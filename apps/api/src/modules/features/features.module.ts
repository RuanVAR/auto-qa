import { Module } from '@nestjs/common';
import { FeaturesController, FeatureDetailController, FeaturesBulkController } from './features.controller';
import { FeaturesService } from './features.service';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [StatsModule],
  controllers: [FeaturesController, FeatureDetailController, FeaturesBulkController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
