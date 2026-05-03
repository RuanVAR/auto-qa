# Git-Native CI Integration

> **Status:** Planned (Phase 10.3)
> **Depends on:** Phase 5.2 (CI/CD trigger API), Phase 5.5 (Repo Connections / RAG), Phase 8.3 (Execution Strategist)

---

## Overview

Phase 5.5 connects your repos so the AI can *read* code as context when generating tests. This is different.

Git-Native CI Integration makes the platform a **first-class participant in your git workflow**. It reacts to git events, posts results back to repos, and turns every PR and deployment into a test quality gate — without requiring developers to change their workflow.

```
Developer opens PR
        │
        ▼
GitHub/GitLab sends pull_request webhook
        │
        ▼
Platform receives webhook
        │
        ├─ Analyse changed files via RAG
        │         │
        │         ├─ Identify affected existing tests
        │         └─ Suggest new tests for uncovered code
        │
        ├─ Post PR comment with impact analysis
        │
        └─ Optionally auto-run affected feature tests
                  │
                  ▼
          Post commit status check (✓ or ✗)
          on the PR — native GitHub/GitLab check
```

---

## 1. Commit Status Checks

### What They Are

The green ✓ or red ✗ checks shown on a PR before it can be merged. Native to GitHub and GitLab. They appear under the PR merge button as:

```
✓  QA Platform / Auth Login Flow — 4/4 tests passed        Details →
✗  QA Platform / Checkout Flow — 1/3 tests passed          Details →
○  QA Platform / Settings Page — pending                    Details →
```

Clicking "Details →" opens the run detail page in the platform.

### GitHub Implementation

```typescript
// POST /repos/{owner}/{repo}/statuses/{sha}
{
  state: 'pending' | 'success' | 'failure' | 'error',
  target_url: `${PLATFORM_URL}/runs/${featureRunId}`,
  description: '4/4 tests passed',       // max 140 chars
  context: `QA Platform / ${featureName}` // unique per feature
}
```

- **`pending`** — posted immediately when a run starts
- **`success`** — posted when all tests pass
- **`failure`** — posted when any test fails
- **`error`** — posted if the run itself errors (worker crash, timeout)

### GitLab Implementation

```typescript
// POST /projects/{id}/statuses/{sha}
{
  state: 'pending' | 'success' | 'failed' | 'canceled',
  target_url: `${PLATFORM_URL}/runs/${featureRunId}`,
  description: '4/4 tests passed',
  name: `QA Platform / ${featureName}`
}
```

### Auth Requirements

Reuses `RepoConnection.accessToken` from Phase 5.5. Requires:
- **GitHub:** `repo:status` scope (classic PAT) or `commit-statuses:write` (fine-grained PAT)
- **GitLab:** `api` scope PAT or repo OAuth

### Configuration

Per `RepoConnection`:
```typescript
postCommitStatus: boolean  // default: false, opt-in
```

---

## 2. PR Event Webhook Handler

### Extended Webhook Handler

The existing `POST /projects/:id/repos/:repoId/webhook` (from Phase 5.5) currently only handles `push` events for re-indexing. This extends it to also handle `pull_request` events.

**GitHub events handled:**
- `pull_request.opened`
- `pull_request.synchronize` (new commits pushed to PR branch)
- `pull_request.reopened`

**GitLab events handled:**
- Merge Request Hook — `object_kind: "merge_request"`, actions: `open`, `update`

### PR Impact Analysis

On PR event received:

```
1. Fetch PR diff from provider API
   GET /repos/{owner}/{repo}/pulls/{number}/files
   → changedFiles: ['src/auth/login.ts', 'src/components/LoginForm.tsx', ...]

2. RAG search for each changed file path
   → affectedTests: tests whose code chunks came from these files
   → affectedFeatures: features containing those tests

3. AI analysis of the diff
   → suggestedNewTests: gaps in coverage revealed by the changes

4. Build impact report
   {
     affectedFeatures: [{ id, name, testCount, lastRunStatus }],
     affectedTests: [{ id, name, featureName, lastResult }],
     suggestedNewTests: [{ rationale, draftSteps, confidence }],
     confidence: 0.87,
     changedFileCount: 3,
     coveredFileCount: 2
   }
```

