# QA Platform — Architecture

## Overview

A self-hosted AI QA automation platform that combines deterministic browser testing with AI-assisted analysis and test generation. Built as a **multi-tenant SaaS** — all data belongs to an **Organisation** (tenant). Users can belong to multiple organisations and switch between them via the org switcher in the top nav.

**Core principle: deterministic execution first, AI augmentation second.**

---

## Multi-Tenancy

```
Platform
  ├── Organisation A  (Acme Corp)          ← tenant boundary
  │     ├── OrgMembers (users + roles)
  │     ├── Project 1  →  Modules → Features → Test Cases
  │     └── PlatformConfig (AI keys, email server)
  │
  ├── Organisation B  (Globex Inc)
  │     └── ...
  │
  └── PLATFORM_ADMIN users — can manage all orgs
```

Every API request is scoped to the active org via an `OrgScopeInterceptor` that injects
`req.orgId` from the authenticated user's `lastActiveOrgId`. Cross-org data access is
impossible — all service queries include `WHERE orgId = req.orgId`.

See `docs/MULTI_TENANCY_AND_RBAC.md` for the full RBAC model, user management, and
Platform Admin Panel specification.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / Client                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP
┌─────────────────────────▼───────────────────────────────────┐
│                     Web UI  :3000                           │
│              React + Vite + Tailwind CSS                     │
│         (served by nginx in Docker, Vite in dev)            │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP /api/v1
┌─────────────────────────▼───────────────────────────────────┐
│                    API Server  :3001                         │
│              NestJS + Fastify + Prisma ORM                   │
│   Auth · Projects · Tests · Runs · Artifacts · AI · Queue   │
└──────┬──────────────────┬──────────────────┬────────────────┘
       │ Prisma            │ BullMQ            │ LangChain
┌──────▼──────┐   ┌───────▼───────┐   ┌──────▼──────────────┐
│  PostgreSQL  │   │     Redis     │   │   AI Provider       │
│  :5432      │   │    :6379      │   │  (Anthropic /       │
│             │   │               │   │   OpenAI / Azure /  │
│  All data   │   │  Job queue    │   │   Ollama / vLLM)    │
└─────────────┘   └───────┬───────┘   └─────────────────────┘
                          │ BullMQ Worker
┌─────────────────────────▼───────────────────────────────────┐
│                    Worker Service                            │
│              Node.js + Playwright + BullMQ                   │
│         Executes test steps, captures artifacts              │
└─────────────────────────┬───────────────────────────────────┘
                          │ writes to
                    /app/artifacts
                   (shared Docker volume)
```

---

## Services

| Service | Technology | Port | Purpose |
|---------|-----------|------|---------|
| `web` | React 18, Vite, Tailwind CSS | 3000 | Operator console UI |
| `api` | NestJS 10, Fastify adapter | 3001 | REST API + WebSocket gateway + orchestration |
| `worker` | Node.js, Playwright 1.42, BullMQ | — | Test execution engine + CDP screencast |
| `postgres` | PostgreSQL 16 + pgvector | 5432 | Primary database + vector embeddings for RAG |
| `redis` | Redis 7 | 6379 | BullMQ job queue + screencast pub/sub channels |

All services run as Docker containers, coordinated by `docker-compose.yml`. The `api` and `worker` share an `artifacts_data` volume for screenshots, traces, videos, recordings, and reports.

### Updated system diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / Client                          │
└────────────────┬──────────────────────────┬─────────────────────┘
                 │ HTTP                      │ WebSocket (Socket.io)
┌────────────────▼──────────────────────────▼─────────────────────┐
│                     Web UI  :3000                                │
│          React 18 · Vite · Tailwind · TanStack Query            │
│   AppShell (TopNav + Sidebar) · LiveBrowserCanvas · UAT View    │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP /api/v1 + WS /runs, /screencast
┌────────────────────────────▼────────────────────────────────────┐
│                    API Server  :3001                             │
│           NestJS + Fastify + Prisma + Socket.io                 │
│                                                                  │
│  Auth · Orgs · Projects · Modules · Features · Tests            │
│  Runs · FeatureRuns · Phases · Versions · Artifacts             │
│  AI · Queue · Integrations · Reports · Screencasting            │
└───┬────────────────┬──────────────────────┬──────────────────────┘
    │ Prisma         │ BullMQ publish        │ LangChain
┌───▼────────┐  ┌────▼──────────────┐  ┌───▼───────────────────┐
│ PostgreSQL  │  │      Redis        │  │    AI Provider        │
│ :5432      │  │     :6379         │  │  Anthropic / OpenAI   │
│            │  │                   │  │  Azure / Ollama       │
│ Data +     │  │ BullMQ queue      │  │  OpenAI-compatible    │
│ pgvector   │  │ Screencast pub/sub│  └───────────────────────┘
│ embeddings │  └────────┬──────────┘
└────────────┘           │ BullMQ consume
                ┌────────▼──────────────────────────────────────┐
                │              Worker Service                    │
                │     Node.js · Playwright · BullMQ             │
                │                                               │
                │  StepRunner (UI/API/Shell)                    │
                │  AiStepResolver (selector healing)            │
                │  AiOutcomeVerifier                            │
                │  ScreencastService (CDP → Redis pub/sub)      │
                │  PhaseEngine (phase transition logic)         │
                └───────────────────┬───────────────────────────┘
                                    │ writes to
                             /app/artifacts
                           (shared Docker volume)
```

