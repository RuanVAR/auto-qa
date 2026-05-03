# Feature Player & Testing Interface

Full specification for the stats overview panels at every level of the hierarchy, the "Start Testing" entry point, and the full-screen testing view.

Related docs:
- `docs/LIVE_TEST_VIEWER.md` — CDP screencast pipeline, LiveBrowserCanvas component
- `docs/MANUAL_TESTING.md` — manual step checklist, iframe, evidence upload, session timeout
- `docs/RUN_EXECUTION_SPEC.md` — run trigger → BullMQ → Playwright → DB writes
- `docs/STEP_DEFINITION_SPEC.md` — step types and input schemas

---

## 1. Stats Definition

Every stats panel across the platform uses the same four numbers, always calculated from the **latest completed run per test case**:

| Stat | Definition |
|------|-----------|
| **Passed** | Test cases whose most recent completed run has `status = PASSED` |
| **Failed** | Test cases whose most recent completed run has `status = FAILED` |
| **Skipped** | Test cases whose most recent completed run has `status = SKIPPED` or `ABORTED` |
| **Outstanding** | Test cases with **no completed run at all**, or test cases added since the last run |

> "Outstanding" represents untested coverage — it is always `totalTestCases − (passed + failed + skipped)`.

Stats are always shown as counts. A percentage pass rate is shown alongside where space allows: `passed / (passed + failed) × 100`, excluding outstanding and skipped from the denominator.

---

## 2. Stats at Module Level

### Where it appears

`ModulesPage` — the row/card for each module in the module list.

### Current state

Currently shows only: module name, description, features count, updated date. No run stats.

### Spec — what to add

Each module row gains an inline stats strip showing the **aggregate** of all test cases across all features in the module:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Authentication                                           3 features  │
│  Handles login, registration and session management                  │
│                                                                      │
│  ✅ 18 passed   ❌ 2 failed   ⊘ 1 skipped   ○ 4 outstanding   82%   │
└──────────────────────────────────────────────────────────────────────┘
```

**Colour coding:**
- Passed → green text / icon
- Failed → red text / icon
- Skipped → muted/grey text
- Outstanding → amber text
- Pass rate % → green if ≥ 80%, amber if 50–79%, red if < 50%
- If all outstanding (no runs at all) → single line: `○ 25 outstanding · Not yet tested`
- If no test cases exist → `No test cases yet`

**API endpoint needed:**

```
GET /api/v1/projects/:projectId/modules/stats
```

Returns per-module stats aggregated from all child features → test cases → latest runs.

```typescript
interface ModuleStats {
  moduleId:     string;
  passed:       number;
  failed:       number;
  skipped:      number;
  outstanding:  number;
  total:        number;
  passRate:     number | null;   // null if no runs at all
  lastRunAt:    string | null;
}
```

The `ModulesPage` fetches this alongside the modules list and merges by `moduleId`.

---

## 3. Stats at Feature List Level

### Where it appears

`FeaturesPage` — the row/card for each feature within a module.

### Current state

Currently shows: feature name, description, tests count, status badge (Draft/Published/Has Changes), updated date. No run stats.

### Spec — what to add

Each feature row gains a stats strip showing counts for that feature's test cases:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Login Flow                                            [Published]   │
│  Tests the main sign-in paths including OAuth and error states       │
│                                                                      │
│  ✅ 5 passed   ❌ 1 failed   ○ 0 outstanding   83%   Last run 2h ago │
│                                                              [Start Testing →] │
└──────────────────────────────────────────────────────────────────────┘
```

**Notes:**
- Stats strip is one line, compact
- `[Start Testing →]` button appears on hover (or always visible on mobile)
- "Last run Xh ago" uses relative time (e.g. "2h ago", "Yesterday", "3 days ago")
- If outstanding > 0: outstanding shown in amber — draws attention to untested cases
- If all passed with no failures: strip shows green checkmark and pass rate, no failed/skipped count
- If never run: `○ 6 outstanding · Never tested` in amber

**API endpoint needed:**

```
GET /api/v1/modules/:moduleId/features/stats
```

Returns per-feature stats.

```typescript
interface FeatureStats {
  featureId:    string;
  passed:       number;
  failed:       number;
  skipped:      number;
  outstanding:  number;
  total:        number;
  passRate:     number | null;
  lastRunAt:    string | null;
}
```

---

## 4. Stats at Feature Detail Level

### Where it appears

`FeaturePage` — at the top of the feature detail page, above the test cases table.

### Current state

No stats overview. The page jumps straight to version management header → test cases table → player → run history.

### Spec — what to add

A 4-card stat strip directly below the feature header (name + description + version banner):

```
┌────────────────────────────────────────────────────────────────────────┐
│  Login Flow                               [Published v3.0] [History]   │
│  Tests the main sign-in paths                                          │
├──────────┬──────────┬──────────┬──────────┬──────────────────────────┤
│ ✅ Passed │ ❌ Failed │ ⊘ Skipped│ ○ Out-   │  Pass rate               │
│    5      │    1     │    0     │ standing │  83%  ████████░░          │
│           │          │          │    0     │  Last run 2h ago          │
└──────────┴──────────┴──────────┴──────────┴──────────────────────────┘
```

