import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { RunSchedulesService } from './run-schedules.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';

class CreateRunScheduleDto {
  /** Target: exactly one of featureId / pipelineId (XOR, service-validated). */
  @IsOptional() @IsString() featureId?: string;
  @IsOptional() @IsString() pipelineId?: string;
  /** Required for feature targets; pipeline schedules take none (env per stage). */
  @IsOptional() @IsString() environmentId?: string;
  /** 5-field cron, e.g. "0 2 * * *" = daily 02:00. Validated with cron-parser. */
  @IsString() @IsNotEmpty() cronExpr!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateRunScheduleDto {
  @IsOptional() @IsString() featureId?: string;
  @IsOptional() @IsString() pipelineId?: string;
  @IsOptional() @IsString() environmentId?: string;
  @IsOptional() @IsString() cronExpr?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiTags('run-schedules') @ApiBearerAuth() @Controller()
export class RunSchedulesController {
  constructor(
    private readonly service: RunSchedulesService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get('projects/:projectId/run-schedules')
  @ApiOperation({ summary: 'List recurring automated-run schedules for a project' })
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post('projects/:projectId/run-schedules')
  @ApiOperation({ summary: 'Schedule a recurring AUTOMATED feature run (cron per feature+env)' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateRunScheduleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Feature targets carry one env to gate on; pipeline targets were already
    // env-gated per stage when the pipeline was created.
    if (dto.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, projectId, dto.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    return this.service.create(projectId, user.sub, dto);
  }

  @Get('projects/:projectId/run-schedules/preview')
  @ApiOperation({ summary: 'Validate a cron expression and preview its next fire times' })
  preview(
    @Param('projectId') _projectId: string,
    @Query('cronExpr') cronExpr: string,
    @Query('timezone') timezone?: string,
  ) {
    return { next: this.service.preview(cronExpr, timezone || 'UTC') };
  }

  @Get('run-schedules/:id/runs')
  @ApiOperation({ summary: 'Run history for one schedule — every feature run it started' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.history(id, limit ? Number(limit) : undefined);
  }

  @Patch('run-schedules/:id')
  @ApiOperation({ summary: 'Update a run schedule (cadence, target, enabled)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRunScheduleDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (dto.environmentId) {
      const s = await this.service.findOne(id);
      await this.envAccess.assertEnvAccess(user.sub, s.projectId, dto.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    return this.service.update(id, dto);
  }

  @Delete('run-schedules/:id')
  @ApiOperation({ summary: 'Delete a run schedule' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
