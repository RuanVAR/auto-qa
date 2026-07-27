import {
  Injectable,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';
import { ScopeResolverService } from './scope-resolver.service';
import type { CreateIssueOutput, LinkTicketOutput } from './capabilities';

/**
 * Generic ClickUp ticket linking, extracted so callers beyond the web
 * controllers (notably the MCP server) share one health-gated, audited path
 * for create / link / unlink across every linkable entity scope.
 *
 * Scope coverage matches what the platform supports today: feature, module,
 * defect and issue (bug). Tests are NOT linkable — TicketLink has no
 * testDefinition column — and this service rejects that scope explicitly
 * rather than silently succeeding.
 *
 * The existing web controllers (bindings.controller feature/issue push-link,
 * DefectsService) still carry their own copies of this logic; converging them
 * onto this service is a deliberate follow-up, kept out of this change so the
 * battle-tested UI-driven flows are untouched.
 */

export type TicketScopeKind = 'feature' | 'module' | 'defect' | 'issue';

interface ScopeMeta {
  /** The TicketLink column + the create-issue/link-ticket scope key. */
  field: 'featureId' | 'moduleId' | 'defectId' | 'issueId';
  /** Human label used as the default ClickUp task title prefix. */
  label: string;
}

const SCOPES: Record<TicketScopeKind, ScopeMeta> = {
  feature: { field: 'featureId', label: 'Feature' },
  module: { field: 'moduleId', label: 'Module' },
  defect: { field: 'defectId', label: 'Defect' },
  issue: { field: 'issueId', label: 'Bug' },
};

@Injectable()
export class TicketLinkingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
    private readonly scopeResolver: ScopeResolverService,
  ) {}

  /**
   * Resolve the entity → its projectId + a default ticket title, and confirm
   * it exists. Throws NotFound if the entity is gone. projectId is what the
   * caller uses for RBAC and what we use to find the ClickUp binding.
   */
  private async resolveEntity(
    scope: TicketScopeKind,
    entityId: string,
  ): Promise<{ projectId: string; defaultTitle: string }> {
    switch (scope) {
      case 'feature': {
        const f = await this.prisma.feature.findUnique({
          where: { id: entityId },
          select: { name: true, module: { select: { projectId: true } } },
        });
        if (!f) throw new NotFoundException('Feature not found');
        return { projectId: f.module.projectId, defaultTitle: `Feature: ${f.name}` };
      }
      case 'module': {
        const m = await this.prisma.module.findUnique({
          where: { id: entityId },
          select: { name: true, projectId: true },
        });
        if (!m) throw new NotFoundException('Module not found');
        return { projectId: m.projectId, defaultTitle: `Module: ${m.name}` };
      }
      case 'defect': {
        const d = await this.prisma.defect.findUnique({
          where: { id: entityId },
          select: { title: true, projectId: true },
        });
        if (!d) throw new NotFoundException('Defect not found');
        return { projectId: d.projectId, defaultTitle: `Defect: ${d.title}` };
      }
      case 'issue': {
        const i = await this.prisma.issue.findUnique({
          where: { id: entityId },
          select: { title: true, projectId: true },
        });
        if (!i) throw new NotFoundException('Bug (issue) not found');
        return { projectId: i.projectId, defaultTitle: i.title };
      }
    }
  }

  /** Find the one healthy ClickUp project binding, or throw a clear 404. */
  private async healthyBinding(projectId: string) {
    const binding = await this.prisma.projectPluginBinding.findFirst({
      where: {
        projectId,
        deletedAt: null,
        install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: { install: { select: { id: true, orgId: true } } },
    });
    if (!binding) {
      throw new NotFoundException(
        'No healthy ClickUp integration for this project. Connect ClickUp under Org → Plugins and bind it to the project first.',
      );
    }
    return binding;
  }

  /** The projectId that owns an entity — used by the MCP tool for its RBAC check. */
  async projectIdOf(scope: TicketScopeKind, entityId: string): Promise<string> {
    return (await this.resolveEntity(scope, entityId)).projectId;
  }

  /**
   * Create a new ClickUp task for the entity and link it. Hits the real
   * ClickUp API (subject to the plugin write-guard). Returns the TicketLink.
   */
  async createTicket(
    scope: TicketScopeKind,
    entityId: string,
    userId: string,
    opts?: { title?: string; description?: string },
  ) {
    const meta = SCOPES[scope];
    const { projectId, defaultTitle } = await this.resolveEntity(scope, entityId);
    const binding = await this.healthyBinding(projectId);
    const config = await this.scopeResolver.resolve(binding.installId, { [meta.field]: entityId });

    let created: CreateIssueOutput;
    try {
      created = await this.plugins.dispatch<CreateIssueOutput>(
        'createIssue',
        binding.installId,
        {
          scope: { kind: scope, [meta.field]: entityId },
          title: opts?.title?.trim() || defaultTitle,
          description: opts?.description,
          labels: ['qa-platform'],
        },
        config,
        { actingUserId: userId },
      );
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : 'ClickUp rejected the ticket create');
    }

    return this.persist(scope, entityId, projectId, binding.install.orgId, binding.installId, created);
  }

  /** Link an EXISTING ClickUp task (by URL / id / custom id) to the entity. */
  async linkTicket(scope: TicketScopeKind, entityId: string, ticketRef: string, userId: string) {
    if (!ticketRef?.trim()) throw new BadRequestException('ticketRef is required');
    const meta = SCOPES[scope];
    const { projectId } = await this.resolveEntity(scope, entityId);
    const binding = await this.healthyBinding(projectId);
    const config = await this.scopeResolver.resolve(binding.installId, { [meta.field]: entityId });

    let linked: LinkTicketOutput;
    try {
      linked = await this.plugins.dispatch<LinkTicketOutput>(
        'linkTicket',
        binding.installId,
        { scope: { kind: scope, [meta.field]: entityId }, ticketRef: ticketRef.trim() },
        config,
        { actingUserId: userId },
      );
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : 'ClickUp ticket could not be linked');
    }

    return this.persist(scope, entityId, projectId, binding.install.orgId, binding.installId, linked);
  }

  /**
   * Unlink — soft-delete every active TicketLink for the entity. Purely
   * internal (no ClickUp write): the ClickUp task itself is never deleted, we
   * just drop the association. Returns how many links were cleared.
   */
  async unlinkTicket(scope: TicketScopeKind, entityId: string) {
    const meta = SCOPES[scope];
    // resolveEntity also validates existence + gives a clean 404.
    await this.resolveEntity(scope, entityId);
    const res = await this.prisma.ticketLink.updateMany({
      where: { [meta.field]: entityId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { unlinked: res.count };
  }

  /** List the active ticket links for an entity. */
  async listLinks(scope: TicketScopeKind, entityId: string) {
    const meta = SCOPES[scope];
    await this.resolveEntity(scope, entityId);
    return this.prisma.ticketLink.findMany({
      where: { [meta.field]: entityId, deletedAt: null },
      select: {
        id: true,
        externalId: true,
        externalUrl: true,
        externalTitle: true,
        externalStatus: true,
        externalStatusType: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Upsert-by-hand (module/issue have no compound unique key, so we can't use
   * prisma upsert uniformly): find the active link for this
   * install+externalId+entity, update it, else create.
   */
  private async persist(
    scope: TicketScopeKind,
    entityId: string,
    projectId: string,
    orgId: string,
    installId: string,
    external: CreateIssueOutput | LinkTicketOutput,
  ) {
    const meta = SCOPES[scope];
    const statusColor = 'externalStatusColor' in external ? external.externalStatusColor ?? null : null;
    const statusType = 'externalStatusType' in external ? external.externalStatusType ?? null : null;

    const existing = await this.prisma.ticketLink.findFirst({
      where: { installId, externalId: external.externalId, [meta.field]: entityId, deletedAt: null },
      select: { id: true },
    });
    const data = {
      externalUrl: external.externalUrl,
      externalTitle: external.externalTitle ?? null,
      externalStatus: external.externalStatus ?? null,
      externalStatusColor: statusColor,
      externalStatusType: statusType,
    };
    if (existing) {
      return this.prisma.ticketLink.update({ where: { id: existing.id }, data });
    }
    return this.prisma.ticketLink.create({
      data: {
        orgId,
        installId,
        projectId,
        [meta.field]: entityId,
        externalId: external.externalId,
        ...data,
      },
    });
  }
}
