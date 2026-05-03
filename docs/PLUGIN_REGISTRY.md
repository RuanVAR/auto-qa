# Plugin Registry — Unified Integration Architecture

**Phase target:** Phase 5.3 refactor + Phase 5.8 rewrite (supersedes current two-system design)
**Status:** Planned — not implemented.
**Related docs:** `docs/PM_INTEGRATIONS.md` (ClickUp — consumer of this registry), `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` (Slack/Email/Teams — to be refactored against this registry), `docs/EXTENDED_INTEGRATIONS.md` (Phase 10 additional plugins — consumers), `docs/EXPLORATORY_TESTING.md` (findings → ticket flow via this registry), `docs/FEATURE_PLAYER.md` (doc pill consumes `fetchDocs` capability).

This document specifies **a single, unified plugin registry** that subsumes the platform's two previously-parallel integration systems (`OrgPlugin` PM tier + `IntegrationPlugin` notifications tier) into one extensible architecture. ClickUp, Jira, Slack, Discord, GitHub, Linear, PagerDuty, and future integrations all plug in through the same contract.

---

## 1. Core Concepts

### 1.1 What a Plugin Is

A **Plugin** is a typed integration with an external system. Each plugin:
- Declares a **manifest** (id, version, display name, icon, description)
- Opts into a set of **capabilities** (what it can do — e.g. `createIssue`, `notify`, `fetchDocs`)
- Declares a **config schema** (non-secret config — e.g. workspace id) and a **secrets schema** (encrypted — e.g. API token)
- Implements **lifecycle hooks** (`onEnable`, `onDisable`, `healthCheck`, `onConfigChange`)
- Implements each capability it claims via a typed method

The **core platform** advertises **capability slots**. Features across the platform (issue creation, notification send, phase sync, AC import, doc display) call through the registry by capability — never by plugin id — so features stay plugin-agnostic.

### 1.2 Why Capabilities (Not a Fat Interface)

A notifier-only plugin (e.g. Discord) should not have to stub `createIssue()`. A ticket-only plugin (e.g. GitHub Issues) should not have to stub `notify()`. Capabilities are the **opt-in contract** — each plugin declares which slots it fills, and the registry only routes calls to plugins that declared the capability.

### 1.3 Scope of "Plugin"

| Used for | Example plugins |
|---|---|
| PM / ticket systems | ClickUp, Jira, Linear, GitHub Issues, GitLab Issues |
| Chat / notifications | Slack, Teams, Discord, Google Chat |
| Email | SMTP, SendGrid, Postmark |
| Alerts / paging | PagerDuty, Opsgenie |
| Docs sources | ClickUp Docs, Confluence, Notion (future) |
| Time tracking | ClickUp time, Harvest, Toggl (future) |
| VCS | GitHub, GitLab, Bitbucket (future, partially overlaps with `CODEBASE_AWARE_TESTING.md`) |
| Webhooks | Generic inbound/outbound webhook |

---

## 2. Capability Taxonomy

Capabilities are the opt-in interface slots. **Phase 1 ships with these nine**:

| Capability | Purpose | Required methods |
|---|---|---|
| `notify` | Send a message (channel, DM, webhook, email) | `notify(payload, config): Promise<NotifyResult>` |
| `createIssue` | Create a bug / feedback / ticket in an external system | `createIssue(payload, config): Promise<IssueRef>` |
| `linkTicket` | Resolve / validate an existing external ticket by URL or ID | `linkTicket(urlOrId, config): Promise<TicketRef>` |
| `pullTicketStatus` | **Read** the current external state of a linked ticket (status, assignees, updated time) — powers the Refresh button + webhook inbound path | `pullTicketStatus(ticketRef, config): Promise<ExternalTicketState>` |
| `syncPhaseStatus` | Push a QA→UAT→Sign-off phase status change to the external system | `syncPhaseStatus(ticketRef, phase, config): Promise<void>` |
| `fetchTicketContext` | Pull a ticket's description/AC/comments for AI test generation | `fetchTicketContext(ticketRef, config): Promise<TicketContext>` |
| `fetchDocs` | List / search / fetch Docs/Pages for linking to project/module/feature | `listDocs(config, query?)`, `fetchDoc(docId, config)` |
| `logTime` | Log time entries (ClickUp time, Harvest) | `logTime(entry, config): Promise<void>` |
| `webhookListener` | Accept inbound webhook events from external system — validates HMAC signature, routes events to capability handlers (e.g. `taskStatusUpdated` → inbound sync path) | `registerWebhook(ctx): Promise<WebhookHandle>`, `handleWebhook(req, config): Promise<WebhookResult>` |

> **Capability expansion is non-breaking.** Adding a new capability (e.g. `screenRecord`, `alertRoute`, `branchEnvironment`) does not break existing plugins — they simply don't opt in.

### 2.1 Capability signatures (shared types)

```typescript
// apps/api/src/plugins/capabilities/types.ts

export interface NotifyPayload {
  title:    string;
  body:     string;                 // markdown
  severity: 'info' | 'warn' | 'error' | 'critical';
  links?:   { label: string; url: string }[];
  meta?:    Record<string, unknown>;
}
export interface NotifyResult {
  messageId?: string;
  deliveredAt: Date;
}

export interface CreateIssuePayload {
  title:       string;
  description: string;              // markdown
  severity?:   'low' | 'medium' | 'high' | 'critical';
  labels?:     string[];
  assigneeExternalId?: string;
  attachments?: Attachment[];       // screenshots, recordings
  // Targeting:
  targetMode:  'list' | 'subtask';  // list=new task in list, subtask=child of parent
  targetId:    string;              // listId or parentTaskId
  parentContext?: {                 // when targetMode='subtask' we may inject a reference line
    url: string;
    title: string;
  };
}

export interface Attachment {
  storageKey: string;               // S3 path on our side
  filename:   string;
  mimeType:   string;
  sizeBytes:  number;
}

export interface IssueRef {
  externalId:  string;
  externalUrl: string;
  externalSystem: string;           // plugin id
  externalListId?: string;
  parentExternalId?: string;
}

export interface TicketRef {
  externalId:  string;
  externalUrl: string;
  title:       string;
  status?:     string;
  assignees?:  { externalId: string; displayName: string; avatarUrl?: string }[];
}

// Returned by pullTicketStatus — richer than TicketRef because it carries
// visual metadata (colour, type) so our UI can mirror the external system
export interface ExternalTicketState {
  externalId:         string;
  externalUrl:        string;
  title:              string;

  externalStatus:     string;                           // e.g. "Ready for QA"
  externalStatusColor?: string;                         // hex from external system
  externalStatusType?: 'open' | 'custom' | 'closed';    // lets us auto-group

  assignees:          { externalId: string; displayName: string; avatarUrl?: string }[];
  priority?:          number | string;
  lastUpdatedAt:      Date;                             // source-of-truth timestamp
  fetchedAt:          Date;

  rawTask?:           Record<string, unknown>;          // optional passthrough for custom fields
}

// Webhook infrastructure
export interface WebhookHandle {
  externalWebhookId: string;                            // id returned by external system
  events:            string[];                          // subscribed event names
  endpoint:          string;                            // our public URL
  signingSecret:     string;                            // for HMAC verification
}

export interface WebhookResult {
  handled:       boolean;
  eventType?:    string;
  affectedIds?:  string[];                              // external ids we matched to TicketLinks
  errors?:       string[];
}

export interface TicketContext {
  title:       string;
  description: string;              // markdown preferred
  acceptanceCriteria?: string[];
  comments?:   { author: string; body: string; createdAt: Date }[];
  customFields?: Record<string, unknown>;
  fetchedAt:   Date;
}

export interface DocSummary {
  externalId:  string;
  title:       string;
  url:         string;
  workspaceId?: string;
  spaceId?:    string;
  updatedAt?:  Date;
}
export interface DocContent {
  externalId:  string;
  title:       string;
  url:         string;
  bodyMarkdown: string;
  pages?:      { id: string; title: string; bodyMarkdown: string }[];
  fetchedAt:   Date;
}

export interface LogTimePayload {
  ticketRef:   TicketRef;
  userEmail:   string;              // plugin maps to external user
  durationMs:  number;
  description?: string;
  startedAt:   Date;
}
```

