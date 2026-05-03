# Testing Phases & Progress Reports

## Overview

Testing cycles can span days, weeks, or months. The platform supports **configurable
testing phases** (QA, UAT, Sign-off, Regression — whatever the project needs) with
features progressing through them sequentially. Progress reports can be generated
at any point — not just at completion — at both feature and module level.

---

## Core Concepts

### Phases

Phases are configured **per project** in Project Settings → Phases tab.
The ORG_ADMIN, project OWNER, or TECH_LEAD defines them. There is no shared
org-level template — each project controls its own phase pipeline independently.

```
Project: My App — Project Settings → Phases
  Phase 1: QA Testing   (automated + manual) → linked to "QA" environment
  Phase 2: UAT           (manual — assigned UAT users) → linked to "Staging" env
  Phase 3: Sign-off      (manager review + approval)
```

**Feature creation is blocked until at least one environment exists on the project.**
This prevents features from being created without a valid testing target. The
project setup checklist guides users: create environments first, then phases, then
start adding features.

### Environment Access per Phase

Each project phase can be **linked to one environment**. When a tester opens
the test runner within a phase, the platform automatically uses that phase's
environment (base URL, headers, variables). This ensures:

- QA engineers always test against the QA environment
- UAT users always test against the UAT / staging environment
- Sign-off reviewers review against the production-mirror environment

If no environment is linked to a phase, the project's default environment is used.

### Feature Phase Status

Each feature independently tracks where it sits in the phase pipeline. Features
in the same module can be at different phases simultaneously.

```
Module: Authentication

  Login Flow         ✅ QA Passed  →  🔵 UAT In Progress
  Password Reset     ✅ QA Passed  →  ✅ UAT Passed  →  ⏳ Sign-off Pending
  OAuth Login        🔄 QA In Progress
  Session Management ⏸ QA Pending
  2FA Flow           ⏸ QA Pending
```

### Phase Roles

Each phase has users assigned to it with a role:

| Role | Who | What they do |
|------|-----|-------------|
| **TESTER** | QA engineers / UAT users | Execute tests, mark steps pass/fail |
| **MANAGER** | QA lead, product owner | Promote features, receive reports, unblock |
| **VIEWER** | Stakeholders | Read-only access to progress, receive reports |

### Member Environment Access

When a member is added to a project, their access is defined by **two independent
settings**:

1. **Project Role** (`QA_ENGINEER`, `MANAGER`, etc.) — controls what actions they
   can take (create tests, trigger runs, manage settings, etc.)
2. **Allowed Environments** — controls which environments they can see and run
   tests against

By default (empty list), a member can access **all** environments. When specific
environments are selected, the member is restricted to only those environments.

This is stored as `ProjectMember.allowedEnvironmentIds String[]`.

**Rule:** If a phase's linked environment is not in the member's allowed list, they
cannot execute tests in that phase (the run trigger button is disabled with a
tooltip: "You don't have access to the [Staging] environment").

#### Practical use

| Scenario | Project Role | Allowed Environments |
|----------|-------------|---------------------|
| QA engineer | `QA_ENGINEER` | `[qa-env-id]` — QA only |
| UAT tester | `QA_ENGINEER` | `[staging-env-id]` — Staging only |
| Full-stack developer | `TECH_LEAD` | _(empty = all)_ |
| External stakeholder viewer | `VIEWER` | `[staging-env-id]` — can only view Staging results |
| ORG_ADMIN / OWNER | any | _(always all — env restriction not applied)_ |

#### Add Member modal — project settings

```
┌───────────────────────────────────────────────────────────┐
│  Add Member — My App                                       │
│                                                            │
│  User           [ Search members…           ▼ ]           │
│                 Alice B.                                   │
│                                                            │
│  Project role   [ QA Engineer               ▼ ]           │
│                                                            │
│  Environment access                                        │
│  Which environments can this member access?               │
│  ┌──────────────────────────────────────────────────┐     │
│  │ (●) All environments (default)                   │     │
│  │ ( ) Restrict to specific environments            │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  [ Cancel ]                          [ Add Member ]       │
└───────────────────────────────────────────────────────────┘
```

When "Restrict to specific environments" is selected:

```
┌───────────────────────────────────────────────────────────┐
│  Add Member — My App                                       │
│                                                            │
│  User           Alice B.                                   │
│  Project role   [ QA Engineer               ▼ ]           │
│                                                            │
│  Environment access                                        │
│  ( ) All environments (default)                           │
│  (●) Restrict to specific environments                    │
│                                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │ ☐  QA         https://qa.myapp.com               │     │
│  │ ☑  Staging    https://staging.myapp.com          │     │
│  │ ☐  Production https://myapp.com                  │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  [ Cancel ]                          [ Add Member ]       │
└───────────────────────────────────────────────────────────┘
```

This also applies when **editing** an existing member's access via the Members table.

---

### Phase-Scoped Visibility

A user's view of the platform is shaped by which phases they're assigned to:

