import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { OIDCStrategy, IProfile } from 'passport-azure-ad';
import { createHash } from 'crypto';
import { AuthService } from '../auth.service';
import { apiUrl } from '../../../common/config/urls';

/**
 * Microsoft / Azure AD Entra SSO via OpenID Connect (authorization-code flow).
 *
 * Mirrors GoogleStrategy structurally so the rest of the auth pipeline
 * (findOrCreateSsoUser, JWT issuance, invite-token state passthrough) is
 * provider-agnostic. The only Microsoft-specific bits are:
 *
 *   - `identityMetadata` URL embeds the tenant. We default to `organizations`
 *     for work/school accounts only (per the agreed B2B policy — personal
 *     outlook.com accounts are intentionally excluded). Override via the
 *     MICROSOFT_TENANT_ID env to either a specific tenant GUID (single
 *     tenant) or `common` (work + school + personal).
 *
 *   - `responseType: 'code'` + `responseMode: 'query'` means Azure redirects
 *     back to us with a `?code=...` we then exchange server-side. No tokens
 *     ever touch the browser — same model as our Google flow.
 *
 *   - Claim extraction is brittle: different Azure tenants surface email in
 *     different fields depending on whether the app has Mail.Read or just
 *     User.Read. We fall through `preferred_username` → `upn` → `email` →
 *     `emails[0]` to be tolerant.
 */
@Injectable()
export class MicrosoftStrategy extends PassportStrategy(OIDCStrategy, 'microsoft') {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    const explicit = config.get<string>('MICROSOFT_CALLBACK_URL');
    const callbackURL = explicit ?? `${apiUrl()}/api/v1/auth/microsoft/callback`;
    const tenant = config.get<string>('MICROSOFT_TENANT_ID') ?? 'organizations';

    // passport-azure-ad refuses non-HTTPS redirect URLs out of the box —
    // safe default for prod, but our local dev runs http://localhost:3001.
    // Opt-in to HTTP only when the callback URL itself is http:// AND we're
    // in non-production. Anything pointing to https:// keeps the stricter
    // default. Belt-and-braces: NODE_ENV must also not be 'production'.
    const allowHttp =
      callbackURL.startsWith('http://') &&
      (config.get<string>('NODE_ENV') ?? 'development') !== 'production';

    // passport-azure-ad's default storage for the OAuth `state` + `nonce`
    // round-trip is express-session. Our API is stateless (JWT only — no
    // session middleware), so we flip the strategy into cookie-storage mode
    // via `useCookieInsteadOfSession`. That cookie is AES-GCM encrypted —
    // we MUST provide a stable 32-byte key + 12-byte IV (the byte sizes
    // expected by Node's `crypto.createCipheriv('aes-256-gcm', …)`).
    //
    // Deriving from JWT_SECRET via SHA-256 + domain-separator strings
    // gives us:
    //   - a strong, restart-survivable key (so users mid-flow don't get
    //     "invalid state" if the API process bounces between authorize
    //     and callback)
    //   - no NEW env var to manage
    //   - cryptographic independence from the actual JWT signing key
    //     (different hash inputs → no key-reuse risk)
    //
    // Same length on every restart — exactly what the encryption layer
    // expects. The slice lengths look funny: 32-char ascii string IS 32
    // bytes UTF-8, which is what aes-256 wants for its key. 12 chars for
    // the GCM IV, same logic.
    const jwtSecret = config.get<string>('JWT_SECRET') ?? '';
    const cookieKey = createHash('sha256').update(`${jwtSecret}|microsoft-sso-cookie-key`).digest('hex').slice(0, 32);
    const cookieIv  = createHash('sha256').update(`${jwtSecret}|microsoft-sso-cookie-iv`).digest('hex').slice(0, 12);

    super({
      identityMetadata: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`,
      clientID:         config.get<string>('MICROSOFT_CLIENT_ID') || 'not-configured',
      clientSecret:     config.get<string>('MICROSOFT_CLIENT_SECRET') || 'not-configured',
      redirectUrl:      callbackURL,
      allowHttpForRedirectUrl: allowHttp,
      useCookieInsteadOfSession: true,
      cookieEncryptionKeys: [{ key: cookieKey, iv: cookieIv }],
      responseType:     'code',
      responseMode:     'query',
      scope:            ['openid', 'profile', 'email', 'User.Read'],
      // `common` and `organizations` mean we don't know the tenant up front,
      // so the issuer in the ID token won't match a single expected value.
      // passport-azure-ad accepts an array of valid issuers; we instead
      // disable strict issuer validation for multi-tenant mode (the standard
      // approach — Microsoft signs every ID token, and the audience claim
      // pins it to OUR client ID, so a wrong tenant can't forge a login).
      validateIssuer:   tenant !== 'common' && tenant !== 'organizations' && tenant !== 'consumers',
      passReqToCallback: false,
      loggingLevel:     'warn',
      // Request access scopes (User.Read) so the access_token works against
      // Microsoft Graph if we ever decide to fetch additional profile data.
      // For login alone the ID token is sufficient.
    });
  }

  /**
   * NestJS-passport convention: `validate()` RETURNS the user object —
   * NestJS internally wraps that into `done(null, user)` for passport.
   * Do NOT also call done() manually (the v1 of this strategy did, which
   * silently broke the round-trip — `return done(…)` resolves the promise
   * to `undefined`, NestJS reads that as "no user", and AuthGuard rejected
   * the callback with 401 in a few milliseconds with no error log).
   *
   * Mirror the same shape as GoogleStrategy.validate (further up the file
   * tree) so the two providers behave identically downstream.
   */
  async validate(profile: IProfile) {
    // passport-azure-ad gives us a `profile` with claim grab-bag in `_json`.
    // Use the standard OIDC claims first, fall back to the AAD-specific
    // ones for older tenants.
    const claims = (profile._json ?? {}) as Record<string, unknown>;
    const email =
      (typeof claims.email === 'string' && claims.email) ||
      (typeof claims.preferred_username === 'string' && claims.preferred_username) ||
      (typeof claims.upn === 'string' && claims.upn) ||
      profile.upn ||
      (Array.isArray(profile.emails) ? profile.emails[0] : undefined);
    const name =
      profile.displayName ||
      (typeof claims.name === 'string' && claims.name) ||
      (email ? email.split('@')[0] : 'Microsoft User');
    const microsoftId = profile.oid || profile.sub;

    if (!email || !microsoftId) {
      throw new UnauthorizedException(
        'Microsoft sign-in did not return an email + subject. The app registration probably lacks User.Read / openid / email scopes — re-grant in Azure portal → API permissions.',
      );
    }

    return this.authService.findOrCreateSsoUser({
      provider: 'MICROSOFT',
      providerId: String(microsoftId),
      email: String(email).toLowerCase(),
      name: String(name),
    });
  }
}
