import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { createHash } from 'crypto';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { isProviderEnabled } from './auth.module';
import { GoogleEnabledGuard, MicrosoftEnabledGuard } from './guards/sso-provider.guards';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { webUrl, apiUrl } from '../../common/config/urls';
import { PlatformBrandingService } from '../platform/platform-branding.service';

/** Raw OAuth identity returned by the SSO strategies' validate(). */
interface SsoProfile {
  provider: 'GOOGLE' | 'MICROSOFT';
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

const SSO_LINK_COOKIE = 'sso_link';

interface RequestWithMetadata {
  headers: { 'user-agent'?: string; [k: string]: unknown };
  ip?: string;
}

function extractMetadata(req: RequestWithMetadata) {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}

/**
 * Write a 302 redirect directly onto the underlying Node ServerResponse,
 * bypassing Fastify's reply.redirect / reply.send pipeline.
 *
 * Why we don't use reply.redirect: the OAuth flow installs an Express ↔
 * Fastify compat shim (main.ts) that decorates reply.{setHeader, end,
 * statusCode, cookie} so passport-azure-ad's Express-style writes survive
 * the round-trip. That shim conflicts with Fastify's send pipeline on the
 * return leg — calling reply.redirect() finished as an empty 200 instead
 * of a 302, leaving users stuck on the callback URL with a blank page.
 *
 * Writing directly to raw mirrors what passport's own redirect does on
 * the /microsoft start endpoint (which works), and sidesteps every
 * possible interaction with the shim.
 */
function issueSsoRedirect(raw: import('http').ServerResponse, url: string) {
  raw.statusCode = 302;
  raw.setHeader('Location', url);
  raw.setHeader('Content-Length', '0');
  raw.end();
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly tokens: TokenService,
    private readonly workSessions: WorkSessionsService,
    private readonly featureRuns: FeatureRunsService,
    private readonly config: ConfigService,
    private readonly platformBranding: PlatformBrandingService,
    private readonly jwt: JwtService,
  ) {}

