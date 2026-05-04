# Test Recorder — MVP Specification

**Phase target:** Phase 5.9 (new sub-phase) — independent of plugin work; can ship in parallel.
**Status:** Planned — not implemented.
**Scope:** MVP only. Phase 2 AI polish + Phase 3 expansion live in `docs/future/TEST_RECORDER_PHASE_2.md` and `docs/future/TEST_RECORDER_PHASE_3.md`.

> **What this is.** A codeless test authoring tool. User clicks `[● Record]`, performs actions in an embedded browser, the platform captures every DOM event as a typed test step, and the recorded sequence is saved as a normal `TestCase` that runs through the existing automated pipeline.

---

## Related docs (read first)

- `docs/STEP_DEFINITION_SPEC.md` — the 22 canonical step types — recorder output target
- `docs/STEP_EDITOR_SPEC.md` — existing step editor — recorded steps land here for review
- `docs/MANUAL_TESTING.md` §iframe-preview — same iframe + X-Frame pre-flight pattern
- `docs/EXPLORATORY_TESTING.md` §6 (screenshot capture), §8.4 (auto-captured repro steps from DOM events) — the existing capture script is the seed of this recorder
- `docs/AI_EXECUTION_ENGINE.md` — selector healing — recorder writes both `selector` AND `aiDescription` so heals work day 1
- `docs/CODEBASE_AWARE_TESTING.md` — codebase RAG — used to detect the app's selector convention
- `docs/LIVE_TEST_VIEWER.md` — `FloatingRecorder` component — reused for non-embeddable apps

---

## 1. MVP Scope

### 1.1 In scope

- New page `/projects/:projectId/features/:featureId/record` (full-screen, outside Shell)
- Embedded iframe of the app (or `FloatingRecorder` popup if X-Frame blocks)
- Capture script injected into iframe via `srcdoc` wrapper or `postMessage` handshake
- Captures these DOM events → maps to step types:
  - Click → `CLICK`
  - Form input change → `FILL`
  - `<select>` change → `SELECT`
  - URL change (full nav + SPA) → `NAVIGATE`
  - Key press (Enter, Tab, Escape, etc.) → `KEYBOARD`
  - Scroll → `SCROLL`
  - Hover (capture `mouseenter` selectively) → `HOVER`
