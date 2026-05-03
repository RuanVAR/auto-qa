import { Module, forwardRef } from '@nestjs/common';
import { RunsController, RunDetailController } from './runs.controller';
import { RunsService } from './runs.service';
import { RunStepsService } from './runs-steps.service';
import { WebsocketModule } from '../websocket/websocket.module';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { WorkSessionsModule } from '../work-sessions/work-sessions.module';

@Module({
  imports: [WebsocketModule, forwardRef(() => FeatureRunsModule), WorkSessionsModule],
  controllers: [RunsController, RunDetailController],
  providers: [RunsService, RunStepsService],
  exports: [RunsService, RunStepsService],
})
export class RunsModule {}
