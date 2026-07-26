import { Module, forwardRef, Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { MicrosoftStrategy } from './strategies/microsoft.strategy';
import { GoogleEnabledGuard, MicrosoftEnabledGuard } from './guards/sso-provider.guards';
import { WorkSessionsModule } from '../work-sessions/work-sessions.module';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { AuthTokensModule } from './auth-tokens.module';

/**
 * Access tokens are intentionally short-lived (15 min). Long-running clients
 * use the refresh-token flow (POST /auth/refresh) to mint a new access token
 * — see TokenService for rotation semantics. Logging the user out revokes the
 * refresh token AND adds the access token's `jti` to the Redis revocation set
 * so the residual access window collapses to whatever's left of the 15 min.
 */
const log = new Logger('AuthModule');

/**
 * Per-provider boot-time flag resolution. SSO is gated by:
 *
 *   1. `*_SSO_ENABLED` env var (explicit on/off — wins if set to "false")
 *   2. Presence of the corresponding `*_CLIENT_ID` env var (back-compat —
 *      Google was implicitly enabled by configuration before the flag
 *      existed, so we keep that behaviour when the flag isn't set)
 *
 * When a provider IS enabled but its credentials are blank/missing, we throw
 * at boot rather than at first user click. Same fail-fast contract as
 * JWT_SECRET — bad config never silently degrades to a runtime mystery.
 */
export function isProviderEnabled(
  c: ConfigService,
  provider: 'GOOGLE' | 'MICROSOFT',
): boolean {
  const flag = c.get<string>(`${provider}_SSO_ENABLED`);
  const clientId = c.get<string>(`${provider}_CLIENT_ID`);
  const clientSecret = c.get<string>(`${provider}_CLIENT_SECRET`);

  // Explicit flag wins.
  if (flag === 'true' || flag === '1') {
    if (!clientId || !clientSecret) {
      throw new Error(
        `${provider}_SSO_ENABLED=true but ${provider}_CLIENT_ID / ${provider}_CLIENT_SECRET are missing. ` +
          `Fill them in or set ${provider}_SSO_ENABLED=false.`,
      );
    }
    return true;
  }
  if (flag === 'false' || flag === '0') return false;

  // Flag unset — fall back to "enabled if credentials are present" so that
  // existing deployments configured before this flag existed keep working.
  // Microsoft has no such legacy users (this is its first appearance), so
  // for it the default is effectively off until both creds AND the flag
  // are set. We require explicit opt-in for new providers.
  if (provider === 'MICROSOFT') return false;
  return Boolean(clientId && clientSecret);
}

@Module({
  imports: [
    WorkSessionsModule,
    AuthTokensModule,
    // forwardRef — FeatureRunsModule sits in a circular import with
    // WorkSessionsModule; importing it here lets the logout handler abandon
    // active manual runs.
    forwardRef(() => FeatureRunsModule),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // SSO strategies are only registered with Passport when their provider
    // is enabled. A disabled provider means the strategy class never
    // instantiates → `AuthGuard('google')` / `AuthGuard('microsoft')` will
    // throw "Unknown authentication strategy" → controller routes return
    // 500 unless we also gate them with the same flag (see auth.controller).
    //
    // Defense in depth: we ALSO check the flag inside the controller
    // before invoking the guard, so a disabled provider returns 404 cleanly
    // rather than a 500 stack trace.
    {
      provide: GoogleStrategy,
      inject: [ConfigService, AuthService],
      useFactory: (c: ConfigService, auth: AuthService) => {
        if (!isProviderEnabled(c, 'GOOGLE')) {
          log.log('Google SSO disabled — strategy not registered');
          return null;
        }
        log.log('Google SSO enabled — strategy registered');
        return new GoogleStrategy(c, auth);
      },
    } satisfies Provider,
    {
      provide: MicrosoftStrategy,
      inject: [ConfigService, AuthService],
      useFactory: (c: ConfigService, auth: AuthService) => {
        if (!isProviderEnabled(c, 'MICROSOFT')) {
          log.log('Microsoft SSO disabled — strategy not registered');
          return null;
        }
        log.log('Microsoft SSO enabled — strategy registered');
        return new MicrosoftStrategy(c, auth);
      },
    } satisfies Provider,
    GoogleEnabledGuard,
    MicrosoftEnabledGuard,
  ],
  exports: [AuthService, AuthTokensModule],
})
export class AuthModule {}
