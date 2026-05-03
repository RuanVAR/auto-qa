import { Module } from '@nestjs/common';
import { ReportSchedulesController } from './report-schedules.controller';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [ReportSchedulesController],
  providers: [ReportSchedulesService],
  exports: [ReportSchedulesService],
})
export class ReportSchedulesModule {}
