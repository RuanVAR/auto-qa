# Market comparison & what to adopt — July 2026

Companion to `PLATFORM_AUDIT_2026-07.md`. Where that document says what we have,
this one says what the market has and what is worth taking.

**Verification note.** Pricing and feature claims below were checked against live
vendor pages in July 2026 except where marked. Two things invalidate older
knowledge: LambdaTest rebranded to **TestMu AI** (12 Jan 2026), and **Microsoft
Playwright Testing was retired** (8 Mar 2026), folded into Azure App Testing as
"Playwright Workspaces". Items marked *(unverified)* could not be fetched and
should be re-checked before acting.

---

## 1. The competitive set

We sit in an unusual position: most products do *either* test management *or*
automation execution. We do both, plus manual testing, in one tool. The
comparison therefore splits three ways.

### A. Test management
TestRail, **Qase**, Xray, Zephyr Scale, Allure TestOps, **Testomat**, PractiTest.

Qase and Testomat are the two modern competitors and were verified directly
(July 2026). Pricing benchmark: **Qase $24–30/user/mo** (Startup/Business,
Enterprise custom, 3–5 seat minimums); **Testomat $27–30/user/mo**.

**Table-stakes features we lack.** These are not differentiators — they are the
things a buyer will refuse to switch without, and both competitors have them:

| Capability | Qase | Testomat | Us |
|---|---|---|---|
| **Shared/reusable steps** | Project + workspace-level, edits propagate instantly; Q1 2026 added folder hierarchies, nested steps, bulk local→global promotion | "Snippets" in a Steps Database, propagating, lockable | ❌ every test's steps are a private JSON blob |
| **Parameterised / data-driven** | Single params (full Cartesian product) + param *groups* (one row = one meaningful combination); workspace-level shared params; auto-creates a run instance per combination | Parameter table with `{{var}}` / `${Param}` substitution | ❌ env variables only |
| **Version history with diff + restore** | ⚠️ weak — changelog inside review only; no general compare/restore found | **Strong** — Git-like, per-change timestamp+user, "Compare with Current" side-by-side diff, "Restore to Previous Version", plus project **branches** (Enterprise) | ⚠️ partial — `TestDefinitionVersion`, max 5 snapshots, no diff UI |
| **Review / approval workflow** | **Strong** — explicitly PR-modelled: send-to-review, N required approvals, request-changes, suggest-edits, merge/decline, mandatory mode removes Save entirely (Business tier) | ❌ none found | ❌ `isAiDraft` exists but nothing gates promotion |
| **Requirements traceability** | Jira/GitLab/GitHub only (no Azure DevOps, Linear, Asana); reports uncovered requirements; **snapshots are versioned so coverage can be diffed across releases** | Jira story ↔ case/suite links, coverage page inside Jira | ❌ AI-generated `mappedAcceptanceCriteria` in a JSON blob |
| **Test plans / configuration matrix** | Plan = reusable template, many runs per plan; **Configurations** produce a cross-product, each combination getting its own result set; Environments + Milestones separate | Plans, RunGroups | ❌ no suite/plan/cycle concept at all |
| **Flaky detection** | Stability Score A+→F ⚠️*(thresholds unverified)* | **Configurable min/max success-rate thresholds over last 100 runs** — tunable, transparent | ⚠️ fixed 20–80% band over last 100, not tunable, nothing acts on it |

**Where we already win, and should say so:**

- **BYO AI model.** Testomat gates custom providers (OpenAI/Anthropic/Azure/Groq)
  behind Enterprise; **Qase has no BYO option at all**, and meters AI credits that
  *do not roll over* at $0.40/credit overage. We ship BYOK across six providers
  with per-org spend caps, monthly budget enforcement and a full cost ledger. That
  is a straightforwardly better commercial position.
- **Manual + automated in one tool.** Neither competitor has anything close to our
  manual testing player (evidence capture, annotation, narrated recording,
  structured failure categories, takeover tracking). Both are management layers
  that *receive* automated results.
- **MCP.** Both ship MCP servers on their free tier — Qase's is larger than ours
  (83 tools vs our 22), Testomat's ships faster (28 releases vs 9). We are
  competitive but no longer novel here; **MCP is now table stakes in this
  category**, which is worth knowing before treating it as a differentiator.

