import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { OIDCStrategy, IProfile, VerifyCallback } from 'passport-azure-ad';
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

    super({
      identityMetadata: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`,
      clientID:         config.get<string>('MICROSOFT_CLIENT_ID') || 'not-configured',
      clientSecret:     config.get<string>('MICROSOFT_CLIENT_SECRET') || 'not-configured',
      redirectUrl:      callbackURL,
      allowHttpForRedirectUrl: allowHttp,
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

  async validate(profile: IProfile, done: VerifyCallback) {
    try {
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
        return done(
          new Error(
            'Microsoft sign-in did not return an email + subject. The app registration probably lacks User.Read / openid / email scopes — re-grant in Azure portal → API permissions.',
          ),
        );
      }

      const auth = await this.authService.findOrCreateSsoUser({
        provider: 'MICROSOFT',
        providerId: String(microsoftId),
        email: String(email).toLowerCase(),
        name: String(name),
      });
      return done(null, auth);
    } catch (err) {
      return done(err as Error);
    }
  }
}
