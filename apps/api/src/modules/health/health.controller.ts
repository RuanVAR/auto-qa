import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { Public } from '../../common/decorators/public.decorator';

type Check = { ok: boolean; error?: string };

/**
 * Liveness vs readiness split (no extra deps — reuses Prisma + the BullMQ
 * Redis connection):
 *   - GET /live  → process is up. Cheap, dependency-free. Liveness probe.
 *   - GET /ready → can we actually serve? DB + Redis reachable. Returns **503**
 *     (not 200) when a dependency is down so LBs / orchestrators route away and
 *     auto-recover — the previous /health returned 200 even with the DB down.
 *   - GET /health → kept as a readiness alias (the deploy script + monitors poll
 *     it; it now 503s on failure too).
 *
 * Health endpoints must skip BOTH named throttler buckets — `@SkipThrottle()`
 * with no args only skips the unnamed default, so the deploy script's
 * poll-every-3s burst was tripping the `auth: 10/min` bucket and 429ing.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle({ global: true, auth: true })
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness — process is up (no dependency checks)' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — DB + Redis reachable (503 if not)' })
  async ready() {
    const checks = await this.runChecks();
    const body = { status: Object.values(checks).every((c) => c.ok) ? 'ok' : 'error', checks, timestamp: new Date().toISOString() };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }

  /** Back-compat readiness alias — the deploy script / docker healthcheck poll
   *  /health. Now returns 503 on a failed dependency instead of 200 + error. */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Readiness alias of /ready (back-compat)' })
  async check() {
    return this.ready();
  }

  private async runChecks(): Promise<{ db: Check; redis: Check }> {
    const db: Check = await this.prisma.$queryRaw`SELECT 1`
      .then(() => ({ ok: true }))
      .catch((e: unknown) => ({ ok: false, error: (e as Error)?.message }));
    const redis: Check = await this.queue.pingRedis()
      .then(() => ({ ok: true }))
      .catch((e: unknown) => ({ ok: false, error: (e as Error)?.message }));
    return { db, redis };
  }
}
