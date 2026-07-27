import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TokenService } from './token.service';

const ACCESS_TOKEN_TTL = '15m';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.trim().length < 16) {
          throw new Error(
            'JWT_SECRET is missing or too short (<16 chars). Set a strong random value before booting the API.',
          );
        }
        return {
          secret,
          signOptions: {
            expiresIn: ACCESS_TOKEN_TTL,
            algorithm: 'HS256' as const,
          },
        };
      },
    }),
  ],
  providers: [TokenService],
  exports: [JwtModule, TokenService],
})
export class AuthTokensModule {}