---

## 3. Plugin Manifest

Every plugin ships a manifest describing itself. Manifests are **statically declared** in TypeScript — no YAML, no runtime discovery (v1).

```typescript
// apps/api/src/plugins/types.ts

export interface PluginManifest<Config extends object, Secrets extends object> {
  id:           string;                 // "clickup", "jira", "slack" — stable URL-safe
  displayName:  string;                 // "ClickUp"
  description:  string;                 // one-liner for admin UI
  iconUrl:      string;                 // static asset in apps/web/public/plugin-icons
  version:      string;                 // semver; used for migration detection
  website?:     string;                 // vendor link

  capabilities: PluginCapability[];     // opt-in list

  // Zod schemas — power the auto-generated admin UI + runtime validation
  configSchema:  ZodSchema<Config>;     // non-secret config
  secretsSchema: ZodSchema<Secrets>;    // encrypted at rest

  // Plugin-specific UX hints for the admin form
  configUiHints?: Record<keyof Config, FieldHint>;
  secretsUiHints?: Record<keyof Secrets, FieldHint>;

  // Lifecycle
  lifecycle: PluginLifecycle<Config, Secrets>;

  // Capability implementations — TypeScript narrows based on `capabilities` array
  implementations: PluginImplementations<Config, Secrets>;
}

export type PluginCapability =
  | 'notify'
  | 'createIssue'
  | 'linkTicket'
  | 'syncPhaseStatus'
  | 'fetchTicketContext'
  | 'fetchDocs'
  | 'logTime'
  | 'webhookListener';

export interface FieldHint {
  label:       string;
  placeholder?: string;
  help?:       string;
  inputType?:  'text' | 'password' | 'select' | 'textarea' | 'url' | 'number';
  options?:    { value: string; label: string }[];
  // For cascading selectors (e.g. workspace → space → list)
  dependsOn?:  string;
  fetchOptions?: (parentValue: string, plugin: PluginHandle) => Promise<{ value: string; label: string }[]>;
}

export interface PluginLifecycle<Config, Secrets> {
  onEnable?:        (ctx: PluginCtx<Config, Secrets>) => Promise<void>;
  onDisable?:       (ctx: PluginCtx<Config, Secrets>) => Promise<void>;
  onConfigChange?:  (ctx: PluginCtx<Config, Secrets>, previous: Config) => Promise<void>;
  healthCheck:      (ctx: PluginCtx<Config, Secrets>) => Promise<HealthResult>;
}
export interface HealthResult {
  ok:        boolean;
  message?:  string;
  details?:  Record<string, unknown>;
  checkedAt: Date;
}

export interface PluginCtx<Config, Secrets> {
  orgId:   string;
  config:  Config;
  secrets: Secrets;
  logger:  Logger;
  http:    HttpClient;                  // pre-configured Axios with retry + rate-limit middleware
  redis:   Redis;                       // scoped to `plugin:{orgId}:{pluginId}:*`
}
```

### 3.1 Example manifest (skeleton)

```typescript
// apps/api/src/plugins/clickup/index.ts
import { PluginManifest } from '../types';
import { clickupConfigSchema, clickupSecretsSchema } from './schemas';
import { lifecycle } from './lifecycle';
import { implementations } from './implementations';

export const clickupPlugin: PluginManifest<ClickUpConfig, ClickUpSecrets> = {
  id:          'clickup',
  displayName: 'ClickUp',
  description: 'Sync features, push bugs, pull Docs and ACs from ClickUp',
  iconUrl:     '/plugin-icons/clickup.svg',
  version:     '1.0.0',
  website:     'https://clickup.com',

  capabilities: ['createIssue', 'linkTicket', 'syncPhaseStatus', 'fetchTicketContext', 'fetchDocs'],

  configSchema:  clickupConfigSchema,
  secretsSchema: clickupSecretsSchema,

  configUiHints:  { /* ... */ },
  secretsUiHints: { /* ... */ },

  lifecycle,
  implementations,
};
```

### 3.2 Static registry

```typescript
// apps/api/src/plugins/registry.ts
import { clickupPlugin } from './clickup';
import { jiraPlugin }    from './jira';
import { slackPlugin }   from './slack';
// ... etc

export const pluginRegistry: Record<string, PluginManifest<any, any>> = {
  clickup: clickupPlugin,
  jira:    jiraPlugin,
  slack:   slackPlugin,
};

export function getPlugin(id: string) {
  const p = pluginRegistry[id];
  if (!p) throw new PluginNotFoundError(id);
  return p;
}
export function listPluginsByCapability(cap: PluginCapability) {
  return Object.values(pluginRegistry).filter(p => p.capabilities.includes(cap));
}
```

**Adding a new plugin in Phase 2+** = one new directory under `apps/api/src/plugins/{id}/` + one line in the registry. No core changes.

---

## 4. Data Model (Refactor of Existing Schema)

> **Refactor approach.** Existing `OrgPlugin`, `OrgPluginType`, `ProjectPluginConfig`, `ProjectPluginStatusMapping`, `FeatureTicketLink`, `TicketLinkType`, and the `IntegrationPlugin` (unimplemented) designs are superseded by the models below. No production data to migrate. The old models are **dropped** in the migration; the new models take over.

