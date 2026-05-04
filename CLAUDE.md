# QA Automation Platform — Claude Instructions

## What This Project Is
A self-hosted, AI-powered QA automation platform. Full spec lives in the docs listed below.
Read the relevant doc before working on any feature — do not invent architecture.

## Source of Truth — Read These Docs
| Doc | What it covers |
|-----|---------------|
| `docs/ARCHITECTURE.md` | Full system architecture, all 25 data models, API modules, service map |
| `IMPLEMENTATION_PLAN.md` | Every feature broken into numbered tasks with status — follow phase order |
| `PROGRESS_TRACKER.md` | Which features are done / in progress / blocked — update after completing work |
| `docs/UI_LAYOUT.md` | Navigation shell, top nav, sidebar, org switcher, dashboard layout |
| `docs/MULTI_TENANCY_AND_RBAC.md` | Org model, RBAC tiers, invite flow, access requests, SSO |
| `docs/FEATURE_VERSIONING.md` | Draft → publish → snapshot versioning model |
| `docs/TESTING_PHASES_AND_REPORTS.md` | Phase engine, QA→UAT→Sign-off flow, PDF reports |
| `docs/LIVE_TEST_VIEWER.md` | CDP screencast pipeline, manual iframe mode, FloatingRecorder |
| `docs/CODEBASE_AWARE_TESTING.md` | Org-level Git credentials, repo providers, project repo connect wizard, AI generation with RAG, auto feature↔code mapping, on-demand file fetch, coverage heat map, change-aware test alerts |
| `docs/AI_LAYER.md` | LangChain setup, pgvector vs Qdrant, embedding cache, all 4 AI tasks |
| `docs/AI_EXECUTION_ENGINE.md` | Hybrid AI test execution engine, selector healing trigger conditions, confidence thresholds, SelectorHeal record |
| `docs/RUN_EXECUTION_SPEC.md` | Full run trigger → BullMQ → worker → Playwright → DB writes flow, artifact storage, abort/retry, socket events |
| `docs/STEP_DEFINITION_SPEC.md` | Canonical step JSON schema, all 22 step types with exact TypeScript interfaces, variable tokens, RunStep status transitions |
| `docs/STEP_EDITOR_SPEC.md` | Step editor UI — field panels per type, validation UX, drag-to-reorder, bulk edit, AI generation surfaces, import |
| `docs/AI_GENERATION_SPEC.md` | AI test generation — prompt structure, context injection, JSON schema, streaming, output validation, error recovery |
| `docs/WORKER_ARCHITECTURE.md` | BullMQ queues, worker pool, fair queuing, horizontal scaling |
| `docs/MANUAL_TESTING.md` | Manual test runner, step checklist, iframe preview + timeout, screenshot evidence upload, auto-save, session abandonment |
| `docs/PLUGIN_REGISTRY.md` | **Unified plugin architecture** (foundation) — manifest, 8 capabilities (notify/createIssue/linkTicket/syncPhaseStatus/fetchTicketContext/fetchDocs/logTime/webhookListener), cascading binding config (project → module → feature), secrets encryption, admin UI, dispatch, health checks. All integrations (ClickUp, Jira, Slack, GitHub, Linear) plug in through this. |
| `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` | Slack, Teams, Email, Jira (run-alert notifications), Webhooks — to be refactored onto plugin registry |
| `docs/IN_APP_NOTIFICATIONS.md` | In-app notification centre (bell icon, panel, toasts, real-time), all 20 notification types with CTAs, per-user preferences, muting, full transactional email catalog (18 templates), email infrastructure, unsubscribe |
| `docs/PM_INTEGRATIONS.md` | **ClickUp full spec** against plugin registry — PAT auth, list/subtask mode cascading, attachment upload (screenshots always, recordings <50 MB else signed URL), ClickUp Docs v3 integration with multi-scope DocLinks, workspace hierarchy cache, phase status sync, AC import, full acceptance criteria |
| `docs/EXPLORATORY_TESTING.md` | Session-based exploratory testing — charters, time-box timer, live note stream with slash-commands, screenshot + annotation, screen recording, findings with auto-captured repro steps, convert-to-ticket/test/risk, coverage mind map, pair testing, SBTM metrics, debrief workflow, AI mid-session nudges |
| `docs/TEST_RECORDER.md` | **Codeless test authoring (MVP)** — record DOM events in iframe → typed steps → save as TestCase. Codebase-aware selector strategy (uses repo's actual `data-*` convention via RAG), dual capture (`selector` + `aiDescription`) so heals work day 1, assert mode overlay, password redaction, tokenization suggestions, three entry points (feature page / test editor / Testing View). Phase 2 (AI polish) and Phase 3 (Chrome extension, server-side CDP, file uploads, edit-in-recorder mode) live in `docs/future/`. |
| `docs/future/` | Forward-looking specs not yet on the build path — see `docs/future/README.md` for promotion conventions |
| `docs/FEATURE_PLAYER.md` | Stats panels at module/feature/test-case levels, "Start Testing" entry point, full-screen testing view (2-pane: adjustable left list + right browser), top action bar, run controls, keyboard shortcuts, acceptance criteria |
| `docs/EXPORT_IMPORT.md` | Test suite export/import format |
| `docs/AGENTIC_AI_TESTING.md` | Multi-agent pipeline, LangGraph orchestration, Explorer/Planner/Healer agents, MCP server |
| `docs/AI_INTELLIGENCE.md` | Duplicate detection, Test Value Scoring, Execution Strategist, enhanced flaky detection |
| `docs/BDD_GHERKIN.md` | Given/When/Then authoring, step definition registry, .feature import/export |
| `docs/GLOBAL_SEARCH.md` | Full-text search index, ⌘K palette, `/search` page, RBAC-scoped results |
| `docs/EXTENDED_INTEGRATIONS.md` | Discord, GitHub Issues, GitLab Issues, Linear, Google Chat, ClickUp, PagerDuty plugins |
| `docs/GIT_NATIVE_CI.md` | Commit status checks, PR webhooks, deployment triggers, AI PR suggestions, branch environments (Phase 10, future) |
| `docs/SESSION_TRACKING.md` | QA work session timer, passive event recording, AI session summary, ClickUp/Jira time logging |

---

## Monorepo Structure
```
/apps/api        → NestJS REST API (TypeScript)
/apps/worker     → BullMQ worker process (NestJS, TypeScript)
/apps/web        → React frontend (Vite + TypeScript + Tailwind CSS)
/packages/shared → Shared types, utilities, constants
```

## Tech Stack — Do Not Deviate, Do Not Ask
| Layer | Technology |
|-------|-----------|
| Backend framework | NestJS (TypeScript) |
| ORM | Prisma |
| Database | PostgreSQL |
| Vector search | pgvector (default); Qdrant via `VECTOR_BACKEND=qdrant` |
| Job queue | BullMQ + Redis |
| Browser automation | Playwright |
| Real-time | Socket.io (WebSocket) |
| AI abstraction | LangChain (provider-agnostic) |
| AI provider | Anthropic Claude (default); switchable via `AI_PROVIDER` env var |
| Embeddings | OpenAI `text-embedding-3-small` (default); Ollama `nomic-embed-text` for local |
| Auth | JWT (access + refresh tokens) + Passport.js |
| SSO | passport-google-oauth20 + passport-azure-ad |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui |
| HTTP client | Axios (frontend) |
| State management | Zustand |
| Routing | React Router v6 |
| Charts | Recharts |
| PDF generation | Puppeteer |
| Screen recording | RecordRTC |
| Containerisation | Docker + Docker Compose |
| Package manager | pnpm (workspaces) |

---

## Key Commands
```bash
# Start everything (DB, Redis, API, Worker, Web)
pnpm docker:up

# Run all apps in dev mode
pnpm dev

# Build all
pnpm build

# Database
pnpm db:migrate      # run pending migrations
pnpm db:generate     # regenerate Prisma client
pnpm db:studio       # open Prisma Studio

# Individual apps
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter worker dev
```

---

## Data Model Rules
- Every model scoped to `orgId` (multi-tenancy — Org is the root tenant)
- Soft deletes via `deletedAt DateTime?` — never hard delete user data
- All timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`
- UUIDs as primary keys: `id String @id @default(uuid())`
- Full Prisma schema is the authoritative model definition — see `apps/api/prisma/schema.prisma`

## API Rules
- All routes prefixed `/api/v1/`
- JWT auth via `Authorization: Bearer <token>` header on all protected routes
- `OrgGuard` applied at org-scoped routes — reads `orgId` from JWT or route param
- `ProjectRoleGuard` applied at project-scoped routes
- Validation via `class-validator` DTOs on all request bodies
- Errors: always return `{ statusCode, message, error }` shape

## Frontend Rules
- All pages inside `apps/web/src/pages/`
- Shared components in `apps/web/src/components/`
- API calls via `apps/web/src/lib/api.ts` (Axios instance with auth interceptor)
- Auth state in Zustand store: `apps/web/src/stores/authStore.ts`
- Org context in Zustand store: `apps/web/src/stores/orgStore.ts`
- Use shadcn/ui components — do not build raw UI from scratch
- Tailwind for all styling — no CSS modules, no styled-components
- Dark mode support using Tailwind `dark:` variants

---

## Behaviour Rules — Read This Before Every Task
1. **Never ask clarifying questions.** If the spec is in the docs, follow the docs. If it's genuinely ambiguous, pick the most common industry pattern and proceed.
2. **Never ask for permission to create files, install packages, or run commands.** Just do it.
3. **Follow the implementation plan phase order.** Complete Phase 1 fully before touching Phase 2, etc.
4. **After completing each section, run the build** (`pnpm build`) and fix all TypeScript/lint errors before moving on.
5. **Update `PROGRESS_TRACKER.md`** after completing each feature row — set `Impl` column to `[x]`.
6. **Write proper TypeScript** — no `any` types, full interface definitions, strict mode on.
7. **Every API endpoint needs a DTO** (class-validator), a service method, and a controller handler.
8. **Every Prisma model change needs a migration** — run `pnpm db:migrate` after schema changes.
9. **Environment variables** go in `apps/api/.env.example` and `apps/worker/.env.example` — never hardcode secrets.
10. **If a package is missing, install it** — don't ask, just `pnpm --filter <app> add <package>`.

---

## Environment Variables (defaults for local dev)
```env
# Database
DATABASE_URL=postgresql://qa_user:qa_password@localhost:5432/qa_platform

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=local-dev-secret-change-in-production
JWT_REFRESH_SECRET=local-dev-refresh-secret

# AI
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<set by user>
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=<set by user>

# Vector backend
VECTOR_BACKEND=pgvector

# Worker
MAX_CONCURRENT_RUNS=20
MAX_BROWSERS_PER_WORKER=5
STEP_TIMEOUT_MS=30000
RUN_TIMEOUT_MS=300000

# SSO (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
AZURE_TENANT_ID=

# App URLs
API_URL=http://localhost:3001
WEB_URL=http://localhost:3000
```
