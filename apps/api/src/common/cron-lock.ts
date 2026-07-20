import Redis from 'ioredis';

/**
 * Redis-backed advisory lock for scheduled work (docs/plan/06-PHASE-4-SCALE.md §4.6).
 *
 * Every @Cron in this codebase assumes it is the only API instance — true
 * today (single replica) but silently wrong the moment a second one starts:
 * scheduled reports send twice, pipeline ticks race, stuck-run sweeps
 * double-fire. This makes that assumption explicit and enforced instead of
 * tribal knowledge, using `SET key value NX PX ttl` as the mutual-exclusion
 * primitive — the same counter-via-Redis pattern already used in
 * ai-quota.guard.ts, just for exclusion instead of counting.
 *
 * Lock acquisition failing OPEN on a Redis error (proceeds unlocked) is
 * deliberate: a Redis blip silently halting every scheduled report/pipeline
 * tick/stuck-run sweep is worse than the rare double-fire this guards
 * against, and only matters at all once a second replica exists.
 */

let redis: Redis = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
  lazyConnect: true,
  // Fail fast rather than hang: correctness under a Redis outage is "proceed
  // unlocked" (see CronLock below), so a slow reconnect loop here would just
  // delay every scheduled job — and would otherwise stall any unit test that
  // exercises a @CronLock-wrapped method without Redis running.
  connectTimeout: 2000,
  maxRetriesPerRequest: 1,
});
redis.on('error', (err) => {
  console.warn(`[CronLock] Redis connection error: ${err.message}`);
});

/** Test-only seam — swap the module's Redis client for an isolated one. */
export function _setCronLockRedisForTests(client: Redis): void {
  redis = client;
}

const RELEASE_SCRIPT =
  'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end';

/**
 * Attempt to acquire `name` for `ttlSeconds`. Returns a release token on
 * success, or null if another holder already has it (or Redis is down —
 * callers treat null-on-error as "proceed unlocked", see CronLock below).
 */
export async function acquireCronLock(
  name: string,
  ttlSeconds: number,
): Promise<{ release: () => Promise<void> } | null> {
  const key = `cron-lock:${name}`;
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const result = await redis.set(key, token, 'PX', ttlSeconds * 1000, 'NX');
  if (result !== 'OK') return null;
  return {
    // CAS delete: only clear the lock if we still hold it, so a tick that
    // outlives its TTL can't delete a different replica's fresh lock.
    release: () => redis.eval(RELEASE_SCRIPT, 1, key, token).then(() => undefined),
  };
}

/**
 * Method decorator: wraps a @Cron-decorated method so at most one API
 * replica executes a given tick. Skips (does not throw) when another
 * replica already holds the lock — this is the expected, silent case under
 * N>1 replicas, not an error.
 */
export function CronLock(name: string, opts: { ttl: number }) {
  return (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor => {
    const original = descriptor.value as (...args: unknown[]) => Promise<unknown>;
    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      let lock: { release: () => Promise<void> } | null;
      try {
        lock = await acquireCronLock(name, opts.ttl);
      } catch (err) {
        console.warn(`[CronLock:${name}] Redis error acquiring lock — proceeding unlocked: ${(err as Error).message}`);
        return original.apply(this, args);
      }
      if (lock === null) return; // another replica holds it this tick — expected under N>1, not an error
      try {
        return await original.apply(this, args);
      } finally {
        await lock.release().catch(() => undefined);
      }
    };
    return descriptor;
  };
}
