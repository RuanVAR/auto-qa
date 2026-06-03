import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EmailModule } from '../../email/email.module';
import { StatsModule } from '../stats/stats.module';

@Module({
  // EmailModule → dispatchReportEmail; StatsModule → the project summary
  // now uses the SAME coverage stats as the dashboards (StatsService) so a
  // generated report can never contradict the project page's pass rate.
  imports: [EmailModule, StatsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
