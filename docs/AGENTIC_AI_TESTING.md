# Agentic AI Testing

> **Status:** Planned (Phase 8)
> **Depends on:** Phase 5.5 (RAG / Codebase-Aware Testing), Phase 3 (Live Test Viewer), Phase 2-D (Hybrid AI Engine)

---

## Overview

The Agentic AI Testing system provides autonomous, goal-directed test agents that can plan, execute, analyze, and self-heal tests without human intervention. Unlike the existing AI-assisted features (single-shot generation, failure explanation), agentic testing uses a continuous **Observe -> Plan -> Act -> Evaluate -> Adapt** loop where agents pursue testing goals autonomously within configurable boundaries.

The system uses a **multi-agent architecture** with specialized agents coordinated by an orchestrator, each with a bounded responsibility and clear handoff protocol.

---

## Architecture

### Multi-Agent Pipeline

```
                         ┌──────────────────┐
                         │   Orchestrator   │
                         │                  │
                         │ Routes goals to  │
                         │ agent pipeline   │
                         └────────┬─────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │    Planner      │  │   Explorer     │  │   Analyzer     │
     │                 │  │                │  │                │
     │ • Reads reqs    │  │ • Crawls app   │  │ • Classifies   │
     │ • Reads code    │  │ • Maps flows   │  │   failures     │
     │ • Reads tests   │  │ • Finds inputs │  │ • Root cause   │
     │ • Plans coverage│  │ • Discovers UI │  │ • Confidence   │
     └────────┬────────┘  └────────┬───────┘  └────────┬───────┘
              │                    │                    │
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │   Generator    │  │    Executor    │  │    Healer      │
     │                │  │                │  │                │
     │ • Creates test │  │ • Runs tests   │  │ • Fixes sels   │
     │   definitions  │  │ • Screenshots  │  │ • Retries (5x) │
     │ • Real sels    │  │ • Artifacts    │  │ • Adapts steps │
     │ • Priority P0-2│  │ • a11y tree    │  │ • Logs fixes   │
     └────────────────┘  └────────────────┘  └────────┬───────┘
                                                      │
                                              ┌───────▼────────┐
                                              │    Reporter    │
                                              │                │
                                              │ • Summarizes   │
                                              │ • Scores runs  │
                                              │ • Files bugs   │
                                              │ • Slack/Jira   │
                                              └────────────────┘
```

### Agent Specifications

#### 1. Orchestrator Agent

The central coordinator that receives high-level testing goals and routes them through the appropriate agent pipeline.

**Inputs:**
- Testing goal (natural language or structured)
- Project context (modules, features, environments)
- Constraints (time budget, scope boundaries, priority thresholds)

**Behavior:**
- Decomposes goals into subtasks for specialized agents
- Manages context chain — each agent receives the full output of prior agents
- Enforces quality gates between pipeline stages
- Tracks overall progress and budget consumption
- Escalates to human when confidence drops below threshold

**Implementation:**
- LangGraph `StateGraph` with conditional edges
- Shared state object passed through all nodes
- `AgenticSessionState` type tracks progress, artifacts, decisions

#### 2. Planner Agent

Receives a testing goal and produces a prioritized test plan using RAG context from code, requirements, and existing tests.

**Inputs:**
- Goal description
- RAG context: code chunks, existing test library, historical run results
- Feature/module scope

**Outputs:**
- Prioritized test plan with P0 (critical), P1 (important), P2 (nice-to-have) tiers
- Coverage map showing which code paths are covered
- Duplicate check results against existing test library
- Estimated execution time

**RAG Sources (retrieved via existing vector pipeline):**
- Codebase chunks (existing `CodeChunk` model)
- Existing `TestDefinition` records (embedded at indexing time)
- Historical `TestRun` results (last 30 runs)
- Feature descriptions and module context

#### 3. Explorer Agent

Autonomously navigates the application under test, discovering pages, forms, flows, and interactive elements.

**Inputs:**
- Environment `baseUrl`
- Scope constraints (URL patterns to include/exclude)
- Playwright browser context

**Outputs:**
- Application map: pages discovered, links between them, forms found
- Interactive element inventory per page
- User flow candidates (login, signup, checkout, etc.)

**Tools available to agent:**
- `screenshot()` — capture current page state
- `getAccessibilityTree()` — structured element inventory (preferred over DOM)
- `click(selector)` — interact with element
- `fill(selector, value)` — enter text
- `navigate(url)` — go to URL
- `getLinks()` — extract all links on page
- `back()` — browser back
- `waitForNavigation()` — wait for page load

