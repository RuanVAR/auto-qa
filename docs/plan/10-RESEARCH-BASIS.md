# 10 — Research basis

The evidence behind this plan, separated by how well it is established. Read this
before challenging or acting on any competitive claim.

Research conducted **19 July 2026** across nine parallel agents: four auditing
this codebase, five researching the market.

---

## 1. Confidence tiers

| Tier | Meaning | How to treat it |
|---|---|---|
| **A — Verified in our code** | Read directly, `file:line` cited, and independently re-checked by me | Act on it |
| **B — Verified against a live source** | Vendor doc, changelog, GitHub API or pricing page fetched on 19 Jul 2026 | Act on it; re-check before quoting publicly |
| **C — Reported but unverified** | Secondary source, or a primary source that could not be re-fetched | Verify before acting |
| **D — Could not be checked** | Blocked, 403, or budget exhausted | Treat as unknown, not as absent |

---

## 2. Tier A — our codebase

Everything in [00-CONTEXT](00-CONTEXT.md) and
[03-PHASE-1-CORRECTNESS](03-PHASE-1-CORRECTNESS.md) is Tier A. The highest-impact
findings were re-verified by hand rather than trusted from an agent:

| Finding | How verified |
|---|---|
| `TIMED_OUT` absent from `terminalStatuses` | Read `feature-runs.service.ts:835` and `run.executor.ts:374` directly |
| `.env.production` enters the build context | Ran fnmatch against `.dockerignore` patterns; confirmed file present at 4,139 bytes; confirmed `COPY . .` in all three Dockerfiles |
| Per-step timeout is a no-op | Grepped `step.timeoutMs` across `apps/worker/src` — zero matches |
| `aiDescription` never read | Grepped `apps/worker/src` — zero matches |
| "Heals Today" hardcoded | Read `DashboardPage.tsx:823-824` |
| `SelectorHeal` never written | Grepped `apps/worker/src` — zero matches; confirmed API reads it at `runs.service.ts:94` |
| Traces already recorded | Read `run.executor.ts:498,718` — `screenshots: true, snapshots: true` |
| Recorder ranks 7 strategies | Read `apps/recorder-extension/content.js:226-312` |
| No parallelism | Traced `feature-runs.service.ts:351` → `:885-888` chaining |
| Codebase size ratio | `find` + `wc -l`: api 336 files/45k, web 207/64k, worker 23/3.8k |

---

## 3. Tier B — verified market claims

Fetched live on 19 July 2026.

### Structural / strategic
| Claim | Source |
|---|---|
| **Octomind wound down** — letter 23 Apr 2026, product off end May, company end June | LinkedIn announcement; **every repo in their GitHub org archived**; `dig octomind.dev` returns NS but **no A record** |
| **Propolis acquired by Datadog**, Jan 2026 | datadoghq.com/blog |
| **Canary QA-Bench v0**: Canary 83.1 · GPT-5.4 80.2 · Opus 4.6 78.0 | runcanary.ai/blog/qa-bench-v0, 9 Mar 2026 — vendor-published, self-favourable |
| **Slack**: AI-generated Playwright tests fail 8 % simple / **48 % complex**; agent runs cost **$15–30**; ~20 % determinism | slack.engineering, 11 Jun 2026 |
| **Atlassian Flakinator**: circuit-broken retry, **81 % detection**; Bayesian score over moving window; auto-quarantine with auto-release | atlassian.com/blog, 8 Dec 2025 |
| Playwright shards by **count, not duration** | Official Playwright docs |
| Playwright trace viewer is a standalone static app; **must be served over http(s)** | Verified against `demo.playwright.dev` trace bundle |
| **odiff 6–8× faster than pixelmatch** (1.17 s vs 7.71 s full-page) | github.com/dmtrKovalenko/odiff benchmarks |

