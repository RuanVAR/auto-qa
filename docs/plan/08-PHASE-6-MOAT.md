# 08 — Phase 6: The moat

Everything in Phases 2–5 makes us competitive. **This phase makes us hard to
copy.**

**Total effort: ~6–8 weeks.** Do not start before Phases 2 and 3 are proven in
production — every item here compounds on data those phases produce.

---

## 0. The strategic argument

The 2025–26 startup cohort ran a clean natural experiment:

- **Octomind is dead.** Farewell letter 23 Apr 2026, product off end of May,
  company wound down end of June. $4.8M, three years. Their reason: *"We didn't
  find the market validation we needed to keep going."* Squeezed from above by
  QA Wolf's managed service, from below by **free first-party Playwright tooling**.
- **Propolis was acquired by Datadog** (Jan 2026) and folded into observability.
- **Canary's own benchmark** — vendor-published and self-favourable — has their
  purpose-built QA agent beating a general frontier model by **2.9 points, and
  losing on coherence.**
- **2026 funding into AI testing is down ~86 % versus 2025.**

Every company still alive has a **proprietary signal**, not a better agent:

| Company | Signal |
|---|---|
| Tusk | production traffic |
| Docket | real user sessions |
| Canary | code diffs |
| Datadog/Propolis | production observability |
| Antithesis | deterministic replay via a custom hypervisor |

**Octomind died holding only a better browser agent.** Do not build one.

### Our signal is manual testing

It is the thing we already have that no pure-automation vendor can obtain, and we
currently treat it as a separate product area rather than as fuel.

Already captured, today:

| Signal | Where | Why it matters |
|---|---|---|
| `RunStep.executedBy` / `takeoverReason` / `takeoverAt` | `schema.prisma:1302-1304` | **We literally record where a human had to take over from automation, and why.** Nobody else models this. |
| 13 structured failure categories | `TestFailureCategory`, shared with `Issue.category` | A human-labelled corpus of *why things break* |
| Annotated screenshots, narrated video, session recordings | `TestingView.tsx` | Real user journeys captured with intent — what Docket pays for via session replay |
| Sign-off decisions per feature × environment | `FeatureEnvSignoff` | Human judgement of "ready", tied to run evidence |

**The reframe: we are not an automation tool competing with browser agents. We are
where manual QA generates the signal that directs automation** — a loop the
pure-automation vendors structurally cannot close, because they never see the
human half.

---

## 6.1 — The manual-signal loop: "automate this next" `[ ]` M ⭐ start here

Rank candidate tests for automation using data we already store:

```sql
-- Which manual tests are costing the most human time and failing most often?
-- Every term already exists; nothing new needs capturing.
SELECT td.id, td.name,
       COUNT(*) FILTER (WHERE tr."runMode" = 'MANUAL')        AS manual_runs,
       COUNT(*) FILTER (WHERE tr.status    = 'FAILED')         AS failures,
       COUNT(*) FILTER (WHERE rs."executedBy" = 'HUMAN'
                          AND tr."runMode"    = 'AUTOMATED')   AS takeovers,
       AVG(tr.duration) FILTER (WHERE tr."runMode" = 'MANUAL') AS avg_manual_ms
FROM test_definitions td
JOIN test_runs tr ON tr."testDefinitionId" = td.id
LEFT JOIN run_steps rs ON rs."runId" = tr.id
WHERE tr."createdAt" > now() - interval '90 days'
GROUP BY td.id
ORDER BY (manual_runs * avg_manual_ms) DESC, failures DESC, takeovers DESC;
```

Surface as an **"Automation candidates"** panel: *"This test has been run manually
23 times in 90 days, averaging 4 minutes, and failed 6 times. Automating it saves
~92 minutes per quarter."*

**`takeoverReason` is the sharpest term** — a step where automation gave up and a
human finished is a precise, labelled statement of what the runner cannot yet do.
Aggregate those reasons and you have a prioritised engineering backlog for the
worker itself.

### Acceptance
- [ ] Ranked automation-candidate list per project, with time-saved estimate
- [ ] Takeover reasons aggregated into a "what the runner can't do" report
- [ ] One-click "generate automated test from this manual test" (feeds 6.5)

---

## 6.2 — Run from the tool, with selective execution `[ ]` L ⭐ the "one tool" proof

**Only Allure TestOps does this**, and only as a CI trigger with four strict
prerequisites. Because we own the Playwright integration end to end, we can go
further.

