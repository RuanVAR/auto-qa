import Redis from 'ioredis';

export class WorkerEventsService {
  private redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    this.redis = new Redis(redisUrl, { lazyConnect: true, enableOfflineQueue: false });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  async emitRunUpdated(payload: {
    id: string;
    status: string;
    projectId: string;
    featureRunId?: string | null;
    startedAt: Date | null;
    completedAt: Date | null;
    duration: number | null;
    errorMessage: string | null;
  }): Promise<void> {
    await this.redis.publish('worker:events', JSON.stringify({ type: 'run:updated', payload }));
  }

  /** Fired after a cancelled run has fully torn down its browser/context.
   *  The web UI uses this as the "safe to switch to manual" signal — receipt
   *  guarantees no Playwright process is still holding resources for this run. */
  async emitRunAbortCompleted(payload: {
    runId: string;
    projectId: string;
    featureRunId: string | null;
  }): Promise<void> {
    await this.redis.publish('worker:events', JSON.stringify({ type: 'run:abortCompleted', payload }));
  }

  async emitStepCompleted(payload: {
    runId: string;
    stepId: string;
    index: number;
    status: string;
    screenshotPath: string | null;
    duration: number | null;
    errorMessage: string | null;
  }): Promise<void> {
    await this.redis.publish('worker:events', JSON.stringify({ type: 'step:completed', payload }));
  }

  async emitStepFailed(payload: {
    runId: string;
    stepId: string;
    index: number;
    stepName: string;
    errorMessage: string | null;
  }): Promise<void> {
    await this.redis.publish('worker:events', JSON.stringify({ type: 'step:failed', payload }));
  }
}
