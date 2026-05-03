# Step Editor Specification

Full reference for the step editor UI in the Test Case detail view — field panels per step type, validation UX, drag-to-reorder, bulk operations, AI generation, regeneration flows, and import/export.

Related docs:
- `docs/STEP_DEFINITION_SPEC.md` — canonical step JSON structure and per-type input specs
- `docs/AI_GENERATION_SPEC.md` — AI generation pipeline (prompt → JSON → steps)
- `docs/BDD_GHERKIN.md` — Gherkin import/export

---

## 1. Layout Overview

The Step Editor is embedded in the Test Case detail panel. It occupies the right-side content area when a test case is selected in the Feature detail view.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Test Case: "User can log in with valid credentials"                 │
│  [Edit Title]  [Regenerate ▼]  [Import ▼]  [Run This Case]         │
├─────────────────────────────────────────────────────────────────────┤
│  Steps  (6 steps)             [+ Add Step ▼]  [Bulk Edit]          │
├─────────────────────────────────────────────────────────────────────┤
│  ⠿  1  NAVIGATE       Go to login page                  [✎][⋯]    │
│  ⠿  2  FILL           Enter email                        [✎][⋯]    │
│  ⠿  3  FILL           Enter password                     [✎][⋯]    │
│  ⠿  4  CLICK          Click login button                 [✎][⋯]    │
│  ⠿  5  WAIT_FOR_SEL   Dashboard header visible           [✎][⋯]    │
│  ⠿  6  ASSERT_URL     URL contains /dashboard            [✎][⋯]    │
├─────────────────────────────────────────────────────────────────────┤
│  Step Detail Panel  (opens when ✎ clicked)                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  Step 2 — FILL                                    [✕ Close]  │  │
│  │  Name: [Enter email                              ]           │  │
│  │  Type: [FILL               ▼]                               │  │
│  │  ─────────────────────────────────────────────────────────  │  │
│  │  Selector:  [input[type="email"]                 ] [? Help]  │  │
│  │  Value:     [{{ENV.TEST_USER_EMAIL}}             ] [Tokens]  │  │
│  │  ─────────────────────────────────────────────────────────  │  │
│  │  ☐ Continue on fail                                         │  │
│  │  Timeout:  [30000              ] ms  (blank = default)      │  │
│  │  AI Description:  [Fills the email input field with…  ]     │  │
│  │                                                             │  │
│  │  [Cancel]                               [Save Step]         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Step List Row

Each step row in the list shows:

| Element | Detail |
|---------|--------|
| Drag handle (⠿) | `draggable` — triggers reorder on drop |
| Index badge | `1`, `2`, … auto-renumbered after any reorder/delete |
| Type badge | Pill with step type, colour-coded by category (navigation=blue, interaction=green, assertion=purple, wait=yellow, script=red) |
| Step name | Truncated to 60 chars with tooltip on hover |
| Edit icon (✎) | Opens Step Detail Panel for this step |
| More icon (⋯) | Context menu: Duplicate, Move Up, Move Down, Delete, Copy JSON |

Step rows are rendered in index order. The index in the badge is visual only — the canonical `step.index` is recalculated from DOM order on save.

---

## 3. Step Detail Panel

Clicking ✎ opens the Step Detail Panel as an inline slide-over (not a modal) that pushes the step list left. Only one panel can be open at a time.

### 3.1 Common Fields (all step types)

| Field | Input | Validation |
|-------|-------|-----------|
| **Name** | Text input | Required; 1–200 chars |
| **Type** | Select dropdown (22 options) | Required; changing type resets type-specific fields |
| **Continue on fail** | Checkbox | Default: unchecked |
| **Timeout (ms)** | Number input | Optional; 100–120000; blank = use project default |
| **AI Description** | Textarea | Optional; 0–500 chars; used for selector healing context |

When **Type** is changed, the panel smoothly fades the type-specific section out and fades the new type's fields in. A confirmation prompt is shown: _"Changing step type will clear the current step inputs. Continue?"_