- "Assert mode" overlay — user clicks element to add `ASSERT_TEXT`, `ASSERT_VISIBLE`, `ASSERT_URL`, `ASSERT_ELEMENT` (one click → modal picks assertion type)
- Live step list pane — steps appear in real time as the user acts; user can edit/delete/reorder during recording
- Selector strategy with **codebase RAG integration** (priority order in §4)
- Both `selector` AND `aiDescription` populated on every step at capture time (heal-ready)
- Save → creates new `TestCase` (or appends to existing) → opens in `StepEditor` for review
- Password auto-redaction
- Inline "tokenize this value as `{{ENV_VAR}}`" prompt on suspicious values (URLs containing the env baseUrl, the logged-in user's email, etc.)
- Three entry points (Test Editor, Testing View, Feature page)

### 1.2 Explicitly NOT in MVP

These move to `docs/future/TEST_RECORDER_PHASE_2.md` or `_PHASE_3.md`:

- AI-suggested assertions from DOM-diff (Phase 2)
- AI step-name cleanup ("Click button.btn-primary" → "Click Submit") (Phase 2)
- Shadow DOM piercing (Phase 2)
- Agentic post-processing (split, name, add waits) (Phase 2)
- Chrome extension for non-embeddable apps (Phase 3)
- Server-side Playwright-driven recorder via CDP (Phase 3)
- Cypress Studio-style "edit existing test recorder mode" (replay to point + record from there) (Phase 3)
- File upload capture with file-picker prompt (Phase 3)
- Cross-origin iframes via injected app script tag (Phase 3 — needs app team buy-in)

---

## 2. Data Model

**Zero new database models.** Recorder output is a normal `TestCase` with normal `TestStep[]` per `STEP_DEFINITION_SPEC.md`. This keeps blast radius minimal and means recorded tests are indistinguishable from hand-authored ones from Day 1 — they run through the existing executor, get the existing healing, show up in the existing run history.

**One new column** on `TestCase` (optional, for telemetry / future analytics):

```prisma
model TestCase {
  // ... existing fields ...
  authoringMethod   AuthoringMethod  @default(MANUAL)
  recordedAt        DateTime?
  recordedDurationSec Int?
  // ...
}

enum AuthoringMethod {
  MANUAL          // typed in the step editor
  RECORDED        // captured via recorder
  AI_GENERATED    // generated via AI from natural language
  IMPORTED        // import from JSON / Gherkin
}
```

`authoringMethod` enables future analytics ("recorded tests have X% lower flake rate than manual"); not user-visible in MVP.

Migration: `20260424000000_test_case_authoring_method` — add column with default `MANUAL` (back-fills existing rows).

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  RECORDER PAGE   /projects/:pId/features/:fId/record                 │
│                  (rendered outside <Shell>, full viewport)           │
├──────────────────────────────────────────────────────────────────────┤
│  Top action bar — controls + state                                   │
├──────────────┬───────────────────────────────────────────────────────┤
│              │                                                       │
│  LEFT PANEL  │  RIGHT PANEL                                          │
│  Live step   │  iframe (same-origin) OR FloatingRecorder window     │
│  list        │  + AssertModeOverlay (when toggled on)                │
│              │                                                       │
│  ~360px      │  remaining width                                      │
│              │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘

Capture data flow:
  User clicks element in iframe
    ↓
  test-recorder.js (injected) intercepts event in capture phase
    ↓
  selectorEngine.generateLocators(element, ctx) → primary + fallbacks + aiDescription
    ↓
  postMessage({ type: 'recorder:event', step: TestStep }) → parent window
    ↓
  RecorderStore.appendStep(step) → Zustand state
    ↓
  Live step list re-renders (React Query optimistic)
    ↓
  Save → POST /test-cases (or PATCH if appending) → opens in StepEditor
```

### 3.1 Component tree

```
<RecorderPage>
  <RecorderTopBar />
  <RecorderShortcuts /> (keyboard handler — global)
  <ResizablePanes>
    <LeftPane>
      <RecordingState />          (idle / recording / paused / saving)
      <StepList>                  (live, drag-reorderable, inline edit)
        <StepRow editable />
      </StepList>
      <RecorderFooter>
        <ButtonsRow [Save] [Discard] [Add Manual Step] />
      </RecorderFooter>
    </LeftPane>
    <RightPane>
      <IframePreview environmentId>
        <AssertModeOverlay show={assertMode} />
      </IframePreview>
      OR
      <FloatingRecorderHost />    (when X-Frame blocks iframe)
    </RightPane>
  </ResizablePanes>
</RecorderPage>
```

---

## 4. Selector Strategy (the most important section)

For every captured DOM element, the selector engine generates **a primary locator + N fallback locators + a natural-language description**. All three are stored on the step so healing has multiple shots at finding the element on replay.

### 4.1 Priority order (try in sequence, pick first stable)

| Order | Strategy | Example | Stability |
|---|---|---|---|
| 1 | **Project-detected test attribute** | `[data-testid="login-submit"]` | Highest — survives almost everything |
| 2 | `getByRole('role', { name })` (Playwright role locator) | `getByRole('button', { name: 'Submit' })` | Very high — accessibility-aware |
| 3 | `getByText('exact text')` | `getByText('Submit')` | High — survives styling |
| 4 | `getByLabel('label text')` (form fields) | `getByLabel('Email address')` | High — survives styling |
| 5 | `getByPlaceholder` (form fields) | `getByPlaceholder('Enter email')` | Medium-high |
| 6 | `id` attribute (if not auto-generated) | `#login-form` | Medium — id may change |
| 7 | CSS path (last resort) | `form > div:nth-child(2) > input` | Low — brittle |

### 4.2 Codebase RAG integration

Before recording starts, the recorder calls:

```
GET /api/v1/projects/:projectId/test-attribute-conventions
```

Backend reads the connected repo's source files (already indexed by `CODEBASE_AWARE_TESTING.md` RAG) and detects which test attribute convention this codebase uses by frequency:

```typescript
// Service searches indexed code for test-attribute occurrences
const counts = {
  'data-testid': await countOccurrences(projectId, 'data-testid'),
  'data-test':   await countOccurrences(projectId, 'data-test'),
  'data-cy':     await countOccurrences(projectId, 'data-cy'),
  'data-qa':     await countOccurrences(projectId, 'data-qa'),
  'data-test-id':await countOccurrences(projectId, 'data-test-id'),
};
const detected = Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0];
return { convention: detected, count: counts[detected] };
```

The selector engine uses **this** attribute as priority 1 — it knows what convention this codebase actually uses. If no test attributes are in the codebase, priority 1 is skipped and we start at role.

> **Why this matters.** Playwright Codegen always picks the same priority globally. We adapt per-project. A team using `data-cy` doesn't get `data-testid` recommendations they'll have to rewrite.

### 4.3 Stability check — "is this locator unique?"

For each candidate in priority order, the engine evaluates:

```typescript
function isStable(locator: string, doc: Document): boolean {
  const matches = doc.querySelectorAll(locator);
  return matches.length === 1;
}
```

If priority 1 returns 0 or >1 matches, fall through to priority 2. Continue until a unique match is found. If every priority is non-unique, the engine combines (e.g. role + text + nth-child) until unique. **Recorded `selector` value is always unique at capture time.**

### 4.4 Generating `aiDescription` — RAG-grounded

Every step also gets a natural-language description for AI healing fallback:

```typescript
const description = await aiService.runTask('selector-description', {
  elementHtml:    element.outerHTML.slice(0, 500),
  surroundingText: getSurroundingText(element, 200),
  pageRoute:      location.pathname,
  componentHint:  await codebaseRag.findComponentByRoute(location.pathname), // RAG
});
// Returns: "the Submit button at the bottom of the LoginForm component"
```

Stored as `step.aiDescription`. Healer uses it when `selector` fails on replay (per `AI_EXECUTION_ENGINE.md`).

If RAG is unavailable, fall back to a non-RAG description: "the Submit button containing text 'Sign In'".

### 4.5 Generated TestStep example

```jsonc
{
  "index": 4,
  "type": "CLICK",
  "selector": "[data-cy='login-submit']",
  "aiDescription": "the Submit button at the bottom of the LoginForm component",
  "fallbackSelectors": [
    "getByRole('button', { name: 'Sign In' })",
    "getByText('Sign In')",
    "#login-submit"
  ],
  "expectedOutcome": "form submits, navigates to /dashboard",
  "timeoutMs": 5000,
  "name": "Click Sign In button",  // AI-cleaned in Phase 2; raw in MVP
  "capturedAt": "2026-05-04T12:34:56.789Z"
}
```

`fallbackSelectors` is a new optional field on `TestStep` (additive — see §6 schema additions).

---

## 5. Capture Script — `apps/web/public/test-recorder.js`

### 5.1 Injection model

**Same-origin iframe path (default):**
- Recorder iframe `<iframe srcdoc="...">` wraps the env baseUrl page; `srcdoc` injects a `<script>` tag pointing at our recorder script
- OR if env app cooperates: app team adds `<script src="https://platform/recorder.js">` to their dev build (Phase 3 — not MVP)
- For MVP we rely on `srcdoc` — works for any same-origin app, fails for cross-origin (deferred to Phase 3 Chrome extension)

**FloatingRecorder popup path (X-Frame fallback):**
- `window.open(envBaseUrl, '_blank')` opens the app in a new window
- `window.opener.postMessage(...)` channel for capture events
- App must be same-origin to platform OR cooperate via script tag (Phase 3)
- For MVP, FloatingRecorder works only for same-origin apps OR apps that have already integrated the recorder script

### 5.2 What the script intercepts

```javascript
// apps/web/public/test-recorder.js (skeleton)
(() => {
  if (window.__qaRecorderActive) return;
  window.__qaRecorderActive = true;

  const channel = (eventType, payload) =>
    window.parent.postMessage({ type: `recorder:${eventType}`, payload }, '*');

  // Click — capture phase to see all clicks before app handlers
  document.addEventListener('click', (e) => {
    const target = e.composedPath()[0]; // shadow DOM piercing — Phase 2 expansion
    const step = buildClickStep(target);
    channel('event', step);
  }, { capture: true });

  // Input change — debounce so we capture the FINAL value, not every keystroke
  let inputTimers = new WeakMap();
  document.addEventListener('input', (e) => {
    const target = e.target;
    if (!isFormField(target)) return;
    clearTimeout(inputTimers.get(target));
    inputTimers.set(target, setTimeout(() => {
      const step = buildFillStep(target);
      channel('event', step);
    }, 500));
  }, { capture: true });

  document.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT') {
      channel('event', buildSelectStep(e.target));
    }
  }, { capture: true });

  // Navigation — full nav + SPA route changes
  let lastUrl = location.href;
  const recordNav = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    channel('event', buildNavigateStep(location.href));
  };
  ['pushState', 'replaceState'].forEach(method => {
    const orig = history[method];
    history[method] = function(...args) {
      const r = orig.apply(this, args);
      recordNav();
      return r;
    };
  });
  window.addEventListener('popstate', recordNav);

  // Key press — only meaningful keys (Enter/Tab/Escape/Arrow*); ignore character keys (covered by FILL)
  document.addEventListener('keydown', (e) => {
    if (!MEANINGFUL_KEYS.has(e.key)) return;
    channel('event', buildKeyboardStep(e));
  });

  // Scroll — debounce; only capture if scrolled meaningfully (>200px)
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      channel('event', buildScrollStep(window.scrollX, window.scrollY));
    }, 600);
  });

  // Heartbeat to parent so it knows the iframe is alive and recording
  setInterval(() => channel('heartbeat', { url: location.href }), 2000);
})();
```

### 5.3 Selector engine in browser context

Selector generation must run **inside** the iframe (the parent window can't access the iframe's DOM if there were any cross-origin policy). The engine is bundled into `test-recorder.js`:

```javascript
function generateSelector(el, ctx) {
  const conv = ctx.testAttributeConvention; // "data-cy" etc.

  // Priority 1: project test attribute
  if (conv && el.getAttribute(conv)) {
    const sel = `[${conv}="${el.getAttribute(conv)}"]`;
    if (isUnique(sel)) return { selector: sel, strategy: conv };
  }

  // Priority 2: role + accessible name
  const role = el.getAttribute('role') || implicitRole(el);
  const name = accessibleName(el);
  if (role && name) {
    const sel = `getByRole:${role}|${name}`;
    if (isUniqueByRoleName(role, name)) return { selector: sel, strategy: 'role' };
  }

  // Priority 3-7 ... (text, label, placeholder, id, CSS path)
  // ... fall through ...
}

function isUnique(selector) {
  return document.querySelectorAll(selector).length === 1;
}
```

Helper functions: `accessibleName(el)` (computes per WAI-ARIA), `implicitRole(el)` (button/link/textbox/etc by tag), `findLabel(el)` (form field label).

### 5.4 Privacy — auto-redaction

```javascript
function buildFillStep(el) {
  const isPassword = el.type === 'password' || el.autocomplete === 'current-password' || el.autocomplete === 'new-password';
  return {
    type: 'FILL',
    selector: generateSelector(el, ctx).selector,
    value: isPassword ? '{{REDACTED_PASSWORD}}' : el.value,
    redacted: isPassword,
  };
}
```

Parent UI surfaces redacted values with a 🔒 icon and inline "Replace with `{{TEST_USER_PASSWORD}}` env variable?" prompt.

### 5.5 Tokenisation suggestions

After each FILL step arrives at parent, a tokenisation pass runs:

```typescript
function suggestTokens(step: TestStep, env: Environment): TokenSuggestion[] {
  const v = step.value;
  if (v === env.baseUrl) return [{ token: '{{ENV_BASE_URL}}', reason: 'Matches environment base URL' }];
  if (v.match(/^[\w.+-]+@[\w-]+\.[\w.-]+$/)) {
    return [{ token: '{{TEST_USER_EMAIL}}', reason: 'Looks like an email address' }];
  }
  // ... date patterns, common test data fixtures from Environment.testData ...
  return [];
}
```

UI shows inline chip below the value: `💡 Tokenize as {{TEST_USER_EMAIL}}? [Yes] [No]`.

---

## 6. TestStep Schema Additions

Additive only — no breaking changes to `STEP_DEFINITION_SPEC.md`:

```typescript
interface TestStep {
  // ... existing fields ...

  /** Recorder-only — additional locator strategies tried before selector heal */
  fallbackSelectors?: string[];

  /** Recorder-only — true if value was redacted at capture time (e.g. password) */
  redacted?: boolean;

  /** Recorder-only — when this step was captured (for ordering integrity) */
  capturedAt?: string; // ISO 8601
}
```

The executor reads `fallbackSelectors` and tries them in order before invoking the AI healer:

```typescript
// apps/worker/src/executor.ts — augmented
async function findElement(step: TestStep, page: Page) {
  const candidates = [step.selector, ...(step.fallbackSelectors ?? [])];
  for (const sel of candidates) {
    try {
      const el = await page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 })) return el;
    } catch { /* try next */ }
  }
  // All deterministic locators failed → invoke AI healer using step.aiDescription
  return await healSelector(step, page);
}
```

---

## 7. Recorder Page UI

### 7.1 Route

```
/projects/:projectId/features/:featureId/record
?testCaseId=:id     (optional — append to existing test case)
?env=:envId         (optional — pre-select env)
```

Rendered outside `<Shell>` (same pattern as Testing View / Session Run View per `FEATURE_PLAYER.md` §8 routing).

### 7.2 Top action bar

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Login Flow    [Env: Staging ▼]    [● REC]  [⏸]  [⏹]    Steps: 12     │
│                                       [Assert mode: OFF]                  │
│                                                       [Save] [Discard]   │
└──────────────────────────────────────────────────────────────────────────┘
```

| Element | Behaviour |
|---|---|
| `← Feature name` | Returns to feature page; if recording, prompts "Discard recording?" |
| Environment selector | Pre-selects last-used env; disabled while recording |
| `[● REC]` | Starts recording. Becomes red pulse during recording |
| `[⏸]` | Pauses capture (events ignored); can resume |
| `[⏹]` | Stops capture; preserves steps |
| `Steps: N` | Live count of captured steps |
| `Assert mode toggle` | Switches iframe overlay on; clicks become assertion-add actions instead of capture |
| `[Save]` | Save steps to TestCase (creates new or appends) |
| `[Discard]` | Confirms then clears; returns to feature |

### 7.3 Left pane — live step list

```
┌────────────────────────────────────────┐
│ Step 1   NAVIGATE                      │
│ → /login                               │
├────────────────────────────────────────┤
│ Step 2   FILL                          │
│ "Email address" → user@test.com 💡     │
│   Tokenize as {{TEST_USER_EMAIL}}?     │
│   [Yes] [No]                           │
├────────────────────────────────────────┤
│ Step 3   FILL  🔒 redacted             │
│ "Password" → {{REDACTED_PASSWORD}}     │
│   Use {{TEST_USER_PASSWORD}}?          │
│   [Yes] [Set custom] [Keep redacted]   │
├────────────────────────────────────────┤
│ Step 4   CLICK                         │
│ Sign In button                         │
│ ✏ aiDescription: "the Submit button…"  │
└────────────────────────────────────────┘
```

Each step row:
- Step number + type badge (colour-coded per `STEP_EDITOR_SPEC.md`)
- Primary descriptor (URL for nav, label for fill, accessible name for click)
- Captured value (with redaction marker if applicable)
- Inline tokenisation suggestion chip (dismissable)
- Hover actions: `[Edit]`, `[Delete]`, `[Move up/down]`, `[Insert step before]`
- Drag handle on left for reorder
- AI description shown collapsed; click `✏` to expand and edit

### 7.4 Assert mode overlay

When `Assert mode: ON`:
- Right pane iframe gets a dimmed overlay (`bg-black/10 ring-2 ring-yellow-400`)
- Cursor changes to crosshair
- Hovering elements highlights them with a yellow border
- Click an element → modal:
  ```
  Assert what about this element?
  [✓ Visible]  [Has text "..."]  [Has value "..."]  [URL contains "..."]  [Element exists]
  ```
- Choosing one inserts the assertion step into the list, exits assert mode (toggle off)
- `Esc` exits assert mode without inserting

The overlay is drawn into the iframe's document by the recorder script when it receives a `recorder:assert-mode-on` postMessage from parent.

### 7.5 X-Frame fallback — FloatingRecorder

When pre-flight check (`GET /environments/:id/iframe-check` per `MANUAL_TESTING.md`) returns `embeddable: false`:

1. Right pane shows a centered card: "This environment doesn't allow embedding. We'll record in a separate window."
2. `[Open Recorder Window]` button → opens `FloatingRecorder` popup with the env URL
3. Capture script needs to run inside the popup — for MVP, this works only when:
   - The popup is same-origin to the platform (rare in practice), OR
   - The app has integrated the recorder script tag (Phase 3 cooperation)
4. If the popup can't run our script → fallback to "Manual mode": user describes actions in textarea, we generate steps with AI (existing `AI_GENERATION_SPEC.md` pipeline)
5. Document the limitation clearly in MVP — Phase 3 (Chrome extension) solves it properly

### 7.6 Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `R` | Start / Stop recording (focus must be on recorder UI, not iframe) |
| `Space` | Pause / Resume |
| `A` | Toggle assert mode |
| `Cmd+S` | Save |
| `Cmd+Z` | Undo last step (delete most recent) |
| `Esc` | Exit assert mode if on; else prompt close recorder |

---

## 7.6 Review Mode — Verify Before Save

After the user clicks `[⏹ Stop]`, the recorder transitions to **Review Mode** — a dedicated state with a redesigned layout giving the user space and tools to verify the recording before committing it. Save is **NOT** available until the user has explicitly entered Review Mode.

### State machine (extends §12.7)

```
recording → stopping → reviewing → saving → saved
                          ↓
                       discarding → idle
                          ↓
                       resuming → recording   (user wants to add more steps)
```

### Review Mode layout

The two-pane layout shifts: the step list grows, the iframe shrinks but stays interactive for **per-step preview**.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ← Login Flow    Review your recording                    [Discard] [Save]│
│                  12 steps · ~45 seconds            [↺ Resume] [▶ Verify]  │
├──────────────────────────────────┬───────────────────────────────────────┤
│                                  │                                       │
│  STEP LIST (60% width — wider!)  │  IFRAME (40% — preview pane)          │
│                                  │                                       │
│  ┌────────────────────────────┐  │   App iframe paused at last URL.      │
│  │ ▼ Step 1   NAVIGATE        │  │                                       │
│  │   → /login                 │  │   Click any step on the left to       │
│  │   ✏ Edit                   │  │   highlight its target element here   │
│  ├────────────────────────────┤  │   with a yellow ring + scroll into    │
│  │ ▼ Step 2   FILL  💡        │  │   view.                               │
│  │   "Email" → user@test.com  │  │                                       │
│  │   💡 Tokenize as           │  │   Currently showing: Step 4           │
│  │      {{TEST_USER_EMAIL}}?  │  │   ⌖ Sign In button                   │
│  │   [Yes] [No]               │  │                                       │
│  ├────────────────────────────┤  │                                       │
│  │ ▼ Step 3   FILL 🔒         │  │                                       │
│  │   "Password" → REDACTED    │  │                                       │
│  ├────────────────────────────┤  │                                       │
│  │ ◉ Step 4   CLICK   ←active │  │                                       │
│  │   Sign In button           │  │                                       │
│  │   ✏ aiDescription:         │  │                                       │
│  │     "the Submit button at  │  │                                       │
│  │     the bottom of the      │  │                                       │
│  │     LoginForm component"   │  │                                       │
│  │   ⚠ matched 2 elements →   │  │                                       │
│  │     [Auto-fix selector]    │  │                                       │
│  ├────────────────────────────┤  │                                       │
│  │ ▼ Step 5   ASSERT_TEXT     │  │                                       │
│  │   "Welcome" visible        │  │                                       │
│  ├────────────────────────────┤  │                                       │
│  │  ... + 7 more              │  │                                       │
│  └────────────────────────────┘  │                                       │
│                                  │                                       │
│  [+ Add Manual Step]             │                                       │
└──────────────────────────────────┴───────────────────────────────────────┘
```

### What's available in Review Mode (and not before)

| Affordance | What it does |
|---|---|
| **Click any step → highlight in iframe** | Iframe scrolls to the captured element, draws a yellow ring around it. Confirms the recording targeted what the user thought. **Available in MVP.** |
| **Step expansion shows full detail** | `selector`, `fallbackSelectors[]`, `aiDescription`, `expectedOutcome` all visible per step (collapsed by default during recording). |
| **Per-step validation status badges** | Each step shows `✓ Selector unique` / `⚠ Selector matched N elements` / `✗ Selector matches nothing now`. Re-validated against current iframe DOM on entry to Review Mode. |
| **`[Auto-fix selector]` action** | For warnings/errors, re-runs the selector engine against the current DOM and proposes a new selector. User clicks Accept or Edit. |
| **Tokenisation suggestions surface fully** | Inline chips below FILL steps; user accepts/rejects per step (these were dismissable during recording, more prominent in review). |
| **Drag-to-reorder with bigger handles** | Easier to fix step ordering when not also recording. |
| **Inline edit any field** | Selector, value, name, description — all editable without leaving review. |
| **`[+ Add Manual Step]`** | Insert a step by hand (e.g. WAIT, SCREENSHOT, COMMENT) that the recorder didn't capture. |
| **`[↺ Resume Recording]`** | Goes back to `recording` state — lets user add more steps to the same session if they realised they missed something. |
| **`[▶ Verify]` (Phase 2)** | Dry-run the recording in the iframe (or via screencast from worker) to confirm it plays back correctly. **MVP scope: button visible but disabled with "Coming in v1.1" tooltip.** |
| **`[Save]`** | Opens the save modal (per §8). Disabled if any step has a hard error (selector matches nothing). Warnings allow save with confirmation. |
| **`[Discard]`** | Confirmation dialog → returns to feature page. State cleared. |

### Per-step preview — the MVP verification mechanism

This is the key MVP affordance. Without it, the user is reviewing JSON-shaped step descriptions in the abstract. With it, they get visual confirmation:

**How it works:**

1. User clicks Step 4 in the list
2. Parent sends `postMessage({ type: 'recorder:highlight', selector: 'data-cy=login-submit' })` to iframe
3. Recorder script in iframe:
   - Runs `document.querySelector(selector)`
   - If found: scrolls element into view, applies `outline: 3px solid #facc15; outline-offset: 4px` for 3 seconds
   - If not found: postMessage back `recorder:highlight-failed` → parent shows ⚠ badge on that step
4. User sees exactly which button/input/element each step targets
5. User can compare against the screenshot taken at capture time (we already have it in `step.captureContext.screenshot`)

**Why this works:** the iframe is still the same app at the same URL the user left it. The selectors should still resolve. If they don't (DOM changed since capture), the user sees that immediately and can `[Auto-fix selector]` before saving — preventing day-one flake.

### Re-validation on Review Mode entry

When `stopping → reviewing` transitions, run §12.8 validation **immediately**:

```typescript
async function enterReviewMode() {
  setStatus('reviewing');
  const report = await validateAllStepsAgainstIframe(steps);
  // Annotate each step in the store with: { validationStatus, matchCount }
  // UI re-renders with badges visible
  // If any errors: scroll to first error
  // If all good: show "✓ All 12 steps validated against current page" green banner
}
```

This catches the most common recorder bug: the user clicked a button that was modal-only, the modal has since closed, the selector now matches 0 elements. Better to surface in Review Mode than at first run.

### `[▶ Verify]` button — Phase 2 enhancement (not MVP)

Phase 2 (per `docs/future/TEST_RECORDER_PHASE_2.md`) adds a real dry-run:

- Click `[▶ Verify]` → iframe resets to first NAVIGATE URL
- Steps execute one-by-one in the iframe (via in-browser playback) OR via screencast from the Playwright worker
- Per-step status updates in real time
- On completion: green "Verified ✓ — 12/12 passed" or red "Step 7 failed — element not found"
- User can then fix the failing step OR `[Save anyway]`

For MVP, the button is present but disabled with a "Coming in v1.1" tooltip — sets the expectation, primes the codepath. The validation in §12.8 + per-step preview cover most of the verification need without building a playback engine.

### Save flow update — Save is gated on Review Mode

Update §8.1: the `[Save]` button **does not exist** during the `recording` or `paused` states. It only appears in `reviewing` state. This forces every recording to pass through review before committing.

Old top-bar layout (recording state):

```
[← Login Flow]  [Env ▼]  [● REC] [⏸] [⏹]   Steps: 12   [Save] [Discard]
                                                        ↑ available always — TOO EASY
```

New top-bar layout:

```
RECORDING:  [← Login Flow]  [Env ▼]  [● REC] [⏸] [⏹]   Steps: 12   [Discard]
                                                       ↑ no Save during recording
PAUSED:     [← Login Flow]  [Env ▼]  [▶ Resume] [⏹]    Steps: 12   [Discard]
REVIEWING:  [← Login Flow]  Review your recording...  [↺ Resume] [▶ Verify*] [Discard] [Save]
                                                                  ↑ disabled MVP
SAVING:     [← Login Flow]  Saving...                              (all buttons disabled)
```

This adds friction *exactly where friction is good*: at the moment of commitment.

### Acceptance criteria additions (rolled into §13)

- [ ] After clicking `[⏹ Stop]`, recorder transitions to Review Mode automatically
- [ ] Save button is hidden/unavailable during `recording` and `paused` states; only appears in `reviewing` state
- [ ] Entry to Review Mode runs §12.8 validation; per-step badges (✓/⚠/✗) update within 500ms
- [ ] Clicking a step in the list highlights its target element in the iframe with yellow ring + scroll-into-view, fading after 3s
- [ ] If selector matches 0 elements, badge shows ✗; clicking the step shows tooltip "Element not found in current page state"
- [ ] If selector matches >1 elements, badge shows ⚠ with `[Auto-fix selector]` action that re-runs the engine
- [ ] `[↺ Resume Recording]` button transitions back to `recording`; new steps append after existing ones
- [ ] `[▶ Verify]` button is visible but disabled in MVP with tooltip "Dry-run verification coming in v1.1"
- [ ] `[Save]` is disabled if any step has a hard error (matches 0); enabled with warning confirmation if any have warnings
- [ ] All step fields (name, selector, value, aiDescription, fallbackSelectors) are inline-editable in Review Mode
- [ ] Tokenisation suggestion chips appear more prominently in Review Mode than during recording (always shown if applicable, not auto-collapsed)

---

## 7.7 Dual-Mode Output — Recorded Tests Are Manual AND Automated

A recorded `TestCase` is **not** tagged for one execution mode. It's a normal `TestCase` that the platform's existing dual-mode system can run either way. The tester picks the mode at run time in the Testing View top action bar.

### What each mode reads from a recorded step

| Field | Used by | Purpose |
|---|---|---|
| `name` | Both | Step title shown in checklist (manual) or progress bar (automated) |
| `aiDescription` | Manual + AI Healer | Human-readable instruction in checklist; healer fallback when selectors miss |
| `expectedOutcome` | Manual | "What should happen" line under the step |
| `selector` | Automated | Primary Playwright locator |
| `fallbackSelectors[]` | Automated | Tried in parallel before AI healer |
| `value` | Both | The string to type / select; manual mode shows it as "Type **{value}**" |
| `type` | Both | Drives the rendering template |
| `timeoutMs` | Automated | Per-step timeout |
| `redacted` | Both | Manual shows 🔒; automated substitutes from `{{ENV_VAR}}` |

The recorder populates all of these at capture time. Both modes get the data they need without re-authoring.

### StepRenderer — the translation layer

`apps/web/src/components/manual/StepRenderer.tsx` reads any `TestStep` and produces a manual-mode instruction:

```typescript
function renderStepInstruction(step: TestStep): JSX.Element {
  switch (step.type) {
    case 'NAVIGATE':      return <>Navigate to <strong>{step.value}</strong></>;
    case 'CLICK':         return <>Click {describe(step)}</>;
    case 'FILL':          return <>Type <strong>{maskIfRedacted(step.value)}</strong> into {describe(step)}</>;
    case 'SELECT':        return <>Select <strong>{step.value}</strong> from {describe(step)}</>;
    case 'ASSERT_TEXT':   return <>Verify <strong>"{step.value}"</strong> is visible on the page</>;
    case 'ASSERT_URL':    return <>Verify the URL contains <strong>{step.value}</strong></>;
    case 'KEYBOARD':      return <>Press the <strong>{step.value}</strong> key</>;
    // ... covers all 22 step types
  }
}

function describe(step: TestStep): string {
  // Prefer aiDescription (recorder-generated, human-readable)
  // Fall back to selector (e.g. for hand-authored steps without aiDescription)
  return step.aiDescription ?? `the element matching ${step.selector}`;
}
```

This component already exists in the platform per `docs/MANUAL_TESTING.md` — recorded steps just feed it richer data than hand-typed steps did before.

### Recording produces zero manual-mode-specific work

The recorder writes a TestCase. That TestCase shows up in:
- Feature page test list (with normal `[▶ Test]` action)
- Testing View → Manual mode → walks through as checklist
- Testing View → Automated mode → Playwright executes
- Test history / runs page
- PDF reports
- Sign-off flows

No "is this a recorded test?" branching anywhere except telemetry (`authoringMethod` enum) and a small badge in the test editor that says "📹 Recorded on May 4, 2026".

### Why this is the right architecture

Most QA platforms force a choice: this test is **either** an automation script **or** a manual procedure. They drift apart. We unify them:

- **Mode switching during debug** — automated fails on CI? Open in Manual mode, walk through, see if it's the app or the test.
- **No double-write** — record once, get both modes; no parallel "manual procedure doc" to maintain.
- **Production-safe** — same test runs automated on staging + manually on production where bots aren't allowed.
- **Training & onboarding** — new QA walks through recorded tests in Manual mode to learn the app; zero risk.
- **UAT handoff** — UAT testers walk through recorded happy-paths manually; QA team automates them; both teams use the same record.

---

## 7.8 Flow — Feature → Record → Both Modes

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. FEATURE PAGE                                                       │
│    User clicks [● Record New Test] in test list header               │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 2. ENVIRONMENT PICKER MODAL (lightweight — only if multiple envs)    │
│    "Record against:  [Staging ▼]"           [Cancel] [Start Recording]│
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 3. RECORDER PAGE                                                      │
│    Iframe loads env baseUrl. User clicks [● REC]. Performs flow.      │
│    Steps stream into left pane in real time.                          │
│    Optional: assert mode → click elements to add assertions.          │
│    User clicks [⏹ Stop]. Reviews. Edits if needed.                    │
│    User clicks [Save].                                                │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 4. SAVE MODAL                                                         │
│    Name: [Login with valid creds]    (AI-suggested from first nav)   │
│    Description: [...]                                                 │
│    Tags: [smoke] [happy-path]                                         │
│                            [Cancel] [Save]                            │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │ POST /test-cases
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 5. TEST EDITOR PAGE                                                   │
│    User reviews the saved test. Sees green "📹 Recorded on May 4"    │
│    badge. Can edit, add waits, refine assertions.                     │
└─────────────────────────────────────┬─────────────────────────────────┘
                                      │ user clicks [▶ Test] OR navigates back
                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 6. TESTING VIEW (per docs/FEATURE_PLAYER.md)                          │
│    [← Login Flow]  [Env ▼]  [● Manual | ○ Automated]  [▶ Start]     │
│                              ↑                                        │
│                  Mode toggle — picked at RUN time                     │
└──────────┬───────────────────────────────────────┬───────────────────┘
           │                                       │
           ▼                                       ▼
   MANUAL MODE                            AUTOMATED MODE
   ──────────────                         ────────────────
   Left: step checklist                   Left: step list w/ ⟳/✅/❌
   Right: app iframe                      Right: LiveBrowserCanvas
   User clicks Pass/Fail                  Playwright runs steps
   per step, adds notes,                  Selector heal kicks in
   uploads screenshots.                   if a locator misses.
   Creates TestRun                        Creates TestRun
   { runMode: MANUAL }                    { runMode: AUTOMATED }
                          │                         │
                          ▼                         ▼
                    ┌──────────────────────────────────┐
                    │ TEST RUN HISTORY (unified)       │
                    │  • Run #47   AUTOMATED  ✅ Pass  │
                    │  • Run #46   MANUAL     ❌ Fail  │
                    │  • Run #45   AUTOMATED  ✅ Pass  │
                    │ Both modes counted in stats      │
                    │ alongside hand-authored tests.   │
                    └──────────────────────────────────┘
```

**Key acceptance criterion (added to §13):**

- [ ] A test recorded once can be played back in both modes from the same `TestCase` record without modification — verified by recording a 5-step login, running it Automated (passes), running same TestCase in Manual mode (rendered as checklist with auto-translated instructions), then running Automated again (still passes)

---

## 8. Save Flow

When user clicks `[Save]`:

```
1. Validate step list non-empty
2. If creating new TestCase:
     a. Open "Save Recording" modal:
        - Name input (required, AI-suggested from first nav step)
        - Description textarea (optional)
        - Type: UI (locked — recorder always UI)
        - Tags (optional)
     b. POST /api/v1/features/:fId/test-cases
        Body: {
          name, description, type: 'UI', tags,
          authoringMethod: 'RECORDED',
          recordedAt: <recording start time>,
          recordedDurationSec: <delta>,
          steps: [...]
        }
3. If appending to existing TestCase:
     PATCH /api/v1/test-cases/:id/steps
     Body: { append: [...newSteps] }
4. On success: navigate to TestEditorPage to review
5. Toast: "Recorded test saved with N steps"
```

**Recorder never auto-runs the test after save.** User reviews in editor first; runs it manually from there. This avoids surprise of a recorded test failing immediately due to selector drift between record and run environments.

---

## 9. REST API

```
GET    /api/v1/projects/:projectId/test-attribute-conventions
       → { convention: "data-cy" | "data-testid" | ..., count: 247 }

POST   /api/v1/recorder/sessions/start
       Body: { projectId, featureId, environmentId, testCaseId? }
       Returns: { sessionId, recorderScriptUrl, signedToken }
       (sessionId tracks the recording in Redis for analytics; nothing persists yet)

POST   /api/v1/recorder/sessions/:sessionId/append
       Body: { step: TestStep }
       (Optional — for resilience against page refresh; MVP can skip and keep
        steps client-side only, requiring user to save before navigating away)

POST   /api/v1/recorder/sessions/:sessionId/finalize
       Body: { name, description, tags, testCaseId? }
       Returns: { testCaseId } — creates or appends

DELETE /api/v1/recorder/sessions/:sessionId   (discard)

POST   /api/v1/recorder/ai/describe-element
       Body: { elementHtml, surroundingText, pageRoute, projectId }
       Returns: { description: string }
       (Calls codebase RAG + LLM to generate aiDescription)
```

For MVP, the simplest implementation skips `/append` and keeps the step buffer entirely client-side in Zustand store, persisted to localStorage every 2s as crash insurance. Server-side session storage is a polish in Phase 2.

---

## 10. Service Layer

### 10.1 New backend services

```typescript
// apps/api/src/recorder/recorder.service.ts
@Injectable()
export class RecorderService {
  constructor(
    private db: PrismaService,
    private codebaseRag: CodebaseRagService,
    private ai: AiService,
  ) {}

  async detectTestAttributeConvention(projectId: string): Promise<{ convention: string; count: number }> {
    // Counts occurrences of each convention in indexed code
    // Returns most-used; null if no conventions detected
  }

  async describeElement(input: DescribeElementInput): Promise<{ description: string }> {
    const componentHint = await this.codebaseRag.findComponentByRoute(input.projectId, input.pageRoute);
    return this.ai.runTask('selector-description', {
      ...input,
      componentHint,
    });
  }

  async finalizeRecording(sessionId: string, params: FinalizeParams): Promise<TestCase> {
    // ... creates TestCase or appends ...
  }
}
```

### 10.2 New AI task

`SELECTOR_DESCRIPTION` added to `AiTaskType` in `docs/AI_LAYER.md`.

Prompt template `apps/api/src/ai/prompts/selector-description.hbs`:

```handlebars
You generate concise natural-language descriptions of HTML elements that an AI healer can use to find them again on a web page.

Element HTML: {{elementHtml}}
Surrounding text on page: {{surroundingText}}
Page route: {{pageRoute}}
{{#if componentHint}}Component context: {{componentHint.componentName}} in {{componentHint.filePath}}{{/if}}

Output a single sentence (max 120 characters) describing this element in terms a human would use. Examples:
- "the Submit button at the bottom of the LoginForm"
- "the email input field with placeholder 'you@example.com'"
- "the Logout link in the top navigation"

Description:
```

Output: plain string (no JSON wrapping for this simple task).

### 10.3 Frontend state management

```typescript
// apps/web/src/stores/recorderStore.ts
interface RecorderState {
  sessionId:    string | null;
  status:       'idle' | 'recording' | 'paused' | 'saving';
  steps:        TestStep[];
  assertMode:   boolean;
  testAttributeConvention: string | null;

  startRecording: (params) => Promise<void>;
  appendStep:     (step: TestStep) => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording:  () => void;
  toggleAssertMode: () => void;
  editStep:       (idx, patch) => void;
  deleteStep:     (idx) => void;
  reorderStep:    (from, to) => void;
  save:           (params) => Promise<TestCase>;
  discard:        () => void;
}
```

Zustand with `persist` middleware → `localStorage` autosave every 2s → restore prompt on page reload mid-recording.

---

## 11. Entry Points

Three places in the existing UI to start a recording:

### 11.1 Feature page — primary entry

```
┌──────────────────────────────────────────────────────────────┐
│  Login Flow                  [Published v3.0]  [▶ Run All]   │
│                                              [● Record New]  │
└──────────────────────────────────────────────────────────────┘
```

Click `[● Record New]` → navigates to `/projects/:pId/features/:fId/record`.

### 11.2 Test Editor — append to existing

In the existing `TestEditorPage`, top of step list:

```
[+ Add Step ▼]   [● Record more steps]
```

`[● Record more steps]` → navigates to `/.../record?testCaseId=:id` → recorded steps append to existing test on save.

### 11.3 Testing View — record while testing

In Testing View (`FEATURE_PLAYER.md`), top action bar gains a `[● Record]` action when in Manual mode:

```
[← Login Flow]  [Env ▼]  [Manual | Automated]  [● Record]  [▶ Start]  [✕]
```

Clicking switches the right panel from manual iframe to recorder iframe (same iframe; just enables capture script). Useful for "I'm exploring manually and want to capture this flow."

---

## 12. Performance, Robustness & Failure Modes

**Concrete budgets, back-pressure design, and failure recovery.** Every external dependency (AI, RAG, iframe, localStorage, network) has a degraded-mode path so the recorder stays usable when things go wrong.

### 12.1 Performance budgets (measured, not aspirational)

| Operation | Budget | How we hit it |
|---|---|---|
| Click → step appended in left pane | **<100ms p95** | Selector engine completes synchronously; AI description deferred (§12.3). Measured via `performance.mark` in capture script + Sentry timing. |
| Selector generation per element | **<20ms p95** | Cap querySelectorAll candidates; bounded DOM walk depth (max 12); fail-fast cache (§12.2). |
| Live step list re-render | **<50ms** | React Query optimistic update + virtual list when steps > 50. |
| Recorder page initial load (iframe loaded) | **<3s on broadband** | Lazy-load AI description endpoint; pre-warm hierarchy cache; iframe loads in parallel with recorder shell. |
| Save flow (50 steps) | **<2s** | Single `prisma.testCase.create` transaction with nested step writes; no per-step API calls. |
| Replay of recorded test (worst case 5 fallbacks miss) | **<3s per failed step** | Parallel locator evaluation (§12.10), not sequential. |

### 12.2 Selector engine performance

The naive implementation is O(N priorities) querySelectorAll calls per element + WAI-ARIA accessible-name walk + DOM-tree ascent. On a 10k-node SPA, that's 5-50ms per click and the user feels lag.

**Mitigations baked into the engine:**

```javascript
// 1. Hard timeout per element — bail out gracefully
function generateSelector(el, ctx) {
  const deadline = performance.now() + 20; // 20ms hard cap
  for (const strategy of PRIORITY_ORDER) {
    if (performance.now() > deadline) {
      logTelemetry('selector-timeout', { strategy, route: location.pathname });
      return fallbackToCssPath(el); // immediate, deterministic
    }
    const candidate = tryStrategy(strategy, el, ctx);
    if (candidate && isUnique(candidate)) return candidate;
  }
  return fallbackToCssPath(el);
}

// 2. Memoize accessible-name computation per element (WeakMap, GC-friendly)
const accessibleNameCache = new WeakMap();

// 3. Cap querySelectorAll candidates with `:scope` + `[hidden]:not()` filters
function isUnique(selector) {
  // Skip hidden elements that aren't part of the user-visible page
  const matches = document.querySelectorAll(`${selector}:not([hidden])`);
  return matches.length === 1;
}

// 4. Bounded DOM walk for CSS path fallback (max depth 12 — beyond which we use position-based)
const MAX_PATH_DEPTH = 12;
```

**Telemetry at every step:** record `selectorStrategy`, `selectorGenerationMs`, `domNodeCount` per captured step. Surface in `WebhookEvent`-like `RecorderTelemetry` table for tuning.

### 12.3 AI description generation — back-pressured queue

**The naive design** (calls AI synchronously per step) breaks at 5+ events per second. Real solution:

```typescript
// Frontend: capture script appends step IMMEDIATELY with placeholder description
appendStep({
  ...step,
  aiDescription: '⏳ generating…',
  aiDescriptionStatus: 'pending',
});

// Background queue worker (in browser, NOT server)
class AIDescriptionQueue {
  private queue: TestStep[] = [];
  private inflight = 0;
  private MAX_CONCURRENT = 2;
  private MAX_QUEUE = 100;

  enqueue(step: TestStep) {
    if (this.queue.length >= this.MAX_QUEUE) {
      // Drop oldest pending — user has moved on; show ⚠ in UI
      const dropped = this.queue.shift();
      dropped.aiDescriptionStatus = 'skipped';
    }
    this.queue.push(step);
    this.tick();
  }

  private async tick() {
    while (this.inflight < this.MAX_CONCURRENT && this.queue.length > 0) {
      const step = this.queue.shift();
      this.inflight++;
      this.processOne(step).finally(() => {
        this.inflight--;
        this.tick();
      });
    }
  }

  private async processOne(step: TestStep) {
    try {
      const desc = await api.recorder.describeElement(step.captureContext);
      updateStepDescription(step.localId, desc);
    } catch (err) {
      // Degraded — fall back to non-AI description (visible text + tag name)
      updateStepDescription(step.localId, fallbackDescription(step), 'fallback');
    }
  }
}
```

**Server-side batching:** `POST /api/v1/recorder/ai/describe-element` accepts both single-element AND batch payloads. Frontend coalesces queued requests every 200ms into a batch of up to 5. Single LLM call returns 5 descriptions. Cost and latency drop ~3-5x.

**Save behaviour:** save NEVER blocks on pending descriptions. If user saves with 3 descriptions still in flight, save proceeds with placeholder text; descriptions complete and patch via `PATCH /test-cases/:id/steps/:idx/description` post-save.

### 12.4 Codebase RAG dependency — three-tier fallback

| RAG state | Behaviour |
|---|---|
| **Connected, fast** | Use as primary for `aiDescription` component context + selector convention detection |
| **Connected but slow (>500ms)** | First call detects slowness via timeout → switch session to "convention-only" mode (use cached convention, skip per-step component lookup) |
| **Not connected / down** | Skip RAG entirely; AI description uses page DOM only ("the Submit button containing text Sign In"). Selector convention detection returns `null` → priority 1 falls through to role-based |

**Convention detection cached aggressively:**
- Per-project Redis cache `recorder:convention:{projectId}`, TTL 24h
- Invalidated on repo re-index event
- Pre-warmed on `/recorder/sessions/start` so the recorder loads with it ready

### 12.5 Memory bounds

| Resource | Soft cap | Hard cap | Behaviour at hard cap |
|---|---|---|---|
| Step buffer (Zustand) | 200 steps | 500 steps | Top bar warning at 200 ("Long recording — consider saving"); hard refusal at 500 with toast "Save and start a new recording" |
| `fallbackSelectors[]` per step | 5 | 5 | Cap enforced by selector engine output |
| `aiDescription` length | 120 chars | 200 chars | Truncated server-side |
| localStorage payload | 2 MB | 4 MB | Telemetry compression (drop captureContext after AI desc generated); warn user; refuse new captures at hard cap |
| Capture event burst | 10 events / 100ms | 50 events / 100ms | Rate-limit telemetry; coalesce duplicate events (e.g. 5 scrolls in 100ms → 1 step) |

**localStorage quota detection:**

```typescript
function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      // Compress: drop captureContext from saved steps (server-only need)
      const compressed = compressRecorderState(value);
      try {
        localStorage.setItem(key, compressed);
        showToast('Recording state compressed to fit storage', 'warning');
        return true;
      } catch {
        showToast('⚠ Storage full — recording crash recovery disabled. Save soon!', 'error');
        return false;
      }
    }
    throw err;
  }
}
```

### 12.6 Iframe failure detection + recovery

The 2s heartbeat I mentioned wasn't fleshed out. Here's the proper design:

```typescript
// Parent watcher
class IframeHealthMonitor {
  lastHeartbeat = Date.now();
  state: 'healthy' | 'lagging' | 'lost' = 'healthy';

