# 05 — Phase 3: Intelligence

> **Status (2026-07-21):** 3.1, 3.2, 3.4, 3.5, 3.6, 3.7 and 3.8 are complete
> on `codex/phase3-completion`. Defect rules (3.3) support
> matching, source resolution and mute; external-ticket lifecycle sync remains
> deferred. Project-dashboard quarantine totals are now visible.
>
> Deviations from spec, both found via live verification against a real
> failing run on the dev stack:
> - The plan's `triage()` regex `Timeout.*waiting for locator` assumed the
>   Playwright timeout message and the "waiting for locator" call-log line
>   are on one line. They aren't — Playwright puts them on separate lines
>   under a `Call log:` header, and `.` doesn't cross `\n`. Every real
>   selector-timeout failure fell through to `null` until fixed to
>   `Timeout[\s\S]*waiting for locator`. See `apps/worker/src/utils/failure-intelligence.ts`.
> - 3.5's branch-aware weighting ("failures on a feature branch should not
>   weigh the same as main") is **not implemented** — the platform doesn't
>   record branch/commit on a run yet (that's 3.7, deferred). All three
>   monitors currently treat every canonical run identically regardless of
>   branch.

**The highest perceived-value-per-hour work in the plan.** Almost everything here
is SQL over run history we already store and barely query.

The market charges heavily for these: Cypress paywalls flake detection at $67/mo
and spec prioritisation at $267/mo; Datadog bills test intelligence per active
committer. They are queries.

**Total effort: ~2 weeks.** Depends on [2.3](04-PHASE-2-HEALING.md) (retry
outcomes persisted).

---

## 3.1 — Embed the Playwright trace viewer `[x]` S

Implemented as an iframe to Playwright's maintained viewer. The platform issues
an authenticated, artifact-bound HMAC URL valid for five minutes; the viewer can
fetch only that one trace, and invalid/expired tokens return `401`. Normal
project/environment access is required before minting a URL.

### Why this is nearly free

We **already record traces** with everything the viewer needs
(`run.executor.ts:498,718`):

```ts
await context.tracing.start({ screenshots: true, snapshots: true });
```

They are stored as `TRACE` artifacts. The UI offers **download only**
(`RunDetailPage.tsx:401-412`).

The Playwright trace viewer is a **static React app, Apache 2.0**, bundled inside
`playwright-core`. It gives DOM time-travel, network, console, action-by-action
snapshots and sources — **the thing BrowserStack and Sauce Labs cannot sell at any
price.** Their offering is video plus a command log, which is not the same thing.

### Implementation

1. Add `sources: true` to the tracing options (helps the Source tab).
2. Extract the viewer's static assets from `playwright-core` at build time and
   host them under a stable path (e.g. `/trace-viewer/`), served by nginx.
3. In `RunDetailPage`, replace the download-only card with an iframe:
   ```
   /trace-viewer/index.html?trace=<presigned-artifact-url>
   ```

**Two hard requirements**, both verified:
- The viewer **must be served over http(s), not `file://`** — it errors explicitly
  otherwise.
- The artifact bucket **needs CORS** allowing the viewer's origin. Presigned URLs
  work.

Note the interaction with [1.4](03-PHASE-1-CORRECTNESS.md): traces contain full
network bodies including credentials. Gate trace *viewing* on elevated project
roles until scrubbing lands.

### Acceptance
- [x] Trace opens inline in run detail
- [x] Network and console tabs are available through the Playwright viewer
- [x] Access is scoped by normal project/environment authorization before URL minting

---

## 3.2 — Failure fingerprinting and clustering `[x]` M — done

### The problem
Every failure is a raw `Error.message` truncated to 2000 chars. Nothing
distinguishes assertion failure from selector-not-found from navigation timeout.
"23 tests failed" gives no indication that it is really 3 problems.

### Implementation

Normalise, then hash:

```ts
/**
 * Collapse a raw error message into a stable fingerprint so the same underlying
 * problem groups across tests, runs and environments.
 *
 * Everything stripped here is incidental — it varies run to run while the defect
 * stays the same. Getting this list wrong in either direction is the whole
 * difficulty: strip too little and every failure is unique; strip too much and
 * unrelated failures collapse together.
 */
const normalise = (msg: string): string => msg
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
  .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<timestamp>')
  .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
  .replace(/:\d{2,5}\b/g, ':<port>')
  .replace(/\/[\w.\-/]+\/(?=[\w.\-]+\.\w+)/g, '<path>/')
  .replace(/\bnth=\d+/g, 'nth=<n>')
  .replace(/\b\d+\b/g, '<n>')
  .trim()
  .slice(0, 500);

const fingerprint = (msg: string) => sha256(normalise(msg)).slice(0, 16);
```

Store `TestRun.failureFingerprint` and `RunStep.failureFingerprint`. Index both.

### ⚠️ Validate before promising accuracy
*"230,439 Test Failures Later"* (arXiv 2401.15788) found de-duplication
effectiveness **varies enormously by project** — 100 % specificity in some,
entirely ineffective in others. Measure on our own corpus before marketing it.

### Acceptance
- [x] Fingerprint computed for every failure — `fingerprintFailure()`,
      stamped on `RunStep.failureFingerprint` at every FAILED-write site
      (UI/API/Shell/SCRIPT runs)
- [x] Run detail groups failures: "N distinct problems across M failed
      steps" — computed client-side in `RunDetailPage.tsx` from
      already-loaded step data, no new endpoint needed
- [x] Cross-run view: `GET projects/:projectId/runs/failure-fingerprints/:fingerprint`
      returns count + first-seen, live-verified against a real repeated
      failure (`count: 2`, correct `firstSeenAt`)

---

## 3.3 — Defect rules: regex → automatic categorisation `[~]` M

Core matching is implemented: rules can combine message/stack regex, step type
and triage category; matches are persisted and resolve the run step as a known
defect. A separate mute resolution requires a reason. External ticket lifecycle
sync and a dedicated defect-management UI are still pending.

**The single highest-leverage feature identified in the entire market survey**,
taken from Allure TestOps — which is our closest conceptual competitor and is
shipping no AI at all.

### The mechanic

A **defect** is a first-class record that carries **automation rules — regular
expressions matched against the error message and/or stack trace**. Once created,
the rules are applied automatically to every failure in every subsequent run.

The crucial design detail is the distinction Allure draws:

| | Asserts a root cause? | Suppresses noise? | Counts as "resolved"? |
|---|---|---|---|
| **Defect** | Yes — "this failure is caused by X" | Yes | **Yes** |
| **Mute** | No — "ignore this, no claim made" | Yes | **Yes** |

Both count as resolving a failure, so **triage state is always explicit rather
than implied**. A failure is either: unresolved (needs a human), attached to a
defect (cause known), or muted (deliberately ignored). No silent middle ground.

### Why we can go further than Allure

Allure matches on message and stack trace. We have **richer signal**: error class,
the failing selector, the step type, the assertion's expected-vs-actual, and the
full trace. So rules can match on structured fields, not just text:

```prisma
model Defect {
  id          String   @id @default(uuid())
  projectId   String
  title       String
  description String?
  status      DefectStatus   // OPEN | RESOLVED | CLOSED
  // Matching rules — applied to every new failure
  messagePattern    String?   // regex
  stackPattern      String?   // regex
  stepTypeIn        StepType[]  @default([])
  category          TestFailureCategory?
  // Link out
  issueId     String?         // our Issue
  ticketLinkId String?        // external ClickUp/Jira
  createdAt   DateTime @default(now())
  @@index([projectId, status])
}

model DefectMatch {
  id        String @id @default(uuid())
  defectId  String
  testRunId String
  runStepId String?
  matchedAt DateTime @default(now())
  @@unique([defectId, testRunId, runStepId])
}
```

### Lifecycle sync
Link a defect to a ClickUp ticket and sync bidirectionally — **closing the
external task auto-closes the defect**. `TicketLink` now supports defect scope;
`DEFECT_STATUS` mappings control normal close/reopen transitions, while a
terminal ClickUp status always closes the linked defect. Jira remains deferred.

### Why it matters
This turns repeated triage into a **reusable asset**. The first time someone
diagnoses "this is the flaky payment gateway sandbox", they write a rule; every
future occurrence is categorised automatically, forever. Almost nobody has it.

### Acceptance
- [x] Creating a defect from a failure can seed the source test and resolve it
- [x] New failures matching a rule are auto-attached
- [x] Mute is distinct from defect, and both mark the failure resolved
- [x] Closing the linked ClickUp ticket closes the defect
- [x] Run detail shows known-defect, muted and unresolved failure counts

---

## 3.4 — Triage buckets `[x]` S — done

Layer BrowserStack's categorisation on top of fingerprinting — *Product bug /
Automation issue / Environment issue*. It is arguably the highest-perceived-value
feature on the commercial list, and it is a **lookup table**.

```ts
/**
 * First-pass triage. Deliberately heuristic and deliberately conservative — it
 * proposes a bucket, it does not decide one. Anything unmatched stays
 * unclassified rather than being guessed into a bucket, because a wrong
 * confident label is worse than no label.
 */
const triage = (f: Failure): TriageBucket | null => {
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|502|503|504|net::ERR/.test(f.message))
    return 'ENVIRONMENT';
  if (/strict mode violation|no element|not found|Timeout.*waiting for locator/.test(f.message))
    return 'AUTOMATION';
  if (f.stepType?.startsWith('ASSERT_'))
    return 'PRODUCT';
  return null;
};
```

> **Deviation:** the `Timeout.*waiting for locator` pattern above looks
> right but doesn't match Playwright's actual multi-line timeout message
> (`.` doesn't cross `\n`) — found live, fixed to `Timeout[\s\S]*waiting for
> locator` in the implementation. See status note at the top of this doc.

**Feed this from the manual corpus rather than inventing it** — we already have
13 human-assigned `TestFailureCategory` values on every manual failure, plus
`takeoverReason`. That is a labelled training set for exactly this problem, and it
is the bridge into [Phase 6](08-PHASE-6-MOAT.md).

### Acceptance
- [x] Every failure gets a proposed bucket or explicit `null` —
      `triageFailure()`, stamped on `RunStep.triageBucket` at every
      FAILED-write site; live-verified (`AUTOMATION` on a real selector
      timeout after the regex fix above)
- [~] Users can correct it, and corrections are stored — schema exists
      (`RunStep.triageBucketOverridden`) but **no UI/endpoint to actually
      make the correction was built**; the column freezes a future
      human correction but nothing writes to it yet
- [~] Analytics can slice by bucket — badge shown inline per failed step in
      `RunDetailPage`; no dedicated analytics/aggregate view by bucket yet

---

## 3.5 — Flake scoring, published and tunable `[x]` M — done

### Current state
One function: `runs.service.ts:262-289` — last 100 canonical runs per test,
flagged if pass rate lands in 20–80 %. Fixed, opaque, not tunable, and **nothing
acts on it**.

### Target

Copy **Allure's determinism** and **Testomat's configurability**, and *publish the
algorithm*. Opaque scoring draws "why is this flagged?" complaints at both
PractiTest and Qase.

**Primary rule (Allure's, deterministic):** flagged when **≥3 status transitions
occur within the 10 most recent executions**, surfacing from the 6th result.

**Plus independent monitors (Trunk's decomposition)** — three separate signals,
not one score, because a single number hides *why*:

| Monitor | Default | Rationale |
|---|---|---|
| **Pass-on-retry** | **on** | Highest precision, near-zero false positives. Uses `attemptsToPass` from [2.3](04-PHASE-2-HEALING.md). |
| **Transition count** | on | Allure's ≥3-in-10 rule |
| **Failure rate** | off | >X % over N days, per-project |

Status priority **Broken > Flaky > Healthy**. A test stays flagged until *every*
monitor that flagged it independently clears.

**Branch-aware**: failures on a feature branch during development should not
weigh the same as failures on the main line.

Trunk publishing **no default thresholds** is the tell — ship configurable
monitors, not a magic constant.

### Acceptance
- [x] Algorithm documented in-product, visible from the flaky badge —
      `RunsPage.tsx` flaky panel shows monitor chips ("retry"/"flip"/"rate")
      per flagged test, driven by the returned `flaggedMonitors` array
- [x] Thresholds configurable per project — `Project.flakeConfig` JSON
      (`passOnRetry`, `transitionCount`, `failureRate`,
      `failureRateThreshold`, `failureRateWindowDays`)
- [x] Three monitors independently toggleable — same `flakeConfig`; each
      unit-tested individually and in combination (`runs.service.spec.ts`)
- [x] `attemptsToPass` feeds pass-on-retry detection — from
      [2.3](04-PHASE-2-HEALING.md)'s `RunStep.attemptsToPass`

**Deviation:** branch-aware weighting (see status note at top) not
implemented — no commit/branch attribution exists yet ([3.7](#37--commit-attribution),
deferred).

---

## 3.6 — Quarantine with automatic exit `[x]` M — done

Implemented with a conservative, observable policy: at least three pass/fail
transitions across six automated results quarantines a test; three consecutive
passes release it. Quarantined tests keep running and collecting evidence but
are excluded from retry, fail-fast and feature failure counts. The project owner
receives a notification on quarantine and release. Dashboard aggregation is
still pending.

Detection without action is what we have today. Add the loop, copying Atlassian's
Flakinator lifecycle:

```
score over threshold
  → QUARANTINED: test still executes, but does not fail the build
  → ownership routed (assign to the feature's developerId, notify)
  → keeps gathering signal on every run
  → healthy for N consecutive runs → AUTO-RELEASE
```

**The auto-exit half is what stops quarantine becoming a graveyard, and it is the
half most teams skip.**

```prisma
model TestDefinition {
  // …
  quarantineStatus   QuarantineStatus @default(ACTIVE)  // ACTIVE | QUARANTINED
  quarantinedAt      DateTime?
  quarantineReason   String?
  healthyRunsSince   Int @default(0)
}
```

We already have the `FLAKY_TEST_FLAGGED` notification type — wire it up.

### Acceptance
- [x] Quarantined tests run but do not gate
- [x] Ownership notification fires on quarantine
- [x] Auto-release after N healthy runs, with notification
- [x] Quarantined count visible on the project dashboard

---

## 3.7 — Commit attribution `[x]` M

Run triggers accept and persist `commitSha`/`branch`. Run detail finds the
previous green revision for the same test and branch and links to the configured
repository compare URL when available.

Key every run to a commit SHA, then for each test find the first run where its
fingerprint flipped pass→fail, and attribute to the commit range between
last-green and first-red.

With [3.2](#32--failure-fingerprinting-and-clustering) in place this is a window
function. We already have `ProjectRepo` and git credentials; the missing piece is
recording the SHA on the run.

```prisma
model TestRun {
  commitSha    String?
  branch       String?
  // …
}
```

Populate from the CI trigger payload and from `FeatureRun.trigger === 'ci'`.

### Acceptance
- [x] Runs carry commit SHA and branch when supplied by CI
- [x] Failure detail shows the current revision and last green run
- [x] Link out to the diff when a project repository is configured

---

## 3.8 — Capture console and network for UI runs `[~]` S

Implemented bounded, scrubbed console/page-error/network-failure/HTTP-4xx/5xx
capture for UI and script browser runs. The worker stores separate `CONSOLE_LOG`
and `NETWORK_LOG` JSON artifacts and run detail exposes searchable panels.
The run detail selects the most relevant in-window diagnostic for each failed
step using severity, message overlap and proximity to the failure.

### The gap
There is **no `page.on('console')`, `page.on('pageerror')`, or
`page.on('requestfailed')` anywhere** in the worker (verified by grep). The only
console capture is the SCRIPT sandbox's own log shim — which captures *your
script's* logs, not the page's.

The data exists inside the trace, but it is opaque unless someone opens
`trace.zip`, and it is not searchable or queryable.

### Implementation
```ts
// browser.session.ts — capture page diagnostics as first-class artifacts, not
// only inside the trace. A JS error immediately preceding a failure is usually
// the actual answer, and today it is invisible unless someone downloads a zip.
page.on('console', m => this.consoleLog.push({ type: m.type(), text: m.text(), at: Date.now() }));
page.on('pageerror', e => this.consoleLog.push({ type: 'pageerror', text: e.message, at: Date.now() }));
page.on('requestfailed', r => this.networkLog.push({ url: r.url(), failure: r.failure()?.errorText, at: Date.now() }));
page.on('response', r => { if (r.status() >= 400) this.networkLog.push({ url: r.url(), status: r.status(), at: Date.now() }); });
```

Upload as `CONSOLE_LOG` / `NETWORK_LOG` artifacts. Surface in run detail as a
searchable panel, and **feed into fingerprinting** — BrowserStack's RCA works by
surfacing the JS error or 500 response immediately preceding the failure, and this
is exactly the data needed for that.

Note `ArtifactType.HAR` already exists in the schema and is dead — either
implement `recordHar` or remove the enum value.

### Acceptance
- [x] Console and network logs captured for UI runs
- [x] Searchable panel in run detail
- [x] The most relevant in-window browser error or failed request is surfaced automatically for each failed step

---

## Phase 3 exit criteria

- [x] Traces open in-app
- [x] Failures are fingerprinted, clustered, and bucketed
- [x] Defect rules auto-categorise recurring failures; mute is distinct; ClickUp ticket lifecycle sync is live (Jira deferred)
- [x] Flake algorithm is published, tunable and **acted upon** through quarantine
- [x] Quarantine has an automatic exit
- [x] Console/network captured and searchable
- [ ] Fingerprint effectiveness **measured on our own corpus** before it is
      marketed (per arXiv 2401.15788) — not yet measured; too little live
      data on this branch to draw a conclusion, revisit once fingerprinting
      has run against real failure volume
