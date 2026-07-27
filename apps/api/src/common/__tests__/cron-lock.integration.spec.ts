import Redis from 'ioredis';
import { acquireCronLock, CronLock, _setCronLockRedisForTests } from '../cron-lock';

/**
 * Integration tests — real Redis (per project convention: races are not
 * mockable). Requires the dev Redis container (`docker-compose up redis`);
 * uses the same REDIS_URL the API containers use, reachable from the host
 * via the `6379:6379` port mapping.
 */
describe('cron-lock (integration)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://:qa_redis_password@localhost:6379');
    _setCronLockRedisForTests(redis);
  });

  afterAll(async () => {
    await redis.quit();
    _setCronLockRedisForTests(null);
  });

  const uniqueName = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  it('grants the lock to exactly one of two concurrent acquirers', async () => {
    const name = uniqueName();
    const [a, b] = await Promise.all([acquireCronLock(name, 30), acquireCronLock(name, 30)]);
    const acquired = [a, b].filter((x) => x !== null);
    expect(acquired).toHaveLength(1);
    await acquired[0]!.release();
  });

  it('allows re-acquisition after release', async () => {
    const name = uniqueName();
    const first = await acquireCronLock(name, 30);
    expect(first).not.toBeNull();
    await first!.release();
    const second = await acquireCronLock(name, 30);
    expect(second).not.toBeNull();
    await second!.release();
  });

  it('allows re-acquisition after TTL expiry without an explicit release', async () => {
    const name = uniqueName();
    const first = await acquireCronLock(name, 1); // 1s TTL
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1200));
    const second = await acquireCronLock(name, 30);
    expect(second).not.toBeNull();
    await second!.release();
  });

  it("release is a CAS — does not delete another holder's lock acquired after our TTL expired", async () => {
    const name = uniqueName();
    const first = await acquireCronLock(name, 1);
    expect(first).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1200)); // let it expire
    const second = await acquireCronLock(name, 30); // a different "replica" claims it
    expect(second).not.toBeNull();
    await first!.release(); // stale release from the first holder — must be a no-op
    const stillHeld = await acquireCronLock(name, 30);
    expect(stillHeld).toBeNull(); // second's lock must still be intact
    await second!.release();
  });

  describe('CronLock decorator', () => {
    const lockName = uniqueName();
    class Job {
      calls = 0;
      @CronLock(lockName, { ttl: 30 })
      async run(): Promise<void> {
        this.calls++;
      }
    }

    it('runs the wrapped method exactly once when called concurrently by two instances', async () => {
      const a = new Job();
      const b = new Job();
      await Promise.all([a.run(), b.run()]);
      expect(a.calls + b.calls).toBe(1);
    });
  });
});
