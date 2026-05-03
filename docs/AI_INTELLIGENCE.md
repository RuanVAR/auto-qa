# AI Intelligence Layer — Duplicate Detection, Value Scoring & Execution Strategist

> **Status:** Planned (Phase 8)
> **Depends on:** Phase 3-F (Analytics & Trend Charts), Phase 5.5 (RAG), Phase 5.6 (AI Recommendation Engine)

---

## Overview

The AI Intelligence Layer adds three interconnected capabilities that make the platform smarter about which tests matter, which tests are redundant, and which tests to run:

1. **Duplicate Detection** — identifies semantically similar test cases to prevent bloat
2. **Test Value Scoring** — scores each test on maintenance cost vs. defect-finding value
3. **Execution Strategist** — recommends which tests to run, skip, or retire before each run

These features upgrade the existing Phase 5.6 AI Recommendation Engine from passive (informational) to active (actionable, automated).

---

## 1. AI Duplicate Detection

### Problem

As teams grow and AI generates more tests, test libraries accumulate redundant tests that cover the same functionality with slightly different steps or wording. This wastes execution time, increases maintenance burden, and dilutes coverage metrics.

### Approach

Use the existing embedding pipeline (from RAG/Codebase-Aware Testing) to embed test definitions and compare them via cosine similarity.

### How It Works

```
TestDefinition ──► Embed (steps + name + description)
                         │
                         ▼
                   pgvector store
                         │
                         ▼
              Cosine similarity search
              (threshold ≥ 0.85 = likely duplicate)
                         │
                         ▼
              LLM confirmation pass
              "Are these functionally equivalent?"
                         │
                         ▼
              DuplicateGroup record
```

#### Step 1: Embedding Test Definitions

When a test definition is created or updated, embed a canonical representation:

```typescript
function buildTestEmbeddingText(test: TestDefinition): string {
  const stepTexts = test.steps.map(s =>
    `${s.type}: ${s.description || ''} ${s.selector || ''} ${s.value || ''} ${s.expectedOutcome || ''}`
  ).join(' → ');
  return `${test.name}. ${test.description || ''}. Steps: ${stepTexts}`;
}
```

Store embedding on the `TestDefinition` model (new `embedding` vector column).

#### Step 2: Similarity Search

On creation/update, query for existing tests in the same project with cosine similarity ≥ 0.85:

```sql
SELECT id, name, 1 - (embedding <=> $queryVector) as similarity
FROM "TestDefinition"
WHERE "projectId" = $projectId
  AND id != $currentTestId
  AND "deletedAt" IS NULL
ORDER BY embedding <=> $queryVector
LIMIT 5
```

#### Step 3: LLM Confirmation

High-similarity pairs are sent to the LLM for semantic confirmation:

```
Prompt: "Are these two test cases functionally equivalent?
They may have different wording but test the same behavior.

Test A: {name, steps}
Test B: {name, steps}

Respond with: { equivalent: boolean, reason: string, overlap: 'full' | 'partial' | 'none' }"
```

#### Step 4: Surface to User

- **Editor warning** — when creating/editing a test, show "Similar tests found" panel if duplicates detected
- **Project-level report** — "Duplicate Tests" tab showing all duplicate groups with merge/dismiss actions
- **Bulk merge** — select tests from a duplicate group, choose the canonical version, archive the rest

### Data Model

```prisma
model TestDuplicateGroup {
  id         String   @id @default(uuid())
  projectId  String
  status     DuplicateGroupStatus @default(PENDING)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  tests      TestDuplicateMember[]
  project    Project  @relation(fields: [projectId], references: [id])

  @@index([projectId])
}

model TestDuplicateMember {
  id         String   @id @default(uuid())
  groupId    String
  testId     String
  similarity Float
  isCanonical Boolean @default(false)

  group      TestDuplicateGroup @relation(fields: [groupId], references: [id])
  test       TestDefinition     @relation(fields: [testId], references: [id])

  @@unique([groupId, testId])
}

enum DuplicateGroupStatus {
  PENDING    // needs review
  MERGED     // user merged duplicates
  DISMISSED  // user decided they're not duplicates
}
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:id/duplicates` | List duplicate groups with test details |
| `POST` | `/projects/:id/duplicates/scan` | Trigger full project duplicate scan |
| `PATCH` | `/duplicates/:groupId` | Update status (merge/dismiss) |
| `POST` | `/duplicates/:groupId/merge` | Merge group: keep canonical, archive rest |

---

## 2. Test Value Scoring

### Problem

Not all tests are equally valuable. Some tests catch bugs frequently, run quickly, and rarely need maintenance. Others are slow, flaky, never find bugs, and break constantly. Teams need data-driven guidance on which tests to keep, fix, or retire.

### Test Value Score Formula

Each test receives a **Test Value Score (TVS)** from 0-100, computed from four signals:

```
TVS = (defectSignal × 0.35) + (stabilitySignal × 0.25)
    + (maintenanceSignal × 0.25) + (coverageSignal × 0.15)
```

