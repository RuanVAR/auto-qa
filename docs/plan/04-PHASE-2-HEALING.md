# 04 — Phase 2: Selector drift detection

**The highest value-to-effort work available.** This is wiring, not building —
the feature already exists across four layers and is missing only the worker
write path.

**Total effort: ~1 week.** Ship all of 2.1–2.6 together; they are one feature.

**Status (2026-07-21): complete.** 2.1–2.7 are implemented. Selector changes
require repeated corroboration before entering the review queue, and optional
high-confidence auto-application remains off by default. One correctness bug
was found and fixed by the live verification, not by the unit tests: promote() assumed
steps carried a stored `index` field: they don't; the index is array
position. Full commit trail on the branch.

## 1. Why this is cheap

| Layer | State | Location |
|---|---|---|
| Candidate generation + ranking (7 strategies) | **Built** | `apps/recorder-extension/content.js:226-312` |
| `fallbackSelectors[]` persisted per step | **Built** | step `input.fallbackSelectors` |
| `SelectorHeal` model | **Built** | `apps/api/prisma/schema.prisma:1309` |
| API loads heals into run detail | **Built** | `apps/api/src/modules/runs/runs.service.ts:94` |
| Dashboard "Heals Today" tile | **Built, hardcoded `0`** | `DashboardPage.tsx:823` |
| `aiDescription` per step | **Built, never read** | worker has zero references |
| **Worker writes a heal row** | **MISSING** | — |

The existing model is already well designed:

```prisma
model SelectorHeal {
  id               String   @id @default(uuid())
  stepIndex        Int
  stepName         String
  originalSelector String?
  healedSelector   String
  confidence       String   // "high" | "medium" | "low"
  source           String   // "code" | "visual" | "code+visual"
  createdAt        DateTime @default(now())
  runId            String
  stepId           String
  testDefinitionId String
  @@map("selector_heals")
}
```

The recorder already ranks `testattr → role → label → placeholder → text → id →
css`, picks a winner, and emits fallbacks. **That candidate ranking is what Testim
and Testsigma market as their core differentiator.** We run it once at record
time in a Chrome extension instead of at failure time in the worker.

---

## 2. Naming — this matters commercially

**Do not call this "self-healing".** Practitioner sentiment through 2025–26 is
close to unanimous and hostile: *"Self-healing test is bullshit"*, *"half the time
it 'fixes' itself even when there's a real bug"*. The most credible negative
signal comes from a **paying mabl customer who rated the product 8/10**:
*"Self-heal feature produces false positives, disabled it in most cases."*

Ship it as **"selector drift detection"** with reviewable proposals. Identical
feature, honest promise. The critics' actual objection is not that selectors
drift — it is that healing **hides regressions and reports a green build**. Every
guard below exists to make that accusation untrue of us.

---

## 2.1 — Write `SelectorHeal` rows from the fallback cascade `[x]` S

### Current behaviour

`apps/worker/src/steps/step.runner.ts:472-480` builds an **OR-union**:

```ts
let loc = page.locator(primary);
for (const f of input.fallbackSelectors ?? []) loc = loc.or(page.locator(f));
```

Two problems: it is a union rather than an ordered fallback (if both match,
Playwright throws a strict-mode violation), and **nothing records which
alternative won**.

### New behaviour

Replace the union with an ordered cascade that reports the winner:

```ts
/**
 * Resolve a step's target by trying the primary selector, then each fallback in
 * order, returning which rung won so the caller can record a heal.
 *
 * Deliberately ordered rather than `.or()`-unioned: `.or()` does not prefer the
 * left side, so when both the primary and a fallback match, Playwright raises a
 * strict-mode violation instead of using the primary. Ordered resolution also
 * gives us the one thing a union cannot — knowing that the primary FAILED, which
 * is the entire signal this feature is built on.
 */
interface Resolution {
  locator: Locator;
  selector: string;
  rung: SelectorRung;      // 'primary' | 'fallback'
  fallbackIndex?: number;
  healed: boolean;
}

async resolveTarget(page: Page, step: Step, input: StepInput): Promise<Resolution>
```

