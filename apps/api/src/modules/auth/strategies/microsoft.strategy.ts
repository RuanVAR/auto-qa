import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OIDCStrategy } = require('passport-azure-ad');
import { AuthService } from '../auth.service';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(OIDCStrategy, 'microsoft') {
  constructor(config: ConfigService, private readonly authService: AuthService) {
    super({
      identityMetadata: `https://login.microsoftonline.com/${config.get('AZURE_AD_TENANT_ID') ?? 'common'}/v2.0/.well-known/openid-configuration`,
      clientID:         config.get<string>('AZURE_AD_CLIENT_ID') ?? 'not-configured',
      clientSecret:     config.get<string>('AZURE_AD_CLIENT_SECRET') ?? 'not-configured',
      redirectUrl:      config.get<string>('AZURE_AD_CALLBACK_URL') ?? 'https://not-configured.local/api/v1/auth/microsoft/callback',
      responseType:     'code',
      responseMode:     'query',
      scope:            ['openid', 'profile', 'email'],
      passReqToCallback: false,
    });
  }

  // OIDCStrategy calls verify with (iss, sub, profile, accessToken, refreshToken, done)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async validate(
    _iss: string,
    _sub: string,
    profile: Record<string, unknown>,
    _accessToken: string,
    _refreshToken: string,
    done: (err: Error | null, user?: unknown) => void,
  ) {
    try {
      const json = profile['_json'] as Record<string, string> | undefined;
      const email: string =
        json?.['email'] ??
        json?.['preferred_username'] ??
        (profile['upn'] as string) ??
        '';

      const user = await this.authService.findOrCreateSsoUser({
        provider: 'MICROSOFT',
        providerId: (profile['oid'] as string) ?? (profile['id'] as string) ?? '',
        email,
        name: (profile['displayName'] as string) ?? email,
      });

      done(null, user);
    } catch (err) {
      done(err as Error);
    }
  }
}
