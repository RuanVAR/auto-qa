import { Module, forwardRef } from '@nestjs/common';
import { FeatureRunsController, OrgActiveSessionsController } from './feature-runs.controller';
import { FeatureRunsService } from './feature-runs.service';
import { StuckRunsService } from './stuck-runs.service';
import { QueueModule } from '../queue/queue.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkSessionsModule } from '../work-sessions/work-sessions.module';

@Module({
  imports: [QueueModule, forwardRef(() => WebsocketModule), NotificationsModule, forwardRef(() => WorkSessionsModule)],
  controllers: [FeatureRunsController, OrgActiveSessionsController],
  providers: [FeatureRunsService, StuckRunsService],
  exports: [FeatureRunsService, StuckRunsService],
})
export class FeatureRunsModule {}
