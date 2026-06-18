# Automation Feature — Master Test Plan (Phases 1–7)

Branch: `feature/automation`. Covers every change in the automation epic with
**positive and negative** cases. Goal: 100% behavioural coverage before merge.

> The implementation is typecheck-clean + unit-tested (crypto / DSL / data-gen)
> but **not yet runtime-verified end to end**. This plan is the runtime gate.

---

## 0. Test approach & legend

- **Layers:** (U) unit — already automated; (A) API/integration via HTTP; (E) end-to-end via UI + a real run; (D) DB/inspection.
- **Case IDs:** `P<phase>-<POS|NEG>-<n>`.
- Every case lists **Pre / Steps / Expected**. A case passes only if the expected result — including error text/status — matches exactly.
- "Automation env" = an Environment with `supportsAutomation = true` and a **reachable** `baseUrl`.

### Final behavioural model (after Phase 4 reconciliation)
Automation availability is **env-driven only** — there is **no** per-feature automation flag. An automated/preview run requires: `Environment.supportsAutomation = true` **AND** the `baseUrl` is reachable. Per-env credentials are **optional** (injected when present). Keep this in mind: any "feature automation toggle" behaviour from the original Phase 1/3 spec is **superseded** and must NOT appear.

---

## 1. Prerequisites & environment setup

| ID | Check |
|---|---|
| PRE-1 | Full stack up: Postgres, Redis, API, worker, web. |
| PRE-2 | All migrations applied (`prisma migrate deploy` shows nothing pending). |
| PRE-3 | `SECRETS_KEK` set **and identical** on API **and** worker. Confirm worker logs no decrypt errors. |
| PRE-4 | An org + project exist; users seeded for each role: ORG_ADMIN, project OWNER, TECH_LEAD, MANAGER, QA_ENGINEER, DEVELOPER, CLIENT. |
| PRE-5 | A test target app is reachable from the worker (for real runs) with: a `data-testid` form, an element that updates text after a delay (for web-first assertions), a `<select>`, a file `<input type=file>`, and a login page. |
| PRE-6 | Org AI credential configured (for prose→AI generation tests). |
| PRE-7 | `RECORD_VIDEO` unset or `true` (video tests); a second run with `RECORD_VIDEO=false` for the negative video case. |

**Setup negatives**
- PRE-NEG-1: Start the worker **without** `SECRETS_KEK`. Trigger an automated run that uses an encrypted env var / credential → run does **not** crash; encrypted values resolve empty and credentials are skipped (graceful degrade), worker logs a decrypt warning. (Confirms the catch-and-skip path.)
- PRE-NEG-2: API booted without `SECRETS_KEK` → API fails fast at startup (SecretsService). Documented requirement.

---

## 2. Phase 1 — Environment `supportsAutomation` + run gating

### Positive
| ID | Layer | Pre | Steps | Expected |
|---|---|---|---|---|
| P1-POS-1 | E | — | Env settings → create env, tick **Supports automation** | Saved; list/edit shows it on; `supportsAutomation=true` in DB (D). |
| P1-POS-2 | E | Automation env exists, reachable | Run a test AUTOMATED against it | Run proceeds (queued → running). |
| P1-POS-3 | A | — | `GET /projects/:id/environments` | Response includes `supportsAutomation`; **no** raw `*Ciphertext` fields. |

### Negative
| ID | Layer | Steps | Expected |
|---|---|---|---|
| P1-NEG-1 | A/E | Trigger AUTOMATED run vs env with `supportsAutomation=false` | **400** "This environment is not enabled for automation…". No run created. |
| P1-NEG-2 | A/E | Trigger AUTOMATED run vs automation env whose `baseUrl` is unreachable (bad host/port) | **400** "Environment … is not reachable (…)". No run. |
| P1-NEG-3 | A | Trigger AUTOMATED **feature** run with no `environmentId` | **400** "Environment is required for automated runs". |
| P1-NEG-4 | E | MANUAL run vs the same `supportsAutomation=false` env | **Succeeds** — manual ignores both gates. |
| P1-NEG-5 | E | Preview run from test editor vs non-automation env | **400** (preview counts as automated). |

