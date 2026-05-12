import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Health endpoint must be reachable on every poll regardless of how many
 * times Docker / the deploy script / external monitors hit it. The default
 * ThrottlerModule has an `auth: 10/min` bucket that applies globally
 * (alongside `global: 1500/min`) and was returning 429 on health-check
 * polling during deploys — which made `scripts/deploy-prod.sh` time out
 * waiting for "API: 200". @SkipThrottle bypasses both buckets for this route.
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle()
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
