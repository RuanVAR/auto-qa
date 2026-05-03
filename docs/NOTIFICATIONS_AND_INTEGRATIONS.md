# Notifications, Integrations & Reporting

## Overview

The platform supports a plugin-based integration system. Each project configures its own integrations and notification rules. When a test fails, a feature run completes, or a report is generated, the platform fires the configured integrations — sending emails, posting to Slack/Teams, creating Jira tickets, or calling a custom webhook.

A test engineer can also manually trigger a report or ticket from the Feature Player after a run completes.

---

## Project Membership & Roles

Projects have their own membership system, separate from the platform-level role (`ADMIN/ENGINEER/VIEWER`). Each project member has a **project role** that determines what they receive.

| Project Role | Description |
|---|---|
| `OWNER` | Full control — configures integrations, manages members |
| `TECH_LEAD` | Receives failure reports, Jira tickets assigned to them |
| `DEVELOPER` | Receives failure notifications for tests they own |
| `QA_ENGINEER` | Runs tests, generates reports, triggers integrations |
| `MANAGER` | Receives scheduled summary reports only |

Project membership is configured in **Project Settings → Team**. A user can have a platform role of `ENGINEER` but be the `OWNER` of a specific project.

---

## Integration Types

| Type | What it does |
|------|-------------|
| `EMAIL` | Sends HTML test report to configured recipients |
| `SLACK` | Posts result summary to a Slack channel via incoming webhook |
| `TEAMS` | Posts result summary to a Microsoft Teams channel |
| `JIRA` | Creates a Jira issue on test failure |
| `WEBHOOK` | HTTP POST to any URL — full failure report as JSON payload |

Each project can have **multiple integrations** of the same or different types. E.g. two Slack integrations — one for `#qa-alerts` and one for `#dev-team`.

---

## Notification Triggers

| Trigger | When it fires |
|---------|-------------|
| `FEATURE_RUN_FAILED` | Any test case in a feature run fails |
| `FEATURE_RUN_COMPLETE` | Feature run finishes (pass or fail) |
| `TEST_CASE_FAILED` | A single individual test case fails |
| `REPORT_GENERATED` | Test engineer clicks "Send Report" manually |
| `SCHEDULED_REPORT` | Daily/weekly scheduled report (configured per project) |

Triggers are configured per-integration. Example: Slack fires on `FEATURE_RUN_FAILED`, Email fires on `SCHEDULED_REPORT` weekly.

---

## Integration: Email

### What gets sent

An HTML email report showing:

```
Subject: [QA Platform] Login Flow — 3/5 passed ❌  |  My App · Staging

┌─────────────────────────────────────────────────────┐
│  QA Report · Login Flow                             │
│  My App · Staging · 14 April 2026 · 09:32          │
├─────────────────────────────────────────────────────┤
│  ✅ 3 passed   ❌ 2 failed   🕐 14.2s total         │
├─────────────────────────────────────────────────────┤
│  ✅ Login with valid credentials            1.8s    │
│  ✅ Login with invalid password             0.9s    │
│  ❌ Password reset flow                     3.1s    │
│     Step failed: Assert success message            │
│     Expected: "Reset link sent"                    │
│     Got: Element not found (.toast-success)        │
│     [View Screenshot]                              │
│  ❌ OAuth Google login                      8.4s    │
│     Step failed: Navigate                          │
│     Error: net::ERR_CONNECTION_REFUSED             │
│  ✅ Session expiry redirect                 0.9s    │
├─────────────────────────────────────────────────────┤
│  AI Summary                                         │
│  "2 failures detected. Password reset toast        │
│   selector appears to have changed. OAuth fails    │
│   suggest Google OAuth service is unreachable      │
│   in this environment."                            │
├─────────────────────────────────────────────────────┤
│           [ View Full Report in Platform ]          │
└─────────────────────────────────────────────────────┘
```

### Configuration

```json
{
  "type": "EMAIL",
  "name": "QA Team Report",
  "config": {
    "to": ["manager@company.com", "techlead@company.com"],
    "cc": [],
    "includeScreenshots": true,
    "includeAiSummary": true
  }
}
```

Recipients can also be auto-resolved from project roles. E.g. `notifyRoles: ["MANAGER", "TECH_LEAD"]` sends to everyone in those roles on the project.

