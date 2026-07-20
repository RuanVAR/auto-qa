# 02 — Screen reviews

Screen by screen: what a user sees, in what order, and what is wrong with it.

Sources: the July 2026 frontend audit, plus direct verification of the claims
below. Anything not verified is marked.

---

## 0. Global findings

### 0.1 There is no global search `[ ]` M ⚠️ verified

No `cmdk`, no command palette, no ⌘K handler, and **no `/search` endpoint on the
API**. The only modifier-key binding in the entire frontend is ⌘Enter to submit a
comment (`pages/issues/IssuePage.tsx:384`).

Full spec in [01-INFORMATION-ARCHITECTURE §2](01-INFORMATION-ARCHITECTURE.md).

### 0.2 `Sidebar.tsx` is dead code `[ ]` S ⚠️ verified

`components/layout/Sidebar.tsx` (36 lines) is **imported nowhere**.
`Shell.tsx:42` renders `TopNav` only. The two files describe different navigation
paradigms — one horizontal, one vertical — and only one is real.

Delete it. A dead navigation component is a trap for the next person who edits
"the nav" and sees nothing change.

### 0.3 `/ai` is a top-level destination pointing at a dead end `[ ]` S

Listed in both navs (`TopNav.tsx:191`, and the dead `Sidebar.tsx:9`). The page
generates JSON and tells the user to **copy it and paste it into the test editor**
— the product knows where that output belongs and declines to take it there.

It occupies one of five slots in the most valuable navigation real estate in the
product. Remove the destination; AI already works well *inside* the feature and
test pages where it belongs.

### 0.4 Keyboard support is modal-only

Handlers exist in `Modal`, `NavDropdown`, `ScreenshotViewer`, `SelectorTester` and
a few plugin components — i.e. escape-to-close and enter-to-submit. **Nothing for
the repeated workflows** that dominate this product.

### 0.5 No first-run experience

Nothing anywhere. A new user with an empty org lands on a dashboard of zeros with
no path to a first project, environment, or test.

---

## 1. Dashboard — `pages/dashboard/DashboardPage.tsx` (937 lines)

**Above the fold**: greeting, last-activity card, four stat cards, project grid.

### Defects

| # | Issue | Severity |
|---|---|---|
| 1 | **`Heals Today` is hardcoded `0`** (`:823-824`) | ⚠️ credibility |
| 2 | **`Pass Rate (7d)` has no 7-day window** (`:802`) — it is `passedProjects / projectsWithLastRun` from each project's *latest* run | ⚠️ credibility |
| 3 | Recent-activity feed fetches **N+1 in parallel** across the first six projects (`:648-667`) | perf |
| 4 | No empty state — a new user sees a grid of zeros and no next action | onboarding |

### The deeper problem

It answers *"what is the state of everything?"* but not **"what needs me?"** For a
QA lead that is the actual question. A dashboard that opened on *failed runs since
you last looked, tests awaiting your sign-off, bugs assigned to you, quarantined
tests* would be used daily; the current one is looked at once and abandoned.

---

## 2. Run detail — `pages/runs/RunDetailPage.tsx` (470 lines)

The screen people land on from a failure notification, i.e. the moment their
confidence is lowest.

### Defects

| # | Issue | Severity |
|---|---|---|
| 1 | **Entirely light-mode inside a dark app** (`:139-470`) — reads as broken | ⚠️ visible |
| 2 | **Traces are download-only** (`:401-412`) — the viewer is free and the traces already exist ([3.1](../plan/05-PHASE-3-INTELLIGENCE.md)) | high |
| 3 | No console or network panel — that data is not captured at all ([3.8](../plan/05-PHASE-3-INTELLIGENCE.md)) | high |
| 4 | Flat step list, no waterfall/timeline — per-step durations exist but relative cost is invisible | medium |
| 5 | AI summary renders into a bare `<pre>` (`:220-232`) | low |
| 6 | No "retry whole run" — only per-step retry | medium |
| 7 | No run-to-run comparison | medium |

### Strength worth preserving
`StepFailurePanel` auto-surfaces the first failed step with four actions and a
create-ticket dropdown. That is the right instinct — the screen opens on the
problem rather than making you hunt for it.

---

## 3. Test editor — `pages/tests/TestEditorPage.tsx` + `StepEditor.tsx` (1,448 lines)

The primary authoring surface.

### Defects

| # | Issue | Severity |
|---|---|---|
| 1 | **No drag-and-drop reorder.** `GripVertical` is rendered (`:1037`) and is **purely decorative** — reordering is Move Up/Down inside a `⋯` menu (`:1063-1090`). dnd-kit *is* installed and used for reordering features | ⚠️ high |
| 2 | **No validation before save.** Labels say `Selector *` but nothing enforces it; Save is enabled on `hasChanges` alone (`:1400`). You can save a `CLICK` with an empty selector and discover it 30 s into a run | ⚠️ high |
| 3 | **Per-step Timeout field does nothing** (`:1173-1174` writes a key the worker never reads) | ⚠️ lies |
| 4 | **"AI Description (helps self-healing)"** (`:1192`) — the worker never reads it | ⚠️ lies |
| 5 | Changing a step's type **silently discards its input** (`:1124`) with no confirm | high |
| 6 | No unsaved-changes guard — the app is not on a data router, so `useBlocker` is unavailable | high |
| 7 | **API/SHELL authoring is a single 42-row unhighlighted `<textarea>`** of raw JSON (`:1012-1022`) | high |
| 8 | `duplicateStep` appends to the **end** of the list, not after the source (`:1330-1335`) | medium |
| 9 | `DataTokenPicker` is **copy-to-clipboard only** — it does not insert into the focused field | medium |
| 10 | `StepTypeHelp` covers **12 of 28** step types; the rest render nothing (`:298`) | medium |
| 11 | No element picker — you type a selector or record an entire flow | medium |

