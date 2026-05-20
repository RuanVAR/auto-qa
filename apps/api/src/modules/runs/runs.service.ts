import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { TriggerRunDto } from './dto/trigger-run.dto';
import { RunStatus, Prisma } from '@prisma/client';
import { RunsGateway } from '../websocket/runs.gateway';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';

export interface RunFilters {
  status?: RunStatus;
  testId?: string;
  envId?: string;
  /** Implicit env-RBAC filter (set by controller from EnvAccessService).
   *  When set, results are restricted to envs in this list — combined with
   *  any explicit `envId` so a UAT-only user passing no filter still only
   *  sees UAT runs. Empty array = no envs allowed → empty result. */
  allowedEnvIds?: string[];
  page?: number;
  limit?: number;
}

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly gateway: RunsGateway,
    private readonly workSessions: WorkSessionsService,
  ) {}

  async findByProject(projectId: string, filters: RunFilters = {}) {
    const { status, testId, envId, allowedEnvIds, page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.TestRunWhereInput = { projectId };
    if (status) where.status = status;
    if (testId) where.testDefinitionId = testId;
    if (envId) {
      where.environmentId = envId;
    } else if (allowedEnvIds !== undefined) {
      // Implicit env-RBAC filter: only runs in the user's allowed envs.
      where.environmentId = { in: allowedEnvIds };
    }

    const [items, total] = await Promise.all([
      this.prisma.testRun.findMany({
        where,
        include: {
          environment: { select: { id: true, name: true, type: true } },
          testDefinition: { select: { id: true, name: true, type: true } },
          featureVersion: { select: { id: true, label: true, name: true } },
          _count: { select: { steps: true, artifacts: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.testRun.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { index: 'asc' } },
        artifacts: true,
        aiSummaries: { orderBy: { createdAt: 'desc' } },
        environment: true,
        testDefinition: true,
        featureVersion: { select: { id: true, label: true, name: true } },
        selectorHeals: { orderBy: { stepIndex: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException('Run not found');
    return run;
  }

  async trigger(projectId: string, dto: TriggerRunDto, triggeredById?: string) {
    const [env, test, project] = await Promise.all([
      this.prisma.environment.findUnique({ where: { id: dto.environmentId } }),
      this.prisma.testDefinition.findUnique({
        where: { id: dto.testDefinitionId },
        include: { feature: { select: { id: true, moduleId: true } } },
      }),
      this.prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } }),
    ]);
    if (!env) throw new NotFoundException('Environment not found');
    if (!test) throw new NotFoundException('Test definition not found');

    // Attach to the user's active QA work session (if we have a user + org)
    let workSessionId: string | undefined;
    if (triggeredById && project?.orgId) {
      workSessionId = await this.workSessions.attachToSession(triggeredById, project.orgId, {
        testDefinitionId: test.id,
        featureId: test.feature?.id ?? undefined,
        moduleId: test.feature?.moduleId ?? undefined,
        projectId,
        activityType: 'TEST_MODE',
      });
    }

    const run = await this.prisma.testRun.create({
      data: {
        projectId,
        environmentId: dto.environmentId,
        testDefinitionId: dto.testDefinitionId,
        triggeredById,
        trigger: dto.trigger ?? 'manual',
        runMode: dto.runMode ?? 'AUTOMATED',
        status: RunStatus.PENDING,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
        ...(workSessionId ? { workSessionId } : {}),
      },
    });
    // Only enqueue to worker for automated runs; manual runs wait for engineer input
    if ((dto.runMode ?? 'AUTOMATED') === 'AUTOMATED') {
      await this.queue.enqueueRun({ runId: run.id });
    }

    return run;
  }

  async cancel(id: string) {
    const run = await this.findOne(id);
    const terminalStatuses: RunStatus[] = [RunStatus.PASSED, RunStatus.FAILED, RunStatus.CANCELLED];
    // Use a proper HTTP exception so the message reaches the client (a
    // plain Error becomes a 500 "Internal server error" with no detail).
    // 409 is the correct semantic — the resource isn't in a state where the
    // requested action makes sense.
    if (terminalStatuses.includes(run.status)) {
      throw new ConflictException(`Run is already ${run.status.toLowerCase()} — nothing to cancel`);
    }
    const updated = await this.prisma.testRun.update({
      where: { id },
      data: { status: RunStatus.CANCELLED, completedAt: new Date() },
    });
    this.gateway.emitRunUpdated({
      id: updated.id,
      status: updated.status,
      projectId: updated.projectId,
      startedAt: updated.startedAt,
      completedAt: updated.completedAt,
      duration: updated.duration,
      errorMessage: updated.errorMessage,
    });
    return updated;
  }

  /**
   * @param allowedEnvIds Optional env-RBAC filter from the controller. When
   *   set, all counts are restricted to runs whose env is in this list. A
   *   UAT-only tester sees UAT pass rates here, not project-wide totals.
   */
  async getStats(projectId: string, allowedEnvIds?: string[]) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const [total, passed, failed, running] = await Promise.all([
      this.prisma.testRun.count({ where: { projectId, ...envClause } }),
      this.prisma.testRun.count({ where: { projectId, status: RunStatus.PASSED, ...envClause } }),
      this.prisma.testRun.count({ where: { projectId, status: RunStatus.FAILED, ...envClause } }),
      this.prisma.testRun.count({ where: { projectId, status: RunStatus.RUNNING, ...envClause } }),
    ]);
    return { total, passed, failed, running, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 };
  }

  /** 3.5.1 — daily pass/fail counts for the last 30 days */
  async getTrend(projectId: string, allowedEnvIds?: string[]) {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const runs = await this.prisma.testRun.findMany({
      where: { projectId, createdAt: { gte: since }, ...envClause },
      select: { status: true, createdAt: true },
    });

    const byDay: Record<string, { date: string; passed: number; failed: number; total: number }> = {};

    for (const run of runs) {
      const date = run.createdAt.toISOString().slice(0, 10);
      if (!byDay[date]) byDay[date] = { date, passed: 0, failed: 0, total: 0 };
      byDay[date].total++;
      if (run.status === RunStatus.PASSED) byDay[date].passed++;
      if (run.status === RunStatus.FAILED) byDay[date].failed++;
    }

    return Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** 3.5.2 — tests with pass rate 20–80% (flaky tests) */
  async getFlakyTests(projectId: string, allowedEnvIds?: string[]) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const tests = await this.prisma.testDefinition.findMany({
      where: { projectId, deletedAt: null },
      include: {
        runs: {
          where: { status: { in: [RunStatus.PASSED, RunStatus.FAILED] }, ...envClause },
          select: { status: true },
          take: 100,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return tests
      .map(test => {
        const total = test.runs.length;
        const passed = test.runs.filter((r: { status: RunStatus }) => r.status === RunStatus.PASSED).length;
        const passRate = total > 0 ? Math.round((passed / total) * 100) : null;
        return { id: test.id, name: test.name, type: test.type, total, passed, passRate };
      })
      .filter(t => t.passRate !== null && t.passRate >= 20 && t.passRate <= 80);
  }

  /** Mark a TestRun directly (PASSED/FAILED/SKIPPED) — used by description-
   *  driven manual mode where the tester evaluates the test as a whole rather
   *  than stepping through individual Playwright steps. We still flip every
   *  child step to the same terminal status so the run ledger is consistent
   *  for reports, and we set completedAt. */
  async markTestRunStatus(
    runId: string,
    data: { status: 'PASSED' | 'FAILED' | 'SKIPPED'; notes?: string },
  ) {
    const run = await this.prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      select: { id: true, featureRunId: true, status: true },
    });
    const completedAt = new Date();
    // Map SKIPPED to RunStatus.CANCELLED — Prisma RunStatus enum doesn't
    // have SKIPPED; CANCELLED is the established "not run" terminal state.
    const targetRunStatus =
      data.status === 'SKIPPED' ? RunStatus.CANCELLED
      : data.status === 'PASSED' ? RunStatus.PASSED
      : RunStatus.FAILED;
    const targetStepStatus =
      data.status === 'SKIPPED' ? 'SKIPPED'
      : data.status === 'PASSED' ? 'PASSED'
      : 'FAILED';

    await this.prisma.$transaction([
      this.prisma.testRun.update({
        where: { id: runId },
        data: {
          status: targetRunStatus,
          completedAt,
          // notes are stored on metadata since TestRun has no first-class notes column
          ...(data.notes ? { metadata: { notes: data.notes } as Prisma.InputJsonValue } : {}),
        },
      }),
      // Flip any not-yet-terminal steps to match. We don't touch already-
      // PASSED/FAILED steps so a tester who evaluated steps individually
      // before flipping the whole test doesn't lose that detail.
      this.prisma.runStep.updateMany({
        where: { runId, status: { in: ['PENDING', 'RUNNING'] as never } },
        data: { status: targetStepStatus as never, completedAt },
      }),
    ]);

    // Emit socket update so any open UI (TestingView, ActiveSessionsPill)
    // re-fetches the run state.
    if (run.featureRunId) {
      this.gateway.emitFeatureRunTestRunUpdated?.({
        featureRunId: run.featureRunId,
        testRunId: runId,
        status: targetRunStatus,
      });
    }

    return { id: runId, status: targetRunStatus };
  }

  async completeManualRun(runId: string) {
    const run = await this.prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      include: { steps: true },
    });
    const anyFailed = run.steps.some(s => s.status === 'FAILED');
    return this.prisma.testRun.update({
      where: { id: runId },
      data: {
        status: anyFailed ? RunStatus.FAILED : RunStatus.PASSED,
        completedAt: new Date(),
      },
    });
  }

  /** 3.5.3 — per-test pass rate breakdown */
  async getTestBreakdown(projectId: string, allowedEnvIds?: string[]) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const tests = await this.prisma.testDefinition.findMany({
      where: { projectId, deletedAt: null },
      include: {
        runs: {
          where: { status: { in: [RunStatus.PASSED, RunStatus.FAILED] }, ...envClause },
          select: { status: true, duration: true, createdAt: true },
          take: 50,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return tests.map(test => {
      const total = test.runs.length;
      const passed = test.runs.filter((r: { status: RunStatus }) => r.status === RunStatus.PASSED).length;
      const avgDuration = total > 0
        ? Math.round(test.runs.reduce((s: number, r: { duration: number | null }) => s + (r.duration ?? 0), 0) / total)
        : null;
      const lastRun = test.runs[0]?.createdAt ?? null;
      return {
        id: test.id,
        name: test.name,
        type: test.type,
        total,
        passed,
        failed: total - passed,
        passRate: total > 0 ? Math.round((passed / total) * 100) : null,
        avgDuration,
        lastRun,
      };
    });
  }
}
