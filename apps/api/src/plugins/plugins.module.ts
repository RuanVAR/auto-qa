import { Module, forwardRef } from '@nestjs/common';
import { PluginService } from './plugin.service';
import { EnablementService } from './enablement.service';
import { PhaseSyncService } from './phase-sync.service';
import { DefectSyncService } from './defect-sync.service';
import { PluginHealthCron } from './plugin-health.cron';
import { InboundSyncService } from './inbound-sync.service';
import { InboundSyncController } from './inbound-sync.controller';
import { DocsController } from './docs.controller';
import { DocsLocalController } from './docs-local.controller';
import { ScopeResolverService } from './scope-resolver.service';
import { TicketLinkingService } from './ticket-linking.service';
import { ClickUpBootstrapService } from './clickup/bootstrap.service';
import { ClickUpBootstrapController } from './clickup/bootstrap.controller';
import { IssuesModule } from '../modules/issues/issues.module';
import { PluginsController } from './plugins.controller';
import { BindingsController } from './bindings.controller';
import { WebhookReceiverController } from './webhook-receiver.controller';
import { pluginRegistry } from './registry';
import { clickupManifest } from './clickup';
import { gdriveManifest } from './gdrive';
import { GdriveOAuthController } from './gdrive/gdrive-oauth.controller';

/**
 * Wiring point for the plugin registry. Plugin manifests are registered here
 * (statically, at module init) — adding a new plugin is one import + one
 * `pluginRegistry.register()` line below. The runtime never dynamic-loads.
 */
@Module({
  imports: [forwardRef(() => IssuesModule)],
  controllers: [PluginsController, BindingsController, WebhookReceiverController, InboundSyncController, DocsController, DocsLocalController, ClickUpBootstrapController, GdriveOAuthController],
  providers: [PluginService, EnablementService, PhaseSyncService, DefectSyncService, PluginHealthCron, InboundSyncService, ScopeResolverService, TicketLinkingService, ClickUpBootstrapService],
  exports: [PluginService, EnablementService, PhaseSyncService, DefectSyncService, InboundSyncService, ScopeResolverService, TicketLinkingService],
})
export class PluginsModule {
  constructor() {
    // Idempotent: re-registration would throw, so wrap in a try in case the
    // module is constructed twice in tests.
    try {
      pluginRegistry.register(clickupManifest);
      pluginRegistry.register(gdriveManifest);
    } catch (err) {
      if (!String(err).includes('already registered')) throw err;
    }
  }
}
