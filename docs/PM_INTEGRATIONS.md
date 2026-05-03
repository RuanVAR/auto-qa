# ClickUp Integration — Full Specification

**Phase target:** Phase 5.8 (this spec) — depends on Phase 5.3 plugin registry being in place.
**Status:** Planned — not implemented.

> **This doc is the ClickUp-specific implementation** of the generic plugin contract defined in `docs/PLUGIN_REGISTRY.md`. Read the registry spec first — this doc assumes the reader understands manifests, capabilities, bindings, and cascading config.

**Related docs:**
- `docs/PLUGIN_REGISTRY.md` — unified plugin architecture (prerequisite)
- `docs/EXPLORATORY_TESTING.md` — findings → ClickUp subtask/task flow
- `docs/IN_APP_NOTIFICATIONS.md` — in-app + email notifications (NOT ClickUp — separate system)
- `docs/FEATURE_PLAYER.md` — doc pill in Testing View
- `docs/TESTING_PHASES_AND_REPORTS.md` — phase status sync

---

## 1. Scope of Phase 1

### In scope (Phase 5.8-a through 5.8-j)

- **Auth:** Personal API Token only (`pk_...`). OAuth 2.0 deferred to Phase 2.
- **Capabilities implemented:** `createIssue`, `linkTicket`, `pullTicketStatus`, `syncPhaseStatus`, `fetchTicketContext`, `fetchDocs`, `webhookListener`.
- **Issue tracking modes:** `list` (new task in a list) and `subtask` (child of a parent task), cascading from project → module → feature.
- **Attachments:** screenshots (always upload, <10 MB each) and recordings (upload if <50 MB, otherwise inject platform URL).
- **Docs:** Read-only mirror of ClickUp Docs, linkable to project / module / feature. Pill in Testing View with inline viewer. Cached markdown for fast render.
- **AC import:** pull markdown description + any Doc body linked to the task → AI generation pipeline.
- **Inbound status sync (§11):** manual [↺ Refresh] button pulls latest task state; bi-directional status mapping (external → internal); toast + notification pattern for QA engineer to apply; unmapped statuses notify ORG_ADMIN.
- **Webhooks (§12):** register `taskStatusUpdated`, `taskUpdated`, `taskMoved`, `taskDeleted` webhooks per install; HMAC-SHA256 signature verification; real-time inbound updates routed to the same handler as manual refresh.

### Deferred (Phase 2+)

- OAuth 2.0 flow (per-user tokens, refresh)
- Native in-platform Docs (write, edit) — the user-confirmed **hybrid strategy**: we ship read-only ClickUp Docs in Phase 1; native Docs as an optional parallel system later.
- Bi-directional doc editing / commenting
- Time logging (deferred to Phase 11.D per existing plan)

---

## 2. Plugin Manifest

```typescript
// apps/api/src/plugins/clickup/index.ts

import { PluginManifest } from '../types';
import { clickupConfigSchema, clickupSecretsSchema, clickupBindingSchema } from './schemas';
import { lifecycle }       from './lifecycle';
import { implementations } from './implementations';

export const clickupPlugin: PluginManifest<ClickUpConfig, ClickUpSecrets> = {
  id:          'clickup',
  displayName: 'ClickUp',
  description: 'Create bugs, link features to tasks, sync phase statuses, import ACs and Docs',
  iconUrl:     '/plugin-icons/clickup.svg',
  version:     '1.0.0',
  website:     'https://clickup.com',

  capabilities: [
    'createIssue',
    'linkTicket',
    'pullTicketStatus',     // §11 — inbound status refresh
    'syncPhaseStatus',
    'fetchTicketContext',
    'fetchDocs',
    'webhookListener',      // §12 — real-time inbound updates
  ],

  configSchema:  clickupConfigSchema,
  secretsSchema: clickupSecretsSchema,
  bindingConfigSchema: clickupBindingSchema,

  configUiHints: {
    defaultWorkspaceId: {
      label: 'Default Workspace',
      inputType: 'select',
      help: 'ClickUp team / workspace. Loaded after token is validated.',
      fetchOptions: async (_parent, plugin) => {
        const teams = await plugin.http.get('/api/v2/team').then(r => r.data.teams);
        return teams.map(t => ({ value: t.id, label: t.name }));
      },
    },
  },

  secretsUiHints: {
    personalApiToken: {
      label: 'Personal API Token',
      inputType: 'password',
      placeholder: 'pk_12345_ABC...',
      help: 'Generate at ClickUp → Settings → Apps → API Token. Never shared.',
    },
  },

  lifecycle,
  implementations,
};
```

---

## 3. Config + Secrets Schemas

```typescript
// apps/api/src/plugins/clickup/schemas.ts
import { z } from 'zod';

// Non-secret config, stored plaintext in Postgres JSONB
export const clickupConfigSchema = z.object({
  defaultWorkspaceId: z.string().min(1, 'Workspace is required'),
  apiBaseUrl:         z.string().url().default('https://api.clickup.com'),
  locale:             z.string().optional(),
});
export type ClickUpConfig = z.infer<typeof clickupConfigSchema>;

// Encrypted before DB write
export const clickupSecretsSchema = z.object({
  personalApiToken: z.string().regex(/^pk_[A-Z0-9_]+$/i, 'Must start with pk_'),
});
export type ClickUpSecrets = z.infer<typeof clickupSecretsSchema>;

// Per-binding config (project / module / feature) — each field individually optional for cascade
export const clickupBindingSchema = z.object({
  spaceId:           z.string().optional(),
  folderId:          z.string().optional(),

  // Multiple target lists — a project may have N lists (one per module or custom)
  targetListId:      z.string().optional(),

  // Issue creation mode
  targetMode:        z.enum(['list', 'subtask']).optional(),
  parentTaskId:      z.string().optional(),  // required when targetMode='subtask'

  // Field mappings
  bugStatusName:     z.string().optional(), // e.g. "open"
  bugTagName:        z.string().optional(), // e.g. "qa-bug"
  severityFieldId:   z.string().optional(), // Custom Field id for severity mapping

  // Phase status mappings → status names in this list
  phaseStatusQa:         z.string().optional(),
  phaseStatusUat:        z.string().optional(),
  phaseStatusSignoffPending: z.string().optional(),
  phaseStatusSignedOff:  z.string().optional(),

  // Attachment behaviour
  attachRecordings:      z.boolean().default(true),
  attachRecordingMaxMb:  z.number().int().positive().max(500).default(50),

  // Inbound status sync (§11)
  autoApplyInboundStatus: z.boolean().default(false),     // false = show toast, user applies; true = auto-update snag
  notifyUnmappedStatus:   z.boolean().default(true),      // true = notify ORG_ADMIN on unmapped external status
  bulkRefreshOnProjectOpen: z.boolean().default(true),    // true = refresh all linked tickets when project page opens

  // Webhook (§12)
  webhookEnabled:    z.boolean().default(true),
  webhookEvents:     z.array(z.enum([
    'taskStatusUpdated',
    'taskUpdated',
    'taskMoved',
    'taskDeleted',
    'taskCommentPosted',
  ])).default(['taskStatusUpdated', 'taskMoved', 'taskDeleted']),
});
export type ClickUpBindingConfig = z.infer<typeof clickupBindingSchema>;
```

---

## 4. Lifecycle

```typescript
// apps/api/src/plugins/clickup/lifecycle.ts

export const lifecycle: PluginLifecycle<ClickUpConfig, ClickUpSecrets> = {
  async onEnable(ctx) {
    await refreshWorkspaceHierarchy(ctx);
  },

  async healthCheck(ctx) {
    try {
      const res = await ctx.http.get('/api/v2/user', {
        baseURL: ctx.config.apiBaseUrl,
        headers: { Authorization: ctx.secrets.personalApiToken },
      });
      return { ok: true, checkedAt: new Date(), details: { username: res.data.user?.username } };
    } catch (err: unknown) {
      return { ok: false, checkedAt: new Date(), message: humanisedError(err, 'ClickUp health check failed') };
    }
  },

  async onConfigChange(ctx, previous) {
    if (ctx.config.defaultWorkspaceId !== previous.defaultWorkspaceId) {
      await invalidateWorkspaceHierarchy(ctx);
      await refreshWorkspaceHierarchy(ctx);
    }
  },

  async onDisable(ctx) {
    await invalidateWorkspaceHierarchy(ctx);
  },
};
```