### 4.1 Prisma schema additions

```prisma
// ─── Plugin Registry ─────────────────────────────────────────────────────────

// Installed plugins at the org level — stores encrypted secrets and non-secret config
model OrgPluginInstall {
  id              String    @id @default(uuid())
  orgId           String
  pluginId        String                          // "clickup", "jira", ...
  pluginVersion   String                          // frozen at install; used for migration triggers

  displayLabel    String?                         // optional — "Acme ClickUp (primary)" when same plugin installed twice
  isEnabled       Boolean   @default(true)

  // Non-secret config (JSON validated at write-time against plugin.configSchema)
  config          Json                            // e.g. { workspaceId, defaultSpaceId }

  // Secrets — encrypted via AES-256-GCM with key from SECRETS_KEK env var (see §9)
  secretsCiphertext Bytes                         // raw encrypted blob
  secretsKeyId    String                          // key rotation identifier

  // Health
  lastHealthOk    Boolean   @default(false)
  lastHealthAt    DateTime?
  lastHealthError String?

  // Metadata
  installedById   String
  deletedAt       DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  org             Organisation @relation(fields: [orgId], references: [id], onDelete: Cascade)
  installedBy     User         @relation(fields: [installedById], references: [id])

  projectBindings ProjectPluginBinding[]
  moduleBindings  ModulePluginBinding[]
  featureBindings FeaturePluginBinding[]
  docLinks        DocLink[]

  @@unique([orgId, pluginId, displayLabel])
  @@index([orgId, pluginId])
  @@map("org_plugin_installs")
}

// Project-level binding + config override
model ProjectPluginBinding {
  id                 String   @id @default(uuid())
  orgId              String
  projectId          String
  installId          String                        // OrgPluginInstall id

  // Capability-specific config — matches the plugin's `bindingConfigSchema`
  // Examples:
  //   ClickUp: { defaultListId, targetMode: 'list'|'subtask', defaultParentTaskId? }
  //   Slack:   { defaultChannelId }
  //   Jira:    { projectKey }
  bindingConfig      Json

  // Which capabilities are active at this project level (subset of install.plugin.capabilities)
  enabledCapabilities String[] @default([])

  deletedAt          DateTime?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  install            OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)
  project            Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  statusMappings     PluginStatusMapping[]

  @@unique([projectId, installId])
  @@index([orgId, projectId])
  @@map("project_plugin_bindings")
}

// Module-level override (cascading config — see §5)
model ModulePluginBinding {
  id              String   @id @default(uuid())
  moduleId        String
  installId       String

  // Partial override — only the fields set here override the project binding
  bindingConfig   Json                              // partial shape

  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  install         OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)
  module          Module           @relation(fields: [moduleId], references: [id], onDelete: Cascade)

  @@unique([moduleId, installId])
  @@map("module_plugin_bindings")
}

// Feature-level override
model FeaturePluginBinding {
  id              String   @id @default(uuid())
  featureId       String
  installId       String

  bindingConfig   Json                              // partial shape

  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  install         OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)
  feature         Feature          @relation(fields: [featureId], references: [id], onDelete: Cascade)

  @@unique([featureId, installId])
  @@map("feature_plugin_bindings")
}

// Status mapping — bi-directional between platform values and external statuses.
// OUTBOUND:  platformValue (e.g. phase "UAT") → externalValue (e.g. "Ready for UAT")
// INBOUND:   externalValue (e.g. "Resolved") → platformValue (e.g. issue status "RESOLVED")
// Same row can serve both directions when direction = BIDIRECTIONAL (phase ↔ external status).
model PluginStatusMapping {
  id             String   @id @default(uuid())
  bindingId      String
  direction      MappingDirection
  targetType     MappingTargetType

  platformValue  String                             // phase name OR issue status string
  externalValue  String                             // e.g. "Ready for UAT", "Resolved"

  // When direction=INBOUND and targetType=ISSUE_STATUS, the QA platform shows a toast
  // "ClickUp says {externalValue} → map to {platformValue}? [Apply]" by default.
  // If binding.autoApplyInboundStatus=true, skip the toast and apply immediately.

  binding        ProjectPluginBinding @relation(fields: [bindingId], references: [id], onDelete: Cascade)

  @@unique([bindingId, direction, targetType, platformValue, externalValue])
  @@index([bindingId, direction])
  @@map("plugin_status_mappings")
}

enum MappingDirection   { OUTBOUND  INBOUND  BIDIRECTIONAL }
enum MappingTargetType  { PHASE  ISSUE_STATUS }

// External ticket link — generalised (replaces FeatureTicketLink)
model TicketLink {
  id              String   @id @default(uuid())
  orgId           String
  installId       String

  // What this link attaches to — exactly one of these is set
  featureId       String?
  moduleId        String?
  projectId       String?
  findingId       String?                           // SessionFinding (exploratory)
  issueId         String?                           // manual testing Issue / Snag

  // External entity
  externalId      String                            // task id / issue number / etc.
  externalUrl     String
  externalTitle   String?

  // External status snapshot (updated by pullTicketStatus + webhook path)
  externalStatus        String?
  externalStatusColor   String?                     // hex from external system
  externalStatusType    String?                     // "open" | "custom" | "closed"
  externalAssignees     Json?                       // [{ externalId, displayName, avatarUrl }]
  externalLastUpdatedAt DateTime?                   // last change upstream (from API / webhook)

  // Outbound sync state
  lastOutboundSyncAt    DateTime?                   // last time WE pushed a status to them
  lastOutboundSyncError String?

  // Inbound sync state
  lastInboundSyncAt     DateTime?                   // last time WE pulled their status
  lastInboundSyncError  String?
  lastInboundSource     InboundSource?              // MANUAL_REFRESH | WEBHOOK | BULK_SYNC

  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  install         OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)
  feature         Feature?         @relation(fields: [featureId], references: [id])
  module          Module?          @relation(fields: [moduleId], references: [id])
  project         Project?         @relation(fields: [projectId], references: [id])

  @@unique([installId, externalId, featureId])
  @@index([orgId, featureId])
  @@map("ticket_links")
}

enum InboundSource { MANUAL_REFRESH  WEBHOOK  BULK_SYNC }

// Pending inbound status suggestion — when the external system reports a status
// change and autoApplyInboundStatus=false OR no mapping exists, we record the
// suggestion here and notify the user. User clicks "Apply" in the toast to consume it.
model TicketStatusSuggestion {
  id              String   @id @default(uuid())
  ticketLinkId    String

  externalStatus  String
  mappedStatus    String?                           // null = no mapping found; admin must create one
  suggestionKind  SuggestionKind                    // AUTO_APPLIED | PENDING_APPROVAL | UNMAPPED

  appliedById     String?                           // user who clicked Apply
  appliedAt       DateTime?
  dismissedById   String?
  dismissedAt     DateTime?

  createdAt       DateTime @default(now())

  ticketLink      TicketLink @relation(fields: [ticketLinkId], references: [id], onDelete: Cascade)

  @@index([ticketLinkId, appliedAt])
  @@map("ticket_status_suggestions")
}

enum SuggestionKind { AUTO_APPLIED  PENDING_APPROVAL  UNMAPPED }

// External doc link — many-to-many (a doc can link to project + module + feature simultaneously)
model DocLink {
  id             String   @id @default(uuid())
  orgId          String
  installId      String

  // Scope — at least one is set; all three may be set (multi-scope)
  projectId      String?
  moduleId       String?
  featureId      String?

  externalId     String                              // ClickUp Doc id
  externalUrl    String
  title          String
  summary        String?                             // short summary (AI-generated or first 200 chars)

  // Cache
  cachedMarkdown String?                             // snapshot for offline / fast render
  cachedAt       DateTime?
  cacheExpiresAt DateTime?

  deletedAt      DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  install        OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)
  project        Project?         @relation(fields: [projectId], references: [id])
  module         Module?          @relation(fields: [moduleId], references: [id])
  feature        Feature?         @relation(fields: [featureId], references: [id])

  @@index([orgId, featureId])
  @@index([orgId, moduleId])
  @@index([orgId, projectId])
  @@map("doc_links")
}

// Webhook endpoints exposed by the platform for plugins that declare `webhookListener`
model PluginWebhookEndpoint {
  id           String   @id @default(uuid())
  installId    String
  path         String   @unique                      // /webhooks/plugins/{orgId}/{installId}/{token}
  signingSecret String                               // validates incoming payloads
  isActive     Boolean  @default(true)
  lastCalledAt DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  install      OrgPluginInstall @relation(fields: [installId], references: [id], onDelete: Cascade)

  @@map("plugin_webhook_endpoints")
}
```

