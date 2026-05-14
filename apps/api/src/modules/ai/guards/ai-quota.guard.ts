import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../../../common/prisma/prisma.service';

const MAX_CONCURRENT_PER_ORG = 3;
const CONCURRENCY_TTL_SECONDS = 300; // 5 min — covers the longest expected generation
const DEFAULT_RATE_LIMIT_PER_USER_PER_HOUR = 20;

export interface QuotaCheckOk {
  ok: true;
  /** Returned monthly spend in USD — UI uses this to render the budget bar */
  currentSpendUsd: number;
  /** Effective cap (USD) — comes from the org credential or platform default */
  capUsd: number;
  /** 0–100 — what fraction of the cap has been consumed this month */
  percentageUsed: number;
  /** Set when 80–99% — UI shows a banner */
  warning?: string;
  /** Concurrency slot acquired — caller MUST call `release()` when done */
  release: () => Promise<void>;
}

/**
 * Enforces three orthogonal limits before every generation call:
 *
 *   1. Monthly cap — SUM(AISummary.costUsd) for the org this calendar month
 *      must stay below OrgAiCredential.monthlyCapUsd
 *   2. Concurrency — at most 3 in-flight generations per org
 *   3. Per-user rate — token bucket per user (default 20/hour)
 *
 * The guard is a regular service rather than a Nest guard because it needs
 * to know the generation purpose (g1/g2/g3) to estimate pre-flight cost,
 * which is only available inside the service method. Routes call
 * `quota.assert(orgId, userId)` at the top of each generation path.
 */
@Injectable()
export class AiQuotaGuard implements OnModuleDestroy {
  private readonly logger = new Logger(AiQuotaGuard.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const url = config.get<string>('REDIS_URL') ?? 'redis://redis:6379';
    this.redis = new Redis(url, { lazyConnect: false });
    this.redis.on('error', (err) => {
      // Don't crash on connection blips — assert() handles transient failures
      this.logger.warn(`Redis connection error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  async assert(orgId: string, userId: string): Promise<QuotaCheckOk> {
    const credential = await this.prisma.orgAiCredential.findUnique({ where: { orgId } });

    const capUsd = credential
      ? Number(credential.monthlyCapUsd)
      : Number(this.config.get<string>('AI_DEFAULT_MONTHLY_CAP_USD') ?? '50');
    const userRateLimit =
      credential?.rateLimitPerUserPerHour ?? DEFAULT_RATE_LIMIT_PER_USER_PER_HOUR;

    // ── 1. Monthly cap (calendar-month — first-of-month rollover) ────────────
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const agg = await this.prisma.aISummary.aggregate({
      where: { orgId, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    });
    const currentSpendUsd = Number(agg._sum.costUsd ?? 0);
    const percentageUsed = capUsd > 0 ? Math.round((currentSpendUsd / capUsd) * 100) : 0;

    if (currentSpendUsd >= capUsd) {
      const nextMonth = new Date(monthStart);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const retryAfter = Math.max(1, Math.floor((nextMonth.getTime() - Date.now()) / 1000));
      throw new HttpException(
        {
          error: 'AI_BUDGET_EXCEEDED',
          currentSpendUsd,
          capUsd,
          percentageUsed: 100,
          retryAfterSeconds: retryAfter,
          message: `Monthly AI budget of $${capUsd.toFixed(2)} is exhausted. Resets on ${nextMonth.toISOString().slice(0, 10)}.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 2. Per-user hourly rate (token bucket via Redis INCR + EXPIRE) ───────
    const userKey = `ai:user-rate:${userId}:${this.currentHourBucket()}`;
    const count = await this.redis.incr(userKey);
    if (count === 1) {
      await this.redis.expire(userKey, 3600);
    }
    if (count > userRateLimit) {
      throw new HttpException(
        {
          error: 'AI_RATE_LIMIT_PER_USER',
          limit: userRateLimit,
          windowSeconds: 3600,
          retryAfterSeconds: 3600 - (Date.now() % 3_600_000) / 1000,
          message: `You've used ${count - 1}/${userRateLimit} AI calls this hour. Try again later.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // ── 3. Concurrency — Redis counter with safety TTL ───────────────────────
    const concurrencyKey = `ai:concurrent:${orgId}`;
    const concurrent = await this.redis.incr(concurrencyKey);
    if (concurrent === 1) {
      await this.redis.expire(concurrencyKey, CONCURRENCY_TTL_SECONDS);
    }
    if (concurrent > MAX_CONCURRENT_PER_ORG) {
      // Roll back our increment so the slot stays accurate
      await this.redis.decr(concurrencyKey).catch(() => undefined);
      throw new HttpException(
        {
          error: 'AI_CONCURRENCY_LIMIT',
          limit: MAX_CONCURRENT_PER_ORG,
          message: `${MAX_CONCURRENT_PER_ORG} AI generations are already running for this org. Wait for one to finish.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const warning =
      percentageUsed >= 80 && percentageUsed < 100
        ? `${percentageUsed}% of monthly AI budget used`
        : undefined;

    return {
      ok: true,
      currentSpendUsd,
      capUsd,
      percentageUsed,
      warning,
      release: async () => {
        await this.redis.decr(concurrencyKey).catch(() => undefined);
      },
    };
  }

  private currentHourBucket(): string {
    return new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
  }
}
