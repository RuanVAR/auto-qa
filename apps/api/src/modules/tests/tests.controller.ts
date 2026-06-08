import { Controller, Get, Post, Put, Delete, Param, Body, Query, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TestsService } from './tests.service';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { QuickMarkDto } from './dto/quick-mark.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { clampLimit } from '../../common/util/pagination';

/**
 * A test "executes arbitrary code" — and so needs elevated authoring rights —
 * when it's a SHELL test (runs a shell command on the worker) or any step
 * runs raw JavaScript (EXECUTE_SCRIPT, or STORE with from='expression', both
 * compiled via `new Function` in the page). A plain project member must not be
 * able to introduce these onto the shared worker.
 */
function hasCodeExecContent(type: string | undefined, steps: unknown): boolean {
  if (type === 'SHELL') return true;
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const st = (s as { type?: string; input?: { from?: string } } | null);
      if (st?.type === 'EXECUTE_SCRIPT') return true;
      if (st?.type === 'STORE' && st?.input?.from === 'expression') return true;
    }
  }
  return false;
}

@ApiTags('tests') @ApiBearerAuth() @Controller('projects/:projectId/tests')
export class TestsController {
  constructor(
    private readonly service: TestsService,
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
  ) {}

  /** Require elevated role before letting the caller author code-exec content. */
  private async assertMayAuthorCodeExec(projectId: string, user: JwtPayload): Promise<void> {
    await this.envAccess.assertElevatedProjectAccess(user.sub, projectId, {
      jwtRoleHint: { orgRole: user.orgRole, platformRole: user.platformRole },
      orgId: user.activeOrgId,
    });
  }

  @Get() @ApiOperation({ summary: 'List tests for a project' })
  findAll(@Param('projectId') projectId: string, @Query('featureId') featureId?: string) {
    return this.service.findByProject(projectId, featureId);
  }

  @Get('summary') @ApiOperation({ summary: 'Project-wide test stats + distinct tags (all-tests page header)' })
  summary(@Param('projectId') projectId: string) {
    return this.service.getProjectTestSummary(projectId);
  }

  @Get('browse') @ApiOperation({ summary: 'Paginated / filterable test browser for the whole project' })
  browse(
    @Param('projectId') projectId: string,
    @Query() q: {
      page?: string; limit?: string; search?: string;
      moduleId?: string; featureId?: string; tags?: string; epics?: string;
      assignedToId?: string; hasBugs?: string;
      status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
      sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
    },
  ) {
    return this.service.browse(projectId, {
      page: q.page ? Number(q.page) : undefined,
      limit: clampLimit(q.limit, { max: 200 }),
      search: q.search,
      moduleId: q.moduleId || undefined,
      featureId: q.featureId || undefined,
      tags: q.tags ? q.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      epics: q.epics ? q.epics.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      assignedToId: q.assignedToId || undefined,
      hasBugs: q.hasBugs === '1' || q.hasBugs === 'true',
      status: q.status,
      sort: q.sort,
    });
  }

  @Get(':id') @ApiOperation({ summary: 'Get a test definition' })
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post() @ApiOperation({ summary: 'Create a test definition' })
  async create(@Param('projectId') projectId: string, @Body() dto: CreateTestDto, @CurrentUser() user: JwtPayload) {
    // RBAC: shell / script-execution tests run code on the shared worker —
    // only elevated roles may author them.
    if (hasCodeExecContent(dto.type, dto.steps)) {
      await this.assertMayAuthorCodeExec(projectId, user);
    }
    return this.service.create(projectId, dto, user.sub);
  }

