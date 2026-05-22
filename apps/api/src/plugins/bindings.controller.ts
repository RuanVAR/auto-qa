import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  NotFoundException,
  BadGatewayException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../common/prisma/prisma.service';
import { pluginRegistry } from './registry';
import { PluginService } from './plugin.service';
import { ScopeResolverService } from './scope-resolver.service';
import { buildClickUpIssueBody } from './clickup/issue-body-builder';
import { webUrl } from '../common/config/urls';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import type { PluginCapability } from './types';
import type { PullTicketStatusOutput, SyncPhaseStatusOutput } from './capabilities';

const asJson = (v: Record<string, unknown>): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * ClickUp has no native "epic" — workspaces model it as a custom field on the
 * task (often a task-relationship or dropdown named "Epic"). We locate the
 * field by name (case-insensitive contains "epic") and coerce its value to a
 * display string, handling the common field-value shapes:
 *   - string / number            → as-is
 *   - array of {name|label}       → joined names (relationship / labels)
 *   - array of strings            → joined
 *   - object with {name|label}    → that name
 * Returns null when there's no epic field or it's empty.
 */
function extractEpicFromCustomFields(
  fields?: Array<{ name: string; type: string; value?: unknown }>,
): { name: string } | null {
  if (!fields?.length) return null;
  const field = fields.find((f) => f.name?.toLowerCase().includes('epic'));
  const v = field?.value;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' || typeof v === 'number') return { name: String(v) };
  const nameOf = (item: unknown): string | null => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      return (o.name as string) ?? (o.label as string) ?? null;
    }
    return null;
  };
  if (Array.isArray(v)) {
    const names = v.map(nameOf).filter((n): n is string => !!n);
    return names.length ? { name: names.join(', ') } : null;
  }
  const single = nameOf(v);
  return single ? { name: single } : null;
}

/**
 * Project / Module / Feature plugin bindings.
 *
 * Bindings carry the per-scope override config that cascades through
 * effective-config (feature → module → project → install.config).
 * Project bindings own status mappings + the enabledCapabilities array;
 * module / feature bindings only carry partial overrides.
 *
 * RBAC: bindings are project-scoped — wiring up the project role guard fully
 * is part of the broader project-RBAC track; for now we lean on JwtAuthGuard
 * + the existing membership checks done at the org/project layer. This will
 * tighten when the bindings UI ships in Phase 2.
 */
