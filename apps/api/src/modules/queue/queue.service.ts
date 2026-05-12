import { Injectable, Inject, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from './queue.constants';

export interface ExecuteRunJobData { runId: string; }
export interface GenerateReportPdfJobData {
  reportId: string;
  projectId: string;
  html: string;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  constructor(
    @Inject(QUEUE_NAMES.TEST_RUN) private readonly runQueue: Queue,
    @Inject(QUEUE_NAMES.REPORT_PDF) private readonly reportPdfQueue: Queue,
  ) {}

  async enqueueRun(data: ExecuteRunJobData) {
    const job = await this.runQueue.add(JOB_NAMES.EXECUTE_RUN, data, { jobId: `run-${data.runId}` });
    this.logger.log(`Enqueued run job ${job.id} for run ${data.runId}`);
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
