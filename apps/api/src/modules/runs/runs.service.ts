import { Injectable, NotFoundException, BadRequestException, ConflictException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { TriggerRunDto } from './dto/trigger-run.dto';
import { RunStatus, RunMode, Prisma, TestFailureCategory } from '@prisma/client';
import { RunsGateway } from '../websocket/runs.gateway';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { notifyFailureMentions } from '../../common/notifications/failure-mentions';
import { checkBaseUrlReachable } from '../environments/environments.service';
import { isTestDefinitionAutomatable } from '../../common/util/automation';
import { CANONICAL_RUN_FILTER } from '../../common/util/canonical-runs';
import { isTerminalRunStatus } from '../../common/util/run-status';
import { RunSpecService } from '../shared-steps/run-spec.service';

export interface RunFilters {
  status?: RunStatus;
  /** Filter by how the run executed: AUTOMATED (worker) vs MANUAL (tester). */
  runMode?: RunMode;
  testId?: string;
  /** Scope to every run whose test belongs to this feature. */
  featureId?: string;
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
    @Inject(forwardRef(() => FeatureRunsService))
    private readonly featureRuns: FeatureRunsService,
    private readonly runSpec: RunSpecService,
  ) {}

  async findByProject(projectId: string, filters: RunFilters = {}) {
    const { status, runMode, testId, featureId, envId, allowedEnvIds, page = 1, limit = 50 } = filters;
    const skip = (page - 1) * limit;

    // Default: exclude preview runs from history. They're for debugging,
    // not "what happened in this project" listings. A future caller can
    // pass includePreviews=true if needed.
    const where: Prisma.TestRunWhereInput = { projectId, isPreview: false };
    if (status) where.status = status;
    if (runMode) where.runMode = runMode;
    if (testId) where.testDefinitionId = testId;
    // Feature scope: every run whose test definition lives under this feature,
    // whether triggered solo or as part of a feature run.
    if (featureId) where.testDefinition = { featureId };
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
          triggeredBy: { select: { id: true, name: true, email: true } },
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
        triggeredBy: { select: { id: true, name: true, email: true } },
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

    const wantsAutomated =
      (dto.runMode ?? 'AUTOMATED') === 'AUTOMATED' || dto.isPreview === true;

    // Automation availability is env-driven: an automated/preview run targets a
    // real browser, so the env must be an automation target and reachable.
    // (Credential requirement is enforced in Phase 5c.) Manual runs skip this.
    if (wantsAutomated) {
      if (!isTestDefinitionAutomatable(test)) {
        throw new BadRequestException(
          'This test is not automatable — add steps, or use a SCRIPT test, before running it automated.',
        );
      }
      if (!env.supportsAutomation) {
        throw new BadRequestException(
          'This environment is not enabled for automation. Turn on "Supports automation" in the environment settings to run automated tests or previews against it.',
        );
      }
      const reach = await checkBaseUrlReachable(env.baseUrl);
      if (!reach.reachable) {
        throw new BadRequestException(
          `Environment "${env.name}" is not reachable (${reach.reason ?? 'no response'}). Automated runs need a live target.`,
        );
      }
    }

    // Work sessions track HUMAN QA activity — a person walking through test
    // steps — not machine execution. A single AUTOMATED run is just a test
    // run; it must never open or join a session. Only manual, non-preview
    // runs attach. (Preview runs are ephemeral and never attach either.)
    const preview = dto.isPreview === true;
    const runMode = dto.runMode ?? 'AUTOMATED';
    let workSessionId: string | undefined;
    if (triggeredById && project?.orgId && runMode === 'MANUAL' && !preview) {
      workSessionId = await this.workSessions.attachToSession(triggeredById, project.orgId, {
        testDefinitionId: test.id,
        featureId: test.feature?.id ?? undefined,
        moduleId: test.feature?.moduleId ?? undefined,
        projectId,
        activityType: 'TEST_MODE',
      });
    }

    // Preview runs always carry trigger='preview' so a caller can't ask for
    // isPreview without it being obvious in the run row.
    const run = await this.prisma.testRun.create({
      data: {
        projectId,
        environmentId: dto.environmentId,
        testDefinitionId: dto.testDefinitionId,
        triggeredById,
        trigger: preview ? 'preview' : (dto.trigger ?? 'manual'),
        ...(dto.commitSha ? { commitSha: dto.commitSha } : {}),
        ...(dto.branch ? { branch: dto.branch } : {}),
        runMode,
        status: RunStatus.PENDING,
        isPreview: preview,
        metadata: (dto.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
        executedSpec: await this.runSpec.build(test),
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
    // Use a proper HTTP exception so the message reaches the client (a
    // plain Error becomes a 500 "Internal server error" with no detail).
    // 409 is the correct semantic — the resource isn't in a state where the
    // requested action makes sense.
    if (isTerminalRunStatus(run.status)) {
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
   * @param scope Optional narrowing to a single test or all tests in a
   *   feature — keeps the RunsPage stat strip honest when the page is
   *   URL-scoped (?testId=… / ?featureId=…). Without this, a 0-run scoped
   *   list still showed the project-wide pass rate which looked like a bug.
   */
  async getStats(
    projectId: string,
    allowedEnvIds?: string[],
    scope?: { testId?: string; featureId?: string },
  ) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const scopeClause: Prisma.TestRunWhereInput = {};
    if (scope?.testId) scopeClause.testDefinitionId = scope.testId;
    else if (scope?.featureId) scopeClause.testDefinition = { featureId: scope.featureId };
    // Stats never include preview runs — they're debug iterations, not
    // signal. Including them would skew pass rate every time someone
    // hits Preview while editing a flaky test.
    // NOT_TESTED runs (manual session ended before the test was evaluated)
    // are not a verdict — keep them out of the pass-rate denominator.
    const baseWhere: Prisma.TestRunWhereInput = { projectId, isPreview: false, status: { not: RunStatus.NOT_TESTED }, ...envClause, ...scopeClause };
    const [total, passed, failed, running] = await Promise.all([
      this.prisma.testRun.count({ where: baseWhere }),
      this.prisma.testRun.count({ where: { ...baseWhere, status: RunStatus.PASSED } }),
      this.prisma.testRun.count({ where: { ...baseWhere, status: RunStatus.FAILED } }),
      this.prisma.testRun.count({ where: { ...baseWhere, status: RunStatus.RUNNING } }),
    ]);
    return { total, passed, failed, running, passRate: total > 0 ? Math.round((passed / total) * 100) : 0 };
  }

  /** 3.5.1 — daily pass/fail counts for the last 30 days */
  async getTrend(projectId: string, allowedEnvIds?: string[]) {
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const runs = await this.prisma.testRun.findMany({
      where: { projectId, isPreview: false, createdAt: { gte: since }, ...envClause },
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
  /**
   * Flake scoring (docs/plan/05-PHASE-3-INTELLIGENCE.md §3.5) — three
   * independent monitors rather than one opaque score, because a single
   * number hides *why* a test was flagged. A test stays flagged as long as
   * any enabled monitor currently flags it; this is recomputed fresh on
   * every call rather than persisted, so "stays flagged until every monitor
   * clears" falls out naturally — no separate state to go stale.
   *
   * - passOnRetry (default on): highest precision — a step that needed a
   *   retry to pass, using RunStep.attemptsToPass from Phase 2 §2.3.
   * - transitionCount (default on): Allure's rule — ≥3 status transitions
   *   in the 10 most recent canonical runs (only evaluated once at least 6
   *   runs exist, matching "surfacing from the 6th result").
   * - failureRate (default off): >threshold% failures over a rolling
   *   window — noisier, opt-in per project. Trunk publishes no default
   *   threshold for exactly this reason; ours defaults to 30%/14d but is
   *   per-project configurable via Project.flakeConfig.
   */
  async getFlakyTests(projectId: string, allowedEnvIds?: string[]) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { flakeConfig: true } });
    const cfg = (project?.flakeConfig ?? {}) as {
      passOnRetry?: boolean; transitionCount?: boolean; failureRate?: boolean;
      failureRateThreshold?: number; failureRateWindowDays?: number;
    };
    const monitorsEnabled = {
      passOnRetry: cfg.passOnRetry ?? true,
      transitionCount: cfg.transitionCount ?? true,
      failureRate: cfg.failureRate ?? false,
    };
    const failureRateThreshold = cfg.failureRateThreshold ?? 0.3;
    const windowStart = new Date(Date.now() - (cfg.failureRateWindowDays ?? 14) * 24 * 60 * 60 * 1000);

    const tests = await this.prisma.testDefinition.findMany({
      where: { projectId, deletedAt: null },
      include: {
        runs: {
          where: {
            status: { in: [RunStatus.PASSED, RunStatus.FAILED] },
            ...CANONICAL_RUN_FILTER,
            ...envClause,
          },
          select: {
            status: true, createdAt: true,
            // One retry-recovered step among the recent runs is enough to
            // flag passOnRetry — take:1 keeps this cheap per run.
            steps: { where: { attemptsToPass: { gt: 1 } }, select: { id: true }, take: 1 },
          },
          take: 100,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return tests
      .map(test => {
        const total = test.runs.length;
        if (total === 0) return null;
        const passed = test.runs.filter(r => r.status === RunStatus.PASSED).length;
        const passRate = Math.round((passed / total) * 100);

        const flaggedMonitors: string[] = [];

        if (monitorsEnabled.passOnRetry && test.runs.some(r => r.steps.length > 0)) {
          flaggedMonitors.push('passOnRetry');
        }

        if (monitorsEnabled.transitionCount && total >= 6) {
          const last10 = test.runs.slice(0, 10);
          let transitions = 0;
          for (let i = 1; i < last10.length; i++) {
            if (last10[i].status !== last10[i - 1].status) transitions++;
          }
          if (transitions >= 3) flaggedMonitors.push('transitionCount');
        }

        if (monitorsEnabled.failureRate) {
          const windowRuns = test.runs.filter(r => r.createdAt >= windowStart);
          if (windowRuns.length > 0) {
            const windowFailed = windowRuns.filter(r => r.status === RunStatus.FAILED).length;
            if (windowFailed / windowRuns.length > failureRateThreshold) flaggedMonitors.push('failureRate');
          }
        }

        if (flaggedMonitors.length === 0) return null;
        return { id: test.id, name: test.name, type: test.type, total, passed, passRate, flaggedMonitors };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }

  /**
   * Cross-run view for one failure fingerprint (docs/plan §3.2): "this
   * fingerprint first seen N days ago, M occurrences" — the run-detail
   * failure card's drill-in. Scoped to the project (and the caller's
   * allowed envs) via a join through RunStep → TestRun, since RunStep
   * itself carries no projectId.
   */
  async getFingerprintOccurrences(projectId: string, fingerprint: string, allowedEnvIds?: string[]) {
    const envClause = allowedEnvIds !== undefined ? { environmentId: { in: allowedEnvIds } } : {};
    const where: Prisma.RunStepWhereInput = {
      failureFingerprint: fingerprint,
      run: { projectId, ...CANONICAL_RUN_FILTER, ...envClause },
    };
    const [count, first] = await Promise.all([
      this.prisma.runStep.count({ where }),
      this.prisma.runStep.findFirst({ where, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
    ]);
    return { fingerprint, count, firstSeenAt: first?.createdAt ?? null };
  }

  async getCommitAttribution(runId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, projectId: true, testDefinitionId: true, status: true, commitSha: true, branch: true, createdAt: true },
    });
    if (!run) throw new NotFoundException('Run not found');
    if (!run.commitSha) return { current: null, lastGreen: null, compareUrl: null };

    const branchClause = run.branch ? { branch: run.branch } : {};
    const lastGreen = await this.prisma.testRun.findFirst({
      where: {
        testDefinitionId: run.testDefinitionId,
        status: RunStatus.PASSED,
        commitSha: { not: null },
        createdAt: { lt: run.createdAt },
        ...branchClause,
        ...CANONICAL_RUN_FILTER,
      },
      orderBy: { createdAt: 'desc' },
      select: { commitSha: true, branch: true, createdAt: true },
    });
    const repo = await this.prisma.projectRepo.findFirst({
      where: { projectId: run.projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { repoOwner: true, repoName: true },
    });
    const compareUrl = repo && lastGreen?.commitSha
      ? `https://github.com/${repo.repoOwner}/${repo.repoName}/compare/${lastGreen.commitSha}...${run.commitSha}`
      : null;
    return {
      current: { commitSha: run.commitSha, branch: run.branch, status: run.status, createdAt: run.createdAt },
      lastGreen,
      compareUrl,
    };
  }

  /** Mark a TestRun directly (PASSED/FAILED/SKIPPED) — used by description-
   *  driven manual mode where the tester evaluates the test as a whole rather
   *  than stepping through individual Playwright steps. We still flip every
   *  child step to the same terminal status so the run ledger is consistent
   *  for reports, and we set completedAt. */
  async markTestRunStatus(
    runId: string,
    data: {
      status: 'PASSED' | 'FAILED' | 'SKIPPED';
      notes?: string;
      /** Structured failure reason — only meaningful when status=FAILED. */
      failureCategory?: TestFailureCategory;
      failureNote?: string;
      failureScreenshotUrls?: string[];
      failureRecordingUrl?: string;
      /** Named manual Test Run this mark belongs to, if marking inside one. */
      testRunSessionId?: string;
    },
    actorId?: string,
  ) {
    const run = await this.prisma.testRun.findUniqueOrThrow({
      where: { id: runId },
      select: {
        id: true, featureRunId: true, status: true, projectId: true,
        testDefinitionId: true,
        testDefinition: { select: { name: true, featureId: true, project: { select: { orgId: true } } } },
      },
    });
    const completedAt = new Date();
    // A manual "Skip" is now a first-class SKIPPED verdict (distinct from a
    // CANCELLED/stopped run). Steps already carry their own SKIPPED status.
    const targetRunStatus =
      data.status === 'SKIPPED' ? RunStatus.SKIPPED
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
          // Failure reason follows the verdict: set on FAILED, cleared when
          // the same run is re-marked PASSED/SKIPPED so it never lingers
          // inconsistent with the run's final status.
          failureCategory: data.status === 'FAILED' ? (data.failureCategory ?? null) : null,
          failureNote: data.status === 'FAILED' ? (data.failureNote ?? null) : null,
          failureScreenshotUrls: data.status === 'FAILED' ? (data.failureScreenshotUrls ?? []) : [],
          failureRecordingUrl: data.status === 'FAILED' ? (data.failureRecordingUrl ?? null) : null,
          // Attach to the named manual Test Run when marking inside one (idempotent).
          ...(data.testRunSessionId ? { testRunSessionId: data.testRunSessionId } : {}),
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
      // Roll the verdict up to the parent FeatureRun: when this was the last
      // un-marked test, onRunComplete flips the FeatureRun to COMPLETE.
      // Without this a fully-marked manual run lingered as RUNNING forever
      // (markTestRunStatus never told the parent it was done) — the stuck-run
      // cron eventually cancelled it. Safe for manual runs: their child
      // TestRuns are RUNNING (never PENDING) after start(), so onRunComplete's
      // enqueue-next branch can't fire and re-queue a manual test.
      await this.featureRuns.onRunComplete(runId);
    }

    // @mentions in the failure reason → in-app notification + deep link to the
    // test. Best-effort: never let a notification hiccup fail the mark.
    if (data.status === 'FAILED' && data.failureNote?.trim() && actorId) {
      try {
        await notifyFailureMentions(this.prisma, {
          runId: run.id,
          projectId: run.projectId,
          testDefinitionId: run.testDefinitionId,
          featureId: run.testDefinition?.featureId ?? null,
          orgId: run.testDefinition?.project.orgId ?? null,
          testName: run.testDefinition?.name ?? 'a test',
        }, data.failureNote, actorId);
      } catch { /* swallow — verdict already saved */ }
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
          where: {
            status: { in: [RunStatus.PASSED, RunStatus.FAILED] },
            ...CANONICAL_RUN_FILTER,
            ...envClause,
          },
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
