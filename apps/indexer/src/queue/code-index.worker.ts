import {
  CODE_INDEX_JOB,
  CODE_INDEX_QUEUE,
  type CodeIndexJobData,
} from '@qa-platform/shared';
import { Job, Worker } from 'bullmq';

export interface CodeIndexProcessor {
  process(job: CodeIndexJobData): Promise<unknown>;
}

export function createCodeIndexWorker(
  redisUrl: string,
  processor: CodeIndexProcessor,
  concurrency: number,
  jobsPerMinute = 4,
): Worker<CodeIndexJobData> {
  return new Worker<CodeIndexJobData>(
    CODE_INDEX_QUEUE,
    async (job: Job<CodeIndexJobData>) => {
      if (job.name !== CODE_INDEX_JOB) {
        throw new Error(`Unsupported code-index job name: ${job.name}`);
      }
      return processor.process(job.data);
    },
    {
      connection: { url: redisUrl },
      concurrency,
      limiter: {
        max: jobsPerMinute,
        duration: 60_000,
      },
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    },
  );
}
