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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

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
  login(@Body() dto: LoginDto) {
    return this.service.login(dto);
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

  @Patch('me/password')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Change password for current user' })
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.service.changePassword(user.sub, dto);
  }
}
