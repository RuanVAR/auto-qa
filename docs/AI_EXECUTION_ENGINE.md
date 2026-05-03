# AI Execution Engine — Hybrid Step Execution

## Overview

The worker supports a **hybrid execution model** for UI test steps. Every step can carry
two targeting strategies side by side:

| Field | Purpose | When used |
|-------|---------|-----------|
| `selector` | Exact CSS selector | Tried first — fast, zero AI cost |
| `description` | Plain-English description of the element | AI fallback — used only when selector fails or is absent |
| `expectedOutcome` | What should be true after the step | AI post-step verification (optional) |

**The deterministic path is always tried first.** AI is only invoked when the selector
fails or is missing. This keeps the happy path fast and cheap while making the test
resilient to UI changes.

---

## Execution Flow Per Step

```
Worker receives step
        │
        ├─ selector present?
        │       │
        │      YES → Playwright tries selector
        │               │
        │          Found? ──YES──► Execute action
        │               │                │
        │              NO                │
        │               │         ┌──── take post-action screenshot
        │               │         │
        │               │    expectedOutcome present + AI verify enabled?
        │               │         │
        │               │        YES → AI verifies outcome
        │               │               │
        │               │          passed? ──YES──► STEP PASSED
        │               │               │
        │               │              NO ──────► STEP FAILED (AI reason)
        │               │
        │               └─ description present + healSelectors enabled?
        │                       │
        │                      YES → [AI HEALING FLOW] ──────────────────────┐
        │                      NO  → STEP FAILED (selector not found)         │
        │                                                                      │
        └─ no selector, description present? ──YES──► [AI HEALING FLOW] ─────┘
                                                                               │
                                              ┌────────────────────────────────┘
                                              │
                                    AI HEALING FLOW
                                              │
                                   Take screenshot of current page
                                              │
                                   Fetch relevant code chunks from
                                   repo index (if connected)
                                              │
                                   Send to AI vision model:
                                     - screenshot (base64)
                                     - code context
                                     - step description
                                     - step type
                                              │
                                   AI returns:
                                     { selector, confidence, source }
                                              │
                                   Playwright tries AI-returned selector
                                              │
                                   Found? ──YES──► Execute action
                                              │          │
                                             NO          └── record SelectorHeal event
                                              │
                                   STEP FAILED
                                   "Selector not found. AI attempted
                                    to locate '{description}' but
                                    could not find a matching element."
```

---

## Step Input Format

Existing steps are fully backward compatible — `selector` alone still works exactly
as before. New fields are optional.

### UI step (deterministic only — existing behaviour)
```json
{
  "index": 2,
  "name": "Click login button",
  "type": "CLICK",
  "input": {
    "selector": "#login-btn"
  }
}
```

### UI step (AI fallback only — no known selector)
```json
{
  "index": 2,
  "name": "Click login button",
  "type": "CLICK",
  "input": {
    "description": "the main login submit button"
  }
}
```

### UI step (hybrid — recommended)
```json
{
  "index": 2,
  "name": "Click login button",
  "type": "CLICK",
  "input": {
    "selector": "#login-btn",
    "description": "the main login submit button",
    "expectedOutcome": "login form is submitted and user is redirected"
  }
}
```

### AI-generated step (codebase connected)

