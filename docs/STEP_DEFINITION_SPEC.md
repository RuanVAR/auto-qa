# Step Definition Specification

> This is the **canonical reference** for the step JSON structure.
> Every place that reads or writes steps — the step editor, the AI generator,
> the StepRunner, the BDD parser, the import/export module — must conform to this spec.

---

## Overview

A `TestDefinition` has a `steps` field of type `Json` in Prisma, which stores
an array of step objects. Steps are ordered (0-based index) and executed
sequentially. Execution stops on the first failure unless `continueOnFail` is set.

```typescript
// The complete type definition
interface TestStep {
  index:          number;          // 0-based position in the array
  type:           StepType;        // one of the enum values below
  name:           string;          // human-readable label shown in the UI
  input:          StepInput;       // type-specific input fields (see per-type specs)
  continueOnFail: boolean;         // default false — if true, run continues even if step fails
  timeoutMs?:     number;          // per-step timeout override; null = use default (30 000 ms)
  aiDescription?: string;          // natural-language fallback for AI selector healing
}
```

`index` is always set to the step's position in the array (0, 1, 2 …). It is
re-calculated on save whenever steps are reordered — never rely on stored index
for ordering; always sort by `index` ascending.

---

## StepType Enum

```typescript
enum StepType {
  // Navigation
  NAVIGATE       = 'NAVIGATE',
  RELOAD         = 'RELOAD',
  GO_BACK        = 'GO_BACK',
  GO_FORWARD     = 'GO_FORWARD',

  // Interaction
  CLICK          = 'CLICK',
  DOUBLE_CLICK   = 'DOUBLE_CLICK',
  RIGHT_CLICK    = 'RIGHT_CLICK',
  HOVER          = 'HOVER',
  FILL           = 'FILL',
  SELECT         = 'SELECT',
  PRESS_KEY      = 'PRESS_KEY',
  SCROLL         = 'SCROLL',
  DRAG_DROP      = 'DRAG_DROP',
  UPLOAD_FILE    = 'UPLOAD_FILE',

  // Assertions
  ASSERT_TEXT    = 'ASSERT_TEXT',
  ASSERT_VISIBLE = 'ASSERT_VISIBLE',
  ASSERT_HIDDEN  = 'ASSERT_HIDDEN',
  ASSERT_URL     = 'ASSERT_URL',
  ASSERT_ELEMENT = 'ASSERT_ELEMENT',
  ASSERT_VALUE   = 'ASSERT_VALUE',

  // Utility
  WAIT           = 'WAIT',
  SCREENSHOT     = 'SCREENSHOT',

  // API (used in API-type tests only — runs outside Playwright)
  REQUEST        = 'REQUEST',

  // Custom (extensible — runs a named handler registered in the worker)
  CUSTOM         = 'CUSTOM',
}
```

---

## Per-Type Input Specification

### NAVIGATE

Navigate the browser to a URL.

```typescript
interface NavigateInput {
  url: string;   // Required. Absolute URL or path relative to environment baseUrl.
                 // Examples: "https://example.com"  OR  "/auth/login"
                 // Relative paths are resolved: baseUrl + url at runtime.
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
                 // Default: 'load'. Use 'networkidle' for SPAs with heavy async rendering.
}
```

Validation: `url` is required and must be a non-empty string.

---

### RELOAD

Reload the current page.

```typescript
interface ReloadInput {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}
```

No required fields. `input` can be `{}`.

---

### GO_BACK / GO_FORWARD

Browser history navigation.

```typescript
interface HistoryNavInput {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}
```

No required fields. `input` can be `{}`.

---

### CLICK

Click on an element.

```typescript
interface ClickInput {
  selector:    string;              // Required. CSS selector or text selector.
  button?:     'left' | 'right' | 'middle'; // Default: 'left'
  clickCount?: number;              // Default: 1. Use 2 for double-click.
  force?:      boolean;             // Default: false. Skip actionability checks.
  position?: {                      // Click offset within the element bounding box.
    x: number;
    y: number;
  };
}
```

Validation: `selector` is required.

---

### DOUBLE_CLICK

Shorthand for `CLICK` with `clickCount: 2`.

```typescript
interface DoubleClickInput {
  selector: string;   // Required.
  force?:   boolean;
}
```

---

### RIGHT_CLICK

Shorthand for `CLICK` with `button: 'right'`.

```typescript
interface RightClickInput {
  selector: string;   // Required.
}
```

