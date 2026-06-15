import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';
import { apiUrl } from '../../../common/config/urls';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    // Callback URL precedence: explicit GOOGLE_CALLBACK_URL > derived
    // from API_URL helper (which falls back to localhost:3001 for dev,
    // and is asserted-non-empty in production by assertProdUrls()).
    // Use a truthiness check, not `??`: docker-compose passes the var through
    // as an EMPTY STRING when unset (`${GOOGLE_CALLBACK_URL:-}`), and `??`
    // wouldn't fall back on '' — leaving passport with an empty callbackURL
    // and omitting redirect_uri entirely (Google: "Missing required parameter:
    // redirect_uri").
    const explicit = config.get<string>('GOOGLE_CALLBACK_URL')?.trim();
    const callbackURL = explicit || `${apiUrl()}/api/v1/auth/google/callback`;
    super({
      clientID:     config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    const { emails, displayName, photos, id: googleId } = profile;
    // Return the RAW identity — the callback branches login vs link (see
    // MicrosoftStrategy for the rationale). Find-or-create no longer happens here.
    return {
      provider: 'GOOGLE' as const,
      providerId: googleId,
      email: emails![0].value.toLowerCase(),
      name: displayName,
      avatarUrl: photos?.[0]?.value,
    };
  }
}
