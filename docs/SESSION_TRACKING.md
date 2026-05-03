# QA Session Tracking

> **Status:** Planned (Phase 11)
> **Depends on:** Phase 6 (Multi-Tenancy / Auth), Phase 5.3 (Integrations), Phase 10.2 (ClickUp / Jira plugins)

---

## Overview

Session Tracking lets QA engineers start a timed work session from anywhere in the platform. The platform silently records everything that happens — tests run, steps marked, bugs filed, features reviewed — and when the session ends it produces an AI-generated summary with a full activity breakdown.

Engineers can then log that time directly to a ClickUp task, Jira issue, or any configured time-tracking integration without leaving the platform.

This replaces manual time logging in external tools and gives teams a permanent record of exactly what was done in each QA session.

---

## User Flow

```
┌──────────────────────────────────────────────────────┐
│  1. Start session                                    │
│                                                      │
│  QA engineer clicks the session timer widget in the  │
│  top nav → enters optional session goal → clicks     │
│  "Start Session"                                     │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│  2. Work normally                                    │
│                                                      │
│  Platform records in the background:                 │
│  • Every feature run triggered                       │
│  • Every test result (pass/fail)                     │
│  • Every manual step marked                          │
│  • Every bug ticket created                          │
│  • Every AI generation used                          │
│  • Every feature/test page visited                   │
│  • Running wall-clock time                           │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│  3. Stop session                                     │
│                                                      │
│  Engineer clicks "Stop" on timer widget OR           │
│  logs out (auto-stops session)                       │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│  4. Session Review modal                             │
│                                                      │
│  AI generates a 3-5 sentence summary                 │
│  Full activity timeline shown                        │
│  Pass/fail breakdown per feature                     │
│  Duration confirmed                                  │
│                                                      │
│  [ Log Time to ClickUp Task ]                        │
│  [ Log Time to Jira Issue   ]                        │
│  [ Save Session Only        ]                        │
│  [ Discard Session          ]                        │
└──────────────────────────────────────────────────────┘
```

---

## Session Timer Widget (Top Nav)

A persistent widget in the top navigation bar, always visible when no session is active and always showing elapsed time when one is running.

### Idle state (no active session)
```
[  ▶ Start Session  ]
```

### Active state
```
[  ⏺  01:24:37  ■ Stop  ]    ← pulsing red dot, live clock
```

Clicking the active timer opens a **Session HUD** — a small dropdown showing:
- Elapsed time (large)
- Session goal (if set)
- Live counts: X tests run, X passed, X failed, X bugs filed
- "Stop & Review" button
- "Pause" button (pauses clock, session continues recording events)

### Pause behaviour
When paused, clock stops but the dot turns yellow and events still record. Resume button shown. Useful for lunch breaks, meetings, etc.

---

## What Gets Recorded

Every event during the session is stamped with a timestamp and stored in `WorkSessionEvent`:

| Event Type | Trigger | Data Stored |
|---|---|---|
| `FEATURE_RUN_STARTED` | Any feature run triggers | featureId, featureName, environmentId |
| `FEATURE_RUN_COMPLETED` | Run finishes | featureRunId, passed, failed, durationMs |
| `TEST_PASSED` | Individual test result passes | testId, testName, featureName, featureRunId |
| `TEST_FAILED` | Individual test result fails | testId, testName, featureName, featureRunId, errorMessage (first 200 chars) |
| `MANUAL_STEP_MARKED` | Step marked pass/fail in manual runner | stepId, result, featureName |
| `BUG_FILED` | New ticket created from a test failure and sent to ClickUp / Jira / Linear / GitHub / GitLab | ticketId, ticketUrl, integrationName, provider, testResultId, testName, featureName |
| `TICKET_SYNCED` | Existing ticket linked to a test failure (no new ticket created — "link to existing") | ticketId, ticketUrl, integrationName, provider, testResultId, testName, featureName |
| `AI_GENERATION_USED` | Generate Tests AI called | featureId, featureName, testCount, promptSummary |
| `AGENTIC_SESSION_RUN` | Agentic session completed | agenticSessionId, featureName, summary |
| `FEATURE_VIEWED` | Feature page navigated to | featureId, featureName |
| `TEST_EDITED` | Test definition saved | testId, testName, featureName |
| `VERSION_PUBLISHED` | Feature version published | featureId, featureName, versionName |