---

### HOVER

Move mouse over an element (triggers CSS :hover state, tooltips, etc.).

```typescript
interface HoverInput {
  selector: string;   // Required.
  force?:   boolean;
}
```

---

### FILL

Clear an input and type a value into it.

```typescript
interface FillInput {
  selector: string;   // Required. Should target an <input>, <textarea>, or contenteditable.
  value:    string;   // Required. The text to type.
                      // Supports variable tokens: {{ENV_VAR_NAME}}
                      // Tokens are resolved from Environment.variables at runtime.
}
```

Validation: both `selector` and `value` are required.

**Variable resolution:**
`{{TOKEN}}` syntax is replaced at runtime from `environment.variables` JSON map.
Example: `{{TEST_USER_EMAIL}}` → `"qa@example.com"` from environment config.
Unresolved tokens are left as-is and logged as a warning (not a failure).

---

### SELECT

Select an option in a `<select>` dropdown.

```typescript
interface SelectInput {
  selector: string;            // Required. The <select> element.
  value?:   string;            // Option value attribute.  At least one of
  label?:   string;            // Option display text.     value, label, or
  index?:   number;            // Option position (0-based). index is required.
}
```

Validation: `selector` required; at least one of `value`, `label`, or `index` required.

---

### PRESS_KEY

Press one or more keyboard keys.

```typescript
interface PressKeyInput {
  selector?: string;   // Optional. If provided, focuses this element first.
  key:       string;   // Required. Playwright key name or combination.
                       // Examples: "Enter", "Tab", "Escape", "Control+A", "Shift+Tab"
}
```

Validation: `key` is required.

---

### SCROLL

Scroll the page or a specific element.

```typescript
interface ScrollInput {
  selector?: string;   // Optional. If omitted, scrolls the window.
  direction: 'up' | 'down' | 'left' | 'right';  // Required.
  distance:  number;   // Required. Pixels to scroll.
  smooth?:   boolean;  // Default: false.
}
```

Validation: `direction` and `distance` are required.

---

### DRAG_DROP

Drag one element and drop it onto another.

```typescript
interface DragDropInput {
  sourceSelector: string;   // Required. Element to drag.
  targetSelector: string;   // Required. Element to drop onto.
}
```

Validation: both selectors are required.

---

### UPLOAD_FILE

Upload a file via a file input.

```typescript
interface UploadFileInput {
  selector:  string;   // Required. The <input type="file"> element.
  filePath:  string;   // Required. Path to the file within the platform's test-fixtures/
                       // directory. Do NOT use absolute paths — all paths are relative
                       // to apps/worker/test-fixtures/ for security.
}
```

Validation: both fields required. `filePath` must not contain `..` (path traversal guard).

---

### ASSERT_TEXT

Assert that an element contains specific text.

```typescript
interface AssertTextInput {
  selector:  string;                              // Required.
  text:      string;                              // Required. Expected text value.
  matchType: 'exact' | 'contains' | 'regex';     // Default: 'contains'
  trim?:     boolean;                             // Default: true. Trim whitespace before comparing.
}
```

Validation: `selector` and `text` are required.

---

### ASSERT_VISIBLE

Assert that an element is visible in the viewport.

```typescript
interface AssertVisibleInput {
  selector: string;    // Required.
  visible?: boolean;   // Default: true. Set to false to assert NOT visible (same as ASSERT_HIDDEN).
}
```

---

### ASSERT_HIDDEN

Assert that an element does not exist or is not visible.

```typescript
interface AssertHiddenInput {
  selector: string;   // Required.
}
```

---

### ASSERT_URL

Assert the current page URL.

```typescript
interface AssertUrlInput {
  url:       string;                          // Required. Expected URL.
  matchType: 'exact' | 'contains' | 'regex'; // Default: 'contains'
}
```

Validation: `url` is required.

---

### ASSERT_ELEMENT

Assert properties of an element beyond just visibility.

```typescript
interface AssertElementInput {
  selector:   string;         // Required.
  property:   'checked' | 'disabled' | 'enabled' | 'editable' | 'focused' | 'empty';
  expected:   boolean;        // Required. Whether property should be true or false.
}
```

Validation: `selector` and `property` are required.

---

### ASSERT_VALUE

Assert the current value of a form field.

```typescript
interface AssertValueInput {
  selector:  string;   // Required. Input or textarea element.
  value:     string;   // Required. Expected value.
  matchType: 'exact' | 'contains' | 'regex';  // Default: 'exact'
}
```