---

## Database

### Why PostgreSQL

PostgreSQL was chosen over alternatives for the following reasons:

**vs MySQL**
- Native `ARRAY` type — used for `TestDefinition.tags String[]`
- Superior `JSONB` support — steps, config, headers, variables are stored as JSON with indexing capability

**vs MongoDB**
- Foreign key constraints and `onDelete: Cascade` — enforces referential integrity across the `Project → Module → Feature → TestDefinition → TestRun → RunStep` hierarchy without application-level checks
- ACID transactions — critical for atomic run state updates (`PENDING → RUNNING → PASSED/FAILED`) across multiple tables
- SQL aggregations — pass rates, trend data, flaky test detection are simpler and faster with SQL joins than MongoDB aggregation pipelines
- Prisma's MongoDB support lacks referential integrity enforcement and cascading deletes

**vs SQLite**
- Not suitable for concurrent worker processes writing run results simultaneously

**Best of both worlds**
The schema-flexible parts of the data model (`steps`, `config`, `headers`, `variables`, `metadata`) are stored as `Json` columns backed by PostgreSQL JSONB — giving document-style flexibility inside a relational structure.

### ORM: Prisma

Prisma was chosen over raw query builders (Knex, Drizzle) for:
- Auto-generated TypeScript types from `schema.prisma` — `AISummaryType`, `RunStatus`, `StepType` etc. used throughout the codebase
- Schema as single source of truth — all models defined in one file
- `prisma migrate dev` — automatic migration generation from schema diffs
- Built-in `include` for relation fetching — avoids manual join queries
- Prisma Studio — visual DB browser for development

---

## Data Model

### Full Hierarchy

```
Platform
  └── Organisation (tenant)
        ├── OrgMember[]           — users with OrgRole (ORG_ADMIN | ORG_MEMBER)
        ├── OrgInvite[]           — pending email invitations
        ├── AccessRequest[]       — org-level and project-level access requests
        ├── AuditLog[]            — immutable action log
        ├── PlatformConfig        — org-wide AI keys, email server, shared vars
        │
        └── Project
              ├── ProjectMember[] — users with ProjectRole (OWNER|TECH_LEAD|DEVELOPER|QA_ENGINEER|MANAGER)
              ├── Environment[]   — target URLs, headers, env vars per environment
              ├── ProjectPhase[]  — configurable testing phases (QA → UAT → Sign-off)
              │     ├── PhaseAssignment[]  — users assigned to each phase with PhaseRole
              │     └── PhaseReportSchedule[] — scheduled progress reports
              ├── RepoConnection  — GitHub/GitLab/local repo for RAG indexing
              │     └── CodeChunk[] — indexed + embedded code chunks (pgvector)
              │
              └── Module
                    └── Feature
                          ├── FeatureVersion[]  — published snapshots (draft → publish workflow)
                          ├── FeaturePhase[]    — per-phase status tracking (PENDING→PASSED)
                          │
                          └── TestDefinition (type: UI | API | SHELL)
                                ├── steps: Json[]    — step definitions
                                ├── config: Json     — browser, timeout, aiExecution flags
                                │
                                └── TestRun (linked to Environment + FeatureRun + FeatureVersion)
                                      ├── RunStep[]      — per-step results
                                      │     ├── manualNotes   — tester notes (manual mode)
                                      │     ├── jiraIssueKey  — if ticket created from failure panel
                                      │     └── status: PENDING|RUNNING|PASSED|FAILED|SKIPPED|ABORTED
                                      ├── Artifact[]     — screenshots, traces, videos, recordings, PDFs
                                      ├── AISummary[]    — AI explanations, summaries
                                      └── SelectorHeal[] — AI-healed selector records

FeatureRun (groups sequential TestRuns for a Feature)
  ├── status: IDLE|RUNNING|PAUSED|COMPLETE|CANCELLED
  ├── runMode: AUTOMATED | MANUAL
  ├── featureVersionId          — version active at run time
  └── featurePhaseId            — phase this run belongs to
```