Events are **lightweight** — no full payloads, just identifiers and key metrics. The full data lives in the existing run/test tables and is joined at review time.

### Ticket Events in Detail

When a QA engineer creates or links a ticket from a test failure result panel, the platform records:

```typescript
// BUG_FILED — engineer clicked "Create Ticket" on a failed test result
await sessionService.recordEvent(userId, {
  eventType: WorkSessionEventType.BUG_FILED,
  entityId: ticketId,           // ClickUp task ID / Jira issue key
  entityName: ticketTitle,      // e.g. "OAuth callback timeout on staging"
  meta: {
    ticketUrl: 'https://app.clickup.com/t/abc123',
    integrationName: 'ClickUp — Main Workspace',
    provider: 'clickup',
    testResultId: 'uuid',
    testName: 'OAuth callback does not time out',
    featureName: 'OAuth Login',
  }
});

// TICKET_SYNCED — engineer clicked "Link to Existing Ticket" on a failed test result
await sessionService.recordEvent(userId, {
  eventType: WorkSessionEventType.TICKET_SYNCED,
  entityId: ticketId,
  entityName: ticketTitle,
  meta: {
    ticketUrl: 'https://app.clickup.com/t/xyz456',
    integrationName: 'ClickUp — Main Workspace',
    provider: 'clickup',
    testResultId: 'uuid',
    testName: 'OAuth callback does not time out',
    featureName: 'OAuth Login',
  }
});
```

Both events appear in the session timeline with a clickable ticket URL deep-link so the engineer can jump straight to the ticket from the session detail page.

---

## Session Review Modal

