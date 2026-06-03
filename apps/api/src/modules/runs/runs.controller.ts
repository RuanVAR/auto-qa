import { Controller, Get, Post, Patch, Param, Body, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { RunsService } from './runs.service';
import { RunStepsService, PatchStepDto } from './runs-steps.service';
import { TriggerRunDto } from './dto/trigger-run.dto';
import { TestFailureCategory } from '@prisma/client';
import { MarkStepStatusDto } from './dto/mark-step-status.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { RunStatus, RunMode } from '@prisma/client';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('runs') @ApiBearerAuth() @Controller('projects/:projectId/runs')
export class RunsController {
  constructor(
    private readonly service: RunsService,
    private readonly envAccess: EnvAccessService,
  ) {}

  @Get() @ApiOperation({ summary: 'List runs for a project with optional filters' })
  async findAll(
    @Param('projectId') projectId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: RunStatus,
    @Query('mode') mode?: RunMode,
    @Query('testId') testId?: string,
    @Query('featureId') featureId?: string,
    @Query('envId') envId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // Explicit env filter: 403 if disallowed.
    if (envId) {
      await this.envAccess.assertEnvAccess(user.sub, projectId, envId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    // Implicit RBAC filter: even with no envId param, restricted users see
    // only their allowed envs. null = unrestricted.
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    return this.service.findByProject(projectId, {
      status,
      runMode: mode,
      testId,
      featureId,
      envId,
      allowedEnvIds: allowedEnvIds ?? undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('stats') async stats(
    @Param('projectId') p: string,
    @CurrentUser() user: JwtPayload,
    @Query('testId') testId?: string,
    @Query('featureId') featureId?: string,
  ) {
    // Same implicit filter applies to stats. computeStats now respects it.
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, p, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    // Forward URL scope (?testId=… / ?featureId=…) so a per-test runs page
    // shows per-test stats, not project totals — otherwise a scoped page
    // with 0 runs displayed e.g. "100 passed · 80% pass rate", which looks
    // like the filter is ignored.
    return this.service.getStats(p, allowedEnvIds ?? undefined, { testId, featureId });
  }
  @Get('trend') @ApiOperation({ summary: 'Daily pass/fail trend for last 30d' })
  async trend(@Param('projectId') p: string, @CurrentUser() user: JwtPayload) {
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, p, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    return this.service.getTrend(p, allowedEnvIds ?? undefined);
  }
  @Get('flaky') @ApiOperation({ summary: 'Tests with pass rate 20–80%' })
  async flaky(@Param('projectId') p: string, @CurrentUser() user: JwtPayload) {
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, p, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    return this.service.getFlakyTests(p, allowedEnvIds ?? undefined);
  }
  @Get('breakdown') @ApiOperation({ summary: 'Per-test pass rate breakdown' })
  async breakdown(@Param('projectId') p: string, @CurrentUser() user: JwtPayload) {
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, p, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    return this.service.getTestBreakdown(p, allowedEnvIds ?? undefined);
  }

  @Get(':id') findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post('trigger') async trigger(
    @Param('projectId') p: string,
    @Body() dto: TriggerRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Solo-test trigger now has the same env-RBAC check as the feature run
    // trigger. Without this, a UAT-only tester could fire any test against
    // the QA env directly.
    if (dto.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, p, dto.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    return this.service.trigger(p, dto, user.sub);
  }

  @Post(':id/cancel') cancel(@Param('id') id: string) { return this.service.cancel(id); }
}

/** Standalone run lookup — used by RunDetailPage which only knows the runId, not the projectId */
@ApiTags('runs') @ApiBearerAuth() @Controller('runs')
export class RunDetailController {
  constructor(
    private readonly service: RunsService,
    private readonly stepsService: RunStepsService,
    private readonly envAccess: EnvAccessService,
    private readonly prisma: PrismaService,
  ) {}

  /** Returns 403 if the caller can't see the run's env. Without this, anyone
   *  with a leaked runId could read full run data including the env it ran in. */
  private async assertCanReadRun(runId: string, user: JwtPayload): Promise<void> {
    const r = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { projectId: true, environmentId: true },
    });
    if (!r) throw new (await import('@nestjs/common')).NotFoundException('Run not found');
    if (!r.environmentId) return; // no env stamped (legacy / shell-only) — fall through
    await this.envAccess.assertEnvAccess(user.sub, r.projectId, r.environmentId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    }).catch(() => {
      throw new ForbiddenException('You do not have access to this run');
    });
  }

  @Get(':runId') @SkipThrottle({ global: true, auth: true }) @ApiOperation({ summary: 'Get a single run by ID' })
  async findOne(@Param('runId') runId: string, @CurrentUser() user: JwtPayload) {
    await this.assertCanReadRun(runId, user);
    return this.service.findOne(runId);
  }

  @Post(':runId/cancel') @ApiOperation({ summary: 'Cancel a run by ID' })
  cancel(@Param('runId') runId: string) { return this.service.cancel(runId); }

  @Patch(':runId/steps/:stepId') @ApiOperation({ summary: 'Update notes or Jira key on a step' })
  patchStep(
    @Param('runId') runId: string,
    @Param('stepId') stepId: string,
    @Body() dto: PatchStepDto,
  ) {
    return this.stepsService.addNotes(runId, stepId, dto.notes ?? '');
  }

  @Post(':runId/steps/:stepId/skip') @ApiOperation({ summary: 'Skip a failed or running step' })
  skipStep(@Param('runId') runId: string, @Param('stepId') stepId: string) {
    return this.stepsService.skipStep(runId, stepId);
  }

  @Post(':runId/steps/:stepId/retry') @ApiOperation({ summary: 'Retry a failed step' })
  retryStep(@Param('runId') runId: string, @Param('stepId') stepId: string) {
    return this.stepsService.retryStep(runId, stepId);
  }

  @Patch(':runId/steps/:stepId/status') @ApiOperation({ summary: 'Mark a step as PASSED or FAILED (manual testing)' })
  markStepStatus(
    @Param('runId') runId: string,
    @Param('stepId') stepId: string,
    @Body() dto: MarkStepStatusDto,
  ) {
    return this.stepsService.markStepStatus(runId, stepId, dto);
  }

  @Get(':runId/steps') @SkipThrottle({ global: true, auth: true }) @ApiOperation({ summary: 'Get all steps for a run' })
  getSteps(@Param('runId') runId: string) {
    return this.stepsService.getRunSteps(runId);
  }

  @Post(':runId/complete') @ApiOperation({ summary: 'Mark a manual run as complete' })
  completeManualRun(@Param('runId') runId: string) {
    return this.service.completeManualRun(runId);
  }

  @Patch(':runId/status') @ApiOperation({ summary: 'Mark a TestRun PASSED/FAILED/SKIPPED at the test-case level (description-driven manual mode)' })
  markTestRunStatus(
    @Param('runId') runId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: {
      status: 'PASSED' | 'FAILED' | 'SKIPPED';
      notes?: string;
      failureCategory?: TestFailureCategory;
      failureNote?: string;
      failureScreenshotUrls?: string[];
      failureRecordingUrl?: string;
    },
  ) {
    return this.service.markTestRunStatus(runId, dto, user.sub);
  }
}
