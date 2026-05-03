import { Module } from '@nestjs/common';
import { TestsController, TestsDetailController } from './tests.controller';
import { TestsService } from './tests.service';
import { AuditModule } from '../audit/audit.module';
import { ImportExportModule } from '../import-export/import-export.module';
import { WorkSessionsModule } from '../work-sessions/work-sessions.module';

@Module({
  imports: [AuditModule, ImportExportModule, WorkSessionsModule],
  controllers: [TestsController, TestsDetailController],
  providers: [TestsService],
  exports: [TestsService],
})
export class TestsModule {}