### Key Models — summary

| Model | Purpose |
|-------|---------|
| `Organisation` | Tenant boundary. All data isolated per org. |
| `OrgMember` | User → Org relationship with `OrgRole` |
| `OrgInvite` | Time-limited (72h) email invite with accept/reject flow |
| `AccessRequest` | User-initiated request to join org or project (admin approves) |
| `UserSsoAccount` | Links a user to a Google or Microsoft OAuth provider identity |
| `Project` | Top-level container per org |
| `ProjectPhase` | Configurable testing phase (name, order, color, autoPromote) |
| `PhaseAssignment` | User assigned to a phase as TESTER, MANAGER, or VIEWER |
| `FeaturePhase` | Tracks each feature's status within each phase (PENDING → PASSED) |
| `PhaseReportSchedule` | Scheduled email reports (daily/weekly/monthly) per phase or project |
| `Feature` | Groups test cases; has `isDraft` flag and `activeVersionId` |
| `FeatureVersion` | Immutable snapshot of a feature's test cases at publish time |
| `TestDefinition` | Single test case; type fixed (UI/API/SHELL); steps as JSONB |
| `FeatureRun` | Orchestrates sequential test runs for a full feature; play/pause/stop |
| `TestRun` | Single test execution; records environment, version, phase, mode |
| `RunStep` | Per-step result; includes manual notes, jira key, SKIPPED/ABORTED status |
| `SelectorHeal` | Records when AI healed a broken CSS selector |
| `Artifact` | File reference (screenshot, trace, video, recording, PDF report) |
| `AISummary` | Persisted AI prompt/response with model label |
| `AuditLog` | Append-only log of sensitive actions (role changes, deletions, etc.) |
| `RepoConnection` | Connected GitHub/GitLab/local repo for RAG indexing |
| `CodeChunk` | Indexed code fragment with pgvector embedding for semantic search |
| `PlatformConfig` | Org-wide shared config (AI provider, email server, global vars) |

### Enums — full list

| Enum | Values |
|------|--------|
| `PlatformRole` | `USER` `PLATFORM_ADMIN` |
| `OrgRole` | `ORG_ADMIN` `ORG_MEMBER` |
| `ProjectRole` | `OWNER` `TECH_LEAD` `DEVELOPER` `QA_ENGINEER` `MANAGER` |
| `PhaseRole` | `TESTER` `MANAGER` `VIEWER` |
| `PhaseStatus` | `PENDING` `IN_PROGRESS` `PASSED` `FAILED` `BLOCKED` `SKIPPED` |
| `RunMode` | `AUTOMATED` `MANUAL` |
| `TestCaseType` | `UI` `API` `SHELL` |
| `RunStatus` | `PENDING` `QUEUED` `RUNNING` `PASSED` `FAILED` `CANCELLED` `TIMED_OUT` `ERROR` |
| `RunStepStatus` | `PENDING` `RUNNING` `PASSED` `FAILED` `SKIPPED` `ABORTED` `ERROR` |
| `FeatureRunStatus` | `IDLE` `RUNNING` `PAUSED` `COMPLETE` `CANCELLED` |
| `AccessRequestType` | `ORG` `PROJECT` |
| `AccessRequestStatus` | `PENDING` `APPROVED` `REJECTED` |
| `ReportFrequency` | `DAILY` `WEEKLY` `MONTHLY` |
| `StepType (UI)` | `NAVIGATE` `CLICK` `FILL` `SELECT` `ASSERT_TEXT` `ASSERT_VISIBLE` `ASSERT_URL` `ASSERT_ELEMENT` `WAIT` `SCREENSHOT` `KEYBOARD` `SCROLL` `HOVER` `CUSTOM` |
| `StepType (API)` | `REQUEST` `ASSERT_STATUS` `ASSERT_BODY` `ASSERT_HEADER` `EXTRACT` `DELAY` |
| `StepType (SHELL)` | `COMMAND` `ASSERT_EXIT` `ASSERT_OUTPUT` `ASSERT_CONTAINS` |
| `ArtifactType` | `SCREENSHOT` `TRACE` `VIDEO` `RECORDING` `LOG` `REPORT` `HAR` |
| `AISummaryType` | `RUN_SUMMARY` `FAILURE_EXPLANATION` `TEST_GENERATION` `RECOMMENDATION` `EXPLORATORY_REPORT` |