Each of the 4 stat cards is a compact `StatCard` variant. Clicking a card filters the test case list below to show only that category (e.g. clicking "Failed" shows only failed test cases).

The pass rate card also includes a mini progress bar and the last run timestamp.

**When no runs exist:**
```
  ○  6 outstanding · This feature has not been tested yet
  [✦ Generate Tests]   [▶ Start Testing]
```

---

## 5. Test Case List with Per-Test Stats

### Where it appears

`FeaturePage` — the test cases table, below the stat strip.

### Current state

Table columns: Name, Type badge, Steps count, Updated, Edit button. No run stats per test case.

### Spec — what to add

Each test case row gains a status and a last-run summary:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  #  Name                   Type  Steps  Last Run     Status  Duration   │
├──────────────────────────────────────────────────────────────────────────┤
│  1  Login with valid creds  UI    5      2h ago      ✅ Pass   1.8s     │
│  2  Login with wrong pwd    UI    4      2h ago      ✅ Pass   0.9s     │
│  3  Password reset flow     UI    7      2h ago      ❌ Fail   3.1s     │
│  4  OAuth Google login      UI    6      Yesterday   ✅ Pass   4.2s     │
│  5  Session expiry          UI    3      Never       ○ —       —        │
│  6  Rate limit lockout      UI    8      Never       ○ —       —        │
└──────────────────────────────────────────────────────────────────────────┘
```

**Per-row elements:**
- **#** — index number
- **Name** — test case name (clickable, expands detail or opens testing view)
- **Type** — UI / API / SHELL badge
- **Steps** — step count
- **Last Run** — relative time of last completed run ("2h ago", "Yesterday", "Never")
- **Status** — `✅ Pass`, `❌ Fail`, `⊘ Skip`, `○ —` (never run)
- **Duration** — last run duration in seconds (`—` if never run)
- **Actions** (hover):
  - `[Edit]` — opens TestEditorPage
  - `[▶ Test]` — opens the testing view with this test case pre-selected (see §6)

Row background:
- Failed → very subtle red tint (`bg-red-50 dark:bg-red-950/20`)
- Never run → very subtle amber tint (`bg-amber-50 dark:bg-amber-950/20`)
- Passed → no tint (default)

Rows are sortable by: Status, Last Run, Duration. Default sort: Status (failed first, then outstanding, then passed).

**Filtering** (driven by stat card clicks from §4):
- All (default)
- Passed only
- Failed only
- Outstanding only

**API enrichment needed:**

When `FeaturePage` fetches the test case list it needs to include the latest run summary per test case:

```typescript
interface TestCaseWithStats {
  id:          string;
  name:        string;
  type:        string;
  stepsCount:  number;
  updatedAt:   string;
  latestRun: {
    status:    'PASSED' | 'FAILED' | 'SKIPPED' | null;
    duration:  number | null;
    runAt:     string | null;
  } | null;
}
```

The API adds a `latestRun` join when returning test cases for a feature:
```
GET /api/v1/features/:featureId/test-cases?includeLatestRun=true
```

---

## 6. Back Navigation — Breadcrumb + Back Buttons

### Problem

The hierarchy is deep: Org → Project → Module → Feature → Test → Testing View. Every page must give the user a clear one-click way to go up one level. React Router's `history.back()` is unreliable when users land via deep links. Use explicit `navigate(-1)` OR explicit parent path links.

### Back button spec — every page

| Page | Back button label | Destination |
|------|------------------|-------------|
| **ModulesPage** (`/projects/:id`) | `← Projects` | `/projects` (org projects list) |
| **FeaturesPage** (`/projects/:id/modules/:moduleId`) | `← [Module name]` | `/projects/:id` |
| **FeaturePage** (`/projects/:id/modules/:moduleId/features/:featureId`) | `← [Module name]` | `/projects/:id/modules/:moduleId` |
| **TestEditorPage** (`/features/:featureId/test-cases/:testCaseId/edit`) | `← [Feature name]` | `/projects/:id/modules/:moduleId/features/:featureId` |
| **TestingView** (`/projects/:id/features/:featureId/test`) | `← [Feature name]` (in top action bar) | `/projects/:id/modules/:moduleId/features/:featureId` |

### Back button placement

- On all Shell-wrapped pages: back button appears as the **first element in the page header** — left of the page title.
- Styled as: `← Module name` in muted text, a plain text link (`text-muted-foreground hover:text-foreground`), with a `ChevronLeft` icon.
- NOT a separate full-width breadcrumb bar — it is inline with the page title row.

**Page header layout with back button:**

```
┌──────────────────────────────────────────────────────────┐
│  ← Auth Module     Login Flow                [actions]   │
│                    Tests the main sign-in paths          │
└──────────────────────────────────────────────────────────┘
```

- `← Auth Module` links back to the module's feature list
- `Login Flow` is the current page title
- Actions (buttons) are right-aligned

### Breadcrumb strip (secondary, above header)

In addition to the back button, a compact breadcrumb strip appears above the page title row on feature and test editor pages:

```
My App  /  Auth Module  /  Login Flow
```

- Each segment is a clickable link
- Current page segment is non-clickable, bold
- Styled in `text-xs text-muted-foreground`
- Only shown on pages 3+ levels deep (Feature page and deeper)

### TestingView back button

In the **TestingView** top action bar, the leftmost element is the back link:

```
← Login Flow    [Env ▼]    [Manual] [Automated]    [▶ Start]    [✕]
```

- Click `← Login Flow` navigates to the feature detail page
- Feature name is truncated to 28 chars with ellipsis if longer

---

## 7. "Start Testing" Entry Points — Detailed Placement

### Entry point 1 — Feature list row (FeaturesPage)

The feature row has an explicit **`[▶ Start Testing]`** button that appears on the right side of the row, always visible (not hover-only):

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Login Flow                           [Published]                         │
│  Tests the main sign-in paths                                             │
│                                                                           │
│  ✅ 5 passed   ❌ 1 failed   ○ 0 outstanding   83%   Last run 2h ago      │
│                                              [Edit]  [▶ Start Testing]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- `[Edit]` → opens feature editor
- `[▶ Start Testing]` → navigates to `/projects/:projectId/features/:featureId/test`

On mobile / narrow viewports: buttons move inside a `⋮` overflow menu.

### Entry point 2 — Feature detail page header (FeaturePage)

The feature page header action area (top-right) always shows `[▶ Start Testing]` as a **primary button** (filled, not outline):

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Auth Module                                                            │
│  My App  /  Auth Module  /  Login Flow                                   │
│                                                                           │
│  Login Flow                  [Published v3.0]  [▶ Run Feature]            │
│  Tests the main sign-in paths                  [▶ Start Testing]  [⋮]    │
└──────────────────────────────────────────────────────────────────────────┘
```

