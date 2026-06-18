import { Worker, Job } from 'bullmq';
import { RunExecutor } from '../executors/run.executor';
import { getPrisma } from '../utils/prisma';

export interface RunJobData { runId: string; }

export function createWorker() {
  const executor = new RunExecutor(getPrisma());
  return new Worker<RunJobData>(
    'test-run',
    async (job: Job<RunJobData>) => {
      console.log(`[Worker] Executing run: ${job.data.runId}`);
      await executor.execute(job.data.runId);
    },
    {
      connection: { url: process.env.REDIS_URL! },
      concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '3', 10),
      // Stalled-job recovery (Phase 6e): if a worker dies mid-run, the job lock
      // expires after lockDuration and another worker re-picks it. BullMQ
      // auto-renews the lock while the processor is alive, so long browser runs
      // are safe. The executor's DB-claim guards against a stalled job being
      // re-run while the original is still alive (no duplicate execution).
      lockDuration: Number(process.env.WORKER_LOCK_DURATION_MS ?? 60_000),
      stalledInterval: Number(process.env.WORKER_STALLED_INTERVAL_MS ?? 30_000),
      maxStalledCount: Number(process.env.WORKER_MAX_STALLED ?? 2),
    },
  );
}