### 4.1 Workspace hierarchy cache

On `onEnable` / `onConfigChange`, fetch:

```
GET /api/v2/team/{workspaceId}/space
GET /api/v2/space/{spaceId}/folder
GET /api/v2/space/{spaceId}/list            (folderless)
GET /api/v2/folder/{folderId}/list          (per folder)
```

Cached in Redis:
- Key: `plugin:clickup:{installId}:hierarchy`
- TTL: 1 hour
- Invalidate on config change

Used for cascading dropdowns in UI (workspace → space → folder → list).

---

## 5. Cascading Binding Config — Rules

### 5.1 Resolution order (see `docs/PLUGIN_REGISTRY.md` §5)

```
Feature binding → Module binding → Project binding → Plugin defaults
```

### 5.2 Target-mode rules

| targetMode (effective) | Required fields | Behaviour |
|---|---|---|
| `list` | `targetListId` | `POST /api/v2/list/{listId}/task` creates a new top-level task |
| `subtask` | `targetListId` + `parentTaskId` | `POST /api/v2/list/{listId}/task` with `parent: parentTaskId` creates a subtask |

Validation on binding save:
- `targetMode='subtask'` without effective `parentTaskId` → `400 BINDING_MISSING_PARENT`
- `targetMode='list'` without effective `targetListId` → `400 BINDING_MISSING_LIST`

### 5.3 "Split where we can" — Doc multi-attachment

Docs may be linked at **any combination** of scopes simultaneously — a single Doc can link to project + module + feature at once. `DocLink` is many-to-many via three nullable scope columns (see `PLUGIN_REGISTRY.md` §4.1).

**Deduplication in UI:** when rendering Docs on a feature page, docs linked at **feature** level are shown first, then module, then project, with a scope badge. Same Doc linked at multiple scopes collapses to one visible pill with tooltip "Linked at project + feature".

### 5.4 Module-level list inheritance

A project may have 5 modules, each pointing at a different ClickUp list. The project binding may set `targetListId = null` (no project default); each module binding sets its own. A feature with no override inherits from its module.

---

## 6. Capability: `createIssue`

The central bug-push flow. Used by:
- Manual test failure panel (`[Create Ticket ▼]` action)
- Exploratory session findings (`[Create Ticket ▼]` on each finding)
- Automated run failures with `Create Issue` recovery action

### 6.1 Payload

```typescript
CreateIssuePayload = {
  title: string;
  description: string;               // markdown
  severity?: 'low' | 'medium' | 'high' | 'critical';
  labels?: string[];
  attachments?: Attachment[];
  targetMode: 'list' | 'subtask';    // resolved from effective binding config
  targetId:   string;                // listId (always) + parentTaskId (if subtask)
  parentContext?: { url; title };    // injected into description for subtask mode
};
```

### 6.2 Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Resolve effective binding config for feature/module/project   │
│ 2. Validate: targetListId present; parentTaskId if subtask       │
│ 3. Build ClickUp task payload                                    │
│ 4. POST /api/v2/list/{listId}/task  (with parent if subtask)     │
│ 5. Upload each attachment → POST /task/{taskId}/attachment       │
│    - Screenshots: always upload if ≤10 MB                        │
│    - Recordings:  upload if ≤attachRecordingMaxMb AND            │
│                   attachRecordings=true; else inject platform    │
│                   URL into description                           │
│ 6. Write TicketLink row (scope=finding|issue, externalId, url)   │
│ 7. Emit audit log                                                │
│ 8. Return IssueRef { externalId, externalUrl, ... }              │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3 Implementation

```typescript
// apps/api/src/plugins/clickup/implementations/create-issue.ts

export async function createIssue(
  payload: CreateIssuePayload,
  ctx: PluginCtx<ClickUpConfig, ClickUpSecrets>,
): Promise<IssueRef> {
  const binding = ctx.config as unknown as ClickUpBindingConfig;

  if (!binding.targetListId) throw new BindingConfigError('targetListId is required');
  if (payload.targetMode === 'subtask' && !binding.parentTaskId) {
    throw new BindingConfigError('parentTaskId is required for subtask mode');
  }

  const description = buildDescription(payload, binding);

  const body = {
    name: payload.title,
    description,
    markdown_description: description,
    status: binding.bugStatusName ?? 'open',
    tags:   [...(payload.labels ?? []), binding.bugTagName].filter(Boolean),
    priority: severityToPriority(payload.severity),
    parent: payload.targetMode === 'subtask' ? binding.parentTaskId : undefined,
    custom_fields: binding.severityFieldId && payload.severity
      ? [{ id: binding.severityFieldId, value: payload.severity }]
      : undefined,
  };

  const res = await ctx.http.post(`/api/v2/list/${binding.targetListId}/task`, body, { headers: authHeader(ctx) });
  const task = res.data;

  for (const att of payload.attachments ?? []) {
    await uploadAttachmentWithFallback(task.id, att, binding, ctx);
  }

  return {
    externalId:       task.id,
    externalUrl:      task.url,
    externalSystem:   'clickup',
    externalListId:   binding.targetListId,
    parentExternalId: payload.targetMode === 'subtask' ? binding.parentTaskId : undefined,
  };
}
```

### 6.4 Description builder

```typescript
function buildDescription(payload: CreateIssuePayload, binding: ClickUpBindingConfig): string {
  const parts: string[] = [];
  if (payload.targetMode === 'subtask' && payload.parentContext) {
    parts.push(`> Related feature: [${payload.parentContext.title}](${payload.parentContext.url})`);
  }
  parts.push(payload.description);
  return parts.join('\n\n');
}
```

### 6.5 Attachment upload + fallback

```typescript
async function uploadAttachmentWithFallback(
  taskId: string,
  att: Attachment,
  binding: ClickUpBindingConfig,
  ctx: PluginCtx<ClickUpConfig, ClickUpSecrets>,
): Promise<void> {
  const isVideo = att.mimeType.startsWith('video/');
  const maxMb   = isVideo ? binding.attachRecordingMaxMb ?? 50 : 10;
  const sizeMb  = att.sizeBytes / 1024 / 1024;

  const allowUpload = !isVideo || (binding.attachRecordings !== false && sizeMb <= maxMb);

  if (allowUpload) {
    try {
      const stream = await artifactService.getStream(att.storageKey);
      const form   = new FormData();
      form.append('attachment', stream, { filename: att.filename, contentType: att.mimeType });

      await ctx.http.post(`/api/v2/task/${taskId}/attachment`, form, {
        headers: { ...authHeader(ctx), ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return;
    } catch (err) {
      ctx.logger.warn({ err, taskId, att: att.filename }, 'attachment upload failed — falling back to URL');
    }
  }

  const signedUrl = await artifactService.getSignedUrl(att.storageKey, { expiresInSec: 60 * 60 * 24 * 30 });
  await appendToTaskDescription(
    taskId,
    `\n\n🔗 Attachment: [${att.filename}](${signedUrl}) (${isVideo ? 'recording' : 'file'})`,
    ctx,
  );
}

// ClickUp's PUT /task doesn't support description_append — fetch + re-put full description
async function appendToTaskDescription(taskId: string, suffix: string, ctx: PluginCtx<any, any>) {
  const current = await ctx.http.get(`/api/v2/task/${taskId}`, { headers: authHeader(ctx) });
  const next = (current.data.markdown_description ?? current.data.description ?? '') + suffix;
  await ctx.http.put(`/api/v2/task/${taskId}`, { markdown_content: next }, { headers: authHeader(ctx) });
}
```

### 6.6 Size thresholds (Phase 1 defaults)

| Attachment type | Default max to upload | On exceed |
|---|---|---|
| Screenshot (PNG/JPG) | 10 MB | Inject signed-URL link in description |
| Video recording (WebM/MP4) | 50 MB (configurable per-binding, max 500) | Inject signed-URL link |
| Log file / HAR | 5 MB | Inject link |
| Other | 10 MB | Inject link |

