# Automation platform audit — July 2026

A trace of what the platform actually does today: infrastructure, execution
engine, domain model, and UI. Every claim below was read out of the code, not
inferred from intent; file:line references are given so each can be re-checked.

Companion document: `PLATFORM_OPPORTUNITIES_2026-07.md` (market comparison and
what is worth adopting).

---

## 0. Shape of the system

| App | Files | Lines |
|---|---|---|
| `apps/api` | 336 | ~45,000 |
| `apps/web` | 207 | ~64,000 |
| `apps/worker` | 23 | **~3,800** |

73 Prisma models, 47 enums, 81 migrations, 56 controllers, **461 mapped routes**,
59 web pages, 40 step types.

**The execution engine is ~3% of the codebase.** This is a test-management
product with a thin runner attached, not an automation engine with management
bolted on. That single ratio explains most of what follows: the domain model is
unusually strong, and nearly every gap is in execution.

---

## 1. What is genuinely strong

Worth stating plainly, because it is the half that is hard to buy or copy.

- **Honest result semantics.** `NOT_TESTED` (session ended before evaluation —
  not a verdict, excluded from pass rate, never overrides a prior verdict) is
  distinguished from `SKIPPED` (an explicit tester decision — a real verdict,
  counts toward coverage, excluded from pass rate). Most commercial tools
  collapse these and produce dishonest dashboards.
- **`excludedFromCanonical` is stamped at run creation**, not evaluated at read
  time, so toggling a pipeline setting later cannot retroactively rewrite
  history (`schema.prisma:789`).
- **`RunStep.executedBy` / `takeoverReason` / `takeoverAt`** record that a human
  finished step 7 of a nominally automated run. Almost nothing on the market
  models the manual/automated boundary this honestly.
- **`EMIT_METRIC`** — asserting a *business* value as part of a run (record a
  count before and after, assert the delta) is close to unique in this market.
- **Encryption**: AES-256-GCM envelope, `[IV(12)|tag(16)|ciphertext]`, staged KEK
  rotation via `SECRETS_KEK_PREVIOUS`, low-entropy KEK rejected in production.
- **MCP server** (22 tools) enforcing live per-user RBAC on every call, with
  `hasCodeExecContent()` escalating SHELL / `EXECUTE_SCRIPT` / expression-`STORE`
  to elevated rights, and an audit row per tool call.
- **AI generation** validates against a single Zod schema used three ways —
  runtime validation, JSON-schema injected into the prompt, and TS types via
  `z.infer` — so drift between them is impossible by construction
  (`ai/prompts/base/output-schemas.ts:4-13`).
- **Queue correctness**: deterministic `jobId`, an atomic DB claim that only
  moves `PENDING|QUEUED → RUNNING`, stalled-job recovery, clean SIGTERM.

---

## 2. Critical operational risk

Ranked by "how bad is the worst day this causes".

### 2.1 There are no database backups

No `pg_dump`, no WAL archiving, no PITR, no documented or tested restore
anywhere in the repository. Production data lives in a single Docker named
volume (`postgres_data`) on one Lightsail instance.

A disk failure, a bad migration, or one mistyped `docker volume prune` is total
unrecoverable loss. **RPO is infinite; RTO is "re-enter everything by hand."**

### 2.2 Production secrets are baked into every Docker image

`.dockerignore:14` contains the pattern `.env`. That pattern does **not** match
`.env.production` — verified against fnmatch semantics, not assumed. The file is
present in the build context (4.1 KB), and all three production Dockerfiles do
`COPY . .` (`apps/api/Dockerfile:12`, `apps/worker/Dockerfile:24`,
`apps/web/Dockerfile:11`).

Consequence: `POSTGRES_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_SECRET`, `EMAIL_PASS` and
~20 others are readable layers in `qa-platform/api:latest` and
`qa-platform/worker:latest`.

Blast radius is currently limited because images never leave the host — but any
`docker save`, registry push, or host compromise exfiltrates the entire secret
set at once.

**Fix**: add `.env*` and `!.env*.example` to `.dockerignore`, rebuild, rotate
every credential.

### 2.3 Artifacts accumulate forever on the database's disk