Shown immediately when the session is stopped (or on next login if session was ended by logout).

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Session Review                              Thu 17 Apr, 2026  │
│  ─────────────────────────────────────────────────────────────  │
│  ⏱  2h 14m (9:02am → 11:16am)                                  │
│  Goal: "Complete UAT pass on Auth module"                       │
│                                                                 │
│  AI Summary                                                     │
│  ──────────                                                     │
│  "2h 14m QA session on the Authentication module. Ran 14       │
│   tests across 3 features: Login Flow (4/4 ✓), OAuth Login     │
│   (3/4 – 1 failure), Password Reset (6/6 ✓). Filed 1 bug on    │
│   the OAuth callback timeout. Generated 2 AI test drafts for   │
│   the new MFA flow. Overall: 13/14 tests passing (93%)."       │
│                                                                 │
│  Activity Breakdown                                             │
│  ──────────────────                                             │
│  📁 Auth Login Flow         4 tests  ✓ 4/4  passed             │
│  📁 OAuth Login             4 tests  ✗ 3/4  (1 bug filed)      │
│  📁 Password Reset Flow     6 tests  ✓ 6/6  passed             │
│                                                                 │
│  1 bug filed · 2 AI generations · 14 manual steps marked       │
│                                                                 │
│  Log Time                                                       │
│  ────────                                                       │
│  [●] ClickUp   Task: _______________________________ [Select]  │
│  [ ] Jira      Issue: (not configured)                          │
│                                                                 │
│  Notes for time log (pre-filled by AI, editable):              │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ UAT pass on Auth module. Tested 14 cases across Login,   │  │
│  │ OAuth, and Password Reset flows. Found 1 OAuth callback  │  │
│  │ timeout bug (ticket #1234). 93% pass rate.               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [ Log Time & Save ]   [ Save Without Logging ]   [ Discard ]  │
└────────────────────────────────────────────────────────────────┘
```

### AI Summary Generation

The AI receives a structured prompt with the session's event log:

```
Summarise this QA engineer's work session in 3-5 sentences.
Include: duration, features tested, pass/fail counts, any bugs filed,
any AI features used. Be specific and factual. Write in past tense.

Session data:
- Duration: 2h 14m
- Features tested: [Auth Login Flow (4/4), OAuth Login (3/4), Password Reset (6/6)]
- Bugs filed: [Jira #1234 - OAuth callback timeout]
- AI generations: 2
- Manual steps marked: 14
```

---

## Time Logging Integrations

### ClickUp Time Logging

Uses the ClickUp plugin from Phase 10.2 (already planned). In addition to `createTicket()`, adds a `logTime()` method:

```typescript
// POST /api/v2/task/{taskId}/time
{
  start: sessionStartTimestamp,
  duration: sessionDurationMs,
  description: aiGeneratedNotes,
  billable: false  // configurable
}
```

**Task selection in the modal:**
- User types to search ClickUp tasks (searches by name via ClickUp API)
- Recently used tasks shown first
- Can select a task from any list in the connected workspace
- Platform remembers last-used task per project (pre-fills next time)

### Jira Time Logging

Uses the Jira plugin from Phase 5.3. Adds `logTime()` method using Jira's worklog API:

```typescript
// POST /rest/api/3/issue/{issueId}/worklog
{
  timeSpentSeconds: sessionDurationSeconds,
  started: sessionStartIso,
  comment: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: aiGeneratedNotes }] }]
  }
}
```

### Extensible for Future

The `logTime()` method can be added to any future integration plugin — Harvest, Toggl, Linear, etc.

---

## Data Model

```prisma
model WorkSession {
  id            String   @id @default(uuid())
  orgId         String
  userId        String
  projectId     String?  // optional — sessions can span projects
  goal          String?  // optional goal set at start
  status        WorkSessionStatus @default(ACTIVE)
  startedAt     DateTime @default(now())
  stoppedAt     DateTime?
  pausedMs      Int      @default(0)  // total time paused (ms)
  durationMs    Int?     // computed: (stoppedAt - startedAt) - pausedMs
  aiSummary     String?  // generated on stop
  notes         String?  // user-edited notes for time logging

  // Computed metrics (populated on stop)
  totalRunsTriggered  Int @default(0)
  totalTestsPassed    Int @default(0)
  totalTestsFailed    Int @default(0)
  totalBugsFiled      Int @default(0)
  featuresWorkedOn    String[] // feature names

  // Time log record
  timeLoggedAt    DateTime?
  timeLogProvider String?   // 'clickup' | 'jira'
  timeLogTicketId String?   // external ticket ID
  timeLogTicketUrl String?  // external ticket URL

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?

  user         User         @relation(fields: [userId], references: [id])
  organisation Organisation @relation(fields: [orgId], references: [id])
  events       WorkSessionEvent[]

  @@index([userId])
  @@index([orgId])
}

enum WorkSessionStatus {
  ACTIVE    // timer running
  PAUSED    // timer paused
  STOPPED   // ended, pending review
  REVIEWED  // review completed, session saved
  DISCARDED // user discarded the session
}

model WorkSessionEvent {
  id          String   @id @default(uuid())
  sessionId   String
  eventType   WorkSessionEventType
  entityId    String?  // featureId, testId, runId, etc.
  entityName  String?  // human-readable name for display
  meta        Json?    // type-specific data (counts, URLs, etc.)
  createdAt   DateTime @default(now())

  session     WorkSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId])
  @@index([sessionId, eventType])
}

