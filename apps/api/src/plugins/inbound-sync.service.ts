import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';
import { IssuesService } from '../modules/issues/issues.service';
import { IssueStatus } from '@prisma/client';

/**
 * Inbound sync orchestrator.
 *
 * Pulls the current state of an external ticket via the plugin's
 * `pullTicketStatus` capability, snapshots it onto the `TicketLink` row, and
 * decides what to do with the new external status:
 *
 *   no mapping              → TicketStatusSuggestion(kind=UNMAPPED), notify ORG_ADMIN if binding.notifyUnmappedStatus
 *   mapping + auto-apply    → IssuesService.changeStatus + TicketStatusSuggestion(kind=AUTO_APPLIED) for the audit trail
 *   mapping + manual review → TicketStatusSuggestion(kind=PENDING_APPROVAL), notify the issue's assignee
 *
 * Source: MANUAL_REFRESH (user clicked refresh) | WEBHOOK (Phase 6) | BULK_SYNC.
 *
 * The service NEVER writes Issue.status directly — it always goes through
 * IssuesService.changeStatus so the immutable IssueStatusHistory audit trail
 * stays consistent and any side-effects (notifications, resolvedAt, etc.)
 * fire normally.
 */
@Injectable()
export class InboundSyncService {
  private readonly logger = new Logger(InboundSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
    private readonly issues: IssuesService,
  ) {}

  /**
   * Pull a single ticket's current state and route it through the suggestion
   * pipeline. Returns the (possibly new) suggestion id when one was created.
   *
   * `actorUserId` is set when a real user triggered the refresh (clicked the
   * button) so auto-applied changeStatus calls can attribute the change. For
   * BULK_SYNC + WEBHOOK paths, pass undefined and the system bot user is used
   * (we look up the project owner as a stand-in).
   */
  async refreshTicket(
    ticketLinkId: string,
    source: 'MANUAL_REFRESH' | 'WEBHOOK' | 'BULK_SYNC',
    actorUserId?: string,
  ): Promise<{ ticketLink: { id: string; externalStatus: string | null }; suggestionId?: string; applied?: boolean }> {
    const link = await this.prisma.ticketLink.findUnique({
      where: { id: ticketLinkId },
      include: { install: true },
    });
    if (!link || link.deletedAt) {
      throw new Error(`TicketLink ${ticketLinkId} not found or deleted`);
    }

    // Pull the latest status from the plugin. Effective config = install.config
    // (the project binding's bindingConfig isn't needed for read-only pulls).
    const pulled = await this.plugins
      .dispatch<{
        externalStatus: string;
        externalStatusColor?: string;
        externalStatusType?: string;
        externalAssignees?: { externalId: string; displayName: string; avatarUrl?: string }[];
        externalLastUpdatedAt: string;
      }>('pullTicketStatus', link.installId, { externalId: link.externalId }, link.install.config as object);

    // Snapshot the new state.
    const previousExternalStatus = link.externalStatus;
    await this.prisma.ticketLink.update({
      where: { id: link.id },
      data: {
        externalStatus: pulled.externalStatus,
        externalStatusColor: pulled.externalStatusColor,
        externalStatusType: pulled.externalStatusType,
        externalAssignees: pulled.externalAssignees ?? [],
        externalLastUpdatedAt: new Date(pulled.externalLastUpdatedAt),
        lastInboundSyncAt: new Date(),
        lastInboundSyncError: null,
        lastInboundSource: source,
      },
    });

    // No status change → nothing else to do.
    if (previousExternalStatus === pulled.externalStatus) {
      return { ticketLink: { id: link.id, externalStatus: pulled.externalStatus } };
    }

    // Decide based on TicketLink scope.
    if (link.issueId) {
      return this.handleIssueLink(link.id, link.issueId, pulled.externalStatus, actorUserId);
    }
    if (link.featureId) {
      // Feature-level inbound is informational only — we don't auto-promote
      // platform phases from external status flips.
      return { ticketLink: { id: link.id, externalStatus: pulled.externalStatus } };
    }
    return { ticketLink: { id: link.id, externalStatus: pulled.externalStatus } };
  }

