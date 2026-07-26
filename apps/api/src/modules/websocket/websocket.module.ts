import { Module, Global, forwardRef } from '@nestjs/common';
import { RunsGateway } from './runs.gateway';
import { ScreencastGateway } from './screencast.gateway';
import { WorkerEventsService } from './worker-events.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { QuarantineModule } from '../quarantine/quarantine.module';
import { SelectorHealsModule } from '../selector-heals/selector-heals.module';
import { AuthTokensModule } from '../auth/auth-tokens.module';

@Global()
@Module({
  imports: [
    AuthTokensModule,
    forwardRef(() => FeatureRunsModule),
    forwardRef(() => PipelinesModule),
    QuarantineModule,
    forwardRef(() => SelectorHealsModule),
  ],
  providers: [RunsGateway, ScreencastGateway, WorkerEventsService],
  exports: [RunsGateway, ScreencastGateway],
})
export class WebsocketModule {}
