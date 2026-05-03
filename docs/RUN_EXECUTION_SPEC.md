# Run Execution Specification

Full reference for how a test run travels from API trigger through BullMQ, the worker process, Playwright, and back to the database — including real-time streaming, error handling, and artifact storage.

Related docs:
- `docs/STEP_DEFINITION_SPEC.md` — step JSON structure and per-type input specs
- `docs/LIVE_TEST_VIEWER.md` — CDP screencast pipeline and UI
- `docs/WORKER_ARCHITECTURE.md` — queue configuration, fair queuing, horizontal scaling
- `docs/AI_EXECUTION_ENGINE.md` — AI/selector healing during execution

---

## 1. High-Level Sequence

```
Client (Web/API)
  │
  │  POST /api/v1/projects/:projectId/features/:featureId/runs
  │
  ▼
RunsController
  │  1. Validate request (DTO)
  │  2. Auth + OrgGuard + ProjectRoleGuard
  │  3. Guard: project has ≥1 environment
  │  4. Guard: caller allowed in target environment
  │
  ▼
RunsService.triggerRun()
  │  1. Resolve environment (explicit or phase default)
  │  2. Create FeatureRun record  → status: QUEUED
  │  3. Create TestRun records    → status: QUEUED  (one per TestCase)
  │  4. Create RunStep records    → status: PENDING (one per step per TestCase)
  │  5. Emit socket event: run:queued
  │  6. Enqueue BullMQ job(s)
  │
  ▼
BullMQ  (queue: "test-runs")
  │  Job payload: { testRunId }
  │
  ▼
RunExecutorProcessor  (worker process)
  │  1. Fetch TestRun + TestCase + steps from DB
  │  2. Launch Playwright browser
  │  3. Open CDP session → start screencast
  │  4. Execute steps via StepRunner
  │  5. Write result to DB
  │  6. Upload artifacts (screenshots, video, HAR)
  │  7. Close browser
  │  8. Roll up FeatureRun status
  │
  ▼
DB + Redis + S3-compatible storage
```

---

## 2. Trigger Endpoint

### Request

```
POST /api/v1/projects/:projectId/features/:featureId/runs
Authorization: Bearer <token>
Content-Type: application/json
```

```typescript
// TriggerRunDto
class TriggerRunDto {
  @IsOptional()
  @IsUUID()
  environmentId?: string;          // override — uses phase default if omitted

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  testCaseIds?: string[];          // subset — runs all if omitted

  @IsOptional()
  @IsEnum(RunMode)
  mode?: RunMode;                  // 'full' | 'smoke' | 'regression' — default 'full'

  @IsOptional()
  @IsString()
  triggeredBy?: string;            // 'manual' | 'ci' | 'schedule' — default 'manual'

  @IsOptional()
  ciContext?: CiContextDto;        // filled by CI webhook handler
}

class CiContextDto {
  @IsString() commitSha: string;
  @IsString() branch: string;
  @IsOptional() @IsString() prNumber?: string;
  @IsOptional() @IsString() pipelineUrl?: string;
}
```

### Pre-flight Guards

1. **Feature exists** — 404 if not found or soft-deleted
2. **Project has environment** — 400: `"Project has no environments configured. Add an environment in Project Settings before running tests."`
3. **Environment resolved** — if `environmentId` provided, verify it belongs to the project; if omitted, resolve from current feature phase; 400 if still unresolved
4. **Caller environment access** — unless OWNER/ORG_ADMIN, caller's `ProjectMember.allowedEnvironmentIds` must include resolved env (or be empty = all)
5. **Test cases exist** — 400 if feature has no test cases (or if `testCaseIds` given but none found)

### Response

```typescript
interface TriggerRunResponse {
  featureRunId: string;
  testRunIds:   string[];          // one per TestCase
  status:       'QUEUED';
  queuePosition?: number;          // estimated position in queue
  environmentId: string;
  environmentName: string;
}
```

HTTP 202 Accepted.

---

## 3. Database Records Created at Trigger

### 3.1 FeatureRun