Signed URL TTL: 30 days (configurable via `ARTIFACT_SIGNED_URL_TTL_DAYS` env).

---

## 7. Capability: `linkTicket`

Resolves an existing ClickUp task by URL or ID.

### 7.1 Input formats supported

- Full URL: `https://app.clickup.com/t/abc123def`
- Short URL: `https://app.clickup.com/t/1234567/ABC-123`
- Custom task ID: `ABC-123`
- Raw task ID: `abc123def`

### 7.2 Implementation

```typescript
export async function linkTicket(urlOrId: string, ctx): Promise<TicketRef> {
  const { taskId, isCustomId } = parseClickUpTaskRef(urlOrId);
  const query = isCustomId ? { custom_task_ids: true, team_id: ctx.config.defaultWorkspaceId } : {};
  const res = await ctx.http.get(`/api/v2/task/${taskId}`, {
    params: { ...query, include_markdown_description: true },
    headers: authHeader(ctx),
  });
  const task = res.data;
  return {
    externalId:  task.id,
    externalUrl: task.url,
    title:       task.name,
    status:      task.status?.status,
    assignees:   (task.assignees ?? []).map(a => ({
      externalId:  String(a.id),
      displayName: a.username,
      avatarUrl:   a.profilePicture,
    })),
  };
}
```

---

## 8. Capability: `syncPhaseStatus`

Called when a feature's phase changes (QA → UAT → Sign-off complete).

```typescript
export async function syncPhaseStatus(
  { ticketRef, phase }: { ticketRef: TicketRef; phase: PlatformPhase },
  ctx,
): Promise<void> {
  const binding = ctx.config as unknown as ClickUpBindingConfig;
  const statusName = {
    QA:                 binding.phaseStatusQa,
    UAT:                binding.phaseStatusUat,
    SIGNOFF_PENDING:    binding.phaseStatusSignoffPending,
    SIGNED_OFF:         binding.phaseStatusSignedOff,
  }[phase];

  if (!statusName) {
    ctx.logger.warn({ phase, ticketRef }, 'no status mapping configured — skipping sync');
    return;
  }

  await ctx.http.put(
    `/api/v2/task/${ticketRef.externalId}`,
    { status: statusName },
    { headers: authHeader(ctx) },
  );
}
```

Hooked into `FeaturePhaseService.transitionPhase()` — fires after platform state change commits.

---

## 9. Capability: `fetchTicketContext`

Pulls a task's full context for AI test generation.

```typescript
export async function fetchTicketContext(ticketRef: TicketRef, ctx): Promise<TicketContext> {
  const res = await ctx.http.get(`/api/v2/task/${ticketRef.externalId}`, {
    params: { include_markdown_description: true },
    headers: authHeader(ctx),
  });
  const task = res.data;

  const commentsRes = await ctx.http.get(`/api/v2/task/${ticketRef.externalId}/comment`, {
    headers: authHeader(ctx),
  });

  const acceptanceCriteria = extractAcceptanceCriteria(task.markdown_description ?? task.description);

  return {
    title:       task.name,
    description: task.markdown_description ?? task.description,
    acceptanceCriteria,
    comments: (commentsRes.data.comments ?? []).map(c => ({
      author:    c.user?.username ?? 'unknown',
      body:      stripClickUpCommentMarkup(c.comment_text),
      createdAt: new Date(Number(c.date)),
    })),
    customFields: Object.fromEntries((task.custom_fields ?? []).map(f => [f.name, f.value])),
    fetchedAt:   new Date(),
  };
}

// Heuristic: look for "Acceptance Criteria" heading followed by bullets/numbered list
function extractAcceptanceCriteria(md: string): string[] { /* ... */ }
```

---

## 10. Capability: `fetchDocs`

### 10.1 API endpoints (ClickUp Docs v3)

```typescript
listDocs: async (query, ctx): Promise<DocSummary[]> => {
  const res = await ctx.http.get(
    `/api/v3/workspaces/${ctx.config.defaultWorkspaceId}/docs`,
    { params: query.search ? { q: query.search, limit: query.limit ?? 25 } : { limit: query.limit ?? 50 } },
  );
  return res.data.docs.map(d => ({
    externalId: d.id,
    title:      d.name,
    url:        d.url,
    workspaceId: d.workspace_id,
    spaceId:    d.space_id,
    updatedAt:  d.date_updated ? new Date(Number(d.date_updated)) : undefined,
  }));
},

fetchDoc: async (docId, ctx): Promise<DocContent> => {
  const doc   = await ctx.http.get(`/api/v3/workspaces/${ctx.config.defaultWorkspaceId}/docs/${docId}`);
  const pages = await ctx.http.get(`/api/v3/workspaces/${ctx.config.defaultWorkspaceId}/docs/${docId}/pages`);
  return {
    externalId:   doc.data.id,
    title:        doc.data.name,
    url:          doc.data.url,
    bodyMarkdown: doc.data.content ?? '',
    pages: (pages.data.pages ?? []).map(p => ({ id: p.id, title: p.name, bodyMarkdown: p.content ?? '' })),
    fetchedAt: new Date(),
  };
},
```

> **ClickUp v3 Docs API volatility.** The endpoints above are the best-known shape circa 2024-2025. Before implementation, run a 30-min reconnaissance against a real workspace and confirm (a) endpoint paths, (b) response shape, (c) markdown content field name. Encapsulate the mapping in one adapter function so changes don't ripple.

### 10.2 UX — Search + browse (answer to Q9)

**Both paste and browse**, implemented as one modal:

```
┌───────────────────────────────────────────────────────────┐
│  Link a ClickUp Doc                                       │
│                                                           │
│  ○ Paste a ClickUp Doc URL                                │
│    [ https://app.clickup.com/docs/d/... ]  [Resolve]     │
│                                                           │
│  ● Browse / search workspace Docs                         │
│    Space filter: [All ▼]                                  │
│    Search:       [ acceptance criteria ... ]              │
│                                                           │
│    ┌────────────────────────────────────────────────┐    │
│    │ 📄 OAuth AC — v3                               │    │
│    │    Updated 2 days ago · Space: Product         │    │
│    ├────────────────────────────────────────────────┤    │
│    │ 📄 Login UX spec                               │    │
│    │    Updated 1 week ago · Space: Product         │    │
│    └────────────────────────────────────────────────┘    │
│                                                           │
│  Attach at:  [x] This feature   [ ] Parent module         │
│              [ ] Project                                  │
│                                                           │
│                                     [Cancel] [Link Doc]   │
└───────────────────────────────────────────────────────────┘
```

- **Paste:** fast, no list call — URL parser → doc ID
- **Browse:** `listDocs` first page (50 items) — paginated; user types to search
- **Attach at:** checkboxes allow multi-scope (project + module + feature). Defaults to current scope. Creates multiple `DocLink` rows atomically in a transaction.

### 10.3 Caching

On successful link, cache `bodyMarkdown` + `pages[]` into `DocLink.cachedMarkdown` (JSONB), with `cachedAt = now`, `cacheExpiresAt = now + 24h`. Re-fetch on access if expired. Refresh button in UI forces immediate refetch.

### 10.4 Where Docs surface

| Location | Rendering |
|---|---|
| `FeaturePage` header | Badge row: `📄 OAuth AC` · `📄 Login UX spec` — click opens side drawer |
| Testing View top action bar | Pill: `📄 2 docs ▼` — click opens dropdown → doc → inline pane |
| Module page header | Same badge component |
| Project overview | Linked docs card in stats panel |
| Test case editor | "Reference docs" collapsible in right sidebar |
| AI generation context | `fetchDoc` on linked Doc injected into generation prompt |

### 10.5 Inline viewer component

`apps/web/src/components/docs/DocViewer.tsx`:
- Renders `bodyMarkdown` via `react-markdown` + `remark-gfm`
- Tabs for multi-page docs
- "Open in ClickUp" link in header
- "Refresh" button forces refetch

---

## 11. Capability: `pullTicketStatus` (Inbound Status Sync)

**The refresh flow.** Called when (a) user clicks `[↺ Refresh]` on a snag/ticket, (b) user lands on project page with `bulkRefreshOnProjectOpen=true`, (c) webhook fires and we fall back to a fresh fetch to validate (§12.4).

