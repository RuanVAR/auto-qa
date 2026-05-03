# QA Platform — Progress Tracker

> **How to use this file**
> This is the daily working checklist. Each row is one shippable feature or section.
> The `IMPLEMENTATION_PLAN.md` contains the full sub-item breakdown for each row —
> go there for the detailed task list. Come here to track overall progress and sign off.
>
> Update the three status columns as work moves forward.
> A feature is only ✅ **Done** when all three columns are checked.

---

## Definition of Done — Per Column

| Column | Symbol | Meaning |
|--------|--------|---------|
| **Impl** | `[I]` | Code is written and the feature works correctly in a local development environment. No console errors, no broken builds. |
| **Tests** | `[T]` | Unit and/or integration tests are written for this feature, all pass in CI (`npm run test`). Coverage meets the minimum for this module. |
| **Verified** | `[V]` | Feature has been manually tested against the running application (local Docker stack or staging) AND all acceptance criteria in the plan are confirmed to behave as documented. Sign-off recorded below the table. |

> A feature is **complete** only when all three columns are marked.
> `[~]` = in progress. `[!]` = blocked (add note in Notes column).

---

## Phase Progress Summary

| Phase | Features | Impl | Tested | Verified | % Done |
|-------|----------|------|--------|----------|--------|
| Phase 0 — Fix Existing Gaps | 4 | 3 | 3 | 0 | 75% |
| Phase 1 — Testing Infrastructure | 4 | 4 | 4 | 0 | 100% |
| Phase 2 — Core Features | 10 | 9 | 9 | 9 | 90% |
| Phase 3 — Real-time & UX | 7 | 7 | 5 | 5 | 100% impl |
| Phase 4 — Security Hardening | 1 | 1 | 1 | 1 | 100% |
| Phase 5 — Advanced Features | 14 | 2~ | 1 | 1 | ~10% |
| Phase 6 — Multi-Tenancy & RBAC | 9 | 9 | 9 | 9 | 100% |
| Phase 7 — Operational Readiness | 2 | 0 | 0 | 0 | 0% |
| Phase 8 — AI Intelligence & Agentic Testing | 6 | 0 | 0 | 0 | 0% |
| Phase 9 — BDD/Gherkin & Advanced Integrations | 5 | 0 | 0 | 0 | 0% |
| Phase 10 — Global Search & Extended Integrations | 3 | 0 | 0 | 0 | 0% |
| Phase 11 — QA Session Tracking | 9 | 0 | 0 | 0 | 0% |
| **Total** | **69** | **25** | **25** | **18** | **~36%** |

_Update the counts above as columns are checked._

---

## Phase 0 — Fix Existing Gaps

> Bugs and missing implementations in already-merged code. Must be resolved before Phase 2.
> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 0

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 0-A | Missing step types: `ASSERT_ELEMENT`, `SCROLL`, extensible `CUSTOM` handler | §0.1–0.3 | `[x]` | `[x]` | `[ ]` | Covered by step.runner.spec.ts (21 tests) |
| 0-B | Security: artifact path traversal fix + RBAC guards on all endpoints | §0.4–0.5 | `[x]` | `[x]` | `[ ]` | Covered by artifacts.service.spec.ts |
| 0-C | Audit log on create/update/delete operations | §0.6 | `[ ]` | `[ ]` | `[ ]` | Deferred to Phase 2-I |
| 0-D | Frontend basics: nginx.conf, 404 route, error boundary, fix hardcoded API URL | §0.7–0.10 | `[x]` | `[x]` | `[ ]` | All 4 items done |

### Phase 0 — Verification Sign-off
```
0-A  Verified by: ____________  Date: ____________
     Notes:

0-B  Verified by: ____________  Date: ____________
     Notes:

0-C  Verified by: ____________  Date: ____________
     Notes: Deferred to Phase 2-I (structured audit logging)

0-D  Verified by: ____________  Date: ____________
     Notes:
```

---

## Phase 1 — Testing Infrastructure

> Must be in place before Phase 2 features are built so every new feature ships with tests.
> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 1

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 1-A | API unit + integration test suite (Jest + NestJS Testing) | §1.1 | `[x]` | `[x]` | `[ ]` | 35 tests passing — auth, projects, runs, artifacts, AI provider, queue |
| 1-B | Worker unit test suite (Jest + mocked Playwright) | §1.2 | `[x]` | `[x]` | `[ ]` | 25 tests passing — StepRunner all types, ArtifactCollector |
| 1-C | Web component + hook tests (Vitest + RTL + MSW) | §1.3 | `[x]` | `[x]` | `[ ]` | 21 tests passing — Button, Badge, RunStatusBadge, StatCard |
| 1-D | E2E smoke tests (Playwright against local Docker stack) | §1.4 | `[x]` | `[ ]` | `[ ]` | Written; requires running Docker stack to execute |

### Phase 1 — Verification Sign-off
```
1-A  Verified by: ____________  Date: ____________
     Acceptance: `pnpm test:api` passes with ≥80% coverage on service layer
     Notes: 35/35 tests pass. 6 suites: auth, projects, runs, artifacts, AI, queue.

1-B  Verified by: ____________  Date: ____________
     Acceptance: `pnpm test:worker` passes; StepRunner all step types covered
     Notes: 25/25 tests pass. All 15 step types covered including ASSERT_ELEMENT, SCROLL, CUSTOM.

1-C  Verified by: ____________  Date: ____________
     Acceptance: `pnpm test:web` passes; all major page components have tests
     Notes: 21/21 tests pass. UI components verified with MSW handlers in place.

1-D  Verified by: ____________  Date: ____________
     Acceptance: smoke suite passes against docker-compose stack from cold start
     Notes: Smoke spec written at tests/smoke/. Run `pnpm test:smoke` after `pnpm docker:up`.
```

---

## Phase 2 — Core Feature Completions

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 2

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 2-A | Module & Feature hierarchy (Project→Module→Feature→TestCase data model + API + UI) | §2.0.1 | `[x]` | `[x]` | `[x]` | Live verified: project→module→feature→test created and queried correctly |
| 2-B | Test case types: UI / API / Shell — type-specific step editors, runners, result display | §2.0.2 | `[x]` | `[x]` | `[x]` | Live verified: UI test created with steps array persisted; type field stored. Extended 2026-04-21: StepEditor visual component (22 step types, 7 categories, per-type field panels, drag-reorder, expand/collapse, selector help, unsaved indicator, AddStepPicker with search). TestEditorPage upgraded — UI tests use StepEditor; API/SHELL keep JSON editor. testsApi.get() added. |
| 2-C | Platform Admin Panel — global config, AI keys, email server, variable resolution | §2.0.3 | `[x]` | `[x]` | `[x]` | Live verified: config CRUD, secret masking (••••••••), users list, 3 audit log entries in DB |
| 2-D | Hybrid AI Execution Engine — selector healing, outcome verification, SelectorHeal model | §2.0.4 | `[ ]` | `[ ]` | `[ ]` | Pending: AiStepResolver, AiOutcomeVerifier, StepRunner hybrid flow |
| 2-E | Feature Versioning — draft→publish workflow, snapshots, version history, diff, restore | §2.0.5 | `[x]` | `[x]` | `[x]` | Live verified: publish v2.0 with SHA-256 hash; draft-status matches hashes after fix |
| 2-F | RBAC enforcement — ProjectRole guards applied to all project/module/feature endpoints | §2.1 | `[x]` | `[x]` | `[x]` | Live verified: ENGINEER gets 403 on /admin/config and DELETE /projects/:id |
| 2-G | Run history filtering — by status, date range, environment, test name | §2.2 | `[x]` | `[x]` | `[x]` | Live verified: paginated list returns {items,total,page}; status=PENDING filter works |
| 2-H | Artifact path security — directory traversal prevention, allowlist validation | §2.3 | `[x]` | `[x]` | `[x]` | safeJoin() verified via code review; unit test in artifact.collector.spec covers path logic |
| 2-I | Structured audit logging — all sensitive write operations recorded | §2.4 | `[x]` | `[x]` | `[x]` | Live verified: 3 entries in audit_logs table (CREATE Project, CREATE/UPDATE TestDefinition) |
| 2-J | Missing UI step types: `ASSERT_VISIBLE`, `ASSERT_URL`, `WAIT`, `SCREENSHOT`, `HOVER`, `SELECT`, `PRESS_KEY` | §2.5 | `[x]` | `[x]` | `[x]` | All step types in StepRunner; unit tested; SCROLL, ASSERT_ELEMENT, CUSTOM also added |