---

## 3. Phase 4 — Env-driven availability & UX split (tested before P2/P3 because it defines availability)

### Positive
| ID | Pre | Steps | Expected |
|---|---|---|---|
| P4-POS-1 | ≥1 automation env in project | Open feature run modal | AUTOMATED tab shown; mode **pre-selected to AUTOMATED**; env picker lists **only** automation envs. |
| P4-POS-2 | same | Solo-run + promote modals | Same: automated offered, picker filtered, AUTOMATED default. |
| P4-POS-3 | — | Feature → Settings tab | **No** "automated testing" toggle (removed); only tags + developer. |

### Negative
| ID | Steps | Expected |
|---|---|---|
| P4-NEG-1 | Project with **zero** automation envs → open run modal | Only **MANUAL** shown; warning "No automation-enabled environment…"; AUTOMATED hidden. |
| P4-NEG-2 | Same, solo modal | "No automation-enabled environments" hint; cannot pick AUTOMATED. |
| P4-NEG-3 | Confirm no stale references | No screen mentions a per-feature automation toggle; manual run modal shows zero automation concepts. |
| P4-NEG-4 | DB inspection | `Feature.automatedTestingEnabled` column unread (deprecated) — toggling it directly changes nothing in the UI/run gating. |

---

## 4. Phase 2 — Progress tracking split by run mode

### Positive
| ID | Pre | Steps | Expected |
|---|---|---|---|
| P2-POS-1 | A feature with both manual + automated terminal runs | Feature page donut → toggle **Automated** | Donut shows only automated tallies; **Manual** shows only manual; **All** = sum. |
| P2-POS-2 | — | Project page → mode toggle | Project donut + module strips re-fetch and partition the same way. |
| P2-POS-3 | A | `GET /projects/:id/stats?mode=AUTOMATED` and `?mode=MANUAL` | Tallies partition; AUTOMATED+MANUAL counts == combined (no `?mode`). |
| P2-POS-4 | — | RecentRunsPanel mode filter | List filters to the chosen mode; `featureRuns?mode=` filter works (A). |

### Negative
| ID | Steps | Expected |
|---|---|---|
| P2-NEG-1 | `GET …/stats?mode=BOGUS` | Treated as "all" (parseRunMode → null); no error, combined tallies. |
| P2-NEG-2 | Feature with only manual runs, toggle Automated | Donut shows 0 passed / all outstanding (no automated runs) — not an error. |
| P2-NEG-3 | Preview runs present | Excluded from stats (existing rule) regardless of mode. |

---

## 5. Phase 3 — Authoring (DSL spec, prose→AI, recorder)

### 3b — `describe/it` DSL (positive)
| ID | Layer | Steps | Expected |
|---|---|---|---|
| P3-POS-1 | E | Feature → **Spec** tab → write a `describe` with **two** `it` blocks → Save | Toast "N created…"; **two** TestDefinitions created under the feature (D). |
| P3-POS-2 | E | Edit an `it` (rename + change a step) → Save | That test updated (matched by `#id`/name); others untouched. |
| P3-POS-3 | E | Delete one `it` from the spec → Save | That TestDefinition soft-deleted; others remain. |
| P3-POS-4 | A | `GET /features/:id/spec` | Serializes current tests back to DSL; re-parsing is stable. |
| P3-POS-5 | A | `POST /features/:id/spec/validate` with valid text | `{ ok: true }`. |
| P3-POS-6 | U | (already automated) | 17/17 DSL checks (round-trip, multi-it, generic escape hatch). |

