# 01 — Decision matrix

Every candidate piece of work, scored and sequenced, with the reasoning stated so
it can be argued with rather than guessed at.

---

## 1. Scoring model

Each item scores on four axes. **Priority = (Risk + Value + Confidence) ÷ Effort.**

| Axis | Scale | Meaning |
|---|---|---|
| **Risk removed** | 0–10 | What breaks, and how badly, if we don't do this |
| **User value** | 0–10 | Perceived value to a buyer or an existing user |
| **Confidence** | 0–10 | How sure are we this is the right thing — is it verified, or a guess? |
| **Effort** | S=1, M=3, L=8 | Hours / days / weeks |

Two overrides sit above the score:

1. **Survival overrides everything.** An item that prevents unrecoverable data loss
   or credential compromise goes first regardless of score.
2. **Wiring beats building.** Where a feature is already 60–90 % built and only
   needs connecting, it outranks a higher-scoring greenfield item, because the
   confidence is far higher and the effort estimate far more reliable.

---

## 2. The full backlog, scored

### Phase 0 — Survival *(overrides all scoring)*

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 0.1 | Postgres backups + tested restore | 10 | 3 | 10 | S | **23.0** | [P0](02-PHASE-0-SURVIVAL.md) |
| 0.2 | `.env*` out of Docker images + rotate | 10 | 2 | 10 | S | **22.0** | [P0](02-PHASE-0-SURVIVAL.md) |
| 0.3 | Artifact retention + disk alert | 9 | 3 | 10 | S | **22.0** | [P0](02-PHASE-0-SURVIVAL.md) |
| 0.4 | Error tracking + uptime monitor | 8 | 4 | 10 | S | **22.0** | [P0](02-PHASE-0-SURVIVAL.md) |
| 0.5 | Resource limits + log rotation | 7 | 2 | 9 | S | **18.0** | [P0](02-PHASE-0-SURVIVAL.md) |
| 0.6 | CI runs `ci:check`, not bare lint | 7 | 3 | 10 | S | **20.0** | [P0](02-PHASE-0-SURVIVAL.md) |

### Phase 1 — Correctness

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 1.1 | `TIMED_OUT` wedges feature runs | 9 | 7 | 10 | S | **26.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.2 | Per-step timeout UI is a no-op | 3 | 6 | 10 | S | **19.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.3 | `__authSeed` SSRF gap | 8 | 1 | 10 | S | **19.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.4 | Secrets unredacted in traces | 8 | 2 | 10 | M | **6.3** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.5 | Split PDF worker concurrency | 7 | 3 | 9 | S | **19.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.6 | Dead config (`MAX_BROWSERS_PER_WORKER`) | 4 | 2 | 10 | S | **16.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.7 | Orphan-Chromium reaper is dead | 5 | 1 | 10 | S | **16.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.8 | Dashboard lies (`Heals Today`, `Pass Rate 7d`) | 2 | 5 | 10 | S | **17.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.9 | Legacy AI prompt contradicts selector rules | 3 | 4 | 10 | S | **17.0** | [P1](03-PHASE-1-CORRECTNESS.md) |
| 1.10 | `run.executor.ts` has zero tests | 8 | 2 | 10 | M | **6.7** | [P1](03-PHASE-1-CORRECTNESS.md) |

### Phase 2 — Selector drift detection *(wiring, not building)*

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 2.1 | Write `SelectorHeal` from fallback cascade | 3 | 9 | 10 | S | **22.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.2 | `passed (healed)` status | 6 | 8 | 10 | S | **24.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.3 | Persist retry outcomes as flake signal | 2 | 7 | 10 | S | **19.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.4 | Never heal assertions + confidence floor | 8 | 6 | 10 | S | **24.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.5 | Outcome-gated persistence | 6 | 6 | 9 | S | **21.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.6 | Give-up rule after N heals | 5 | 6 | 9 | S | **20.0** | [P2](04-PHASE-2-HEALING.md) |
| 2.7 | Promotion/demotion with validation gate | 2 | 7 | 8 | M | **5.7** | [P2](04-PHASE-2-HEALING.md) |

### Phase 3 — Intelligence *(SQL over history we already store)*

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 3.1 | Embed Playwright trace viewer | 1 | 10 | 9 | S | **20.0** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.2 | Failure fingerprinting + clustering | 2 | 9 | 9 | M | **6.7** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.3 | **Defect rules (regex → auto-categorise)** | 3 | 10 | 9 | M | **7.3** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.4 | Triage buckets (product/automation/env) | 2 | 9 | 9 | S | **20.0** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.5 | Flake scoring, published + tunable | 3 | 8 | 9 | M | **6.7** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.6 | Quarantine with automatic exit | 3 | 7 | 8 | M | **6.0** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.7 | Commit attribution | 1 | 7 | 8 | M | **5.3** | [P3](05-PHASE-3-INTELLIGENCE.md) |
| 3.8 | Console + network capture for UI runs | 3 | 7 | 10 | S | **20.0** | [P3](05-PHASE-3-INTELLIGENCE.md) |