**Constraints:**
- Maximum 100 page visits per session
- 5-minute timeout per exploration session
- Stay within configured URL patterns
- Never submit payment forms or destructive actions

#### 4. Generator Agent

Creates test definitions from the Planner's test plan, using RAG context for accurate selectors and routes.

**Inputs:**
- Test plan from Planner
- Code chunks from RAG retrieval
- Application map from Explorer (when available)

**Outputs:**
- Array of `TestDefinition` drafts with steps, selectors, expected outcomes
- Each test tagged with priority tier (P0/P1/P2)
- Confidence score per test (0-1)

**Selector Strategy (ordered by preference):**
1. `data-testid` attributes (most stable)
2. Accessibility tree targeting (role + name)
3. Semantic selectors from codebase (component names, form IDs)
4. CSS selectors as last resort

#### 5. Executor Agent

Runs generated tests with autonomous decision-making during execution. Unlike the existing deterministic runner, the Executor can adapt to unexpected states.

**Behavior:**
- Uses accessibility tree as primary page representation (not screenshots)
- On unexpected state: pauses, observes, decides whether to adapt or fail
- Records all decisions in execution log for human review
- Captures screenshots at decision points (not just on failure)

**Autonomy Boundaries:**
- Can retry a step up to 3 times with different selectors
- Can skip a non-critical step and continue
- Cannot create accounts, submit payments, or modify production data
- Must fail and escalate if confidence drops below 0.5

#### 6. Analyzer Agent

Post-execution agent that classifies results and determines root causes.

**Inputs:**
- Execution results (pass/fail per step)
- Screenshots at decision points
- Execution log with agent decisions
- Historical results for the same tests

**Outputs:**
- Failure classification: `REAL_BUG` | `FLAKY_TEST` | `ENVIRONMENT_ISSUE` | `SELECTOR_DRIFT` | `TEST_DESIGN_FLAW`
- Root cause analysis with confidence level
- Suggested fix (for `SELECTOR_DRIFT` and `TEST_DESIGN_FLAW`)
- Bug report draft (for `REAL_BUG`)

#### 7. Healer Agent

Self-healing agent that fixes broken tests and re-runs them.

**Inputs:**
- Failed test with failure details
- Current page state (accessibility tree + screenshot)
- Historical selector heals for this test

**Behavior:**
- Attempts to locate the correct element using accessibility tree + vision
- Updates the selector in the test definition
- Re-runs the healed test to verify the fix
- Maximum 5 heal-and-retry iterations per test
- Logs all heals to `SelectorHeal` model for human review

**Escalation:**
- After 5 failed attempts: marks test as `NEEDS_HUMAN_REVIEW`
- If heal changes the test's semantic meaning: flags for review instead of auto-applying

#### 8. Reporter Agent

Generates human-readable summaries and takes notification actions.

**Inputs:**
- Full pipeline results (plan, execution, analysis, heals)
- Project notification configuration

**Outputs:**
- Session summary (natural language, 3-5 sentences)
- Detailed report (HTML/PDF)
- Bug tickets filed (Jira integration)
- Notifications sent (Slack/Teams/Email)

---

## Data Model

### AgenticSession

```prisma
model AgenticSession {
  id            String   @id @default(uuid())
  orgId         String
  projectId     String
  featureId     String?
  goal          String
  status        AgenticSessionStatus @default(PENDING)
  agentConfig   Json     // { maxPages, timeoutMinutes, autoHeal, autoFile, priorityThreshold }
  planOutput    Json?    // Planner agent output
  explorerMap   Json?    // Explorer agent output
  executionLog  Json?    // Full execution trace
  analysisResult Json?   // Analyzer output
  healLog       Json?    // Healer actions taken
  summary       String?  // Reporter summary
  testsCreated  Int      @default(0)
  testsPassed   Int      @default(0)
  testsFailed   Int      @default(0)
  testsHealed   Int      @default(0)
  durationMs    Int?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  project       Project  @relation(fields: [projectId], references: [id])
  organisation  Organisation @relation(fields: [orgId], references: [id])

  @@index([orgId])
  @@index([projectId])
}

enum AgenticSessionStatus {
  PENDING
  PLANNING
  EXPLORING
  GENERATING
  EXECUTING
  ANALYZING
  HEALING
  REPORTING
  COMPLETED
  FAILED
  CANCELLED
}
```

### AgenticDecision