`RECORD_VIDEO` defaults to `true`. Every UI run writes a video and a trace.
There is no retention, TTL, quota, or purge anywhere in `packages/storage`, the
artifacts module, or the worker — verified by grep.

Production runs `STORAGE_PROVIDER=local`, so everything lands in the
`artifacts_data` volume on the same root disk as Postgres. When that disk fills,
Postgres cannot write WAL. **Unbounded video growth eventually corrupts the
database.** `scripts/docker-cleanup.sh` prunes images and build cache; it never
touches artifacts.

### 2.4 No observability of any kind

Grep for `sentry|opentelemetry|prom-client|datadog|newrelic|winston|pino` across
the entire repo: zero matches. No error tracking, no metrics, no tracing, no
structured logging, no alerting.

When a run silently fails: the worker logs to stdout → nothing scrapes stdout →
BullMQ retries once → the job sits in the failed set until evicted at 200
entries → the stuck-runs cron eventually cancels it → **the UI shows a cancelled
run and nobody is told**. A worker that dies at 18:00 Friday is discovered
Monday morning.

The one bright spot is health endpoints: a correct liveness/readiness split
returning 503 when Postgres or Redis is unreachable, plus a worker probe that
actually launches Chromium to confirm it is not wedged.

### 2.5 CI gates on lint only

`.github/workflows/deploy.yml:12-27` runs `pnpm lint` and nothing else. No
typecheck, no unit tests, no build verification, no smoke run.

`package.json:53` defines `ci:check` (lint + three builds + all tests). **Nothing
invokes it.** Code that does not compile passes the gate and fails on the
production host *after* containers have already been recreated.

Compounding this: images are tagged `:latest` only, so there is **no rollback**.
On health-check timeout the deploy script exits 1 and leaves the broken
containers running. `docker-cleanup.sh` prunes images older than 72h, so the
last known-good image may already be gone. There is also no `concurrency:` group,
so two pushes in quick succession run two overlapping deploys that both
`git reset --hard` the same checkout.

---

## 3. Verified bugs

Each of these was confirmed directly against the code.

### 3.1 `TIMED_OUT` permanently wedges a feature run

The worker sets `RunStatus.TIMED_OUT` (`run.executor.ts:374`).
`feature-runs.service.ts:835` defines:

```ts
const terminalStatuses: RunStatus[] = [PASSED, FAILED, CANCELLED, ERROR];
```

`TIMED_OUT` is absent, so `allDone` can never become true once any child test
times out. The FeatureRun stays `RUNNING` forever: sign-off never fires, the
completion webhook never fires, and any parent pipeline never advances. It is
rescued 15–60 minutes later by the stuck-runs cron, which *cancels* it rather
than completing it. **One-line fix.**

### 3.2 The per-step Timeout control does nothing

`StepEditor.tsx:1174` writes `step.timeoutMs` at the step root. The worker reads
`input.timeout ?? input.timeoutMs` (`step.runner.ts:484`). Nothing in
`apps/worker/src` ever reads `step.timeoutMs` — verified by grep. A user setting
60000 still gets the 5 s assertion default.

### 3.3 "AI Description (helps self-healing)" is unbacked

`aiDescription` is captured on every step, stored, and labelled in the UI as
helping self-healing. Zero references to it exist anywhere in `apps/worker/src`.
It is never read.

### 3.4 The dashboard's "Heals Today" tile is hardcoded to `0`

`DashboardPage.tsx:823-824` renders `<StatCard label="Heals Today" value={0}>`.

### 3.5 "Pass Rate (7d)" is not a 7-day figure

`DashboardPage.tsx:802` labels it 7d; the value is
`passedProjects / projectsWithLastRun` derived from each project's *last run
status*, with no time window.

### 3.6 Job-level retry is dead code

`attempts: 2` is configured, but the executor's atomic claim only accepts
`PENDING|QUEUED`, and the catch block writes `ERROR` before rethrowing. Attempt 2
therefore finds nothing to claim, logs "already claimed", and **reports success**.
A failed run is never actually retried.

### 3.7 The orphan-Chromium reaper cannot work