---

## API

### Structure

- Framework: NestJS with Fastify adapter (higher throughput than Express)
- Prefix: `/api/v1`
- Auth: JWT Bearer tokens, 7-day expiry
- Validation: `class-validator` on all DTOs with global `ValidationPipe`
- Docs: Swagger UI at `/docs`

### Modules

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Register, login, JWT strategy, Google/Microsoft SSO, account linking |
| `OrganisationsModule` | Org CRUD, invite flow, access requests, org switching |
| `UsersModule` | User management, platform admin actions, GDPR hard-delete |
| `ProjectsModule` | Project CRUD, project member management |
| `ModulesModule` | Module CRUD (org-scoped) |
| `FeaturesModule` | Feature CRUD, feature versioning (publish, diff, restore) |
| `EnvironmentsModule` | Environment CRUD, variable resolution |
| `TestsModule` | Test definition CRUD, step validation per type |
| `RunsModule` | Individual run triggering, cancellation, status, stats |
| `FeatureRunsModule` | Feature-level orchestration — play/pause/stop, sequential execution |
| `PhasesModule` | Phase config, phase assignments, feature phase transitions, PhaseEngine |
| `ReportsModule` | On-demand + scheduled progress reports (HTML + PDF via Puppeteer) |
| `ArtifactsModule` | Artifact listing, file download, signed URLs |
| `AiModule` | Test generation, failure explanation, summarization, RAG indexing |
| `IntegrationsModule` | Email, Slack, Teams, Jira, custom webhook plugins |
| `ScreencastModule` | WebSocket gateway for CDP screencast fan-out (Redis → Socket.io) |
| `QueueModule` | BullMQ queue wrapper + scheduled job processor (global) |
| `HealthModule` | DB + Redis connectivity check |

### Run Flow

```
POST /runs/trigger
       │
       ▼
 RunsService.trigger()
  ├── Validates environment + test exist
  ├── Creates TestRun { status: PENDING }
  └── QueueService.enqueueRun(runId)
                    │
                    ▼
              Redis (BullMQ queue)
                    │
                    ▼
          Worker picks up job
                    │
                    ▼
        RunExecutor.execute(runId)
          ├── Updates run: RUNNING
          ├── Launches Playwright browser
          ├── Iterates steps via StepRunner
          │     ├── Each step: creates RunStep, executes, updates result
          │     └── On failure: captures screenshot, breaks loop
          ├── Stops trace, saves trace.zip artifact
          └── Updates run: PASSED or FAILED
```

---

## AI Layer

### Provider Abstraction

The AI layer uses LangChain with a provider factory (`provider.factory.ts`) that resolves the correct model at runtime based on environment config. This allows switching providers without code changes.

**Supported providers:**

| `AI_PROVIDER` | Description | Key env vars |
|---------------|-------------|--------------|
| `anthropic` | Anthropic Claude (cloud) | `AI_API_KEY` or `ANTHROPIC_API_KEY` |
| `openai` | OpenAI GPT (cloud) | `AI_API_KEY` or `OPENAI_API_KEY` |
| `azure` | Azure-hosted OpenAI | `AI_AZURE_INSTANCE`, `AI_AZURE_DEPLOYMENT`, `AI_API_KEY` |
| `ollama` | Ollama (local / private server) | `AI_BASE_URL` (default: `http://localhost:11434`) |
| `openai-compatible` | vLLM, LM Studio, llama.cpp | `AI_BASE_URL` (required), `AI_MODEL` |

**Default models per provider:**

