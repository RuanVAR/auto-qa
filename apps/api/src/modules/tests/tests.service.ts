import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportExportService } from '../import-export/import-export.service';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { QuickMarkDto, QuickMarkStatus } from './dto/quick-mark.dto';
import { Prisma, RunMode, RunStatus } from '@prisma/client';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';

@Injectable()
export class TestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly importExport: ImportExportService,
    private readonly workSessions: WorkSessionsService,
  ) {}

  findByProject(projectId: string, featureId?: string) {
    return this.prisma.testDefinition.findMany({
      where: {
        projectId,
        isActive: true,
        deletedAt: null,
        ...(featureId ? { featureId } : {}),
      },
      // createdAt asc → tests appear in the order they were created. Stable
      // across edits (updatedAt would shuffle the list every time someone
      // touches a test) and intuitive for QA workflows ("test 1, 2, 3 …").
      // Both FeaturePage and TestingView's left panel now share this order
      // — previously they diverged (page = updatedAt desc, panel = alpha).
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Project-wide test browser ──────────────────────────────────────────
  //
  // Powers the "View all tests" page: paginated, filterable, searchable list
  // across every module/feature in the project, plus a summary stat strip.

  /** Latest TestRun status per testDefinitionId across the whole project. */
  private async latestStatusByTest(projectId: string): Promise<Map<string, RunStatus>> {
    const rows = await this.prisma.testRun.findMany({
      where: { projectId, completedAt: { not: null } },
      orderBy: { completedAt: 'desc' },
      distinct: ['testDefinitionId'],
      select: { testDefinitionId: true, status: true },
    });
    return new Map(rows.map((r) => [r.testDefinitionId, r.status]));
  }

  /** Summary stats + distinct test tags for the all-tests page header + filters. */
  async getProjectTestSummary(projectId: string) {
    const [modules, features, tests, openBugs, latest, tagRows] = await Promise.all([
      this.prisma.module.count({ where: { projectId, deletedAt: null } }),
      this.prisma.feature.count({ where: { deletedAt: null, module: { projectId, deletedAt: null } } }),
      this.prisma.testDefinition.count({ where: { projectId, isActive: true, deletedAt: null } }),
      this.prisma.issue.count({
        where: { projectId, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      }),
      this.latestStatusByTest(projectId),
      this.prisma.testDefinition.findMany({
        where: { projectId, isActive: true, deletedAt: null },
        select: { tags: true },
      }),
    ]);
    let passed = 0;
    let failed = 0;
    for (const st of latest.values()) {
      if (st === RunStatus.PASSED) passed++;
      else if (st === RunStatus.FAILED) failed++;
    }
    const tags = [...new Set(tagRows.flatMap((t) => t.tags))].filter(Boolean).sort();
    return { modules, features, tests, passed, failed, openBugs, tags };
  }

  /**
   * Paginated, filterable test list for the whole project. The latest-run
   * status is computed from one project-wide distinct query (not per row) so
   * status display + the status filter cost a single extra query.
   */
  async browse(
    projectId: string,
    opts: {
      page?: number;
      limit?: number;
      search?: string;
      moduleId?: string;
      featureId?: string;
      tags?: string[];
      assignedToId?: string;
      hasBugs?: boolean;
      status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
      sort?: 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';
    },
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
    const latest = await this.latestStatusByTest(projectId);

    const where: Prisma.TestDefinitionWhereInput = {
      projectId,
      isActive: true,
      deletedAt: null,
    };
    if (opts.search?.trim()) {
      const s = opts.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s } },
      ];
    }
    if (opts.featureId) where.featureId = opts.featureId;
    if (opts.moduleId) where.feature = { moduleId: opts.moduleId };
    if (opts.tags?.length) where.tags = { hasSome: opts.tags };
    // hasBugs + assignedToId both narrow the linked-issues relation.
    if (opts.assignedToId) {
      where.issues = { some: { deletedAt: null, assignedToId: opts.assignedToId } };
    } else if (opts.hasBugs) {
      where.issues = { some: { deletedAt: null } };
    }
    // Status filter — derived from the latest-run map. OUTSTANDING = the test
    // has no terminal run at all.
    if (opts.status === 'PASSED' || opts.status === 'FAILED') {
      where.id = {
        in: [...latest.entries()].filter(([, st]) => st === opts.status).map(([id]) => id),
      };
    } else if (opts.status === 'OUTSTANDING') {
      where.id = { notIn: [...latest.keys()] };
    }

    const orderBy: Prisma.TestDefinitionOrderByWithRelationInput =
      opts.sort === 'name_asc' ? { name: 'asc' }
      : opts.sort === 'name_desc' ? { name: 'desc' }
      : opts.sort === 'created_desc' ? { createdAt: 'desc' }
      : opts.sort === 'created_asc' ? { createdAt: 'asc' }
      : { updatedAt: 'desc' };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.testDefinition.count({ where }),
      this.prisma.testDefinition.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          name: true,
          type: true,
          tags: true,
          steps: true,
          updatedAt: true,
          featureId: true,
          feature: { select: { id: true, name: true, module: { select: { id: true, name: true } } } },
          _count: { select: { issues: { where: { deletedAt: null } } } },
        },
      }),
    ]);

    return {
      items: rows.map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        tags: t.tags,
        stepCount: Array.isArray(t.steps) ? (t.steps as unknown[]).length : 0,
        updatedAt: t.updatedAt,
        featureId: t.featureId,
        featureName: t.feature?.name ?? null,
        moduleId: t.feature?.module?.id ?? null,
        moduleName: t.feature?.module?.name ?? null,
        bugCount: t._count.issues,
        latestStatus: latest.get(t.id) ?? null,
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async findOne(id: string) {
    const t = await this.prisma.testDefinition.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new NotFoundException('Test not found');
    return t;
  }

  async create(projectId: string, dto: CreateTestDto, userId?: string) {
    const test = await this.prisma.testDefinition.create({
      data: {
        projectId,
        name: dto.name,
        description: dto.description,
        type: dto.type ?? 'UI',
        tags: dto.tags ?? [],
        steps: dto.steps as Prisma.InputJsonValue,
        config: (dto.config as Prisma.InputJsonValue) ?? Prisma.DbNull,
        isAiDraft: dto.isAiDraft ?? false,
        featureId: dto.featureId ?? null,
      },
    });
    await this.audit.log(userId, 'CREATE', 'TestDefinition', test.id, undefined, { name: test.name });
    return test;
  }

  async update(id: string, dto: UpdateTestDto, userId?: string) {
    const before = await this.findOne(id);

    const updated = await this.prisma.$transaction(async (tx) => {
      // Snapshot current state before overwriting (max 5 kept)
      await this.importExport.snapshotTestDefinition(tx, before, 'Before edit');

      return tx.testDefinition.update({
        where: { id },
        data: {
          ...(dto as Partial<typeof dto>),
          steps: dto.steps ? (dto.steps as Prisma.InputJsonValue) : undefined,
          config: dto.config ? (dto.config as Prisma.InputJsonValue) : undefined,
          version: { increment: 1 },
        },
      });
    });

    await this.audit.log(userId, 'UPDATE', 'TestDefinition', id, { name: before.name }, { name: updated.name });
    return updated;
  }

  /**
   * Test Recorder — append a batch of recorded steps to an existing test
   * definition. Steps are appended in the order received, with their `index`
   * field rewritten to continue the existing sequence. Returns the updated
   * row so the recorder UI can re-render with stable ids.
   *
   * `meta` (optional) lets the recorder also set `recordedAt`/duration on a
   * test that started as MANUAL — once a test has been touched by the
   * recorder, we want the badge.
   */
  async appendSteps(
    id: string,
    body: { steps: Array<Record<string, unknown>>; meta?: { recordedAt?: string; recordedDurationSec?: number } },
    userId?: string,
  ) {
    const before = await this.findOne(id);
    const existingSteps = Array.isArray(before.steps) ? (before.steps as Array<Record<string, unknown>>) : [];
    const baseIndex = existingSteps.length;
    const incoming = (body.steps ?? []).map((s, i) => ({
      ...s,
      // Preserve any provided index but renumber so the merged array is
      // strictly increasing. Recorder ships indices 0..N; we shift by N.
      index: baseIndex + i,
    }));
    const mergedSteps = [...existingSteps, ...incoming];

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.importExport.snapshotTestDefinition(tx, before, 'Before recorder append');
      return tx.testDefinition.update({
        where: { id },
        data: {
          steps: mergedSteps as Prisma.InputJsonValue,
          version: { increment: 1 },
          ...(body.meta?.recordedAt ? { recordedAt: new Date(body.meta.recordedAt) } : {}),
          ...(body.meta?.recordedDurationSec ? { recordedDurationSec: body.meta.recordedDurationSec } : {}),
        },
      });
    });

    await this.audit.log(
      userId,
      'TEST.RECORDED_APPEND',
      'TestDefinition',
      id,
      { stepCount: existingSteps.length },
      { stepCount: mergedSteps.length, appended: incoming.length },
    );
    return updated;
  }

  async remove(id: string, userId?: string) {
    const test = await this.findOne(id);
    await this.prisma.testDefinition.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
    await this.audit.log(userId, 'ARCHIVE', 'TestDefinition', id, { name: test.name });
    return { id, isActive: false };
  }

  /**
   * Reverse a previous archive. Bypasses findOne() (which filters out
   * archived rows) by querying directly. Idempotent for already-active
   * rows so a double-click on Restore is a no-op rather than a 404.
   */
  async restore(id: string, userId?: string) {
    const test = await this.prisma.testDefinition.findUnique({ where: { id } });
    if (!test) {
      // Match the not-found semantics of findOne so admins can't probe.
      throw new NotFoundException('Test not found');
    }
    if (test.isActive && test.deletedAt == null) return { id, isActive: true };
    await this.prisma.testDefinition.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
    });
    await this.audit.log(userId, 'RESTORE', 'TestDefinition', id, { name: test.name });
    return { id, isActive: true };
  }

  /**
   * Quick pass/fail mark — used by Pass/Fail buttons in the frontend FeaturePlayer.
   * Creates a completed TestRun (no RunSteps, duration=0) and attaches it to the
   * user's active QA work session.
   */
  async quickMark(testDefinitionId: string, dto: QuickMarkDto, userId: string) {
    const test = await this.prisma.testDefinition.findFirst({
      where: { id: testDefinitionId, deletedAt: null },
      include: { feature: { select: { id: true, moduleId: true } } },
    });
    if (!test) throw new NotFoundException('Test not found');

    const project = await this.prisma.project.findUnique({
      where: { id: test.projectId },
      select: { orgId: true },
    });

    const status = dto.status === QuickMarkStatus.PASSED ? RunStatus.PASSED : RunStatus.FAILED;
    const activityType = dto.status === QuickMarkStatus.PASSED ? 'MARK_PASS' : 'MARK_FAIL';

    let workSessionId: string | undefined;
    if (project?.orgId) {
      workSessionId = await this.workSessions.attachToSession(userId, project.orgId, {
        testDefinitionId: test.id,
        featureId: test.feature?.id ?? undefined,
        moduleId: test.feature?.moduleId ?? undefined,
        projectId: test.projectId,
        activityType,
      });
    }

    const now = new Date();
    const run = await this.prisma.testRun.create({
      data: {
        projectId: test.projectId,
        testDefinitionId: test.id,
        ...(dto.environmentId ? { environmentId: dto.environmentId } : {}),
        triggeredById: userId,
        trigger: 'manual-mark',
        runMode: RunMode.MANUAL,
        status,
        startedAt: now,
        completedAt: now,
        duration: 0,
        ...(dto.notes ? { metadata: { notes: dto.notes } as Prisma.InputJsonValue } : {}),
        // Structured failure reason — only on a FAILED quick-mark.
        ...(status === RunStatus.FAILED
          ? { failureCategory: dto.failureCategory ?? null, failureNote: dto.failureNote ?? null }
          : {}),
        ...(workSessionId ? { workSessionId } : {}),
      },
    });

    return run;
  }

  /**
   * Returns the latest TestRun status for every test in a feature.
   * Covers BOTH FeatureRun-attached runs AND standalone quick-mark / manual
   * testing runs so the front-end always shows the real last result.
   *
   * Uses Prisma `distinct` to get one row per testDefinitionId ordered by
   * completedAt DESC — the newest result wins.
   */
  async getLatestTestStatuses(featureId: string, envId?: string | null) {
    const rows = await this.prisma.testRun.findMany({
      where: {
        testDefinition: { featureId, deletedAt: null },
        completedAt: { not: null },
        ...(envId ? { environmentId: envId } : {}),
      },
      orderBy: { completedAt: 'desc' },
      distinct: ['testDefinitionId'],
      select: {
        testDefinitionId: true,
        status: true,
        completedAt: true,
        environmentId: true,
        runMode: true,
        trigger: true,
        // Failure reason — lets the feature page show a "View reason" popover
        // on a failed test without an extra query.
        failureCategory: true,
        failureNote: true,
      },
    });
    return rows;
  }

  /**
   * Bulk soft-delete. Caller (controller) MUST have already gated this to
   * ORG_ADMIN of the project. We re-scope by projectId so a payload that
   * sneaks in ids from another project simply gets ignored — never archive
   * something the caller doesn't own.
   */
  async bulkArchive(projectId: string, ids: string[], userId?: string) {
    if (!ids?.length) return { archived: 0 };
    const tests = await this.prisma.testDefinition.findMany({
      where: { id: { in: ids }, projectId, isActive: true, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!tests.length) return { archived: 0 };
    const now = new Date();
    const res = await this.prisma.testDefinition.updateMany({
      where: { id: { in: tests.map((t) => t.id) } },
      data: { isActive: false, deletedAt: now },
    });
    await Promise.all(
      tests.map((t) => this.audit.log(userId, 'ARCHIVE', 'TestDefinition', t.id, { name: t.name })),
    );
    return { archived: res.count };
  }

  /**
   * Bulk move tests to another feature in the SAME project. Both source tests
   * and target feature are scoped to projectId so we can't cross project
   * boundaries even if a bad payload tries.
   */
  async bulkMove(projectId: string, testIds: string[], targetFeatureId: string, userId?: string) {
    if (!testIds?.length) return { moved: 0 };
    const targetFeature = await this.prisma.feature.findFirst({
      where: { id: targetFeatureId, deletedAt: null, module: { projectId } },
      select: { id: true, name: true },
    });
    if (!targetFeature) throw new NotFoundException('Target feature not found in this project');
    const tests = await this.prisma.testDefinition.findMany({
      where: { id: { in: testIds }, projectId, deletedAt: null },
      select: { id: true, featureId: true, name: true },
    });
    if (!tests.length) return { moved: 0 };
    const res = await this.prisma.testDefinition.updateMany({
      where: { id: { in: tests.map((t) => t.id) } },
      data: { featureId: targetFeatureId },
    });
    await Promise.all(
      tests.map((t) =>
        this.audit.log(
          userId,
          'MOVE',
          'TestDefinition',
          t.id,
          { featureId: t.featureId },
          { featureId: targetFeatureId, featureName: targetFeature.name },
        ),
      ),
    );
    return { moved: res.count };
  }

  async duplicate(id: string, userId?: string) {
    const o = await this.findOne(id);
    const copy = await this.prisma.testDefinition.create({
      data: {
        name: `${o.name} (copy)`,
        description: o.description,
        type: o.type,
        tags: o.tags,
        steps: o.steps as Prisma.InputJsonValue,
        config: (o.config as Prisma.InputJsonValue) ?? Prisma.DbNull,
        projectId: o.projectId,
        featureId: o.featureId,
      },
    });
    await this.audit.log(userId, 'DUPLICATE', 'TestDefinition', copy.id, undefined, { sourceId: id });
    return copy;
  }
}