```prisma
model FeatureRun {
  id              String    @id @default(uuid())
  featureId       String
  orgId           String
  projectId       String
  environmentId   String
  featurePhaseId  String?
  triggeredBy     String    @default("manual")
  ciContext       Json?
  mode            RunMode   @default(FULL)
  status          RunStatus @default(QUEUED)
  startedAt       DateTime?
  completedAt     DateTime?
  duration        Int?      // ms
  passCount       Int       @default(0)
  failCount       Int       @default(0)
  skipCount       Int       @default(0)
  totalCount      Int       @default(0)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
}
```

### 3.2 TestRun

One record per `TestCase` included in this run.

```prisma
model TestRun {
  id            String    @id @default(uuid())
  featureRunId  String
  testCaseId    String
  orgId         String
  status        RunStatus @default(QUEUED)
  startedAt     DateTime?
  completedAt   DateTime?
  duration      Int?      // ms
  errorMessage  String?
  videoUrl      String?
  harUrl        String?
  screenshotUrl String?   // final screenshot on failure
  healCount     Int       @default(0)   // selector heals applied
  retryCount    Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
}
```

### 3.3 RunStep

One record per step within each TestCase.

```prisma
model RunStep {
  id           String         @id @default(uuid())
  testRunId    String
  orgId        String
  stepIndex    Int
  stepType     String
  stepName     String
  input        Json           // snapshot of TestStep.input at execution time
  status       RunStepStatus  @default(PENDING)
  startedAt    DateTime?
  completedAt  DateTime?
  duration     Int?           // ms
  errorMessage String?
  screenshotUrl String?       // taken on failure, or SCREENSHOT step
  actualValue  String?        // captured value for ASSERT steps
  healApplied  Boolean        @default(false)
  healSelector String?        // new selector if healed
  createdAt    DateTime       @default(now())
  updatedAt    DateTime       @updatedAt
}
```

### RunStatus Enum

```typescript
enum RunStatus {
  QUEUED     = 'QUEUED',
  RUNNING    = 'RUNNING',
  PASSED     = 'PASSED',
  FAILED     = 'FAILED',
  ABORTED    = 'ABORTED',
  TIMED_OUT  = 'TIMED_OUT',
  SKIPPED    = 'SKIPPED',
}
```

### RunStepStatus Enum

```typescript
enum RunStepStatus {
  PENDING   = 'PENDING',    // not yet reached
  RUNNING   = 'RUNNING',    // currently executing
  PASSED    = 'PASSED',
  FAILED    = 'FAILED',
  SKIPPED   = 'SKIPPED',    // skipped because earlier step failed + continueOnFail=false
  HEALING   = 'HEALING',    // AI selector healing in progress
}
```

---

## 4. BullMQ Job

### Queue Name

`test-runs`

See `docs/WORKER_ARCHITECTURE.md` for concurrency config, fair queuing by `orgId`, and priority settings.

### Job Payload

```typescript
interface TestRunJob {
  testRunId:    string;
  featureRunId: string;
  orgId:        string;       // for fair-queue grouping
  priority?:    number;       // 1 (highest) … 10 (lowest); default 5
}
```

The worker fetches all other data from the database — **the job payload is intentionally minimal** to avoid stale data if the job is delayed in queue.

### Job Options

```typescript
const jobOptions: JobsOptions = {
  attempts:    3,
  backoff:     { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86400 },   // keep 24 h
  removeOnFail:     { age: 604800 },  // keep 7 days
  timeout:     Number(process.env.RUN_TIMEOUT_MS) || 300_000,  // 5 min default
};
```

If a TestCase has multiple test runs in the same FeatureRun (not typical but possible for retry runs), each gets its own job.

---

## 5. Worker — RunExecutorProcessor

File: `apps/worker/src/processors/run-executor.processor.ts`

### 5.1 Entry Point

```typescript
@Processor('test-runs')
export class RunExecutorProcessor {

  @Process()
  async handle(job: Job<TestRunJob>): Promise<void> {
    const { testRunId, featureRunId, orgId } = job.data;

    // 1. Mark as RUNNING
    await this.db.testRun.update({
      where: { id: testRunId },
      data:  { status: 'RUNNING', startedAt: new Date() },
    });

    // emit socket: testRun:started
    this.gateway.emitToOrg(orgId, 'testRun:started', { testRunId, featureRunId });

    // 2. Fetch full data
    const testRun = await this.fetchTestRun(testRunId);

    // 3. Execute
    let result: RunResult;
    try {
      result = await this.executeTestRun(testRun);
    } catch (err) {
      result = this.buildErrorResult(err);
    }

    // 4. Persist result
    await this.persistResult(testRunId, result);

    // 5. Roll up FeatureRun
    await this.rollUpFeatureRun(featureRunId);
  }
}
```

