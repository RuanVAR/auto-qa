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
    await this.audit.log(userId, 'DELETE', 'TestDefinition', id, { name: test.name });
    return { id };
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
      },
    });
    return rows;
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
