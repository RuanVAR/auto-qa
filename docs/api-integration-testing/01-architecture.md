# Architecture — Data Model & Design Rationale

## New Prisma models

```prisma
model Integration {
  id                String   @id @default(uuid())
  projectId         String
  project           Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name              String
  description       String?
  baseUrl           String
  healthCheckPath   String?  // defaults to '/' if unset
  authType          IntegrationAuthType @default(NONE)
  authConfig        Json?    // NON-secret shape: e.g. { headerName: "X-Api-Key" } or { paramName, in: "query" }
  defaultHeaders    Json?    // non-secret headers merged into every request from this integration
  secretsCiphertext Bytes?   // encrypted {API_KEY:...} / {USERNAME,PASSWORD} / {TOKEN:...} — shape depends on authType
  secretsKeyId      String?
  sourceType        IntegrationSourceType @default(MANUAL)
  sourceRaw         Json?    // stored parsed import (size-capped) for future re-sync/diff
  isActive          Boolean  @default(true)
  createdById       String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  endpoints         IntegrationEndpoint[]
  @@unique([projectId, name])
  @@map("integrations")
}

enum IntegrationAuthType { NONE API_KEY BEARER_TOKEN BASIC }
enum IntegrationSourceType { MANUAL OPENAPI POSTMAN }

model IntegrationEndpoint {
  id                String      @id @default(uuid())
  integrationId     String
  integration       Integration @relation(fields: [integrationId], references: [id], onDelete: Cascade)
  name              String
  method            String      // GET/POST/PUT/PATCH/DELETE/...
  path              String      // relative to Integration.baseUrl, may contain {param} placeholders
  description       String?
  defaultHeaders    Json?
  defaultQuery      Json?
  defaultBody       Json?
  requestSchema     Json?       // optional, from OpenAPI components — not validated in v1, stored for later
  responseSchema    Json?
  sourceOperationId String?     // traceability to the imported spec's operationId / Postman request id
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt
  @@unique([integrationId, name])
  @@map("integration_endpoints")
}
```

Why two models, not one: an Integration is the connection (base URL + auth + secrets); an Endpoint
is a reusable request template within it (method + path + default headers/query/body). A test
picks an Integration for auth/base-URL and, optionally, an Endpoint for the request shape — the
two concerns are independently useful (you can reference an Integration without a catalogued
Endpoint, e.g. for a one-off call).

## `FeatureRun.contextVariables` — the cross-test propagation store

**Confirmed by direct schema inspection: no suitable column exists today.** `FeatureRun` has no
JSON column at all; `TestRun.metadata` exists but is the wrong scope (per-TestRun, already used
for manual-verdict notes and `EMIT_METRIC` output) and would leak values from unrelated tests if
reused.

Plan: a new nullable `contextVariables Json?` column on `FeatureRun`.

### Why cross-test propagation is safe to build here

This was verified directly against the execution code, not assumed:

- `FeatureRunsService.start()` creates all N TestRuns as `PENDING` but enqueues **only the first**
  (`testRuns[0]`) to BullMQ.
- Every subsequent TestRun is enqueued **one at a time**, driven by a completion-event chain:
  worker finishes → publishes a terminal `run:updated` event over Redis → API's subscriber calls
  `FeatureRunsService.onRunComplete()` → that method finds the next `PENDING` TestRun (ordered by
  `createdAt asc`, which is stable because TestRuns are created in a sequential, awaited loop) and
  enqueues exactly that one.
- **No explicit lock is needed for the happy path** — the architecture is genuinely one-at-a-time
  by construction, not by convention.

### The one gap that had to be closed: the `skipCurrent()` race

`FeatureRunsService.skipCurrent()` finds the current `RUNNING`/`QUEUED` TestRun, marks it
`CANCELLED`, and calls `onRunComplete()` **synchronously and unconditionally**. If the skipped run
was actually `RUNNING` on a worker (not just `QUEUED`), that worker doesn't know about the cancel
yet — its own watchdog polls DB status roughly once a second, eventually sees `CANCELLED`, tears
down, and **also** emits its own terminal event, which drives a **second** `onRunComplete()` call
for the same TestRun. Between the two calls, the "next" TestRun that call #1 enqueued can already
be `QUEUED`/`RUNNING` by the time call #2 runs its own "find next pending" query — so call #2
enqueues the TestRun *after* that one instead, and if a worker slot is free, two TestRuns of the
same FeatureRun can end up running concurrently.

Harmless today (nothing depends on strict ordering). **Actively dangerous once context variables
propagate test-to-test** — a later test could start reading `contextVariables` before an earlier
one has finished writing its output, or two tests could write conflicting values around the same
time.

