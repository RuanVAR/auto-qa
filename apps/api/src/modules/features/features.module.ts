import { Module } from '@nestjs/common';
import { FeaturesController, FeatureDetailController } from './features.controller';
import { FeaturesService } from './features.service';
import { StatsModule } from '../stats/stats.module';

@Module({
  imports: [StatsModule],
  controllers: [FeaturesController, FeatureDetailController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}