Button hierarchy on FeaturePage:
- `[▶ Start Testing]` — **primary action** (blue filled button, always visible)
- `[▶ Run Feature]` — secondary action (outline button, triggers automated run without opening testing view)
- `[⋮]` — overflow for: Edit Feature, Duplicate, Archive, Export

### Entry point 3 — Test case row action (FeaturePage test table)

Each test case row has two hover-visible action buttons in the rightmost column:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  #  Name                   Type  Steps  Last Run   Status   Dur    Actions   │
├──────────────────────────────────────────────────────────────────────────────┤
│  1  Login with valid creds  UI    5      2h ago    ✅ Pass  1.8s   [Edit][▶] │
│  2  Login with wrong pwd    UI    4      2h ago    ✅ Pass  0.9s   [Edit][▶] │
│  3  Password reset flow     UI    7      2h ago    ❌ Fail  3.1s   [Edit][▶] │
└──────────────────────────────────────────────────────────────────────────────┘
```

The `[▶]` button in the Actions column:
- Icon-only button with `Play` icon + tooltip "Start testing this case"
- Navigates to `/projects/:projectId/features/:featureId/test?testCaseId=:testCaseId`
- In the testing view, the specified test case is **pre-selected and expanded** in the left panel
- All other test cases for the feature are still listed in the left panel (user can navigate between them)

The `[Edit]` button:
- Opens `TestEditorPage` for that test case

**Actions column visibility:**
- On desktop: buttons visible on row hover (opacity 0 → 1 on hover)
- On mobile: always visible (no hover state)

### Entry point 4 — Test case name click (FeaturePage test table)

Clicking the **test case name** (link styled, underline on hover) opens the **TestingView** pre-selected to that test case — same as clicking `[▶]`. This provides a larger click target and a more discoverable entry point.

- Name is styled: `cursor-pointer text-foreground hover:text-primary hover:underline`

### What "pre-selected" means in the Testing View

When a `?testCaseId=` query param is present in the testing view URL:
1. The left panel auto-scrolls to that test case row
2. That row is expanded (showing step detail)
3. Other test cases remain in the list — user can click any of them to switch
4. The top bar shows: `[▶ Start Selected]` and `[▶ Start All]` buttons
5. `[▶ Start Selected]` only runs the one pre-selected test case

### Run mode selection

Mode (Automated / Manual) and environment are chosen inside the Testing View itself via the top action bar — not in a modal before entering. This keeps the entry point frictionless.

---

## 8. Testing View — Full-Screen Layout

### Route

```
/projects/:projectId/features/:featureId/test
```

Optional query param: `?testCaseId=:id` — pre-selects and expands a specific test case.

### Viewport coverage

The Testing View renders at `position: fixed; inset: 0; z-index: 50` — it covers the full browser viewport including any sidebar or topnav. The shell layout beneath is hidden (not destroyed) while this view is open.

Closing the Testing View returns to the `FeaturePage` it was opened from. A subtle `[✕ Close]` or `[← Back to feature]` button lives in the top action bar.

### Two-pane layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TOP ACTION BAR (full width, ~56px tall)                                │
│  [← Login Flow]  [Env: Staging ▼]  [● Manual | ○ Automated]  [▶ Start] │
├────────────────────┬────────────────────────────────────────────────────┤
│                    │                                                     │
│   LEFT PANEL       │   RIGHT PANEL                                       │
│   (adjustable      │   (remaining width — fills entirely)                │
│    width,          │                                                     │
│    ~320px default) │   Browser view:                                     │
│                    │   • Automated → LiveBrowserCanvas                   │
│   Test case list   │   • Manual    → App iframe                         │
│   (scrollable)     │                                                     │
│                    │                                                     │
└────────────────────┴────────────────────────────────────────────────────┘
```