### 5.2 Data Fetch

```typescript
private async fetchTestRun(testRunId: string) {
  return this.db.testRun.findUniqueOrThrow({
    where: { id: testRunId },
    include: {
      testCase: {
        include: {
          steps: { orderBy: { index: 'asc' } },
        },
      },
      featureRun: {
        include: {
          environment: true,    // baseUrl, headers, variables
          feature:    true,     // name, description for context
        },
      },
    },
  });
}
```

### 5.3 Environment Variables Resolution

The `Environment` model stores:
- `baseUrl: string` — prepended to any relative URL step
- `variables: Json` — key/value map injected into step tokens, e.g. `{{ENV.USERNAME}}`
- `headers: Json` — default request headers for API test steps

At runtime, `StepRunner` merges environment variables with run-time variables (captured `{{LAST_RESPONSE_BODY}}` etc.) into a single `VariableContext` map.

---

## 6. Playwright Launch

### 6.1 Browser Config

```typescript
const browser = await chromium.launch({
  headless:   true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
  ],
});

const context = await browser.newContext({
  baseURL:           environment.baseUrl,
  extraHTTPHeaders:  environment.headers ?? {},
  recordVideo:       { dir: tmpVideoDir, size: { width: 1280, height: 720 } },
  recordHar:         { path: tmpHarPath },
  viewport:          { width: 1280, height: 720 },
  ignoreHTTPSErrors: environment.ignoreSSL ?? false,
});

const page = await context.newPage();
```

### 6.2 CDP Session + Screencast

```typescript
const cdpSession = await context.newCDPSession(page);

await cdpSession.send('Page.startScreencast', {
  format:        'jpeg',
  quality:       60,
  maxWidth:      1280,
  maxHeight:     720,
  everyNthFrame: 2,   // ~15 fps
});

cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
  // Ack immediately — Chromium pauses screencasting if not ack'd
  await cdpSession.send('Page.screencastFrameAck', { sessionId });

  // Publish to Redis channel — ScreencastGateway picks this up
  await this.redis.publish(
    `screencast:${testRunId}`,
    JSON.stringify({ data, timestamp: Date.now() }),
  );
});
```

Screencast stops automatically when the CDP session closes (on `browser.close()`).

The `ScreencastGateway` (Socket.io) subscribes to `screencast:{testRunId}` and emits `screencast:frame` events to clients in the room `run:{testRunId}`. See `docs/LIVE_TEST_VIEWER.md` for the full gateway implementation.

---

## 7. StepRunner

File: `apps/worker/src/execution/step-runner.ts`

### 7.1 Main Loop

```typescript
export class StepRunner {
  async run(
    steps:    TestStep[],
    page:     Page,
    context:  BrowserContext,
    env:      Environment,
    testRunId: string,
  ): Promise<StepResult[]> {

    const vars: VariableContext = this.buildInitialVars(env);
    const results: StepResult[] = [];

    for (const step of steps) {
      // Mark step RUNNING
      await this.db.runStep.update({
        where: { testRunId_stepIndex: { testRunId, stepIndex: step.index } },
        data:  { status: 'RUNNING', startedAt: new Date() },
      });

      this.gateway.emitToOrg(this.orgId, 'runStep:running', {
        testRunId,
        stepIndex: step.index,
      });

      const result = await this.executeStep(step, page, context, vars);
      results.push(result);

      // Update RunStep with result
      await this.db.runStep.update({
        where: { testRunId_stepIndex: { testRunId, stepIndex: step.index } },
        data: {
          status:        result.passed ? 'PASSED' : 'FAILED',
          completedAt:   new Date(),
          duration:      result.duration,
          errorMessage:  result.error ?? null,
          screenshotUrl: result.screenshotUrl ?? null,
          actualValue:   result.actualValue ?? null,
          healApplied:   result.healApplied ?? false,
          healSelector:  result.healSelector ?? null,
        },
      });

      this.gateway.emitToOrg(this.orgId, 'runStep:completed', {
        testRunId,
        stepIndex:  step.index,
        status:     result.passed ? 'PASSED' : 'FAILED',
        duration:   result.duration,
        error:      result.error,
      });

      // Capture variable from step output
      if (result.capturedValue !== undefined) {
        vars[`STEP_${step.index}_VALUE`] = result.capturedValue;
      }

      // Abort remaining steps if failed and continueOnFail=false
      if (!result.passed && !step.continueOnFail) {
        const remaining = steps.slice(step.index + 1);
        await this.markRemainingSkipped(remaining, testRunId);
        break;
      }
    }

    return results;
  }
}
```

