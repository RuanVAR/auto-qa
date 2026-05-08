import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';

/**
 * Best-effort outbound phase synchronisation.
 *
 * Called after a FeaturePhase transition (promote or setStatus). For every
 * TicketLink attached to the feature, we resolve the OUTBOUND status mapping
 * for the phase that was entered and dispatch `syncPhaseStatus` to the linked
 * install. Failures are logged + persisted on the TicketLink — they never
 * bubble back to the phase transition itself, since the platform's truth
 * (the phase change) has already happened.
 *
 * Effective config for the dispatch is the install.config + binding.bindingConfig
 * — same shape PluginsController.dispatch builds.
 */
@Injectable()
export class PhaseSyncService {
  private readonly logger = new Logger(PhaseSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  /**
   * Fire and forget — caller should NOT await this. We swallow all errors
   * and persist them as ticket-link state so an admin can inspect.
   */
  syncFeaturePhase(featureId: string, phaseName: string): void {
    void this.runSync(featureId, phaseName).catch((e) =>
      this.logger.error(`syncFeaturePhase fatal: ${(e as Error).message}`),
    );
  }

  private async runSync(featureId: string, phaseName: string): Promise<void> {
    // Resolve the project for this feature so we can find its bindings + their
    // OUTBOUND mappings for the entered phase.
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { module: { select: { projectId: true } } },
    });
    if (!feature) return;
    const projectId = feature.module.projectId;

    const ticketLinks = await this.prisma.ticketLink.findMany({
      where: { featureId, deletedAt: null },
      include: { install: true },
    });
    if (ticketLinks.length === 0) return;

    const bindings = await this.prisma.projectPluginBinding.findMany({
      where: { projectId, deletedAt: null, install: { isEnabled: true, lastHealthOk: true, deletedAt: null } },
      include: {
        statusMappings: {
          where: {
            targetType: 'PHASE',
            direction: { in: ['OUTBOUND', 'BIDIRECTIONAL'] },
            platformValue: phaseName,
          },
        },
      },
    });

    const bindingByInstallId = new Map(bindings.map((b) => [b.installId, b] as const));

    for (const link of ticketLinks) {
      const binding = bindingByInstallId.get(link.installId);
      if (!binding) continue;
      const mapping = binding.statusMappings[0];
      if (!mapping) continue;                        // no OUTBOUND mapping for this phase

      const effectiveConfig = {
        ...((link.install.config as object) ?? {}),
        ...((binding.bindingConfig as object) ?? {}),
      };

      try {
        await this.plugins.dispatch(
          'syncPhaseStatus',
          link.installId,
          {
            ticketLinkId: link.id,
            externalId: link.externalId,
            newPhase: phaseName,
            targetExternalStatus: mapping.externalValue,
          },
          effectiveConfig,
        );
        await this.prisma.ticketLink.update({
          where: { id: link.id },
          data: { lastOutboundSyncAt: new Date(), lastOutboundSyncError: null },
        });
      } catch (err) {
        this.logger.warn(
          `syncPhaseStatus failed for link ${link.id} (${link.install.pluginId} ${link.externalId}): ${(err as Error).message}`,
        );
        await this.prisma.ticketLink
          .update({
            where: { id: link.id },
            data: { lastOutboundSyncAt: new Date(), lastOutboundSyncError: (err as Error).message },
          })
          .catch(() => undefined);
      }
    }
  }
}
