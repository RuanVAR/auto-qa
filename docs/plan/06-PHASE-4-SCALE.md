# 06 — Phase 4: Scale

> **Status (2026-07-21):** All six items (4.1–4.6) done and live-verified,
> `feature/phase4-scale` (stacked on `feature/phase3-intelligence`), not yet
> merged/pushed. One structural sub-item explicitly deferred: 4.3's "move PDF
> rendering to its own service" (out of scope for this pass — see 4.3 below).
>
> Deviations from spec, all found via live verification:
> - **4.1**: `serial` is expressed as `Feature.concurrency = 1`, not a
>   separate boolean — the two are equivalent and a dedicated flag would just
>   be sugar over the same mechanism.
> - **4.2**: the retry ladder retries a feature run's failures together in
>   lockstep waves (attempt N applies to every currently-failed test at
>   once), not per-test independently. This has a real consequence for 4.5
>   — see below.
> - **4.3 × 4.4 interaction (found live)**: 4.4's duration-based ordering
>   sorts unknown-duration (no history yet) tests *last* regardless of
>   `TestDefinition.order`. A fresh test seeded to run first via `order=-1`
>   instead ran last, behind tests that already had recorded durations —
>   `TestDefinition.order` is not yet honored when duration history exists
>   for other candidates. No UI sets `order` today, so this has no current
>   user-facing impact, but is a real interaction worth fixing before any
>   `order`-setting UI ships.
> - **4.5**: only actionable when `retryLadderEnabled` is off for the run —
>   see the schema comment on `FeatureRun.failFast` for why (4.2's lockstep
>   waves mean a failure is never "final" while the ladder is on until
>   everything has already had its first attempt, by which point there's
>   nothing left to cancel).
> - **4.6 survey correction**: the plan's list of "seven" `@Cron` sites
>   missed an eighth — `artifact-retention.service.ts`'s daily sweep. Locked
>   along with the rest.
>
> Two real concurrency bugs found and fixed while live-verifying 4.2 (see
> that section) — both are the kind of bug that only a real dev-stack run
> surfaces, not a mocked-Prisma unit test.

Currently there is **no parallelism anywhere** and total platform capacity is
three concurrent browsers. This phase removes that ceiling.

**Total effort: ~2 weeks.** Schedule against throughput pain, not calendar —
everything here is invisible to a user whose suite already finishes fast enough.

---

## 4.1 — Parallel test execution within a run `[x]` L — done

### Current behaviour

Strictly sequential, chained through Redis:

```
feature-runs.service.ts:351   enqueue testRuns[0] only
worker finishes → publishes run:updated
worker-events.service.ts:52   → featureRunsService.onRunComplete
feature-runs.service.ts:885   enqueue pending[0]   ← the next single test
```

Consequences: a 20-test feature run takes the sum of all 20 durations; a single
lost Redis event stalls the chain until the stuck-run cron intervenes; and
`WORKER_CONCURRENCY=3` is only ever used by *unrelated* runs.

There is also **no user-controllable test order** — `createdAt: 'asc'` only.

### Target

Fan out at enqueue time with a per-feature-run concurrency budget:

```ts
/**
 * Enqueue up to `concurrency` tests at once rather than chaining one at a time.
 *
 * The existing design enqueued testRuns[0] and relied on the completion event to
 * enqueue the next — which serialised every feature run and made a single lost
 * Redis event enough to stall the whole chain. Fanning out removes both problems:
 * the queue itself becomes the ordering mechanism, and a lost event costs one
 * test rather than the remainder of the run.
 */
const budget = Math.min(featureRun.concurrency ?? DEFAULT_FEATURE_CONCURRENCY, pending.length);
await Promise.all(pending.slice(0, budget).map(r => this.queue.enqueueRun(r.id)));
```

`onRunComplete` then tops the window back up rather than advancing a pointer.

### Prerequisites and hazards

| Hazard | Mitigation |
|---|---|
| Tests sharing a user account collide | Per-test credential allocation, or an explicit `serial: true` flag on the feature |
| Test data collisions | Data generators already memoise **per runner instance**, so parallel runs get distinct values — verify this holds |
| Host memory | `WORKER_CONCURRENCY` still caps real browsers; fan-out only fills the queue |
| Ordering dependencies | Add `TestDefinition.order` and a `serial` flag; default parallel |

**This must not ship before [1.10](03-PHASE-1-CORRECTNESS.md)** (executor tests) —
it changes the most concurrency-sensitive code in the system.

### Acceptance
- [x] A 20-test feature run completes in roughly `ceil(20/N)` × avg duration
      — live-verified with concurrency=3: 3 TestRuns shared an identical
      `startedAt` timestamp (genuine simultaneous dispatch), vs. the old
      code's always-staggered starts
