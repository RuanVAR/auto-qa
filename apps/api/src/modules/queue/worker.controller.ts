import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { QueueService } from './queue.service';

/**
 * WorkerStatusController
 * ----------------------
 * Lightweight health/visibility endpoint for the BullMQ test-run queue.
 * Surfaces live counts so the web app can show a "● 2/3 running · 4 queued"
 * chip in the topbar — letting QA know whether their next trigger will run
 * immediately or sit in the queue.
 *
 * SkipThrottle: the topbar polls this once every 5s and shouldn't be subject
 * to the global per-IP rate limit. It's read-only and very cheap (four
 * BullMQ XLEN-style Redis ops).
 */
@ApiTags('worker') @ApiBearerAuth() @Controller('worker')
export class WorkerStatusController {
  constructor(private readonly queueService: QueueService) {}

  @Get('status') @SkipThrottle()
  @ApiOperation({ summary: 'BullMQ run queue stats + worker concurrency' })
  async status() {
    const metrics = await this.queueService.getQueueMetrics();
    // Concurrency is baked into the worker image at boot via WORKER_CONCURRENCY.
    // Surfacing it here lets the UI show "2 / 3 running" without baking the
    // limit into the frontend. Default mirrors apps/worker/src/queue/run.worker.ts.
    const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? '3', 10);
    return {
      // In-flight jobs the worker is actively executing right now.
      active: metrics.active,
      // Jobs sitting in Redis waiting for a slot.
      waiting: metrics.waiting,
      // Lifetime totals (BullMQ trims them via removeOnComplete/Fail = 500/200).
      completed: metrics.completed,
      failed: metrics.failed,
      // Concurrency budget for the UI chip.
      concurrency,
    };
  }
}