### Self-healing mechanisms
| Vendor | Verified detail |
|---|---|
| **Testim** | Ancestor-chain fingerprint; per-attribute weights as star ratings; auto-improve loop that rewrites locators **only when validation passes**; user-tunable Very Low → Strict |
| **Katalon** | Ranked strategy chain (XPath→Attributes→CSS→Image→Smart Locator); LLM fallback; **heals never auto-apply**; **`Verify`/`Wait` auto-excluded from healing by design** |
| **mabl** | Element model from past runs; strong-match then partial-match; **persistence gated on the test ultimately passing AND being a plan run** |
| **Functionize** | 5D element model, ~200 attributes/element, ~40 models; **adjoint model reverse-validates**, emits "self-heal validation failed" |
| **Virtuoso** | **Four-condition gate**, including *no prior element in the sequence resolved with low confidence*; **never heals the hint selector**; 15-selector cap |
| **ACCELQ** | Healing **excluded** where absence is expected (waiting for disappearance, asserting non-existence); deterministic label+anchor+index+regex matching — **no ML in their own locator docs** |
| **Autify** | Published algorithm: 20 s wait → score alternatives on wording, DOM position, parent-child, class/id → highest match. States plainly **"not a feature that utilizes generative AI"**. Review-Needed flag; Save-as-Passed persists |
| **Reflect** | Four tiers: diverse cached selectors → text → LLM semantic → Vision AI. **"Selectors are a cache."** Descriptions auto-generated and user-editable; improving them improves healing |

### Test management
| Claim | Source |
|---|---|
| Qase $24–30/user/mo; review + traceability + QQL are **Business-tier**; AI credits **$0.40, no rollover** | qase.io/pricing |
| Qase shared steps 2026: folder hierarchies, nested child steps, bulk promotion, cascading-delete safety | Qase changelog |
| Testomat $27–30/user/mo; **versioning and branches are Enterprise** | testomat.io/pricing |
| **Testomat's "two-way sync" is one-way for content** — *"synchronization is one-directional—from code to Testomat.io only"* | Their own JS-import and BDD-import docs |
| TestRail $37–74/seat/mo; **parameterisation and versioning are Enterprise** | testrail.com/pricing |
| **TestRail and Xray have no official MCP server** | Verified absent from both vendors' sites and GitHub orgs |
| Allure: **flaky = ≥3 status transitions in the 10 most recent executions**, surfacing from the 6th | docs.qameta.io |
| Allure **defects carry regex rules** matched against message and/or stack trace, auto-applied to new failures; **mute is distinct from defect**, both count as resolved | docs.qameta.io/allure-testops/briefly/defects/ |
| Allure runs tests **from the TMS** via `testplan.json` + `allurectl` | docs.qameta.io |
| **Allure ships no AI at all** — full 2025–26 release notes read | docs.qameta.io release notes |
| **2026 AI-testing funding down ~86 % vs 2025** | Aggregated funding sweep |
| QA Wolf retry ladder: concurrent → **batches of 5** → serial; all must report before re-attempt | docs.qawolf.com |
| QA Wolf managed median ACV **$83,100** (58 transactions) | Vendr |

---

## 4. Tier C — reported, unverified

Do not quote publicly without checking.

- **mabl's exact attribute count and dynamic-region handling** — `help.mabl.com`
  403'd on every attempt. Their positioning is inferred.
- **Testim's current smart-locator internals** — `docs.tricentis.com` deep pages
  are **behind a login wall**; only marketing-grade claims remain public. This is
  a regression from when it was their headline claim.
- **Qase's flaky thresholds** (a status-alternation rule, min 5 runs; Stability
  Score A+→F, min 10 runs) — from search excerpts; primary doc pages 404'd.
- **Qase MCP tier availability** — their pricing page says Free, their MCP
  marketing page says Business-and-above. **Unresolved contradiction.**
- **Testsigma / Virtuoso / ACCELQ pricing** — all contact-sales. ACCELQ's Vendr
  median ($32,093) is undated. Testsigma's "$499–799/mo" is competitor-authored
  and self-admittedly an estimate.
