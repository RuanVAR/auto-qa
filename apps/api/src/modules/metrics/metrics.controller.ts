import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { parseRunMode } from '../stats/stats.service';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('projects/:projectId/metrics')
export class MetricsController {
  constructor(private readonly service: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Cross-run rollup of test-emitted metrics for a project' })
  get(
    @Param('projectId') projectId: string,
    @Query('envId') envId?: string,
    @Query('mode') mode?: string,
  ) {
    return this.service.computeProjectMetrics(projectId, { envId: envId ?? null, runMode: parseRunMode(mode) });
  }
}