### 7.2 Variable Context

```typescript
interface VariableContext {
  // Environment variables — set before run starts
  [key: `ENV.${string}`]: string;

  // Runtime tokens — updated after each step
  LAST_RESPONSE_BODY:    string;
  LAST_RESPONSE_STATUS:  string;
  LAST_RESPONSE_HEADERS: string;    // JSON string
  CURRENT_URL:           string;
  PAGE_TITLE:            string;

  // Step capture tokens — set when a step emits capturedValue
  [key: `STEP_${number}_VALUE`]: string;

  // Any other run-level vars
  [key: string]: string;
}
```

Token substitution is applied to all `string` fields in `StepInput` before execution:

```typescript
function resolveTokens(value: string, vars: VariableContext): string {
  return value.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');
}
```

### 7.3 Per-Type Execution

Each step type maps to a handler. Full input specs are in `docs/STEP_DEFINITION_SPEC.md`.

| StepType | Playwright / implementation |
|----------|-----------------------------|
| `NAVIGATE` | `page.goto(url, { waitUntil })` |
| `CLICK` | `page.locator(selector).click({ timeout })` |
| `DBLCLICK` | `page.locator(selector).dblclick({ timeout })` |
| `FILL` | `page.locator(selector).fill(value)` |
| `TYPE` | `page.locator(selector).type(value, { delay })` |
| `CLEAR` | `page.locator(selector).clear()` |
| `SELECT` | `page.locator(selector).selectOption(value)` |
| `CHECK` | `page.locator(selector).check()` |
| `UNCHECK` | `page.locator(selector).uncheck()` |
| `HOVER` | `page.locator(selector).hover()` |
| `PRESS_KEY` | `page.locator(selector ?? 'body').press(key)` |
| `SCROLL` | `page.locator(selector ?? 'body').evaluate(el => el.scrollBy(x,y))` |
| `WAIT_FOR_SELECTOR` | `page.locator(selector).waitFor({ state, timeout })` |
| `WAIT_FOR_NAVIGATION` | `page.waitForNavigation({ url, timeout })` |
| `WAIT_MS` | `await sleep(ms)` |
| `ASSERT_TEXT` | `expect(page.locator(selector)).toHaveText(expected)` |
| `ASSERT_VISIBLE` | `expect(page.locator(selector)).toBeVisible()` |
| `ASSERT_VALUE` | `expect(page.locator(selector)).toHaveValue(expected)` |
| `ASSERT_URL` | `expect(page).toHaveURL(pattern)` |
| `SCREENSHOT` | `page.screenshot()` → upload → store URL in RunStep |
| `API_REQUEST` | `context.request.fetch(url, { method, headers, body })` |
| `EXECUTE_SCRIPT` | `page.evaluate(script, args)` |

### 7.4 Selector Healing

When a `locator()` call throws a `TimeoutError` (selector not found), the worker triggers the AI Healing flow before marking the step failed:

```typescript
async function tryWithHealing(
  step:    TestStep,
  page:    Page,
  handler: StepHandler,
): Promise<StepResult> {
  try {
    return await handler.execute(step, page);
  } catch (err) {
    if (!isLocatorTimeout(err)) throw err;
    if (!step.aiDescription) return buildFailResult(err);  // can't heal without description

    // Change RunStep status to HEALING
    await markHealing(step.index);

    const healed = await this.healerAgent.heal({
      originalSelector: step.input.selector,
      aiDescription:    step.aiDescription,
      accessibilityTree: await page.accessibility.snapshot(),
      screenshot:        await page.screenshot({ type: 'png' }),
    });

    if (!healed || healed.confidence < 0.75) {
      return buildFailResult(err, 'Healing confidence below threshold');
    }

    // Retry with new selector
    const healedStep = { ...step, input: { ...step.input, selector: healed.selector } };
    const result = await handler.execute(healedStep, page);
    return { ...result, healApplied: true, healSelector: healed.selector };
  }
}
```

