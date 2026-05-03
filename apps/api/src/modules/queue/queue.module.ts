import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
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

@Global()
@Module({ providers: [RUN_QUEUE_PROVIDER, QueueService], exports: [QueueService] })
export class QueueModule {}