Resolution order:
1. Primary — `count() === 1` within a short probe timeout (2 s, not the full
   action timeout — we are probing, not waiting for the app).
2. Each `fallbackSelectors[i]` in order, same test.
3. If none resolves uniquely, throw the original primary's error so the message
   stays familiar.

When a fallback wins, emit a heal record.

### Confidence model

Derive confidence from the **strategy that won**, tuned to *why* each breaks:

```ts
/**
 * Confidence priors by selector strategy. These encode how each strategy fails,
 * not how "good" it looks:
 *   - testattr survives copy edits, restyles and DOM refactors — it only breaks
 *     when someone deliberately removes it, so a match is near-certainly right.
 *   - text is common but copy changes constantly, and two buttons can share text.
 *   - id looks stable but framework-generated ids churn on every build.
 *   - css positional paths break on any structural change; a match proves little.
 */
const CONFIDENCE_BY_STRATEGY: Record<SelectorStrategy, number> = {
  testattr:    0.99,
  role:        0.95,   // role + accessible name
  label:       0.90,
  placeholder: 0.85,
  text:        0.70,
  id:          0.60,
  css:         0.40,
};

const bucket = (n: number) => n >= 0.9 ? 'high' : n >= 0.65 ? 'medium' : 'low';
```

Strategy is inferred from the selector string (the same parsing
`normalizeToLocator` already does at `step.runner.ts:447`).

### Writing the row

**Deviation, and a stale claim corrected:** this paragraph's premise — "the
worker has no Prisma client" — is false; `run.executor.ts` already writes
`RunStep` and `TestRun` rows directly via Prisma throughout (see e.g. the
error path in `execute()`). The "no direct DB writes except the claim"
framing describes an aspiration, not the current code. Given that, the
simpler and equally safe implementation was chosen: `run.executor.ts` writes
the `SelectorHeal` row directly, the same way it already writes everything
else — no new Redis event, no `worker-events.service.ts` change. `StepRunner`
itself still has no DB access (kept unit-testable) — it exposes the outcome
via `getLastResolution()` and takes DB-backed decisions as injected callbacks
(`healConfig.sensitivity`, `healConfig.giveUpCheck`) that the executor
supplies.

### Acceptance
- [x] A step whose primary selector is wrong but whose fallback is valid **passes**
- [x] Exactly one `SelectorHeal` row is written, with correct
      `originalSelector`, `healedSelector`, `confidence`, `source: 'code'`
- [x] Run detail shows the heal (the API already loads it)
- [x] Strict-mode violations no longer occur when primary and fallback both match

---

## 2.2 — `passed (healed)` is not `passed` `[x]` S ⚠️ non-negotiable

A heal that fires must **never** report as a clean pass. This is precisely the
failure mode Momentic and Testsigma both admit to, and the one practitioners cite
when they say healing masks regressions.

### Schema

```prisma
enum StepStatus {
  PENDING
  RUNNING
  PASSED
  PASSED_HEALED   // passed, but only after a selector fallback was used
  FAILED
  SKIPPED
  ABORTED
  ERROR
}
```

Rules:
- `PASSED_HEALED` **counts as passing** for gating, pass rate and sign-off — the
  test did verify the behaviour.
- It is **visually distinct** everywhere: run detail, step list, feature status,
  and the dashboard.
- A run containing any healed step is itself flagged (`TestRun.healCount`), so a
  green run that leaned on healing is visible at a glance.

### UI
- Step row: amber "healed" chip with the before/after selector on hover.
- Run header: `12 passed (2 healed)`.
- A **review queue** — the heals awaiting a human decision (see 2.7).

### Acceptance
- [x] Healed steps render distinctly and are never indistinguishable from clean passes
- [x] Pass-rate maths unchanged (healed still counts as passed)
- [x] `TestRun.healCount` populated and surfaced

---

## 2.3 — Persist retry outcomes as flake signal `[x]` S

We already retry per step (`run.executor.ts:599-619`) and **discard the result**.
A step that passes on attempt 2 is a flake datapoint, and it is currently
invisible — `RunStep` has no attempt counter.

