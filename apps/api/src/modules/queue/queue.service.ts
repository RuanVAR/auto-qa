import { Injectable, Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from './queue.constants';

export interface ExecuteRunJobData { runId: string; }
export interface GenerateReportPdfJobData {
  reportId: string;
  projectId: string;
  html: string;
  /** Ad-hoc renders (sign-off certificate) skip the GeneratedReport update. */
  skipDbUpdate?: boolean;
}

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  constructor(
    @Inject(QUEUE_NAMES.TEST_RUN) private readonly runQueue: Queue,
    @Inject(QUEUE_NAMES.REPORT_PDF) private readonly reportPdfQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Close the producer queues (and their Redis connections) on shutdown so a
   * deploy/scale-down releases connections cleanly instead of leaking them.
   * Fired by Nest because main.ts calls app.enableShutdownHooks().
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log(`Closing BullMQ queues${signal ? ` (${signal})` : ''}…`);
    await Promise.allSettled([this.runQueue.close(), this.reportPdfQueue.close()]);
  }

  async enqueueRun(data: ExecuteRunJobData) {
    const job = await this.runQueue.add(JOB_NAMES.EXECUTE_RUN, data, { jobId: `run-${data.runId}` });
    this.logger.log(`Enqueued run job ${job.id} for run ${data.runId}`);
    // Make the QUEUED status real. The run was created PENDING; now that it's
    // actually sitting in BullMQ waiting for a worker slot, reflect that — the
    // worker flips it to RUNNING the instant it starts executing. This gives
    // the dashboard a true PENDING → QUEUED → RUNNING lifecycle (the UI already
    // renders QUEUED in badges + the worker queue chip). Guarded to PENDING so
    // a re-enqueue of an already-RUNNING run (resume / retry) can't regress it.
    // Best-effort — the job is already queued, status is cosmetic-but-honest.
    await this.prisma.testRun.updateMany({
      where: { id: data.runId, status: RunStatus.PENDING },
      data: { status: RunStatus.QUEUED },
    }).catch((err) => {
      this.logger.warn(`Could not mark run ${data.runId} QUEUED: ${(err as Error).message}`);
    });
    return job;
  }

  async enqueueReportPdf(data: GenerateReportPdfJobData) {
    const job = await this.reportPdfQueue.add(
      JOB_NAMES.GENERATE_REPORT_PDF,
      data,
      { jobId: `report-pdf-${data.reportId}` },
    );
    this.logger.log(`Enqueued PDF job ${job.id} for report ${data.reportId}`);
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