### 3.2 Type-Specific Field Panels

#### NAVIGATE

| Field | Input | Validation | Notes |
|-------|-------|-----------|-------|
| URL | Text | Required; must start with `http`, `https`, or `{{` | Supports tokens |
| Wait Until | Select: `load` / `domcontentloaded` / `networkidle` / `commit` | Default: `load` | |

#### CLICK / DBLCLICK / HOVER

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Button | Select: `left` / `right` / `middle` | Default: `left` (hidden for HOVER) |
| Click Count | Number | 1–10; default 1 (hidden for HOVER/DBLCLICK) |
| Force | Checkbox | Bypass actionability checks |
| Modifiers | Multi-select: `Alt` / `Control` / `Meta` / `Shift` | Optional |

#### FILL

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Value | Text | Required; supports tokens |

#### TYPE

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Text | Text | Required; supports tokens |
| Delay (ms) | Number | Optional; 0–500; simulates human typing speed |

#### CLEAR

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |

#### SELECT

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Value / Label / Index | Segmented control to pick match mode | Required; one of value/label/index |
| Input | Text or Number (for index) | Required |

#### CHECK / UNCHECK

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |

#### PRESS_KEY

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Optional; blank = `body` |
| Key | Text with autocomplete: `Enter`, `Tab`, `Escape`, `ArrowUp` … | Required |
| Modifiers | Multi-select: `Alt` / `Control` / `Meta` / `Shift` | Optional |

#### SCROLL

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Optional; blank = window scroll |
| Delta X | Number | Default 0 |
| Delta Y | Number | Default 300 |

#### WAIT_FOR_SELECTOR

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| State | Select: `visible` / `hidden` / `attached` / `detached` | Default: `visible` |

#### WAIT_FOR_NAVIGATION

| Field | Input | Validation |
|-------|-------|-----------|
| URL Pattern | Text | Optional; regex or glob |
| Wait Until | Select: `load` / `domcontentloaded` / `networkidle` | Default: `load` |

#### WAIT_MS

| Field | Input | Validation |
|-------|-------|-----------|
| Duration (ms) | Number | Required; 100–30000 |

_Note: The step-level Timeout field is hidden for WAIT_MS (not applicable)._

#### ASSERT_TEXT

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Expected Text | Text | Required; supports tokens |
| Match Mode | Select: `exact` / `contains` / `regex` | Default: `contains` |
| Case Sensitive | Checkbox | Default: checked |

#### ASSERT_VISIBLE

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Should Be | Toggle: `Visible` / `Hidden` | Default: Visible |

#### ASSERT_VALUE

| Field | Input | Validation |
|-------|-------|-----------|
| Selector | Text | Required |
| Expected Value | Text | Required; supports tokens |

#### ASSERT_URL

| Field | Input | Validation |
|-------|-------|-----------|
| Expected URL | Text | Required; supports tokens; can be regex pattern |
| Match Mode | Select: `exact` / `contains` / `regex` | Default: `contains` |

#### SCREENSHOT

| Field | Input | Validation |
|-------|-------|-----------|
| Name / Label | Text | Optional; used in run report |
| Full Page | Checkbox | Default: unchecked |

#### API_REQUEST

| Field | Input | Validation |
|-------|-------|-----------|
| URL | Text | Required; supports tokens |
| Method | Select: `GET` / `POST` / `PUT` / `PATCH` / `DELETE` | Default: `GET` |
| Headers | Key-value editor | Optional |
| Body | JSON textarea (shown when method ≠ GET/DELETE) | Optional |
| Capture Response As | Optional section (toggle) | — |
| — Variable Name | Text | Required if section open |
| — JSON Path | Text | Optional (e.g. `$.data.id`) |
| Assertions | List of assertion rows (see below) | Optional |

**API Assertion Row:**