The divider between the two panels is a **draggable resize handle** — a 4px-wide vertical bar the user can grab and drag left/right to resize the left panel.

- Left panel min width: **220px**
- Left panel max width: **520px**
- Left panel default width: **320px**
- Width preference saved to `localStorage` key `testing-view-left-width`

---

## 9. Top Action Bar

Full-width bar, `~56px` tall, dark background (`bg-gray-900 dark:bg-gray-950`), always visible.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Login Flow    [Staging ▼]    [Manual]  [Automated]    [▶ Start]  [✕] │
└──────────────────────────────────────────────────────────────────────────┘
```

### Elements left to right

| Element | Detail |
|---------|--------|
| **← Feature name** | Back link — closes testing view, returns to `FeaturePage`. Shows feature name truncated to 24 chars. |
| **Environment selector** | Dropdown listing all project environments. Pre-selects the last-used environment (localStorage). Disabled while a run is active. |
| **Mode toggle** | Two pill buttons: `[Manual]` `[Automated]`. Selected mode has white background; inactive is ghost. Switches the right panel between iframe and canvas. Disabled while a run is active. |
| **Run controls** | Change based on state — see table below. |
| **Status indicator** | Text + pulsing dot: "Ready", "Running — Test 2 of 6", "Paused", "Complete — 5/6 passed". |
| **✕ Close** | Right-most. Closes the view. If a run is active, shows confirmation: "A run is in progress. Stop it and close?" |

### Run control states

| State | Controls shown |
|-------|---------------|
| Idle (Automated) | `[▶ Start All]`  `[▶ Start Selected]` (if a specific test pre-selected) |
| Running (Automated) | `[⏸ Pause]`  `[⏹ Stop]` |
| Paused (Automated) | `[▶ Resume]`  `[⏹ Stop]` |
| Complete (Automated) | `[↺ Re-run]`  `[↺ Re-run Failed]` (if any failures) |
| Idle (Manual) | `[▶ Start Manual Session]` |
| Manual in progress | `[■ End Session]` |
| Manual complete | `[↺ Start Again]` |

---

## 10. Left Panel — Test Case List

### Layout

Scrollable vertical list, full panel height. Each test case is a row.

**Collapsed row (default):**
```
┌───────────────────────────────────────────┐
│ ✅  1  Login with valid credentials   1.8s │
└───────────────────────────────────────────┘
```

**Failed collapsed row:**
```
┌───────────────────────────────────────────┐
│ ❌  3  Password reset flow            3.1s │
└───────────────────────────────────────────┘
```

**Never run row:**
```
┌───────────────────────────────────────────┐
│ ○   5  Session expiry redirect        —   │
└───────────────────────────────────────────┘
```

Row elements:
- Status icon (✅ / ❌ / ⊘ / ○ / ⟳ when running)
- Index number (muted)
- Test case name (truncated with tooltip on overflow)
- Duration of last run (muted, right-aligned)

Clicking any row selects that test case and expands it. Only one test case can be expanded at a time.

### Active / expanded row

The test currently being run (or manually selected) is expanded to show its steps:

```
┌────────────────────────────────────────────────────────┐
│ ⟳   3  Password reset flow              ← active      │
├────────────────────────────────────────────────────────┤
│  Steps:                                                │
│                                                        │
│  ✅  1  Navigate to /reset               312ms        │
│  ✅  2  Fill email input                 204ms        │
│  ⟳   3  Click submit button             …            │
│  ○   4  Assert success toast             —            │
│  ○   5  Assert email input cleared       —            │
│  ○   6  Assert redirect to /login        —            │
│                                                        │
│  Step 3 / 6 — Click submit button                     │
│  ████████████░░░░░░░░░  50%                           │
└────────────────────────────────────────────────────────┘
```

Step rows inside the expanded section:
- ✅ PASSED — green icon, step name, duration (muted right)
- ❌ FAILED — red icon, step name, error message in small red text below name
- ⟳ RUNNING — blue spinner icon, step name, `…`
- ○ PENDING — muted circle, step name, `—`
- ⊘ SKIPPED — grey slash icon, step name, `skipped` label

Below the steps: the step counter ("Step 3 / 6 — Click submit button") and a progress bar showing steps completed. Both update in real time via Socket.io `runStep:running` and `runStep:completed` events.

**For manual mode**, the expanded row shows the step checklist inline (same content as the current ManualPlayer right panel — step instructions, notes textarea, screenshot upload, Pass/Fail buttons) instead of the automated step status list.

### Panel header

```
┌───────────────────────────────────────────┐
│  Test Cases (6)     ✅3  ❌1  ○2          │
└───────────────────────────────────────────┘
```

Small stat summary at the top of the left panel. Updates live as runs complete.

### Scroll behaviour

The list scrolls independently of the right panel. When a test becomes active (starts running), the list auto-scrolls to keep that test visible.

---

## 10.6 Doc Pill (Top Action Bar)

> **Enablement gate.** The Doc pill, Doc widgets, and the Link-a-Doc modal only render when `usePluginCapability('fetchDocs', { projectId })` returns `enabled=true`. If the project has no ClickUp binding (or any other `fetchDocs` plugin), the pill never mounts — users see no trace of Docs integration. See `docs/PLUGIN_REGISTRY.md` §4.5.

When the feature under test has linked Docs (via `docs/PM_INTEGRATIONS.md` Doc integration — ClickUp Docs Phase 1), the top action bar shows a `📄 N docs ▼` pill right of the mode toggle:

```
[← Login Flow]  [Env ▼]  [Manual | Automated]  [📄 2 docs ▼]  [▶ Start] [✕]
```

### Behaviour

1. Pill only renders when `docLinks.length > 0` for this feature (via `GET /api/v1/doc-links?featureId=:id`)
2. Pill icon + count — click opens dropdown of Doc titles with scope badge (feature / module / project)
3. Selecting a doc opens a **right-side drawer** (380px wide, `z-index: 40` — above right panel, below modals)
4. Drawer renders via shared `DocViewer` component:
   - Header: doc title + "Open in ClickUp ↗" + "Refresh" + `[✕]` close
   - Tabs: one per Doc page (if multi-page)
   - Body: `react-markdown` + `remark-gfm` rendering
5. Drawer pins — click pin icon → right panel collapses to 50% width so browser + docs visible side-by-side
6. Drawer state (open / doc id / pinned) persists in `localStorage` key `testing-view-doc-drawer`

### Doc sources shown

- Project-scoped docs linked to this feature's project
- Module-scoped docs linked to this feature's module
- Feature-scoped docs linked to this feature
- Deduped: a single Doc linked at multiple scopes shows once with tooltip "Linked at project + feature"

### Why this matters for QA

During manual or exploratory testing the tester needs the acceptance criteria a click away. The pill gives a zero-navigation path to AC docs without losing the test context.

---

## 10.7 Snags Drawer + Highlight Routing

The Testing View is the **canonical surface** for snag interactions — not scattered refresh buttons across every page. When a user clicks a snag anywhere else in the platform (project issues list, dashboards, notifications), they navigate into the Testing View with the snag highlighted.

> **Enablement gates at three levels:**
> 1. **Snags drawer itself** — renders whenever the project's Issue Tracking feature is enabled (not ClickUp-dependent)
> 2. **`[↺ Refresh]` button on a snag card** — only visible when both: (a) the snag has a linked `TicketLink`, AND (b) `usePluginCapability('pullTicketStatus', { projectId }, ticketLink.install.pluginId)` returns enabled
> 3. **"Apply mapping?" inline banner** — only appears when `TicketStatusSuggestion` exists AND capability still enabled at banner-render time
>
> If ClickUp is uninstalled after a snag was linked, the Refresh button disappears, the external status pill shows the last cached value with a tooltip "(offline — ClickUp disabled)", and the linked ticket row becomes read-only. No orphan errors, no phantom refresh calls.

### Pill in top action bar

Right of the Docs pill, when the current feature has any `Issue` records (snags / bugs / queries):

```
[← Login Flow]  [Env ▼]  [Manual | Automated]  [📄 2 docs ▼]  [🐞 3 snags ▼]  [▶ Start] [✕]
```

- Hidden when `issues.length === 0`
- Count includes all non-closed `Issue` records for this feature
- Badge turns **red** if any snag has `severity=CRITICAL` and `status ∈ { OPEN, IN_PROGRESS }`

### Drawer layout

Click pill → **right-side drawer** opens (380px wide, `z-index: 40` — same stack as Doc drawer; they don't overlap, user picks one at a time):

```
┌─────────────────────────────────────────┐
│  Snags (3)                    [✕ Close] │
│  ─────────────────────────────────────  │
│  [x] Show closed                        │
│  Sort: [Severity ▼]                     │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🔴 CRITICAL · OPEN              │    │
│  │ Login crashes on submit         │    │
│  │ Linked: [ABC-123] Ready for QA  │    │
│  │              [↺ Refresh] [⋮]    │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │ 🟡 MEDIUM · IN_PROGRESS         │    │
│  │ Error toast text cut off        │    │
│  │ No linked ticket — [+ Link]     │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