When a test is generated with the repo connected the AI populates **both** `selector`
(from the real code) and `description` (from the element's purpose). Both fields are
present automatically — the tester does not need to add them manually.

```json
{
  "index": 2,
  "name": "Click login button",
  "type": "CLICK",
  "input": {
    "selector": ".btn-login",
    "description": "the primary login submit button",
    "expectedOutcome": "page redirects to /dashboard"
  }
}
```

### API step — no AI execution needed
API steps are fully deterministic. The response status and body are checked
programmatically. No screenshot, no AI vision call.

### Shell step — no AI execution needed
Shell steps are fully deterministic. Exit code and output are checked
programmatically. No AI vision call.

---

## AI Calls Per Step

### Call 1 — Selector resolution (only when selector fails or absent)

**Input to AI:**
```
System: You are a QA automation assistant. Given a screenshot of a web page
        and relevant source code, find the best CSS selector for the described element.
        Return JSON only: { "selector": "...", "confidence": "high|medium|low",
        "source": "code|visual|code+visual", "reasoning": "..." }

Context (code chunks from repo):
--- LoginForm.tsx ---
<button className="btn-login" type="submit" data-testid="login-submit">
  Sign in
</button>

User: Find the selector for: "the main login submit button"
      Step type: CLICK
      Current URL: /auth/login
```

**AI response:**
```json
{
  "selector": "[data-testid='login-submit']",
  "confidence": "high",
  "source": "code",
  "reasoning": "Found data-testid attribute 'login-submit' on the submit button in LoginForm.tsx"
}
```

### Call 2 — Outcome verification (only when `expectedOutcome` is set and `verifyOutcomes: true` in config)

**Input to AI:**
```
System: You are a QA verification assistant. Given a screenshot taken after
        a test step executed, determine whether the expected outcome occurred.
        Return JSON only: { "passed": true|false, "confidence": "high|medium|low",
        "reason": "...", "observed": "..." }

User: Step type: CLICK
      Expected outcome: "login form is submitted and user is redirected to dashboard"
      [screenshot attached]
```

**AI response:**
```json
{
  "passed": true,
  "confidence": "high",
  "reason": "Page shows /dashboard URL with user avatar and navigation menu visible",
  "observed": "Dashboard page loaded successfully with user 'qa@test.com' shown in header"
}
```

---

## Selector Healing

When the AI heals a broken selector, the event is recorded and surfaced to the engineer.

### `SelectorHeal` model

```prisma
model SelectorHeal {
  id               String   @id @default(uuid())
  runId            String
  run              TestRun  @relation(fields: [runId], references: [id], onDelete: Cascade)
  stepId           String
  step             RunStep  @relation(fields: [stepId], references: [id], onDelete: Cascade)
  testDefinitionId String
  stepIndex        Int
  stepName         String
  originalSelector String?  // what was tried and failed (null if step had no selector)
  healedSelector   String   // what AI found
  confidence       String   // high | medium | low
  source           String   // code | visual | code+visual
  createdAt        DateTime @default(now())
  @@map("selector_heals")
}
```

### How it surfaces

**In the run detail view:**
```
Step 2 — Click login button          ✅ PASSED
⚠ Selector healed
  Original:  #login-btn  (not found)
  AI found:  .btn-login  (confidence: high, source: code)
  [ Update selector in test definition ]
```

**In the feature run summary:**
```
✅ 5/5 tests passed
⚠ 2 selector heals detected in this run
  → LoginFlow: Step 2 — #login-btn healed to .btn-login
  → LoginFlow: Step 5 — #welcome-msg healed to .user-greeting
  [ Review and update selectors ]
```

**Notification:** If a project has a notification rule configured, selector heals
are included in the email/Slack/webhook report as a warnings section.

---

## Test Config — AI Execution Settings

Per-test configuration controls AI execution behaviour. All flags default to `false`
to preserve existing behaviour for tests that don't opt in.

```json
{
  "name": "Login Flow",
  "config": {
    "browser": "chromium",
    "headless": true,
    "timeout": 30000,
    "retries": 1,
    "aiExecution": {
      "enabled": true,
      "healSelectors": true,
      "verifyOutcomes": false,
      "screenshotPerStep": true
    }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Master switch — enables the AI execution engine for this test |
| `healSelectors` | `false` | When selector fails, attempt AI healing via screenshot + code context |
| `verifyOutcomes` | `false` | After each step, AI verifies `expectedOutcome` if present |
| `screenshotPerStep` | `false` | Take a screenshot after every step (required for `verifyOutcomes`) |

> **Cost note:** `verifyOutcomes: true` makes one AI call per step. For a 10-step test
> that is up to 10 AI calls. Use selectively — recommended for critical assertions only,
> not every navigation step.

---

## AI Model Requirements

Selector resolution and outcome verification require a **vision-capable model**
(one that can accept image inputs).

| Provider | Supported vision model |
|----------|----------------------|
| `anthropic` | `claude-sonnet-4-20250514` ✅ |
| `openai` | `gpt-4o` ✅ |
| `azure` | `gpt-4o` deployment ✅ |
| `ollama` | `llava`, `bakllava`, `moondream` ✅ |
| `openai-compatible` | Any model with vision support ✅ |

If the configured model does not support vision and `healSelectors` or `verifyOutcomes`
is enabled, the worker logs a warning and falls back to deterministic-only execution
rather than throwing an error.

---

## Performance Characteristics

| Scenario | Latency per step | AI calls |
|----------|-----------------|----------|
| Selector found, no verify | ~50ms | 0 |
| Selector not found, healed | ~1–3s | 1 |
| Selector found, outcome verified | ~1–3s | 1 |
| Selector healed + outcome verified | ~2–5s | 2 |

Selector healing only adds latency when a selector actually fails. A passing test
with no broken selectors runs at full Playwright speed.

---

## How Codebase Context Improves Healing

When a project has a connected repo:

1. Worker calls `RetrievalService.findRelevantChunks(description, projectId)`
2. Returns top-5 code chunks most relevant to the step description
3. Chunks are prepended to the AI prompt as context

This means the AI is not guessing from the screenshot alone — it can see that
`data-testid="login-submit"` exists in `LoginForm.tsx` and use that stable attribute
instead of a visual guess.

**Without repo context:** AI guesses from screenshot → `button.btn-primary:nth-child(2)` (fragile)

**With repo context:** AI finds from code → `[data-testid='login-submit']` (stable)

---

## Where This Fits in the Implementation Plan

This is **Phase 2.0.2 extension** in `IMPLEMENTATION_PLAN.md` — part of the worker
execution engine. It depends on:

- Phase 2.0.1 (Module/Feature hierarchy) — test definitions have features
- Phase 1.2 (Worker unit tests) — healing logic needs test coverage
- Phase 5.5.2 (Repo indexing) — for code-context-aware healing

The core healing flow (screenshot → AI → selector) can be built **without** the repo
connection and works purely from visual AI. Repo context makes it more accurate
but is not required.

---

## Healing — Detailed Trigger Conditions

Selector healing activates **only** when ALL of the following are true:

1. `aiExecution.healSelectors = true` on the test config (opt-in)
2. The Playwright locator throws a `TimeoutError` — meaning the element was not found within the step timeout
3. The step has an `aiDescription` (or legacy `input.description`) — without a natural-language description there is nothing for the AI to reason about

Healing does **not** activate for:
- `ActionError` (element found but not actionable, e.g. disabled button) — this is a test failure, not a selector issue
- `StrictModeViolation` (selector matched more than one element) — surface the error to the tester to fix
- Network errors during navigation
- Any step type other than the interaction types (CLICK, DBLCLICK, FILL, TYPE, CLEAR, SELECT, CHECK, UNCHECK, HOVER, PRESS_KEY, SCROLL, WAIT_FOR_SELECTOR) — assertion steps and NAVIGATE do not benefit from element healing

### Trigger Code

```typescript
function isHealableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Playwright TimeoutError message contains 'waiting for locator'
  return err.message.includes('waiting for locator') ||
         err.constructor.name === 'TimeoutError';
}