---

### WAIT

Pause execution for a fixed duration or until a condition.

```typescript
interface WaitInput {
  type:       'time' | 'selector' | 'url';   // Required.
  durationMs?: number;                        // Required when type = 'time'. Milliseconds.
  selector?:   string;                        // Required when type = 'selector'.
  state?:      'visible' | 'hidden' | 'attached' | 'detached'; // Default: 'visible'
  url?:        string;                        // Required when type = 'url'.
}
```

Validation:
- `type = 'time'` → `durationMs` required (max: 30 000 ms enforced by worker)
- `type = 'selector'` → `selector` required
- `type = 'url'` → `url` required

---

### SCREENSHOT

Capture a screenshot. Auto-named and stored as an Artifact.

```typescript
interface ScreenshotInput {
  name?:      string;    // Optional label for the artifact. Default: "step-{index}-screenshot".
  fullPage?:  boolean;   // Default: false. Capture full scrollable page.
  selector?:  string;    // Optional. Capture only this element's bounding box.
}
```

No required fields. `input` can be `{}`.

---

### REQUEST

HTTP request step. Used in `API`-type tests — executes outside Playwright.

```typescript
interface RequestInput {
  method:   'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';  // Required.
  url:      string;                  // Required. Absolute or relative to environment baseUrl.
  headers?: Record<string, string>;  // Optional. Merged with environment.headers.
  body?:    unknown;                 // Optional. JSON body for POST/PUT/PATCH.
  // Assertions on the response
  expectedStatus?: number;           // Default: 200. Assert HTTP status code.
  assertBody?: {                     // Optional. Assert response body.
    jsonPath:  string;               // JSONPath expression (e.g. "$.user.email")
    value:     unknown;              // Expected value at that path.
    matchType: 'exact' | 'contains' | 'exists';
  }[];
}
```

Validation: `method` and `url` are required.

---

### CUSTOM

Extensible step that calls a named handler registered in the worker.

```typescript
interface CustomInput {
  handler: string;          // Required. Name of the registered handler function.
  params?: Record<string, unknown>;  // Handler-specific parameters.
}
```

Custom handlers are registered in `apps/worker/src/steps/custom-handlers/`.
If no handler is found for the given name, the step fails with a descriptive error.

---

## Complete Step Examples

### Full test definition (UI type)

```json
[
  {
    "index": 0,
    "type": "NAVIGATE",
    "name": "Open login page",
    "input": { "url": "/auth/login" },
    "continueOnFail": false,
    "timeoutMs": null,
    "aiDescription": "Navigate to the application login page"
  },
  {
    "index": 1,
    "type": "FILL",
    "name": "Enter email address",
    "input": { "selector": "input[name='email']", "value": "{{TEST_USER_EMAIL}}" },
    "continueOnFail": false,
    "timeoutMs": null,
    "aiDescription": "Type the test user's email address into the email input field"
  },
  {
    "index": 2,
    "type": "FILL",
    "name": "Enter password",
    "input": { "selector": "input[name='password']", "value": "{{TEST_USER_PASSWORD}}" },
    "continueOnFail": false,
    "timeoutMs": null
  },
  {
    "index": 3,
    "type": "CLICK",
    "name": "Submit login form",
    "input": { "selector": "button[type='submit']" },
    "continueOnFail": false,
    "timeoutMs": 5000
  },
  {
    "index": 4,
    "type": "ASSERT_URL",
    "name": "Verify redirect to dashboard",
    "input": { "url": "/dashboard", "matchType": "contains" },
    "continueOnFail": false,
    "timeoutMs": null
  },
  {
    "index": 5,
    "type": "ASSERT_TEXT",
    "name": "Verify welcome message",
    "input": {
      "selector": "h1",
      "text": "Welcome back",
      "matchType": "contains"
    },
    "continueOnFail": false,
    "timeoutMs": null
  }
]
```

### Full test definition (API type)