Each snag card shows:
- Severity badge (colour-coded) + current internal status
- Title
- Linked ticket row (if any) with external status pill (using `externalStatusColor` from `TicketLink`)
- `[↺ Refresh]` button → calls `POST /api/v1/ticket-links/:id/refresh` (only when ticket linked)
- `[⋮]` overflow: Edit, Delete, Create Ticket, Link Existing

### Highlight routing from notifications

When a user clicks an inbound status notification or follows a deep link:

```
/projects/:projectId/features/:featureId/test?highlight=issue:{issueId}&suggestion={suggestionId?}
```

The Testing View on mount:
1. Parses `highlight=issue:…` query param
2. Opens Snags drawer automatically (bypasses `localStorage` drawer state for this render only)
3. Scrolls to matching snag card (uses `scrollIntoView({ behavior: 'smooth', block: 'center' })`)
4. Pulses **yellow border** around the card for 2 seconds (CSS animation)
5. If `suggestion=…` is present, also opens an inline banner inside that snag:
   ```
   ┌────────────────────────────────────────┐
   │ 💬 ClickUp says: "Resolved"            │
   │ Map to: RESOLVED                        │
   │              [Apply] [Dismiss]          │
   └────────────────────────────────────────┘
   ```
   Apply → `POST /status-suggestions/:id/apply` → snag transitions to mapped status, banner dismisses
   Dismiss → `POST /status-suggestions/:id/dismiss`, banner dismisses

