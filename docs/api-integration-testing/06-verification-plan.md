# Verification Plan — Positive & Negative Cases

Same format as `docs/AUTOMATION_TEST_PLAN.md` (`P<phase>-POS/NEG-<n>`, Pre/Steps/Expected), so this
file can be folded into that master test plan directly once Phases A–D ship (Phase F). Layer
legend matches that doc: **(U)** unit, **(A)** API/integration via HTTP, **(E)** end-to-end via UI
+ a real run, **(D)** DB/inspection.

---

## Prerequisites

| ID | Check |
|---|---|
| PRE-1 | Migration applied; `Integration`/`IntegrationEndpoint` tables and `FeatureRun.contextVariables` column exist. |
| PRE-2 | A project with at least one automation-enabled Environment (per the existing env-driven automation model — see `docs/API_TRIGGERING.md`). |
| PRE-3 | A real (or realistic test-double) external API reachable from the worker, with at least: a create endpoint returning an ID, a get-by-ID endpoint, a delete-by-ID endpoint, and one endpoint requiring each of API Key / Bearer / Basic auth. |
| PRE-4 | Users seeded at each relevant role: OWNER, TECH_LEAD, MANAGER, DEVELOPER, QA_ENGINEER — to exercise the RBAC bar precisely. |

---

## Phase A — engine, storage, prerequisite fixes

### Positive
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PA-POS-1 | A/D | Create an Integration with BEARER_TOKEN auth (OWNER/TECH_LEAD) | 201; DB row has `secretsCiphertext` populated (bytes, not plaintext); `GET .../integrations` list never includes the token value. |
| PA-POS-2 | E | REQUEST step with `integrationId` set, run against a real endpoint requiring that Bearer token | Step passes; the target endpoint actually receives the correct `Authorization` header. |
| PA-POS-3 | E | Feature with Test A (`EXTRACT` an `ITEM_ID` from a create-response) → Test B (`{{ITEM_ID}}` in its REQUEST url) → run AUTOMATED | Test B's request genuinely uses the real ID extracted by Test A — the core scenario this whole plan exists for. |
| PA-POS-4 | A | `POST .../integrations/:id/ping` against a reachable, correctly-authed endpoint | Returns `healthy`, with latency. |
| PA-POS-5 | A | Via MCP: `list_integrations` on the project used in PA-POS-1 | Returns the created Integration; response contains no ciphertext/secret field of any kind. |
| PA-POS-6 | A | Via MCP: `list_integration_endpoints({ integrationId })` | Returns the endpoint catalog for that Integration. |
| PA-POS-7 | A | Via MCP: `create_test` with a REQUEST step including `integrationId` | Test created successfully; running it behaves identically to an equivalent test authored via REST directly. |

### Negative
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PA-NEG-1 | A | DEVELOPER or QA_ENGINEER attempts to create an Integration | 403 — matches the SCRIPT/SHELL elevated bar, not the looser environment-credential bar. |
| PA-NEG-2 | A | DEVELOPER attempts to create a `type: SCRIPT` test via REST | 403 (this is the prerequisite RBAC fix — currently a real gap, must be closed). |
| PA-NEG-3 | E | Skip a `RUNNING` TestRun mid-execution via `skipCurrent()` | Exactly one `onRunComplete()`/next-enqueue happens — reproduce the historical race and confirm it no longer occurs. |
| PA-NEG-4 | E | Solo/preview run (no `featureRunId`) that references `{{ITEM_ID}}` with nothing having set it | Resolves to empty string per existing `{{VAR}}` behavior — no crash, and confirms context-variable machinery is correctly inert outside a feature run. |
| PA-NEG-5 | E | Ping an Integration with a valid host but wrong credentials | Returns `reachable, auth failed` (401/403) — distinct from `unreachable`. |
| PA-NEG-6 | E | Ping an Integration with an unresolvable host | Returns `unreachable` with a reason, not a hang or a 500. |
| PA-NEG-7 | E | Pre-existing API test with no `integrationId`/`endpointId`, run unchanged | Behaves byte-identically to its pre-feature behavior — regression check. |
| PA-NEG-8 | A | Attempt to point an Integration's `baseUrl` at a metadata/link-local address | Blocked by the same SSRF guard already protecting REQUEST/SCRIPT calls. |
| PA-NEG-9 | A | Via MCP: attempt `create_integration`/`update_integration`/`ping_integration` before Phase E ships | Tools don't exist in Phase A's MCP surface (by design — only `list_integrations`/`list_integration_endpoints` ship then); confirms the read/write split from `05-security-rbac.md` is actually reflected in what's registered, not just documented. |