> **Enablement gate.** Everything in this section — the Refresh button, the bulk refresh job, the suggestion notifications, the inbound mapping UI — is gated by `EnablementService.isCapabilityEnabled(projectId, 'pullTicketStatus', 'clickup')` per `docs/PLUGIN_REGISTRY.md` §4.5. If the project has no ClickUp binding, no capability opt-in, or invalid config, **nothing about inbound sync appears in the UI or fires in the background**.

### 11.1 Implementation

```typescript
// apps/api/src/plugins/clickup/implementations/pull-ticket-status.ts

export async function pullTicketStatus(
  ticketRef: TicketRef,
  ctx: PluginCtx<ClickUpConfig, ClickUpSecrets>,
): Promise<ExternalTicketState> {
  const res = await ctx.http.get(`/api/v2/task/${ticketRef.externalId}`, {
    params: { include_markdown_description: false },      // keep payload lean
    headers: authHeader(ctx),
  });
  const task = res.data;

  return {
    externalId:   task.id,
    externalUrl:  task.url,
    title:        task.name,

    externalStatus:      task.status?.status,
    externalStatusColor: task.status?.color,
    externalStatusType:  task.status?.type,              // 'open' | 'custom' | 'closed'

    assignees: (task.assignees ?? []).map(a => ({
      externalId:  String(a.id),
      displayName: a.username,
      avatarUrl:   a.profilePicture,
    })),

    priority:      task.priority?.priority ?? task.priority,
    lastUpdatedAt: new Date(Number(task.date_updated)),
    fetchedAt:     new Date(),
    rawTask:       task,
  };
}
```

### 11.2 Orchestration — `InboundSyncService`

```typescript
// apps/api/src/plugins/inbound-sync.service.ts

@Injectable()
export class InboundSyncService {
  async refreshTicket(ticketLinkId: string, source: InboundSource, actingUserId?: string) {
    const link = await this.db.ticketLink.findUniqueOrThrow({ where: { id: ticketLinkId }, include: { install: true } });

    let external: ExternalTicketState;
    try {
      external = await this.plugins.dispatch<ExternalTicketState>({
        capability: 'pullTicketStatus',
        installId:  link.installId,
        scope:      resolveScope(link),
        payload:    { externalId: link.externalId },
      });
    } catch (err) {
      await this.markInboundError(link.id, err, source);
      throw err;
    }

    // 1. Update the snapshot columns on TicketLink (always)
    await this.db.ticketLink.update({
      where: { id: link.id },
      data: {
        externalStatus:        external.externalStatus,
        externalStatusColor:   external.externalStatusColor,
        externalStatusType:    external.externalStatusType,
        externalAssignees:     external.assignees as any,
        externalLastUpdatedAt: external.lastUpdatedAt,
        lastInboundSyncAt:     new Date(),
        lastInboundSource:     source,
        lastInboundSyncError:  null,
      },
    });

    // 2. Resolve inbound mapping
    const mapping = await this.findInboundMapping(link, external.externalStatus);

    // 3. Decide: auto-apply, prompt, or unmapped
    const binding = await resolveEffectiveBindingConfig(link);

    if (!mapping) {
      // UNMAPPED — create suggestion + notify ORG_ADMIN (if notifyUnmappedStatus=true)
      await this.recordSuggestion(link.id, external.externalStatus, null, 'UNMAPPED');
      if (binding.notifyUnmappedStatus ?? true) {
        await this.notifications.create({
          type: 'PLUGIN_STATUS_UNMAPPED',
          orgId: link.orgId,
          recipientRoles: ['ORG_ADMIN'],
          title: `Unknown ClickUp status: "${external.externalStatus}"`,
          body: `Task ${external.externalId} moved to "${external.externalStatus}" but no mapping is configured. Add a mapping to auto-sync this status.`,
          actionUrl: bindingConfigUrl(link),
          actionLabel: 'Configure Mapping',
          meta: { ticketLinkId: link.id, externalStatus: external.externalStatus },
        });
      }
      return { status: 'unmapped', external };
    }

    // 4. Mapping exists — apply or suggest based on binding.autoApplyInboundStatus
    if (binding.autoApplyInboundStatus) {
      await this.applyMappingToTarget(link, mapping);
      await this.recordSuggestion(link.id, external.externalStatus, mapping.platformValue, 'AUTO_APPLIED');
      // Toast notification (inbox; no email by default)
      await this.notifications.create({
        type: 'TICKET_STATUS_SYNCED',
        orgId: link.orgId,
        recipientUserId: actingUserId ?? null,
        recipientRoles: actingUserId ? undefined : ['QA_ENGINEER', 'TECH_LEAD'],
        title: `Ticket auto-synced: "${external.externalStatus}" → ${mapping.platformValue}`,
        body: `${link.externalTitle ?? external.externalId} was updated upstream and synced to ${mapping.platformValue}.`,
        actionUrl: snagDeepLink(link),
        actionLabel: 'View',
      });
      return { status: 'auto-applied', external, mapping };
    }

    // PENDING_APPROVAL — toast + notification, user clicks Apply
    await this.recordSuggestion(link.id, external.externalStatus, mapping.platformValue, 'PENDING_APPROVAL');
    await this.notifications.create({
      type: 'TICKET_STATUS_PENDING_APPROVAL',
      orgId: link.orgId,
      recipientRoles: ['QA_ENGINEER', 'TECH_LEAD'],
      title: `ClickUp says "${external.externalStatus}"`,
      body: `Map "${external.externalStatus}" → ${mapping.platformValue}?`,
      actionUrl: snagDeepLink(link),          // deep-link into Testing View with snag highlight
      actionLabel: 'Review & Apply',
      meta: { ticketLinkId: link.id, suggestionId: '…' },
    });
    return { status: 'pending-approval', external, mapping };
  }

  async applySuggestion(suggestionId: string, actingUserId: string) {
    const suggestion = await this.db.ticketStatusSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
      include: { ticketLink: true },
    });
    if (suggestion.appliedAt || suggestion.dismissedAt) throw new AlreadyProcessedError();
    if (!suggestion.mappedStatus) throw new NoMappingError();

    const mapping = await this.findInboundMapping(suggestion.ticketLink, suggestion.externalStatus);
    if (!mapping) throw new NoMappingError();

    await this.applyMappingToTarget(suggestion.ticketLink, mapping);
    await this.db.ticketStatusSuggestion.update({
      where: { id: suggestionId },
      data: { appliedAt: new Date(), appliedById: actingUserId },
    });
  }
}
```

### 11.3 What "apply mapping to target" means

The mapping's `targetType` decides which platform object gets updated:

| targetType | Action |
|---|---|
| `ISSUE_STATUS` | If `TicketLink.issueId` set → update `Issue.status` (the snag model) |
| `ISSUE_STATUS` | If `TicketLink.findingId` set → update `SessionFinding.status` |
| `PHASE` | If `TicketLink.featureId` set → advance `FeaturePhase` state (same hook as outbound, but reversed direction). **Phase mappings default to `BIDIRECTIONAL`** so the same row serves both push and pull. |

Write-back to the target object uses the normal service (`IssuesService.transitionStatus()`, `FindingsService.updateStatus()`, `PhaseEngine.transition()`) — **NOT** direct DB writes. This ensures audit logs, socket emissions, and cascading rules fire consistently.

### 11.4 Bulk refresh (project page open)

When user opens a project page with `bulkRefreshOnProjectOpen=true`:

1. Platform builds a map of `{ installId → listId → [externalIds] }` from all `TicketLink`s
2. For each `(installId, listId)` pair: `GET /api/v2/list/{listId}/task?date_updated_gt={max(lastInboundSyncAt) of links in this list}` (paginated)
3. Intersect returned tasks with local `TicketLink` table → for each intersection, call `InboundSyncService.refreshTicket(..., source='BULK_SYNC')`
4. Only tasks that actually changed since last sync trigger suggestions — no noise
5. Rate-limited per plugin's token bucket; skips refresh if bucket <10% remaining
6. Runs non-blocking in background; UI shows subtle "Syncing tickets…" indicator in project header

