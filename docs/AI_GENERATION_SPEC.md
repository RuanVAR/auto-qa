# AI Test Generation Specification

Full reference for how the AI generates test cases and steps — prompt construction, context injection order, JSON schema validation, streaming, error recovery, and all four generation surfaces.

Related docs:
- `docs/AI_LAYER.md` — LangChain setup, provider config, embedding cache, pgvector vs Qdrant
- `docs/CODEBASE_AWARE_TESTING.md` — RAG pipeline, code chunk retrieval, repo connection
- `docs/STEP_DEFINITION_SPEC.md` — Canonical step JSON schema the AI must output
- `docs/STEP_EDITOR_SPEC.md` — UI surfaces that trigger generation
- `docs/PM_INTEGRATIONS.md` — Ticket context injection (Jira/ClickUp AC)

---

## 1. Generation Surfaces

| Surface | Trigger | Output |
|---------|---------|--------|
| **Feature-level generation** | New feature created (auto) or `[Generate Test Cases]` clicked | Multiple TestCase records with steps each |
| **Test case generation** | `[✦ Generate with AI]` on empty test case | Steps for a single test case |
| **Regenerate** | `[Regenerate All Steps]` or `[Regenerate with Instructions]` | Replaces/augments steps in one test case |
| **Acceptance criteria import** | `[Import AC from Ticket]` in feature header | New test cases derived from AC bullet points |

All surfaces share the same underlying `AiGenerationService` — they differ only in what context is provided and which part of the output is used.

---

## 2. LangChain Chain

File: `apps/api/src/ai/generation/test-generation.chain.ts`

```typescript
import { ChatAnthropic }      from '@langchain/anthropic';
import { ChatOpenAI }         from '@langchain/openai';
import { PromptTemplate }     from '@langchain/core/prompts';
import { JsonOutputParser }   from '@langchain/core/output_parsers';
import { RunnableSequence }   from '@langchain/core/runnables';

// Provider selected at runtime from AI_PROVIDER env var
const model = process.env.AI_PROVIDER === 'openai'
  ? new ChatOpenAI({ model: 'gpt-4o', temperature: 0.2 })
  : new ChatAnthropic({ model: 'claude-opus-4-5', temperature: 0.2 });

export const testGenerationChain = RunnableSequence.from([
  PromptTemplate.fromTemplate(GENERATION_PROMPT_TEMPLATE),
  model,
  new JsonOutputParser(),
]);
```

`temperature: 0.2` — low randomness for deterministic, well-structured step output.

---

## 3. Prompt Template

### 3.1 Master Template

```
GENERATION_PROMPT_TEMPLATE = `
You are a QA automation expert. Your task is to generate automated test cases
for a web application.

## Output Format
You MUST respond with valid JSON only — no prose, no markdown fences, no explanations.
The JSON schema is:

{{JSON_SCHEMA}}

## Application Context
Base URL: {{BASE_URL}}
Feature name: {{FEATURE_NAME}}
Feature description: {{FEATURE_DESCRIPTION}}

