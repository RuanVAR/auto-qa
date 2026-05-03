# Feature Versioning

## Overview

Every feature has a **live draft** (the editable test cases) and a **version history**
(published snapshots). The two exist independently:

- The **live draft** is what you see in the test case editor — always editable.
- A **version** is a named, immutable snapshot of the feature's test cases at a point
  in time. Versions are created by the user when they choose to publish.

```
Feature: Login Flow
  │
  ├── Live Draft (editable)
  │     └── 5 test cases (current working state)
  │
  └── Version History
        ├── v3.0  "2FA Support"         ← ACTIVE (used for new runs)
        ├── v2.0  "OAuth Integration"
        └── v1.0  "Base Version"
```

The **active version** is the published snapshot used for all new automated runs.
The live draft is independent — you can freely edit it without affecting the active
version or any historical runs.

---

## Why This Model

| Concern | How it's handled |
|---------|-----------------|
| Historical accuracy | Each run records which version it ran against. You can always replay what the test looked like on any past date. |
| Safe editing | Editing the draft never touches published versions or breaks scheduled runs. |
| No data duplication | Versions are JSON snapshots, not copies of DB rows. |
| Roll-back | Restoring a version copies its snapshot back to the live draft. |
| Comparison | Any two versions can be diffed against each other. |

---

## Version Numbering

Versions are auto-numbered sequentially per feature (`1, 2, 3…`) and displayed
as `v1.0`, `v2.0`, `v3.0`. The user provides:

- **Name** (required) — short label for what changed: `"OAuth Integration"`, `"2FA Support"`
- **Description** (optional) — free text changelog for this version

The `v1.0` base version is created automatically when a feature is first published
(first run triggered, or user explicitly clicks Publish for the first time).

---

## Draft → Publish Workflow

```
User creates feature + adds test cases
        ↓
Feature is in DRAFT state (no published version yet)
        ↓
User clicks [ Publish ] → enters name + description → confirms
        ↓
FeatureVersion v1.0 created: snapshot of all current test cases
v1.0 set as ACTIVE
        ↓
═══════════════════════════════════════════
Later — user wants to add new test cases:
═══════════════════════════════════════════
        ↓
User opens feature → sees current draft
Two choices presented:
        │
        ├─ [ Edit draft ]
        │     → Make changes freely
        │     → Draft changes DO NOT affect runs (still use v1.0)
        │     → No version created yet
        │
        └─ [ Publish as new version ]  (after editing draft)
              → Enter name: "OAuth Integration"
              → Enter description: "Added Google and GitHub OAuth test cases"
              → Confirm
              ↓
        FeatureVersion v2.0 created: snapshot of current draft state
        v2.0 set as ACTIVE
        All future runs use v2.0
        v1.0 preserved in history
```

---

## Data Model

```prisma
// ─── FEATURE VERSION ──────────────────────────────────────────────────
model FeatureVersion {
  id            String    @id @default(uuid())
  featureId     String
  feature       Feature   @relation(fields: [featureId], references: [id], onDelete: Cascade)

  versionNumber Int       // auto-incremented per feature: 1, 2, 3...
  label         String    // display label: "v1.0", "v2.0" — generated from versionNumber
  name          String    // user-provided: "Base Version", "OAuth Integration"
  description   String?   // user-provided changelog

  snapshot      Json      // full state: array of TestDefinition + steps at publish time
  isActive      Boolean   @default(false)   // the version used for new runs
  createdById   String
  createdBy     User      @relation(fields: [createdById], references: [id])
  publishedAt   DateTime  @default(now())

  runs          TestRun[]     // runs reference the version they executed
  featureRuns   FeatureRun[]  // feature runs reference the version used

  @@unique([featureId, versionNumber])
  @@map("feature_versions")
}

// ─── FEATURE (additions) ─────────────────────────────────────────────
model Feature {
  // existing fields ...
  isDraft           Boolean  @default(true)   // false once first version published
  activeVersionId   String?                   // FK to FeatureVersion (set on publish)
  activeVersion     FeatureVersion? @relation("ActiveVersion", fields: [activeVersionId], references: [id])
}

// ─── TEST RUN (addition) ─────────────────────────────────────────────
model TestRun {
  // existing fields ...
  featureVersionId  String?
  featureVersion    FeatureVersion? @relation(fields: [featureVersionId], references: [id])
}
```

### Snapshot shape

The `snapshot` JSON field stores the complete, self-contained state of the feature
at publish time. It is never mutated after creation.