```
[Status Code ▼]  [equals ▼]  [200            ]  [+ Add]  [✕]
[Body           ]  [contains ▼]  [{"success":true}]  [✕]
```

Assertion targets: `Status Code`, `Body`, `Header`. Operators: `equals`, `contains`, `regex`, `greater than`, `less than`.

#### EXECUTE_SCRIPT

| Field | Input | Validation |
|-------|-------|-----------|
| Script | Code editor (Monaco, JS) | Required |
| Args | JSON textarea | Optional |
| Capture Result As | Text (variable name) | Optional |

_Warning banner:_ "Scripts run in the browser context. Avoid secrets in script body."

---

## 4. Selector Help Panel

Every selector field has a `[? Help]` button that opens a popover:

```
┌──────────────────────────────────────────────────────┐
│  Selector Reference                              [✕]  │
│                                                      │
│  Recommended (most stable):                          │
│    role: [role=button][name="Submit"]                │
│    data-testid: [data-testid="submit-btn"]           │
│    aria-label: [aria-label="Close dialog"]           │
│                                                      │
│  CSS selectors:                                      │
│    #login-form input[type="email"]                   │
│    .card-body > button:first-child                   │
│                                                      │
│  Avoid (brittle):                                    │
│    :nth-child() positions                            │
│    Auto-generated class names (e.g. .css-1a2b3c)    │
│                                                      │
│  Tip: AI Description helps the healing agent find   │
│  the element if the selector breaks.                 │
└──────────────────────────────────────────────────────┘
```

---

## 5. Token Picker

Every field that supports `{{TOKEN}}` substitution shows a `[Tokens]` button. Clicking it opens a dropdown listing:

```
Runtime tokens:
  {{LAST_RESPONSE_BODY}}
  {{LAST_RESPONSE_STATUS}}
  {{LAST_RESPONSE_HEADERS}}
  {{CURRENT_URL}}
  {{PAGE_TITLE}}

Environment variables (from current env):
  {{ENV.BASE_URL}}
  {{ENV.TEST_USER_EMAIL}}
  {{ENV.TEST_USER_PASSWORD}}
  … (all keys from Environment.variables)

Step capture tokens:
  {{STEP_1_VALUE}}
  {{STEP_3_VALUE}}
  … (steps that have captureResponseAs or similar)
```

Selecting a token inserts it at the cursor position in the field.

---

## 6. Adding a Step

The `[+ Add Step ▼]` button opens a dropdown with two options:

### 6.1 Choose Step Type

A searchable type picker listing all 22 step types grouped by category:

```
Navigation:   NAVIGATE, WAIT_FOR_NAVIGATION
Interaction:  CLICK, DBLCLICK, FILL, TYPE, CLEAR, SELECT,
              CHECK, UNCHECK, HOVER, PRESS_KEY, SCROLL
Assertions:   ASSERT_TEXT, ASSERT_VISIBLE, ASSERT_VALUE, ASSERT_URL
Waits:        WAIT_FOR_SELECTOR, WAIT_MS
Media:        SCREENSHOT
API:          API_REQUEST
Script:       EXECUTE_SCRIPT
```

Selecting a type appends a new blank step with the Step Detail Panel opened for it.

New steps are appended at the bottom of the list by default. If a step row is selected, the new step is inserted **after** the selected step.

### 6.2 Generate with AI

Opens the AI Step Generation dialog (see §9).

---

## 7. Drag-to-Reorder

Steps use HTML5 drag-and-drop (or `@dnd-kit/core` for accessible drag-and-drop). The drag handle (⠿) is the only draggable area on the row.

During drag:
- The dragged row shows a blue outline and 0.7 opacity
- A blue insertion line appears between rows as the user drags
- Other rows shift to show the drop target position

On drop:
- `index` values are recalculated sequentially from 1
- A PATCH request is sent: `PATCH /api/v1/test-cases/:id/steps/reorder` with the new ordered array of `stepId`s
- Optimistic update in UI; revertion on API error