See `docs/AI_EXECUTION_ENGINE.md` for full healing agent implementation.

### 7.5 Step Timeout

Each step uses `step.timeoutMs ?? process.env.STEP_TIMEOUT_MS ?? 30_000`.

`WAIT_MS` is exempt — its `ms` value is the explicit wait, not a timeout.

The step timeout is passed to Playwright's `timeout` option where supported. For custom steps (EXECUTE_SCRIPT, API_REQUEST), a `Promise.race` wrapper enforces the limit.

### 7.6 API_REQUEST Step Detail

```typescript
case 'API_REQUEST': {
  const { url, method, headers, body, captureResponseAs } = input as ApiRequestInput;

  const response = await context.request.fetch(resolveTokens(url, vars), {
    method:  method ?? 'GET',
    headers: { ...env.headers, ...headers },
    data:    body ? resolveTokens(JSON.stringify(body), vars) : undefined,
    timeout: step.timeoutMs ?? 30_000,
  });

  const responseText = await response.text();

  // Update runtime tokens
  vars['LAST_RESPONSE_BODY']    = responseText;
  vars['LAST_RESPONSE_STATUS']  = String(response.status());
  vars['LAST_RESPONSE_HEADERS'] = JSON.stringify(response.headers());

  // Named capture for later steps
  if (captureResponseAs) {
    try {
      const parsed = JSON.parse(responseText);
      const extracted = captureResponseAs.jsonPath
        ? jsonPath.query(parsed, captureResponseAs.jsonPath)[0]
        : responseText;
      vars[captureResponseAs.variableName] = String(extracted);
    } catch {
      vars[captureResponseAs.variableName] = responseText;
    }
  }

  // Assertion (optional)
  if (input.assertions) {
    for (const assertion of input.assertions) {
      // validate status, body content, headers etc.
      await this.apiAssert(assertion, response, responseText, vars);
    }
  }

  break;
}
```

---

## 8. Artifact Storage

### 8.1 Screenshots

Any `SCREENSHOT` step, or auto-screenshot on step failure, is stored as:

```
artifacts/
  {orgId}/
    {featureRunId}/
      {testRunId}/
        step-{stepIndex}-screenshot.png
        failure-step-{stepIndex}.png
```

Storage backend: S3-compatible (MinIO for self-hosted; any S3 bucket). Configured via:

```env
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_BUCKET=qa-platform-artifacts
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_PUBLIC_URL_BASE=http://localhost:9000/qa-platform-artifacts
```

`RunStep.screenshotUrl` stores the public URL.

### 8.2 Video

Playwright records video via `recordVideo` context option. After the run:

```typescript
await page.video()?.saveAs(path.join(tmpDir, `${testRunId}.webm`));
```

Uploaded to `artifacts/{orgId}/{featureRunId}/{testRunId}/recording.webm`.
`TestRun.videoUrl` stores the public URL.

Video is only stored if `env.recordVideo !== false` (default: true).

### 8.3 HAR

Playwright records a HAR file via `recordHar`. After the run:

```typescript
await context.close();  // finalises HAR file
// upload tmpHarPath to storage
```

`TestRun.harUrl` stores the public URL. HAR is available for download in the run detail view.

---

## 9. Result Persistence

### 9.1 TestRun Final Update

```typescript
await this.db.testRun.update({
  where: { id: testRunId },
  data: {
    status:        overallStatus,    // PASSED | FAILED | ABORTED | TIMED_OUT
    completedAt:   new Date(),
    duration:      Date.now() - startedAt.getTime(),
    errorMessage:  fatalError ?? null,
    videoUrl,
    harUrl,
    screenshotUrl: lastFailureScreenshot ?? null,
    healCount:     results.filter(r => r.healApplied).length,
  },
});
```

### 9.2 FeatureRun Roll-Up

Called after every `TestRun` in the `FeatureRun` completes (including when one is still running — we check remaining):

