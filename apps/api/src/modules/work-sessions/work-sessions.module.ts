import { Module, forwardRef } from '@nestjs/common';
import { WorkSessionsController } from './work-sessions.controller';
import { WorkSessionsService } from './work-sessions.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';

@Module({
  // forwardRef — FeatureRunsModule imports WorkSessionsModule (FeatureRunsService
  // injects WorkSessionsService) and this module imports FeatureRunsModule
  // (WorkSessionsController injects FeatureRunsService to couple session end).
  imports: [forwardRef(() => FeatureRunsModule)],
  controllers: [WorkSessionsController],
  providers: [WorkSessionsService],
  exports: [WorkSessionsService],
})
export class WorkSessionsModule {}
