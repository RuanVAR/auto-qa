import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtTokenPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'dev_secret'),
    });
  }

  validate(payload: JwtTokenPayload) {
    return {
      sub: payload.sub,
      email: payload.email,
      platformRole: payload.platformRole,
      activeOrgId: payload.activeOrgId,
      orgRole: payload.orgRole,
      // legacy compat
      role: payload.platformRole,
    };
  }
}
