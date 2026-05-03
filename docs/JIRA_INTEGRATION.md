# Jira Integration — Plugin Registry Specification

> **Status:** Planned
> **Depends on:** `docs/PLUGIN_REGISTRY.md` (foundation), `docs/PM_INTEGRATIONS.md` (ClickUp reference implementation)

---

## 1) Why this doc exists

ClickUp has a full plugin plan, but Jira is currently split across older pre-registry notes and partial references.
This document defines a Jira implementation that follows the unified plugin model (manifest, install, bindings,
capability-gated dispatch, webhook handling), so Jira can be built without introducing a second integration pattern.

---

## 2) Current planning state (research summary)

- Plugin architecture is already defined in `docs/PLUGIN_REGISTRY.md` and is intended for Jira, ClickUp, Slack, and future providers.
- ClickUp is the first full consumer in `docs/PM_INTEGRATIONS.md` and should be treated as the blueprint for Jira.
- Old references still exist in legacy planning (`IntegrationPlugin` naming and pre-registry Jira tasks), but Phase 5.8 explicitly supersedes that design.
- No dedicated Jira plugin spec currently exists; this doc fills that gap.

---

## 3) Plugin management and registration model (must match core)

Jira uses the same lifecycle and storage model as all registry plugins:

1. **Static manifest registration**
   - Add `jiraPlugin` under `apps/api/src/plugins/jira/`
   - Register in `apps/api/src/plugins/registry.ts`
   - No runtime plugin discovery

2. **Org-level install**
   - Store non-secret config in `OrgPluginInstall.config`
   - Store encrypted Jira secrets in `OrgPluginInstall.secretsCiphertext`
   - Run health check on install/update

3. **Project/module/feature bindings**
   - Project binding defines Jira defaults (`projectKey`, issue type, labels, etc.)
   - Module/feature bindings provide partial overrides
   - Effective config resolution order remains:
     plugin defaults -> project binding -> module binding -> feature binding

4. **Capability gate (four-level guard)**
   - Install enabled + healthy
   - Project binding exists
   - Capability opted in for that project
   - Capability-specific config is valid

5. **Webhook registration and inbound handling**
   - Reuse `PluginWebhookEndpoint` and generic `/webhooks/plugins/:orgId/:installId/:token`
   - Jira webhook registration/deregistration handled in plugin lifecycle hooks
   - HMAC/signature verification and replay protection handled via shared webhook framework

---

## 4) Jira plugin scope

## 4.1 V1 capabilities

- `createIssue`
- `linkTicket`
- `pullTicketStatus`
- `syncPhaseStatus`
- `fetchTicketContext`
- `webhookListener`

## 4.2 V2 capability (later)

- `logTime` (aligned with `docs/SESSION_TRACKING.md` time logging roadmap)

---

## 5) Manifest and schemas

```typescript
// apps/api/src/plugins/jira/index.ts
export const jiraPlugin: PluginManifest<JiraConfig, JiraSecrets> = {
  id: 'jira',
  displayName: 'Jira',
  description: 'Create and sync Jira issues from QA Platform',
  iconUrl: '/plugin-icons/jira.svg',
  version: '1.0.0',
  capabilities: [
    'createIssue',
    'linkTicket',
    'pullTicketStatus',
    'syncPhaseStatus',
    'fetchTicketContext',
    'webhookListener',
  ],
  configSchema: jiraConfigSchema,
  secretsSchema: jiraSecretsSchema,
  bindingConfigSchema: jiraBindingSchema,
  lifecycle,
  implementations,
};
```

### 5.1 `configSchema` (org install, non-secret)

- `baseUrl` (default `https://your-domain.atlassian.net`)
- `deploymentType` (`cloud` | `server` | `datacenter`)
- `defaultJqlWindowDays` (for bulk refresh windows)

### 5.2 `secretsSchema` (encrypted)

- PAT/Auth token path for server/datacenter
- OAuth client/refresh token path for cloud (if enabled)
- Optional webhook secret when required by deployment mode

### 5.3 `bindingConfigSchema` (project/module/feature)

- `projectKey`
- `issueTypeId` or `issueTypeName`
- `defaultPriority`
- `defaultLabels[]`
- `assigneeStrategy` (`reporter` | `featureOwner` | `fixed`)
- `fixedAssigneeAccountId?`
- `phaseStatusMap` (platform phase -> Jira transition target)
- `webhookEnabled` and subscribed events

---

## 6) Capability design

### 6.1 `createIssue`

- Creates Jira issue from failure/finding/issue context
- Adds structured description with run URL, step details, evidence links
- Attaches screenshots directly; large recordings use signed URL fallback (same rule as ClickUp)
- Persists `TicketLink` (`externalId`, `externalUrl`, `externalStatus`)

### 6.2 `linkTicket`

- Accepts Jira key (`PROJ-123`) or URL
- Resolves and validates ticket exists
- Creates/updates `TicketLink`

### 6.3 `pullTicketStatus`

- Fetches latest status/assignee/update time for linked Jira issue
- Feeds `InboundSyncService` for refresh and optional auto-apply mapping

### 6.4 `syncPhaseStatus`

- Applies outbound phase mapping from platform phase to Jira transition/state
- Uses `PluginStatusMapping` rules to avoid hardcoded statuses

### 6.5 `fetchTicketContext`

- Pulls acceptance criteria, summary, and recent comments into AI context
- Used by test generation and "explain this feature" surfaces

### 6.6 `webhookListener`

- Handles issue updated/transitioned/deleted events
- Verifies signature/auth
- Routes to `InboundSyncService.refreshTicket(..., 'WEBHOOK')`
- Audits every inbound event via `WebhookEvent`

---

## 7) Implementation order (recommended)

1. **Core registration**
   - Add Jira plugin folder, manifest, schemas, registry entry, icon
2. **Install and binding UX**
   - Org install form + project binding form using shared `PluginConfigForm`
3. **Ticket lifecycle**
   - `createIssue` + `linkTicket` end-to-end
4. **Status sync**
   - `pullTicketStatus` + inbound mapping UI reuse + `syncPhaseStatus`
5. **Webhooks**
   - Jira webhook registration + receiver + replay/signature controls
6. **AI context**
   - `fetchTicketContext` integration with generation prompt
7. **Hardening**
   - Contract tests, integration tests, manual verification script

---

## 8) Delivery acceptance checklist

- Jira install succeeds with valid credentials, fails cleanly with invalid credentials.
- Binding cascade works (project default, module override, feature override).
- "Create Ticket" action can target Jira and stores `TicketLink`.
- Refresh pulls latest Jira status into linked records.
- Phase transition sync updates Jira according to configured mappings.
- Webhook updates reflect in platform within seconds and are audited.
- Disabling Jira install or capability hides Jira UI surfaces and short-circuits dispatch.

---

## 9) Notes on compatibility with existing docs

- This spec follows the registry contract in `docs/PLUGIN_REGISTRY.md`; it does not reintroduce the legacy `IntegrationPlugin` model.
- ClickUp remains the reference plugin for implementation patterns (attachments fallback, cascade behavior, webhook lifecycle).
- Extended integrations should be treated as plugin consumers on top of the same registry foundation.