`process.reaper.ts:83` finds stray browsers by matching `ps` output for
`qa-pw-`, which would appear in a `--user-data-dir` flag. `browser.session.ts:70`
calls `launch()` + `newContext()` and **never passes `userDataDir`**, despite a
comment claiming `launchPersistentContext` is used. The reaper always matches
zero processes; the stated protection against pid accumulation does not exist.

### 3.8 `__authSeed` bypasses the SSRF guard

Every other outbound path in the worker calls `assertSafeTargetUrl`.
`auth-seed.ts:79` calls bare `fetch(cfg.loginUrl)` with no guard, and parses the
response for a token — so a configured `loginUrl` pointing at
`169.254.169.254` would reach cloud metadata.

### 3.9 Secrets are not redacted from evidence

Interpolated values land in `RunStep.input`, in failure screenshots, and in the
Playwright trace (which records full network bodies). A `{{LOGIN_PASSWORD}}`
typed into a form is in the trace in plaintext. There is no scrubbing layer.

### 3.10 Dead configuration

`MAX_CONCURRENT_RUNS` and `MAX_BROWSERS_PER_WORKER` appear in
`.env.production.example`, the dev compose file, and `docker/dev/.env` — and are
read by **zero lines of code**. An operator tuning `MAX_BROWSERS_PER_WORKER=5`
believes in a safety limit that does not exist.

### 3.11 Contradictory AI guidance

`ai.service.ts:112` instructs the model to "Use CSS selectors", while
`output-schemas.ts:51`, `packages/shared/src/types/index.ts:94` and
`dsl/verbs.ts:33-40` all reject raw CSS as brittle. The legacy `/generate-test`
endpoint produces tests the DSL validator would refuse.

---

## 4. Execution engine

### 4.1 Capabilities

- **Playwright 1.59.1**, but **no `@playwright/test`** — no test runner, no
  `expect()` matchers, no built-in retries, sharding, or reporters. All
  hand-rolled.
- **40 step types** across UI, API, and Shell, plus a `SCRIPT` type that runs raw
  Playwright JS in a hardened `node:vm` sandbox (with genuinely good escape tests).
- **Selector resolution is good**: `getByRole/Text/Label/Placeholder/TestId/Title/
  AltText` are parsed from authoring strings, with fall-through to
  `page.locator()` so CSS, XPath and Playwright engines all work.
- **Web-first assertions** via a hand-rolled `pollUntil` (100 ms interval,
  5 s default).
- Per-step retries with linear backoff; `continueOnFail`; data generators
  (including SA-specific Luhn-valid ID numbers); per-env encrypted credentials;
  auth seeding via a reserved `__authSeed` variable.

### 4.2 Limits

- **No parallelism anywhere.** Tests inside a feature run strictly sequentially:
  the API enqueues `testRuns[0]`, waits for a Redis completion event, then
  enqueues the next. No sharding, no fan-out, no user-controllable test order.
- **Total platform capacity is `WORKER_CONCURRENCY = 3`** concurrent browsers.
- **Workers cannot scale horizontally** — `container_name` is pinned, so
  `docker compose up --scale worker=N` fails outright.
- **Up to 6 Chromium instances on a 2 GB host**: the report-PDF worker reuses the
  same concurrency value and launches its own browser per job, in the same
  container. The API container also runs Chromium for PDF rendering. This is the
  most likely cause of current production instability.
- **Only Chromium is installed.** `browser.session.ts:65-67` will dispatch to
  firefox/webkit and fail at runtime; there is no UI to select a browser anyway.
- **No mobile emulation** — only width/height. No `devices[]`, `userAgent`,
  `locale`, `timezoneId`, `geolocation`, or `colorScheme`.
- **`testIdAttribute` is never configured**, so `getByTestId()` only ever matches
  `data-testid`. Apps using `data-cy` / `data-test` / `data-qa` silently cannot
  use testid selectors.
- **No proxy support, no HAR capture** (the `ArtifactType.HAR` enum value is
  dead), no `storageState` (auth seeding is localStorage-only, so cookie-based
  auth cannot be seeded).