- **Any vendor's healing false-positive rate** — **nobody publishes one.** This is
  a genuine market-wide absence, not a research failure.

---

## 5. Tier D — could not be checked

| Blocked | Impact |
|---|---|
| **Reddit** — `reddit.com`, `old.reddit.com` and all mirrors return 403 | Practitioner sentiment came via the PullPush archive API (coverage ends 2025-05-19) and the Ministry of Testing forum instead |
| **G2, TrustRadius, Gartner Peer Insights, SoftwareAdvice, GetApp** — 403 to automated fetching | Complaint sections lean on Capterra and PeerSpot, where volumes are tiny |
| **WebSearch budget exhausted** (200/200) in several agents | Later gaps closed by direct fetch, GitHub API and sitemaps |

### ⚠️ Contamination warning

**The 2026 "vendor complaints" content on the open web is overwhelmingly
competitor-authored SEO with fabricated quotes.** One agent caught
`checkthat.ai` attributing a Capterra quote to Rainforest QA that **does not exist
in any of that vendor's 17 reviews**. Bug0, Autonoma, BugBug, Momentic, TestGrid,
Qodex and remote.qa all publish "X alternatives" pages that read as user sentiment
and are not.

**Rule: treat any "what users complain about X" page as marketing unless the quote
can be traced to a dated, named review on a primary site.**

Review-corpus quality is also poor across this category:
- QA Wolf: **73 Capterra reviews, 71 five-star, zero below 4** — that distribution
  does not occur organically
- Rainforest: **14 of 17 Capterra reviews are from Dec 2017–Jun 2018**; one is
  literally about rainforests and agriculture
- Testim's 2025 reviewers hold roles like "Internal Medicine" and "Import Manager"
- Reflect: **2 Capterra reviews, both from early 2021**

---

## 6. Academic sources

| Paper | Finding | Use |
|---|---|---|
| arXiv **2310.06298** — *Just-in-Time Flaky Test Detection via Abstracted Failure Symptom Matching* | SAP HANA, 6 months production CI. Matching normalised failure symptoms against known-flaky history classifies flakiness **without rerunning**: **≥96 % precision, ~58 % machine time saved** | The spec for [3.2](05-PHASE-3-INTELLIGENCE.md) extended into flake classification |
| arXiv **2401.15788** — *230,439 Test Failures Later* | 498 flaky tests, 22 Java projects. De-duplication effectiveness **varies enormously by project** — 100 % specificity in some, entirely ineffective in others | **The reason [3.2] must be measured on our own corpus before being marketed** |

---

## 7. Where the plan is a judgement call, not a finding

Stated explicitly so these can be revisited:

1. **Phase ordering puts Intelligence before Parity.** Score alone would sometimes
   invert this. The reasoning is in
   [01-DECISION-MATRIX §3](01-DECISION-MATRIX.md) — higher effort-estimate
   confidence, and Parity is a sales gate rather than a user gate.
2. **"Manual testing is our proprietary signal"** is an inference from the
   competitive pattern (every survivor has one; ours is the asset nobody else
   has), not something a competitor has confirmed by acting on it.
3. **Not building visual regression early** trades a table-stakes checkbox for
   effort. Defensible while nobody is losing deals over it; revisit if that changes.
4. **Renaming healing to "selector drift detection"** is a bet that honesty
   converts better than the familiar term. The sentiment evidence is strong; the
   commercial evidence is not, because nobody has tried it.

---

## 8. Re-verification schedule

This market moved twice during a single day of research (LambdaTest → TestMu AI in
Jan 2026; Microsoft Playwright Testing retired Mar 2026; Functionize Studio GA
three days before the sweep).

- **Before any roadmap decision** citing a competitor: re-fetch that vendor's
  pricing and changelog.
- **Quarterly**: re-check the Tier B table.
- **Immediately**: anything in Tier C that a decision now depends on.