### 4.2 What gets dropped

The following are removed in the refactor migration:

- `OrgPlugin`, `OrgPluginType` enum
- `ProjectPluginConfig`, `ProjectPluginStatusMapping`
- `FeatureTicketLink`, `TicketLinkType` enum
- `Issue.externalTicketId` / `externalTicketUrl` / `externalSystem` / `pushedExternallyAt` → replaced with a `TicketLink` record where `issueId = this.id`

Migration file naming: `20260422000000_plugin_registry_refactor/migration.sql`.

---

## 4.5 Enablement Gate — The Four-Level Check

**Nothing about a plugin appears in the UI, fires a notification, runs a background job, or shows up in an API response unless the plugin is fully enabled at every level of the cascade.** This is a cross-cutting concern — every feature that consumes a plugin capability must check the gate before doing anything.

### 4.5.1 The cascade (top to bottom)

| Level | Check | Data source |
|---|---|---|
| **1. Org install** | `OrgPluginInstall` exists for this `pluginId` with `isEnabled=true` and `deletedAt IS NULL` and `lastHealthOk=true` | `org_plugin_installs` table |
| **2. Project binding** | `ProjectPluginBinding` exists for `(projectId, installId)` with `deletedAt IS NULL` | `project_plugin_bindings` table |
| **3. Capability opt-in** | `capability ∈ binding.enabledCapabilities[]` | `enabledCapabilities` column on binding |
| **4. Config validity** | Capability-specific config requirements are met (see per-capability matrix below) | Resolved effective binding config |

If **any** level fails, the capability is **not available** for this project. Any UI surface, API endpoint, service call, or background job that would have used it must behave as if the plugin does not exist — no pills, no buttons, no notifications, no audit noise, no health nags.

### 4.5.2 Per-capability config requirements (level 4)

| Capability | Required effective config |
|---|---|
| `notify` | `defaultChannel` OR `webhookUrl` (plugin-specific) |
| `createIssue` | `targetListId` — and `parentTaskId` if `targetMode='subtask'` |
| `linkTicket` | (none beyond install) |
| `pullTicketStatus` | (none beyond install) |
| `syncPhaseStatus` | ≥ 1 `PluginStatusMapping` row with `direction IN (OUTBOUND, BIDIRECTIONAL)` and `targetType=PHASE` |
| `fetchTicketContext` | (none beyond install) |
| `fetchDocs` | (none beyond install) |
| `logTime` | Plugin-specific (e.g. ClickUp time tracking enabled workspace) |
| `webhookListener` | `webhookEnabled=true` AND successful upstream registration (`PluginWebhookEndpoint.externalWebhookId` set) |

### 4.5.3 The canonical guard helper

**Server-side:**

```typescript
// apps/api/src/plugins/enablement.service.ts

@Injectable()
export class EnablementService {
  /**
   * Returns the list of active installs that provide a given capability
   * for a given project scope. Returns [] when the plugin is disabled
   * at any level.
   */
  async getEnabledInstalls(
    projectId: string,
    capability: PluginCapability,
    pluginId?: string,                    // optional filter — "clickup" only
  ): Promise<EnabledInstall[]> {
    const bindings = await this.db.projectPluginBinding.findMany({
      where: {
        projectId,
        deletedAt: null,
        enabledCapabilities: { has: capability },
        install: {
          isEnabled: true,
          deletedAt: null,
          lastHealthOk: true,             // level 1 — health gate
          ...(pluginId ? { pluginId } : {}),
        },
      },
      include: { install: true },
    });

    // Level 4 — config validity per capability
    const enabled: EnabledInstall[] = [];
    for (const b of bindings) {
      const effective = await resolveEffectiveConfig(b.install.id, { projectId });
      if (await this.validateCapabilityConfig(capability, b.install.pluginId, effective)) {
        enabled.push({ install: b.install, binding: b, effectiveConfig: effective });
      }
    }
    return enabled;
  }

  async isCapabilityEnabled(projectId: string, capability: PluginCapability, pluginId?: string): Promise<boolean> {
    return (await this.getEnabledInstalls(projectId, capability, pluginId)).length > 0;
  }

  /** Throws PluginNotEnabledError if not enabled — use at service entry points */
  async requireEnabled(projectId: string, capability: PluginCapability, pluginId: string): Promise<EnabledInstall> {
    const installs = await this.getEnabledInstalls(projectId, capability, pluginId);
    if (installs.length === 0) {
      throw new PluginNotEnabledError(pluginId, capability, projectId);
    }
    return installs[0];
  }
}

export interface EnabledInstall {
  install:         OrgPluginInstall;
  binding:         ProjectPluginBinding;
  effectiveConfig: Record<string, unknown>;
}
```