  onHeartbeat(payload: { url: string; route: string }) {
    this.lastHeartbeat = Date.now();
    if (this.state !== 'healthy') {
      this.transitionTo('healthy');
    }
    if (this.lastKnownUrl !== payload.url) {
      this.handleNavigation(payload.url);
    }
  }

  // Tick every 1s
  tick() {
    const elapsed = Date.now() - this.lastHeartbeat;
    if (elapsed > 5000 && this.state === 'healthy') {
      this.transitionTo('lagging');
      // UI shows yellow indicator: "Iframe slow to respond"
    }
    if (elapsed > 15000 && this.state === 'lagging') {
      this.transitionTo('lost');
      // UI shows red banner with [Reload Iframe] [Save & Exit] buttons
      // Capture is paused; user steps preserved
    }
  }

  handleNavigation(newUrl: string) {
    if (isCrossOrigin(newUrl, this.originalOrigin)) {
      // Capture script can't run in cross-origin destination
      this.transitionTo('lost-cross-origin');
      // UI: "App navigated to {newUrl} which we can't record. [Reload original] [Save & Exit]"
    }
  }
}
```

**UI states surfaced:**
- 🟢 Recording (default)
- 🟡 "Iframe lagging — last response 7s ago"
- 🔴 "Lost connection to iframe" + reload button
- 🔴 "App navigated cross-origin — can't record there" + return button

User's captured steps are **never lost** during iframe issues — they live in the parent's Zustand store + localStorage.

### 12.7 Race conditions — explicit state machine

The recorder has a state machine, not boolean flags:

```typescript
type RecorderState =
  | { status: 'idle' }
  | { status: 'starting'; startedAt: number }
  | { status: 'recording' }
  | { status: 'pausing' }                    // pause requested, debounced events still arriving
  | { status: 'paused' }
  | { status: 'stopping' }                   // stop requested, drain in-flight events
  | { status: 'stopped' }
  | { status: 'saving'; idempotencyKey: string }
  | { status: 'saved'; testCaseId: string }
  | { status: 'discarding' };

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  idle:       ['starting'],
  starting:   ['recording', 'idle'],
  recording:  ['pausing', 'stopping'],
  pausing:    ['paused', 'recording'],       // debounced events drain into paused state
  paused:     ['recording', 'stopping'],
  stopping:   ['stopped'],
  stopped:    ['saving', 'discarding', 'recording'], // can resume
  saving:     ['saved'],
  saved:      ['idle'],
  discarding: ['idle'],
};
```

**Specific race fixes:**

1. **Save while debounced FILL pending** — `transitionTo('stopping')` flushes all pending debounced events FIRST, waits 600ms (max debounce window), then advances to `stopped`. Save proceeds with all events captured.

2. **Pause then Stop quickly** — `pausing → paused → stopping → stopped`. Each transition gates on the next; UI button disabled during transitional states.

3. **Multi-click Save** — every save attempt generates an `idempotencyKey` (UUID); server rejects duplicate keys within 5min Redis cache → returns the original `testCaseId`. UI button is also disabled for `status === 'saving'`.

4. **Capture event after Stop** — events arriving in `stopped` state are dropped silently with telemetry log (helps detect timing bugs).

### 12.8 Save-time validation

At save time, re-run uniqueness check on every selector against the LIVE iframe DOM:

```typescript
async function validateBeforeSave(steps: TestStep[]): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  for (const [i, step] of steps.entries()) {
    if (!step.selector) continue;
    const matches = await iframeQuery(step.selector);
    if (matches.length === 0) {
      issues.push({ stepIndex: i, severity: 'error', message: 'Selector matches nothing' });
    } else if (matches.length > 1) {
      issues.push({ stepIndex: i, severity: 'warning', message: `Selector matches ${matches.length} elements` });
    }
  }
  return { issues, canSave: !issues.some(i => i.severity === 'error') };
}
```

If issues exist, save modal shows them grouped with `[Auto-fix]` (re-runs selector engine on current DOM) or `[Save anyway]` options. Errors block save by default; warnings allow with confirmation.

### 12.9 Concurrent recording sessions (org-level concerns)

| Concern | Mitigation |
|---|---|
| AI provider rate limit hit by 10 users recording simultaneously | Per-org token bucket on `SELECTOR_DESCRIPTION` AI task — 60 calls/min/org. On exhaust, frontend falls back to non-AI description with "AI quota reached, descriptions will use plain text" toast. |
| RAG saturation under concurrent load | Convention detection cached 24h (§12.4) so only first session per day pays the RAG cost. Per-step component lookups cached per route in Redis 1h. |
| Recorder sessions left open / abandoned | Session row created on start; `lastActiveAt` heartbeat every 30s; sessions inactive >2h auto-cleaned by nightly cron. |
| One user's runaway session crashing AI calls for whole org | Per-user concurrent session cap = 1 (enforced at session-start endpoint). User must stop existing session before starting new one. |

### 12.10 Replay performance — fallbackSelectors don't kill us

The naive executor change (try `selector` then each `fallbackSelectors[i]` sequentially with 2s timeout each) means worst case is 5 × 2s = 10s lost per failed step. Multiplied across a flaky test, that's minutes of waste.

**Better: parallel evaluation:**

```typescript
async function findElement(step: TestStep, page: Page): Promise<Locator> {
  const candidates = [step.selector, ...(step.fallbackSelectors ?? [])];

  // Race all candidates with a SHORT individual timeout
  const results = await Promise.allSettled(
    candidates.map(sel => page.locator(sel).first().waitFor({ state: 'attached', timeout: 1500 }))
  );

  const winner = results.findIndex(r => r.status === 'fulfilled');
  if (winner !== -1) {
    if (winner > 0) {
      // Telemetry: primary selector failed, fallback #N succeeded
      recordSelectorTelemetry({ stepId: step.id, primaryFailed: true, fallbackUsed: winner });
    }
    return page.locator(candidates[winner]).first();
  }

  // All deterministic locators failed → AI healer
  return await healSelector(step, page);
}
```

Worst case: 1.5s (all fail in parallel). Best case: instant.

**Telemetry feedback loop:** when a fallback wins, record which one. Over time, we can promote frequently-winning fallbacks to be the primary selector — automatic "selector healing without the AI cost."

### 12.11 Error surfacing — every silent failure becomes a visible signal

Specific things that currently fail silently (or would in a v1 implementation) — all surfaced explicitly:

| Failure | Today's risk | Fix |
|---|---|---|
| `postMessage` from iframe to parent fails (e.g. parent navigated away) | Capture script keeps sending to nothing | Heartbeat ack from parent; if 3 acks missed, capture script self-disables and shows in-iframe toast "Recorder lost connection to platform" |
| AI description endpoint 500s | Step has placeholder forever | Status badge per step: `⏳ generating` / `✓ described` / `⚠ failed (retry)` — user can click retry per-step |
| localStorage quota exceeded | State silently dropped | §12.5 explicit handling with user toast |
| RAG endpoint timeout | Long save delay | 500ms timeout → degrade silently to non-RAG path; one-time toast "RAG unavailable, descriptions will be less specific" |
| Iframe navigates cross-origin | Recorder shows green but captures nothing | §12.6 cross-origin detection + red banner |
| User's network goes offline mid-recording | Save fails when attempted | Capture continues (it's all client-side); save attempt detects offline → "Offline — saved locally; will retry on reconnect"; auto-retries via `online` event listener |

### 12.12 Telemetry — measure what we built

Without telemetry we can't tune. New table:

```prisma
model RecorderTelemetry {
  id                String   @id @default(uuid())
  orgId             String
  userId            String
  sessionId         String

  eventType         String   // "session.start", "step.captured", "ai.description.success", etc.
  metadata          Json     // { selectorStrategy, generationMs, fallbackCount, ... }

  recordedAt        DateTime @default(now())

  @@index([orgId, sessionId, recordedAt])
  @@index([eventType, recordedAt])
  @@map("recorder_telemetry")
}
```

Sampled at 100% in MVP, retained 30 days. Powers a private admin dashboard:
- p95 selector generation time per project
- AI description failure rate per provider
- Average steps per recording
- Sessions per user per week
- Fallback selector hit rate (informs the "promote fallback to primary" optimization)

### 12.13 Load test plan

Before MVP ships, run synthetic load:

| Scenario | Target | Pass criteria |
|---|---|---|
| 10 concurrent recording sessions in same org | 60s recording each, 30 steps avg | All sessions complete; AI desc completion p95 <5s; no 429s |
| 1 user records 500-step session | Step append latency stays <100ms p95 | UI doesn't degrade visibly |
| 50 steps, all heavily-nested DOM (10k nodes) | Selector generation p95 <30ms | No timeouts; no fallback to brittle CSS path more than 10% |
| Save 200-step test case | <3s wall time | Single Prisma transaction; no N+1 queries |
| Iframe disconnects mid-recording | UI transitions through lagging → lost in <20s | User can save partial recording; no state loss |

---

## 13. Acceptance Criteria

### Capture

- [ ] User clicks `[● Record New]` on feature page → `/.../record` opens with recorder UI, iframe loads env baseUrl, capture script injected
- [ ] X-Frame pre-flight detects blocked → FloatingRecorder fallback shown with clear messaging
- [ ] Click in iframe creates a `CLICK` step in the live list within 200ms of the click
- [ ] Typing in a text input creates a single `FILL` step (debounced 500ms — final value, not per-keystroke)
- [ ] Selecting a `<select>` option creates a `SELECT` step
- [ ] Navigating (full page load OR SPA pushState) creates a `NAVIGATE` step
- [ ] Pressing Enter / Tab / Escape / Arrow keys creates a `KEYBOARD` step
- [ ] Pressing character keys does NOT create extra steps (covered by FILL)
- [ ] Scrolling >200px creates a `SCROLL` step (debounced 600ms)
- [ ] `[⏸]` pauses capture; events while paused are ignored; `[▶ Resume]` re-enables
- [ ] `[⏹]` stops capture; existing steps preserved

### Selector engine

- [ ] Project with `data-cy` convention in code → recorded step uses `[data-cy="..."]` as primary selector
- [ ] Project with no test attributes → primary falls through to role-based locator
- [ ] If primary selector matches >1 element, engine refines until unique (combines with text, position)
- [ ] Every step has both `selector` AND `aiDescription` populated
- [ ] `fallbackSelectors[]` populated with at least 2 alternatives where possible
- [ ] AI description is ≤120 characters and references component name when codebase RAG available

### Assert mode

- [ ] Toggle Assert mode ON → iframe shows yellow ring + dimmed overlay
- [ ] Hovering element highlights it
- [ ] Clicking element opens assertion picker modal
- [ ] Selecting `[✓ Visible]` inserts `ASSERT_VISIBLE` step with selector
- [ ] Selecting `[Has text]` opens text input pre-filled with element's text → inserts `ASSERT_TEXT`
- [ ] Selecting `[URL contains]` pre-fills current URL substring
- [ ] After insertion, assert mode auto-toggles OFF
- [ ] `Esc` exits assert mode without inserting

### Privacy

- [ ] Password input field → captured value is `{{REDACTED_PASSWORD}}`, `redacted: true` flag set
- [ ] Step row shows 🔒 icon with "Use {{TEST_USER_PASSWORD}}?" suggestion
- [ ] Email-format value → "Tokenize as {{TEST_USER_EMAIL}}?" suggestion appears
- [ ] Value matching env baseUrl → "Tokenize as {{ENV_BASE_URL}}?" suggestion
- [ ] Dismiss suggestion → chip disappears; value remains literal

### Save flow

- [ ] `[Save]` with empty step list → button disabled
- [ ] Save modal: name field required; AI suggests name from first nav step (e.g. "Login → /dashboard")
- [ ] Submit modal → `POST /test-cases` with `authoringMethod: RECORDED`
- [ ] Successful save → navigates to TestEditorPage with the new TestCase loaded
- [ ] Append mode (`?testCaseId=:id`) → steps appended to existing test, no name modal
- [ ] Toast confirms save with step count
- [ ] `[Discard]` → confirmation modal → clears state, navigates back

### Crash recovery

- [ ] Recorder state autosaves to localStorage every 2s
- [ ] Page reload mid-recording → "Recover unsaved recording with N steps?" prompt
- [ ] Accept → state restored; reject → cleared
- [ ] After successful save → localStorage cleared

### Integration with existing platform

- [ ] Recorded TestCase shows in feature's test list with normal `[▶ Test]` action
- [ ] Running recorded TestCase via existing executor passes (selectors work)
- [ ] Selector heal kicks in if primary fails → uses `aiDescription` per `AI_EXECUTION_ENGINE.md`
- [ ] Recorded steps editable in `StepEditor` like any other test
- [ ] Authoring method visible in TestCase metadata (analytics-ready)

### Codebase RAG integration

- [ ] If project has connected repo → `GET /test-attribute-conventions` returns detected convention
- [ ] If no repo connected → returns `{ convention: null, count: 0 }`; recorder falls through to role-based priority
- [ ] AI description includes component reference when codebase RAG returns a hit for the route

### Performance — measured budgets (per §12)

- [ ] Click → step appended in left pane: **<100ms p95** (Sentry timing in production)
- [ ] Selector generation per element: **<20ms p95** (RecorderTelemetry log)
- [ ] Selector engine hard-times-out at 20ms and falls back to CSS path; never blocks user
- [ ] Live step list re-renders **<50ms** even with 200+ steps (virtual list kicks in at 50)
- [ ] Recorder page initial load (iframe interactive): **<3s** broadband
- [ ] Save flow with 50 steps: **<2s** wall time (single transaction)
- [ ] Replay of step with all 5 fallbacks failing: **<3s before AI healer invoked** (parallel evaluation, not sequential)

### Robustness — back-pressure and degradation

- [ ] AI description generation runs in background queue (max 2 concurrent, max 100 queued); save NEVER blocks on pending descriptions
- [ ] Server endpoint accepts batch of up to 5 elements per call; frontend coalesces every 200ms
- [ ] AI failure on description → step gets fallback description (visible text + tag), `aiDescriptionStatus='fallback'`; per-step retry button
- [ ] AI provider rate-limit hit (org-level token bucket 60/min) → user toast, future steps use plain-text descriptions; recording continues
- [ ] Codebase RAG unavailable → convention detection returns null, priority 1 falls through to role; description omits component context; one-time toast
- [ ] RAG slow (>500ms) → session switches to convention-only mode; per-step component lookup skipped
- [ ] Convention detection cached per project Redis 24h; invalidated on repo re-index

### Memory bounds

- [ ] Soft warning at 200 steps; hard refusal at 500 ("Save and start a new recording")
- [ ] localStorage QuotaExceededError triggers compression (drop captureContext); second failure surfaces toast and disables crash recovery for the session
- [ ] Capture event burst >50 events / 100ms → coalesced (e.g. 5 scrolls in 100ms → 1 step) with telemetry log

### Iframe failure modes

- [ ] Heartbeat every 2s from iframe; parent monitors with state machine
- [ ] No heartbeat for 5s → 🟡 lagging indicator; 15s → 🔴 lost banner with [Reload] [Save & Exit]
- [ ] Captured steps preserved across iframe reload (Zustand state independent of iframe)
- [ ] Cross-origin navigation detected → red banner "App navigated to {url} which we can't record" + [Return to original] button
- [ ] Reload iframe → recorder script re-injected automatically; capture continues if user was recording

### State machine + race conditions

- [ ] Recorder state transitions follow `ALLOWED_TRANSITIONS` map; illegal transitions throw + telemetry log
- [ ] Save during pending debounced FILL → drains debounce window (600ms) then proceeds; no lost steps
- [ ] Pause then Stop in <100ms → state transitions cleanly through `pausing → paused → stopping → stopped`
- [ ] Multi-click [Save] → idempotency key prevents duplicate TestCases; second click returns first call's TestCase id
- [ ] Capture event arriving in `stopped` state → dropped silently with telemetry log; doesn't bug out UI

### Save-time validation

- [ ] On save, all selectors re-validated against live iframe DOM
- [ ] Errors (selector matches 0 elements) block save by default; modal lists per-step with [Auto-fix] (re-runs selector engine)
- [ ] Warnings (selector matches >1 element) show banner; user can [Save anyway] with confirmation
- [ ] Auto-fix preserves user's edits (name, value); only changes selector + fallbackSelectors

### Concurrent sessions (org-level)

- [ ] Per-user concurrent session cap = 1 (start endpoint returns 409 if existing active session); error message includes "Resume" link
- [ ] Per-org AI rate limit: 60 SELECTOR_DESCRIPTION calls/min — token bucket in Redis
- [ ] Sessions abandoned >2h → nightly cron cleanup; Telemetry logs cleanup events

### Error surfacing

- [ ] postMessage failure (parent navigated away) → iframe script self-disables after 3 missed heartbeat acks; in-iframe toast "Recorder lost connection"
- [ ] AI description endpoint 500 → per-step status badge `⚠ failed (retry)`; click retries that one step
- [ ] localStorage quota → toast + degraded crash recovery (per §12.5)
- [ ] User goes offline mid-recording → capture continues; save attempt detects offline → "Offline — saved locally; will retry on reconnect"; auto-retries via `online` event listener
- [ ] No silent failures — every degraded path emits telemetry + a user-visible signal at the appropriate severity

### Telemetry

- [ ] `RecorderTelemetry` model captures eventType + metadata for: session lifecycle (start/stop/save/discard), every step capture, selector strategy + ms, AI description success/failure, fallback selector wins on replay
- [ ] 100% sampling in MVP; 30-day retention via nightly cron
- [ ] Admin dashboard surfaces p95 selector time per project, AI failure rate, fallback hit rate

### Load test (gate before MVP ships)

- [ ] 10 concurrent same-org sessions × 30 steps × 60s recording → all complete; AI desc completion p95 <5s; no 429s
- [ ] 1 user × 500 steps → step append p95 <100ms throughout
- [ ] 50 steps in 10k-node DOM → selector p95 <30ms; CSS path fallback rate <10%
- [ ] Save 200-step test case → <3s; verified single Prisma transaction (no N+1)
- [ ] Iframe disconnect mid-recording → UI lagging→lost in <20s; user saves partial recording successfully

---

## 14. Implementation Tasks (high-level)

To be expanded into IMPLEMENTATION_PLAN.md §5.9 — outline:

**Backend:**
1. `RecorderService` + REST endpoints (5 routes)
2. `detectTestAttributeConvention` — codebase RAG counter
3. `SELECTOR_DESCRIPTION` AI task + prompt template
4. `TestCase.authoringMethod` migration + Prisma update
5. `TestStep.fallbackSelectors` field on schema
6. Executor update — try `fallbackSelectors[]` before invoking healer

**Frontend:**
7. `apps/web/public/test-recorder.js` — capture script (~400 LOC)
8. `apps/web/public/recorder-selector-engine.js` — selector strategy (~300 LOC)
9. `RecorderPage` page component + routing outside Shell
10. `RecorderTopBar`, `RecordingState`, `StepList`, `StepRow` components
11. `AssertModeOverlay` component (cross-frame postMessage)
12. `RecorderStore` (Zustand) with persist middleware
13. Recorder API client lib (`apps/web/src/lib/recorderApi.ts`)
14. `[● Record New]` button on FeaturePage
15. `[● Record more steps]` button in TestEditorPage
16. `[● Record]` toggle in Testing View top action bar
17. FloatingRecorder integration for X-Frame fallback
18. Save modal with AI-suggested name
19. Tokenisation suggestion engine + UI chips
20. localStorage autosave + crash-recovery prompt

**Performance & Robustness (per §12 — must-have for MVP, not Phase 2):**
21. Selector engine 20ms hard timeout + CSS-path fallback path
22. `accessibleName()` WeakMap memoization
23. `AIDescriptionQueue` client-side worker (max 2 concurrent / 100 queued / drop-oldest policy)
24. Server-side batch endpoint `POST /recorder/ai/describe-element` accepts up to 5 elements per call
25. Per-org AI rate limit token bucket (60/min) with degraded plain-text fallback
26. Codebase RAG three-tier fallback (fast / slow → convention-only / down → no RAG); convention cached Redis 24h
27. Memory bounds enforcement (200 soft / 500 hard step cap; localStorage quota detection + compression)
28. `IframeHealthMonitor` heartbeat watchdog with healthy / lagging / lost / lost-cross-origin states + UI banners
29. Recorder state machine with `ALLOWED_TRANSITIONS` validator
30. Save idempotency key (UUID generated client-side; Redis 5min server-side dedup)
31. Save-time validation re-runs uniqueness against live DOM; auto-fix path
32. Per-user concurrent session cap (start endpoint 409s with Resume link)
33. Replay executor change: parallel `Promise.allSettled` evaluation of `[selector, ...fallbacks]` with 1.5s individual timeout (not sequential)
34. Selector telemetry — record fallback wins to inform "promote fallback to primary" optimisation
35. `RecorderTelemetry` Prisma model + 30-day cleanup cron
36. Admin telemetry dashboard (p95 selector time, AI failure rate, fallback hit rate, sessions per user)
37. Offline detection — capture continues; save retries via `online` event listener

**Testing:**
38. Unit: selector engine priority order + 20ms timeout + CSS-path fallback
39. Unit: stability check (unique vs ambiguous vs zero)
40. Unit: redaction logic for password fields
41. Unit: tokenisation suggestion patterns
42. Unit: state machine — every illegal transition throws
43. Unit: AIDescriptionQueue back-pressure (100 enqueued, drops oldest)
44. Unit: localStorage quota detection + compression
45. Unit: replay executor parallel evaluation; correct winner identified
46. Integration: recorded TestCase runs via existing executor
47. Integration: heartbeat watchdog transitions through states correctly
48. Integration: save idempotency — duplicate POST returns same TestCase id
49. Integration: AI rate limit triggers degraded path
50. E2E (Playwright): full record → save → run flow against test fixture app
51. E2E: iframe disconnect → user can save partial recording
52. Component: live step list virtual scrolling at 200+ steps
53. Load test: 10 concurrent sessions × 30 steps (per §12.13)
54. Load test: 500 steps single session — step append p95 <100ms
55. Load test: 200-step save → <3s wall time, single transaction
56. Manual test script: record a non-trivial flow on a real production app (login + navigate + form fill + assert)

---

## 15. Differentiators (why this beats Playwright Codegen out of the box)

1. **Codebase-aware selector picking** — RAG detects this project's actual `data-*` convention; we use it. Codegen guesses globally.
2. **Dual capture (`selector` + `aiDescription`) by default** — every step is born self-healing. No competitor does this at capture time.
3. **Inline tokenisation suggestions** — recorder spots emails / URLs / known fixtures and suggests env-var substitution. Codegen outputs literals.
4. **Promotes existing exploratory captures** — the §8.4 buffer in exploratory testing IS a recorder; one button "Save these last N actions as a test."
5. **Lives in the same UI as runs / failures / debugging** — Codegen is a separate CLI. We're a unified workflow.

---

## 16. Open Questions / Future Iterations

See:
- `docs/future/TEST_RECORDER_PHASE_2.md` — AI polish (assertion suggestions, step naming, agentic post-processing, Shadow DOM)
- `docs/future/TEST_RECORDER_PHASE_3.md` — Chrome extension, server-side CDP recorder, file uploads, Cypress Studio-style edit-existing-test mode

---

## 17. Quick Decision Log

| Decision | Choice | Rationale |
|---|---|---|
| Recorder output format | Existing `TestCase` + `TestStep[]` | Zero data model bloat; recorded tests indistinguishable from manual |
| Selector storage | `selector` + `aiDescription` + `fallbackSelectors[]` on every step | Heal-ready day 1; reuses existing AI healing |
| Capture mechanism | Same-origin iframe + injected script | Reuses existing iframe pattern; Chrome ext deferred to Phase 3 |
| State management | Zustand + localStorage | Simple, crash-safe; matches platform conventions |
| Selector convention detection | Codebase RAG | We have the data; Codegen doesn't |
| Cross-origin support | Out of MVP | Needs app cooperation OR Chrome ext — both expensive |
| Auto-run after save | No | Surprise failures kill trust; user reviews then runs manually |
| AI assertion suggestions | Phase 2 | DOM-diff is non-trivial; ship recording first |
| Edit existing in recorder mode (Cypress Studio) | Phase 3 | Requires playback engine; double the complexity |