function isHealableStepType(type: StepType): boolean {
  return [
    'CLICK','DBLCLICK','FILL','TYPE','CLEAR','SELECT',
    'CHECK','UNCHECK','HOVER','PRESS_KEY','SCROLL','WAIT_FOR_SELECTOR',
  ].includes(type);
}

async function executeWithHealing(
  step: TestStep,
  page: Page,
  handler: StepHandler,
  config: AiExecutionConfig,
): Promise<StepResult> {
  try {
    return await handler.execute(step, page);
  } catch (err) {
    const canHeal =
      config.healSelectors &&
      isHealableError(err) &&
      isHealableStepType(step.type) &&
      !!(step.aiDescription ?? (step.input as any).description);

    if (!canHeal) return buildFailResult(err);

    return this.runHealingFlow(step, page, err as Error);
  }
}
```

---

## Healing — Data Captured for AI Prompt

The healing agent receives three inputs:

### 1. Screenshot (Required)

Captured immediately after the locator failure, before any page state changes:

```typescript
const screenshotBuffer = await page.screenshot({
  type:     'png',
  fullPage: false,   // viewport only — keeps image small
  scale:    'css',   // device-pixel-ratio normalised
});
const screenshotBase64 = screenshotBuffer.toString('base64');
```

The image is sent directly in the AI vision call. It is also stored as a `RunStep` artifact (labelled "healing-attempt") for debugging.

### 2. Accessibility Tree (Required)

The accessibility tree provides the AI with a structured DOM representation that is more reliable than raw HTML and maps closely to how Playwright's own locators work:

```typescript
const a11yTree = await page.accessibility.snapshot({
  interestingOnly: true,   // omit purely presentational nodes
});
const a11yJson = JSON.stringify(a11yTree, null, 2);
// Trimmed to ~8000 chars to fit token budget
const trimmed = a11yJson.length > 8000 ? a11yJson.slice(0, 8000) + '\n...(truncated)' : a11yJson;
```

The accessibility tree is included as text (not an image) in the prompt, complementing the screenshot.

### 3. Codebase Code Chunks (Optional — requires connected repo)

```typescript
const chunks = projectHasRepo
  ? await this.ragService.retrieveChunks({
      query:     step.aiDescription,
      projectId: step.projectId,
      limit:     5,
      minScore:  0.70,
    })
  : [];