```json
[
  {
    "index": 0,
    "type": "REQUEST",
    "name": "POST /auth/login",
    "input": {
      "method": "POST",
      "url": "/api/auth/login",
      "body": {
        "email": "{{TEST_USER_EMAIL}}",
        "password": "{{TEST_USER_PASSWORD}}"
      },
      "expectedStatus": 200,
      "assertBody": [
        { "jsonPath": "$.accessToken", "value": null, "matchType": "exists" },
        { "jsonPath": "$.user.email",  "value": "{{TEST_USER_EMAIL}}", "matchType": "exact" }
      ]
    },
    "continueOnFail": false
  },
  {
    "index": 1,
    "type": "REQUEST",
    "name": "GET /auth/me (authenticated)",
    "input": {
      "method": "GET",
      "url": "/api/auth/me",
      "headers": { "Authorization": "Bearer {{LAST_RESPONSE_TOKEN}}" },
      "expectedStatus": 200
    },
    "continueOnFail": false
  }
]
```

---

## Variable Token Reference

Tokens resolved from `Environment.variables` (a JSON map):

| Token | Resolved from | Example |
|-------|-------------|---------|
| `{{ANY_KEY}}` | `Environment.variables.ANY_KEY` | `{{BASE_URL}}` |
| `{{TEST_USER_EMAIL}}` | `Environment.variables.TEST_USER_EMAIL` | `qa@example.com` |

Special runtime tokens (set by the worker during execution):

| Token | Value |
|-------|-------|
| `{{LAST_RESPONSE_BODY}}` | Full JSON response body from the previous REQUEST step |
| `{{LAST_RESPONSE_STATUS}}` | HTTP status code from the previous REQUEST step |
| `{{LAST_RESPONSE_TOKEN}}` | `accessToken` field from the previous REQUEST step body (convenience) |
| `{{RUN_ID}}` | The current TestRun UUID |
| `{{TIMESTAMP}}` | ISO 8601 timestamp at step execution time |

---

## Selector Guidelines

All `selector` fields use **CSS selectors** by default. Playwright also supports:

| Format | Example | When to use |
|--------|---------|-------------|
| CSS selector | `input[name='email']` | Standard — preferred |
| Text selector | `text=Submit` | When no unique CSS selector exists |
| Role selector | `role=button[name='Submit']` | Accessibility-aligned, most stable |
| Test ID | `data-testid=login-button` | If app uses data-testid attributes |
| XPath | `//button[@type='submit']` | Last resort — fragile |

The AI generator prefers `data-testid` → role selectors → CSS attribute selectors
in that order of priority. Generic class selectors (`.btn.btn-primary`) should be
avoided as they break with UI library version changes.

---

## AI-Assisted Fields

Two optional fields support the hybrid AI execution engine:

```typescript
aiDescription?: string;
// Natural language description of what this step does.
// Used by the AI selector healer when the CSS selector fails.
// Example: "Click the blue submit button at the bottom of the login form"

// Set automatically on AI-generated steps. Can be edited manually.
```

The `aiDescription` is included in the healing prompt when a step fails:
> "The selector `button[type='submit']` could not be found.
>  The step is described as: 'Click the blue submit button at the bottom of the login form'.
>  Using the screenshot, find the best matching selector and return it."

---

## Runtime Execution — Status Transitions

Each step has a corresponding `RunStep` DB record that transitions through these statuses:

```
PENDING → RUNNING → PASSED
                  → FAILED   (step threw an error or assertion failed)
                  → SKIPPED  (continueOnFail=false on a previous step; all remaining steps skipped)
                  → ABORTED  (run was manually cancelled mid-execution)
```

When a step fails:
1. `RunStep.status` → `FAILED`
2. `RunStep.errorMessage` = Playwright error message
3. `RunStep.screenshotPath` = auto-captured failure screenshot
4. If `continueOnFail = false` (default): all subsequent steps immediately → `SKIPPED`
5. If `continueOnFail = true`: execution continues to the next step regardless

---

## Validation Rules Summary

| Field | Rule |
|-------|------|
| `index` | Must equal the step's 0-based position in the array |
| `type` | Must be a valid `StepType` enum value |
| `name` | Required, 1–200 characters |
| `continueOnFail` | Boolean, defaults to `false` |
| `timeoutMs` | If set: integer 100–60 000 ms; null = use global default (30 000 ms) |
| `input.selector` | Required for all interaction and assertion types; max 500 chars; must not be empty string |
| `input.url` (NAVIGATE) | Required; must be non-empty; relative paths must start with `/` |
| `input.value` (FILL) | Required; supports `{{TOKEN}}` syntax; max 10 000 chars |
| `input.durationMs` (WAIT) | Required when type=time; max 30 000 ms |
| `input.filePath` | Must not contain `..`; must not be an absolute path |