### 11.5 Mapping storage + UI

**Storage:** `PluginStatusMapping` with `direction=INBOUND, targetType=ISSUE_STATUS` (§PLUGIN_REGISTRY.md §4.1).

Phase mappings default to `BIDIRECTIONAL` so one row (e.g. `{ platformValue: "UAT", externalValue: "Ready for UAT" }`) serves outbound on phase promotion AND inbound on refresh.

**UI — Project integration settings → Inbound tab:**

```
┌─────────────────────────────────────────────────────────────┐
│  Inbound Status Mapping                                     │
│  When ClickUp says →     Map to our snag status →           │
│  ─────────────────────────────────────────────────          │
│  "Open"                  [OPEN ▼]                           │
│  "In Progress"           [IN_PROGRESS ▼]                    │
│  "Ready for QA"          [OPEN ▼]          ← custom mapping │
│  "Resolved"              [RESOLVED ▼]                       │
│  "Closed"                [CLOSED ▼]                         │
│  "Won't Fix"             [WONT_FIX ▼]                       │
│                                                             │
│  Auto-apply mappings: ( ) Yes — update immediately          │
│                       (●) No  — show me a toast to approve  │
│                                                             │
│  Unmapped statuses: [x] Notify ORG_ADMIN                    │
│                                                             │
│  Bulk refresh on project open: [x] Enabled                  │
└─────────────────────────────────────────────────────────────┘
```

Left column pre-populated by `GET /clickup/statuses?listId=`; right column is our `IssueStatus` enum.

"Learn a mapping" shortcut: when an unmapped status lands, the notification CTA opens this grid with a new row already added for that status — user just picks the right-hand dropdown and saves.

### 11.6 Deep link into Testing View with snag highlight

Every inbound suggestion creates a `notification.actionUrl` of the form:

```
/projects/:projectId/features/:featureId/test?highlight=issue:{issueId}&suggestion={suggestionId}
```

The Testing View (see `docs/FEATURE_PLAYER.md` §10.7) detects the `highlight=issue:…` param on load:
1. Opens the Snags drawer in the right side
2. Scrolls to the matching snag
3. Pulses a yellow border around it for 2s
4. If `suggestion=…` is present, also opens the inline "Apply mapping?" banner on that snag with `[Apply]` + `[Dismiss]` buttons

### 11.7 API endpoints

```
POST   /api/v1/ticket-links/:id/refresh                  Trigger pullTicketStatus for one link
POST   /api/v1/projects/:projectId/ticket-links/refresh-all  Bulk refresh all links in a project
GET    /api/v1/ticket-links/:id/status-suggestions       List pending suggestions for a link
POST   /api/v1/status-suggestions/:id/apply              Apply a pending suggestion (user clicked Apply)
POST   /api/v1/status-suggestions/:id/dismiss            Dismiss a pending suggestion
GET    /api/v1/projects/:projectId/status-suggestions?status=PENDING   List all pending in project (for dashboard badge)
```

---

## 12. Capability: `webhookListener` (Real-time Inbound)

ClickUp pushes events to our platform — skips the need to manually refresh. Same handler as §11 once the payload is decoded.

> **Enablement gate.** Webhook registration only happens on `onEnable` when `binding.webhookEnabled=true` AND the install is fully enabled (§PLUGIN_REGISTRY.md §4.5). On install disable or capability opt-out, the upstream webhook is deregistered and the receiver short-circuits with `result=ignored-plugin-disabled` for any in-flight deliveries.

### 12.1 Registration

At install-enable time (and after every config change that toggles webhooks), we register a workspace-scoped webhook:

```typescript
// apps/api/src/plugins/clickup/lifecycle.ts — extended

async onEnable(ctx) {
  await refreshWorkspaceHierarchy(ctx);
  if (ctx.config.webhookEnabled !== false) {
    await registerClickUpWebhook(ctx);
  }
}

async registerClickUpWebhook(ctx: PluginCtx<ClickUpConfig, ClickUpSecrets>) {
  // 1. Create a local PluginWebhookEndpoint row → generates signingSecret + URL
  const endpoint = await ctx.services.webhookEndpoints.create({
    installId: ctx.installId,
    signingSecret: randomBytes(32).toString('hex'),
  });
  // endpoint.path = /webhooks/plugins/{orgId}/{installId}/{token}
  // public URL = `${WEB_URL}${endpoint.path}`

  // 2. Call ClickUp to register the webhook
  const res = await ctx.http.post(
    `/api/v2/team/${ctx.config.defaultWorkspaceId}/webhook`,
    {
      endpoint:   `${process.env.API_URL}${endpoint.path}`,
      events:     ctx.config.webhookEvents ?? ['taskStatusUpdated', 'taskMoved', 'taskDeleted'],
    },
    { headers: authHeader(ctx) },
  );

  // 3. Store ClickUp's returned webhook id + secret on the endpoint row
  await ctx.services.webhookEndpoints.update(endpoint.id, {
    externalWebhookId: res.data.id,
    externalSigningSecret: res.data.webhook.secret,      // ClickUp's secret for HMAC
    events: res.data.webhook.events,
  });
}

async onDisable(ctx) {
  await invalidateWorkspaceHierarchy(ctx);
  await unregisterClickUpWebhook(ctx);    // DELETE /api/v2/webhook/{id}
}
```

### 12.2 Receiver endpoint

```typescript
// apps/api/src/plugins/webhook.controller.ts — generic for all plugins

@Controller('webhooks/plugins')
export class PluginWebhookController {
  @Post(':orgId/:installId/:token')
  async receive(
    @Param('orgId') orgId: string,
    @Param('installId') installId: string,
    @Param('token') token: string,
    @Headers() headers: Record<string, string>,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: boolean }> {
    const endpoint = await this.db.pluginWebhookEndpoint.findFirst({
      where: { installId, path: { endsWith: `/${token}` }, isActive: true },
    });
    if (!endpoint) throw new NotFoundException();

    // 1. Verify HMAC using ClickUp's secret
    const plugin = getPlugin((await this.db.orgPluginInstall.findUnique({ where: { id: installId } }))!.pluginId);
    const impl = plugin.implementations.webhookListener!;
    const result = await impl({
      rawBody:       req.rawBody!,
      headers,
      endpointSecret: endpoint.externalSigningSecret,
    }, /* ctx */ );

    await this.db.pluginWebhookEndpoint.update({
      where: { id: endpoint.id },
      data: { lastCalledAt: new Date() },
    });

    return { ok: true };
  }
}
```

### 12.3 ClickUp implementation

```typescript
// apps/api/src/plugins/clickup/implementations/webhook-listener.ts

export async function handleWebhook(
  req: { rawBody: Buffer; headers: Record<string, string>; endpointSecret: string },
  ctx: PluginCtx<ClickUpConfig, ClickUpSecrets>,
): Promise<WebhookResult> {
  // 1. Verify HMAC-SHA256 signature
  const sig = req.headers['x-signature'];
  if (!sig) throw new UnauthorizedError('Missing X-Signature');

  const expected = crypto
    .createHmac('sha256', req.endpointSecret)
    .update(req.rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    throw new UnauthorizedError('Invalid signature');
  }

  // 2. Parse payload
  const payload = JSON.parse(req.rawBody.toString('utf-8'));
  const { event, task_id, history_items } = payload;

  if (!task_id) return { handled: false };

  // 3. Find all TicketLinks for this external id under this install
  const links = await ctx.db.ticketLink.findMany({
    where: { installId: ctx.installId, externalId: task_id, deletedAt: null },
  });
  if (links.length === 0) return { handled: false, eventType: event };

  // 4. Route by event type
  switch (event) {
    case 'taskStatusUpdated': {
      // Use the "after" from history_items — skip an API round trip
      const statusChange = history_items.find((h: any) => h.field === 'status');
      if (!statusChange) return { handled: false };

      for (const link of links) {
        // Fast path: use payload; also do a pullTicketStatus to refresh full state
        await ctx.services.inboundSync.refreshTicket(link.id, 'WEBHOOK');
      }
      return { handled: true, eventType: event, affectedIds: links.map(l => l.id) };
    }

    case 'taskMoved': {
      // List changed — TicketLink.externalListId may be stale; refresh anyway
      for (const link of links) {
        await ctx.services.inboundSync.refreshTicket(link.id, 'WEBHOOK');
      }
      return { handled: true, eventType: event, affectedIds: links.map(l => l.id) };
    }

    case 'taskDeleted': {
      for (const link of links) {
        // Soft-delete the TicketLink; notify
        await ctx.db.ticketLink.update({ where: { id: link.id }, data: { deletedAt: new Date() } });
        await ctx.services.notifications.create({
          type: 'TICKET_DELETED_UPSTREAM',
          orgId: link.orgId,
          recipientRoles: ['QA_ENGINEER', 'TECH_LEAD'],
          title: `Linked ticket deleted in ClickUp`,
          body: `Task ${link.externalId} was deleted upstream; link removed.`,
        });
      }
      return { handled: true, eventType: event, affectedIds: links.map(l => l.id) };
    }

    default:
      return { handled: false, eventType: event };
  }
}
```