| Provider | Default model |
|----------|--------------|
| anthropic | `claude-sonnet-4-20250514` |
| openai | `gpt-4o` |
| azure | Deployment name from `AI_AZURE_DEPLOYMENT` |
| ollama | `llama3` |
| openai-compatible | `local-model` |

### AI Features

| Feature | Endpoint | What it does |
|---------|----------|--------------|
| Failure Explanation | `POST /ai/runs/:id/explain` | Analyses failed steps, returns root cause, failure category, suggested fix, confidence level |
| Run Summary | `POST /ai/runs/:id/summarise` | Plain-English summary of the full run: what passed, what failed, overall health |
| Test Generation | `POST /ai/projects/:id/generate-test` | Generates a JSON test definition from a natural-language prompt |

Every AI response is persisted as an `AISummary` record with the full prompt, response, and model label.

### Codebase-Aware Test Generation (RAG)

When a project's source code repository is connected, test generation uses **Retrieval Augmented Generation (RAG)** — the AI receives relevant code chunks as context so it can produce accurate selectors, real route paths, and correct field names instead of guessing.

```
User prompt → embed prompt → vector search over CodeChunk table
           → retrieve top-K relevant code chunks
           → inject chunks into AI prompt as context
           → AI generates test with real selectors from actual code
```

Repos can be connected via GitHub OAuth, GitLab OAuth, or a local filesystem path (for self-hosted setups). Code is chunked, embedded using the configured AI provider, and stored in PostgreSQL via `pgvector`.

See `docs/CODEBASE_AWARE_TESTING.md` for the full specification.

---

## Queue & Worker

### Why BullMQ + Redis

- Clean separation between API (accepts requests) and Worker (executes tests)
- Built-in retry logic, job concurrency control, job history
- Worker can be scaled horizontally by increasing `WORKER_CONCURRENCY` or running multiple worker containers
- Redis is already a standard dependency for this class of application

### Concurrency

Worker concurrency is controlled by the `WORKER_CONCURRENCY` env var (default: 3). Each concurrent slot runs an isolated Playwright browser context.

### Step Types

| Category | Step Types |
|----------|-----------|
| Navigation | `NAVIGATE`, `WAIT`, `SCROLL`, `HOVER` |
| Interaction | `CLICK`, `FILL`, `SELECT`, `KEYBOARD` |
| Assertions | `ASSERT_TEXT`, `ASSERT_VISIBLE`, `ASSERT_URL`, `ASSERT_ELEMENT` |
| Capture | `SCREENSHOT` |
| API | `REQUEST`, `ASSERT_STATUS`, `ASSERT_BODY`, `ASSERT_HEADER`, `EXTRACT`, `DELAY` |
| Shell | `COMMAND`, `ASSERT_EXIT`, `ASSERT_OUTPUT`, `ASSERT_CONTAINS` |
| Custom | `CUSTOM` |

### Hybrid AI Execution Engine

UI steps support a **hybrid execution model**. Each step can carry three input fields:

| Field | Role |
|-------|------|
| `selector` | CSS selector — tried first via Playwright directly |
| `description` | Plain-English element description — used by AI if selector fails |
| `expectedOutcome` | What should be true after the step — AI verifies post-action |

**Execution order:**
1. Playwright tries `selector` directly — if it works, zero AI cost
2. If selector fails (or is absent) and `description` is set — worker takes a screenshot, fetches relevant repo code chunks, asks AI vision model to resolve the correct selector
3. Playwright executes with the AI-resolved selector
4. If `expectedOutcome` is set and `verifyOutcomes` is enabled — AI looks at the post-action screenshot and confirms the outcome occurred

**Selector healing** — when AI resolves a broken selector, a `SelectorHeal` record is written. The engineer sees a warning in the run detail view with the original vs healed selector and a one-click "Update selector" action.

**Config flags per test** (all default `false` for backward compatibility):
```json
"aiExecution": {
  "enabled": true,
  "healSelectors": true,
  "verifyOutcomes": false,
  "screenshotPerStep": true
}
```

Vision-capable models are required for AI execution (`claude-sonnet-4`, `gpt-4o`, `llava` for Ollama). If the configured model does not support vision, the worker falls back to deterministic-only execution gracefully.

See `docs/AI_EXECUTION_ENGINE.md` for the full specification.

---

## Frontend

### Stack

