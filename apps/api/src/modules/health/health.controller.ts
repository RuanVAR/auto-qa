import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Health endpoint must be reachable on every poll regardless of how many
 * times Docker / the deploy script / external monitors hit it. With NAMED
 * throttlers (`global`, `auth`), `@SkipThrottle()` with no args only skips
 * the unnamed default bucket — the `auth: 10/min` bucket was still firing
 * and returning 429 once the deploy script's poll-every-3s burst exceeded
 * 10 hits in a minute. Pass each name explicitly so both buckets skip.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle({ global: true, auth: true })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
    } catch {
      return { status: 'error', db: 'disconnected', timestamp: new Date().toISOString() };
    }
  }
}
