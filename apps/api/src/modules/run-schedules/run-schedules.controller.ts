import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { RunSchedulesService } from './run-schedules.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';

class CreateRunScheduleDto {
  @IsString() @IsNotEmpty() featureId!: string;
  @IsString() @IsNotEmpty() environmentId!: string;
  /** 5-field cron, e.g. "0 2 * * *" = daily 02:00. Validated with cron-parser. */
  @IsString() @IsNotEmpty() cronExpr!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateRunScheduleDto {
  @IsOptional() @IsString() featureId?: string;
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
    await this.envAccess.assertEnvAccess(user.sub, projectId, dto.environmentId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
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
