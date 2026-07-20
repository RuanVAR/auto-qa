# Engine & Execution — Phase A (+ Phase D: SCRIPT parity)

## Focus — what and where

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | New `Integration`/`IntegrationEndpoint`/enum models; new `FeatureRun.contextVariables Json?` column |
| `apps/api/src/modules/integrations/` (new) | Controller + service — CRUD + ping (manual endpoint entry only in Phase A; import is Phase B) |
| `apps/worker/src/services/integration-client.ts` (new) | `IntegrationClient` — see `01-architecture.md` |
| `apps/worker/src/steps/api.step.runner.ts` | REQUEST case extended with optional `integrationId`/`endpointId` |
| `apps/worker/src/executors/run.executor.ts` | Context-variable read/write hooks in `executeUiRun`/`executeApiRun`/`executeScriptRun` |
| `apps/worker/src/steps/step.runner.ts` | Produced-key tracking for `STORE` (so its output can feed `contextVariables`) |
| `apps/api/src/modules/feature-runs/feature-runs.service.ts` (`skipCurrent`, ~line 457-508) | Prerequisite fix 1 — race |
| `apps/api/src/modules/tests/tests.controller.ts` (`hasCodeExecContent`, ~line 20) | Prerequisite fix 2 — RBAC gap |
| `apps/api/src/modules/mcp/mcp.server.ts` | New `list_integrations`/`list_integration_endpoints` tools (membership-gated, mirroring `list_environments`); `create_test`/`update_test` docstrings extended to document `integrationId`/`endpointId`/`config.integrations` |
| `apps/worker/src/steps/script.runner.ts` | Phase D — `integrations.<name>` + `ctx.get`/`ctx.set` sandbox globals |
| `apps/api/src/modules/tests/tests.service.ts` (`validateScriptConfig`) | Phase D — allowed-globals list extended |

## Why critical

Everything else in this plan — import, the structured editor, SCRIPT parity's UI half — is
authoring ergonomics on top of this engine. None of it is useful without a working, secure,
correctly-sequenced execution core. The two prerequisite fixes are **hard blockers**, not
nice-to-haves:

- Without the `skipCurrent()` fix, cross-test context propagation can silently produce **wrong
  data** — a test could start reading `contextVariables` before its predecessor finished writing,
  and the failure mode is silent (a stale or missing value, not a crash), which is the worst kind
  of bug to ship.
- Without the RBAC fix, this plan would be *adding* a new code-exec-adjacent capability (SCRIPT
  tests calling arbitrary external APIs with stored secrets) on top of an already-broken
  authorization gate. Fixing it first, not after, is the only responsible order.

The MCP additions (`list_integrations`/`list_integration_endpoints`, docstring updates) belong in
this phase too, not deferred. `create_test`/`update_test`/`trigger_feature_run`/`get_run_logs`
already exist and work today (`docs/API_TRIGGERING.md`) — MCP is already a first-class way
developers use this platform, not a secondary UI. Shipping the REST/engine half of Integrations
while leaving MCP discovery for a later phase would make MCP-driven test authoring second-class
relative to the web UI landing in Phase C — worth avoiding from the start, not retrofitting later.

## Method

1. **Migration first, in isolation.** New models + the new column, no behavior change yet.
   Established checkpoint from the prior automation epic: verify `prisma migrate deploy` +
   `prisma generate` are clean before touching any service code — never skip this step.
2. **Fix `skipCurrent()`.** Only call `onRunComplete()` directly when the cancelled TestRun's
   status was `QUEUED` at the time of cancellation (no worker has claimed it — guaranteed no
   duplicate event will ever arrive for it). When it was `RUNNING`, do nothing further; the
   worker's own watchdog-driven terminal event will drive the single `onRunComplete()` call, the
   same way every other completion path in the system already works. This is a small, surgical
   change — not a rewrite of the completion chain.
3. **Fix the RBAC gap.** Add an explicit `type === 'SCRIPT'` check to `hasCodeExecContent()` (or
   an equivalent guard) in `tests.controller.ts`, matching what the MCP server already does
   correctly in its own (currently duplicated) implementation of the same check.