### SMTP configuration (platform admin)

Configured once in the Admin Panel under **Platform Settings → Email**:
```
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
```

---

## Integration: Slack

Posts a formatted message to a Slack channel using an **incoming webhook URL**.

```
[QA Platform] ❌ Login Flow failed — My App · Staging
──────────────────────────────────────────────
✅ 3 passed · ❌ 2 failed · 🕐 14.2s
──────────────────────────────────────────────
❌ Password reset flow
   Assert success message — Element not found (.toast-success)
❌ OAuth Google login
   Navigate — net::ERR_CONNECTION_REFUSED
──────────────────────────────────────────────
View full report → https://qa.internal/runs/...
```

### Configuration

```json
{
  "type": "SLACK",
  "name": "Dev Team Alerts",
  "config": {
    "webhookUrl": "https://hooks.slack.com/services/...",
    "channel": "#qa-alerts",
    "mentionOnFail": ["@dev-lead", "@qa-team"]
  }
}
```

---

## Integration: Microsoft Teams

Posts an Adaptive Card to a Teams channel via incoming webhook.

### Configuration

```json
{
  "type": "TEAMS",
  "name": "QA Channel",
  "config": {
    "webhookUrl": "https://company.webhook.office.com/webhookb2/..."
  }
}
```

---

## Integration: Jira

Creates a Jira issue automatically when a test fails.

### What gets created

```
Summary:   [QA FAIL] Password reset flow — Login Flow · My App
Type:      Bug
Priority:  High (if all steps failed) / Medium (partial failure)
Labels:    qa-automated, login-flow, my-app
Assignee:  Tech Lead (resolved from project membership)
Description:
  Automated test failure detected.

  Feature: Login Flow
  Environment: Staging
  Failed step: Assert success message
  Error: Element not found (.toast-success)
  Screenshot: [attached]
  AI Analysis: "Password reset toast selector appears to have changed..."

  View full run: https://qa.internal/runs/...
```

### Configuration

```json
{
  "type": "JIRA",
  "name": "Dev Jira Board",
  "config": {
    "baseUrl": "https://company.atlassian.net",
    "apiToken": "...",
    "email": "qa-bot@company.com",
    "projectKey": "DEV",
    "issueType": "Bug",
    "defaultAssignee": "accountId:...",
    "attachScreenshots": true,
    "labels": ["qa-automated"]
  }
}
```

---

## Integration: Custom Webhook

The most flexible integration. Configure any HTTP endpoint — the platform sends a structured JSON payload with the complete test failure report including screenshots.

Use this to integrate with **any system** not natively supported: PagerDuty, Linear, Asana, GitHub Issues, custom internal tools, n8n/Zapier automations, etc.

### Authentication options

| Method | How it works |
|--------|-------------|
| `bearer` | `Authorization: Bearer <token>` header |
| `api_key` | Custom header name + value (e.g. `X-API-Key: <key>`) |
| `basic` | `Authorization: Basic base64(user:pass)` |
| `hmac` | HMAC-SHA256 signature of body in `X-Signature` header — lets receiver verify the request came from the platform |
| `none` | No authentication (for internal services) |

### Configuration

```json
{
  "type": "WEBHOOK",
  "name": "Internal Alerting Service",
  "config": {
    "url": "https://internal.company.com/hooks/qa-failures",
    "method": "POST",
    "auth": {
      "type": "bearer",
      "token": "my-secret-token"
    },
    "headers": {
      "X-Source": "qa-platform"
    },
    "includeScreenshotsAsBase64": false,
    "includeScreenshotUrls": true,
    "timeout": 10000,
    "retries": 2
  }
}
```

### Payload — test case failure

When trigger is `TEST_CASE_FAILED` or `FEATURE_RUN_FAILED`:

