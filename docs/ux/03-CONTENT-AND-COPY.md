# 03 — Content and copy

Word flow, labels, empty states, error messages. The cheapest UX work available
and the most consistently skipped.

---

## 1. Voice

**Plain, specific, and never enthusiastic about itself.** The audience is QA
professionals who read status text all day and discount anything that sounds like
marketing.

| Do | Don't |
|---|---|
| "3 tests failed in Payments" | "Oops! Something went wrong 😕" |
| "This code does not match any organisation" | "Invalid input" |
| "Accepting moves the project immediately" | "Are you sure?" |
| "No environment is enabled for automation" | "Automation unavailable" |

Three rules:

1. **Name the thing.** "3 tests failed", not "Some tests failed".
2. **Say what happens next.** "The project moves the moment they accept."
3. **Never apologise for the software's own behaviour.** Explain the state.

The existing codebase is already good at this in places — the recorder's
explanation of why `chrome://` links cannot be clicked, and the transfer flow's
"you will see their name before anything is sent", are both exactly right.

---

## 2. Labels must match behaviour

The most damaging copy failures in the product are not awkward phrasing — they are
**labels that describe something the code does not do**:

| Label | Reality | Fix |
|---|---|---|
| `Heals Today` | Hardcoded `0` | Remove until [Phase 2](../plan/04-PHASE-2-HEALING.md) |
| `Pass Rate (7d)` | No time window at all | "Projects passing (latest run)" |
| "AI Description (helps self-healing)" | Never read by the worker | "Step intent — used by AI generation" until 6.4 |
| `Timeout (ms)` on a step | Written to a key nothing reads | Fix the worker, or disable with a reason |

**Rule**: a label is a claim. If the code does not honour it, the label is a bug
with the same severity as a wrong calculation.

---

## 3. Terminology — decide once, use everywhere

Several concepts have multiple names across the UI. Fix the vocabulary before
adding screens that inherit the confusion.

| Use | Not | Note |
|---|---|---|
| **Selector drift detection** | Self-healing | The term is damaged in this market ([Phase 2 §2](../plan/04-PHASE-2-HEALING.md)) |
| **Test** | Test case, test definition | `TestDefinition` is the model name; users say "test" |
| **Run** | Execution, test run | One word |
| **Session** | Work session, run session, sitting | `TestRunSession` in the model; "session" in the UI |
| **Environment** | Env, target | Never abbreviate in UI |
| **Feature** | — | Overloaded with product-feature; consider "Area" if it causes confusion in testing |

Also settle **manual vs automated** language: the product's differentiator is that
they are the same thing seen two ways. Copy should reinforce that — "run" not
"automated run" where the mode is already visible.

---

## 4. Empty states

`EmptyState` exists in `components/ui/` and is **barely used**. Most lists render
nothing, or a bare "No results".

Every empty state has three parts:

```
1. What this is        "Environments are where your tests run."
2. Why it's empty      "This project doesn't have one yet."
3. The next action     [ Add an environment ]
```

### Priority empty states

| Screen | Currently | Should say |
|---|---|---|
| New org dashboard | grid of zeros | "Create your first project" + what a project is |
| Project with no environments | empty list | "Tests need an environment to run against" + Add |
| Feature with no tests | empty list | Two paths: **Record a test** or **Generate with AI** |
| Runs, never run | empty table | "No runs yet — start a testing session" |
| Search, no results | *(does not exist)* | Suggest broadening scope; show recents |
| Flaky tests, none | empty card | "No flaky tests detected" — a **good** empty state, say so positively |

That last one matters: some empty states are good news and should read as such.

---

## 5. Error messages

Follow the routing rule from [PRINCIPLES §4](00-UX-PRINCIPLES.md) — inline for
what the user can fix, toast for what they could not predict.

### Structure

```
What happened  →  Why  →  What to do
"Couldn't start the run — the environment isn't reachable.
 Check the base URL or pick another environment."
```

### Specific improvements

| Current | Better |
|---|---|
| "Action failed. Please try again." (`OrgAccessRequestsPage.tsx:189`) | Name the action and the reason |
| "Could not check that code" | The specific reason — no match / same org / not accepting |
| Raw Playwright error dumped into a step | Keep the raw text available, lead with the interpreted cause ([3.4](../plan/05-PHASE-3-INTELLIGENCE.md) buckets) |
| Silent variable resolution to `''` (`interpolate.ts:172`) | Warn on unknown `{{VAR}}` — a typo'd `{{PASWORD}}` currently fills an empty field and fails confusingly later |

That last one is a genuine footgun: unknown variables resolve to empty string with
no error anywhere.

---

## 6. Destructive confirmations

State the **consequence**, not the action, and make the button say what it does:

```
✗  "Are you sure?"                    [Cancel] [OK]
✓  "Delete 'Checkout regression'?
    12 tests will be permanently removed. This cannot be undone."
                                       [Cancel] [Delete 12 tests]
```

Where a shared object is involved, **show the blast radius** — this is required
for shared steps ([5.1](../plan/07-PHASE-5-PARITY.md)): deleting one must name the
tests that will break.

---

## 7. Numbers and time

- **Always state the window**: "Pass rate (last 30 days)", never a bare percentage
- **Relative time for recent, absolute on hover**: "4 minutes ago" / `19 Jul 2026, 10:15`
- **Round honestly**: `94%` not `93.7%`, but never round `99.4%` to `100%`
- **Zero is a value, not an absence**: "0 failures" reads better than an empty cell
- **Show the denominator**: "12 of 14 passed" beats "86%"
- **Say when it was computed** if it is cached or scheduled

---

## 8. Microcopy that earns trust

Specific to this product, and a differentiator per
[PRINCIPLES §9](00-UX-PRINCIPLES.md):

- Next to a flaky badge: *"Flagged because this test changed result 3 times in the
  last 10 runs."* — the published algorithm, in place
- Next to a healed pass: *"Passed using a fallback selector. The original selector
  no longer matches."*
- Next to a coverage number: *"Coverage here means tests executed, not code
  covered."*
- Next to AI output: *"Generated from the acceptance criteria — review before
  accepting. These tests inherit any gaps in the requirements."*

That last one is unusually honest and directly addresses the circularity problem
in [5c of the opportunities doc](../PLATFORM_OPPORTUNITIES_2026-07.md). Saying it
out loud costs nothing and is the kind of thing this audience notices.

---

## Acceptance

- [ ] Every label audited against what the code does; mismatches fixed or removed
- [ ] Terminology table applied consistently across all screens
- [ ] `EmptyState` used on every list, with a next action
- [ ] Error routing follows inline-vs-toast; specific reasons surfaced
- [ ] Destructive confirms state consequence and blast radius
- [ ] Every displayed metric names its window
- [ ] Unknown `{{VAR}}` warns instead of silently resolving to empty