| Assigned phase role | What they see |
|---------------------|--------------|
| **TESTER in QA** | Features in QA phase with "Run / Test" actions enabled; other phases visible but actions disabled |
| **TESTER in UAT** | "My UAT Tasks" dashboard showing only features promoted to UAT phase; QA-phase features visible as read-only status |
| **MANAGER in any phase** | Full project view; promote/block/unblock buttons on their managed phase |
| **VIEWER** | Read-only dashboard; no action buttons; receives scheduled report emails |
| **No phase assigned** | Can still view project if they are a project member, but cannot execute tests |

Org admins, project owners, and tech leads always have full access regardless of
phase assignments.

### Feature Sign-off State

A feature reaches **Signed Off** status when it has passed through all configured
phases and a MANAGER or project owner explicitly approves. This is distinct from
`FeaturePhase.status = PASSED` — sign-off is the terminal approval state of the
entire feature across all phases.

```
Feature lifecycle across phases:

  QA → IN_PROGRESS → PASSED
                          ↓  (promote)
  UAT → IN_PROGRESS → PASSED
                          ↓  (promote or final phase)
  Sign-off → MANAGER approves
                          ↓
  Feature.signedOffAt = now ✅  ← terminal state
```

---

## Data Model

```prisma
// ─── ORG PHASE TEMPLATE ───────────────────────────────────────────
// Organisation-level phase templates inherited by new projects.
// Projects can customise their own phases independently.
model OrgPhaseTemplate {
  id          String       @id @default(uuid())
  orgId       String
  org         Organisation @relation(fields: [orgId], references: [id], onDelete: Cascade)
  name        String       // "QA Testing", "UAT", "Sign-off"
  description String?
  order       Int          // display order in template list
  color       String?      // default hex colour for this template phase

  @@unique([orgId, order])
  @@map("org_phase_templates")
}

// ─── PROJECT PHASE ────────────────────────────────────────────────
model ProjectPhase {
  id              String       @id @default(uuid())
  projectId       String
  project         Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  name            String       // "QA Testing", "UAT", "Sign-off"
  description     String?
  order           Int          // 1 = first phase, 2 = second, etc.
  color           String?      // hex color for UI badges: "#3B82F6"
  autoPromote     Boolean      @default(false)  // auto-promote when all tests pass

  // Environment access: testers in this phase use this environment.
  // If null, falls back to the project's default environment.
  environmentId   String?
  environment     Environment? @relation(fields: [environmentId], references: [id])

  // Handover email: when a feature is promoted TO this phase,
  // these addresses receive the handover report automatically.
  // Phase MANAGERs are always included; these are additional recipients.
  handoverRecipients String[]   @default([])

  assignments      PhaseAssignment[]
  featurePhases    FeaturePhase[]
  reportSchedules  PhaseReportSchedule[]

  @@unique([projectId, order])
  @@map("project_phases")
}

// ─── PHASE ASSIGNMENT (users assigned to a phase) ─────────────────
enum PhaseRole { TESTER MANAGER VIEWER }

model PhaseAssignment {
  id      String    @id @default(uuid())
  phaseId String
  phase   ProjectPhase @relation(fields: [phaseId], references: [id], onDelete: Cascade)
  userId  String
  user    User      @relation(fields: [userId], references: [id])
  role    PhaseRole

  @@unique([phaseId, userId])
  @@map("phase_assignments")
}

// ─── FEATURE PHASE (where each feature sits in the pipeline) ──────
enum PhaseStatus {
  PENDING       // not started in this phase yet
  IN_PROGRESS   // testing underway
  PASSED        // all tests passed — ready for promotion
  FAILED        // one or more tests failed — blocked
  BLOCKED       // manually blocked by manager (pending fix/decision)
  SKIPPED       // phase skipped for this feature (e.g. no UAT needed)
}

model FeaturePhase {
  id             String       @id @default(uuid())
  featureId      String
  feature        Feature      @relation(fields: [featureId], references: [id], onDelete: Cascade)
  phaseId        String
  phase          ProjectPhase @relation(fields: [phaseId], references: [id])
  status         PhaseStatus  @default(PENDING)
  startedAt      DateTime?
  completedAt    DateTime?    // set when status → PASSED or FAILED
  promotedAt     DateTime?    // set when promoted to the next phase
  promotedById   String?
  promotedBy     User?        @relation("FeaturePhasePromotions", fields: [promotedById], references: [id])
  notes          String?      // promotion note, block reason, etc.

  // Handover: email addresses that received the handover report for this
  // specific promotion event (captured at promotion time — immutable).
  handoverSentTo String[]     @default([])
  handoverSentAt DateTime?

  featureRuns    FeatureRun[] // runs executed within this phase context

  @@unique([featureId, phaseId])
  @@map("feature_phases")
}

// ─── FEATURE SIGN-OFF ─────────────────────────────────────────────
// Terminal approval record. Created when a MANAGER approves the feature
// after all phases have passed. Immutable once created.
model FeatureSignOff {
  id            String   @id @default(uuid())
  featureId     String   @unique
  feature       Feature  @relation(fields: [featureId], references: [id])
  signedOffById String
  signedOffBy   User     @relation(fields: [signedOffById], references: [id])
  signedOffAt   DateTime @default(now())
  message       String?  // custom sign-off message from approver
  notifiedEmails String[] @default([])  // who was emailed at sign-off time

  @@map("feature_sign_offs")
}

// ─── REPORT SCHEDULE ──────────────────────────────────────────────
enum ReportFrequency { DAILY WEEKLY MONTHLY }
enum ReportScope     { FEATURE MODULE PROJECT }

model PhaseReportSchedule {
  id           String          @id @default(uuid())
  projectId    String
  project      Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  phaseId      String?         // null = report covers all phases
  phase        ProjectPhase?   @relation(fields: [phaseId], references: [id])
  scope        ReportScope     // FEATURE | MODULE | PROJECT
  scopeId      String?         // featureId or moduleId when scope is not PROJECT
  name         String          // "Weekly UAT Progress Report"
  frequency    ReportFrequency
  dayOfWeek    Int?            // 0–6 (Sun–Sat) for WEEKLY
  dayOfMonth   Int?            // 1–28 for MONTHLY
  sendTime     String          // "09:00" in org timezone (HH:mm)
  recipients   String[]        // email addresses (can include non-platform users)
  includeCharts Boolean @default(true)
  lastSentAt   DateTime?
  createdById  String
  createdBy    User            @relation(fields: [createdById], references: [id])

  @@map("phase_report_schedules")
}
```

