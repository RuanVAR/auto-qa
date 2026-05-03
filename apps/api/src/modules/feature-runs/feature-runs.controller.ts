import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { FeatureRunsService } from './feature-runs.service';
import { TriggerFeatureRunDto } from './dto/trigger-feature-run.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';

@ApiTags('feature-runs') @ApiBearerAuth()
@Controller()
export class FeatureRunsController {
  constructor(
    private readonly service: FeatureRunsService,
    private readonly envAccess: EnvAccessService,
    private readonly prisma: PrismaService,
  ) {}

  /** Resolve the projectId for a feature so we can check env access. */
  private async getProjectIdForFeature(featureId: string): Promise<string> {
    const f = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { module: { select: { projectId: true } } },
    });
    if (!f) throw new (await import('@nestjs/common')).NotFoundException('Feature not found');
    return f.module.projectId;
  }

  @Post('features/:featureId/run') @ApiOperation({ summary: 'Start a feature run' })
  async start(
    @Param('featureId') featureId: string,
    @Body() dto: TriggerFeatureRunDto,
    @CurrentUser() user: JwtPayload,
  ) {
    // Hard-block triggering against an env the caller can't access. Without
    // this, a UAT-only tester could pass a QA env id and start a run on QA.
    if (dto.environmentId) {
      const projectId = await this.getProjectIdForFeature(featureId);
      await this.envAccess.assertEnvAccess(user.sub, projectId, dto.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    return this.service.start(featureId, dto, user.sub);
  }

  @Get('features/:featureId/runs') @ApiOperation({ summary: 'List feature runs (optionally filtered by environment)' })
  async listByFeature(
    @Param('featureId') featureId: string,
    @CurrentUser() user: JwtPayload,
    @Query('environmentId') environmentId?: string,
  ) {
    const projectId = await this.getProjectIdForFeature(featureId);
    if (environmentId) {
      // Explicit env in the query: 403 if user can't access it.
      await this.envAccess.assertEnvAccess(user.sub, projectId, environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    // Implicit filter: even without a query param, restricted users only see
    // runs in their allowed envs. null = unrestricted (admins / OWNER /
    // TECH_LEAD / no-restriction members).
    const allowedEnvIds = await this.envAccess.getAllowedEnvIds(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
    });
    return this.service.findByFeature(featureId, 20, environmentId, allowedEnvIds);
  }

  @Get('feature-runs/:id') @ApiOperation({ summary: 'Get a feature run' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post('feature-runs/:id/pause') @ApiOperation({ summary: 'Pause a feature run' })
  pause(@Param('id') id: string) { return this.service.pause(id); }

  @Post('feature-runs/:id/resume') @ApiOperation({ summary: 'Resume a paused feature run' })
  resume(@Param('id') id: string) { return this.service.resume(id); }

  @Post('feature-runs/:id/skip-current')
  @ApiOperation({ summary: 'Skip the currently running test in a feature run and continue with the next test' })
  skipCurrent(@Param('id') id: string) { return this.service.skipCurrent(id); }

  @Post('feature-runs/:id/stop') @ApiOperation({ summary: 'Stop a feature run' })
  stop(@Param('id') id: string) { return this.service.stop(id); }

  @Post('feature-runs/:id/heartbeat')
  @ApiOperation({ summary: 'Send heartbeat to keep manual session alive' })
  heartbeat(@Param('id') id: string) {
    return this.service.heartbeat(id);
  }

  @Post('feature-runs/:id/abandon')
  @ApiOperation({ summary: 'Abandon a manual testing session' })
  abandon(@Param('id') id: string) {
    return this.service.abandon(id);
  }

  @Get('me/active-feature-runs')
  @ApiOperation({ summary: 'List the calling user\'s in-progress feature runs (for top-bar pill)' })
  myActiveRuns(@CurrentUser() user: JwtPayload) {
    return this.service.findActiveForUser(user.sub);
  }

  @Post('me/active-feature-runs/heartbeat')
  @ApiOperation({ summary: 'Bulk-heartbeat all of the caller\'s active manual runs (Shell-level keepalive)' })
  bulkHeartbeat(@CurrentUser() user: JwtPayload) {
    return this.service.bulkHeartbeat(user.sub);
  }

  /** Resolve {projectId, environmentId} for a featureRun. Used to check env
   *  access on sign-off / promote without making the service do auth. */
  private async resolveFeatureRunCtx(featureRunId: string): Promise<{ projectId: string; environmentId: string | null }> {
    const fr = await this.prisma.featureRun.findUnique({
      where: { id: featureRunId },
      select: { environmentId: true, feature: { select: { module: { select: { projectId: true } } } } },
    });
    if (!fr) throw new (await import('@nestjs/common')).NotFoundException('Feature run not found');
    return { projectId: fr.feature.module.projectId, environmentId: fr.environmentId };
  }

  @Post('feature-runs/:id/signoff')
  @ApiOperation({ summary: 'Record an APPROVED or REJECTED sign-off on a feature run' })
  async signoff(
    @Param('id') id: string,
    @Body() dto: { decision: 'APPROVED' | 'REJECTED'; note?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    // Sign-off must be made by someone with access to the env the run was
    // executed in. A UAT-only tester signing off on a QA run was the gap.
    const ctx = await this.resolveFeatureRunCtx(id);
    if (ctx.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, ctx.projectId, ctx.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    return this.service.signoff(id, user.sub, dto);
  }

  @Post('feature-runs/:id/promote')
  @ApiOperation({ summary: 'Promote a passed feature run to the next environment (handover)' })
  async promote(
    @Param('id') id: string,
    @Body() dto: { targetEnvironmentId: string; note?: string; runMode?: 'AUTOMATED' | 'MANUAL' },
    @CurrentUser() user: JwtPayload,
  ) {
    // Two-sided check: caller must have access to BOTH the source env (to
    // read the QA result) AND the target env (to spawn a UAT run). Either
    // alone would let half-privileged users break the access model.
    const ctx = await this.resolveFeatureRunCtx(id);
    if (ctx.environmentId) {
      await this.envAccess.assertEnvAccess(user.sub, ctx.projectId, ctx.environmentId, {
        jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
        orgId: user.activeOrgId,
      });
    }
    await this.envAccess.assertEnvAccess(user.sub, ctx.projectId, dto.targetEnvironmentId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
    return this.service.promote(id, user.sub, dto);
  }
}