### Same drawer used for inline creation

`FindingCard` (exploratory) and `IssueCard` (manual testing) reuse the same `SnagCard` component for consistent look. Creating a new snag during a manual test session opens the snag modal (not the drawer) — the drawer is for viewing existing snags.

### Pinning

Pin icon in drawer header → right panel collapses to 50% width; snag drawer takes remaining space — same pattern as Doc drawer.

Only **one** of Snags drawer / Docs drawer can be pinned at a time; opening the other auto-unpins the first.

### Keyboard shortcuts (additions)

| Shortcut | Action |
|---|---|
| `Cmd+D` | Toggle Doc drawer |
| `Cmd+B` | Toggle Snags drawer (**B for Bug**) |
| `Cmd+Shift+R` | Refresh highlighted snag's linked ticket |
| `Esc` (drawer focused) | Close drawer |

### API wiring

```
GET    /api/v1/features/:featureId/issues             List snags for feature (for pill count + drawer)
POST   /api/v1/ticket-links/:id/refresh               Refresh button action
POST   /api/v1/status-suggestions/:id/apply           Banner Apply button
POST   /api/v1/status-suggestions/:id/dismiss         Banner Dismiss button
GET    /api/v1/features/:featureId/status-suggestions?status=PENDING   Fetch pending suggestions to overlay on cards
```

### Why consolidated into Testing View

- Tester is already in the right mental context (the feature under test)
- No duplicated refresh buttons across the platform
- Navigation pattern reinforces the "feature" as the unit of work — snags belong to features
- Clicking a snag anywhere in the platform always lands the user in a place they can act on it

---

## 11. Right Panel — Browser View

Takes all remaining viewport width after the left panel. Full height of the viewport minus the top action bar.

### Automated mode — LiveBrowserCanvas

The existing `LiveBrowserCanvas` component fills the right panel entirely.

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│                                                                      │
│              [ LIVE browser frames drawn here ]                      │
│                                                                      │
│              Waiting for browser frames...          (idle state)     │
│                                                                      │
│                                                                      │
│                                               ● LIVE   frame: 147   │
└──────────────────────────────────────────────────────────────────────┘
```

When idle (no active run): shows the last screenshot from the most recent run if available, or an empty state with a monitor icon and "Run tests to see live browser output".

When a step fails: `StepFailurePanel` overlays the bottom 200px of the canvas — the panel slides up from the bottom with the failure message and recovery action buttons (Add Comment, Skip Step, Retry Step, Abort Run, Create Ticket, Notify Slack). The canvas content remains visible above it.

### Manual mode — App iframe

The app iframe fills the right panel. Uses the exact same implementation as the current `ManualPlayer` left pane:
- Loads `environment.baseUrl`
- 10-second load timeout with `timeout` / `blocked` fallback states
- "Open in New Tab" link in the top-right corner of the iframe area
- `[↗ Open in New Tab]` and `[↺ Retry Preview]` buttons in the error state

The step checklist (notes, screenshot upload, Pass/Fail buttons) lives in the **left panel** expanded active test row — not in the right panel. The right panel is purely the browser preview.

**Why this layout:**
The user does actions in the browser (right panel) then looks left to mark the step. It mirrors a natural left-to-right reading pattern: browser action → confirm result → mark in checklist.

---

## 12. Keyboard Shortcuts (Testing View)

| Shortcut | Action |
|----------|--------|
| `Space` | Play / Pause (automated) |
| `Escape` | Close testing view (with confirmation if run active) |
| `↑` / `↓` | Navigate test case list (selects prev/next test) |
| `P` | Mark current step Passed (manual mode) |
| `F` | Mark current step Failed (manual mode) |
| `Cmd/Ctrl + Enter` | Start run |

---

## 13. Real-time Updates in the Testing View

The testing view subscribes to Socket.io events on mount:

| Event | What updates in the UI |
|-------|------------------------|
| `testRun:started` | Active test row expands; status icon → ⟳ |
| `runStep:running` | Step row in expanded list → ⟳; step counter and progress bar update |
| `runStep:completed` | Step row → ✅ or ❌; progress bar advances |
| `testRun:completed` | Active row collapses (result shown); status icon → ✅ or ❌; duration shown; next test auto-expands; panel header stats update |
| `featureRun:completed` | Top bar status → "Complete — X/Y passed"; controls → re-run buttons |
| `screencast:frame` | LiveBrowserCanvas draws frame (automated mode) |

---

## 14. API Additions Required

### Stats endpoints

```
GET /api/v1/projects/:projectId/modules/stats
    → ModuleStats[] (one per module)

GET /api/v1/modules/:moduleId/features/stats
    → FeatureStats[] (one per feature)

