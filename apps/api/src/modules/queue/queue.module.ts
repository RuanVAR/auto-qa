import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { WorkerStatusController } from './worker.controller';
import { QUEUE_NAMES } from './queue.constants';
import { Queue } from 'bullmq';

const RUN_QUEUE_PROVIDER = {
  provide: QUEUE_NAMES.TEST_RUN,
  useFactory: (config: ConfigService) =>
    new Queue(QUEUE_NAMES.TEST_RUN, {
      connection: { url: config.get<string>('REDIS_URL') },
      defaultJobOptions: { removeOnComplete: { count: 500 }, removeOnFail: { count: 200 }, attempts: 2 },
    }),
  inject: [ConfigService],
};

const REPORT_PDF_QUEUE_PROVIDER = {
  provide: QUEUE_NAMES.REPORT_PDF,
  useFactory: (config: ConfigService) =>
    new Queue(QUEUE_NAMES.REPORT_PDF, {
      connection: { url: config.get<string>('REDIS_URL') },
      defaultJobOptions: { removeOnComplete: { count: 500 }, removeOnFail: { count: 200 }, attempts: 2 },
    }),
  inject: [ConfigService],
};

const CODE_INDEX_QUEUE_PROVIDER = {
  provide: QUEUE_NAMES.CODE_INDEX,
  useFactory: (config: ConfigService) =>
    new Queue(QUEUE_NAMES.CODE_INDEX, {
      connection: { url: config.get<string>('REDIS_URL') },
      defaultJobOptions: {
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    }),
  inject: [ConfigService],
};

@Global()
@Module({
  controllers: [WorkerStatusController],
  providers: [
    RUN_QUEUE_PROVIDER,
    REPORT_PDF_QUEUE_PROVIDER,
    CODE_INDEX_QUEUE_PROVIDER,
    QueueService,
  ],
  exports: [QueueService],
})
export class QueueModule {}
