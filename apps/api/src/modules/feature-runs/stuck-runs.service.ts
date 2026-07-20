import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronLock } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

// ─── StuckRunsService ────────────────────────────────────────────────────────
// Cleans up FeatureRuns that are stuck in RUNNING/PAUSED with no recent
// heartbeat. Typical causes:
//   • Worker crashed / machine rebooted mid-run
//   • User closed the browser tab during a manual session without stopping
//   • Socket disconnect + no reconnect within grace period
//
// Without this, the UI permanently shows a "Testing mode is active" banner
// for the affected feature because activeRun stays non-null forever.

// Cleanup is split by run mode:
//
// AUTOMATED runs (worker-driven) are reaped fast — a hung run means a dead
// worker, and we don't want a zombie sitting "running" for a day:
//   • PAUSE_AFTER_MS  of no heartbeat → RUNNING → PAUSED (recoverable)
//   • CANCEL_AFTER_MS of no heartbeat → RUNNING/PAUSED → CANCELLED
//
// MANUAL test sessions/runs are human-driven and long-lived. While the tab is
// open the keep-alive heartbeat (pill + TestingView) keeps lastHeartbeatAt
// fresh, so an actively-used session NEVER trips this. Only a session whose tab
// was closed / abandoned for a full day crosses the line — and then we
// gracefully AUTO-FINISH it (status COMPLETED + endedAt + duration), preserving
// every verdict the tester already recorded. Resuming a paused run bumps the
// heartbeat, so the 24h window restarts on resume.
const PAUSE_AFTER_MS  = 15 * 60 * 1000;        // automated: 15 min idle → PAUSED
const CANCEL_AFTER_MS = 60 * 60 * 1000;        // automated: 1 hour idle → CANCELLED
const MANUAL_IDLE_MS  = 24 * 60 * 60 * 1000;   // manual: 24 h idle → auto-finish