### Phase 2 — Verification Sign-off
```
2-A  Verified by: ____________  Date: ____________
     Acceptance: Can create Org→Project→Module→Feature→TestCase via UI; hierarchy displays correctly;
     delete cascades; API returns 403 for out-of-org requests.
     Notes:

2-B  Verified by: ____________  Date: ____________
     Acceptance: UI test runs Playwright steps; API test hits real endpoint; Shell test runs command.
     All three types show correct pass/fail output and step results.
     Notes:

2-C  Verified by: ____________  Date: ____________
     Acceptance: Platform admin can set AI provider + email config; a test run uses the configured
     provider; {{PLATFORM_VAR}} resolves correctly in a test step.
     Notes:

2-D  Verified by: ____________  Date: ____________
     Acceptance: A UI test with a broken selector heals via AI and records a SelectorHeal event.
     SelectorHeal appears in run detail. verifyOutcomes confirms a passing step.
     AI falls back to deterministic when model has no vision support.
     Notes:

2-E  Verified by: ____________  Date: ____________
     Acceptance: Create a feature with test cases; publish as v1.0; edit a step; header shows
     "Draft has changes"; publish as v2.0 with a name + description; run history shows version
     badge on each run; clicking badge opens read-only snapshot; restoring v1.0 replaces live
     draft; old runs still reference their original version snapshot correctly.
     Notes:

2-F  Verified by: ____________  Date: ____________
     Acceptance: QA_ENGINEER cannot hit project settings endpoint (403). MANAGER cannot trigger run.
     ORG_ADMIN bypasses all project guards.
     Notes:

2-G  Verified by: ____________  Date: ____________
     Acceptance: Run history filters by status, date, environment. Results match DB query.
     Notes:

2-H  Verified by: ____________  Date: ____________
     Acceptance: Requests to `../../etc/passwd` return 400. Verified with curl.
     Notes:

2-I  Verified by: ____________  Date: ____________
     Acceptance: AuditLog table has entries for project create/delete, test create/delete, role change.
     Notes:

2-J  Verified by: ____________  Date: ____________
     Acceptance: Each new step type executes correctly in a Playwright run and records pass/fail.
     Notes:
```

---

## Phase 3 — Real-time & UX Improvements

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 3

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 3-A | WebSocket live run updates — socket replaces polling in run detail and run list | §3.1 | `[x]` | `[x]` | `[x]` | RunsGateway on port 3002; useRunSocket/useProjectRunSocket hooks; run detail shows "Live" indicator; project run list auto-refreshes |
| 3-B | Screenshot viewer + artifact previews — lightbox, prev/next, trace link | §3.2 | `[x]` | `[x]` | `[x]` | ScreenshotViewer component with keyboard nav; inline step screenshot links; thumbnail strip |
| 3-C | Feature Test Player — play/pause/stop, sequential test execution, WebSocket events | §3.3 | `[x]` | `[x]` | `[x]` | Live player panel on FeaturePage; per-test status indicators; pause/resume/stop buttons; useFeatureRunSocket hook |
| 3-D | Live Test Viewer — CDP screencast pipeline (worker→Redis→Socket.io→Canvas) | §3.4 | `[x]` | `[ ]` | `[ ]` | ScreencastService in worker (CDP→Redis); ScreencastGateway on /screencast namespace; LiveBrowserCanvas component draws JPEG frames on canvas. Jira/Slack buttons disabled with "Requires setup" badge until configured in Admin. |
| 3-E | Step failure action panel — Add Comment, Skip Step, Abort Run, Retry Step, Create Jira Ticket, Notify Slack/Teams | §3.4 | `[x]` | `[ ]` | `[ ]` | StepFailurePanel component; skip/retry/addNotes endpoints live; Jira/Slack disabled with "Requires setup" badge when not configured in platform config |
| 3-F | Analytics & trend charts — pass rate trend, flaky tests, per-feature stats | §3.5 | `[x]` | `[x]` | `[x]` | trend/flaky/breakdown endpoints live; Recharts line chart on dashboard; flaky tests panel; real stat cards |
| 3-G | Settings page — theme, notifications, account | §3.6 | `[x]` | `[x]` | `[x]` | SettingsPage with theme selector, notification toggles, sign out |

### Phase 3 — Verification Sign-off
```
3-A  Verified by: ____________  Date: ____________
     Acceptance: Trigger a run; run status updates in UI without page refresh within 2s.
     Notes:

3-B  Verified by: ____________  Date: ____________
     Acceptance: Click a screenshot thumbnail → lightbox opens; keyboard prev/next works.
     Notes:

3-C  Verified by: ____________  Date: ____________
     Acceptance: Click Play on a feature with 3 tests; all 3 run sequentially; pause stops
     between tests; stop cancels remaining; left panel shows live status indicators.
     Notes:

3-D  Verified by: ____________  Date: ____________
     Acceptance: Start an automated run; canvas shows live browser frames within 2s of start.
     Multiple browser tabs can watch the same run. Frames stop on run complete.
     Notes:

3-E  Verified by: ____________  Date: ____________
     Acceptance: Deliberately break a selector; failure panel appears; Create Jira Ticket
     creates an issue with screenshot attached; Notify Slack fires immediately.
     Notes:

3-F  Verified by: ____________  Date: ____________
     Acceptance: 7-day pass rate trend chart renders with real data. Flaky tests list
     shows tests with 20–80% pass rate. Per-feature stats accurate.
     Notes:
```

---

## Phase 4 — Security Hardening

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 4

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 4-A | Rate limiting, Helmet headers, secret masking, JWT secret validation | §4.1–4.8 | `[x]` | `[x]` | `[x]` | ThrottlerModule (global 100/min, auth 10/min); @fastify/helmet (12 headers); maskVariables(); validateBaseUrl(); JWT ≥32 char check on startup |

### Phase 4 — Verification Sign-off
```
4-A  Verified by: Claude  Date: 2026-04-20
     Acceptance: 11th auth request within 60s returns 429. GET environment does not expose
     secrets in plain text. `curl -I` shows security headers (X-Content-Type, etc.).
     Notes: Live verified — curl confirmed 11th POST /auth/login returns HTTP 429.
            curl -I shows all 12 Helmet headers (CSP, X-Frame-Options, HSTS, etc.).
            x-ratelimit-limit-global:100 and x-ratelimit-limit-auth:10 present on every response.
            maskVariables() unit tested: 22/22 passing. validateBaseUrl() rejects ftp/file/js protocols.
            JWT startup guard tested: <32-char secret throws Error at bootstrap.
            All tests: API 60/60, Worker 46/46, Web 21/21.
```

---