enum WorkSessionEventType {
  FEATURE_RUN_STARTED
  FEATURE_RUN_COMPLETED
  TEST_PASSED
  TEST_FAILED
  MANUAL_STEP_MARKED
  BUG_FILED          // new ticket created and sent to external integration
  TICKET_SYNCED      // existing ticket linked to a test failure
  AI_GENERATION_USED
  AGENTIC_SESSION_RUN
  FEATURE_VIEWED
  TEST_EDITED
  VERSION_PUBLISHED
  SESSION_PAUSED
  SESSION_RESUMED
}
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions/start` | Start a new work session |
| `POST` | `/sessions/current/pause` | Pause active session |
| `POST` | `/sessions/current/resume` | Resume paused session |
| `POST` | `/sessions/current/stop` | Stop active session, generate AI summary |
| `GET` | `/sessions/current` | Get active session state (for timer widget) |
| `GET` | `/sessions/:id` | Session detail with all events |
| `PATCH` | `/sessions/:id` | Save notes, update status to REVIEWED or DISCARDED |
| `POST` | `/sessions/:id/log-time` | Log time to external integration |
| `GET` | `/sessions` | Session history for current user |
| `GET` | `/organisations/:id/sessions` | All sessions in org (ORG_ADMIN view) |

---

## Event Recording

Events are recorded passively — no user action needed. The platform hooks into existing service calls:

```typescript
// In FeatureRunsService.complete() — already called when run finishes
await this.sessionService.recordEvent(userId, {
  eventType: WorkSessionEventType.FEATURE_RUN_COMPLETED,
  entityId: featureRun.featureId,
  entityName: featureRun.feature.name,
  meta: { passed: featureRun.passedCount, failed: featureRun.failedCount, durationMs }
});

// In IntegrationsService.createTicket() — called when filing a new bug from a test result
await this.sessionService.recordEvent(userId, {
  eventType: WorkSessionEventType.BUG_FILED,
  entityId: ticketId,
  entityName: ticketTitle,
  meta: {
    ticketUrl,
    integrationName,
    provider,           // 'clickup' | 'jira' | 'linear' | 'github' | 'gitlab'
    testResultId,       // links back to the specific failed test result
    testName,
    featureName,
  }
});

