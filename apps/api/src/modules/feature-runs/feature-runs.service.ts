import { Injectable, NotFoundException, BadRequestException, ConflictException, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { TriggerFeatureRunDto } from './dto/trigger-feature-run.dto';
import { FeatureRunStatus, RunMode, RunStatus, StepStatus, StepType, TestRun, SignoffDecision } from '@prisma/client';
import { RunsGateway } from '../websocket/runs.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';
import { SignoffService } from '../signoff/signoff.service';

@Injectable()
export class FeatureRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    @Inject(forwardRef(() => RunsGateway))
    private readonly gateway: RunsGateway,
    private readonly notificationsService: NotificationsService,
    private readonly workSessions: WorkSessionsService,
    private readonly signoffService: SignoffService,
  ) {}

  async start(featureId: string, dto: TriggerFeatureRunDto, triggeredById?: string) {
    // ── Concurrency guard ────────────────────────────────────────────────
    // A user can only have one in-progress MANUAL feature run at a time.
    // Without this, every Open Testing Mode click silently spawns another
    // session that lingers as orphan RUNNING + 7 stranded TestRuns until
    // the hourly stuck-runs sweep cleans up. We enforce the limit only for
    // MANUAL — automated runs are user-triggered but worker-driven, so
    // having two in flight simultaneously is fine.
    if (triggeredById && dto.runMode === 'MANUAL' && !dto.allowConcurrent) {
      const existing = await this.prisma.featureRun.findFirst({
        where: {
          triggeredById,
          runMode: RunMode.MANUAL,
          status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
        },
        // Surface the MOST RECENT stale run deterministically. Without an
        // orderBy, findFirst returned an arbitrary row, so the conflict
        // modal showed a different session each refresh.
        orderBy: { startedAt: 'desc' },
        include: {
          feature: { select: { id: true, name: true, module: { select: { id: true, name: true, projectId: true } } } },
        },
      });
      if (existing) {
        // 409 with rich payload so the client can render an
        // "Active session conflict" modal (Resume / End-and-start / Cancel).
        throw new ConflictException({
          message: 'You already have an active manual session',
          code: 'ACTIVE_SESSION_CONFLICT',
          activeRun: {
            id: existing.id,
            featureId: existing.featureId,
            featureName: existing.feature.name,
            moduleId: existing.feature.module.id,
            moduleName: existing.feature.module.name,
            projectId: existing.feature.module.projectId,
            startedAt: existing.startedAt,
            status: existing.status,
            sameFeature: existing.featureId === featureId,
          },
        });
      }
    }

    // When the caller explicitly opts into concurrency — the "End previous &
    // start new" path — proactively end EVERY active manual run for this
    // user, not just the single one the conflict modal surfaced. Without
    // this, a user with several stale RUNNING/PAUSED runs abandons one,
    // starts a new one, and the conflict modal reappears on the next start
    // — the "stuck" loop. Ending them all here makes the resolution final.
    if (triggeredById && dto.runMode === 'MANUAL' && dto.allowConcurrent) {
      await this.endAllActiveManualForUser(triggeredById, 'superseded');
    }

    // Validate feature exists
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, deletedAt: null },
      include: {
        testDefinitions: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        module: true,
      },
    });
    if (!feature) throw new NotFoundException('Feature not found');
    if (feature.testDefinitions.length === 0) {
      throw new BadRequestException('Feature has no test definitions');
    }

    // Per-feature gate: AUTOMATED feature runs require the opt-in flag
    // (default false). MANUAL feature runs are always allowed — testers
    // walking through steps don't need automation enabled.
    if (dto.runMode === 'AUTOMATED' && !feature.automatedTestingEnabled) {
      throw new BadRequestException(
        'Automated testing is disabled for this feature. Enable it in the feature’s Settings tab to run automated feature tests.',
      );
    }

    // "Start From Here" — optionally drop tests before the requested startpoint.
    // Validated against the loaded testDefinitions so a stale ID returns 400
    // rather than silently running everything.
    let testDefinitions = feature.testDefinitions;
    if (dto.startFromTestDefinitionId) {
      const startIdx = testDefinitions.findIndex(td => td.id === dto.startFromTestDefinitionId);
      if (startIdx === -1) {
        throw new BadRequestException('startFromTestDefinitionId does not belong to this feature');
      }
      testDefinitions = testDefinitions.slice(startIdx);
    }

    // Validate environment — required for automated runs, optional for manual
    if (dto.environmentId) {
      const env = await this.prisma.environment.findUnique({ where: { id: dto.environmentId } });
      if (!env) throw new NotFoundException('Environment not found');
    } else if (dto.runMode !== 'MANUAL') {
      throw new BadRequestException('Environment is required for automated runs');
    }

    // Resolve version to use
    let featureVersionId: string | null = null;
    if (dto.versionId) {
      const v = await this.prisma.featureVersion.findFirst({
        where: { id: dto.versionId, featureId },
      });
      if (!v) throw new NotFoundException('Feature version not found');
      featureVersionId = v.id;
    } else {
      const activeVersion = await this.prisma.featureVersion.findFirst({
        where: { featureId, isActive: true },
      });
      featureVersionId = activeVersion?.id ?? null;
    }

    const isManual = dto.runMode === 'MANUAL';
    const runMode: RunMode = isManual ? RunMode.MANUAL : RunMode.AUTOMATED;

    // Resolve work-session for the tester — MANUAL runs only. A work session
    // tracks a human walking through test steps; an AUTOMATED feature run is
    // machine execution and must not open or join a session (it lives purely
    // in run history). Done before the creation transaction so the resulting
    // workSessionId can be stamped onto every manual TestRun row.
    let workSessionId: string | undefined;
    if (triggeredById && isManual) {
      const project = await this.prisma.project.findUnique({
        where: { id: feature.module.projectId },
        select: { orgId: true },
      });
      if (project?.orgId) {
        workSessionId = await this.workSessions.attachToSession(triggeredById, project.orgId, {
          testDefinitionId: testDefinitions[0]?.id,
          featureId: feature.id,
          moduleId: feature.module.id,
          projectId: feature.module.projectId,
          activityType: 'TEST_MODE',
        });
      }
    }

    // Create the FeatureRun + all child TestRuns + (manual) RunSteps in ONE
    // transaction. Previously these were sequential un-transacted writes — a
    // failure partway left an orphan FeatureRun with missing TestRuns that the
    // UI rendered as a broken half-run.
    const { featureRun, testRuns } = await this.prisma.$transaction(async (tx) => {
      const featureRun = await tx.featureRun.create({
        data: {
          featureId,
          ...(dto.environmentId ? { environmentId: dto.environmentId } : {}),
          featureVersionId,
          triggeredById,
          runMode,
          status: FeatureRunStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      const testRuns: TestRun[] = [];
      for (const td of testDefinitions) {
        testRuns.push(await tx.testRun.create({
          data: {
            projectId: feature.module.projectId,
            testDefinitionId: td.id,
            ...(dto.environmentId ? { environmentId: dto.environmentId } : {}),
            featureRunId: featureRun.id,
            featureVersionId,
            triggeredById,
            trigger: 'feature_run',
            runMode,
            status: RunStatus.PENDING,
            ...(workSessionId ? { workSessionId } : {}),
          },
        }));
      }

      // For manual runs: pre-create RunStep records from the test definition
      // steps so the tester can immediately see and mark each step.
      if (isManual) {
        for (let tdIndex = 0; tdIndex < testDefinitions.length; tdIndex++) {
          const td = testDefinitions[tdIndex];
          const testRun = testRuns[tdIndex];
          if (!testRun) continue;
          const steps = Array.isArray(td.steps) ? td.steps : [];
          // Valid StepType values, read from Prisma so the set never drifts.
          const VALID_STEP_TYPES = new Set(Object.values(StepType) as string[]);
          for (let idx = 0; idx < steps.length; idx++) {
            const step = steps[idx] as Record<string, unknown>;
            // Coerce any unknown step type to CUSTOM rather than letting a
            // single odd/legacy step 500 the whole session start. The real
            // intent is preserved in `name`.
            const rawType = String(step['type'] ?? 'NAVIGATE');
            const stepType = VALID_STEP_TYPES.has(rawType) ? rawType : 'CUSTOM';
            await tx.runStep.create({
              data: {
                runId: testRun.id,
                index: idx,
                name: (step['name'] as string | undefined) ?? String(step['type'] ?? `Step ${idx + 1}`),
                type: stepType as never,
                input: (step['input'] as object | undefined) ??
                  (step['selector'] || step['value'] || step['url']
                    ? { selector: step['selector'], value: step['value'], url: step['url'] }
                    : undefined),
                status: 'PENDING' as never,
              },
            });
          }
          // Manual test runs go RUNNING immediately — no worker picks them up.
          await tx.testRun.update({
            where: { id: testRun.id },
            data: { status: RunStatus.RUNNING, startedAt: new Date() },
          });
        }
      }

      return { featureRun, testRuns };
    });

    // ── Post-create race reconciliation ──────────────────────────────────
    // The concurrency guard above is a check-then-create, not atomic: N
    // near-simultaneous Manual clicks can all pass the guard and all reach
    // here, leaving the user with several RUNNING manual runs — the conflict
    // modal then reappears forever ("stuck loop").
    //
    // Resolve it with a deterministic winner: the active manual run with the
    // earliest startedAt (id as tiebreak for same-millisecond creates) keeps
    // running; every other racer abandons ITSELF and returns the conflict.
    // Because the ordering is a total order, exactly one run always survives
    // a race — never zero, never two.
    if (triggeredById && isManual && !dto.allowConcurrent) {
      const others = await this.prisma.featureRun.findMany({
        where: {
          triggeredById,
          runMode: RunMode.MANUAL,
          status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
          id: { not: featureRun.id },
        },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        include: {
          feature: { select: { id: true, name: true, module: { select: { id: true, name: true, projectId: true } } } },
        },
      });
      const iLose = others.some((o) => {
        const ot = o.startedAt?.getTime() ?? 0;
        const mt = featureRun.startedAt?.getTime() ?? 0;
        return ot < mt || (ot === mt && o.id < featureRun.id);
      });
      if (iLose) {
        await this.abandon(featureRun.id).catch(() => { /* best-effort undo */ });
        const winner = others[0]; // earliest by the orderBy above
        throw new ConflictException({
          message: 'You already have an active manual session',
          code: 'ACTIVE_SESSION_CONFLICT',
          activeRun: {
            id: winner.id,
            featureId: winner.featureId,
            featureName: winner.feature.name,
            moduleId: winner.feature.module.id,
            moduleName: winner.feature.module.name,
            projectId: winner.feature.module.projectId,
            startedAt: winner.startedAt,
            status: winner.status,
            sameFeature: winner.featureId === featureId,
          },
        });
      }
      // else: I hold the earliest startedAt — I'm the winner. Any newer
      // racers will see me and abandon themselves.
    }

    // Only enqueue automated runs — manual runs are stepped through by the user.
    if (!isManual && testRuns.length > 0) {
      await this.queue.enqueueRun({ runId: testRuns[0].id });
    }

    return { featureRun, testRuns };
  }

  async pause(id: string) {
    const fr = await this.findOne(id);
    if (fr.status !== FeatureRunStatus.RUNNING) {
      throw new BadRequestException('Feature run is not running');
    }
    const updated = await this.prisma.featureRun.update({
      where: { id },
      data: { status: FeatureRunStatus.PAUSED },
    });
    this.gateway.emitFeatureRunUpdated({ id: updated.id, featureId: updated.featureId, status: updated.status });
    return updated;
  }

  async resume(id: string) {
    const fr = await this.findOne(id);
    if (fr.status !== FeatureRunStatus.PAUSED) {
      throw new BadRequestException('Feature run is not paused');
    }

    // Find next pending run and enqueue it
    const nextRun = await this.prisma.testRun.findFirst({
      where: { featureRunId: id, status: RunStatus.PENDING },
      orderBy: { createdAt: 'asc' },
    });

    await this.prisma.featureRun.update({
      where: { id },
      data: { status: FeatureRunStatus.RUNNING },
    });

    if (nextRun) {
      await this.queue.enqueueRun({ runId: nextRun.id });
    }

    const result = await this.findOne(id);
    this.gateway.emitFeatureRunUpdated({ id: result.id, featureId: result.featureId, status: result.status });
    return result;
  }

  async stop(id: string) {
    const fr = await this.findOne(id);

    // Idempotent: stopping an already-terminal run is a no-op success. A
    // double-click on "Stop" or a retried request must not 4xx — the run is
    // stopped, that's all the caller cares about. Still close the work
    // session in case an earlier partial stop left it open.
    if (fr.status === FeatureRunStatus.COMPLETE || fr.status === FeatureRunStatus.CANCELLED) {
      await this.endWorkSessionForRun(id, 'session-ended');
      return fr;
    }

    // Snapshot which runs were already running on a worker BEFORE we mark
    // them cancelled — only those have a live browser that the worker needs
    // to tear down. PENDING/QUEUED runs never started, so we emit the
    // abort-completed signal for them ourselves; otherwise the web UI would
    // wait forever for an event that the worker will never fire.
    const liveRunIds = fr.testRuns.filter(r => r.status === RunStatus.RUNNING).map(r => r.id);
    const noBrowserRunIds = fr.testRuns
      .filter(r => r.status === RunStatus.PENDING || r.status === RunStatus.QUEUED)
      .map(r => r.id);

    // A stopped run gives no verdict to tests the tester didn't evaluate, so
    // they become NOT_TESTED — not CANCELLED. NOT_TESTED is excluded from
    // pass-rate/progress and never overrides a prior PASSED/FAILED, which is
    // exactly right: stopping a session shouldn't read as "tested" nor wipe an
    // earlier result. (CANCELLED + a SKIPPED step is the fingerprint of a
    // deliberate skip — only skipCurrent() may produce that.)
    await this.prisma.testRun.updateMany({
      where: { featureRunId: id, status: { in: [RunStatus.PENDING, RunStatus.QUEUED, RunStatus.RUNNING] } },
      data: { status: RunStatus.NOT_TESTED, completedAt: new Date() },
    });
    // Resolve dangling steps as ABORTED (not SKIPPED): the run was stopped, the
    // steps weren't deliberately skipped. Avoids the false skip fingerprint.
    const testRunIds = fr.testRuns.map(r => r.id);
    if (testRunIds.length > 0) {
      await this.prisma.runStep.updateMany({
        where: { runId: { in: testRunIds }, status: { in: [StepStatus.PENDING, StepStatus.RUNNING] } },
        data: { status: StepStatus.ABORTED, completedAt: new Date() },
      });
    }

    const updated = await this.prisma.featureRun.update({
      where: { id },
      data: { status: FeatureRunStatus.CANCELLED, completedAt: new Date() },
    });
    // Close the user's QA work session — run and session end together.
    await this.endWorkSessionForRun(id, 'session-ended');
    this.gateway.emitFeatureRunUpdated({ id: updated.id, featureId: updated.featureId, status: updated.status });

    // Fire abort-completed for runs that never reached the worker.
    // Live (worker-side) runs will fire their own once the browser tears down.
    for (const runId of noBrowserRunIds) {
      this.gateway.emitRunAbortCompleted({ runId, projectId: fr.testRuns[0]?.projectId ?? '', featureRunId: id });
    }
    // If nothing was running on the worker, we're already fully aborted —
    // emit a feature-run-level abortCompleted for the UI's gating logic.
    if (liveRunIds.length === 0) {
      this.gateway.emitRunAbortCompleted({ runId: id, projectId: fr.testRuns[0]?.projectId ?? '', featureRunId: id });
    }
    return updated;
  }

  async skipCurrent(id: string) {
    const fr = await this.findOne(id);
    if (fr.status !== FeatureRunStatus.RUNNING && fr.status !== FeatureRunStatus.PAUSED) {
      throw new BadRequestException('Feature run is not active');
    }

    const currentRun = await this.prisma.testRun.findFirst({
      where: { featureRunId: id, status: { in: [RunStatus.RUNNING, RunStatus.QUEUED] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!currentRun) {
      throw new BadRequestException('No running test to skip');
    }

    const completedAt = new Date();
    const updatedRun = await this.prisma.testRun.update({
      where: { id: currentRun.id },
      data: {
        status: RunStatus.CANCELLED,
        completedAt,
        errorMessage: 'Skipped by user from automated testing view',
      },
    });
    await this.prisma.runStep.updateMany({
      where: { runId: currentRun.id, status: { in: [StepStatus.PENDING, StepStatus.RUNNING] } },
      data: {
        status: StepStatus.SKIPPED,
        completedAt,
        errorMessage: 'Skipped by user',
      },
    });

    this.gateway.emitRunUpdated({
      id: updatedRun.id,
      status: updatedRun.status,
      projectId: updatedRun.projectId,
      startedAt: updatedRun.startedAt,
      completedAt: updatedRun.completedAt,
      duration: updatedRun.duration,
      errorMessage: updatedRun.errorMessage,
    });
    if (updatedRun.featureRunId) {
      this.gateway.emitFeatureRunTestRunUpdated({
        featureRunId: updatedRun.featureRunId,
        testRunId: updatedRun.id,
        status: updatedRun.status,
      });
    }

    await this.onRunComplete(currentRun.id);
    return this.findOne(id);
  }

  async findOne(id: string) {
    const fr = await this.prisma.featureRun.findUnique({
      where: { id },
      include: {
        testRuns: {
          include: {
            testDefinition: { select: { id: true, name: true, type: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        feature: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true } },
        featureVersion: { select: { id: true, label: true, name: true } },
      },
    });
    if (!fr) throw new NotFoundException('Feature run not found');
    return fr;
  }

  /**
   * @param allowedEnvIds Implicit env-RBAC filter: when non-null, restricts
   *   results to feature runs in one of these envs (comes from
   *   EnvAccessService.getAllowedEnvIds). Combined with the explicit
   *   environmentId filter so a UAT-only user passing no filter still sees
   *   only UAT runs. Empty array = "no envs allowed" → returns nothing.
   */
  findByFeature(featureId: string, limit = 20, environmentId?: string, allowedEnvIds?: string[] | null) {
    const envFilter: { environmentId?: string | { in: string[] } } = {};
    if (environmentId) {
      envFilter.environmentId = environmentId;
    } else if (allowedEnvIds !== null && allowedEnvIds !== undefined) {
      envFilter.environmentId = { in: allowedEnvIds };
    }
    return this.prisma.featureRun.findMany({
      where: { featureId, ...envFilter },
      include: {
        testRuns: {
          include: {
            testDefinition: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        featureVersion: { select: { id: true, label: true } },
        environment: { select: { id: true, name: true, type: true } },
        promotedFrom: { select: { id: true, environmentId: true, status: true } },
        signoffs: {
          include: { signedBy: { select: { id: true, name: true, email: true } } },
          orderBy: { signedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Caller's in-progress manual + automated runs. Drives the global
   * "Active sessions" pill in the TopNav so a user always knows what they
   * have open across features, not just on the page they're currently on.
   */
  findActiveForUser(userId: string) {
    return this.prisma.featureRun.findMany({
      where: {
        triggeredById: userId,
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
      },
      include: {
        feature: {
          select: { id: true, name: true, module: { select: { id: true, name: true, projectId: true, project: { select: { id: true, name: true } } } } },
        },
        _count: { select: { testRuns: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Refreshes lastHeartbeatAt on every active run for this user. Lets the
   * heartbeat live at the Shell level instead of inside the ManualPlayer —
   * sessions stay alive while the user navigates around the platform.
   */
  async bulkHeartbeat(userId: string): Promise<{ refreshed: number }> {
    const result = await this.prisma.featureRun.updateMany({
      where: {
        triggeredById: userId,
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
      },
      data: { lastHeartbeatAt: new Date() },
    });
    return { refreshed: result.count };
  }

  /** Called by the tester's browser every 5 minutes to keep the session alive */
  async heartbeat(id: string) {
    await this.findOne(id); // validates it exists
    return this.prisma.featureRun.update({
      where: { id },
      data: { lastHeartbeatAt: new Date() },
    });
  }

  /**
   * Resolve {triggeredById, orgId} for a feature run so a stop/abandon can
   * also close the user's QA work session. Returns nulls if the run has no
   * triggering user or the org chain can't be resolved — caller no-ops.
   */
  private async resolveRunUserOrg(featureRunId: string): Promise<{ userId: string | null; orgId: string | null }> {
    const fr = await this.prisma.featureRun.findUnique({
      where: { id: featureRunId },
      select: {
        triggeredById: true,
        feature: { select: { module: { select: { project: { select: { orgId: true } } } } } },
      },
    });
    return {
      userId: fr?.triggeredById ?? null,
      orgId: fr?.feature?.module?.project?.orgId ?? null,
    };
  }

  /**
   * Couple the MANUAL run to the QA work session: when a manual run is
   * stopped or abandoned, the user's work session is closed too. The two
   * used to be fully decoupled — "Stop Testing" cancelled the run but the
   * session badge stayed lit, so "stop" never felt like it actually stopped.
   *
   * Guarded to MANUAL runs only. Automated runs never join a session, so
   * there's nothing to end — and crucially, finishing/stopping an automated
   * batch must NOT close a human's concurrent manual session that happens to
   * belong to the same user+org. This guard is the single chokepoint that
   * makes that guarantee regardless of which caller (stop/abandon/skip)
   * invokes it. Best-effort: a failure here must never block run teardown.
   */
  private async endWorkSessionForRun(featureRunId: string, reason: string): Promise<void> {
    try {
      const fr = await this.prisma.featureRun.findUnique({
        where: { id: featureRunId },
        select: { runMode: true },
      });
      if (fr?.runMode !== RunMode.MANUAL) return;
      const { userId, orgId } = await this.resolveRunUserOrg(featureRunId);
      if (userId && orgId) {
        await this.workSessions.endActive(userId, orgId, reason);
      }
    } catch {
      /* non-fatal — the run is already cancelled, session cleanup is best-effort */
    }
  }

  /**
   * Abandon a manual run — user clicked End Session / Stop Testing.
   * Idempotent: calling it on an already-terminal run returns that run
   * instead of throwing, so a double-click (or React-Query retry) can't
   * surface a false "Failed to end session" error.
   */
  async abandon(id: string) {
    const fr = await this.findOne(id);
    if (fr.status === FeatureRunStatus.COMPLETE || fr.status === FeatureRunStatus.CANCELLED) {
      // Already finished — make sure the work session is closed too (it may
      // have been left open by an earlier partial stop) and return as success.
      await this.endWorkSessionForRun(id, 'session-ended');
      return fr;
    }
    // Ending a manual session is a normal finish, not an abort. Tests the
    // tester already marked keep their PASSED/FAILED verdict; tests they
    // never got to are recorded as NOT_TESTED (not CANCELLED, which reads as
    // an abort and is excluded from pass-rate / never overrides a verdict).
    await this.prisma.testRun.updateMany({
      where: { featureRunId: id, status: { in: [RunStatus.PENDING, RunStatus.RUNNING, RunStatus.QUEUED] } },
      data: { status: RunStatus.NOT_TESTED, completedAt: new Date() },
    });
    // Mark all pending RunSteps as SKIPPED
    const testRunIds = fr.testRuns.map(r => r.id);
    if (testRunIds.length > 0) {
      await this.prisma.runStep.updateMany({
        where: { runId: { in: testRunIds }, status: 'PENDING' as never },
        data: { status: 'SKIPPED' as never },
      });
    }
    const updated = await this.prisma.featureRun.update({
      where: { id },
      data: { status: FeatureRunStatus.COMPLETE, completedAt: new Date() },
    });
    // Close the user's QA work session — the run and the session end together.
    await this.endWorkSessionForRun(id, 'session-ended');
    this.gateway.emitFeatureRunUpdated({ id: updated.id, featureId: updated.featureId, status: updated.status });
    // Manual sessions never had a worker browser to clean up, so the
    // abort-completed signal can be emitted immediately. The web UI uses
    // this to advance the mode-switch modal.
    this.gateway.emitRunAbortCompleted({
      runId: id,
      projectId: fr.testRuns[0]?.projectId ?? '',
      featureRunId: id,
    });
    return updated;
  }

  // ─── Active-session management ──────────────────────────────────────────
  //
  // A "manual session" is a FeatureRun with runMode=MANUAL still in
  // RUNNING/PAUSED. These can pile up when a user closes the tab without
  // stopping; the helpers below clear them reliably.

  /** End every active manual run for a user. Used by the concurrent-start
   *  path so "End previous & start new" wipes ALL stale runs, not just one. */
  async endAllActiveManualForUser(userId: string, reason: string) {
    const active = await this.prisma.featureRun.findMany({
      where: {
        triggeredById: userId,
        runMode: RunMode.MANUAL,
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
      },
      select: { id: true },
    });
    for (const r of active) {
      try { await this.abandon(r.id); } catch { /* already finished — ignore */ }
    }
    return { ended: active.length, reason };
  }

  /** List all active (RUNNING/PAUSED) manual sessions across an org —
   *  org-admin visibility into who has a session open. */
  async listActiveSessionsForOrg(orgId: string) {
    const runs = await this.prisma.featureRun.findMany({
      where: {
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
        runMode: RunMode.MANUAL,
        feature: { module: { project: { orgId } } },
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        createdAt: true,
        lastHeartbeatAt: true,
        feature: { select: { id: true, name: true, module: { select: { id: true, name: true, projectId: true } } } },
        triggeredBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt,
      createdAt: r.createdAt,
      lastHeartbeatAt: r.lastHeartbeatAt,
      featureId: r.feature.id,
      featureName: r.feature.name,
      moduleName: r.feature.module.name,
      projectId: r.feature.module.projectId,
      user: r.triggeredBy
        ? { id: r.triggeredBy.id, name: r.triggeredBy.name, email: r.triggeredBy.email }
        : null,
    }));
  }

  /** Force-end one active session — verifies it belongs to the org first so
   *  an admin of org A can't end a session in org B. */
  async forceEndSessionForOrg(orgId: string, featureRunId: string) {
    const fr = await this.prisma.featureRun.findFirst({
      where: { id: featureRunId, feature: { module: { project: { orgId } } } },
      select: { id: true, status: true },
    });
    if (!fr) throw new NotFoundException('Session not found in this organisation');
    if (fr.status === FeatureRunStatus.COMPLETE || fr.status === FeatureRunStatus.CANCELLED) {
      return { ended: 0 };
    }
    await this.abandon(featureRunId);
    return { ended: 1 };
  }

  /** Force-end every active manual session in an org. The org-admin escape
   *  hatch for clearing stuck sessions in bulk. */
  async forceEndAllForOrg(orgId: string) {
    const active = await this.prisma.featureRun.findMany({
      where: {
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
        runMode: RunMode.MANUAL,
        feature: { module: { project: { orgId } } },
      },
      select: { id: true },
    });
    for (const r of active) {
      try { await this.abandon(r.id); } catch { /* already finished — ignore */ }
    }
    return { ended: active.length };
  }

  /** Called by the worker when a TestRun in a FeatureRun completes */
  async onRunComplete(testRunId: string) {
    const run = await this.prisma.testRun.findUnique({
      where: { id: testRunId },
      select: { featureRunId: true, status: true },
    });
    if (!run?.featureRunId) return;

    const featureRunId = run.featureRunId;
    const featureRun = await this.prisma.featureRun.findUnique({
      where: { id: featureRunId },
      include: { testRuns: { select: { id: true, status: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!featureRun || featureRun.status === FeatureRunStatus.CANCELLED) return;

    const pending = featureRun.testRuns.filter(r => r.status === RunStatus.PENDING);
    const terminalStatuses: RunStatus[] = [RunStatus.PASSED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.ERROR];
    const allDone = featureRun.testRuns.every(r => terminalStatuses.includes(r.status));

    if (allDone) {
      const updated = await this.prisma.featureRun.update({
        where: { id: featureRunId },
        data: { status: FeatureRunStatus.COMPLETE, completedAt: new Date() },
      });
      const passed = featureRun.testRuns.filter(r => r.status === RunStatus.PASSED).length;
      const failed = featureRun.testRuns.filter(r => r.status === RunStatus.FAILED).length;
      this.gateway.emitFeatureRunUpdated({
        id: updated.id,
        featureId: updated.featureId,
        status: updated.status,
        passedCount: passed,
        failedCount: failed,
      });

      // Fire notification — fetch feature → module → project → org chain
      try {
        const featureCtx = await this.prisma.feature.findUnique({
          where: { id: featureRun.featureId },
          select: {
            name: true,
            module: {
              select: {
                project: {
                  select: { id: true, name: true, orgId: true },
                },
              },
            },
          },
        });
        if (featureCtx?.module?.project?.orgId) {
          const { id: projectId, name: projectName, orgId } = featureCtx.module.project;
          await this.notificationsService.notifyRunCompleted({
            orgId,
            projectId,
            projectName,
            featureName: featureCtx.name,
            featureId: featureRun.featureId,
            runId: featureRunId,
            passed: failed === 0,
            passedCount: passed,
            totalCount: featureRun.testRuns.length,
          });
        }
      } catch {
        // Notification failure must never break the run completion flow
      }

      // Sign-off automation — if this feature is now 100% passed in its
      // environment, kick off the sign-off request (notifies + emails the
      // designated approvers). requestSignoff self-guards on actual 100% and
      // is idempotent, so firing unconditionally on completion is safe.
      if (featureRun.environmentId) {
        this.signoffService
          .requestSignoff(featureRun.featureId, featureRun.environmentId)
          .catch(() => undefined);
      }
    } else if (featureRun.status === FeatureRunStatus.RUNNING && pending.length > 0) {
      // Enqueue next pending run
      await this.queue.enqueueRun({ runId: pending[0].id });
    }
  }

  /**
   * Record a sign-off decision for a feature run. Used as the formal QA →
   * UAT gate: an approved sign-off is what the promote endpoint requires
   * before opening a parallel run in the target environment. We allow
   * multiple signoffs per run (e.g. dual-approval) — the most recent
   * APPROVED is what gates promotion.
   */
  async signoff(
    featureRunId: string,
    userId: string,
    dto: { decision: 'APPROVED' | 'REJECTED'; note?: string },
  ) {
    const fr = await this.prisma.featureRun.findUnique({
      where: { id: featureRunId },
      select: { id: true, status: true, environmentId: true },
    });
    if (!fr) throw new NotFoundException('Feature run not found');
    if (!fr.environmentId) throw new BadRequestException('Feature run has no environment to sign off on');
    if (fr.status !== FeatureRunStatus.COMPLETE) {
      throw new BadRequestException('Sign-off requires the feature run to be COMPLETE');
    }
    return this.prisma.phaseSignoff.create({
      data: {
        featureRunId,
        environmentId: fr.environmentId,
        signedById: userId,
        decision: dto.decision as SignoffDecision,
        note: dto.note,
      },
      include: { signedBy: { select: { id: true, name: true, email: true } } },
    });
  }

  /**
   * Promote (handover) a fully-passed feature run to a different environment.
   *
   * Behaviour:
   *   1. Source run must be COMPLETE with no failed test runs (100% pass).
   *   2. Source run must have at least one APPROVED sign-off.
   *   3. Target env must belong to the same project.
   *   4. Creates a new FeatureRun in the target env, manual mode by default
   *      (UAT/clients usually want to run their own tests rather than have
   *      Playwright auto-execute) — caller can request AUTOMATED to re-run.
   *   5. Pre-creates RunStep records for manual mode so the UAT tester can
   *      step through them immediately on accept.
   *   6. Notifies the project's UAT team via the existing notifications
   *      service. Failure to notify is non-fatal.
   */
  async promote(
    sourceFeatureRunId: string,
    userId: string,
    dto: { targetEnvironmentId: string; note?: string; runMode?: 'AUTOMATED' | 'MANUAL' },
  ) {
    const source = await this.prisma.featureRun.findUnique({
      where: { id: sourceFeatureRunId },
      include: {
        testRuns: { include: { testDefinition: true } },
        signoffs: { where: { decision: SignoffDecision.APPROVED } },
        feature: { include: { module: { select: { projectId: true } } } },
      },
    });
    if (!source) throw new NotFoundException('Source feature run not found');
    if (source.status !== FeatureRunStatus.COMPLETE) {
      throw new BadRequestException('Only COMPLETE runs can be promoted');
    }
    const failed = source.testRuns.filter(r => r.status === RunStatus.FAILED || r.status === RunStatus.ERROR).length;
    if (failed > 0) {
      throw new BadRequestException(`Cannot promote — ${failed} test(s) failed in source run`);
    }
    if (source.signoffs.length === 0) {
      throw new BadRequestException('At least one APPROVED sign-off is required before promotion');
    }

    const targetEnv = await this.prisma.environment.findUnique({ where: { id: dto.targetEnvironmentId } });
    if (!targetEnv) throw new NotFoundException('Target environment not found');
    if (targetEnv.projectId !== source.feature.module.projectId) {
      throw new BadRequestException('Target environment must belong to the same project');
    }
    if (targetEnv.id === source.environmentId) {
      throw new BadRequestException('Cannot promote into the same environment');
    }

    const isManual = (dto.runMode ?? 'MANUAL') === 'MANUAL';
    const projectId = source.feature.module.projectId;

    // Reuse the same active set of test definitions the source ran against
    // so the UAT scope is identical to what was signed off in QA.
    const testDefinitions = source.testRuns.map(r => r.testDefinition);

    const newFr = await this.prisma.featureRun.create({
      data: {
        featureId: source.featureId,
        environmentId: targetEnv.id,
        featureVersionId: source.featureVersionId,
        triggeredById: userId,
        runMode: isManual ? RunMode.MANUAL : RunMode.AUTOMATED,
        status: FeatureRunStatus.RUNNING,
        startedAt: new Date(),
        promotedFromId: source.id,
      },
    });

    const testRuns: TestRun[] = [];
    for (const td of testDefinitions) {
      testRuns.push(await this.prisma.testRun.create({
        data: {
          projectId,
          testDefinitionId: td.id,
          environmentId: targetEnv.id,
          featureRunId: newFr.id,
          featureVersionId: source.featureVersionId,
          triggeredById: userId,
          trigger: 'feature_run_promoted',
          runMode: isManual ? RunMode.MANUAL : RunMode.AUTOMATED,
          status: RunStatus.PENDING,
        },
      }));
    }

    if (isManual) {
      // Pre-create RunSteps so the UAT tester can immediately mark pass/fail
      await Promise.all(
        testDefinitions.map(async (td, tdIndex) => {
          const tr = testRuns[tdIndex];
          if (!tr) return;
          const steps = Array.isArray(td.steps) ? td.steps : [];
          await Promise.all(
            (steps as Record<string, unknown>[]).map((step, idx: number) =>
              this.prisma.runStep.create({
                data: {
                  runId: tr.id,
                  index: idx,
                  name: (step['name'] as string | undefined) ?? String(step['type'] ?? `Step ${idx + 1}`),
                  type: String(step['type'] ?? 'NAVIGATE') as never,
                  input: (step['input'] as object | undefined) ?? undefined,
                  status: 'PENDING' as never,
                },
              }),
            ),
          );
          await this.prisma.testRun.update({
            where: { id: tr.id },
            data: { status: RunStatus.RUNNING, startedAt: new Date() },
          });
        }),
      );
    } else if (testRuns.length > 0) {
      await this.queue.enqueueRun({ runId: testRuns[0].id });
    }

    // Notify — best-effort, never fail the promotion on notification errors
    try {
      const projectCtx = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, orgId: true },
      });
      if (projectCtx?.orgId) {
        await this.notificationsService.notifyRunCompleted({
          orgId: projectCtx.orgId,
          projectId,
          projectName: projectCtx.name,
          featureName: `${source.feature?.id ? '' : ''}Promoted to ${targetEnv.name}`,
          featureId: source.featureId,
          runId: newFr.id,
          passed: true,
          passedCount: 0,
          totalCount: testRuns.length,
        });
      }
    } catch {
      // Notification failure is non-fatal
    }

    return { sourceRunId: source.id, newFeatureRun: newFr, testRuns, targetEnvironment: targetEnv };
  }
}
