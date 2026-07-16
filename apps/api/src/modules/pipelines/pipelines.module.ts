import { Module, forwardRef } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { FeatureRunsModule } from '../feature-runs/feature-runs.module';

@Module({
  // forwardRef: feature-runs' completion path notifies pipelines (via the
  // global websocket module), while pipelines start feature runs.
  imports: [forwardRef(() => FeatureRunsModule)],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
