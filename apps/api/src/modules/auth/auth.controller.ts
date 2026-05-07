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
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly tokens: TokenService,
  ) {}

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
  login(@Body() dto: LoginDto, @Req() req: RequestWithMetadata) {
    return this.service.login(dto, extractMetadata(req));
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
    // 1. Revoke whichever refresh token the client is holding (if any).
    //    Lookup by hash, since clients only ever have plaintext.
    if (dto?.refreshToken) {
      const crypto = await import('crypto');
      const tokenHash = crypto.createHash('sha256').update(dto.refreshToken).digest('hex');
      await this.service.revokeRefreshTokenByHash(user.sub, tokenHash);
    }
    // 2. Blacklist the access token JTI so the rest of its lifetime is dead.
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

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Initiate Google OAuth2 login' })
  googleAuth() {
    // redirect handled by passport
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Google OAuth2 callback' })
  googleCallback(@Req() req: { user: { accessToken: string } }, @Res() res: { redirect: (url: string) => void }) {
    const { accessToken } = req.user;
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    res.redirect(`${webUrl}/auth/callback?token=${accessToken}`);
  }

  // ── SSO: Microsoft ─────────────────────────────────────────────────────────

  @Public()
  @Get('microsoft')
  @UseGuards(AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Initiate Microsoft OIDC login' })
  microsoftAuth() {
    // redirect handled by passport
  }

  @Public()
  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  @ApiOperation({ summary: 'Microsoft OIDC callback' })
  microsoftCallback(@Req() req: { user: { accessToken: string } }, @Res() res: { redirect: (url: string) => void }) {
    const { accessToken } = req.user;
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    res.redirect(`${webUrl}/auth/callback?token=${accessToken}`);
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
}