  @Put(':id') @ApiOperation({ summary: 'Update a test definition' })
  async update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTestDto,
    @CurrentUser() user: JwtPayload,
  ) {
    if (hasCodeExecContent(dto.type, dto.steps)) {
      await this.assertMayAuthorCodeExec(projectId, user);
    }
    return this.service.update(id, dto, user.sub);
  }

  @Post(':id/duplicate') @ApiOperation({ summary: 'Duplicate a test definition' })
  duplicate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.duplicate(id, user.sub);
  }

  @Post(':id/append-steps')
  @ApiOperation({ summary: 'Append recorder-captured steps to an existing test (used by the test recorder)' })
  async appendSteps(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() body: { steps: Array<Record<string, unknown>>; meta?: { recordedAt?: string; recordedDurationSec?: number } },
    @CurrentUser() user: JwtPayload,
  ) {
    if (hasCodeExecContent(undefined, body.steps)) {
      await this.assertMayAuthorCodeExec(projectId, user);
    }
    return this.service.appendSteps(id, body, user.sub);
  }

  @Delete(':id') @ApiOperation({ summary: 'Archive a test definition (ORG_ADMIN of the project\'s org)' })
  async remove(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.remove(id, user.sub);
  }

  @Post('bulk-archive') @ApiOperation({ summary: 'Bulk archive test definitions (ORG_ADMIN)' })
  async bulkArchive(
    @Param('projectId') projectId: string,
    @Body() body: { ids: string[] },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.bulkArchive(projectId, body?.ids ?? [], user.sub);
  }

  @Post('bulk-move') @ApiOperation({ summary: 'Bulk move test definitions to another feature in same project (ORG_ADMIN)' })
  async bulkMove(
    @Param('projectId') projectId: string,
    @Body() body: { testIds: string[]; targetFeatureId: string },
    @CurrentUser() user: JwtPayload,
  ) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.bulkMove(projectId, body?.testIds ?? [], body?.targetFeatureId, user.sub);
  }

  @Post(':id/restore') @ApiOperation({ summary: 'Restore a previously archived test definition (ORG_ADMIN of the project\'s org)' })
  async restore(@Param('projectId') projectId: string, @Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.assertOrgAdminForProject(projectId, user);
    return this.service.restore(id, user.sub);
  }

  /**
   * Gate: ORG_ADMIN of the project's org, or PLATFORM_ADMIN (support-style
   * bypass). The old global-role check (@Roles(UserRole.ADMIN, ENGINEER))
   * was using user.platformRole which sits at 'USER' for every real user
   * on this platform — even org admins — so it rejected everyone. JwtStrategy
   * re-reads orgRole live from Postgres each request, so a demoted admin
   * loses access on the next call.
   */
  private async assertOrgAdminForProject(projectId: string, user: JwtPayload): Promise<void> {
    if (user.platformRole === 'PLATFORM_ADMIN') return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (user.activeOrgId !== project.orgId || user.orgRole !== 'ORG_ADMIN') {
      throw new ForbiddenException('Only ORG_ADMIN of this project\'s organisation can archive or restore tests.');
    }
  }
}

@ApiTags('tests') @ApiBearerAuth() @Controller('tests')
export class TestsDetailController {
  constructor(private readonly service: TestsService) {}

  @Post(':testDefinitionId/mark')
  @ApiOperation({ summary: 'Quick pass/fail mark — creates a completed TestRun attached to the active work session' })
  quickMark(
    @Param('testDefinitionId') testDefinitionId: string,
    @Body() dto: QuickMarkDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.quickMark(testDefinitionId, dto, user.sub);
  }
}

@ApiTags('tests') @ApiBearerAuth() @Controller('features')
export class FeatureTestStatusController {
  constructor(private readonly service: TestsService) {}

  /**
   * Returns the latest TestRun result per testDefinitionId for a feature.
   * Includes quick-mark, manual, and automated runs — not just FeatureRun-
   * attached results. Optionally filtered by environment.
   */
  @Get(':featureId/test-statuses')
  @ApiOperation({ summary: 'Latest TestRun status per test in a feature' })
  getLatestStatuses(
    @Param('featureId') featureId: string,
    @Query('envId') envId?: string,
  ) {
    return this.service.getLatestTestStatuses(featureId, envId ?? null);
  }

  /**
   * Active (in-flight) runs per test in a feature — PENDING / QUEUED / RUNNING.
   * Drives the live "Running…" badge on the FeaturesPage test list. Polled +
   * invalidated via the project run socket on the client.
   */
  @Get(':featureId/active-runs')
  @ApiOperation({ summary: 'In-flight TestRuns per test in a feature' })
  getActiveRuns(
    @Param('featureId') featureId: string,
    @Query('envId') envId?: string,
  ) {
    return this.service.getActiveRunsForFeature(featureId, envId ?? null);
  }
}