// In IntegrationsService.linkTicket() — called when linking to an existing ticket
await this.sessionService.recordEvent(userId, {
  eventType: WorkSessionEventType.TICKET_SYNCED,
  entityId: ticketId,
  entityName: ticketTitle,
  meta: { ticketUrl, integrationName, provider, testResultId, testName, featureName }
});
```

`recordEvent()` is a no-op if the user has no active session — zero overhead when session tracking is off.

---

## Session History

Users can view past sessions in their profile under **Profile → Session History**.

Each session shows:
- Date, duration, goal
- AI summary (one paragraph)
- Feature breakdown table
- Time log record (if logged)

**ORG_ADMIN view** — org-level session log showing all members' sessions with aggregate stats:
- Total QA hours logged per member (weekly/monthly)
- Pass rate trends per engineer
- Most tested features
- Most common bugs filed

---

## Auto-stop on Logout

When a user logs out while a session is active:
1. Session is stopped at logout time
2. On next login: "You have an unreviewed session from yesterday (2h 14m). Review now?"
3. Banner shown at top of page until reviewed or discarded

---

## Session End Report & Email Distribution

When a session is saved (status → REVIEWED), the platform generates a **Session Report** and emails it to the relevant people. This gives managers and stakeholders visibility into QA coverage without needing to log into the platform.

### Report Content

```
┌──────────────────────────────────────────────────────────────┐
│  QA Session Report                                           │
│  Sarah Chen  ·  Thu 17 Apr 2026  ·  2h 14m                  │
│  Project: My App  ·  Goal: UAT pass on Auth module           │
│──────────────────────────────────────────────────────────────│
│  Summary                                                     │
│  ────────                                                     │
│  "2h 14m session on the Auth module. Ran 14 tests across     │
│   3 features: Login Flow (4/4 ✓), OAuth Login (3/4 – 1       │
│   failure), Password Reset (6/6 ✓). Filed 1 bug on the       │
│   OAuth callback timeout. 93% passing."                      │
│──────────────────────────────────────────────────────────────│
│  Coverage Breakdown                                          │
│  ──────────────────                                          │
│  Feature              Tests   Passed  Failed  Status         │
│  ─────────────────────────────────────────────────────────   │
│  Auth Login Flow        4       4       0     ✓ PASSED       │
│  OAuth Login            4       3       1     ✗ FAILED       │
│  Password Reset Flow    6       6       0     ✓ PASSED       │
│  ─────────────────────────────────────────────────────────   │
│  Total                 14      13       1     93% pass rate  │
│──────────────────────────────────────────────────────────────│
│  Activity Timeline                                           │
│  ─────────────────                                           │
│  09:02  Session started                                      │
│  09:08  Auth Login Flow — all 4 tests passed (6m)            │
│  09:31  OAuth Login — 3/4 passed, 1 failure (23m)            │
│  09:35  Bug filed: Jira #1234 — OAuth callback timeout       │
│  09:38  AI generated 2 test drafts for MFA flow              │
│  11:09  Password Reset Flow — all 6 tests passed (1h 31m)    │
│  11:16  Session ended                                        │
│──────────────────────────────────────────────────────────────│
│  Bugs Filed: 1  ·  AI Generations: 2  ·  Manual Steps: 14   │
│                                                              │
│  Time logged to: ClickUp #PROJ-421 "Auth UAT Sprint 3"       │
│──────────────────────────────────────────────────────────────│
│  [ View Full Session in QA Platform → ]                      │
└──────────────────────────────────────────────────────────────┘
```

### Who Receives the Report

Recipients are resolved in this order:

1. **Session owner** — always receives their own report (can opt out in profile settings)
2. **Project MANAGERs** — all users with MANAGER role on any project touched in the session
3. **Phase assignees with MANAGER role** — if the session worked on features in a specific phase, the phase MANAGER receives it
4. **Configured extra recipients** — a per-project or per-user list of email addresses (including non-platform users)

Recipient resolution is smart: if a session touched features across 3 projects, the managers from all 3 projects get the report.

### Report Format

- **In-app** — HTML rendered in the session detail page
- **Email** — HTML email with the same layout (reuses `ReportService` from Phase 5.7, same Puppeteer PDF pipeline)
- **PDF attachment** — attached to the email for archiving
- **Export button** — "Download PDF" on session detail page

### Trigger

Report is generated and sent automatically when:
- User clicks "Log Time & Save" in the review modal
- User clicks "Save Without Logging" in the review modal

It is **not** sent if:
- User discards the session
- Session is auto-stopped on logout and not yet reviewed (sent when user reviews it later)

### Opt-out

- Engineers can disable "Email my own report to me" in Profile → Notifications
- Project MANAGERs can disable "Receive session reports for my projects" in their notification preferences
- Neither opt-out affects other recipients

---

## Editable Session Details

All session data is fully editable after the fact. The session detail page (accessible from session history) allows editing:

### Editable Fields

| Field | Editable? | Notes |
|-------|-----------|-------|
| Goal | Yes | Can be set/changed even after session |
| AI Summary | Yes | Free-text override — AI draft shown initially |
| Time log notes | Yes | Pre-filled by AI, always editable before and after logging |
| Start time | Yes | Manual correction (e.g. forgot to start timer) |
| End time | Yes | Manual correction |
| Session duration | Auto-computed | Recalculated from start/end minus pauses when times are edited |
| Event notes | Yes | Each event in the timeline can have a user annotation added |
| Extra recipients | Yes | Add/remove email recipients for report re-send |

### What Cannot Be Edited

| Field | Why |
|-------|-----|
| Event list | Events are immutable — they reflect what actually happened |
| Timestamps on events | Chronological record integrity |
| Time log record | Once logged to ClickUp/Jira it's external — can log again but not edit the external record |

### Re-send Report

After editing, the session detail page has a **"Re-send Report"** button — regenerates the report with the latest session data and sends it to the current recipient list (which may have been updated).

### Edit History

Edits to the AI summary and goal are tracked with timestamps: "Last edited by Sarah Chen on 17 Apr at 2:34pm". Shown as a subtle note below the field. Not a full audit trail — just last-editor metadata.

---

## Session Detail Page

Accessible at `/sessions/:id` — the permanent home for every saved session.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Session History                             [ Edit ] [ PDF ] │
│                                                                  │
│  Auth Module UAT Pass                          Thu 17 Apr 2026   │
│  Sarah Chen  ·  2h 14m  ·  93% pass rate  ·  1 bug filed        │
│  Time logged: ClickUp #PROJ-421                                  │
│                                                                  │
│  Summary (editable)                                              │
│  ──────────────────                                              │
│  "2h 14m session on the Auth module. Ran 14 tests..."            │
│  [ Edit Summary ]                                                │
│                                                                  │
│  Coverage                                                        │
│  ────────                                                        │
│  Feature              Tests   Pass   Fail   Link                 │
│  Auth Login Flow        4       4      0    → Feature            │
│  OAuth Login            4       3      1    → Feature            │
│  Password Reset Flow    6       6      0    → Feature            │
│                                                                  │
│  Activity Timeline                                               │
│  ─────────────────                                               │
│  ▼ 09:02  Session started  [ + Add note ]                        │
│  ▼ 09:08  Auth Login Flow — 4/4 passed  [ + Add note ]           │
│  ▼ 09:31  OAuth Login — 3/4 (1 failure)  [ + Add note ]          │
│     └── Your note: "Reproduced consistently on staging env"      │
│  ▼ 09:35  Bug filed: Jira #1234  [ View ticket ]                 │
│  ▼ 11:16  Session ended  [ + Add note ]                          │
│                                                                  │
│  [ Re-send Report ]  [ Log Time ]  [ Download PDF ]              │
└─────────────────────────────────────────────────────────────────┘
```

