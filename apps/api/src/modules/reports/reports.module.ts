import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [EmailModule], // ReportsService.dispatchReportEmail uses EmailService
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
