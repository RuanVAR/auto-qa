import { Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { PluginService } from './plugin.service';
import { EnablementService } from './enablement.service';
import { PluginsController } from './plugins.controller';
import { BindingsController } from './bindings.controller';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { pluginRegistry } from './registry';
import { clickupManifest } from './clickup';

/**
 * Wiring point for the plugin registry. Plugin manifests are registered here
 * (statically, at module init) — adding a new plugin is one import + one
 * `pluginRegistry.register()` line below. The runtime never dynamic-loads.
 */
@Module({
  controllers: [PluginsController, BindingsController, WebhookReceiverController],
  providers: [SecretsService, PluginService, EnablementService],
  exports: [SecretsService, PluginService, EnablementService],
})
export class PluginsModule {
  constructor() {
    // Idempotent: re-registration would throw, so wrap in a try in case the
    // module is constructed twice in tests.
    try {
      pluginRegistry.register(clickupManifest);
    } catch (err) {
      if (!String(err).includes('already registered')) throw err;
    }
  }
}
