import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';

/**
 * Recurring plugin healthcheck.
 *
 * Iterates every non-deleted, enabled OrgPluginInstall, calls the manifest's
 * healthCheck, and persists the result. PluginService.healthCheck already
 * handles the lastHealthOk/At/Error fields; this cron just orchestrates the
 * fan-out and emits a notification when the health flips.
 *
 * Schedule: every 15 minutes by default, overridable via PLUGIN_HEALTH_CHECK_CRON.
 *
 * Why not BullMQ? Each healthcheck is short and has no fan-out; the work fits
 * comfortably in the API process. @Cron is consistent with the existing
 * stuck-runs cleanup + report-schedules tick.
 */
@Injectable()
export class PluginHealthCron {
  private readonly logger = new Logger(PluginHealthCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
    private readonly config: ConfigService,
  ) {}

  @Cron(process.env.PLUGIN_HEALTH_CHECK_CRON ?? '*/15 * * * *', { name: 'plugin-health-check' })
  async tick(): Promise<void> {
    const installs = await this.prisma.orgPluginInstall.findMany({
      where: { deletedAt: null, isEnabled: true },
      select: { id: true, pluginId: true, lastHealthOk: true },
    });

    if (installs.length === 0) return;
    this.logger.log(`Healthcheck tick: ${installs.length} install(s)`);

    for (const install of installs) {
      try {
        const result = await this.plugins.healthCheck(install.id);
        if (install.lastHealthOk !== result.ok) {
          this.logger.log(
            `Plugin install ${install.id} (${install.pluginId}) flipped: ${install.lastHealthOk} → ${result.ok}`,
          );
          // TODO(Phase 5/6): emit PLUGIN_HEALTH_DEGRADED notification to ORG_ADMIN
          // when result.ok === false. Wired in once the notifications module
          // surfaces a generic "system" channel.
        }
      } catch (err) {
        this.logger.warn(`Healthcheck failed for ${install.id}: ${(err as Error).message}`);
      }
    }
  }
}