```typescript
async rollUpFeatureRun(featureRunId: string): Promise<void> {
  const runs = await this.db.testRun.findMany({
    where: { featureRunId },
    select: { status: true },
  });

  const allDone = runs.every(r => TERMINAL_STATUSES.includes(r.status));
  if (!allDone) return;   // still waiting for other test runs

  const passCount = runs.filter(r => r.status === 'PASSED').length;
  const failCount = runs.filter(r => r.status === 'FAILED').length;
  const skipCount = runs.filter(r => r.status === 'SKIPPED').length;

  const featureStatus: RunStatus =
    failCount > 0 ? 'FAILED' :
    passCount === runs.length ? 'PASSED' :
    'SKIPPED';

  await this.db.featureRun.update({
    where: { id: featureRunId },
    data: {
      status:      featureStatus,
      completedAt: new Date(),
      passCount,
      failCount,
      skipCount,
      totalCount:  runs.length,
    },
  });

  // Emit final event
  this.gateway.emitToOrg(orgId, 'featureRun:completed', {
    featureRunId,
    status: featureStatus,
    passCount,
    failCount,
    skipCount,
  });

  // Trigger phase status evaluation
  await this.phaseEngine.evaluateFeatureRunResult(featureRunId, featureStatus);
}
```

### 9.3 Phase Engine Evaluation

After a FeatureRun completes, the `PhaseEngine` checks whether the feature's current phase passes or fails based on project phase configuration (pass threshold, required test count, etc.). See `docs/TESTING_PHASES_AND_REPORTS.md` for the full phase transition logic.

---

## 10. Real-Time Socket Events

All events are emitted to the Socket.io room `org:{orgId}`.

Clients watching a specific run also join room `run:{featureRunId}`.

| Event | Payload | When |
|-------|---------|------|
| `run:queued` | `{ featureRunId, testRunIds, queuePosition }` | After DB records created |
| `testRun:started` | `{ testRunId, featureRunId }` | Worker picks up job |
| `runStep:running` | `{ testRunId, stepIndex }` | Step begins |
| `runStep:completed` | `{ testRunId, stepIndex, status, duration, error? }` | Step ends |
| `screencast:frame` | `{ data: string, timestamp: number }` | Each CDP frame (15 fps) |
| `testRun:completed` | `{ testRunId, featureRunId, status, duration, healCount }` | TestRun finalised |
| `featureRun:completed` | `{ featureRunId, status, passCount, failCount, skipCount }` | All TestRuns done |

---

## 11. Error Handling

### 11.1 Worker Crash / Job Timeout

BullMQ marks the job `failed` with `MoveToFailedError`. After `attempts` (default 3) retries with exponential backoff, the job is permanently failed.

The `job:failed` event handler in `RunExecutorProcessor`:

```typescript
@OnQueueFailed()
async onFailed(job: Job, err: Error): Promise<void> {
  if (job.attemptsMade >= job.opts.attempts) {
    // Final failure — mark DB records
    await this.db.testRun.update({
      where: { id: job.data.testRunId },
      data: {
        status:       'FAILED',
        completedAt:  new Date(),
        errorMessage: `Worker error: ${err.message}`,
      },
    });
    // Mark any still-PENDING RunStep records as SKIPPED
    await this.db.runStep.updateMany({
      where: { testRunId: job.data.testRunId, status: { in: ['PENDING', 'RUNNING'] } },
      data:  { status: 'SKIPPED' },
    });
    await this.rollUpFeatureRun(job.data.featureRunId);
  }
}
```

### 11.2 Run Timeout

The BullMQ job `timeout` option kills the job if it exceeds `RUN_TIMEOUT_MS` (default 5 min). The `onFailed` handler catches this as a `TimeoutError`.

A per-run soft timeout also exists: if the run has been `RUNNING` for more than `RUN_TIMEOUT_MS`, the worker will stop executing steps and mark the TestRun `TIMED_OUT`.

### 11.3 Browser Crash

If the browser crashes mid-run, `page.evaluate()` or any Playwright call throws. This is caught by the outer try/catch in `handle()` and goes through the normal failure path.

### 11.4 Partial Failure (continueOnFail)