### 12.4 Signature verification details (ClickUp-specific)

- Header: `X-Signature`
- Algorithm: HMAC-SHA256, **hex encoded** (not base64)
- Body: **raw request bytes** — NestJS must be configured with `rawBody: true` on the request; do NOT re-serialize JSON before verifying
- Timing-safe compare (`crypto.timingSafeEqual`) to prevent timing attacks
- If signature invalid → 401, increment `pluginWebhookEndpoint.failedVerificationCount`; after 10 in an hour, disable endpoint and notify ORG_ADMIN

### 12.5 Operational concerns

- **Replay protection:** ClickUp payloads include a unique `webhook_id` + event timestamp — we keep a rolling 5-min Redis set `webhook:seen:{installId}` to reject duplicates
- **Failure retries:** if our handler 5xx's, ClickUp retries with backoff. We also BullMQ-enqueue a `webhook-replay` job on our side so even if the ClickUp retry window lapses, we can reprocess from `webhook_events` table (see §12.6)
- **Webhook audit:** every inbound request logs to `webhook_events` table — `{ installId, event, externalId, payloadDigest, processedAt, result }` — 30-day retention, admin-visible
- **Endpoint rotation:** `POST /plugin-installs/:id/webhook/rotate` endpoint regenerates the path token + signing secret; re-registers with ClickUp; old path continues to accept for 1h grace

### 12.6 `webhook_events` audit table (Prisma addition)

```prisma
model WebhookEvent {
  id             String   @id @default(uuid())
  orgId          String
  installId      String
  endpointId     String
  eventType      String
  externalId     String?                              // task id etc.
  payloadDigest  String                               // SHA-256 of raw body
  result         String                               // "handled" | "ignored" | "error:<code>"
  errorMessage   String?
  processedAt    DateTime @default(now())
  payloadStore   String?                              // S3 key if full payload archived (optional)

  endpoint       PluginWebhookEndpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([orgId, installId, processedAt])
  @@index([eventType, processedAt])
  @@map("webhook_events")
}
```

### 12.7 Phase 2 enhancement — smart debouncing

A single user action in ClickUp can fire 3+ events rapidly (`taskStatusUpdated`, `taskUpdated`, `taskMoved`). Debounce via Redis key `webhook:debounce:{installId}:{externalId}` with 500ms TTL — first event wins, second event within window updates the target but skips the full refresh call.

---

## 13. REST API (ClickUp-specific endpoints)

Augmenting the generic plugin API in `PLUGIN_REGISTRY.md` §8:

```
GET    /api/v1/plugins/:installId/clickup/workspaces                  List workspaces (teams)
GET    /api/v1/plugins/:installId/clickup/spaces?workspaceId=         List spaces
GET    /api/v1/plugins/:installId/clickup/folders?spaceId=            List folders
GET    /api/v1/plugins/:installId/clickup/lists?spaceId=|folderId=    List lists
GET    /api/v1/plugins/:installId/clickup/statuses?listId=            List statuses (for mapping UI)
GET    /api/v1/plugins/:installId/clickup/custom-fields?listId=       List custom fields

GET    /api/v1/plugins/:installId/docs?q=&spaceId=                    List/search Docs
GET    /api/v1/plugins/:installId/docs/:docId                         Get Doc content (cache or fresh)
POST   /api/v1/plugins/:installId/docs/:docId/refresh                 Force refetch

POST   /api/v1/doc-links                                              Create DocLink ({ installId, docId, projectId?, moduleId?, featureId? })
GET    /api/v1/doc-links?projectId=|moduleId=|featureId=              List DocLinks for a scope
DELETE /api/v1/doc-links/:id                                          Remove DocLink

# Inbound status sync (§11)
POST   /api/v1/ticket-links/:id/refresh                               Trigger pullTicketStatus
POST   /api/v1/projects/:projectId/ticket-links/refresh-all           Bulk refresh (async BullMQ job)
GET    /api/v1/ticket-links/:id/status-suggestions?status=PENDING     List suggestions
POST   /api/v1/status-suggestions/:id/apply                           Apply a pending suggestion
POST   /api/v1/status-suggestions/:id/dismiss                         Dismiss a suggestion
GET    /api/v1/projects/:projectId/status-suggestions?status=PENDING  Project-wide pending badge
GET    /api/v1/plugins/:installId/clickup/inbound-mappings            List inbound status mappings
PUT    /api/v1/plugins/:installId/clickup/inbound-mappings            Replace mappings (bulk upsert)

# Webhooks (§12)
POST   /api/v1/webhooks/plugins/:orgId/:installId/:token              Inbound ClickUp webhook receiver
POST   /api/v1/plugin-installs/:id/webhook/rotate                     Rotate endpoint token + signing secret
GET    /api/v1/plugin-installs/:id/webhook/events?limit=50            Admin — recent webhook events (audit)
```

---

## 14. Database Models (ClickUp-specific additions)

No ClickUp-specific models beyond the generic plugin registry. All ClickUp data lives in:

| Model | Holds |
|---|---|
| `OrgPluginInstall` (pluginId='clickup') | Token + workspace default |
| `ProjectPluginBinding` | List id + target mode + status mappings |
| `ModulePluginBinding` | Module overrides (different list, etc.) |
| `FeaturePluginBinding` | Feature overrides |
| `TicketLink` | Each linked ClickUp task |
| `DocLink` | Each linked ClickUp Doc (multi-scope) |

---

## 15. Error Handling — Typed Errors

```typescript
// apps/api/src/plugins/clickup/errors.ts
export class ClickUpAuthError       extends PluginTransientError { /* 401 */ }
export class ClickUpRateLimitError  extends PluginTransientError { /* 429 + Retry-After */ }
export class ClickUpNotFoundError   extends PluginPermanentError { /* 404 */ }
export class ClickUpValidationError extends PluginPermanentError { /* 400 */ }
export class ClickUpServerError     extends PluginTransientError { /* 5xx */ }
export class ClickUpProtocolError   extends PluginPermanentError { /* malformed response */ }
```

Callers distinguish transient vs permanent in UI (e.g. "We couldn't reach ClickUp, retrying..." vs "This task no longer exists").

---

## 16. UI Surfaces (ClickUp-specific)

### 14.1 Install modal

Auto-rendered from manifest. Specific fields:
- **Token** — `password` input; help: "Generate at ClickUp → Settings → Apps → API Token"
- **Workspace** — dropdown lazy-loaded once token is entered + validated (calls `GET /team`)
- **Test connection** button — `healthCheck()` — shows green check + username on success

### 14.2 Project integration settings

Auto-rendered from binding schema. Fields:
- Space → Folder → List cascading selects (fed by workspace hierarchy cache)
- Target mode — `[ List mode | Subtask mode ]` pill
- Parent task — async autocomplete via `GET /list/{listId}/task?search=...`, visible only when `subtask` mode
- Status mapping — grid of 4 rows (QA / UAT / Signoff Pending / Signed Off), each with dropdown of list statuses
- Advanced (collapsed): custom field for severity, bug tag, attach recordings toggle + size cap

### 14.3 Feature page — ClickUp widgets