### PR Comment

A comment is posted to the PR from the platform bot. On subsequent pushes to the same PR, the comment is **edited** (not duplicated):

```markdown
## QA Platform — Impact Analysis for this PR

**3 files changed** · **2 of 3 covered by existing tests** · [View in QA Platform →](link)

### Affected Features (2)

| Feature | Module | Tests | Last Status | Action |
|---------|--------|-------|-------------|--------|
| Auth Login Flow | Authentication | 4 tests | ✓ Passed 2h ago | [Run →](link) |
| Login Form Component | Authentication | 2 tests | — Never run | [Run →](link) |

### Suggested New Tests (1)

AI identified 1 gap in test coverage for the changed code:

> **Login error state** — `src/components/LoginForm.tsx` now handles a new `SESSION_EXPIRED`
> error state that has no test coverage. Suggested: assert error banner is shown with correct message.
>
> [Accept this suggestion →](link)  ·  [Dismiss](link)

---
*Powered by [QA Platform](link)*
```

### PR Trigger Modes

Configurable per repo connection:

| Mode | Behaviour |
|------|-----------|
| `off` | No PR reaction (default) |
| `suggest` | Post impact comment only, no automatic runs |
| `auto-run` | Post comment + automatically trigger affected feature runs |

---

## 3. Deployment Event Trigger

### When Tests Should Run After Deploy

After a deployment succeeds, automatically run smoke tests and P0 tests against the new deployment. This catches regressions in the actual deployed build rather than just the source code.

### GitHub Deployment Events

GitHub fires `deployment_status` with `state: "success"` when a deployment completes.

```typescript
// Webhook payload
{
  action: "created",
  deployment_status: {
    state: "success",
    environment: "production",  // or "staging", "preview", etc.
    environment_url: "https://myapp.com"
  },
  deployment: {
    sha: "abc123...",
    ref: "main",
    environment: "production"
  }
}
```

The platform:
1. Maps `environment` name to a platform `Environment` record
2. Enqueues runs for all `@smoke`-tagged or P0 features in the project
3. Posts `pending` commit status on the SHA
4. Posts `success` / `failure` when smoke suite completes

### GitLab Deployment Webhook

Same flow using GitLab's Deployment webhook (`object_kind: "deployment"`, `status: "success"`).

### Environment Mapping

Deployment environment names don't always match platform environment names. A configurable map bridges them:

```typescript
deploymentEnvMap: [
  { providerEnv: 'production', platformEnvId: 'uuid-of-prod-env' },
  { providerEnv: 'staging', platformEnvId: 'uuid-of-staging-env' },
  { providerEnv: 'preview', platformEnvId: null }  // null = skip this env
]
```

---

## 4. AI PR Test Suggestions

### Problem

Code review shows *what* changed. But reviewers rarely know which tests are missing. The AI analyses the PR diff and generates *specific, actionable* test suggestions.

### How It Works

```typescript
interface PrSuggestion {
  rationale: string;       // why this test is needed
  changedFile: string;     // which file prompted this suggestion
  testType: 'UI' | 'API' | 'SHELL';
  draftSteps: StepDraft[]; // ready-to-accept step definitions
  confidence: number;      // 0-1
}
```

Prompt structure:
```
System: You are a QA engineer reviewing code changes for test coverage gaps.

Changed files and their diffs:
{diffContent}

Existing test coverage for these files:
{existingTestSteps}

Identify tests that are MISSING for the new/changed code paths.
Return as structured TestDefinition drafts. Do not suggest tests that already exist.
Focus on: new error states, new conditional branches, new API endpoints, new UI states.
```

### Platform Notification

When suggestions are generated, a notification appears in the platform:
> 💡 **1 test suggestion from PR #42** — "Login error state" in Auth Login Flow
> [Review →]  [Accept All]  [Dismiss]

Accepted suggestions are saved as `TestDefinition` with `isAiDraft: true` and linked to the PR number.

---

## 5. Commit Traceability

### New Fields on FeatureRun