### 3b — DSL (negative)
| ID | Steps | Expected |
|---|---|---|
| P3-NEG-1 | Spec with a **raw CSS** selector (`div.x > li:nth-child(2)`) → Validate/Save | **Rejected** — DslError "unstable selector…"; nothing persisted. |
| P3-NEG-2 | Malformed spec (missing `}`) | Validate `{ ok:false, error, line }`; Save → 400, no partial sync. |
| P3-NEG-3 | Unknown verb (`frobnicate "x"`) | Rejected with line number. |
| P3-NEG-4 | Two `it` blocks with the **same name**, no ids | Sync is deterministic (no crash); inspect resulting tests for sane create/adopt behaviour. |
| P3-NEG-5 | Save spec with **zero** `it` blocks | All existing feature tests soft-deleted (empty feature) — confirm this is intended before running destructively on real data. |

### 3a — prose→AI
| ID | Pre | Steps | Expected |
|---|---|---|---|
| P3-POS-7 | AI configured (PRE-6) | Test editor → description filled → **Generate steps from description** | SSE streams; proposed steps appear; apply merges them. |
| P3-NEG-6 | AI **not** configured | Click Generate steps | Routed to AI settings (button reads "Set up AI"); no crash. |
| P3-NEG-7 | Empty description | Generate | Graceful (AI may return few/no steps); no exception surfaced to UI. |

### 3c — recorder gating
| ID | Steps | Expected |
|---|---|---|
| P3-POS-8 | Open Test Recorder with ≥1 automation env | Env picker lists **only** automation envs; records → produces runnable steps. |
| P3-NEG-8 | Open recorder in a project with **no** automation env | Picker shows "No automation environment"; recording can't target a non-automation env. |

---

## 6. Phase 5a — Run video artifact

| ID | Layer | Pre | Steps | Expected |
|---|---|---|---|---|
| P5a-POS-1 | E | `RECORD_VIDEO` on | Run an automated test to completion → open run detail | A **VIDEO** artifact exists and **plays inline**; downloadable. |
| P5a-POS-2 | E | — | During the run | Live screencast still streams (both coexist). |
| P5a-POS-3 | E | — | Trigger a step failure mid-run | Failure **screenshot** still captured alongside the video. |
| P5a-NEG-1 | E | Per-test `config.recordVideo=false` (or `RECORD_VIDEO=false`) | No VIDEO artifact registered; run still completes normally. |
| P5a-NEG-2 | E | Force a browser crash / cancel mid-run | Teardown doesn't hang; missing video logged as a warning, not a run failure. |

---

## 7. Phase 5b — Data generators

| ID | Layer | Steps | Expected |
|---|---|---|---|
| P5b-POS-1 | U | (automated) | 10/10: SA ID 13-digit + valid Luhn + plausible DOB; `{{$dob(18-65)}}` in range; `{{$phone.sa}}` `+27…`; passport format; metadata lists tokens. |
| P5b-POS-2 | E | FILL a field with `{{$id.sa}}`, run | Injected value is a valid SA ID; **two** references in the same run yield the **same** value (memoization). |
| P5b-POS-3 | E | Token picker on editor toolbar | Lists tokens; click copies `{{$token}}`. |
| P5b-NEG-1 | E | `{{$dob(99-10)}}` (reversed range) | Still yields an in-range valid date (range normalised), not an error. |
| P5b-NEG-2 | E | `{{$unknownGen}}` | Resolves to empty string (unknown generator), no crash. |

---

## 8. Phase 5c — Per-env encrypted credentials + encrypt-at-rest (SECURITY)

