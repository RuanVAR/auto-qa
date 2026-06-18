import { Module } from '@nestjs/common';
import { EnvironmentCredentialsController } from './environment-credentials.controller';
import { EnvironmentCredentialsService } from './environment-credentials.service';

@Module({
  controllers: [EnvironmentCredentialsController],
  providers: [EnvironmentCredentialsService],
})
export class EnvironmentCredentialsModule {}