```prisma
model FeatureRun {
  // ... existing fields ...
  commitSha     String?  // e.g. "a1b2c3d"
  commitBranch  String?  // e.g. "feat/new-login"
  commitMessage String?  // first line of commit message
  prNumber      Int?     // e.g. 42
  prUrl         String?  // full URL to PR
  triggerSource RunTriggerSource @default(MANUAL)
}

enum RunTriggerSource {
  MANUAL       // user clicked run in UI
  SCHEDULED    // cron schedule
  CI_API       // POST /ci/trigger
  PR_WEBHOOK   // pull_request event
  PUSH_WEBHOOK // push event
  DEPLOY_EVENT // deployment_status event
}
```

### UI

**Run detail page:**
```
Run #142  •  Auth Login Flow  •  ✓ Passed  •  2m 14s
Triggered by: PR #42 "Add session expiry handling"  •  Branch: feat/session-expiry
Commit: a1b2c3d "Handle SESSION_EXPIRED error state"  •  2h ago
```

**Run history — branch filter:**
- Filter runs by `commitBranch` (dropdown populated from distinct branches in run history)
- Useful for seeing all runs on a feature branch over time

**Commit timeline view:**
- Per-branch spark chart showing pass/fail per run over time
- Visualises quality trend as a branch develops

---

## 6. Branch Environments (Optional)

### What They Are

Ephemeral environments spun up per PR/branch by external CI (Vercel Preview, Netlify Deploy Preview, custom Docker). The platform needs to know the URL to test against.

### Registration Flow

CI/CD registers the branch environment with the platform:

```bash
# In GitHub Actions / GitLab CI, after preview deploy completes:
curl -X POST https://qa.company.com/api/v1/projects/${PROJECT_ID}/branch-environments \
  -H "Authorization: Bearer ${QA_API_KEY}" \
  -d '{
    "branch": "feat/new-checkout",
    "baseUrl": "https://feat-new-checkout.preview.myapp.com",
    "expiresInHours": 72
  }'
```

### Run Resolution

When a PR event triggers test runs for a branch:
1. Check if a `BranchEnvironment` exists for that branch
2. If yes → run tests against `branchEnvironment.baseUrl`
3. If no → run against the project's default environment

### Deregistration

When a PR is merged or closed, CI deregisters:
```bash
curl -X DELETE .../projects/${PROJECT_ID}/branch-environments/${ENV_ID}
```

Platform also auto-expires environments after `expiresAt`.

---

## Putting It All Together

### Developer Workflow (No Extra Steps Required)

```
1. Developer opens PR
   ↓
2. GitHub sends pull_request webhook to QA Platform
   ↓
3. Platform analyses PR diff via RAG
   - Finds affected features: "Auth Login Flow", "OAuth Login"
   - Finds coverage gap: "SESSION_EXPIRED error state not tested"
   ↓
4. Platform posts PR comment:
   "2 features affected. 1 new test suggested. [Run tests →]"
   ↓
5. (If auto-run mode) Platform triggers feature runs
   against PR branch environment
   ↓
6. Runs execute → results ready
   ↓
7. GitHub PR shows:
   ✓  QA Platform / Auth Login Flow — 4/4 passed
   ✗  QA Platform / OAuth Login — 1/2 passed
   ↓
8. Developer sees failing test, clicks "Details →",
   sees exact step failure with screenshot
   ↓
9. Developer fixes code, pushes again
   → PR webhook fires again
   → Runs re-trigger
   → Statuses updated
   ↓
10. All checks pass → PR merge unblocked
```

### Comparison to Competitors

| Capability | Our Platform | Katalon | BrowserStack | TestRail |
|---|---|---|---|---|
| Commit status checks | GitHub + GitLab | GitHub Actions only | Via API | Via API |
| PR event webhook | Yes — full pipeline | No | No | No |
| AI impact analysis on PR | Yes — RAG-powered | No | No | No |
| AI test suggestions from PR diff | Yes | No | No | No |
| Deployment event trigger | Yes — GitHub + GitLab | No | No | No |
| Branch environment support | Yes | No | Partial | No |
| Commit traceability on runs | Yes | Via CI params | Via CI params | Via CI params |