When a step fails and `continueOnFail = true`, execution continues. Remaining steps are executed normally. The TestRun status is `FAILED` if any step failed, regardless of `continueOnFail`.

When a step fails and `continueOnFail = false` (default), all remaining steps are marked `SKIPPED` and the loop breaks.

### 11.5 Step-Level Screenshots on Failure

Whenever a step transitions to `FAILED`, the worker automatically captures a screenshot:

```typescript
if (!result.passed) {
  try {
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    const url = await this.storage.upload(buf, `failure-step-${step.index}.png`);
    result.screenshotUrl = url;
  } catch {
    // screenshot capture failed — non-fatal
  }
}
```

---

## 12. Abort / Cancel

### API Endpoint

```
POST /api/v1/runs/:featureRunId/abort
```

```typescript
// AbortRunDto — no body required
```

The handler:
1. Sets `FeatureRun.status = 'ABORTED'`
2. Finds all `TestRun` records that are `QUEUED` or `RUNNING`
3. For QUEUED runs — removes the BullMQ job (`queue.remove(jobId)`)
4. For RUNNING runs — publishes abort signal to Redis: `PUBLISH run:abort:{testRunId} 1`
5. The worker's `StepRunner` checks this flag between steps:

```typescript
// In StepRunner.run() loop, after each step:
const aborted = await this.redis.get(`run:abort:${testRunId}`);
if (aborted) {
  await this.markRemainingSkipped(remainingSteps, testRunId);
  throw new RunAbortedError('Run aborted by user');
}
```

---

## 13. Retry a Failed Run

### API Endpoint

```
POST /api/v1/runs/:featureRunId/retry
```

Options:

```typescript
class RetryRunDto {
  @IsOptional()
  @IsBoolean()
  failedOnly?: boolean;    // default true — only re-run failed TestCases

  @IsOptional()
  @IsBoolean()
  resetResults?: boolean;  // default false — keep previous pass results
}
```

A retry creates **new** `TestRun` and `RunStep` records (linked to the same `FeatureRun`). Previous records are preserved for history. The `FeatureRun` roll-up considers the **latest** `TestRun` per `TestCase` when calculating final status.

---

## 14. Run History and Pagination

### List Runs

```
GET /api/v1/projects/:projectId/features/:featureId/runs?page=1&limit=20&status=FAILED
```

Returns:

```typescript
interface FeatureRunListItem {
  id:             string;
  status:         RunStatus;
  triggeredBy:    string;
  environment:    { id: string; name: string };
  passCount:      number;
  failCount:      number;
  totalCount:     number;
  duration:       number | null;
  createdAt:      string;
  completedAt:    string | null;
}
```

### Get Run Detail

```
GET /api/v1/runs/:featureRunId
```

Returns the full `FeatureRun` with nested `TestRun[]`, each with nested `RunStep[]`. Includes artifact URLs.

---

## 15. CI-Triggered Runs

CI systems (GitHub Actions, GitLab CI, etc.) call the trigger endpoint with an API key:

```
POST /api/v1/projects/:projectId/features/:featureId/runs
Authorization: Bearer <PROJECT_API_KEY>
Content-Type: application/json

{
  "triggeredBy": "ci",
  "ciContext": {
    "commitSha": "abc123",
    "branch": "feature/login-redesign",
    "prNumber": "42",
    "pipelineUrl": "https://github.com/org/repo/actions/runs/99"
  }
}
```

The `ciContext` is stored on `FeatureRun.ciContext` and surfaced in the run detail view and commit status updates.

See `docs/GIT_NATIVE_CI.md` for the full CI webhook and commit status flow.

---

## 16. Status Transition Diagram

```
FeatureRun / TestRun:
  QUEUED ──► RUNNING ──► PASSED
                    │
                    ├──► FAILED
                    ├──► TIMED_OUT
                    └──► ABORTED

RunStep:
  PENDING ──► RUNNING ──► PASSED
                     │
                     ├──► FAILED
                     ├──► SKIPPED   (continueOnFail=false on earlier step)
                     └──► HEALING ──► PASSED
                                 └──► FAILED
```

Terminal states: `PASSED`, `FAILED`, `TIMED_OUT`, `ABORTED`, `SKIPPED`.

Once a record reaches a terminal state it is never updated again (except by a retry, which creates new records).
