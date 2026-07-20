# 06 — Phase 4: Scale

Currently there is **no parallelism anywhere** and total platform capacity is
three concurrent browsers. This phase removes that ceiling.

**Total effort: ~2 weeks.** Schedule against throughput pain, not calendar —
everything here is invisible to a user whose suite already finishes fast enough.

---

## 4.1 — Parallel test execution within a run `[ ]` L

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
- [ ] A 20-test feature run completes in roughly `ceil(20/N)` × avg duration
- [ ] A feature marked `serial` still runs one at a time
- [ ] A lost completion event costs one test, not the run
- [ ] No cross-test data collisions under parallel execution

---

## 4.2 — De-parallelising retry ladder `[ ]` S ⭐ copy verbatim

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
- [ ] Failures re-run in batches of 5, then serially
- [ ] All tests report before any re-attempt
- [ ] `passedAtAttempt` recorded and surfaced
- [ ] Ladder is per-feature-run configurable and can be disabled

---

## 4.3 — Horizontal worker scaling `[ ]` M

### The blocker
`container_name: qa-worker-prod` (`docker/prod/docker-compose.yml:103`) makes
`docker compose up --scale worker=N` **fail outright** — container names must be
unique. Every service is pinned this way.

### Fix
1. Remove `container_name` from the worker service (keep it for stateful services
   where a stable name is useful).
2. Verify the atomic DB claim (`run.executor.ts:126-133`) genuinely prevents
   double-execution across *processes*, not just within one — it should, since it
   is a conditional `updateMany`, but it has never been exercised with N>1 workers.
3. Move PDF rendering to its own service so it scales independently of run
   execution (follows from [1.5](03-PHASE-1-CORRECTNESS.md)).

### ⚠️ Do not scale the API
The **7 `@Cron` schedulers run in-process with no distributed lock**
(`stuck-runs`, `pipelines`, `run-schedules`, `reports`, `report-schedules`,
`work-sessions`, `plugin-health`). This is safe *only* because there is exactly
one API replica. Scaling the API to 2 **double-fires every scheduled report,
pipeline tick and stuck-run sweep.** See [4.6](#46--distributed-cron-lock).

`RunSchedule` already guards itself with an atomic `nextRunAt` claim
(`run-schedules.service.ts:176-185`) — that is the pattern the others need.

### Acceptance
- [ ] `--scale worker=3` starts three workers that share the queue correctly
- [ ] No run is executed twice under N workers (verified with a stress run)
- [ ] PDF rendering is a separate, independently limited service

---

## 4.4 — Duration-balanced sharding `[ ]` S

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

### Acceptance
- [ ] Per-test p50 duration maintained
- [ ] Enqueue window ordered longest-first
- [ ] Measurable wall-clock improvement on a mixed-duration suite

---

## 4.5 — Fail-fast / auto-cancellation `[ ]` S

Cypress charges $267/mo for this tier. With BullMQ it is trivial: when a run has
already failed and the feature is configured `failFast`, cancel the remaining
queued jobs for that feature run.

Saves real compute on a small box, and shortens time-to-signal — which is the
actual user benefit.

Interacts with [4.2](#42--de-parallelising-retry-ladder): fail-fast should trigger
**after** the retry ladder completes, not on first failure, or it will cancel
tests that would have passed on retry.

### Acceptance
- [ ] `failFast` cancels remaining queued tests once the ladder has resolved
- [ ] Cancelled tests are `CANCELLED`, not `FAILED` — they were never attempted
- [ ] Off by default

---

## 4.6 — Distributed cron lock `[ ]` M 🔒

**This is a latent data-corruption bug**, not an optimisation. Seven `@Cron` sites
run in-process with no coordination. The moment anyone scales the API, scheduled
reports send twice, pipelines tick twice, and stuck-run sweeps race each other.

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
- [ ] All seven crons take a lock
- [ ] Two API replicas produce exactly one execution per tick
- [ ] Lock TTL exceeds the longest expected job duration

---

## Phase 4 exit criteria

- [ ] Feature runs execute tests in parallel with a configurable budget
- [ ] Retry ladder implemented, with `passedAtAttempt` feeding flake scoring
- [ ] Workers scale horizontally without double-execution
- [ ] All crons hold distributed locks, so the API can scale too
- [ ] Documented real ceiling: `WORKER_CONCURRENCY × workers` browsers, and the
      host memory that implies
