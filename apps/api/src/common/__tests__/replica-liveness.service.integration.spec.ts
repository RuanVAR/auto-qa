import Redis from 'ioredis';
import { ReplicaLivenessService } from '../replica-liveness.service';

/** Integration test — real Redis, same convention as cron-lock's tests. */
describe('ReplicaLivenessService (integration)', () => {
  // Isolated key — the default key is shared with any real API instance
  // that might be heartbeating into the same dev Redis right now.
  const ZKEY = `test-api-replica-liveness-${Date.now()}`;
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://:qa_redis_password@localhost:6379');
  });

  afterAll(async () => {
    await redis.quit();
  });

  afterEach(async () => {
    await redis.del(ZKEY);
  });

  it('a lone instance heartbeats without warning', async () => {
    const svc = new ReplicaLivenessService();
    svc._setZkeyForTests(ZKEY);
    svc.onModuleInit();
    const warnSpy = jest.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    await svc.heartbeat();
    expect(warnSpy).not.toHaveBeenCalled();
    await svc.onModuleDestroy();
  });

  it('detects a second replica and logs a warning', async () => {
    const a = new ReplicaLivenessService();
    a._setZkeyForTests(ZKEY);
    const b = new ReplicaLivenessService();
    b._setZkeyForTests(ZKEY);
    a.onModuleInit();
    b.onModuleInit();
    const warnSpy = jest.spyOn((a as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    await a.heartbeat();
    await b.heartbeat();
    await a.heartbeat(); // a's second heartbeat now sees b too
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('2 API replicas detected'));
    await a.onModuleDestroy();
    await b.onModuleDestroy();
  });

  it('a departed replica (destroyed) drops out of the count', async () => {
    const a = new ReplicaLivenessService();
    a._setZkeyForTests(ZKEY);
    const b = new ReplicaLivenessService();
    b._setZkeyForTests(ZKEY);
    a.onModuleInit();
    b.onModuleInit();
    await a.heartbeat();
    await b.heartbeat();
    await b.onModuleDestroy(); // b leaves cleanly (ZREM)
    const warnSpy = jest.spyOn((a as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');
    await a.heartbeat();
    expect(warnSpy).not.toHaveBeenCalled();
    await a.onModuleDestroy();
  });
});
