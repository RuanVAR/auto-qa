import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from './queue.constants';

export interface ExecuteRunJobData { runId: string; }

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  constructor(@Inject(QUEUE_NAMES.TEST_RUN) private readonly runQueue: Queue) {}

  async enqueueRun(data: ExecuteRunJobData) {
    const job = await this.runQueue.add(JOB_NAMES.EXECUTE_RUN, data, { jobId: `run-${data.runId}` });
    this.logger.log(`Enqueued run job ${job.id} for run ${data.runId}`);
    return job;
  }

  async getQueueMetrics() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.runQueue.getWaitingCount(), this.runQueue.getActiveCount(),
      this.runQueue.getCompletedCount(), this.runQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }
}