---

## Phase B — import

### Positive
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PB-POS-1 | A | Import a real small OpenAPI 3.x spec with `$ref`s | Endpoints created correctly; refs resolved (not left as unresolved `$ref` strings); `baseUrl` pre-filled from `servers[0].url`. |
| PB-POS-2 | A | Import a real small Postman v2.1 collection | Endpoints created correctly; `baseUrl` inferred from a `{{baseUrl}}` variable or first-request origin. |

### Negative
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PB-NEG-1 | A | Import a Postman collection using an unsupported auth type (e.g. `aws4`) | Endpoint still created; `authType: NONE`; a warning is present in the response — not silently dropped, not a crash. |
| PB-NEG-2 | A | Upload a malformed/non-spec JSON file | Clean 400 with a parse error, not a 500. |
| PB-NEG-3 | A | Re-import the same spec a second time | Doesn't corrupt or duplicate in a broken way (full re-sync/diff is deferred, but this must degrade gracefully). |

---

## Phase C — structured UI

### Positive
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PC-POS-1 | E | Author a full REQUEST step via the new UI, no raw JSON | Resulting `steps[]` structurally identical to a hand-written equivalent. |
| PC-POS-2 | E | Select an Endpoint in the picker | Method/url/headers/body pre-fill correctly from the Endpoint's stored defaults. |
| PC-POS-3 | E | Override a pre-filled field (e.g. change the body) | The override actually takes effect at run time, not just visually in the form. |
| PC-POS-4 | E | View the data-flow panel on the Phase A core-scenario feature | Correctly shows Test A produces `ITEM_ID` → Test B consumes `ITEM_ID`. |

### Negative
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PC-NEG-1 | E | View data-flow panel on a feature with no cross-test variable usage | Panel shows nothing / an empty state — not an error. |
| PC-NEG-2 | E | Reference a variable in a test that no earlier test produces | Surfaced clearly (not necessarily blocking — decide exact UX at implementation time — but must not be silently misleading). |

---

## Phase D — SCRIPT parity

### Positive
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PD-POS-1 | E | SCRIPT test with `config.integrations: ["Stripe"]` calls `integrations.Stripe.get(...)` | Succeeds, using the correct injected auth. |
| PD-POS-2 | E | `ctx.set('X', value)` in a SCRIPT test, `ctx.get('X')` in a later SCRIPT test in the same feature run | Reads back the same value. |
| PD-POS-3 | E | `ctx.set('X', value)` in a SCRIPT test, `{{X}}` referenced in a later **structured API** test in the same feature run | Reads back the same value — proves type-agnostic cross-test propagation (UI/API/SCRIPT interoperate). |

### Negative
| ID | Layer | Steps | Expected |
|---|---|---|---|
| PD-NEG-1 | A | SCRIPT test references an integration name not in `config.integrations` | Clear runtime error, not a silent `undefined`. |
| PD-NEG-2 | A | Save a SCRIPT test whose source doesn't reference any allowed sandbox global | Rejected at save time (existing `validateScriptConfig` behavior, confirm it still holds after the allowed-globals list is extended). |

---

## Exit criteria

1. All POS + NEG cases above pass, or deviations are explicitly triaged and accepted.
2. `tsc --noEmit` clean on `apps/api`, `apps/worker`, `apps/web`, `packages/shared`.
3. Full regression pass on pre-existing API/UI/SCRIPT tests — zero behavior change for anything
   not explicitly using the new `integrationId`/`endpointId`/`config.integrations` fields.
4. Security sign-off: no plaintext secrets at rest or on the wire anywhere in the Integration
   flow; RBAC bar enforced exactly as specified in `05-security-rbac.md`; SSRF guard confirmed
   active on every new outbound-call path.
5. This file merged into `docs/AUTOMATION_TEST_PLAN.md` as a new section (Phase F).
