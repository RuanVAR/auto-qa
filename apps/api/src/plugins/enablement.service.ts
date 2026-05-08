import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginNotEnabledError } from './plugin.errors';
import type { PluginCapability } from './types';
import { pluginRegistry } from './registry';

/**
 * The 4-level enablement gate.
 *
 * NOTHING about a plugin appears in the UI, fires a notification, runs a
 * background job, or shows up in an API response unless the plugin is fully
 * enabled at every level of the cascade:
 *
 *   1. OrgPluginInstall exists, isEnabled, deletedAt=null, lastHealthOk=true
 *   2. ProjectPluginBinding exists for (project, install), deletedAt=null
 *   3. The capability is listed in binding.enabledCapabilities
 *   4. The plugin manifest declares the capability
 *
 * If any check fails, the API returns 404 (NOT 403) — leaking the existence
 * of an installed-but-unbound plugin would let curious project members enumerate
 * org integrations they're not entitled to know about.
 */
@Injectable()
export class EnablementService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve every install enabled for `capability` in the given project. */
  async getEnabledInstalls(
    projectId: string,
    capability: PluginCapability,
  ): Promise<EnabledInstall[]> {
    const bindings = await this.prisma.projectPluginBinding.findMany({
      where: {
        projectId,
        deletedAt: null,
        enabledCapabilities: { has: capability },
        install: { isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: { install: true },
    });

    return bindings
      .filter((b) => {
        const manifest = pluginRegistry.get(b.install.pluginId);
        return manifest?.capabilities.includes(capability);
      })
      .map((b) => ({
        installId: b.install.id,
        bindingId: b.id,
        pluginId: b.install.pluginId,
        pluginVersion: b.install.pluginVersion,
        displayLabel: b.install.displayLabel ?? null,
      }));
  }

  /** True if at least one install satisfies the gate for this capability + project. */
  async isEnabled(projectId: string, capability: PluginCapability): Promise<boolean> {
    const installs = await this.getEnabledInstalls(projectId, capability);
    return installs.length > 0;
  }

  /**
   * Throw if no install satisfies the gate. Used at the top of every
   * capability-consuming endpoint so the rest of the handler can assume
   * at least one usable install.
   */
  async requireEnabled(
    projectId: string,
    capability: PluginCapability,
    pluginId?: string,
  ): Promise<EnabledInstall[]> {
    const installs = await this.getEnabledInstalls(projectId, capability);
    const filtered = pluginId ? installs.filter((i) => i.pluginId === pluginId) : installs;
    if (filtered.length === 0) {
      throw new PluginNotEnabledError(pluginId ?? '*', capability, `project:${projectId}`);
    }
    return filtered;
  }
}

export type EnabledInstall = {
  installId: string;
  bindingId: string;
  pluginId: string;
  pluginVersion: string;
  displayLabel: string | null;
};