@Injectable()
export class StuckRunsService {
  private readonly logger = new Logger(StuckRunsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  /**
   * Find any RUNNING/PAUSED FeatureRuns whose lastHeartbeatAt is older than the
   * threshold (or null + createdAt older) and mark them CANCELLED. Untouched /
   * never-run child TestRuns (PENDING/QUEUED) become NOT_TESTED so the test
   * keeps its prior status on the list (a tester who walked away never
   * evaluated them — not an error); only genuinely-executing (RUNNING) TestRuns
   * become ERROR.
   *
   * This job is idempotent — safe to run multiple times, and if no stuck
   * runs exist it's a no-op single query against a newly-indexed column
   * (feature_runs_status_lastHeartbeatAt_idx).
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'stuck-runs-cleanup' })
  @CronLock('stuck-runs-cleanup', { ttl: 600 })
  async sweepStuckRuns(): Promise<void> {
    // Heal severed automated chains BEFORE the pause/cancel stages get a
    // chance to give up on them.
    await this.resumeSeveredAutomatedRuns();

    // Reap orphan SOLO runs first — this must run regardless of whether any
    // FeatureRuns are stuck (the feature-run sweep below early-returns when
    // it finds nothing).
    await this.sweepOrphanSoloRuns();

    // Abandon named test-run sessions the tester walked away from.
    await this.sweepStaleSessions();

    const now = Date.now();
    const pauseThreshold  = new Date(now - PAUSE_AFTER_MS);
    const cancelThreshold = new Date(now - CANCEL_AFTER_MS);

    // ── Stage 1: AUTOMATED RUNNING runs idle ≥ 15 min → PAUSED ──────────
    // Automated only — manual runs are kept alive by the keep-alive heartbeat
    // and only ended by the 24h sweep below.
    const toPause = await this.prisma.featureRun.findMany({
      where: {
        status: 'RUNNING',
        runMode: 'AUTOMATED',
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

    // ── Stage 2: AUTOMATED still idle ≥ 1 hour → CANCELLED ──────────────
    const stuck = await this.prisma.featureRun.findMany({
      where: {
        status: { in: ['RUNNING', 'PAUSED'] },
        runMode: 'AUTOMATED',
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

    // Writes in a transaction so stats stay consistent:
    //   1. FeatureRuns → CANCELLED
    //   2. Untouched / never-run child TestRuns (PENDING/QUEUED) → NOT_TESTED.
    //      A tester who abandoned a manual session never evaluated these, and an
    //      automated test never picked up was never run — neither is an error.
    //      NOT_TESTED is excluded from "latest status", so the test KEEPS its
    //      prior status on the list (mirrors a clean session stop).
    //   3. Only TestRuns genuinely mid-execution (RUNNING) → ERROR.
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
          status: { in: ['PENDING', 'QUEUED'] },
        },
        data: {
          status: 'NOT_TESTED',
          completedAt,
        },
      }),
      this.prisma.testRun.updateMany({
        where: {
          featureRunId: { in: ids },
          status: 'RUNNING',
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
   * Re-enqueue automated FeatureRuns whose TestRun chain was severed. The
   * chain is API-driven (worker → Redis terminal event → onRunComplete →
   * enqueue next PENDING), so an API restart mid-run loses the event and the
   * run hangs: no child QUEUED/RUNNING, some still PENDING. Without this it
   * sits until the idle-pause (15m) + cancel (60m) reapers give up on work
   * that is perfectly resumable. Enqueue is jobId-deduped, so racing a live
   * enqueue is harmless; the 3-min idle guard avoids racing a healthy worker.
   */
  async resumeSeveredAutomatedRuns(): Promise<void> {
    const idleThreshold = new Date(Date.now() - 3 * 60 * 1000);
    const severed = await this.prisma.featureRun.findMany({
      where: {
        runMode: 'AUTOMATED',
        status: { in: ['RUNNING', 'PAUSED'] },
        updatedAt: { lt: idleThreshold },
        testRuns: {
          none: { status: { in: ['QUEUED', 'RUNNING'] } },
          some: { status: 'PENDING' },
        },
      },
      select: {
        id: true,
        status: true,
        testRuns: {
          where: { status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    for (const run of severed) {
      const next = run.testRuns[0];
      if (!next) continue;
      if (run.status === 'PAUSED') {
        // Idle-paused by the reaper while actually resumable — wake it.
        await this.prisma.featureRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } });
      }
      await this.queue.enqueueRun({ runId: next.id });
      this.logger.warn(`Resumed severed automated run ${run.id} — re-enqueued test ${next.id}`);
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
   * Auto-finish named test-run sessions left ACTIVE with no heartbeat for 24h —
   * the tester closed the tab / never came back. The keep-alive heartbeat (pill
   * + TestingView) keeps live sessions fresh, so only genuinely-idle ones cross
   * the line. We END them gracefully — status COMPLETED + endedAt + duration,
   * preserving every verdict already recorded — rather than abandoning, so the
   * run shows up with its results in the Test Runs table. Any still-open feature
   * runs under the session are closed (COMPLETE) and their unmarked tests fall
   * to NOT_TESTED (a manual test that was never marked was simply not tested).
   */
  async sweepStaleSessions(): Promise<void> {
    const threshold = new Date(Date.now() - MANUAL_IDLE_MS);
    const stale = await this.prisma.testRunSession.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { lastHeartbeatAt: { lt: threshold } },
          { AND: [{ lastHeartbeatAt: null }, { startedAt: { lt: threshold } }] },
        ],
      },
      select: {
        id: true,
        startedAt: true,
        featureRuns: { where: { status: { in: ['RUNNING', 'PAUSED'] } }, select: { id: true } },
      },
    });
    if (stale.length === 0) return;
    const now = new Date();
    for (const s of stale) {
      const frIds = s.featureRuns.map((r) => r.id);
      await this.prisma.$transaction([
        this.prisma.testRunSession.update({
          where: { id: s.id },
          data: {
            status: 'COMPLETED',
            endedAt: now,
            duration: now.getTime() - s.startedAt.getTime(),
            summary: 'Auto-ended after 24h of inactivity — results preserved.',
          },
        }),
        ...(frIds.length
          ? [
              this.prisma.featureRun.updateMany({ where: { id: { in: frIds } }, data: { status: 'COMPLETE', completedAt: now } }),
              this.prisma.testRun.updateMany({
                where: { featureRunId: { in: frIds }, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } },
                data: { status: 'NOT_TESTED', completedAt: now },
              }),
            ]
          : []),
      ]);
    }
    this.logger.warn(`Auto-finished ${stale.length} idle test-run session(s) after 24h.`);

    // Solo MANUAL feature runs (no parent session) idle ≥ 24h → CANCELLED.
    // These aren't covered by the session sweep above; without this they'd
    // linger forever now that the fast automated stages skip manual runs.
    const staleManual = await this.prisma.featureRun.findMany({
      where: {
        runMode: 'MANUAL',
        status: { in: ['RUNNING', 'PAUSED'] },
        testRunSessionId: null,
        OR: [
          { lastHeartbeatAt: { lt: threshold } },
          { AND: [{ lastHeartbeatAt: null }, { createdAt: { lt: threshold } }] },
        ],
      },
      select: { id: true },
    });
    if (staleManual.length > 0) {
      const ids = staleManual.map((r) => r.id);
      await this.prisma.$transaction([
        this.prisma.featureRun.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED', completedAt: now } }),
        this.prisma.testRun.updateMany({
          where: { featureRunId: { in: ids }, status: { in: ['PENDING', 'QUEUED', 'RUNNING'] } },
          data: { status: 'NOT_TESTED', completedAt: now },
        }),
      ]);
      this.logger.warn(`Cancelled ${staleManual.length} idle solo manual feature run(s) after 24h.`);
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
