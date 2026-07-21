# 03 — Phase 1: Correctness

Eleven defects, every one verified directly against the code. Each entry gives
the evidence, the fix, and how to prove the fix.

**Total effort: ~2 days**, dominated by 1.4 and 1.10.

Do these after [Phase 0](02-PHASE-0-SURVIVAL.md) and before any feature work —
several of them silently corrupt the data that Phases 2 and 3 depend on.

---

## 1.1 — `TIMED_OUT` permanently wedges a feature run `[x]` S ⚠️ highest impact

### Evidence

The worker sets `RunStatus.TIMED_OUT` (`apps/worker/src/executors/run.executor.ts:374`).

`apps/api/src/modules/feature-runs/feature-runs.service.ts:835`:
```ts
const terminalStatuses: RunStatus[] = [
  RunStatus.PASSED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.ERROR
];
const allDone = featureRun.testRuns.every(r => terminalStatuses.includes(r.status));
```

`TIMED_OUT` is absent. So once any child test times out, `allDone` can **never**
become true.

The API's own `TERMINAL_RUN_STATUSES` in the worker-events service *does* include
`TIMED_OUT` — the two lists disagree, which is how this survived review.

### Impact

The FeatureRun stays `RUNNING` forever. Sign-off never fires. The completion
webhook never fires. Any parent pipeline never advances. It is rescued 15–60 min
later by `stuck-runs.service.ts`, which **cancels** it — so a timed-out test
silently converts an entire feature run into a cancellation.

### Fix

```ts
const terminalStatuses: RunStatus[] = [
  RunStatus.PASSED, RunStatus.FAILED, RunStatus.CANCELLED,
  RunStatus.ERROR, RunStatus.TIMED_OUT,
];
```

Then **extract this to one shared constant** so the two lists cannot drift again:
`apps/api/src/common/util/run-status.ts` exporting `TERMINAL_RUN_STATUSES`, and
import it in both `feature-runs.service.ts` and `worker-events.service.ts`.

Audit every other `RunStatus[]` literal in the API for the same omission.

### Test
`apps/api/src/modules/feature-runs/__tests__/feature-runs.service.spec.ts` —
a feature run with 2 tests, one `PASSED`, one `TIMED_OUT`, asserts the feature run
transitions to `COMPLETE` and the webhook fires.

---

## 1.2 — Per-step Timeout control does nothing `[x]` S

### Evidence
- UI writes at the step **root**: `apps/web/src/components/StepEditor.tsx:1174`
  → `onChange({ ...step, timeoutMs: … })`
- Type declares it at the root: `packages/shared/src/types/index.ts:84`
- Worker reads from **`input`**: `apps/worker/src/steps/step.runner.ts:484`
  → `this.optionalNumber(input.timeout ?? input.timeoutMs) ?? 5000`
- `grep -rn "step\.timeoutMs" apps/worker/src/` → **no matches**

A user setting 60000 still gets the 5 s assertion default.

### Fix
Fix in the **worker** (the root position is the documented contract), and keep
reading `input.*` for backward compatibility with existing stored steps:

```ts
// step.runner.ts — accept the documented root-level `timeoutMs` (what the editor
// writes) while still honouring the legacy input-level override.
private assertionTimeout(step: Step, input: Record<string, unknown>): number {
  return this.optionalNumber(input.timeout ?? input.timeoutMs)
      ?? this.optionalNumber(step.timeoutMs)
      ?? 5000;
}
```

This requires threading `step` into `assertionTimeout`; it currently only
receives `input`.

### Test
Unit test in `apps/worker/src/__tests__/step.runner.spec.ts`: a step with
`timeoutMs: 100` at the root against never-appearing text fails in ~100 ms, not
5,000 ms.

---

## 1.3 — `__authSeed` bypasses the SSRF guard `[x]` S 🔒

### Evidence
Every other outbound path in the worker calls `assertSafeTargetUrl`.
`apps/worker/src/services/auth-seed.ts:79` calls bare
`fetch(cfg.loginUrl)` with no guard, and parses the response for a token.

An environment configured with `loginUrl: http://169.254.169.254/latest/meta-data/…`
would reach cloud metadata, and the response is parsed and injected into the run.

### Fix
```ts
import { assertSafeTargetUrl } from '../utils/ssrf-guard';
// …
await assertSafeTargetUrl(cfg.loginUrl);   // same guard as every other egress
const res = await fetch(cfg.loginUrl, { … });
```

### Test
`apps/worker/src/__tests__/auth-seed.spec.ts` (new file — this module currently
has zero coverage): assert `169.254.169.254`, `metadata.google.internal`,
`localhost` and `[fe80::1]` are all rejected before any fetch occurs.

