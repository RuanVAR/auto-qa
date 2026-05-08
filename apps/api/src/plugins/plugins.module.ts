import { Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { PluginService } from './plugin.service';
import { EnablementService } from './enablement.service';
import { PhaseSyncService } from './phase-sync.service';
import { PluginHealthCron } from './plugin-health.cron';
import { InboundSyncService } from './inbound-sync.service';
import { InboundSyncController } from './inbound-sync.controller';
import { IssuesModule } from '../modules/issues/issues.module';
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
  imports: [IssuesModule],
  controllers: [PluginsController, BindingsController, WebhookReceiverController, InboundSyncController],
  providers: [SecretsService, PluginService, EnablementService, PhaseSyncService, PluginHealthCron, InboundSyncService],
  exports: [SecretsService, PluginService, EnablementService, PhaseSyncService, InboundSyncService],
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