4. **Build `IntegrationClient` + `resolveIntegrationSecrets`.** Mirror
   `resolveEnvCredentialVars`'s best-effort-per-credential decrypt pattern exactly — a credential
   that fails to decrypt (e.g. a rotated-out KEK) is skipped, not fatal to the run.
5. **Extend `ApiStepRunner`'s REQUEST case** with the optional `integrationId`/`endpointId`
   fields — additive only; every existing code path in that file is untouched.
6. **Wire `FeatureRun.contextVariables` read/write** into all three executors in
   `run.executor.ts`, using the same "collect this run's side effects into a small list, persist
   once at run end" shape already proven for `EMIT_METRIC` output in the same file — same pattern,
   same file, low risk of introducing something novel.
7. **New `integrations` API module**: CRUD gated at the elevated RBAC tier (see
   `05-security-rbac.md`), plus `ping` gated at plain project-membership.
8. **MCP discovery tools**: `list_integrations` and `list_integration_endpoints`, membership-gated
   with a whitelisted `select` (no `secretsCiphertext`/`secretsKeyId` fields ever reach the
   response), mirroring `list_environments`'s existing convention exactly. Extend `create_test`'s
   and `update_test`'s tool description strings to document the new `integrationId`/`endpointId`
   REQUEST-step fields — the established self-documenting-docstring convention already used
   throughout `mcp.server.ts` (e.g. `update_environment`'s docstring already states its
   replace-not-merge semantics inline for exactly this reason).
9. **(Phase D) SCRIPT sandbox extension**: `integrations.<name>` built from the same
   `IntegrationClient` (no parallel implementation); `ctx.get`/`ctx.set` reading/writing the
   identical `contextVariables` flow as `EXTRACT`/`STORE`; extend the allowed-globals validation
   regex in `tests.service.ts` accordingly.

## Verification

- `prisma migrate deploy` clean; `tsc --noEmit` clean on `apps/api`, `apps/worker`,
  `packages/shared`.
- **Race fix**: reproduce the `skipCurrent()` scenario against a `RUNNING` TestRun (skip
  mid-execution) → confirm exactly one `onRunComplete()`/enqueue happens, not two.
- **RBAC fix**: confirm a plain ORG_MEMBER/DEVELOPER **cannot** create a `type: SCRIPT` test via
  REST (expect 403) — matches the MCP server's existing, already-correct behavior.
- **Secrets**: create an Integration with BEARER_TOKEN auth → the DB row holds ciphertext, and
  `GET .../integrations` never returns the token value in its response.
- **Basic execution**: a REQUEST step with `integrationId` set successfully calls a real test
  endpoint using the auth header the client injected.
- **The core scenario** (the whole point of Phase A): a feature with Test A (`EXTRACT` an
  `ITEM_ID`) → Test B (references `{{ITEM_ID}}` in its own REQUEST url), run AUTOMATED end to end
  → confirm Test B genuinely receives the real ID extracted by Test A — not empty, not stale.
- **Isolation**: confirm a solo/preview run (no `featureRunId`) is completely unaffected by any of
  the above — the context-variable machinery should be inert outside a feature run.
- **Regression, hard requirement**: pre-existing API tests with no `integrationId` continue to
  behave byte-identically to before. `ApiStepRunner` is being extended in place, not replaced —
  this must be provably true, not assumed.
- **MCP discovery**: via MCP, `list_integrations` on the project used above returns the created
  Integration with no ciphertext/secret fields present anywhere in the response; `list_integration_
  endpoints` returns its endpoint catalog; a `create_test` call via MCP that includes
  `integrationId` in a REQUEST step succeeds and produces a test that runs identically to one
  authored through the (future) web UI.
- **(Phase D)**: a SCRIPT test with `config.integrations: ["Stripe"]` successfully calls
  `integrations.Stripe.get(...)`; `ctx.set('X', ...)` in one test is readable via `ctx.get('X')`
  (or `{{X}}` in a later structured-step test) in a later test in the same feature run.
