import { Controller, Get, Post, Param, UseGuards, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { InboundSyncService } from './inbound-sync.service';

/**
 * REST surface for inbound ticket-status sync.
 *
 * Reads (list ticket links + pending suggestions) and writes (refresh,
 * apply / dismiss suggestion) all live here. Webhook-driven refresh runs
 * server-side without going through this controller.
 */
@ApiTags('plugin-inbound-sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class InboundSyncController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbound: InboundSyncService,
  ) {}

  // ── Lookups ────────────────────────────────────────────────────────────

  @Get('issues/:issueId/ticket-links')
  @ApiOperation({ summary: 'List external ticket links for an issue' })
  listForIssue(@Param('issueId') issueId: string) {
    return this.prisma.ticketLink.findMany({
      where: { issueId, deletedAt: null },
      include: {
        install: { select: { id: true, pluginId: true, displayLabel: true } },
        suggestions: {
          where: { dismissedAt: null, appliedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get('features/:featureId/ticket-links')
  @ApiOperation({ summary: 'List external ticket links for a feature' })
  listForFeature(@Param('featureId') featureId: string) {
    return this.prisma.ticketLink.findMany({
      where: { featureId, deletedAt: null },
      include: {
        install: { select: { id: true, pluginId: true, displayLabel: true } },
        suggestions: {
          where: { dismissedAt: null, appliedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Refresh ────────────────────────────────────────────────────────────

  @Post('ticket-links/:id/refresh')
  @ApiOperation({ summary: 'Pull current external status for a single ticket link' })
  refresh(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.inbound.refreshTicket(id, 'MANUAL_REFRESH', user.sub);
  }

  @Post('projects/:projectId/ticket-links/refresh-all')
  @ApiOperation({ summary: 'Bulk-refresh every ticket link in the project' })
  refreshAll(@Param('projectId') projectId: string, @CurrentUser() user: JwtPayload) {
    return this.inbound.refreshAllForProject(projectId, 'BULK_SYNC', user.sub);
  }

  // ── Suggestions ────────────────────────────────────────────────────────

  @Post('ticket-status-suggestions/:id/apply')
  @ApiOperation({ summary: 'Apply a pending status suggestion to its issue' })
  apply(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.inbound.applySuggestion(id, user.sub);
  }

  @Post('ticket-status-suggestions/:id/dismiss')
  @ApiOperation({ summary: 'Dismiss a pending status suggestion (no platform write)' })
  dismiss(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.inbound.dismissSuggestion(id, user.sub);
  }

  // ── Project-scoped pending suggestions ─────────────────────────────────

  @Get('projects/:projectId/ticket-status-suggestions')
  @ApiOperation({ summary: 'List pending status suggestions across the project' })
  listPending(@Param('projectId') projectId: string, @Body() _: unknown) {
    return this.prisma.ticketStatusSuggestion.findMany({
      where: {
        appliedAt: null,
        dismissedAt: null,
        ticketLink: {
          deletedAt: null,
          OR: [
            { projectId },
            { feature: { module: { projectId } } },
            { module: { projectId } },
            { issue: { projectId } },
          ],
        },
      },
      include: {
        ticketLink: {
          select: { id: true, externalId: true, externalUrl: true, externalTitle: true, issueId: true, featureId: true, install: { select: { pluginId: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
