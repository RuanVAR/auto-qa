import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export const PLATFORM_LOGO_KEY = 'PLATFORM_LOGO_URL';
export const PLATFORM_NAME_KEY = 'PLATFORM_APP_NAME';

export interface PlatformBranding {
  logoUrl: string | null;
  appName: string | null;
}

const CACHE_TTL_MS = 60_000;

/**
 * Single source of truth for the platform-wide default branding (logo + name).
 * Stored as two rows in the existing PlatformConfig key-value table, so no
 * schema migration is needed. Resolution order across the app is:
 *   org logo/name → THIS platform default → built-in QA Platform shield.
 *
 * Reads are cached briefly so per-email / per-request resolution doesn't hit
 * the DB every time; writes bust the cache.
 */
@Injectable()
export class PlatformBrandingService {
  private cache: { at: number; value: PlatformBranding } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<PlatformBranding> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.value;
    }
    const rows = await this.prisma.platformConfig.findMany({
      where: { key: { in: [PLATFORM_LOGO_KEY, PLATFORM_NAME_KEY] } },
      select: { key: true, value: true },
    });
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const value: PlatformBranding = {
      logoUrl: map.get(PLATFORM_LOGO_KEY) ?? null,
      appName: map.get(PLATFORM_NAME_KEY) ?? null,
    };
    this.cache = { at: Date.now(), value };
    return value;
  }

  /**
   * Upsert the provided fields. Passing `null` for a field clears it (removes
   * the row) — i.e. "reset to the built-in default". Fields left `undefined`
   * are untouched.
   */
  async set(data: { logoUrl?: string | null; appName?: string | null }): Promise<PlatformBranding> {
    const ops: Promise<unknown>[] = [];
    if (data.logoUrl !== undefined) ops.push(this.upsertKey(PLATFORM_LOGO_KEY, data.logoUrl));
    if (data.appName !== undefined) ops.push(this.upsertKey(PLATFORM_NAME_KEY, data.appName));
    await Promise.all(ops);
    this.cache = null; // bust
    return this.get();
  }

  private upsertKey(key: string, value: string | null): Promise<unknown> {
    if (value === null || value === '') {
      return this.prisma.platformConfig.deleteMany({ where: { key } });
    }
    return this.prisma.platformConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value, category: 'branding' },
    });
  }
}
