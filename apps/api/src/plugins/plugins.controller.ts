import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../common/guards/org-role.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';
import { ScopeResolverService } from './scope-resolver.service';
import { pluginRegistry } from './registry';

/**
 * Org-level plugin endpoints.
 *
 * Public catalog is open to any authenticated user (so the install dialog can
 * render). Everything else (list / install / update / uninstall / health-check)
 * requires ORG_ADMIN.
 *
 * Secrets ARE NEVER returned. The response shape for an install row is
 * deliberately narrow: id, pluginId, displayLabel, isEnabled, config, health
 * fields, createdAt/updatedAt. `secretsCiphertext` and `secretsKeyId` stay
 * server-side.
 */
@ApiTags('plugins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgRoleGuard)
@Controller()
export class PluginsController {
  constructor(
    private readonly pluginService: PluginService,
    private readonly prisma: PrismaService,
    private readonly scopeResolver: ScopeResolverService,
  ) {}

  // ── Public catalog (any authenticated user) ───────────────────────────────

  @Get('plugins')
  @ApiOperation({ summary: 'List available plugin manifests (the catalog)' })
  catalog() {
    return pluginRegistry.catalog();
  }

  // ── Org-scoped install management (ORG_ADMIN) ─────────────────────────────

  @Get('orgs/:orgId/plugin-installs')
  @ApiOperation({ summary: 'List plugin installs for an org' })
  list(@Param('orgId') orgId: string) {
    return this.prisma.orgPluginInstall
      .findMany({
        where: { orgId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
      })
      .then((installs) => installs.map(toPublic));
  }

  @Get('orgs/:orgId/plugin-installs/:id')
  @ApiOperation({ summary: 'Get a single plugin install' })
  async get(@Param('orgId') orgId: string, @Param('id') id: string) {
    const install = await this.prisma.orgPluginInstall.findFirst({
      where: { id, orgId, deletedAt: null },
    });
    return install ? toPublic(install) : null;
  }

  @Post('orgs/:orgId/plugin-installs')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Install a plugin at org level' })
  async install(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      pluginId: string;
      displayLabel?: string;
      config: unknown;
      secrets: Record<string, string>;
    },
  ) {
    const install = await this.pluginService.install({
      orgId,
      pluginId: body.pluginId,
      displayLabel: body.displayLabel,
      config: body.config,
      secrets: body.secrets,
      installedById: user.sub,
    });
    return toPublic(install);
  }

  @Patch('orgs/:orgId/plugin-installs/:id')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Update plugin config / secrets / enabled flag' })
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      config?: unknown;
      secrets?: Record<string, string>;
      displayLabel?: string | null;
      isEnabled?: boolean;
    },
  ) {
    const install = await this.pluginService.update(id, body);
    return toPublic(install);
  }

  @Delete('orgs/:orgId/plugin-installs/:id')
  @OrgRoles('ORG_ADMIN')
  @HttpCode(204)
  @ApiOperation({ summary: 'Uninstall (soft-delete + zero secrets ciphertext)' })
  async uninstall(@Param('id') id: string) {
    await this.pluginService.uninstall(id);
  }

  @Post('orgs/:orgId/plugin-installs/:id/health-check')
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Re-run the plugin health check' })
  healthCheck(@Param('id') id: string) {
    return this.pluginService.healthCheck(id);
  }

  /**
   * Generic capability dispatch at the install scope.
   *
   * Used by the binding-form UI to call `listEntities` (cascading pickers).
   * Other write capabilities (createIssue / syncPhaseStatus / attachArtifacts)
   * still flow through this endpoint, but the write guard inside the plugin
   * vetoes them when CLICKUP_DEV_WRITE_MODE is not 'live'.
   *
   * Effective config: when `bindingId` is present, the binding's
   * `bindingConfig` overrides install.config (single layer for now —
   * module/feature cascade lands when those binding scopes get UIs).
   */
  @Post('orgs/:orgId/plugin-installs/:id/dispatch')
  @ApiOperation({ summary: 'Invoke a plugin capability against an install (RBAC: see capability guards)' })
  async dispatch(
    @Param('id') id: string,
    @Body()
    body: {
      capability: import('./types').PluginCapability;
      payload?: unknown;
      bindingId?: string;
    },
  ) {
    // Walk the full cascade: feature → module → project → install. The
    // payload's `scope` field (used by createIssue / linkTicket etc.)
    // tells us where the dispatch is rooted; ScopeResolverService walks
    // forward from there to derive moduleId/projectId.
    const payloadScope = (body.payload as { scope?: { kind: string; featureId?: string; moduleId?: string; projectId?: string; issueId?: string } })?.scope;
    const scopeForCascade = payloadScope
      ? {
          featureId: payloadScope.featureId,
          moduleId: payloadScope.moduleId,
          projectId: payloadScope.projectId,
          issueId: payloadScope.issueId,
        }
      : null;

    const effectiveConfig = await this.scopeResolver.resolve(id, scopeForCascade);
    return this.pluginService.dispatch(body.capability, id, body.payload ?? {}, effectiveConfig);
  }
}

/** Public response shape — strips secrets fields. */
function toPublic(install: {
  id: string;
  orgId: string;
  pluginId: string;
  pluginVersion: string;
  displayLabel: string | null;
  isEnabled: boolean;
  config: unknown;
  lastHealthOk: boolean;
  lastHealthAt: Date | null;
  lastHealthError: string | null;
  installedById: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: install.id,
    orgId: install.orgId,
    pluginId: install.pluginId,
    pluginVersion: install.pluginVersion,
    displayLabel: install.displayLabel,
    isEnabled: install.isEnabled,
    config: install.config,
    lastHealthOk: install.lastHealthOk,
    lastHealthAt: install.lastHealthAt,
    lastHealthError: install.lastHealthError,
    installedById: install.installedById,
    createdAt: install.createdAt,
    updatedAt: install.updatedAt,
  };
}