### Positive
| ID | Layer | Pre | Steps | Expected |
|---|---|---|---|---|
| P5c-POS-1 | E | Logged in as OWNER/TECH_LEAD/MANAGER or admin | Env editor → add credential `login` with `EMAIL` + `PASSWORD` | Saved; list shows name + field **keys** (no values). |
| P5c-POS-2 | D | after POS-1 | Inspect `environment_credentials` row | `secretsCiphertext` is **bytes** (not plaintext); `secretsKeyId` set. |
| P5c-POS-3 | A | — | `GET …/credentials` | Returns name + field keys only — **never** secret values. |
| P5c-POS-4 | E | test uses `{{LOGIN_EMAIL}}` / `{{LOGIN_PASSWORD}}` | Run automated | Worker decrypts + injects; login succeeds. |
| P5c-POS-5 | D | Save an env with `variables`/`headers` | Inspect row | `variablesCiphertext`/`headersCiphertext` populated; plaintext `variables`/`headers` JSON **null**. |
| P5c-POS-6 | E | Legacy env (plaintext variables, never re-saved) | Run | Dual-read falls back to plaintext; values still resolve. |

### Negative
| ID | Steps | Expected |
|---|---|---|
| P5c-NEG-1 | Logged in as DEVELOPER / QA_ENGINEER / CLIENT → add/delete credential | **403** "Only project leads … can manage environment credentials". |
| P5c-NEG-2 | Upsert credential with empty name | **400** "Credential name is required". |
| P5c-NEG-3 | Upsert credential with empty `fields` | **400** "At least one field … required". |
| P5c-NEG-4 | Worker has a **different** `SECRETS_KEK` than the API | Credential fails to decrypt → skipped (logged); run proceeds unauthenticated → login-dependent test fails **honestly** (not a crash). |
| P5c-NEG-5 | Tamper a `secretsCiphertext` byte in the DB → run | Decrypt throws (GCM auth tag) → credential skipped, warning logged. |
| P5c-NEG-6 | API response inspection | Confirm **no** endpoint ever returns decrypted env variable values or credential values in plaintext. |

---

## 9. Phase 6 — Execution robustness & accuracy

### 6a — selectors
| ID | Steps | Expected |
|---|---|---|
| P6-POS-1 | Step with a **wrong primary** selector but a valid `fallbackSelectors[]` entry | Step succeeds via the fallback. |
| P6-POS-2 | Step authored with `getByText("Save")` / `getByRole("button","Save")` | Resolves to a real locator and acts (no "invalid selector" error). |
| P6-NEG-1 | Both primary **and** all fallbacks invalid | Step fails with a clear locator error after the timeout. |
| P6-NEG-2 | `getByRole("button","Save")` matching multiple elements | Acts on first / surfaces ambiguity per Playwright; no silent wrong-element on a strict path. |

### 6b — file upload
| ID | Steps | Expected |
|---|---|---|
| P6-POS-3 | `FILE_UPLOAD` step with inline text content → run vs a file input | App receives the file; step passes. |
| P6-POS-4 | `FILE_UPLOAD` with `base64:true` binary content | Decoded bytes uploaded correctly. |
| P6-NEG-3 | `FILE_UPLOAD` with empty `files[]` | **Throws** "FILE_UPLOAD requires a non-empty files[] array" → step FAILED. |
| P6-NEG-4 | `FILE_UPLOAD` targeting a non-file element | Playwright error → step FAILED (clear message). |

### 6d — web-first assertions + retry + continueOnFail
| ID | Steps | Expected |
|---|---|---|
| P6-POS-5 | ASSERT_TEXT against text that appears after ~1s delay | **Passes** (polls) where a one-shot read would have failed. |
| P6-POS-6 | ASSERT_ELEMENT `count` that settles after a delay | Passes once count matches within timeout. |
| P6-POS-7 | Flaky step with `retries: 2` that succeeds on attempt 2 | Step passes; logs show retry. |
| P6-POS-8 | Two failing steps, both `continueOnFail:true`, then a passing step | All steps run; both failures recorded; test ends **FAILED**. |
| P6-NEG-5 | ASSERT_TEXT for text that never appears | Fails after assertion timeout with the **last actual value** in the message. |
| P6-NEG-6 | ASSERT_VALUE mismatch (exact) that never matches | Fails after timeout. |
| P6-NEG-7 | Failing step with `continueOnFail:false` (default) | Run **stops** at that step (subsequent steps not run). |