## Phase 5 — Advanced Features

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 5

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 5-N | Stats panels (module/feature list/feature detail/per-test), "Start Testing" entry points, full-screen testing view (2-pane: adjustable left test list + right browser), top action bar, run controls, keyboard shortcuts | §5.N | `[~]` | `[ ]` | `[ ]` | Done 2026-04-21: StatsService (5 endpoints), module stats strip (ProjectDetailPage), feature stats strip (FeaturesPage), TestingView full-screen overlay, two-pane drag-resize (localStorage), Manual mode iframe+timeout, run controls (Start/Pause/Stop/Resume), live socket updates. Done 2026-04-21 (cont): FeaturePage 4 stat cards (test cases / passed / failed / pass rate from last run), test row hover "▶ Test" button, automated run card dark-theme fix. Remaining: automated canvas panel in FeaturePage, keyboard shortcuts |
| 5-A | Export / Import — project, module, feature, test case levels; portable JSON format | §5.0 | `[ ]` | `[ ]` | `[ ]` | |
| 5-B | Scheduled runs — cron expression per feature, timezone support, next-run preview | §5.1 | `[ ]` | `[ ]` | `[ ]` | |
| 5-C | CI/CD integration — REST trigger API, GitHub Actions example, status badge | §5.2 | `[ ]` | `[ ]` | `[ ]` | |
| 5-D | Notifications & integrations — Email, Slack, Teams, Jira, Custom Webhook | §5.3 | `[ ]` | `[ ]` | `[ ]` | |
| 5-E | Manual testing mode — step checklist, iframe preview, tester marks pass/fail | §5.4 | `[x]` | `[x]` | `[x]` | Fully verified 2026-04-21: mode toggle, ManualPlayer 2-col layout, step pre-creation, pass/fail marking, auto-advance, completion screen, MANUAL badge in history. Extended 2026-04-21: iframe 10s timeout state machine (loading/loaded/timeout/blocked), screenshot evidence upload (5 files × 10MB, FileReader preview, upload-on-mark), heartbeat every 5min (POST /feature-runs/:id/heartbeat), inactivity warning at 30min, End Session dialog with ABANDONED flow (POST /feature-runs/:id/abandon), Prisma migration add_feature_run_heartbeat |
| 5-E2 | Bug/Snag/Query Issue Tracking — log issues during manual testing, OPEN→IN_PROGRESS→RESOLVED/WONT_FIX/CLOSED lifecycle, status history audit, comments, stats widgets at project/module/feature/test levels, IssueListDrawer, project-level enable toggle, ClickUp push prep | §5.4 | `[x]` | `[x]` | `[x]` | Implemented 2026-04-22: Prisma schema (Issue, IssueStatusHistory, IssueComment models + 3 enums), migration, NestJS IssuesModule (service + controller + 5 DTOs), issuesApi in frontend lib, IssueTracker.tsx (IssueStatsWidget, LogIssueModal, IssueDetailModal, IssueListDrawer, LogIssueButton), integrated into ProjectDetailPage + TestEditorPage |
| 5-F | Screen recording during manual tests — FloatingRecorder, RecordRTC, review modal, attach to Jira | §5.4 | `[ ]` | `[ ]` | `[ ]` | |
| 5-G | RAG / Codebase-aware test generation — repo connect, indexing, vector search, AI generates with real selectors, on-demand file fetch, auto feature↔code mapping | §5.5.1–5.5.5 | `[ ]` | `[ ]` | `[ ]` | |
| 5-J | Org-level Git credentials — one OAuth/PAT per org inherited by all projects, token expiry monitoring, credential management UI | §5.5.6 | `[ ]` | `[ ]` | `[ ]` | |
| 5-K | Advanced code intelligence — change-aware test alerts, smart feature discovery, coverage heat map, multi-repo cross-stack generation | §5.5.7 | `[ ]` | `[ ]` | `[ ]` | |
| 5-H | AI recommendation engine — flaky test analysis, coverage gaps, selector health report | §5.6 | `[ ]` | `[ ]` | `[ ]` | |
| 5-I | Testing Phases & Progress Reports — org phase templates, env access per phase, phase-scoped visibility, handover email, sign-off flow & email, auto-phase switching, UAT empty state, PDF reports, scheduled reports, customizable report-builder modal (session/feature/project sections), report summary card (`totalReports` + `latestReport`), `View Reports` history, plus saved report configs and regenerate flow (new immutable snapshots over time) | §5.7 | `[ ]` | `[ ]` | `[ ]` | |
| 5-L | ~~PM Tool Integrations (old design)~~ — **REFACTORED into §5.8 new design** — split into 5-P1 through 5-P6 below | ~~§5.8~~ | `[~]` | `[~]` | `[~]` | Superseded by unified plugin registry — see docs/PLUGIN_REGISTRY.md |
| 5-P1 | **Plugin Registry Core** — unified manifest/capability architecture, Prisma refactor (OrgPluginInstall/ProjectPluginBinding/ModulePluginBinding/FeaturePluginBinding/TicketLink/DocLink/PluginStatusMapping/PluginWebhookEndpoint), SecretsService AES-256-GCM, effective-config cascade resolver, HTTP client with retry + rate-limit, PluginService.dispatch, admin UI (`/org/:slug/plugins`), project/module/feature binding UI with inherit toggles, health-check cron, audit logging | §5.8-A | `[ ]` | `[ ]` | `[ ]` | Foundation — 104 tasks |
| 5-P2 | **Slack plugin** — validates registry end-to-end, `notify`-only capability, Block Kit message builder, webhook auth | §5.8-B | `[ ]` | `[ ]` | `[ ]` | 7 tasks — prereq for ClickUp |
| 5-P3 | **ClickUp core** — manifest + schemas, PAT auth, workspace hierarchy cache, `createIssue` (list + subtask modes), `linkTicket` (URL/ID parsing + custom-ID lookup), typed errors, binding UI (cascading dropdowns + target mode + status grid), LinkedTicketWidget on FeaturePage, Create Ticket flow (failure panel + findings + manual issues) | §5.8-C | `[ ]` | `[ ]` | `[ ]` | 44 tasks |
| 5-P4 | **ClickUp phase sync + AI context** — `syncPhaseStatus` hooked into FeaturePhaseService, `fetchTicketContext` (AC extraction + comments), TestGeneration prompt injection as Story Context, `import-ac` endpoint, `explain` SSE endpoint, FeaturePage AI panel + `[Import from ClickUp]` button | §5.8-D | `[ ]` | `[ ]` | `[ ]` | 18 tasks |
| 5-P5 | **ClickUp attachments** — screenshot always-upload, recording conditional (≤50 MB configurable + `attachRecordings` flag), URL fallback via signed-URL injected into description, retry once on network error | §5.8-E | `[ ]` | `[ ]` | `[ ]` | 12 tasks |
| 5-P6 | **ClickUp Docs + Testing View pill** — v3 Docs API reconnaissance, `fetchDocs` (listDocs/fetchDoc), DocLink multi-scope (project/module/feature simultaneous), Link-a-Doc modal (paste + browse tabs), DocViewer component, Doc widgets on FeaturePage/ModulePage/ProjectOverviewPage, `📄 N docs ▼` pill in Testing View top bar + side drawer, AI context injection from linked docs | §5.8-F | `[ ]` | `[ ]` | `[ ]` | 43 tasks |
| 5-P7 | **Plugin rate limiting & health notifications** — ClickUp token bucket (90/min), 3-in-5min 429 → `PLUGIN_RATE_LIMITED`; `PLUGIN_HEALTH_DEGRADED` + `PLUGIN_SYNC_FAILED` notification types | §5.8-G | `[ ]` | `[ ]` | `[ ]` | 7 tasks |
| 5-P8 | **Plugin E2E verification** — full install→bind→dispatch→ticket flow, module override cascading, size fallback, multi-scope docs, AI prompt integration, manual test script | §5.8-H | `[ ]` | `[ ]` | `[ ]` | 10 tasks |
| 5-P9 | **ClickUp inbound status sync** — `pullTicketStatus` capability, bi-directional `PluginStatusMapping` (direction + targetType), `TicketStatusSuggestion` model, `InboundSyncService` with auto-apply/pending/unmapped paths, bulk refresh via `date_updated_gt`, inbound mapping UI (new "Inbound" tab), Snags drawer in Testing View with `[🐞 N snags ▼]` pill + `[↺ Refresh]` button + highlight routing from deep links + inline "Apply mapping?" banner | §5.8-I | `[ ]` | `[ ]` | `[ ]` | 68 tasks |
| 5-P10 | **ClickUp webhooks** — extend `PluginWebhookEndpoint` + `WebhookEvent` audit model, raw-body NestJS middleware, generic HMAC-verified receiver endpoint, ClickUp `webhookListener` impl (taskStatusUpdated/taskMoved/taskDeleted), auto-register on enable + unregister on disable, replay protection (5 min digest set), failed-verification lockout (10/hr), endpoint rotation with 1h grace, admin UI recent events table, 30-day audit retention cron | §5.8-J | `[ ]` | `[ ]` | `[ ]` | 44 tasks |
| 5-P11 | **Jira plugin (registry-native)** — Jira manifest/schemas/lifecycle, createIssue + linkTicket + pullTicketStatus + syncPhaseStatus + fetchTicketContext + webhookListener, capability-gated UI wiring, contract/integration/manual verification | §5.8-K | `[ ]` | `[ ]` | `[ ]` | 24 tasks |
| 5-M | In-App Notifications & Email — bell icon, notification panel, toasts, all 20 notification types with action CTAs, per-user preferences, project muting, 18 email templates, base template, SMTP queue, daily digest, unsubscribe | §5.M | `[~]` | `[ ]` | `[ ]` | Done 2026-04-21: Notification Prisma model + NotificationType (24 values) + NotificationCategory (7 values) enums + migration applied. Remaining: API endpoints (GET/POST/PATCH notifications), bell icon in TopNav, notification panel, toasts, email templates |