### Deep Links

- Each feature in the coverage table links to the feature page
- Each bug in the timeline links to the external ticket
- "View Full Run" links from each run event to the run detail page
- The session detail page URL is shareable — managers can be sent a direct link

---

## Session History Page

`/profile/sessions` — user's complete session log.

```
┌─────────────────────────────────────────────────────────────────┐
│  My Sessions                     [ Date ▾ ] [ Project ▾ ] [🔍] │
├─────────────────────────────────────────────────────────────────┤
│  Thu 17 Apr  Auth Module UAT Pass  2h 14m  93%  1 bug  ClickUp  │
│  Wed 16 Apr  Checkout Flow Testing 1h 42m  88%  2 bugs  Jira    │
│  Tue 15 Apr  Smoke test regression  47m   100%  0 bugs  —       │
│  ...                                                             │
│  ─────────────────────────────────────────────────────────────  │
│  This month: 14h 32m QA logged  ·  12 sessions  ·  91% avg     │
└─────────────────────────────────────────────────────────────────┘
```

Each row:
- Click → opens session detail page
- Pass rate badge colour-coded (green/amber/red)
- Time log destination shown as chip (ClickUp / Jira / —)
- Editable indicator (pencil icon) if session has been manually edited

### Org Admin View

`/admin/sessions` — all members' sessions across the org.

Additional columns: Engineer name, project, features covered.

Filter by: engineer, project, date range, has bugs, time logged.

Stats section at top:
- Total QA hours logged this month (org total)
- Sessions per engineer (bar chart)
- Average pass rate per engineer
- Most tested features this month

---

## Comparison to Competitors

No major QA platform has this feature. The closest is Jira's built-in time tracking (manual log, no automation) or Toggl (separate app, no QA context).

Our advantage: the summary and activity log are **automatically generated from what actually happened** — no manual entry required. The QA engineer just does their work and gets a ready-to-submit time log at the end. Managers get automatic visibility without chasing engineers for updates.