```prisma
model AgenticDecision {
  id          String   @id @default(uuid())
  sessionId   String
  agent       String   // which agent made the decision
  action      String   // what was decided
  reasoning   String   // why (LLM reasoning trace)
  confidence  Float    // 0-1
  input       Json     // what the agent saw
  output      Json     // what the agent produced
  durationMs  Int
  createdAt   DateTime @default(now())

  session     AgenticSession @relation(fields: [sessionId], references: [id])

  @@index([sessionId])
}
```

---

## API Endpoints

| Method | Path | Description | Guard |
|--------|------|-------------|-------|
| `POST` | `/projects/:id/agentic/sessions` | Start a new agentic session | OWNER, TECH_LEAD |
| `GET` | `/projects/:id/agentic/sessions` | List sessions with pagination | Any project member |
| `GET` | `/agentic/sessions/:id` | Session detail with full results | Any project member |
| `GET` | `/agentic/sessions/:id/decisions` | Decision audit trail | Any project member |
| `POST` | `/agentic/sessions/:id/cancel` | Cancel a running session | OWNER, TECH_LEAD |
| `POST` | `/agentic/sessions/:id/approve-heals` | Approve or reject pending heals | OWNER, TECH_LEAD, QA_ENGINEER |
| `POST` | `/agentic/sessions/:id/apply-tests` | Apply generated tests to feature | OWNER, TECH_LEAD, QA_ENGINEER |
| `GET` | `/projects/:id/agentic/stats` | Aggregated session stats | Any project member |

---

## Agent Configuration

Per-session configuration with project-level defaults:

```typescript
interface AgenticConfig {
  // Target environment — REQUIRED
  // Determines the baseUrl the Explorer and Executor agents navigate to.
  // Must be an Environment record belonging to the same project.
  environmentId: string;       // UUID of the Environment to test against
  // The Environment record provides:
  //   baseUrl       → starting URL for the Explorer agent; prepended to all NAVIGATE steps
  //   headers       → extra HTTP headers injected into every Playwright request
  //   variables     → env vars available to step inputs (e.g. {{API_KEY}})
  //   embedAllowed  → if false, manual preview uses "Open in new tab" instead of iframe

  // Codebase context — repo(s) to use for RAG-powered planning and generation
  // Uses the RepoConnection records already configured in Project Settings → Source Code.
  // If omitted, all connected repos for the project are used.
  repoIds?: string[];          // specific RepoConnection UUIDs (default: all project repos)
  repoBranch?: string;         // branch to use for retrieval (default: each repo's tracked branch)
  // The Planner and Generator agents use these repos to:
  //  - Understand the codebase structure before writing the test plan
  //  - Generate steps with real selectors, routes, and field names from actual source code
  //  - Identify which modules/features map to which code files
  //  - Check existing test coverage against the codebase

  // Exploration
  maxPages: number;            // default: 50
  explorationTimeoutMin: number; // default: 5
  urlIncludePatterns: string[]; // default: ['**']
  urlExcludePatterns: string[]; // default: ['/admin/**', '/logout']

  // Generation
  priorityThreshold: 'P0' | 'P1' | 'P2'; // minimum priority to generate, default: P1
  maxTestsPerSession: number;  // default: 20
  testTypes: ('UI' | 'API' | 'SHELL')[]; // default: ['UI']

  // Execution
  autoHeal: boolean;           // default: true
  maxHealRetries: number;      // default: 5
  confidenceThreshold: number; // default: 0.6

  // Reporting
  autoFileBugs: boolean;       // default: false
  autoNotify: boolean;         // default: true
  notifyChannels: string[];    // integration IDs
}
```

### How Repo Context Flows Through the Agent Pipeline

```
Session starts with repoIds: ['repo-uuid-1']
            │
            ▼
    Planner Agent
    ─────────────
    RAG query: "what authentication flows exist in this codebase?"
    → retrieves chunks from src/auth/*, src/components/LoginForm.tsx
    → understands: JWT-based auth, /api/v1/auth/login endpoint,
      email + password fields, redirect to /dashboard on success
    → writes test plan with REAL knowledge of the app
            │
            ▼
    Generator Agent
    ───────────────
    RAG query per planned test: "login form selectors and routes"
    → retrieves chunks matching the test's scope
    → generates steps using ACTUAL selectors from codebase:
      NAVIGATE /login
      FILL     #email-input
      FILL     #password-input
      CLICK    button[data-testid="signin-btn"]
      ASSERT_URL /dashboard
    → tests work first-time without manual selector hunting
            │
            ▼
    Executor + Healer
    ─────────────────
    If a generated selector doesn't match: Healer uses
    vision model to find the correct element and updates
    the selector — but because Generator used RAG, this
    should rarely be needed
```

---

## LangGraph Implementation