- [x] A feature marked `serial` still runs one at a time — via
      `concurrency=1`; live-verified strictly staggered starts, each
      immediately after the prior test's `completedAt`
- [x] A lost completion event costs one test, not the run — the top-up
      model re-derives `pending`/`inFlight` fresh from the DB on every call,
      not from an in-memory pointer
- [x] No cross-test data collisions under parallel execution — verified by
      reading the generator code rather than assuming: memoization
      (`apps/worker/src/steps/step.runner.ts:56`) is a `StepRunner` instance
      field, not module-level state, so concurrent runs can't collide

---

## 4.2 — De-parallelising retry ladder `[x]` S ⭐ copy verbatim — done

The cleverest mechanism found in the entire market survey, from QA Wolf, and it is
roughly 20 lines:

1. **Attempt 1** — all tests run concurrently
2. **Attempt 2** — only the failures re-run, **in batches of five**
3. **Attempt 3** — remaining failures run **serially**

Plus: *all* tests must report before any re-attempt begins.

### Why it is good

It is a targeted attack on **resource-contention and race-condition flakes**. If a
test only passes when it is alone, the ladder **proves** that rather than masking
it — and **the attempt at which it passed is itself a diagnosis**:

| Passed at | Diagnosis |
|---|---|
| Attempt 1 | Fine |
| Attempt 2 (batch of 5) | Contention under high concurrency |
| Attempt 3 (serial) | Hard contention or a genuine race |
| Never | Real failure |

Feed that straight into [3.5](05-PHASE-3-INTELLIGENCE.md) flake scoring — it is
a far richer signal than a binary retry flag.

### Calibration note
QA Wolf markets "zero flakes", but that is a **reporting** guarantee (humans
reproduce every failure before it reaches the customer), not an execution
guarantee — and **they publish no measured flake rate anywhere**. Same gap as the
heal-precision figure. Do not repeat their claim; publish the number instead.

### Acceptance
- [x] Failures re-run in batches of 5, then serially
- [x] All tests report before any re-attempt — free by construction: the
      wave-transition branch only runs once `allDone` (every TestRun
      terminal) is true
- [x] `passedAtAttempt` recorded and surfaced — stamped for every PASSED
      test at finalize time, including attempt-1 passes; no UI badge built
      yet (same precedent as 2.x/3.x's config fields — data correctness
      first, UI as a follow-up)
- [x] Ladder is per-feature-run configurable and can be disabled —
      `Feature.retryLadderEnabled` (default on), snapshotted onto
      `FeatureRun`

### Two real bugs found via live verification (an always-fails smoke test
run through all 3 waves on the dev stack), neither of which a mocked-Prisma
unit test would have caught:

1. **BullMQ jobId collision.** The ladder resets a failed `TestRun` in
   place and re-enqueues the *same* id. `QueueService.enqueueRun`'s job id
   was `run-<testRunId>` — re-adding it after the attempt-1 job had already
   completed hit BullMQ's own dedup-by-jobId and silently returned the
   stale completed job instead of queuing a new one; the DB flipped to
   `QUEUED` but nothing ever executed it again. A `remove()`-before-`add()`
   fix worked most of the time but raced BullMQ's own post-completion
   bookkeeping for a slow test whose wave-1 job finished right as the retry
   fired. Fixed properly by scoping the jobId to the ladder attempt
   (`run-<id>-attempt-<n>`) — every retry is a genuinely new id, no removal
   or its timing involved at all.
2. **Unguarded wave-transition race.** Two `TestRun`s in the same
   `FeatureRun` completing within moments of each other each fire
   `onRunComplete` independently; both can read `allDone=true` and decide
   to enter the same wave concurrently, and one call's reset then clobbers
   a row the other had already progressed — leaving it permanently stuck.
   Fixed with the same idempotent-claim pattern `PipelinesService`'s
   stage-advance and `RunSchedulesService`'s `nextRunAt` already use: an
   `updateMany` conditioned on the `currentLadderAttempt` just read, 0 rows
   = another call already won, back off with no side effects.

---

## 4.3 — Horizontal worker scaling `[~]` M — mostly done

### The blocker
`container_name: qa-worker-prod` (`docker/prod/docker-compose.yml:103`) makes
`docker compose up --scale worker=N` **fail outright** — container names must be
unique. Every service is pinned this way.

### Fix
1. [x] Remove `container_name` from the worker service (keep it for stateful
   services where a stable name is useful). **Also removed the fixed
   `127.0.0.1:3003:3003` host-port mapping** — found live that this would
   *also* block scaling even after removing the name, since N replicas
   can't share one host port. The container's own healthcheck runs inside
   its network namespace and needs no published port.