```json
{
  "schemaVersion": 1,
  "featureId": "feat_abc123",
  "featureName": "Login Flow",
  "capturedAt": "2026-04-15T10:30:00Z",
  "testDefinitions": [
    {
      "id": "td_001",
      "name": "Login with valid credentials",
      "type": "UI",
      "order": 1,
      "config": { "browser": "chromium", "headless": true, "timeout": 30000 },
      "steps": [
        { "index": 1, "name": "Navigate to login", "type": "NAVIGATE", "input": { "url": "/auth/login" } },
        { "index": 2, "name": "Fill email", "type": "FILL", "input": { "selector": "#email", "value": "{{TEST_USER_EMAIL}}" } },
        { "index": 3, "name": "Fill password", "type": "FILL", "input": { "selector": "#password", "value": "{{TEST_USER_PASSWORD}}" } },
        { "index": 4, "name": "Click submit", "type": "CLICK", "input": { "selector": "[data-testid='login-submit']" } },
        { "index": 5, "name": "Assert dashboard", "type": "ASSERT_URL", "input": { "url": "/dashboard" } }
      ]
    },
    {
      "id": "td_002",
      "name": "Login with invalid credentials",
      "type": "UI",
      "order": 2,
      "steps": [ "..." ]
    }
  ]
}
```

---

## UI — Version Panel in Feature Page

The version panel sits in the right side of the feature page header, always visible.

### Unpublished draft state

```
┌─────────────────────────────────────────────────────────────────────┐
│  Login Flow                                  ⚠ Unpublished draft    │
│  Authentication · My App                                            │
│                                              [ Publish v1.0... ]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Published, draft matches active version

```
┌─────────────────────────────────────────────────────────────────────┐
│  Login Flow                                  v2.0  OAuth Integration │
│  Authentication · My App                     Active · Published 3 Apr│
│                                              [ Version history ]    │
└─────────────────────────────────────────────────────────────────────┘
```

### Published, draft has unpublished changes

```
┌─────────────────────────────────────────────────────────────────────┐
│  Login Flow                     v2.0 active · ✏ Draft has changes   │
│  Authentication · My App                                            │
│                        [ Discard changes ]  [ Publish as v3.0... ] │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Publish Modal

```
┌────────────────────────────────────────────────────────┐
│  Publish new version                                    │
│                                                         │
│  Version         v3.0  (auto-assigned)                  │
│                                                         │
│  Version name *                                         │
│  [ 2FA Support                                       ]  │
│                                                         │
│  Description (what changed)                             │
│  [ Added two-factor authentication test cases.       ]  │
│  [ Removed legacy SMS tests.                         ]  │
│                                                         │
│  Changes from v2.0:                                     │
│  + "2FA setup flow"       (new test case)               │
│  + "2FA login flow"       (new test case)               │
│  ~ "Login success"        (steps modified)              │
│  - "SMS login"            (removed)                     │
│                                                         │
│  ⚠ All future runs will use v3.0 once published.       │
│    Scheduled runs will automatically switch to v3.0.   │
│                                                         │
│  [ Cancel ]                      [ Publish v3.0 ]      │
└────────────────────────────────────────────────────────┘
```

The **Changes from vX.0** diff is generated at publish time by comparing the current
draft's test definitions against the previous version's snapshot JSON.

---

## Version History Panel

Accessible from the feature page header — opens as a side drawer.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Version History — Login Flow                                [✕]    │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  v3.0  2FA Support                              ✅ ACTIVE           │
│        "Added two-factor authentication tests"                      │
│        Published by Jamie D. · 15 Apr 2026                          │
│        35 runs · 91% pass rate                                      │
│        [ View ]  [ Compare with v2.0 ]                              │
│  ─────────────────────────────────────────────────────────────────  │
│  v2.0  OAuth Integration                                            │
│        "Added Google and GitHub OAuth test cases"                   │
│        Published by Sarah R. · 3 Apr 2026                           │
│        120 runs · 88% pass rate                                     │
│        [ View ]  [ Compare with v1.0 ]  [ Restore to draft ]       │
│  ─────────────────────────────────────────────────────────────────  │
│  v1.0  Base Version                                                 │
│        "Initial login flow test suite"                              │
│        Published by Jamie D. · 10 Jan 2026                          │
│        400 runs · 95% pass rate                                     │
│        [ View ]  [ Restore to draft ]                               │
└─────────────────────────────────────────────────────────────────────┘
```

### View (read-only)
Opens the version's snapshot in a read-only editor. All test cases and steps visible
exactly as they were when published. Cannot be edited.

### Compare
Side-by-side diff of two versions:

```
┌─────────────────────────────────────┬──────────────────────────────────┐
│  v1.0  Base Version                 │  v2.0  OAuth Integration          │
│  ─────────────────────────────────  │  ────────────────────────────── │
│  ✅ Login success          [4 steps]│  ✅ Login success        [5 steps]│
│  ✅ Login invalid          [3 steps]│  ✅ Login invalid         [3 steps]│
│  ✅ Password reset         [5 steps]│  ✅ Password reset        [5 steps]│
│                                     │  ✅ OAuth — Google   [NEW]        │
│                                     │  ✅ OAuth — GitHub   [NEW]        │
└─────────────────────────────────────┴──────────────────────────────────┘

Step diff — "Login success" (v1.0 → v2.0)
  Step 1: Navigate /auth/login           [unchanged]
  Step 2: Fill email field               [unchanged]
  Step 3: Fill password field            [unchanged]
  Step 4: Click submit                   [unchanged]