### Phase 4 — Scale

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 4.1 | Parallel test execution within a run | 5 | 9 | 9 | L | **2.9** | [P4](06-PHASE-4-SCALE.md) |
| 4.2 | De-parallelising retry ladder | 2 | 8 | 9 | S | **19.0** | [P4](06-PHASE-4-SCALE.md) |
| 4.3 | Horizontal worker scaling | 6 | 6 | 9 | M | **7.0** | [P4](06-PHASE-4-SCALE.md) |
| 4.4 | Duration-balanced sharding | 1 | 6 | 8 | S | **15.0** | [P4](06-PHASE-4-SCALE.md) |
| 4.5 | Fail-fast / auto-cancellation | 2 | 6 | 9 | S | **17.0** | [P4](06-PHASE-4-SCALE.md) |
| 4.6 | Distributed cron lock | 7 | 2 | 9 | M | **6.0** | [P4](06-PHASE-4-SCALE.md) |

### Phase 5 — Parity *(buyers refuse to switch without these)*

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 5.1 | Shared / reusable steps | 4 | 10 | 10 | M | **8.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.2 | Parameterised / data-driven tests | 4 | 10 | 10 | M | **8.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.3 | Versioning with diff + restore | 3 | 9 | 10 | M | **7.3** | [P5](07-PHASE-5-PARITY.md) |
| 5.4 | Requirement traceability matrix | 3 | 9 | 9 | M | **7.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.5 | Test plans / suites / cycles | 3 | 9 | 9 | M | **7.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.6 | Configurations (browser × OS matrix) | 2 | 7 | 9 | M | **6.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.7 | JUnit XML / Cucumber JSON import | 2 | 8 | 10 | S | **20.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.8 | Free read-only / stakeholder seats | 1 | 8 | 9 | S | **18.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.9 | Migration importers (TestRail/Xray/Qase) | 1 | 8 | 9 | M | **6.0** | [P5](07-PHASE-5-PARITY.md) |
| 5.10 | Review workflow (PR-style) | 2 | 8 | 10 | M | **6.7** | [P5](07-PHASE-5-PARITY.md) |
| 5.11 | Recorder: assertion capture | 2 | 9 | 9 | M | **6.7** | [P5](07-PHASE-5-PARITY.md) |

### Phase 6 — Moat *(defensible; nobody else can copy easily)*

| # | Item | Risk | Value | Conf | Effort | Score | Doc |
|---|---|---|---|---|---|---|---|
| 6.1 | **Manual-signal loop ("automate this next")** | 2 | 10 | 9 | M | **7.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.2 | **Run-from-tool with selective execution** | 2 | 10 | 8 | L | **2.5** | [P6](08-PHASE-6-MOAT.md) |
| 6.3 | Launch → job-run model | 2 | 8 | 8 | M | **6.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.4 | AI hybrid healing (LLM → cached selector) | 1 | 9 | 8 | M | **6.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.5 | Generate from manual sessions | 1 | 9 | 8 | M | **6.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.6 | AI gap-finder mode | 1 | 8 | 9 | S | **18.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.7 | Publish heal-precision metric | 1 | 8 | 9 | S | **18.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.8 | Query language (uniform across UI/API/MCP) | 1 | 8 | 8 | L | **2.1** | [P6](08-PHASE-6-MOAT.md) |
| 6.9 | Manual tests as markdown in repo | 1 | 7 | 7 | M | **5.0** | [P6](08-PHASE-6-MOAT.md) |
| 6.10 | Agent skills as distribution | 1 | 7 | 7 | M | **5.0** | [P6](08-PHASE-6-MOAT.md) |

---

## 3. Sequencing

Score alone would put some Phase 5 items ahead of Phase 3. It doesn't, for three
reasons:

1. **Phase 3 items are queries over data we already have.** Phase 5 items require
   new schema, new UI, and migration of existing data. Confidence in the effort
   estimate is much higher for Phase 3, so it delivers sooner and more reliably.
2. **Phase 2 → 3 → 6 is one coherent arc.** Healing writes the data (2), the
   intelligence layer reads it (3), the moat compounds it (6). Doing 5 first
   would stall that arc for weeks.
3. **Phase 5 is a sales gate, not a user gate.** Existing users don't churn
   without shared steps; *prospects* refuse to evaluate without them. So Phase 5
   should be scheduled against a sales need, not a technical one.

```
P0 Survival ──▶ P1 Correctness ──▶ P2 Healing ──▶ P3 Intelligence ──┬─▶ P6 Moat
   (days)          (days)            (~1 week)      (~2 weeks)      │
                                                                     └─▶ P4 Scale
                                                     P5 Parity ──────────┘
                                                (schedule against sales)
```

**Hard dependencies:**
- 3.5, 3.6 (flake scoring, quarantine) **require** 2.3 (retry outcomes persisted)
- 3.3 (defect rules) **requires** 3.2 (fingerprinting)
- 4.2, 4.4, 4.5 (retry ladder, sharding, fail-fast) **require** 4.1 (parallelism)
- 6.1 (manual-signal loop) **requires** 3.4 (triage buckets) to be useful
- 6.4 (AI healing) **requires** 2.1–2.6 proven in production first
- 6.7 (heal precision) **requires** 2.1 plus a human review queue

