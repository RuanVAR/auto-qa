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
    { connection: { url: process.env.REDIS_URL! }, concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '3', 10) },
  );
}