{{#if TICKET_CONTEXT}}
## Ticket / User Story
{{TICKET_CONTEXT}}
{{/if}}

{{#if CODEBASE_CONTEXT}}
## Relevant Code
The following source files are relevant to this feature.
Use selectors, routes, and field names from this code when generating steps.

{{CODEBASE_CONTEXT}}
{{/if}}

{{#if EXISTING_TEST_CASES}}
## Existing Test Cases (do not duplicate)
{{EXISTING_TEST_CASES}}
{{/if}}

{{#if USER_INSTRUCTION}}
## Additional Instructions
{{USER_INSTRUCTION}}
{{/if}}

## What to generate
{{GENERATION_INSTRUCTION}}

Remember: respond with JSON only.
`
```

### 3.2 Context Block Injection Order

Context blocks are injected in this order of priority (most important first, since LLMs attend to earlier tokens more strongly):

1. **JSON schema** — always first so the model knows the output contract
2. **Application context** — base URL, feature name, feature description
3. **Ticket context** — Jira/ClickUp story description + acceptance criteria (if linked)
4. **Codebase context** — RAG-retrieved code chunks (if codebase connected)
5. **Existing test cases** — to avoid generating duplicate coverage
6. **User instruction** — any free-text instruction from the user (Regenerate with Instructions)
7. **Generation instruction** — what specifically to generate (varies by surface, see §4)

### 3.3 Total Token Budget

Maximum input tokens: 32,000 (fits comfortably within Claude 3.5 Sonnet context).

| Block | Max tokens |
|-------|-----------|
| System prompt + schema | ~2,500 |
| Application context | ~500 |
| Ticket context | ~2,000 |
| Codebase context | ~20,000 |
| Existing test cases | ~3,000 |
| User instruction | ~500 |
| Generation instruction | ~200 |
| **Total** | ~28,700 |

If codebase context would exceed its budget, the RAG retriever ranks chunks by similarity score and truncates lowest-score chunks first.

---

## 4. JSON Output Schema

The AI is required to return this JSON structure (a subset of the full internal data model, to keep the prompt schema simple):

### 4.1 Feature-Level Generation Output

```json
{
  "$schema": "qa-platform/test-generation/v1",
  "testCases": [
    {
      "name": "string — descriptive test case name",
      "description": "string — what this test case validates (optional)",
      "priority": "HIGH | MEDIUM | LOW",
      "steps": [
        {
          "index": 1,
          "type": "STEP_TYPE",
          "name": "string — human-readable step description",
          "input": { ... },
          "continueOnFail": false,
          "aiDescription": "string — describe what UI element this targets (optional)"
        }
      ]
    }
  ]
}
```

### 4.2 Single Test Case Output

```json
{
  "$schema": "qa-platform/test-generation/v1",
  "steps": [
    {
      "index": 1,
      "type": "STEP_TYPE",
      "name": "string",
      "input": { ... },
      "continueOnFail": false,
      "aiDescription": "string"
    }
  ]
}
```

### 4.3 Step Type Guidance in Schema

The JSON schema block in the prompt includes a concise inline reference for each step type. This is a summary — the model already has training data on Playwright but the inline reminder aligns it to our exact field names:

```
Step types and their required input fields:
NAVIGATE:          { url: string, waitUntil?: "load|domcontentloaded|networkidle" }
CLICK:             { selector: string, button?: "left|right|middle" }
DBLCLICK:          { selector: string }
FILL:              { selector: string, value: string }
TYPE:              { selector: string, text: string, delay?: number }
CLEAR:             { selector: string }
SELECT:            { selector: string, value?: string, label?: string, index?: number }
CHECK:             { selector: string }
UNCHECK:           { selector: string }
HOVER:             { selector: string }
PRESS_KEY:         { key: string, selector?: string, modifiers?: string[] }
SCROLL:            { selector?: string, deltaX?: number, deltaY?: number }
WAIT_FOR_SELECTOR: { selector: string, state?: "visible|hidden|attached|detached" }
WAIT_FOR_NAVIGATION:{ url?: string, waitUntil?: "load|domcontentloaded|networkidle" }
WAIT_MS:           { ms: number }
ASSERT_TEXT:       { selector: string, expected: string, matchMode?: "exact|contains|regex" }
ASSERT_VISIBLE:    { selector: string, visible?: boolean }
ASSERT_VALUE:      { selector: string, expected: string }
ASSERT_URL:        { expected: string, matchMode?: "exact|contains|regex" }
SCREENSHOT:        { label?: string, fullPage?: boolean }
API_REQUEST:       { url: string, method?: string, headers?: object, body?: object }
EXECUTE_SCRIPT:    { script: string, args?: any[] }

Selector guidance:
  Prefer: role-based ([role=button][name="Submit"]), data-testid, aria-label
  If code context provided: use exact selectors from the source code
  Avoid: :nth-child positions, auto-generated class names
  If selector unknown: use descriptive placeholder and set aiDescription
```

---

## 5. Context Building

### 5.1 Ticket Context

If the feature has a linked `FeatureTicketLink`, `TicketContextService.getContext(featureId)` fetches the ticket:

```typescript
interface TicketContext {
  title:              string;
  description:        string;   // ADF → plain text (Jira), or raw (ClickUp)
  acceptanceCriteria: string[];  // extracted checklist items
  labels:             string[];
  status:             string;
}
```

Formatted into the prompt as:

```
Title: Implement login page
Description: Users should be able to sign in with their email and password.
  On success they are redirected to /dashboard.
  On failure a toast error is shown.

Acceptance Criteria:
  - Email field accepts valid email format
  - Password field is masked
  - Submit button is disabled while request is in flight
  - On success: redirect to /dashboard within 2 seconds
  - On failure (401): show toast "Invalid credentials"
  - Rate limit: after 5 failures lock for 10 minutes, show countdown
```

### 5.2 Codebase Context (RAG)

If the project has a connected repo (`ProjectRepo`) and `codebaseContextEnabled = true`:

```typescript
const chunks = await this.ragService.retrieveChunks({
  query:     `${feature.name} ${feature.description}`,
  projectId: feature.projectId,
  limit:     20,
  minScore:  0.72,
});
```

Chunks are sorted by score descending and concatenated:

```
// File: src/pages/LoginPage.tsx
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  ...
  return (
    <form onSubmit={handleSubmit} data-testid="login-form">
      <input data-testid="email-input" type="email" ... />
      <input data-testid="password-input" type="password" ... />
      <button data-testid="submit-btn" type="submit">Sign In</button>
    </form>
  );
}

// File: src/api/auth.ts
export async function login(email: string, password: string) {
  return axios.post('/api/v1/auth/login', { email, password });
}
```

The AI uses these exact `data-testid` values in the generated selectors.

### 5.3 Existing Test Cases

Formatted as a list to prevent duplicate coverage:

```
Existing test cases (do not duplicate these scenarios):
  1. "User can log in with valid credentials" — covers happy path login flow
  2. "User sees error with wrong password" — covers invalid credentials error
```

### 5.4 Generation Instructions by Surface

**Feature-level (full generation):**
```
Generate {{TARGET_COUNT}} distinct test cases for this feature.
Cover: happy path, common error cases, edge cases, boundary values.
Each test case should be independent and self-contained.
```

`TARGET_COUNT` = `Math.max(3, Math.ceil(acceptanceCriteria.length * 1.5))` — defaults to 3 if no AC found.

**Single test case generation:**
```
Generate the automation steps for this specific test case: "{{TEST_CASE_NAME}}"
Return only the "steps" array. Do not return a "testCases" wrapper.
```

**Regenerate with instructions:**
```
Regenerate the steps for test case: "{{TEST_CASE_NAME}}"
{{#if PRESERVE}}Append new steps after the existing ones — do not modify existing steps.{{/if}}
{{USER_INSTRUCTION}}
Return only the "steps" array.
```

**AC import:**
```
The following are acceptance criteria from a ticket.
Generate one focused test case per acceptance criterion.
Return the full "testCases" array.

Acceptance Criteria:
{{AC_LIST}}
```

---

## 6. Streaming

Generation uses LangChain streaming for real-time feedback in the UI:

### 6.1 API Endpoint

```
POST /api/v1/features/:featureId/test-cases/generate
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream
```

Response: Server-Sent Events (SSE).

### 6.2 SSE Event Types

```
event: status
data: {"phase": "building_context"}

event: status
data: {"phase": "fetching_codebase_chunks", "chunkCount": 15}

event: status
data: {"phase": "generating"}

event: chunk
data: {"text": "{\n  \"testCases\": [\n    {\n      \"name\""}

event: chunk
data: {"text": ": \"User can log in with"}

... (streaming tokens) ...

event: complete
data: {"testCaseCount": 4, "totalSteps": 23}

event: error
data: {"message": "AI provider error: rate limit exceeded", "code": "RATE_LIMIT"}
```

### 6.3 Frontend SSE Handling

```typescript
const es = new EventSource(`/api/v1/features/${featureId}/test-cases/generate`, {
  headers: { Authorization: `Bearer ${token}` },
});

let buffer = '';

es.addEventListener('status', (e) => {
  const { phase } = JSON.parse(e.data);
  setGenerationPhase(phase);
});

es.addEventListener('chunk', (e) => {
  buffer += JSON.parse(e.data).text;
  // Attempt partial parse to show progress (not always valid JSON mid-stream)
});

es.addEventListener('complete', (e) => {
  es.close();
  const result = JSON.parse(buffer);
  setGeneratedTestCases(result.testCases);
});

es.addEventListener('error', (e) => {
  es.close();
  const { message } = JSON.parse(e.data);
  showErrorToast(message);
});
```

---

## 7. Output Validation

The AI response is parsed and validated before any DB writes.

### 7.1 JSON Parse

```typescript
let parsed: unknown;
try {
  parsed = JSON.parse(rawOutput);
} catch (e) {
  // Attempt cleanup: strip markdown fences if model leaked them
  const cleaned = rawOutput
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new AiOutputParseError('Model returned invalid JSON', rawOutput);
  }
}
```

### 7.2 Schema Validation

Validated with Zod (server-side) against the expected output schema:

```typescript
const TestStepSchema = z.object({
  index:          z.number().int().positive(),
  type:           z.enum(STEP_TYPES),
  name:           z.string().min(1).max(200),
  input:          z.record(z.unknown()),   // per-type validated below
  continueOnFail: z.boolean().default(false),
  timeoutMs:      z.number().optional(),
  aiDescription:  z.string().max(500).optional(),
});

const TestCaseSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  priority:    z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  steps:       z.array(TestStepSchema).min(1).max(50),
});

const GenerationOutputSchema = z.union([
  z.object({ testCases: z.array(TestCaseSchema).min(1).max(20) }),
  z.object({ steps:     z.array(TestStepSchema).min(1).max(50) }),
]);
```

Per-type input validation runs after the outer schema passes — each step's `input` is validated against its type's specific schema.

### 7.3 Input Field Validation Per Type

```typescript
const inputSchemas: Record<StepType, z.ZodSchema> = {
  NAVIGATE:           z.object({ url: z.string().min(1), waitUntil: z.enum([...]).optional() }),
  FILL:               z.object({ selector: z.string().min(1), value: z.string() }),
  CLICK:              z.object({ selector: z.string().min(1), button: z.enum([...]).optional() }),
  // ... all 22 types
};

for (const step of steps) {
  const schema = inputSchemas[step.type];
  const result = schema.safeParse(step.input);
  if (!result.success) {
    // Log validation error and attempt auto-fix (see §7.4)
  }
}
```

### 7.4 Auto-Fix for Minor Validation Errors

Rather than failing the entire generation on minor AI output errors, the service attempts auto-fixes:

| Error | Auto-fix |
|-------|---------|
| `index` values not sequential | Renumber from 1 |
| `continueOnFail` missing | Default to `false` |
| `priority` missing | Default to `MEDIUM` |
| `waitUntil` invalid value | Default to `"load"` |
| `matchMode` invalid | Default to `"contains"` |
| `method` not uppercase | `.toUpperCase()` |

If a step has a missing **required** field (e.g. `selector` for FILL) after auto-fix attempts, the step is flagged in the response but NOT silently dropped:

```json
{
  "testCases": [...],
  "warnings": [
    {
      "testCaseIndex": 1,
      "stepIndex": 3,
      "issue": "FILL step missing required field 'selector' — step included with empty selector, review before running"
    }
  ]
}
```

Warnings are shown in the UI as yellow inline badges on the affected steps.

### 7.5 Full Retry on Unrecoverable Parse Error

If JSON parsing fails even after cleanup, the chain is retried once with an additional instruction appended to the system prompt:

```
IMPORTANT: Your previous response could not be parsed as JSON.
Respond with ONLY the raw JSON object. No explanation, no markdown.
Start your response with { and end with }.
```

If the retry also fails, the error is surfaced to the user:
- Toast: _"AI generation failed. The AI returned an unexpected response. Try again or add steps manually."_
- Error logged with `rawOutput` for debugging

---

## 8. Saving Generated Output

After validation, generated test cases are saved to DB:

```typescript
async saveGeneratedTestCases(
  featureId:  string,
  output:     GenerationOutput,
  options:    { replaceExisting?: boolean } = {},
): Promise<TestCase[]> {

  return this.db.$transaction(async (tx) => {
    if (options.replaceExisting) {
      // Soft-delete existing test cases
      await tx.testCase.updateMany({
        where: { featureId, deletedAt: null },
        data:  { deletedAt: new Date() },
      });
    }

    const created: TestCase[] = [];
    for (const [i, tc] of output.testCases.entries()) {
      const testCase = await tx.testCase.create({
        data: {
          featureId,
          orgId:       feature.orgId,
          name:        tc.name,
          description: tc.description ?? null,
          priority:    tc.priority,
          generatedBy: 'AI',
          steps: {
            create: tc.steps.map(s => ({
              index:          s.index,
              type:           s.type,
              name:           s.name,
              input:          s.input,
              continueOnFail: s.continueOnFail,
              timeoutMs:      s.timeoutMs ?? null,
              aiDescription:  s.aiDescription ?? null,
            })),
          },
        },
      });
      created.push(testCase);
    }
    return created;
  });
}
```

`generatedBy: 'AI'` is stored on the TestCase record to distinguish AI-generated from manually-created cases. This is used for analytics (AI vs manual coverage ratio).

---

## 9. Generation for Single Test Case (Steps Only)

When generating steps for an existing test case (`POST /api/v1/test-cases/:id/generate-steps`):

```typescript
class GenerateStepsForCaseDto {
  @IsOptional() @IsString()
  userInstruction?: string;

  @IsOptional() @IsBoolean()
  preserveExisting?: boolean;   // default false
}
```

1. Fetch the test case (name, description) and its parent feature (name, description)
2. Build context (ticket, codebase) as normal
3. Set generation instruction to single-test-case mode
4. AI returns `{ steps: [...] }` (not `testCases` wrapper)
5. If `preserveExisting = true` — new steps are appended after the highest existing `index`; existing steps unchanged
6. If `preserveExisting = false` — all existing steps soft-deleted, new steps replace them

---

## 10. AC Import Flow

Triggered by `[Import AC from Ticket]` in the Feature header (only shown when a ticket is linked):

```typescript
// POST /api/v1/features/:id/import-ac
```

1. `TicketContextService.getContext(featureId)` fetches AC items
2. If no AC found: error toast _"No acceptance criteria found on the linked ticket."_
3. If found: show preview dialog:

```
┌────────────────────────────────────────────────────────────────────┐
│  Import Acceptance Criteria from Jira                         [✕]  │
│                                                                    │
│  Found 5 acceptance criteria on JRA-42:                            │
│                                                                    │
│  ☑  Email field accepts valid email format                         │
│  ☑  Password field is masked                                       │
│  ☑  Submit button disabled while request is in flight             │
│  ☑  On success: redirect to /dashboard within 2 seconds           │
│  ☑  On failure (401): show toast "Invalid credentials"            │
│                                                                    │
│  Each checked item will become one test case.                      │
│                                                                    │
│  [Cancel]              [Generate Test Cases (5)]                   │
└────────────────────────────────────────────────────────────────────┘
```

4. User deselects any AC items they don't want automated
5. On confirm: generation runs with `AC_IMPORT` generation instruction
6. Generated test cases appear in the feature test case list, each tagged with the source AC text in `TestCase.description`

---

## 11. Duplicate Detection During Generation

Before finalising generated test cases, the `DuplicateDetectionService` checks each new case against existing ones in the feature (and optionally cross-feature):

```typescript
const duplicates = await this.dupeService.findDuplicates({
  candidates:  generatedTestCases,
  featureId,
  threshold:   0.88,   // semantic similarity threshold
});
```

If a generated test case is flagged as a near-duplicate of an existing one, it is shown with a warning in the preview:

```
  ⚠ "User logs in with valid email" is 91% similar to existing
    "User can log in with valid credentials" — review before saving
```

See `docs/AI_INTELLIGENCE.md` for the full duplicate detection algorithm.

---

## 12. Rate Limiting and Queuing

AI generation calls are rate-limited per org to prevent abuse:

- **Max concurrent generation jobs per org:** 3
- **Max generation requests per hour per org:** 50

If the limit is hit:
- HTTP 429 with body: `{ "message": "Generation limit reached. Try again in N minutes.", "retryAfterSeconds": N }`
- The request is NOT queued — the user sees the error immediately and can retry manually

Heavy generation (e.g. bulk AC import with 20+ items) is run as a BullMQ job in the `ai-generation` queue with a webhook notification when complete.

---

## 13. Environment Variables

```env
# AI provider selection
AI_PROVIDER=anthropic          # or 'openai'
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Model overrides (optional — defaults shown)
ANTHROPIC_MODEL=claude-opus-4-5
OPENAI_MODEL=gpt-4o

# Generation settings
AI_GENERATION_TEMPERATURE=0.2
AI_MAX_CODEBASE_CHUNKS=20
AI_MAX_INPUT_TOKENS=32000
AI_GENERATION_TIMEOUT_MS=60000
AI_MAX_CONCURRENT_GENERATION=3
AI_MAX_GENERATION_PER_HOUR=50
```
