# API Integration Testing — Design & Implementation Plan

> **Status: design document, not implemented.** Nothing in this folder has been built — no
> schema migration, no new modules, no UI changes. This is the plan, written up for review before
> any implementation branch is cut.

## Why this exists

The automation epic (see `docs/AUTOMATION_TEST_PLAN.md`) built out UI-test automation end to end —
authoring, robustness, value verification. A parallel stream of work (already merged) added run
scheduling, completion webhooks, the `SCRIPT` test type, and an MCP tool surface (see
`docs/API_TRIGGERING.md`).

What's still missing, confirmed by direct investigation of the current codebase (not assumed):
**real external-API-under-test modeling.** Today:

- API-type tests exist (`ApiStepRunner`: REQUEST/ASSERT_STATUS/ASSERT_BODY/ASSERT_HEADER/
  ASSERT_CONTAINS/EXTRACT/DELAY) but the web editor for them is a **raw JSON textarea** — no
  structured form, unlike UI tests.
- There is **no auth abstraction** — a user hand-writes an `Authorization` header string.
- There is **no "integration"/"connector"/external-API concept anywhere** in the codebase. This is
  new domain modeling, not an extension of something existing.
- Context/data passing works *within* one test (`{{VAR}}` + `EXTRACT`/`STORE`) but dies with the
  TestRun — nothing propagates to the next test in a feature run.

The motivating scenario, stated directly by the product owner: *"integrate with a system, run a
full data flow — create an item, capture its ID, then GET/PATCH/DELETE that same item in later
tests to verify it was created/updated/deleted."* That needs the ID to survive across separate
TestRuns within one feature run, which is the single biggest architectural piece of this plan.

## What this adds, in one sentence each

- **Integrations** — a project-level entity representing an external API under test: base URL,
  auth (API Key / Bearer / Basic in v1), default headers, encrypted secrets.
- **Import** — pull a Postman collection or an OpenAPI spec into an Integration's endpoint catalog
  instead of hand-typing every request.
- **Structured API-test authoring** — a real form (method, integration+endpoint picker, headers,
  body) replacing today's raw-JSON-only editor.
- **Cross-test context passing** — a value extracted in one test (e.g. an item ID) becomes
  available to every later test in the same feature run.
- **SCRIPT parity** — SCRIPT tests get the same authenticated Integration client and the same
  cross-test context, so they're not a second-class citizen for multi-call API flows.
- **Health check** — a one-click "can we reach this API, and does our auth work" ping per
  Integration.
- **MCP discovery (Phase A, not deferred)** — `list_integrations`/`list_integration_endpoints`
  ship alongside the REST API, and `create_test`/`update_test`'s existing MCP docstrings get
  extended to document `integrationId`/`endpointId`/`config.integrations` — so a developer
  authoring or reviewing an API test entirely through MCP is a first-class path from day one, not
  an afterthought bolted on later. See "MCP tool surface" below.

## MCP tool surface — split across Phase A and Phase E

MCP is already a first-class way to drive this platform — `create_test`/`update_test`/
`trigger_feature_run`/`get_run_logs`/etc. exist today and work on any test type, including `API`
(see `docs/API_TRIGGERING.md`). This plan follows that precedent rather than treating MCP as an
afterthought:

| Tool | Phase | Why |
|---|---|---|
| `list_integrations` | **A** | Read-only, membership-gated (mirrors `list_environments`'s existing pattern — whitelisted `select`, no secrets in the response by construction). A developer/agent authoring an API test via MCP needs to discover which Integrations exist, same as a human does in the UI. |
| `list_integration_endpoints` | **A** | Same rationale — discovery of the endpoint catalog to reference from `create_test`/`update_test`. |
| `create_test`/`update_test` docstring updates | **A** | Extend the existing tool descriptions to document the new `integrationId`/`endpointId` REQUEST-step fields and `config.integrations` for SCRIPT tests — same self-documenting convention already used throughout `mcp.server.ts`. |
| `create_integration`/`update_integration`/`ping_integration` | **E (deferred)** | Mutating/admin actions on secrets and outbound-call config — lower frequency than authoring a test, and gated at the elevated RBAC tier. Deferring these doesn't block a developer from *using* an Integration via MCP once one exists — only from *managing* one via MCP. |

## Two prerequisite fixes (bundled, not deferred)

Investigation surfaced two real, pre-existing gaps that this plan depends on being fixed —
detailed in `02-engine-execution.md`:

1. A race in `FeatureRunsService.skipCurrent()` that can let two TestRuns of the same feature run
   go `RUNNING` concurrently — harmless today, but would make cross-test context propagation
   unreliable if left unfixed.
2. The REST API doesn't RBAC-gate `SCRIPT` test creation the way the MCP server already does — a
   real security gap on the exact surface this plan extends.

## Decisions locked

| Topic | Decision | Why |
|---|---|---|
| Secret storage | Same AES-256-GCM envelope as `EnvironmentCredential` (`packages/shared/src/crypto/secret-box.ts`) | Proven pattern, importable from both API and worker, no new infra |
| Context-passing mechanism | Extend today's implicit `{{VAR}}` + `EXTRACT`/`STORE` model | No new typed-contract engine needed |
| Context-passing scope | **Cross-test**, within one AUTOMATED feature run | Confirmed safe on the existing strictly-sequential execution model (see `02-engine-execution.md`) |
| SCRIPT parity | SCRIPT tests get an Integration client + context read/write | Explicit requirement — SCRIPT shouldn't be second-class for API flows |
| Auth types (v1) | API Key, Bearer Token, Basic Auth only | OAuth2/HMAC need token-minting/caching engine work — fast-follow |
| Integration RBAC | OWNER / TECH_LEAD + org/platform admins only | Matches the SCRIPT/SHELL code-exec bar — outbound HTTP + secrets is that risk class, not a plain config value |

## Phase index

| Phase | Doc | Covers |
|---|---|---|
| A | [02-engine-execution.md](02-engine-execution.md) | Data model, encrypted storage, worker engine, prerequisite fixes, **`list_integrations`/`list_integration_endpoints` MCP tools + `create_test`/`update_test` docstring updates** |
| B | [03-import.md](03-import.md) | Postman + OpenAPI import |
| C | [04-web-ui.md](04-web-ui.md) | Structured API-test editor, Integrations UI |
| D | [02-engine-execution.md](02-engine-execution.md) (SCRIPT parity section) | SCRIPT sandbox extension |
| E | [05-security-rbac.md](05-security-rbac.md) (Deferred section) | OAuth2/HMAC, **`create_integration`/`update_integration`/`ping_integration` MCP tools**, spec re-sync, JSONPath hardening |
| F | [06-verification-plan.md](06-verification-plan.md) | Fold into `docs/AUTOMATION_TEST_PLAN.md` |

See [01-architecture.md](01-architecture.md) for the full data model and design rationale,
[05-security-rbac.md](05-security-rbac.md) for the security model, and
[06-verification-plan.md](06-verification-plan.md) for the positive/negative test matrix.

## Verified against existing docs (at time of writing)

- `docs/AUTOMATION_TEST_PLAN.md` — grepped for `Integration`/`API test`/`SCRIPT`: zero coverage.
  Not a conflict — a confirmed gap this plan's Phase F closes.
- `docs/API_TRIGGERING.md` — its env-driven automation model and MCP tool conventions match
  exactly what's live in the codebase today. No contradiction; the deferred Phase E MCP tools
  belong in this doc, not a new one.
- Codebase spot-checked directly (not from stale exploration output): `FeatureRun` genuinely has
  no JSON column, `EnvironmentCredential` matches the cited pattern exactly, the `SCRIPT` RBAC gap
  and the `skipCurrent()` race are both real and reproducible in current code.