  private async handleIssueLink(
    ticketLinkId: string,
    issueId: string,
    externalStatus: string,
    actorUserId?: string,
  ): Promise<{ ticketLink: { id: string; externalStatus: string | null }; suggestionId?: string; applied?: boolean }> {
    // Find the binding so we can read autoApplyInboundStatus + status mappings.
    const link = await this.prisma.ticketLink.findUniqueOrThrow({ where: { id: ticketLinkId } });
    const issue = await this.prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true, status: true, assignedToId: true } });
    if (!issue) return { ticketLink: { id: link.id, externalStatus } };

    const binding = await this.prisma.projectPluginBinding.findFirst({
      where: { projectId: issue.projectId, installId: link.installId, deletedAt: null },
    });
    if (!binding) {
      // No binding for the project — record an UNMAPPED suggestion.
      return this.recordSuggestion(ticketLinkId, externalStatus, null, 'UNMAPPED');
    }

    const mapping = await this.prisma.pluginStatusMapping.findFirst({
      where: {
        bindingId: binding.id,
        targetType: 'ISSUE_STATUS',
        direction: { in: ['INBOUND', 'BIDIRECTIONAL'] },
        externalValue: externalStatus,
      },
    });

    if (!mapping) {
      const result = await this.recordSuggestion(ticketLinkId, externalStatus, null, 'UNMAPPED');
      // TODO: notify ORG_ADMIN when binding.notifyUnmappedStatus — wired in
      // when notifications module surfaces a generic system channel.
      return result;
    }

    const platformStatus = mapping.platformValue as IssueStatus;
    if (issue.status === platformStatus) {
      // Mapping resolved to the status we already have — no-op, but record
      // an AUTO_APPLIED entry so the audit trail shows we considered it.
      return this.recordSuggestion(ticketLinkId, externalStatus, platformStatus, 'AUTO_APPLIED', { autoApplied: true });
    }

    if (binding.autoApplyInboundStatus) {
      try {
        const userId = actorUserId ?? (await this.resolveSystemActor(issue.projectId));
        await this.issues.changeStatus(issueId, { status: platformStatus, note: `Auto-applied from external status "${externalStatus}"` } as never, userId);
        return this.recordSuggestion(ticketLinkId, externalStatus, platformStatus, 'AUTO_APPLIED', { autoApplied: true });
      } catch (err) {
        this.logger.warn(`Auto-apply changeStatus failed for issue ${issueId}: ${(err as Error).message}`);
        // Fall through to a PENDING_APPROVAL suggestion so the user can retry.
      }
    }

    return this.recordSuggestion(ticketLinkId, externalStatus, platformStatus, 'PENDING_APPROVAL');
  }

  private async recordSuggestion(
    ticketLinkId: string,
    externalStatus: string,
    mappedStatus: string | null,
    kind: 'AUTO_APPLIED' | 'PENDING_APPROVAL' | 'UNMAPPED',
    opts?: { autoApplied?: boolean },
  ) {
    const suggestion = await this.prisma.ticketStatusSuggestion.create({
      data: {
        ticketLinkId,
        externalStatus,
        mappedStatus,
        suggestionKind: kind,
        appliedAt: opts?.autoApplied ? new Date() : null,
      },
    });
    const link = await this.prisma.ticketLink.findUniqueOrThrow({ where: { id: ticketLinkId }, select: { id: true, externalStatus: true } });
    return { ticketLink: link, suggestionId: suggestion.id, applied: !!opts?.autoApplied };
  }

  private async resolveSystemActor(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true } });
    return project.ownerId;
  }

  // ── Suggestion lifecycle ───────────────────────────────────────────────────

  async applySuggestion(suggestionId: string, userId: string): Promise<{ ok: boolean }> {
    const suggestion = await this.prisma.ticketStatusSuggestion.findUnique({
      where: { id: suggestionId },
      include: { ticketLink: { select: { id: true, issueId: true } } },
    });
    if (!suggestion) throw new Error('Suggestion not found');
    if (suggestion.appliedAt) return { ok: true };
    if (!suggestion.mappedStatus || !suggestion.ticketLink.issueId) {
      throw new Error('Cannot apply an unmapped suggestion or one not bound to an issue');
    }

    await this.issues.changeStatus(
      suggestion.ticketLink.issueId,
      { status: suggestion.mappedStatus as IssueStatus, note: `Applied from external status "${suggestion.externalStatus}"` } as never,
      userId,
    );
    await this.prisma.ticketStatusSuggestion.update({
      where: { id: suggestionId },
      data: { appliedAt: new Date(), appliedById: userId },
    });
    return { ok: true };
  }

  async dismissSuggestion(suggestionId: string, userId: string): Promise<{ ok: boolean }> {
    await this.prisma.ticketStatusSuggestion.update({
      where: { id: suggestionId },
      data: { dismissedAt: new Date(), dismissedById: userId },
    });
    return { ok: true };
  }

  // ── Bulk refresh ───────────────────────────────────────────────────────────

  async refreshAllForProject(projectId: string, source: 'MANUAL_REFRESH' | 'BULK_SYNC' = 'BULK_SYNC', actorUserId?: string): Promise<{ refreshed: number; failed: number }> {
    const links = await this.prisma.ticketLink.findMany({
      where: { projectId: { not: null }, deletedAt: null, OR: [{ projectId }, { feature: { module: { projectId } } }, { module: { projectId } }, { issue: { projectId } }] },
      select: { id: true },
    });
    let refreshed = 0;
    let failed = 0;
    for (const link of links) {
      try {
        await this.refreshTicket(link.id, source, actorUserId);
        refreshed++;
      } catch (err) {
        failed++;
        this.logger.warn(`bulk refresh: link ${link.id} failed: ${(err as Error).message}`);
      }
    }
    return { refreshed, failed };
  }
}