### The mechanic (Allure's, generalised)

1. Create the run session **first**, in the platform.
2. Dispatch to the runner (our worker, or the customer's CI) **passing the
   selected test set as an execution manifest** — Allure's `testplan.json` pattern.
3. Stream results back live into the session that already exists.

### Why it matters

This is **the single strongest argument for "manual + automated in ONE tool"
rather than two tools with a sync.** Without it, "unified" is just a shared
database. With it:

- A tester assembles a plan mixing manual and automated tests
- Hits run
- Automated tests dispatch and execute; manual tests appear in their queue
- **Both land in the same session, with the same evidence model and one sign-off**

We already have most of it: `TestRunSession` spans features, the queue dispatches,
Socket.IO streams. The missing piece is **selective execution driven by a plan**
rather than by feature membership.

### Acceptance
- [ ] A plan containing both manual and automated tests executes as one session
- [ ] Automated selection dispatched as a manifest, not by re-deriving from features
- [ ] Results stream into the pre-created session
- [ ] External CI can consume the same manifest (documented contract)

---

## 6.3 — Launch → job-run model `[ ]` M

Adopt Allure's structure: one logical **launch** containing multiple **job runs**,
so reruns, shards, retries and multi-environment matrices consolidate into a
single result the team reasons about.

Adopt the **"close the launch"** transition as the commit point that triggers
statistics processing and repository updates — it makes "is this run finished?"
explicit rather than inferred, which is exactly the ambiguity that produced
[bug 1.1](03-PHASE-1-CORRECTNESS.md).

Manual results live in the same launch without needing a job run. This maps
cleanly onto `TestRunSession` and is what makes mixed sessions coherent.

### Acceptance
- [ ] A launch groups N job runs plus manual results
- [ ] Retry ladder attempts ([4.2](06-PHASE-4-SCALE.md)) roll up into one launch
- [ ] Explicit close transition drives stats and sign-off eligibility

---

## 6.4 — Hybrid AI healing: LLM on the healing path only `[ ]` M

**The architecture the market has not shipped.** Only attempt after Phase 2's
deterministic ladder is proven in production.

```
all deterministic rungs fail
  → capture page.ariaSnapshot()        (text, cheap, no pixels)
  → send aiDescription + snapshot to the LLM
  → receive a role + accessible name
  → resolve it
  → WRITE THE RESOLVED DETERMINISTIC SELECTOR BACK into fallbackSelectors[]
     with source='ai-intent'
```

**The write-back is the entire point.** Slack measured LLM-in-the-loop at
**$15–30 per run** with only ~20 % determinism — unaffordable per run, entirely
affordable **once per drift event**. Pay for AI on the healing path, then never
again for that drift.

### Why this is defensible
- **Testim** cannot recover from structural refactors (deterministic only).
- **Momentic** pays the model tax on every run, forever.
- **Reflect** independently reached the same design and named it well —
  *"selectors are a cache"* — which is corroboration, not a reason to abandon it.
  They have no free tier, no published price and no local runner, so the
  architecture is available to us on far better commercial terms.

### Guard rails (all non-negotiable)
- Budget per run; hard timeout
- **Never on the first failure** — deterministic rungs get their chance
- **Never on an assertion step** or a negative assertion
  ([2.4](04-PHASE-2-HEALING.md))
- **Never when an earlier step resolved with low confidence** (no cascading)
- Promotion gate: resolved to **exactly one** element **and** downstream
  assertions passed
- Everything routed to the review queue by default

### `aiDescription` quality is the input
This is why [6.6](#66--ai-gap-finder-mode) and the generation work matter: Reflect
documents plainly that *improving the step description improves healing*. Populate
`aiDescription` well at authoring time and this rung gets better for free.

### Acceptance
- [ ] LLM rung fires only after all deterministic rungs fail
- [ ] Resolved selector written back as a deterministic fallback
- [ ] Second occurrence of the same drift resolves deterministically (no LLM call)
- [ ] Per-run budget enforced and observable

---

## 6.5 — Generate from manual sessions `[ ]` M

The recorded manual journey is a **better generation input than a user story**,
and it sidesteps the circularity problem entirely:

> *"If the same acceptance criteria shape both the feature and the AI-written
> tests, you can get a lot of clean coverage around the wrong behaviour."*

Generating from an actual executed session reflects what the app **does**, not
what the requirements **claim**. Nobody else can do this, because nobody else has
the manual sessions.

Inputs available per session: the ordered steps a human actually performed, the
URLs visited, the evidence captured, the failure categories assigned, and the
narration if recorded.

### Acceptance
- [ ] "Generate automated test from this session" on a completed manual run
- [ ] Generated steps carry real selectors verified against the recorded DOM
- [ ] `aiDescription` populated from the manual step's name and notes

---

## 6.6 — AI gap-finder mode `[ ]` S

The workflow practitioners independently converge on is the **inverse** of what
vendors sell: write tests manually first, then use AI purely as a **gap-finder**
against what already exists.

We generate *into* an empty feature; we never generate *against* an existing suite
to find what is missing. It is a small addition to `generation.service.ts` — pass
the existing test set as context and prompt for coverage gaps rather than for a
suite.

One practitioner reported the first run catching a function they had forgotten —
**a gap-finding win, not a time win**, which is the honest value proposition.

### Acceptance
- [ ] "Find coverage gaps" mode on a feature with existing tests
- [ ] Output framed as gaps with rationale, not as a test suite
- [ ] Existing tests passed as context and explicitly not duplicated

---

## 6.7 — Publish a heal-precision metric `[ ]` S

**No vendor in this market publishes a false-positive rate for healing. Not one.**
Every answer is a guardrail, never a measurement. Same gap on flake: QA Wolf
markets "zero flakes" and publishes no measured rate.

We have the substrate: `SelectorHeal` rows carry confidence and source, and join
to run outcomes and to the review queue.

```
heal precision = heals approved on review ÷ heals reviewed
```

Publish it in-product per project, and externally as a platform-wide figure.
Being the only vendor that measures the thing everyone else hand-waves is a
positioning asset that costs a query.

### Acceptance
- [ ] Per-project heal precision visible on the dashboard
- [ ] Broken down by confidence bucket and by source
- [ ] Documented methodology, published

---

## 6.8 — A query language, uniform everywhere `[ ]` L

Qase has QQL, Testomat TQL, Allure AQL, Xray 29 JQL functions. It has become an
expected primitive for power users — **and it is the natural interface for AI
agents.**

Learn from two documented failures:
- **Allure's dashboard widgets get a reduced query surface** (`now()` and
  `currentUser()` unavailable) — an inconsistency users hit constantly.
- **Xray inherits Jira's 7-day result cache and 1,000-issue cap.**

Make ours **uniform across UI, REST API, dashboards and MCP**, and uncapped. Then
**embed the query-language reference directly in the MCP tool descriptions** so
agents write valid queries first try — Testomat's touch, and a good one.

---

## 6.9 — Manual tests as markdown in the repo `[ ]` M

Testomat's `check-tests push` defaults to `**/*.test.md`: manual cases versioned in
Git, reviewed in PRs, diffed by normal tools, **edited by coding agents**.

Natural fit here — our module→feature hierarchy maps directly onto a directory
structure, and it makes the MCP server dramatically more useful: an agent can
write a manual test as a file and push it.

Pair with **test IDs written back into source** (`--update-ids`) and a CI gate
(`--require-ids` fails the build when tests lack IDs), plus the two status labels
that make it valuable: **Detached** (in the platform, gone from source) and **Out
of Sync** (content diverged). Fix the bug their users complain about — multi-tab
usage producing spurious Out-of-Sync.

Since we own the Playwright reporter, do this via **annotations** rather than
title-string mangling.

---

## 6.10 — Agent skills as a distribution channel `[ ]` M

Testomat publishes eight installable skills (`npx skills add testomatio/skills`).
Skills in Claude Code and Cursor put the product **inside the developer's editor**.

The one to copy first is **`qa-test-code-coverage`**: maps manual and automated
tests to source files, emits a coverage manifest, and **runs only the tests
affected by a diff.** For a Playwright-native tool with a repo integration
already in place, that is a killer capability rather than a convenience.

---

## Phase 6 exit criteria

- [ ] The manual → automation loop is closed and visible in-product
- [ ] A single session can execute manual and automated tests together, from a plan
- [ ] LLM healing fires only on deterministic failure and caches its result down
- [ ] Heal precision is measured and published
- [ ] Generation can run in gap-finder mode and from manual sessions
- [ ] The positioning claim — *"the only platform where manual QA directs
      automation"* — is demonstrably true in the product, not just in the copy