### 6e — queue robustness
| ID | Steps | Expected |
|---|---|---|
| P6-POS-9 | Kill the worker mid-run, bring it back | Stalled job is re-picked after `lockDuration`; **DB-claim** prevents a still-running duplicate. |
| P6-NEG-8 | Re-enqueue / manually re-trigger a run already RUNNING | Second execution **bails** ("already claimed…"); no duplicate/clobbered results. |
| P6-NEG-9 | Run exceeds `RUN_TIMEOUT_MS` | Status **TIMED_OUT**; browser force-killed; honest message. |

---

## 10. Phase 7 — Value verification & metrics

| ID | Layer | Steps | Expected |
|---|---|---|---|
| P7-POS-1 | E | STORE count before, do actions, STORE after, `EMIT_METRIC` value `{{AFTER}} - {{BEFORE}}` with assert `>= 5` and the delta **is** ≥5 | Step passes; metric persisted on `RunStep.output` + `TestRun.metadata.emittedMetrics` (D). |
| P7-POS-2 | E | Run the metric test 3× | Project page **Metrics tile** shows the rollup (sum) across the 3 runs; respects the All/Automated/Manual toggle. |
| P7-POS-3 | A | `GET /projects/:id/metrics?mode=AUTOMATED` | Returns aggregated metrics partitioned by mode. |
| P7-POS-4 | E | aggregation `latest` / `avg` / `min` / `max` | Tile value matches the declared aggregation. |
| P7-NEG-1 | E | `EMIT_METRIC` value that interpolates to non-numeric (e.g. empty) | Step **FAILS** "value … is not numeric". |
| P7-NEG-2 | E | Inline assert `>= 5` but delta is 3 | Step **FAILS** with the metric value + operator in the message; metric not counted as passing. |
| P7-NEG-3 | E | `EMIT_METRIC` value `"1; process.exit()"` (injection attempt) | Rejected by the char-whitelist → "not numeric"; no code execution. |
| P7-NEG-4 | A | Project with no emitted metrics | `/metrics` returns `[]`; no tile rendered (not an error). |

---

## 11. Regression (must NOT break)

| ID | Check |
|---|---|
| REG-1 | Existing **manual** testing flow (TestingView, step pass/fail marking, work sessions) unchanged. |
| REG-2 | Existing AI/Git plugin credentials (OrgAiCredential/OrgGitCredential) still encrypt/decrypt — **SecretsService untouched**. |
| REG-3 | Existing tests/runs created before this branch still load, run, and report. |
| REG-4 | Visual ↔ JSON step editor round-trip stable for a single test. |
| REG-5 | Reports generation still succeeds (metrics block deferred — confirm no regression). |
| REG-6 | Non-automation envs still usable for manual preview (iframe/new tab). |

---

## 12. Exit criteria

1. All POS + NEG cases pass (or deviations triaged & accepted).
2. Unit suites green (crypto 5, DSL 17, data-gen 10).
3. `tsc --noEmit` clean on api/worker/web/shared (pre-existing `turndown`/`mammoth`/`docx-preview`/`xlsx` excluded).
4. A full E2E pass: one feature taken through **DSL author → automated run (with credential + data-gen + file upload + web-first assert + EMIT_METRIC) → video + metric visible**, plus the matching negatives.
5. Security sign-off on Phase 5c: no plaintext secrets at rest or on the wire; RBAC enforced; worker-KEK confirmed.

## 13. Known deferred (out of scope — don't fail the build on these)
- Phase 6 P1/P2: SelectorHeal-at-runtime, iframe/shadow-DOM, worker heartbeat, per-org automated-run cap, browser pooling, Redis HA, stack-trace capture.
- `EMIT_METRIC` on API/SHELL runs (UI runs covered).
- Reports-payload metrics block.
- Dropping the deprecated `Feature.automatedTestingEnabled` column.
