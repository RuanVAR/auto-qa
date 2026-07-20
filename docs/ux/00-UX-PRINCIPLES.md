# 00 — UX principles

The rules we hold ourselves to, written down so design arguments can be settled by
reference rather than by opinion.

---

## 1. Never show a number you cannot defend

The strongest one, and the one currently most violated.

This is a QA platform. The audience is professionally sceptical and spends all day
evaluating whether systems are telling the truth. A single wrong number teaches
them to distrust every other number on the page.

Current violations, all shipped:

| What it says | What it is |
|---|---|
| `Heals Today: 0` | Hardcoded literal `0` (`DashboardPage.tsx:823`) |
| `Pass Rate (7d)` | Has no 7-day window at all |
| "AI Description (helps self-healing)" | The worker never reads the field |

**Rule**: if a value is unavailable, show the tile in an explicit empty state, or
do not show the tile. A placeholder that looks like data is worse than a gap.

**Corollary**: label precision matters. `Pass Rate (7d)` is not a rounding error —
it is a claim about a time window that does not exist. If the number is
"projects whose latest run passed", say that.

---

## 2. Every screen answers three questions on arrival

Before a user clicks anything, the screen must make clear:

1. **Where am I?** — breadcrumb, title, context
2. **What is the state of things?** — the one status that matters here
3. **What can I do next?** — the primary action, visible without scrolling

If a screen cannot answer all three above the fold, it is wrong regardless of how
much it contains.

---

## 3. Optimise the repeated action, not the first-time one

Most UX advice optimises for a first impression. This product is used by the same
people, doing the same handful of things, hundreds of times a week:

- Mark a test pass/fail and move to the next
- Open a failed run and find the failing step
- Find a test by a name half-remembered
- Log a bug with evidence attached

**Every click removed from those four is multiplied by thousands.** Every clever
first-run flourish is seen once and then endured.

This is why keyboard shortcuts and global search rank above onboarding in the
priority list, despite onboarding being entirely absent.

---

## 4. Errors go where the mistake was made

- **Inline, at the field** — anything the user could plausibly correct: a bad
  code, a missing required value, a name collision.
- **Toast** — only for things the user could not have predicted: the network
  dropped, the server errored, a background job failed.

There is a real bug in the codebase caused by getting this backwards: `errMsg()`
only unwraps the axios error shape, so a thrown `Error` fell through to a generic
fallback and a set of specific, helpful reasons became dead code. The user saw
"Could not check that code" instead of "That code does not match any organisation."

**Rule**: expected failures are *returned as data* and rendered in place.
Unexpected failures are thrown and toasted. See
[CONVENTIONS §6](../plan/09-CONVENTIONS.md).

---

## 5. No dead ends

Every empty state names the next action and links to it. Every error offers a way
forward. Every "no results" suggests what to try.

The current `/ai` page is the anti-pattern: it produces JSON and instructs the user
to copy-paste it into another screen. The product knows where that JSON should go
and declines to take it there.

---

## 6. Density is a feature, sparseness is a cost

The users are professionals looking at lists of tests and runs all day. They want
more rows visible, not more whitespace.

This is not permission for clutter — it is a bias. When choosing between showing
eight rows comfortably and twenty rows compactly, choose twenty, and make the
typography carry the hierarchy instead of the spacing.

---

## 7. Consistency beats local optimisation

A screen that is individually better but conventionally different is worse overall,
because it forces re-learning.

We currently violate this visibly: `RunDetailPage`, `AiPage`, `PipelinesPanel`,
`SchedulesPanel` and the API/SHELL editor pane are **light-mode Tailwind inside a
dark application**. They do not read as "different", they read as **broken**.

---

## 8. The interface must not outrun the implementation

Do not ship a control that does nothing, a label that overstates, or a tile that
implies a feature exists.

Two shipped examples: the per-step Timeout field writes to a key the worker never
reads, and "helps self-healing" describes a mechanism that does not exist.

**Rule**: a control that cannot yet work is either absent or visibly disabled with
a reason. Never present and inert.

---

## 9. Trust is a design surface

Specific to this product, and a genuine differentiator available to us:

- Show **when** a number was computed, and over what window
- Show **what** a status is derived from — a healed pass is not a clean pass
  ([Phase 2.2](../plan/04-PHASE-2-HEALING.md))
- Publish the **algorithm** behind flake detection and healing precision, in the
  product, next to the badge

No competitor does this. In a market where every vendor's self-healing claim is
unfalsifiable and none publishes a false-positive rate, *showing your working* is
both good UX and the strongest positioning available.

---

## 10. Accessibility is not a later phase

Current state is thin: `role="dialog"` and `aria-label` on the modal and one
resize handle, a couple of labelled checkboxes, and nothing else. Custom dropdowns
and pickers have no keyboard handling, no focus trap, no `aria-expanded`.

Minimum bar for anything new:

- Reachable and operable by keyboard alone
- Visible focus, never `outline: none` without a replacement
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries
- Targets ≥ 44×44 px on touch
- Modals trap focus and restore it on close
- Live regions announce async state changes

---

## Settling disagreements

In order:

1. Does it violate a principle above? Then no.
2. Does it make a repeated action faster? Then probably yes.
3. Can it be shipped smaller and looked at? Then do that instead of debating.
4. Still stuck: build both, put them side by side, decide by looking.
