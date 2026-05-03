import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportFrequency, ReportScope } from '@prisma/client';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';

interface ScheduleDto {
  name: string;
  scope: ReportScope;
  scopeId?: string;
  phaseId?: string;
  frequency: ReportFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  sendTime: string;
  recipients: string[];
  includeCharts?: boolean;
}

@ApiTags('report-schedules') @ApiBearerAuth()
@Controller()
export class ReportSchedulesController {
  constructor(private readonly service: ReportSchedulesService) {}

  @Get('projects/:projectId/report-schedules')
  @ApiOperation({ summary: 'List scheduled reports for a project' })
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post('projects/:projectId/report-schedules')
  @ApiOperation({ summary: 'Create a scheduled report' })
  create(
    @Param('projectId') projectId: string,
    @Body() dto: ScheduleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(projectId, user.sub, dto);
  }

  @Patch('report-schedules/:id')
  @ApiOperation({ summary: 'Update a scheduled report' })
  update(@Param('id') id: string, @Body() dto: Partial<ScheduleDto>) {
    return this.service.update(id, dto);
  }

  @Delete('report-schedules/:id')
  @ApiOperation({ summary: 'Delete a scheduled report' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('report-schedules/:id/run-now')
  @ApiOperation({ summary: 'Run a schedule immediately (does not affect lastSentAt logic for next tick)' })
  runNow(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.runNow(id, user.sub);
  }
}