```

If no repo is connected, the AI relies purely on the screenshot + accessibility tree.

---

## Healing — Full Prompt Structure

```typescript
const systemPrompt = `
You are a QA automation expert. A Playwright selector has failed to find an element.
Using the screenshot, accessibility tree, and any code context provided,
find the best selector for the described element.

Respond with JSON only:
{
  "selector": "the best CSS or role-based selector",
  "confidence": "high | medium | low",
  "source": "code | visual | accessibility | combined",
  "reasoning": "brief explanation (1-2 sentences)"
}

Confidence rules:
  high   — you are certain this selector will work (found in source code or very specific attribute)
  medium — likely correct but based on visual inference
  low    — best guess; element may not exist or may be in an unexpected state

Prefer in this order:
  1. data-testid attributes (most stable)
  2. aria-label or role-based selectors
  3. unique CSS class names that look semantic (not auto-generated)
  4. Input type + label association
  5. Text content as last resort (e.g. button:has-text("Submit"))
`;

const userMessage = [
  `Element description: "${step.aiDescription}"`,
  `Step type: ${step.type}`,
  `Original selector (failed): ${step.input.selector ?? 'none'}`,
  `Current URL: ${await page.url()}`,
  '',
  '## Accessibility Tree',
  trimmedA11yJson,
  '',
  chunks.length > 0 ? '## Source Code' : '',
  ...chunks.map(c => `// File: ${c.filePath}\n${c.content}`),
];
```

---

## Healing — Confidence Threshold and Decision

```typescript
const CONFIDENCE_AUTO_APPLY_THRESHOLD  = 0.75;   // high = 1.0, medium = 0.6, low = 0.3
const CONFIDENCE_SKIP_HEAL_THRESHOLD   = 0.3;    // below this: don't even try with new selector

const confidenceScore: Record<string, number> = {
  high:   1.0,
  medium: 0.6,
  low:    0.3,
};

