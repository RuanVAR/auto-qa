import type { AxiosInstance } from 'axios';
import type { Logger } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Capability identifiers — the contract surface every plugin can opt into.
 * Adding a new capability requires:
 *   1. add the literal here
 *   2. add a *.types.ts file under capabilities/ with the input/output shape
 *   3. extend PluginManifest.handlers map
 */
export type PluginCapability =
  | 'createIssue'         // POST: create external task/issue from a finding
  | 'linkTicket'          // POST: link an existing external ticket to a feature/issue/finding
  | 'syncPhaseStatus'     // PUT:  push platform phase transition → external status
  | 'pullTicketStatus'    // GET:  fetch current external status (snapshot)
  | 'fetchTicketContext'  // GET:  description + comments (for AC import + AI prompts)
  | 'attachArtifacts'     // POST: upload screenshot / recording / log to external ticket
  | 'listDocs'            // GET:  list available external docs (for binding pickers)
  | 'fetchDoc'            // GET:  fetch markdown body of a doc
  | 'sendNotification'    // POST: chat-style message (Slack-shaped capability)
  | 'listEntities'        // GET:  generic browsing endpoint for binding-picker cascades
  | 'updateAssignees'     // PUT:  add/remove assignees on an existing external task
  | 'addTicketComment'    // POST: add a free-text comment to an external ticket
  | 'webhookListener';    // INBOUND: HMAC verify + handle external webhooks

/**
 * Hint for the auto-rendered binding form. Tells the UI how to pick values
 * for a particular config field.
 *
 * - kind=select       → static dropdown from `options`
 * - kind=multiselect  → static multi from `options`
 * - kind=autocomplete → typeahead; UI calls `loader` capability with current text
 * - kind=parent-task  → ClickUp subtask mode helper; UI shows recent tasks in the chosen list
 * - kind=text         → plain string input
 * - kind=secret       → masked input (write-only — never returned in API)
 *
 * `dependsOn` lists other field paths whose values must be present before this
 * field's loader fires. Lets us model "Workspace → Space → Folder → List" cascades.
 */
export type FieldHint = {
  field: string;                                         // dotted path in config, e.g. "defaultListId"
  kind: 'select' | 'multiselect' | 'autocomplete' | 'parent-task' | 'text' | 'secret';
  options?: { value: string; label: string }[];
  loader?: PluginCapability;                             // capability called to load options dynamically
  dependsOn?: string[];                                  // field paths required first
  label?: string;
  helpText?: string;
};

/**
 * Per-dispatch context handed to each capability handler.
 *
 * Secrets are decrypted in-memory only when dispatch() is called. Handlers
 * MUST treat `secrets` as opaque — never log it, never store it elsewhere.
 */
export type PluginCtx<C = unknown, S = Record<string, string>> = {
  orgId: string;
  installId: string;
  pluginId: string;
  pluginVersion: string;

  /** Pre-configured axios instance: auth header injected, retries + rate-limit applied. */
  http: AxiosInstance;

  /** Decrypted secrets (e.g. apiToken). Lifetime = single dispatch call. */
  secrets: S;

  /** Resolved effective config — feature → module → project → defaults. */
  config: C;

  logger: Logger;
};

/**
 * The single source of truth for a plugin's contract. A static registry maps
 * pluginId → manifest at boot time; nothing else ever instantiates plugins.
 */
export type PluginManifest<C = unknown, S = Record<string, string>> = {
  id: string;                                  // "clickup", "jira", "slack"
  name: string;                                // "ClickUp"
  description: string;
  version: string;                             // semver — frozen on install
  iconUrl?: string;
  capabilities: PluginCapability[];

  /** Validates non-secret install config. */
  configSchema: ZodSchema<C>;
  /** Validates per-binding override config (project/module/feature scope). */
  bindingConfigSchema?: ZodSchema<unknown>;
  /** Validates secrets dictionary at install-time. */
  secretsSchema: ZodSchema<S>;

  fieldHints?: FieldHint[];

  /** Ceiling that the plugin HTTP client uses to size its Redis token bucket. */
  rateLimit?: { perMinute: number };

  /** API base URL — every dispatch's http client mounts here. */
  baseURL?: string;

  /** Webhook event names this plugin understands (for handlers + registration). */
  webhookEvents?: string[];

  /** GET /user or equivalent — flips lastHealthOk in OrgPluginInstall. */
  healthCheck: (ctx: PluginCtx<C, S>) => Promise<{ ok: boolean; error?: string; connectedAs?: string }>;

  /**
   * Capability handlers. Map keys MUST be a subset of `capabilities`.
   * Throw subclasses of PluginError; dispatch() turns them into the right outcomes.
   */
  handlers: Partial<{
    [K in PluginCapability]: (ctx: PluginCtx<C, S>, payload: unknown) => Promise<unknown>;
  }>;

  // ── Webhook lifecycle (only required if "webhookListener" in capabilities) ──

  /** Per-plugin HMAC verification — keep crypto inside the plugin. */
  verifyWebhook?: (rawBody: Buffer, headers: Record<string, string>, signingSecret: string) => boolean;

  /** Handle a verified webhook payload — typically refreshes a TicketLink. */
  handleWebhook?: (ctx: PluginCtx<C, S>, payload: unknown) => Promise<void>;

  /**
   * Plugin-specific extractor that pulls the external entity ids referenced in
   * a verified webhook payload. The receiver uses these to find matching
   * TicketLink rows and trigger inbound sync. Returning an empty array is
   * acceptable — it just means no sync work for this event type.
   */
  extractAffectedExternalIds?: (payload: unknown) => string[];

  /** Register a webhook with the upstream system on binding-enable. */
  registerWebhook?: (
    ctx: PluginCtx<C, S>,
    callbackUrl: string,
    events: string[],
  ) => Promise<{ externalId: string; secret: string }>;

  /** Tear down a registered webhook on binding-disable. */
  deregisterWebhook?: (ctx: PluginCtx<C, S>, externalId: string) => Promise<void>;
};

/** Catalog entry returned by GET /plugins (no manifest internals leaked). */
export type PluginCatalogEntry = {
  id: string;
  name: string;
  description: string;
  version: string;
  iconUrl?: string;
  capabilities: PluginCapability[];
  fieldHints?: FieldHint[];
};