#### Defect Signal (0-100)
How often does this test find real bugs?

```typescript
defectSignal = (failuresClassifiedAsBug / totalRuns) × 100
```

Requires the Analyzer agent's failure classification (`REAL_BUG` vs `FLAKY_TEST` vs `SELECTOR_DRIFT`). Falls back to raw failure rate if classification unavailable.

#### Stability Signal (0-100)
How consistent are the results?

```typescript
// Flaky = frequently alternates pass/fail
passRate = passCount / totalRuns;
stabilitySignal = passRate > 0.8 ? 100
                : passRate > 0.5 ? (passRate - 0.2) / 0.6 × 100
                : passRate > 0.2 ? 30  // very flaky
                : 10;                   // almost always fails
```

#### Maintenance Signal (0-100, inverted — lower maintenance = higher score)
How much effort does this test require?

```typescript
healCount = selectorHeals in last 90 days;
editCount = test definition edits in last 90 days;
maintenanceSignal = Math.max(0, 100 - (healCount × 10) - (editCount × 5));
```

#### Coverage Signal (0-100)
Does this test cover unique code paths?

```typescript
// Uses RAG: which code chunks does this test's step descriptions match?
matchedChunks = vectorSearch(testEmbedding, projectCodeChunks);
uniqueChunks = matchedChunks not covered by other tests;
coverageSignal = (uniqueChunks.length / matchedChunks.length) × 100;
```

### Scoring Tiers

| Tier | TVS Range | Recommendation |
|------|-----------|----------------|
| Essential | 80-100 | Always run, prioritize maintenance |
| Valuable | 60-79 | Run in full suites, standard priority |
| Marginal | 40-59 | Consider running only in nightly/scheduled |
| Low Value | 20-39 | Candidate for rewrite or retirement |
| Retire | 0-19 | Recommend archival — costs more than it finds |

### Data Model

```prisma
model TestValueScore {
  id              String   @id @default(uuid())
  testId          String
  projectId       String
  score           Float    // 0-100
  tier            TestValueTier
  defectSignal    Float
  stabilitySignal Float
  maintenanceSignal Float
  coverageSignal  Float
  sampleSize      Int      // number of runs used to compute
  computedAt      DateTime @default(now())

  test            TestDefinition @relation(fields: [testId], references: [id])

  @@index([projectId])
  @@index([testId])
}

enum TestValueTier {
  ESSENTIAL
  VALUABLE
  MARGINAL
  LOW_VALUE
  RETIRE
}
```

### Recomputation Schedule

- **On-demand:** `POST /projects/:id/value-scores/compute`
- **Automatic:** After every 10th run for a project (BullMQ job)
- **Scheduled:** Nightly recomputation for all active projects

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/projects/:id/value-scores` | All test scores with filters (tier, min/max score) |
| `GET` | `/tests/:id/value-score` | Single test score with signal breakdown |
| `POST` | `/projects/:id/value-scores/compute` | Trigger recomputation |
| `GET` | `/projects/:id/value-scores/distribution` | Histogram of scores by tier |
| `POST` | `/projects/:id/value-scores/retire` | Bulk archive tests in RETIRE tier |

### Frontend

- **Test Value Dashboard** — project-level view with:
  - Score distribution chart (histogram by tier)
  - Test table sortable by TVS, with signal breakdown columns
  - "Retire Candidates" section with bulk archive action
  - Trend chart showing average TVS over time
- **Test Editor** — TVS badge next to test name (color-coded by tier)
- **Run History** — TVS column showing score at time of run

---

## 3. AI Execution Strategist

### Problem

Running the entire test suite on every change is wasteful. Teams need intelligent test selection based on what changed, what's been flaky, and what's most valuable.

### How It Works

The Execution Strategist is invoked before each run (manual, scheduled, or CI-triggered) and produces a **Run Strategy** — an ordered list of tests with run/skip/defer recommendations.

```
┌─────────────────────────────────────┐
│           Run Request               │
│  (feature, environment, trigger)    │
└────────────────┬────────────────────┘
                 │
    ┌────────────▼────────────────┐
    │     Execution Strategist    │
    │                             │
    │  Inputs:                    │
    │  • Git diff (if CI trigger) │
    │  • Test Value Scores        │
    │  • Flaky test history       │
    │  • Recent run results       │
    │  • Time budget              │
    │                             │
    │  Output:                    │
    │  • Run Strategy             │
    └────────────────┬────────────┘
                     │
    ┌────────────────▼────────────────┐
    │         Run Strategy            │
    │                                 │
    │  testId: abc → RUN (P0, 95TVS) │
    │  testId: def → RUN (P0, 88TVS) │
    │  testId: ghi → SKIP (flaky)    │
    │  testId: jkl → DEFER (low TVS) │
    │  testId: mno → RUN (changed)   │
    └─────────────────────────────────┘
```

### Strategy Computation

```typescript
interface RunStrategy {
  testId: string;
  action: 'RUN' | 'SKIP' | 'DEFER';
  reason: string;
  priority: number; // execution order
}