  // ── SSO link helpers ───────────────────────────────────────────────────────
  // Link tokens are signed with a secret DERIVED from JWT_SECRET (not the secret
  // itself) so a link token can never be replayed as a session bearer — the
  // JwtStrategy verifies with JWT_SECRET and will reject these.
  private linkSecret(): string {
    const base = this.config.get<string>('JWT_SECRET') ?? '';
    return createHash('sha256').update(`${base}|sso-link`).digest('hex');
  }
  private signLinkToken(userId: string, provider: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, provider, purpose: 'sso-link' },
      { secret: this.linkSecret(), expiresIn: '10m' },
    );
  }
  private async verifyLinkToken(token: string): Promise<{ sub: string; provider: string } | null> {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; provider: string; purpose: string }>(
        token, { secret: this.linkSecret() },
      );
      return p.purpose === 'sso-link' ? { sub: p.sub, provider: p.provider } : null;
    } catch {
      return null;
    }
  }
  private readLinkCookie(req: { headers: { cookie?: string } }): string | undefined {
    const raw = req.headers?.cookie;
    if (!raw) return undefined;
    for (const part of raw.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === SSO_LINK_COOKIE) return decodeURIComponent(v.join('='));
    }
    return undefined;
  }
  private setLinkCookie(raw: import('http').ServerResponse, value: string) {
    const secure = (this.config.get<string>('NODE_ENV') ?? 'development') === 'production';
    raw.setHeader('Set-Cookie',
      `${SSO_LINK_COOKIE}=${encodeURIComponent(value)}; Max-Age=600; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
  }
  private clearLinkCookie(raw: import('http').ServerResponse) {
    raw.setHeader('Set-Cookie', `${SSO_LINK_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
  }

  /**
   * Shared SSO callback: link mode (attach to the current user, keep session)
   * when a valid sso_link cookie is present, else login mode (issue a token).
   */
  private async handleSsoCallback(
    req: { user: SsoProfile; headers: { cookie?: string } },
    raw: import('http').ServerResponse,
  ) {
    const profile = req.user;
    const linkCookie = this.readLinkCookie(req);
    const link = linkCookie ? await this.verifyLinkToken(linkCookie) : null;

    if (link && link.provider === profile.provider) {
      this.clearLinkCookie(raw);
      try {
        await this.service.linkSsoAccount(link.sub, {
          provider: profile.provider,
          providerId: profile.providerId,
          email: profile.email,
        });
        return issueSsoRedirect(raw, `${webUrl()}/settings?section=linked-accounts&linked=${profile.provider.toLowerCase()}`);
      } catch (e) {
        const msg = e instanceof ConflictException ? e.message : 'Could not link this account.';
        return issueSsoRedirect(raw, `${webUrl()}/settings?section=linked-accounts&linkError=${encodeURIComponent(msg)}`);
      }
    }

    // Login mode — unchanged behaviour.
    const auth = await this.service.findOrCreateSsoUser(profile);
    return issueSsoRedirect(raw, `${webUrl()}/auth/callback?token=${auth.accessToken}`);
  }

  /**
   * Public discovery endpoint. The frontend hits this on Login/Register/Invite
   * pages and conditionally renders the relevant SSO buttons. Cheap (env
   * read), so React Query caching the response for a few minutes is plenty.
   */
  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Discover which auth providers + platform branding are enabled on this deployment' })
  async authConfig() {
    const branding = await this.platformBranding.get();
    return {
      providers: {
        password: true,
        google: isProviderEnabled(this.config, 'GOOGLE'),
        microsoft: isProviderEnabled(this.config, 'MICROSOFT'),
      },
      // Platform-wide default branding (cosmetic). Org/per-user branding still
      // overrides this after login; this is the deployment-wide default shown
      // on login/register and as the in-app fallback when an org has no logo.
      branding: { logoUrl: branding.logoUrl, appName: branding.appName },
    };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Register a new user + create organisation' })
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Login with email + password' })
  async login(@Body() dto: LoginDto, @Req() req: RequestWithMetadata) {
    const result = await this.service.login(dto, extractMetadata(req));
    // Close any QA work sessions left dangling from a previous login
    // (browser closed without logout, token expired before the stale-sweep
    // cron caught it, etc.) so this fresh login starts with a clean slate.
    // Identifier is pulled from the freshly-issued access token's payload —
    // /login is @Public(), so we don't have a JwtPayload from the request.
    try {
      const sub = JSON.parse(
        Buffer.from(result.accessToken.split('.')[1], 'base64url').toString(),
      )?.sub as string | undefined;
      if (sub) {
        await this.workSessions.endAllForUser(sub, 'superseded').catch(() => { /* non-fatal */ });
      }
    } catch { /* non-fatal — login still succeeds even if cleanup throws */ }
    return result;
  }

  /**
   * Refresh-token rotation. Trade an unrevoked refresh token for a fresh
   * (access, refresh) pair. The old refresh token is single-use — re-using
   * it triggers replay-detection and revokes ALL of the user's sessions.
   */
  @Public()
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Trade a refresh token for a fresh (access, refresh) pair' })
  async refresh(@Body() dto: { refreshToken: string }, @Req() req: RequestWithMetadata) {
    if (!dto?.refreshToken) {
      // Mirror the service's ForbiddenException so the client-side handling
      // is uniform whether the token is missing, invalid, or revoked.
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('refreshToken required');
    }
    const { accessToken, refreshToken } = await this.tokens.rotate(dto.refreshToken, extractMetadata(req));
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      accessTokenExpiresInSeconds: 15 * 60,
    };
  }

  /**
   * Logout. Revokes the supplied refresh token (DB) AND blacklists the
   * current access token's `jti` (Redis) so the residual ~15-min window
   * collapses immediately. Idempotent — calling twice is a no-op.
   */
  @Post('logout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Logout — revoke refresh token + blacklist current access token' })
  async logout(
    @CurrentUser() user: JwtPayload & { jti?: string; exp?: number },
    @Body() dto: { refreshToken?: string },
  ) {
    // 1. End all active QA work sessions for this user so session timers
    //    stop immediately. Must happen BEFORE the JTI is blacklisted — once
    //    blacklisted any subsequent authenticated request (including the
    //    frontend's separate workSessionsApi.end() call) would be rejected.
    //    Also abandon any active manual FeatureRun — logging out used to
    //    leave runs RUNNING, so the user got a conflict modal on next login
    //    and the run lingered until the hourly stuck-run sweep.
    await this.featureRuns.endAllActiveManualForUser(user.sub, 'logout').catch(() => { /* non-fatal */ });
    await this.workSessions.endAllForUser(user.sub, 'logout').catch(() => { /* non-fatal */ });
    // 2. Revoke whichever refresh token the client is holding (if any).
    //    Lookup by hash, since clients only ever have plaintext.
    if (dto?.refreshToken) {
      const crypto = await import('crypto');
      const tokenHash = crypto.createHash('sha256').update(dto.refreshToken).digest('hex');
      await this.service.revokeRefreshTokenByHash(user.sub, tokenHash);
    }
    // 3. Blacklist the access token JTI so the rest of its lifetime is dead.
    await this.tokens.blacklistAccessToken(user.jti, user.exp);
  }

  /**
   * Logout EVERYWHERE. Revokes every refresh token for the user. Existing
   * access tokens still live for up to 15 min (we'd need every JTI to
   * blacklist them); good enough for "I lost my laptop" scenarios.
   */
  @Post('logout-all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke all refresh tokens for the current user (sign out of every device)' })
  async logoutAll(@CurrentUser() user: JwtPayload & { jti?: string; exp?: number }) {
    await this.featureRuns.endAllActiveManualForUser(user.sub, 'logout').catch(() => { /* non-fatal */ });
    await this.workSessions.endAllForUser(user.sub, 'logout').catch(() => { /* non-fatal */ });
    await this.tokens.revokeAllForUser(user.sub, 'logout-all');
    await this.tokens.blacklistAccessToken(user.jti, user.exp);
  }

  /** List active refresh-token sessions for the current user. */
  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List active sessions (refresh tokens) for the current user' })
  listSessions(@CurrentUser() user: JwtPayload) {
    return this.tokens.listSessionsForUser(user.sub);
  }

  /** Revoke one specific session ("Sign out this device"). */
  @Delete('sessions/:id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a specific session by id' })
  async revokeSession(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    // Service layer asserts the session belongs to this user before revoking
    // — a malicious client mustn't be able to revoke another user's tokens
    // by guessing UUIDs.
    await this.service.revokeSessionById(user.sub, id);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user profile with org memberships' })
  me(@CurrentUser() user: JwtPayload) {
    return this.service.me(user.sub);
  }

  // ── Password reset (email-based) ─────────────────────────────────────────

  @Public()
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password-reset email. Always returns 204 (no user enumeration).' })
  forgotPassword(@Body() dto: { email: string }) {
    // Fire-and-forget; controller never reveals whether the email exists
    // (anti-enum). Service handles missing user silently.
    this.service.requestPasswordReset(dto.email).catch(() => { /* swallowed */ });
    return { ok: true };
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @ApiOperation({ summary: 'Set a new password using a reset token from email' })
  resetPassword(@Body() dto: { token: string; newPassword: string }) {
    return this.service.resetPasswordWithToken(dto.token, dto.newPassword);
  }

  // ── Email verification ───────────────────────────────────────────────────

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @ApiOperation({ summary: 'Verify a user\'s email using the activation token' })
  verifyEmail(@Body() dto: { token: string }) {
    return this.service.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Resend the email-verification message' })
  resendVerification(@CurrentUser() user: JwtPayload) {
    return this.service.resendVerification(user.sub);
  }

  @Post('switch-org/:orgId')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Switch active organisation and re-issue token' })
  switchOrg(@CurrentUser() user: JwtPayload, @Param('orgId') orgId: string) {
    return this.service.switchOrg(user.sub, orgId);
  }

  // ── SSO: Google ────────────────────────────────────────────────────────────
  //
  // Guard order matters — *EnabledGuard runs FIRST and short-circuits with
  // a clean 404 when the provider is off. Without it, AuthGuard would try
  // to look up an unregistered Passport strategy and throw a 500.

  @Public()
  @Get('google')
  @UseGuards(GoogleEnabledGuard, AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth2 login' })
  googleAuth() {
    // redirect handled by passport
  }

  // ── SSO account linking (attach an identity to the CURRENT user) ───────────

  @Post('sso/link/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Begin linking an SSO provider to the current account — returns a redirect URL' })
  async startSsoLink(@CurrentUser() user: JwtPayload, @Body() body: { provider?: string }) {
    const provider = (body?.provider ?? '').toLowerCase();
    if (provider !== 'google' && provider !== 'microsoft') {
      throw new BadRequestException('provider must be "google" or "microsoft"');
    }
    const token = await this.signLinkToken(user.sub, provider.toUpperCase());
    return { url: `${apiUrl()}/api/v1/auth/sso/link-init?token=${encodeURIComponent(token)}` };
  }

  @Public()
  @Get('sso/link-init')
  @ApiOperation({ summary: 'Consume a link token, set the link cookie, then enter the OAuth start (top-level nav)' })
  async ssoLinkInit(@Req() req: { query: { token?: string } }, @Res() res: { raw: import('http').ServerResponse }) {
    const token = req.query?.token;
    const link = token ? await this.verifyLinkToken(token) : null;
    if (!link) {
      return issueSsoRedirect(res.raw, `${webUrl()}/settings?section=linked-accounts&linkError=${encodeURIComponent('Link request expired — please try again.')}`);
    }
    this.setLinkCookie(res.raw, token!);
    const startPath = link.provider === 'GOOGLE' ? 'google' : 'microsoft';
    return issueSsoRedirect(res.raw, `${apiUrl()}/api/v1/auth/${startPath}`);
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleEnabledGuard, AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback (login or link)' })
  // The Fastify reply object — we use its `.raw` (Node's ServerResponse) to
  // write the redirect directly; reply.redirect() interacts poorly with the
  // Fastify ↔ Passport compat shim in main.ts (empty 200 instead of 302).
  googleCallback(
    @Req() req: { user: SsoProfile; headers: { cookie?: string } },
    @Res() res: { raw: import('http').ServerResponse },
  ) {
    return this.handleSsoCallback(req, res.raw);
  }

  // ── SSO: Microsoft / Azure AD ──────────────────────────────────────────────

  @Public()
  @Get('microsoft')
  @UseGuards(MicrosoftEnabledGuard, AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Initiate Microsoft / Azure AD OIDC login' })
  microsoftAuth() {
    // redirect handled by passport-azure-ad
  }

  @Public()
  @Get('microsoft/callback')
  @UseGuards(MicrosoftEnabledGuard, AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Microsoft / Azure AD OIDC callback (login or link)' })
  microsoftCallback(
    @Req() req: { user: SsoProfile; headers: { cookie?: string } },
    @Res() res: { raw: import('http').ServerResponse },
  ) {
    return this.handleSsoCallback(req, res.raw);
  }

  /**
   * passport-azure-ad does the authorize → callback handshake via POST in
   * some tenant configurations (response_mode=form_post). We accept both
   * GET and POST on the callback to be safe — both delegate to the same
   * guards, which only care about req.user being populated.
   */
  @Public()
  @Post('microsoft/callback')
  @UseGuards(MicrosoftEnabledGuard, AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Microsoft / Azure AD OIDC callback (form_post mode; login or link)' })
  microsoftCallbackPost(
    @Req() req: { user: SsoProfile; headers: { cookie?: string } },
    @Res() res: { raw: import('http').ServerResponse },
  ) {
    return this.handleSsoCallback(req, res.raw);
  }

  // ── SSO Account Management ─────────────────────────────────────────────────

  @Get('sso/accounts')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List linked SSO accounts for current user' })
  getSsoAccounts(@CurrentUser() user: JwtPayload) {
    return this.service.getSsoAccounts(user.sub);
  }

  @Delete('sso/:provider')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Unlink an SSO provider from current user account' })
  unlinkSso(@CurrentUser() user: JwtPayload, @Param('provider') provider: string) {
    return this.service.unlinkSsoAccount(user.sub, provider.toUpperCase());
  }

  // ── Profile & Password ─────────────────────────────────────────────────────

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update current user profile (name, avatarUrl)' })
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.service.updateProfile(user.sub, dto);
  }

  @Patch('me/notification-prefs')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update notification preferences for the current user' })
  updateNotificationPrefs(
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateNotificationPrefs(user.sub, body);
  }

  @Patch('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change password for current user' })
  async changePassword(
    @CurrentUser() user: JwtPayload & { jti?: string; exp?: number },
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.service.changePassword(user.sub, dto);
    // Belt-and-braces: revokeAllForUser already kills every refresh token,
    // but the caller's own access token would still live for ≤15 min. Bump
    // their JTI into the blacklist so they're forced to re-auth right now.
    await this.tokens.blacklistAccessToken(user.jti, user.exp);
    return result;
  }

  @Post('me/request-email-change')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Initiate email change — verification link goes to the new address' })
  requestEmailChange(
    @CurrentUser() user: JwtPayload,
    @Body() body: { newEmail: string; currentPassword: string },
  ) {
    return this.service.requestEmailChange(user.sub, body.newEmail, body.currentPassword);
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('confirm-email-change')
  @ApiOperation({ summary: 'Confirm email change via token from the verification email' })
  confirmEmailChange(@Body('token') token: string) {
    return this.service.confirmEmailChange(token);
  }
}
