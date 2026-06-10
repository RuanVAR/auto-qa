import { Module } from '@nestjs/common';
import { TestRunSessionsController } from './test-run-sessions.controller';
import { TestRunSessionsService } from './test-run-sessions.service';
import { ReportsModule } from '../reports/reports.module';
import { NotificationsModule } from '../notifications/notifications.module';

// PrismaModule + AccessModule (EnvAccessService) are @Global. ReportsModule is
// imported for run-scoped report generation; NotificationsModule to alert
// project managers when a run finishes.
@Module({
  imports: [ReportsModule, NotificationsModule],
  controllers: [TestRunSessionsController],
  providers: [TestRunSessionsService],
  exports: [TestRunSessionsService],
})
export class TestRunSessionsModule {}
