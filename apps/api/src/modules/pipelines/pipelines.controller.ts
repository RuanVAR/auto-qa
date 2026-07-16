import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEnum, IsNotEmpty,
  IsOptional, IsString, MaxLength, ValidateNested,
} from 'class-validator';
import { PipelinesService } from './pipelines.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';

class PipelineStageDto {
  @IsString() @IsNotEmpty() featureId!: string;
  @IsString() @IsNotEmpty() environmentId!: string;
  @IsOptional() @IsEnum(['HALT', 'CONTINUE']) onFailure?: 'HALT' | 'CONTINUE';
}

class CreatePipelineDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** When true, stage runs count toward feature status/stats like normal runs. */
  @IsOptional() @IsBoolean() updatesFeatureStatus?: boolean;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => PipelineStageDto)
  stages!: PipelineStageDto[];
}

class UpdatePipelineDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsBoolean() updatesFeatureStatus?: boolean;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => PipelineStageDto)
  stages?: PipelineStageDto[];
}

@ApiTags('pipelines') @ApiBearerAuth() @Controller()
export class PipelinesController {
  constructor(
    private readonly service: PipelinesService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get('projects/:projectId/pipelines')
  @ApiOperation({ summary: 'List a project\'s pipelines with stages + recent run health' })
  list(@Param('projectId') projectId: string) {
    return this.service.list(projectId);
  }

  @Post('projects/:projectId/pipelines')
  @ApiOperation({ summary: 'Create a pipeline — an ordered list of feature+env stages run sequentially' })
  async create(
    @Param('projectId') projectId: string,
    @Body() dto: CreatePipelineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertStageEnvs(user, projectId, dto.stages);
    return this.service.create(projectId, user.sub, dto);
  }

  @Patch('pipelines/:id')
  @ApiOperation({ summary: 'Update a pipeline (stages replaced wholesale; in-flight runs unaffected)' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePipelineDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const existing = await this.service.findOne(id);
    if (dto.stages) await this.assertStageEnvs(user, existing.projectId, dto.stages);
    return this.service.update(id, dto);
  }

  @Delete('pipelines/:id')
  @ApiOperation({ summary: 'Delete a pipeline (blocked while a run is active; run evidence survives)' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post('pipelines/:id/trigger')
  @ApiOperation({ summary: 'Start a pipeline run — stages execute sequentially. 409 if already running.' })
  async trigger(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const run = await this.service.trigger(id, user.sub, 'api');
    return {
      pipelineRunId: run.id,
      status: run.status,
      stageCount: (run.stagesSnapshot as unknown[]).length,
    };
  }

  @Get('pipelines/:id/runs')
  @ApiOperation({ summary: 'Run history for one pipeline, newest first' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.service.history(id, limit ? Number(limit) : undefined);
  }

  @Get('pipeline-runs/:id')
  @ApiOperation({ summary: 'Aggregate status of one pipeline run — the CI poll target (status: RUNNING|COMPLETE|FAILED|CANCELLED)' })
  getRun(@Param('id') id: string) {
    return this.service.getRun(id);
  }

  @Post('pipeline-runs/:id/stop')
  @ApiOperation({ summary: 'Stop a running pipeline: current stage stopped, remaining stages skipped' })
  async stop(@Param('id') id: string) {
    await this.service.stop(id);
    return { stopped: true };
  }

  /** Env-gate every DISTINCT stage env — writes only. */
  private async assertStageEnvs(user: JwtPayload, projectId: string, stages: PipelineStageDto[]): Promise<void> {
    const envIds = [...new Set(stages.map(s => s.environmentId))];
    for (const environmentId of envIds) {
      await this.envAccess.assertEnvAccess(user.sub, projectId, environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
  }
}
