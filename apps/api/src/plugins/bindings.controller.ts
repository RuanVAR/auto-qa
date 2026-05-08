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
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import type { PluginCapability } from './types';

const asJson = (v: Record<string, unknown>): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

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
  async pushIssueToClickUp(@Param('issueId') issueId: string) {
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
    const effectiveConfig = await this.scopeResolver.resolve(installId, {
      featureId: issue.featureId ?? undefined,
      moduleId: issue.moduleId ?? undefined,
      projectId: issue.projectId,
    });
    const listId = (effectiveConfig as { defaultListId?: string }).defaultListId;
    if (!listId) {
      throw new NotFoundException('No defaultListId resolved from cascade — set one on the project / module binding first');
    }

    // Build the body. publicIssueUrl points at the platform's issue page.
    const webUrl = this.config.get<string>('WEB_URL') ?? 'http://localhost:3000';
    const publicIssueUrl = `${webUrl.replace(/\/+$/, '')}/issues/${issue.id}`;

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
    const created = await this.plugins.dispatch<CreateOut>(
      'createIssue',
      installId,
      {
        scope: { kind: 'issue', issueId: issue.id },
        title: body.name,
        description: body.markdown_description,
        severity: issue.severity.toLowerCase(),
        labels: body.tags,
      },
      effectiveConfig,
    );

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
          effectiveConfig,
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
