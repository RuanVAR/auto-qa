# 00 — System context

The platform as it actually is, July 2026. Read this before any other plan
document. Everything below was read out of the code; `file:line` references are
given so each claim can be re-checked.

---

## 1. Stack

| Layer | Technology | Notes |
|---|---|---|
| Language | TypeScript (strict) end-to-end | |
| API | NestJS + Fastify | global prefix `api/v1`, Swagger at `/docs` (disabled in prod) |
| ORM | Prisma 5.22 | **73 models, 47 enums, 81 migrations** |
| DB | PostgreSQL 16 (`postgres:16-alpine`) | + `pgvector` for embeddings |
| Queue | BullMQ + Redis 7 (`--appendonly yes`) | two queues: `test-run`, `report-pdf` |
| Browser | **Playwright 1.59.1** — *not* `@playwright/test` | no test runner, no `expect()`, no built-in retries/sharding/reporters |
| Real-time | Socket.IO (`api:3002`) + Redis pub/sub | |
| AI | LangChain, provider-agnostic | Anthropic default; OpenAI/Azure/Gemini/Ollama supported |
| Web | React 18 + Vite + Tailwind + zustand + TanStack Query v5 | react-router-dom 6 (**not** a data router — no `useBlocker`) |
| PDF | Puppeteer (own Chromium) | in both API and worker |
| Deploy | Docker Compose on a single ~2 GB AWS Lightsail box | |

## 2. Repository layout

```
apps/
  api/     336 files  ~45,000 lines   56 controllers, 461 mapped routes
  web/     207 files  ~64,000 lines   59 pages
  worker/   23 files   ~3,800 lines   ← the entire execution engine
  recorder-extension/                 Chrome MV3 recorder (763-line content.js)
packages/
  shared/    DSL (parse/serialize/verbs), AES-GCM secret-box, shared types
  storage/   local | s3 | gcs | azure driver abstraction
docker/
  dev/       bind-mounted hot-reload stack
  prod/      multi-stage builds, single env_file
docs/        this plan, plus audit + opportunities
scripts/     deploy-prod.sh, docker-cleanup.sh, pipeline-stress-test.sh
```

**The ratio is the most important architectural fact about this system.** The
worker is ~3% of the code. The domain model is mature; execution is thin.

## 3. Domain model — the spine

```
Organisation → Project → Module → Feature → TestDefinition → steps (Json)
```

- `TestDefinition.steps` is an **untyped `Json` column**. There is no `Step`
  table. Canonical shape lives in `packages/shared/src/types/index.ts:78-87`:
  ```ts
  interface Step {
    index: number; name: string; type: StepType;
    input: Record<string, unknown>;
    continueOnFail?: boolean; timeoutMs?: number; aiDescription?: string;
  }
  ```
- `StepType` — **40 values** across UI / API / Shell (`schema.prisma:143-187`).
- Execution-side steps *do* get a table: **`RunStep`** (`schema.prisma:1278`).

### Run models

| Model | Purpose |
|---|---|
| `TestRun` | one test × one environment. `isPreview`, `excludedFromCanonical`, failure fields |
| `FeatureRun` | all tests of one feature, one env. `promotedFromId` self-relation for QA→UAT trail |
| `TestRunSession` | a **named manual QA sitting** spanning features — sits *above* FeatureRun |
| `PipelineRun` | one execution of an ordered multi-feature pipeline |
| `QaWorkSession` | invisible presence/telemetry ("continue where you left off") |

### Invariants that must not be broken

These encode real judgement and are easy to destroy by accident:

1. **`NOT_TESTED` ≠ `SKIPPED`.** `NOT_TESTED` = session ended before evaluation —
   not a verdict, excluded from pass rate, **never overrides a prior verdict**.
   `SKIPPED` = an explicit tester decision — a real verdict, counts toward
   coverage, excluded from pass rate. (`schema.prisma:94-111`)
2. **`excludedFromCanonical` is stamped at run creation**, not evaluated at read
   time, so toggling a pipeline setting cannot retroactively rewrite history.
   Enforced through `CANONICAL_RUN_FILTER` in `common/util/canonical-runs.ts`.
3. **`RunStep.executedBy` / `takeoverReason` / `takeoverAt`** record that a human
   finished a step in a nominally automated run. **This is the platform's most
   valuable proprietary signal** — see [PHASE-6-MOAT](08-PHASE-6-MOAT.md).
4. **Automation availability is environment-driven only.** An automated run
   requires `Environment.supportsAutomation === true` **and** a reachable
   `baseUrl`. There is no per-feature automation flag; `Feature.automatedTestingEnabled`
   is deprecated and unread.
5. **Secrets are never returned in plaintext.** `SECRET_KEY_PATTERN` masking in
   `environments.service.ts:46`; ciphertext columns never serialised.

## 4. The execution path, end to end

```
API: runs.service / feature-runs.service
  └─ queue.service.ts:43   enqueue { jobId: `run-${runId}` } → BullMQ "test-run"
       └─ worker/queue/run.worker.ts:10   concurrency 3, lock 60s, stalled 30s
            └─ executors/run.executor.ts:113   execute()
                 ├─ :126  atomic DB claim  PENDING|QUEUED → RUNNING
                 ├─ :164  dispatch on TestCaseType
                 │     ├─ executeUiRun     :426   Playwright steps
                 │     ├─ executeApiRun    :795   ApiStepRunner (fetch)
                 │     ├─ executeShellRun  :896   ShellStepRunner (child_process)
                 │     └─ executeScriptRun :209   raw Playwright JS in node:vm
                 ├─ steps/step.runner.ts        29 case labels
                 ├─ services/browser.session.ts one browser+context+page per run
                 └─ services/worker.events.service.ts → Redis `worker:events`
                      └─ API worker-events.service.ts → Socket.IO rooms
```

