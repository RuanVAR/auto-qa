import { Module } from '@nestjs/common';
import { RunSchedulesController } from './run-schedules.controller';
import { RunSchedulesService } from './run-schedules.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { PipelinesModule } from '../pipelines/pipelines.module';

@Module({
  imports: [FeatureRunsModule, PipelinesModule],
  controllers: [RunSchedulesController],
  providers: [RunSchedulesService],
  exports: [RunSchedulesService],
})
export class RunSchedulesModule {}