---

## 1.4 — Secrets are not redacted from evidence `[x]` M 🔒

### Evidence
Interpolated values land in `RunStep.input` (`run.executor.ts:589`), in failure
screenshots, and in the **Playwright trace, which records full network bodies**.
A `{{LOGIN_PASSWORD}}` typed into a form is in the trace in plaintext. There is no
scrubbing layer anywhere.

This becomes materially worse once the trace viewer is embedded (item 3.1),
because traces move from "download-only, rarely opened" to "one click in the UI".

### Fix

Three layers:

1. **Persisted step input** — before writing `RunStep.input`, replace any value
   that originated from a secret-classified variable with `'••••••••'`. The worker
   knows which variables came from `EnvironmentCredential` / encrypted env vars,
   so classify at resolve time rather than pattern-matching the value.
   ```ts
   // run.executor.ts — build the bag with provenance so evidence can be scrubbed
   type ResolvedVar = { value: string; secret: boolean };
   ```
2. **Screenshots** — set `mask:` on Playwright's screenshot options for inputs
   whose value came from a secret variable. Playwright supports
   `page.screenshot({ mask: [locator] })` natively.
3. **Traces** — Playwright cannot selectively scrub a trace. Two options, pick
   per-project: either do not record traces for runs that used credentials, or
   restrict trace download/view to elevated project roles. **Default to the
   latter** and make it explicit in the UI.

### Test
Integration test: run a step filling `{{LOGIN_PASSWORD}}`, then assert the
persisted `RunStep.input` contains no plaintext and the screenshot is masked.

---

## 1.5 — PDF worker doubles browser pressure `[x]` S

### Evidence
`apps/worker/src/queue/report-pdf.worker.ts:59` reuses `WORKER_CONCURRENCY`
(default 3, `run.worker.ts:17`) and each PDF job launches **its own Chromium**
(`:28`). Both workers run in the same container (`worker/src/main.ts:78,84`).

**Worst case: 3 run browsers + 3 PDF browsers = 6 concurrent Chromium on a 2 GB
host.** At ~300–500 MB each that is 2–3 GB against 2 GB of RAM, plus a `shm_size:
2gb` allocation carved from the same budget. This is the most likely cause of
current production instability.

The API container *also* runs Chromium for PDF rendering, adding more.

### Fix
```ts
// report-pdf.worker.ts — PDF rendering launches its own Chromium, so it must NOT
// inherit the run-worker's concurrency or the host runs 2N browsers.
concurrency: parseInt(process.env.PDF_WORKER_CONCURRENCY ?? '1', 10),
```

Default `1`. Document that `WORKER_CONCURRENCY + PDF_WORKER_CONCURRENCY` is the
real browser ceiling.

Longer term (Phase 4): move PDF rendering to its own container so it can be
scaled and limited independently.

### Test
Start a run and a report generation simultaneously; assert `docker stats` shows
at most `WORKER_CONCURRENCY + 1` Chromium processes.

---

## 1.6 — Dead concurrency configuration `[x]` S

### Evidence
`MAX_CONCURRENT_RUNS` and `MAX_BROWSERS_PER_WORKER` appear in
`.env.production.example:49-50`, `docker/dev/docker-compose.yml:197-198` and
`docker/dev/.env:16-17` — and are read by **zero lines of code** (verified by grep
across `apps/` and `packages/`).

An operator setting `MAX_BROWSERS_PER_WORKER=5` believes in a safety limit that
does not exist.

### Fix
Either implement them or delete them. **Delete them**, and document
`WORKER_CONCURRENCY` and the new `PDF_WORKER_CONCURRENCY` (1.5) as the real
controls, with a comment stating the browser-count implication.

Sweep for other dead env vars while in there.

---

## 1.7 — Orphan-Chromium reaper cannot match anything `[x]` S

### Evidence
`apps/worker/src/services/process.reaper.ts:83` finds stray browsers by matching
`ps` output for `qa-pw-`, which would appear in a `--user-data-dir` flag.

`browser.session.ts:63` creates `fs.mkdtemp(.../qa-pw-)` and stores the path —
but `:70-71` calls `launcher.launch()` + `browser.newContext()` and **never
passes `userDataDir`**, despite a comment at `:60-62` claiming
`launchPersistentContext` is used.

Playwright uses its own `/tmp/playwright_chromiumdev_profile-*` paths, so the
reaper always matches zero processes. **The stated protection against pid
accumulation after a crash does not exist.**

### Fix
Match on Playwright's actual profile prefix and on browser processes parented to
this worker:

