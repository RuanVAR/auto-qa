import { Module } from '@nestjs/common';
import { TestRunSessionsController } from './test-run-sessions.controller';
import { TestRunSessionsService } from './test-run-sessions.service';
import { ReportsModule } from '../reports/reports.module';

// PrismaModule + AccessModule (EnvAccessService) are @Global. ReportsModule is
// imported for run-scoped report generation.
@Module({
  imports: [ReportsModule],
  controllers: [TestRunSessionsController],
  providers: [TestRunSessionsService],
  exports: [TestRunSessionsService],
})
export class TestRunSessionsModule {}
