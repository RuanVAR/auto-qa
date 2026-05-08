import type { PluginManifest } from '../types';
import {
  ClickUpBindingConfigSchema,
  ClickUpInstallConfigSchema,
  ClickUpSecretsSchema,
  type ClickUpInstallConfig,
  type ClickUpSecrets,
} from './schemas';
import { clickupHealthCheck, clickupVerifyWebhook } from './lifecycle';
import { listEntities } from './capabilities/list-entities';
import { createIssue } from './capabilities/create-issue';
import { linkTicket } from './capabilities/link-ticket';
import { syncPhaseStatus } from './capabilities/sync-phase-status';
import { pullTicketStatus } from './capabilities/pull-ticket-status';
import { fetchTicketContext } from './capabilities/fetch-ticket-context';
import { attachArtifacts } from './capabilities/attach-artifacts';
import { listDocs } from './capabilities/list-docs';
import { fetchDoc } from './capabilities/fetch-doc';
import { ClickUpClient } from './clickup.client';
import type { PluginCtx } from '../types';
import { ensureWriteAllowed } from './write-guard';

/**
 * ClickUp plugin manifest — full Phase 2/3/4/5/6 capability surface.
 *
 * Writes are gated at the capability layer by ensureWriteAllowed (env-driven
 * kill switch). Reads run unconditionally.
 *
 * fieldHints power the auto-rendered binding form — the cascading workspace
 * → space → folder → list dropdowns key off `loader: 'listEntities'` with
 * `dependsOn` declaring the parent dependency chain.
 */
export const clickupManifest: PluginManifest<ClickUpInstallConfig, ClickUpSecrets> = {
  id: 'clickup',
  name: 'ClickUp',
  description:
    'Push QA tickets, sync phase status, attach artefacts, import acceptance criteria from ClickUp tasks, and link ClickUp Docs as feature specs.',
  version: '1.0.0',
  iconUrl: '/plugin-icons/clickup.svg',

  capabilities: [
    'createIssue',
    'linkTicket',
    'syncPhaseStatus',
    'pullTicketStatus',
    'fetchTicketContext',
    'attachArtifacts',
    'listDocs',
    'fetchDoc',
    'listEntities',
    'webhookListener',
  ],

  configSchema: ClickUpInstallConfigSchema,
  secretsSchema: ClickUpSecretsSchema,
  bindingConfigSchema: ClickUpBindingConfigSchema,

  rateLimit: { perMinute: 100 },                  // ClickUp PAT ceiling

  webhookEvents: ['taskStatusUpdated', 'taskUpdated', 'taskMoved', 'taskDeleted'],

  fieldHints: [
    // Install-level — only the workspace is captured at install time.
    {
      field: 'workspaceId',
      kind: 'select',
      label: 'Workspace',
      loader: 'listEntities',
      helpText: 'Pick the ClickUp workspace this install will operate against.',
    },

    // Binding-level — cascading picker.
    {
      field: 'spaceId',
      kind: 'select',
      label: 'Space',
      loader: 'listEntities',
      dependsOn: ['workspaceId'],
    },
    {
      field: 'folderId',
      kind: 'select',
      label: 'Folder',
      loader: 'listEntities',
      dependsOn: ['workspaceId', 'spaceId'],
      helpText: 'Choose "(no folder)" for spaces that house lists at the top level.',
    },
    {
      field: 'defaultListId',
      kind: 'select',
      label: 'Default list',
      loader: 'listEntities',
      dependsOn: ['workspaceId', 'spaceId', 'folderId'],
      helpText: 'Where new tickets land. Status mappings below pull from this list.',
    },
    {
      field: 'targetMode',
      kind: 'select',
      label: 'Mode',
      options: [
        { value: 'list', label: 'Top-level task in list' },
        { value: 'subtask', label: 'Subtask under a parent task' },
      ],
    },
    {
      field: 'defaultParentTaskId',
      kind: 'parent-task',
      label: 'Parent task',
      loader: 'listEntities',
      dependsOn: ['defaultListId', 'targetMode'],
      helpText: 'Required when mode = subtask.',
    },
    {
      field: 'attachRecordingMaxMb',
      kind: 'text',
      label: 'Recording attachment cap (MB)',
      helpText: 'Recordings larger than this become a description link instead of an upload.',
    },
  ],

  healthCheck: clickupHealthCheck,
  verifyWebhook: clickupVerifyWebhook,

  extractAffectedExternalIds: (payload: unknown): string[] => {
    const p = payload as { task_id?: string; history_items?: Array<{ data?: { task_id?: string } }> } | null;
    if (!p) return [];
    const ids = new Set<string>();
    if (p.task_id) ids.add(p.task_id);
    for (const h of p.history_items ?? []) if (h?.data?.task_id) ids.add(h.data.task_id);
    return [...ids];
  },

  handlers: {
    listEntities,
    createIssue,
    linkTicket,
    syncPhaseStatus,
    pullTicketStatus,
    fetchTicketContext,
    attachArtifacts,
    listDocs,
    fetchDoc,
  },

  // Webhook lifecycle — Phase 6 inbound sync.
  registerWebhook: async (ctx, callbackUrl, events) => {
    ensureWriteAllowed('registerWebhook', null);
    const wsId = ctx.config.workspaceId;
    if (!wsId) throw new Error('registerWebhook requires workspaceId on install config');
    const client = new ClickUpClient(ctx.http);
    const r = await client.registerWebhook(wsId, { endpoint: callbackUrl, events });
    return { externalId: r.id, secret: r.webhook?.secret ?? '' };
  },

  deregisterWebhook: async (ctx, externalId) => {
    ensureWriteAllowed('deregisterWebhook', null);
    const client = new ClickUpClient(ctx.http);
    await client.deregisterWebhook(externalId);
  },

  /**
   * handleWebhook routes ClickUp's event types to inbound sync logic. The
   * full InboundSyncService wiring lives outside the plugin (Phase 5/6); we
   * just record the event here and let that service re-pull via
   * pullTicketStatus on the next tick.
   */
  handleWebhook: async (ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>, payload: unknown) => {
    const event = payload as { event?: string; task_id?: string };
    ctx.logger.log(`webhook ${event.event ?? 'unknown'} task=${event.task_id ?? '?'}`);
    // TODO(Phase 5): InboundSyncService.refreshTicket(link, 'WEBHOOK')
  },
};