GET /api/v1/features/:featureId/stats
    → FeatureStats (single feature overview)

GET /api/v1/features/:featureId/test-cases?includeLatestRun=true
    → TestCaseWithStats[]
```

### Stats calculation (shared service method)

```typescript
// StatsService.computeFeatureStats(featureId: string): FeatureStats
//
// For each TestCase in the feature:
//   Find the most recent TestRun where status IN (PASSED, FAILED, SKIPPED, ABORTED)
//   Bucket into passed / failed / skipped / outstanding
//   outstanding = TestCases with no qualifying run
//
// passRate = passed / (passed + failed) * 100   (null if passed + failed === 0)
// lastRunAt = max(latestRun.completedAt) across all test cases

async computeFeatureStats(featureId: string): Promise<FeatureStats> {
  const testCases = await this.db.testCase.findMany({
    where: { featureId, deletedAt: null },
    include: {
      testRuns: {
        where:   { status: { in: ['PASSED', 'FAILED', 'SKIPPED', 'ABORTED'] } },
        orderBy: { completedAt: 'desc' },
        take:    1,
      },
    },
  });

  let passed = 0, failed = 0, skipped = 0, outstanding = 0;
  let lastRunAt: Date | null = null;

  for (const tc of testCases) {
    const latest = tc.testRuns[0] ?? null;
    if (!latest) { outstanding++; continue; }
    if (latest.status === 'PASSED')              passed++;
    else if (latest.status === 'FAILED')         failed++;
    else                                         skipped++;
    if (!lastRunAt || latest.completedAt > lastRunAt) lastRunAt = latest.completedAt;
  }

  const passRate = (passed + failed) > 0
    ? Math.round(passed / (passed + failed) * 100)
    : null;

  return {
    featureId,
    passed, failed, skipped, outstanding,
    total: testCases.length,
    passRate,
    lastRunAt: lastRunAt?.toISOString() ?? null,
  };
}
```

Module stats aggregate by calling `computeFeatureStats` for each child feature and summing the buckets.

---

## 15. Implementation Notes

### What already exists (reuse as-is)

| Existing piece | Used in testing view as |
|----------------|------------------------|
| `LiveBrowserCanvas` component | Right panel — automated mode |
| ManualPlayer iframe logic | Right panel — manual mode |
| ManualPlayer step checklist | Left panel expanded row — manual mode |
| `StepFailurePanel` component | Overlay on right panel bottom on step failure |
| WebSocket hooks (`useFeatureRunSocket`, `useRunSocket`) | Left panel step updates + canvas frames |
| `featureRunsApi.pause/resume/stop/start` | Top bar run controls |
| `environmentsApi.list` | Environment selector in top bar |

### What needs to be built new

| New piece | Notes |
|-----------|-------|
| `StatsService.computeFeatureStats()` | Shared; called by all three stats endpoints |
| Three stats API endpoints | GET module stats, feature stats, single feature stats |
| `TestCaseWithStats` join in `GET /features/:id/test-cases` | Add `includeLatestRun` query param |
| Stats strip on `ModulesPage` rows | Small UI addition |
| Stats strip on `FeaturesPage` rows | Small UI addition |
| Stat cards on `FeaturePage` header | 4 `StatCard` components + filter integration |
| Per-test status columns in `FeaturePage` test table | Add last run status + duration columns |
| Back button on `ModulesPage` | `← Projects` link in page header |
| Back button on `FeaturesPage` | `← [Module name]` link in page header |
| Back button on `FeaturePage` | `← [Module name]` link in page header |
| Breadcrumb strip on `FeaturePage` and deeper | `My App / Auth Module / Login Flow` above the title row |
| `[▶ Start Testing]` button on `FeaturesPage` rows | Always-visible button, right side of feature row; navigates to testing view |
| `[▶ Start Testing]` primary button on `FeaturePage` header | Blue filled button in header action area; always visible |
| `[▶]` (play) icon button on test case rows | Hover-visible in Actions column; navigates to testing view with `?testCaseId=` |
| Test case name as clickable link | `cursor-pointer` styling; same destination as `[▶]` button |
| `/projects/:id/features/:id/test` route + page | New page, full-screen |
| `TestingView` page component | Full-screen shell override, top bar, 2-pane layout |
| Drag-resize left panel | ResizeHandle component, localStorage persistence |
| Left panel test case list | Collapsed + expanded rows with step detail |
| Step progress bar + counter | Inside expanded row, driven by socket events |

### Full-screen override

The testing view needs to escape the app `Shell` layout. Two approaches:

**Option A — Portal route**: Define `/features/:id/test` outside the `Shell` wrapper in `App.tsx` so it renders without sidebar/topnav. Cleanest — the shell never mounts.

**Option B — Fixed overlay**: Render the testing view as `position: fixed; inset: 0; z-index: 50` inside the existing route. Shell is hidden beneath it. Easier to implement, slightly heavier DOM.

**Recommend Option A** — cleaner, avoids any z-index stacking issues, and signals clearly to the user they are in a dedicated testing mode.

```tsx
// App.tsx routing structure
<Routes>
  {/* Shell-wrapped routes */}
  <Route element={<Shell />}>
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/projects/:projectId/features/:featureId" element={<FeaturePage />} />
    {/* ... all other routes */}
  </Route>

  {/* Full-screen routes — NO Shell wrapper */}
  <Route
    path="/projects/:projectId/features/:featureId/test"
    element={<ProtectedRoute><TestingView /></ProtectedRoute>}
  />
