# Platform Plan — index

Everything needed to build the next phase of this platform, written so that a
developer (or an AI agent) can pick up any single document and have the full
context for that work without reading the others.

Derived from the July 2026 audit and market research:
`../PLATFORM_AUDIT_2026-07.md` and `../PLATFORM_OPPORTUNITIES_2026-07.md`.

---

## Read in this order

| # | Document | What it gives you | Read when |
|---|---|---|---|
| 00 | [CONTEXT](00-CONTEXT.md) | The system as it actually is — stack, layout, execution path, data model, invariants you must not break | **Always first.** Before any work. |
| 01 | [DECISION-MATRIX](01-DECISION-MATRIX.md) | Every candidate piece of work, scored and sequenced, with the reasoning and the explicit *nots* | Before arguing about priority |
| 02 | [PHASE-0-SURVIVAL](02-PHASE-0-SURVIVAL.md) | The four things that can end the business | **Do this first. Nothing else matters until it's done.** |
| 03 | [PHASE-1-CORRECTNESS](03-PHASE-1-CORRECTNESS.md) | Eleven verified bugs, each with evidence, fix and test | Immediately after Phase 0 |
| 04 | [PHASE-2-HEALING](04-PHASE-2-HEALING.md) | Selector drift detection — wiring a feature that is already 60% built | The first real feature work |
| 05 | [PHASE-3-INTELLIGENCE](05-PHASE-3-INTELLIGENCE.md) | Flake scoring, failure fingerprinting, triage, trace viewer, commit attribution | Highest perceived-value-per-hour |
| 06 | [PHASE-4-SCALE](06-PHASE-4-SCALE.md) | Parallelism, retry ladder, resource isolation | When throughput becomes the constraint |
| 07 | [PHASE-5-PARITY](07-PHASE-5-PARITY.md) | Shared steps, parameterised data, versioning, review workflow, test plans | Before selling against Qase/Testomat |
| 08 | [PHASE-6-MOAT](08-PHASE-6-MOAT.md) | The manual-signal loop and hybrid AI healing — the defensible part | After 2 and 3 are proven |
| 09 | [CONVENTIONS](09-CONVENTIONS.md) | How to build here: migrations, tests, security, definition of done | Before writing code |
| 10 | [RESEARCH-BASIS](10-RESEARCH-BASIS.md) | Evidence log — what was verified, what was inferred, what could not be checked | When a claim in these docs needs challenging |

---

## The three sentences that drive this plan

1. **The execution engine is ~3% of the codebase** (3,800 lines of worker against
   45k API + 64k web). This is a test-management product with a thin runner, so
   the domain model is strong and nearly every gap is in execution.
2. **A better browser agent is not a moat** — Octomind died holding one in June
   2026. Every surviving competitor has a *proprietary signal* instead. **Ours is
   manual testing**, and we currently treat it as a separate product rather than
   as fuel for automation.
3. **The expensive-looking features in this market are mostly SQL over run
   history**, and we have unusually well-structured run history that almost
   nothing queries.

---

## Status legend

Used consistently in every phase document.

| Marker | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Done and verified |
| `[!]` | Blocked — reason stated inline |
| **S** | Hours |
| **M** | Days |
| **L** | Weeks |

## Ground rules

1. **Phase 0 is not negotiable and is not parallelisable with feature work.** No
   database backups exist. Until that is fixed, every other line of code is
   written on top of an unrecoverable single point of failure.
2. **Each phase document is self-contained.** It states its own preconditions,
   file targets, schema changes, test plan and rollback. If you are implementing
   one, you should not need to hold another in your head.
3. **Every claim carries a `file:line`.** If a document asserts something about
   the codebase without one, treat it as unverified and check before relying on
   it.
4. **Nothing here is a guess about the market.** Every competitor claim traces to
   [RESEARCH-BASIS](10-RESEARCH-BASIS.md), which separates *verified by direct
   fetch* from *inferred* from *could not be checked*.
