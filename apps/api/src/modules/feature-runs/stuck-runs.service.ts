import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';

// ─── StuckRunsService ────────────────────────────────────────────────────────
// Cleans up FeatureRuns that are stuck in RUNNING/PAUSED with no recent
// heartbeat. Typical causes:
//   • Worker crashed / machine rebooted mid-run
//   • User closed the browser tab during a manual session without stopping
//   • Socket disconnect + no reconnect within grace period
//
// Without this, the UI permanently shows a "Testing mode is active" banner
// for the affected feature because activeRun stays non-null forever.

// Two-stage decay so a tester who walks away for lunch isn't punished
// the same as one who closed the tab and never came back:
//   • At PAUSE_AFTER_MS of no heartbeat → flip RUNNING to PAUSED. Recoverable.
//   • At CANCEL_AFTER_MS of no heartbeat → flip PAUSED/RUNNING to CANCELLED.
const PAUSE_AFTER_MS  = 15 * 60 * 1000;       // 15 minutes idle → PAUSED
const CANCEL_AFTER_MS = 60 * 60 * 1000;       // 1 hour idle → CANCELLED
const STALE_HEARTBEAT_THRESHOLD_MS = CANCEL_AFTER_MS; // legacy alias for the cron name

@Injectable()
export class StuckRunsService {
  private readonly logger = new Logger(StuckRunsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every hour at :05 past the hour, find any RUNNING/PAUSED FeatureRuns whose
   * lastHeartbeatAt is older than the threshold (or null + createdAt older)
   * and mark them CANCELLED. Their TestRuns that are still RUNNING get marked
   * ERROR so stats roll up consistently.
   *
   * This job is idempotent — safe to run multiple times, and if no stuck
   * runs exist it's a no-op single query against a newly-indexed column
   * (feature_runs_status_lastHeartbeatAt_idx).
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'stuck-runs-cleanup' })
  async sweepStuckRuns(): Promise<void> {
    // Reap orphan SOLO runs first — this must run regardless of whether any
    // FeatureRuns are stuck (the feature-run sweep below early-returns when
    // it finds nothing).
    await this.sweepOrphanSoloRuns();

    const now = Date.now();
    const pauseThreshold  = new Date(now - PAUSE_AFTER_MS);
    const cancelThreshold = new Date(now - CANCEL_AFTER_MS);

    // ── Stage 1: RUNNING runs idle ≥ 15 min → PAUSED ────────────────────
    // Doesn't kill child TestRuns — the user can still come back, hit
    // heartbeat (or just mark a step), and the run resumes cleanly.
    const toPause = await this.prisma.featureRun.findMany({
      where: {
        status: 'RUNNING',
        OR: [
          { lastHeartbeatAt: { lt: pauseThreshold } },
          { AND: [{ lastHeartbeatAt: null }, { createdAt: { lt: pauseThreshold } }] },
        ],
      },
      select: { id: true, featureId: true },
    });
    if (toPause.length > 0) {
      await this.prisma.featureRun.updateMany({
        where: { id: { in: toPause.map(r => r.id) } },
        data: { status: 'PAUSED' },
      });
      this.logger.log(`Idle-paused ${toPause.length} feature run(s).`);
    }

    // ── Stage 2: still idle ≥ 1 hour → CANCELLED ────────────────────────
    const stuck = await this.prisma.featureRun.findMany({
      where: {
        status: { in: ['RUNNING', 'PAUSED'] },
        OR: [
          { lastHeartbeatAt: { lt: cancelThreshold } },
          { AND: [{ lastHeartbeatAt: null }, { createdAt: { lt: cancelThreshold } }] },
        ],
      },
      select: { id: true, featureId: true, createdAt: true, lastHeartbeatAt: true },
    });

    if (stuck.length === 0) {
      // Nothing to do — emit a quiet debug log, not info, to avoid log spam.
      this.logger.debug('No stuck feature runs found.');
      return;
    }

    this.logger.warn(`Found ${stuck.length} stuck feature run(s) — cancelling.`);

    const ids = stuck.map((r) => r.id);
    const completedAt = new Date();

    // Two writes in a transaction so stats stay consistent:
    //   1. FeatureRuns → status=CANCELLED
    //   2. Their child TestRuns still RUNNING → status=ERROR
    await this.prisma.$transaction([
      this.prisma.featureRun.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'CANCELLED',
          completedAt,
        },
      }),
      this.prisma.testRun.updateMany({
        where: {
          featureRunId: { in: ids },
          status: { in: ['PENDING', 'RUNNING'] },
        },
        data: {
          status: 'ERROR',
          errorMessage: 'Parent feature run cancelled by stuck-run cleanup job',
          completedAt,
        },
      }),
    ]);

    for (const r of stuck) {
      this.logger.warn(
        `Cancelled FeatureRun ${r.id} (feature ${r.featureId}) — lastHeartbeatAt=${r.lastHeartbeatAt?.toISOString() ?? 'never'}`,
      );
    }
  }

  /**
   * Reap orphaned SOLO TestRuns — those with no parent FeatureRun (single
   * automated runs + previews). The feature-run sweep only covers TestRuns
   * UNDER a FeatureRun; a solo run whose worker crashed (or that the worker
   * never picked up) would otherwise sit RUNNING / PENDING forever with no
   * reaper, leaving the run badge spinning indefinitely.
   *
   * The worker self-enforces RUN_TIMEOUT_MS while it IS executing, so this is
   * purely the backstop for crashes / never-started jobs — hence a generous
   * threshold kept ≥ 2× the worker's own run timeout so we never race a run
   * the worker is still legitimately driving.
   */
  async sweepOrphanSoloRuns(): Promise<void> {
    const runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS) || 300_000;
    const staleMs = Math.max(15 * 60 * 1000, runTimeoutMs * 2);
    const threshold = new Date(Date.now() - staleMs);
    const completedAt = new Date();

    // RUNNING, no parent, started long ago → the worker crashed past its own
    // timeout (a healthy worker would have self-reported TIMED_OUT already).
    const timedOut = await this.prisma.testRun.updateMany({
      where: {
        featureRunId: null,
        status: 'RUNNING',
        startedAt: { lt: threshold },
      },
      data: {
        status: 'TIMED_OUT',
        completedAt,
        errorMessage: 'Run abandoned — worker stopped reporting (reaped by stuck-run cleanup).',
      },
    });

    // PENDING / QUEUED, no parent, created long ago → the worker never picked
    // it up (queue or worker outage). It never executed → ERROR.
    const errored = await this.prisma.testRun.updateMany({
      where: {
        featureRunId: null,
        status: { in: ['PENDING', 'QUEUED'] },
        createdAt: { lt: threshold },
      },
      data: {
        status: 'ERROR',
        completedAt,
        errorMessage: 'Run was never started by a worker (reaped by stuck-run cleanup).',
      },
    });

    const total = timedOut.count + errored.count;
    if (total > 0) {
      this.logger.warn(
        `Reaped ${total} orphan solo run(s): ${timedOut.count} timed-out, ${errored.count} never-started.`,
      );
    }
  }

  /**
   * Manually triggered version — same logic, exposed so admins can invoke
   * cleanup on demand (e.g. from the Admin panel) without waiting for the cron.
   * Returns the count cleaned up.
   */
  async runOnce(): Promise<{ cleaned: number }> {
    const before = await this.prisma.featureRun.count({
      where: { status: { in: ['RUNNING', 'PAUSED'] } },
    });
    await this.sweepStuckRuns();
    const after = await this.prisma.featureRun.count({
      where: { status: { in: ['RUNNING', 'PAUSED'] } },
    });
    return { cleaned: Math.max(0, before - after) };
  }
}
