import { Module } from '@nestjs/common';
import { FeatureVersionsController } from './feature-versions.controller';
import { FeatureVersionsService } from './feature-versions.service';

@Module({
  controllers: [FeatureVersionsController],
  providers: [FeatureVersionsService],
  exports: [FeatureVersionsService],
})
export class FeatureVersionsModule {}