### Strength worth preserving
`SelectorTester` — creates a recorder session, runs `querySelectorAll` against the
live page, returns match count and element samples with highlighting. **The single
best feature in the authoring flow** and it should be far more prominent.

---

## 4. Testing view — `pages/testing/TestingView.tsx` (4,501 lines)

The manual testing player, and **the strongest thing in the product**.

### Strengths
Cross-origin screenshot capture via Chromium Region Capture; screen + mic
recording; marker.js annotation; structured failure categories that drive the
analytics donut; ClickUp write-back; resumable sessions; a genuine mobile layout;
a three-source iframe URL fallback with graceful cross-origin degradation.

### Defects

| # | Issue | Severity |
|---|---|---|
| 1 | **No keyboard shortcuts** for pass/fail/skip/next — the single most repeated action in the product is mouse-only | ⚠️ high |
| 2 | 4,501 lines — unmaintainable, and the cause of drift | high |
| 3 | `LiveRunModal` **polls every 1,000 ms** (`:96-101`) despite sockets being available | medium |
| 4 | Three independent ref-counted socket singletons on the same namespace; an unmount race can disconnect a socket another component still needs | medium |

Fixing #1 alone would measurably change a tester's day: `p` pass, `f` fail, `s`
skip, `n` next, `e` evidence, `b` log bug.

---

## 5. Recorder — `pages/tests/RecorderPage.tsx` (1,266 lines)

### Strengths
A genuinely thoughtful flow: extension detection with a six-step install
walkthrough, pairing codes, live step streaming, six documented compaction rules,
tokenisation suggestions with reasons, and a preview-run → keep/discard loop.

### Defects

| # | Issue | Severity |
|---|---|---|
| 1 | **No assertion capture** — actions only. Every assertion is hand-added later, which is where recorded tests go to die | ⚠️ highest |
| 2 | Recorded steps cannot be edited — delete or adjust wait-ms only (`:934-1002`); `GripVertical` decorative again (`:940`) | high |
| 3 | Chrome only (`:797`) | medium |
| 4 | No screenshots captured during recording | low |

---

## 6. Runs list — `pages/runs/RunsPage.tsx`

### Defects
- **Filter state is not in the URL** — a filtered view cannot be shared, which is
  the dominant sharing mechanism in QA
- The flaky-tests card (`:123-129`) is **informational only** — nothing can be
  done from it ([3.6](../plan/05-PHASE-3-INTELLIGENCE.md) adds quarantine)
- `PipelinesPanel` and `SchedulesPanel` are light-mode inside the dark app

---

## 7. Org analytics — `pages/org/OrgAnalyticsPage.tsx` (571 lines)

**The most polished analytics surface in the product.** Cascading filters,
click-a-slice-to-filter-everything, RBAC-aware scoping, drill-down from top-failing
lists.

### Defects
- **No export.** No CSV/XLSX/PDF, despite `xlsx` already being a dependency used
  elsewhere. Analytics people export; this is the first thing they will ask for.
- Filter state not in the URL — same sharing problem
- Sits under `Org`, so a project-level user may never find it

---

## 8. Environments — `pages/environments/EnvironmentsPage.tsx`

### Defects
- **No "test connection"** on save. `supportsAutomation` gates the entire
  automation UX, and the API already has `checkBaseUrlReachable` — so the user can
  save an unreachable environment and only discover it when a run fails
- No timezone selector on schedules (raw cron only)

### Strength
Secret masking by key-name pattern, with untouched values dropped from the payload
(`:298-336`). Correct and quietly good.

---

## Ranked fix list

| Rank | Fix | Screen | Effort |
|---|---|---|---|
| 1 | Remove/repair the three lies (`Heals Today`, `Pass Rate (7d)`, "helps self-healing") | Dashboard, Step editor | S |
| 2 | Global search ⌘K | Global | M |
| 3 | Convert `RunDetailPage` to dark tokens | Run detail | S |
| 4 | Embed the trace viewer | Run detail | S |
| 5 | Step validation before save | Step editor | S |
| 6 | Drag-and-drop step reorder (dnd-kit already present) | Step editor | S |
| 7 | Keyboard shortcuts for the testing loop | Testing view | M |
| 8 | Delete `Sidebar.tsx`; remove `/ai` from nav | Global | S |
| 9 | Assertion capture in the recorder | Recorder | M |
| 10 | Filter state in the URL | Runs, Analytics | S |
| 11 | Empty states with a next action | All lists | M |
| 12 | Fix per-step timeout key mismatch | Step editor + worker | S |
| 13 | Analytics export | Analytics | S |
| 14 | Environment "test connection" | Environments | S |
| 15 | Convert remaining light-mode screens | 5 screens | M |

Items 1, 3, 5, 6, 8, 10, 12, 13, 14 are each a few hours and together would change
the perceived quality of the product more than any single feature in the build plan.