Keyboard accessibility: when a row is focused, `Space` picks it up, arrow keys move it, `Space` drops it.

---

## 8. Bulk Edit

The `[Bulk Edit]` button enters bulk selection mode:
- Each row shows a checkbox on the left
- A floating action bar appears at the bottom of the list:

```
  ☑ 3 steps selected
  [Set Continue on Fail]  [Set Timeout]  [Delete Selected]  [Cancel]
```

**Set Continue on Fail:** Toggle — sets all selected steps to checked or unchecked.

**Set Timeout:** Number input — sets `timeoutMs` on all selected steps. `0` = clear (use default).

**Delete Selected:** Confirmation dialog: _"Delete 3 steps? This cannot be undone."_ On confirm, a batch DELETE request removes the steps and recalculates indexes.

---

## 9. AI Generation

### 9.1 Regenerate All Steps

`[Regenerate ▼]` → **Regenerate All Steps**

Confirmation dialog:
```
  Regenerate all steps for this test case?
  This will replace all 6 existing steps with newly AI-generated ones.
  Previous steps cannot be recovered after saving.

  [Cancel]  [Regenerate]
```

On confirm, shows a loading state in the step list (spinner, "Generating steps…") while the AI generation API call completes. On completion the new steps replace the old ones in the panel (not yet saved to DB — the user still clicks Save).

### 9.2 Regenerate from Instruction

`[Regenerate ▼]` → **Regenerate with Instructions**

Opens a drawer:

```
┌─────────────────────────────────────────────────────────────────┐
│  Regenerate Steps with Instructions                        [✕]  │
│                                                                 │
│  Current test case:                                             │
│  "User can log in with valid credentials"                       │
│                                                                 │
│  Instructions to AI:                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Also verify that after login, the user's name appears   │   │
│  │ in the top-right nav. Use data-testid for selectors.    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ☐ Preserve existing steps (append new steps only)             │
│                                                                 │
│  [Cancel]             [Generate]                               │
└─────────────────────────────────────────────────────────────────┘
```

The user instruction is added to the AI generation prompt as a `userInstruction` parameter. See `docs/AI_GENERATION_SPEC.md` §5 for prompt structure.

### 9.3 Generate Steps for New Test Case

When a new (empty) test case is created, the step list shows an empty state:

```
  ┌─────────────────────────────────────────────────────────────┐
  │              No steps yet                                    │
  │                                                             │
  │  [✦ Generate with AI]    [+ Add Step Manually]              │
  └─────────────────────────────────────────────────────────────┘
```

`[✦ Generate with AI]` triggers generation using the test case name + feature description + codebase context. See `docs/AI_GENERATION_SPEC.md` for full generation flow.

---

## 10. Import

### 10.1 Import from JSON

`[Import ▼]` → **Import from JSON**

Opens a file picker. Accepts `.json` files conforming to the step array format:

```json
[
  {
    "index": 1,
    "type": "NAVIGATE",
    "name": "Go to login page",
    "input": { "url": "https://example.com/login", "waitUntil": "load" },
    "continueOnFail": false
  },
  ...
]
```

Validation on upload:
- Must be valid JSON array
- Each element must have `type`, `name`, `input`
- `type` must be a known `StepType`
- `input` fields validated per type

Validation errors are shown inline:
```
  ✕ Step 3: FILL input missing required field "selector"
  ✕ Step 5: Unknown step type "PRESS_BUTTON"
```

If valid, steps are previewed in a read-only list. The user can choose:
- **Replace existing steps** — replaces all current steps
- **Append to existing steps** — appends after the last step

### 10.2 Import from Gherkin (.feature)

`[Import ▼]` → **Import from Gherkin**

Opens a file picker or paste area accepting `.feature` files or raw Gherkin text.

The AI step mapper converts Gherkin `Given/When/Then` steps to `TestStep` JSON using the step definition registry. See `docs/BDD_GHERKIN.md` for the full mapping flow.