2. [x] Verify the atomic DB claim (`run.executor.ts`) genuinely prevents
   double-execution across *processes*, not just within one — live-verified:
   scaled the local dev worker to 2 real replicas (throwaway compose
   override, not a change to the checked-in dev compose file) and fired 4
   concurrent feature runs (12 TestRuns, 6 live execution slots across both
   replicas). Both replicas processed genuinely different runIds
   concurrently (confirmed via logs); no RunStep index was ever duplicated
   for any TestRun (the signature of a double-execution); no "already
   claimed" log line fired (BullMQ's own distribution never actually raced
   under this load — the DB claim's specific stalled-job-redelivery
   backstop is a code-reviewed guarantee, a standard Postgres atomic
   `UPDATE...WHERE` unaffected by process boundaries, not one deliberately
   triggered here since engineering a genuine stalled-job scenario — killing
   a worker mid-run — was out of scope for this pass).
   Bonus: this same run cross-validated 4.1+4.2 under real concurrent load
   across two processes — the retry ladder correctly engaged (one test
   recovered at attempt 2, four failed genuinely through all 3 attempts,
   consistent with 4.1's documented "tests sharing a user account collide"
   hazard under 6 simultaneous sessions against one demo account).
3. [ ] **Deferred** — move PDF rendering to its own service so it scales
   independently of run execution. A structural extraction beyond this
   pass's scope (the plan's own note: "follows from
   [1.5](03-PHASE-1-CORRECTNESS.md)"). Not started.