**Frontend hook:**

```typescript
// apps/web/src/hooks/usePluginCapability.ts

export function usePluginCapability(
  capability: PluginCapability,
  scope: { projectId: string; moduleId?: string; featureId?: string },
  pluginId?: string,
): { enabled: boolean; installs: EnabledInstall[]; loading: boolean } {
  // Calls GET /api/v1/plugins/enabled?projectId=&capability=&pluginId=
  // Returns cached 30s via React Query
}
```

### 4.5.4 Consumption pattern — UI

Every UI element that depends on a plugin capability wraps its render in `usePluginCapability()`:

```tsx
// The Testing View doc pill, for example
function DocPill({ featureId, projectId }: Props) {
  const { enabled, installs } = usePluginCapability('fetchDocs', { projectId });
  if (!enabled) return null;                       // ← invisible when disabled
  // ... render pill
}

// The snag refresh button
function SnagCard({ snag }: Props) {
  const { enabled } = usePluginCapability('pullTicketStatus', { projectId }, snag.ticketLink?.install.pluginId);
  return (
    <Card>
      {/* ... title, status ... */}
      {enabled && snag.ticketLink && <RefreshButton />}   {/* ← hidden when disabled */}
    </Card>
  );
}
```

### 4.5.5 Consumption pattern — API

Every capability-backed API endpoint calls `EnablementService.requireEnabled()` at the top; throws 404 (not 403) when the capability isn't enabled — we don't leak which plugins exist.

```typescript
@Post('ticket-links/:id/refresh')
async refreshTicket(@Param('id') id: string, @AuthUser() user: User) {
  const link = await this.db.ticketLink.findUnique({ where: { id } });
  if (!link) throw new NotFoundException();

  await this.enablement.requireEnabled(
    link.projectId ?? (await lookupProjectId(link)),
    'pullTicketStatus',
    link.install.pluginId,
  );   // throws PluginNotEnabledError → mapped to 404 by global filter

  return this.inboundSync.refreshTicket(link.id, 'MANUAL_REFRESH', user.id);
}
```

### 4.5.6 Consumption pattern — background jobs

Every BullMQ job that runs per-install or per-project **re-checks enablement at execution time** (not just scheduling time). Jobs queued when a plugin was enabled but processed after disable must no-op gracefully:

```typescript
@Processor('bulk-refresh-tickets')
async process(job: Job<{ projectId: string; pluginId: string }>) {
  const installs = await this.enablement.getEnabledInstalls(
    job.data.projectId,
    'pullTicketStatus',
    job.data.pluginId,
  );
  if (installs.length === 0) {
    this.logger.info({ ...job.data }, 'plugin disabled since job was queued; skipping');
    return;
  }
  // ... proceed
}
```