**Linked Ticket widget** (sidebar of `FeaturePage`):
```
┌───────────────────────────────────┐
│ ClickUp Ticket                    │
│ [ABC-123] Login page broken       │
│ Status: In QA    Assignee: Sam    │
│                 [Open] [Unlink]   │
└───────────────────────────────────┘
```
If no ticket linked: `[+ Link a ClickUp task]` button.

**Linked Docs widget** (same sidebar):
```
┌───────────────────────────────────┐
│ Linked Docs (2)       [+ Link]    │
│ 📄 OAuth AC                       │
│ 📄 Login UX spec                  │
└───────────────────────────────────┘
```

### 14.4 Failure panel — Create Ticket action

In `StepFailurePanel` (automated run failures) and `FindingForm` (exploratory findings):
- Button `[Create Ticket ▼]` — dropdown lists every installed `createIssue`-capable plugin
- Select ClickUp → modal pre-filled:
  - Title: `{testCase.name} — step {stepIndex} failed: {error.shortMessage}`
  - Description: AI-drafted failure summary + repro steps + linked run URL
  - Target list/mode: resolved from effective binding (shown read-only as "→ My QA Bugs (list mode)")
  - Attachments: screenshots + any step video clip, pre-selected
- `[Create]` → `PluginService.dispatch({ capability: 'createIssue', ... })` → toast + link to ticket

### 14.5 Testing View — Doc pill

**New pill** in top action bar, right of mode toggle:
```
[← Login Flow]  [Env ▼]  [Manual | Automated]  [📄 2 docs ▼]  [▶ Start] [✕]
```
Click → dropdown of Doc titles → selecting a doc opens a right side drawer (380px) with rendered markdown. Drawer has tabs per page. Feature under test continues behind the drawer (or collapses to 50% width if user pins drawer).

See `docs/FEATURE_PLAYER.md` §10.6 for full spec.

---

## 17. Integration with Other Systems

| System | How ClickUp plugin fits |
|---|---|
| `docs/EXPLORATORY_TESTING.md` | `SessionFinding → createIssue` uses ClickUp subtask/list; recording upload uses §6.5 fallback |
| `docs/IN_APP_NOTIFICATIONS.md` | `PLUGIN_HEALTH_DEGRADED` fires on outages; `TICKET_CREATED` confirms push |
| `docs/TESTING_PHASES_AND_REPORTS.md` | Phase transitions trigger `syncPhaseStatus` via registry |
| `docs/AI_GENERATION_SPEC.md` | `fetchTicketContext` + linked Doc content injected into prompt context block |
| `docs/FEATURE_PLAYER.md` | Doc pill surfaces `DocLink`s; linked ticket widget surfaces `TicketLink` |
| `docs/MANUAL_TESTING.md` | Manual failure panel `[Create Ticket]` dispatches through ClickUp plugin |

---

## 18. Rate Limiting

- ClickUp free: 100 req/min per token
- Business+: ~1000 req/min
- Our token-bucket in Redis (`plugin:ratelimit:clickup:{orgId}`) refills at 90/min (10% safety margin)
- On 429, respect `Retry-After` header; retry once
- 3 consecutive 429s in 5 min → `PLUGIN_RATE_LIMITED` notification to `ORG_ADMIN`

---

## 19. Phased Rollout (within 5.8)

| Sub-phase | Scope |
|---|---|
| **5.8-a** | Manifest, schemas, lifecycle, `createIssue`, `linkTicket`, install/binding UI, status mapping UI, `syncPhaseStatus` — fully usable for feature-ticket linking + bug push |
| **5.8-b** | `fetchTicketContext` → AI generation integration, AC extraction, link from test editor |
| **5.8-c** | Attachment upload (screenshots always, recordings conditional), size fallback |
| **5.8-d** | `fetchDocs` + DocLink model + UI surfaces (widgets, pill, viewer drawer, multi-scope linking modal) |
| **5.8-e** | Caching + refresh + AI context injection from Docs |
| **5.8-i** | **Inbound status sync** — `pullTicketStatus` capability, `[↺ Refresh]` button, bi-directional mapping UI, `InboundSyncService`, toast + notification flow, `TicketStatusSuggestion` model, bulk refresh, unmapped-status admin notifications |
| **5.8-j** | **Webhooks** — auto-register subscriptions on enable, generic webhook receiver with HMAC verification, ClickUp `webhookListener` impl (`taskStatusUpdated` / `taskMoved` / `taskDeleted`), `WebhookEvent` audit table, replay protection, endpoint rotation |
| **Phase 2 (later)** | OAuth 2.0, webhook debouncing, `taskCommentPosted` handling, Doc change webhooks |

---

## 20. Acceptance Criteria

### Installation

- [ ] `ORG_ADMIN` can install ClickUp plugin with a PAT token
- [ ] Invalid token rejected at save-time (healthCheck fails → form shows error, no install row created)
- [ ] Workspace dropdown populates after valid token
- [ ] Install creates encrypted `secretsCiphertext`; token never returned in subsequent GETs
- [ ] `onEnable` pre-warms workspace hierarchy cache in Redis
- [ ] Uninstall zeros secrets, soft-deletes install, cascades project/module/feature bindings

### Project binding

- [ ] `OWNER` / `TECH_LEAD` can create a project binding
- [ ] Space → folder → list cascading dropdowns work off cached hierarchy
- [ ] Saving binding with `targetMode=subtask` and no `parentTaskId` rejected with 400
- [ ] Saving binding with `targetMode=list` and no `targetListId` rejected with 400
- [ ] Phase status mapping grid saves all four phase→status mappings
- [ ] Attach recordings toggle + size cap saves correctly

### Module binding override

- [ ] `OWNER` / `TECH_LEAD` can override `targetListId` at module level
- [ ] Module override shows project-inherited value as ghost placeholder
- [ ] `[Inherit]` toggle removes the override field; resaving re-inherits
- [ ] Effective config at module level = project merged with module partial

### Feature binding override

- [ ] Feature-level override takes precedence over module AND project
- [ ] UI shows cascade clearly: "inherited from module: My QA Bugs"

### createIssue — list mode

- [ ] Creating a finding → ClickUp task appears in the configured list
- [ ] Task name = finding title; description contains repro steps in markdown
- [ ] Screenshots uploaded as attachments (≤10 MB)
- [ ] Recording uploaded if ≤50 MB and `attachRecordings=true`; otherwise link in description
- [ ] `TicketLink` row created with correct `externalId`, `externalUrl`, `findingId` or `issueId`
- [ ] Toast in UI shows "Ticket ABC-123 created" with link

### createIssue — subtask mode

- [ ] Creating a finding in subtask mode → ClickUp subtask under the configured parent
- [ ] Parent context line appears in description (`> Related feature: [Login Flow](url)`)
- [ ] Subtask visible in ClickUp as child of parent task
- [ ] `TicketLink.parentExternalId` set

### linkTicket

- [ ] Pasting a full ClickUp URL resolves to the correct task
- [ ] Pasting a custom task ID (e.g. `ABC-123`) resolves via custom-id endpoint
- [ ] Pasting an invalid URL returns 400 with clear error
- [ ] Linked ticket widget shows status, assignees, open link

### syncPhaseStatus

- [ ] Moving feature from QA → UAT updates ClickUp task status to the mapped name
- [ ] If mapping missing for a phase, sync is skipped with warn log (no error)
- [ ] Audit log entry written for every sync

### fetchTicketContext

- [ ] `POST /api/v1/ai-generation/import-ac` pulls markdown description + acceptance criteria bullets
- [ ] ACs extracted from `## Acceptance Criteria` / `## AC` / `**Acceptance Criteria**` sections
- [ ] Last 20 comments included in context; comments stripped of ClickUp-specific markup
- [ ] Fetched context cached in Redis 5 min keyed by taskId

### fetchDocs

- [ ] `[+ Link Doc]` modal opens with Paste + Browse tabs
- [ ] Pasting a Doc URL resolves to the correct Doc by ID
- [ ] Browse tab paginates (50 per page); search filters by title
- [ ] Multi-scope checkboxes (project / module / feature) create multiple `DocLink` rows atomically
- [ ] Linked Doc renders in DocViewer with correct markdown + page tabs
- [ ] "Refresh" button fetches fresh content and updates cache
- [ ] Cache expires after 24h; access auto-refreshes

