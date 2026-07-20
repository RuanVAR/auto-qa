# UX Plan — index

A separate track from `docs/plan/`. That folder is about **capability** — what the
platform can do. This one is about **experience** — whether a person can actually
use it, find things, and trust what they see.

They are deliberately independent: you can ship every feature in the build plan
and still have a product people find confusing.

---

## Read in this order

| # | Document | What it covers |
|---|---|---|
| 00 | [UX-PRINCIPLES](00-UX-PRINCIPLES.md) | The rules we hold ourselves to, and how to settle arguments |
| 01 | [INFORMATION-ARCHITECTURE](01-INFORMATION-ARCHITECTURE.md) | Navigation, hierarchy, breadcrumbs, **global search** |
| 02 | [SCREEN-REVIEWS](02-SCREEN-REVIEWS.md) | Screen-by-screen: what's seen, in what order, what's wrong |
| 03 | [CONTENT-AND-COPY](03-CONTENT-AND-COPY.md) | Word flow, labels, microcopy, empty states, error messages |
| 04 | [DESIGN-SYSTEM](04-DESIGN-SYSTEM.md) | Tokens, components, consistency, the light-mode-page problem |
| 05 | [LANDING-PAGE](05-LANDING-PAGE.md) | Public marketing/landing page — **plan only, not to be built yet** |

---

## Why this matters more than usual here

This is a **QA platform**. The people using it are professionally sceptical, and
they spend all day looking at tools that report status. Two consequences:

1. **A UI that lies costs more here than elsewhere.** We currently ship a
   "Heals Today" tile hardcoded to `0`, a "Pass Rate (7d)" that has no 7-day
   window, and a field labelled "helps self-healing" that nothing reads. To a QA
   audience, each of those is evidence the tool cannot be trusted on anything else.
2. **Speed of navigation is the product.** A tester in a session, or a lead
   triaging a failed run, is doing the same three or four things hundreds of times
   a week. Every extra click is multiplied by that.

---

## Current state, in one line

The **manual testing player is genuinely excellent** — evidence capture, region
capture, annotation, structured failure reasons — and the surrounding application
has not kept up with it. Several screens are visibly from a different era of the
codebase, there is **no global search**, and there is **no first-run experience at
all**.

---

## Priority summary

Full detail in the individual documents; this is the running order.

| Rank | Item | Why | Effort |
|---|---|---|---|
| 1 | **Remove the lies** (`Heals Today`, `Pass Rate (7d)`, "helps self-healing") | Credibility. Cheapest possible win. | S |
| 2 | **Global search (⌘K)** | The single biggest navigation gap | M |
| 3 | **Style consistency pass** | Several pages are light-mode inside a dark app and read as broken | M |
| 4 | **Empty states with a next action** | A new user currently hits dead ends | M |
| 5 | **Step editor: validation + drag-reorder** | The most-used authoring surface, and the roughest | M |
| 6 | **Retire the dead `/ai` page** | It dumps JSON and tells you to copy-paste it | S |
| 7 | **Breadcrumbs** | Five levels deep with no positional cue | S |
| 8 | **Keyboard shortcuts for the testing loop** | Pass/fail/next, hundreds of times a day | M |
| 9 | **Split the 4,500-line screens** | Unmaintainable, and it shows in the inconsistency | L |
| 10 | **First-run onboarding** | Nothing exists today | M |

---

## Ground rules for this track

1. **Fix what lies before adding what's new.** A wrong number is worse than a
   missing one.
2. **Every screen answers three questions on arrival**: where am I, what is the
   state of things, what can I do next.
3. **The primary action is visible without scrolling.** If it isn't, the screen is
   wrong.
4. **No dead ends.** Every empty state names the next action and links to it.
5. **Errors go where the mistake happened** — inline at the field. Toasts are for
   things the user could not have predicted.
6. Changes here are cheap to reverse. Where there is disagreement, ship the
   smaller version and look at it.
