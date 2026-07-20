import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PipelineRunStatus, Prisma, RunStatus, StageFailurePolicy } from '@prisma/client';
import { CronLock } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { isTestDefinitionAutomatable } from '../../common/util/automation';
import { sendProjectWebhook } from '../../common/webhooks/outbound-webhook';
import { clampLimit } from '../../common/util/pagination';
import { RunsGateway } from '../websocket/runs.gateway';

// ─── Pipelines: the cross-feature sequencer ─────────────────────────────────
// A pipeline chains stages (feature + env + on-failure policy) SEQUENTIALLY.
// Each stage execution IS a FeatureRun; the advance signal is the same
// worker → Redis → onRunComplete path that chains TestRuns inside a feature
// run, one level up: worker-events calls onFeatureRunMaybeTerminal() after
// onRunComplete. A per-minute safety tick covers missed events (API restart,
// stuck-run reaper) via the same idempotent claim.

export interface UpsertPipelineDto {
  name: string;
  description?: string;
  updatesFeatureStatus?: boolean;
  stages: Array<{ featureId: string; environmentId: string; onFailure?: 'HALT' | 'CONTINUE' }>;
}

interface StageSnapshot {
  order: number;
  featureId: string;
  environmentId: string;
  onFailure: 'HALT' | 'CONTINUE';
  featureName: string;
  envName: string;
}

interface StageResult {
  order: number;
  featureRunId?: string;
  status: 'PASSED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';
  passed: number;
  failed: number;
  errorMessage?: string;
}