@ApiTags('plugin-bindings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class BindingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
    private readonly scopeResolver: ScopeResolverService,
    private readonly config: ConfigService,
  ) {}

  // ── Project bindings ──────────────────────────────────────────────────────

  @Get('projects/:projectId/plugin-bindings')
  @ApiOperation({ summary: 'List project-level plugin bindings' })
  listProjectBindings(@Param('projectId') projectId: string) {
    return this.prisma.projectPluginBinding.findMany({
      where: { projectId, deletedAt: null },
      include: { install: true, statusMappings: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post('projects/:projectId/plugin-bindings')
  @ApiOperation({ summary: 'Create / replace a project binding for an installed plugin' })
  async upsertProjectBinding(
    @Param('projectId') projectId: string,
    @Body()
    body: {
      installId: string;
      bindingConfig: Record<string, unknown>;
      enabledCapabilities?: PluginCapability[];
      autoApplyInboundStatus?: boolean;
      notifyUnmappedStatus?: boolean;
    },
  ) {
    const install = await this.prisma.orgPluginInstall.findUnique({ where: { id: body.installId } });
    if (!install || install.deletedAt) throw new NotFoundException('Install not found');
    const manifest = pluginRegistry.get(install.pluginId);
    if (!manifest) throw new NotFoundException(`Plugin not in registry: ${install.pluginId}`);

    // Filter requested capabilities down to what the manifest actually declares.
    const enabled = (body.enabledCapabilities ?? []).filter((c) => manifest.capabilities.includes(c));

    return this.prisma.projectPluginBinding.upsert({
      where: { projectId_installId: { projectId, installId: install.id } },
      create: {
        orgId: install.orgId,
        projectId,
        installId: install.id,
        bindingConfig: asJson(body.bindingConfig),
        enabledCapabilities: enabled,
        autoApplyInboundStatus: body.autoApplyInboundStatus ?? false,
        notifyUnmappedStatus: body.notifyUnmappedStatus ?? true,
      },
      update: {
        bindingConfig: asJson(body.bindingConfig),
        enabledCapabilities: enabled,
        autoApplyInboundStatus: body.autoApplyInboundStatus,
        notifyUnmappedStatus: body.notifyUnmappedStatus,
        deletedAt: null,
      },
    });
  }

  @Patch('projects/:projectId/plugin-bindings/:id')
  @ApiOperation({ summary: 'Patch a project binding' })
  patchProjectBinding(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      bindingConfig: Record<string, unknown>;
      enabledCapabilities: PluginCapability[];
      autoApplyInboundStatus: boolean;
      notifyUnmappedStatus: boolean;
    }>,
  ) {
    const { bindingConfig, ...rest } = body;
    return this.prisma.projectPluginBinding.update({
      where: { id },
      data: { ...rest, ...(bindingConfig ? { bindingConfig: asJson(bindingConfig) } : {}) },
    });
  }

  @Delete('projects/:projectId/plugin-bindings/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-delete a project binding' })
  async deleteProjectBinding(@Param('id') id: string) {
    await this.prisma.projectPluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Status mappings (bulk-replace) ───────────────────────────────────────

  @Get('projects/:projectId/plugin-bindings/:id/status-mappings')
  @ApiOperation({ summary: 'List status mappings on a project binding' })
  listStatusMappings(@Param('id') id: string) {
    return this.prisma.pluginStatusMapping.findMany({
      where: { bindingId: id },
      orderBy: [{ direction: 'asc' }, { platformValue: 'asc' }],
    });
  }

  @Put('projects/:projectId/plugin-bindings/:id/status-mappings')
  @ApiOperation({ summary: 'Bulk-replace status mappings on a project binding' })
  async replaceStatusMappings(
    @Param('id') id: string,
    @Body()
    body: {
      mappings: Array<{
        direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
        targetType: 'PHASE' | 'ISSUE_STATUS';
        platformValue: string;
        externalValue: string;
      }>;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.pluginStatusMapping.deleteMany({ where: { bindingId: id } });
      if (body.mappings.length > 0) {
        await tx.pluginStatusMapping.createMany({
          data: body.mappings.map((m) => ({
            bindingId: id,
            direction: m.direction,
            targetType: m.targetType,
            platformValue: m.platformValue,
            externalValue: m.externalValue,
          })),
        });
      }
      return tx.pluginStatusMapping.findMany({
        where: { bindingId: id },
        orderBy: [{ direction: 'asc' }, { platformValue: 'asc' }],
      });
    });
  }

  // ── Module bindings ───────────────────────────────────────────────────────

  @Get('modules/:moduleId/plugin-bindings')
  listModuleBindings(@Param('moduleId') moduleId: string) {
    return this.prisma.modulePluginBinding.findMany({
      where: { moduleId, deletedAt: null },
      include: { install: true },
    });
  }

  @Post('modules/:moduleId/plugin-bindings')
  upsertModuleBinding(
    @Param('moduleId') moduleId: string,
    @Body() body: { installId: string; bindingConfig: Record<string, unknown> },
  ) {
    return this.prisma.modulePluginBinding.upsert({
      where: { moduleId_installId: { moduleId, installId: body.installId } },
      create: { moduleId, installId: body.installId, bindingConfig: asJson(body.bindingConfig) },
      update: { bindingConfig: asJson(body.bindingConfig), deletedAt: null },
    });
  }

  @Delete('modules/:moduleId/plugin-bindings/:id')
  @HttpCode(204)
  async deleteModuleBinding(@Param('id') id: string) {
    await this.prisma.modulePluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ── Feature bindings ──────────────────────────────────────────────────────

  @Get('features/:featureId/plugin-bindings')
  listFeatureBindings(@Param('featureId') featureId: string) {
    return this.prisma.featurePluginBinding.findMany({
      where: { featureId, deletedAt: null },
      include: { install: true },
    });
  }

  /**
   * Resolve the effective ClickUp routing for a scope. Walks the cascade
   * (feature → module → project → install) and returns the resolved
   * `defaultListId` + `targetMode` + `defaultParentTaskId` along with which
   * level supplied each value. Frontend uses this to render the
   * "Tickets land in: TEst list (inherited from project)" hint.
   */
  @Get('projects/:projectId/clickup-routing')
  @ApiOperation({ summary: 'Effective ClickUp routing for a project (uses install pluginId=clickup)' })
  async projectRouting(@Param('projectId') projectId: string) {
    return this.resolveRouting({ projectId });
  }

  @Get('modules/:moduleId/clickup-routing')
  async moduleRouting(@Param('moduleId') moduleId: string) {
    return this.resolveRouting({ moduleId });
  }

  @Get('features/:featureId/clickup-routing')
  async featureRouting(@Param('featureId') featureId: string) {
    return this.resolveRouting({ featureId });
  }

  /**
   * Fetch the ClickUp workspace's custom task types (Bug / Enhancement / etc)
   * for a project's resolved install. Used by LogIssueModal to populate the
   * "ClickUp task type" picker when the user enables push-to-ClickUp.
   *
   * Resolves the workspaceId from the project's binding cascade — saves the
   * frontend from having to know workspace ids. Returns an empty array if
   * the workspace hasn't customised types or the project has no healthy
   * ClickUp install (caller hides the dropdown in that case).
   */
  @Get('projects/:projectId/clickup-task-types')
  @ApiOperation({ summary: 'List ClickUp custom task types for a project (Bug / Enhancement / …)' })
  async projectClickUpTaskTypes(@Param('projectId') projectId: string): Promise<{
    items: Array<{ id: string; label: string; numericId: number }>;
  }> {
    const routing = await this.resolveRouting({ projectId });
    if (!routing.install?.healthy || !routing.workspaceId) return { items: [] };

    type ListEntitiesItem = { id: string; label: string; meta?: { numericId?: number } };
    try {
      const r = await this.plugins.dispatch<{ items: ListEntitiesItem[] }>(
        'listEntities' as never,
        routing.install.id,
        { kind: 'custom-item-types', parent: { workspaceId: routing.workspaceId } },
        {},
      );
      return {
        items: r.items.map((it) => ({
          id: it.id,
          label: it.label,
          numericId: it.meta?.numericId ?? Number(it.id),
        })),
      };
    } catch {
      // Best-effort: the wizard already swallows the same failure mode at
      // the client layer (workspaces that have never customised types).
      return { items: [] };
    }
  }

  /** Walks feature → module → project bindings and merges their bindingConfig. */
  private async resolveRouting(scope: { featureId?: string; moduleId?: string; projectId?: string }): Promise<{
    install: { id: string; pluginId: string; healthy: boolean } | null;
    listId: string | null;
    listIdSource: 'feature' | 'module' | 'project' | 'install' | null;
    targetMode: 'list' | 'subtask' | null;
    parentTaskId: string | null;
    listIdInheritedLabel: string;
    workspaceId: string | null;
    spaceId: string | null;
    folderId: string | null;
  }> {
    let projectId: string | undefined = scope.projectId;
    let moduleId: string | undefined = scope.moduleId;
    let featureId: string | undefined = scope.featureId;

    if (featureId && !moduleId) {
      const feature = await this.prisma.feature.findUnique({
        where: { id: featureId },
        select: { moduleId: true, module: { select: { projectId: true } } },
      });
      if (feature) {
        moduleId = feature.moduleId;
        projectId = projectId ?? feature.module.projectId;
      }
    }
    if (moduleId && !projectId) {
      const m = await this.prisma.module.findUnique({ where: { id: moduleId }, select: { projectId: true } });
      if (m) projectId = m.projectId;
    }
    if (!projectId) {
      return { install: null, listId: null, listIdSource: null, targetMode: null, parentTaskId: null, listIdInheritedLabel: 'No scope resolved', workspaceId: null, spaceId: null, folderId: null };
    }

    const projectBinding = await this.prisma.projectPluginBinding.findFirst({
      where: { projectId, deletedAt: null, install: { pluginId: 'clickup', deletedAt: null } },
      include: { install: { select: { id: true, pluginId: true, isEnabled: true, lastHealthOk: true, config: true } } },
    });
    if (!projectBinding) {
      return { install: null, listId: null, listIdSource: null, targetMode: null, parentTaskId: null, listIdInheritedLabel: 'No project binding', workspaceId: null, spaceId: null, folderId: null };
    }
    const moduleBinding = moduleId
      ? await this.prisma.modulePluginBinding.findFirst({
          where: { moduleId, deletedAt: null, installId: projectBinding.installId },
        })
      : null;
    const featureBinding = featureId
      ? await this.prisma.featurePluginBinding.findFirst({
          where: { featureId, deletedAt: null, installId: projectBinding.installId },
        })
      : null;

    type Cfg = Record<string, unknown> | null | undefined;
    const featCfg = featureBinding?.bindingConfig as Cfg;
    const modCfg = moduleBinding?.bindingConfig as Cfg;
    const projCfg = projectBinding.bindingConfig as Cfg;
    const instCfg = projectBinding.install.config as Cfg;

    const pickFirst = <T,>(field: string): { value: T | null; source: 'feature' | 'module' | 'project' | 'install' | null } => {
      for (const [src, cfg] of [
        ['feature', featCfg],
        ['module', modCfg],
        ['project', projCfg],
        ['install', instCfg],
      ] as const) {
        const v = cfg && (cfg as Record<string, unknown>)[field];
        if (v !== undefined && v !== null && v !== '') return { value: v as T, source: src };
      }
      return { value: null, source: null };
    };

    const list = pickFirst<string>('defaultListId');
    const mode = pickFirst<'list' | 'subtask'>('targetMode');
    const parent = pickFirst<string>('defaultParentTaskId');

    const workspaceId = pickFirst<string>('workspaceId');
    const spaceId = pickFirst<string>('spaceId');
    const folderId = pickFirst<string>('folderId');

    return {
      install: {
        id: projectBinding.install.id,
        pluginId: projectBinding.install.pluginId,
        healthy: projectBinding.install.isEnabled && projectBinding.install.lastHealthOk,
      },
      listId: list.value,
      listIdSource: list.source,
      targetMode: mode.value,
      parentTaskId: parent.value,
      listIdInheritedLabel:
        list.source === 'feature' ? 'feature override'
          : list.source === 'module' ? 'module override'
            : list.source === 'project' ? 'project default'
              : list.source === 'install' ? 'install default'
                : 'unset',
      workspaceId: workspaceId.value,
      spaceId: spaceId.value,
      folderId: folderId.value,
    };
  }

  @Post('features/:featureId/plugin-bindings')
  upsertFeatureBinding(
    @Param('featureId') featureId: string,
    @Body() body: { installId: string; bindingConfig: Record<string, unknown> },
  ) {
    return this.prisma.featurePluginBinding.upsert({
      where: { featureId_installId: { featureId, installId: body.installId } },
      create: { featureId, installId: body.installId, bindingConfig: asJson(body.bindingConfig) },
      update: { bindingConfig: asJson(body.bindingConfig), deletedAt: null },
    });
  }

  @Delete('features/:featureId/plugin-bindings/:id')
  @HttpCode(204)
  async deleteFeatureBinding(@Param('id') id: string) {
    await this.prisma.featurePluginBinding.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Push a feature to ClickUp as a parent task.
   *
   *   1. Resolve effective routing (cascade) — must end up with a defaultListId.
   *   2. Dispatch `createIssue` to create a top-level task in that list.
   *   3. Auto-create a FeaturePluginBinding with `targetMode=subtask` and
   *      `defaultParentTaskId` set to the new task id.
   *   4. Record a TicketLink so the feature header can show the link.
   *
   * Subsequent ticket creates under that feature (failed steps, manual issues)
   * will land as subtasks of the parent automatically — the cascade resolves
   * the feature binding's targetMode/parent over the module's listId.
   */
  @Post('features/:featureId/push-to-clickup')
  @ApiOperation({ summary: 'Create a ClickUp parent task for a feature + auto-bind it' })
  async pushFeatureToClickUp(
    @Param('featureId') featureId: string,
    @CurrentUser() _user: JwtPayload,
    @Body() body: { description?: string } = {},
  ) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: { module: { select: { id: true, projectId: true, name: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found');

    const projectId = feature.module.projectId;
    const moduleId = feature.module.id;

    // Resolve the cascading list id (feature → module → project → install).
    const projectBinding = await this.prisma.projectPluginBinding.findFirst({
      where: { projectId, deletedAt: null, install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null } },
      include: { install: { select: { id: true, orgId: true, config: true } } },
    });
    if (!projectBinding) {
      throw new NotFoundException('No healthy ClickUp project binding — set one up under Org → Plugins + Project → Integrations first');
    }
    const moduleBinding = await this.prisma.modulePluginBinding.findFirst({
      where: { moduleId, deletedAt: null, installId: projectBinding.installId },
    });

    type Cfg = Record<string, unknown> | null | undefined;
    const cfg = (key: string): unknown => {
      for (const layer of [moduleBinding?.bindingConfig as Cfg, projectBinding.bindingConfig as Cfg, projectBinding.install.config as Cfg]) {
        const v = layer && (layer as Record<string, unknown>)[key];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };

    const listId = cfg('defaultListId') as string | undefined;
    if (!listId) {
      throw new NotFoundException('No defaultListId resolved from cascade — set one on the project or module binding');
    }

    // Build effective config for the dispatch — top-level task creation in
    // the resolved list, regardless of cascade-level subtask defaults
    // (we're CREATING the parent, not pushing a subtask under one).
    const effectiveConfig = {
      defaultListId: listId,
      targetMode: 'list' as const,
    };

    type CreateOut = { externalId: string; externalUrl: string; externalTitle?: string; externalStatus?: string };
    const result = await this.plugins.dispatch<CreateOut>(
      'createIssue',
      projectBinding.installId,
      {
        scope: { kind: 'feature', featureId },
        title: feature.name,
        description: body.description ?? feature.description ?? `Feature parent task for ${feature.module.name} / ${feature.name}.`,
        labels: ['qa-platform', 'feature-parent'],
      },
      effectiveConfig,
    );

    // Auto-bind: every subsequent push under this feature lands as a subtask.
    await this.prisma.featurePluginBinding.upsert({
      where: { featureId_installId: { featureId, installId: projectBinding.installId } },
      create: {
        featureId,
        installId: projectBinding.installId,
        bindingConfig: { targetMode: 'subtask', defaultParentTaskId: result.externalId } as unknown as Prisma.InputJsonValue,
      },
      update: {
        bindingConfig: { targetMode: 'subtask', defaultParentTaskId: result.externalId } as unknown as Prisma.InputJsonValue,
        deletedAt: null,
      },
    });

    // Record the TicketLink for the feature so the existing TicketLinksPanel
    // (used elsewhere) renders this as the feature's primary external ticket.
    await this.prisma.ticketLink.upsert({
      where: { installId_externalId_featureId: { installId: projectBinding.installId, externalId: result.externalId, featureId } },
      create: {
        orgId: projectBinding.install.orgId,
        installId: projectBinding.installId,
        featureId,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        externalTitle: result.externalTitle ?? feature.name,
        externalStatus: result.externalStatus,
      },
      update: {
        externalUrl: result.externalUrl,
        externalTitle: result.externalTitle ?? feature.name,
        externalStatus: result.externalStatus,
        deletedAt: null,
      },
    });

    return {
      ok: true,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      listId,
    };
  }

  /**
   * Link an EXISTING ClickUp task as the feature's parent.
   *
   * Mirror of pushFeatureToClickUp — same end-state (FeaturePluginBinding
   * + TicketLink) but no ClickUp write. Resolves the ticket via the plugin's
   * `linkTicket` capability so URL / plain id / custom-id all work.
   */
  @Post('features/:featureId/link-clickup-task')
  @ApiOperation({ summary: 'Link an existing ClickUp task as the feature parent' })
  async linkFeatureToClickUp(
    @Param('featureId') featureId: string,
    @Body() body: { ticketRef: string },
  ) {
    if (!body.ticketRef?.trim()) {
      throw new NotFoundException('ticketRef is required (URL, plain id, or custom id)');
    }
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      select: { name: true, module: { select: { projectId: true } } },
    });
    if (!feature) throw new NotFoundException('Feature not found');

    const projectBinding = await this.prisma.projectPluginBinding.findFirst({
      where: { projectId: feature.module.projectId, deletedAt: null, install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null } },
      include: { install: { select: { id: true, orgId: true, config: true } } },
    });
    if (!projectBinding) {
      throw new NotFoundException('No healthy ClickUp project binding — set one up under Org → Plugins + Project → Integrations first');
    }

    type LinkOut = {
      externalId: string;
      externalUrl: string;
      externalTitle?: string;
      externalStatus?: string;
      externalStatusColor?: string;
      externalStatusType?: string;
    };
    const result = await this.plugins.dispatch<LinkOut>(
      'linkTicket',
      projectBinding.installId,
      { scope: { kind: 'feature', featureId }, ticketRef: body.ticketRef.trim() },
      // linkTicket is read-only — install.config is enough for workspace/custom-id resolution.
      (projectBinding.install.config as object) ?? {},
    );

    // Bind feature → subtask mode under this existing task.
    await this.prisma.featurePluginBinding.upsert({
      where: { featureId_installId: { featureId, installId: projectBinding.installId } },
      create: {
        featureId,
        installId: projectBinding.installId,
        bindingConfig: { targetMode: 'subtask', defaultParentTaskId: result.externalId } as unknown as Prisma.InputJsonValue,
      },
      update: {
        bindingConfig: { targetMode: 'subtask', defaultParentTaskId: result.externalId } as unknown as Prisma.InputJsonValue,
        deletedAt: null,
      },
    });

    await this.prisma.ticketLink.upsert({
      where: { installId_externalId_featureId: { installId: projectBinding.installId, externalId: result.externalId, featureId } },
      create: {
        orgId: projectBinding.install.orgId,
        installId: projectBinding.installId,
        featureId,
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        externalTitle: result.externalTitle ?? feature.name,
        externalStatus: result.externalStatus,
        externalStatusColor: result.externalStatusColor,
        externalStatusType: result.externalStatusType,
      },
      update: {
        externalUrl: result.externalUrl,
        externalTitle: result.externalTitle ?? feature.name,
        externalStatus: result.externalStatus,
        externalStatusColor: result.externalStatusColor,
        externalStatusType: result.externalStatusType,
        deletedAt: null,
      },
    });

    return {
      ok: true,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      externalTitle: result.externalTitle,
    };
  }

  /**
   * Unlink the feature's parent task. Soft-deletes the FeaturePluginBinding +
   * the TicketLink. Subsequent pushes under the feature fall back to the
   * module/project list at top level (no parent).
   */
  @Post('features/:featureId/unlink-clickup-task')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the feature’s ClickUp parent-task binding (no ClickUp write)' })
  async unlinkFeatureFromClickUp(@Param('featureId') featureId: string) {
    const bindings = await this.prisma.featurePluginBinding.findMany({
      where: { featureId, deletedAt: null, install: { pluginId: 'clickup' } },
      select: { id: true, installId: true },
    });
    for (const b of bindings) {
      await this.prisma.featurePluginBinding.update({
        where: { id: b.id },
        data: { deletedAt: new Date() },
      });
      await this.prisma.ticketLink.updateMany({
        where: { featureId, installId: b.installId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
  }

  /**
   * Resolve the active ClickUp TicketLink for a feature + its install. Throws
   * 404 when the feature has no linked task. The most-recent active link wins
   * (a feature normally has exactly one).
   */
  private async resolveFeatureTicketLink(featureId: string) {
    const link = await this.prisma.ticketLink.findFirst({
      where: {
        featureId,
        deletedAt: null,
        install: { pluginId: 'clickup', isEnabled: true, deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      include: { install: { select: { id: true, config: true, lastHealthOk: true } } },
    });
    if (!link) throw new NotFoundException('This feature has no linked ClickUp task');
    return link;
  }

  /**
   * Current status of the feature's linked ClickUp task + the full set of
   * statuses it can be moved to. Refreshes the cached snapshot on the
   * TicketLink so the edit-modal row and overview pill agree.
   */
  @Get('features/:featureId/clickup-task-status')
  @ApiOperation({ summary: 'Linked ClickUp task status + selectable statuses for a feature' })
  async getFeatureClickUpStatus(@Param('featureId') featureId: string) {
    const link = await this.resolveFeatureTicketLink(featureId);
    const cfg = (link.install.config as object) ?? {};

    let current: PullTicketStatusOutput;
    let statuses: Array<{ status: string; color?: string; type?: string }> = [];
    try {
      // 1. Fresh current status — also yields the task's list id.
      current = await this.plugins.dispatch<PullTicketStatusOutput>(
        'pullTicketStatus',
        link.installId,
        { externalId: link.externalId },
        cfg,
      );

      // 2. The list's available statuses (the transition options).
      if (current.externalListId) {
        const opts = await this.plugins.dispatch<{
          items: Array<{ id: string; label: string; meta?: { color?: string; type?: string } }>;
        }>(
          'listEntities',
          link.installId,
          { kind: 'list-statuses', parent: { listId: current.externalListId } },
          cfg,
        );
        statuses = opts.items.map((i) => ({ status: i.id, color: i.meta?.color, type: i.meta?.type }));
      }
    } catch (err) {
      // Surface ClickUp/plugin failures as a clean 502 with the real message
      // instead of a generic 500.
      throw new BadGatewayException(
        err instanceof Error ? err.message : 'Could not reach ClickUp',
      );
    }

    // 3. Keep the cached snapshot fresh for the other surfaces.
    await this.prisma.ticketLink.update({
      where: { id: link.id },
      data: {
        externalStatus: current.externalStatus,
        externalStatusColor: current.externalStatusColor,
        externalStatusType: current.externalStatusType,
      },
    });

    return {
      linked: true,
      externalId: link.externalId,
      externalUrl: link.externalUrl,
      externalTitle: link.externalTitle,
      currentStatus: current.externalStatus,
      currentStatusColor: current.externalStatusColor,
      statuses,
      // Epic the linked task belongs to, read from its custom fields — lets
      // QA see the ClickUp epic without leaving the platform. Null when the
      // task's list has no custom field whose name contains "epic".
      epic: extractEpicFromCustomFields(current.externalCustomFields),
    };
  }

  /**
   * Move the feature's linked ClickUp task to a new status (outbound write).
   * Double-confirmed client-side. Reuses the syncPhaseStatus capability —
   * the same PUT /task path the phase-sync uses — and refreshes the cached
   * snapshot on success.
   */
  @Post('features/:featureId/clickup-task-status')
  @ApiOperation({ summary: 'Update the status of a feature\'s linked ClickUp task' })
  async setFeatureClickUpStatus(
    @Param('featureId') featureId: string,
    @Body() body: { status?: string },
  ) {
    const status = body?.status?.trim();
    if (!status) throw new NotFoundException('status is required');
    const link = await this.resolveFeatureTicketLink(featureId);
    const cfg = (link.install.config as object) ?? {};

    let result: SyncPhaseStatusOutput;
    try {
      result = await this.plugins.dispatch<SyncPhaseStatusOutput>(
        'syncPhaseStatus',
        link.installId,
        {
          ticketLinkId: link.id,
          externalId: link.externalId,
          newPhase: status,
          targetExternalStatus: status,
        },
        cfg,
      );
    } catch (err) {
      // ClickUp rejected the write (bad status name, permissions, dev
      // write-guard, network) — surface the real reason, not a 500.
      throw new BadGatewayException(
        err instanceof Error ? err.message : 'ClickUp rejected the status update',
      );
    }

    await this.prisma.ticketLink.update({
      where: { id: link.id },
      data: { externalStatus: result.externalStatus },
    });

    return { ok: true, externalStatus: result.externalStatus, syncedAt: result.syncedAt };
  }

  /**
   * Push a platform Issue to ClickUp.
   *
   *   1. Resolve the cascade for the issue (feature → module → project)
   *      so we know which list / parent task to attach to.
   *   2. Build the ClickUp body via buildClickUpIssueBody (markdown_description
   *      bundles every field + a back-link to the platform's issue page).
   *   3. Dispatch createIssue against the resolved install.
   *   4. Best-effort attach evidence files via attachArtifacts. Failures here
   *      DON'T fail the push — they fall back to the markdown links the
   *      builder already includes in the description.
   *   5. The dispatch path already creates a TicketLink on success; we just
   *      return the externalId/url to the caller.
   */
  @Post('issues/:issueId/push-to-clickup')
  @ApiOperation({ summary: 'Create a ClickUp ticket from an Issue + attach evidence + back-link' })
  async pushIssueToClickUp(
    @Param('issueId') issueId: string,
    @Body() pushOptions: {
      customItemId?: string;
      /**
       * Where the bug task lands in ClickUp:
       *   feature-subtask → subtask under the feature's own ClickUp task
       *   module-list     → top-level task in the module/project list, so a
       *                     PM working in ClickUp sees every module bug in
       *                     one place
       * Omitted → keep the cascade's own routing (back-compat).
       */
      placement?: 'feature-subtask' | 'module-list';
    } = {},
  ) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        reportedBy: { select: { name: true, email: true } },
        feature: { select: { name: true } },
        module: { select: { name: true } },
      },
    });
    if (!issue) throw new NotFoundException('Issue not found');

    // Resolve cascade for this issue's scope.
    const projectBinding = await this.prisma.projectPluginBinding.findFirst({
      where: {
        projectId: issue.projectId,
        deletedAt: null,
        install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: { install: { select: { id: true, orgId: true } } },
    });
    if (!projectBinding) {
      throw new NotFoundException('No healthy ClickUp project binding — install + bind under Org → Plugins / Project → Integrations first');
    }
    const installId = projectBinding.installId;

    // Walk the cascade (feature → module → project → install) to get the
    // listId / targetMode / parentTaskId. Same machinery as the dispatch
    // endpoint uses for createIssue routing.
    const cascadeConfig = await this.scopeResolver.resolve(installId, {
      featureId: issue.featureId ?? undefined,
      moduleId: issue.moduleId ?? undefined,
      projectId: issue.projectId,
    });
    const listId = (cascadeConfig as { defaultListId?: string }).defaultListId;
    if (!listId) {
      throw new NotFoundException('No defaultListId resolved from cascade — set one on the project / module binding first');
    }

    // ── Placement resolution ─────────────────────────────────────────────
    // The feature's OWN ClickUp task (issueId=null link) is both the subtask
    // parent and the link target when the bug lands at list level.
    let featureTaskExternalId: string | null = null;
    if (issue.featureId) {
      const featureLink = await this.prisma.ticketLink.findFirst({
        where: { featureId: issue.featureId, issueId: null, deletedAt: null, installId },
        orderBy: { createdAt: 'desc' },
        select: { externalId: true },
      });
      featureTaskExternalId = featureLink?.externalId ?? null;
    }

    const placement = pushOptions.placement;
    if (placement === 'feature-subtask' && !featureTaskExternalId) {
      throw new NotFoundException(
        "This issue's feature has no linked ClickUp task — link the feature first, or push to the module list instead.",
      );
    }

    // Build the config the createIssue dispatch runs against. Placement
    // overrides the cascade's targetMode so the user's explicit choice wins.
    let dispatchConfig: Record<string, unknown> = { ...(cascadeConfig as object) };
    if (placement === 'feature-subtask') {
      dispatchConfig = { ...dispatchConfig, targetMode: 'subtask', defaultParentTaskId: featureTaskExternalId };
    } else if (placement === 'module-list') {
      dispatchConfig = { ...dispatchConfig, targetMode: 'list', defaultParentTaskId: undefined };
    }

    // Inherit the feature task's custom fields (incl. epic when modelled as
    // a field) — only when the bug lands in the SAME list as the feature
    // task, since ClickUp custom field ids are list-scoped. Subtask
    // placement is always same-list; list placement only when the resolved
    // list IS the feature task's list. Best-effort — never block the push.
    let inheritedCustomFields: { id: string; value: unknown }[] | undefined;
    if (featureTaskExternalId) {
      try {
        const featureTask = await this.plugins.dispatch<PullTicketStatusOutput>(
          'pullTicketStatus', installId, { externalId: featureTaskExternalId }, dispatchConfig,
        );
        const effectiveMode = (dispatchConfig as { targetMode?: string }).targetMode;
        const sameList =
          effectiveMode === 'subtask' || featureTask.externalListId === listId;
        if (sameList && featureTask.externalCustomFields?.length) {
          inheritedCustomFields = featureTask.externalCustomFields.map((f) => ({ id: f.id, value: f.value }));
        }
      } catch {
        /* best-effort — the push proceeds without field inheritance */
      }
    }

    // Build the body. publicIssueUrl points at the platform's issue page.
    const publicIssueUrl = `${webUrl()}/issues/${issue.id}`;

    const body = buildClickUpIssueBody(
      {
        id: issue.id,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        stepsToReproduce: issue.stepsToReproduce,
        expectedBehaviour: issue.expectedBehaviour,
        actualBehaviour: issue.actualBehaviour,
        screenshotUrls: issue.screenshotUrls ?? [],
        recordingUrl: issue.recordingUrl,
        reportedBy: issue.reportedBy,
        feature: issue.feature,
        module: issue.module,
      },
      { publicIssueUrl },
    );

    // Push as createIssue — payload shape matches the capability's input.
    type CreateOut = {
      externalId: string;
      externalUrl: string;
      externalTitle?: string;
      externalStatus?: string;
    };
    let created: CreateOut;
    try {
      created = await this.plugins.dispatch<CreateOut>(
        'createIssue',
        installId,
        {
          scope: { kind: 'issue', issueId: issue.id },
          title: body.name,
          description: body.markdown_description,
          severity: issue.severity.toLowerCase(),
          labels: body.tags,
          // Optional task-type override picked by the user in LogIssueModal.
          // Stringified numeric id — the createIssue capability parses it.
          customItemId: pushOptions.customItemId,
          // Inherited feature-task custom fields (undefined when cross-list).
          customFields: inheritedCustomFields,
          // Subtask placement links via the parent; module-list placement
          // needs an explicit ClickUp linked-task relationship back to the
          // feature task so the connection is still visible.
          linkToExternalId:
            (dispatchConfig as { targetMode?: string }).targetMode === 'list' && featureTaskExternalId
              ? featureTaskExternalId
              : undefined,
        },
        dispatchConfig,
      );
    } catch (err) {
      // ClickUp rejected the create (dev write-guard, permissions, bad
      // list/field) — surface the real reason as a 502, not a generic 500.
      throw new BadGatewayException(
        err instanceof Error ? err.message : 'ClickUp rejected the ticket create',
      );
    }

    // Best-effort attachment upload. attachArtifacts handles per-kind size
    // caps + falls back to description URLs on overflow / network errors.
    const evidenceArtifacts = [
      ...(issue.screenshotUrls ?? []).map((url, i) => ({
        url,
        filename: `screenshot-${i + 1}.png`,
        kind: 'screenshot' as const,
      })),
      ...(issue.recordingUrl
        ? [{ url: issue.recordingUrl, filename: 'recording.webm', kind: 'recording' as const }]
        : []),
    ];

    let attachmentResult: unknown = null;
    if (evidenceArtifacts.length > 0) {
      try {
        attachmentResult = await this.plugins.dispatch(
          'attachArtifacts',
          installId,
          { externalId: created.externalId, artifacts: evidenceArtifacts },
          dispatchConfig,
        );
      } catch (err) {
        // Non-fatal — markdown description already contains URLs as fallback.
        attachmentResult = { error: (err as Error).message };
      }
    }

    // Persist the TicketLink on the issue.
    await this.prisma.ticketLink.upsert({
      where: {
        installId_externalId_featureId: {
          installId,
          externalId: created.externalId,
          featureId: issue.featureId ?? null as never,
        },
      },
      create: {
        orgId: projectBinding.install.orgId,
        installId,
        issueId: issue.id,
        featureId: issue.featureId,
        moduleId: issue.moduleId,
        projectId: issue.projectId,
        externalId: created.externalId,
        externalUrl: created.externalUrl,
        externalTitle: created.externalTitle ?? body.name,
        externalStatus: created.externalStatus,
      },
      update: {
        externalUrl: created.externalUrl,
        externalTitle: created.externalTitle ?? body.name,
        externalStatus: created.externalStatus,
        deletedAt: null,
      },
    });

    return {
      ok: true,
      externalId: created.externalId,
      externalUrl: created.externalUrl,
      attachments: attachmentResult,
    };
  }

  /**
   * Lightweight prompt resolver — what the LogIssueModal needs to render
   * "Push this to ClickUp?" with a real preview ("MPF / Widget Manager").
   * Returns the routing context for an issue's scope before the issue
   * exists yet.
   */
  @Get('issues-routing-preview')
  @ApiOperation({ summary: 'Resolve where a hypothetical issue would push (used by Log Issue modal)' })
  async issuesRoutingPreview(@Body() _: unknown) {
    // GET with optional query params. We accept them as separate routes for
    // RBAC simplicity — see the project / module / feature routing-hint endpoints
    // already present. The frontend calls those today. This stub stays for
    // discoverability.
    return { ok: true };
  }
}
