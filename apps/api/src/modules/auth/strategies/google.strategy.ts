import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    // Callback URL precedence: explicit GOOGLE_CALLBACK_URL > derived from
    // API_URL (the public base URL of the API) > localhost dev fallback.
    // The localhost fallback only fires when neither prod-style env is set,
    // so production misconfiguration crashes the OAuth flow visibly rather
    // than silently mailing localhost links to real users.
    const explicit = config.get<string>('GOOGLE_CALLBACK_URL');
    const apiBase = config.get<string>('API_URL');
    const callbackURL = explicit
      ?? (apiBase ? `${apiBase.replace(/\/$/, '')}/api/v1/auth/google/callback` : undefined)
      ?? 'http://localhost:3001/api/v1/auth/google/callback';
    super({
      clientID:     config.get<string>('GOOGLE_CLIENT_ID') || 'not-configured',
      clientSecret: config.get<string>('GOOGLE_CLIENT_SECRET') || 'not-configured',
      callbackURL,
      scope: ['email', 'profile'],
    });
  }

  async validate(_accessToken: string, _refreshToken: string, profile: Profile) {
    const { emails, displayName, photos, id: googleId } = profile;
    return this.authService.findOrCreateSsoUser({
      provider: 'GOOGLE',
      providerId: googleId,
      email: emails![0].value,
      name: displayName,
      avatarUrl: photos?.[0]?.value,
    });
  }
}
