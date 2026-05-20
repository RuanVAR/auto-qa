import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RecorderController } from './recorder.controller';
import { RecorderService } from './recorder.service';
import { RecorderGateway } from './recorder.gateway';

@Module({
  imports: [
    // Local JwtModule so the gateway can verify viewer tokens. Same config
    // shape as the auth module — both must use the same JWT_SECRET to verify
    // tokens issued by AuthService.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.get<string>('JWT_SECRET') ?? 'dev-only-secret',
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  controllers: [RecorderController],
  providers: [RecorderService, RecorderGateway],
  exports: [RecorderService],
})
export class RecorderModule {}