Each agent is a node in a LangGraph `StateGraph`. The orchestrator manages the flow:

```typescript
const agenticGraph = new StateGraph<AgenticSessionState>({
  channels: {
    goal: { value: null },
    plan: { value: null },
    appMap: { value: null },
    generatedTests: { value: [] },
    executionResults: { value: [] },
    analysis: { value: null },
    heals: { value: [] },
    report: { value: null },
    status: { value: 'PENDING' },
    decisions: { value: [] },
  }
})
  .addNode('planner', plannerAgent)
  .addNode('explorer', explorerAgent)
  .addNode('generator', generatorAgent)
  .addNode('executor', executorAgent)
  .addNode('analyzer', analyzerAgent)
  .addNode('healer', healerAgent)
  .addNode('reporter', reporterAgent)
  .addEdge(START, 'planner')
  .addEdge('planner', 'explorer')
  .addEdge('explorer', 'generator')
  .addEdge('generator', 'executor')
  .addEdge('executor', 'analyzer')
  .addConditionalEdges('analyzer', shouldHeal, {
    heal: 'healer',
    report: 'reporter',
  })
  .addEdge('healer', 'executor')  // retry after healing
  .addEdge('reporter', END);
```

---

## Frontend — Agentic Testing Tab

### Session Launcher
- Goal input (textarea with examples)
- Config panel (collapsible, shows defaults)
- Scope selector (feature, module, or full project)
- "Start Agentic Session" button

### Live Session View
- Pipeline progress indicator (Planner -> Explorer -> Generator -> Executor -> Analyzer -> Healer -> Reporter)
- Current agent status with activity description
- Live decision feed (scrolling log of agent decisions with confidence scores)
- Browser canvas (reuse CDP screencast from Live Test Viewer) showing Explorer/Executor activity
- Elapsed time and budget consumption

### Session Results
- Summary card with key metrics (tests created, passed, failed, healed)
- Test plan table with priority tiers
- Application map visualization (if Explorer was used)
- Failure analysis cards with root cause classification
- Heal log with before/after selectors
- "Apply Tests" and "File Bugs" action buttons
- Full decision audit trail (expandable)

### Session History
- Table of past sessions with status, duration, metrics
- Filter by date, status, feature
- Trend chart showing session effectiveness over time

---

## Quality Gates

The Orchestrator enforces gates between pipeline stages:

| Gate | Condition | Action on Failure |
|------|-----------|-------------------|
| Plan quality | Planner produces at least 1 P0 test | Warn user, continue if P1/P2 exist |
| Exploration coverage | Explorer visits at least 3 pages | Warn user, continue with available map |
| Generation validity | All generated tests pass schema validation | Reject invalid tests, continue with valid ones |
| Execution stability | At least 50% of tests produce a definitive result | Flag session as unstable, recommend manual review |
| Heal confidence | Healed selector confidence > 0.7 | Queue for human review instead of auto-applying |

---

## MCP Server (Future)

Expose platform data to external AI tools (Claude Desktop, VS Code Copilot, Cursor):

**Tools exposed via MCP:**
- `list_tests(projectId, featureId?)` — read test definitions
- `get_test_results(testId, limit?)` — read run history
- `create_test(featureId, testDefinition)` — create a test case
- `update_test(testId, changes)` — modify a test
- `trigger_run(featureId, environmentId)` — start a test run
- `get_run_status(runId)` — poll run progress
- `get_flaky_tests(projectId)` — read flaky test list
- `get_recommendations(projectId)` — read AI recommendations

**Resources exposed via MCP:**
- `project://{id}` — project metadata
- `feature://{id}` — feature with test definitions
- `run://{id}` — run results with step details

---

## Comparison to Competitors

| Capability | Our Platform | qTest | Katalon | BrowserStack |
|---|---|---|---|---|
| Multi-agent pipeline | 8 specialized agents with context chaining | 4 agents (less specialized) | 6 agents | 5 agents |
| Codebase-aware planning | RAG over actual source code | No | Production behavior only | No |
| Self-healing approach | Accessibility tree + vision model + retry loop | Unknown | Script regeneration | 40% failure reduction |
| Explorer agent | Autonomous app crawling with a11y tree | No | JS snippet in prod (TrueTest) | No |
| Decision audit trail | Full reasoning trace per decision | No | No | No |
| Quality gates | Configurable gates between pipeline stages | No | No | No |
| Open architecture | LangChain/LangGraph, any LLM provider | Closed | AWS Bedrock | Closed |
| Human-in-the-loop | Approve heals, apply tests, review decisions | Minimal | Minimal | Minimal |