```json
{
  "event": "feature_run_failed",
  "timestamp": "2026-04-14T09:32:14.000Z",
  "platformUrl": "https://qa.internal/runs/abc123",
  "project": {
    "id": "proj-uuid",
    "name": "My App",
    "slug": "my-app"
  },
  "module": {
    "id": "mod-uuid",
    "name": "Authentication"
  },
  "feature": {
    "id": "feat-uuid",
    "name": "Login Flow"
  },
  "featureRun": {
    "id": "fr-uuid",
    "environment": "Staging",
    "status": "FAILED",
    "totalTests": 5,
    "passed": 3,
    "failed": 2,
    "durationMs": 14200,
    "startedAt": "2026-04-14T09:31:59.000Z",
    "completedAt": "2026-04-14T09:32:13.000Z"
  },
  "failedTests": [
    {
      "id": "run-uuid-1",
      "name": "Password reset flow",
      "type": "UI",
      "status": "FAILED",
      "durationMs": 3100,
      "failedStep": {
        "index": 3,
        "name": "Assert success message",
        "type": "ASSERT_TEXT",
        "input": { "selector": ".toast-success", "text": "Reset link sent" },
        "errorMessage": "Element not found: .toast-success",
        "durationMs": 5002
      },
      "allSteps": [
        { "index": 0, "name": "Navigate", "status": "PASSED", "durationMs": 312 },
        { "index": 1, "name": "Fill email", "status": "PASSED", "durationMs": 204 },
        { "index": 2, "name": "Click submit", "status": "PASSED", "durationMs": 891 },
        { "index": 3, "name": "Assert success message", "status": "FAILED", "durationMs": 5002 }
      ],
      "screenshots": [
        {
          "stepIndex": 3,
          "filename": "step-3-failure.png",
          "url": "https://qa.internal/artifacts/uuid/download",
          "base64": null
        }
      ],
      "aiSummary": "Password reset toast selector appears to have changed. The element .toast-success was not found after form submission. Check if the toast class was renamed in a recent UI update."
    }
  ],
  "passedTests": [
    { "id": "run-uuid-2", "name": "Login with valid credentials", "status": "PASSED", "durationMs": 1800 },
    { "id": "run-uuid-3", "name": "Login with invalid password", "status": "PASSED", "durationMs": 900 },
    { "id": "run-uuid-5", "name": "Session expiry redirect", "status": "PASSED", "durationMs": 900 }
  ],
  "featureAiSummary": "2 of 5 tests failed. Password reset selector issue likely caused by a UI change. OAuth failure suggests the Google OAuth service is unreachable in the Staging environment."
}
```

### Payload — scheduled report

When trigger is `SCHEDULED_REPORT`:

```json
{
  "event": "scheduled_report",
  "timestamp": "2026-04-14T08:00:00.000Z",
  "reportPeriod": "daily",
  "project": { "id": "...", "name": "My App", "slug": "my-app" },
  "summary": {
    "totalRuns": 42,
    "passed": 38,
    "failed": 4,
    "passRate": 90.5,
    "avgDurationMs": 11200
  },
  "features": [
    {
      "name": "Login Flow",
      "passed": 10,
      "failed": 0,
      "passRate": 100
    },
    {
      "name": "Checkout Flow",
      "passed": 8,
      "failed": 4,
      "passRate": 66.7,
      "recentFailures": ["Payment validation", "Order confirmation"]
    }
  ],
  "platformUrl": "https://qa.internal/projects/my-app"
}
```

---

## Manual Triggers (Feature Player)

After a feature run completes, the test engineer sees action buttons in the player panel:

```
┌─────────────────────────────────────────────────────┐
│  Run complete · 3 passed · 2 failed                 │
│                                                     │
│  [ 📧 Send Report ]  [ 🎫 Create Ticket ]           │
│  [ 🔗 Trigger Webhook ]                             │
└─────────────────────────────────────────────────────┘
```

- **Send Report** — opens a modal to select which email/Slack/Teams integration to send to
- **Create Ticket** — opens a modal to select which Jira integration, pre-fills issue fields
- **Trigger Webhook** — opens a modal to select which webhook integration to fire

These buttons only appear if the project has integrations configured. If no integrations are configured, a "Set up integrations" link shows instead.

---

## Data Models

### `ProjectMember`

```prisma
model ProjectMember {
  id          String      @id @default(uuid())
  projectId   String
  project     Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId      String
  user        User        @relation(fields: [userId], references: [id])
  projectRole ProjectRole
  createdAt   DateTime    @default(now())
  @@unique([projectId, userId])
  @@map("project_members")
}

enum ProjectRole { OWNER TECH_LEAD DEVELOPER QA_ENGINEER MANAGER }
```

### `ProjectIntegration`

