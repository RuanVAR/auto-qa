import { Module } from '@nestjs/common';
import { FeatureSpecController } from './feature-spec.controller';
import { FeatureSpecService } from './feature-spec.service';

@Module({
  controllers: [FeatureSpecController],
  providers: [FeatureSpecService],
})
export class FeatureSpecModule {}
