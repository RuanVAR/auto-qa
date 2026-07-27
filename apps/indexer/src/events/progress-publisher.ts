import Redis from 'ioredis';
import {
  type RepoIndexProgressEvent,
  type WorkerEventEnvelope,
  WORKER_EVENTS_CHANNEL,
} from '@qa-platform/shared';

export interface ProgressPublisher {
  publish(event: RepoIndexProgressEvent): Promise<void>;
  close(): Promise<void>;
}

export class RedisProgressPublisher implements ProgressPublisher {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 2,
    });
  }

  async connect(): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
  }

  async publish(event: RepoIndexProgressEvent): Promise<void> {
    const envelope: WorkerEventEnvelope<'repo:index-progress', RepoIndexProgressEvent> = {
      type: 'repo:index-progress',
      payload: event,
    };
    await this.redis.publish(WORKER_EVENTS_CHANNEL, JSON.stringify(envelope));
  }

  async ping(): Promise<void> {
    await this.redis.ping();
  }

  async close(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit();
  }
}