- **No browser console or network capture for UI runs** — no `page.on('console')`
  or `page.on('pageerror')` anywhere. The data exists inside the trace but is
  not surfaced as searchable log data.
- **`fallbackSelectors[]` is an OR-union, not an ordered fallback.**
  `loc.or(...)` does not prefer the primary; if both match, Playwright throws a
  strict-mode violation.
- **`CUSTOM` always throws** — it requires `registerHandler()`, which nothing
  ever calls.
- **API and SHELL runs produce zero artifacts** — the `ArtifactCollector` is
  constructed and never used in those paths.
- **Shell steps are unsandboxed**: user strings go straight to `child_process.exec`
  on the worker host with no allowlist — and, unlike UI/API steps, with **no
  variable interpolation at all**, so `{{VARS}}` reach the shell literally.
- **Only two screenshot capture points**: an explicit `SCREENSHOT` step, and one
  automatic shot on failure. No per-step or before/after capture.
- **No failure taxonomy in the runner.** Every failure is a raw `Error.message`
  truncated to 2000 chars. Nothing distinguishes assertion failure from
  selector-not-found from navigation timeout from browser crash.

### 4.3 Result delivery

Redis pub/sub → NestJS → Socket.IO, with a separate CDP screencast channel for
live video. Granularity is **completion-only** — there is no `step:started`
event, so a 30-second step shows the user nothing for 30 seconds even though the
`RunStep` row already exists in Postgres with `status: RUNNING`.

Pub/sub is fire-and-forget with no persistence: if the API is restarting when
the worker publishes a terminal `run:updated`, that event is lost permanently and
the feature-run chain stalls until the stuck-run cron intervenes. The existence
of `resumeSeveredAutomatedRuns()` confirms this happens in practice.

---

## 5. Domain model gaps

The hierarchy is Organisation → Project → Module → Feature → TestDefinition,
with steps stored as an untyped `Json` column (no `Step` table). What is missing
relative to a mature test-management product:

1. **No test suite / test plan / test cycle.** Zero hits for `TestSuite|TestPlan`.
   The only grouping is the fixed module tree plus ad-hoc tags. You cannot
   assemble a cross-feature regression suite, a smoke suite, or a release plan.
2. **No priority or severity on a test.** "Run the critical tests first" is
   unexpressible.
3. **No requirements model or traceability matrix.** Traceability exists only as
   AI-generated `mappedAcceptanceCriteria` inside a JSON blob.
4. **No data-driven / parameterised tests.** You cannot run one test over 50 rows
   of input; environment variables are the only injection mechanism.
5. **No shared/reusable step library.** Every test's steps are a private JSON blob;
   a login flow is copy-pasted N times and edited N times.
6. **No test ownership** on `TestDefinition`, and no review/approval workflow to
   promote an AI draft to approved.
7. **No visual regression** of any kind — no baselines, no diffing.
8. **No flake quarantine.** Detection exists (a 20–80 % pass-rate band over the
   last 100 runs) and a `FLAKY_TEST_FLAGGED` notification type exists, but
   nothing acts on it.
9. **No duration trends or performance regression detection**, despite durations
   being stored on four models. No p50/p95 anywhere.