```prisma
model ProjectIntegration {
  id        String          @id @default(uuid())
  projectId String
  project   Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  type      IntegrationType
  name      String
  config    Json            // encrypted at rest
  isActive  Boolean         @default(true)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  rules     NotificationRule[]
  @@map("project_integrations")
}

enum IntegrationType { EMAIL SLACK TEAMS JIRA WEBHOOK }
```

### `NotificationRule`

```prisma
model NotificationRule {
  id            String                @id @default(uuid())
  projectId     String
  integrationId String
  integration   ProjectIntegration    @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  trigger       NotificationTrigger
  notifyRoles   ProjectRole[]         // project members with these roles get notified
  notifyUserIds String[]              // specific user IDs to always notify
  isActive      Boolean               @default(true)
  createdAt     DateTime              @default(now())
  @@map("notification_rules")
}

enum NotificationTrigger {
  FEATURE_RUN_COMPLETE
  FEATURE_RUN_FAILED
  TEST_CASE_FAILED
  REPORT_GENERATED
  SCHEDULED_REPORT
}
```

---

## Plugin Architecture

All integrations implement a common interface. Adding a new integration type requires implementing one class.

```typescript
interface IntegrationPlugin {
  readonly type: IntegrationType

  /** Validate config shape before saving */
  validateConfig(config: unknown): { valid: boolean; errors: string[] }

  /** Send a notification (report, alert etc.) */
  notify(payload: NotificationPayload, config: unknown): Promise<void>

  /** Optional: create a ticket (Jira, GitHub Issues, Linear etc.) */
  createTicket?(payload: TicketPayload, config: unknown): Promise<{ ticketUrl: string; ticketId: string }>
}
```

The `IntegrationService` holds a registry of plugins:

```typescript
const plugins: Record<IntegrationType, IntegrationPlugin> = {
  EMAIL:   new EmailPlugin(),
  SLACK:   new SlackPlugin(),
  TEAMS:   new TeamsPlugin(),
  JIRA:    new JiraPlugin(),
  WEBHOOK: new WebhookPlugin(),
}
```

Adding a new integration in the future = implement `IntegrationPlugin`, register it, add the enum value. No changes to the core notification flow.

---

## API Endpoints

```
# Project members
GET    /projects/:id/members
POST   /projects/:id/members          { userId, projectRole }
PATCH  /projects/:id/members/:userId  { projectRole }
DELETE /projects/:id/members/:userId

# Integrations
GET    /projects/:id/integrations
POST   /projects/:id/integrations     { type, name, config }
PUT    /projects/:id/integrations/:integrationId
DELETE /projects/:id/integrations/:integrationId
POST   /projects/:id/integrations/:integrationId/test   — send test ping

# Notification rules
GET    /projects/:id/integrations/:integrationId/rules
POST   /projects/:id/integrations/:integrationId/rules
PUT    /projects/:id/integrations/:integrationId/rules/:ruleId
DELETE /projects/:id/integrations/:integrationId/rules/:ruleId

# Manual triggers
POST   /feature-runs/:id/send-report   { integrationIds[] }
POST   /feature-runs/:id/create-ticket { integrationId }
POST   /feature-runs/:id/trigger-webhook { integrationId }
```

---

## UI: Project Settings → Integrations

```
Project Settings
  ├── General          (name, slug, description)
  ├── Team             (add/remove members, assign project roles)
  ├── Environments     (Local Dev, Staging, Production configs)
  ├── Integrations     ← new
  │     ├── + Add Integration
  │     ├── Email — QA Team Report     [Rules] [Edit] [Test] [Delete]
  │     ├── Slack — Dev Team Alerts    [Rules] [Edit] [Test] [Delete]
  │     └── Webhook — Internal Alerts  [Rules] [Edit] [Test] [Delete]
  └── Repo Connection  (GitHub/GitLab for AI test generation)
```

Each integration row has a **Test** button that fires a sample payload to confirm the connection works before going live.

---

## Security

- Integration `config` stored encrypted at rest (AES-256)
- Webhook `config.auth.token` / `config.auth.password` never returned in GET responses — replaced with `"••••••"` after save
- HMAC webhook signing uses a platform-generated secret, not user-provided — prevents spoofing
- Jira `apiToken` stored encrypted, used only server-side, never exposed to frontend
- Screenshot URLs in webhook payloads are signed, time-limited URLs (expiry: 24h)