---

## 4. Decisions taken, with reasoning

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| **Name of the healing feature** | "Selector drift detection" with reviewable proposals | "Self-healing" | Practitioners actively distrust the term — *"self-healing test is bullshit"*, *"half the time it 'fixes' itself even when there's a real bug"*. The feature is identical; the promise is honest. |
| **Default heal behaviour** | Propose + flag; auto-apply opt-in per project | Auto-apply by default | Rainforest auto-applies and it is their most-criticised behaviour. Katalon requires approval and is structurally immune to silent heals. |
| **Assertions** | **Never healed** | Heal everything | Katalon excludes `Verify`/`Wait` by design; a competing tool's author deliberately refuses to heal assertions because auto-greening *"is exactly how other self-healing tools mask regressions"*. |
| **Heal persistence** | Only when the test ultimately **passes**, and never on preview runs | Persist on heal success | mabl's design. A heal recorded during an already-failing run poisons the selector for every future run. |
| **AI in the run loop** | LLM only on deterministic failure, result cached back to a deterministic selector | LLM resolution every run | Slack measured $15–30/run and ~20 % determinism. Reflect calls it *"selectors are a cache"*. Every vendor under commercial pressure converges here. |
| **Visual regression engine** | `odiff` (MIT) | `pixelmatch` | 6–8× faster (1.17 s vs 7.71 s full-page), SIMD-parallel. Decisive on a 2 GB box. |
| **Trace viewer** | Embed Playwright's own (Apache 2.0) | Build a custom one | It is the only real DOM time-travel in the market, it is free, and **we already generate the traces**. |
| **Test impact analysis** | Prioritisation (order by recently-failed / flaky / touched) | Coverage-based TIA | Real TIA needs per-step coverage instrumentation of the app under test; doesn't map to JSON step definitions. Cypress charges $267/mo for the prioritisation version. |
| **Parameterised test display** | **One** test case with collected parameters | N generated cases | Allure's rule. Exploding them pollutes the repository, and most competitors get this wrong. |
| **Versioning tier** | **Base tier** | Enterprise-gated | TestRail and Xray charge ~2× for it, Qase appears not to have it, Testomat gates it at Enterprise. Shipping it in base is a clean wedge and the most-complained-about gate in the market. |
| **AI billing** | Bundled, BYOK, per-org spend cap | Credit metering | Qase charges $0.40/credit with no rollover and draws consistent complaints; PractiTest markets "no per-action credit charges" as a differentiator. We already have BYOK across six providers. |
| **Read-only seats** | Free | Per-seat | Universal complaint across every tool surveyed. |
| **MCP** | Invest, but not as a differentiator | Treat as a moat | It is now table stakes — Qase ships 83 tools on their free tier to our 22. **But TestRail and Xray, the two market leaders, have no official server at all**, so it is still a wedge against *them*. |

---

## 5. Explicitly not doing

| Not doing | Why |
|---|---|
| Device cloud / real-device grid | We don't have device diversity, and their debugging is strictly worse than the trace we already generate. Buy BrowserStack if a customer demands it. |
| ReportPortal for failure analysis | Microservice fleet requiring Elasticsearch (2 GB+ heap alone). Will not co-exist with the worker. |
| Self-hosting Argos for visual | MIT and tempting, but drags in Postgres + Redis + its own app server. |
| Coverage-based test impact analysis | Needs per-step coverage instrumentation of the app under test. Doesn't map to our model. |
| Building a proprietary visual-diff engine | Applitools-class Visual AI is years of work and the weakest differentiation available to us. |
| Chasing "a better browser agent" | **Octomind died holding exactly that** (wound down June 2026, $4.8M, three years). Every survivor has a proprietary signal instead. |
| Enterprise-gating versioning / parameterisation / traceability / review | The most-complained-about pattern in the entire market survey, and our clearest positioning wedge. |

---

## 6. Positioning summary

**Closest conceptual competitor: Allure TestOps.** Genuinely unified manual +
automated, auto-populating repository, best-in-class failure triage — and
shipping **no AI whatsoever**, with a public presence dormant since 2023, a
review corpus that stops in 2022, a four-service self-hosting burden
(Postgres + RabbitMQ + Redis + S3), and unresolved questions about its
engineering footprint that surface in regulated procurement.

**Its feature set is the thing to match; its market position is the thing to
take.** The three items that do that are 3.3 (defect rules), 6.2 (run-from-tool
with selective execution) and 6.3 (launch model) — precisely the three things
that make "one tool" true rather than merely claimed.

**Market gaps we can exploit** (all verified):
1. TestRail and Xray — the two leaders — have **no official MCP server**.
2. Versioning is Enterprise-gated almost everywhere, or absent.
3. **ClickUp traceability is nearly unserved** — only Allure and PractiTest.
4. **Reporting is the single most universal complaint** across every tool, without
   exception.