### Schema
```prisma
model RunStep {
  // …
  attempts        Int      @default(1)   // how many attempts were made
  attemptsToPass  Int?                   // which attempt finally passed (null if never)
}
```

### Worker
Record both in the retry loop. This is the prerequisite for **everything** in
[Phase 3](05-PHASE-3-INTELLIGENCE.md) — flake scoring cannot exist without it.

### Acceptance
- [x] A step passing on attempt 2 records `attempts: 2, attemptsToPass: 2`
- [x] A clean pass records `attempts: 1, attemptsToPass: 1`
- [x] A total failure records `attempts: N, attemptsToPass: null`

---

## 2.4 — Never heal assertions; enforce a confidence floor `[x]` S 🔒

### Rule 1 — assertions are never healed

A selector that drifted is an authoring artefact. **An assertion that fails is the
product talking.** Healing an assertion is how a real regression ships green.

Independently confirmed: Katalon auto-excludes its `Verify` and `Wait` keywords
from healing *by design*, and a competing tool's author deliberately made his
refuse to heal failing assertions because auto-greening them *"is exactly how
other self-healing tools mask regressions"*.

```ts
/**
 * Step types whose failure is a statement about the product, not about the
 * selector. Never healed — healing these is how a genuine regression ships green.
 */
const NEVER_HEAL: ReadonlySet<StepType> = new Set([
  'ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL',
  'ASSERT_ELEMENT', 'ASSERT_STATUS', 'ASSERT_BODY', 'ASSERT_HEADER',
  'ASSERT_EXIT', 'ASSERT_OUTPUT', 'ASSERT_CONTAINS',
]);
```

Note the nuance: an assertion still *resolves* a locator. Locator resolution for
an assertion may use the primary only — if the primary does not resolve, the
assertion **fails** rather than falling back.

**Extend this to negative assertions**, which ACCELQ handles well and most
vendors miss entirely: healing must also be skipped wherever the element's
*absence* is the expected state — waiting for something to disappear, or
asserting an element does **not** exist. Searching harder for an element you
expect to be gone is guaranteed to produce the wrong answer. Report it in the run
as "healing skipped (negative assertion)" so the behaviour is visible rather than
silent.

### Rule 3 — no cascading heals

Taken from Virtuoso's four-condition gate, and it is the subtlest guard in the
category: **do not heal if any earlier step in the same run was itself resolved
with low confidence.**

Once a run has gone off-piste — wrong page, wrong modal, wrong record — every
subsequent "successful" heal is resolving against the wrong context and
manufacturing a green run out of a broken journey. One uncertain resolution
poisons everything after it.

```ts
// Track resolution confidence across the run; once anything resolves below the
// floor, stop healing for the remainder. A heal is only trustworthy if every
// step before it landed where it was supposed to.
if (this.runHasLowConfidenceResolution) return { healed: false, reason: 'upstream-uncertainty' };
```

### Rule 2 — confidence floor

Below a threshold, fail the step and flag it rather than healing.
Default `0.65` (i.e. `low` never auto-heals), configurable per project.

Expose it as a **sensitivity control**, copying Testim's `Very Low → Strict`
scale, where `Strict` means *fail rather than heal through*. It is the one control
the other vendors lack, and it is what makes healing acceptable on a critical flow.

### Acceptance
- [x] An assertion step never produces a `SelectorHeal` row
- [x] A `css`-rung fallback (0.40) does not auto-heal at default sensitivity
- [x] Project-level sensitivity setting is honoured

---

## 2.5 — Gate promotion evidence on run outcome `[x]` S

Copied from mabl, and better than the naive design: apply the heal **in-flight**
so the run continues, but only let it count toward a future selector promotion
if the test ultimately passed — and discard it if the test failed or it was a
preview run.

Otherwise a heal recorded during an already-failing run poisons that selector for
every future run.

```
heal fires  → step continues, SelectorHeal row written (always — it is evidence)
run ends PASSED / PASSED_HEALED, and !isPreview
            → heal counts toward the repeated-run promotion gate (2.7)
run ends FAILED / ERROR / TIMED_OUT, or isPreview
            → heal recorded for diagnosis, never contributes to promotion
```

