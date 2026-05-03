# QA Platform — Implementation Plan, Todo & Verification Checklist

> This document is the single source of truth for what needs to be built, in what order,
> and how to verify it works. Update status as work is completed.
>
> Status legend: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Table of Contents

1. [Phase 0 — Fix Existing Gaps](#phase-0--fix-existing-gaps)
2. [Phase 1 — Testing Infrastructure](#phase-1--testing-infrastructure)
3. [Phase 2 — Core Feature Completions](#phase-2--core-feature-completions)
4. [Phase 3 — Real-time & UX Improvements](#phase-3--real-time--ux-improvements)
5. [Phase 4 — Security Hardening](#phase-4--security-hardening)
6. [Phase 5 — Advanced Features](#phase-5--advanced-features)
7. [Phase 6 — Multi-Tenancy, RBAC & Navigation Shell](#phase-6--multi-tenancy-rbac--navigation-shell)
8. [Phase 7 — Operational Readiness](#phase-7--operational-readiness)
9. [Phase 8 — AI Intelligence & Agentic Testing](#phase-8--ai-intelligence--agentic-testing)
10. [Phase 9 — BDD/Gherkin Support & Advanced Integrations](#phase-9--bddgherkin-support--advanced-integrations)
11. [Phase 10 — Global Search & Extended Integrations](#phase-10--global-search--extended-integrations)
12. [Phase 11 — QA Session Tracking](#phase-11--qa-session-tracking)
13. [Manual Testing Procedures](#manual-testing-procedures)
13. [Automated Test Suite Plan](#automated-test-suite-plan)
14. [Verification Checklist (pre-release gate)](#verification-checklist-pre-release-gate)

---

## Phase 0 — Fix Existing Gaps

These are bugs or missing implementations in already-merged code.

### API / Worker

| # | Item | File | Status |
|---|------|------|--------|
| 0.1 | Implement `ASSERT_ELEMENT` step type in StepRunner | `apps/worker/src/steps/step.runner.ts` | `[ ]` |
| 0.2 | Implement `SCROLL` step type in StepRunner | `apps/worker/src/steps/step.runner.ts` | `[ ]` |
| 0.3 | Replace `CUSTOM` step throw with extensible handler | `apps/worker/src/steps/step.runner.ts` | `[ ]` |
| 0.4 | Sanitize artifact file paths against directory traversal | `apps/api/src/modules/artifacts/artifacts.service.ts` | `[ ]` |
| 0.5 | Enforce `UserRole` guards on all API endpoints (currently only `@UseGuards(AuthGuard)`) | `apps/api/src/modules/*/` | `[ ]` |
| 0.6 | Write `AuditLog` entries on create/update/delete operations | `apps/api/src/modules/projects,tests,runs` | `[ ]` |

### Frontend

| # | Item | File | Status |
|---|------|------|--------|
| 0.7 | Add `nginx.conf` for the web Docker image | `apps/web/nginx.conf` | `[ ]` |
| 0.8 | Add 404 / Not Found route | `apps/web/src/App.tsx` | `[ ]` |
| 0.9 | Add global error boundary component | `apps/web/src/components/ui/ErrorBoundary.tsx` | `[ ]` |
| 0.10 | Fix hardcoded `localhost:3001` in `api.ts` (use `VITE_API_URL`) | `apps/web/src/lib/api.ts` | `[ ]` |

---

## Phase 1 — Testing Infrastructure

Set up the testing foundation before adding more features.

### 1.1 API — Unit & Integration Tests (Jest + NestJS Testing)

| # | Item | Status |
|---|------|--------|
| 1.1.1 | Install Jest, ts-jest, @nestjs/testing, supertest in `apps/api` | `[ ]` |
| 1.1.2 | Create `apps/api/jest.config.ts` | `[ ]` |
| 1.1.3 | Unit test: `AuthService` — register, login, duplicate email, wrong password | `[ ]` |
| 1.1.4 | Unit test: `ProjectsService` — CRUD, soft delete, owner enforcement | `[ ]` |
| 1.1.5 | Unit test: `EnvironmentsService` — CRUD, project scoping | `[ ]` |
| 1.1.6 | Unit test: `TestsService` — CRUD, version increment, duplicate | `[ ]` |
| 1.1.7 | Unit test: `RunsService` — trigger, cancel, stats calculation | `[ ]` |
| 1.1.8 | Unit test: `ArtifactsService` — path resolution, not-found handling | `[ ]` |
| 1.1.9 | Unit test: `AiService` — mock provider, all three AI features | `[ ]` |
| 1.1.10 | Unit test: `provider.factory.ts` — each provider branch, missing config errors | `[ ]` |
| 1.1.11 | Unit test: `QueueService` — enqueue, metrics | `[ ]` |
| 1.1.12 | Integration test: full auth flow (register → login → /me) via TestingModule + real DB | `[ ]` |
| 1.1.13 | Integration test: project → environment → test → run trigger lifecycle | `[ ]` |
| 1.1.14 | Integration test: artifact upload and download | `[ ]` |
| 1.1.15 | Add `test`, `test:watch`, `test:cov` scripts to `apps/api/package.json` | `[ ]` |
| 1.1.16 | Add `test:api` script to root `package.json` | `[ ]` |

### 1.2 Worker — Unit Tests (Jest)

| # | Item | Status |
|---|------|--------|
| 1.2.1 | Install Jest, ts-jest in `apps/worker` | `[ ]` |
| 1.2.2 | Create `apps/worker/jest.config.ts` | `[ ]` |
| 1.2.3 | Unit test: `StepRunner` — each step type with a mocked Playwright Page | `[ ]` |
| 1.2.4 | Unit test: `StepRunner` — unknown type throws, ASSERT_TEXT mismatch throws | `[ ]` |
| 1.2.5 | Unit test: `ArtifactCollector` — register saves record, file-not-found skips gracefully | `[ ]` |
| 1.2.6 | Unit test: `RunExecutor` — mock DB + browser, happy path + step failure path | `[ ]` |
| 1.2.7 | Add `test` script to `apps/worker/package.json` | `[ ]` |
| 1.2.8 | Add `test:worker` script to root `package.json` | `[ ]` |

### 1.3 Web — Component & Hook Tests (Vitest + React Testing Library)

| # | Item | Status |
|---|------|--------|
| 1.3.1 | Install vitest, @testing-library/react, @testing-library/user-event, jsdom | `[ ]` |
| 1.3.2 | Create `apps/web/vitest.config.ts` | `[ ]` |
| 1.3.3 | Create `apps/web/src/test/setup.ts` (RTL cleanup, MSW setup) | `[ ]` |
| 1.3.4 | Install msw for API mocking | `[ ]` |
| 1.3.5 | Create `apps/web/src/test/handlers.ts` (MSW request handlers for all API routes) | `[ ]` |
| 1.3.6 | Component test: `Button` — renders variants, loading state, onClick | `[ ]` |
| 1.3.7 | Component test: `Badge` — all variants render correct class | `[ ]` |
| 1.3.8 | Component test: `RunStatusBadge` — each RunStatus maps correctly | `[ ]` |
| 1.3.9 | Component test: `Modal` — opens/closes, backdrop click, title renders | `[ ]` |
| 1.3.10 | Component test: `StatCard` — renders label, value, icon | `[ ]` |
| 1.3.11 | Page test: `ProjectsPage` — lists projects, opens create modal, submits form | `[ ]` |
| 1.3.12 | Page test: `RunsPage` — lists runs, trigger modal, cancel action | `[ ]` |
| 1.3.13 | Page test: `RunDetailPage` — steps render, AI button triggers mutation | `[ ]` |
| 1.3.14 | Page test: `AiPage` — prompt input, generate button enabled/disabled, response display | `[ ]` |
| 1.3.15 | Util test: `formatDuration`, `formatDate`, `cn` in `utils.ts` | `[ ]` |
| 1.3.16 | Add `test`, `test:watch`, `test:ui` scripts to `apps/web/package.json` | `[ ]` |
| 1.3.17 | Add `test:web` script to root `package.json` | `[ ]` |

### 1.4 Smoke Tests (Playwright against running stack)

| # | Item | Status |
|---|------|--------|
| 1.4.1 | Create `tests/smoke/` at repo root | `[ ]` |
| 1.4.2 | Install Playwright + `@playwright/test` in root dev deps | `[ ]` |
| 1.4.3 | Create `playwright.config.ts` targeting `http://localhost:3000` | `[ ]` |
| 1.4.4 | Smoke: `/health` API returns 200 with `status: ok` | `[ ]` |
| 1.4.5 | Smoke: Register new user and receive JWT | `[ ]` |
| 1.4.6 | Smoke: Login with registered user | `[ ]` |
| 1.4.7 | Smoke: Create project via API, assert in projects list | `[ ]` |
| 1.4.8 | Smoke: Create environment for project | `[ ]` |
| 1.4.9 | Smoke: Create test definition for project | `[ ]` |
| 1.4.10 | Smoke: Trigger run, poll until terminal state | `[ ]` |
| 1.4.11 | Smoke: UI — dashboard page loads without error | `[ ]` |
| 1.4.12 | Smoke: UI — projects page loads and shows created project | `[ ]` |
| 1.4.13 | Smoke: UI — run detail page loads with steps | `[ ]` |
| 1.4.14 | Add `test:smoke` script to root `package.json` | `[ ]` |

### 1.5 CI Script

| # | Item | Status |
|---|------|--------|
| 1.5.1 | Add root `test:all` script: `pnpm test:api && pnpm test:worker && pnpm test:web` | `[ ]` |
| 1.5.2 | Add `ci:check` script: lint + type-check + test:all | `[ ]` |

---

## Phase 2 — Core Feature Completions

### 2.0 Module & Feature Hierarchy + Test Case Types + Admin Panel (prerequisite for everything else)

**Confirmed design decisions:**
- A test case has ONE type (`UI`, `API`, or `SHELL`) — steps cannot be mixed across types
- Admin panel is platform-wide (all projects), separate from per-project Environments
- Variable resolution: project Environment takes precedence over Platform Config

**2.0.1 — Module & Feature schema**

| # | Item | Status |
|---|------|--------|
| 2.0.1.1 | Add `Module` model to `schema.prisma` (id, name, description, projectId, isActive, timestamps) | `[ ]` |
| 2.0.1.2 | Add `Feature` model to `schema.prisma` (id, name, description, moduleId, isActive, timestamps) | `[ ]` |
| 2.0.1.3 | Add nullable `featureId` to `TestDefinition` | `[ ]` |
| 2.0.1.4 | Write and run Prisma migration | `[ ]` |
| 2.0.1.5 | Create `ModulesModule` — CRUD for `/projects/:projectId/modules` | `[ ]` |
| 2.0.1.6 | Create `FeaturesModule` — CRUD for `/projects/:projectId/modules/:moduleId/features` | `[ ]` |
| 2.0.1.7 | Update `TestsModule` to scope by featureId when provided | `[ ]` |
| 2.0.1.8 | Unit test: modules CRUD, features CRUD, test scoping | `[ ]` |
| 2.0.1.9 | Integration test: create project → module → feature → test → verify hierarchy | `[ ]` |

**2.0.2 — Test Case Types**

| # | Item | Status |
|---|------|--------|
| 2.0.2.1 | Add `TestCaseType` enum to schema: `UI`, `API`, `SHELL` | `[ ]` |
| 2.0.2.2 | Add `type` field to `TestDefinition` (required, default `UI` for backward compat) | `[ ]` |
| 2.0.2.3 | Add UI step types to schema enum (existing NAVIGATE, CLICK etc. — no change) | `[ ]` |
| 2.0.2.4 | Add API step types to schema enum: `REQUEST`, `ASSERT_STATUS`, `ASSERT_BODY`, `ASSERT_HEADER`, `EXTRACT`, `DELAY` | `[ ]` |
| 2.0.2.5 | Add Shell step types to schema enum: `COMMAND`, `ASSERT_EXIT`, `ASSERT_OUTPUT`, `ASSERT_CONTAINS` | `[ ]` |
| 2.0.2.6 | Worker: create `ApiStepRunner` — executes HTTP requests, validates status/body/headers | `[ ]` |
| 2.0.2.7 | Worker: create `ShellStepRunner` — executes commands via `child_process.exec`, validates exit code and output | `[ ]` |
| 2.0.2.8 | Worker: `RunExecutor` routes to correct runner based on `TestDefinition.type` | `[ ]` |
| 2.0.2.9 | API: `TestsService.create` validates that all steps match the declared type | `[ ]` |
| 2.0.2.10 | AI: `AiService.generateTest` generates step format matching the requested type | `[ ]` |
| 2.0.2.11 | UI: test editor shows different step palette based on selected type | `[ ]` |
| 2.0.2.12 | UI: type selector (UI/API/Shell) on test case creation — locked after save | `[ ]` |
| 2.0.2.13 | Unit test: `ApiStepRunner` — REQUEST, ASSERT_STATUS, ASSERT_BODY, EXTRACT | `[ ]` |
| 2.0.2.14 | Unit test: `ShellStepRunner` — COMMAND pass/fail, exit code, output match | `[ ]` |
| 2.0.2.15 | Unit test: mixed-type steps in one test definition are rejected with 422 | `[ ]` |

**2.0.4 — Hybrid AI Execution Engine**

See full spec: `docs/AI_EXECUTION_ENGINE.md`

*Schema & model changes*

| # | Item | Status |
|---|------|--------|
| 2.0.4.1 | Add `description` field to step input schema (optional string) | `[ ]` |
| 2.0.4.2 | Add `expectedOutcome` field to step input schema (optional string) | `[ ]` |
| 2.0.4.3 | Add `aiExecution` object to test `config` schema: `{ enabled, healSelectors, verifyOutcomes, screenshotPerStep }` — all default `false` | `[ ]` |
| 2.0.4.4 | Add `SelectorHeal` model to Prisma schema: `{ runId, stepId, testDefinitionId, stepIndex, stepName, originalSelector, healedSelector, confidence, source, createdAt }` | `[ ]` |
| 2.0.4.5 | Write and run Prisma migration | `[ ]` |

*Worker — AI healing (selector resolution)*

| # | Item | Status |
|---|------|--------|
| 2.0.4.6 | Create `AiStepResolver` service in worker — takes screenshot + code chunks + step description, calls AI vision model, returns `{ selector, confidence, source }` | `[ ]` |
| 2.0.4.7 | `StepRunner.runStep()` — try `input.selector` first via Playwright; if not found and `healSelectors` enabled, call `AiStepResolver` | `[ ]` |
| 2.0.4.8 | If no `input.selector` and `description` present and `enabled` — go straight to `AiStepResolver` | `[ ]` |
| 2.0.4.9 | After successful heal, write `SelectorHeal` record with original selector, healed selector, confidence, source | `[ ]` |
| 2.0.4.10 | If AI cannot find element, `STEP FAILED` with message: `"Selector not found. AI attempted to locate '{description}' but could not identify a matching element."` | `[ ]` |
| 2.0.4.11 | AI model check on worker start — if `aiExecution.enabled` and configured model does not support vision, log warning and fall back gracefully to deterministic-only | `[ ]` |

*Worker — AI outcome verification*

| # | Item | Status |
|---|------|--------|
| 2.0.4.12 | Create `AiOutcomeVerifier` service — takes post-action screenshot + `expectedOutcome`, calls AI vision model, returns `{ passed, confidence, reason, observed }` | `[ ]` |
| 2.0.4.13 | After step executes, if `verifyOutcomes` enabled and `input.expectedOutcome` present — take screenshot and call `AiOutcomeVerifier` | `[ ]` |
| 2.0.4.14 | If outcome verification fails — mark step `FAILED` with AI reason as `errorMessage` | `[ ]` |
| 2.0.4.15 | Store outcome verification result in `RunStep.output` — `{ aiVerification: { passed, confidence, reason, observed } }` | `[ ]` |

*Worker — screenshot per step*

| # | Item | Status |
|---|------|--------|
| 2.0.4.16 | If `screenshotPerStep` enabled — take and store screenshot after every step (not just on failure) | `[ ]` |
| 2.0.4.17 | Screenshot stored as `Artifact` linked to `RunStep` with type `SCREENSHOT` | `[ ]` |

*Worker — repo context integration*

| # | Item | Status |
|---|------|--------|
| 2.0.4.18 | `AiStepResolver` calls `RetrievalService.findRelevantChunks(description, projectId)` if repo is connected | `[ ]` |
| 2.0.4.19 | Code chunks prepended to AI prompt as context — improves selector accuracy from `button.btn` to `[data-testid='login-submit']` | `[ ]` |
| 2.0.4.20 | If no repo connected — resolver uses screenshot only (visual-only mode) | `[ ]` |

*API — selector heal surfacing*

| # | Item | Status |
|---|------|--------|
| 2.0.4.21 | `GET /runs/:id` response includes `selectorHeals[]` array | `[ ]` |
| 2.0.4.22 | `GET /projects/:id/selector-heals` — list all heals in project, grouped by test definition | `[ ]` |
| 2.0.4.23 | `POST /tests/:id/steps/:index/update-selector` — update a step's selector to the healed value in one click | `[ ]` |

*Frontend — run detail view*

| # | Item | Status |
|---|------|--------|
| 2.0.4.24 | Run detail: step row shows `⚠ Selector healed` warning badge when `SelectorHeal` exists for that step | `[ ]` |
| 2.0.4.25 | Expandable heal detail: `Original: #login-btn → Healed: .btn-login (confidence: high, source: code)` | `[ ]` |
| 2.0.4.26 | "Update selector" button on heal detail — calls update-selector endpoint, shows success toast | `[ ]` |
| 2.0.4.27 | Feature run summary banner: `"⚠ 2 selector heals detected — review and update"` if any heals occurred | `[ ]` |
| 2.0.4.28 | Step row shows AI outcome verification result when `verifyOutcomes` was enabled: `AI verified: "User redirected to dashboard"` | `[ ]` |
| 2.0.4.29 | Per-step screenshot thumbnails visible in run detail when `screenshotPerStep` was enabled | `[ ]` |

*Test editor — AI execution config*

| # | Item | Status |
|---|------|--------|
| 2.0.4.30 | Test editor: AI Execution section in config panel — toggle `enabled`, `healSelectors`, `verifyOutcomes`, `screenshotPerStep` | `[ ]` |
| 2.0.4.31 | Step editor: `description` field below `selector` field with hint "Used by AI if selector fails" | `[ ]` |
| 2.0.4.32 | Step editor: `expectedOutcome` field with hint "AI verifies this after the step executes" | `[ ]` |

*Tests*

| # | Item | Status |
|---|------|--------|
| 2.0.4.33 | Unit test: `AiStepResolver` — returns selector from AI response, handles null/error gracefully | `[ ]` |
| 2.0.4.34 | Unit test: `AiOutcomeVerifier` — passed/failed outcomes, low confidence warning | `[ ]` |
| 2.0.4.35 | Unit test: `StepRunner` hybrid flow — selector found (no AI call), selector missing (AI call), both missing (fail) | `[ ]` |
| 2.0.4.36 | Unit test: `SelectorHeal` record written with correct fields on heal | `[ ]` |
| 2.0.4.37 | Unit test: vision-unsupported model falls back gracefully without throwing | `[ ]` |
| 2.0.4.38 | Integration test: run a test with broken selector + description, verify heal recorded and test passes | `[ ]` |

**2.0.3 — Platform Admin Panel**

| # | Item | Status |
|---|------|--------|
| 2.0.3.1 | Add `PlatformConfig` model to schema: `{ id, key (unique), value, isSecret, category, timestamps }` | `[ ]` |
| 2.0.3.2 | Create `AdminModule` — ADMIN-only endpoints | `[ ]` |
| 2.0.3.3 | `GET /admin/config` — list all platform config entries (secret values masked) | `[ ]` |
| 2.0.3.4 | `POST /admin/config` — create config entry | `[ ]` |
| 2.0.3.5 | `PUT /admin/config/:key` — update config entry | `[ ]` |
| 2.0.3.6 | `DELETE /admin/config/:key` — delete config entry | `[ ]` |
| 2.0.3.7 | `GET /admin/users` — list users with roles (ADMIN only) | `[ ]` |
| 2.0.3.8 | `PATCH /admin/users/:id` — update user role or deactivate | `[ ]` |
| 2.0.3.9 | `GET /admin/audit-logs` — paginated audit log viewer | `[ ]` |
| 2.0.3.10 | Worker: `ConfigResolver.resolve(key, environmentId)` — merges platform config + project environment, project takes precedence | `[ ]` |
| 2.0.3.11 | Worker: resolve `{{VAR_NAME}}` tokens in all step inputs before execution | `[ ]` |
| 2.0.3.12 | Secret values in `PlatformConfig` stored encrypted (AES-256), masked in all API responses | `[ ]` |
| 2.0.3.13 | UI: `/admin` route and `AdminPage` — accessible to ADMIN role only | `[ ]` |
| 2.0.3.14 | UI: Platform URLs tab — manage shared base URLs by category | `[ ]` |
| 2.0.3.15 | UI: Shared Credentials tab — manage secrets (show/hide toggle, never shown in full) | `[ ]` |
| 2.0.3.16 | UI: Global Variables tab — manage shared env vars | `[ ]` |
| 2.0.3.17 | UI: Users tab — list users, change role, deactivate | `[ ]` |
| 2.0.3.18 | UI: Audit Log tab — paginated table of platform actions | `[ ]` |
| 2.0.3.19 | Unit test: `ConfigResolver` — project value overrides platform value, missing key returns undefined | `[ ]` |
| 2.0.3.20 | Unit test: secret values never appear in GET /admin/config response | `[ ]` |
| 2.0.3.21 | Unit test: ENGINEER role gets 403 on all /admin/* endpoints | `[ ]` |

### 2.0.5 Feature Versioning

See full spec: `docs/FEATURE_VERSIONING.md`

**Database & Core**

| # | Item | Status |
|---|------|--------|
| 2.0.5.1 | Add `FeatureVersion` model: featureId, versionNumber (unique per feature), label, name, description, snapshot (Json), isActive, createdById, publishedAt | `[ ]` |
| 2.0.5.2 | Add `isDraft Boolean @default(true)` and `activeVersionId String?` to `Feature` model | `[ ]` |
| 2.0.5.3 | Add `featureVersionId String?` to `TestRun` model — set at run creation to the active version at that time | `[ ]` |
| 2.0.5.4 | Add `featureVersionId String?` to `FeatureRun` model | `[ ]` |
| 2.0.5.5 | Create `FeatureVersionsModule` with service + controller | `[ ]` |
| 2.0.5.6 | `POST /features/:id/versions` — snapshot current draft, auto-assign versionNumber, set as active | `[ ]` |
| 2.0.5.7 | Snapshot builder: serialize all `TestDefinition` + steps for the feature into `snapshot` JSON with a SHA-256 hash | `[ ]` |
| 2.0.5.8 | `GET /features/:id/versions` — list versions (id, label, name, description, publishedAt, isActive, run count, pass rate) | `[ ]` |
| 2.0.5.9 | `GET /features/:id/versions/:versionId` — return full version including snapshot | `[ ]` |
| 2.0.5.10 | `GET /features/:id/versions/:versionId/diff?compareTo=:id` — compare two version snapshots; return added/modified/removed test cases and changed steps | `[ ]` |
| 2.0.5.11 | `POST /features/:id/versions/:versionId/restore` — copy snapshot test definitions back to live draft (requires TECH_LEAD+) | `[ ]` |
| 2.0.5.12 | `PATCH /features/:id/versions/active` — set a different published version as active | `[ ]` |
| 2.0.5.13 | `GET /features/:id/draft-status` — compute SHA-256 of current test definitions, compare to active snapshot hash, return `{ isDraft, hasUnpublishedChanges, activeVersion }` | `[ ]` |
| 2.0.5.14 | `DELETE /features/:id/draft` — discard draft changes by restoring from active version snapshot | `[ ]` |
| 2.0.5.15 | On `FeatureRun.start()`: resolve active version and set `featureVersionId` on both FeatureRun and each TestRun | `[ ]` |
| 2.0.5.16 | On `FeatureRun.start()` with optional `versionId` override: use specified version instead of active | `[ ]` |
| 2.0.5.17 | Scheduled run config: support optional `versionId` field to pin a schedule to a specific version | `[ ]` |
| 2.0.5.18 | Unit test: publish creates correct snapshot JSON with hash; versionNumber increments correctly | `[ ]` |
| 2.0.5.19 | Unit test: diff returns added/modified/removed correctly for test case and step changes | `[ ]` |
| 2.0.5.20 | Unit test: restore overwrites live draft test definitions with snapshot contents | `[ ]` |
| 2.0.5.21 | Unit test: draft-status returns `hasUnpublishedChanges: true` after a step is edited | `[ ]` |
| 2.0.5.22 | Integration test: publish → edit draft → run uses old active version → publish new version → run uses new version | `[ ]` |

**Frontend**

| # | Item | Status |
|---|------|--------|
| 2.0.5.23 | Feature page header: version badge showing active version label + name | `[ ]` |
| 2.0.5.24 | Header state 1 — unpublished draft: "⚠ Unpublished draft" badge + `[ Publish v1.0... ]` button | `[ ]` |
| 2.0.5.25 | Header state 2 — published, no changes: active version badge + `[ Version history ]` button | `[ ]` |
| 2.0.5.26 | Header state 3 — draft has changes: "✏ Draft has changes" + `[ Discard changes ]` + `[ Publish as vX.0... ]` | `[ ]` |
| 2.0.5.27 | **Publish modal**: version label (auto), name field (required), description textarea, changes diff summary (added/modified/removed), confirmation warning | `[ ]` |
| 2.0.5.28 | **Version History drawer**: list of all versions with label, name, description, published date, run count, pass rate | `[ ]` |
| 2.0.5.29 | Version History: `[ View ]` button → opens snapshot in read-only test case editor | `[ ]` |
| 2.0.5.30 | Version History: `[ Compare ]` button → side-by-side diff panel with test case and step-level changes | `[ ]` |
| 2.0.5.31 | Version History: `[ Restore to draft ]` button → confirmation dialog → restores snapshot | `[ ]` |
| 2.0.5.32 | Run history table: add Version column showing `v2.0` badge; clicking badge opens read-only version snapshot | `[ ]` |
| 2.0.5.33 | Read-only version viewer: shows test cases and steps from snapshot; clearly labelled "Viewing v2.0 — read only" | `[ ]` |
| 2.0.5.34 | Component test: Publish modal validates name, shows diff, calls API on confirm | `[ ]` |
| 2.0.5.35 | Component test: Version History drawer renders all versions, view/compare/restore actions work | `[ ]` |
| 2.0.5.36 | Component test: header state machine — correct state shown based on draft-status API response | `[ ]` |

### 2.1 RBAC Enforcement

| # | Item | Status |
|---|------|--------|
| 2.1.1 | Create `@Roles(...)` decorator | `apps/api/src/common/decorators/roles.decorator.ts` | `[ ]` |
| 2.1.2 | Create `RolesGuard` — reads `@Roles()` metadata, checks `req.user.role` | `apps/api/src/common/guards/roles.guard.ts` | `[ ]` |
| 2.1.3 | Apply guards: DELETE project/test/environment = ADMIN only | Multiple controllers | `[ ]` |
| 2.1.4 | Apply guards: POST /ai/* = ENGINEER or ADMIN | `ai.controller.ts` | `[ ]` |
| 2.1.5 | Unit test: `RolesGuard` — correct roles pass, VIEWER denied | `[ ]` |

### 2.2 Run Filtering & Pagination

| # | Item | Status |
|---|------|--------|
| 2.2.1 | Add query params to `GET /projects/:id/runs`: `status`, `testId`, `envId`, `page`, `limit` | `runs.controller.ts` | `[ ]` |
| 2.2.2 | Update `RunsService.findByProject` to apply filters | `runs.service.ts` | `[ ]` |
| 2.2.3 | Add filter bar to `RunsPage` in web UI | `[ ]` |
| 2.2.4 | Unit test: filter by status, pagination boundaries | `[ ]` |

### 2.3 Artifact Path Security

| # | Item | Status |
|---|------|--------|
| 2.3.1 | Resolve paths with `path.resolve` and verify they start with `ARTIFACT_STORAGE_PATH` | `artifacts.service.ts` | `[ ]` |
| 2.3.2 | Unit test: path traversal attempt returns 403 | `[ ]` |

### 2.4 Audit Logging

| # | Item | Status |
|---|------|--------|
| 2.4.1 | Create `AuditService` with `log(userId, action, entity, entityId, before?, after?)` | `[ ]` |
| 2.4.2 | Inject `AuditService` into Projects, Tests, Environments, Runs controllers | `[ ]` |
| 2.4.3 | Add `GET /audit-logs` endpoint (ADMIN only, paginated) | `[ ]` |
| 2.4.4 | Integration test: create project, verify audit log entry | `[ ]` |

### 2.5 Missing Step Types (Worker)

| # | Item | Status |
|---|------|--------|
| 2.5.1 | `ASSERT_ELEMENT` — assert attribute value or count of elements | `step.runner.ts` | `[ ]` |
| 2.5.2 | `SCROLL` — scroll to element or by pixel offset | `step.runner.ts` | `[ ]` |
| 2.5.3 | `CUSTOM` — allow inline JS eval via `page.evaluate` (with safety note) | `step.runner.ts` | `[ ]` |
| 2.5.4 | Unit test each new step type | `[ ]` |

---

## Phase 3 — Real-time & UX Improvements

### 3.1 WebSocket / SSE for Live Run Updates

| # | Item | Status |
|---|------|--------|
| 3.1.1 | Add `@nestjs/websockets` + `socket.io` to API | `[ ]` |
| 3.1.2 | Create `RunsGateway` — emits `run:updated` event on run status change | `[ ]` |
| 3.1.3 | Update `RunExecutor` to publish events via Redis pub/sub → Gateway | `[ ]` |
| 3.1.4 | Install `socket.io-client` in web app | `[ ]` |
| 3.1.5 | Create `useRunSocket` hook — subscribes to `run:updated`, invalidates React Query cache | `[ ]` |
| 3.1.6 | Replace polling (`refetchInterval`) in `RunDetailPage` and `RunsPage` with socket | `[ ]` |
| 3.1.7 | Integration test: trigger run, assert WebSocket event received | `[ ]` |

### 3.2 Screenshot Viewer & Artifact Previews

| # | Item | Status |
|---|------|--------|
| 3.2.1 | Create `ScreenshotViewer` component — lightbox with prev/next navigation | `[ ]` |
| 3.2.2 | Show screenshots inline on `RunDetailPage` step rows | `[ ]` |
| 3.2.3 | Link trace artifacts to Playwright Trace Viewer URL | `[ ]` |
| 3.2.4 | Component test: `ScreenshotViewer` opens/closes, keyboard navigation | `[ ]` |

### 3.3 Analytics & Trend Charts

| # | Item | Status |
|---|------|--------|
| 3.3.1 | Add `GET /projects/:id/runs/trend` — returns daily pass/fail counts for last 30d | `[ ]` |
| 3.3.2 | Add `GET /projects/:id/runs/flaky` — tests with pass rate 20–80% | `[ ]` |
| 3.3.3 | Dashboard: replace placeholder stats with real `runs/stats` data | `[ ]` |
| 3.3.4 | Dashboard: add pass rate trend line chart (Recharts) | `[ ]` |
| 3.3.5 | Project detail: add per-test pass rate breakdown table | `[ ]` |
| 3.3.6 | Unit test: trend aggregation logic | `[ ]` |

### 3.3 Feature Test Player

See full spec: `docs/FEATURE_PLAYER.md`

**Backend**

| # | Item | Status |
|---|------|--------|
| 3.3.1 | Add `FeatureRun` model to schema (id, status, featureId, environmentId, triggeredById, timestamps) | `[ ]` |
| 3.3.2 | Add `FeatureRunStatus` enum: `IDLE RUNNING PAUSED COMPLETE CANCELLED` | `[ ]` |
| 3.3.3 | Link `TestRun.featureRunId` (nullable) so individual runs belong to a feature run | `[ ]` |
| 3.3.4 | Create `FeatureRunsModule` with `POST /features/:id/run`, `POST /feature-runs/:id/pause`, `POST /feature-runs/:id/resume`, `POST /feature-runs/:id/stop`, `GET /feature-runs/:id`, `GET /features/:id/runs` | `[ ]` |
| 3.3.5 | `FeatureRunService.start()` — creates FeatureRun, creates all TestRun records, enqueues first job | `[ ]` |
| 3.3.6 | `FeatureRunService.onRunComplete()` — called by worker on job finish, triggers AI feedback, enqueues next or stops | `[ ]` |
| 3.3.7 | Pause: set `FeatureRun.status = PAUSED` — worker will not enqueue next test until resumed | `[ ]` |
| 3.3.8 | Resume: set status back to RUNNING, enqueue next pending test | `[ ]` |
| 3.3.9 | Stop: set status to CANCELLED, mark remaining TestRuns as CANCELLED | `[ ]` |
| 3.3.10 | Unit test: start/pause/resume/stop state transitions | `[ ]` |
| 3.3.11 | Integration test: feature run completes all tests sequentially | `[ ]` |

**WebSocket Events**

| # | Item | Status |
|---|------|--------|
| 3.3.12 | Emit `featureRun:started` when FeatureRun begins | `[ ]` |
| 3.3.13 | Emit `run:started` when each TestRun begins | `[ ]` |
| 3.3.14 | Emit `step:completed` with latest screenshot path after each step | `[ ]` |
| 3.3.15 | Emit `run:completed` with status + AI feedback after each TestRun finishes | `[ ]` |
| 3.3.16 | Emit `featureRun:paused` when paused between tests | `[ ]` |
| 3.3.17 | Emit `featureRun:completed` with summary (passed, failed, duration) | `[ ]` |

**Frontend — Feature Page**

| # | Item | Status |
|---|------|--------|
| 3.3.18 | Create `FeaturePage` — split-pane layout (left: test list, right: player) | `[ ]` |
| 3.3.19 | Left panel: test case list with live status indicators (—, ⟳, ✓, ✗) | `[ ]` |
| 3.3.20 | Left panel: environment selector dropdown + Run All / Run Selected buttons | `[ ]` |
| 3.3.21 | Right panel: `TestPlayer` component with Play/Pause/Stop controls | `[ ]` |
| 3.3.22 | Right panel: `LiveScreenshot` — displays latest screenshot, updates on `step:completed` event | `[ ]` |
| 3.3.23 | Right panel: step progress bar for currently running test | `[ ]` |
| 3.3.24 | Right panel: `ResultFeed` — appends result card per test as `run:completed` fires | `[ ]` |
| 3.3.25 | Result card: test name, status badge, duration, AI feedback text | `[ ]` |
| 3.3.26 | Expandable result card: shows individual step rows | `[ ]` |
| 3.3.27 | Idle state: show most recent FeatureRun results in player panel | `[ ]` |
| 3.3.28 | Run history selector: browse previous FeatureRuns | `[ ]` |
| 3.3.29 | Create `useFeaturePlayer` hook — manages WebSocket subscription, player state machine | `[ ]` |
| 3.3.30 | Component test: TestPlayer controls, state transitions, result feed rendering | `[ ]` |
| 3.3.31 | Component test: LiveScreenshot updates on socket event | `[ ]` |

### 3.4 Live Test Viewer — Screencast Streaming

See full spec: `docs/LIVE_TEST_VIEWER.md`

**Worker — CDP Screencast**

| # | Item | Status |
|---|------|--------|
| 3.4.1 | Create `ScreencastService` in worker — wraps CDP `Page.startScreencast` / `Page.stopScreencast` | `[ ]` |
| 3.4.2 | On each `Page.screencastFrame` event: publish base64 JPEG to Redis channel `screencast:{featureRunId}` | `[ ]` |
| 3.4.3 | Call `Page.screencastFrameAck` after every publish to prevent CDP backpressure | `[ ]` |
| 3.4.4 | Integrate `ScreencastService.start()` into `FeatureRunnerService` after browser launch | `[ ]` |
| 3.4.5 | Integrate `ScreencastService.stop()` in finally block before `browser.close()` | `[ ]` |
| 3.4.6 | Add adaptive throttle: if Redis publish RTT > 200ms, increase `everyNthFrame` to 2 | `[ ]` |
| 3.4.7 | Add `SCREENCAST_ENABLED`, `SCREENCAST_QUALITY`, `SCREENCAST_MAX_WIDTH`, `SCREENCAST_MAX_HEIGHT` env vars | `[ ]` |
| 3.4.8 | Add `screencast` block to per-feature config (enabled, quality, maxWidth, maxHeight) | `[ ]` |
| 3.4.9 | Unit test: `ScreencastService` publishes frames, calls ack, stops cleanly | `[ ]` |

**API — WebSocket Gateway**

| # | Item | Status |
|---|------|--------|
| 3.4.10 | Create `ScreencastGateway` in `/screencast` namespace | `[ ]` |
| 3.4.11 | `watch:run` handler — join Socket.io room `run:{featureRunId}`, subscribe Redis channel (idempotent) | `[ ]` |
| 3.4.12 | On Redis message: emit `screencast:frame` (`{ data, timestamp, frameNumber }`) to room | `[ ]` |
| 3.4.13 | `unwatch:run` handler — leave room, clean up Redis subscriber if room is empty | `[ ]` |
| 3.4.14 | `handleDisconnect` — leave all rooms on client disconnect, clean up empty subscriptions | `[ ]` |
| 3.4.15 | Unit test: gateway subscribes once for N watchers, cleans up when last watcher leaves | `[ ]` |

**Frontend — LiveBrowserCanvas**

| # | Item | Status |
|---|------|--------|
| 3.4.16 | Create `LiveBrowserCanvas` component — `<canvas>` sized 1280×800, responsive via CSS | `[ ]` |
| 3.4.17 | Connect to `/screencast` Socket.io namespace, emit `watch:run` on mount | `[ ]` |
| 3.4.18 | On `screencast:frame`: create `Image`, set `src = data:image/jpeg;base64,...`, on load call `ctx.drawImage()` | `[ ]` |
| 3.4.19 | Emit `unwatch:run` and disconnect on unmount | `[ ]` |
| 3.4.20 | Replace `LiveScreenshot` (polling) in `FeaturePage` right panel with `LiveBrowserCanvas` | `[ ]` |
| 3.4.21 | Show placeholder skeleton when no active run (idle state) | `[ ]` |
| 3.4.22 | Component test: renders canvas, draws image on socket frame event | `[ ]` |

**Automated Mode — Failure Action Panel**

| # | Item | Status |
|---|------|--------|
| 3.4.23 | Add `SKIPPED` and `ABORTED` to `RunStepStatus` enum in Prisma schema | `[ ]` |
| 3.4.24 | Add `jiraIssueKey String?` to `RunStep` model | `[ ]` |
| 3.4.25 | Emit `step:failed` WebSocket event with step details + AI explanation when a step fails | `[ ]` |
| 3.4.26 | Create `StepFailurePanel` component — shown below canvas on `step:failed` event | `[ ]` |
| 3.4.27 | **Add Comment** action: inline text field → `PATCH /runs/:id/steps/:stepId` with `{ notes }`, then resume | `[ ]` |
| 3.4.28 | **Skip Step** action: `POST /runs/:runId/steps/:stepId/skip` → marks step `SKIPPED`, continues run | `[ ]` |
| 3.4.29 | **Skip Test** action: `POST /runs/:runId/skip` → marks TestRun `SKIPPED`, advances to next test | `[ ]` |
| 3.4.30 | **Retry Step** action: `POST /runs/:runId/steps/:stepId/retry` → re-attempts step (once) | `[ ]` |
| 3.4.31 | **Abort Run** action: `POST /feature-runs/:id/stop` → cancels FeatureRun | `[ ]` |
| 3.4.32 | **Create Jira Ticket** action: inline panel pre-populated with AI summary + screenshot attachment | `[ ]` |
| 3.4.33 | Jira creation: call Jira REST API `POST /rest/api/3/issue`, then `POST /attachments` with screenshot | `[ ]` |
| 3.4.34 | On Jira success: store issue key in `RunStep.jiraIssueKey`, show badge in step row | `[ ]` |
| 3.4.35 | **Notify Slack/Teams** action: immediately fire integration message with Block Kit / Adaptive Card payload | `[ ]` |
| 3.4.36 | Slack message includes: step name, failure reason, AI analysis, screenshot URL, run link | `[ ]` |
| 3.4.37 | Teams Adaptive Card includes same fields; "View Jira Ticket" action button if issue key present | `[ ]` |
| 3.4.38 | Unit test: `StepFailurePanel` renders all actions, each triggers correct API call | `[ ]` |
| 3.4.39 | Integration test: create Jira ticket from failure panel, assert `jiraIssueKey` stored on step | `[ ]` |

**Manual Mode — App Preview Panel**

> Manual mode has no Playwright running. The tester uses the real app. The left panel is a plain iframe.

| # | Item | Status |
|---|------|--------|
| 3.4.40 | Add `embedAllowed Boolean @default(true)` to `Environment` model | `[ ]` |
| 3.4.41 | Manual player layout: left panel = `<iframe src={baseUrl}>`, right panel = step checklist | `[ ]` |
| 3.4.42 | If `embedAllowed = false` (or iframe errors): show "Open app in new tab" button instead of iframe | `[ ]` |
| 3.4.43 | **Hide Preview** toggle: collapses left panel to zero width; preference saved to `localStorage` | `[ ]` |
| 3.4.44 | **Full Screen** mode: hides left panel entirely, step checklist fills full width | `[ ]` |
| 3.4.45 | Manual step failure actions: same **Add Comment**, **Skip Step**, **Next Test**, **Create Jira Ticket**, **Notify** as automated mode | `[ ]` |
| 3.4.46 | Screenshots uploaded by tester are attached to Jira ticket automatically if ticket created on same step | `[ ]` |
| 3.4.47 | Component test: manual player renders iframe + checklist, hide/show toggle works, "open in new tab" shown when `embedAllowed = false` | `[ ]` |

### 3.5 Analytics & Trend Charts

| # | Item | Status |
|---|------|--------|
| 3.5.1 | Add `GET /projects/:id/runs/trend` — returns daily pass/fail counts for last 30d | `[ ]` |
| 3.5.2 | Add `GET /projects/:id/runs/flaky` — tests with pass rate 20–80% | `[ ]` |
| 3.5.3 | Add `GET /features/:id/stats` — pass rate, avg duration, last run date | `[ ]` |
| 3.5.4 | Add `GET /modules/:id/stats` — aggregated across all features | `[ ]` |
| 3.5.5 | Dashboard: replace placeholder stats with real `runs/stats` data | `[ ]` |
| 3.5.6 | Dashboard: add pass rate trend line chart (Recharts) | `[ ]` |
| 3.5.7 | Module/Feature pages: show per-feature pass rate breakdown | `[ ]` |
| 3.5.8 | Unit test: trend aggregation logic, flaky detection | `[ ]` |

### 3.6 Settings Page

| # | Item | Status |
|---|------|--------|
| 3.6.1 | Add `/settings` route and `SettingsPage` | `[ ]` |
| 3.6.2 | Show current user profile (name, email, role) | `[ ]` |
| 3.6.3 | Change password form | `[ ]` |
| 3.6.4 | Add `PATCH /auth/me` and `PATCH /auth/me/password` endpoints | `[ ]` |
| 3.6.5 | Component test: settings form validation | `[ ]` |

---

## Phase 4 — Security Hardening

| # | Item | Status |
|---|------|--------|
| 4.1 | Add `@nestjs/throttler` rate limiting (global: 100 req/min, auth: 10 req/min) | `[ ]` |
| 4.2 | Add `helmet` for security headers | `[ ]` |
| 4.3 | Validate `baseUrl` in environments against allowlist or format | `[ ]` |
| 4.4 | Hash / mask environment `variables` values containing `password`, `secret`, `token` in API responses | `[ ]` |
| 4.5 | Ensure JWT secret is at least 32 chars — throw on startup if not | `[ ]` |
| 4.6 | Add `PATCH /projects/:id/environments/:id` header to not expose full JSON in responses | `[ ]` |
| 4.7 | Unit test: throttler blocks 11th auth request within 60s | `[ ]` |
| 4.8 | Unit test: masked secrets do not appear in GET environment response | `[ ]` |

---

## Phase 5 — Advanced Features

### §5.N — Stats Panels, Testing View & Full-Screen Player

> **Spec:** `docs/FEATURE_PLAYER.md`
> **Depends on:** Phase 3-A (WebSocket), Phase 3-C (Feature Player base), Phase 3-D (LiveBrowserCanvas), Phase 5-E (Manual testing)

**Stats Service**

| # | Item | Status |
|---|------|--------|
| 5.N.1 | `StatsService.computeFeatureStats(featureId)` — buckets each test case's latest completed run into passed/failed/skipped/outstanding; computes passRate and lastRunAt | `[ ]` |
| 5.N.2 | `StatsService.computeModuleStats(moduleId)` — aggregates computeFeatureStats across all child features | `[ ]` |
| 5.N.3 | Unit tests: computeFeatureStats returns correct buckets; outstanding = 0 runs; passRate null when no runs | `[ ]` |

**Stats API Endpoints**

| # | Item | Status |
|---|------|--------|
| 5.N.4 | `GET /api/v1/projects/:id/modules/stats` — returns `ModuleStats[]`, one per module in the project | `[ ]` |
| 5.N.5 | `GET /api/v1/modules/:id/features/stats` — returns `FeatureStats[]`, one per feature in the module | `[ ]` |
| 5.N.6 | `GET /api/v1/features/:id/stats` — returns single `FeatureStats` | `[ ]` |
| 5.N.7 | Add `?includeLatestRun=true` query param to `GET /api/v1/features/:id/test-cases` — joins latest completed run per test case | `[ ]` |
| 5.N.8 | `TestCaseWithStats` response DTO: id, name, type, stepsCount, updatedAt, latestRun.{status, duration, runAt} | `[ ]` |

**ModulesPage — stats strip**

| # | Item | Status |
|---|------|--------|
| 5.N.9 | Fetch `GET /projects/:id/modules/stats` alongside modules list; merge by moduleId | `[ ]` |
| 5.N.10 | Add stats strip to each module row: ✅ N passed ❌ N failed ⊘ N skipped ○ N outstanding, pass rate % | `[ ]` |
| 5.N.11 | Colour coding: pass rate green ≥80%, amber 50–79%, red <50%; outstanding in amber; "Not yet tested" if all outstanding | `[ ]` |

**FeaturesPage — stats strip + entry point**

| # | Item | Status |
|---|------|--------|
| 5.N.12 | Fetch `GET /modules/:id/features/stats` alongside features list; merge by featureId | `[ ]` |
| 5.N.13 | Add stats strip to each feature row: pass/fail/skip/outstanding counts + pass rate + "Last run X ago" | `[ ]` |
| 5.N.14 | `[Start Testing →]` button on each feature row (visible on hover on desktop, always on mobile); navigates to `/projects/:pId/features/:fId/test` | `[ ]` |

**FeaturePage — stat cards + test table + entry points**

| # | Item | Status |
|---|------|--------|
| 5.N.15 | Fetch `GET /features/:id/stats` on FeaturePage load; render 4 `StatCard` components (Passed, Failed, Skipped, Outstanding) below the feature header | `[ ]` |
| 5.N.16 | Pass rate card: mini progress bar + "Last run X ago" | `[ ]` |
| 5.N.17 | Clicking a stat card sets a `statusFilter` state that filters the test case table below | `[ ]` |
| 5.N.18 | Fetch test cases with `?includeLatestRun=true`; add Status and Duration columns to the test case table | `[ ]` |
| 5.N.19 | Row tinting: failed rows get `bg-red-50 dark:bg-red-950/20`; outstanding rows get `bg-amber-50 dark:bg-amber-950/20` | `[ ]` |
| 5.N.20 | Default table sort: failed first, then outstanding, then passed | `[ ]` |
| 5.N.21 | `[▶ Start Testing]` button in FeaturePage header action area; navigates to testing view | `[ ]` |
| 5.N.22 | `[▶ Test]` hover action on each test case row; navigates to `/test?testCaseId=:id` | `[ ]` |

**Testing View — routing**

| # | Item | Status |
|---|------|--------|
| 5.N.23 | Add `/projects/:projectId/features/:featureId/test` route in `App.tsx` **outside** the Shell wrapper (no sidebar/topnav) | `[ ]` |
| 5.N.24 | Wrap in `ProtectedRoute`; redirect to login if unauthenticated | `[ ]` |
| 5.N.25 | Accept optional `?testCaseId=:id` query param; pass to `TestingView` component | `[ ]` |

**TestingView — top action bar**

| # | Item | Status |
|---|------|--------|
| 5.N.26 | Top action bar: 56px tall, full width, `bg-gray-900 dark:bg-gray-950` | `[ ]` |
| 5.N.27 | Back link (`← {featureName}`) — navigates to FeaturePage; truncates name at 24 chars | `[ ]` |
| 5.N.28 | Environment selector dropdown — loads from `environmentsApi.list()`; persists last selection to localStorage | `[ ]` |
| 5.N.29 | Mode toggle: `[Manual]` `[Automated]` pill buttons; selected = white bg, inactive = ghost; disabled while run active | `[ ]` |
| 5.N.30 | Automated idle controls: `[▶ Start All]` and `[▶ Start Selected]` (if testCaseId param present) | `[ ]` |
| 5.N.31 | Automated running controls: `[⏸ Pause]` + `[⏹ Stop]` | `[ ]` |
| 5.N.32 | Automated paused controls: `[▶ Resume]` + `[⏹ Stop]` | `[ ]` |
| 5.N.33 | Automated complete controls: `[↺ Re-run]` + `[↺ Re-run Failed]` (if failures) | `[ ]` |
| 5.N.34 | Manual idle: `[▶ Start Manual Session]` | `[ ]` |
| 5.N.35 | Manual active: `[■ End Session]` | `[ ]` |
| 5.N.36 | Status indicator text: "Ready" / "Running — Test 2 of 6" / "Paused" / "Complete — 5/6 passed" — updates via socket events | `[ ]` |
| 5.N.37 | `[✕]` close button: if run active shows confirmation "Stop run and close?"; otherwise closes immediately | `[ ]` |

**TestingView — two-pane layout**

| # | Item | Status |
|---|------|--------|
| 5.N.38 | Two-column layout: left panel (fixed width) + right panel (flex-1) filling remaining viewport height below action bar | `[ ]` |
| 5.N.39 | Drag-resize handle: 4px-wide vertical bar between panels; cursor `col-resize` on hover | `[ ]` |
| 5.N.40 | Left panel width: default 320px, min 220px, max 520px; drag updates width in real time | `[ ]` |
| 5.N.41 | Persist left panel width to `localStorage` key `testing-view-left-width` | `[ ]` |

**TestingView — left panel**

| # | Item | Status |
|---|------|--------|
| 5.N.42 | Panel header: "Test Cases (N)" with live stat mini-strip (✅N ❌N ○N) | `[ ]` |
| 5.N.43 | Collapsed test row: status icon + index + name (truncated) + last-run duration | `[ ]` |
| 5.N.44 | Row tinting: failed = subtle red bg, outstanding = subtle amber bg | `[ ]` |
| 5.N.45 | Clicking row selects it; previously selected row collapses | `[ ]` |
| 5.N.46 | `testCaseId` query param pre-selects and expands the matching row on mount | `[ ]` |
| 5.N.47 | Automated expanded row: step list with ✅/❌/⟳/○/⊘ per step, duration right-aligned, error message on failed step | `[ ]` |
| 5.N.48 | Step progress counter ("Step 3 / 6 — Click submit button") and progress bar inside expanded row | `[ ]` |
| 5.N.49 | Step counter and progress bar update in real time via `runStep:running` + `runStep:completed` socket events | `[ ]` |
| 5.N.50 | List auto-scrolls to keep active test case (⟳ running) in view | `[ ]` |
| 5.N.51 | Manual expanded row: render step checklist inline — step type badge, name, instruction text, notes textarea, screenshot upload, Pass/Fail buttons (reuse ManualPlayer step UI) | `[ ]` |

**TestingView — right panel (automated)**

| # | Item | Status |
|---|------|--------|
| 5.N.52 | Automated mode: render `LiveBrowserCanvas` filling right panel completely (`w-full h-full`) | `[ ]` |
| 5.N.53 | Idle state: if latest run exists show last screenshot; otherwise show empty state (monitor icon + "Start a run to see live output") | `[ ]` |
| 5.N.54 | `StepFailurePanel` renders as an overlay sliding up from the bottom of the right panel on step failure; canvas visible above | `[ ]` |
| 5.N.55 | Failure panel dismissed when step is skipped, retried, or run is aborted | `[ ]` |

**TestingView — right panel (manual)**

| # | Item | Status |
|---|------|--------|
| 5.N.56 | Manual mode: render app iframe filling right panel completely | `[ ]` |
| 5.N.57 | Iframe loads `environment.baseUrl` | `[ ]` |
| 5.N.58 | Reuse ManualPlayer iframe timeout (10s) and blocked detection logic — show same fallback states (timeout/blocked with "Open in New Tab" + "Retry Preview") | `[ ]` |
| 5.N.59 | "Open in New Tab" icon link in top-right corner of iframe area (always visible) | `[ ]` |

**TestingView — socket subscriptions**

| # | Item | Status |
|---|------|--------|
| 5.N.60 | Subscribe to `testRun:started` → expand active test row; set status icon to ⟳ | `[ ]` |
| 5.N.61 | Subscribe to `runStep:running` → update step row to ⟳; update step counter + progress bar | `[ ]` |
| 5.N.62 | Subscribe to `runStep:completed` → update step row to ✅ or ❌; advance progress | `[ ]` |
| 5.N.63 | Subscribe to `testRun:completed` → collapse active row; show result; auto-expand next pending test; update panel header stats | `[ ]` |
| 5.N.64 | Subscribe to `featureRun:completed` → update top bar status; switch controls to re-run state | `[ ]` |

**Keyboard shortcuts**

| # | Item | Status |
|---|------|--------|
| 5.N.65 | `Space` — play/pause automated run | `[ ]` |
| 5.N.66 | `Escape` — close testing view (with confirmation if run active) | `[ ]` |
| 5.N.67 | `↑` / `↓` — navigate test case list (change selected test) | `[ ]` |
| 5.N.68 | `P` / `F` — mark current step Passed / Failed (manual mode only) | `[ ]` |

---

### 5.0 Test Suite Export & Import

Export and import test suites at every level of the hierarchy. Export format is a portable JSON file that can be shared, version-controlled, or imported into another project or platform instance.

See full spec: `docs/EXPORT_IMPORT.md`

**Export levels:**

| Level | What is exported | Endpoint |
|-------|-----------------|----------|
| Project | All modules + features + test cases | `GET /projects/:id/export` |
| Module | All features + test cases within | `GET /modules/:id/export` |
| Feature | All test cases within | `GET /features/:id/export` |
| Test Case | Single test definition | `GET /tests/:id/export` |

**5.0.1 — Backend: Export**

| # | Item | Status |
|---|------|--------|
| 5.0.1.1 | `GET /projects/:id/export?format=json` — exports full project hierarchy as JSON file download | `[ ]` |
| 5.0.1.2 | `GET /modules/:id/export?format=json` — exports module with all nested features and test cases | `[ ]` |
| 5.0.1.3 | `GET /features/:id/export?format=json` — exports feature with all test cases | `[ ]` |
| 5.0.1.4 | `GET /tests/:id/export?format=json` — exports single test case | `[ ]` |
| 5.0.1.5 | `ExportService.buildProjectExport(id)` — recursively assembles full hierarchy into export schema | `[ ]` |
| 5.0.1.6 | All export endpoints set `Content-Disposition: attachment; filename="<name>-export.json"` | `[ ]` |
| 5.0.1.7 | Export includes metadata: `version`, `exportedAt`, `exportType`, `platformVersion` | `[ ]` |
| 5.0.1.8 | Unit test: project export contains correct nested structure | `[ ]` |
| 5.0.1.9 | Unit test: feature export only contains its own test cases | `[ ]` |

**5.0.2 — Backend: Import**

| # | Item | Status |
|---|------|--------|
| 5.0.2.1 | `POST /projects/:id/import` — imports a project/module/feature/test export file into the target project | `[ ]` |
| 5.0.2.2 | `ImportService.detectType(payload)` — reads `exportType` field to determine import strategy | `[ ]` |
| 5.0.2.3 | Import strategy — `project` export: creates all modules, features, test cases under target project | `[ ]` |
| 5.0.2.4 | Import strategy — `module` export: creates module + features + test cases under target project | `[ ]` |
| 5.0.2.5 | Import strategy — `feature` export: creates feature + test cases under a specified module | `[ ]` |
| 5.0.2.6 | Import strategy — `testCase` export: creates test case under a specified feature | `[ ]` |
| 5.0.2.7 | Duplicate handling — if name already exists, append `(imported)` suffix, never overwrite | `[ ]` |
| 5.0.2.8 | Import runs inside a Prisma transaction — if any creation fails, entire import rolls back | `[ ]` |
| 5.0.2.9 | Version validation — reject import files with incompatible schema version, return clear error | `[ ]` |
| 5.0.2.10 | `POST /projects/:id/import` returns summary: `{ modulesCreated, featuresCreated, testCasesCreated, skipped[] }` | `[ ]` |
| 5.0.2.11 | Unit test: import project export, verify hierarchy created correctly | `[ ]` |
| 5.0.2.12 | Unit test: duplicate name gets suffix, not overwritten | `[ ]` |
| 5.0.2.13 | Unit test: invalid schema version returns 422 with message | `[ ]` |
| 5.0.2.14 | Integration test: export project → import into new project → verify parity | `[ ]` |

**5.0.3 — Frontend: Export**

| # | Item | Status |
|---|------|--------|
| 5.0.3.1 | Project page — "Export Project" button in project header actions menu | `[ ]` |
| 5.0.3.2 | Module page — "Export Module" button in module header actions menu | `[ ]` |
| 5.0.3.3 | Feature page — "Export Feature" button in feature header actions menu | `[ ]` |
| 5.0.3.4 | Test case editor/view — "Export Test" button in toolbar | `[ ]` |
| 5.0.3.5 | All export actions trigger file download directly in browser (no modal needed) | `[ ]` |
| 5.0.3.6 | Filename format: `{slug}-{level}-export-{YYYY-MM-DD}.json` | `[ ]` |

**5.0.4 — Frontend: Import**

| # | Item | Status |
|---|------|--------|
| 5.0.4.1 | Project page — "Import" button opens import modal | `[ ]` |
| 5.0.4.2 | Import modal — file picker (accepts `.json` only) + drag and drop | `[ ]` |
| 5.0.4.3 | Import modal — after file selected, show preview: export type, item counts, source name | `[ ]` |
| 5.0.4.4 | Import modal — for feature/test case imports, show target module/feature selector | `[ ]` |
| 5.0.4.5 | Import modal — "Import" button submits, shows result summary on success | `[ ]` |
| 5.0.4.6 | Import modal — shows error message clearly if validation fails | `[ ]` |
| 5.0.4.7 | On successful import, invalidate and refetch the affected project/module/feature queries | `[ ]` |
| 5.0.4.8 | Component test: import modal file selection, preview, submit, error states | `[ ]` |

### 5.1 Test Scheduling

| # | Item | Status |
|---|------|--------|
| 5.1.1 | Add `schedule` field to `TestDefinition` (cron string, nullable) | Prisma migration | `[ ]` |
| 5.1.2 | Create `SchedulerService` using `@nestjs/schedule` that polls active cron definitions | `[ ]` |
| 5.1.3 | `SchedulerService` triggers runs via `RunsService.trigger` with trigger=`scheduled` | `[ ]` |
| 5.1.4 | Add cron field to `TestEditorPage` in UI | `[ ]` |
| 5.1.5 | Unit test: cron expression parsing, next-run calculation | `[ ]` |

### 5.2 CI/CD Webhook Integration

| # | Item | Status |
|---|------|--------|
| 5.2.1 | Add `POST /projects/:id/webhooks/trigger` — accepts API key in header, queues run | `[ ]` |
| 5.2.2 | Generate and store per-project API key (hashed) | `[ ]` |
| 5.2.3 | Document webhook payload format in Swagger | `[ ]` |
| 5.2.4 | Integration test: webhook with valid/invalid key | `[ ]` |

### 5.3 Notifications, Integrations & Reporting

See full spec: `docs/NOTIFICATIONS_AND_INTEGRATIONS.md`

**5.3.1 — Project Membership & Roles**

| # | Item | Status |
|---|------|--------|
| 5.3.1.1 | Add `ProjectMember` model to schema: `{ projectId, userId, projectRole, timestamps }` with unique `[projectId, userId]` | `[ ]` |
| 5.3.1.2 | Add `ProjectRole` enum: `OWNER TECH_LEAD DEVELOPER QA_ENGINEER MANAGER` | `[ ]` |
| 5.3.1.3 | `GET/POST/PATCH/DELETE /projects/:id/members` endpoints (OWNER only to manage) | `[ ]` |
| 5.3.1.4 | UI: Project Settings → Team tab — add/remove members, assign project roles | `[ ]` |
| 5.3.1.5 | Unit test: non-OWNER cannot manage members | `[ ]` |

**5.3.2 — Integration Plugin Architecture** — ⚠️ **SUPERSEDED by §5.8** (unified plugin registry). The `ProjectIntegration` / `IntegrationPlugin` / `NotificationRule` design below is replaced by the manifest-based registry in `docs/PLUGIN_REGISTRY.md`. Skip this subsection during build — implement §5.8-A through §5.8-C first; `NotificationRule` is reintroduced in §5.3.8 as a thin consumer of the registry.

| # | Item | Status |
|---|------|--------|
| 5.3.2.1 | ~~Add `ProjectIntegration` model~~ → see §5.8-A (`OrgPluginInstall` + `ProjectPluginBinding`) | `[~]` superseded |
| 5.3.2.2 | ~~Add `IntegrationType` enum~~ → plugins are string-id'd in registry, not enum-bound | `[~]` superseded |
| 5.3.2.3 | Keep — `NotificationRule` reintroduced in §5.3.8 as thin consumer of the registry | `[ ]` |
| 5.3.2.4 | Keep — `NotificationTrigger` enum stays; triggers dispatch via `notify` capability | `[ ]` |
| 5.3.2.5 | ~~`IntegrationPlugin` interface~~ → see §5.8-A (manifest + capabilities) | `[~]` superseded |
| 5.3.2.6 | ~~`IntegrationService` enum dispatch~~ → see §5.8-A `PluginService.dispatch()` | `[~]` superseded |
| 5.3.2.7 | Encryption handled by generic `SecretsService` in §5.8-A | `[~]` superseded |
| 5.3.2.8 | `POST .../test` generalised as `POST /org/:orgId/plugin-installs/:id/test` in §5.8-A | `[~]` superseded |
| 5.3.2.9 | Registry contract test defined in §5.8-A | `[~]` superseded |

**5.3.3 — Email Plugin**

| # | Item | Status |
|---|------|--------|
| 5.3.3.1 | `EmailPlugin` implements `IntegrationPlugin` using nodemailer | `[ ]` |
| 5.3.3.2 | HTML email template: feature name, environment, date, per-test pass/fail table, AI summary, link to platform | `[ ]` |
| 5.3.3.3 | Subject line format: `[QA Platform] {feature} — {passed}/{total} passed · {project} · {env}` | `[ ]` |
| 5.3.3.4 | Recipients resolved from `notifyRoles` (project members) + `notifyUserIds` | `[ ]` |
| 5.3.3.5 | SMTP config in Admin Panel: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | `[ ]` |
| 5.3.3.6 | Unit test: email plugin generates correct HTML, resolves recipients from roles | `[ ]` |

**5.3.4 — Slack Plugin**

| # | Item | Status |
|---|------|--------|
| 5.3.4.1 | `SlackPlugin` POSTs formatted message to incoming webhook URL | `[ ]` |
| 5.3.4.2 | Message includes: feature, environment, pass/fail counts, failed step details, platform link | `[ ]` |
| 5.3.4.3 | Support `mentionOnFail` — adds `@user` mentions to the Slack message | `[ ]` |
| 5.3.4.4 | Unit test: Slack plugin builds correct payload | `[ ]` |

**5.3.5 — Microsoft Teams Plugin**

| # | Item | Status |
|---|------|--------|
| 5.3.5.1 | `TeamsPlugin` POSTs Adaptive Card to Teams incoming webhook URL | `[ ]` |
| 5.3.5.2 | Card shows: title, pass/fail counts, failed test list, action button → platform link | `[ ]` |
| 5.3.5.3 | Unit test: Teams plugin builds correct Adaptive Card JSON | `[ ]` |

**5.3.6 — Jira Plugin**

| # | Item | Status |
|---|------|--------|
| 5.3.6.1 | `JiraPlugin` uses Jira REST API v3 to create issues | `[ ]` |
| 5.3.6.2 | Issue fields: summary, description (with failed step + error + AI summary), type, priority, labels, assignee | `[ ]` |
| 5.3.6.3 | Attach screenshot to Jira issue as file attachment | `[ ]` |
| 5.3.6.4 | Priority derived from failure severity: all steps failed = High, partial = Medium | `[ ]` |
| 5.3.6.5 | `createTicket` returns `{ ticketUrl, ticketId }` — stored on the TestRun record | `[ ]` |
| 5.3.6.6 | Unit test: Jira plugin builds correct issue payload, assigns from project membership | `[ ]` |

**5.3.7 — Custom Webhook Plugin**

| # | Item | Status |
|---|------|--------|
| 5.3.7.1 | `WebhookPlugin` POSTs structured JSON payload to configured URL | `[ ]` |
| 5.3.7.2 | Auth types: `bearer`, `api_key` (custom header), `basic`, `hmac`, `none` | `[ ]` |
| 5.3.7.3 | HMAC signing: HMAC-SHA256 of request body, sent in `X-QA-Signature` header | `[ ]` |
| 5.3.7.4 | Payload includes: event type, project, module, feature, featureRun summary, failedTests[], passedTests[], screenshots (URLs or base64), AI summaries | `[ ]` |
| 5.3.7.5 | `includeScreenshotsAsBase64` option — for receivers that cannot reach the platform's artifact URLs | `[ ]` |
| 5.3.7.6 | Screenshot URLs in payload are signed with 24h expiry | `[ ]` |
| 5.3.7.7 | Configurable `timeout` (default 10s) and `retries` (default 2) per webhook | `[ ]` |
| 5.3.7.8 | Failed webhook delivery logged to `NotificationLog` with status + error | `[ ]` |
| 5.3.7.9 | Unit test: bearer/api_key/basic/hmac auth headers set correctly | `[ ]` |
| 5.3.7.10 | Unit test: payload contains correct failed step details + screenshots | `[ ]` |
| 5.3.7.11 | Integration test: webhook fires on `FEATURE_RUN_FAILED`, receiver gets correct payload | `[ ]` |

**5.3.8 — Notification Trigger Engine**

| # | Item | Status |
|---|------|--------|
| 5.3.8.1 | `NotificationEngine.fire(trigger, featureRunId)` — finds all active rules for trigger, calls correct plugin | `[ ]` |
| 5.3.8.2 | Hook into `FeatureRunService.onRunComplete()` — fires `FEATURE_RUN_COMPLETE` and `FEATURE_RUN_FAILED` triggers | `[ ]` |
| 5.3.8.3 | Hook into `FeatureRunService.onRunComplete()` per test — fires `TEST_CASE_FAILED` if individual test fails | `[ ]` |
| 5.3.8.4 | All notification delivery runs as BullMQ background job — never blocks the run flow | `[ ]` |
| 5.3.8.5 | Add `NotificationLog` model: `{ ruleId, integrationId, trigger, status (SENT/FAILED), error?, sentAt }` | `[ ]` |
| 5.3.8.6 | Unit test: engine fires correct plugins for each trigger type | `[ ]` |

**5.3.9 — Manual Triggers (Feature Player UI)**

| # | Item | Status |
|---|------|--------|
| 5.3.9.1 | After feature run completes, show action buttons: "Send Report", "Create Ticket", "Trigger Webhook" | `[ ]` |
| 5.3.9.2 | "Send Report" modal — select which Email/Slack/Teams integrations to send to | `[ ]` |
| 5.3.9.3 | "Create Ticket" modal — select Jira integration, shows pre-filled issue summary, confirm | `[ ]` |
| 5.3.9.4 | "Trigger Webhook" modal — select webhook integration, fires immediately | `[ ]` |
| 5.3.9.5 | `POST /feature-runs/:id/send-report`, `POST /feature-runs/:id/create-ticket`, `POST /feature-runs/:id/trigger-webhook` | `[ ]` |
| 5.3.9.6 | If no integrations configured, show "Set up integrations →" link instead of action buttons | `[ ]` |

**5.3.10 — Project Settings → Integrations UI**

| # | Item | Status |
|---|------|--------|
| 5.3.10.1 | Project Settings page with tabs: General, Team, Environments, Integrations, Repo Connection | `[ ]` |
| 5.3.10.2 | Integrations tab: list integrations with type badge, name, status, Rules/Edit/Test/Delete actions | `[ ]` |
| 5.3.10.3 | Add Integration modal: type selector → dynamic config form per type | `[ ]` |
| 5.3.10.4 | Notification Rules modal: trigger selector, role multi-select, user multi-select | `[ ]` |
| 5.3.10.5 | "Test" button per integration — fires sample payload, shows success/error response | `[ ]` |
| 5.3.10.6 | Secret fields (tokens, passwords) shown as `••••••` after save, never retrievable | `[ ]` |

### 5.4 Manual Testing Mode

See full spec: `docs/MANUAL_TESTING.md`

A test engineer or admin can step through test cases manually — verifying each test by hand and recording pass/fail with notes. The Feature Player shows a mode toggle between **Automated** and **Manual** at the top. In manual mode, the player does not execute Playwright — instead it walks the tester through each step as a checklist.

**Backend**

| # | Item | Status |
|---|------|--------|
| 5.4.1 | Add `RunMode` enum: `AUTOMATED` `MANUAL` | `[ ]` |
| 5.4.2 | Add `runMode` field to `TestRun` (default `AUTOMATED`) | `[ ]` |
| 5.4.3 | Add `manualNotes` field to `RunStep` — tester's free-text notes | `[ ]` |
| 5.4.4 | Manual run creation: `POST /features/:id/run` with `{ runMode: "MANUAL", environmentId }` — creates TestRun records with PENDING, no job enqueued | `[ ]` |
| 5.4.5 | `PATCH /runs/:id/steps/:stepId` — tester marks step PASSED or FAILED with optional notes and screenshot upload | `[ ]` |
| 5.4.6 | `POST /runs/:id/complete` — tester marks entire run complete, calculates final status | `[ ]` |
| 5.4.7 | Manual runs trigger the same notification rules as automated runs on completion | `[ ]` |
| 5.4.8 | Unit test: manual run does not enqueue a BullMQ job | `[ ]` |
| 5.4.9 | Unit test: marking all steps passed sets run status to PASSED | `[ ]` |

**Frontend**

| # | Item | Status |
|---|------|--------|
| 5.4.10 | Feature Player top bar: mode toggle `[ Automated ] [ Manual ]` | `[ ]` |
| 5.4.11 | Manual mode player: shows test case list on left — same as automated | `[ ]` |
| 5.4.12 | Manual mode right panel: step-by-step checklist for the active test — one step at a time | `[ ]` |
| 5.4.13 | Each step shows: step name, type, expected input/action in plain English | `[ ]` |
| 5.4.14 | Tester actions per step: `[ ✅ Pass ] [ ❌ Fail ]` buttons + optional notes text field | `[ ]` |
| 5.4.15 | Tester can upload a screenshot per step (evidence capture) | `[ ]` |
| 5.4.16 | Progress auto-advances to next step when current step is marked | `[ ]` |
| 5.4.17 | After all steps in a test case are marked: test is auto-completed, moves to next test case | `[ ]` |
| 5.4.18 | Manual runs show `MANUAL` badge in run history and run detail views | `[ ]` |
| 5.4.19 | Component test: step checklist advances correctly, pass/fail sets correct state | `[ ]` |

### 5.5 AI Exploratory Testing Mode

| # | Item | Status |
|---|------|--------|
| 5.4.1 | Design `ExploratorySession` model in Prisma | `[ ]` |
| 5.4.2 | Create `ExploratoryAgent` service — LangGraph-based loop: observe → act → report | `[ ]` |
| 5.4.3 | Playwright tool functions: screenshot, click, fill, navigate, getLinks, getContent | `[ ]` |
| 5.4.4 | Add `POST /projects/:id/explore` endpoint | `[ ]` |
| 5.4.5 | Add Exploratory Testing tab to UI | `[ ]` |
| 5.4.6 | Integration test: exploratory session starts, produces report | `[ ]` |

### 5.5 Codebase-Aware AI Test Generation (RAG)

Connect project source repos (GitHub, GitLab, Gitea, GitHub/GitLab Enterprise, local path).
AI indexes the codebase and uses it as context when generating tests — accurate selectors,
real routes, real field names from actual code. Multiple repos per project supported.

See full spec: `docs/CODEBASE_AWARE_TESTING.md`

**Implementation note (agreed architecture):**
- Primary context ingestion uses git clone/pull (`simple-git`) into local workspace + index.
- Provider APIs (GitHub/GitLab) are secondary: auth/repo metadata/branch listing and optional on-demand file fetch fallback.
- Avoid using provider file-content APIs as the default full-repo sync path.

**Recommended delivery order (fastest path to value):**
1. `5.5.1` RepoConnection + encrypted token storage + repo/branch endpoints
2. `5.5.2` IndexerService (`simple-git`, file filters, chunking, embeddings)
3. `5.5.3` RetrievalService + generate-tests endpoint with repo context
4. `5.5.4` Source Code settings UI (connect/sync/status)
5. `5.5.5.13` On-demand provider API fetch fallback for unindexed repos

**5.5.1 — Data Model & Repo Connection**

| # | Item | Status |
|---|------|--------|
| 5.5.1.1 | Add `RepoProvider` enum: `GITHUB GITLAB GITEA LOCAL` | `[ ]` |
| 5.5.1.2 | Add `RepoIndexStatus` enum: `PENDING INDEXING READY FAILED` | `[ ]` |
| 5.5.1.3 | Add `RepoConnection` model: projectId (non-unique — multiple repos per project), displayName, provider, baseUrl?, repoUrl?, repoOwner?, repoName?, defaultBranch, localPath?, accessToken (encrypted), webhookSecret?, includeGlobs[], excludeGlobs[], autoSync, status, chunkCount | `[ ]` |
| 5.5.1.4 | Add `CodeChunk` model: projectId, repoId, filePath, chunkIndex, content, embedding (pgvector `vector(1536)`) | `[ ]` |
| 5.5.1.5 | Enable `pgvector` PostgreSQL extension in migrations | `[ ]` |
| 5.5.1.6 | Add `REPO_TOKEN_SECRET` (AES-256 key) env var; encrypt/decrypt accessToken on read/write | `[ ]` |
| 5.5.1.7 | `GET/POST /projects/:id/repos` — list + create repo connections | `[ ]` |
| 5.5.1.8 | `PATCH /projects/:id/repos/:repoId` — update branch, globs, autoSync | `[ ]` |
| 5.5.1.9 | `DELETE /projects/:id/repos/:repoId` — disconnect + hard-delete all CodeChunks | `[ ]` |
| 5.5.1.10 | `POST /projects/:id/repos/:repoId/sync` — enqueue manual re-index BullMQ job | `[ ]` |
| 5.5.1.11 | `GET /projects/:id/repos/:repoId/branches` — list branches from provider API (used to populate dropdown) | `[ ]` |
| 5.5.1.12 | `POST /projects/:id/repos/:repoId/webhook` — push webhook receiver; verify HMAC (GitHub), token (GitLab/Gitea); enqueue re-index if push is to tracked branch | `[ ]` |
| 5.5.1.13 | GitHub OAuth for repo connection: `GET /auth/github-repo` + `/auth/github-repo/callback` (separate OAuth app from SSO login) | `[ ]` |
| 5.5.1.14 | GitLab OAuth for repo connection: `GET /auth/gitlab-repo` + `/auth/gitlab-repo/callback` | `[ ]` |
| 5.5.1.15 | PAT auth path (Gitea + self-hosted + optional for GitHub/GitLab): store token directly, skip OAuth | `[ ]` |
| 5.5.1.16 | Unit test: access token encrypted at rest, not returned in any API response | `[ ]` |
| 5.5.1.17 | Unit test: webhook HMAC verification rejects tampered payloads | `[ ]` |

**5.5.2 — Indexer Service**

| # | Item | Status |
|---|------|--------|
| 5.5.2.1 | Create `IndexerService` — BullMQ job processor for `index-repo` queue | `[ ]` |
| 5.5.2.2 | Clone/pull repo using `simple-git` with token-in-URL auth for cloud providers | `[ ]` |
| 5.5.2.3 | Local path: read directly from mounted filesystem (no clone needed) | `[ ]` |
| 5.5.2.4 | Walk file tree applying `includeGlobs` and `excludeGlobs` (use `fast-glob`) | `[ ]` |
| 5.5.2.5 | Hard-exclude regardless of user config: `**/.env*`, `**/*.key`, `**/secrets.*`, `**/credentials.*`, `**/*.pem` | `[ ]` |
| 5.5.2.6 | Chunking strategy: split at function/component boundaries; max 500 tokens; 50-token overlap | `[ ]` |
| 5.5.2.7 | Embed chunks in batches of 50 using configured AI provider's embedding model | `[ ]` |
| 5.5.2.8 | `OpenAI/Azure → text-embedding-3-small`; `Ollama → OLLAMA_EMBEDDING_MODEL env var`; `Anthropic → OpenAI fallback (Anthropic has no embedding API)` | `[ ]` |
| 5.5.2.9 | Upsert chunks: delete all existing chunks for `repoId`, bulk insert new ones | `[ ]` |
| 5.5.2.10 | Emit WebSocket progress event (`indexing:progress { repoId, processed, total }`) for live progress bar in UI | `[ ]` |
| 5.5.2.11 | On complete: set `status = READY`, `chunkCount`, `lastIndexedAt` | `[ ]` |
| 5.5.2.12 | On error: set `status = FAILED`, store error message | `[ ]` |
| 5.5.2.13 | Unit test: file filter excludes node_modules, dist, .env files | `[ ]` |
| 5.5.2.14 | Unit test: chunking respects max token size | `[ ]` |
| 5.5.2.15 | Integration test: index a sample local repo, verify correct chunk count and embeddings stored | `[ ]` |

**5.5.3 — RAG Retrieval & Test Generation**

| # | Item | Status |
|---|------|--------|
| 5.5.3.1 | `RetrievalService.findRelevantChunks(projectId, repoIds[], query, filePaths[], topK=15)` — embed query, vector search with optional path filter | `[ ]` |
| 5.5.3.2 | pgvector query: `ORDER BY embedding <-> $queryVector LIMIT 15` with `WHERE file_path LIKE ANY($pathFilters)` when hints provided | `[ ]` |
| 5.5.3.3 | `POST /features/:id/generate-tests` endpoint: accepts `{ prompt, repoIds, branch, filePaths?, testType, count }` | `[ ]` |
| 5.5.3.4 | Fetch code at specified branch (not default branch) for retrieval — re-clone or checkout if different from indexed branch | `[ ]` |
| 5.5.3.5 | Build AI prompt: system prompt + code context chunks + feature name + user description | `[ ]` |
| 5.5.3.6 | AI returns structured array of `TestDefinition` drafts; validate schema before returning to client | `[ ]` |
| 5.5.3.7 | Fall back to context-free generation if no repos connected or indexing not complete | `[ ]` |
| 5.5.3.8 | Unit test: retrieval returns most relevant chunks for a login-related query | `[ ]` |
| 5.5.3.9 | Unit test: path filter narrows results to specified directory | `[ ]` |
| 5.5.3.10 | Integration test: full generation flow — connect repo, index, generate, verify selectors match actual code | `[ ]` |

**5.5.4 — Project Settings UI (Source Code tab)**

| # | Item | Status |
|---|------|--------|
| 5.5.4.1 | Project Settings → Source Code tab: list of connected repos with status cards | `[ ]` |
| 5.5.4.2 | Status card shows: provider icon, displayName, repoUrl, defaultBranch, chunk count, last synced, live indexing progress bar | `[ ]` |
| 5.5.4.3 | **Connect Repository wizard** — Step 1: provider picker + optional custom base URL | `[ ]` |
| 5.5.4.4 | Wizard Step 2: OAuth button (GitHub/GitLab cloud) OR PAT input (all providers) | `[ ]` |
| 5.5.4.5 | Wizard Step 3: repo dropdown (populated via provider API after auth), branch dropdown, displayName, include/exclude glob config | `[ ]` |
| 5.5.4.6 | Wizard Step 3: auto-sync toggle + webhook URL + secret (with copy button) for setting up push hooks | `[ ]` |
| 5.5.4.7 | "Sync Now" button triggers manual re-index; card shows live progress via WebSocket | `[ ]` |
| 5.5.4.8 | "Disconnect" with confirmation dialog (warns that all indexed chunks will be deleted) | `[ ]` |
| 5.5.4.9 | Component test: wizard steps render, provider selection shows correct auth UI, repo dropdown populates | `[ ]` |

**5.5.5 — Feature: AI Generate Tests panel**

| # | Item | Status |
|---|------|--------|
| 5.5.5.1 | "✨ Generate Tests" button in feature page header (always shown; works with or without repo) | `[ ]` |
| 5.5.5.2 | Generate Tests side drawer: 4 inputs — description, repo selector, branch dropdown, file/folder hints textarea | `[ ]` |
| 5.5.5.3 | Repo selector: dropdown of all connected repos for the project + "Use all repos" option | `[ ]` |
| 5.5.5.4 | Branch dropdown: populated from `GET /projects/:id/repos/:repoId/branches` on repo selection | `[ ]` |
| 5.5.5.5 | File hints: multiline textarea, one path per line, placeholder shows example paths | `[ ]` |
| 5.5.5.6 | Test type selector (UI / API / Shell) and count picker (1–10) | `[ ]` |
| 5.5.5.7 | On generate: show skeleton loading state with "Reading code…" message | `[ ]` |
| 5.5.5.8 | Review panel: generated test cards with Accept / Discard / Edit / Regenerate (per card) actions | `[ ]` |
| 5.5.5.9 | Each card shows: test name, type, steps list, "context used" expandable (which files were retrieved) | `[ ]` |
| 5.5.5.10 | "Accept All & Save" and "Accept All & Save & Run ▶" bulk actions | `[ ]` |
| 5.5.5.11 | Accepted tests saved as `TestDefinition` with `isAiDraft: true` and `generatedFromFiles: string[]` (file paths used) | `[ ]` |
| 5.5.5.12 | "No repo connected" state: drawer still works but shows info banner ("Connect a repo for better accuracy") | `[ ]` |
| 5.5.5.13 | On-demand file fetch mode: checkbox in drawer to skip vector search and fetch listed files directly from GitHub/GitLab API; works on un-indexed repos | `[ ]` |
| 5.5.5.14 | Auto-feature ↔ code mapping: on drawer open, run vector search using feature name as query; pre-populate file hints with top 4 results (confidence ≥ 0.75); engineer can uncheck/add | `[ ]` |
| 5.5.5.15 | Component test: form validates required fields, branch dropdown loads on repo change, review panel actions | `[ ]` |

**5.5.6 — Org-Level Git Credentials**

| # | Item | Status |
|---|------|--------|
| 5.5.6.1 | Add `OrgGitProvider` enum: `GITHUB GITLAB GITEA` | `[ ]` |
| 5.5.6.2 | Add `OrgGitCredential` model: orgId, provider, baseUrl?, displayName, accessToken (encrypted), tokenType, oauthAccount?, scopes[], expiresAt?, createdById | `[ ]` |
| 5.5.6.3 | Add `orgCredentialId String?` to `RepoConnection` model; when set, indexer uses org token instead of project token | `[ ]` |
| 5.5.6.4 | Run Prisma migration | `[ ]` |
| 5.5.6.5 | `GET /organisations/:id/git-credentials` — list org credentials (ORG_ADMIN) | `[ ]` |
| 5.5.6.6 | `POST /organisations/:id/git-credentials` — create credential with PAT or OAuth start | `[ ]` |
| 5.5.6.7 | `PATCH /organisations/:id/git-credentials/:credId` — rotate token / update display name | `[ ]` |
| 5.5.6.8 | `DELETE /organisations/:id/git-credentials/:credId` — remove; warn if used by active project connections | `[ ]` |
| 5.5.6.9 | GitHub OAuth flow for org credential: `GET /auth/github-org` + `/auth/github-org/callback` (separate from repo OAuth and SSO) | `[ ]` |
| 5.5.6.10 | GitLab OAuth flow for org credential: `GET /auth/gitlab-org` + `/auth/gitlab-org/callback` | `[ ]` |
| 5.5.6.11 | Token expiry monitor: daily cron job checks `expiresAt`; email ORG_ADMIN 30 days before expiry; show banner in org settings | `[ ]` |
| 5.5.6.12 | Connect wizard Step 2: detect available org credentials for selected provider; show "Use org credential" option first; fall through to per-project auth if none available or user opts out | `[ ]` |
| 5.5.6.13 | Org Settings → Source Code tab: credential list with status cards (provider, auth type, used-by count, token status) | `[ ]` |
| 5.5.6.14 | Unit test: org credential token encrypted at rest; not returned in any API response | `[ ]` |
| 5.5.6.15 | Unit test: deleting an org credential used by projects returns 400 with list of affected projects | `[ ]` |

**5.5.7 — Advanced Intelligence Features**

| # | Item | Status |
|---|------|--------|
| 5.5.7.1 | `TestDefinition` — add `generatedFromFiles String[]` field (migration); populated on AI generation | `[ ]` |
| 5.5.7.2 | Change-aware test alerts: after re-index webhook, diff changed `CodeChunk` content; find `TestDefinition` records whose `generatedFromFiles` contains any changed file; set `codeChangedAt DateTime?` on those tests | `[ ]` |
| 5.5.7.3 | Feature page: amber `⚠ Code changed` badge on flagged tests; "Code changed — [Review] [Re-Generate] [Mark as OK]" action bar | `[ ]` |
| 5.5.7.4 | Project dashboard: "N tests may be outdated" alert card when any tests have `codeChangedAt != null` | `[ ]` |
| 5.5.7.5 | Smart Feature Discovery: `POST /projects/:id/repos/discover-features` — AI analyses indexed code_chunks, identifies page components + routes + API controllers, returns suggested features not yet in the project | `[ ]` |
| 5.5.7.6 | Feature Discovery UI: Project → AI Insights → "Coverage Gaps" tab: suggested feature cards with file evidence, "Create Feature →" one-click action pre-fills name + module + file hints | `[ ]` |
| 5.5.7.7 | Coverage Heat Map: `GET /projects/:id/repos/coverage` — cross-reference `code_chunks.filePath` against `test_definitions.generatedFromFiles`; return per-file coverage score | `[ ]` |
| 5.5.7.8 | Coverage Heat Map UI: Project → AI Insights → "Coverage Map" tab: file tree with colour coding (green = covered, amber = partial, red = none) + `[Generate →]` link per uncovered file | `[ ]` |
| 5.5.7.9 | Multi-repo cross-stack generation: when multiple repos selected in drawer, merge retrieved chunks from all repos and include all in AI prompt (ordered: frontend chunks, then API chunks, then shared-types chunks) | `[ ]` |
| 5.5.7.10 | Unit test: change detection flags correct tests when LoginForm.tsx changes but Header.tsx changes do not affect login tests | `[ ]` |
| 5.5.7.11 | Unit test: coverage map returns 0% for files with no matching generatedFromFiles entries | `[ ]` |
| 5.5.7.12 | Integration test: feature discovery on a real indexed repo returns structured suggestions with correct file evidence | `[ ]` |

### 5.6 AI Recommendation Engine

| # | Item | Status |
|---|------|--------|
| 5.5.1 | Add `GET /projects/:id/ai/recommendations` endpoint | `[ ]` |
| 5.5.2 | Analyze last 30 runs for flaky tests, recurring errors, untested flows | `[ ]` |
| 5.5.3 | Return structured recommendations: `{ type, severity, message, testId? }` | `[ ]` |
| 5.5.4 | Display recommendations on project dashboard | `[ ]` |
| 5.5.5 | Unit test: recommendation logic with seed data | `[ ]` |

### 5.7 Testing Phases & Progress Reports

See full spec: `docs/TESTING_PHASES_AND_REPORTS.md`

**Database & Phase Engine**

| # | Item | Status |
|---|------|--------|
| 5.7.1 | Add `ProjectPhase` model: projectId, name, description, order, color, autoPromote | `[ ]` |
| 5.7.2 | Add `PhaseRole` enum (`TESTER`, `MANAGER`, `VIEWER`) and `PhaseAssignment` model: phaseId, userId, role | `[ ]` |
| 5.7.3 | Add `PhaseStatus` enum (`PENDING`, `IN_PROGRESS`, `PASSED`, `FAILED`, `BLOCKED`, `SKIPPED`) | `[ ]` |
| 5.7.4 | Add `FeaturePhase` model: featureId, phaseId, status, startedAt, completedAt, promotedAt, promotedById, notes | `[ ]` |
| 5.7.5 | Add `ReportFrequency` enum (`DAILY`, `WEEKLY`, `MONTHLY`) and `PhaseReportSchedule` model: projectId, phaseId?, scope, scopeId?, name, frequency, sendTime, recipients, includeCharts | `[ ]` |
| 5.7.6 | Add `featurePhaseId String?` to `FeatureRun` — links each run to the phase it was executed in | `[ ]` |
| 5.7.7 | On project phase create: auto-create `FeaturePhase` PENDING records for all existing features | `[ ]` |
| 5.7.8 | On feature create: auto-create `FeaturePhase` PENDING records for all existing project phases | `[ ]` |
| 5.7.9 | `PhaseEngine.onFeatureRunComplete()` — check if all test cases in the active phase now pass; if yes, set `FeaturePhase.status = PASSED`; if `autoPromote = true`, trigger promotion | `[ ]` |
| 5.7.10 | `PhaseEngine.promote(featureId, phaseId)` — set current `FeaturePhase` status `PASSED`, open next phase `IN_PROGRESS`, notify new phase TESTERs | `[ ]` |
| 5.7.11 | `PhaseEngine.block(featureId, phaseId, reason)` — set `BLOCKED`, notify phase MANAGERs | `[ ]` |
| 5.7.12 | `PhaseEngine.unblock()` — return to `IN_PROGRESS` | `[ ]` |

**Phase API**

| # | Item | Status |
|---|------|--------|
| 5.7.13 | `GET/POST /projects/:id/phases` — list and create phases | `[ ]` |
| 5.7.14 | `PATCH /projects/:id/phases/:phaseId` — update name, order, color, autoPromote | `[ ]` |
| 5.7.15 | `DELETE /projects/:id/phases/:phaseId` — soft delete; preserve historical FeaturePhase records | `[ ]` |
| 5.7.16 | `PATCH /projects/:id/phases/reorder` — accept ordered array of phase IDs, update order values | `[ ]` |
| 5.7.17 | `POST/PATCH/DELETE /projects/:id/phases/:phaseId/users` — manage phase assignments | `[ ]` |
| 5.7.18 | `GET /features/:id/phases` — all FeaturePhase records with phase details and run counts | `[ ]` |
| 5.7.19 | `POST /features/:id/phases/:phaseId/start` — manually open a phase (MANAGER) | `[ ]` |
| 5.7.20 | `POST /features/:id/phases/:phaseId/promote` — promote to next phase (MANAGER) | `[ ]` |
| 5.7.21 | `POST /features/:id/phases/:phaseId/block` — block with reason (MANAGER) | `[ ]` |
| 5.7.22 | `POST /features/:id/phases/:phaseId/unblock` — unblock (MANAGER) | `[ ]` |
| 5.7.23 | `POST /features/:id/phases/:phaseId/skip` — skip this phase for this feature (MANAGER) | `[ ]` |
| 5.7.24 | `GET /modules/:id/phase-status` — all features with their current phase position and status | `[ ]` |
| 5.7.25 | Unit test: PhaseEngine — auto-promote triggers when all tests pass; block/unblock state transitions | `[ ]` |
| 5.7.26 | Integration test: full QA → auto-promote → UAT flow with test runs | `[ ]` |

**Report Generation**

| # | Item | Status |
|---|------|--------|
| 5.7.27 | Create `ReportService` — generates HTML report from feature/module/project/phase data | `[ ]` |
| 5.7.28 | Feature report template: phase summary, test case table with status/tester/date, blockers, previous phases | `[ ]` |
| 5.7.29 | Module report template: overview stats, phase breakdown table, per-feature status table, blockers | `[ ]` |
| 5.7.30 | Project report template: all modules, phase distribution, overall completion percentage | `[ ]` |
| 5.7.31 | `GET /features/:id/report?format=html|pdf` — generate and return report | `[ ]` |
| 5.7.32 | `GET /modules/:id/report?format=html|pdf&phase=:phaseId` — generate module report | `[ ]` |
| 5.7.33 | `GET /projects/:id/report?format=html|pdf` — generate project report | `[ ]` |
| 5.7.34 | PDF generation: use Puppeteer (`page.pdf()`) to convert rendered HTML report to PDF (reuse existing Playwright dep) | `[ ]` |
| 5.7.35 | `POST /projects/:id/report-schedules` — create scheduled report; store cron expression from frequency + day + time | `[ ]` |
| 5.7.36 | `GET/PATCH/DELETE /projects/:id/report-schedules/:id` — manage schedules | `[ ]` |
| 5.7.37 | `POST /projects/:id/report-schedules/:id/send` — send report now (manual trigger) | `[ ]` |
| 5.7.38 | BullMQ scheduled job: fire at configured time, generate report, email to recipients list | `[ ]` |
| 5.7.39 | Email template for scheduled report: inline HTML summary + PDF attachment | `[ ]` |
| 5.7.40 | Unit test: report HTML renders correctly with partial data (mid-cycle — not all tests passed) | `[ ]` |
| 5.7.41 | Unit test: PDF export produces a valid file with correct content | `[ ]` |
| 5.7.41a | Report generation criteria DTO: `environmentId?`, `includeSession?`, `includeFeature?`, `includeProject?`, `sessionId?`; enforce at least one include flag true | `[ ]` |
| 5.7.41b | Persist report metadata (`reportSections`, `environmentId`, `generatedById`, `generatedAt`) for report history and latest-report card | `[ ]` |
| 5.7.41c | Add report history endpoints: `GET /features/:id/reports`, `GET /modules/:id/reports`, `GET /projects/:id/reports`, `GET /reports/:reportId` | `[ ]` |
| 5.7.41d | Environment-aware report query layer: use selected environment when provided; fallback to current view/default; enforce RBAC environment access | `[ ]` |
| 5.7.41e | Build section composers in `ReportService`: `buildSessionSection`, `buildFeatureSection`, `buildProjectSection`; include only selected sections | `[ ]` |
| 5.7.41f | Add `ReportConfig` model (saved criteria preset) and `GeneratedReport` model (immutable generated snapshot) with relation `GeneratedReport.reportConfigId` | `[ ]` |
| 5.7.41g | `POST /projects/:id/report-configs` + `GET/PATCH/DELETE /projects/:id/report-configs/:configId` for reusable report setup management | `[ ]` |
| 5.7.41h | `POST /report-configs/:id/generate` creates new `GeneratedReport` snapshot from saved config criteria | `[ ]` |
| 5.7.41i | `POST /generated-reports/:id/regenerate` clones prior criteria (optional edits) and creates a new snapshot row; prior row remains immutable | `[ ]` |
| 5.7.41j | Report history table query (`GET /projects/:id/generated-reports`) returns latest-first list with criteria summary, generatedBy, generatedAt, artifact status | `[ ]` |

**Frontend**

| # | Item | Status |
|---|------|--------|
| 5.7.42 | Project Settings → Phases tab: phase list with drag-to-reorder, add/edit/delete | `[ ]` |
| 5.7.43 | Edit Phase modal: name, description, color, autoPromote toggle, user assignment table | `[ ]` |
| 5.7.44 | Project Settings → Reports tab: schedule list, new schedule modal | `[ ]` |
| 5.7.45 | Module page: add phase swimlane board view (features as cards in phase columns) | `[ ]` |
| 5.7.46 | Module page: "Progress Report" button → dropdown (View / Download PDF / Email now) | `[ ]` |
| 5.7.47 | Feature page: phase timeline strip below header (phases with status badges + dates) | `[ ]` |
| 5.7.48 | Feature page: "Promote to [next phase]" button visible to MANAGER when status = PASSED | `[ ]` |
| 5.7.49 | Feature page: "Block" / "Unblock" buttons with reason modal (MANAGER only) | `[ ]` |
| 5.7.50 | Feature page: "Progress Report" button with same dropdown | `[ ]` |
| 5.7.50a | Add `ReportBuilderModal` used by feature/module/project report actions with toggles: include session, feature summary, project summary | `[ ]` |
| 5.7.50b | Add environment selector to `ReportBuilderModal`; prefill from current page view context; allow switch before generation | `[ ]` |
| 5.7.50c | Add Reports summary card on Project/Module/Feature pages: `totalReports`, `latestReport`, CTA `[View Reports]` | `[ ]` |
| 5.7.50d | Add Reports list drawer/page with filters (type, environment, date range) and row actions (View, Download PDF, Email now, Regenerate) from generated snapshot rows | `[ ]` |
| 5.7.50e | Wire environment switch controls at project/module/feature level so report card + report generation respect active environment context | `[ ]` |
| 5.7.50f | Add Saved Report Configs panel (criteria presets) with actions: Create, Edit, Generate now, Delete | `[ ]` |
| 5.7.51 | **UAT tester view** — simplified shell (no sidebar, no project nav): "My UAT Tasks" landing page | `[ ]` |
| 5.7.52 | UAT task list: feature cards with completion progress, "Start Testing" / "Continue" CTA | `[ ]` |
| 5.7.53 | UAT feature view: manual checklist (reuse Manual Testing mode) with app iframe left panel | `[ ]` |
| 5.7.54 | When UAT tester completes all steps: auto-submit, update FeaturePhase progress | `[ ]` |
| 5.7.55 | Component test: phase settings — create phase, assign user, drag to reorder | `[ ]` |
| 5.7.56 | Component test: module board — features render in correct phase column, promote action fires | `[ ]` |
| 5.7.57 | Component test: UAT task list renders assigned features; completing checklist updates progress | `[ ]` |

**Project Phase Setup & Feature Creation Guard**

| # | Item | Status |
|---|------|--------|
| 5.7.58 | `FeaturesService.create()`: guard — return `400 Bad Request` if project has zero environments defined; include helpful message: "Add at least one environment in Project Settings before creating features" | `[ ]` |
| 5.7.59 | Project setup checklist (shown in project Overview when incomplete): Step 1 = Add an Environment, Step 2 = Configure Phases, Step 3 = Add Team Members, Step 4 = Create Your First Feature | `[ ]` |
| 5.7.60 | Feature creation modal: disable "Create Feature" button with tooltip if no env exists; link to "Add Environment →" | `[ ]` |
| 5.7.61 | Unit test: `FeaturesService.create()` throws `BadRequestException` when project has no environments | `[ ]` |

**Environment Access per Phase**

| # | Item | Status |
|---|------|--------|
| 5.7.66 | Add `environmentId String?` to `ProjectPhase` model (FK → Environment); migration | `[ ]` |
| 5.7.67 | Add `handoverRecipients String[]` to `ProjectPhase` model; migration | `[ ]` |
| 5.7.68 | Phase PATCH endpoint: accept `environmentId` and `handoverRecipients` fields | `[ ]` |
| 5.7.69 | `PhaseEngine`: when resolving environment for a run, prefer `phase.environmentId` over project default | `[ ]` |
| 5.7.70 | Edit Phase modal: environment dropdown + handover recipients input | `[ ]` |
| 5.7.71 | Unit test: run triggered within phase context uses phase environment, not project default | `[ ]` |

**Handover Report & Email**

| # | Item | Status |
|---|------|--------|
| 5.7.72 | Add `handoverSentTo String[]` and `handoverSentAt DateTime?` to `FeaturePhase` model; migration | `[ ]` |
| 5.7.73 | `HandoverReportService.resolveRecipients(phaseId, additionalEmails[])` — merge phase MANAGERs + `ProjectPhase.handoverRecipients` + ad-hoc, deduplicate | `[ ]` |
| 5.7.74 | `HandoverReportService.buildHandoverData(featureId, fromPhaseId)` — collect completed phase stats, test case results, tester names, environment | `[ ]` |
| 5.7.75 | `HandoverReportService.sendHandoverEmail(featureId, toPhaseId, recipients, note?)` — render HTML template, attach Phase PDF, send via existing email service | `[ ]` |
| 5.7.76 | `PhaseEngine.promote()` — after status updates, call `HandoverReportService.sendHandoverEmail()` with resolved recipients; save result to `FeaturePhase.handoverSentTo` | `[ ]` |
| 5.7.77 | Promote modal UI: "Promote to [Phase]" confirmation modal with recipient list (phase MANAGERs pre-checked, additional multi-select input, optional note field) | `[ ]` |
| 5.7.78 | Promote modal: shows pre-populated recipients from `ProjectPhase.handoverRecipients`; allows adding extra ad-hoc emails at promotion time | `[ ]` |
| 5.7.79 | Handover email template: feature name, completed phase summary (test count, pass/fail, tester names, duration), environment details, "Open UAT Task" CTA button, PDF attachment | `[ ]` |
| 5.7.80 | Unit test: `HandoverReportService.resolveRecipients()` deduplicates correctly; phase MANAGERs always included | `[ ]` |
| 5.7.81 | Unit test: handover email not sent if promoted phase has no MANAGERs and no recipients configured (warn but don't error) | `[ ]` |

**Sign-off Flow**

| # | Item | Status |
|---|------|--------|
| 5.7.82 | Add `FeatureSignOff` model: featureId (unique), signedOffById, signedOffAt, message, notifiedEmails | `[ ]` |
| 5.7.83 | `PhaseEngine.onFeaturePhasePass()` — when last phase passes, emit `feature.all_phases_passed` event; feature page receives this via WebSocket | `[ ]` |
| 5.7.84 | `POST /features/:id/sign-off` — create `FeatureSignOff` record; body: `{ message?, additionalRecipients? }` (MANAGER / project OWNER) | `[ ]` |
| 5.7.85 | `GET /features/:id/sign-off` — return sign-off record or 404 | `[ ]` |
| 5.7.86 | `DELETE /features/:id/sign-off` — revoke sign-off (ORG_ADMIN only); returns feature to last phase IN_PROGRESS | `[ ]` |
| 5.7.87 | `SignOffService.resolveRecipients()` — project OWNER + all phase MANAGERs (all phases) + all phase TESTERs (final phase) + ad-hoc | `[ ]` |
| 5.7.88 | `SignOffService.sendSignOffEmail(featureId, record)` — render sign-off email template, attach full project phase report PDF, send to resolved recipients | `[ ]` |
| 5.7.89 | Sign-off notification email template: feature/module/project header, all phase summary rows, approver message, "View Feature" CTA button | `[ ]` |
| 5.7.90 | Feature page: "All phases complete" banner shown when `feature.all_phases_passed` event received; "Sign Off Feature →" CTA | `[ ]` |
| 5.7.91 | Sign-off modal: phase summary table, message textarea, recipient checklist (pre-populated, editable), "Confirm Sign-off ✅" button | `[ ]` |
| 5.7.92 | Feature page header: show "✅ Signed Off — [date] by [name]" badge once `FeatureSignOff` record exists | `[ ]` |
| 5.7.93 | If a next phase IS configured after the final signed-off phase: `PhaseEngine.promote()` auto-called after sign-off (auto-phase switching) | `[ ]` |
| 5.7.94 | Project dashboard: "Signed Off" count stat card; click filters feature list to signed-off features | `[ ]` |
| 5.7.95 | Unit test: sign-off endpoint returns 403 if caller is not MANAGER or OWNER | `[ ]` |
| 5.7.96 | Unit test: sign-off sends email to resolved recipient list; `notifiedEmails` field matches | `[ ]` |
| 5.7.97 | Unit test: revoke sign-off returns feature phase to IN_PROGRESS on the final phase | `[ ]` |
| 5.7.98 | Integration test: full QA → UAT → sign-off flow; sign-off email contains all three phase summaries | `[ ]` |

**Phase-Scoped Visibility (Frontend)**

| # | Item | Status |
|---|------|--------|
| 5.7.99 | `/me/phase-tasks` endpoint — return all features where current user is assigned as TESTER, grouped by project and phase, with FeaturePhase status | `[ ]` |
| 5.7.100 | UAT tester simplified view: when user has NO full project member role but IS a phase TESTER — show "My Tasks" shell (no sidebar, no project nav) | `[ ]` |
| 5.7.101 | "My UAT Tasks" empty state: show informative message + read-only "Upcoming (in QA)" feature status cards when no features are in user's assigned phase | `[ ]` |
| 5.7.102 | "Upcoming" cards show phase name, QA progress (`3/5 tests passed`), but no testing action buttons | `[ ]` |
| 5.7.103 | "All done" completion state: shown when user has no remaining tasks in their phase; shows completed feature list with timestamps | `[ ]` |
| 5.7.104 | Full project member view: non-phase-TESTER project members see features in all phases; test action buttons disabled on phases they're not assigned to (greyed out with tooltip "Not assigned to this phase") | `[ ]` |
| 5.7.105 | Component test: empty state renders with correct "Upcoming" cards when 0 features in user phase | `[ ]` |
| 5.7.106 | Component test: "All done" state renders after all features pass | `[ ]` |

---

### 5.8 Plugin Registry + ClickUp Integration (REFACTOR)

> **Specs (read first):**
> - `docs/PLUGIN_REGISTRY.md` — unified plugin architecture (foundation)
> - `docs/PM_INTEGRATIONS.md` — ClickUp-specific implementation
> - `docs/JIRA_INTEGRATION.md` — Jira plugin implementation plan
> - `docs/FEATURE_PLAYER.md` §10.6 — doc pill in Testing View
> - `docs/EXPLORATORY_TESTING.md` §9.2.1 — Convert-to-ticket flow consumer
>
> **This section supersedes §5.3.2.** The old `ProjectIntegration` + `IntegrationPlugin` design is replaced by a unified manifest-based registry. Build §5.8-A through §5.8-C before any other plugin work.
>
> **Depends on:** Phase 3-A (Socket.io), Phase 5.7 (Phase engine for syncPhaseStatus consumer). **Does not block:** Phase 5 can proceed in parallel on other sections.

---

#### §5.8-A — Plugin Registry Core (Foundation)

**Data model — Prisma schema refactor**

| # | Item | Status |
|---|------|--------|
| 5.8-A.1 | Create migration `20260422000000_plugin_registry_refactor` that drops old tables: `org_plugins`, `project_plugin_configs`, `project_plugin_status_mappings`, `feature_ticket_links`; drops `OrgPluginType`, `TicketLinkType` enums | `[ ]` |
| 5.8-A.2 | Remove obsolete columns from `issues`: `externalTicketId`, `externalTicketUrl`, `externalSystem`, `pushedExternallyAt` (moved into `TicketLink` via `issueId`) | `[ ]` |
| 5.8-A.3 | Add `OrgPluginInstall` model per `PLUGIN_REGISTRY.md` §4.1 — fields: orgId, pluginId, pluginVersion, displayLabel, isEnabled, config (Json), secretsCiphertext (Bytes), secretsKeyId, lastHealthOk/At/Error, installedById; `@@unique([orgId, pluginId, displayLabel])` | `[ ]` |
| 5.8-A.4 | Add `ProjectPluginBinding` model — fields: orgId, projectId, installId, bindingConfig (Json), enabledCapabilities (String[]); `@@unique([projectId, installId])` | `[ ]` |
| 5.8-A.5 | Add `ModulePluginBinding` model — fields: moduleId, installId, bindingConfig (Json); `@@unique([moduleId, installId])` | `[ ]` |
| 5.8-A.6 | Add `FeaturePluginBinding` model — fields: featureId, installId, bindingConfig (Json); `@@unique([featureId, installId])` | `[ ]` |
| 5.8-A.7 | Add `PluginStatusMapping` model — fields: bindingId, platformPhase (String), externalStatus (String); `@@unique([bindingId, platformPhase])` | `[ ]` |
| 5.8-A.8 | Add `TicketLink` model — fields: orgId, installId, one-of (featureId/moduleId/projectId/findingId/issueId), externalId, externalUrl, externalTitle, externalStatus, lastSyncedAt; `@@unique([installId, externalId, featureId])` | `[ ]` |
| 5.8-A.9 | Add `DocLink` model — fields: orgId, installId, nullable (projectId, moduleId, featureId — all three can be set), externalId, externalUrl, title, summary, cachedMarkdown (Json), cachedAt, cacheExpiresAt | `[ ]` |
| 5.8-A.10 | Add `PluginWebhookEndpoint` model — fields: installId, path @unique, signingSecret, isActive, lastCalledAt | `[ ]` |
| 5.8-A.11 | Run `pnpm db:migrate` + `pnpm db:generate`; verify Prisma client regenerates and TypeScript compiles | `[ ]` |

**Core types & registry**

| # | Item | Status |
|---|------|--------|
| 5.8-A.12 | Create `apps/api/src/plugins/types.ts` — `PluginManifest<Config, Secrets>`, `PluginCapability`, `PluginLifecycle`, `PluginCtx`, `HealthResult`, `FieldHint` per spec §3 | `[ ]` |
| 5.8-A.13 | Create `apps/api/src/plugins/capabilities/types.ts` — `NotifyPayload`, `CreateIssuePayload`, `Attachment`, `IssueRef`, `TicketRef`, `TicketContext`, `DocSummary`, `DocContent`, `LogTimePayload` per spec §2.1 | `[ ]` |
| 5.8-A.14 | Create `apps/api/src/plugins/errors.ts` — `PluginNotFoundError`, `CapabilityNotSupportedError`, `BindingConfigError`, `PluginTransientError`, `PluginPermanentError`, `PluginProtocolError`, `SecretDecryptionError` | `[ ]` |
| 5.8-A.15 | Create `apps/api/src/plugins/registry.ts` — `pluginRegistry: Record<string, PluginManifest>`, `getPlugin(id)`, `listPluginsByCapability(cap)` | `[ ]` |
| 5.8-A.16 | Unit test: `getPlugin('unknown')` throws `PluginNotFoundError`; `listPluginsByCapability('notify')` filters correctly | `[ ]` |

**Secrets service**

| # | Item | Status |
|---|------|--------|
| 5.8-A.17 | Create `apps/api/src/plugins/secrets.service.ts` — AES-256-GCM encrypt/decrypt with `SECRETS_KEK` env var; 12-byte random IV; 16-byte tag; format `iv ‖ tag ‖ ciphertext` | `[ ]` |
| 5.8-A.18 | `SecretsService.encrypt(plaintext: object, keyId: string): { ciphertext: Buffer, keyId }` | `[ ]` |
| 5.8-A.19 | `SecretsService.decrypt(ciphertext: Buffer, keyId: string): object` — throws `SecretDecryptionError` on tamper | `[ ]` |
| 5.8-A.20 | Support multiple keys via `SECRETS_KEKS` env (JSON `{ "v1": "...", "v2": "..." }`); writes use latest; reads look up by `secretsKeyId` | `[ ]` |
| 5.8-A.21 | Add `SECRETS_KEK` (default) + `SECRETS_KEKS` to `apps/api/.env.example` with doc comment | `[ ]` |
| 5.8-A.22 | Unit test: round-trip encrypt → decrypt returns original; tampered tag byte → throws | `[ ]` |
| 5.8-A.23 | Unit test: write with `v2` key, read with `v1`/`v2` both work during rotation window | `[ ]` |

**Effective config resolver**

| # | Item | Status |
|---|------|--------|
| 5.8-A.24 | Create `apps/api/src/plugins/effective-config.ts` — `resolveEffectiveConfig<T>(installId, { projectId, moduleId?, featureId? }): Promise<T>` | `[ ]` |
| 5.8-A.25 | Deep-merge order: plugin defaults (from manifest) → project binding → module binding → feature binding; `null`/`undefined` fields fall through to next level | `[ ]` |
| 5.8-A.26 | Unit test: feature override wins over module override wins over project binding wins over defaults | `[ ]` |
| 5.8-A.27 | Unit test: partial override (only `targetMode` at feature level) preserves inherited `targetListId` | `[ ]` |

**HTTP client with retry + rate-limit**

| # | Item | Status |
|---|------|--------|
| 5.8-A.28 | Create `apps/api/src/plugins/http-client.ts` — `buildHttpClient(pluginId, orgId): AxiosInstance` | `[ ]` |
| 5.8-A.29 | Retry middleware: exponential backoff 250ms → 1s → 4s; max 3 attempts; only retry on 5xx + network errors | `[ ]` |
| 5.8-A.30 | Rate-limit middleware: Redis token-bucket keyed `plugin:ratelimit:{pluginId}:{orgId}`; respects `Retry-After` on 429 | `[ ]` |
| 5.8-A.31 | Logging middleware: logs method + url + status + duration; redacts `Authorization` header | `[ ]` |
| 5.8-A.32 | Unit test: retries transient 500 twice then succeeds; non-retryable 4xx bubbles immediately | `[ ]` |
| 5.8-A.33 | Unit test: 429 with `Retry-After: 2` waits 2s and retries once | `[ ]` |

**EnablementService — the four-level guard**

| # | Item | Status |
|---|------|--------|
| 5.8-A.33a | Create `apps/api/src/plugins/enablement.service.ts` with `getEnabledInstalls(projectId, capability, pluginId?)`, `isCapabilityEnabled(...)`, `requireEnabled(...)` per `PLUGIN_REGISTRY.md` §4.5.3 | `[ ]` |
| 5.8-A.33b | Guard checks all four levels in order: (1) `OrgPluginInstall.isEnabled + !deletedAt + lastHealthOk`, (2) `ProjectPluginBinding` exists + not deleted, (3) capability in `enabledCapabilities[]`, (4) capability-specific config validator | `[ ]` |
| 5.8-A.33c | Create `validateCapabilityConfig(capability, pluginId, effectiveConfig)` — per-capability matrix per spec §4.5.2 (e.g. `createIssue` requires `targetListId`; `webhookListener` requires `externalWebhookId`) | `[ ]` |
| 5.8-A.33d | Create typed error `PluginNotEnabledError(pluginId, capability, projectId)` in `apps/api/src/plugins/errors.ts` | `[ ]` |
| 5.8-A.33e | Map `PluginNotEnabledError` to HTTP 404 in global exception filter (don't leak plugin existence to non-enabled users) | `[ ]` |
| 5.8-A.33f | `GET /api/v1/plugins/enabled?projectId=&capability=&pluginId=` endpoint returns enabled installs for frontend hooks; includes effective config (secrets masked) | `[ ]` |
| 5.8-A.33g | React hook `usePluginCapability(capability, scope, pluginId?)` in `apps/web/src/hooks/` — returns `{ enabled, installs, loading }`; backed by React Query 30s cache | `[ ]` |
| 5.8-A.33h | Unit test: level 1 fail (install disabled) → guard returns false | `[ ]` |
| 5.8-A.33i | Unit test: level 2 fail (no binding) → guard returns false | `[ ]` |
| 5.8-A.33j | Unit test: level 3 fail (capability not in enabledCapabilities) → guard returns false | `[ ]` |
| 5.8-A.33k | Unit test: level 4 fail (createIssue with no targetListId) → guard returns false | `[ ]` |
| 5.8-A.33l | Unit test: all four levels pass → guard returns true with correct `EnabledInstall` shape | `[ ]` |

**Consumption — wiring the guard into every layer**

| # | Item | Status |
|---|------|--------|
| 5.8-A.33m | `PluginService.dispatch()` internally calls `EnablementService.requireEnabled()` first — any disabled plugin dispatch throws typed error | `[ ]` |
| 5.8-A.33n | Every capability-backed REST controller method calls `enablement.requireEnabled(projectId, capability, pluginId)` at the top | `[ ]` |
| 5.8-A.33o | Every BullMQ processor (`bulk-refresh-tickets`, `plugin-sync-phase`, webhook receiver, etc.) **re-checks** enablement at job execution time, not scheduling time; logs + no-ops on disabled | `[ ]` |
| 5.8-A.33p | `plugin-health-check` cron is the ONE exception — runs for disabled installs too (so token recovery is detected), but only writes state, no downstream actions | `[ ]` |
| 5.8-A.33q | Notification builder (`NotificationService.create`) short-circuits plugin-related notification types (`TICKET_STATUS_*`, `PLUGIN_*`) when plugin is disabled — belt-and-braces defence | `[ ]` |
| 5.8-A.33r | Webhook receiver short-circuits with `WebhookEvent.result = 'ignored-plugin-disabled'` when install disabled between registration and delivery | `[ ]` |
| 5.8-A.33s | `TicketStatusSuggestion` pending rows auto-dismissed with `reason='PLUGIN_DISABLED'` when plugin uninstalled or disabled | `[ ]` |

**Data retention — linked data survives disable**

| # | Item | Status |
|---|------|--------|
| 5.8-A.33t | `TicketLink` rows retained on plugin disable/uninstall; UI marks as "offline — ClickUp disabled" with cached last-known external status visible but Refresh button hidden | `[ ]` |
| 5.8-A.33u | `DocLink` rows retained on disable; cached markdown still renders; Refresh disabled with tooltip explaining why | `[ ]` |
| 5.8-A.33v | Amber "ClickUp offline" banner surfaces on any page that would have shown plugin features when `lastHealthOk=false`; includes `[Reconfigure]` CTA to admin UI | `[ ]` |
| 5.8-A.33w | Integration test: disable plugin mid-flight → in-flight webhook deliveries short-circuit without side effects; bulk refresh job no-ops gracefully | `[ ]` |

**PluginService**

| # | Item | Status |
|---|------|--------|
| 5.8-A.34 | Create `apps/api/src/plugins/plugin.service.ts` — methods: `install`, `update`, `uninstall`, `healthCheck`, `dispatch<T>(args)` | `[ ]` |
| 5.8-A.35 | `install(orgId, pluginId, config, secrets, installedById)`: Zod-validate `config` via `plugin.configSchema`, `secrets` via `plugin.secretsSchema`; encrypt; INSERT `OrgPluginInstall`; call `lifecycle.onEnable`; run `healthCheck`; return row | `[ ]` |
| 5.8-A.36 | `update(installId, patch)`: if `secrets` provided, re-encrypt; if `config` changed, call `lifecycle.onConfigChange(ctx, previous)`; audit log changed field names (never values) | `[ ]` |
| 5.8-A.37 | `uninstall(installId)`: call `lifecycle.onDisable`; overwrite `secretsCiphertext` with zeros; soft-delete; cascade soft-delete bindings | `[ ]` |
| 5.8-A.38 | `healthCheck(installId)`: decrypt secrets; build ctx; call `plugin.lifecycle.healthCheck(ctx)`; write `lastHealthOk/At/Error`; return result | `[ ]` |
| 5.8-A.39 | `dispatch<T>({ capability, installId, scope, payload })`: verify capability declared; decrypt secrets; resolve effective config; build ctx; call `plugin.implementations[capability]`; return typed result; write audit log | `[ ]` |
| 5.8-A.40 | Throws `CapabilityNotSupportedError` if plugin did not declare the capability | `[ ]` |
| 5.8-A.41 | Every dispatch wrapped in try/catch; typed errors propagate; unknown errors logged with request ctx (secrets redacted) | `[ ]` |
| 5.8-A.42 | Unit test: `dispatch` with unsupported capability throws typed error | `[ ]` |
| 5.8-A.43 | Unit test: `dispatch` resolves effective config; passes to implementation with merged shape | `[ ]` |

**REST API — org-level install**

| # | Item | Status |
|---|------|--------|
| 5.8-A.44 | `GET /api/v1/plugins` — list all plugins in registry (manifest only — no secrets, no install state) | `[ ]` |
| 5.8-A.45 | `GET /api/v1/plugins/:id` — single plugin manifest | `[ ]` |
| 5.8-A.46 | `GET /api/v1/orgs/:orgId/plugin-installs` — list installs for org; config returned, secrets masked as `{ __masked: true }` | `[ ]` |
| 5.8-A.47 | `POST /api/v1/orgs/:orgId/plugin-installs` — body: `{ pluginId, config, secrets, displayLabel? }`; ORG_ADMIN only | `[ ]` |
| 5.8-A.48 | `GET /api/v1/orgs/:orgId/plugin-installs/:id` — single install (secrets masked) | `[ ]` |
| 5.8-A.49 | `PATCH /api/v1/orgs/:orgId/plugin-installs/:id` — update config/secrets/isEnabled; ORG_ADMIN only; blank secret field = unchanged | `[ ]` |
| 5.8-A.50 | `DELETE /api/v1/orgs/:orgId/plugin-installs/:id` — soft-delete + zero secrets; ORG_ADMIN only | `[ ]` |
| 5.8-A.51 | `POST /api/v1/orgs/:orgId/plugin-installs/:id/health-check` — run on demand; return `HealthResult` | `[ ]` |
| 5.8-A.52 | `POST /api/v1/orgs/:orgId/plugin-installs/:id/test` — dry-run test (e.g. "send test message" for Slack) — dispatches a sentinel payload | `[ ]` |
| 5.8-A.53 | DTOs: `CreateInstallDto`, `UpdateInstallDto` with `class-validator` + runtime Zod via plugin.configSchema | `[ ]` |
| 5.8-A.54 | Unit test: non-admin user 403; invalid config shape 400; invalid secrets shape 400 | `[ ]` |

**REST API — project / module / feature bindings**

| # | Item | Status |
|---|------|--------|
| 5.8-A.55 | `GET /api/v1/projects/:projectId/plugin-bindings` — list all bindings; TECH_LEAD+ | `[ ]` |
| 5.8-A.56 | `POST /api/v1/projects/:projectId/plugin-bindings` — body: `{ installId, bindingConfig, enabledCapabilities }`; Zod-validate against plugin's `bindingConfigSchema` | `[ ]` |
| 5.8-A.57 | `PATCH /api/v1/projects/:projectId/plugin-bindings/:id` — update partial | `[ ]` |
| 5.8-A.58 | `DELETE /api/v1/projects/:projectId/plugin-bindings/:id` — remove; cascades status mappings | `[ ]` |
| 5.8-A.59 | `POST /api/v1/modules/:moduleId/plugin-bindings` — upsert module override; only settable fields stored | `[ ]` |
| 5.8-A.60 | `DELETE /api/v1/modules/:moduleId/plugin-bindings/:installId` — remove module override (feature reverts to project inheritance) | `[ ]` |
| 5.8-A.61 | `POST /api/v1/features/:featureId/plugin-bindings` — upsert feature override | `[ ]` |
| 5.8-A.62 | `DELETE /api/v1/features/:featureId/plugin-bindings/:installId` — remove feature override | `[ ]` |
| 5.8-A.63 | `GET /api/v1/features/:featureId/plugin-bindings/:installId/effective` — returns resolved effective config (for UI to show inheritance) | `[ ]` |
| 5.8-A.64 | Unit test: create project binding with valid bindingConfig succeeds; invalid shape 400 | `[ ]` |
| 5.8-A.65 | Unit test: module override partial only overrides set fields | `[ ]` |

**Health-check cron**

| # | Item | Status |
|---|------|--------|
| 5.8-A.66 | BullMQ repeatable job `plugin-health-check` runs every 15 min per `OrgPluginInstall` | `[ ]` |
| 5.8-A.67 | Job reads all enabled installs; calls `PluginService.healthCheck(installId)`; writes `lastHealthOk/At/Error` | `[ ]` |
| 5.8-A.68 | Transition `ok → !ok` emits `PLUGIN_HEALTH_DEGRADED` notification to all `ORG_ADMIN` users (via `docs/IN_APP_NOTIFICATIONS.md` system) | `[ ]` |
| 5.8-A.69 | Unit test: state transition fires notification; no-transition does not | `[ ]` |

**Admin UI — Org plugins page**

| # | Item | Status |
|---|------|--------|
| 5.8-A.70 | Route `/org/:orgSlug/plugins` — new page `OrgPluginsPage.tsx`; RBAC gate ORG_ADMIN | `[ ]` |
| 5.8-A.71 | Lists plugins in registry with installed state + health badge + version + capabilities | `[ ]` |
| 5.8-A.72 | `[Install]` button opens `PluginInstallModal` with auto-rendered form from `configSchema` + `secretsSchema` | `[ ]` |
| 5.8-A.73 | Create shared `PluginConfigForm` component — auto-renders fields from Zod schema + `configUiHints` / `secretsUiHints` | `[ ]` |
| 5.8-A.74 | Field types supported: text, password, select (static options), select (async via `fetchOptions`), textarea, url, number | `[ ]` |
| 5.8-A.75 | Cascading dropdowns: `FieldHint.dependsOn` — parent field value passed to child's `fetchOptions` | `[ ]` |
| 5.8-A.76 | "Test connection" button calls `POST /.../test` or `.../health-check`; success → green check + details; error → inline red | `[ ]` |
| 5.8-A.77 | On save: `POST /api/v1/orgs/:orgId/plugin-installs`; optimistic UI; refetch on success | `[ ]` |
| 5.8-A.78 | Configure modal: pre-fills with current config; secrets fields show `••••••••` placeholder; blank = unchanged | `[ ]` |
| 5.8-A.79 | Disable / uninstall actions with confirmation modal | `[ ]` |
| 5.8-A.80 | Health badge: green ✓ (ok), amber ⚠ (degraded), red ✗ (failing); tooltip shows `lastHealthError` | `[ ]` |
| 5.8-A.81 | Component test: form auto-renders all field types; validation errors display under fields | `[ ]` |

**Admin UI — Project integrations page**

| # | Item | Status |
|---|------|--------|
| 5.8-A.82 | Route `/projects/:projectId/settings/integrations` — new sub-tab in `ProjectSettingsPage` | `[ ]` |
| 5.8-A.83 | Lists all org-installed plugins; each has a section with binding form | `[ ]` |
| 5.8-A.84 | Binding form auto-renders from `plugin.bindingConfigSchema` + `bindingConfigUiHints` (same component as install) | `[ ]` |
| 5.8-A.85 | Cascading dropdowns fed by plugin-specific endpoints (e.g. ClickUp `/workspaces`, `/spaces`, `/lists`) | `[ ]` |
| 5.8-A.86 | Capability toggles (checkboxes) — "Use this plugin for Create Issue / Sync Status / Notify" | `[ ]` |
| 5.8-A.87 | RBAC gate: OWNER, TECH_LEAD only | `[ ]` |
| 5.8-A.88 | Status mapping sub-form: grid of platform phases vs external statuses (dropdown fed by `PluginStatusMapping`) | `[ ]` |
| 5.8-A.89 | Save button; dirty-state indicator; beforeunload guard on unsaved changes | `[ ]` |

**Admin UI — Module / feature override panels**

| # | Item | Status |
|---|------|--------|
| 5.8-A.90 | Module page → Settings tab → Integrations section | `[ ]` |
| 5.8-A.91 | Same `PluginConfigForm` component in `scope="module"` mode: shows inherited values as ghost placeholder | `[ ]` |
| 5.8-A.92 | Inherited value source label: "Inherited from project (Bugs list)" | `[ ]` |
| 5.8-A.93 | `[Inherit]` toggle next to each field resets the override (unsets field in `bindingConfig`) | `[ ]` |
| 5.8-A.94 | Feature page → Settings tab → Integrations section — same behaviour, scope=feature, shows module OR project inheritance source | `[ ]` |
| 5.8-A.95 | Component test: override a field, toggle inherit → field re-displays project value | `[ ]` |

**Audit trail**

| # | Item | Status |
|---|------|--------|
| 5.8-A.96 | Wire `AuditLog` entries for: `plugin.install`, `plugin.update`, `plugin.uninstall`, `plugin.binding.create`, `plugin.binding.update`, `plugin.binding.delete`, `plugin.dispatch.createIssue`, `plugin.dispatch.syncPhaseStatus`, `plugin.health.degraded` | `[ ]` |
| 5.8-A.97 | Audit meta includes `changedFields` (names only) for updates — never secret values | `[ ]` |
| 5.8-A.98 | Unit test: `plugin.update` with secret change logs audit without secret value | `[ ]` |

**Frontend shared components & hooks**

| # | Item | Status |
|---|------|--------|
| 5.8-A.99 | `apps/web/src/components/plugins/PluginConfigForm.tsx` — auto-renders from manifest | `[ ]` |
| 5.8-A.100 | `apps/web/src/components/plugins/PluginPicker.tsx` — dropdown listing installs for a given capability | `[ ]` |
| 5.8-A.101 | `apps/web/src/hooks/usePluginCapability.ts` — returns `{ dispatch, isAvailable, installs }` for a capability | `[ ]` |
| 5.8-A.102 | `apps/web/src/lib/pluginsApi.ts` — typed client for plugin endpoints | `[ ]` |

**E2E validation**

| # | Item | Status |
|---|------|--------|
| 5.8-A.103 | E2E test `apps/api/test/e2e/plugin-registry.e2e-spec.ts`: install → bad token (health fail) → update token (health ok) → create project binding → dispatch at feature scope verifies effective config merged → uninstall → secrets zeroed, bindings cascaded | `[ ]` |
| 5.8-A.104 | Contract test harness `apps/api/test/helpers/plugin-contract.ts` — shared utility used by each plugin's contract test | `[ ]` |

---

#### §5.8-B — First Plugin: Slack (arch validation, `notify` only)

> Build this before ClickUp to validate the registry end-to-end with the simplest possible plugin. Re-uses existing `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` webhook message shape.

| # | Item | Status |
|---|------|--------|
| 5.8-B.1 | Create `apps/api/src/plugins/slack/index.ts` with manifest declaring `capabilities: ['notify']` | `[ ]` |
| 5.8-B.2 | Create `slack/schemas.ts` — `configSchema: { workspaceName: string }`, `secretsSchema: { webhookUrl: string }`, `bindingConfigSchema: { defaultChannel?: string, mentionOnFail?: string }` | `[ ]` |
| 5.8-B.3 | Create `slack/lifecycle.ts` — `healthCheck` POSTs a test payload with `text: 'QA Platform health check'` and expects 200 | `[ ]` |
| 5.8-B.4 | Create `slack/implementations/notify.ts` — build Slack Block Kit message from `NotifyPayload`; POST to webhook URL | `[ ]` |
| 5.8-B.5 | Register in `apps/api/src/plugins/registry.ts`; add icon `apps/web/public/plugin-icons/slack.svg` | `[ ]` |
| 5.8-B.6 | Contract test `slack/__tests__/contract.test.ts` — healthCheck + notify happy + notify 500 error paths | `[ ]` |
| 5.8-B.7 | Manual verification: install via admin UI → create project binding → trigger test message → arrives in Slack | `[ ]` |

---

#### §5.8-C — ClickUp Plugin: Core (install, createIssue, linkTicket)

> Spec: `docs/PM_INTEGRATIONS.md` §2–§7

| # | Item | Status |
|---|------|--------|
| 5.8-C.1 | Create `apps/api/src/plugins/clickup/index.ts` with manifest declaring `capabilities: ['createIssue', 'linkTicket', 'syncPhaseStatus', 'fetchTicketContext', 'fetchDocs']` | `[ ]` |
| 5.8-C.2 | Create `clickup/schemas.ts` — `clickupConfigSchema`, `clickupSecretsSchema`, `clickupBindingSchema` per `PM_INTEGRATIONS.md` §3 | `[ ]` |
| 5.8-C.3 | Create `clickup/lifecycle.ts` — `onEnable`, `healthCheck` (calls `GET /api/v2/user`), `onConfigChange`, `onDisable` | `[ ]` |
| 5.8-C.4 | Create `clickup/hierarchy.ts` — `refreshWorkspaceHierarchy(ctx)`, `invalidateWorkspaceHierarchy(ctx)`; Redis key `plugin:clickup:{installId}:hierarchy`, TTL 1h | `[ ]` |
| 5.8-C.5 | Fetch sequence: `GET /team/:id/space` → `GET /space/:id/folder` → `GET /space/:id/list` (folderless) + `GET /folder/:id/list` per folder | `[ ]` |
| 5.8-C.6 | Create `clickup/implementations/create-issue.ts` per `PM_INTEGRATIONS.md` §6.3 — validates effective config, builds payload, handles `targetMode: 'list' \| 'subtask'`, writes `TicketLink` | `[ ]` |
| 5.8-C.7 | Validation: `targetMode='subtask'` without `parentTaskId` throws `BindingConfigError` | `[ ]` |
| 5.8-C.8 | Validation: `targetMode='list'` without `targetListId` throws `BindingConfigError` | `[ ]` |
| 5.8-C.9 | Description builder: subtask mode prepends `> Related feature: [{title}]({url})` context line | `[ ]` |
| 5.8-C.10 | Priority mapping: `critical → 1, high → 2, medium → 3, low → 4` | `[ ]` |
| 5.8-C.11 | Custom field mapping: if `binding.severityFieldId` set, send `custom_fields: [{ id, value: severity }]` | `[ ]` |
| 5.8-C.12 | Create `clickup/implementations/link-ticket.ts` per §7.2 — parse URL/ID/custom-ID, fetch task, return `TicketRef` | `[ ]` |
| 5.8-C.13 | URL parser `parseClickUpTaskRef(urlOrId)`: handles full URL, short URL, custom ID, raw ID; returns `{ taskId, isCustomId }` | `[ ]` |
| 5.8-C.14 | Custom ID lookup: `GET /team/:wid/task?custom_task_ids=true&team_id=:wid&custom_id=ABC-123` | `[ ]` |
| 5.8-C.15 | Typed errors in `clickup/errors.ts`: `ClickUpAuthError`, `ClickUpRateLimitError`, `ClickUpNotFoundError`, `ClickUpValidationError`, `ClickUpServerError`, `ClickUpProtocolError` | `[ ]` |
| 5.8-C.16 | HTTP error mapper in `clickup/http.ts`: maps 401→Auth, 429→RateLimit, 404→NotFound, 4xx→Validation, 5xx→Server | `[ ]` |
| 5.8-C.17 | Register plugin in registry; icon `apps/web/public/plugin-icons/clickup.svg` | `[ ]` |
| 5.8-C.18 | Contract test `clickup/__tests__/contract.test.ts` — health + createIssue (list mode) + createIssue (subtask mode) + linkTicket (URL) + linkTicket (custom ID) + error paths (401/404/429/malformed) | `[ ]` |

**ClickUp-specific REST endpoints**

| # | Item | Status |
|---|------|--------|
| 5.8-C.19 | `GET /api/v1/plugins/:installId/clickup/workspaces` — wraps `GET /team`; hit cache first | `[ ]` |
| 5.8-C.20 | `GET /api/v1/plugins/:installId/clickup/spaces?workspaceId=` | `[ ]` |
| 5.8-C.21 | `GET /api/v1/plugins/:installId/clickup/folders?spaceId=` | `[ ]` |
| 5.8-C.22 | `GET /api/v1/plugins/:installId/clickup/lists?spaceId=|folderId=` | `[ ]` |
| 5.8-C.23 | `GET /api/v1/plugins/:installId/clickup/statuses?listId=` — reads `GET /list/:id` → `statuses[]` | `[ ]` |
| 5.8-C.24 | `GET /api/v1/plugins/:installId/clickup/custom-fields?listId=` — reads `GET /list/:id/field` | `[ ]` |
| 5.8-C.25 | `GET /api/v1/plugins/:installId/clickup/task-search?listId=&q=` — client-side fuzzy filter over `GET /list/:id/task` (for parent-task autocomplete) | `[ ]` |

**ClickUp binding UI**

| # | Item | Status |
|---|------|--------|
| 5.8-C.26 | Binding form field: Space → Folder → List cascading dropdowns fed by `/clickup/spaces`, `/folders`, `/lists` | `[ ]` |
| 5.8-C.27 | Target mode toggle: `[ List mode | Subtask mode ]` pill (radio styled) | `[ ]` |
| 5.8-C.28 | Parent task field — async autocomplete via `/clickup/task-search`, visible only when `targetMode=subtask` | `[ ]` |
| 5.8-C.29 | Status mapping grid: 4 rows (QA / UAT / SIGNOFF_PENDING / SIGNED_OFF) × status dropdown fed by `/clickup/statuses` | `[ ]` |
| 5.8-C.30 | Advanced (collapsed): severity field select (from `/custom-fields`), bug tag input, attach recordings toggle, recording max MB number input (default 50) | `[ ]` |
| 5.8-C.31 | Bindings display in `ProjectSettingsPage` → Integrations tab, driven by §5.8-A admin UI | `[ ]` |

**TicketLink UI (Feature page widget)**

| # | Item | Status |
|---|------|--------|
| 5.8-C.32 | `FeaturePage` sidebar widget: `LinkedTicketWidget` — shows `TicketLink` with title, external status badge, assignees, `[Open]` (external URL) + `[Unlink]` | `[ ]` |
| 5.8-C.33 | Empty state: `[+ Link a ClickUp task]` button opens modal | `[ ]` |
| 5.8-C.34 | Link modal: paste URL/ID input + `[Resolve]` → dispatches `linkTicket`; success creates `TicketLink` row, closes modal | `[ ]` |
| 5.8-C.35 | Error state: "Task not found" / "Token invalid" / "Task no longer exists — unlink?" | `[ ]` |
| 5.8-C.36 | Live status polling: every 60s refresh external status via cached `GET /task/:id` (Redis 5 min TTL) | `[ ]` |

**Create Ticket flow (failure panel + findings + manual issues)**

| # | Item | Status |
|---|------|--------|
| 5.8-C.37 | `StepFailurePanel` adds `[Create Ticket ▼]` action — dropdown lists every installed `createIssue`-capable plugin via `usePluginCapability('createIssue')` hook | `[ ]` |
| 5.8-C.38 | Clicking ClickUp in dropdown opens `CreateTicketModal` pre-filled with: title (AI-drafted from failure), description (step trace + AI failure summary), severity, attachments (screenshots + clip) | `[ ]` |
| 5.8-C.39 | Modal shows effective target read-only: "→ My QA Bugs list (ClickUp, subtask of Q2 QA)" | `[ ]` |
| 5.8-C.40 | Submit fires `POST /api/v1/plugins/:installId/dispatch/create-issue` (generic dispatch helper) with scope `{ projectId, moduleId, featureId }` | `[ ]` |
| 5.8-C.41 | Success: toast with external ID + link; writes `TicketLink` record (scope: `issueId` for manual failures, `findingId` for exploratory) | `[ ]` |
| 5.8-C.42 | Same flow wired into exploratory `FindingCard` (per `docs/EXPLORATORY_TESTING.md` §9.2.1) | `[ ]` |
| 5.8-C.43 | Same flow wired into `FailurePanel` for automated run failures | `[ ]` |
| 5.8-C.44 | Integration test: end-to-end create-issue from manual failure → ClickUp task exists with correct body + attachments mocked | `[ ]` |

---

#### §5.8-D — ClickUp: syncPhaseStatus + fetchTicketContext

| # | Item | Status |
|---|------|--------|
| 5.8-D.1 | Create `clickup/implementations/sync-phase-status.ts` per `PM_INTEGRATIONS.md` §8 — reads binding's `phaseStatusQa/Uat/SignoffPending/SignedOff`; calls `PUT /task/:id` with `{ status }` | `[ ]` |
| 5.8-D.2 | Missing mapping → log warn + skip (no error) | `[ ]` |
| 5.8-D.3 | Hook into `FeaturePhaseService.transitionPhase()` — after platform commit, for each `TicketLink` on the feature: dispatch `syncPhaseStatus` | `[ ]` |
| 5.8-D.4 | On failure: write `TicketLink.lastSyncError`; emit `PLUGIN_SYNC_FAILED` notification (retriable) | `[ ]` |
| 5.8-D.5 | `POST /api/v1/ticket-links/:id/sync` — manual retry endpoint | `[ ]` |
| 5.8-D.6 | `FeaturePage` shows amber banner "⚠ ClickUp sync failed — [Retry] [Dismiss]" when `lastSyncError` set | `[ ]` |
| 5.8-D.7 | Create `clickup/implementations/fetch-ticket-context.ts` per `PM_INTEGRATIONS.md` §9 | `[ ]` |
| 5.8-D.8 | Fetches `GET /task/:id?include_markdown_description=true` + `GET /task/:id/comment` | `[ ]` |
| 5.8-D.9 | AC extractor `extractAcceptanceCriteria(markdown)` — regex-based heuristic for `## Acceptance Criteria` / `## AC` / `**Acceptance Criteria:**` followed by bullets or numbered list | `[ ]` |
| 5.8-D.10 | Redis cache keyed `plugin:clickup:ticket-context:{taskId}`, TTL 5 min | `[ ]` |
| 5.8-D.11 | Integrate with `TestGenerationService.buildPrompt()` — if feature has linked ClickUp ticket, dispatch `fetchTicketContext` and inject as `## Story Context` prompt block | `[ ]` |
| 5.8-D.12 | `POST /api/v1/features/:id/ai/import-ac` — dispatches `fetchTicketContext`, returns `[{ text, checked }]`; on submit of selected items, creates draft `TestDefinition`s per `docs/AI_GENERATION_SPEC.md` | `[ ]` |
| 5.8-D.13 | `POST /api/v1/features/:id/ai/explain` — "How should I test this?" SSE endpoint: fetches context + linked docs, builds explanation prompt | `[ ]` |
| 5.8-D.14 | `FeaturePage` AI panel: "Ask about this feature" chat input → `/ai/explain` | `[ ]` |
| 5.8-D.15 | `FeaturePage`: `[Import from ClickUp]` button when ticket linked → review panel with AC checkboxes → "Import as test cases" | `[ ]` |
| 5.8-D.16 | Unit test: `extractAcceptanceCriteria` handles all three heading styles + bullets + numbered lists | `[ ]` |
| 5.8-D.17 | Unit test: phase sync skips gracefully when mapping missing | `[ ]` |
| 5.8-D.18 | Integration test: phase transition QA→UAT triggers ClickUp status update via mocked API | `[ ]` |

---

#### §5.8-E — ClickUp: Attachments (screenshot + recording upload with fallback)

| # | Item | Status |
|---|------|--------|
| 5.8-E.1 | Create `clickup/attachments.ts` with `uploadAttachmentWithFallback(taskId, att, binding, ctx)` per `PM_INTEGRATIONS.md` §6.5 | `[ ]` |
| 5.8-E.2 | Size rules: screenshots always upload if ≤10 MB; recordings conditional (`attachRecordings` true AND ≤`attachRecordingMaxMb`); else fallback to signed URL in description | `[ ]` |
| 5.8-E.3 | Upload: `POST /task/:id/attachment` multipart via `form-data` stream from S3 | `[ ]` |
| 5.8-E.4 | Fallback: `appendToTaskDescription` helper fetches current description (`GET /task/:id`), appends markdown link, PUTs full new description | `[ ]` |
| 5.8-E.5 | Signed URL service: `ArtifactService.getSignedUrl(storageKey, { expiresInSec })` — default 30 days; env `ARTIFACT_SIGNED_URL_TTL_DAYS=30` | `[ ]` |
| 5.8-E.6 | `Attachment` shape from `CreateIssuePayload` → `{ storageKey, filename, mimeType, sizeBytes }`; `createIssue` iterates and calls `uploadAttachmentWithFallback` | `[ ]` |
| 5.8-E.7 | Retry upload once on network error; on second failure → fallback to URL | `[ ]` |
| 5.8-E.8 | Unit test: screenshot ≤10 MB → uploaded; >10 MB → URL fallback | `[ ]` |
| 5.8-E.9 | Unit test: recording 30 MB (binding max 50, attachRecordings=true) → uploaded | `[ ]` |
| 5.8-E.10 | Unit test: recording 100 MB (binding max 50) → URL fallback; description contains signed URL | `[ ]` |
| 5.8-E.11 | Unit test: recording any size, attachRecordings=false → URL fallback | `[ ]` |
| 5.8-E.12 | Unit test: upload 500 error → falls back to URL, task still has link in description | `[ ]` |

---

#### §5.8-F — ClickUp Docs: fetchDocs + DocLink + UI surfaces

> Spec: `docs/PM_INTEGRATIONS.md` §10 + `docs/FEATURE_PLAYER.md` §10.6

**Data + service**

| # | Item | Status |
|---|------|--------|
| 5.8-F.1 | Verify ClickUp v3 Docs API availability in target workspace (30-min live reconnaissance — confirm endpoint paths, response shape, content field name) | `[ ]` |
| 5.8-F.2 | Create `clickup/implementations/fetch-docs.ts` with `listDocs(query, ctx)` + `fetchDoc(docId, ctx)` per `PM_INTEGRATIONS.md` §10.1 | `[ ]` |
| 5.8-F.3 | Adapter function `mapClickUpV3Doc(raw): DocSummary/DocContent` — isolates v3 shape so future API changes touch one function | `[ ]` |
| 5.8-F.4 | Pagination in `listDocs`: v3 `cursor`-based or `page` param (confirm during 5.8-F.1); limit param default 50 | `[ ]` |
| 5.8-F.5 | `DocLink` caching: on link creation, dispatch `fetchDoc` and store `bodyMarkdown` + `pages[]` as JSONB in `DocLink.cachedMarkdown`; set `cachedAt`, `cacheExpiresAt = cachedAt + 24h` | `[ ]` |
| 5.8-F.6 | Cache TTL configurable via env `DOC_CACHE_TTL_HOURS=24` | `[ ]` |
| 5.8-F.7 | On access: if `cacheExpiresAt < now`, refetch in background, return stale immediately (stale-while-revalidate) | `[ ]` |
| 5.8-F.8 | Refresh endpoint forces immediate refetch, updates cache synchronously | `[ ]` |

**REST API**

| # | Item | Status |
|---|------|--------|
| 5.8-F.9 | `GET /api/v1/plugins/:installId/docs?q=&spaceId=&limit=` — wraps `listDocs`; RBAC: project member | `[ ]` |
| 5.8-F.10 | `GET /api/v1/plugins/:installId/docs/:docId` — returns cached or fresh DocContent | `[ ]` |
| 5.8-F.11 | `POST /api/v1/plugins/:installId/docs/:docId/refresh` — force refetch and update cache | `[ ]` |
| 5.8-F.12 | `POST /api/v1/doc-links` — body `{ installId, docId, projectId?, moduleId?, featureId? }` — can set 1–3 scope ids in one call; creates multiple `DocLink` rows in a transaction | `[ ]` |
| 5.8-F.13 | `GET /api/v1/doc-links?projectId=|moduleId=|featureId=` — list links for a scope; at feature scope, includes module + project-scoped links (deduped by `externalId`) | `[ ]` |
| 5.8-F.14 | `DELETE /api/v1/doc-links/:id` — remove; RBAC TECH_LEAD+ | `[ ]` |
| 5.8-F.15 | Unit test: creating a doc link at project+feature scope creates 2 rows atomically | `[ ]` |
| 5.8-F.16 | Unit test: listing feature-scope links includes parent module + project docs | `[ ]` |

**Link-a-doc modal**

| # | Item | Status |
|---|------|--------|
| 5.8-F.17 | `apps/web/src/components/docs/LinkDocModal.tsx` — tabs Paste + Browse per `PM_INTEGRATIONS.md` §10.2 | `[ ]` |
| 5.8-F.18 | Paste tab: URL input + `[Resolve]` button → calls `GET /docs/:docId` via URL parser | `[ ]` |
| 5.8-F.19 | Browse tab: space filter dropdown, search input (debounced 300ms), infinite-scroll results | `[ ]` |
| 5.8-F.20 | Multi-scope checkboxes: `[x] This feature  [ ] Parent module  [ ] Project`; default checks current scope | `[ ]` |
| 5.8-F.21 | On submit: `POST /doc-links` with selected scopes; toast with link count | `[ ]` |
| 5.8-F.22 | Empty state: "No ClickUp Docs found. Check your workspace or try a different search." | `[ ]` |

**DocViewer component**

| # | Item | Status |
|---|------|--------|
| 5.8-F.23 | `apps/web/src/components/docs/DocViewer.tsx` — renders `DocContent` with `react-markdown` + `remark-gfm` + `rehype-sanitize` | `[ ]` |
| 5.8-F.24 | Multi-page: tab strip at top; each tab shows one page | `[ ]` |
| 5.8-F.25 | Header: doc title + `[↗ Open in ClickUp]` + `[↺ Refresh]` + `[✕ Close]` | `[ ]` |
| 5.8-F.26 | Refresh button calls `POST /docs/:docId/refresh`, replaces viewer content | `[ ]` |
| 5.8-F.27 | Loading states: skeleton rows during fetch; error state "Could not load doc — retry?" | `[ ]` |

**Doc surfaces — FeaturePage widget**

| # | Item | Status |
|---|------|--------|
| 5.8-F.28 | `FeaturePage` sidebar: `LinkedDocsWidget` — lists linked docs with scope badge ("feature" / "module" / "project") + `[+ Link]` button | `[ ]` |
| 5.8-F.29 | Click doc → opens `DocViewer` in side drawer (380px, z-40) | `[ ]` |
| 5.8-F.30 | Multi-scope dedup: same Doc at feature + module shows once with tooltip "Linked at module + feature" | `[ ]` |
| 5.8-F.31 | Module page mirror: `ModulePage` has the same widget (scope=module) | `[ ]` |
| 5.8-F.32 | Project overview: linked docs card in stats strip (`ProjectOverviewPage`) | `[ ]` |

**Doc surfaces — Testing View pill (per `FEATURE_PLAYER.md` §10.6)**

| # | Item | Status |
|---|------|--------|
| 5.8-F.33 | Top action bar: `DocPill` component shows `📄 N docs ▼` where N = count from `GET /doc-links?featureId=` | `[ ]` |
| 5.8-F.34 | Pill hidden when N=0 | `[ ]` |
| 5.8-F.35 | Click → dropdown listing doc titles with scope badge; click doc → opens side drawer (380px) rendering `DocViewer` | `[ ]` |
| 5.8-F.36 | Drawer state (open/doc-id/pinned) persisted to `localStorage['testing-view-doc-drawer']` | `[ ]` |
| 5.8-F.37 | Pin icon → right panel collapses to 50% width; drawer takes remaining right side | `[ ]` |
| 5.8-F.38 | `[✕]` close returns to single-pane layout | `[ ]` |
| 5.8-F.39 | Keyboard: `Cmd+D` toggles doc drawer when in Testing View | `[ ]` |

**AI context injection from linked Docs**

| # | Item | Status |
|---|------|--------|
| 5.8-F.40 | `TestGenerationService.buildPrompt()` — fetch all linked docs for feature's scope (feature + module + project), deduped by `externalId`; inject `## Reference Docs` prompt block per `docs/AI_GENERATION_SPEC.md` context injection order | `[ ]` |
| 5.8-F.41 | Budget: sum of all linked doc markdown capped at 8000 tokens; truncate oldest-first if exceeded | `[ ]` |
| 5.8-F.42 | Unit test: feature with 2 module docs + 1 feature doc injects all three, deduped | `[ ]` |
| 5.8-F.43 | Unit test: 20 huge docs truncated to fit budget | `[ ]` |

---

#### §5.8-G — Rate Limiting, Health Monitoring & Notifications

| # | Item | Status |
|---|------|--------|
| 5.8-G.1 | Token bucket in Redis `plugin:ratelimit:clickup:{orgId}` — refills 90/min (10% safety margin under 100/min free tier) | `[ ]` |
| 5.8-G.2 | Configurable via `bindingConfig.rateLimitOverride` (default omitted) — e.g. Business+ tier set 900/min | `[ ]` |
| 5.8-G.3 | On 429 response: respect `Retry-After`; retry once; then typed `ClickUpRateLimitError` to caller | `[ ]` |
| 5.8-G.4 | 3 consecutive 429 errors within 5 min → `PLUGIN_RATE_LIMITED` notification (per `IN_APP_NOTIFICATIONS.md` — new type) | `[ ]` |
| 5.8-G.5 | New notification types in `NotificationType` enum: `PLUGIN_HEALTH_DEGRADED`, `PLUGIN_SYNC_FAILED`, `PLUGIN_RATE_LIMITED` | `[ ]` |
| 5.8-G.6 | Notification CTAs: `[Configure]` → `/org/:slug/plugins/:installId`; `[Retry]` → manual sync endpoint; `[View Log]` → audit log with plugin filter | `[ ]` |
| 5.8-G.7 | Default preferences: all three in-app=true, email=false for `ORG_ADMIN` + `TECH_LEAD` | `[ ]` |

---

#### §5.8-H — End-to-End Verification

| # | Item | Status |
|---|------|--------|
| 5.8-H.1 | E2E `clickup-integration.e2e-spec.ts`: install → bad token (health fails) → fix token (health ok) → create project binding (list mode) → create finding → dispatch createIssue → ClickUp task created (mocked); TicketLink row exists | `[ ]` |
| 5.8-H.2 | E2E: module override to subtask mode → new finding → task created as subtask of parent; parent context line in description | `[ ]` |
| 5.8-H.3 | E2E: feature override on recording size to 10 MB → upload 50 MB recording → URL fallback used | `[ ]` |
| 5.8-H.4 | E2E: link ticket by URL → TicketLink created → live status refreshed on feature page | `[ ]` |
| 5.8-H.5 | E2E: phase transition QA→UAT → ClickUp status update dispatched | `[ ]` |
| 5.8-H.6 | E2E: link doc multi-scope (project + feature) → GET doc-links at feature scope returns both deduped | `[ ]` |
| 5.8-H.7 | E2E: Testing View doc pill renders with correct count; click opens drawer with rendered markdown | `[ ]` |
| 5.8-H.8 | E2E: AI generate test cases with linked ClickUp ticket + doc → prompt contains Story Context + Reference Docs sections | `[ ]` |
| 5.8-H.9 | Manual test script `MT-PLUGINS`: steps to install ClickUp, create bindings, file a bug from exploratory, verify task in real ClickUp workspace | `[ ]` |
| 5.8-H.10 | Documentation: admin help page `/help/plugins/clickup` with setup guide + troubleshooting | `[ ]` |

---

#### §5.8-I — Inbound Status Sync (pullTicketStatus + mapping + refresh UX)

> Spec: `docs/PM_INTEGRATIONS.md` §11 + `docs/FEATURE_PLAYER.md` §10.7
>
> Why this matters: outbound sync alone is half the story — QA engineers need to see when a dev moves a ticket to "Ready for QA" without switching to ClickUp.

**Data model additions**

| # | Item | Status |
|---|------|--------|
| 5.8-I.1 | Extend `PluginStatusMapping` — add `direction` (`OUTBOUND`/`INBOUND`/`BIDIRECTIONAL`), `targetType` (`PHASE`/`ISSUE_STATUS`), rename `platformPhase` → `platformValue`, `externalStatus` → `externalValue`; new `@@unique([bindingId, direction, targetType, platformValue, externalValue])` | `[ ]` |
| 5.8-I.2 | Create new enums `MappingDirection`, `MappingTargetType` in schema | `[ ]` |
| 5.8-I.3 | Extend `TicketLink` with inbound fields: `externalStatusColor`, `externalStatusType`, `externalAssignees` (Json), `externalLastUpdatedAt`, `lastInboundSyncAt`, `lastInboundSyncError`, `lastInboundSource` (enum `InboundSource`: MANUAL_REFRESH/WEBHOOK/BULK_SYNC); split `lastSyncedAt` into `lastOutboundSyncAt` + `lastInboundSyncAt` | `[ ]` |
| 5.8-I.4 | Create `TicketStatusSuggestion` model — fields: ticketLinkId, externalStatus, mappedStatus, suggestionKind (`AUTO_APPLIED`/`PENDING_APPROVAL`/`UNMAPPED`), appliedById/At, dismissedById/At | `[ ]` |
| 5.8-I.5 | Migration `20260422010000_inbound_sync` — additive schema change; phase mappings in existing rows migrate to `direction=BIDIRECTIONAL, targetType=PHASE` | `[ ]` |
| 5.8-I.6 | Run `pnpm db:migrate` + `pnpm db:generate`; verify TypeScript compiles | `[ ]` |

**Capability type + ClickUp implementation**

| # | Item | Status |
|---|------|--------|
| 5.8-I.7 | Add `pullTicketStatus` to `PluginCapability` enum and `PluginImplementations` type in `apps/api/src/plugins/types.ts` | `[ ]` |
| 5.8-I.8 | Add `ExternalTicketState` interface to `apps/api/src/plugins/capabilities/types.ts` per `PLUGIN_REGISTRY.md` §2.1 | `[ ]` |
| 5.8-I.9 | Extend `clickupBindingSchema` with `autoApplyInboundStatus`, `notifyUnmappedStatus`, `bulkRefreshOnProjectOpen`, `webhookEnabled`, `webhookEvents` (Zod schema updates) | `[ ]` |
| 5.8-I.10 | Create `apps/api/src/plugins/clickup/implementations/pull-ticket-status.ts` per `PM_INTEGRATIONS.md` §11.1 — `GET /api/v2/task/:id` returning `ExternalTicketState` with status/color/type/assignees/priority/lastUpdatedAt | `[ ]` |
| 5.8-I.11 | Register `pullTicketStatus` in ClickUp plugin manifest's `capabilities[]` + `implementations` | `[ ]` |
| 5.8-I.12 | Contract test: `pullTicketStatus` happy path + 404 + 401 error paths | `[ ]` |

**InboundSyncService**

| # | Item | Status |
|---|------|--------|
| 5.8-I.13 | Create `apps/api/src/plugins/inbound-sync.service.ts` with `refreshTicket(ticketLinkId, source, actingUserId?)` per spec §11.2 | `[ ]` |
| 5.8-I.14 | `refreshTicket` updates TicketLink snapshot columns (externalStatus/Color/Type/Assignees/LastUpdatedAt) always, regardless of mapping outcome | `[ ]` |
| 5.8-I.15 | `findInboundMapping(link, externalStatus)` — looks up `PluginStatusMapping` where `direction IN (INBOUND, BIDIRECTIONAL)` and `externalValue = externalStatus` | `[ ]` |
| 5.8-I.16 | Unmapped path: create `TicketStatusSuggestion` with `kind=UNMAPPED`; if `binding.notifyUnmappedStatus` true → fire `PLUGIN_STATUS_UNMAPPED` notification to ORG_ADMIN with CTA → binding config URL | `[ ]` |
| 5.8-I.17 | Auto-apply path (`binding.autoApplyInboundStatus=true`): call `applyMappingToTarget(link, mapping)` → then fire `TICKET_STATUS_SYNCED` in-app notification | `[ ]` |
| 5.8-I.18 | Pending path: create `TicketStatusSuggestion` with `kind=PENDING_APPROVAL`; fire `TICKET_STATUS_PENDING_APPROVAL` notification with `actionUrl` = `/projects/:id/features/:featureId/test?highlight=issue:xxx&suggestion=yyy` | `[ ]` |
| 5.8-I.19 | `applyMappingToTarget(link, mapping)` dispatch: uses `IssuesService.transitionStatus()` when `targetType=ISSUE_STATUS` and `link.issueId`; `FindingsService.updateStatus()` for `link.findingId`; `PhaseEngine.transition()` for `targetType=PHASE` and `link.featureId`. **NEVER direct DB writes** | `[ ]` |
| 5.8-I.20 | `applySuggestion(suggestionId, actingUserId)` — idempotent: throws `AlreadyProcessedError` if already applied/dismissed; calls `applyMappingToTarget`; marks suggestion applied with user id + timestamp; audit log `plugin.status.suggestion.applied` | `[ ]` |
| 5.8-I.21 | `dismissSuggestion(suggestionId, actingUserId)` — marks dismissed; no target change | `[ ]` |
| 5.8-I.22 | Error path: typed error during `pullTicketStatus` → writes `lastInboundSyncError`; re-throws so UI shows retry | `[ ]` |
| 5.8-I.23 | Unit test: unmapped status → no target mutation, notification fires | `[ ]` |
| 5.8-I.24 | Unit test: auto-apply path calls IssuesService.transitionStatus with correct value | `[ ]` |
| 5.8-I.25 | Unit test: pending path creates suggestion, notification has deep link | `[ ]` |
| 5.8-I.26 | Unit test: idempotent applySuggestion — second call throws | `[ ]` |

**Bulk refresh**

| # | Item | Status |
|---|------|--------|
| 5.8-I.27 | BullMQ job `bulk-refresh-tickets` — takes `{ projectId, actingUserId }`; reads all `TicketLink`s for project grouped by `(installId, externalListId)` | `[ ]` |
| 5.8-I.28 | For each group, call `GET /list/:id/task?date_updated_gt={max(lastInboundSyncAt)}` (paginated); intersect with local TicketLinks; enqueue per-link `refreshTicket` with source `BULK_SYNC` | `[ ]` |
| 5.8-I.29 | Skip group if rate-limit bucket <10% remaining; log skip; reschedule in 5 min | `[ ]` |
| 5.8-I.30 | `POST /api/v1/projects/:projectId/ticket-links/refresh-all` endpoint enqueues the job; returns 202 with jobId; progress via socket event `plugin:bulk-refresh:progress` | `[ ]` |
| 5.8-I.31 | Project page: subtle "Syncing tickets… (3 of 12)" indicator; disappears on completion | `[ ]` |
| 5.8-I.32 | Auto-trigger bulk refresh on project page mount when `binding.bulkRefreshOnProjectOpen=true` AND `max(lastInboundSyncAt) > 5 min ago` | `[ ]` |
| 5.8-I.33 | Integration test: bulk refresh of 10 tickets uses 1 list-level call, not 10 per-task calls | `[ ]` |

**New notification types**

| # | Item | Status |
|---|------|--------|
| 5.8-I.34 | Add to `NotificationType` enum: `TICKET_STATUS_PENDING_APPROVAL`, `TICKET_STATUS_SYNCED`, `PLUGIN_STATUS_UNMAPPED`, `TICKET_DELETED_UPSTREAM` (used by webhooks in §5.8-J) | `[ ]` |
| 5.8-I.35 | Add new entries to notification templates (title/body/CTA) per `docs/IN_APP_NOTIFICATIONS.md` type catalog | `[ ]` |
| 5.8-I.36 | Default preferences: all new types in-app=true, email=false for `QA_ENGINEER`+`TECH_LEAD` (ORG_ADMIN gets `PLUGIN_STATUS_UNMAPPED` by default) | `[ ]` |

**REST API**

| # | Item | Status |
|---|------|--------|
| 5.8-I.37 | `POST /api/v1/ticket-links/:id/refresh` — dispatches `pullTicketStatus`; returns `{ status: 'auto-applied'\|'pending-approval'\|'unmapped', external, mapping? }` | `[ ]` |
| 5.8-I.38 | `POST /api/v1/projects/:projectId/ticket-links/refresh-all` — enqueues bulk job; returns `{ jobId }`; 202 | `[ ]` |
| 5.8-I.39 | `GET /api/v1/ticket-links/:id/status-suggestions?status=PENDING` — list suggestions for a link | `[ ]` |
| 5.8-I.40 | `POST /api/v1/status-suggestions/:id/apply` — applies; idempotent | `[ ]` |
| 5.8-I.41 | `POST /api/v1/status-suggestions/:id/dismiss` — dismisses | `[ ]` |
| 5.8-I.42 | `GET /api/v1/projects/:projectId/status-suggestions?status=PENDING` — project-wide pending count (for nav badge) | `[ ]` |
| 5.8-I.43 | `GET /api/v1/plugins/:installId/clickup/inbound-mappings?bindingId=` — list mappings filtered by direction | `[ ]` |
| 5.8-I.44 | `PUT /api/v1/plugins/:installId/clickup/inbound-mappings` — bulk upsert; body `{ bindingId, mappings: [{ externalValue, platformValue }] }`; validates no duplicates | `[ ]` |
| 5.8-I.45 | Unit test: apply endpoint idempotent — 409 on second call | `[ ]` |
| 5.8-I.46 | Unit test: put mappings with duplicate external values → 400 | `[ ]` |

**Inbound mapping UI**

| # | Item | Status |
|---|------|--------|
| 5.8-I.47 | Project Settings → Integrations → ClickUp section gains new "Inbound" sub-tab alongside existing outbound phase-sync | `[ ]` |
| 5.8-I.48 | Inbound tab renders a grid: left column pre-populated from `GET /clickup/statuses?listId=`; right column = `IssueStatus` enum dropdown | `[ ]` |
| 5.8-I.49 | Toggles above grid: `autoApplyInboundStatus` (radio Yes/No), `notifyUnmappedStatus` (checkbox), `bulkRefreshOnProjectOpen` (checkbox) | `[ ]` |
| 5.8-I.50 | Save button POSTs to `PUT .../inbound-mappings` + PATCHes binding | `[ ]` |
| 5.8-I.51 | "Refresh statuses from ClickUp" button re-fetches list statuses | `[ ]` |
| 5.8-I.52 | "Learn mapping" shortcut: when `PLUGIN_STATUS_UNMAPPED` notification clicked, opens inbound tab with unmapped row pre-added (external value filled, platform dropdown empty) | `[ ]` |
| 5.8-I.53 | Component test: grid saves all mappings correctly; duplicate externals rejected client-side | `[ ]` |

**Snags drawer + Refresh button (Testing View)**

| # | Item | Status |
|---|------|--------|
| 5.8-I.54 | Testing View top action bar: `[🐞 N snags ▼]` pill — reads `GET /features/:id/issues`; hidden when N=0; red badge when any CRITICAL+OPEN | `[ ]` |
| 5.8-I.55 | Snags drawer component — 380px right-side drawer, z-40, mirrors Doc drawer layout | `[ ]` |
| 5.8-I.56 | `SnagCard` component: severity pill, status pill, title, linked-ticket row (external status pill using `externalStatusColor`), `[↺ Refresh]` button, `[⋮]` overflow | `[ ]` |
| 5.8-I.57 | `[↺ Refresh]` button disabled state while request in flight; shows spinner; success → toast + reload snag | `[ ]` |
| 5.8-I.58 | Drawer shows "Show closed" checkbox + sort dropdown (Severity / Created / Updated) | `[ ]` |
| 5.8-I.59 | `Cmd+B` toggles Snags drawer; `Cmd+Shift+R` refreshes highlighted snag's ticket | `[ ]` |
| 5.8-I.60 | Only one of Docs / Snags drawer can be pinned at a time — opening one unpins the other | `[ ]` |
| 5.8-I.61 | Deep-link handler: `?highlight=issue:{id}` on mount → auto-opens Snags drawer → scrolls to card → 2s yellow pulse border (CSS animation) | `[ ]` |
| 5.8-I.62 | `?suggestion={id}` on mount → inline banner in matched snag card: "ClickUp says X → Map to Y? [Apply] [Dismiss]" | `[ ]` |
| 5.8-I.63 | Banner Apply → `POST /status-suggestions/:id/apply` → banner dismisses, snag updates (socket event `issue:updated` refreshes card) | `[ ]` |
| 5.8-I.64 | Banner Dismiss → `POST /status-suggestions/:id/dismiss` → banner dismisses | `[ ]` |
| 5.8-I.65 | Replace any existing standalone "Refresh ticket" buttons elsewhere in the UI with nav-to-testing-view pattern: clicking a snag anywhere navigates to `/projects/:id/features/:featureId/test?highlight=issue:xxx` | `[ ]` |
| 5.8-I.66 | Component test: deep link lands user on Testing View with drawer open, correct snag in view, banner visible if suggestion | `[ ]` |
| 5.8-I.67 | E2E test: trigger refresh → unmapped → admin notification fires → admin clicks notification → inbound mapping UI opens with new row | `[ ]` |
| 5.8-I.68 | E2E test: trigger refresh → mapped + pending → QA notification fires → QA clicks → Testing View opens with banner → Apply → snag status updates in real-time | `[ ]` |

---

#### §5.8-J — Webhooks (real-time inbound)

> Spec: `docs/PM_INTEGRATIONS.md` §12. Routes inbound events to the same `InboundSyncService` built in §5.8-I.

**Data + infrastructure**

| # | Item | Status |
|---|------|--------|
| 5.8-J.1 | Extend `PluginWebhookEndpoint`: add `externalWebhookId`, `externalSigningSecret`, `events` (String[]), `failedVerificationCount` (Int default 0) | `[ ]` |
| 5.8-J.2 | Create `WebhookEvent` model — fields: orgId, installId, endpointId, eventType, externalId?, payloadDigest (sha256 hex), result, errorMessage, processedAt, payloadStore? | `[ ]` |
| 5.8-J.3 | Migration `20260422020000_webhook_events` — additive | `[ ]` |
| 5.8-J.4 | Enable raw-body middleware in NestJS — `app.use('/webhooks/plugins/*', express.raw({ type: 'application/json', limit: '1mb' }))`; `app.enableRawBody = true` so `@Req() req: RawBodyRequest<Request>` works | `[ ]` |
| 5.8-J.5 | Configure public URL env `API_URL` / `WEBHOOK_BASE_URL` (fallback to API_URL) used in webhook registration body | `[ ]` |

**Capability type + plugin interface**

| # | Item | Status |
|---|------|--------|
| 5.8-J.6 | Add `WebhookHandle`, `WebhookResult` interfaces to `apps/api/src/plugins/capabilities/types.ts` | `[ ]` |
| 5.8-J.7 | `PluginLifecycle.onEnable` is free to call `ctx.services.webhookEndpoints.create()` + register upstream | `[ ]` |
| 5.8-J.8 | `ctx.services.webhookEndpoints` exposed on `PluginCtx` — provides `.create({installId, signingSecret})`, `.update()`, `.remove()`, `.rotate()` | `[ ]` |

**Generic receiver**

| # | Item | Status |
|---|------|--------|
| 5.8-J.9 | `apps/api/src/plugins/webhook.controller.ts` — `POST /webhooks/plugins/:orgId/:installId/:token` receives raw body + headers | `[ ]` |
| 5.8-J.10 | Receiver looks up endpoint by `installId` + `path endsWith /:token`; 404 if not found/inactive | `[ ]` |
| 5.8-J.11 | Receiver dispatches to plugin's `webhookListener.handleWebhook({ rawBody, headers, endpointSecret }, ctx)` | `[ ]` |
| 5.8-J.12 | After dispatch: create `WebhookEvent` audit row with `result` = `"handled"`/`"ignored"`/`"error:CODE"` | `[ ]` |
| 5.8-J.13 | Response: 200 on handled; 202 on ignored; 401 on signature failure; 500 on unexpected error | `[ ]` |
| 5.8-J.14 | On signature failure: increment `PluginWebhookEndpoint.failedVerificationCount`; if ≥10 in 1h → set `isActive=false`, fire `PLUGIN_WEBHOOK_DISABLED` notification to ORG_ADMIN | `[ ]` |
| 5.8-J.15 | Replay protection: Redis set `webhook:seen:{installId}` keyed by `payloadDigest` with 5 min TTL; duplicate digest within TTL → `{ handled: false, result: 'ignored-duplicate' }` | `[ ]` |

**ClickUp registration lifecycle**

| # | Item | Status |
|---|------|--------|
| 5.8-J.16 | `clickup/webhook-register.ts` with `registerClickUpWebhook(ctx)` per spec §12.1 — creates endpoint row, POSTs to `/team/:wid/webhook`, stores `externalWebhookId` + `externalSigningSecret` | `[ ]` |
| 5.8-J.17 | `unregisterClickUpWebhook(ctx)` — DELETE `/webhook/:id`; deactivate endpoint row | `[ ]` |
| 5.8-J.18 | Extend `lifecycle.onEnable` — if `config.webhookEnabled !== false`, call `registerClickUpWebhook` | `[ ]` |
| 5.8-J.19 | Extend `lifecycle.onConfigChange` — detect webhook config change; if events list changed, re-register (delete + recreate) | `[ ]` |
| 5.8-J.20 | Extend `lifecycle.onDisable` + uninstall — call `unregisterClickUpWebhook` | `[ ]` |
| 5.8-J.21 | Handle already-registered case gracefully: if `externalWebhookId` already set, skip POST; re-fetch and verify still active | `[ ]` |

**ClickUp webhookListener implementation**

| # | Item | Status |
|---|------|--------|
| 5.8-J.22 | Create `clickup/implementations/webhook-listener.ts` — verifies HMAC-SHA256 hex of raw body with timing-safe compare per spec §12.4 | `[ ]` |
| 5.8-J.23 | Parse payload; extract `event`, `task_id`, `history_items` | `[ ]` |
| 5.8-J.24 | Find all matching `TicketLink`s for `(installId, externalId=task_id)` | `[ ]` |
| 5.8-J.25 | `taskStatusUpdated` handler: invoke `InboundSyncService.refreshTicket(link.id, 'WEBHOOK')` for each matched link | `[ ]` |
| 5.8-J.26 | `taskMoved` handler: same — refresh pulled (list may have changed) | `[ ]` |
| 5.8-J.27 | `taskDeleted` handler: soft-delete `TicketLink`s; fire `TICKET_DELETED_UPSTREAM` notification to `QA_ENGINEER`+`TECH_LEAD` | `[ ]` |
| 5.8-J.28 | Unknown event types → `{ handled: false, eventType }` — logged but no error | `[ ]` |
| 5.8-J.29 | Register `webhookListener` in ClickUp plugin manifest | `[ ]` |

**Endpoint rotation + admin UI**

| # | Item | Status |
|---|------|--------|
| 5.8-J.30 | `POST /api/v1/plugin-installs/:id/webhook/rotate` — generates new path token + signing secret; registers new webhook upstream; old path continues to accept for 1h grace (dual-endpoint period) | `[ ]` |
| 5.8-J.31 | `GET /api/v1/plugin-installs/:id/webhook/events?limit=50&eventType=&result=` — returns recent `WebhookEvent` rows for admin debugging | `[ ]` |
| 5.8-J.32 | Admin UI: plugin install page gains "Webhooks" accordion — shows endpoint URL, subscribed events, last-called timestamp, `[Rotate]`, `[Disable]` buttons, recent events table | `[ ]` |
| 5.8-J.33 | Recent events table: columns `at`, `event`, `externalId`, `result`, click row → JSON payload panel (stored in `payloadStore` if enabled) | `[ ]` |

**Retention + cleanup**

| # | Item | Status |
|---|------|--------|
| 5.8-J.34 | BullMQ repeatable job `webhook-event-cleanup` — daily 03:00 UTC; deletes `WebhookEvent` rows older than 30 days | `[ ]` |
| 5.8-J.35 | Env `WEBHOOK_EVENT_RETENTION_DAYS=30` — configurable | `[ ]` |

**Testing**

| # | Item | Status |
|---|------|--------|
| 5.8-J.36 | Contract test: `webhookListener` rejects invalid HMAC signature with 401 | `[ ]` |
| 5.8-J.37 | Contract test: `taskStatusUpdated` payload with matched TicketLink → dispatches `refreshTicket` (spied) | `[ ]` |
| 5.8-J.38 | Contract test: `taskDeleted` soft-deletes TicketLink | `[ ]` |
| 5.8-J.39 | Contract test: duplicate `payloadDigest` within 5 min → `result=ignored-duplicate` | `[ ]` |
| 5.8-J.40 | Integration test: install ClickUp plugin → `POST /team/:wid/webhook` called with correct endpoint URL (mocked); endpoint row persisted with upstream id + secret | `[ ]` |
| 5.8-J.41 | Integration test: simulate `taskStatusUpdated` POST to receiver → TicketLink updated via InboundSyncService → notification fired | `[ ]` |
| 5.8-J.42 | Integration test: 11 bad-signature requests in 1h → endpoint disabled → ORG_ADMIN notification fired | `[ ]` |
| 5.8-J.43 | Integration test: rotate endpoint → old path accepts for 1h, new path accepts immediately, after 1h old path returns 404 | `[ ]` |
| 5.8-J.44 | Manual test MT-WEBHOOKS: configure against real ClickUp workspace — change task status → platform snag updates within 5s without manual refresh | `[ ]` |

---

#### §5.8-K — Jira Plugin (registry-native)

> Spec: `docs/JIRA_INTEGRATION.md`
> Build after §5.8-A foundation and preferably after §5.8-C (ClickUp core), reusing shared plugin infrastructure and UI components.

| # | Item | Status |
|---|------|--------|
| 5.8-K.1 | Create `apps/api/src/plugins/jira/index.ts` manifest with capabilities: `createIssue`, `linkTicket`, `pullTicketStatus`, `syncPhaseStatus`, `fetchTicketContext`, `webhookListener` | `[ ]` |
| 5.8-K.2 | Add `jira/schemas.ts` — `configSchema`, `secretsSchema`, `bindingConfigSchema`; include project key, issue type, labels, assignee strategy, webhook toggle | `[ ]` |
| 5.8-K.3 | Add `jira/lifecycle.ts` with `healthCheck` (Jira auth probe) and `onEnable` / `onDisable` webhook registration hooks | `[ ]` |
| 5.8-K.4 | Register Jira plugin in `apps/api/src/plugins/registry.ts`; add `apps/web/public/plugin-icons/jira.svg` | `[ ]` |
| 5.8-K.5 | Contract test: manifest registration + health check success/failure + schema validation errors | `[ ]` |
| 5.8-K.6 | Implement `jira/implementations/create-issue.ts` — create Jira issue with structured QA payload and evidence attachment support | `[ ]` |
| 5.8-K.7 | Reuse attachment fallback logic from ClickUp path: recordings above threshold become signed URL links in issue description | `[ ]` |
| 5.8-K.8 | Persist `TicketLink` on Jira issue creation (`externalId`, `externalUrl`, `externalStatus`) | `[ ]` |
| 5.8-K.9 | Implement `jira/implementations/link-ticket.ts` — accept Jira URL or issue key and upsert TicketLink | `[ ]` |
| 5.8-K.10 | Implement `jira/implementations/pull-ticket-status.ts` — fetch current issue status/assignee/updated timestamp for inbound sync | `[ ]` |
| 5.8-K.11 | Wire `InboundSyncService` to support Jira install IDs in same refresh flow used by ClickUp (`MANUAL_REFRESH`, `WEBHOOK`, `BULK_SYNC`) | `[ ]` |
| 5.8-K.12 | Implement `jira/implementations/sync-phase-status.ts` using `PluginStatusMapping` outbound rules; no hardcoded status names | `[ ]` |
| 5.8-K.13 | Implement `jira/implementations/fetch-ticket-context.ts` — summary, acceptance criteria/body, recent comments for AI context injection | `[ ]` |
| 5.8-K.14 | Implement `jira/implementations/webhook-listener.ts` — verify signature/auth, parse issue events, dispatch refresh per linked ticket | `[ ]` |
| 5.8-K.15 | Reuse generic webhook controller + `PluginWebhookEndpoint` + `WebhookEvent` audit path from §5.8-J | `[ ]` |
| 5.8-K.16 | Add Jira-specific project binding UI hints and async field options (project -> issue type -> optional transition list) | `[ ]` |
| 5.8-K.17 | Project settings Integrations tab: Jira capability toggles and status-mapping grid use existing registry UI components | `[ ]` |
| 5.8-K.18 | Failure panel "Create Ticket" flow lists Jira installs via capability picker; no Jira hardcoding in UI action layer | `[ ]` |
| 5.8-K.19 | Findings/Issue tracker "Push to external" flow supports Jira through `createIssue` dispatch | `[ ]` |
| 5.8-K.20 | Add bulk-refresh job support for Jira using provider-appropriate changed-since filters; rate-limited by plugin token bucket | `[ ]` |
| 5.8-K.21 | Unit test: enablement guard hides Jira surfaces when any of the four levels fails | `[ ]` |
| 5.8-K.22 | Integration test: install Jira -> bind project -> create issue -> link + refresh -> webhook update reflected in platform | `[ ]` |
| 5.8-K.23 | Integration test: disable Jira mid-flight -> webhook short-circuits with `ignored-plugin-disabled`; no side effects | `[ ]` |
| 5.8-K.24 | Manual test: real Jira workspace end-to-end flow from failure panel to linked ticket updates and phase-sync | `[ ]` |

---

### §5.M — In-App Notifications & Email System

> **Spec:** `docs/IN_APP_NOTIFICATIONS.md`
> **Depends on:** Phase 3-A (Socket.io gateway), Phase 5.3 (external integrations), Phase 5.I (phase engine events), Phase 5.L (PM tool events)

**Data Models**

| # | Item | Status |
|---|------|--------|
| 5.M.1 | Add `NotificationType` and `NotificationCategory` enums to Prisma schema | `[ ]` |
| 5.M.2 | Add `Notification` model: orgId, userId, type, category, title, body, isRead, readAt, actionUrl, actionLabel, secondaryActionUrl, secondaryActionLabel, meta, expiresAt | `[ ]` |
| 5.M.3 | Add `NotificationPreference` model: userId, type, inApp, email, emailDigest — unique on [userId, type] | `[ ]` |
| 5.M.4 | Add `NotificationMute` model: userId, projectId, mutedAt, expiresAt — unique on [userId, projectId] | `[ ]` |
| 5.M.5 | Add `EmailDeliveryLog` model: to, subject, template, status, errorDetail, sentAt | `[ ]` |
| 5.M.6 | Migration: create all five new tables; add indexes on `[userId, isRead, createdAt]` and `[orgId, createdAt]` | `[ ]` |

**NotificationService Core**

| # | Item | Status |
|---|------|--------|
| 5.M.7 | `NotificationsService.create(input)` — recipient resolution (explicit userIds / role-based / all project members), mute check, preference check, DB write, socket emit, email queue | `[ ]` |
| 5.M.8 | `resolveRecipients()` — explicit userIds > role-based > all project members fallback | `[ ]` |
| 5.M.9 | `isMuted(userId, projectId)` — checks `NotificationMute` with expiry awareness | `[ ]` |
| 5.M.10 | `getPreferences(userId, type)` — returns `NotificationPreference` record or system default if no record exists | `[ ]` |
| 5.M.11 | System defaults table — implement the default matrix from §8.2 of the spec | `[ ]` |
| 5.M.12 | Title + body rendering — `renderTitle(input)` and `renderBody(input)` using template strings per NotificationType | `[ ]` |
| 5.M.13 | `categoryFor(type)` — maps each NotificationType to its NotificationCategory | `[ ]` |

**NotificationsGateway (Socket.io)**

| # | Item | Status |
|---|------|--------|
| 5.M.14 | `NotificationsGateway` — emits `notification:new`, `notification:read`, `notification:read-all`, `notification:deleted` to `user:{userId}` room | `[ ]` |
| 5.M.15 | `join:user-room` handler — adds authenticated socket to `user:{userId}` room on connection | `[ ]` |

**Event Wiring**

| # | Item | Status |
|---|------|--------|
| 5.M.16 | Wire `NotificationService.create()` into `RunsService.handleRunComplete()` — fires FEATURE_RUN_PASSED / FAILED / PARTIAL | `[ ]` |
| 5.M.17 | Wire into `PhaseEngine` — FEATURE_PROMOTED, PHASE_REQUIRES_SIGN_OFF, FEATURE_SIGNED_OFF, PHASE_FAILED | `[ ]` |
| 5.M.18 | Wire into `PhaseAssignmentsService` — ASSIGNED_TO_PHASE | `[ ]` |
| 5.M.19 | Wire into `ProjectMembersService` — ADDED_TO_PROJECT, ROLE_CHANGED | `[ ]` |
| 5.M.20 | Wire into `AccessRequestsService` — ACCESS_REQUEST_SUBMITTED, APPROVED, REJECTED | `[ ]` |
| 5.M.21 | Wire into `InvitesService` — INVITE_ACCEPTED | `[ ]` |
| 5.M.22 | Wire into `SelectorHealService` — SELECTOR_HEALS_DETECTED (fires when healCount ≥ 1 on a completed run) | `[ ]` |
| 5.M.23 | Wire into `FlakyDetectionService` — FLAKY_TEST_FLAGGED | `[ ]` |
| 5.M.24 | Wire into `ScheduledReportService` — SCHEDULED_REPORT_READY | `[ ]` |
| 5.M.25 | Wire into environment health-check service — ENVIRONMENT_UNREACHABLE | `[ ]` |
| 5.M.26 | Wire into integration delivery failure handler — INTEGRATION_FAILED | `[ ]` |

**Notification REST API**

| # | Item | Status |
|---|------|--------|
| 5.M.27 | `GET /api/v1/notifications` — paginated list (query: status, category, projectId); 20/page; user-scoped | `[ ]` |
| 5.M.28 | `GET /api/v1/notifications/unread-count` — `{ count: number }` — used on socket reconnect | `[ ]` |
| 5.M.29 | `PATCH /api/v1/notifications/:id/read` — mark single read, emit `notification:read` with new unread count | `[ ]` |
| 5.M.30 | `PATCH /api/v1/notifications/read-all` — mark all read, emit `notification:read-all` | `[ ]` |
| 5.M.31 | `DELETE /api/v1/notifications/:id` — soft delete (set deletedAt) | `[ ]` |
| 5.M.32 | `DELETE /api/v1/notifications/clear-read` — delete all read notifications older than 30 days for calling user | `[ ]` |
| 5.M.33 | `GET /api/v1/notifications/preferences` — return all preference records + system defaults for missing types | `[ ]` |
| 5.M.34 | `PATCH /api/v1/notifications/preferences` — upsert preference records for submitted types | `[ ]` |
| 5.M.35 | `POST /api/v1/notifications/preferences/reset` — delete all preference records for user (falls back to defaults) | `[ ]` |
| 5.M.36 | `GET /api/v1/notifications/mutes` — list muted projects (with project name) | `[ ]` |
| 5.M.37 | `POST /api/v1/notifications/mutes` — create mute record `{ projectId, expiresAt? }` | `[ ]` |
| 5.M.38 | `DELETE /api/v1/notifications/mutes/:projectId` — delete mute record | `[ ]` |

**Frontend — Bell Icon + Panel**

| # | Item | Status |
|---|------|--------|
| 5.M.39 | `NotificationBell` component in TopNav — shows badge count (red if any failure/phase-fail unread, amber otherwise, hidden if 0) | `[ ]` |
| 5.M.40 | Real-time unread count via Socket.io `notification:new` event — increments badge; `notification:read-all` resets to 0 | `[ ]` |
| 5.M.41 | `NotificationPanel` dropdown — opens on bell click, closes on outside click / Escape | `[ ]` |
| 5.M.42 | Panel content: 10 most recent notifications, grouped by day (Today / Yesterday / date label) | `[ ]` |
| 5.M.43 | Unread indicator (blue dot), blue ring on panel open triggers mark-as-read after 1 second | `[ ]` |
| 5.M.44 | Per-notification CTA buttons rendered from `actionLabel` / `secondaryActionLabel` fields | `[ ]` |
| 5.M.45 | `[Mark all read]` button — optimistic update + `PATCH /notifications/read-all` | `[ ]` |
| 5.M.46 | `[⚙ Prefs]` button — navigates to `/settings/notifications` | `[ ]` |
| 5.M.47 | Empty state — "You're all caught up 🎉" | `[ ]` |
| 5.M.48 | Loading state — 3 skeleton rows | `[ ]` |

**Frontend — Toast Notifications**

| # | Item | Status |
|---|------|--------|
| 5.M.49 | `NotificationToast` component — slides in from bottom-right on `notification:new` socket event | `[ ]` |
| 5.M.50 | Auto-dismiss: 6 seconds normal / 10 seconds for FAILED and PHASE_REQUIRES_SIGN_OFF types | `[ ]` |
| 5.M.51 | Hover pauses dismiss timer; `[✕]` dismisses immediately | `[ ]` |
| 5.M.52 | Max 3 toasts stacked; oldest dismissed first when limit reached | `[ ]` |
| 5.M.53 | Red left border for failure types; CTA button navigates and dismisses | `[ ]` |
| 5.M.54 | Suppress toast when panel already open or user is already on `actionUrl` | `[ ]` |

**Frontend — Full Notifications Page**

| # | Item | Status |
|---|------|--------|
| 5.M.55 | `/notifications` page with filter bar (read status, category, project) | `[ ]` |
| 5.M.56 | Filter state synced to URL query params for shareable links + browser back | `[ ]` |
| 5.M.57 | Infinite scroll — loads 20 items per page, appends on scroll near bottom | `[ ]` |
| 5.M.58 | Full notification cards with expanded body, all CTA buttons, three-dot menu (mark read, dismiss, mute project) | `[ ]` |
| 5.M.59 | Mute project from three-dot menu — creates mute record and removes project's notifications from current view | `[ ]` |
| 5.M.60 | Muted projects banner at top of page; unmute links | `[ ]` |

**Frontend — Preferences UI**

| # | Item | Status |
|---|------|--------|
| 5.M.61 | `/settings/notifications` page — grouped preference table (Run / Phase / AI / Team / Report / System) | `[ ]` |
| 5.M.62 | Three checkboxes per row: In-App / Email / Daily Digest | `[ ]` |
| 5.M.63 | Daily digest time picker + timezone selector | `[ ]` |
| 5.M.64 | `[Restore defaults]` button with confirmation | `[ ]` |
| 5.M.65 | Saves via `PATCH /notifications/preferences`; success toast on save | `[ ]` |

**Email Infrastructure**

| # | Item | Status |
|---|------|--------|
| 5.M.66 | Install `@nestjs-modules/mailer` + `nodemailer` + `handlebars` | `[ ]` |
| 5.M.67 | `EmailService` with `sendMail(job: EmailJob)` — renders Handlebars template, sends via SMTP | `[ ]` |
| 5.M.68 | BullMQ `emails` queue — `EmailWorker` processor with 3 retries, exponential backoff | `[ ]` |
| 5.M.69 | `EmailDeliveryLog` write on success and on final failure | `[ ]` |
| 5.M.70 | Base email template (`base.hbs`) — platform logo, org name header, content slot, unsubscribe footer with signed token | `[ ]` |
| 5.M.71 | `UnsubscribeService` — signed token generation + validation; `POST /api/v1/auth/unsubscribe?token=` sets preferences | `[ ]` |
| 5.M.72 | Admin Panel → Email tab — delivery log table (last 200 entries), retry failed button | `[ ]` |

**Email Templates** (one Handlebars file per template in `apps/api/src/email/templates/`)

| # | Template | Status |
|---|----------|--------|
| 5.M.73 | `password-reset.hbs` | `[ ]` |
| 5.M.74 | `email-verification.hbs` | `[ ]` |
| 5.M.75 | `org-invite.hbs` | `[ ]` |
| 5.M.76 | `access-request.hbs` (to admin) | `[ ]` |
| 5.M.77 | `access-approved.hbs` | `[ ]` |
| 5.M.78 | `access-rejected.hbs` | `[ ]` |
| 5.M.79 | `added-to-project.hbs` | `[ ]` |
| 5.M.80 | `run-failed.hbs` — pass/fail counts, per-test rows, AI summary, screenshot thumbnail | `[ ]` |
| 5.M.81 | `run-passed.hbs` — minimal pass confirmation | `[ ]` |
| 5.M.82 | `scheduled-report.hbs` — stats, feature breakdown table, top failures, PDF attachment | `[ ]` |
| 5.M.83 | `phase-handover.hbs` — phase summary, assignees, handover notes, PDF attachment | `[ ]` |
| 5.M.84 | `sign-off-required.hbs` — phase summary, sign-off CTA | `[ ]` |
| 5.M.85 | `feature-signed-off.hbs` — sign-off details, all phases summary | `[ ]` |
| 5.M.86 | `flaky-test.hbs` — flip rate, last N results, AI root cause | `[ ]` |
| 5.M.87 | `selector-heals.hbs` — table of healed selectors | `[ ]` |
| 5.M.88 | `session-report.hbs` — duration, features tested, AI summary, PDF attachment | `[ ]` |
| 5.M.89 | `env-unreachable.hbs` — base URL, error, check environment CTA | `[ ]` |
| 5.M.90 | `daily-digest.hbs` — all digest-queued notifications grouped by category | `[ ]` |

**Digest Service**

| # | Item | Status |
|---|------|--------|
| 5.M.91 | `DigestService.addToDigest(userId, input)` — stores digest-flagged notifications in a Redis sorted set keyed by userId + scheduled send time | `[ ]` |
| 5.M.92 | BullMQ repeatable job: fires at each user's configured digest time; reads Redis digest set; renders `daily-digest.hbs`; sends email; clears set | `[ ]` |

**Cleanup**

| # | Item | Status |
|---|------|--------|
| 5.M.93 | BullMQ cron job: delete `Notification` records older than 90 days nightly | `[ ]` |
| 5.M.94 | BullMQ cron job: expire `NotificationMute` records where `expiresAt < now()` nightly | `[ ]` |

---

## Phase 6 — Multi-Tenancy, RBAC & Navigation Shell

See full specs: `docs/MULTI_TENANCY_AND_RBAC.md` · `docs/UI_LAYOUT.md`

### 6.0 Organisation (Tenant) Model

**Database & API**

| # | Item | Status |
|---|------|--------|
| 6.0.1 | Add `Organisation` model: id, name, slug (unique), logoUrl, createdAt | `[ ]` |
| 6.0.2 | Add `OrgRole` enum (`ORG_ADMIN`, `ORG_MEMBER`) and `OrgMember` join table | `[ ]` |
| 6.0.3 | Add `PlatformRole` enum (`USER`, `PLATFORM_ADMIN`) to `User` model | `[ ]` |
| 6.0.4 | Add `lastActiveOrgId String?` to `User` model | `[ ]` |
| 6.0.5 | Add `isActive Boolean @default(true)` to `User` model (soft deactivation) | `[ ]` |
| 6.0.6 | Add `orgId` foreign key to `Project`, `PlatformConfig`, `AuditLog` | `[ ]` |
| 6.0.7 | Create `OrganisationsModule` with CRUD endpoints (`POST`, `GET`, `PATCH`, `DELETE /organisations`) | `[ ]` |
| 6.0.8 | `POST /organisations` — create org, set creator as `ORG_ADMIN`, set `User.lastActiveOrgId` | `[ ]` |
| 6.0.9 | `PATCH /auth/me` — accept `activeOrgId`; validate user is a member before setting | `[ ]` |
| 6.0.10 | Add `OrgScopeInterceptor` — injects `req.orgId` from `user.lastActiveOrgId` on every request | `[ ]` |
| 6.0.11 | Apply org scope to all service queries: Project, Module, Feature, TestDefinition, TestRun, etc. | `[ ]` |
| 6.0.12 | Unit test: org scope interceptor blocks cross-org data access | `[ ]` |
| 6.0.13 | Integration test: user in two orgs sees separate project lists | `[ ]` |

**Invite flow**

| # | Item | Status |
|---|------|--------|
| 6.0.14 | Add `OrgInvite` model: orgId, email, role, token (uuid), expiresAt (72h), acceptedAt | `[ ]` |
| 6.0.15 | `POST /organisations/:id/invites` — generate token, send invite email | `[ ]` |
| 6.0.16 | `GET /invites/:token` — validate token, return org name + inviter name for accept page | `[ ]` |
| 6.0.17 | `POST /invites/:token/accept` — creates `OrgMember`, marks invite accepted; creates User if new | `[ ]` |
| 6.0.18 | `DELETE /organisations/:id/invites/:id` — revoke pending invite | `[ ]` |
| 6.0.19 | Unit test: expired invite token rejected, accepted invite cannot be used twice | `[ ]` |

### 6.1 RBAC Guards & Project Scoping

| # | Item | Status |
|---|------|--------|
| 6.1.1 | Create `OrgRoleGuard` — checks `OrgMember.role` against required minimum | `[ ]` |
| 6.1.2 | Create `ProjectRoleGuard` — checks `ProjectMember.role`; ORG_ADMIN bypasses all project guards | `[ ]` |
| 6.1.3 | Apply guards to all project/module/feature/test endpoints per permission matrix | `[ ]` |
| 6.1.4 | `POST /projects/:id/members` — add org member to project with project role (OWNER only) | `[ ]` |
| 6.1.5 | `PATCH /projects/:id/members/:userId` — change project role (OWNER only) | `[ ]` |
| 6.1.6 | `DELETE /projects/:id/members/:userId` — remove from project (OWNER only) | `[ ]` |
| 6.1.7 | Frontend: hide action buttons based on current user's role (run, edit, delete, manage members) | `[ ]` |
| 6.1.8 | Unit test: each guard permits/rejects correct roles | `[ ]` |
| 6.1.9 | Integration test: QA_ENGINEER cannot access project settings endpoint | `[ ]` |

### 6.1.A Project Member Environment Access

> Extends §6.1. `ProjectMember.allowedEnvironmentIds String[]` restricts which
> environments a member can see and run tests against.

| # | Item | Status |
|---|------|--------|
| 6.1.A.1 | Add `allowedEnvironmentIds String[] @default([])` to `ProjectMember` model; migration | `[ ]` |
| 6.1.A.2 | `PATCH /projects/:id/members/:userId` — accept `allowedEnvironmentIds` alongside role; update record | `[ ]` |
| 6.1.A.3 | `EnvironmentsService.findAllForProject(projectId, requestingUserId)` — if caller is not OWNER/ORG_ADMIN and `allowedEnvironmentIds` is non-empty, filter result to allowed IDs only | `[ ]` |
| 6.1.A.4 | `RunsService.triggerRun()` — if caller has non-empty `allowedEnvironmentIds` and the requested `environmentId` is not in that list, throw `ForbiddenException` | `[ ]` |
| 6.1.A.5 | Add Member modal: "Environment access" section with `(●) All` / `( ) Restrict` radio; when restricted, show checkbox list of project environments | `[ ]` |
| 6.1.A.6 | Members table: "Environments" column — shows "All" or comma-list of env names; `[ Edit ]` opens inline popover | `[ ]` |
| 6.1.A.7 | Edit environment access popover: radio + checkbox list; saves via `PATCH /projects/:id/members/:userId` | `[ ]` |
| 6.1.A.8 | Run trigger dialog: environment dropdown shows only allowed envs for the current user; phase environments the member cannot access show 🔒 with tooltip "You don't have access to [env name]" | `[ ]` |
| 6.1.A.9 | Unit test: `findAllForProject` returns only allowed envs for restricted member | `[ ]` |
| 6.1.A.10 | Unit test: `triggerRun` throws 403 when environment not in `allowedEnvironmentIds` | `[ ]` |
| 6.1.A.11 | Unit test: OWNER and ORG_ADMIN bypass env restriction regardless of `allowedEnvironmentIds` value | `[ ]` |

### 6.2 User Management — Org Admin UI

| # | Item | Status |
|---|------|--------|
| 6.2.1 | `GET /organisations/:id/members` — list members with roles and last-active timestamp | `[ ]` |
| 6.2.2 | `PATCH /organisations/:id/members/:userId` — change org role (ORG_ADMIN only) | `[ ]` |
| 6.2.3 | `DELETE /organisations/:id/members/:userId` — remove from org; cascade-removes ProjectMember records | `[ ]` |
| 6.2.4 | `POST /organisations/:id/members/:userId/reset-password` — send reset email | `[ ]` |
| 6.2.5 | Create `UsersPage` (`/org/users`) — member table with role, last active, action menu | `[ ]` |
| 6.2.6 | **Invite User** modal: email, org role, optional project + project role fields | `[ ]` |
| 6.2.7 | **Change Role** inline select — updates immediately via PATCH | `[ ]` |
| 6.2.8 | **Remove from Org** with confirmation dialog | `[ ]` |
| 6.2.9 | **Reset Password** — sends email, shows success toast | `[ ]` |
| 6.2.10 | Pending invites shown in table with revoke button | `[ ]` |
| 6.2.11 | Component test: invite modal validation, role change, remove confirmation | `[ ]` |

### 6.3 Platform Admin Panel

| # | Item | Status |
|---|------|--------|
| 6.3.1 | `GET /admin/organisations` — list all orgs with member count, project count (PLATFORM_ADMIN only) | `[ ]` |
| 6.3.2 | `GET /admin/users` — global user search across all orgs, filterable by org/role/status | `[ ]` |
| 6.3.3 | `PATCH /admin/users/:id` — change `platformRole`, `isActive`, trigger password reset | `[ ]` |
| 6.3.4 | `DELETE /admin/users/:id` — hard delete (GDPR): remove user + personal data, anonymise audit log entries | `[ ]` |
| 6.3.5 | `GET /admin/organisations/:id` — view any org's members, projects, audit log | `[ ]` |
| 6.3.6 | `POST /admin/organisations` — create org (admin provisioning without signup) | `[ ]` |
| 6.3.7 | Admin panel guard: 403 for any user without `platformRole = PLATFORM_ADMIN` | `[ ]` |
| 6.3.8 | Create `AdminPage` (`/admin`) — org list with stats, global user search | `[ ]` |
| 6.3.9 | Admin org detail page — members table with platform-admin actions (deactivate, hard-delete, reset, promote) | `[ ]` |
| 6.3.10 | Sidebar: show `🛡 Platform Admin` link only when `user.platformRole === PLATFORM_ADMIN` | `[ ]` |
| 6.3.11 | Integration test: non-admin user gets 403 on all `/admin/*` routes | `[ ]` |
| 6.3.12 | Integration test: hard-delete removes user record, anonymises AuditLog entries | `[ ]` |

### 6.4 Audit Log

| # | Item | Status |
|---|------|--------|
| 6.4.1 | Add `AuditLog` model: orgId, userId, action (string), targetId, meta (Json), createdAt | `[ ]` |
| 6.4.2 | Write audit entries for: invite sent, member joined, role changed, member removed, user deactivated, project deleted | `[ ]` |
| 6.4.3 | `GET /organisations/:id/audit-log` — paginated, filterable by action/user (ORG_ADMIN only) | `[ ]` |
| 6.4.4 | Audit log tab in org settings UI — table with action, user, target, timestamp | `[ ]` |
| 6.4.5 | Unit test: audit entries created for each tracked action | `[ ]` |

### 6.5 Access Requests

**Backend**

| # | Item | Status |
|---|------|--------|
| 6.5.1 | Add `AccessRequestType` enum (`ORG`, `PROJECT`) and `AccessRequestStatus` enum (`PENDING`, `APPROVED`, `REJECTED`) | `[ ]` |
| 6.5.2 | Add `AccessRequest` model: type, orgId, projectId?, requesterId, status, message, grantedRole, reviewedById, reviewerNote, reviewedAt | `[ ]` |
| 6.5.3 | `POST /organisations/:id/access-requests` — any authenticated non-member can submit; prevent duplicate pending requests | `[ ]` |
| 6.5.4 | `GET /organisations/:id/access-requests` — list pending requests (ORG_ADMIN only), paginated | `[ ]` |
| 6.5.5 | `PATCH /organisations/:id/access-requests/:id` — approve (creates OrgMember with `grantedRole`) or reject with optional note (ORG_ADMIN only) | `[ ]` |
| 6.5.6 | `POST /projects/:id/access-requests` — org member submits project access request | `[ ]` |
| 6.5.7 | `GET /projects/:id/access-requests` — list pending (OWNER or ORG_ADMIN) | `[ ]` |
| 6.5.8 | `PATCH /projects/:id/access-requests/:id` — approve (creates ProjectMember) or reject | `[ ]` |
| 6.5.9 | `GET /me/access-requests` — current user's own submitted requests with status | `[ ]` |
| 6.5.10 | On approval: send email to requester ("Your access request was approved") | `[ ]` |
| 6.5.11 | On rejection: send email to requester with reviewer note if provided | `[ ]` |
| 6.5.12 | Notify ORG_ADMIN (in-app bell + email) when new org access request submitted | `[ ]` |
| 6.5.13 | Notify project OWNERs when new project access request submitted | `[ ]` |
| 6.5.14 | Write audit log entries: `access_request.approved`, `access_request.rejected` | `[ ]` |
| 6.5.15 | Unit test: duplicate pending request prevented; approval creates member record | `[ ]` |
| 6.5.16 | Unit test: non-admin cannot approve requests | `[ ]` |

**Frontend**

| # | Item | Status |
|---|------|--------|
| 6.5.17 | Public org join page `/join/:orgSlug` — shows org name, "Request Access" form with optional message | `[ ]` |
| 6.5.18 | "Request Access" button on project cards for org members without project access | `[ ]` |
| 6.5.19 | Pending Requests tab in org Settings → Members (ORG_ADMIN) — table with user, message, review modal | `[ ]` |
| 6.5.20 | Review modal: role selector, optional reviewer note, Approve / Reject buttons | `[ ]` |
| 6.5.21 | Pending Requests tab in project Members page (OWNER / ORG_ADMIN) | `[ ]` |
| 6.5.22 | User's own request status visible in notifications bell and `/me/access-requests` | `[ ]` |
| 6.5.23 | Component test: request form submits, review modal approves/rejects, correct API calls fired | `[ ]` |

### 6.6 SSO — Google & Microsoft Login

**Backend**

| # | Item | Status |
|---|------|--------|
| 6.6.1 | Install `passport-google-oauth20` and `@types/passport-google-oauth20` | `[ ]` |
| 6.6.2 | Install `passport-azure-ad` for Microsoft / Azure AD OIDC | `[ ]` |
| 6.6.3 | Add `UserSsoAccount` model: userId, provider (`google`\|`microsoft`), providerId, email, linkedAt | `[ ]` |
| 6.6.4 | Add `ssoDomain String?`, `ssoEnforced Boolean @default(false)` to `Organisation` model | `[ ]` |
| 6.6.5 | Add `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` and `AZURE_AD_CLIENT_ID/SECRET/TENANT_ID/CALLBACK_URL` env vars | `[ ]` |
| 6.6.6 | Create `GoogleStrategy` — on validate: call `AuthService.findOrCreateSsoUser({ provider, providerId, email, name, avatarUrl })` | `[ ]` |
| 6.6.7 | Create `MicrosoftStrategy` (OIDCStrategy) — same `findOrCreateSsoUser` call | `[ ]` |
| 6.6.8 | `AuthService.findOrCreateSsoUser`: look up by `UserSsoAccount.providerId` first, then by email, then create new user | `[ ]` |
| 6.6.9 | On existing user found by email (no SSO link yet): auto-link `UserSsoAccount` and log in | `[ ]` |
| 6.6.10 | On new user created via SSO: check `Organisation.ssoDomain` against email domain; if match, auto-create `OrgMember` | `[ ]` |
| 6.6.11 | `GET /auth/google` — redirect to Google OAuth (only if `GOOGLE_CLIENT_ID` is configured) | `[ ]` |
| 6.6.12 | `GET /auth/google/callback` — handle callback, issue JWT, redirect to app | `[ ]` |
| 6.6.13 | `GET /auth/microsoft` — redirect to Microsoft OAuth | `[ ]` |
| 6.6.14 | `GET /auth/microsoft/callback` — handle callback, issue JWT, redirect to app | `[ ]` |
| 6.6.15 | `POST /auth/sso/link` — link SSO provider to currently authenticated user (requires re-auth with provider) | `[ ]` |
| 6.6.16 | `DELETE /auth/sso/:provider` — unlink provider; reject if it is the user's only login method | `[ ]` |
| 6.6.17 | SSO enforcement: if `org.ssoEnforced = true`, reject password login for org members (return 403 with SSO redirect hint) | `[ ]` |
| 6.6.18 | Platform admins exempt from SSO enforcement (can always use password login) | `[ ]` |
| 6.6.19 | `PATCH /organisations/:id/settings` — allow ORG_ADMIN to set `ssoDomain` and `ssoEnforced` | `[ ]` |
| 6.6.20 | Update `.env.example` and `docker-compose.yml` with all SSO env vars | `[ ]` |
| 6.6.21 | Unit test: `findOrCreateSsoUser` — existing user linked, new user created, domain auto-join triggered | `[ ]` |
| 6.6.22 | Unit test: unlink last login method rejected | `[ ]` |
| 6.6.23 | Unit test: SSO-enforced org blocks password login for members | `[ ]` |
| 6.6.24 | Integration test: full Google OAuth callback creates user and issues valid JWT | `[ ]` |

**Frontend**

| # | Item | Status |
|---|------|--------|
| 6.6.25 | Login page: show "Continue with Google" button only if `GOOGLE_CLIENT_ID` is set (feature-flag via API config endpoint) | `[ ]` |
| 6.6.26 | Login page: show "Continue with Microsoft" button only if `AZURE_AD_CLIENT_ID` is set | `[ ]` |
| 6.6.27 | If SSO-enforced org detected from email domain on blur: hide password fields, show SSO-only message | `[ ]` |
| 6.6.28 | Settings → Security → Linked Accounts: show linked Google / Microsoft with unlink button, link button for unlinked providers | `[ ]` |
| 6.6.29 | Org Settings → Security tab: SSO domain input, "Enforce SSO" toggle with confirmation dialog | `[ ]` |
| 6.6.30 | Component test: login page shows/hides SSO buttons based on config, SSO-enforced org hides password form | `[ ]` |

### 6.7 Navigation Shell — Frontend

| # | Item | Status |
|---|------|--------|
| 6.5.1 | Create `AppShell` layout component: `TopNav` + `Sidebar` + `<Outlet />` | `[ ]` |
| 6.5.2 | `TopNav`: org switcher (left), search/⌘K trigger (centre), notifications bell, help, user avatar menu (right) | `[ ]` |
| 6.5.3 | Org switcher dropdown: list user's orgs with roles, "Create new org" link, active org checkmark | `[ ]` |
| 6.5.4 | Switching org calls `PATCH /auth/me { activeOrgId }`, updates React context, re-fetches org data | `[ ]` |
| 6.5.5 | `Sidebar` expanded (240px): section labels, nav items with icons, collapse button at bottom | `[ ]` |
| 6.5.6 | `Sidebar` collapsed (56px): icon rail, tooltip on hover, expand button | `[ ]` |
| 6.5.7 | Sidebar collapse state persisted to `localStorage` | `[ ]` |
| 6.5.8 | Sidebar: project sub-nav expands inline when inside a project route | `[ ]` |
| 6.5.9 | ⌘K Command Palette: fuzzy search across projects, features, recent runs; keyboard navigation | `[ ]` |
| 6.5.10 | Notifications dropdown: list recent run alerts, selector heal warnings, invite accepted events | `[ ]` |
| 6.5.11 | User avatar menu: name, email, "My Profile", "Settings", "Switch Org", "Sign out" | `[ ]` |
| 6.5.12 | `MANAGER` role: hide Edit/Run/Delete buttons across the UI | `[ ]` |
| 6.5.13 | `PLATFORM_ADMIN` sidebar item visible only to platform admins | `[ ]` |
| 6.5.14 | Responsive: sidebar becomes overlay drawer on viewport < 1024px | `[ ]` |
| 6.5.15 | Component test: org switcher renders correct orgs, fires PATCH on select | `[ ]` |
| 6.5.16 | Component test: sidebar collapse/expand, active route highlighted | `[ ]` |
| 6.5.17 | Component test: ⌘K palette opens, results filtered on input | `[ ]` |

### 6.8 Organisation Dashboard (Landing Page)

| # | Item | Status |
|---|------|--------|
| 6.6.1 | `GET /organisations/:id/stats` — projects count, 7-day pass rate, currently failing count, selector heals today | `[ ]` |
| 6.6.2 | `GET /organisations/:id/projects/summary` — per-project: last run status, pass rate, last run time | `[ ]` |
| 6.6.3 | `GET /organisations/:id/activity` — recent events: run completed, member joined, selector heals | `[ ]` |
| 6.6.4 | Create `OrgDashboard` page — 4 stat widgets, project card grid, recent activity feed | `[ ]` |
| 6.6.5 | Project card: name, module/feature counts, pass rate bar, last run badge, "Open" + "Run Now" CTA | `[ ]` |
| 6.6.6 | Project card states: running (pulsing border), failed (red), passed (green), never run (gray) | `[ ]` |
| 6.6.7 | Redirect `/` to org dashboard for authenticated users | `[ ]` |
| 6.6.8 | "Create your organisation" onboarding screen for new users with no org | `[ ]` |
| 6.6.9 | Component test: dashboard renders stat widgets, project cards, activity feed | `[ ]` |

---

## Phase 7 — Operational Readiness

> Reference: `docs/WORKER_ARCHITECTURE.md`

### 7.1 Worker Concurrency & Queue Architecture

**Goal:** Support many simultaneous automated test runs across multiple users/orgs without crashing the server or letting one tenant starve others.

#### 7.1.1 BullMQ Queue Setup

| # | Item | Status |
|---|------|--------|
| 7.1.1 | Install `bullmq` and `ioredis` packages in the API and worker services | `[ ]` |
| 7.1.2 | Create `QueueModule` (NestJS) that exports a `testRunQueue` BullMQ Queue | `[ ]` |
| 7.1.3 | Define three named queues: `test-run:immediate`, `test-run:scheduled`, `test-run:ci` | `[ ]` |
| 7.1.4 | Publish a `RUN_REQUESTED` job to the queue from the existing `POST /runs` endpoint (replace direct execution) | `[ ]` |
| 7.1.5 | Job payload schema: `{ runId, orgId, projectId, featureId, environmentId, priority, triggeredBy }` | `[ ]` |
| 7.1.6 | Store `jobId` on the `TestRun` record so status can be looked up from the queue | `[ ]` |
| 7.1.7 | Set per-org BullMQ rate limiter: max 5 concurrent jobs per `orgId` group key | `[ ]` |
| 7.1.8 | Set global queue concurrency ceiling via `MAX_CONCURRENT_RUNS` env var (default: 20) | `[ ]` |
| 7.1.9 | Add exponential back-off retry config: 3 attempts, 2s / 8s / 32s delays | `[ ]` |
| 7.1.10 | Configure dead-letter queue (`test-run:dlq`) for jobs that exhaust all retries | `[ ]` |

#### 7.1.2 Worker Pool Manager

| # | Item | Status |
|---|------|--------|
| 7.1.11 | Create standalone `worker` NestJS app (already scaffolded) — confirm it connects to BullMQ and processes jobs | `[ ]` |
| 7.1.12 | Implement `WorkerPoolManager` service: tracks active browser context count, enforces `MAX_BROWSERS_PER_WORKER` ceiling | `[ ]` |
| 7.1.13 | Implement `BrowserContextPool`: allocates/releases Playwright browser contexts with semaphore guard | `[ ]` |
| 7.1.14 | On job pickup, `WorkerPoolManager.acquire()` reserves a slot — if pool is full, job waits in BullMQ (not in memory) | `[ ]` |
| 7.1.15 | On job complete/fail, `WorkerPoolManager.release()` frees the slot and closes the browser context | `[ ]` |
| 7.1.16 | Add Playwright launch options: `--disable-dev-shm-usage`, headless, no-sandbox (for Docker) | `[ ]` |
| 7.1.17 | Set per-context memory cap via `BROWSER_CONTEXT_MEMORY_MB` env var (default: 256); log warning if exceeded | `[ ]` |
| 7.1.18 | Implement context timeout watchdog: kill context and fail job if step takes longer than `STEP_TIMEOUT_MS` (default: 30 000) | `[ ]` |
| 7.1.19 | Implement run-level timeout watchdog: abort entire run if total duration exceeds `RUN_TIMEOUT_MS` (default: 300 000) | `[ ]` |

#### 7.1.3 Per-Org Fair Queuing

| # | Item | Status |
|---|------|--------|
| 7.1.20 | Implement `FairQueueScheduler`: on each dequeue cycle, select next org in round-robin order from active-org ring | `[ ]` |
| 7.1.21 | Track active-org ring in Redis (`queue:fair:orgs` sorted set, score = last dequeue timestamp) | `[ ]` |
| 7.1.22 | When an org's job is picked, update its score to `Date.now()` so it moves to the back of the ring | `[ ]` |
| 7.1.23 | Add `orgId` as BullMQ job group key so native group-based rate limiting also applies | `[ ]` |
| 7.1.24 | Integration test: enqueue 10 jobs from Org A and 2 jobs from Org B — verify Org B's jobs are not starved | `[ ]` |

#### 7.1.4 Horizontal Worker Scaling

| # | Item | Status |
|---|------|--------|
| 7.1.25 | Add `worker` service to `docker-compose.yml` with `deploy: replicas: 2` for default horizontal scale | `[ ]` |
| 7.1.26 | Ensure `WORKER_ID` env var is auto-set (e.g., hostname) so each worker instance is identifiable in logs | `[ ]` |
| 7.1.27 | Confirm workers are stateless: all state (run progress, screenshots) written to shared DB/Redis/S3 | `[ ]` |
| 7.1.28 | Add `SCALE_WORKERS` make/bash command: `docker compose up --scale worker=N` with env-var guidance | `[ ]` |
| 7.1.29 | Document in `docs/WORKER_ARCHITECTURE.md`: how to add a worker node in production (separate VM, same Redis) | `[ ]` |

#### 7.1.5 Queue Visibility — Platform Admin UI

| # | Item | Status |
|---|------|--------|
| 7.1.30 | Add `GET /api/v1/admin/queue/stats` endpoint: returns `{ waiting, active, completed, failed, dlq }` per queue | `[ ]` |
| 7.1.31 | Add `GET /api/v1/admin/queue/jobs?status=active&page=1` endpoint: returns paginated active/waiting jobs | `[ ]` |
| 7.1.32 | Add `POST /api/v1/admin/queue/jobs/:jobId/retry` — requeue a DLQ job | `[ ]` |
| 7.1.33 | Add `DELETE /api/v1/admin/queue/jobs/:jobId` — remove a stuck job | `[ ]` |
| 7.1.34 | Platform Admin UI: "Queue Monitor" panel showing live queue depth bar chart (SSE polling every 5 s) | `[ ]` |
| 7.1.35 | Queue Monitor: active jobs table (jobId, orgName, featureName, duration, workerId) | `[ ]` |
| 7.1.36 | Queue Monitor: DLQ table with retry/dismiss actions | `[ ]` |
| 7.1.37 | Queue Monitor: per-org usage chart (last 24 h, stacked bar by org) | `[ ]` |

#### 7.1.6 Observability & Health

| # | Item | Status |
|---|------|--------|
| 7.1.38 | Emit BullMQ event listeners: log `active`, `completed`, `failed`, `stalled` events with structured JSON | `[ ]` |
| 7.1.39 | Expose `queue_depth{queue="immediate"}`, `queue_active`, `queue_failed` as Prometheus gauges on `/metrics` | `[ ]` |
| 7.1.40 | Add `worker_browser_contexts_active` and `worker_browser_contexts_pool_size` Prometheus gauges | `[ ]` |
| 7.1.41 | Health check `GET /health` on worker service: returns `{ status, activeContexts, queueDepth, uptime }` | `[ ]` |
| 7.1.42 | Stalled job detection: BullMQ `stalledInterval` 30 s; stalled jobs auto-requeued up to `maxStalledCount: 2` | `[ ]` |
| 7.1.43 | Alert threshold config: `QUEUE_DEPTH_ALERT_THRESHOLD` — emit a Notification (Slack/email) when breached | `[ ]` |

#### 7.1.7 Load & Stress Tests

| # | Item | Status |
|---|------|--------|
| 7.1.44 | Write load test script: enqueue 50 runs concurrently across 5 orgs; assert no run is dropped | `[ ]` |
| 7.1.45 | Measure P95 queue wait time under 50-run load; assert < 10 s on 2-worker setup | `[ ]` |
| 7.1.46 | Verify memory stays under `MAX_WORKER_MEMORY_MB` during 20-context load (monitor via `process.memoryUsage`) | `[ ]` |
| 7.1.47 | Verify fair-queuing: in mixed-org load test, no single org's wait time is more than 2× the median | `[ ]` |
| 7.1.48 | Kill one worker mid-run; verify BullMQ stalled detection re-assigns job to surviving worker within 60 s | `[ ]` |

---

### 7.2 Infrastructure & Deployment

| # | Item | Status |
|---|------|--------|
| 7.2.1 | Add `nginx.conf` for web service (SPA routing, gzip, cache headers) | `[ ]` |
| 7.2.2 | Add `GET /api/v1/health/full` — checks DB, Redis, disk space, queue depth | `[ ]` |
| 7.2.3 | Centralize logging with `nestjs-pino` or `winston` (JSON structured logs) | `[ ]` |
| 7.2.4 | Add `DATABASE_URL` connection pool settings to Prisma | `[ ]` |
| 7.2.5 | Add Prometheus metrics endpoint (`/metrics`) for queue depth, run counts | `[ ]` |
| 7.2.6 | Document backup procedure for PostgreSQL volume | `[ ]` |
| 7.2.7 | Add `.dockerignore` files for api and worker | `[ ]` |
| 7.2.8 | Add `README.md` at repo root with quickstart | `[ ]` |

---

## Phase 8 — AI Intelligence & Agentic Testing

> **Depends on:** Phase 3-F (Analytics), Phase 5.5 (RAG), Phase 5.6 (AI Recommendations)
> **Specs:** `docs/AI_INTELLIGENCE.md` · `docs/AGENTIC_AI_TESTING.md`

### 8.1 AI Duplicate Detection

Detect semantically similar test cases using embeddings + LLM confirmation. Prevents test bloat and wasted execution time.

**8.1.1 — Embedding & Similarity Infrastructure**

| # | Item | Status |
|---|------|--------|
| 8.1.1.1 | Add `embedding Vector(1536)?` column to `TestDefinition` model | `[ ]` |
| 8.1.1.2 | Create `buildTestEmbeddingText()` — canonical text from test name + description + step types + selectors + expected outcomes | `[ ]` |
| 8.1.1.3 | On test create/update: embed canonical text and store in `TestDefinition.embedding` | `[ ]` |
| 8.1.1.4 | Backfill job: `POST /projects/:id/duplicates/reindex` — embed all existing tests in project | `[ ]` |
| 8.1.1.5 | Cosine similarity query: find tests with similarity ≥ 0.85 in same project | `[ ]` |
| 8.1.1.6 | Unit test: embedding text includes all meaningful test fields | `[ ]` |
| 8.1.1.7 | Unit test: similarity query returns known duplicates from seed data | `[ ]` |

**8.1.2 — LLM Confirmation & Grouping**

| # | Item | Status |
|---|------|--------|
| 8.1.2.1 | Add `TestDuplicateGroup` model: projectId, status (PENDING/MERGED/DISMISSED) | `[ ]` |
| 8.1.2.2 | Add `TestDuplicateMember` model: groupId, testId, similarity, isCanonical | `[ ]` |
| 8.1.2.3 | Create `DuplicateDetectionService` — orchestrates embed → search → LLM confirm → group | `[ ]` |
| 8.1.2.4 | LLM confirmation prompt: "Are these two test cases functionally equivalent?" → `{ equivalent, reason, overlap }` | `[ ]` |
| 8.1.2.5 | `POST /projects/:id/duplicates/scan` — trigger full project duplicate scan (BullMQ job) | `[ ]` |
| 8.1.2.6 | `GET /projects/:id/duplicates` — list duplicate groups with test details | `[ ]` |
| 8.1.2.7 | `PATCH /duplicates/:groupId` — update status (dismiss) | `[ ]` |
| 8.1.2.8 | `POST /duplicates/:groupId/merge` — keep canonical test, soft-delete rest, update references | `[ ]` |
| 8.1.2.9 | Unit test: LLM confirmation correctly identifies true duplicates vs similar-but-different tests | `[ ]` |
| 8.1.2.10 | Integration test: full scan → group creation → merge flow | `[ ]` |

**8.1.3 — Duplicate Detection UI**

| # | Item | Status |
|---|------|--------|
| 8.1.3.1 | Test editor: "Similar tests found" warning banner when creating/editing a test (real-time similarity check) | `[ ]` |
| 8.1.3.2 | Similar tests panel: expandable list showing matched tests with similarity score and side-by-side diff | `[ ]` |
| 8.1.3.3 | Project → Duplicates tab: list of duplicate groups with member tests, similarity scores | `[ ]` |
| 8.1.3.4 | Group actions: "Choose Canonical" radio per test, "Merge" button, "Dismiss" button | `[ ]` |
| 8.1.3.5 | Bulk scan trigger button with progress indicator | `[ ]` |
| 8.1.3.6 | Component test: warning banner appears for similar test, merge action removes duplicates from list | `[ ]` |

### 8.2 Test Value Scoring

Score each test on defect-finding value vs maintenance cost. Enables data-driven decisions about which tests to keep, fix, or retire.

**8.2.1 — Scoring Engine**

| # | Item | Status |
|---|------|--------|
| 8.2.1.1 | Add `TestValueScore` model: testId, projectId, score (0-100), tier, defectSignal, stabilitySignal, maintenanceSignal, coverageSignal, sampleSize, computedAt | `[ ]` |
| 8.2.1.2 | Add `TestValueTier` enum: ESSENTIAL (80-100), VALUABLE (60-79), MARGINAL (40-59), LOW_VALUE (20-39), RETIRE (0-19) | `[ ]` |
| 8.2.1.3 | Create `ValueScoringService` — computes TVS from four signals | `[ ]` |
| 8.2.1.4 | Defect signal (weight 0.35): failures classified as real bugs / total runs | `[ ]` |
| 8.2.1.5 | Stability signal (weight 0.25): pass rate mapped to 0-100 with flaky penalty | `[ ]` |
| 8.2.1.6 | Maintenance signal (weight 0.25): inverted count of selector heals + test edits in last 90 days | `[ ]` |
| 8.2.1.7 | Coverage signal (weight 0.15): unique code chunks covered vs other tests (RAG-based) | `[ ]` |
| 8.2.1.8 | `POST /projects/:id/value-scores/compute` — trigger recomputation for all tests in project | `[ ]` |
| 8.2.1.9 | `GET /projects/:id/value-scores` — all scores with filter by tier, sort by score | `[ ]` |
| 8.2.1.10 | `GET /tests/:id/value-score` — single test score with signal breakdown | `[ ]` |
| 8.2.1.11 | `GET /projects/:id/value-scores/distribution` — tier histogram for dashboard chart | `[ ]` |
| 8.2.1.12 | Auto-recompute: BullMQ job triggers after every 10th run in a project | `[ ]` |
| 8.2.1.13 | Nightly scheduled recomputation for all active projects | `[ ]` |
| 8.2.1.14 | Unit test: scoring formula produces correct scores for known test profiles | `[ ]` |
| 8.2.1.15 | Unit test: tier assignment matches score ranges | `[ ]` |

**8.2.2 — Retire Workflow**

| # | Item | Status |
|---|------|--------|
| 8.2.2.1 | `POST /projects/:id/value-scores/retire` — bulk soft-delete tests in RETIRE tier | `[ ]` |
| 8.2.2.2 | Retirement confirmation: require explicit confirmation with list of tests to retire | `[ ]` |
| 8.2.2.3 | Retired tests remain in history but excluded from future runs | `[ ]` |
| 8.2.2.4 | "Retired Tests" archive view with restore action | `[ ]` |
| 8.2.2.5 | Unit test: retired tests excluded from feature run, restorable | `[ ]` |

**8.2.3 — Value Score UI**

| # | Item | Status |
|---|------|--------|
| 8.2.3.1 | Project → Test Health dashboard tab: score distribution histogram (Recharts) | `[ ]` |
| 8.2.3.2 | Test table: sortable TVS column with color-coded tier badge | `[ ]` |
| 8.2.3.3 | Score detail popover: signal breakdown bar chart (4 signals) | `[ ]` |
| 8.2.3.4 | "Retire Candidates" section: tests in RETIRE tier with bulk archive button | `[ ]` |
| 8.2.3.5 | Average TVS trend chart (30-day rolling average) | `[ ]` |
| 8.2.3.6 | Test editor: TVS badge next to test name | `[ ]` |
| 8.2.3.7 | Component test: histogram renders, retire action updates list | `[ ]` |

### 8.3 AI Execution Strategist

Intelligent test selection before each run — recommends which tests to run, skip, or defer based on code changes, value scores, and flakiness.

**8.3.1 — Strategy Engine**

| # | Item | Status |
|---|------|--------|
| 8.3.1.1 | Add `StrategyMode` enum: FULL, SMART, FAST, FLAKY_SKIP | `[ ]` |
| 8.3.1.2 | Add `RunStrategyResult` model: featureRunId, testId, action (RUN/SKIP/DEFER), reason, priority | `[ ]` |
| 8.3.1.3 | Create `ExecutionStrategistService` — computes run strategy from test scores + context | `[ ]` |
| 8.3.1.4 | FULL mode: run all tests (existing behavior, default for manual) | `[ ]` |
| 8.3.1.5 | SMART mode: skip flaky (>30% flip rate) + defer low-value (TVS < 40) + prioritize change-affected | `[ ]` |
| 8.3.1.6 | FAST mode: only P0 tests + change-affected tests | `[ ]` |
| 8.3.1.7 | FLAKY_SKIP mode: skip all tests with >30% flip rate | `[ ]` |
| 8.3.1.8 | Change impact analysis: parse git diff file paths → RAG match to affected test definitions | `[ ]` |
| 8.3.1.9 | `POST /features/:id/strategy` — compute and return run strategy | `[ ]` |
| 8.3.1.10 | `GET /features/:id/strategy/preview` — dry-run preview without executing | `[ ]` |
| 8.3.1.11 | Extend `POST /features/:id/run` to accept `strategyMode` parameter | `[ ]` |
| 8.3.1.12 | When strategy applied: worker reads `RunStrategyResult` and skips/defers tests accordingly | `[ ]` |
| 8.3.1.13 | Unit test: SMART mode skips flaky, defers low-value, runs change-affected | `[ ]` |
| 8.3.1.14 | Unit test: FAST mode only includes P0 and change-affected tests | `[ ]` |
| 8.3.1.15 | Integration test: CI trigger with git diff → correct tests selected | `[ ]` |

**8.3.2 — Strategy Effectiveness Tracking**

| # | Item | Status |
|---|------|--------|
| 8.3.2.1 | Add `StrategyOutcome` model: strategyResultId, actualResult (would have passed/failed), validated | `[ ]` |
| 8.3.2.2 | On next full run: backfill outcomes for previously skipped/deferred tests | `[ ]` |
| 8.3.2.3 | `GET /projects/:id/strategy/stats` — false negative rate, time saved, accuracy | `[ ]` |
| 8.3.2.4 | Unit test: outcome tracking correctly flags false negatives | `[ ]` |

**8.3.3 — Strategy UI**

| # | Item | Status |
|---|------|--------|
| 8.3.3.1 | Run trigger modal: strategy mode selector (Full / Smart / Fast / Flaky-skip) | `[ ]` |
| 8.3.3.2 | Strategy preview panel: shows which tests will run/skip/defer with reasons before executing | `[ ]` |
| 8.3.3.3 | Post-run summary: "Strategy saved X min by skipping N low-value tests" card | `[ ]` |
| 8.3.3.4 | Project Settings → Run Defaults: default strategy mode per trigger type (manual, scheduled, CI) | `[ ]` |
| 8.3.3.5 | Strategy effectiveness dashboard: accuracy trend, false negative rate, time saved chart | `[ ]` |
| 8.3.3.6 | Component test: mode selector updates preview, preview shows correct test categorization | `[ ]` |

### 8.4 Enhanced Flaky Test Detection

Upgrades Phase 3-F from basic pass-rate thresholds to comprehensive flakiness analysis with quarantine.

**8.4.1 — Advanced Flakiness Metrics**

| # | Item | Status |
|---|------|--------|
| 8.4.1.1 | Add `QuarantineStatus` enum to `TestDefinition`: ACTIVE, QUARANTINED, MONITORING | `[ ]` |
| 8.4.1.2 | Add `FlakyTestMetric` model: testId, flipRate, consecutiveFlips, environmentCorrelation, timeCorrelation, suggestedAction | `[ ]` |
| 8.4.1.3 | Create `FlakyDetectionService` — compute flip rate (result differs from previous run / total runs) | `[ ]` |
| 8.4.1.4 | Detect environment correlation: "only flaky on staging" via per-environment pass rates | `[ ]` |
| 8.4.1.5 | Detect time correlation: "only flaky after 6pm" via time-bucketed pass rates | `[ ]` |
| 8.4.1.6 | Suggested action algorithm: QUARANTINE (>50% flip), FIX (30-50%), MONITOR (10-30%), RETIRE (<10% but always fails) | `[ ]` |
| 8.4.1.7 | Auto-quarantine: tests with >50% flip rate after 10+ runs get quarantined automatically | `[ ]` |
| 8.4.1.8 | `GET /projects/:id/flaky-tests` — enhanced flaky test list with full metrics | `[ ]` |
| 8.4.1.9 | `PATCH /tests/:id/quarantine` — manually quarantine/unquarantine a test | `[ ]` |
| 8.4.1.10 | Unit test: flip rate computation matches expected values for known run sequences | `[ ]` |
| 8.4.1.11 | Unit test: auto-quarantine triggers at correct threshold | `[ ]` |

**8.4.2 — Quarantine Behavior**

| # | Item | Status |
|---|------|--------|
| 8.4.2.1 | Quarantined tests still execute but results don't affect feature run overall status | `[ ]` |
| 8.4.2.2 | Quarantined test results marked with `QUARANTINED` badge in run detail | `[ ]` |
| 8.4.2.3 | If quarantined test passes 5 consecutive times: suggest un-quarantine | `[ ]` |
| 8.4.2.4 | Quarantine dashboard: list of quarantined tests with flip rates, last run date, suggested actions | `[ ]` |
| 8.4.2.5 | Unit test: quarantined test failure does not fail the feature run | `[ ]` |

**8.4.3 — AI Root Cause Analysis for Flaky Tests**

| # | Item | Status |
|---|------|--------|
| 8.4.3.1 | Collect failure patterns for flaky tests: timing, selectors, error messages, environments | `[ ]` |
| 8.4.3.2 | LLM prompt: "Analyze these flaky test failures and identify the root cause pattern" | `[ ]` |
| 8.4.3.3 | Root cause categories: TIMING_ISSUE, DATA_DEPENDENCY, ENVIRONMENT, RACE_CONDITION, RESOURCE_EXHAUSTION | `[ ]` |
| 8.4.3.4 | Generate suggested fix per root cause category | `[ ]` |
| 8.4.3.5 | Display root cause + suggested fix on flaky test detail card | `[ ]` |
| 8.4.3.6 | Unit test: root cause analysis returns structured output for known failure patterns | `[ ]` |

**8.4.4 — Flaky Test UI**

| # | Item | Status |
|---|------|--------|
| 8.4.4.1 | Project → Flaky Tests tab: table with flip rate, consecutive flips, correlation, suggested action | `[ ]` |
| 8.4.4.2 | Flip rate trend chart per test (30-day sparkline) | `[ ]` |
| 8.4.4.3 | Quarantine toggle button per test with confirmation | `[ ]` |
| 8.4.4.4 | Bulk quarantine action for tests with suggested QUARANTINE action | `[ ]` |
| 8.4.4.5 | Root cause card: pattern description + suggested fix + apply fix button (if auto-fixable) | `[ ]` |
| 8.4.4.6 | Run detail: quarantined test badge + tooltip explaining quarantine behavior | `[ ]` |
| 8.4.4.7 | Component test: quarantine toggle updates test status, flaky table filters correctly | `[ ]` |

### 8.5 Agentic AI Testing — Multi-Agent Pipeline

Autonomous goal-directed testing using specialized AI agents that plan, explore, generate, execute, analyze, heal, and report. This replaces and significantly expands Phase 5.5 (AI Exploratory Testing).

See full spec: `docs/AGENTIC_AI_TESTING.md`

**8.5.1 — Data Model & Session Management**

| # | Item | Status |
|---|------|--------|
| 8.5.1.1 | Add `AgenticSession` model: orgId, projectId, featureId, goal, status, agentConfig, planOutput, explorerMap, executionLog, analysisResult, healLog, summary, metrics, timestamps | `[ ]` |
| 8.5.1.2 | Add `AgenticSessionStatus` enum: PENDING, PLANNING, EXPLORING, GENERATING, EXECUTING, ANALYZING, HEALING, REPORTING, COMPLETED, FAILED, CANCELLED | `[ ]` |
| 8.5.1.3 | Add `AgenticDecision` model: sessionId, agent, action, reasoning, confidence, input, output, durationMs | `[ ]` |
| 8.5.1.4 | `POST /projects/:id/agentic/sessions` — create session with goal + config | `[ ]` |
| 8.5.1.5 | `GET /projects/:id/agentic/sessions` — list sessions with pagination and status filter | `[ ]` |
| 8.5.1.6 | `GET /agentic/sessions/:id` — session detail with full results | `[ ]` |
| 8.5.1.7 | `GET /agentic/sessions/:id/decisions` — decision audit trail | `[ ]` |
| 8.5.1.8 | `POST /agentic/sessions/:id/cancel` — cancel running session | `[ ]` |
| 8.5.1.9 | `POST /agentic/sessions/:id/approve-heals` — approve/reject pending selector heals | `[ ]` |
| 8.5.1.10 | `POST /agentic/sessions/:id/apply-tests` — apply generated tests to feature | `[ ]` |
| 8.5.1.11 | Run Prisma migration for new models | `[ ]` |
| 8.5.1.12 | Unit test: session CRUD operations and status transitions | `[ ]` |

**8.5.2 — Agent Infrastructure (LangGraph)**

| # | Item | Status |
|---|------|--------|
| 8.5.2.1 | Install `@langchain/langgraph` in `apps/api` | `[ ]` |
| 8.5.2.2 | Define `AgenticSessionState` type — shared state passed through all agent nodes | `[ ]` |
| 8.5.2.3 | Create `AgentOrchestratorService` — LangGraph `StateGraph` with conditional edges | `[ ]` |
| 8.5.2.4 | Implement `AgenticConfig` interface — includes `repoIds?: string[]` and `repoBranch?: string` so session uses connected repo(s) from Phase 5.5 as RAG context for Planner + Generator agents | `[ ]` |
| 8.5.2.5 | Decision logging: every agent action recorded to `AgenticDecision` with reasoning + confidence | `[ ]` |
| 8.5.2.6 | Quality gates between pipeline stages (configurable thresholds) | `[ ]` |
| 8.5.2.7 | Session status WebSocket events: `agentic:status { sessionId, status, agent, progress }` | `[ ]` |
| 8.5.2.8 | Unit test: state graph transitions correctly through all nodes | `[ ]` |
| 8.5.2.9 | Unit test: quality gate blocks pipeline when threshold not met | `[ ]` |

**8.5.3 — Planner Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.3.1 | Create `PlannerAgent` — receives goal, produces prioritized test plan using RAG context | `[ ]` |
| 8.5.3.2 | RAG retrieval: query `RepoConnection` chunks (from Phase 5.5 `CodeChunk` table) using `repoIds` from session config — same `RetrievalService.findRelevantChunks()` used by the manual Generate Tests drawer | `[ ]` |
| 8.5.3.2a | Also query: existing test library (embedded `TestDefinition` records) + historical `TestRun` results (last 30 runs) | `[ ]` |
| 8.5.3.3 | Duplicate check: compare planned tests against existing library using embeddings | `[ ]` |
| 8.5.3.4 | Output: prioritized plan with P0/P1/P2 tiers, coverage map, estimated execution time | `[ ]` |
| 8.5.3.5 | Unit test: planner produces valid plan structure from sample goal + code context | `[ ]` |

**8.5.4 — Explorer Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.4.1 | Create `ExplorerAgent` — autonomously navigates the app, discovers pages and flows | `[ ]` |
| 8.5.4.2 | Playwright tool functions: screenshot, getAccessibilityTree, click, fill, navigate, getLinks, back, waitForNavigation | `[ ]` |
| 8.5.4.3 | Use accessibility tree as primary page representation (not DOM/CSS selectors) | `[ ]` |
| 8.5.4.4 | Output: application map (pages, links, forms, interactive elements) | `[ ]` |
| 8.5.4.5 | Constraints: max 100 pages, 5-min timeout, URL pattern filtering, no destructive actions | `[ ]` |
| 8.5.4.6 | Unit test: explorer discovers expected pages from a sample app | `[ ]` |

**8.5.5 — Generator Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.5.1 | Create `GeneratorAgent` — creates TestDefinition drafts from Planner's plan + Explorer's map | `[ ]` |
| 8.5.5.2 | Selector strategy priority: data-testid → accessibility (role+name) → semantic (from code) → CSS | `[ ]` |
| 8.5.5.3 | Each test tagged with priority tier and confidence score | `[ ]` |
| 8.5.5.4 | Schema validation on all generated test definitions | `[ ]` |
| 8.5.5.5 | Unit test: generated tests pass schema validation and use stable selector types | `[ ]` |

**8.5.6 — Executor Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.6.1 | Create `ExecutorAgent` — runs tests with autonomous decision-making on unexpected states | `[ ]` |
| 8.5.6.2 | Accessibility tree as primary element targeting (preferred over selectors) | `[ ]` |
| 8.5.6.3 | On unexpected state: pause, observe, decide (adapt or fail) based on confidence | `[ ]` |
| 8.5.6.4 | Record screenshots at all decision points (not just failures) | `[ ]` |
| 8.5.6.5 | Autonomy bounds: retry step 3x, skip non-critical, fail if confidence < 0.5, never submit payments | `[ ]` |
| 8.5.6.6 | Unit test: executor adapts to changed UI element position | `[ ]` |
| 8.5.6.7 | Unit test: executor fails gracefully when confidence drops below threshold | `[ ]` |

**8.5.7 — Analyzer Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.7.1 | Create `AnalyzerAgent` — classifies failures: REAL_BUG, FLAKY_TEST, ENVIRONMENT_ISSUE, SELECTOR_DRIFT, TEST_DESIGN_FLAW | `[ ]` |
| 8.5.7.2 | Root cause analysis using screenshots + execution log + historical results | `[ ]` |
| 8.5.7.3 | Confidence level per classification | `[ ]` |
| 8.5.7.4 | Bug report draft generation for REAL_BUG classifications | `[ ]` |
| 8.5.7.5 | Conditional edge: route to Healer if SELECTOR_DRIFT, to Reporter if REAL_BUG | `[ ]` |
| 8.5.7.6 | Unit test: analyzer correctly classifies known failure types | `[ ]` |

**8.5.8 — Healer Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.8.1 | Create `HealerAgent` — fixes broken selectors using accessibility tree + vision model | `[ ]` |
| 8.5.8.2 | Maximum 5 heal-and-retry iterations per test | `[ ]` |
| 8.5.8.3 | Log all heals to `SelectorHeal` model with before/after + confidence | `[ ]` |
| 8.5.8.4 | If heal changes test semantic meaning: flag for human review instead of auto-applying | `[ ]` |
| 8.5.8.5 | After 5 failed attempts: mark test as NEEDS_HUMAN_REVIEW, escalate | `[ ]` |
| 8.5.8.6 | Route back to Executor for retry after heal | `[ ]` |
| 8.5.8.7 | Unit test: healer finds correct element after selector change | `[ ]` |
| 8.5.8.8 | Unit test: healer escalates after max retries exceeded | `[ ]` |

**8.5.9 — Reporter Agent**

| # | Item | Status |
|---|------|--------|
| 8.5.9.1 | Create `ReporterAgent` — generates session summary + detailed report + actions | `[ ]` |
| 8.5.9.2 | Natural language summary (3-5 sentences) | `[ ]` |
| 8.5.9.3 | HTML/PDF detailed report generation | `[ ]` |
| 8.5.9.4 | Auto-file Jira tickets for REAL_BUG classifications (if autoFileBugs enabled) | `[ ]` |
| 8.5.9.5 | Send notifications via configured integrations (if autoNotify enabled) | `[ ]` |
| 8.5.9.6 | Unit test: reporter generates valid summary and report from sample session data | `[ ]` |

**8.5.10 — Agentic Testing UI**

| # | Item | Status |
|---|------|--------|
| 8.5.10.1 | Project → Agentic Testing tab | `[ ]` |
| 8.5.10.2 | Session launcher: goal textarea, repo selector (multi-select from connected repos, same as Generate Tests drawer), branch dropdown per repo, config panel (collapsible), scope selector, "Start" button | `[ ]` |
| 8.5.10.3 | Live session view: pipeline progress indicator (7 stages), current agent status, live decision feed | `[ ]` |
| 8.5.10.4 | Live browser canvas: reuse CDP screencast showing Explorer/Executor activity | `[ ]` |
| 8.5.10.5 | Session results: summary card, test plan table, failure analysis cards, heal log | `[ ]` |
| 8.5.10.6 | "Apply Tests" button: add generated tests to feature with review | `[ ]` |
| 8.5.10.7 | "File Bugs" button: create Jira tickets for REAL_BUG findings | `[ ]` |
| 8.5.10.8 | Decision audit trail: expandable log with reasoning + confidence per decision | `[ ]` |
| 8.5.10.9 | Session history table with status, duration, metrics, filters | `[ ]` |
| 8.5.10.10 | Session effectiveness trend chart | `[ ]` |
| 8.5.10.11 | Component test: launcher creates session, live view updates on WebSocket events | `[ ]` |

### 8.6 MCP Server

Expose platform data and actions to external AI tools (Claude Desktop, VS Code Copilot, Cursor) via the Model Context Protocol.

| # | Item | Status |
|---|------|--------|
| 8.6.1 | Install `@modelcontextprotocol/sdk` in `apps/api` | `[ ]` |
| 8.6.2 | Create `McpModule` with MCP server transport (stdio + SSE) | `[ ]` |
| 8.6.3 | Tool: `list_tests(projectId, featureId?)` — read test definitions | `[ ]` |
| 8.6.4 | Tool: `get_test_results(testId, limit?)` — read run history | `[ ]` |
| 8.6.5 | Tool: `create_test(featureId, testDefinition)` — create a test case | `[ ]` |
| 8.6.6 | Tool: `update_test(testId, changes)` — modify a test | `[ ]` |
| 8.6.7 | Tool: `trigger_run(featureId, environmentId)` — start a test run | `[ ]` |
| 8.6.8 | Tool: `get_run_status(runId)` — poll run progress | `[ ]` |
| 8.6.9 | Tool: `get_flaky_tests(projectId)` — read flaky test list | `[ ]` |
| 8.6.10 | Tool: `get_recommendations(projectId)` — read AI recommendations | `[ ]` |
| 8.6.11 | Resource: `project://{id}` — project metadata | `[ ]` |
| 8.6.12 | Resource: `feature://{id}` — feature with test definitions | `[ ]` |
| 8.6.13 | Resource: `run://{id}` — run results with step details | `[ ]` |
| 8.6.14 | Auth: API key-based authentication for MCP connections | `[ ]` |
| 8.6.15 | Unit test: MCP tools return correct data for valid requests | `[ ]` |
| 8.6.16 | Integration test: Claude Desktop connects and reads test data | `[ ]` |

---

## Phase 9 — BDD/Gherkin Support & Advanced Integrations

> **Depends on:** Phase 8 (AI Intelligence), Phase 5 (Advanced Features)
> **Specs:** `docs/BDD_GHERKIN.md`

### 9.1 BDD / Gherkin Native Support

Native Given/When/Then authoring with step definition bindings that map to existing platform step types. Gherkin is an authoring overlay — execution uses the same Playwright/API/Shell runners.

See full spec: `docs/BDD_GHERKIN.md`

**9.1.1 — Data Model & Parser**

| # | Item | Status |
|---|------|--------|
| 9.1.1.1 | Add `TestAuthoringMode` enum: STRUCTURED, BDD | `[ ]` |
| 9.1.1.2 | Add `authoring`, `gherkinSource`, `gherkinParsed`, `tags` fields to `TestDefinition` | `[ ]` |
| 9.1.1.3 | Add `StepDefinitionBinding` model: projectId, pattern, description, steps (Json), isBuiltIn | `[ ]` |
| 9.1.1.4 | Install `@cucumber/gherkin` and `@cucumber/messages` packages | `[ ]` |
| 9.1.1.5 | Create `GherkinParserService` — parse .feature text into AST (Feature → Scenarios → Steps) | `[ ]` |
| 9.1.1.6 | Handle Scenario Outline + Examples: expand into individual test cases | `[ ]` |
| 9.1.1.7 | Handle Background: prepend steps to each scenario | `[ ]` |
| 9.1.1.8 | Parse @tags into test `tags` array | `[ ]` |
| 9.1.1.9 | Run Prisma migration | `[ ]` |
| 9.1.1.10 | Unit test: parser correctly handles Feature, Scenario, Outline, Background, tags | `[ ]` |

**9.1.2 — Step Definition Registry**

| # | Item | Status |
|---|------|--------|
| 9.1.2.1 | Create `StepDefinitionRegistryService` — matches Gherkin steps to bindings | `[ ]` |
| 9.1.2.2 | Built-in navigation definitions: "I am on the {word} page", "I navigate to {string}", "I go back" | `[ ]` |
| 9.1.2.3 | Built-in interaction definitions: click, fill/type, select, check, scroll, hover, press key, wait | `[ ]` |
| 9.1.2.4 | Built-in assertion definitions: should see, should not see, should be visible, URL should contain, title should contain | `[ ]` |
| 9.1.2.5 | Built-in screenshot definitions: take a screenshot, take a screenshot named {string} | `[ ]` |
| 9.1.2.6 | Cucumber expression matching (parameters: {string}, {int}, {float}, {word}) | `[ ]` |
| 9.1.2.7 | Optional word matching: "I click (on )(the ){string}( button/link)" | `[ ]` |
| 9.1.2.8 | Custom step definitions: project-level definitions that map to multi-step sequences | `[ ]` |
| 9.1.2.9 | `GET /projects/:id/step-definitions` — list all (built-in + custom) | `[ ]` |
| 9.1.2.10 | `POST /projects/:id/step-definitions` — create custom binding | `[ ]` |
| 9.1.2.11 | `PATCH/DELETE /projects/:id/step-definitions/:id` — update/delete custom binding | `[ ]` |
| 9.1.2.12 | Unit test: registry matches all built-in patterns correctly | `[ ]` |
| 9.1.2.13 | Unit test: custom binding with multi-step expansion works | `[ ]` |

**9.1.3 — BDD Execution**

| # | Item | Status |
|---|------|--------|
| 9.1.3.1 | Create `BddResolver` — resolves Gherkin steps to native step sequences via registry | `[ ]` |
| 9.1.3.2 | Substitute Scenario Outline parameters into step definitions | `[ ]` |
| 9.1.3.3 | Expand composite step definitions into flat native step sequences | `[ ]` |
| 9.1.3.4 | Unmatched step handling: flag as NEEDS_BINDING, optionally use AI to generate binding | `[ ]` |
| 9.1.3.5 | AI step binding: send unmatched step to LLM with codebase context → generate native step config | `[ ]` |
| 9.1.3.6 | Execute resolved native steps on existing step runner (no changes to Playwright/API/Shell runners) | `[ ]` |
| 9.1.3.7 | Dual-level reporting: Gherkin step results + expanded native step results | `[ ]` |
| 9.1.3.8 | Unit test: full resolution chain (Gherkin → registry → native steps → execution) | `[ ]` |
| 9.1.3.9 | Integration test: run a BDD test end-to-end against a sample app | `[ ]` |

**9.1.4 — Import / Export**

| # | Item | Status |
|---|------|--------|
| 9.1.4.1 | `POST /features/:id/import-gherkin` — import .feature file, create TestDefinitions with authoring=BDD | `[ ]` |
| 9.1.4.2 | `POST /projects/:id/import-gherkin-bulk` — import multiple .feature files | `[ ]` |
| 9.1.4.3 | `GET /features/:id/export-gherkin` — export feature as .feature file | `[ ]` |
| 9.1.4.4 | Reverse mapping: structured tests → Gherkin via step definition reverse lookup | `[ ]` |
| 9.1.4.5 | Unmatched step import: flag steps without bindings for review | `[ ]` |
| 9.1.4.6 | Unit test: import/export round-trip preserves all test data | `[ ]` |

**9.1.5 — AI BDD Generation**

| # | Item | Status |
|---|------|--------|
| 9.1.5.1 | `POST /features/:id/generate-bdd` — AI generates Gherkin scenarios from description + codebase | `[ ]` |
| 9.1.5.2 | `POST /tests/:id/convert-to-bdd` — convert existing structured test to Gherkin | `[ ]` |
| 9.1.5.3 | `POST /tests/:id/convert-to-structured` — convert BDD test to native steps | `[ ]` |
| 9.1.5.4 | Style parameter: verbose (full Given/When/Then) vs concise (minimal) | `[ ]` |
| 9.1.5.5 | Unit test: generated Gherkin is valid and parseable | `[ ]` |
| 9.1.5.6 | Unit test: structured → BDD → structured round-trip preserves behavior | `[ ]` |

**9.1.6 — BDD UI**

| # | Item | Status |
|---|------|--------|
| 9.1.6.1 | Test editor: mode toggle `[ Structured ] [ BDD ]` | `[ ]` |
| 9.1.6.2 | Gherkin editor: syntax highlighting for Feature/Scenario/Given/When/Then keywords | `[ ]` |
| 9.1.6.3 | Auto-complete: suggest matching step definitions as user types | `[ ]` |
| 9.1.6.4 | Inline validation: unmatched steps highlighted in yellow with "No binding found" tooltip | `[ ]` |
| 9.1.6.5 | Live preview panel: shows resolved native steps (expandable) | `[ ]` |
| 9.1.6.6 | Tag input with auto-suggest from existing project tags | `[ ]` |
| 9.1.6.7 | Import panel: drag-drop .feature files | `[ ]` |
| 9.1.6.8 | Export button: download as .feature file | `[ ]` |
| 9.1.6.9 | Step Definition Manager: Project Settings → Step Definitions tab | `[ ]` |
| 9.1.6.10 | Built-in definitions: read-only list with pattern + example | `[ ]` |
| 9.1.6.11 | Custom definitions: CRUD with pattern input, step builder, "Test binding" button | `[ ]` |
| 9.1.6.12 | Run detail: dual-level view — BDD steps (Given/When/Then) with expandable native steps | `[ ]` |
| 9.1.6.13 | Component test: mode toggle switches editor, syntax highlighting renders, auto-complete works | `[ ]` |

### 9.2 Requirements Traceability

Link requirements to features and tests for full coverage tracking.

| # | Item | Status |
|---|------|--------|
| 9.2.1 | Add `Requirement` model: orgId, projectId, externalId, title, description, source (MANUAL/JIRA/AZURE_DEVOPS), priority, status | `[ ]` |
| 9.2.2 | Add `RequirementLink` join table: requirementId, featureId?, testId? | `[ ]` |
| 9.2.3 | `GET/POST /projects/:id/requirements` — CRUD | `[ ]` |
| 9.2.4 | `POST /requirements/:id/link` — link to feature or test | `[ ]` |
| 9.2.5 | `GET /projects/:id/requirements/coverage` — coverage matrix (requirements × features × test results) | `[ ]` |
| 9.2.6 | Jira sync: import requirements from Jira issues (stories, epics) with two-way status sync | `[ ]` |
| 9.2.7 | Coverage dashboard: requirements with coverage %, uncovered requirements highlighted | `[ ]` |
| 9.2.8 | Traceability matrix view: requirements → features → tests → latest run results | `[ ]` |
| 9.2.9 | Unit test: coverage calculation correct for partial and full coverage | `[ ]` |
| 9.2.10 | Component test: matrix renders, link/unlink actions work | `[ ]` |

### 9.3 Visual Regression Testing

Baseline screenshot comparison with pixel-diff and approval workflow.

| # | Item | Status |
|---|------|--------|
| 9.3.1 | Add `VisualBaseline` model: testId, stepIndex, environmentId, baselineScreenshot, threshold | `[ ]` |
| 9.3.2 | Add `VisualDiff` model: runStepId, baselineId, diffScreenshot, diffPercentage, status (NEW/MATCH/MISMATCH/APPROVED) | `[ ]` |
| 9.3.3 | Install `pixelmatch` and `pngjs` packages in worker | `[ ]` |
| 9.3.4 | After each step screenshot: compare to baseline using pixelmatch, store diff | `[ ]` |
| 9.3.5 | Configurable diff threshold per test (default: 0.1% pixel difference) | `[ ]` |
| 9.3.6 | `POST /tests/:id/visual-baselines` — set current screenshot as baseline | `[ ]` |
| 9.3.7 | `GET /tests/:id/visual-baselines` — list baselines with thumbnails | `[ ]` |
| 9.3.8 | `PATCH /visual-diffs/:id` — approve mismatch (update baseline) or reject | `[ ]` |
| 9.3.9 | Visual diff viewer: side-by-side baseline/current/diff with slider overlay | `[ ]` |
| 9.3.10 | Approval workflow: mismatches queue for review, bulk approve/reject | `[ ]` |
| 9.3.11 | Unit test: pixelmatch correctly detects known differences | `[ ]` |
| 9.3.12 | Component test: diff viewer renders, approval action updates status | `[ ]` |

### 9.4 Accessibility Testing

AI-powered WCAG 2.1 AA compliance scanning during test runs.

| # | Item | Status |
|---|------|--------|
| 9.4.1 | Install `@axe-core/playwright` in worker | `[ ]` |
| 9.4.2 | Add `AccessibilityResult` model: runStepId, violations (Json), passes, incompleteCount | `[ ]` |
| 9.4.3 | New step type: `A11Y_SCAN` — runs axe-core on current page | `[ ]` |
| 9.4.4 | Optional auto-scan: run a11y check after every NAVIGATE step (configurable per test) | `[ ]` |
| 9.4.5 | `GET /runs/:id/accessibility` — a11y results for a run | `[ ]` |
| 9.4.6 | A11y dashboard: violations by severity, affected pages, remediation guidance | `[ ]` |
| 9.4.7 | AI remediation suggestions: LLM analyzes violations and suggests code fixes | `[ ]` |
| 9.4.8 | Unit test: axe-core integration detects known violations in sample HTML | `[ ]` |
| 9.4.9 | Component test: a11y dashboard renders violations with severity badges | `[ ]` |

### 9.5 Cross-Project Reporting

Org-wide dashboards aggregating metrics across all projects.

| # | Item | Status |
|---|------|--------|
| 9.5.1 | `GET /organisations/:id/cross-project-report` — aggregated metrics across all projects | `[ ]` |
| 9.5.2 | Cross-project dashboard: project comparison table (pass rate, flaky count, TVS avg, coverage) | `[ ]` |
| 9.5.3 | Org-level trend charts: total tests, pass rate, flaky rate over time | `[ ]` |
| 9.5.4 | Project health heatmap: projects × weeks with color-coded pass rates | `[ ]` |
| 9.5.5 | Export: org-level PDF report with all project metrics | `[ ]` |
| 9.5.6 | Scheduled org reports: daily/weekly email to org admins | `[ ]` |
| 9.5.7 | Component test: cross-project table renders, heatmap colors correct | `[ ]` |

---

## Phase 10 — Global Search & Extended Integrations

> **Depends on:** Phase 6 (Multi-Tenancy), Phase 9 (BDD/Requirements/Tags)
> **Spec:** `docs/GLOBAL_SEARCH.md` · `docs/EXTENDED_INTEGRATIONS.md`

### 10.1 Global Full-Text Search

A unified search system covering every entity a user has access to. Two surfaces:
1. **⌘K Command Palette** — modal, instant results, keyboard-driven navigation (upgrade from Phase 6.7 basic version)
2. **Dedicated `/search` page** — full results with filters, pagination, and deep linking

**10.1.1 — Search Index**

| # | Item | Status |
|---|------|--------|
| 10.1.1.1 | Evaluate search backend: PostgreSQL `tsvector` full-text search (default, zero deps) vs Meilisearch (richer UX). Use `tsvector` unless Meilisearch is opted in via `SEARCH_BACKEND=meilisearch` | `[ ]` |
| 10.1.1.2 | Add `tsvector` generated columns to searchable models: `Project`, `Module`, `Feature`, `TestDefinition`, `TestRun`, `Environment`, `OrgMember` | `[ ]` |
| 10.1.1.3 | PostgreSQL: create `GIN` indexes on all `tsvector` columns for fast full-text search | `[ ]` |
| 10.1.1.4 | Meilisearch adapter (optional): `SearchIndexerService` with document sync on create/update/delete | `[ ]` |
| 10.1.1.5 | Index these entity types: Project, Module, Feature, TestDefinition (name + step descriptions), TestRun (error messages), Environment, OrgMember (name + email), Requirement (Phase 9), BDD tags (Phase 9) | `[ ]` |
| 10.1.1.6 | RBAC-aware search: results filtered to entities the requesting user has access to (org scope + project role) | `[ ]` |
| 10.1.1.7 | Unit test: RBAC filter prevents cross-org results | `[ ]` |
| 10.1.1.8 | Unit test: tsvector search returns correct results for partial word match | `[ ]` |

**10.1.2 — Search API**

| # | Item | Status |
|---|------|--------|
| 10.1.2.1 | `GET /search?q={query}&types={csv}&projectId={id}&limit={n}&offset={n}` — unified search endpoint | `[ ]` |
| 10.1.2.2 | `types` filter: `project,module,feature,test,run,environment,member,requirement,tag` (default: all) | `[ ]` |
| 10.1.2.3 | Response shape: `{ results: SearchResult[], totalCount, breakdown: { type: count } }` | `[ ]` |
| 10.1.2.4 | `SearchResult` type: `{ id, type, title, subtitle, breadcrumb, url, score, highlight, meta }` | `[ ]` |
| 10.1.2.5 | Highlight: return matched text snippets with `<mark>` tags around matched terms | `[ ]` |
| 10.1.2.6 | Recent items: `GET /search/recent` — last 10 entities user navigated to (stored in Redis per user) | `[ ]` |
| 10.1.2.7 | Quick actions: `GET /search/actions?q={query}` — command-style results (e.g. "Run Feature → Auth Login") | `[ ]` |
| 10.1.2.8 | Rate limiting: 30 req/min per user on search endpoint | `[ ]` |
| 10.1.2.9 | Unit test: search returns correct entity types for each filter combination | `[ ]` |
| 10.1.2.10 | Unit test: highlight wraps matched terms correctly | `[ ]` |

**10.1.3 — Upgraded ⌘K Command Palette**

| # | Item | Status |
|---|------|--------|
| 10.1.3.1 | Replace Phase 6.7 basic palette with full search-powered palette | `[ ]` |
| 10.1.3.2 | Open: ⌘K (Mac) / Ctrl+K (Windows/Linux) from anywhere; Escape closes | `[ ]` |
| 10.1.3.3 | Input: debounced 150ms, min 2 chars to trigger API search | `[ ]` |
| 10.1.3.4 | Initial state (empty input): show recent items grouped + quick action shortcuts | `[ ]` |
| 10.1.3.5 | Results: grouped by entity type with type icon and breadcrumb (Org / Project / Module) | `[ ]` |
| 10.1.3.6 | Keyboard navigation: arrow keys move selection, Enter navigates to result | `[ ]` |
| 10.1.3.7 | Quick actions in palette: "Run [feature]", "Create test in [feature]", "Go to settings", "Invite member" | `[ ]` |
| 10.1.3.8 | Type filters: tabs above results to filter by entity type | `[ ]` |
| 10.1.3.9 | "See all results" footer link → opens `/search` page with same query | `[ ]` |
| 10.1.3.10 | Component test: palette opens, results render, keyboard navigation works, Enter navigates | `[ ]` |

**10.1.4 — Dedicated `/search` Page**

| # | Item | Status |
|---|------|--------|
| 10.1.4.1 | Route `/search?q={query}&type={type}` — search results page | `[ ]` |
| 10.1.4.2 | Search bar at top (pre-filled with query), persists query in URL | `[ ]` |
| 10.1.4.3 | Left sidebar filters: entity type (checkboxes), project (dropdown), date range, status | `[ ]` |
| 10.1.4.4 | Results list with highlighted snippets, entity type badge, breadcrumb, last-modified date | `[ ]` |
| 10.1.4.5 | Result grouping toggle: flat list vs grouped by entity type | `[ ]` |
| 10.1.4.6 | Pagination: 20 results per page | `[ ]` |
| 10.1.4.7 | Empty state: suggestions for refining search, recent items fallback | `[ ]` |
| 10.1.4.8 | Loading skeleton while results fetch | `[ ]` |
| 10.1.4.9 | Deep linking: navigating to a result opens that entity's page directly | `[ ]` |
| 10.1.4.10 | Component test: filters update results, pagination works, empty state renders | `[ ]` |

---

### 10.2 Extended Native Integrations

Expands the Phase 5.3 integration plugin registry with first-class support for additional platforms. All new plugins implement the existing `IntegrationPlugin` interface — zero changes to the plugin architecture.

**10.2.1 — Discord Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.1.1 | Create `DiscordPlugin` implementing `IntegrationPlugin` | `[ ]` |
| 10.2.1.2 | Transport: Discord incoming webhook (no bot token required) | `[ ]` |
| 10.2.1.3 | Message format: Discord Embed with color (red=fail, green=pass), title, fields (pass/fail counts, feature name, environment), footer with run link | `[ ]` |
| 10.2.1.4 | Failure details: list failed test names + first error line (truncated to Discord limits) | `[ ]` |
| 10.2.1.5 | Config: `webhookUrl`, `username` (bot display name), `avatarUrl` (optional), `mentionRoleId` (ping role on failure) | `[ ]` |
| 10.2.1.6 | Add `DISCORD` to `IntegrationType` enum + Prisma migration | `[ ]` |
| 10.2.1.7 | Project Settings → Integrations: Discord config form | `[ ]` |
| 10.2.1.8 | Unit test: Discord embed payload matches expected structure | `[ ]` |

**10.2.2 — GitHub Issues Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.2.1 | Create `GitHubIssuesPlugin` implementing `IntegrationPlugin` with `createTicket()` | `[ ]` |
| 10.2.2.2 | Use existing GitHub repo connection OAuth token (reuse `RepoConnection` auth from Phase 5.5) or separate PAT | `[ ]` |
| 10.2.2.3 | `createTicket()`: POST to GitHub Issues API — title, body (markdown with steps + screenshot link), labels, assignees, milestone | `[ ]` |
| 10.2.2.4 | Auto-label: apply configurable labels (e.g. `bug`, `qa-failed`) | `[ ]` |
| 10.2.2.5 | Duplicate detection: search open issues by title before creating (prevent duplicate bug reports) | `[ ]` |
| 10.2.2.6 | Config: `owner`, `repo`, `token` (PAT or reuse repo OAuth), `labels[]`, `assignees[]`, `milestone` | `[ ]` |
| 10.2.2.7 | Failure panel action: "Create GitHub Issue" button alongside existing Jira option | `[ ]` |
| 10.2.2.8 | Unit test: issue creation payload correctly structured, duplicate detection skips existing open issue | `[ ]` |

**10.2.3 — GitLab Issues Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.3.1 | Create `GitLabIssuesPlugin` implementing `IntegrationPlugin` with `createTicket()` | `[ ]` |
| 10.2.3.2 | Reuse GitLab repo connection auth (PAT or OAuth from Phase 5.5) | `[ ]` |
| 10.2.3.3 | `createTicket()`: POST to GitLab Issues API — title, description (markdown), labels, assignee_ids, milestone_id | `[ ]` |
| 10.2.3.4 | Supports self-hosted GitLab: `baseUrl` config field | `[ ]` |
| 10.2.3.5 | Duplicate detection: search open issues by title | `[ ]` |
| 10.2.3.6 | Config: `baseUrl`, `projectId` (numeric), `token`, `labels[]`, `assigneeUsernames[]` | `[ ]` |
| 10.2.3.7 | Unit test: issue creation payload correctly structured for both cloud and self-hosted | `[ ]` |

**10.2.4 — Linear Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.4.1 | Create `LinearPlugin` implementing `IntegrationPlugin` with `createTicket()` | `[ ]` |
| 10.2.4.2 | Transport: Linear GraphQL API with Personal API Key | `[ ]` |
| 10.2.4.3 | `createTicket()`: create Issue via `issueCreate` mutation — title, description (markdown), priority, team, label, assignee | `[ ]` |
| 10.2.4.4 | `notify()`: use Linear webhook or skip (Linear is primarily for ticket creation) | `[ ]` |
| 10.2.4.5 | Config: `apiKey`, `teamId`, `labelId` (e.g. "QA Failure"), `assigneeId`, `priority` (0-4) | `[ ]` |
| 10.2.4.6 | Project Settings: "Connect Linear" → OAuth flow to select workspace + team | `[ ]` |
| 10.2.4.7 | Unit test: GraphQL mutation payload correctly structured | `[ ]` |

**10.2.5 — Google Chat Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.5.1 | Create `GoogleChatPlugin` implementing `IntegrationPlugin` | `[ ]` |
| 10.2.5.2 | Transport: Google Chat incoming webhook | `[ ]` |
| 10.2.5.3 | Message format: Google Chat Card v2 with header, sections (pass/fail counts, failed tests), button (open run) | `[ ]` |
| 10.2.5.4 | Config: `webhookUrl`, `threadKey` (optional — post to specific thread) | `[ ]` |
| 10.2.5.5 | Unit test: Google Chat card payload valid JSON | `[ ]` |

**10.2.6 — ClickUp Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.6.1 | Create `ClickUpPlugin` implementing `IntegrationPlugin` with `createTicket()` | `[ ]` |
| 10.2.6.2 | Transport: ClickUp REST API v2 with Personal API Token | `[ ]` |
| 10.2.6.3 | `createTicket()`: POST `/list/{listId}/task` — name, description (markdown), priority, assignees, tags, status | `[ ]` |
| 10.2.6.4 | Config: `apiToken`, `listId`, `priority` (1=urgent to 4=low), `assignees[]`, `tags[]`, `status` | `[ ]` |
| 10.2.6.5 | Unit test: task creation payload correctly structured | `[ ]` |

**10.2.7 — PagerDuty Plugin**

| # | Item | Status |
|---|------|--------|
| 10.2.7.1 | Create `PagerDutyPlugin` implementing `IntegrationPlugin` | `[ ]` |
| 10.2.7.2 | Transport: PagerDuty Events API v2 (integration key, no OAuth required) | `[ ]` |
| 10.2.7.3 | `notify()`: trigger incident on `FEATURE_RUN_FAILED` for P0 tests only (configurable severity) | `[ ]` |
| 10.2.7.4 | Auto-resolve: send `resolve` event when subsequent run passes | `[ ]` |
| 10.2.7.5 | Config: `integrationKey` (routing key), `severity` (critical/error/warning/info), `triggerOnlyForP0` | `[ ]` |
| 10.2.7.6 | Unit test: trigger and resolve payloads correctly structured | `[ ]` |

**10.2.8 — Integration Registry & Shared UI Updates**

| # | Item | Status |
|---|------|--------|
| 10.2.8.1 | Add all new types to `IntegrationType` enum: `DISCORD`, `GITHUB_ISSUES`, `GITLAB_ISSUES`, `LINEAR`, `GOOGLE_CHAT`, `CLICKUP`, `PAGERDUTY` | `[ ]` |
| 10.2.8.2 | Register all new plugins in `IntegrationPluginRegistry` | `[ ]` |
| 10.2.8.3 | Run Prisma migration for updated enum | `[ ]` |
| 10.2.8.4 | Project Settings → Integrations: update "Add Integration" type dropdown with new options and logos | `[ ]` |
| 10.2.8.5 | Dynamic config forms: each new type has its own validated config form in the modal | `[ ]` |
| 10.2.8.6 | Step failure action panel: "Create Issue" dropdown showing all configured bug-tracking integrations (Jira + GitHub Issues + GitLab Issues + Linear + ClickUp) | `[ ]` |
| 10.2.8.7 | Integration test: each plugin's `validateConfig()` rejects invalid config | `[ ]` |
| 10.2.8.8 | Integration test: each plugin's `notify()` sends correct payload to mocked endpoint | `[ ]` |

---

### 10.3 Git-Native CI Integration (Two-Way Git Workflow)

> **Depends on:** Phase 5.2 (CI/CD trigger API), Phase 5.5 (Repo Connections / RAG), Phase 8.3 (Execution Strategist)
> **Spec:** `docs/GIT_NATIVE_CI.md`

Phase 5.5 connects repos so AI can read code as context. Phase 5.2 lets CI/CD trigger runs via REST API. This section adds the **missing two-way layer**: the platform reacts to git events (PR opened, code pushed, deployment happened) and posts results back to the repo as first-class git status checks.

**10.3.1 — Commit Status Checks (GitHub & GitLab)**

Post test results back to GitHub/GitLab as commit statuses — the native green ✓ / red ✗ check shown on PRs before merging.

| # | Item | Status |
|---|------|--------|
| 10.3.1.1 | Create `CommitStatusService` — posts status to GitHub Statuses API (`POST /repos/{owner}/{repo}/statuses/{sha}`) | `[ ]` |
| 10.3.1.2 | GitLab equivalent: post to Commit Statuses API (`POST /projects/{id}/statuses/{sha}`) | `[ ]` |
| 10.3.1.3 | Status states: `pending` (run started), `success` (all passed), `failure` (any failed), `error` (run errored) | `[ ]` |
| 10.3.1.4 | Status payload: `context` = "QA Platform / {featureName}", `description` = "3/4 tests passed", `target_url` = run deep link | `[ ]` |
| 10.3.1.5 | One status per feature run — context name makes multiple features distinguishable on the PR | `[ ]` |
| 10.3.1.6 | Config per repo connection: `postCommitStatus: boolean` (default: false, opt-in) | `[ ]` |
| 10.3.1.7 | Store `commitSha String?` on `FeatureRun` — populated when triggered by a git event | `[ ]` |
| 10.3.1.8 | Status lifecycle: post `pending` on run start → post `success` or `failure` on run complete | `[ ]` |
| 10.3.1.9 | Auth: reuse `RepoConnection.accessToken` (already has repo scope; needs `repo:status` on GitHub) | `[ ]` |
| 10.3.1.10 | Unit test: GitHub status payload correctly structured for all four states | `[ ]` |
| 10.3.1.11 | Unit test: GitLab status payload correctly structured | `[ ]` |

**10.3.2 — PR Event Webhook Handler**

Receive pull_request events from GitHub/GitLab, automatically identify affected tests via diff + RAG, and optionally trigger them.

| # | Item | Status |
|---|------|--------|
| 10.3.2.1 | Extend `POST /projects/:id/repos/:repoId/webhook` to handle `pull_request` events (in addition to existing push/re-index) | `[ ]` |
| 10.3.2.2 | On `pull_request` opened/synchronize: fetch PR diff file list from provider API | `[ ]` |
| 10.3.2.3 | `PrImpactService.analyzeImpact(projectId, changedFiles[])` — RAG search to find features/tests whose code chunks overlap with changed files | `[ ]` |
| 10.3.2.4 | Return impact report: `{ affectedFeatures, affectedTests, suggestedNewTests, confidence }` | `[ ]` |
| 10.3.2.5 | Config: `prTriggerMode: 'off' | 'suggest' | 'auto-run'` per repo connection | `[ ]` |
| 10.3.2.6 | `suggest` mode: post a PR comment listing affected tests + "Run them →" deep link to platform | `[ ]` |
| 10.3.2.7 | `auto-run` mode: enqueue runs for all affected features against the PR's head branch environment | `[ ]` |
| 10.3.2.8 | PR comment format: markdown table of affected features with pass/fail status badges, link to full report | `[ ]` |
| 10.3.2.9 | Delete+replace existing QA comment on PR update (avoid comment spam on multiple pushes to same PR) | `[ ]` |
| 10.3.2.10 | `POST /projects/:id/pr-impact` — manual endpoint to get impact analysis for any set of changed files | `[ ]` |
| 10.3.2.11 | Unit test: impact analysis correctly maps changed files to affected test definitions | `[ ]` |
| 10.3.2.12 | Unit test: PR comment rendered correctly; existing comment replaced not duplicated | `[ ]` |

**10.3.3 — Deployment Event Trigger**

Receive deployment events and automatically run smoke tests against the new deployment.

| # | Item | Status |
|---|------|--------|
| 10.3.3.1 | Handle `deployment_status` webhook event from GitHub (event fires when deployment status changes to `success`) | `[ ]` |
| 10.3.3.2 | Handle GitLab `deployment` webhook event (fires on `success` deployment) | `[ ]` |
| 10.3.3.3 | Map deployment environment name to `Environment` record in platform (match by name, case-insensitive) | `[ ]` |
| 10.3.3.4 | On successful deployment: enqueue runs for all features in the project tagged `@smoke` or priority P0 | `[ ]` |
| 10.3.3.5 | Config: `deploymentTrigger: boolean`, `deploymentEnvMap: { githubEnv: string, platformEnvId: uuid }[]` | `[ ]` |
| 10.3.3.6 | Post `pending` commit status on deployment detected → post final status when smoke suite completes | `[ ]` |
| 10.3.3.7 | Notification: send deployment test report to configured channels on completion | `[ ]` |
| 10.3.3.8 | Unit test: deployment event correctly enqueues runs for smoke-tagged features only | `[ ]` |

**10.3.4 — PR Diff → AI Test Suggestions**

On PR opened/updated, AI analyses the diff and suggests which *new* tests should be written for the changed code.

| # | Item | Status |
|---|------|--------|
| 10.3.4.1 | `AiPrSuggestionService.suggestTests(projectId, prDiff, existingCoverage)` — LLM analyses changed code + existing tests | `[ ]` |
| 10.3.4.2 | Prompt: "Given these code changes and existing test coverage, what test cases are missing? Return as TestDefinition drafts." | `[ ]` |
| 10.3.4.3 | RAG context: retrieve existing tests covering the same code paths to avoid duplicate suggestions | `[ ]` |
| 10.3.4.4 | Output: `SuggestedTest[]` with name, type, rationale, confidence, draft steps | `[ ]` |
| 10.3.4.5 | Include suggestions in the PR comment (separate section: "Suggested new tests for review") | `[ ]` |
| 10.3.4.6 | Platform UI: "Suggested tests from PR #42" notification with one-click accept/dismiss | `[ ]` |
| 10.3.4.7 | `POST /features/:id/accept-pr-suggestions` — bulk accept suggestions as `isAiDraft: true` test definitions | `[ ]` |
| 10.3.4.8 | Unit test: suggestion service returns valid TestDefinition drafts, no duplicates of existing tests | `[ ]` |

**10.3.5 — Commit Traceability**

Link every test run to the exact commit that triggered it.

| # | Item | Status |
|---|------|--------|
| 10.3.5.1 | Add `commitSha String?`, `commitBranch String?`, `commitMessage String?`, `prNumber Int?`, `prUrl String?` to `FeatureRun` | `[ ]` |
| 10.3.5.2 | Populate from git event webhook payload when run is triggered by PR/push/deployment | `[ ]` |
| 10.3.5.3 | Populate from CI trigger request body when triggered via `POST /ci/trigger` (caller passes `{ commitSha, branch, prNumber }`) | `[ ]` |
| 10.3.5.4 | Run detail page: show commit badge with SHA (7-char), branch, PR link when available | `[ ]` |
| 10.3.5.5 | Run history: filterable by branch name | `[ ]` |
| 10.3.5.6 | `GET /projects/:id/runs?branch={name}` — filter runs by branch | `[ ]` |
| 10.3.5.7 | Commit timeline view: per-branch run history showing pass/fail per commit (spark-chart) | `[ ]` |
| 10.3.5.8 | Unit test: commit fields populated correctly from each trigger source | `[ ]` |

**10.3.6 — Branch Environment Provisioning (Optional)**

Run tests against branch-specific preview environments (ephemeral environments spun up per PR).

| # | Item | Status |
|---|------|--------|
| 10.3.6.1 | Add `BranchEnvironment` model: projectId, branch, baseUrl, status, createdAt, expiresAt | `[ ]` |
| 10.3.6.2 | `POST /projects/:id/branch-environments` — register a preview URL for a branch (called from CI/CD) | `[ ]` |
| 10.3.6.3 | `DELETE /projects/:id/branch-environments/:id` — deregister when PR is closed/merged | `[ ]` |
| 10.3.6.4 | When PR event arrives: auto-resolve branch environment URL for that branch | `[ ]` |
| 10.3.6.5 | Run test against branch environment URL if one exists; fall back to default environment if not | `[ ]` |
| 10.3.6.6 | Auto-expire branch environments after 7 days of inactivity | `[ ]` |
| 10.3.6.7 | Unit test: branch environment resolved correctly for matching branch | `[ ]` |

---

## Phase 11 — QA Session Tracking

> **Depends on:** Phase 6 (Auth / Multi-Tenancy), Phase 5.3 (Integrations), Phase 10.2 (ClickUp plugin)
> **Spec:** `docs/SESSION_TRACKING.md`

A timed work session tracker for QA engineers. Start a session, work normally, stop it — the platform auto-records everything that happened and generates an AI summary. Optionally log time directly to a ClickUp task or Jira issue with a pre-written description.

### 11.1 Data Model

| # | Item | Status |
|---|------|--------|
| 11.1.1 | Add `WorkSession` model: orgId, userId, projectId?, goal, status, startedAt, stoppedAt, pausedMs, durationMs, aiSummary, notes, metrics (totalRuns, passed, failed, bugsField, featuresWorkedOn[]), timeLog fields | `[ ]` |
| 11.1.2 | Add `WorkSessionStatus` enum: ACTIVE, PAUSED, STOPPED, REVIEWED, DISCARDED | `[ ]` |
| 11.1.3 | Add `WorkSessionEvent` model: sessionId, eventType, entityId, entityName, meta (Json) | `[ ]` |
| 11.1.4 | Add `WorkSessionEventType` enum: FEATURE_RUN_STARTED, FEATURE_RUN_COMPLETED, TEST_PASSED, TEST_FAILED, MANUAL_STEP_MARKED, BUG_FILED, TICKET_SYNCED, AI_GENERATION_USED, AGENTIC_SESSION_RUN, FEATURE_VIEWED, TEST_EDITED, VERSION_PUBLISHED, SESSION_PAUSED, SESSION_RESUMED | `[ ]` |
| 11.1.5 | Run Prisma migration | `[ ]` |
| 11.1.6 | Unit test: session status transitions (ACTIVE → PAUSED → ACTIVE → STOPPED → REVIEWED) | `[ ]` |

### 11.2 Session Service & Event Recording

| # | Item | Status |
|---|------|--------|
| 11.2.1 | Create `WorkSessionService` — manages lifecycle: start, pause, resume, stop, discard | `[ ]` |
| 11.2.2 | `SessionService.recordEvent(userId, event)` — no-op if no active session, lightweight insert otherwise | `[ ]` |
| 11.2.3 | Hook into `FeatureRunsService.complete()` — record FEATURE_RUN_COMPLETED event | `[ ]` |
| 11.2.4 | Hook into `FeatureRunsService.triggerRun()` — record FEATURE_RUN_STARTED event | `[ ]` |
| 11.2.5 | Hook into `RunsService` step result — record TEST_PASSED / TEST_FAILED events | `[ ]` |
| 11.2.6 | Hook into `IntegrationsService.createTicket()` — record `BUG_FILED` event with meta: `{ ticketUrl, integrationName, provider, testResultId, testName, featureName }` | `[ ]` |
| 11.2.6a | Hook into `IntegrationsService.linkTicket()` (link to existing ticket action) — record `TICKET_SYNCED` event with same meta shape as BUG_FILED | `[ ]` |
| 11.2.7 | Hook into `AiService.generateTests()` — record AI_GENERATION_USED event | `[ ]` |
| 11.2.8 | Hook into `AgentOrchestratorService` session complete — record AGENTIC_SESSION_RUN event | `[ ]` |
| 11.2.9 | One active session per user enforced — starting a new session stops any existing one | `[ ]` |
| 11.2.10 | `stop()`: compute durationMs = (stoppedAt - startedAt) - pausedMs; aggregate metrics from events; set status STOPPED | `[ ]` |
| 11.2.11 | Unit test: `recordEvent()` is a no-op when no session active | `[ ]` |
| 11.2.12 | Unit test: metrics correctly aggregated from event log on stop | `[ ]` |
| 11.2.13 | Unit test: durationMs correctly excludes pause time | `[ ]` |
| 11.2.14 | Unit test: `createTicket()` call records BUG_FILED event with correct ticketUrl, provider, testName, featureName in meta | `[ ]` |
| 11.2.15 | Unit test: `linkTicket()` call records TICKET_SYNCED event with same meta shape | `[ ]` |

### 11.3 AI Summary Generation

| # | Item | Status |
|---|------|--------|
| 11.3.1 | `AiService.summariseSession(events, metrics)` — generates 3-5 sentence plain-language summary | `[ ]` |
| 11.3.2 | Prompt: features tested, pass/fail counts, bugs filed, AI operations, duration → concise factual summary | `[ ]` |
| 11.3.3 | Also generate pre-filled time log notes (shorter, suitable for ClickUp/Jira comment) | `[ ]` |
| 11.3.4 | Called automatically on `stop()` — result stored in `WorkSession.aiSummary` | `[ ]` |
| 11.3.5 | Unit test: summary prompt produces correct structure from known event set | `[ ]` |

### 11.4 Time Logging Integrations

| # | Item | Status |
|---|------|--------|
| 11.4.1 | Add `logTime()` method to `IntegrationPlugin` interface (optional — not all plugins need it) | `[ ]` |
| 11.4.2 | Implement `ClickUpPlugin.logTime()`: `POST /api/v2/task/{taskId}/time` with durationMs + description | `[ ]` |
| 11.4.3 | Implement `JiraPlugin.logTime()`: `POST /rest/api/3/issue/{issueId}/worklog` with timeSpentSeconds + comment | `[ ]` |
| 11.4.4 | `POST /sessions/:id/log-time` endpoint: accepts `{ integrationId, ticketId, notes }`, calls plugin `logTime()` | `[ ]` |
| 11.4.5 | ClickUp task search: `GET /sessions/time-log/search?q={query}&integrationId={id}` — searches ClickUp tasks by name for the task picker | `[ ]` |
| 11.4.6 | Remember last-used ticket per user per project in Redis (`session:last-ticket:{userId}:{projectId}`) | `[ ]` |
| 11.4.7 | Unit test: ClickUp logTime() sends correct payload with duration and notes | `[ ]` |
| 11.4.8 | Unit test: Jira logTime() sends correct worklog payload | `[ ]` |

### 11.5 Session API

| # | Item | Status |
|---|------|--------|
| 11.5.1 | `POST /sessions/start` — start session with optional goal; returns session with id + startedAt | `[ ]` |
| 11.5.2 | `POST /sessions/current/pause` — pause timer, record SESSION_PAUSED event | `[ ]` |
| 11.5.3 | `POST /sessions/current/resume` — resume timer, record SESSION_RESUMED event, accumulate pausedMs | `[ ]` |
| 11.5.4 | `POST /sessions/current/stop` — stop timer, compute metrics, call AI summary, return full session | `[ ]` |
| 11.5.5 | `GET /sessions/current` — active session state (for timer widget polling / WebSocket) | `[ ]` |
| 11.5.6 | `GET /sessions/:id` — session detail with all events joined | `[ ]` |
| 11.5.7 | `PATCH /sessions/:id` — update notes, set status REVIEWED or DISCARDED | `[ ]` |
| 11.5.8 | `POST /sessions/:id/log-time` — log time to external integration | `[ ]` |
| 11.5.9 | `GET /sessions` — current user's session history (paginated) | `[ ]` |
| 11.5.10 | `GET /organisations/:id/sessions` — all org sessions (ORG_ADMIN only) with user filter | `[ ]` |
| 11.5.11 | Auto-stop on logout: `AuthService.logout()` calls `sessionService.stop(userId)` if active session exists | `[ ]` |
| 11.5.12 | Unit test: start → pause → resume → stop produces correct durationMs | `[ ]` |
| 11.5.13 | Integration test: full session lifecycle with time log call | `[ ]` |

### 11.6 Frontend — Session Timer Widget (Top Nav)

| # | Item | Status |
|---|------|--------|
| 11.6.1 | `SessionTimerWidget` component in top nav — always visible | `[ ]` |
| 11.6.2 | Idle state: "▶ Start Session" button (opens Start Session modal) | `[ ]` |
| 11.6.3 | Active state: pulsing red dot + live elapsed time (HH:MM:SS) + "■ Stop" button | `[ ]` |
| 11.6.4 | Live clock: updates every second using `setInterval` + session `startedAt` from store | `[ ]` |
| 11.6.5 | Paused state: yellow dot + paused clock + "▶ Resume" button | `[ ]` |
| 11.6.6 | Clicking active timer: opens Session HUD dropdown | `[ ]` |
| 11.6.7 | Session HUD: elapsed time, goal, live counts (runs/passed/failed/bugs), "Stop & Review" + "Pause" | `[ ]` |
| 11.6.8 | Start Session modal: optional goal text input, "Start" button | `[ ]` |
| 11.6.9 | Session state stored in Zustand `sessionStore` — synced from `GET /sessions/current` on app load | `[ ]` |
| 11.6.10 | WebSocket event `session:event` updates live counts in HUD without polling | `[ ]` |
| 11.6.11 | Component test: idle → start → active state, live clock increments, stop button appears | `[ ]` |

### 11.7 Frontend — Session Review Modal

| # | Item | Status |
|---|------|--------|
| 11.7.1 | `SessionReviewModal` — shown automatically when session is stopped | `[ ]` |
| 11.7.2 | Header: session date, duration, goal | `[ ]` |
| 11.7.3 | AI Summary section: summary paragraph (loading skeleton while AI generates) | `[ ]` |
| 11.7.4 | Activity Breakdown: table of features worked on with test counts and pass/fail | `[ ]` |
| 11.7.5 | Footer stats: bugs filed, AI generations used, manual steps marked | `[ ]` |
| 11.7.6 | Log Time section: integration selector (ClickUp / Jira — only shows configured integrations) | `[ ]` |
| 11.7.7 | ClickUp task picker: search input → dropdown of matching tasks (debounced API search) | `[ ]` |
| 11.7.8 | Jira issue picker: search input → dropdown of matching issues | `[ ]` |
| 11.7.9 | Notes textarea: pre-filled with AI time log notes, fully editable before submission | `[ ]` |
| 11.7.10 | "Log Time & Save" — calls `/sessions/:id/log-time` then `/sessions/:id` PATCH to REVIEWED | `[ ]` |
| 11.7.11 | "Save Without Logging" — PATCH status to REVIEWED, skips time log | `[ ]` |
| 11.7.12 | "Discard Session" — PATCH status to DISCARDED with confirmation | `[ ]` |
| 11.7.13 | On-login unreviewed session banner: "You have an unreviewed session from {date} ({duration}). Review now?" | `[ ]` |
| 11.7.14 | Report Distribution section (collapsible "Notify Managers" panel): toggle to send session report email on save | `[ ]` |
| 11.7.15 | Extra recipients field: comma-separated email addresses appended to the resolved manager list | `[ ]` |
| 11.7.16 | "Include PDF attachment" checkbox (default on) in the report distribution panel | `[ ]` |
| 11.7.17 | On "Log Time & Save" or "Save Without Logging": if report toggle is on, trigger `POST /sessions/:id/report/send` | `[ ]` |
| 11.7.18 | Component test: modal renders summary + breakdown, task picker populates, log action fires, report toggle triggers send | `[ ]` |

### 11.8 Frontend — Session History & Detail

| # | Item | Status |
|---|------|--------|
| 11.8.1 | Profile → Sessions tab (`/profile/sessions`): user's session history table | `[ ]` |
| 11.8.2 | Columns: date, duration, goal, features worked, pass rate, bugs filed, time logged (ticket link) | `[ ]` |
| 11.8.3 | Expandable row: full AI summary + event timeline preview (first 5 events) | `[ ]` |
| 11.8.4 | Filter: date range, project, status, has bugs, time logged | `[ ]` |
| 11.8.5 | Org Admin → Team Sessions tab: all members' sessions, filter by member | `[ ]` |
| 11.8.6 | Org-level stats cards: total QA hours this month, avg session length, top tester by hours | `[ ]` |
| 11.8.7 | Add route `/sessions/:id` → `SessionDetailPage` | `[ ]` |
| 11.8.8 | Session detail header: session date, duration badge, status badge, project name, "Back to History" link | `[ ]` |
| 11.8.9 | Inline-edit for editable fields: goal, notes, start time, end time — clicking field opens inline text/datetime input; saves on blur via `PATCH /sessions/:id` | `[ ]` |
| 11.8.10 | AI Summary section on detail page: rendered markdown, "Regenerate Summary" button (calls `POST /sessions/:id/regenerate-summary`) | `[ ]` |
| 11.8.11 | Event timeline section: full chronological list of `WorkSessionEvent` entries with icon per event type, relative timestamp, and entity deep-link; `BUG_FILED` and `TICKET_SYNCED` events render the ticket URL as a clickable external link (opens in new tab) showing provider icon + ticket title | `[ ]` |
| 11.8.12 | "+Add note" per timeline event: click opens inline text input; note saved to `WorkSessionEvent.meta.note` via `PATCH /sessions/:id/events/:eventId` | `[ ]` |
| 11.8.13 | Edit history metadata: show "Last edited {relative time} by {name}" below editable fields when `updatedAt` differs from `createdAt` | `[ ]` |
| 11.8.14 | "Re-send Report" button in session detail page header action bar: calls `POST /sessions/:id/report/send`; shows toast on success | `[ ]` |
| 11.8.15 | "Download PDF" button: calls `GET /sessions/:id/report/pdf` → file download with filename `session-{date}.pdf` | `[ ]` |
| 11.8.16 | Time log section on detail page: shows logged ticket link (ClickUp/Jira), duration, notes; read-only (log cannot be re-sent, already dispatched) | `[ ]` |
| 11.8.17 | Monthly stats summary panel in `/profile/sessions`: hours this month, sessions this month, avg session duration | `[ ]` |
| 11.8.18 | Component test: history table renders, expandable row shows timeline; detail page renders editable fields and timeline; "+Add note" saves correctly | `[ ]` |

### 11.9 Session Report Generation & Email Distribution

| # | Item | Status |
|---|------|--------|
| 11.9.1 | Add `WorkSession.reportSentAt DateTime?` and `reportRecipients String[]` fields to track dispatch history | `[ ]` |
| 11.9.2 | Add `WorkSessionReportSettings` to `OrganisationSettings`: `autoSendOnReview Boolean @default(false)`, `extraRecipients String[]`, `includePdf Boolean @default(true)` | `[ ]` |
| 11.9.3 | Run Prisma migration for new fields | `[ ]` |
| 11.9.4 | `SessionReportService.resolveRecipients(session)` — build recipient list: session owner + all project `MANAGER` members for every `projectId` touched in session events + phase `MANAGER` roles + org-level `extraRecipients` + per-call extra recipients; deduplicate by email | `[ ]` |
| 11.9.5 | `SessionReportService.buildReportData(sessionId)` — fetch session + events + user + org; aggregate metrics by project/feature; return `SessionReportData` typed object | `[ ]` |
| 11.9.6 | HTML report template (Handlebars or inline template string): header with org logo + session metadata; Coverage Summary table (projects × features × pass rate); Event Timeline (condensed); AI Summary block; footer with "QA Platform" branding | `[ ]` |
| 11.9.7 | `SessionReportService.renderHtml(data)` — renders HTML report string from template + data | `[ ]` |
| 11.9.8 | `SessionReportService.renderPdf(html)` — calls existing `ReportService` Puppeteer pipeline to produce PDF `Buffer` | `[ ]` |
| 11.9.9 | `SessionReportService.sendReport(sessionId, options)` — resolve recipients, render HTML + PDF (if `includePdf`), call `EmailService.send()` with HTML body + optional PDF attachment; update `session.reportSentAt` and `session.reportRecipients` | `[ ]` |
| 11.9.10 | `EmailService` — add `sendSessionReport()` method: subject `"QA Session Report — {goal or date} — {orgName}"`, HTML body, conditional PDF attachment | `[ ]` |
| 11.9.11 | Auto-trigger: in `WorkSessionService.review()` (called when status moves to REVIEWED), call `SessionReportService.sendReport()` if `org.reportSettings.autoSendOnReview` is true | `[ ]` |
| 11.9.12 | `POST /sessions/:id/report/send` endpoint — accepts `{ extraRecipients?: string[], includePdf?: boolean }`, calls `SessionReportService.sendReport()`; returns `{ sentTo: string[], sentAt: Date }` | `[ ]` |
| 11.9.13 | `GET /sessions/:id/report/pdf` endpoint — renders PDF and returns binary response with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="session-{date}.pdf"` | `[ ]` |
| 11.9.14 | `POST /sessions/:id/regenerate-summary` endpoint — re-calls `AiService.summariseSession()` and updates `session.aiSummary`; returns updated session | `[ ]` |
| 11.9.15 | `PATCH /sessions/:id/events/:eventId` endpoint — accepts `{ note: string }`; updates `WorkSessionEvent.meta` with note field | `[ ]` |
| 11.9.16 | Org settings page: "Session Reports" settings section — auto-send toggle, default extra recipients, include PDF toggle | `[ ]` |
| 11.9.17 | Unit test: `resolveRecipients()` deduplicates correctly across owner + project managers + extras | `[ ]` |
| 11.9.18 | Unit test: `buildReportData()` returns correct per-feature pass/fail counts from event set | `[ ]` |
| 11.9.19 | Integration test: `sendReport()` for a reviewed session → email sent (mocked SMTP), `reportSentAt` updated, correct recipient list stored | `[ ]` |
| 11.9.20 | Integration test: `GET /sessions/:id/report/pdf` returns valid PDF binary for a completed session | `[ ]` |

---

## Manual Testing Procedures

These are step-by-step procedures to manually verify the platform works end-to-end.
Run these against a local `docker compose up` stack.

### MT-01 — Auth Flow

```
1. Open http://localhost:3000
2. Hit an authenticated route — confirm redirect or 401
3. POST /api/v1/auth/register { name, email, password }
   → Expect 201, { access_token: "..." }
4. POST /api/v1/auth/login { email, password }
   → Expect 200, { access_token: "..." }
5. GET /api/v1/auth/me (with Bearer token)
   → Expect 200, { id, email, name, role }
6. GET /api/v1/auth/me (no token)
   → Expect 401
7. POST /api/v1/auth/register (same email again)
   → Expect 409 Conflict
```

### MT-02 — Project Lifecycle

```
1. POST /api/v1/projects { name: "Demo App", slug: "demo-app", description: "..." }
   → Expect 201, project object with id
2. GET /api/v1/projects
   → Expect 200, array containing new project
3. GET /api/v1/projects/:id
   → Expect 200, project with environments=[], _count
4. PUT /api/v1/projects/:id { name: "Demo App v2" }
   → Expect 200, updated name
5. DELETE /api/v1/projects/:id
   → Expect 200
6. GET /api/v1/projects
   → Project should no longer appear (soft-deleted)
```

### MT-03 — Environment Configuration

```
1. POST /api/v1/projects/:id/environments {
     name: "Local Dev", type: "LOCAL", baseUrl: "http://localhost:5173"
   }
   → Expect 201
2. POST with type: "STAGING", baseUrl: "https://staging.example.com",
   headers: { "x-api-key": "test" }, variables: { "USER_EMAIL": "qa@test.com" }
   → Expect 201
3. GET /api/v1/projects/:id/environments
   → Expect both environments in array
4. PUT /api/v1/projects/:id/environments/:envId { baseUrl: "http://localhost:3000" }
   → Expect updated baseUrl
```

### MT-04 — Test Definition CRUD

```
1. POST /api/v1/projects/:id/tests {
     name: "Login Smoke",
     steps: [
       { index: 0, name: "Navigate", type: "NAVIGATE", input: { url: "/" } },
       { index: 1, name: "Fill email", type: "FILL", input: { selector: "#email", value: "qa@test.com" } },
       { index: 2, name: "Fill password", type: "FILL", input: { selector: "#password", value: "password123" } },
       { index: 3, name: "Click submit", type: "CLICK", input: { selector: "button[type=submit]" } },
       { index: 4, name: "Assert logged in", type: "ASSERT_URL", input: { url: "/dashboard" } }
     ],
     config: { browser: "chromium", headless: true, timeout: 30000, retries: 1 }
   }
   → Expect 201, version: 1
2. PUT /api/v1/projects/:id/tests/:testId { name: "Login Smoke v2" }
   → Expect version: 2
3. POST /api/v1/projects/:id/tests/:testId/duplicate
   → Expect new test with name "Login Smoke v2 (copy)", version: 1
4. DELETE /api/v1/projects/:id/tests/:testId
   → Expect 200, test archived
```

### MT-05 — Test Run Execution

```
1. Ensure worker is running (docker compose ps — worker should be Up)
2. POST /api/v1/projects/:id/runs/trigger {
     environmentId: "<env-id>",
     testDefinitionId: "<test-id>",
     trigger: "manual"
   }
   → Expect 201, run.status = "PENDING" or "QUEUED"
3. GET /api/v1/projects/:id/runs/:runId
   → Poll every 2s until status is PASSED, FAILED, or ERROR (max 60s)
4. Inspect run.steps — each step should have status, duration, output
5. If any step has SCREENSHOT type — confirm artifacts array is not empty
6. If run PASSED — confirm no errorMessage
7. If run FAILED — inspect firstFailedStep.errorMessage
```

### MT-06 — Artifact Download

```
1. Complete MT-05 with a test that includes a SCREENSHOT step
2. GET /api/v1/runs/:runId/artifacts
   → Expect array with at least one SCREENSHOT artifact
3. GET /api/v1/artifacts/:artifactId/download
   → Expect 200, Content-Type: image/png, binary body
4. Attempt path traversal: GET /api/v1/artifacts/../../../etc/passwd/download
   → Expect 400 or 404 (never 200)
```

### MT-07 — AI Features

```
Prerequisites: AI provider configured (ANTHROPIC_API_KEY or other)

A) Test Generation
   POST /api/v1/ai/projects/:id/generate-test
   Body: { prompt: "Create a smoke test for a login page with email and password fields" }
   → Expect 200, valid JSON test definition with steps array
   → Each step should have index, name, type, input

B) Run Summarization
   (requires a completed run from MT-05)
   POST /api/v1/ai/runs/:runId/summarise
   → Expect 200, plain-English string (3-5 sentences)
   → GET /api/v1/runs/:runId — aISummaries array should contain entry

C) Failure Explanation
   (requires a FAILED run)
   POST /api/v1/ai/runs/:runId/explain
   → Expect 200, text with root cause, category, suggested fix, confidence
```

### MT-08 — UI End-to-End Walkthrough

```
1. Open http://localhost:3000
2. Navigate to /projects — confirm project list loads
3. Click "+ New Project" — fill form, submit — confirm project appears in list
4. Click project name → /projects/:id — confirm counts show
5. Click "Manage Environments" → create Local Dev environment
6. Navigate to Tests tab → click "+ New Test" → paste JSON from MT-04
7. Click "Run Tests" → Trigger Run modal → select test + environment → Submit
8. Navigate to Runs → confirm run appears with PENDING/QUEUED/RUNNING status
9. Click run → confirm live step updates (or refresh)
10. When run completes — confirm step statuses are shown
11. If FAILED — click "Explain Failure" → confirm AI text appears
12. Click artifact download link → confirm file downloads
13. Navigate to AI page → enter prompt → click Generate → confirm JSON output
```

### MT-09 — Multi-browser Execution

```
1. Create test definition with config.browser = "firefox"
2. Trigger run
3. Confirm run completes (PASSED or FAILED, not ERROR)
4. Repeat with config.browser = "webkit"
```

### MT-10 — Queue & Concurrency

```
1. Trigger 5 test runs simultaneously (parallel POST requests)
2. GET /api/v1/projects/:id/runs — confirm at most WORKER_CONCURRENCY runs are RUNNING
3. Confirm all 5 eventually reach a terminal state
4. No run should be stuck in RUNNING indefinitely
```

### MT-11 — Health Check

```
1. GET /api/v1/health
   → { status: "ok", db: "connected", timestamp: "..." }
2. Stop the postgres container
3. GET /api/v1/health
   → { status: "error", db: "disconnected" }
4. Restart postgres — health should return ok within 30s
```

### MT-12 — AI Provider Switching

```
For each provider you have access to (anthropic / openai / ollama):
1. Set AI_PROVIDER=<provider> (and required keys) in docker-compose or .env
2. Restart api service
3. POST /api/v1/ai/projects/:id/generate-test { prompt: "login smoke test" }
   → Expect 200, valid JSON
4. Check AISummary.model field in DB — should reflect correct provider label
```

---

## Automated Test Suite Plan

### Test File Structure

```
apps/
  api/
    src/
      modules/
        auth/
          auth.service.spec.ts
          auth.controller.spec.ts
        projects/
          projects.service.spec.ts
          projects.controller.spec.ts
        environments/
          environments.service.spec.ts
        tests/
          tests.service.spec.ts
        runs/
          runs.service.spec.ts
        artifacts/
          artifacts.service.spec.ts
        ai/
          ai.service.spec.ts
          providers/
            provider.factory.spec.ts
        queue/
          queue.service.spec.ts
      common/
        guards/
          roles.guard.spec.ts
    test/
      integration/
        auth.e2e-spec.ts
        project-lifecycle.e2e-spec.ts
        run-trigger.e2e-spec.ts
  worker/
    src/
      steps/
        step.runner.spec.ts
      collectors/
        artifact.collector.spec.ts
      executors/
        run.executor.spec.ts
  web/
    src/
      components/
        ui/
          Button.test.tsx
          Badge.test.tsx
          RunStatusBadge.test.tsx
          Modal.test.tsx
          StatCard.test.tsx
      pages/
        projects/
          ProjectsPage.test.tsx
        runs/
          RunsPage.test.tsx
          RunDetailPage.test.tsx
        ai/
          AiPage.test.tsx
      lib/
        utils.test.ts
tests/
  smoke/
    health.spec.ts
    auth.spec.ts
    project-lifecycle.spec.ts
    run-trigger.spec.ts
    ui-walkthrough.spec.ts
```

### What Each Test Layer Covers

| Layer | Scope | Tools | DB | Browser |
|-------|-------|-------|----|---------|
| Unit (API) | Single service/guard logic, no I/O | Jest, mock PrismaService | Mocked | No |
| Unit (Worker) | StepRunner, Collector, Executor logic | Jest, mock Playwright Page | Mocked | No |
| Unit (Web) | React components, hooks, utils | Vitest, RTL, MSW | No | jsdom |
| Integration (API) | Full request → controller → service → DB | Jest, NestJS TestingModule, test DB | Real (test DB) | No |
| Smoke | Key user paths against running stack | Playwright API + UI | Real | Real |

### Test Data Strategy

- Integration tests: use a dedicated test DB (`DATABASE_URL_TEST`), run `prisma migrate reset` before suite
- Each integration test creates its own data, cleans up in `afterEach`
- Smoke tests: create a fresh user per suite, delete project at end
- Worker unit tests: mock `getPrisma()` and `BrowserContext`

---

## Verification Checklist (pre-release gate)

Run this checklist before any release to staging or production.

### API Correctness

- [ ] All 30+ endpoints return correct HTTP status codes
- [ ] Unauthenticated requests return 401
- [ ] VIEWER role cannot delete resources
- [ ] Duplicate email returns 409
- [ ] Invalid run ID returns 404
- [ ] Path traversal on artifact download returns 400/404
- [ ] Cancelling already-completed run returns 409
- [ ] Triggering run with non-existent environment returns 404

### Worker Correctness

- [ ] Run with all NAVIGATE + ASSERT_URL steps passes
- [ ] Run with failing ASSERT_TEXT step marks run FAILED, not ERROR
- [ ] Screenshot artifact is created and downloadable
- [ ] Trace artifact is created after run completes
- [ ] Worker recovers and processes next job after a crash

### AI Features

- [ ] Generate test returns valid parseable JSON
- [ ] Explain failure returns non-empty text for a failed run
- [ ] Summarise run returns non-empty text for a completed run
- [ ] AISummary record is persisted in DB after each AI call
- [ ] AI_PROVIDER=ollama works against local Ollama instance
- [ ] Missing AI provider throws clear error message (not 500)

### Frontend

- [ ] All pages load without JS console errors
- [ ] Run detail page shows correct step statuses
- [ ] RunStatusBadge shows correct colour for each status
- [ ] Screenshots display in run detail
- [ ] AI generate test output can be copied
- [ ] Create project form validates slug format
- [ ] 404 page shown for unknown routes

### Performance

- [ ] GET /projects responds in < 200ms with 10 projects
- [ ] GET /runs responds in < 500ms with 100 runs
- [ ] Run trigger to first step execution < 3s
- [ ] Frontend initial load < 3s on localhost

### Security

- [ ] JWT_SECRET shorter than 32 chars causes startup error
- [ ] Bearer token from user A cannot access resources owned by user B
- [ ] Artifact download does not serve files outside ARTIFACT_STORAGE_PATH
- [ ] Environment `variables` with key containing "password" is masked in API response

### Infrastructure

- [ ] `docker compose up` starts all 5 services without errors
- [ ] `GET /api/v1/health` returns ok after stack start
- [ ] Prisma migrations run clean on fresh DB
- [ ] Worker reconnects to Redis after Redis restart
- [ ] API reconnects to DB after Postgres restart
- [ ] Artifacts volume is shared correctly between api and worker containers

### Test Suite

- [ ] `pnpm test:api` passes with ≥ 80% line coverage
- [ ] `pnpm test:worker` passes with ≥ 80% line coverage
- [ ] `pnpm test:web` passes with ≥ 70% line coverage
- [ ] `pnpm test:smoke` passes against running local stack
- [ ] No test depends on external network (unit/integration)
- [ ] Test suite completes in < 3 minutes

---

## Implementation Order (recommended)

```
Phase 0 (bugs)  →  Phase 1 (tests)  →  Phase 2 (RBAC + security foundations)
→  Phase 4 (security hardening)  →  Phase 3 (UX)  →  Phase 5 (advanced)  →  Phase 6 (ops)
```

Do Phase 0 and Phase 1 together — fix bugs, write tests to prove they are fixed.
Do not start Phase 5 until Phase 2 and 4 are complete.