The `plugin-health-check` job **does** still run for disabled installs (that's how we notice a token became valid again) — but it only writes health state; no notifications or downstream work.

### 4.5.7 What happens on disable / uninstall

| Action | Immediate effect |
|---|---|
| Binding deleted | UI elements for that project disappear next render; queued dispatches for that binding no-op (§4.5.6); existing `TicketLink` / `DocLink` records retained (user can still see titles, just can't refresh) |
| `isEnabled=false` on install | All bindings treated as inert across all projects; same UI hiding; upstream webhooks still receive but handler short-circuits and audits as `result=ignored-plugin-disabled` |
| Uninstall | Bindings cascade-deleted; secrets zeroed; upstream webhooks deregistered; `TicketLink` + `DocLink` rows retained as soft-deleted archive |
| Org plugin install deleted but TicketLinks remain | Soft-deleted TicketLinks render as read-only "Linked to deleted plugin"; user can unlink but not refresh or sync |

### 4.5.8 Health-gate override

`lastHealthOk=false` disables the plugin **for dispatch**, but users can still:
- See existing linked tickets and docs (cached data)
- Uninstall / reconfigure the plugin (admin UI remains functional)
- Read audit logs and health history

An amber "ClickUp offline" banner appears on any page that would have shown plugin features, with a `[Reconfigure]` CTA — instead of silently hiding everything and leaving the user wondering.

### 4.5.9 Data retention after disable

- `TicketLink` rows: **retained** — keep the context, just can't refresh/sync. UI clearly marks them as stale.
- `DocLink` rows: **retained** — cached markdown still renders; "Refresh" button disabled with tooltip "ClickUp integration disabled".
- `TicketStatusSuggestion` pending rows: **auto-dismissed** with reason `PLUGIN_DISABLED`; no orphan suggestions.
- `WebhookEvent` audit: retained per existing 30-day retention.
- `PluginWebhookEndpoint`: set `isActive=false` on disable; upstream webhook deregistered; endpoint row kept for audit.

### 4.5.10 Summary — where the gate is checked

| Layer | Who checks |
|---|---|
| UI components | `usePluginCapability()` hook — conditional render |
| REST endpoints | Controller method calls `EnablementService.requireEnabled()` first |
| Service methods | `PluginService.dispatch()` already throws if install is disabled; capability-level checks in the service too |
| BullMQ processors | Re-check at job execution, not scheduling |
| Notification fires | Notification builder skips plugin-related types if plugin disabled (defensive — notifications shouldn't exist, but belt + braces) |
| Webhook receiver | Rejects with 200 + `result=ignored-plugin-disabled` if install disabled between registration and delivery |

---

## 5. Cascading Configuration

Each feature of the platform that calls a plugin capability resolves **effective config** via a cascade:

```
Feature-level override
    ↓ (fallback)
Module-level override
    ↓ (fallback)
Project-level binding
    ↓ (fallback)
Plugin config defaults (from manifest)
```

### 5.1 Resolver

```typescript
// apps/api/src/plugins/effective-config.ts

export async function resolveEffectiveConfig<T extends object>(
  installId: string,
  scope: { projectId: string; moduleId?: string; featureId?: string }
): Promise<T> {
  const project  = await db.projectPluginBinding.findUnique({ where: { projectId_installId: { projectId: scope.projectId, installId } } });
  const module_  = scope.moduleId  ? await db.modulePluginBinding.findUnique({ where: { moduleId_installId:  { moduleId: scope.moduleId,  installId } } }) : null;
  const feature  = scope.featureId ? await db.featurePluginBinding.findUnique({ where: { featureId_installId: { featureId: scope.featureId, installId } } }) : null;

  // deep-merge with nulls as "inherit"
  return deepMerge<T>(
    getPluginDefaults(installId) as T,
    (project?.bindingConfig  ?? {}) as Partial<T>,
    (module_?.bindingConfig  ?? {}) as Partial<T>,
    (feature?.bindingConfig  ?? {}) as Partial<T>,
  );
}
```

### 5.2 UI indication

Admin forms at module/feature level show the inherited value as a **ghost placeholder** with the label "Inherited from project (Bugs list)" — making it obvious what will happen if the user doesn't override.

Per field:
- `[Inherit]` toggle → resets to null (removes the override)
- Setting a value creates a `bindingConfig` partial record with only that field

---

## 6. Admin UI

### 6.1 Org-level — Plugins page

Route: `/org/:orgSlug/plugins`
RBAC: `ORG_ADMIN` only.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Plugins                                          [+ Install plugin] │
├──────────────────────────────────────────────────────────────────────┤
│  [ClickUp logo]  ClickUp                                             │
│    Installed · v1.0.0 · Healthy ✓ (last checked 2 min ago)           │
│    Capabilities: Create Issue · Link Ticket · Sync Status · Docs     │
│                                [Configure] [Disable] [Uninstall]     │
├──────────────────────────────────────────────────────────────────────┤
│  [Slack logo]    Slack                                               │
│    Not installed                                                     │
│                                               [Install]              │
├──────────────────────────────────────────────────────────────────────┤
│  [Jira logo]     Jira                                                │
│    Not installed                                                     │
│                                               [Install]              │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Install flow

1. User clicks `[Install]` → modal opens
2. Form auto-renders from `configSchema` + `secretsSchema` using `configUiHints` / `secretsUiHints`
3. Secrets fields render as `type=password` and are never echoed back to the client after save
4. "Test connection" button calls `lifecycle.healthCheck()` — success message + green check
5. Save → `POST /org/:orgId/plugins/installs` → encrypts secrets, stores, runs `onEnable`, runs health check

### 6.3 Configure flow

Same modal, pre-filled from current config. Secret fields show `••••••••` placeholder; leaving blank = unchanged.

### 6.4 Project-level binding page

Route: `/projects/:projectId/settings/integrations`
RBAC: `OWNER`, `TECH_LEAD`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Integrations                                                        │
├──────────────────────────────────────────────────────────────────────┤
│  ClickUp                                                  [● Active] │
│    Target mode:  ( ) List mode    (●) Subtask mode                   │
│    Default list: [My QA Bugs ▼]                                      │
│    Parent task:  [Epic: Q2 QA ▼]     (required for subtask mode)     │
│    Status sync:  QA → [In QA ▼]    UAT → [Ready for UAT ▼]    ...    │
│    Capabilities: [x] Create Issue  [x] Link Ticket  [x] Sync Status  │
│                  [x] Fetch Docs    [x] Fetch AC                      │
│                                                         [Save] [⋮]   │
├──────────────────────────────────────────────────────────────────────┤
│  Slack                                                    [● Active] │
│    Default channel: [#qa-alerts ▼]                                   │
│    Capabilities: [x] Notify                                          │
└──────────────────────────────────────────────────────────────────────┘
```

Target mode + default list + parent task fields are ClickUp-specific; the UI is generated from the plugin's `bindingConfigSchema` + `bindingConfigUiHints`.

### 6.5 Module-level override UI

Inside `ModulePage` → Settings tab → Integrations section. Same fields as project, each with `[Inherit]` toggle next to it.

### 6.6 Feature-level override UI

Inside `FeaturePage` → Settings tab → Integrations section. Same pattern.

---

## 7. Service Layer

### 7.1 PluginService

```typescript
// apps/api/src/plugins/plugin.service.ts

@Injectable()
export class PluginService {
  constructor(
    private db: PrismaService,
    private secretsService: SecretsService,        // AES-256-GCM helper
    private logger: Logger,
  ) {}

  // Lifecycle
  async install(orgId: string, pluginId: string, config: object, secrets: object, installedById: string): Promise<OrgPluginInstall> { /* ... */ }
  async update(installId: string, patch: { config?: object; secrets?: object; isEnabled?: boolean }): Promise<void> { /* ... */ }
  async uninstall(installId: string): Promise<void> { /* ... */ }
  async healthCheck(installId: string): Promise<HealthResult> { /* ... */ }

  // Capability dispatch — called by features
  async dispatch<T>(args: {
    capability: PluginCapability;
    installId:  string;
    scope:      { projectId: string; moduleId?: string; featureId?: string };
    payload:    object;
  }): Promise<T> {
    const install = await this.getInstallOrThrow(args.installId);
    const plugin  = getPlugin(install.pluginId);

    if (!plugin.capabilities.includes(args.capability)) {
      throw new CapabilityNotSupportedError(install.pluginId, args.capability);
    }

    const secrets = await this.secretsService.decrypt(install.secretsCiphertext, install.secretsKeyId);
    const effectiveConfig = await resolveEffectiveConfig(args.installId, args.scope);

    const ctx: PluginCtx<any, any> = {
      orgId: install.orgId,
      config: effectiveConfig,
      secrets,
      logger: this.logger.child({ plugin: install.pluginId, installId: install.id }),
      http:  this.buildHttpClient(plugin.id),
      redis: this.buildScopedRedis(install.id),
    };

    const impl = plugin.implementations[args.capability];
    return impl(args.payload, ctx);
  }
}
```

### 7.2 HTTP client with retry + rate-limit

`buildHttpClient()` returns an Axios instance with:
- **Retry middleware** — exponential backoff (250ms → 1s → 4s), max 3 attempts, only on `5xx` and network errors
- **Rate-limit middleware** — respects `Retry-After` header; for plugins with known limits (ClickUp 100/min), tracks via Redis token-bucket `plugin:ratelimit:{pluginId}:{orgId}`
- **Logging** — redacts `Authorization` headers; logs request + status + duration

### 7.3 Background health checks

BullMQ repeatable job `plugin-health-check` fires every 15 minutes per install:
- Calls `plugin.lifecycle.healthCheck(ctx)`
- Writes `lastHealthOk`, `lastHealthAt`, `lastHealthError`
- If transitions `ok → not-ok`, emits in-app notification `PLUGIN_HEALTH_DEGRADED` to `ORG_ADMIN`s (per `docs/IN_APP_NOTIFICATIONS.md`)

---

## 8. REST API

```
# Manifest / catalog
GET    /api/v1/plugins                                      List available plugins (manifests, no secrets)
GET    /api/v1/plugins/:id                                  Manifest for a single plugin

# Org-level installs
GET    /api/v1/orgs/:orgId/plugin-installs                  List installed plugins for org
POST   /api/v1/orgs/:orgId/plugin-installs                  Install a plugin      (body: { pluginId, config, secrets })
GET    /api/v1/orgs/:orgId/plugin-installs/:id              Get install (config only, secrets masked)
PATCH  /api/v1/orgs/:orgId/plugin-installs/:id              Update config / secrets / enabled
DELETE /api/v1/orgs/:orgId/plugin-installs/:id              Uninstall (soft-deletes)
POST   /api/v1/orgs/:orgId/plugin-installs/:id/health-check Run health check now
POST   /api/v1/orgs/:orgId/plugin-installs/:id/test         Dry-run test (e.g. "send test message" for Slack)

# Project bindings
GET    /api/v1/projects/:projectId/plugin-bindings          List all bindings
POST   /api/v1/projects/:projectId/plugin-bindings          Create (body: { installId, bindingConfig, enabledCapabilities })
PATCH  /api/v1/projects/:projectId/plugin-bindings/:id      Update
DELETE /api/v1/projects/:projectId/plugin-bindings/:id      Remove binding

# Module + feature overrides
POST   /api/v1/modules/:moduleId/plugin-bindings            Create/upsert module-level override
POST   /api/v1/features/:featureId/plugin-bindings          Create/upsert feature-level override

# Capability dispatch helpers (used by features)
GET    /api/v1/plugins/:installId/options/:field            Cascade dropdown loader (workspace → space → list)
POST   /api/v1/plugins/:installId/dispatch/link-ticket      Resolve external ticket by URL or id
GET    /api/v1/plugins/:installId/docs                      List available docs (query: ?search=, ?limit=)
GET    /api/v1/plugins/:installId/docs/:docId               Fetch doc content

# Generic webhook receiver
POST   /api/v1/webhooks/plugins/:token                      Inbound webhook (validated by signing secret)
```

All routes protected by JWT + `OrgGuard`. Plugin install/config routes additionally require `ORG_ADMIN` role.

---

## 9. Secrets Handling

- `SECRETS_KEK` — 256-bit key in env (never committed). Rotated via `secretsKeyId` column.
- Encryption: AES-256-GCM with random 12-byte IV, 16-byte tag. Stored as `Bytes` (`iv || tag || ciphertext`).
- Decryption happens in-memory in `PluginService.dispatch()`; secrets are **never** returned over the REST API, never logged, never stored in Redis.
- On `ORG_ADMIN` delete of an install, secrets are zeroed (not just soft-deleted): `UPDATE org_plugin_installs SET secrets_ciphertext = '\x00', deleted_at = now() WHERE id = $1`.
- `SecretsService` unit tests verify round-trip + tamper detection (corrupt tag → throws).

---

## 10. Audit Trail

Every plugin action writes an `AuditLog` entry (existing model, `docs/ARCHITECTURE.md`):

| Action | Actor | Resource | Meta |
|---|---|---|---|
| `plugin.install` | ORG_ADMIN | OrgPluginInstall | `{ pluginId, version }` |
| `plugin.update` | ORG_ADMIN | OrgPluginInstall | `{ changedFields: [...] }` (never secret *values*) |
| `plugin.uninstall` | ORG_ADMIN | OrgPluginInstall | `{ pluginId }` |
| `plugin.binding.create` | TECH_LEAD+ | ProjectPluginBinding | `{ projectId, installId }` |
| `plugin.dispatch.createIssue` | USER | TicketLink | `{ externalId, pluginId }` |
| `plugin.dispatch.syncPhaseStatus` | system | TicketLink | `{ from, to }` |
| `plugin.health.degraded` | system | OrgPluginInstall | `{ error }` |

---

## 11. Testing & Validation

### 11.1 Contract tests per plugin

Every plugin ships a `__tests__/contract.test.ts` that runs the following against the plugin's implementations using **mocked HTTP**:

- `healthCheck()` returns `{ ok: true }` on valid secrets
- `healthCheck()` returns `{ ok: false, message }` on bad secrets (401 simulated)
- Each declared capability: happy path + one error path (404 / 500)
- Config schema parses example valid config; rejects example invalid config
- Secrets schema similarly

### 11.2 E2E harness

`apps/api/test/e2e/plugin-registry.e2e-spec.ts`:
1. Admin installs ClickUp with dummy token
2. Health check fails (invalid token) → notification created
3. Admin updates secret → health check passes
4. Admin creates project binding with `targetMode=subtask`
5. Feature-level binding overrides `targetMode=list`
6. Dispatch `createIssue` at feature scope → uses `list` mode (verified via recorded mock request)
7. Dispatch at module scope → uses subtask mode (inherits project)
8. Uninstall → all bindings cascade-deleted, secrets zeroed

### 11.3 Zod schema property tests

For each plugin's config/secrets schemas, fast-check based property tests ensure:
- Serialisable to JSON Schema (for auto-UI rendering)
- Round-trip through JSON without loss
- All `required` fields genuinely rejected when absent

### 11.4 Chaos / resilience

`ChaosTestSuite` simulates:
- Plugin HTTP 500 for 30s → dispatch retries + ultimately throws typed `PluginTransientError`
- Plugin returns 429 with `Retry-After: 5` → client waits + retries once
- Plugin returns malformed JSON → `PluginProtocolError` with full request context in logs (secrets redacted)
- Secrets key rotation mid-dispatch → in-flight call completes with old key; next call uses new

---

## 12. Frontend Architecture

### 12.1 Shared `PluginConfigForm` component

`apps/web/src/components/plugins/PluginConfigForm.tsx` — auto-renders from a manifest's schemas + UI hints.

```tsx
<PluginConfigForm
  manifest={clickupManifest}
  scope="install"                         // or "project", "module", "feature"
  value={install.config}
  onSave={async (next) => { ... }}
  showInheritToggles={scope !== 'install'}
  inheritedValues={scope === 'module' ? projectBinding.config : ...}
/>
```

Renders each field based on `configUiHints[field].inputType`, with cascading dropdowns for `dependsOn` relationships (e.g. ClickUp workspace → space → list).

### 12.2 `usePluginCapability` hook

```tsx
const { dispatch, isAvailable, installs } = usePluginCapability('createIssue', { projectId });

if (isAvailable) {
  await dispatch({ installId: installs[0].id, payload: { ... } });
}
```

### 12.3 Plugin picker component

When multiple installs offer the same capability (e.g. two ClickUp orgs + Jira), `PluginPicker` shows a dropdown with plugin icon + display label + capability badge.

---

## 13. Migration from Current Schema

One migration file: `20260422000000_plugin_registry_refactor`.

Steps in the migration:
1. Create new tables: `org_plugin_installs`, `project_plugin_bindings`, `module_plugin_bindings`, `feature_plugin_bindings`, `plugin_status_mappings`, `ticket_links`, `doc_links`, `plugin_webhook_endpoints`.
2. Drop old tables: `org_plugins`, `project_plugin_configs`, `project_plugin_status_mappings`, `feature_ticket_links`.
3. Drop old enums: `OrgPluginType`, `TicketLinkType`.
4. Drop old columns on `issues`: `externalTicketId`, `externalTicketUrl`, `externalSystem`, `pushedExternallyAt`. (External issue state lives in `ticket_links` where `issueId = issue.id`.)
5. No data copy — all old tables are empty.

---

## 14. Phased Rollout

| Phase | Scope |
|---|---|
| **5.3-a** | Plugin registry core: types, manifest, registry, `PluginService`, Zod schemas, secrets encryption, `OrgPluginInstall` CRUD API, admin UI install page |
| **5.3-b** | Project / module / feature binding tables + cascading resolver + binding UI |
| **5.3-c** | First plugin (Slack) against the registry — validates the architecture end-to-end with a simple `notify`-only plugin |
| **5.8-a** | ClickUp plugin (`createIssue`, `linkTicket`, `syncPhaseStatus`, `fetchTicketContext`) per `docs/PM_INTEGRATIONS.md` |
| **5.8-b** | ClickUp Docs capability (`fetchDocs`) + DocLink model + UI surfaces (Feature Player pill, Testing View pill) |
| **5.8-c** | Attachment upload (screenshots, recordings) through `createIssue` |
| **10.x**  | Additional plugins: Jira, GitHub Issues, Linear, Discord, Teams, PagerDuty, GitLab — each is one folder + one line in `registry.ts` |

---

## 15. Acceptance Criteria

### Registry core

- [ ] `pluginRegistry` exports all installed plugin manifests; `getPlugin(id)` returns typed manifest
- [ ] `listPluginsByCapability(cap)` filters correctly
- [ ] Adding a new plugin requires zero changes to core dispatch code
- [ ] `PluginService.dispatch()` throws `CapabilityNotSupportedError` when calling a capability the plugin did not declare

### Manifest + schemas

- [ ] Every plugin declares `id`, `displayName`, `version`, `capabilities`, `configSchema`, `secretsSchema`, `lifecycle`, `implementations`
- [ ] Config and secrets validate through Zod on every write; server rejects invalid shapes with 400
- [ ] `configUiHints` / `secretsUiHints` drive the admin form — no per-plugin UI code in the frontend (except icon)

### Secrets

- [ ] Secrets encrypted with AES-256-GCM before DB write
- [ ] Decryption fails with typed `SecretDecryptionError` if ciphertext tampered
- [ ] Key rotation: new installs use `secretsKeyId = 'v2'`; old installs still decrypt with `v1` key
- [ ] Secrets never appear in API responses; field shows `••••••••` placeholder; leaving blank on update = unchanged
- [ ] On uninstall, `secretsCiphertext` overwritten with zeros before soft-delete

### Cascading config

- [ ] Feature override takes precedence over module override
- [ ] Module override takes precedence over project binding
- [ ] Project binding takes precedence over plugin defaults
- [ ] UI shows inherited value as placeholder; `[Inherit]` toggle resets the override
- [ ] `effectiveConfig` merges partials — setting only `targetMode` at feature level does not wipe `defaultListId` inherited from project

### Admin UI

- [ ] `/org/:slug/plugins` lists all plugins with health state + version
- [ ] `[Install]` opens auto-generated form; fields match `configSchema` + `secretsSchema`
- [ ] "Test connection" button calls `healthCheck` and shows success/error
- [ ] Only `ORG_ADMIN` can install/uninstall/update secrets
- [ ] Project-level settings page auto-renders bindings for every installed plugin

### Dispatch

- [ ] `PluginService.dispatch()` injects correctly resolved effective config
- [ ] HTTP client retries on 5xx / network, respects `Retry-After` on 429
- [ ] Rate-limit token bucket in Redis prevents exceeding plugin's known rate limit
- [ ] Every dispatch writes an `AuditLog` entry with action, actor, resource, non-secret meta

### Health checks

- [ ] `plugin-health-check` BullMQ job fires every 15 min per install
- [ ] Status transitions (ok → not-ok) generate `PLUGIN_HEALTH_DEGRADED` notifications to `ORG_ADMIN`s
- [ ] Admin UI shows live health badge + last-checked timestamp

### Migration

- [ ] `20260422000000_plugin_registry_refactor` migration runs cleanly on empty DB
- [ ] Dev environment: old tables dropped, new tables present after migrate
- [ ] Prisma client regenerates; TypeScript compiles
- [ ] Old service code referencing `OrgPlugin` / `FeatureTicketLink` is removed (compiler-enforced)

### Testing

- [ ] Every plugin has a contract test covering every declared capability (happy + error path)
- [ ] E2E `plugin-registry.e2e-spec.ts` passes
- [ ] `PluginService` has > 80% line coverage
- [ ] Property tests for Zod schemas pass fast-check seeds

### Audit

- [ ] `AuditLog` entry created for install / update / uninstall / binding-create / dispatch-create-issue / sync / health-degraded
- [ ] Secret values never appear in audit meta (changed-fields are names, not values)

---

## 16. Implementation Tasks (for IMPLEMENTATION_PLAN.md §5.3 refactor)

> To be added to `IMPLEMENTATION_PLAN.md`. High-level split:

1. **Data model** — Prisma schema changes + migration (§4.1, §13)
2. **Core types** — `apps/api/src/plugins/types.ts`, capability signatures (§2.1, §3)
3. **Registry** — `apps/api/src/plugins/registry.ts` (§3.2)
4. **Secrets service** — AES-256-GCM encrypt/decrypt, key rotation (§9)
5. **Effective config resolver** — cascading merge (§5.1)
6. **PluginService** — install/update/uninstall/healthCheck/dispatch (§7)
7. **HTTP client middleware** — retry, rate-limit (§7.2)
8. **REST controllers** — all endpoints in §8
9. **Admin UI** — `/org/:slug/plugins` list + install modal + configure modal (§6)
10. **Project settings UI** — bindings page with auto-generated forms (§6.4)
11. **Module / feature override UI** — settings tabs with inherit toggles (§6.5–6.6)
12. **Health check cron** — BullMQ job (§7.3)
13. **Audit logging** — wire into every mutating action (§10)
14. **Capability hook** — `usePluginCapability`, `<PluginPicker>`, `<PluginConfigForm>` frontend (§12)
15. **First plugin: Slack** (`notify`-only) — validates the arch end-to-end (§14 phase 5.3-c)
16. **Contract test harness** — shared test utilities for plugin contract tests (§11.1)
17. **E2E plugin-registry suite** (§11.2)
18. **Docs update** — refactor `NOTIFICATIONS_AND_INTEGRATIONS.md` to reference this doc; delete the old `IntegrationPlugin` interface section
