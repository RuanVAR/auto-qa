import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Org-level BI analytics surface. Wires the dashboard controller to the
 * service that does the heavy aggregations. PrismaService is provided
 * globally (PrismaModule), so no extra imports needed.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