Unmapped steps are flagged:
```
  ⚠ Could not map: "When I drag the card to the Done column"
    → Suggested type: EXECUTE_SCRIPT
    → You may need to write a custom script for drag-and-drop.
```

### 10.3 Copy Steps from Another Test Case

`[Import ▼]` → **Copy Steps from Another Test Case**

Opens a search modal:

```
┌──────────────────────────────────────────────────────────────────┐
│  Copy Steps from Test Case                                  [✕]  │
│                                                                  │
│  Search:  [login                                              ]   │
│                                                                  │
│  Feature: Authentication                                         │
│  ├─ ☐ User can log in with valid credentials  (6 steps)         │
│  └─ ☐ User sees error with wrong password     (4 steps)         │
│                                                                  │
│  Feature: User Profile                                           │
│  └─ ☐ Admin can update user email              (8 steps)         │
│                                                                  │
│  [Cancel]              [Copy Selected Steps]                     │
└──────────────────────────────────────────────────────────────────┘
```

Selected steps are appended to the current test case. Indexes are renumbered sequentially.

---

## 11. Saving

Step changes are **not** auto-saved. The Step Detail Panel has explicit `[Save Step]` and `[Cancel]` buttons.

The top-level test case has a `[Save All Changes]` button in the header that is enabled when any unsaved changes exist. Unsaved changes are indicated by a dot on the test case title: "User can log in • Unsaved".

On save:
1. All step changes are sent as a single PATCH: `PATCH /api/v1/test-cases/:id` with the full steps array
2. Indexes are recalculated from the current DOM order before sending
3. Success: toast "Test case saved"; unsaved indicator clears
4. Error: toast "Failed to save. Please try again." — local state preserved

**Navigating away with unsaved changes:** A browser `beforeunload` prompt and an in-app confirmation dialog both warn: _"You have unsaved changes. Leave without saving?"_

---

## 12. Permissions

| Action | Required Role |
|--------|--------------|
| View steps | VIEWER and above |
| Edit steps | TESTER, QA_MANAGER, ORG_ADMIN, OWNER |
| Delete steps | QA_MANAGER, ORG_ADMIN, OWNER |
| Regenerate with AI | TESTER and above |
| Import steps | TESTER and above |

Step edit is disabled in read-only mode (e.g. viewing a published/signed-off version snapshot). A banner reads: _"This is a signed-off version. Steps are read-only."_

---

## 13. Step Validation Before Run

When the user clicks `[Run This Case]`, the system validates all steps before triggering a run:

- Any step with empty required fields → blocking validation error toast listing the steps
- Any step with a selector that looks potentially brittle (e.g. `nth-child`) → non-blocking warning: _"Step 3 uses a potentially fragile selector. Consider adding an AI Description to improve self-healing."_

Validation runs client-side. The API also performs its own validation in `RunsService`.

---

## 14. API Endpoints

```
GET    /api/v1/test-cases/:id                      Get test case with steps
PATCH  /api/v1/test-cases/:id                      Update test case (name, steps)
PATCH  /api/v1/test-cases/:id/steps/reorder        Reorder steps (body: { stepIds: string[] })
POST   /api/v1/test-cases/:id/steps/generate       AI-generate steps (body: GenerateStepsDto)
POST   /api/v1/test-cases/:id/steps/import-json    Import from JSON file upload
POST   /api/v1/test-cases/:id/steps/import-gherkin Import from Gherkin text/file
```

All endpoints require `Authorization: Bearer <token>` and project membership.

### GenerateStepsDto

```typescript
class GenerateStepsDto {
  @IsOptional()
  @IsString()
  userInstruction?: string;

  @IsOptional()
  @IsBoolean()
  preserveExisting?: boolean;   // default false

  @IsOptional()
  @IsString()
  ticketContext?: string;       // injected automatically if ticket linked
}
```