| Tool | Purpose |
|------|---------|
| React 18 | UI framework |
| React Router 6 | Client-side routing |
| TanStack Query 5 | Server state, caching, auto-refetch |
| Axios | HTTP client with JWT interceptor |
| Tailwind CSS 3 | Utility-first styling |
| Recharts | Analytics charts |
| Lucide React | Icons |
| date-fns | Date formatting |

### Page Structure

```
/dashboard                                                    — Overview stats and project list
/projects                                                     — All projects
/projects/:id                                                 — Project detail (module list)
/projects/:id/modules/:moduleId                               — Module detail (feature list)
/projects/:id/modules/:moduleId/features/:featureId           — Feature page + Test Player (split pane)
/projects/:id/tests/:testId/edit                              — Test case editor
/projects/:id/runs                                            — Run history
/runs/:runId                                                  — Run detail (steps, artifacts, AI)
/projects/:id/environments                                    — Environment management
/ai                                                           — AI test generator
/settings                                                     — User profile and preferences
```

### Feature Test Player

The Feature page is the primary test execution UI. It uses a split-pane layout:
- **Left** — test case list with live pass/fail status per test
- **Right** — Test Player with Play/Pause/Stop controls, live browser screenshot stream, step progress, and AI feedback per test case

See `docs/FEATURE_PLAYER.md` for the full specification.

### Data Fetching Pattern

React Query handles all server state. Key patterns:
- `staleTime: 30s` globally — avoids unnecessary refetches
- Active runs refetch every 3s (polling until terminal state)
- Run list refetches every 5s when runs are in progress
- Mutations invalidate relevant queries on success

---

## Test Case Types

Each test case has a single fixed `type`. The type determines the step format, the execution engine, and what the AI generates. Steps cannot be mixed across types within a single test case.

| Type | What it tests | Execution engine | Step format |
|------|--------------|-----------------|-------------|
| `UI` | Browser / frontend flows | Playwright (headless Chromium/Firefox/WebKit) | NAVIGATE, CLICK, FILL, ASSERT_TEXT, SCREENSHOT etc. |
| `API` | HTTP endpoints | Node.js `fetch` / `axios` | REQUEST, ASSERT_STATUS, ASSERT_BODY, EXTRACT etc. |
| `SHELL` | Server-side commands | Node.js `child_process.exec` | COMMAND, ASSERT_EXIT, ASSERT_OUTPUT etc. |

The `type` field is set when the test case is created and cannot be changed. To change type, duplicate the test case.

---

## Configuration: Admin Panel vs Environments

There are two separate levels of configuration, each with a distinct scope and access control.

### Platform Admin Panel (platform-wide)
- Managed by `ADMIN` role only
- Shared across **all projects**
- Contains: shared target URLs, shared API credentials, shared environment variables
- Accessible at `/admin` in the UI
- Stored in the `PlatformConfig` table

### Project Environments (per-project)
- Managed by `ENGINEER` or `ADMIN` role
- Scoped to **one project**
- Contains: project-specific `baseUrl`, headers, variables per environment (Local Dev, Staging, Production etc.)
- Accessible at `/projects/:id/environments`
- Stored in the `Environment` table

### Variable resolution at run time

When a test run is triggered, the worker resolves `{{VAR_NAME}}` tokens in step inputs by merging both levels. Project-level values take precedence over platform-level values.

```
Step input: { "url": "{{BASE_URL}}/api/users" }

Resolution order:
  1. Selected Environment (project-level) → BASE_URL = "http://localhost:3001"
  2. Platform Config (platform-level fallback)

Resolved: { "url": "http://localhost:3001/api/users" }
```

### New model: `PlatformConfig`

