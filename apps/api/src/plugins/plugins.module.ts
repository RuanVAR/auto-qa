import { Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { PluginService } from './plugin.service';
import { EnablementService } from './enablement.service';
import { PluginsController } from './plugins.controller';
import { BindingsController } from './bindings.controller';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { pluginRegistry } from './registry';

/**
 * Wiring point for the plugin registry. Plugin manifests are registered here
 * (statically, at module init) — adding a new plugin is one import + one
 * `pluginRegistry.register()` line below. The runtime never dynamic-loads.
 *
 * Phase 2 will add: `import { clickupManifest } from './clickup';
 *   pluginRegistry.register(clickupManifest);`
 */
@Module({
  controllers: [PluginsController, BindingsController, WebhookReceiverController],
  providers: [SecretsService, PluginService, EnablementService],
  exports: [SecretsService, PluginService, EnablementService],
})
export class PluginsModule {
  constructor() {
    // Phase 1: registry is empty until Phase 2 lands ClickUp.
    // Adding manifests here keeps the registration site obvious.
    void pluginRegistry; // eslint-disable-line @typescript-eslint/no-unused-expressions
  }
}