~ Step 5: Assert URL /dashboard          [selector updated: #dash → .dashboard-root]
```

### Restore to draft
Copies the version's snapshot back to the live draft test definitions.
Requires confirmation:

```
┌─────────────────────────────────────────────────────┐
│  Restore v1.0 to draft?                              │
│                                                      │
│  This will replace your current draft with the       │
│  test cases from v1.0 "Base Version".                │
│                                                      │
│  Your current draft changes will be lost.            │
│  The active version (v3.0) will not change —         │
│  you must publish to make this the active version.   │
│                                                      │
│  [ Cancel ]          [ Restore to draft ]            │
└─────────────────────────────────────────────────────┘
```

---

## Run History — Version Reference

Every run in the run history table shows which version it ran against:

```
┌────────────────────────────┬─────────┬──────────┬───────────┬──────────┐
│ Test                       │ Version │ Mode     │ Status    │ Date     │
├────────────────────────────┼─────────┼──────────┼───────────┼──────────┤
│ Login Flow                 │ v3.0    │ AUTO     │ ✅ PASSED │ 15 Apr   │
│ Login Flow                 │ v2.0    │ AUTO     │ ❌ FAILED │ 10 Apr   │
│ Login Flow                 │ v2.0    │ MANUAL   │ ✅ PASSED │ 5 Apr    │
│ Login Flow                 │ v1.0    │ AUTO     │ ✅ PASSED │ 1 Mar    │
└────────────────────────────┴─────────┴──────────┴───────────┴──────────┘
```

Clicking the version badge (`v2.0`) in a run opens a read-only view of the test
definitions exactly as they were during that run — the snapshot is preserved forever.

---

## Scheduled Runs & Version Behaviour

Scheduled runs always execute against the **active version** at the time the cron
fires. When you publish v3.0 as the active version, the next scheduled run
automatically uses v3.0 — no reconfiguration needed.

If you need to pin a scheduled run to a specific version (e.g. for regression
testing against a specific release), a `versionId` override can be set on the
schedule:

```json
{
  "featureId": "feat_abc123",
  "cron": "0 9 * * 1-5",
  "timezone": "Africa/Johannesburg",
  "environmentId": "env_staging",
  "versionId": "fv_v2.0"   // optional — omit to always use active version
}
```

---

## API Endpoints

```
# Version management
GET    /features/:id/versions                List all versions (summary: id, label, name, publishedAt, isActive, runCount)
POST   /features/:id/versions                Publish current draft as new version
                                             Body: { name, description }
GET    /features/:id/versions/:versionId     Get version detail (includes full snapshot)
GET    /features/:id/versions/:versionId/diff?compareTo=:versionId   Diff two versions

# Version actions
POST   /features/:id/versions/:versionId/restore   Restore version snapshot to live draft
PATCH  /features/:id/versions/active               Set a published version as active
                                                   Body: { versionId }

# Draft state
GET    /features/:id/draft-status            Returns { isDraft, hasUnpublishedChanges, activeVersion }
DELETE /features/:id/draft                   Discard current draft changes (restore from active version snapshot)
```

---

## Permission Requirements

| Action | Required role |
|--------|--------------|
| View version history | Any project member |
| View version snapshot (read-only) | Any project member |
| Compare versions | Any project member |
| Edit draft | DEVELOPER, QA_ENGINEER, TECH_LEAD, OWNER, ORG_ADMIN |
| Publish new version | QA_ENGINEER, TECH_LEAD, OWNER, ORG_ADMIN |
| Restore version to draft | TECH_LEAD, OWNER, ORG_ADMIN |
| Set active version | TECH_LEAD, OWNER, ORG_ADMIN |
| Discard draft changes | TECH_LEAD, OWNER, ORG_ADMIN |

---

## How Draft Changes Are Detected

The platform tracks whether the live draft differs from the active version snapshot
by comparing a hash of the current test definitions against the stored snapshot hash:

```typescript
async getDraftStatus(featureId: string): Promise<DraftStatus> {
  const feature = await this.getFeatureWithTestDefinitions(featureId);
  const activeVersion = await this.getActiveVersion(featureId);

  if (!activeVersion) {
    return { isDraft: true, hasUnpublishedChanges: true, activeVersion: null };
  }

  const currentHash = hashTestDefinitions(feature.testDefinitions);
  const snapshotHash = activeVersion.snapshot.hash;

  return {
    isDraft: feature.isDraft,
    hasUnpublishedChanges: currentHash !== snapshotHash,
    activeVersion: { label: activeVersion.label, name: activeVersion.name },
  };
}
```

The `snapshot.hash` is stored at publish time (SHA-256 of the sorted, stringified
test definitions). The live hash is recomputed on each `getDraftStatus` call — cheap
enough to call on every feature page load.

---

## Where This Fits in the Implementation Plan

This is a new **Phase 2.0.5** — Feature Versioning. It depends on:
- Phase 2.0.1 (Module/Feature hierarchy) — features must exist before versions
- Phase 2.0.2 (Test case types) — test definitions have a known, stable shape to snapshot