</Routes>
```

---

## 16. Verification Checklist (Acceptance Criteria)

### Stats panels

- [ ] Module list shows pass/fail/skip/outstanding counts per module; counts match sum of all child feature test cases
- [ ] Feature list shows pass/fail/skip/outstanding counts per feature row; "Never tested" shown in amber when no runs
- [ ] Feature detail page shows 4 stat cards; clicking "Failed" card filters test table to failed tests only
- [ ] Test case table shows status icon + last run duration per row; "Never" shown for never-run tests
- [ ] Pass rate = `passed / (passed + failed) × 100`; outstanding and skipped excluded from denominator
- [ ] Stats update after a run completes (page refetch or live update)

### Back navigation

- [ ] `ModulesPage` has `← Projects` link left of title; click navigates to org projects list
- [ ] `FeaturesPage` has `← [Module name]` link left of title; click navigates to modules list
- [ ] `FeaturePage` has `← [Module name]` link left of title; click navigates to feature list
- [ ] `FeaturePage` and deeper pages show breadcrumb strip above title (`My App / Auth Module / Login Flow`)
- [ ] `TestingView` top bar has `← [Feature name]` as leftmost element; click returns to feature detail page

### Entry points

- [ ] `[▶ Start Testing]` button is always visible (not hover-only) on every feature row in the feature list
- [ ] `[▶ Start Testing]` is the primary (filled) button in the feature detail page header action area
- [ ] `[▶]` play icon button visible on hover in test case row Actions column; tooltip reads "Start testing this case"
- [ ] Test case name is styled as a link (underline on hover); clicking opens testing view with that test pre-selected
- [ ] All four entry points navigate to `/projects/:projectId/features/:featureId/test` (with optional `?testCaseId=`)
- [ ] When `?testCaseId=` is present, left panel auto-scrolls to that test case and expands it
- [ ] `[▶ Start Selected]` button appears in top bar when a test case is pre-selected

### Testing view layout

- [ ] Testing view fills 100% viewport width and height — no sidebar, no topnav visible
- [ ] Left panel default width is 320px
- [ ] Drag handle between panels is visible on hover; dragging resizes both panels
- [ ] Resized width persists across page refresh (localStorage)
- [ ] Left panel min/max width (220px / 520px) enforced during drag

### Top action bar

- [ ] Environment selector shows all project environments; pre-selects last-used
- [ ] Mode toggle switches right panel between canvas (automated) and iframe (manual)
- [ ] Mode toggle and environment selector are disabled while a run is active
- [ ] Status indicator updates in real time: "Running — Test 2 of 6", "Paused", "Complete — 5/6 passed"
- [ ] Automated idle: `[▶ Start All]` button visible
- [ ] Automated running: `[⏸ Pause]` + `[⏹ Stop]` visible
- [ ] Automated paused: `[▶ Resume]` + `[⏹ Stop]` visible
- [ ] Automated complete: `[↺ Re-run]` + `[↺ Re-run Failed]` (if any failures) visible
- [ ] Manual idle: `[▶ Start Manual Session]` visible
- [ ] `[✕ Close]` shows confirmation if run is active

### Left panel

- [ ] All test cases listed top to bottom with status icon, index, name, last-run duration
- [ ] Failed rows have subtle red background tint; never-run rows have amber tint
- [ ] Clicking a row selects + expands it; previously expanded row collapses
- [ ] Expanded automated row shows step list: ✅/❌/⟳/○ per step, duration, error on failed step
- [ ] Step progress counter and progress bar update in real time during run
- [ ] List auto-scrolls to keep active test visible
- [ ] Panel header shows live stat counts (✅3 ❌1 ○2)

### Right panel — automated

- [ ] `LiveBrowserCanvas` fills right panel entirely
- [ ] Canvas shows "Waiting for browser frames…" when run hasn't started
- [ ] Live JPEG frames render during active run
- [ ] `StepFailurePanel` slides up from bottom on step failure; canvas visible above it
- [ ] Recovery actions (Skip, Retry, Abort) in failure panel work correctly

### Right panel — manual

- [ ] App iframe loads `environment.baseUrl`
- [ ] Iframe load timeout (10s) shows fallback with "Open in New Tab" + "Retry Preview"
- [ ] Blocked X-Frame-Options shows error state
- [ ] "Open in New Tab" link opens env baseUrl in new tab
- [ ] Notes textarea, screenshot upload, Pass/Fail buttons live in the LEFT panel expanded row (not right panel)
- [ ] Passing a step advances to the next step in the expanded row
- [ ] Session heartbeat fires every 5 minutes
- [ ] Inactivity warning appears at 30 minutes

### Keyboard shortcuts

- [ ] `Space` pauses/resumes automated run
- [ ] `Escape` closes view (confirmation if run active)
- [ ] `↑`/`↓` navigate test case list
- [ ] `P` / `F` mark current manual step passed / failed