### Doc surfaces

- [ ] `FeaturePage` shows linked Docs widget with count
- [ ] Testing View top bar shows `📄 N docs` pill; click opens dropdown
- [ ] Click a Doc → right side drawer with rendered markdown
- [ ] Module page shows its linked Docs
- [ ] Project overview shows project-scoped linked Docs
- [ ] Docs linked at multiple scopes collapse to single pill with tooltip

### Attachment behaviour

- [ ] Screenshot ≤10 MB → uploaded to task
- [ ] Screenshot >10 MB → signed URL link in description
- [ ] Recording ≤50 MB, `attachRecordings=true` → uploaded
- [ ] Recording >50 MB → signed URL link
- [ ] Recording any size, `attachRecordings=false` → signed URL link
- [ ] Upload failure → gracefully falls back to URL link
- [ ] Signed URL uses 30-day expiry by default

### Rate limits

- [ ] Token bucket in Redis refills at 90/min
- [ ] 429 response with `Retry-After` respected; retries once
- [ ] 3 consecutive 429s in 5 min → `PLUGIN_RATE_LIMITED` notification to `ORG_ADMIN`

### Health

- [ ] Background health check fires every 15 min
- [ ] `ok=false` transitions trigger `PLUGIN_HEALTH_DEGRADED` notification
- [ ] Admin UI shows health badge + last-checked timestamp
- [ ] Manual `POST .../health-check` endpoint triggers immediate check

### Errors

- [ ] 401 → `ClickUpAuthError` → typed UI message ("Token invalid or revoked")
- [ ] 429 → `ClickUpRateLimitError` → retry + eventual user-facing error if persistent
- [ ] 404 on task → `ClickUpNotFoundError` → "Task no longer exists; unlink?"
- [ ] Malformed JSON → `ClickUpProtocolError` → logged with full request context (secrets redacted)

### Inbound status sync (§11)

- [ ] `[↺ Refresh]` button on every snag card, LinkedTicketWidget, and SessionFinding card (wherever a `TicketLink` exists)
- [ ] Click Refresh → `pullTicketStatus` dispatched → `TicketLink.externalStatus/Color/Type/Assignees/LastUpdatedAt` updated in DB
- [ ] External status in our UI badge mirrors ClickUp's colour (uses `externalStatusColor`)
- [ ] When mapping exists AND `autoApplyInboundStatus=false` → toast appears + in-app notification fires (`TICKET_STATUS_PENDING_APPROVAL`); notification CTA deep-links to `/projects/:id/features/:featureId/test?highlight=issue:xxx&suggestion=xxx`
- [ ] When mapping exists AND `autoApplyInboundStatus=true` → snag status updates immediately; `TICKET_STATUS_SYNCED` notification fires (in-app only by default)
- [ ] When mapping missing → `TicketStatusSuggestion` row with `kind=UNMAPPED`; `PLUGIN_STATUS_UNMAPPED` notification to ORG_ADMIN (if `notifyUnmappedStatus=true`)
- [ ] `Apply` button on suggestion → `applySuggestion` service call → snag status transitions via normal service (not direct DB write); audit log entry written
- [ ] `Dismiss` button → suggestion marked dismissed, no snag change
- [ ] Once applied or dismissed, a suggestion cannot be re-applied (idempotent)
- [ ] Inbound mapping UI: `GET /clickup/statuses?listId=` populates left column; right column uses our `IssueStatus` enum
- [ ] Inbound mapping rejects duplicate `(bindingId, direction, targetType, externalValue)` with 400
- [ ] Phase mappings saved as `BIDIRECTIONAL` by default — one row serves push (phase promotion) + pull (refresh)
- [ ] Bulk refresh on project open: `GET /list/:id/task?date_updated_gt={lastSync}` used where possible; per-ticket pulls only if list unavailable
- [ ] Bulk refresh runs non-blocking, shows "Syncing tickets…" indicator; skips if token bucket <10% remaining
- [ ] Write-back applies via `IssuesService.transitionStatus()` / `FindingsService.updateStatus()` / `PhaseEngine.transition()` — NEVER direct DB writes

### Webhooks (§12)

- [ ] On install enable with `webhookEnabled=true` → `POST /team/:wid/webhook` registers subscription; `PluginWebhookEndpoint` row created with `externalWebhookId` + `externalSigningSecret`
- [ ] On install disable or uninstall → `DELETE /webhook/:id` unregisters upstream; endpoint row deactivated
- [ ] On config change that toggles webhook events → upstream subscription updated in place (PUT) or re-registered
- [ ] Receiver endpoint at `/webhooks/plugins/:orgId/:installId/:token` accepts POST
- [ ] HMAC-SHA256 hex of raw body verified against `X-Signature` header using timing-safe compare
- [ ] Invalid signature → 401 + increment `failedVerificationCount`; 10 in 1h disables endpoint + notifies ORG_ADMIN
- [ ] Valid `taskStatusUpdated` → `InboundSyncService.refreshTicket(link, 'WEBHOOK')` invoked (same handler as manual refresh)
- [ ] Valid `taskDeleted` → `TicketLink` soft-deleted; `TICKET_DELETED_UPSTREAM` notification to `QA_ENGINEER`/`TECH_LEAD`
- [ ] Valid `taskMoved` → refresh pulled (list may have changed)
- [ ] Every inbound webhook creates a `WebhookEvent` audit row with `result` = `"handled"` / `"ignored"` / `"error:CODE"`
- [ ] 30-day retention on `WebhookEvent` table via nightly cleanup cron
- [ ] Replay protection: duplicate `webhook_id` within 5 min rejected; Redis set `webhook:seen:{installId}`
- [ ] Endpoint rotation: `POST /webhook/rotate` generates new token + secret; old path continues to accept for 1h
- [ ] Debouncing (Phase 2): rapid-fire events (3+ in 500ms) collapse via Redis key `webhook:debounce:{installId}:{externalId}`

### Deep-link highlight into Testing View

- [ ] `actionUrl` on inbound notifications: `/projects/:id/features/:fid/test?highlight=issue:xxx&suggestion=xxx`
- [ ] Testing View detects `highlight=issue:…` on mount → opens Snags drawer → scrolls to matching snag → pulses yellow border 2s
- [ ] If `suggestion=…` present → inline banner on snag with "Apply mapping?" + `[Apply]` + `[Dismiss]`
- [ ] Back button returns user to wherever they came from (notification centre or project page)

### Audit trail

- [ ] `plugin.dispatch.createIssue` audit log entry on every issue creation
- [ ] `plugin.dispatch.syncPhaseStatus` entry on every phase sync
- [ ] `plugin.dispatch.pullTicketStatus` entry on every refresh (manual or webhook-triggered)
- [ ] `plugin.status.suggestion.applied` entry when user clicks Apply
- [ ] `plugin.webhook.received` entry logged via `WebhookEvent` table
- [ ] `plugin.binding.create` entry on binding creation
- [ ] `plugin.install` / `plugin.uninstall` entries on install lifecycle

### Security

- [ ] PAT never appears in API response, logs, audit meta, or error messages
- [ ] Encrypted at rest, decrypted only in-memory at dispatch time
- [ ] Secret fields show `••••••••` placeholder in configure modal; blank = unchanged

---

## 21. Open Questions / Future Iterations

- **OAuth 2.0** (Phase 2) — per-user tokens for richer permissions (private Docs access, user-scoped time logging)
- **Webhook listener** — inbound events: ticket status changed → update `TicketLink.externalStatus`; Doc updated → refresh cache
- **Bidirectional comments** — post comments from platform to ClickUp task
- **Time logging** — log a QA session's duration to the linked ClickUp task (Phase 11.D)
- **Native in-platform Docs** — hybrid Phase 2: optional in-platform Doc editor (TipTap) that can sync bi-directionally with ClickUp Docs
- **Multiple ClickUp installs per org** — e.g. personal + work workspaces — schema supports (`@@unique([orgId, pluginId, displayLabel])`) but UI needs dual-install polish
- **Batch AC import** — pulling all tasks in a list at once for bulk feature generation