const score = confidenceScore[healResult.confidence] ?? 0;

if (score < CONFIDENCE_SKIP_HEAL_THRESHOLD) {
  // Not worth retrying — fail the step and report
  return buildFailResult(originalError, `Healing attempted but confidence too low (${healResult.confidence})`);
}

// Retry with healed selector
const healedInput = { ...step.input, selector: healResult.selector };
const healedStep  = { ...step, input: healedInput };

let healedResult: StepResult;
try {
  healedResult = await handler.execute(healedStep, page);
} catch (retryErr) {
  // Healed selector also failed
  return buildFailResult(originalError, `Healing failed: healed selector "${healResult.selector}" also not found`);
}

// Healing succeeded
return {
  ...healedResult,
  healApplied:   true,
  healSelector:  healResult.selector,
  healConfidence: healResult.confidence,
};
```

### Auto-Apply vs Human Review

| Confidence | Behaviour |
|-----------|-----------|
| `high` (≥ 0.75) | Selector auto-applied; run continues; `SelectorHeal` record created; UI shows "healed" badge |
| `medium` (0.3–0.74) | Selector applied, run continues (same as high) but UI shows amber "healed — review recommended" badge |
| `low` (< 0.3) | Healing skipped; step fails with note "Healing confidence too low"; `SelectorHeal` record created with `status: SKIPPED` |

There is no blocking "human must approve before continuing" mode during a run. Human review happens **after** the run via the SelectorHeal surfacing UI. This is intentional — blocking a running test for human approval would make CI pipelines unworkable.

---

## Healing — SelectorHeal Record Linking

The `SelectorHeal` model links to both the `TestRun` and the specific `RunStep`, and also stores a reference to the `TestCase` step definition so the "Update selector in test definition" action can find and patch the right record:

```prisma
model SelectorHeal {
  id                String   @id @default(uuid())
  orgId             String

  // Run context
  featureRunId      String
  testRunId         String
  testRun           TestRun  @relation(fields: [testRunId], references: [id], onDelete: Cascade)
  runStepId         String
  runStep           RunStep  @relation(fields: [runStepId], references: [id], onDelete: Cascade)

  // Test definition link (for "update selector" action)
  testCaseId        String
  stepIndex         Int

  // Healing data
  stepName          String
  stepType          String
  originalSelector  String?    // null if step had no selector at all
  healedSelector    String
  confidence        String     // high | medium | low
  source            String     // code | visual | accessibility | combined
  reasoning         String?
  status            String     @default("APPLIED")  // APPLIED | SKIPPED

  createdAt         DateTime   @default(now())

  @@index([testCaseId, stepIndex])
  @@index([testRunId])
  @@map("selector_heals")
}
```

### "Update Selector" Action

When the tester clicks "Update selector in test definition" in the run detail view:

```
PATCH /api/v1/test-cases/:testCaseId/steps/:stepIndex/selector
Body: { selector: "<new selector>", healId: "<selectorHealId>" }
```

This updates `TestStep.input.selector` on the live test case definition so the next run uses the new selector without needing to heal again. The `SelectorHeal` record is marked `updatedTestDefinition: true` for analytics.

---

## Flaky Detection Integration

When a step is healed in run N, and the same step also failed (without healing) in runs N-1, N-2, the `FlakyDetectionService` is notified:

```typescript
await this.flakyService.recordHeal({
  testCaseId: step.testCaseId,
  stepIndex:  step.index,
  runId:      testRunId,
  originalSelector: step.input.selector,
  healedSelector:   heal.selector,
});
```

If the same step needs healing in 3+ consecutive runs, the step is flagged as **flaky** with reason `SELECTOR_DRIFT` — indicating the underlying UI is changing frequently. This surfaces in the AI Intelligence → Flaky Tests dashboard.

See `docs/AI_INTELLIGENCE.md` for the full flaky detection algorithm.
