import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

const HEARTBEAT_TTL_SECONDS = 30;
const HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_ZKEY = 'api-replica-liveness';

/**
 * Startup/runtime assertion for docs/plan/06-PHASE-4-SCALE.md §4.6. Every
 * @Cron site now takes a CronLock, so double-firing shouldn't happen — but
 * that guarantee is only as good as every replica's Redis reachability.
 * This is the belt-and-braces check: it logs loudly the moment a second
 * replica is observed, so a locks-silently-failing-open scenario (e.g. every
 * replica losing its Redis connection at once) is visible in logs rather
 * than manifesting only as duplicate emails/pipeline ticks days later.
 *
 * Uses a sorted set keyed by expiry timestamp (not individual TTL'd keys) so
 * counting live replicas is an O(log N) ZCARD after trimming expired
 * members, not a KEYS/SCAN sweep of the whole keyspace on every heartbeat.
 */
@Injectable()
export class ReplicaLivenessService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReplicaLivenessService.name);
  private readonly instanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  private redis?: Redis;
  private timer?: NodeJS.Timeout;

  // Not a constructor param: Nest's DI reflects primitive constructor params
  // (string/number/boolean) as injectable tokens and throws
  // UnknownDependenciesException when nothing provides them, even with a
  // default value. Test-only override goes through this setter instead —
  // same convention as cron-lock.ts's _setCronLockRedisForTests.
  private zkey: string = DEFAULT_ZKEY;

  /** Test-only seam — isolate a test run from the shared production key. */
  _setZkeyForTests(key: string): void {
    this.zkey = key;
  }

  onModuleInit(): void {
    const url = process.env.REDIS_URL ?? 'redis://redis:6379';
    this.redis = new Redis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 1 });
    this.redis.on('error', (err) => this.logger.warn(`Redis error in replica liveness check: ${err.message}`));
    void this.heartbeat();
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.redis?.zrem(this.zkey, this.instanceId).catch(() => undefined);
    await this.redis?.quit().catch(() => undefined);
  }

  async heartbeat(): Promise<void> {
    if (!this.redis) return;
    try {
      const now = Date.now();
      await this.redis.zadd(this.zkey, now + HEARTBEAT_TTL_SECONDS * 1000, this.instanceId);
      await this.redis.zremrangebyscore(this.zkey, 0, now); // drop replicas that stopped heartbeating
      const count = await this.redis.zcard(this.zkey);
      if (count > 1) {
        this.logger.warn(
          `${count} API replicas detected (this instance: ${this.instanceId}). ` +
            'Scheduled work correctness under N>1 depends on CronLock — verify Redis is reachable from every replica.',
        );
      }
    } catch (err) {
      this.logger.warn(`Replica liveness heartbeat failed: ${(err as Error).message}`);
    }
  }
}