**Multi-test orchestration is sequential and lives in the API, not the worker.**
`feature-runs.service.ts:351` enqueues only `testRuns[0]`; on completion the
Redis event triggers `onRunComplete`, which enqueues the next single test
(`:885-888`). **There is no parallelism anywhere** — see
[PHASE-4-SCALE](06-PHASE-4-SCALE.md).

## 5. Key file map

When a plan document says "change the runner", this is where things are.

| Concern | File |
|---|---|
| Step execution, all 29 UI step types | `apps/worker/src/steps/step.runner.ts` |
| Selector resolution / fallbacks | `step.runner.ts:447-480` (`normalizeToLocator`, `locator`) |
| Assertion polling | `step.runner.ts:483-503` (`assertionTimeout`, `pollUntil`) |
| Run orchestration, claim, retry, timeout | `apps/worker/src/executors/run.executor.ts` (988 lines, **0 tests**) |
| Per-step retry loop | `run.executor.ts:599-619` |
| Browser lifecycle | `apps/worker/src/services/browser.session.ts` |
| Variable interpolation + generators | `apps/worker/src/steps/interpolate.ts` |
| Auth seeding (`__authSeed`) | `apps/worker/src/services/auth-seed.ts` |
| Artifact upload | `apps/worker/src/services/artifact.collector.ts` |
| Worker → API events | `apps/worker/src/services/worker.events.service.ts` |
| Queue definitions | `apps/api/src/modules/queue/queue.constants.ts`, `queue.module.ts` |
| Feature-run chaining | `apps/api/src/modules/feature-runs/feature-runs.service.ts` |
| Stuck-run recovery | `apps/api/src/modules/feature-runs/stuck-runs.service.ts` |
| Flaky detection (only impl) | `apps/api/src/modules/runs/runs.service.ts:262-289` |
| Encryption | `packages/shared/src/crypto/secret-box.ts`, `api/src/common/secrets/secrets.service.ts` |
| Access control | `apps/api/src/common/access/env-access.service.ts` |
| AI generation pipeline | `apps/api/src/modules/ai/generation.service.ts` (865 lines) |
| AI output schema (single source of truth) | `apps/api/src/modules/ai/prompts/base/output-schemas.ts` |
| MCP server (22 tools) | `apps/api/src/modules/mcp/mcp.server.ts` |
| Step editor UI | `apps/web/src/components/StepEditor.tsx` (1,448 lines) |
| Manual testing player | `apps/web/src/pages/testing/TestingView.tsx` (**4,501 lines**) |
| Run detail UI | `apps/web/src/pages/runs/RunDetailPage.tsx` |
| API client | `apps/web/src/lib/api.ts` |

## 6. What already works well

Do not "improve" these without a specific reason — they encode real thought.

- **Selector authoring** parses `getByRole/Text/Label/Placeholder/TestId/Title/AltText`
  from strings and falls through to `page.locator()`, so CSS/XPath/Playwright
  engines all work (`step.runner.ts:447-470`).
- **Web-first assertions** poll rather than one-shot read (`pollUntil`).
- **Queue correctness**: deterministic `jobId`, atomic DB claim, stalled recovery,
  clean SIGTERM.
- **Encryption**: AES-256-GCM, `[IV(12)|tag(16)|ciphertext]`, staged KEK rotation
  via `SECRETS_KEK_PREVIOUS`, low-entropy KEK rejected in production.
- **MCP server** enforces live per-user RBAC per tool, escalates on
  `hasCodeExecContent()`, audits every call.
- **AI generation** validates against one Zod schema used three ways (runtime
  validation, prompt injection, TS types) so drift is impossible by construction.
- **Data generators** including SA-specific Luhn-valid ID numbers, memoised per
  run so `{{$email}}` matches across steps.

## 7. Environment and operations

- Frontend dev: `http://localhost:3000` · API `:3001` · worker health `:3003` ·
  WebSocket `:3002` · Postgres `:5432` · Redis `:6379`
- Dev containers: `qa-web-dev`, `qa-api-dev`, `qa-worker-dev`, `qa-postgres`,
  `qa-redis` — source bind-mounted, `ts-node-dev --respawn` / `nest --watch` / Vite HMR
- Deploy: push to `main` → GitHub Actions → lint → SSH to Lightsail →
  `git reset --hard` → `scripts/deploy-prod.sh` (build + `prisma migrate deploy` + up)
- **CI gates on `pnpm lint` (Biome) only.** `ci:check` exists in `package.json:53`
  and nothing invokes it.
- Lint is warning-only by design; only error-level rules fail the build.

## 8. Test coverage baseline

| Area | Spec files | Source files | Ratio |
|---|---|---|---|
| API | 17 | 336 | ~5 % |
| Web | 4 | 207 | ~2 % |
| Worker | 6 | 17 (`~35 %` of files, **~37 % of lines**) | |

`run.executor.ts` — 988 lines containing every concurrency, claim, retry, timeout
and teardown decision — has **zero tests**. E2E and smoke suites exist but **do
not run in CI**.

## 9. Current known-broken (detail in PHASE-1)

`TIMED_OUT` wedges feature runs · per-step timeout UI is a no-op · `aiDescription`
never read · "Heals Today" hardcoded `0` · "Pass Rate (7d)" is not 7d · job-level
retry is dead code · orphan-Chromium reaper cannot match · `__authSeed` bypasses
SSRF guard · secrets unredacted in traces · `MAX_BROWSERS_PER_WORKER` read by
nothing · legacy AI prompt contradicts the selector rules.