**One competitive note worth internalising:** Testomat's marketing claims two-way
code sync, auto-PRs, and two-way Jira sync. Their own docs contradict all three —
*"synchronization is one-directional, from code to Testomat.io only"*, and the
Jira plugin is documented as read-only. Their comparison page also claims Qase has
"only a few AI-driven features in early beta", which is flatly false. The lesson
is that this segment's marketing is unusually unreliable, and honest, verifiable
claims are themselves a differentiator.

### B. AI / low-code automation
mabl *(unverified — all doc URLs 404'd)*, Testim (Tricentis), Testsigma,
Functionize, Momentic, Katalon, Virtuoso, Autify, Reflect, QA Wolf.

This is where "self-healing" is sold as the moat.

### C. Infrastructure, visual and orchestration
BrowserStack, Sauce Labs, TestMu AI (ex-LambdaTest); Applitools, Percy,
Chromatic, Argos, Lost Pixel; Cypress Cloud, Currents.dev, Checkly, Datadog.

---

## 2. The three findings that matter

### 2.1 We have already built a self-healing engine and left the write path unimplemented

This is the headline. Across four independent layers, the feature is complete —
except for the ~100 lines in the worker that would populate it:

| Layer | State |
|---|---|
| Selector candidate generation + ranking (7 strategies) | **Built** — `apps/recorder-extension/content.js:226-312` |
| `fallbackSelectors[]` persisted per step | **Built** |
| `SelectorHeal` model (`originalSelector`, `healedSelector`, `confidence`, `source`) | **Built** — `schema.prisma:1309` |
| API loads heals into the run detail response | **Built** — `runs.service.ts:94` |
| Dashboard "Heals Today" tile | **Built, hardcoded to `0`** — `DashboardPage.tsx:823` |
| `aiDescription` per step, labelled "helps self-healing" | **Built, never read by the worker** |
| **Worker writes a heal row** | **Missing** |

The recorder already ranks `testattr → role → label → placeholder → text → id →
css` and emits fallbacks. That candidate-generation-and-ranking logic is what
Testim and Testsigma market as their core differentiator. We run it once, at
record time, in a Chrome extension — instead of at failure time, in the worker.

### 2.2 The expensive-looking features in this market are mostly SQL over run history

Flake detection, failure grouping, commit attribution, duration-balanced
sharding, test prioritisation — the things Cypress paywalls at $267/mo and
Datadog bills per committer — are queries over well-structured execution
history. We have 73 models of unusually well-structured execution history and
almost none of these queries.

### 2.3 The one genuinely hard thing is already free

DOM time-travel debugging is what BrowserStack and Sauce Labs *cannot* sell at
any price — their offering is video plus a command log, which is not the same
thing. The only products with real time-travel are Cypress Test Replay and the
**Playwright trace viewer**, which is Apache 2.0, a static React app, and
embeddable.

We already record traces with `screenshots: true, snapshots: true`
(`run.executor.ts:498,718`) and store them as `TRACE` artifacts. The UI offers
download only (`RunDetailPage.tsx:401-412`). Hosting the viewer and pointing an
iframe at a presigned URL is roughly a day of work for the single most
differentiated debugging experience in the category.

Two hard requirements: the viewer must be served over http(s) (not `file://`),
and the artifact bucket needs CORS for the viewer's origin.

---

## 3. Self-healing: how the market actually does it

No major vendor publishes its ranking function. All describe the same shape —
capture many attributes, score candidates, apply a confidence threshold.

**Testim** *(verified, Mar 2025)* is the most concrete and the most worth
copying. It scans the whole page so scoring is page-relative rather than
element-isolated; captures an ancestor chain rather than a single node; exposes
per-attribute weights as a star rating; and runs an auto-improve loop that
rewrites locators after execution — but **only when validation passes**. That
validation gate is the most stealable detail in the category.

**Testsigma** *(verified, Dec 2025)* is more primitive — ID/Name/XPath/CSS, no
role/ARIA emphasis — but usefully offers healing either in real time *or* queued
for approval, and tracks how often each element churns. It admits the failure
mode outright: "over-healing risk: AI might occasionally select the wrong
element."

**Functionize** *(verified, Dec 2025)* claims deep learning, computer vision and
"hundreds of attributes" with zero algorithmic substance. Treat as marketing.

**Momentic** *(verified, Nov 2025)* uses intent-based locators — steps are
natural language, resolved to elements at runtime via visual cues, accessibility
data and DOM position — and routes proposed changes to human review. Their
warnings are the best critical content in the segment, and they are
self-directed: *"If healing logic is too permissive, it may mask real functional
regressions"* and *"bad similarity thresholds can create more false positives
than they fix."*

**The synthesis.** Two architectures exist: a deterministic ladder with
statistical ranking (cheap, fast, dies on structural refactors), and intent/LLM
resolution (survives refactors, costly, non-deterministic, over-heals). **The
unshipped design is a hybrid where the LLM tier runs only on deterministic
failure and writes its result back down into the deterministic tier.** See §6.

---

## 4. Flake handling: the reference implementation

**Atlassian's "Flakinator"** *(verified, Dec 2025)* — 350M test executions/day,
22,000 builds recovered, 7,000 flaky tests identified:

- **Detection by circuit-broken retry** — retry until the first flip signal
  (pass-after-fail), then stop. **81% detection rate**, minimal wasted compute.
- **Bayesian flakiness score in [0,1]** over a moving window, fed by four signal
  processors: duration variability, environment consistency, result patterns,
  retry frequency.
- **Quarantine lifecycle**: auto-detect → Jira ticket auto-filed to the owning
  team with a due date → quarantined tests keep gathering signal → **auto-release
  once healthy for a configured period.** The auto-exit half is what stops
  quarantine becoming a graveyard, and it is the half most teams skip.

**Trunk.io** decomposes into three independent monitors rather than one score —
pass-on-retry (default on), failure rate, failure count — with status priority
`Broken > Flaky > Healthy`, and detection that is **branch-aware**. Notably they
publish *no default thresholds*, which is a tell that no universal constant
exists: ship configurable monitors, not a magic number.

**Datadog Early Flake Detection**: new tests retried up to 10×; tests inactive
>14 days re-classified as new; tests running >5 min excluded; flaky if *any*
attempt fails. Claims to catch up to 75% pre-merge.

**Worth knowing** — *"Just-in-Time Flaky Test Detection via Abstracted Failure
Symptom Matching"* (arXiv 2310.06298, SAP HANA, 6 months production CI) matches
normalised failure symptoms against historical known-flaky failures to classify
flakiness **without rerunning**: ≥96% precision, ~58% machine time saved. But
*"230,439 Test Failures Later"* (arXiv 2401.15788) found de-duplication
effectiveness varies enormously by project — 100% specificity in some, useless in
others. **Validate on our own corpus before promising accuracy.**

---

## 5. The honest limits of AI authoring

**Slack Engineering** *(verified, Jun 2026)*, Claude Sonnet 4.5 / Opus 4.6:

| Approach | Failure rate | Speed |
|---|---|---|
| Agent + Playwright MCP | 0–12% | 5–8 min |
| Agent + Playwright CLI | 12–20% | 9–11 min |
| **AI-generated Playwright tests** | **8% simple / 48% complex** | ~3 min |

- **Cost: $15–30 per agent-driven execution**, dominated by token retransmission.
- **Only ~20% of runs followed the same action sequence**, even reaching identical
  outcomes.
- Their conclusion: agents suit exploratory work and debugging, and are *"better
  suited for targeted debugging than for high-frequency CI execution."*

**The 48% complex-flow failure rate is the most important number here.** It is
the empirical refutation of "point AI at your app and get a suite." Generation
must execute-and-verify as it goes.

Which is exactly what **Playwright Test Agents** (free) do: a **Planner** that
explores from a seed test and emits a Markdown plan, a **Generator** that
verifies selectors and assertions live while performing the scenario, and a
**Healer** that replays failures, proposes patches, re-runs until green — and
**skips the test if the functionality appears genuinely broken.** That last
clause is the over-healing guard the commercial vendors lack.

---

## 5b. The skeptics — and why they endorse this design

Practitioner sentiment (Hacker News, 2025–2026) is worth reading before building
anything AI-shaped, because the criticism is sharper than the marketing.

**The strongest single data point**: a developer ran mutation testing on
AI-generated tests and found one that passed *even when the production method
returned an empty string* — "high coverage, confident test names, zero actual
verification" (marshalhq, Jun 2026). Related complaints: generated tests are
tautologies that never fail; they validate syntax, not behaviour; they mock
everything and cover nothing.

**On cost and latency**: Playwright MCP measured at ~1.5M tokens / 48–52 turns /
~6 min for a single task; agent steps clocked at ~100 s each. This corroborates
Slack's $15–30/run independently.

**On non-determinism**: *"no risk-averse regulated company will use a QA agent
which could be non-deterministic"* — the commenter would rather have the final
set of Playwright steps than hope the model re-picks the same actions.

**On self-healing specifically — the part that should change our design**:

- *"Those tests don't sound very useful to have then"* — on suites that rewrite
  themselves.
- The author of a competing tool deliberately made it **refuse to heal failing
  assertions**, because auto-greening them "is exactly how other self-healing
  tools mask regressions."
- Another gates healed selectors at **60% confidence** specifically to avoid
  silent false passes, and notes the hardest problem is telling a flaky test from
  a real product race condition.

**Design consequences we should adopt:**

1. **Heal selectors. Never heal assertions.** A selector that drifted is an
   authoring artefact; an assertion that fails is the product talking. This is a
   hard line, and it is the difference between a trustworthy healer and a
   regression-masking one. **Independently confirmed**: Katalon auto-excludes its
   `Verify` and `Wait` keywords from healing *by design*.
2. **Confidence floor.** Below a threshold, fail the step and flag it rather than
   healing. Our `SelectorHeal.confidence` field already exists for this.
3. **A healed pass is not a pass** (item 2 in the plan) — non-negotiable given
   the above.
4. **Gate *persistence* on run outcome, not just on the heal succeeding.** This is
   mabl's design and it is better than the naive version: apply the heal in-flight
   so the run continues, but only **write it back to the stored selector if the
   test ultimately passed** — and discard it if the test failed or it was an
   ad-hoc/preview run. Otherwise a heal recorded during an already-failing run
   poisons the selector for every future run.
5. **Reverse-validate the match.** Functionize runs an "adjoint model" that checks
   the healed match rather than trusting the original score, and emits
   *"self-heal validation failed"* instead of proceeding when uncertainty stays
   high. Our cheap equivalent: after healing, assert the resolved element matches
   the original's expected role/tag/text shape before acting on it.
6. **Expose the threshold to the user.** Testim's Very Low → Strict sensitivity
   control, with "Strict" meaning *fail rather than heal through*, is the one
   control the others lack, and it is what makes healing acceptable on a critical
   flow.

### Positioning: the word "self-healing" is damaged goods

Practitioner sentiment on r/QualityAssurance through 2025 is close to unanimous,
and it is worth reading before naming this feature:

- *"Self-healing test is bullshit."* — test failures signal actual problems
- *"Half the time, it 'fixes' itself even when there's a real bug."*
- The failure mode spelled out: a login link breaks, self-healing repairs the test
  instead, and the chain runs *"Test passed / Code merged / We're live / Customer
  found an issue / Login doesn't work."*
- *"We use a test automation platform that offers self healing… It doesn't work.
  We'll be dumping it at the next opportunity."*
- The most useful critique: if locator failure exceeds ~1%, **fix the locator
  strategy** (`data-test` attributes) rather than buying a tool to compensate.

Corroborated by a *paying mabl user who rated the product 8/10*: **"Self-heal
feature produces false positives, disabled [it in] most cases."** That is the
most credible negative signal in the set — it comes from a satisfied customer,
not a competitor.

**Balance**: this population self-selects for people who can write code, so it
under-weights the non-technical-tester case these tools actually target. But the
reputational damage is real regardless.

**Consequence for us.** Do not ship or market this as "self-healing." Ship it as
**selector drift detection with reviewable proposals** — the thing the critics
actually want, and what Katalon already does by requiring approval. The feature
is identical; the promise is honest. Our default should be *propose and flag*,
with auto-apply as an opt-in per project, and the healed-vs-clean pass
distinction (item 2) visible everywhere.

The critics' real objection is not that selectors drift — it is that healing
**hides regressions and reports a green build**. Every guard in this section
exists to make that specific accusation untrue of us, and being able to say so
with a published precision number is the differentiator.

### The gap nobody has closed

**No vendor in this market publishes a false-positive rate for healing. Not one.**
The structural failure mode is well understood — if a button moves and a different
button occupies its old position, positional attributes can score the wrong
element highest and produce a *passing test that exercised the wrong function* —
and every vendor's answer is a guardrail, never a measurement.

We already have the substrate to measure it: `SelectorHeal` rows carry
`originalSelector`, `healedSelector`, `confidence` and `source`, and can be joined
to run outcomes. Publishing an honest heal-precision number (heals that survived
human review ÷ total heals) would be a genuine first in this category, and it
costs a query.

**The validation worth noting**: when vendors were pressed on how they actually
ship reliably, their answers converged. One described a *"reliability cascade"* —
generate deterministic Playwright from the codebase first, fall back to DOM/ARIA
tree, and only fall back to vision agents last. Another's answer to
non-determinism was caching prior trajectories; another's was caching plans and
replaying them with a small model.

**In every case the production answer is: make it deterministic and get the LLM
out of the run loop.** That is precisely the architecture in item 11 below —
arrived at independently by the vendors under commercial pressure, and by the
skeptics from the opposite direction. It is the strongest signal in this
document that the recommendation is right.

---

## 5c. AI test generation — what practitioners actually report

Sentiment is remarkably stable from 2024 through July 2026: **AI test-case
generation is universally treated as a drafting aid, never a deliverable.** No
thread anywhere claims a test-management tool's built-in AI produces usable cases
without editing. The complaint is not that output is *wrong* — it is that output
is *plausible, happy-path-heavy, and shifts cost from authoring to reviewing*.

**The critique that lands squarely on our G1/G2/G3 pipeline** (Ministry of
Testing, Jul 2026):

> *"I'd spend the time testing the assumptions behind the generated cases, not
> just executing more of them. **If the same acceptance criteria shape both the
> feature and the AI-written tests, you can get a lot of clean coverage around
> the wrong behaviour.**"*

Our generation pipeline extracts acceptance criteria and generates tests from
them, then reports `mappedAcceptanceCriteria` as traceability. That is exactly
the loop described — the tests inherit the requirements' blind spots and the
traceability metric *confirms* the coverage, which makes the blind spot look
like rigour. Worth designing against explicitly.

**Other recurring reports:**

- **Non-determinism**, independently reported by several practitioners: the same
  prompt against the same requirements produces different case sets across runs.
  Serious for a regression suite or an audit trail, and nobody has addressed it.
  We already store `promptVersion` on every `AISummary`; storing temperature/seed
  and offering a deterministic mode would be a cheap, genuinely novel answer.
- **The "garbage-in" trap.** Practitioners blame thin user stories — but the
  counter-argument is sharp: fattening stories to feed the AI *destroys what
  stories are for* ("stories are meant to be brief insights"). Chasing better
  input is not a free fix.
- **The inverted workflow everyone converges on**: write test cases manually
  first, then use AI purely as a **gap-finder** against what exists. Several
  practitioners arrived at this independently, and one reported the first run
  catching a function they had forgotten — a gap-finding win, not a time win.
  **We do not have this mode.** We generate *into* an empty feature; we never
  generate *against* an existing suite to find what is missing. It is a small
  addition to the existing pipeline and it is the use case with the most
  credible practitioner support.
- The only source with before/after numbers (a QA lead's tuned multi-prompt
  framework, May 2026): authoring 8 h → 2.5 h per feature, ~3× edge cases, and
  **first-review pass rate 60% → 85%** — meaning even after six months of tuning,
  ~15% of generated cases still fail first review. Useful as an honest internal
  benchmark to beat, and a reality check on any "AI writes your tests" claim.

**Competitive openings this exposes:**

- **Xray's AI is credit-metered and you cannot bring your own model or fine-tune
  on your own data.** Their own Q&A audience pushed back on "test case explosion"
  and the review effort it creates. We already support **BYOK across six
  providers** with per-org spend caps — a straightforward advantage to state.
- **TestRail has no AI test design.** A Test Architect listed it as a *wanted
  gap* in a 2025 review.
- A competing vendor's own founder conceded publicly (2024) that current GenAI
  test generation "won't have any good results as it's just simple generation
  based on limited context." Context depth is the differentiator, and our source
  bundle (feature + linked docs + ACs + free text) is already richer than most.

**What this means for us:** keep AI generation as a *draft* surface — which we
already do correctly, since proposals never auto-save and require explicit
acceptance. Add the gap-finder mode. Do not market coverage numbers derived from
AC mapping without acknowledging the circularity above.

---

## 5d. Strategic: a better browser agent is not a moat

The 2025–26 startup cohort provides an unusually clean natural experiment.

**Octomind is dead.** Farewell letter 23 Apr 2026, product off end of May, company
wound down end of June. $4.8M seed from Cherry Ventures, three years of work.
Their stated reason: *"We didn't find the market validation we needed to keep
going… We just weren't the ones to crack it."* The post-mortem reading: squeezed
from above by QA Wolf's managed service and from below by **free first-party
Playwright tooling**. Every repo in their GitHub org is now archived.

**Propolis was acquired by Datadog** (Jan 2026) — swarms of browser agents for
goal-oriented QA, folded into an observability platform whose thesis is fusing
that testing with production traces, logs and RUM. The signal: **incumbents treat
autonomous QA as a feature of their platform, not a standalone category.**

**The quantified version of the problem** comes from a vendor's own benchmark.
Canary published QA-Bench v0 (Mar 2026) over 35 PRs across Grafana, Mattermost,
Cal.com and Superset:

| Canary | GPT-5.4 | Claude Code (Opus 4.6) | Sonnet 4.6 |
|---|---|---|---|
| **83.1** | 80.2 | 78.0 | 73.2 |

A purpose-built, VC-funded QA agent beats a general-purpose frontier model by
**2.9 points — and loses on coherence.** This is vendor-published and
self-favourable, and it *still* shows a thin margin. If your differentiator is
"our agent drives a browser better," a frontier model closes most of that gap for
free, and next quarter's model may close the rest.

**The pattern across everyone still alive**: the defensible ideas all involve a
**proprietary signal**, not a better agent.

- **Tusk** — generates from *production traffic*
- **Docket** — maintains from *real user sessions*
- **Canary** — selects flows from *code diffs*
- **Datadog/Propolis** — oracles from *production observability*
- **Antithesis** — deterministic replay via a *custom hypervisor* ($105M Series A
  led by Jane Street, Dec 2025 — the strongest technical moat in the set, and a
  different problem class entirely)

Octomind died holding only a better browser agent.

### So what is *our* proprietary signal?

**Manual testing.** It is the thing we already have that none of these companies
can get, and we have been treating it as a separate product area rather than as
fuel for automation.

Specifically, we already capture:

- **`RunStep.executedBy` / `takeoverReason` / `takeoverAt`** — we literally record
  *where a human had to take over from automation, and why*. That is a direct,
  labelled signal for what to automate next, and nobody else models it.
- **Structured failure categories** on every manual failure (13 values, shared
  with `Issue.category`) — a human-labelled corpus of *why things break*, which is
  exactly the training/heuristic input for the failure-triage buckets in item 6.
- **Manual session recordings, annotated screenshots and narrated video** — real
  user journeys through the app, captured with intent, which is what Docket pays
  for via session replay.
- **Sign-off decisions per feature × environment** — a human judgement of "this is
  ready", tied to the run evidence behind it.

The strategic reframe: we are not an automation tool competing with browser
agents. We are the place where **manual QA generates the signal that directs
automation** — a loop the pure-automation vendors structurally cannot close,
because they never see the human half.

Three concrete moves that follow, all cheap because the data already exists:

1. **"Automate this next" ranking** — order candidate tests by manual execution
   frequency × failure rate × takeover count. We have every term already.
2. **Feed `takeoverReason` and failure categories into the triage buckets** (item
   6) instead of inventing heuristics from scratch.
3. **Generate automated tests from manual sessions** — the recorded manual journey
   is a better generation input than a user story, and it sidesteps the
   circularity problem in §5c entirely, because it reflects what the app *does*
   rather than what the requirements *claim*.

---

## 6. Ranked adoption plan

Ordered by value ÷ effort. Sizes are S (hours), M (days), L (weeks).

### Tier 1 — wiring what already exists

**1. Write `SelectorHeal` rows from the existing fallback cascade — S**
When the primary fails and `fallbackSelectors[k]` resolves, write the row we
already modelled. Confidence priors tuned to *why* each strategy breaks:

```
testattr 0.99 | role+name 0.95 | label 0.90 | placeholder 0.85
text 0.70     | id 0.60        | css 0.40
```

`text` is low because copy changes constantly; `id` is low because
framework-generated ids churn; `css` is near-worthless as evidence. This turns a
dead table, a dead API include and a hardcoded dashboard tile into a working
audit trail in an afternoon.

**2. Distinguish `passed` from `passed (healed)` — S**
A heal that fires must never report as a clean pass. This is precisely the
failure mode Momentic and Testsigma both admit to. Fixing it makes us *more*
trustworthy than the incumbents on their weakest axis, for near-zero effort.

**3. Embed the Playwright trace viewer — S/M**
Traces already exist. Host the viewer's static assets, iframe with a presigned
URL. Delivers time-travel debugging the grid vendors cannot sell.

**4. Persist retry outcomes as flake signal — S**
We already retry per step and **discard the result**. A step passing on attempt 2
is a flake datapoint. Log `attempts_to_pass`. Prerequisite for everything in
Tier 2, costs almost nothing.

**5. Healer that is allowed to give up — S**
If the same step heals *n* runs in a row, stop healing and escalate — repeated
healing means the app genuinely changed. Playwright's Healer does this; most
vendors don't.

### Tier 2 — cheap analytics over existing history

**6. Failure fingerprinting and auto-grouping — S/M**
Normalise error text (strip UUIDs, timestamps, numbers, hex, ports, paths,
selector indices) → hash → cluster key. "23 tests failed" collapses to "3
distinct problems." Then layer BrowserStack's triage buckets on top — *Product
bug / Automation issue / Environment issue* — classified heuristically:
timeouts and connection resets → environment; selector-not-found → automation;
assertion mismatch → product. That categorisation is arguably the
highest-perceived-value feature on the commercial list, and it is a lookup table.

**6b. QA Wolf's de-parallelising retry ladder — S. Copy this verbatim.**
The single cleverest mechanism found in the whole survey, and it is ~20 lines:

1. Attempt 1 — all tests run concurrently
2. Attempt 2 — only the failures re-run, **in batches of five**
3. Attempt 3 — remaining failures run **serially**

Plus: *all* tests must report before any re-attempt begins. This is a targeted
attack on resource-contention and race-condition flakes specifically — if a test
only passes when it's alone, the ladder **proves** that rather than masking it,
and the attempt number at which it passed is itself a diagnosis. It also pairs
exactly with item 4 (persisting `attempts_to_pass`). Note this only becomes
meaningful once parallelism exists (item 13).

Worth knowing for calibration: QA Wolf markets "zero flakes", but that is a
*reporting* guarantee (humans reproduce every failure before it reaches you), not
an execution guarantee — and **they publish no measured flake rate anywhere**.
The same gap as the false-positive rate in §5b.

**7. Flake scoring, Flakinator-shaped — M**
Circuit-broken retry for detection; score over a moving window; three independent
monitors (Trunk's decomposition) rather than one number; branch-aware. Start with
flip-rate, upgrade the estimator later — the data model matters more.

**8. Quarantine with automatic exit — M**
Over threshold → quarantine → still executes but doesn't fail the build →
auto-release after a healthy period. We already have `FLAKY_TEST_FLAGGED`
notifications and detection; nothing acts on them.

**9. "Which commit broke this" — S/M**
Key runs to a commit SHA; find the first run where a fingerprint flipped
pass→fail; attribute to the range between last-green and first-red. With (6) in
place this is a window function.

**10. Duration-balanced sharding + fail-fast — S**
Playwright shards by *count*; Currents charges for balancing by *duration*. We
have a queue: store per-test p50 and bin-pack. ~50 lines, and it is the entire
technical basis of a paid feature. Pair with auto-cancellation (Cypress Business,
$267/mo) — kill queued jobs once a run has failed. **Note: this only matters once
parallelism exists — see Tier 3.**

### Tier 3 — real work, real differentiation

**11. `aiDescription` as the last rung, cached back down — M. This is the moat.**

> All deterministic rungs fail → capture `ariaSnapshot()` (text, cheap, no
> pixels) → send `aiDescription` + snapshot to the LLM → get a role+name →
> resolve → **write the resolved deterministic selector back into
> `fallbackSelectors[]` with `source='ai-intent'`.**

The write-back is the whole point. Slack's data says LLM-in-the-loop costs
$15–30/run and is only ~20% deterministic — unaffordable per run, entirely
affordable **once per drift event**. We pay for AI on the healing path, then
never again for that drift.

This is genuinely unshipped by the *deterministic* vendors: Testim can't recover
from structural refactors; Momentic pays the model tax every run forever.

**One vendor has independently reached the same design and named it well.**
Reflect (SmartBear) frames it as **"selectors are a cache"** — cheap syntactic
selectors on the hot path, LLM latency and cost paid only when the syntactic path
goes stale. Their ladder is four tiers: diverse cached selectors → visible text →
LLM semantic targeting → Vision AI (added May 2026). Two details worth copying
directly:

- Their LLM tier consumes a **per-step description that is auto-generated at
  record time and user-editable**, and their docs state plainly that *improving
  the description improves healing*. That is exactly what `aiDescription` is for,
  and it tells us to populate it well during generation (item 15).
- Their selector list is ordered by **specificity, narrowest first**, and the
  generator deliberately favours **diversity across attributes** — so deleting one
  class doesn't invalidate the whole set. Our recorder ranks by strategy; adding a
  diversity criterion is a small, high-value change.

That an acquired competitor converged on this independently is corroboration, not
a reason to abandon it — they have no free tier, no published price, and no local
runner, so the architecture is available to us on far better commercial terms.

Guard rails: budget per run, hard timeout, never on first failure, **never on an
assertion step** (§5b), and the promotion gate from Testim — only promote if the
healed selector resolved to **exactly one** element **and** downstream assertions
passed.

**12. Promotion/demotion loop — S/M**
After N consecutive runs where rung *k* wins, promote it to primary and demote
the old primary into the fallback array. Same validation gate as above.

**13. Parallelism — M/L**
Currently zero: tests within a feature run sequentially, chained through Redis
events, capped at 3 browsers platform-wide. This blocks (10) and is the single
biggest execution-side limitation. Requires unpinning `container_name`, splitting
the PDF worker's concurrency, and fanning out test enqueue instead of chaining.

**14. Record assertions in the recorder — M**
The recorder captures actions only; every assertion is hand-added afterwards.
This is the biggest authoring gap and the most common complaint pattern against
record-and-playback tools generally.

**15. Generate the plan, not the test — M**
Adopt Playwright's planner/generator split in our MCP server: explore →
intermediate plan → JSON steps, **with every selector verified live during
generation**. Slack's 48% is what happens without live verification. This is also
where `aiDescription` should be populated well, since (11) depends on its quality.

**16. Visual regression — L**
Use **odiff** (MIT, Zig+SIMD, 6–8× faster than pixelmatch — 1.17s vs 7.71s on a
full-page shot), not pixelmatch, which matters enormously on a 2 GB box.
Baselines in S3 keyed by `(test, step, viewport)`. Then, in order of value:
Percy's **layout-vs-content split** (two comparison modes from one capture, kills
most text flake); per-step region ignore lists; **Applitools-style diff
grouping** (extract changed-region bounding boxes, build a positional signature,
group and accept-all — no ML required, and it is what makes visual testing
survive a header redesign); and Argos's **ARIA-snapshot comparison** as a
flake-immune complement.

### Explicitly not worth doing

- **Device clouds.** BrowserStack/Sauce/TestMu solve device diversity, which we
  don't have, and their debugging is strictly worse than the trace we already
  generate.
- **ReportPortal** has the ML failure analysis we'd want, but it's a microservice
  fleet needing Elasticsearch (2 GB+ heap alone). It will not co-exist with the
  worker.
- **Self-hosting Argos** — MIT and tempting, but drags in Postgres + Redis + its
  own app server.
- **Coverage-based test impact analysis.** Doesn't map onto JSON step
  definitions; would need per-step coverage instrumentation of the app under
  test. Do prioritisation instead (order by recently-failed / flaky / touched),
  which is what Cypress charges $267/mo for.

---

## 7. Sequencing

Fix the business-ending risks in `PLATFORM_AUDIT_2026-07.md` §8 first — backups,
secrets in images, artifact retention. None of the below matters if the database
is lost.

Then:

1. **Tier 1 (items 1–5)** — roughly a week, all wiring, and it produces a
   complete, auditable self-healing and flake story out of components that
   already exist. Do this before writing a single new LLM call.
2. **Tier 2 (items 6–9)** — analytics over history we already store. This is
   where the perceived-value-per-hour is highest.
3. **Item 11** — the differentiated architecture, once the deterministic ladder
   and its audit trail are proven.
4. **Item 13 (parallelism)** whenever throughput becomes the binding constraint.