```prisma
model PlatformConfig {
  id        String   @id @default(uuid())
  key       String   @unique
  value     String
  isSecret  Boolean  @default(false)   // masked in API responses
  category  String?                    // e.g. "urls", "credentials"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Admin Panel sections

| Section | What it manages |
|---------|----------------|
| **Platform URLs** | Shared base URLs (staging, production, internal) available to all projects |
| **Shared Credentials** | API keys, tokens — stored encrypted, masked in responses |
| **Global Variables** | Env vars shared across all projects |
| **Users** | Create/deactivate users, change roles |
| **AI Provider** | Configure AI_PROVIDER, model, API key (overrides env vars at runtime) |
| **Worker Settings** | Concurrency, timeouts, browser defaults |
| **Audit Log** | Immutable log of all platform actions |

---

## Notifications & Integrations

The platform supports a plugin-based integration system configured per project. When tests fail or feature runs complete, the platform fires configured integrations automatically — or a test engineer can trigger them manually from the Feature Player.

**Integration types:**

| Type | What it does |
|------|-------------|
| `EMAIL` | HTML test report to configured recipients |
| `SLACK` | Result summary posted to a Slack channel |
| `TEAMS` | Adaptive Card posted to a Teams channel |
| `JIRA` | Bug ticket created with failed step details + screenshot attached |
| `WEBHOOK` | HTTP POST to any URL with full failure report JSON (auth: bearer, api_key, basic, hmac) |

**Project membership** — each project has its own team with roles (`OWNER`, `TECH_LEAD`, `DEVELOPER`, `QA_ENGINEER`, `MANAGER`). Notification rules target recipients by project role. Managers receive reports without being involved in day-to-day testing.

**Custom webhook payload** includes: project/module/feature context, all failed tests with step details, error messages, screenshot URLs (signed, 24h expiry), and AI summaries. Optionally screenshots can be included as base64 for receivers that cannot reach the platform.

See `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` for the full specification.

---

## Live Test Viewer

When a feature run is started, the Playwright-controlled browser is streamed live into the UI using Chrome DevTools Protocol (CDP) screencasting.

### Streaming pipeline

```
Worker (CDP Page.startScreencast)
  → Redis pub/sub  (channel: screencast:{featureRunId})
  → NestJS ScreencastGateway (Socket.io /screencast namespace)
  → React LiveBrowserCanvas (<canvas> ctx.drawImage)
```

- **Worker** calls `context.newCDPSession(page)` and `Page.startScreencast` with JPEG quality 80 at 1280×800. Every frame is published to Redis and immediately acked with `Page.screencastFrameAck` to prevent backpressure.
- **API Gateway** subscribes to the Redis channel once per active run and fans frames out to all members of the Socket.io room `run:{featureRunId}`. Multiple browser tabs can watch the same run simultaneously with no extra Redis load.
- **Canvas rendering** avoids flicker compared to `<img>` tag updates — each frame is decoded off-screen and blitted in a single `drawImage()` call.
- Works in **headless Chromium** — no display server required.

### Manual mode preview

In manual mode **there is no Playwright running** — the tester is the automation. The left panel is a plain `<iframe src={environment.baseUrl}>` pointing directly at the app. The tester interacts with it like a normal browser. If the app blocks embedding (`X-Frame-Options` / CSP), the panel falls back to an "Open in new tab" button — the step checklist remains in the platform while the tester works in a side-by-side tab.

### Failure action panel

When a step fails (automated or manual) an inline action panel appears in the player offering:

| Action | Effect |
|--------|--------|
| Add Comment | Saves notes to `RunStep.manualNotes` |
| Skip Step | Marks step `SKIPPED`, advances run |
| Skip Test | Marks TestRun `SKIPPED`, advances to next test |
| Retry Step | Re-attempts step once |
| Create Jira Ticket | Pre-populated panel — sends to Jira API with screenshot attachment |
| Notify Slack / Teams | Fires immediate message with failure details + screenshot |
| Abort Run | Cancels FeatureRun |

See `docs/LIVE_TEST_VIEWER.md` for the full specification.

---

## Manual Testing Mode

The Feature Player supports a **Manual** mode alongside **Automated**. In manual mode, no automation runs — the platform walks the tester through each test case step-by-step as a human-readable checklist. The tester marks each step pass or fail, adds notes, and uploads screenshots as evidence.

Manual runs appear in run history alongside automated runs, are included in analytics, and trigger the same notification rules (email reports, Jira tickets, webhooks) on completion.

See `docs/MANUAL_TESTING.md` for the full specification.

---

## Export & Import

Test suites can be exported and imported at every level of the hierarchy — project, module, feature, or individual test case. Exports are portable JSON files. Imports are transactional (all-or-nothing) and never overwrite existing data.

| Level | Export endpoint | Button location in UI |
|-------|-----------------|-----------------------|
| Project | `GET /projects/:id/export` | Project page header |
| Module | `GET /modules/:id/export` | Module page header |
| Feature | `GET /features/:id/export` | Feature page header |
| Test Case | `GET /tests/:id/export` | Test case editor toolbar |
| Import (any level) | `POST /projects/:id/import` | Project page "Import" button |

See `docs/EXPORT_IMPORT.md` for the full format specification.

---

## Artifact Storage

### Current (MVP)
Artifacts are stored on a Docker named volume (`artifacts_data`) shared between the `api` and `worker` containers. The path structure is:

```
/app/artifacts/
  runs/
    {runId}/
      screenshot-{step}.png
      trace.zip
      {custom-screenshots}.png
