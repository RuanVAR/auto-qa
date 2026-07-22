import { Injectable, Logger } from '@nestjs/common';
import { DefectStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';

/** Best-effort outbound status synchronisation for linked reusable defects. */
@Injectable()
export class DefectSyncService {
  private readonly logger = new Logger(DefectSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  syncDefectStatus(defectId: string, status: DefectStatus): void {
    void this.runSync(defectId, status).catch((error) =>
      this.logger.error(`syncDefectStatus fatal: ${(error as Error).message}`),
    );
  }

  private async runSync(defectId: string, status: DefectStatus): Promise<void> {
    const defect = await this.prisma.defect.findUnique({
      where: { id: defectId },
      select: { projectId: true },
    });
    if (!defect) return;

    const links = await this.prisma.ticketLink.findMany({
      where: { defectId, deletedAt: null },
      include: { install: true },
    });
    if (links.length === 0) return;

    const bindings = await this.prisma.projectPluginBinding.findMany({
      where: {
        projectId: defect.projectId,
        deletedAt: null,
        install: { isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: {
        statusMappings: {
          where: {
            targetType: 'DEFECT_STATUS',
            direction: { in: ['OUTBOUND', 'BIDIRECTIONAL'] },
            platformValue: status,
          },
        },
      },
    });
    const bindingByInstall = new Map(bindings.map((binding) => [binding.installId, binding] as const));

    for (const link of links) {
      const binding = bindingByInstall.get(link.installId);
      const mapping = binding?.statusMappings[0];
      if (!binding || !mapping) continue;
      const effectiveConfig = {
        ...((link.install.config as object) ?? {}),
        ...((binding.bindingConfig as object) ?? {}),
      };

      try {
        await this.plugins.dispatch(
          'syncTicketStatus',
          link.installId,
          {
            ticketLinkId: link.id,
            externalId: link.externalId,
            platformStatus: status,
            targetExternalStatus: mapping.externalValue,
          },
          effectiveConfig,
        );
        await this.prisma.ticketLink.update({
          where: { id: link.id },
          data: { lastOutboundSyncAt: new Date(), lastOutboundSyncError: null },
        });
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(`Defect sync failed for link ${link.id}: ${message}`);
        await this.prisma.ticketLink.update({
          where: { id: link.id },
          data: { lastOutboundSyncAt: new Date(), lastOutboundSyncError: message },
        }).catch(() => undefined);
      }
    }
  }
}
