import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

/**
 * Access tokens are intentionally short-lived (15 min). Long-running clients
 * use the refresh-token flow (POST /auth/refresh) to mint a new access token
 * — see TokenService for rotation semantics. Logging the user out revokes the
 * refresh token AND adds the access token's `jti` to the Redis revocation set
 * so the residual access window collapses to whatever's left of the 15 min.
 */
const ACCESS_TOKEN_TTL = '15m';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => {
        const secret = c.get<string>('JWT_SECRET');
        // Fail-fast: a missing secret in production silently signs every
        // token with a shared default → instant credential forgery. Dev
        // compose already sets one; CI / prod deploys must too.
        if (!secret || secret.trim().length < 16) {
          throw new Error(
            'JWT_SECRET is missing or too short (<16 chars). Set a strong random value before booting the API.',
          );
        }
        return {
          secret,
          signOptions: { expiresIn: ACCESS_TOKEN_TTL },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy, GoogleStrategy],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