```

### Future
S3-compatible object storage (AWS S3, MinIO, Cloudflare R2) for production deployments. The `ArtifactsService` is the single abstraction point — only this service needs to change.

---

## Security Model

### Authentication
- JWT Bearer tokens, signed with `JWT_SECRET`
- 7-day expiry, no refresh token (MVP — add refresh tokens before production)
- Passwords hashed with bcrypt (salt rounds: 12)

### Authorisation
- Three roles: `ADMIN`, `ENGINEER`, `VIEWER`
- All routes require authentication
- Destructive operations (delete project, delete test) restricted to `ADMIN`

### Known gaps to address (see IMPLEMENTATION_PLAN.md)
- Artifact path traversal protection
- Rate limiting on auth endpoints
- Environment variable masking (secrets in headers/variables)
- JWT secret minimum length enforcement on startup

---

## Feature Map — Documentation Index

Every major feature has a dedicated spec doc. This table is the authoritative index.

| Feature | Spec doc | Implementation |
|---------|----------|----------------|
| Multi-tenancy, RBAC, User Management, SSO, Access Requests | `docs/MULTI_TENANCY_AND_RBAC.md` | Phase 6 |
| UI Layout, Navigation Shell, Org Dashboard | `docs/UI_LAYOUT.md` | Phase 6 |
| Feature Test Player (play/pause/stop) | `docs/FEATURE_PLAYER.md` | Phase 3 |
| Live Browser Streaming (CDP screencast) + Failure Action Panel | `docs/LIVE_TEST_VIEWER.md` | Phase 3 |
| Manual Testing Mode | `docs/MANUAL_TESTING.md` | Phase 5 |
| Hybrid AI Execution Engine (selector healing, outcome verification) | `docs/AI_EXECUTION_ENGINE.md` | Phase 2 |
| Feature Versioning (draft → publish, snapshots, diff, restore) | `docs/FEATURE_VERSIONING.md` | Phase 2 |
| Testing Phases (QA → UAT → Sign-off) + Progress Reports | `docs/TESTING_PHASES_AND_REPORTS.md` | Phase 5 |
| Notifications & Integrations (Email, Slack, Teams, Jira, Webhook) | `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` | Phase 5 |
| AI Layer — LLM providers, embeddings, pgvector/Qdrant, LangChain, performance | `docs/AI_LAYER.md` | Phase 2 + 5 |
| Codebase-aware RAG Test Generation — repo connect, indexing, generation wizard | `docs/CODEBASE_AWARE_TESTING.md` | Phase 5 |
| Export / Import (all hierarchy levels) | `docs/EXPORT_IMPORT.md` | Phase 5 |

---

## Monorepo Structure

```
qa-automation-platform/
├── apps/
│   ├── api/              NestJS API server
│   │   ├── src/
│   │   │   ├── common/   Shared guards, decorators, Prisma service
│   │   │   └── modules/  Feature modules (auth, projects, tests, runs, ai…)
│   │   └── prisma/       schema.prisma + migrations
│   ├── web/              React frontend
│   │   └── src/
│   │       ├── components/  UI components + layout
│   │       ├── pages/       Route-level page components
│   │       └── lib/         API client, utilities
│   └── worker/           Playwright test executor
│       └── src/
│           ├── executors/   Run orchestration
│           ├── steps/       Step type implementations
│           ├── collectors/  Artifact collection
│           └── queue/       BullMQ worker setup
├── packages/
│   └── shared/           Shared TypeScript types and constants
├── docs/
│   ├── ARCHITECTURE.md   ← this file
│   └── SETUP.md
├── IMPLEMENTATION_PLAN.md
├── docker-compose.yml
├── .env.example
└── pnpm-workspace.yaml
```

Package manager: **pnpm** with workspaces. Node >= 20, pnpm >= 8.
