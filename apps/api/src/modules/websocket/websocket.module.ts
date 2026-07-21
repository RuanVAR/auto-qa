import { Module, Global, forwardRef } from '@nestjs/common';
import { RunsGateway } from './runs.gateway';
import { ScreencastGateway } from './screencast.gateway';
import { WorkerEventsService } from './worker-events.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { QuarantineModule } from '../quarantine/quarantine.module';

@Global()
@Module({
  imports: [forwardRef(() => FeatureRunsModule), forwardRef(() => PipelinesModule), QuarantineModule],
  providers: [RunsGateway, ScreencastGateway, WorkerEventsService],
  exports: [RunsGateway, ScreencastGateway],
})
export class WebsocketModule {}