**Fix (part of this plan's Phase A, not deferred):** `skipCurrent()` should only call
`onRunComplete()` directly when the cancelled run's status was `QUEUED` — no worker has claimed
it yet, so no duplicate event will ever arrive for it. When it was `RUNNING`, do nothing further;
let the worker's own watchdog-driven terminal event drive the single `onRunComplete()` call,
exactly like every other completion path in the system already does.

### Read/write design

- **Read**, at the start of each TestRun's execution (`executeUiRun`/`executeApiRun`/
  `executeScriptRun` in the worker's run executor), when `run.featureRunId` is set: merge
  `FeatureRun.contextVariables` into that run's variable bag at a specific priority tier — **above**
  environment variables and `EnvironmentCredential` values, **below** the run's own built-ins
  (`RUN_ID`, `TEST_RUN_ID`, `FEATURE_RUN_ID`, which must stay un-shadowable — matches the existing
  rule for env vars).
- **Write**, on successful completion: each step runner already knows which variable keys it
  produced *this run* (an `EXTRACT` step in the API runner, a `STORE` step in the UI runner, a new
  `ctx.set()` in the SCRIPT sandbox) — track just that produced subset, not the whole variable bag
  (which would otherwise re-persist irrelevant env-derived noise back into the shared store). At
  the end of a successful run, merge only the produced keys into `FeatureRun.contextVariables` via
  a read-modify-write. This mirrors the exact pattern already proven for `EMIT_METRIC` output
  (collect step-level side effects into a list, persist once at run end).
- **Scope**: naturally AUTOMATED-only. Manual FeatureRuns never reach the worker's run executor at
  all (`FeatureRunsService.start()` only enqueues for non-manual runs) — no extra guard needed.
- **Size cap**: mirror the existing 100KB cap on SCRIPT source, applied to the serialized
  `contextVariables` JSON, as a safety net against runaway `EXTRACT` usage filling the column.
- **Type-agnostic by construction**: because all three runners (UI, API, SCRIPT) share the same
  variable-bag mechanism, a UI test can produce a value an API test consumes later in the same
  feature, and vice versa, with zero special-casing. This wasn't explicitly requested but falls
  out of the design — worth confirming as a wanted capability during review rather than assuming.

## REQUEST step extension — backward compatible

Add two **optional** fields to the existing REQUEST step input: `integrationId`, `endpointId`.

- Neither present → behaves exactly as today (resolves against `Environment.baseUrl`, no auth
  injected beyond whatever the user hand-wrote into headers). **Zero behavior change for existing
  tests.**
- `integrationId` present → base URL and auth headers resolve from that Integration instead.
- `endpointId` also present → that Endpoint's `method`/`path`/`defaultHeaders`/`defaultQuery`/
  `defaultBody` seed the step; step-level input values always win over endpoint defaults, which
  always win over integration-level defaults (explicit-wins-over-implicit at every layer).

This is additive to `ApiStepRunner`, not a rewrite — existing `ASSERT_STATUS`/`ASSERT_BODY`/
`ASSERT_HEADER`/`EXTRACT` logic is completely untouched; they read `lastResponse` exactly as
before regardless of how the REQUEST step resolved its target.

## `IntegrationClient` — new worker service

A small fetch-based class, not a Playwright `page.request` wrapper — this decouples integration
calls from needing a browser context at all, matching `ApiStepRunner`'s existing approach (the
worker has no axios; it relies on Node's native `fetch`, same as the rest of the API-test engine).

Responsibilities:

- Resolve the target URL (Integration `baseUrl` + Endpoint `path`, or an explicit path).
- Build auth headers per `authType`:
  - `API_KEY` → header or query parameter, per `authConfig.headerName`/`paramName` + `in`.
  - `BEARER_TOKEN` → `Authorization: Bearer <token>`.
  - `BASIC` → `Authorization: Basic <base64(username:password)>`.
- Merge headers in order: Integration `defaultHeaders` → Endpoint `defaultHeaders` → call-time
  overrides (later wins).
- Run every resolved URL through the existing SSRF guard (`assertSafeTargetUrl`) before firing —
  the same discipline already applied to `ApiStepRunner`'s REQUEST and the SCRIPT sandbox's `api.*`
  helpers. No new trust boundary is introduced; this reuses the established one.
- `resolveIntegrationSecrets(prisma, integrationId)` mirrors the existing
  `resolveEnvCredentialVars` pattern exactly: decrypt via `decryptSecret` from
  `@qa-platform/shared`, and if a credential fails to decrypt (e.g. a rotated-out KEK), skip it —
  don't fail the whole run.

## SCRIPT sandbox extension

- `integrations.<name>.get/post/put/patch/delete/request(...)` — built from the same
  `IntegrationClient` as the REQUEST step (no parallel implementation). Resolved from
  `TestDefinition.config.integrations: string[]` — the integration names a script declares it
  needs, decrypted and injected at run start alongside the existing `page`/`vars`/`data`/`api`/
  `ctx` sandbox globals.
- `ctx.get(key)` / `ctx.set(key, value)` — new sandbox helpers mirroring the existing
  `ctx.step`/`ctx.log` pattern, reading/writing the identical `FeatureRun.contextVariables` flow
  used by `EXTRACT`/`STORE`. A SCRIPT test and a structured API test can freely interoperate in the
  same feature run this way.
- `tests.service.ts`'s `validateScriptConfig()` allowed-globals check needs its regex extended to
  recognize `integrations`/`ctx.get`/`ctx.set` as valid sandbox references (today it requires a
  script to reference at least one of `page|ctx|expect|api|data`).

## Health check ("quick reachability test")

Extends — doesn't just reuse — the existing `checkBaseUrlReachable` helper
(`environments.service.ts`), which does a bare HEAD request with a timeout and treats any HTTP
response (even 4xx/5xx) as "reachable." An Integration ping needs to be more useful than that,
since auth is part of what's being verified:

- Build real auth headers (same code path as `IntegrationClient`).
- Do an authenticated GET against `healthCheckPath` (default `/`).
- Classify the result:
  - 2xx/3xx → healthy
  - 401/403 → **"reachable, auth failed"** — the single most useful distinct signal, since it's
    the failure mode a bare reachability check can't tell apart from "just fine"
  - other status → "reachable, unexpected status"
  - network error/timeout → unreachable

Exposed as `POST /projects/:projectId/integrations/:id/ping`. See `05-security-rbac.md` for the
RBAC decision on this endpoint specifically (it's intentionally *not* gated at the elevated tier).