---

## Phase Configuration — Project Settings UI

Project Settings → **Phases** tab:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Testing Phases                                   [ + Add Phase ]    │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ⠿  1.  🔵 QA Testing                              [ Edit ] [ ✕ ]  │
│          Auto-promote when all tests pass: OFF                        │
│          Testers: Sarah R., Tom K.                                    │
│          Managers: Jamie D.                                           │
│                                                                       │
│  ⠿  2.  🟣 UAT                                     [ Edit ] [ ✕ ]  │
│          Auto-promote when all tests pass: ON                         │
│          Testers: Alice B. (UAT), Mark P. (UAT)                      │
│          Managers: Jamie D., CEO@company.com                         │
│                                                                       │
│  ⠿  3.  🟢 Sign-off                               [ Edit ] [ ✕ ]  │
│          Managers: CEO@company.com                                    │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────   │
│  Drag ⠿ to reorder phases.                                           │
│  Deleting a phase does not delete historical phase run data.         │
└──────────────────────────────────────────────────────────────────────┘
```

### Edit Phase modal

```
┌────────────────────────────────────────────────────────┐
│  Edit Phase — UAT                                       │
│                                                         │
│  Name          [ UAT                               ]   │
│  Description   [ User acceptance testing            ]  │
│  Colour        [ 🟣 Purple  ▼ ]                        │
│                                                         │
│  Testing environment                                    │
│  [ Staging (https://staging.myapp.com)  ▼ ]            │
│  Testers in this phase will use this environment.      │
│  Leave blank to use the project default.               │
│                                                         │
│  Auto-promote when all tests pass                       │
│  [ ✓ ] Automatically promote to Sign-off               │
│                                                         │
│  Handover notification                                  │
│  When a feature is promoted INTO this phase, send a    │
│  handover report email to:                             │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ✓  All phase MANAGERs (always included)         │   │
│  │ Additional recipients (optional, comma-sep):    │   │
│  │ [ alice@co.com, product@co.com              ]   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Assign users                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Role      User                                  │   │
│  │ TESTER    Alice B.         [ Change ] [ ✕ ]     │   │
│  │ TESTER    Mark P.          [ Change ] [ ✕ ]     │   │
│  │ MANAGER   Jamie D.         [ Change ] [ ✕ ]     │   │
│  │ VIEWER    CEO@company.com  [ Change ] [ ✕ ]     │   │
│  │ [ + Add user to phase ]                         │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  Note: Users must be org members to be assigned.        │
│  External email addresses (non-members) can be added    │
│  as VIEWER — they receive reports only, no login.       │
│                                                         │
│  [ Cancel ]                           [ Save Phase ]   │
└────────────────────────────────────────────────────────┘
```

---

## Feature Phase Flow

### Initial state

When a project has phases configured, every feature starts in phase 1 (PENDING).
The first phase opens automatically once any run is triggered on the feature.

```
Feature created
      ↓
FeaturePhase records auto-created for each phase:
  Phase 1 (QA)      → PENDING
  Phase 2 (UAT)     → PENDING
  Phase 3 (Sign-off)→ PENDING
      ↓
First run triggered on feature
      ↓
FeaturePhase for Phase 1 (QA) → IN_PROGRESS, startedAt = now
```

### Promotion flow

```
All test cases in QA phase have passed
        ↓
Feature Phase 1 status → PASSED
"Ready to promote" indicator shown on feature card
        ↓
                    ┌─────────────────────────────────┐
                    │  autoPromote = true?             │
                    │  → Automatically promote         │
                    │                                  │
                    │  autoPromote = false?            │
                    │  → QA MANAGER must click         │
                    │    [ Promote to UAT ]            │
                    └─────────────────────────────────┘
        ↓
FeaturePhase Phase 2 (UAT) → IN_PROGRESS
UAT TESTER users notified:
  "Login Flow is ready for UAT testing"
        ↓
UAT testers work through the manual checklist
        ↓
All UAT steps marked PASSED
        ↓
FeaturePhase Phase 2 → PASSED
(autoPromote: ON → Phase 3 Sign-off opens automatically)
        ↓
Sign-off MANAGER reviews and clicks [ Approve ]
        ↓
Feature fully signed off ✅
```

### Blocking a phase

A MANAGER can block a feature's phase progress (e.g. a critical bug found in UAT):

```
FeaturePhase status → BLOCKED
Notes: "Blocked pending bug fix #JIRA-456"
QA TESTER notified to address the issue
Feature does NOT appear in the UAT queue until unblocked
```

---

## Handover Report & Email

When a feature is promoted from one phase to the next (e.g. QA → UAT), the
platform generates and sends a **Handover Report** email to the incoming phase's
responsible people. This gives UAT leads a clear picture of what has been tested,
by whom, and what passed before they receive the work.

### Trigger

The handover email fires on **any promotion event** — both manual (MANAGER clicks
Promote) and automatic (autoPromote = true after all tests pass).

### Who receives it

Recipients are resolved in this order, merged and de-duplicated:

1. All **MANAGER** role users assigned to the destination phase
2. Any **`handoverRecipients`** configured on the destination `ProjectPhase`
3. Any ad-hoc recipients selected at promotion time (see UI below)

### Promotion modal — manual promote

When a MANAGER clicks **[ Promote to UAT ]**, a confirmation modal opens:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Promote "Login Flow" to UAT                                         │
│                                                                       │
│  QA Testing ✅ → UAT                                                │
│                                                                       │
│  A handover report will be emailed to:                               │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ ✅ Jamie D. (UAT MANAGER)                   [always included] │   │
│  │ ✅ alice@co.com              (configured on phase)            │   │
│  │                                                               │   │
│  │ Add more recipients (optional):                               │   │
│  │ [ Search users or type email…                             ]   │
│  │  + Bob Smith ×    + product@co.com ×                         │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Promotion note (optional):                                           │
│  [ All automated tests pass. OAuth flow verified manually.       ]   │
│                                                                       │
│  [ Cancel ]                              [ Promote & Send Report ]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Handover report email content

The email contains:
- Feature name, module, project, version snapshot
- QA phase summary: total tests, pass/fail count, duration, tester names
- Any test cases that needed re-runs or heals
- Any blockers that were encountered and resolved
- Relevant environment (base URL, name)
- A link to the feature in the platform
- PDF attachment (the Phase Progress Report for the completed phase)
- CTA button: **[ Open UAT Task in Platform ]**

---

## Sign-off Flow

After all configured phases for a feature have reached PASSED status, the platform
prompts for final sign-off. This is the permanent approval that marks the feature
as production-ready.

### Trigger

The sign-off prompt is triggered when:
- The **last configured phase** for a feature reaches `FeaturePhase.status = PASSED`
- OR a MANAGER manually initiates sign-off from the feature page

### Sign-off prompt — in-app

When the last phase passes, a banner appears on the feature page:

```
┌──────────────────────────────────────────────────────────────────────┐
│  🎉  All phases complete for "Login Flow"                             │
│  QA ✅ · UAT ✅ · Sign-off ✅                                        │
│                                                                       │
│  Ready to mark this feature as signed off?                            │
│  Sign-off is the final approval confirming this feature is            │
│  production-ready.                                                    │
│                                                                       │
│  [ Not yet ]               [ Sign Off Feature →  ]                   │
└──────────────────────────────────────────────────────────────────────┘
```

### Sign-off modal

```
┌────────────────────────────────────────────────────────┐
│  Sign Off — Login Flow                                  │
│                                                         │
│  ✅ QA Testing   Passed   15 Apr   (4 days)            │
│  ✅ UAT          Passed   19 Apr   (4 days)            │
│  ✅ Sign-off     Passed   20 Apr   (1 day)             │
│                                                         │
│  Sign-off message (optional)                            │
│  [ All login scenarios verified across QA and UAT.  ]  │
│  [ Approved for deployment.                         ]  │
│                                                         │
│  Notify:                                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ✅ Jamie D. (Project MANAGER)  [always]         │   │
│  │ ✅ Sarah R. (QA Lead)          [always]         │   │
│  │ ✅ Alice B. (UAT TESTER)       [always]         │   │
│  │ Add more: [ product@co.com ×               ]   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [ Cancel ]                   [ Confirm Sign-off ✅ ]  │
└────────────────────────────────────────────────────────┘
```

### What happens on confirm

```
1.  FeatureSignOff record created:
      signedOffById = current user
      signedOffAt   = now
      message       = custom text
      notifiedEmails = resolved recipient list

2.  Feature status badge updates to "✅ Signed Off"

3.  Sign-off notification email sent to all resolved recipients:
      Subject: "Login Flow — Signed Off ✅ [My App · Acme Corp]"
      Body:    feature name, all phase summaries, sign-off message,
               who signed off, date/time
      Attachment: Full project phase report PDF

4.  If a next phase IS configured (auto-phase switching):
      PhaseEngine.promote() is called automatically →
      next phase opens → handover email sent to that phase's MANAGERs
      (This supports a "Production Verification" phase after Sign-off)

5.  Org admin and project OWNER receive a summary notification in-app:
      "Login Flow has been signed off by Jamie D."
```

### Sign-off notification email

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  FEATURE SIGNED OFF
  Feature:   Login Flow
  Module:    Authentication
  Project:   My App  ·  Acme Corp
  Date:      20 Apr 2026, 14:32
  Signed by: Jamie D.  (QA Manager)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  MESSAGE FROM APPROVER
  ─────────────────────────────────────────────────────────
  "All login scenarios verified across QA and UAT.
  Approved for deployment."

  PHASE SUMMARY
  ─────────────────────────────────────────────────────────
  ✅ QA Testing    Passed   15 Apr (4d)  Sarah R., Tom K.
  ✅ UAT           Passed   19 Apr (4d)  Alice B., Mark P.
  ✅ Sign-off      Passed   20 Apr (1d)  Jamie D.

  [ View Feature in Platform ]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Module & Feature Phase Views

### Module board view — phase swimlanes

```
┌──────────────────────────────────────────────────────────────────────┐
│  Authentication Module                          [ Progress Report ]  │
│                                                                       │
│  🔵 QA Testing        🟣 UAT             🟢 Sign-off                 │
│  ───────────────────  ───────────────    ──────────────────          │
│  🔄 OAuth Login       ✅ Login Flow      ✅ Password Reset            │
│  🔄 Session Mgmt      🔵 2FA Flow                                     │
│  ⏸ Logout Flow                                                        │
│                                                                       │
│  3/5 features in QA · 2/5 in UAT · 1/5 in Sign-off                  │
│                                                                       │
│  Overall module progress:  ████████████░░░░  60%                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Feature phase timeline

Inside a feature's detail page, a phase progress bar shows history:

```
Login Flow — Phase Progress

  🔵 QA Testing   ✅ Passed   15 Apr  (4 days)   Jamie D.
  🟣 UAT          🔄 Running  18 Apr  (2 days)   Alice B., Mark P.
  🟢 Sign-off     ⏸ Pending  —
```

---

## Progress Reports

Reports can be generated **at any time** (mid-cycle) and on a schedule.
They show current state — partial passes are shown as-is, not hidden.

### Report types

| Type | Scope | Who uses it |
|------|-------|-------------|
| **Feature Progress Report** | Single feature, all phases | QA lead, dev |
| **Module Progress Report** | All features in a module, per phase | QA lead, manager |
| **Project Progress Report** | All modules, all phases | Manager, stakeholder |
| **Phase Progress Report** | All features in a specific phase (e.g. all UAT items) | UAT manager |

---

### Report composition (customizable at generation time)

When a user clicks **View report**, **Download PDF**, or **Email report now**, a
report-builder modal opens first. It lets the user choose which sections to include:

- `[ ] Include current session testing stats and summary`
  - Focuses on what was tested in the current session scope (steps executed, pass/fail,
    duration, blockers, notes)
- `[ ] Include feature summary`
  - Includes feature-level rollup stats and phase status
- `[ ] Include project summary`
  - Includes project-wide totals and completion trends

Rules:

- At least one section must be selected.
- Defaults are scope-aware:
  - Feature page: session + feature selected by default
  - Module page: feature + project selected by default
  - Project page: project selected by default
- The report metadata records selected sections for audit/debug:
  `reportSections: ['session', 'feature', 'project']`.

### Environment-aware report filtering

Reports are always tied to the current environment context of the page the user is on.
Users can switch environment at project/module/feature level, and report data updates
to match that selected environment.

Rules:

- Current view environment is preselected in the report-builder modal.
- User may change environment in the modal before generation (if they have access).
- The selected environment is printed in the report header and stored with report metadata.
- If no environment filter is selected, the report uses all environments visible to the user.

---

### Report summary cards and "View Reports"

Project, module, and feature pages include a **Reports** card with:

- `Total reports` (count for current scope + active environment filter)
- `Latest report` (title + generated time + generated by)
- Primary CTA: `[View Reports]`

`[View Reports]` opens a report list drawer/page scoped to current context:

- Search by name
- Filter by type (session/feature/module/project/phase)
- Filter by environment
- Filter by date range
- Quick actions per row: View, Download PDF, Email now, Regenerate with same criteria

---

### Saved setup vs generated reports (recommended model)

To support repeated reporting as testing evolves, report data should be modeled in two
layers:

1. **Report Config** (saved setup/template)
   - Stores user-selected criteria:
     - scope (feature/module/project/phase)
     - environment filter
     - section toggles (`includeSession`, `includeFeature`, `includeProject`)
     - optional pinned `sessionId`
     - output defaults (view/pdf/email)
   - Reusable over time
   - Editable by authorized users

2. **Generated Report** (snapshot/run)
   - Immutable output generated at a specific timestamp from a Report Config
   - Captures resolved criteria + generated-by + generated-at
   - Stores render artifacts/links (HTML/PDF/email send status)
   - Used for audit and historical trend tracking

This allows:

- Users to create a setup once and regenerate whenever needed
- Daily/weekly changes in testing to appear in new snapshots
- Clean history without duplicating configuration rows

### Regenerate flow

- From report history row: `[Regenerate]`
- System uses the same Report Config criteria by default
- User may optionally tweak criteria before confirm
- New `Generated Report` row is created (old rows remain unchanged)

---

### Feature Progress Report — layout

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  QA PLATFORM — FEATURE PROGRESS REPORT
  Feature:     Login Flow
  Module:      Authentication
  Project:     My App  ·  Acme Corp
  Version:     v2.0  "OAuth Integration"
  Generated:   18 Apr 2026, 09:14
  Phase:       UAT  (current)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PHASE SUMMARY
  ─────────────────────────────────────────────────────────
  ✅ QA Testing    Passed     15 Apr 2026  (4d 2h)
  🔄 UAT           Running    18 Apr 2026  (ongoing)
  ⏸  Sign-off      Pending    —

  CURRENT PHASE: UAT
  Assigned testers: Alice B., Mark P.
  Progress: 3 / 5 test cases complete

  TEST CASES
  ─────────────────────────────────────────────────────────
  #   Test Case                   Status      Tester     Date
  1   Login with valid creds      ✅ PASSED   Alice B.   18 Apr
  2   Login with invalid creds    ✅ PASSED   Alice B.   18 Apr
  3   Password reset flow         ✅ PASSED   Mark P.    18 Apr
  4   OAuth — Google login        🔄 PENDING  —          —
  5   OAuth — GitHub login        🔄 PENDING  —          —

  PREVIOUS PHASE: QA Testing
  ─────────────────────────────────────────────────────────
  All 5 test cases passed · 2 automated, 3 manual
  Run by: Sarah R.
  Selector heals detected: 1  (Step 3 of Test 1 — healed to stable selector)

  NOTES / BLOCKERS
  ─────────────────────────────────────────────────────────
  (none)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Module Progress Report — layout

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  QA PLATFORM — MODULE PROGRESS REPORT
  Module:      Authentication
  Project:     My App  ·  Acme Corp
  Generated:   18 Apr 2026, 09:14
  Phases:      QA Testing → UAT → Sign-off
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  OVERVIEW
  ─────────────────────────────────────────────────────────
  Total features:     5
  Fully signed off:   1   (20%)
  In progress:        3   (60%)
  Not started:        1   (20%)

  PHASE BREAKDOWN
  Phase            Features passed   Features in progress   Blocked
  QA Testing            4 / 5              1 / 5              0
  UAT                   1 / 5              2 / 5              0
  Sign-off              1 / 5              0 / 5              0

  FEATURE STATUS
  ─────────────────────────────────────────────────────────
  Feature              Current Phase    Status        Last Activity
  Login Flow           UAT              🔄 Running    18 Apr
  Password Reset       Sign-off         ✅ Passed     16 Apr
  OAuth Login          QA Testing       🔄 Running    17 Apr
  Session Management   QA Testing       ❌ Failed     17 Apr
  2FA Flow             UAT              🔄 Running    18 Apr

  BLOCKERS
  ─────────────────────────────────────────────────────────
  Session Management — QA FAILED
    Failing test: "Session timeout after inactivity"
    Reason: Timeout fires after 31s instead of 30s (flaky)
    Assigned to: Tom K.

  SIGN-OFF STATUS
  ─────────────────────────────────────────────────────────
  Password Reset — ✅ Signed off by Jamie D. on 16 Apr
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Report Scheduling

Managers receive reports automatically. Configured in Project Settings → **Reports** tab.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Report Schedules                              [ + New Schedule ]    │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  Weekly UAT Progress                                                  │
│  Module report · UAT phase · Every Monday 09:00                      │
│  Recipients: jamie@co.com, ceo@co.com                                │
│  Last sent: Mon 15 Apr                           [ Edit ] [ ✕ ]     │
│                                                                       │
│  Daily QA Status                                                      │
│  Project report · All phases · Daily 08:00                           │
│  Recipients: sarah@co.com, tom@co.com                                │
│  Last sent: Today 08:00                          [ Edit ] [ ✕ ]     │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### New Report Schedule modal

```
┌────────────────────────────────────────────────────────┐
│  New Report Schedule                                    │
│                                                         │
│  Name           [ Weekly UAT Progress              ]   │
│                                                         │
│  Report type                                           │
│  ( ) Feature   (●) Module   ( ) Project   ( ) Phase   │
│                                                         │
│  Module         [ Authentication ▼ ]                   │
│  Phase filter   [ UAT only ▼ ]  (or "All phases")     │
│                                                         │
│  Frequency                                             │
│  ( ) Daily   (●) Weekly   ( ) Monthly                 │
│  Send on:  [ Monday ▼ ]  at  [ 09:00 ]                │
│                                                         │
│  Recipients (email, comma-separated)                   │
│  [ jamie@co.com, ceo@co.com                        ]   │
│  Non-members receive the report by email only.         │
│                                                         │
│  [ ] Include charts and progress bars                  │
│  [ ] Attach PDF                                        │
│                                                         │
│  [ Cancel ]                    [ Save Schedule ]       │
└────────────────────────────────────────────────────────┘
```

---

## UAT Tester Experience

UAT testers often aren't QA engineers. They get a simplified, focused view —
no sidebar navigation, no run history, no platform configuration. Just the
checklist for what they've been assigned.

The environment shown in the iframe is the **environment linked to the UAT phase**
(e.g. staging), not the QA environment. The tester does not choose — it's
pre-configured by the project admin.

### UAT tester landing page — features ready

```
┌──────────────────────────────────────────────────────────────────────┐
│  My UAT Tasks                               Hi, Alice 👋             │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  My App — UAT Phase                                                   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  🔄 Login Flow                              2 / 5 complete    │   │
│  │  [ Continue Testing ]                                          │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  ⏸ OAuth Login                             Not started        │   │
│  │  [ Start Testing ]                                             │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ✅ Password Reset                              All passed            │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### UAT tester landing page — nothing ready yet

When a UAT tester logs in and no features have been promoted to UAT phase yet,
they see an informative empty state — not a blank screen. Features that exist
but are still in QA are listed as read-only status cards so testers know what's
coming and can track progress.

```
┌──────────────────────────────────────────────────────────────────────┐
│  My UAT Tasks                               Hi, Alice 👋             │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  My App — UAT Phase                                                   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                                                               │   │
│  │       🕐  No features are ready for UAT yet.                 │   │
│  │                                                               │   │
│  │  The QA team is still working through the following features. │   │
│  │  You'll be notified when something is ready for you.         │   │
│  │                                                               │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Upcoming (in QA)                                                     │
│  ─────────────────────────────────────────────────────────────────   │
│  🔄 Login Flow           QA In Progress  (3/5 tests passed)          │
│  🔄 Password Reset       QA In Progress  (5/5 tests passed — promoting│
│  ⏸ OAuth Login           QA Pending                                  │
│  ⏸ 2FA Flow              QA Pending                                  │
│                                                                       │
│  Testing is disabled until features are promoted to UAT.             │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

Key design decisions for the empty state:
- **Testers see pipeline context** — they know work is coming, not that the platform
  is broken or they have no assignments
- **No test action buttons** — cards are read-only status chips, not CTAs
- **"You'll be notified"** — sets expectation; the platform sends a push/email
  notification when a feature enters their phase
- **Progress visibility** — "3/5 tests passed" shows QA momentum without giving
  the UAT tester premature access to QA-phase detail

### When the tester has completed all tasks

```
┌──────────────────────────────────────────────────────────────────────┐
│  My UAT Tasks                               Hi, Alice 👋             │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  My App — UAT Phase                       All done! 🎉               │
│                                                                       │
│  ✅ Login Flow          All passed                                    │
│  ✅ Password Reset      All passed                                    │
│  ✅ OAuth Login         All passed                                    │
│                                                                       │
│  You've completed all your UAT tasks.                                │
│  The QA Manager has been notified.                                   │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

Opening a feature shows the manual testing checklist (same as Manual Testing mode)
with the app in an iframe on the left (using the UAT phase environment). When all
steps are marked the feature auto-completes for that tester.

When **all assigned testers** for a feature have completed their checklist and all
tests pass, the `FeaturePhase` status moves to PASSED.

---

## On-demand Report Generation (Print / Export)

**From the feature page:**
```
Feature: Login Flow          v2.0 · UAT In Progress
[ Progress Report ▼ ]
  → View report (opens report-builder modal)
  → Download PDF
  → Email report now
  → View reports
```

**From the module page:**
```
Module: Authentication
[ Progress Report ▼ ]
  → View report (all features)
  → View report (current phase only)
  → Download PDF
  → Email report now
  → View reports
```

Reports are generated server-side as HTML (rendered by NestJS with a report template)
and converted to PDF using **Puppeteer** (already a dependency via Playwright) — no
external PDF service required.

### Report-builder modal (on-demand generation)

```
┌──────────────────────────────────────────────────────────────┐
│  Generate Report                                              │
│                                                               │
│  Scope:   Feature: Login Flow                                 │
│  Type:    Feature Progress Report                             │
│                                                               │
│  Environment                                                   │
│  [ Staging ▼ ]                                                 │
│                                                               │
│  Include sections                                              │
│  [✓] Current session testing stats and summary                │
│  [✓] Feature summary                                          │
│  [ ] Project summary                                          │
│                                                               │
│  Output                                                        │
│  (●) View in app   ( ) Download PDF   ( ) Email now          │
│                                                               │
│  [ Cancel ]                                 [ Generate ]      │
└──────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

```
# Phase configuration (ORG_ADMIN or project OWNER/TECH_LEAD)
# Phases are per-project — no org-level templates.
GET    /projects/:id/phases                    List phases
POST   /projects/:id/phases                    Create phase
PATCH  /projects/:id/phases/:phaseId           Update phase (name, order, color, autoPromote,
                                               environmentId, handoverRecipients)
DELETE /projects/:id/phases/:phaseId           Delete phase
PATCH  /projects/:id/phases/reorder            Reorder phases { order: [id, id, id] }

# Project member environment access (OWNER or ORG_ADMIN)
PATCH  /projects/:id/members/:userId           Update member role + allowedEnvironmentIds

# Phase assignments
POST   /projects/:id/phases/:phaseId/users     Assign user to phase with role
PATCH  /projects/:id/phases/:phaseId/users/:userId  Change role
DELETE /projects/:id/phases/:phaseId/users/:userId  Remove from phase

# Feature phase status
GET    /features/:id/phases                    Get all FeaturePhase records for this feature
POST   /features/:id/phases/:phaseId/start     Manually start a phase on a feature
POST   /features/:id/phases/:phaseId/promote   Promote to next phase (MANAGER only)
                                               Body: { note?, additionalRecipients? }
POST   /features/:id/phases/:phaseId/block     Block with reason (MANAGER only)
POST   /features/:id/phases/:phaseId/unblock   Unblock
POST   /features/:id/phases/:phaseId/skip      Skip this phase for this feature

# Sign-off
POST   /features/:id/sign-off                  Sign off a feature (MANAGER / project OWNER)
                                               Body: { message?, additionalRecipients? }
GET    /features/:id/sign-off                  Get sign-off record (null if not yet signed off)
DELETE /features/:id/sign-off                  Revoke sign-off (ORG_ADMIN only — rare)

# Module phase overview
GET    /modules/:id/phase-status               All features in module with their phase positions

# Reports
GET    /features/:id/report                    Generate feature progress report
GET    /modules/:id/report                     Generate module progress report
GET    /projects/:id/report                    Generate project progress report
# Query params:
#   ?phase=:phaseId
#   &format=html|pdf
#   &email=true
#   &environmentId=:environmentId
#   &includeSession=true|false
#   &includeFeature=true|false
#   &includeProject=true|false
#   &sessionId=:sessionId         # optional explicit session target

# Report history/listing
GET    /features/:id/reports                   List generated reports for feature scope
GET    /modules/:id/reports                    List generated reports for module scope
GET    /projects/:id/reports                   List generated reports for project scope
GET    /reports/:reportId                      Get report metadata + rendered HTML/PDF links

# Report schedules
GET    /projects/:id/report-schedules          List schedules
POST   /projects/:id/report-schedules          Create schedule
PATCH  /projects/:id/report-schedules/:id      Update
DELETE /projects/:id/report-schedules/:id      Delete
POST   /projects/:id/report-schedules/:id/send Send now (manual trigger)

# Saved report configs (reusable criteria presets)
GET    /projects/:id/report-configs            List saved report configs
POST   /projects/:id/report-configs            Create saved report config
PATCH  /projects/:id/report-configs/:id        Update saved report config
DELETE /projects/:id/report-configs/:id        Delete saved report config

# Generated report history / regeneration
GET    /projects/:id/generated-reports         List generated report snapshots
POST   /report-configs/:id/generate            Generate from saved config
POST   /generated-reports/:id/regenerate       Regenerate using previous criteria
```

---

## Permission Requirements

| Action | Required role |
|--------|-------------|
| Configure project phases | Project OWNER, TECH_LEAD, ORG_ADMIN |
| Set phase environment | Project OWNER, TECH_LEAD, ORG_ADMIN |
| Set handover recipients on phase | Project OWNER, TECH_LEAD, ORG_ADMIN |
| Set member environment access | Project OWNER, ORG_ADMIN |
| Assign users to phases | Project OWNER, TECH_LEAD, ORG_ADMIN |
| Promote a feature to next phase | Phase MANAGER, Project OWNER, TECH_LEAD |
| Block / unblock a feature phase | Phase MANAGER, Project OWNER |
| Execute tests in a phase | Phase TESTER (for that phase) |
| Sign off a feature | Phase MANAGER (final phase), Project OWNER, TECH_LEAD |
| Revoke a sign-off | ORG_ADMIN only |
| View progress reports | Any phase role, any project member |
| Download / email report on-demand | Any project member |
| Configure report schedules | Project OWNER, TECH_LEAD, ORG_ADMIN |

---

## Notifications

| Event | Who is notified | Channel |
|-------|----------------|---------|
| Feature promoted to a new phase | All TESTERs in the new phase | In-app + email |
| Feature promoted — handover report | Phase MANAGERs + `handoverRecipients` + any ad-hoc | Email (with PDF) |
| Feature phase PASSED | Phase MANAGERs | In-app |
| Feature phase FAILED | Phase MANAGERs + TESTERs | In-app + email |
| Feature phase BLOCKED | Phase MANAGERs, assigned TESTERs | In-app + email |
| Feature ready for sign-off (all phases PASSED) | Phase MANAGER (final phase), Project OWNER | In-app banner |
| Feature signed off | Resolved recipients from sign-off modal | Email (with PDF) |
| Scheduled report sent | Report schedule recipients | Email |
| All features in module reach PASSED | Module MANAGERs | In-app |
| All phases complete for a feature | Project OWNER, TECH_LEAD | In-app |

---

## Where This Fits in the Implementation Plan

**Phase 5.7 — Testing Phases & Progress Reports** (new section).
Depends on:
- Phase 2.0.1 (Module/Feature hierarchy)
- Phase 5.3 (Notifications) — phase transition notifications reuse the integration layer
- Phase 5.4 (Manual Testing) — UAT tester view is the manual checklist with a simplified shell