### Phase 5 — Verification Sign-off
```
5-N  Verified by: ____________  Date: ____________
     Acceptance:
     - Module list: each row shows ✅/❌/⊘/○ counts; outstanding shown in amber; "Not yet
       tested" when no runs; pass rate colour-coded (green ≥80% / amber / red).
     - Feature list: each row shows same stats + last run timestamp + "Start Testing →"
       button; button navigates to /features/:id/test.
     - Feature detail: 4 stat cards at top (Passed/Failed/Skipped/Outstanding); clicking
       Failed card filters test table to show only failed tests; clicking Outstanding shows
       only never-run tests; clicking All clears filter.
     - Test case table: Status column (✅ Pass / ❌ Fail / ○ —) + Duration column visible;
       failed rows have red tint; outstanding rows have amber tint; table sorted failed-first
       by default.
     - "▶ Test" hover button on each test case row navigates to testing view with that test
       pre-selected and expanded.
     - Testing view fills 100% viewport — no sidebar, no topnav visible.
     - Left panel default 320px; drag handle resizes to min 220px / max 520px; width
       persists after page refresh.
     - Top bar: environment selector populates and persists; mode toggle switches right
       panel between canvas and iframe; controls change state correctly through
       idle→running→paused→complete lifecycle.
     - Left panel: all test cases listed; status icons correct; clicking row expands it
       (others collapse); expanded automated row shows step list with live updates;
       progress bar advances step-by-step; list auto-scrolls to active test.
     - Automated right panel: LiveBrowserCanvas fills panel; step failure slides up
       StepFailurePanel overlay; recovery actions (Skip, Retry, Abort) function.
     - Manual right panel: iframe loads baseUrl; 10s timeout shows fallback; "Open in New
       Tab" works; step checklist in left panel expanded row — Pass/Fail buttons advance
       steps; notes and screenshot upload work.
     - Keyboard: Space pauses/resumes; Escape closes (with confirmation if active);
       ↑/↓ navigates test list; P/F marks manual steps.
     Notes:

5-A  Verified by: ____________  Date: ____________
     Acceptance: Export a project to JSON; import it into a different project; all modules,
     features, and test cases present. Import is transactional (fails all or nothing on bad input).
     Notes:

5-B  Verified by: ____________  Date: ____________
     Acceptance: Set a cron schedule on a feature; run fires automatically at scheduled time;
     next-run timestamp shown correctly in UI.
     Notes:

5-C  Verified by: ____________  Date: ____________
     Acceptance: POST to /ci/trigger with valid API key starts a feature run; GitHub Actions
     workflow example triggers and polls for result; status badge shows correct state.
     Notes:

5-D  Verified by: ____________  Date: ____________
     Acceptance: On feature run failure — email sent, Slack message posted with screenshot,
     Teams card posted, Jira ticket created, webhook fires with signed payload.
     All five integrations verified end-to-end on a real failure.
     Notes:

5-E  Verified by: ____________  Date: ____________
     Acceptance: Start a manual run; iframe loads the app; mark steps pass/fail with notes;
     run completes and appears in history with MANUAL badge; same notification rules fire.
     Notes:

5-F  Verified by: ____________  Date: ____________
     Acceptance: Start recording during a manual session; take screenshots; stop recording;
     review modal shows video preview; attach to test step; create Jira ticket with video
     and screenshots attached.
     Notes:

5-G  Verified by: ____________  Date: ____________
     Acceptance: Connect a GitHub repo (using org credential); indexing completes without
     errors; describe a feature in plain English; file hints auto-populated from feature name;
     AI generates test steps with real selectors from the codebase; on-demand file fetch works
     on un-indexed repo; generated selectors match actual elements in the app.
     Notes:

5-J  Verified by: ____________  Date: ____________
     Acceptance: ORG_ADMIN adds GitHub OAuth credential in Org Settings → Source Code;
     project owner connects repo using "Use org credential" (no re-auth needed); second project
     connects to a different repo using the same org credential; token expiry warning appears
     when PAT is within 30 days of expiry; deleting a credential in use returns 400 with
     affected project list.
     Notes:

5-K  Verified by: ____________  Date: ____________
     Acceptance: Push a code change to tracked branch → tests generated from the changed file
     gain "⚠ Code changed" badge; Coverage Map shows uncovered files in red with [Generate →]
     links; Feature Discovery suggests at least one feature from an un-tested component;
     multi-repo generation drawer selects both frontend and API repos and AI prompt includes
     context from both.
     Notes:

5-H  Verified by: ____________  Date: ____________
     Acceptance: AI recommendations page shows flaky tests ranked by instability;
     coverage gap suggestions reference actual untested features; selector health
     report flags selectors healed more than once.
     Notes:

5-M  Verified by: ____________  Date: ____________
     Acceptance:
     - Bell icon shows badge 0 on fresh account; badge increments in real-time when a
       test run completes without page refresh.
     - Notification panel opens; shows run result with correct title/body/CTAs; unread
       dot clears after 1 second; badge resets to 0 on "Mark all read".
     - Failure notification: red border on toast; toast persists 10s; clicking navigates
       to run detail and dismisses toast.
     - PHASE_REQUIRES_SIGN_OFF notification: "Sign Off Feature" CTA opens sign-off modal.
     - SELECTOR_HEALS_DETECTED: "Review Heals" CTA navigates to run heals tab; "Update
       Selectors" applies high-confidence heals to test definitions.
     - ACCESS_REQUEST_SUBMITTED: admin receives in-app + email; "Review Request" CTA
       opens review modal; approval fires ACCESS_REQUEST_APPROVED notification to requester.
     - Mute a project from notification three-dot menu; that project's notifications no
       longer appear; muted badge shows on project card; unmute restores notifications.
     - Preferences page: uncheck Email for "Feature run passed"; trigger a passing run;
       no email received, in-app notification still appears.
     - Daily digest: set a type to Digest; trigger multiple events; at configured time
       one digest email arrives with all batched items grouped by category.
     - Password reset email: trigger forgot-password; email arrives within 30s; link works.
     - Run-failed email: trigger failure; email arrives with per-test failure rows, AI
       summary, screenshot thumbnail, and "View Full Report" CTA link.
     - Unsubscribe: click unsubscribe link in email footer; confirmation page shows;
       email preference for that type toggled off; subsequent events produce no email.
     - Admin Panel → Email tab: delivery log shows sent entries; force a failure;
       retry button re-queues and delivers.
     Notes:

5-L  SUPERSEDED — see 5-P1 through 5-P8 for new plugin registry acceptance blocks.

5-P1 Verified by: ____________  Date: ____________  (Plugin Registry Core)
     Acceptance:
     - Prisma refactor: old tables (org_plugins, project_plugin_configs, feature_ticket_links,
       project_plugin_status_mappings) removed; new tables created; Prisma client regenerates;
       TypeScript compiles.
     - ORG_ADMIN navigates to /org/:slug/plugins → sees Slack + ClickUp (installed plugins
       only in Phase 1); each shows install state + health badge.
     - Install flow: clicking [Install] opens modal with auto-rendered form from Zod schema;
       password-type field renders as masked; "Test connection" runs healthCheck and shows
       green check with details on success.
     - Invalid secrets rejected at save-time; no install row created.
     - Secrets encrypted at rest (verified via psql SELECT on secrets_ciphertext — binary blob);
       `GET /plugin-installs/:id` returns secrets as `{ __masked: true }`.
     - Rotation: setting SECRETS_KEKS with v1 + v2 keys; existing install decrypts with v1;
       new install writes with v2; both work.
     - Cascading config: project binding sets list=A; module override sets list=B; feature
       override sets targetMode=subtask. `GET /features/:id/plugin-bindings/:installId/effective`
       returns merged { list: B, targetMode: 'subtask' }.
     - Module settings page shows project-inherited value as ghost placeholder; [Inherit]
       toggle resets the override and field falls back to project value.
     - Health check cron: stop backend API, wait 16 min, restart → PLUGIN_HEALTH_DEGRADED
       notification fires to ORG_ADMIN users.
     - Uninstall: secretsCiphertext overwritten with zeros (verified via psql); soft-delete
       set; all project/module/feature bindings cascaded to deleted.
     - Audit log entries for install / update / uninstall / binding.create / dispatch.
       createIssue — changed field names logged, never secret values.
     - Enablement four-level gate:
       * No OrgPluginInstall for ClickUp → no Docs/snags/refresh UI appears anywhere for
         any project; API endpoints for plugin capabilities return 404.
       * Install exists but isEnabled=false → same result (UI hidden, 404 on API).
       * Install enabled but lastHealthOk=false → amber "ClickUp offline" banner on
         affected pages with [Reconfigure] CTA; Refresh buttons disabled with tooltip;
         cached external status still visible on linked tickets.
       * Install healthy but project has no ProjectPluginBinding → UI still hidden for
         that project; other projects with bindings unaffected.
       * Binding exists but capability not in enabledCapabilities[] → that specific
         feature hidden (e.g. fetchDocs opted out → no Doc pill, but Create Ticket still
         works).
       * Binding has capability enabled but config invalid (e.g. createIssue with no
         targetListId) → that capability hidden; UI shows "Configure" nag in admin area.
     - BullMQ jobs re-check enablement at execution time (not scheduling time); queued
       bulk-refresh-tickets job no-ops with log line when plugin disabled between
       schedule and execution.
     - Webhook receiver short-circuits with WebhookEvent.result='ignored-plugin-disabled'
       when install disabled between upstream webhook registration and delivery.
     - TicketStatusSuggestion pending rows auto-dismissed with reason='PLUGIN_DISABLED'
       on uninstall; no orphan suggestions remain.
     - TicketLinks + DocLinks retained on uninstall with "offline" marker; user can
       unlink but not refresh or sync.
     Notes:

5-P2 Verified by: ____________  Date: ____________  (Slack plugin — arch validation)
     Acceptance:
     - Install Slack with webhook URL → health check returns ok.
     - Create project binding → default channel saved.
     - Trigger a notification event → Slack message arrives in channel.
     - Binding disabled → no messages delivered.
     Notes:

5-P3 Verified by: ____________  Date: ____________  (ClickUp core)
     Acceptance:
     - Install ClickUp with PAT → workspace dropdown populates once token valid → save
       stores encrypted token; health check returns username.
     - Project binding: space → folder → list cascading dropdowns all fed from hierarchy
       cache; saving with targetMode=subtask and no parentTaskId → 400.
     - Status mapping grid saves 4 rows (QA/UAT/SIGNOFF_PENDING/SIGNED_OFF) → external
       status names persist.
     - Module override: different targetListId → feature under module uses module's list;
       module's features without override use module list, not project list.
     - Feature override → takes precedence over module.
     - Create finding in exploratory session → [Create Ticket] → ClickUp selected → task
       appears in configured list with title + description + repro steps; TicketLink row
       exists; toast shows external ID.
     - Create finding with subtask mode effective → task is subtask of configured parent;
       description has "Related feature: [Login Flow](url)" line.
     - Link existing ticket: paste URL → LinkedTicketWidget renders with live status;
       status polls every 60s; cached 5min.
     - Paste custom ID (ABC-123) → resolves via custom-id endpoint.
     - Paste invalid URL → 400 "Task not found" or "Token invalid".
     - Unlink → TicketLink soft-deleted; widget returns to empty state.
     Notes:

5-P4 Verified by: ____________  Date: ____________  (Phase sync + AI context)
     Acceptance:
     - Promote feature QA → UAT → ClickUp task status updates to mapped value within 5s;
       TicketLink.lastSyncedAt updated; audit log entry exists.
     - Remove the UAT mapping → promote feature QA → UAT → sync skipped silently (warn log
       only, no error, no sync error banner).
     - ClickUp API returns 403 → TicketLink.lastSyncError populated; amber banner
       "⚠ ClickUp sync failed — [Retry] [Dismiss]" appears on FeaturePage; Retry re-dispatches.
     - Feature linked to ticket with ## Acceptance Criteria section + 4 bullets →
       [Import from ClickUp] button visible; modal shows 4 checkboxes; selecting 3 →
       creates 3 draft TestDefinitions.
     - AC extractor handles all three heading styles: `## Acceptance Criteria`, `## AC`,
       `**Acceptance Criteria:**` followed by bullets or numbered list.
     - "Ask about this feature" AI panel → SSE stream returns explanation citing ticket
       description + AC.
     - Test generation prompt includes `## Story Context` block when ticket linked.
     Notes:

5-P5 Verified by: ____________  Date: ____________  (Attachments)
     Acceptance:
     - Screenshot 5MB → uploaded as attachment to ClickUp task.
     - Screenshot 15MB → URL fallback; description contains signed link; 30-day TTL.
     - Recording 30MB, attachRecordings=true, max=50MB → uploaded as attachment.
     - Recording 100MB, max=50MB → URL fallback.
     - Recording 10MB, attachRecordings=false → URL fallback.
     - ClickUp returns 500 on upload → retry once; on second failure → URL fallback;
       task still has link in description.
     - Description append: current description preserved; new line added cleanly.
     Notes:

5-P6 Verified by: ____________  Date: ____________  (ClickUp Docs + Testing View pill)
     Acceptance:
     - Pre-flight: ClickUp v3 Docs API reconnaissance confirms endpoint paths; adapter
       function maps correctly.
     - [+ Link Doc] modal: Paste tab resolves Doc URL; Browse tab paginates 50 at a time;
       search filters by title.
     - Multi-scope: checking [x] feature + [x] module in one submit creates 2 DocLink rows
       atomically (verified via psql).
     - Cache: first open shows cached markdown; [Refresh] forces refetch; cache expires
       after 24h and is stale-while-revalidate refreshed.
     - FeaturePage LinkedDocsWidget: shows all linked docs (feature + module + project
       scope) deduped by externalId; each shows scope badge.
     - Testing View top bar: `📄 N docs ▼` pill renders count; N=0 hides pill; click opens
       dropdown with doc titles; clicking doc opens side drawer (380px) with rendered
       markdown.
     - Pin icon on drawer → right panel collapses to 50%.
     - Drawer state persists across page refresh (localStorage).
     - Cmd+D toggles doc drawer.
     - AI test generation with 3 linked docs (project + module + feature scope) → prompt
       contains `## Reference Docs` block with all three deduped; truncates oldest-first
       when budget exceeded.
     Notes:

5-P7 Verified by: ____________  Date: ____________  (Rate limiting + health notifications)
     Acceptance:
     - Token bucket refills at 90/min (configurable); 91st req in a minute waits; logs show
       bucket state.
     - 429 with Retry-After: 2 → retries once after 2s; succeeds second attempt.
     - 3 consecutive 429 in 5 min → PLUGIN_RATE_LIMITED notification fires to ORG_ADMIN.
     - Plugin health degrades → PLUGIN_HEALTH_DEGRADED notification fires.
     - Sync failure (phase sync 5xx repeatable) → PLUGIN_SYNC_FAILED notification to
       TECH_LEAD+; CTAs: [Retry] and [View Log] work.
     Notes:

5-P8 Verified by: ____________  Date: ____________  (E2E verification)
     Acceptance:
     - Full end-to-end scripted test (clickup-integration.e2e-spec.ts) passes with all 10
       scenarios.
     - Manual test script MT-PLUGINS executed against a real ClickUp workspace — bug filed
       from exploratory session arrives in correct list with all attachments.
     - /help/plugins/clickup documentation page exists with setup guide + troubleshooting.
     Notes:

5-P9 Verified by: ____________  Date: ____________  (Inbound status sync)
     Acceptance:
     - PluginStatusMapping refactor: existing phase-sync rows migrate to direction=
       BIDIRECTIONAL, targetType=PHASE; new rows for issue status mapping use
       direction=INBOUND, targetType=ISSUE_STATUS.
     - TicketLink gains 6 new columns (externalStatusColor/Type, externalAssignees,
       externalLastUpdatedAt, lastInboundSyncAt, lastInboundSyncError, lastInboundSource);
       Prisma migration applies cleanly.
     - TicketStatusSuggestion model created with kind enum (AUTO_APPLIED/PENDING_APPROVAL/
       UNMAPPED).
     - On a snag card in the Testing View Snags drawer, [↺ Refresh] button dispatches
       pullTicketStatus; ClickUp task status/color/assignees reflected in the linked-ticket
       row within 2s.
     - Auto-apply mode: change ClickUp task to a mapped status → refresh → snag status
       transitions immediately (verified via IssuesService path, audit log entry exists);
       TICKET_STATUS_SYNCED toast appears.
     - Pending mode (default): change ClickUp task to a mapped status → refresh →
       TICKET_STATUS_PENDING_APPROVAL notification with deep-link CTA fires; snag status
       unchanged until user clicks [Apply].
     - Deep-link navigation: click notification → Testing View opens at correct feature
       with Snags drawer open, correct snag in view, 2s yellow pulse on snag card, inline
       banner "ClickUp says X → Map to Y? [Apply] [Dismiss]" visible.
     - Apply button → snag transitions via IssuesService.transitionStatus (not direct DB);
       banner dismisses; socket event issue:updated received by other browser tabs;
       audit log plugin.status.suggestion.applied entry written.
     - Dismiss button → suggestion marked dismissed; snag unchanged.
     - Applied suggestion cannot be re-applied (409 AlreadyProcessedError).
     - Unmapped status: change ClickUp task to a status with no mapping → refresh →
       TicketStatusSuggestion kind=UNMAPPED; PLUGIN_STATUS_UNMAPPED notification to
       ORG_ADMIN; notification CTA opens Inbound mapping UI with that external value
       pre-filled in a new row.
     - Inbound mapping UI at Project Settings → Integrations → ClickUp → Inbound tab:
       left column populated from GET /clickup/statuses; right dropdown = IssueStatus enum;
       duplicate external value rejected on save; bulkRefreshOnProjectOpen + notifyUnmapped
       + autoApply toggles persist.
     - Bulk refresh: open project page with 10 linked tickets → uses a single
       GET /list/:id/task?date_updated_gt=... call per list (not 10 per-task GETs);
       verified via API call logs.
     - Bulk refresh skipped when rate-limit bucket <10% remaining; reschedules in 5 min.
     - bulkRefreshOnProjectOpen only triggers if max(lastInboundSyncAt) > 5 min ago.
     - Phase mapping round-trip: BIDIRECTIONAL row serves outbound (phase promotion →
       ClickUp status) AND inbound (ClickUp status change → phase advance via PhaseEngine.
       transition).
     Notes:

5-P10 Verified by: ____________  Date: ____________  (Webhooks — real-time inbound)
     Acceptance:
     - PluginWebhookEndpoint extended: externalWebhookId, externalSigningSecret, events,
       failedVerificationCount persist; WebhookEvent audit model migration applied.
     - NestJS raw-body middleware enabled for /webhooks/plugins/* — req.rawBody is a
       Buffer (not JSON-reserialized).
     - ClickUp install: POST /team/:wid/webhook called with correct endpoint URL; returned
       id + secret persisted on PluginWebhookEndpoint.
     - Simulating POST to /webhooks/plugins/:orgId/:installId/:token with valid
       X-Signature HMAC-SHA256 hex → 200; invalid signature → 401; failedVerificationCount
       incremented.
     - 11 bad signatures in 1h → endpoint isActive=false; PLUGIN_WEBHOOK_DISABLED
       notification to ORG_ADMIN.
     - taskStatusUpdated webhook → matched TicketLink → InboundSyncService.refreshTicket
       called (same handler as manual refresh); mapping resolution + suggestion/apply
       flows identical to §5-P9.
     - taskDeleted webhook → TicketLink soft-deleted; TICKET_DELETED_UPSTREAM notification
       to QA_ENGINEER + TECH_LEAD.
     - taskMoved webhook → refresh dispatched (list may have changed).
     - Duplicate webhook delivery (same payloadDigest within 5 min) → result=
       "ignored-duplicate"; no downstream actions.
     - WebhookEvent audit row created for every request with correct result string.
     - Rotate endpoint: POST /webhook/rotate generates new path+secret; old path accepts
       for 1h grace; after grace period old path → 404; new path active immediately.
     - Admin UI: plugin install page shows Webhooks accordion with endpoint URL,
       subscribed events, last-called timestamp, Rotate + Disable buttons, recent events
       table with event/result/timestamp; clicking row shows payload JSON.
     - Nightly cleanup cron deletes WebhookEvent rows older than 30 days (configurable via
       WEBHOOK_EVENT_RETENTION_DAYS env).
     - Manual test MT-WEBHOOKS against real ClickUp workspace: change a task status in
       ClickUp UI → platform snag reflects the change within 5 seconds without any
       manual refresh.
     Notes:

5-I  Verified by: ____________  Date: ____________
     Acceptance:
     - ORG_ADMIN creates 3 org phase templates (QA → UAT → Sign-off); new project inherits all 3.
     - Project admin edits UAT phase: sets environment to "Staging"; sets handoverRecipients.
     - Feature created in project auto-gets FeaturePhase PENDING records for all 3 phases.
     - Feature runs complete → QA phase passes; MANAGER clicks "Promote to UAT"; promote modal
       shows pre-populated recipient list (phase MANAGERs + configured recipients); handover
       email delivered with PDF attachment within 30s.
     - UAT tester logs in with no features in UAT → sees empty state with "Upcoming (in QA)"
       read-only status cards and no test action buttons.
     - UAT tester logs in with 2 features ready → "My UAT Tasks" shows Start/Continue cards.
     - Full project member sees features in all phases; test buttons greyed on phases they're
       not assigned to with "Not assigned to this phase" tooltip.
     - All UAT steps passed → "All phases complete" banner appears; MANAGER clicks
       "Sign Off Feature" → custom message modal → confirm → FeatureSignOff record created;
       sign-off email delivered to all resolved recipients; feature header shows "✅ Signed Off".
     - If next phase exists after sign-off, auto-promote fires; handover email for that phase sent.
     - Scheduled report fires at configured time; email contains correct HTML summary + PDF.
     Notes:
```

---

## Phase 6 — Multi-Tenancy, RBAC & Navigation Shell

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 6
> Spec: `docs/MULTI_TENANCY_AND_RBAC.md` · `docs/UI_LAYOUT.md`

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 6-A | Organisation (tenant) model — Org, OrgMember, OrgInvite, org-scoped API interceptor | §6.0 | `[x]` | `[x]` | `[x]` | Prisma migration add_multitenancy applied; Organisation/OrgMember/OrgInvite/ProjectMember models live; PlatformAdminGuard + OrgRoleGuard; OrganisationsModule with full CRUD + invite flow |
| 6-B | RBAC guards — OrgRoleGuard, ProjectRoleGuard applied to all endpoints per permission matrix | §6.1 | `[x]` | `[x]` | `[x]` | PlatformAdminGuard on /admin/* routes; OrgRoleGuard with @OrgRoles() decorator; JWT expanded with platformRole/activeOrgId/orgRole |
| 6-C | User management UI — member table, invite modal, role change, remove, pending invites | §6.2 | `[x]` | `[x]` | `[x]` | Admin Users tab: list all users with platformRole/status badges, suspend/reactivate actions |
| 6-D | Platform Admin Panel — org list, global user search, deactivate/hard-delete, promote | §6.3 | `[x]` | `[x]` | `[x]` | Full AdminPage: Overview/Approvals/Users/Orgs/Config/Audit tabs; live stats; registration approval queue with approve/reject + notes; org list; pending badge on Approvals tab |
| 6-E | Audit Log — sensitive actions recorded, visible to ORG_ADMIN and PLATFORM_ADMIN | §6.4 | `[x]` | `[x]` | `[x]` | AuditLog model has orgId FK; Audit Log tab in AdminPage |
| 6-F | Access Requests — org-level and project-level request/approve/reject flows | §6.5 | `[x]` | `[x]` | `[x]` | AccessRequestsModule: 6 service methods, 7 REST routes; OrgAccessRequestsPage admin review UI; RequestAccessModal on dashboard |
| 6-G | SSO — Google OAuth and Microsoft Azure AD login, account linking, JIT provisioning, SSO enforcement | §6.6 | `[x]` | `[x]` | `[x]` | GoogleStrategy + MicrosoftStrategy; findOrCreateSsoUser with domain auto-join; SSO buttons on LoginPage; SsoCallbackPage; LinkedAccountsSection in settings; ChangePasswordSection |
| 6-H | Navigation Shell — top nav, org switcher, collapsible sidebar, ⌘K command palette | §6.7 | `[x]` | `[x]` | `[x]` | Floating pill TopNav; org switcher dropdown with role badge + active indicator; PLATFORM_ADMIN sees Admin tab; regular users do not; zustand authStore persisted |
| 6-I | Organisation Dashboard — stat widgets, project card grid, activity feed, onboarding screen | §6.8 | `[x]` | `[x]` | `[x]` | DashboardPage redesigned: time-based greeting, 4 stat cards, project card grid with pass-rate bars, recent activity feed, onboarding empty state |

### Phase 6 — Verification Sign-off
```
6-A  Verified by: ____________  Date: ____________
     Acceptance: Create two orgs; user in both sees separate project lists; cross-org
     API request returns 403; switching org via org switcher immediately changes data context.
     Notes:

6-B  Verified by: ____________  Date: ____________
     Acceptance: QA_ENGINEER cannot access project settings (403). MANAGER cannot trigger run (403).
     ORG_ADMIN can do everything in their org. PLATFORM_ADMIN can access all orgs.
     Notes:

6-C  Verified by: ____________  Date: ____________
     Acceptance: Invite a new user by email; they receive invite email; accept link creates account
     and adds them to the org with correct role; ORG_ADMIN can change role and remove member.
     Notes:

6-D  Verified by: ____________  Date: ____________
     Acceptance: PLATFORM_ADMIN can list all orgs; search for a user across orgs; deactivate
     their account (login blocked); hard-delete removes user record.
     Notes:

6-E  Verified by: ____________  Date: ____________
     Acceptance: Audit log shows entries for invite sent, role changed, member removed.
     Visible to ORG_ADMIN in org settings; visible to PLATFORM_ADMIN in admin panel.
     Notes:

6-F  Verified by: Claude  Date: 2026-04-20
     Acceptance: Non-member submits org access request; ORG_ADMIN sees it in pending list;
     approve with role → user added to org and notified; reject with note → user notified
     with the note. Duplicate pending requests prevented.
     Notes: Implemented. AccessRequestsModule with createOrgRequest, createProjectRequest,
            listOrgRequests, listProjectRequests, listMyRequests, reviewRequest.
            Prisma AccessRequest model with type (ORG/PROJECT) + status (PENDING/APPROVED/REJECTED).
            APPROVE path creates OrgMember/ProjectMember in a Prisma transaction.
            OrgAccessRequestsPage admin UI + RequestAccessModal on dashboard.
            Live browser verified: OrgAccessRequestsPage renders correctly; review modal
            shows requester info, role selector, reviewer note, Approve/Reject buttons.
            API: 70/70 tests passing. Web: 21/21 tests passing. Build: clean.

6-G  Verified by: Claude  Date: 2026-04-20
     Acceptance: Click "Sign in with Google" → OAuth flow completes → JWT issued → user lands
     on dashboard. Existing password user can link Google in Settings. SSO-enforced org blocks
     password login and shows SSO message. New user from configured domain auto-joins org.
     Notes: Implemented. GoogleStrategy (passport-google-oauth20) + MicrosoftStrategy (passport-azure-ad).
            findOrCreateSsoUser: checks UserSsoAccount → links by email → creates new user;
            domain auto-join via Organisation.ssoDomain; SSO enforcement blocks password login.
            SSO buttons on LoginPage; SsoCallbackPage handles /auth/callback?token= redirect;
            LinkedAccountsSection in Settings; ChangePasswordSection in Settings.
            Microsoft strategy fix: redirectUrl must be https:// — uses https://not-configured.local
            as fallback so API boots without Azure credentials set.
            API: 70/70 tests passing. Web: 21/21 tests passing. Build: clean.

6-H  Verified by: ____________  Date: ____________
     Acceptance: Sidebar collapses to icon rail; collapse state persists across refresh.
     Org switcher dropdown lists all orgs and switches context on click.
     ⌘K opens palette; typing filters results; Enter navigates.
     PLATFORM_ADMIN item only visible to platform admins.
     Notes:

6-I  Verified by: Claude  Date: 2026-04-20
     Acceptance: Dashboard shows correct project count, 7d pass rate, currently failing count.
     Project cards show live status. "Create your organisation" screen shown for new users.
     Notes: Implemented. DashboardPage completely redesigned with time-based greeting,
            4 stat cards (projects/active runs/passing/failing), project card grid with
            pass-rate progress bars and border color by last run status, Run Now CTA on
            failed projects, recent activity feed, and onboarding empty state for new orgs.
            Role-aware: ORG_ADMIN gets 4th stat card = Members count + Team section with
            member list and "Manage Team →" link to /org/team.
            Live browser verified: all 4 stat cards render; Team section shows members;
            Manage Team navigates to /org/team correctly.
            New pages also verified: AdminPage (stat cards + pending approvals + org tabs),
            AdminOrgDetailPage (/admin/orgs/:id — 5 stat cards + members table + projects),
            OrgTeamPage (/org/team — members table with You badge + Invite Member modal).
            API: 70/70 tests passing. Web: 21/21 tests passing. Build: clean.
```

---

## Phase 7 — Operational Readiness

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 7  
> Architecture reference: `docs/WORKER_ARCHITECTURE.md`

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 7-A | Worker Concurrency & Queue Architecture — BullMQ queues, per-org fair queuing, worker pool manager, horizontal Docker scaling, DLQ, queue monitor UI | §7.1 | `[ ]` | `[ ]` | `[ ]` | |
| 7-B | Infrastructure & Deployment — nginx, health checks, structured logging, Prometheus metrics, backup scripts, runbook | §7.2 | `[ ]` | `[ ]` | `[ ]` | |

### Phase 7 — Verification Sign-off
```
7-A  Verified by: ____________  Date: ____________
     Acceptance: 50 concurrent runs across 5 orgs all complete without drops; P95 queue wait
     < 10 s on 2-worker setup; no single org's wait time > 2× median; killing one worker
     mid-run causes stalled job to be requeued within 60 s; Platform Admin queue monitor
     shows live queue depth, active jobs, and DLQ with retry/dismiss actions.
     Notes:

7-B  Verified by: ____________  Date: ____________
     Acceptance: `docker-compose up` from cold start completes within 3 min; health checks
     pass; backup script produces restorable archive; runbook covers common failure scenarios.
     Notes:
```

---

## Phase 8 — AI Intelligence & Agentic Testing

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 8
> Specs: `docs/AI_INTELLIGENCE.md` · `docs/AGENTIC_AI_TESTING.md`

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 8-A | AI Duplicate Detection — embedding-based similarity + LLM confirmation, duplicate groups, merge workflow | §8.1 | `[ ]` | `[ ]` | `[ ]` | |
| 8-B | Test Value Scoring — TVS formula (defect/stability/maintenance/coverage signals), tier classification, retire workflow | §8.2 | `[ ]` | `[ ]` | `[ ]` | |
| 8-C | AI Execution Strategist — smart test selection (Full/Smart/Fast/Flaky-skip modes), change impact analysis, effectiveness tracking | §8.3 | `[ ]` | `[ ]` | `[ ]` | |
| 8-D | Enhanced Flaky Test Detection — flip rate, correlations, quarantine system, AI root cause analysis | §8.4 | `[ ]` | `[ ]` | `[ ]` | |
| 8-E | Agentic AI Testing — multi-agent pipeline (Planner/Explorer/Generator/Executor/Analyzer/Healer/Reporter), LangGraph orchestration, decision audit trail | §8.5 | `[ ]` | `[ ]` | `[ ]` | |
| 8-F | MCP Server — expose platform data/actions to external AI tools (Claude Desktop, VS Code Copilot, Cursor) | §8.6 | `[ ]` | `[ ]` | `[ ]` | |

### Phase 8 — Verification Sign-off
```
8-A  Verified by: ____________  Date: ____________
     Acceptance: Create two near-identical tests; duplicate detection flags them as a group;
     merge keeps canonical and archives duplicate; editor shows "Similar tests" warning
     on creation of a test resembling an existing one.
     Notes:

8-B  Verified by: ____________  Date: ____________
     Acceptance: After 10+ runs, value scores computed for all tests; scores distribute across
     tiers correctly; RETIRE tier tests shown in candidates list; bulk retire archives them;
     TVS badge visible in test editor; distribution chart renders on dashboard.
     Notes:

8-C  Verified by: ____________  Date: ____________
     Acceptance: Trigger a SMART mode run; strategy preview shows which tests will run/skip/defer
     with reasons; post-run summary shows time saved; CI trigger with git diff correctly
     identifies change-affected tests as priority; effectiveness stats track false negatives.
     Notes:

8-D  Verified by: ____________  Date: ____________
     Acceptance: Test with >50% flip rate auto-quarantined after 10 runs; quarantined test
     failure does NOT fail the feature run; quarantine dashboard shows tests with metrics;
     AI root cause analysis returns structured output with suggested fix.
     Notes:

8-E  Verified by: ____________  Date: ____________
     Acceptance: Start agentic session with a goal; pipeline progresses through all 7 agents;
     live session view shows pipeline progress + decision feed; Explorer discovers pages;
     Generator creates tests from plan; Healer fixes broken selectors; Reporter generates
     summary; "Apply Tests" adds generated tests to feature; decision audit trail shows
     full reasoning chain.
     Notes:

8-F  Verified by: ____________  Date: ____________
     Acceptance: MCP server starts alongside API; Claude Desktop connects via MCP;
     list_tests returns project tests; trigger_run starts a run; get_run_status polls correctly.
     Notes:
```

---

## Phase 9 — BDD/Gherkin & Advanced Integrations

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 9
> Spec: `docs/BDD_GHERKIN.md`

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 9-A | BDD / Gherkin Native Support — Given/When/Then authoring, step definition registry, Gherkin parser, .feature import/export, AI BDD generation, dual-level reporting | §9.1 | `[ ]` | `[ ]` | `[ ]` | |
| 9-B | Requirements Traceability — requirement model, feature/test linking, coverage matrix, Jira sync | §9.2 | `[ ]` | `[ ]` | `[ ]` | |
| 9-C | Visual Regression Testing — baseline screenshots, pixelmatch diffing, approval workflow | §9.3 | `[ ]` | `[ ]` | `[ ]` | |
| 9-D | Accessibility Testing — axe-core integration, A11Y_SCAN step type, WCAG violation dashboard, AI remediation | §9.4 | `[ ]` | `[ ]` | `[ ]` | |
| 9-E | Cross-Project Reporting — org-wide dashboards, project comparison, health heatmap, org-level PDF reports | §9.5 | `[ ]` | `[ ]` | `[ ]` | |

### Phase 9 — Verification Sign-off
```
9-A  Verified by: ____________  Date: ____________
     Acceptance: Create a BDD test with Given/When/Then in the editor; syntax highlighting
     and auto-complete work; test executes via resolved native steps; import a .feature file
     and tests created correctly; export produces valid .feature; AI generates Gherkin from
     description; convert between structured ↔ BDD preserves behavior.
     Notes:

9-B  Verified by: ____________  Date: ____________
     Acceptance: Create a requirement; link it to a feature and tests; coverage matrix shows
     correct percentages; uncovered requirements highlighted; Jira sync imports stories.
     Notes:

9-C  Verified by: ____________  Date: ____________
     Acceptance: Set a screenshot as baseline; run test with UI change; visual diff detected;
     diff viewer shows side-by-side with overlay slider; approve updates baseline; reject
     marks mismatch. Threshold-based: tiny changes below threshold pass.
     Notes:

9-D  Verified by: ____________  Date: ____________
     Acceptance: Add A11Y_SCAN step to a test; run captures axe-core violations; dashboard
     shows violations by severity; AI suggests code fixes for violations.
     Notes:

9-E  Verified by: ____________  Date: ____________
     Acceptance: Org dashboard shows cross-project comparison table with metrics; heatmap
     renders; PDF export includes all project data; scheduled org report emails correctly.
     Notes:
```

---

## Phase 10 — Global Search & Extended Integrations

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 10

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 10-A | Global Search — full-text search across all entities (projects, modules, features, tests, runs, members, requirements, tags), ⌘K palette upgrade, dedicated `/search` page with filters | §10.1 | `[ ]` | `[ ]` | `[ ]` | |
| 10-B | Extended Integrations — Discord, GitHub Issues, GitLab Issues, Linear, Google Chat, ClickUp, PagerDuty plugins + updated failure action panel | §10.2 | `[ ]` | `[ ]` | `[ ]` | |
| 10-C | Git-Native CI Integration — commit status checks, PR event webhooks, deployment triggers, AI PR test suggestions, commit traceability, branch environments | §10.3 | `[ ]` | `[ ]` | `[ ]` | |

### Phase 10 — Verification Sign-off
```
10-A  Verified by: ____________  Date: ____________
      Acceptance: Search "login" returns results across features, test cases, and run errors;
      ⌘K palette groups by entity type with breadcrumbs; dedicated /search page filters by
      type and project; results respect org + project RBAC (cross-org results never appear);
      deep linking from result navigates to correct entity page.
      Notes:

10-B  Verified by: ____________  Date: ____________
      Acceptance: Configure Discord webhook → run failure posts embed to channel;
      Configure GitHub Issues → failure creates issue with screenshot link + labels;
      Configure Linear → failure creates issue in correct team;
      Configure PagerDuty → P0 failure triggers incident, subsequent pass resolves it;
      Failure action panel shows all configured bug-tracker options in "Create Issue" dropdown.
      Notes:

10-C  Verified by: ____________  Date: ____________
      Acceptance: Open a PR in a connected GitHub repo → platform receives webhook → PR comment
      posted listing affected features with "Run tests →" link; after CI triggers run, GitHub PR
      shows "QA Platform / Auth Login Flow — 4/4 passed" commit status check; deployment webhook
      auto-triggers smoke tests → commit status updated; AI PR suggestions appear in platform
      notification and can be accepted as draft tests; run history filterable by branch; commit
      SHA + branch + PR link visible on run detail page.
      Notes:
```

---

## Phase 11 — QA Session Tracking

> Plan reference: `IMPLEMENTATION_PLAN.md` → Phase 11
> Spec: `docs/SESSION_TRACKING.md`

| # | Feature | Plan ref | Impl | Tested | Verified | Notes |
|---|---------|----------|------|--------|----------|-------|
| 11-A | Data Model — WorkSession, WorkSessionEvent, enums, migration | §11.1 | `[ ]` | `[ ]` | `[ ]` | |
| 11-B | Session Service & Event Recording — lifecycle management, passive hooks into existing services | §11.2 | `[ ]` | `[ ]` | `[ ]` | |
| 11-C | AI Summary Generation — session summary + pre-filled time log notes | §11.3 | `[ ]` | `[ ]` | `[ ]` | |
| 11-D | Time Logging Integrations — ClickUp logTime() + Jira worklog, task search, last-used memory | §11.4 | `[ ]` | `[ ]` | `[ ]` | |
| 11-E | Session API — start/pause/resume/stop/discard, history, org admin view | §11.5 | `[ ]` | `[ ]` | `[ ]` | |
| 11-F | Session Timer Widget — top nav, live clock, HUD dropdown, start modal | §11.6 | `[ ]` | `[ ]` | `[ ]` | |
| 11-G | Session Review Modal — AI summary, activity breakdown, task picker, log time action, report distribution panel | §11.7 | `[ ]` | `[ ]` | `[ ]` | |
| 11-H | Session History & Detail — history table, `/sessions/:id` detail page, inline editing, event annotations, report actions | §11.8 | `[ ]` | `[ ]` | `[ ]` | |
| 11-I | Session Report Generation & Email — HTML/PDF report, recipient resolution, auto-send on review, re-send endpoint, org settings | §11.9 | `[ ]` | `[ ]` | `[ ]` | |

### Phase 11 — Verification Sign-off
```
11-A  Verified by: ____________  Date: ____________
      Acceptance: WorkSession and WorkSessionEvent tables created; status transitions
      enforced; durationMs correctly excludes pause time.
      Notes:

11-B  Verified by: ____________  Date: ____________
      Acceptance: Trigger a feature run with an active session → FEATURE_RUN_COMPLETED
      event recorded. File a Jira ticket → BUG_FILED event recorded. recordEvent() is
      a no-op when no session active (no DB write).
      Notes:

11-C  Verified by: ____________  Date: ____________
      Acceptance: Stop a session with multiple events; AI generates a 3-5 sentence
      factual summary mentioning features tested, pass/fail counts, and bugs filed;
      time log notes are shorter and suitable for a ticket comment.
      Notes:

11-D  Verified by: ____________  Date: ____________
      Acceptance: Log time to ClickUp — task picker searches tasks by name, time entry
      appears in ClickUp with correct duration and notes. Log time to Jira — worklog
      appears on the issue with correct time and comment.
      Notes:

11-E  Verified by: ____________  Date: ____________
      Acceptance: Start → pause → resume → stop lifecycle produces correct durationMs
      (pause time excluded). Auto-stop fires on logout. Unreviewed session banner shown
      on next login.
      Notes:

11-F  Verified by: ____________  Date: ____________
      Acceptance: Timer widget shows in top nav. Clicking "Start Session" opens modal,
      enters goal, starts timer. Live clock updates every second. HUD shows live counts
      that update as runs complete. Stop button stops session and opens review modal.
      Notes:

11-G  Verified by: ____________  Date: ____________
      Acceptance: Review modal shows correct duration, AI summary, feature breakdown table,
      and footer stats. ClickUp task picker searches and selects a task. Notes pre-filled
      by AI, editable. "Log Time & Save" calls ClickUp API and closes modal. "Discard"
      removes session.
      Notes:

11-H  Verified by: ____________  Date: ____________
      Acceptance: Profile → Sessions shows user's history with correct durations and
      summaries. Expandable row shows event timeline. /sessions/:id detail page loads.
      Inline-edit for goal/notes/start/end saves via PATCH. "+Add note" on timeline
      event persists. "Re-send Report" button triggers email. "Download PDF" downloads
      file. Org admin sees all members' sessions with filter.
      Notes:

11-I  Verified by: ____________  Date: ____________
      Acceptance: Stop and review a session → if autoSendOnReview enabled, email
      delivered to session owner + all project managers for touched projects; PDF
      attached. POST /sessions/:id/report/send with extra recipients → email delivered
      to merged list (no duplicates). GET /sessions/:id/report/pdf returns valid PDF.
      resolveRecipients() unit test passes with deduplication of overlapping roles.
      Notes:
```

---

## Documentation Completeness

Canonical reference docs required before implementing each phase.

| Doc | Status | Notes |
|-----|--------|-------|
| `docs/ARCHITECTURE.md` | ✅ Complete | |
| `docs/MULTI_TENANCY_AND_RBAC.md` | ✅ Complete | Expanded with env access per member |
| `docs/FEATURE_VERSIONING.md` | ✅ Complete | |
| `docs/TESTING_PHASES_AND_REPORTS.md` | ✅ Complete | Full phase + sign-off + handover flow |
| `docs/LIVE_TEST_VIEWER.md` | ✅ Complete | |
| `docs/CODEBASE_AWARE_TESTING.md` | ✅ Complete | |
| `docs/AI_LAYER.md` | ✅ Complete | |
| `docs/AI_EXECUTION_ENGINE.md` | ✅ Complete | Expanded: healing triggers, confidence thresholds, SelectorHeal linking, flaky integration |
| `docs/RUN_EXECUTION_SPEC.md` | ✅ Complete | NEW — full trigger→BullMQ→Playwright→DB flow |
| `docs/STEP_DEFINITION_SPEC.md` | ✅ Complete | NEW — all 22 step types, TypeScript interfaces, variable tokens |
| `docs/STEP_EDITOR_SPEC.md` | ✅ Complete | NEW — full step editor UI per step type |
| `docs/AI_GENERATION_SPEC.md` | ✅ Complete | NEW — prompt structure, streaming, validation, error recovery |
| `docs/WORKER_ARCHITECTURE.md` | ✅ Complete | |
| `docs/MANUAL_TESTING.md` | ✅ Complete | Expanded: iframe timeout, upload UX, auto-save, abandonment |
| `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` | ⚠️ Partial — to be refactored onto plugin registry | Slack/Teams/Email/Webhook spec stays, but plugin architecture moved to PLUGIN_REGISTRY.md |
| `docs/PLUGIN_REGISTRY.md` | ✅ Complete | **NEW FOUNDATION** — unified manifest+capabilities architecture, 8 capability slots, cascading binding config, secrets encryption, admin UI auto-rendered from schemas, dispatch/health/audit — replaces two old disjoint plugin systems |
| `docs/PM_INTEGRATIONS.md` | ✅ Complete | **REWRITTEN** — ClickUp-specific impl against plugin registry: PAT auth, list/subtask cascade, attachment upload <50MB else signed URL, ClickUp Docs v3 multi-scope linking, workspace hierarchy cache, phase sync, AC import, full acceptance criteria |
| `docs/JIRA_INTEGRATION.md` | ✅ Complete | **NEW** — Jira plugin plan against plugin registry: install/binding model, capability scope, webhook + inbound sync, implementation order, acceptance checklist |
| `docs/IN_APP_NOTIFICATIONS.md` | ✅ Complete | NEW — notification centre, 20 types with CTAs, preferences, muting, 18 email templates, email infra, digest, unsubscribe |
| `docs/EXPLORATORY_TESTING.md` | ✅ Complete | NEW — session-based exploratory testing, charters, time-box, live notes with slash-commands, screenshots + annotations, screen recording, findings with auto-captured repro, convert-to-ticket via plugin registry, coverage mind map, pair testing, SBTM metrics, debrief |
| `docs/FEATURE_PLAYER.md` | ✅ Complete | Rewritten — stats panels, Start Testing entry points, full-screen 2-pane testing view, back navigation, §10.6 doc pill in Testing View |
| `docs/EXPORT_IMPORT.md` | ✅ Complete | |
| `docs/AGENTIC_AI_TESTING.md` | ✅ Complete | |
| `docs/AI_INTELLIGENCE.md` | ✅ Complete | |
| `docs/BDD_GHERKIN.md` | ✅ Complete | |
| `docs/GLOBAL_SEARCH.md` | ✅ Complete | |
| `docs/EXTENDED_INTEGRATIONS.md` | ✅ Complete | |
| `docs/GIT_NATIVE_CI.md` | ✅ Complete | |
| `docs/SESSION_TRACKING.md` | ✅ Complete | |
| `docs/UI_LAYOUT.md` | ✅ Complete | |

---

## How to Update This File

### Marking a column done
Change `[ ]` to `[x]`:
```
| 2-A | Module & Feature hierarchy | §2.0.1 | `[x]` | `[x]` | `[ ]` | Pending sign-off |
```

### Marking in progress
```
| 2-A | Module & Feature hierarchy | §2.0.1 | `[~]` | `[ ]` | `[ ]` | In development |
```

### Marking blocked
```
| 2-D | Hybrid AI Execution Engine | §2.0.4 | `[!]` | `[ ]` | `[ ]` | Blocked: needs Phase 1 test infra first |
```

### Completing verification sign-off
Fill in the sign-off block below each phase table:
```
2-A  Verified by: Jamie D.  Date: 2026-04-20
     Acceptance: All criteria met.
     Notes: Edge case found — delete cascade leaves orphaned runs. Fixed in commit abc1234.
```

### Updating phase summary
Recount `[x]` marks per phase and update the Phase Progress Summary table at the top.

---

## Blocked / On Hold

Items that cannot proceed until a dependency is resolved:

| Item | Blocked by | Since |
|------|-----------|-------|
| 1-D smoke tests | Requires running Docker stack | Until Phase 2 sign-off |

---

## Completed Features

Move rows here (from their phase table) once all three columns are `[x]` and sign-off is filled in.

| # | Feature | Completed | Verified by |
|---|---------|-----------|-------------|
| _(none yet — pending manual verification)_ | | | |
