import { Module } from '@nestjs/common';
import { RunSchedulesController } from './run-schedules.controller';
import { RunSchedulesService } from './run-schedules.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';

@Module({
  imports: [FeatureRunsModule],
  controllers: [RunSchedulesController],
  providers: [RunSchedulesService],
  exports: [RunSchedulesService],
})
export class RunSchedulesModule {}