const MAX_STAGES = 20;
// A stage with no progress for this long gets the whole run cancelled by the
// safety tick — generous multiple of the stuck-runs reaper's 60-min cancel so
// we never race a run the reaper is still entitled to resurrect.
const PIPELINE_STALL_MS = Number(process.env.PIPELINE_STALL_MS) || 2 * 60 * 60 * 1000;
// A RUNNING run whose current stage has no FeatureRun after this long had its
// advance severed (process died between the claim and starting the stage) —
// the tick re-drives it from stored state.
const PIPELINE_RESUME_GRACE_MS = 3 * 60 * 1000;

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);
  // Runs mid-resume in THIS process — prevents overlapping ticks double-starting a stage.
  private readonly resuming = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => FeatureRunsService))
    private readonly featureRuns: FeatureRunsService,
    private readonly gateway: RunsGateway,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────

  list(projectId: string) {
    return this.prisma.pipeline.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        stages: {
          orderBy: { order: 'asc' },
          include: {
            feature: { select: { id: true, name: true } },
            environment: { select: { id: true, name: true } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        // Recent outcomes for the panel's health strip, newest first.
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 5,
          select: { id: true, status: true, trigger: true, startedAt: true, completedAt: true, currentStageOrder: true },
        },
      },
    });
  }

  async create(projectId: string, userId: string, dto: UpsertPipelineDto) {
    const stages = await this.validateDefinition(projectId, dto);
    try {
      return await this.prisma.pipeline.create({
        data: {
          projectId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          updatesFeatureStatus: dto.updatesFeatureStatus ?? false,
          createdById: userId,
          stages: { create: stages },
        },
        include: { stages: { orderBy: { order: 'asc' } } },
      });
    } catch (err) {
      this.rethrowUniqueName(err);
    }
  }

  async update(id: string, dto: Partial<UpsertPipelineDto>) {
    const existing = await this.findOne(id);
    // Stages are replaced wholesale (same convention as env variables); a
    // definition edit never touches in-flight runs — they execute from their
    // stagesSnapshot taken at trigger time.
    let stages: Array<{ order: number; featureId: string; environmentId: string; onFailure: StageFailurePolicy }> | undefined;
    if (dto.stages) {
      stages = await this.validateDefinition(existing.projectId, {
        name: dto.name ?? existing.name,
        stages: dto.stages,
      });
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (stages) {
          await tx.pipelineStage.deleteMany({ where: { pipelineId: id } });
          await tx.pipelineStage.createMany({ data: stages.map(s => ({ ...s, pipelineId: id })) });
        }
        return tx.pipeline.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description?.trim() || null } : {}),
            ...(dto.updatesFeatureStatus !== undefined ? { updatesFeatureStatus: dto.updatesFeatureStatus } : {}),
          },
          include: { stages: { orderBy: { order: 'asc' } } },
        });
      });
    } catch (err) {
      this.rethrowUniqueName(err);
    }
  }

  async findOne(id: string) {
    const p = await this.prisma.pipeline.findUnique({
      where: { id },
      include: {
        stages: {
          orderBy: { order: 'asc' },
          include: {
            feature: { select: { id: true, name: true } },
            environment: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!p) throw new NotFoundException('Pipeline not found');
    return p;
  }

  async remove(id: string) {
    await this.findOne(id);
    const running = await this.prisma.pipelineRun.findFirst({
      where: { pipelineId: id, status: PipelineRunStatus.RUNNING },
      select: { id: true },
    });
    if (running) {
      throw new ConflictException(`Pipeline has an active run (${running.id}) — stop it before deleting`);
    }
    // PipelineRun rows cascade with the pipeline; the FeatureRuns they started
    // (the actual evidence) survive via the SetNull back-link.
    return this.prisma.pipeline.delete({ where: { id } });
  }

  /** Run history for one pipeline — the panel's drill-in. */
  async history(id: string, limit = 50) {
    await this.findOne(id);
    return this.prisma.pipelineRun.findMany({
      where: { pipelineId: id },
      orderBy: { startedAt: 'desc' },
      take: clampLimit(limit, { def: 50, max: 200 }),
    });
  }

  /** Aggregate status of one run — the CI poll target + UI stage timeline. */
  async getRun(id: string) {
    const run = await this.prisma.pipelineRun.findUnique({
      where: { id },
      include: {
        pipeline: { select: { id: true, name: true, projectId: true } },
        featureRuns: {
          select: { id: true, status: true, startedAt: true, completedAt: true },
        },
      },
    });
    if (!run) throw new NotFoundException('Pipeline run not found');
    return run;
  }

  // ─── Trigger ───────────────────────────────────────────────────────

  async trigger(pipelineId: string, userId: string | undefined, trigger: string) {
    const pipeline = await this.findOne(pipelineId);
    if (pipeline.stages.length === 0) {
      throw new BadRequestException('Pipeline has no stages');
    }
    // Overlap control: one live run per pipeline. The unique claim is the
    // create-below guarded by this check + the atomic advance claims; a racing
    // second trigger loses on the recheck inside the transaction.
    const snapshot: StageSnapshot[] = pipeline.stages.map(s => ({
      order: s.order,
      featureId: s.featureId,
      environmentId: s.environmentId,
      onFailure: s.onFailure,
      featureName: s.feature.name,
      envName: s.environment.name,
    }));

    // Re-validate the definition — it may have rotted since creation
    // (feature archived, env automation turned off). All failures in one 400.
    await this.validateStagesRunnable(pipeline.projectId, snapshot);

    const run = await this.prisma.$transaction(async (tx) => {
      const running = await tx.pipelineRun.findFirst({
        where: { pipelineId, status: PipelineRunStatus.RUNNING },
        select: { id: true },
      });
      if (running) {
        throw new ConflictException(`Pipeline is already running (run ${running.id})`);
      }
      return tx.pipelineRun.create({
        data: {
          pipelineId,
          trigger,
          stagesSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdById: userId ?? null,
        },
      });
    });

    this.logger.log(`[pipeline] run ${run.id} (${pipeline.name}) started via ${trigger} — ${snapshot.length} stage(s)`);
    await this.startStage(run.id, 0);
    return this.getRun(run.id);
  }

  // ─── Sequencer core ────────────────────────────────────────────────

  /**
   * Start the stage at `order`. On failure to even start (env unreachable,
   * feature deleted mid-run), records the stage as FAILED with the reason and
   * applies the stage's on-failure policy — never throws to the caller.
   */
  private async startStage(pipelineRunId: string, order: number): Promise<void> {
    const run = await this.prisma.pipelineRun.findUnique({
      where: { id: pipelineRunId },
      include: { pipeline: { select: { updatesFeatureStatus: true } } },
    });
    if (!run || run.status !== PipelineRunStatus.RUNNING) return;
    const stages = run.stagesSnapshot as unknown as StageSnapshot[];
    const stage = stages.find(s => s.order === order);
    if (!stage) {
      await this.finalize(pipelineRunId);
      return;
    }

    try {
      const { featureRun } = await this.featureRuns.start(
        stage.featureId,
        { runMode: 'AUTOMATED', environmentId: stage.environmentId, trigger: 'pipeline' },
        run.createdById ?? undefined,
        { pipelineRunId, pipelineExcludesFromCanonical: !run.pipeline.updatesFeatureStatus },
      );
      this.logger.log(`[pipeline] run ${pipelineRunId} stage ${order} → featureRun ${featureRun.id}`);
      this.emitUpdate(pipelineRunId);
    } catch (err) {
      const message = (err as Error).message ?? 'Failed to start stage';
      this.logger.warn(`[pipeline] run ${pipelineRunId} stage ${order} failed to start: ${message}`);
      // Claim the stage exactly like a terminal advance — currentStageOrder
      // must always point at the first undecided stage.
      const claimed = await this.prisma.pipelineRun.updateMany({
        where: { id: pipelineRunId, status: PipelineRunStatus.RUNNING, currentStageOrder: order },
        data: { currentStageOrder: order + 1 },
      });
      if (claimed.count === 0) return;
      await this.recordStageResult(pipelineRunId, {
        order,
        status: 'FAILED',
        passed: 0,
        failed: 0,
        errorMessage: message.slice(0, 500),
      });
      await this.applyPolicyAndAdvance(pipelineRunId, order, true);
    }
  }

  /**
   * Advance signal — called for every terminal TestRun (chained after
   * onRunComplete in worker-events) and by the safety tick. No-ops unless the
   * FeatureRun is terminal AND belongs to a RUNNING pipeline run whose
   * current stage it is. Idempotent via an atomic currentStageOrder claim.
   */
  async onFeatureRunMaybeTerminal(featureRunId: string): Promise<void> {
    const fr = await this.prisma.featureRun.findUnique({
      where: { id: featureRunId },
      select: {
        id: true, status: true, pipelineRunId: true,
        testRuns: { select: { status: true } },
      },
    });
    if (!fr?.pipelineRunId) return;
    if (fr.status !== 'COMPLETE' && fr.status !== 'CANCELLED') return;

    const run = await this.prisma.pipelineRun.findUnique({ where: { id: fr.pipelineRunId } });
    if (!run || run.status !== PipelineRunStatus.RUNNING) return;
    if (((run.stageResults as unknown as StageResult[]) ?? []).some(r => r.featureRunId === fr.id)) {
      return; // this FeatureRun's stage is already accounted for
    }

    // Which stage was this FeatureRun? Match via stageResults-not-yet-recorded
    // current order (the run executes one stage at a time by construction).
    const order = run.currentStageOrder;

    const passed = fr.testRuns.filter(t => t.status === RunStatus.PASSED).length;
    const failed = fr.testRuns.filter(t =>
      t.status === RunStatus.FAILED || t.status === RunStatus.ERROR || t.status === RunStatus.TIMED_OUT,
    ).length;
    const stageFailed = failed > 0 || fr.status === 'CANCELLED';

    // Idempotent claim: only the first caller for this stage advances (a racing
    // duplicate matches 0 rows). The result lands in the SAME transaction so a
    // crash can never leave a claimed stage without its result — the tick's
    // resume branch depends on that pairing.
    const claimed = await this.prisma.$transaction(async tx => {
      const c = await tx.pipelineRun.updateMany({
        where: { id: run.id, status: PipelineRunStatus.RUNNING, currentStageOrder: order },
        data: { currentStageOrder: order + 1 },
      });
      if (c.count === 0) return false;
      const fresh = await tx.pipelineRun.findUnique({
        where: { id: run.id }, select: { stageResults: true },
      });
      const results = [...((fresh?.stageResults as unknown as StageResult[]) ?? [])];
      if (!results.some(r => r.order === order)) {
        results.push({
          order,
          featureRunId: fr.id,
          status: fr.status === 'CANCELLED' ? 'CANCELLED' : stageFailed ? 'FAILED' : 'PASSED',
          passed,
          failed,
        });
        results.sort((a, b) => a.order - b.order);
        await tx.pipelineRun.update({
          where: { id: run.id },
          data: { stageResults: results as unknown as Prisma.InputJsonValue },
        });
      }
      return true;
    });
    if (!claimed) return;

    await this.applyPolicyAndAdvance(run.id, order, stageFailed);
  }

  /** HALT+failed → skip the rest and finalize; otherwise next stage / finalize. */
  private async applyPolicyAndAdvance(pipelineRunId: string, order: number, stageFailed: boolean): Promise<void> {
    const run = await this.prisma.pipelineRun.findUnique({ where: { id: pipelineRunId } });
    if (!run) return;
    const stages = run.stagesSnapshot as unknown as StageSnapshot[];
    const stage = stages.find(s => s.order === order);
    const halt = stageFailed && (stage?.onFailure ?? 'HALT') === 'HALT';

    if (halt) {
      await this.skipRemaining(pipelineRunId, order + 1, 'halt policy');
      await this.finalize(pipelineRunId);
      return;
    }
    const next = stages.find(s => s.order === order + 1);
    if (next) {
      await this.startStage(pipelineRunId, order + 1);
    } else {
      await this.finalize(pipelineRunId);
    }
  }

  /** Stop the chain: current FeatureRun stopped, rest SKIPPED, run CANCELLED. */
  async stop(pipelineRunId: string): Promise<void> {
    const run = await this.getRun(pipelineRunId);
    if (run.status !== PipelineRunStatus.RUNNING) {
      throw new ConflictException(`Pipeline run is ${run.status} — only RUNNING runs can be stopped`);
    }
    // Take the run out of RUNNING first so a stage completion racing this
    // stop can't advance to the next stage mid-cancel.
    const claimed = await this.prisma.pipelineRun.updateMany({
      where: { id: pipelineRunId, status: PipelineRunStatus.RUNNING },
      data: { status: PipelineRunStatus.CANCELLED, completedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new ConflictException('Pipeline run already finished');
    }

    // Stop the in-flight FeatureRun (best-effort — worker may already be done).
    const current = await this.prisma.featureRun.findFirst({
      where: { pipelineRunId, status: { in: ['RUNNING', 'PAUSED'] } },
      select: { id: true },
    });
    if (current) {
      try { await this.featureRuns.stop(current.id); } catch { /* already terminal */ }
    }

    const stages = (run.stagesSnapshot as unknown as StageSnapshot[]) ?? [];
    const results = (run.stageResults as unknown as StageResult[]) ?? [];
    const currentOrder = run.currentStageOrder;
    // Record the interrupted stage (if it hadn't landed a result yet).
    if (!results.some(r => r.order === currentOrder) && stages.some(s => s.order === currentOrder)) {
      await this.recordStageResult(pipelineRunId, {
        order: currentOrder, featureRunId: current?.id, status: 'CANCELLED', passed: 0, failed: 0,
        errorMessage: 'Stopped by user',
      });
    }
    await this.skipRemaining(pipelineRunId, currentOrder + 1, 'pipeline stopped');
    this.logger.log(`[pipeline] run ${pipelineRunId} stopped`);
    this.emitUpdate(pipelineRunId);
    await this.fireWebhook(pipelineRunId);
  }

  // ─── Safety tick ───────────────────────────────────────────────────

  /**
   * Belt-and-braces sweep. Two jobs:
   *  1. Advance RUNNING pipeline runs whose current FeatureRun is terminal but
   *     whose advance signal was lost (API restart; the stuck-runs reaper
   *     cancels FeatureRuns via updateMany, which never calls onRunComplete).
   *  2. Cancel runs stalled past PIPELINE_STALL_MS — no zombie pipelines.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'pipeline-runs-tick' })
  @CronLock('pipeline-runs-tick', { ttl: 120 })
  async tick(): Promise<void> {
    let running: Array<{
      id: string; startedAt: Date; currentStageOrder: number;
      stageResults: unknown; stagesSnapshot: unknown;
    }>;
    try {
      running = await this.prisma.pipelineRun.findMany({
        where: { status: PipelineRunStatus.RUNNING },
        select: {
          id: true, startedAt: true, currentStageOrder: true,
          stageResults: true, stagesSnapshot: true,
        },
      });
    } catch (err) {
      this.logger.error(`pipeline tick failed: ${(err as Error).message}`);
      return;
    }
    for (const run of running) {
      try {
        const results = (run.stageResults as StageResult[]) ?? [];
        const current = await this.prisma.featureRun.findFirst({
          where: { pipelineRunId: run.id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, status: true, updatedAt: true },
        });
        const currentRecorded = current != null && results.some(r => r.featureRunId === current.id);
        if (
          current && !currentRecorded &&
          (current.status === 'COMPLETE' || current.status === 'CANCELLED')
        ) {
          // Terminal but not advanced — the lost-signal case.
          await this.onFeatureRunMaybeTerminal(current.id);
          continue;
        }
        // Resume a severed advance: the current stage has no FeatureRun (the
        // latest one is already recorded, or none exists at all) — the process
        // died between the claim and starting the stage. Re-drive from stored
        // state after a grace period.
        const idleMs = Date.now() - (current?.updatedAt ?? run.startedAt).getTime();
        if ((!current || currentRecorded) && idleMs > PIPELINE_RESUME_GRACE_MS && !this.resuming.has(run.id)) {
          this.resuming.add(run.id);
          try {
            this.logger.warn(
              `[pipeline] run ${run.id} has no FeatureRun for stage ${run.currentStageOrder} — resuming severed advance`,
            );
            const stages = (run.stagesSnapshot as StageSnapshot[]) ?? [];
            const haltHit = results.some(r =>
              r.status === 'FAILED' &&
              (stages.find(s => s.order === r.order)?.onFailure ?? 'HALT') === 'HALT',
            );
            if (haltHit) {
              await this.skipRemaining(run.id, run.currentStageOrder, 'halt policy');
              await this.finalize(run.id);
            } else {
              await this.startStage(run.id, run.currentStageOrder);
            }
          } finally {
            this.resuming.delete(run.id);
          }
          continue;
        }
        // Stall ceiling: a FeatureRun stuck non-terminal with no updates for
        // too long.
        const lastActivity = current?.updatedAt ?? run.startedAt;
        if (Date.now() - lastActivity.getTime() > PIPELINE_STALL_MS) {
          this.logger.warn(`[pipeline] run ${run.id} stalled > ${PIPELINE_STALL_MS}ms — cancelling`);
          const claimed = await this.prisma.pipelineRun.updateMany({
            where: { id: run.id, status: PipelineRunStatus.RUNNING },
            data: { status: PipelineRunStatus.CANCELLED, completedAt: new Date() },
          });
          if (claimed.count > 0) {
            await this.recordStageResult(run.id, {
              order: run.currentStageOrder, status: 'CANCELLED', passed: 0, failed: 0,
              errorMessage: 'Pipeline stalled — cancelled by safety tick',
            });
            await this.skipRemaining(run.id, run.currentStageOrder + 1, 'pipeline stalled');
            this.emitUpdate(run.id);
            await this.fireWebhook(run.id);
          }
        }
      } catch (err) {
        this.logger.error(`pipeline tick for run ${run.id} failed: ${(err as Error).message}`);
      }
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private async recordStageResult(pipelineRunId: string, result: StageResult): Promise<void> {
    // Serialized via the advance claim, so read-modify-write is safe here.
    const run = await this.prisma.pipelineRun.findUnique({
      where: { id: pipelineRunId }, select: { stageResults: true },
    });
    if (!run) return;
    const results = [...((run.stageResults as unknown as StageResult[]) ?? [])];
    if (results.some(r => r.order === result.order)) return; // already recorded
    results.push(result);
    results.sort((a, b) => a.order - b.order);
    await this.prisma.pipelineRun.update({
      where: { id: pipelineRunId },
      data: { stageResults: results as unknown as Prisma.InputJsonValue },
    });
  }

  private async skipRemaining(pipelineRunId: string, fromOrder: number, reason: string): Promise<void> {
    const run = await this.prisma.pipelineRun.findUnique({
      where: { id: pipelineRunId }, select: { stagesSnapshot: true, stageResults: true },
    });
    if (!run) return;
    const stages = (run.stagesSnapshot as unknown as StageSnapshot[]) ?? [];
    const results = [...((run.stageResults as unknown as StageResult[]) ?? [])];
    for (const s of stages) {
      if (s.order >= fromOrder && !results.some(r => r.order === s.order)) {
        results.push({ order: s.order, status: 'SKIPPED', passed: 0, failed: 0, errorMessage: reason });
      }
    }
    results.sort((a, b) => a.order - b.order);
    await this.prisma.pipelineRun.update({
      where: { id: pipelineRunId },
      data: { stageResults: results as unknown as Prisma.InputJsonValue },
    });
  }

  /** All stages accounted for → COMPLETE (no failures) or FAILED. */
  private async finalize(pipelineRunId: string): Promise<void> {
    const run = await this.prisma.pipelineRun.findUnique({ where: { id: pipelineRunId } });
    if (!run || run.status !== PipelineRunStatus.RUNNING) return;
    const results = (run.stageResults as unknown as StageResult[]) ?? [];
    const anyBad = results.some(r => r.status === 'FAILED' || r.status === 'CANCELLED' || r.status === 'SKIPPED');
    const status = anyBad ? PipelineRunStatus.FAILED : PipelineRunStatus.COMPLETE;
    const claimed = await this.prisma.pipelineRun.updateMany({
      where: { id: pipelineRunId, status: PipelineRunStatus.RUNNING },
      data: { status, completedAt: new Date() },
    });
    if (claimed.count === 0) return;
    this.logger.log(`[pipeline] run ${pipelineRunId} finished: ${status}`);
    this.emitUpdate(pipelineRunId);
    await this.fireWebhook(pipelineRunId);
  }

  private emitUpdate(pipelineRunId: string): void {
    this.getRun(pipelineRunId)
      .then(run => this.gateway.emitPipelineRunUpdated({
        id: run.id,
        pipelineId: run.pipelineId,
        status: run.status,
        currentStageOrder: run.currentStageOrder,
        stageResults: run.stageResults,
      }))
      .catch(() => undefined);
  }

  private async fireWebhook(pipelineRunId: string): Promise<void> {
    try {
      const run = await this.prisma.pipelineRun.findUnique({
        where: { id: pipelineRunId },
        include: {
          pipeline: {
            select: {
              id: true, name: true, projectId: true,
              project: { select: { webhookUrl: true, webhookSecretCiphertext: true, webhookSecretKeyId: true } },
            },
          },
        },
      });
      if (!run) return;
      await sendProjectWebhook(
        run.pipeline.project,
        {
          event: 'pipeline_run.completed',
          pipelineRunId: run.id,
          pipelineId: run.pipeline.id,
          pipelineName: run.pipeline.name,
          projectId: run.pipeline.projectId,
          status: run.status,
          trigger: run.trigger,
          stages: run.stageResults,
          completedAt: run.completedAt?.toISOString() ?? new Date().toISOString(),
        },
        this.logger,
        `pipelineRun ${run.id}`,
      );
    } catch (err) {
      this.logger.warn(`pipeline webhook failed: ${(err as Error).message}`);
    }
  }

  // ─── Validation ────────────────────────────────────────────────────

  /** Definition-shape validation for create/update. Returns normalized stages. */
  private async validateDefinition(projectId: string, dto: Pick<UpsertPipelineDto, 'name' | 'stages'>) {
    if (!dto.name?.trim()) throw new BadRequestException('Pipeline name is required');
    if (!dto.stages || dto.stages.length === 0) throw new BadRequestException('A pipeline needs at least one stage');
    if (dto.stages.length > MAX_STAGES) throw new BadRequestException(`A pipeline supports at most ${MAX_STAGES} stages`);

    const snapshot = dto.stages.map((s, i) => ({
      order: i, // server-normalized: client array order IS the order
      featureId: s.featureId,
      environmentId: s.environmentId,
      onFailure: (s.onFailure ?? 'HALT') as 'HALT' | 'CONTINUE',
      featureName: '', envName: '',
    }));
    await this.validateStagesRunnable(projectId, snapshot);
    return snapshot.map(({ order, featureId, environmentId, onFailure }) => ({
      order, featureId, environmentId, onFailure: onFailure as StageFailurePolicy,
    }));
  }

  /**
   * Every stage must be runnable: feature alive in this project with ≥1
   * automatable test; env alive in this project with automation on.
   * ALL failures reported in one 400 — not first-failure-only.
   */
  private async validateStagesRunnable(projectId: string, stages: StageSnapshot[]): Promise<void> {
    const featureIds = [...new Set(stages.map(s => s.featureId))];
    const envIds = [...new Set(stages.map(s => s.environmentId))];
    const [features, envs] = await Promise.all([
      this.prisma.feature.findMany({
        where: { id: { in: featureIds }, deletedAt: null, module: { projectId } },
        select: {
          id: true,
          testDefinitions: { where: { deletedAt: null }, select: { type: true, steps: true, config: true } },
        },
      }),
      this.prisma.environment.findMany({
        where: { id: { in: envIds }, projectId, deletedAt: null, isActive: true },
        select: { id: true, supportsAutomation: true },
      }),
    ]);
    const featureById = new Map(features.map(f => [f.id, f]));
    const envById = new Map(envs.map(e => [e.id, e]));

    const problems: string[] = [];
    for (const s of stages) {
      const stageNo = s.order + 1;
      const feature = featureById.get(s.featureId);
      if (!feature) {
        problems.push(`Stage ${stageNo}: feature not found in this project`);
      } else if (!feature.testDefinitions.some(td => isTestDefinitionAutomatable(td))) {
        problems.push(`Stage ${stageNo}: feature has no automatable test (add steps or a SCRIPT test)`);
      }
      const env = envById.get(s.environmentId);
      if (!env) {
        problems.push(`Stage ${stageNo}: environment not found or inactive in this project`);
      } else if (!env.supportsAutomation) {
        problems.push(`Stage ${stageNo}: environment is not automation-enabled`);
      }
    }
    if (problems.length > 0) throw new BadRequestException(problems.join('; '));
  }

  private rethrowUniqueName(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException('A pipeline with this name already exists in the project');
    }
    throw err;
  }
}