10. **Two different pass-rate definitions coexist** (StatsService's
    latest-run-per-test coverage style vs AnalyticsService's per-run trend) — a
    known source of number drift between dashboard and reports.
11. **`UserApiToken.scopes` is decorative.** Every PAT carries the owner's full
    RBAC; there are no read-only or project-scoped tokens.
12. **No native CI integration** — no GitHub Action, no JUnit/XML ingestion, no
    PR status checks. CI means "get a PAT and poll".
13. **Outbound webhooks**: 2 attempts, no backoff, no dead-letter, no delivery
    log, and only 2 event types.
14. **Three overlapping sign-off systems coexist**, two of them dead — the schema
    admits this in a comment, and `phases.controller.ts` still exposes 13 routes
    against the dead path.
15. **`TicketLink.findingId` references a `SessionFinding` model that does not
    exist**, so exploratory-testing findings are unimplemented.
16. **In-process cron with no distributed lock** (7 `@Cron` sites). Safe only
    because there is exactly one API replica — scaling to 2 double-fires every
    scheduled report, pipeline tick and stuck-run sweep. **Scaling the API is a
    latent data-corruption bug.**

---

## 6. UI

### Strong
- The **manual testing player** is the most polished surface: cross-origin
  screenshot capture via Chromium Region Capture, screen + mic recording,
  marker.js annotation, structured failure categories, ClickUp write-back,
  resumable sessions.
- **`SelectorTester`** — validate a selector against the live page and see match
  count plus element samples. The standout authoring feature.
- The **recorder** (first-party Chrome extension) with 6 documented compaction
  rules and tokenisation suggestions.
- **`OrgAnalyticsPage`** — cross-filtering charts where clicking a donut slice
  filters the whole dashboard.
- Automation gating via `supportsAutomation` is applied *consistently* — options
  are hidden with an explanation rather than shown and rejected.

### Rough
- **`TestingView.tsx` is 4,501 lines; `FeaturePage.tsx` is 4,995.** Both are past
  maintainable.
- **`RunDetailPage`, `AiPage`, `PipelinesPanel`, `SchedulesPanel`** and the
  API/SHELL editor are light-mode Tailwind inside a dark app — they look broken.
- **`/ai` is a dead end** — it dumps JSON and tells you to copy-paste it into the
  test editor. Still linked in both navs.
- **API/SHELL authoring is a single 42-row unhighlighted textarea.**
- **Frontend tests: 4 spec files, 115 lines total**, all trivial UI primitives.
  Nothing covers `StepEditor` or `recorderUtils.compactSteps` — the latter being
  pure functions that are trivially testable and high value.

### What a user cannot do today
1. Drag-and-drop reorder steps (features have it; steps don't — the grip icon is
   decorative).
2. Get any validation before saving a broken step — you can save a `CLICK` with
   an empty selector and find out 30 s into a run.
3. Pick an element visually to produce a selector.
4. **Record an assertion** — the recorder captures actions only; every assertion
   is hand-added afterwards. This is the biggest single authoring gap.
5. Edit a recorded step's selector or value in the recorder.
6. **View a Playwright trace in-app** — download only.
7. Compare runs, diff screenshots, or set visual baselines.
8. See failures grouped by error signature.
9. Retry a whole run (only individual steps).
10. Export analytics.
11. Set a schedule's timezone.
12. Test an environment's connectivity.
13. Be warned about unsaved step edits when navigating away.

---

## 7. Testing of the platform itself

| Area | Spec files | Source files | Ratio |
|---|---|---|---|
| API | 17 | 336 | ~5 % |
| Web | 4 | 207 | ~2 % |
| Worker | 6 | 17 | ~35 % |

The tested parts are well chosen — secrets, environments security, auth, queue,
and the step runners. But **`run.executor.ts` (988 lines) has zero tests**, and
it contains all the concurrency, claim, retry, timeout and teardown logic. Around
63 % of worker LOC is untested, and it is the 63 % holding the lifecycle and
security behaviour.

E2E and smoke suites exist (`apps/api/test/`, `tests/smoke/`). **None of them run
in CI.**

---

## 8. Fix order

Ranked by (risk removed) ÷ (effort). The first three are each under an hour and
remove the three failure modes that end the business.

| # | Action | Effort |
|---|---|---|
| 1 | Nightly `pg_dump` to S3 **with a tested restore** | ~1 h |
| 2 | `.dockerignore` `.env*`; rebuild; rotate all credentials | ~1 h |
| 3 | Artifact retention job + disk-usage alert | ~2 h |
| 4 | Add `TIMED_OUT` to `terminalStatuses` | 1 line |
| 5 | Sentry + an uptime monitor on `/api/v1/health` | ~2 h |
| 6 | `mem_limit` and `logging.max-size` on every compose service | ~1 h |
| 7 | Run `ci:check` in CI instead of bare `pnpm lint` | ~1 h |
| 8 | Fix the per-step timeout key mismatch | ~1 line |
| 9 | SSRF-guard `__authSeed`; redact secrets from traces | ~2 h |
| 10 | Split the PDF worker's concurrency from the run worker's | ~1 h |