Note the distinction: the `SelectorHeal` **row is always written** (it is
evidence of what happened). What is gated is whether it may ever be promoted into
the stored step definition.

### Acceptance
- [x] Heal on a failing run is recorded but never promoted
- [x] Heal on a preview run is recorded but never promoted
- [x] Only heals from passing, non-preview automated runs contribute to the
      promotion queue's repeated-run gate

---

## 2.6 — Let the healer give up `[x]` S

If the same step has already healed *n* consecutive runs (default 3), **stop
healing on the next unresolved run and escalate**. The first three healed passes
are intentionally available to the promotion gate in 2.7; repeated drift beyond
that means the selector should be updated, not papered over indefinitely.

Playwright's own Healer agent does this: it *skips* rather than heals when the
functionality appears genuinely broken. Most commercial vendors do not.

```
three completed healed runs, then another unresolved execution
  → step FAILS with: "Selector has drifted for 3 consecutive runs and is no
     longer being auto-resolved. Update the step or accept the proposed selector."
  → notification to the project
```

### Acceptance
- [x] The run after three consecutive heals fails the step with a clear message
- [x] Counter resets when the step passes cleanly or the selector is updated

---

## 2.7 — Promotion / demotion with a validation gate `[x]` M

After N consecutive runs where fallback rung *k* wins and the primary fails,
promote *k* to primary and demote the old primary into the fallback array.

**The gate is Testim's, and it is the most stealable detail in the category:**
only promote if the healed selector resolved to **exactly one** element **and**
the step's downstream assertions passed.

Two modes, per project:
- **Propose** (default) — heals accumulate in a review queue; a human approves.
  This is Katalon's model and it is structurally immune to silent heals.
  **Shipped**: `SelectorHealsService` (list/promote/dismiss), a panel on
  Runs & Schedules, promote reuses `TestsService.update` for the
  snapshot/version/audit trail.
- **Auto-apply** — opt-in, and only for heals at `high` confidence from passing
  runs. The per-project policy defaults to off, requires an elevated project
  role to change, and is available on Runs & Schedules. Automatic promotions
  still use `TestsService.update`, preserving the test snapshot and audit trail.

Also add a **diversity criterion** to the recorder's candidate generation
(`content.js`): Reflect orders by specificity, narrowest first, and deliberately
favours diversity across attributes, so deleting one class does not invalidate the
whole set. Recorder fallbacks now require unique resolution and distinct
strategies from the winner and one another; two brittle variants of the same
selector approach no longer masquerade as resilience.

### Acceptance
- [x] Promotion requires unique resolution, passing downstream assertions,
      and the configured number of consecutive matching healed automated runs
- [x] Review queue lists pending heals with before/after and confidence
- [x] Approving updates the stored step and clears the queue entry — verified
      live: a real heal was promoted and the stored selector swapped correctly
- [x] Auto-apply is off by default, restricted to `high` confidence, and
      requires an elevated project role to enable
- [x] Recorder fallbacks are unique and strategy-diverse

---

## 3. Reinstate the dashboard tile

Once heals exist, restore "Heals Today" (removed in
[1.8](03-PHASE-1-CORRECTNESS.md)) with a real query, and add a **heal-precision**
figure — heals that survived human review ÷ total heals reviewed.

**No vendor in this market publishes a false-positive rate for healing. Not one.**
Every answer is a guardrail, never a measurement. Publishing an honest number
would be a first in the category, and it costs a query. See
[6.7](08-PHASE-6-MOAT.md).

---

## Phase 2 exit criteria

- [x] Heals are written, surfaced, and distinguishable from clean passes
- [x] Assertions are never healed; confidence floor enforced
- [x] Persistence gated on run outcome
- [x] Give-up rule active
- [x] Retry outcomes persisted (unblocks Phase 3)
- [x] Feature is named "selector drift detection" in all UI copy
- [x] `aiDescription` still unused — deliberately. It is the input for
      [6.4](08-PHASE-6-MOAT.md), and the deterministic ladder must be proven first
      (confirmed: zero new references to it anywhere in this phase's diff)