function computeStrategy(tests: TestWithScore[], context: StrategyContext): RunStrategy[] {
  return tests.map(test => {
    // 1. Always run if code changed in related files
    if (context.changedFiles && isAffected(test, context.changedFiles)) {
      return { testId: test.id, action: 'RUN', reason: 'Affected by code change', priority: 0 };
    }

    // 2. Skip if flaky and not recently fixed
    if (test.flakyRate > 0.3 && !test.recentlyFixed) {
      return { testId: test.id, action: 'SKIP', reason: `Flaky (${test.flakyRate}% flip rate)`, priority: 99 };
    }

    // 3. Defer if low value and time-constrained
    if (context.timeBudgetMin && test.valueScore < 40) {
      return { testId: test.id, action: 'DEFER', reason: `Low value (TVS: ${test.valueScore})`, priority: 98 };
    }

    // 4. Run everything else, ordered by value score
    return { testId: test.id, action: 'RUN', reason: 'Standard run', priority: 100 - test.valueScore };
  });
}
```

### Change Impact Analysis

When triggered via CI/CD with a git diff:

1. Parse changed file paths from the diff
2. Use RAG to find test definitions whose code chunks overlap with changed files
3. Mark those tests as `priority: 0` (must run)
4. If no tests overlap with changes, run the full suite (no confidence to skip)

### Strategy Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Full** | Run all tests, ignore strategy | Manual runs, release validation |
| **Smart** | Apply strategy recommendations | CI/CD, scheduled runs |
| **Fast** | Only run P0 + change-affected tests | PR validation, quick feedback |
| **Flaky-skip** | Skip all tests with >30% flaky rate | Reduce noise in CI |

### Configuration

```typescript
interface StrategyConfig {
  mode: 'full' | 'smart' | 'fast' | 'flaky-skip';
  timeBudgetMin?: number;     // max execution time
  flakyThreshold: number;     // default: 0.3 (30%)
  minValueScore: number;      // default: 20 (skip below this)
  changedFiles?: string[];    // from CI diff
  forceInclude?: string[];    // test IDs to always run
  forceExclude?: string[];    // test IDs to never run
}
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/features/:id/strategy` | Compute run strategy for a feature |
| `GET` | `/features/:id/strategy/preview` | Preview strategy without executing |
| `POST` | `/features/:id/run` | Extended to accept `strategyMode` parameter |
| `GET` | `/projects/:id/strategy/stats` | Strategy effectiveness metrics |

### Strategy Effectiveness Tracking

Track whether the strategist's recommendations were correct:

- **Skipped but would have failed** — a skipped flaky test actually had a real bug (false negative)
- **Ran but always passes** — a test that always passes was run unnecessarily (wasted time)
- **Deferred correctly** — a deferred test indeed didn't need to run (validated by next full run)

Store in `StrategyOutcome` table for continuous improvement.

### Frontend

- **Run Trigger Modal** — strategy mode selector (Full / Smart / Fast / Flaky-skip)
- **Strategy Preview** — before running, show which tests will run/skip/defer with reasons
- **Post-Run Analysis** — show strategy effectiveness ("Saved 12 min by skipping 8 low-value tests")
- **Project Settings** — default strategy mode per trigger type (manual, scheduled, CI)

---

## Flaky Test Detection (Enhanced)

Upgrades the existing Phase 3-F flaky detection from basic (20-80% pass rate) to comprehensive:

### Enhanced Flakiness Metrics

```typescript
interface FlakyTestMetrics {
  testId: string;
  flipRate: number;         // % of runs where result differs from previous run
  consecutiveFlips: number; // longest streak of alternating pass/fail
  environmentCorrelation: string | null; // "only flaky on staging"
  timeCorrelation: string | null;       // "only flaky after 6pm"
  firstFlakyAt: Date;
  lastFlakyAt: Date;
  totalRuns: number;
  suggestedAction: 'QUARANTINE' | 'FIX' | 'MONITOR' | 'RETIRE';
}
```

### Flaky Test Quarantine

- **Quarantine mode** — quarantined tests still run but their results don't affect the overall pass/fail status
- **Auto-quarantine** — tests with >50% flip rate are auto-quarantined after 10 runs
- **Quarantine dashboard** — shows quarantined tests, their flip rates, and suggested actions
- `QuarantineStatus` field on `TestDefinition`: `ACTIVE | QUARANTINED | MONITORING`

### Root Cause Patterns

The AI analyzes flaky test failure patterns to identify common root causes:

| Pattern | Detection | Suggested Fix |
|---------|-----------|---------------|
| Timing issues | Failures correlate with step timeout | Increase wait, add explicit wait condition |
| Data dependency | Failures correlate with specific test data | Isolate test data, use fixtures |
| Environment | Failures correlate with specific environment | Fix environment config, add retry |
| Race condition | Random failures with no pattern | Add synchronization, explicit waits |
| Resource exhaustion | Failures increase under load | Reduce concurrency, increase resources |
