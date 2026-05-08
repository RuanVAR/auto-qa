import type { PluginManifest, PluginCapability, PluginCatalogEntry } from './types';

/**
 * Static registry — populated at module init by importing each plugin's
 * `index.ts`. Nothing else creates plugins at runtime; nothing dynamic-loads
 * them. The registry is the single lookup table the rest of the system uses.
 *
 * Adding a plugin = three lines: import its manifest, register it here, ship.
 */
class PluginRegistry {
  private readonly plugins = new Map<string, PluginManifest>();

  register(manifest: PluginManifest): void {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`);
    }
    // Sanity: every declared capability has a handler (except webhookListener,
    // which uses manifest-level hooks rather than a handler entry).
    for (const cap of manifest.capabilities) {
      if (cap === 'webhookListener') {
        if (!manifest.verifyWebhook || !manifest.handleWebhook) {
          throw new Error(
            `Plugin ${manifest.id} declares webhookListener but is missing verifyWebhook/handleWebhook`,
          );
        }
        continue;
      }
      if (!manifest.handlers[cap]) {
        throw new Error(`Plugin ${manifest.id} declares capability ${cap} but has no handler`);
      }
    }
    this.plugins.set(manifest.id, manifest);
  }

  get(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId);
  }

  /** Throws if not present — used in service code where absence is a bug. */
  require(pluginId: string): PluginManifest {
    const m = this.plugins.get(pluginId);
    if (!m) throw new Error(`Plugin not found in registry: ${pluginId}`);
    return m;
  }

  listByCapability(capability: PluginCapability): PluginManifest[] {
    return [...this.plugins.values()].filter((p) => p.capabilities.includes(capability));
  }

  /** Public-facing catalog — strips lifecycle hooks + handlers. */
  catalog(): PluginCatalogEntry[] {
    return [...this.plugins.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      version: p.version,
      iconUrl: p.iconUrl,
      capabilities: p.capabilities,
      fieldHints: p.fieldHints,
    }));
  }

  /** Test-only — clears all registrations. Never call in production code. */
  _resetForTest(): void {
    this.plugins.clear();
  }
}

export const pluginRegistry = new PluginRegistry();