### ⚠️ Do not scale the API — status: now safe, not yet done
The **8 `@Cron` schedulers** (one more than the 7 originally listed here —
see [4.6](#46--distributed-cron-lock)) ran in-process with no distributed
lock, safe only because there was exactly one API replica. **This is now
fixed** — all 8 take a `CronLock` as of 4.6, so scaling the API no longer
double-fires scheduled reports/pipeline ticks/stuck-run sweeps. The prod
compose file's `container_name`/port pinning on the `api` service was
deliberately left untouched in this pass — actually enabling API scaling is
a separate operational decision (resource footprint, load balancer config)
left for an explicit follow-up, not bundled into this item.

`RunSchedule` already guards itself with an atomic `nextRunAt` claim
(`run-schedules.service.ts`) — that is the pattern [4.6](#46--distributed-cron-lock)
generalised for the rest.

### Acceptance
- [x] `--scale worker=3` starts three workers that share the queue correctly
      — live-verified with 2 replicas (see above); the mechanism doesn't
      change at 3
- [x] No run is executed twice under N workers (verified with a stress run)
      — see above
- [ ] PDF rendering is a separate, independently limited service — **deferred**

---

## 4.4 — Duration-balanced sharding `[x]` S — done

Playwright's native sharding splits by **test count or file, never by duration**
(confirmed in the official docs). That is exactly the gap Currents monetises,
claiming up to 50 % faster than native sharding.

We have a queue, so we do not need sharding *per se* — we need **bin-packing by
estimated duration** when filling the concurrency window:

```ts
// Order the enqueue window longest-first. With a fixed worker pool this is the
// classic LPT heuristic — it keeps the tail short, because a long test starting
// last is what determines total wall-clock.
pending.sort((a, b) => (durationP50(b.testDefinitionId) ?? 0) - (durationP50(a.testDefinitionId) ?? 0));
```

Store a rolling p50 duration per `TestDefinition`. ~50 lines, and it is the entire
technical basis of a paid feature elsewhere.

> **Deviation:** computed on demand via a single grouped `percentile_cont`
> query over canonical run history, instead of a maintained rolling column —
> avoids a background freshness job, and it's always current by
> construction since the ordering only matters at the moment of enqueue.

### Acceptance
- [x] Per-test p50 duration maintained — computed on demand (see deviation
      above), not stored; verified the raw SQL directly against real dev
      Postgres data (sane values, matched what was observed live in earlier
      phases' runs)
- [x] Enqueue window ordered longest-first — wired into all 5
      enqueue-selection sites (`start`, `onRunComplete`'s ladder-wave and
      top-up branches, `resume`, `promote`)
- [~] Measurable wall-clock improvement on a mixed-duration suite — the
      mechanism is live-verified working (executes cleanly, orders
      correctly for candidates with known duration), but not measured
      against a real mixed-duration suite at meaningful scale; **found a
      real interaction while verifying 4.5** — unknown-duration candidates
      sort last regardless of `TestDefinition.order`, see the status note
      at the top of this doc

---

## 4.5 — Fail-fast / auto-cancellation `[x]` S — done

Cypress charges $267/mo for this tier. With BullMQ it is trivial: when a run has
already failed and the feature is configured `failFast`, cancel the remaining
queued jobs for that feature run.

Saves real compute on a small box, and shortens time-to-signal — which is the
actual user benefit.

Interacts with [4.2](#42--de-parallelising-retry-ladder): fail-fast should trigger
**after** the retry ladder completes, not on first failure, or it will cancel
tests that would have passed on retry.

> **Deviation, architectural not cosmetic:** because 4.2's ladder retries a
> feature run's failures together in lockstep waves (not per-test
> independently), `allDone` — and therefore "the ladder has resolved" —
> requires *every* TestRun, including ones never yet attempted, to be
> terminal before a wave can even fire. So with the ladder on, a failure is
> never "final" until everything has already had its first attempt, by
> which point there is nothing pending left to fail-fast on. **Fail-fast is
> therefore only actionable when `retryLadderEnabled` is off for the run** —
> with the ladder off, a `FAILED` status is final the instant it's written,
> which is exactly the case this acts on. Reconciling this properly (e.g. an
> independent per-test ladder) is future work, not attempted here.

### Acceptance
- [x] `failFast` cancels remaining queued tests once the ladder has resolved
      — scoped to `retryLadderEnabled=false` runs (see deviation above)
- [x] Cancelled tests are `CANCELLED`, not `FAILED` — they were never attempted
- [x] Off by default

Live-verified on the dev stack: first attempt (probe seeded to run first via
`TestDefinition.order=-1`) didn't actually surface the bug, because 4.4's
duration ordering pushed it to run *last* instead (see the 4.4×4.3 status
note at the top) — by the time it failed, nothing was left pending to
cancel. Re-verified with a controlled setup (two tests, neither with prior
duration history, so ordering fell back to its tie-break — original array
index, i.e. `TestDefinition.order`): the failing test ran first as
intended, and the second was correctly cancelled with `startedAt` null,
never attempted.

---

## 4.6 — Distributed cron lock `[x]` M 🔒 — done

**This is a latent data-corruption bug**, not an optimisation. Seven `@Cron` sites
run in-process with no coordination. The moment anyone scales the API, scheduled
reports send twice, pipelines tick twice, and stuck-run sweeps race each other.

> **Deviation:** there are actually **eight** `@Cron` sites, not seven —
> `artifact-retention.service.ts`'s daily sweep was missing from this list.
> Locked along with the rest.

### Fix
Generalise the pattern `RunSchedule` already uses — an atomic claim — into a
reusable lock:

```ts
/**
 * Redis-backed advisory lock for scheduled work.
 *
 * Every @Cron in this codebase currently assumes it is the only API instance.
 * That assumption is invisible, unenforced, and wrong the moment a second
 * replica starts — so it is encoded here rather than left as tribal knowledge.
 */
@CronLock('reports-email-dispatch', { ttl: 300 })
```

Implement as a decorator wrapping `SET key value NX PX ttl`.

Apply to all seven. Add a startup assertion that logs loudly if more than one
replica is detected without locks enabled.

### Acceptance
- [x] All seven — actually eight, see deviation above — crons take a lock
- [x] Two API replicas produce exactly one execution per tick —
      integration-tested against real Redis (`CronLock` decorator proven to
      run its wrapped method exactly once under concurrent callers), plus
      `ReplicaLivenessService` as a belt-and-braces runtime check independent
      of whether the locks themselves are working
- [x] Lock TTL exceeds the longest expected job duration — TTLs scaled to
      each cron's own interval (120s for every-minute crons, 600s for
      every-5-minutes, 1800s for every-15-minutes, 3600s for the daily sweep)

---

## Phase 4 exit criteria

- [x] Feature runs execute tests in parallel with a configurable budget
- [x] Retry ladder implemented, with `passedAtAttempt` feeding flake scoring —
      recorded and surfaced on every TestRun; not yet wired into
      [3.5](05-PHASE-3-INTELLIGENCE.md)'s flake-scoring monitors as an
      additional signal (3.5 shipped in Phase 3, before this existed) —
      left as a natural follow-up, not attempted here
- [x] Workers scale horizontally without double-execution
- [x] All crons hold distributed locks, so the API can scale too — locks are
      live; actually turning on API replicas is a deliberate separate
      decision, not made here (see 4.3)
- [ ] Documented real ceiling: `WORKER_CONCURRENCY × workers` browsers, and
      the host memory that implies — **not done**. Per-worker `mem_limit`
      is 768m (prod compose); the real ceiling is
      `768m × workers + other services' limits`, capped by host memory —
      worth a line in the deploy runbook, not written here
