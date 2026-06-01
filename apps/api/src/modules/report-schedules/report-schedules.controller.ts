import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportSchedulesService } from './report-schedules.service';
import { ReportFrequency, ReportScope } from '@prisma/client';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Loosely-typed filter spec carried into the scheduled report. Validated
 *  shape-only (IsObject) — the report generator coerces the individual keys. */
interface ScheduleFilters {
  search?: string; tags?: string[]; epics?: string[];
  moduleId?: string; featureId?: string;
  status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
}

class CreateScheduleDto {
  @IsString()
  name!: string;

  @IsEnum(ReportScope)
  scope!: ReportScope;

  @IsOptional() @IsString()
  scopeId?: string;

  @IsOptional() @IsString()
  phaseId?: string;

  @IsEnum(ReportFrequency)
  frequency!: ReportFrequency;

  @IsOptional() @IsInt() @Min(0) @Max(6)
  dayOfWeek?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  dayOfMonth?: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  sendTime!: string;

  @IsArray()
  @IsEmail({}, { each: true })
  recipients!: string[];

  @IsOptional() @IsBoolean()
  includeCharts?: boolean;

  @IsOptional() @IsObject()
  appliedFilters?: ScheduleFilters;
}

class UpdateScheduleDto {
  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsEnum(ReportScope)
  scope?: ReportScope;

  @IsOptional() @IsString()
  scopeId?: string;

  @IsOptional() @IsString()
  phaseId?: string;

  @IsOptional() @IsEnum(ReportFrequency)
  frequency?: ReportFrequency;

  @IsOptional() @IsInt() @Min(0) @Max(6)
  dayOfWeek?: number;

  @IsOptional() @IsInt() @Min(1) @Max(31)
  dayOfMonth?: number;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  sendTime?: string;

  @IsOptional() @IsArray() @IsEmail({}, { each: true })
  recipients?: string[];

  @IsOptional() @IsBoolean()
  includeCharts?: boolean;

  @IsOptional() @IsObject()
  appliedFilters?: ScheduleFilters;
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
    @Body() dto: CreateScheduleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.create(projectId, user.sub, dto);
  }

  @Patch('report-schedules/:id')
  @ApiOperation({ summary: 'Update a scheduled report' })
  update(@Param('id') id: string, @Body() dto: UpdateScheduleDto) {
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