```ts
// The temp dir we create is never passed to Playwright, so matching on it finds
// nothing. Playwright names its own profile dirs — match those instead.
const PW_PROFILE_PREFIX = 'playwright_chromiumdev_profile-';
```

Also remove the misleading comment and the unused `userDataDir` creation, or
actually pass it. **Prefer removing it** — `newContext()` is already isolated.

### Test
Unit test with a fixture `ps` output asserting the matcher identifies a
Playwright-launched Chromium.

---

## 1.8 — The dashboard displays two false numbers `[x]` S

### Evidence
- `apps/web/src/pages/dashboard/DashboardPage.tsx:823-824` —
  `<StatCard label="Heals Today" value={0} …>` — **hardcoded**.
- `:802` — labelled `Pass Rate (7d)`, but the value is
  `passedProjects / projectsWithLastRun` from each project's *last run status*,
  with no time window at all.

### Fix
- **Heals Today** — remove the tile now; reinstate it in
  [Phase 2](04-PHASE-2-HEALING.md) when `SelectorHeal` rows actually exist. A tile
  hardcoded to zero is worse than no tile: it teaches users the feature does not
  work.
- **Pass Rate** — either relabel to "Projects passing (latest run)" which is what
  it computes, or implement a real 7-day window. Relabel now, implement in
  Phase 3 alongside the other analytics work.

---

## 1.9 — Legacy AI prompt contradicts the selector rules `[x]` S

### Evidence
`apps/api/src/modules/ai/ai.service.ts:112` instructs the model to
**"Use CSS selectors"**, while `ai/prompts/base/output-schemas.ts:51`,
`packages/shared/src/types/index.ts:94` and `packages/shared/src/dsl/verbs.ts:33-40`
all **reject raw CSS as brittle**.

The legacy `POST /projects/:projectId/generate-test` endpoint therefore produces
tests the DSL validator would refuse.

### Fix
The G1/G2/G3 pipeline in `generation.service.ts` supersedes this endpoint.
**Deprecate and remove `generateTest`**, redirecting callers to G3
(`POST /tests/:testId/ai/steps`).

If it must stay, replace the prompt with the shared
`STABLE_SELECTOR_GUIDANCE` constant used by the real pipeline — and extract that
constant so the rule lives in exactly one place. The selector regex is currently
**triplicated verbatim** across three files.

---

## 1.10 — `run.executor.ts` lifecycle coverage `[x]` M

### Evidence
988 lines containing the atomic claim, the retry loop, the cancel/timeout
watchdog, status resolution, teardown ordering and metric rollup. **No spec file.**
~63 % of worker LOC is untested, and it is the 63 % holding all the concurrency,
lifecycle and security logic.

### Fix
Add `apps/worker/src/__tests__/run.executor.spec.ts` covering, at minimum:

| Case | Asserts |
|---|---|
| Claim wins | `PENDING → RUNNING`, execution proceeds |
| Claim loses (already `RUNNING`) | bails without executing, no duplicate results |
| Step retry succeeds on attempt 2 | run `PASSED`, retry recorded |
| Step retry exhausts | run `FAILED`, last error surfaced |
| `continueOnFail` | later steps still execute, run ends `FAILED` |
| Timeout exceeded | status `TIMED_OUT`, browser force-killed |
| Cancellation mid-run | status `CANCELLED`, distinct from timeout |
| Teardown on throw | browser closed, temp dir removed |

Mock Playwright the same way `step.runner.spec.ts:6-44` does.

This is the highest-value test work in the codebase and it blocks confident
changes in Phases 2 and 4.

---

## Current implementation status (2026-07-21)

Items 1.1–1.9 are now present on `development`. This document was stale: the
underlying fixes entered via `d0b0181`, with later execution changes preserving
them. Item 1.4 is now complete: encrypted credential/environment provenance
drives redaction of persisted inputs, outputs, errors and websocket evidence;
failure screenshots mask known secret fields, and trace/video retrieval requires
an elevated project role because those artifacts cannot be safely redacted.

Item 1.10 now has a direct worker spec for atomic claim behaviour, secret-safe
API evidence, retry success/exhaustion, continue-on-fail, timeout,
cancellation and teardown, plus the existing API claim E2E test.

## Phase 1 exit criteria

- [x] All ten items closed or explicitly deferred with a reason
- [x] `TERMINAL_RUN_STATUSES` exists as one shared constant, used everywhere
- [x] `run.executor.ts` has the full eight-case lifecycle matrix
- [x] Full worker suite: 12 suites / 125 tests; full API suite: 23 suites /
      256 tests (2026-07-21)
- [x] A timed-out test no longer wedges its feature run (verified end-to-end)
- [x] No plaintext secret appears in a persisted `RunStep.input` or screenshot
