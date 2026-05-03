# Multi-Tenancy & RBAC

## Overview

The platform is **multi-tenant**. Every piece of data — projects, test cases, runs,
integrations, environments — belongs to an **Organisation** (the tenant). Users can
be members of multiple organisations and switch between them via the org switcher in
the top nav.

```
Platform
  ├── Organisation A  (Acme Corp)
  │     ├── Members (users + roles)
  │     ├── Project 1  →  Modules → Features → Test Cases
  │     ├── Project 2
  │     └── Platform Config (shared API keys, email server, etc.)
  │
  ├── Organisation B  (Globex Inc)
  │     ├── Members
  │     └── Project 3
  │
  └── [Platform Admin] — can see and manage all orgs
```

Data is **strictly isolated per org**. A user with access to Org A cannot see any
data from Org B, even if they have an account that exists in both.

---

## Hierarchy & RBAC

There are **three permission levels**: Platform, Organisation, and Project.

```
PLATFORM_ADMIN  (Super Admin)
    │
    ├── can view/manage ALL organisations + ALL users across every tenant
    ├── sees the global registration queue — pending + active accounts per tenant
    ├── approves or rejects new user registrations before accounts are activated
    ├── can activate, suspend, or deactivate any account on the platform
    └── can promote any user to PLATFORM_ADMIN
    
ORGANISATION
    ├── ORG_ADMIN       — manages org settings, members, all projects; approves org access requests
    └── ORG_MEMBER      — basic org access; project role controls actual permissions

PROJECT (within an org)
    ├── OWNER           — full control: edit, delete, manage members, run
    ├── TECH_LEAD       — edit tests, manage environments, trigger runs
    ├── DEVELOPER       — edit tests, view runs
    ├── QA_ENGINEER     — create/edit/run tests, mark manual steps
    └── MANAGER         — read-only + receive reports, view analytics
```

A user always has exactly **one org-level role** per organisation they belong to.
They may additionally have a **project-level role** for specific projects.
Project role is additive — it can grant more access than the org role, never less.

### Permission matrix

| Action | MANAGER | QA_ENGINEER | DEVELOPER | TECH_LEAD | OWNER | ORG_ADMIN |
|--------|---------|-------------|-----------|-----------|-------|-----------|
| View runs & reports | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Run tests | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create / edit test cases | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit project settings | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Manage environments | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Manage project members | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Delete project | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Manage org settings | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Invite / remove org members | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## Data Models

```prisma
// ─── ORGANISATION (Tenant) ────────────────────────────────────────
model Organisation {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique           // used in URLs: /org/acme-corp
  logoUrl     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members     OrgMember[]
  projects    Project[]
  platformConfig PlatformConfig?        // org-level shared config

  @@map("organisations")
}

// ─── ORG MEMBERSHIP ───────────────────────────────────────────────
enum OrgRole {
  ORG_ADMIN
  ORG_MEMBER
}

model OrgMember {
  id             String   @id @default(uuid())
  orgId          String
  org            Organisation @relation(fields: [orgId], references: [id], onDelete: Cascade)
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role           OrgRole  @default(ORG_MEMBER)
  invitedAt      DateTime @default(now())
  joinedAt       DateTime?

  @@unique([orgId, userId])
  @@map("org_members")
}

// ─── USER ──────────────────────────────────────────────────────────
enum PlatformRole {
  USER
  PLATFORM_ADMIN
}

// Lifecycle states for user accounts
enum AccountStatus {
  PENDING_ACTIVATION   // registered but email not yet verified
  PENDING_APPROVAL     // email verified; waiting for PLATFORM_ADMIN to approve
  ACTIVE               // fully approved and can log in
  SUSPENDED            // temporarily blocked (e.g. org SSO enforcement, billing)
  DEACTIVATED          // permanently disabled; data retained, login blocked
}

model User {
  id              String        @id @default(uuid())
  email           String        @unique
  name            String
  avatarUrl       String?
  passwordHash    String?
  platformRole    PlatformRole  @default(USER)
  accountStatus   AccountStatus @default(PENDING_ACTIVATION)
  activationToken String?       @unique  // email verification token (null once verified)
  activationSentAt DateTime?             // when the activation email was last sent
  approvedById    String?               // PLATFORM_ADMIN who approved the account
  approvedAt      DateTime?
  approverNote    String?               // optional note left by the approver
  lastActiveOrgId String?               // persisted org switcher state
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  orgMemberships  OrgMember[]
  projectMembers  ProjectMember[]
  sessions        Session[]

  @@map("users")
}

// ─── PROJECT MEMBERSHIP (already in architecture, shown for completeness) ─
enum ProjectRole {
  OWNER
  TECH_LEAD
  DEVELOPER
  QA_ENGINEER
  MANAGER
}

model ProjectMember {
  id        String      @id @default(uuid())
  projectId String
  project   Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  userId    String
  user      User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      ProjectRole
  addedAt   DateTime    @default(now())

  // Environment access restriction.
  // Empty = access to ALL environments in this project (default).
  // Non-empty = member can only see and run tests against these specific environment IDs.
  // ORG_ADMIN and project OWNER are never restricted regardless of this field.
  allowedEnvironmentIds String[] @default([])

  @@unique([projectId, userId])
  @@map("project_members")
}

// ─── INVITE ────────────────────────────────────────────────────────
model OrgInvite {
  id        String    @id @default(uuid())
  orgId     String
  org       Organisation @relation(fields: [orgId], references: [id], onDelete: Cascade)
  email     String
  role      OrgRole   @default(ORG_MEMBER)
  token     String    @unique @default(uuid())
  expiresAt DateTime
  acceptedAt DateTime?
  invitedById String
  invitedBy  User     @relation(fields: [invitedById], references: [id])

  @@map("org_invites")
}
```

---

## Registration & Account Activation Flow

### Self-registration (no invite)

```
User fills in: name, email, password → [ Create Account ]
        ↓
User record created — accountStatus: PENDING_ACTIVATION
Activation email sent (token valid 24h)
        ↓
User clicks link in email → email verified
        ↓
  ┌─────────────────────────────────────────────────────────┐
  │ Platform Config: requireRegistrationApproval?           │
  ├─────────────────────────────────────────────────────────┤
  │  false (default — open)                                 │
  │  → accountStatus set to ACTIVE                          │
  │  → User proceeds to "Create your organisation" step     │
  │                                                         │
  │  true (controlled — requires PLATFORM_ADMIN sign-off)  │
  │  → accountStatus set to PENDING_APPROVAL                │
  │  → PLATFORM_ADMIN notified (email + admin panel badge)  │
  │  → User sees: "Account pending approval — we'll email   │
  │    you once your account is activated."                 │
  └─────────────────────────────────────────────────────────┘
        ↓  (when approved by PLATFORM_ADMIN)
accountStatus set to ACTIVE
User notified by email
        ↓
User logs in → "Create your organisation" wizard
        ↓
Enter org name → slug auto-generated (editable)
        ↓
Org created, user is set as ORG_ADMIN
        ↓
Wizard: Create first project? [ Skip / Create Project ]
        ↓
Dashboard — org overview
```

### Invite-based registration

```
Invite email received → click link → register or log in
        ↓
If registering: account created → activation email skipped
(invite already verifies email ownership)
        ↓
accountStatus immediately set to ACTIVE (invite bypasses approval)
        ↓
Accept invite → OrgMember record created with invited role
        ↓
Redirected to that org's dashboard
```

### Account status state machine

```
PENDING_ACTIVATION ──(email verified, approval off)──→ ACTIVE
PENDING_ACTIVATION ──(email verified, approval on)───→ PENDING_APPROVAL
PENDING_APPROVAL   ──(admin approves)────────────────→ ACTIVE
PENDING_APPROVAL   ──(admin rejects)─────────────────→ DEACTIVATED
ACTIVE             ──(admin suspends)────────────────→ SUSPENDED
ACTIVE             ──(admin deactivates)─────────────→ DEACTIVATED
SUSPENDED          ──(admin reactivates)─────────────→ ACTIVE
DEACTIVATED        ──(admin reactivates)─────────────→ ACTIVE
```

A user with `accountStatus ≠ ACTIVE` cannot log in. Login endpoint returns `403`
with a message specific to their state:
- `PENDING_ACTIVATION` → "Please verify your email. [Resend email]"
- `PENDING_APPROVAL` → "Your account is pending approval by a platform administrator."
- `SUSPENDED` → "Your account has been temporarily suspended. Contact support."
- `DEACTIVATED` → "This account has been deactivated."

---

## Org Switcher — Behaviour

The org switcher lives in the top-left of the top nav. Clicking it opens a dropdown:

```
┌──────────────────────────────────┐
│  Switch organisation             │
│  ──────────────────────────────  │
│  ✓ Acme Corp            ADMIN    │  ← current org, with user's role shown
│    Globex Inc          MEMBER    │
│    Initech             MEMBER    │
│  ──────────────────────────────  │
│  + Create new organisation       │
└──────────────────────────────────┘
```

On switch:
1. `PATCH /auth/me` → `{ activeOrgId }` — persists choice to `User.lastActiveOrgId`
2. React context updates the active org
3. All API queries are scoped to the new org (`orgId` injected in all requests)
4. Sidebar and dashboard re-render with the new org's data
5. URL updates to reflect new org context (optional slug-based routing)

---

## User Management — ORG_ADMIN View

### Users page (`/org/users`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Users                                              [ + Invite User ] │
│  ─────────────────────────────────────────────────────────────────   │
│  Search users...                          Filter: All roles  ▼       │
│                                                                       │
│  ┌──────┬───────────────────┬───────────────┬──────────────┬───────┐ │
│  │      │ Name              │ Role          │ Last Active  │       │ │
│  ├──────┼───────────────────┼───────────────┼──────────────┼───────┤ │
│  │  JD  │ Jamie D.    (You) │ ORG_ADMIN     │ Now          │  ...  │ │
│  │  SR  │ Sarah R.          │ ORG_MEMBER    │ 2h ago       │  ...  │ │
│  │  TK  │ Tom K.            │ ORG_MEMBER    │ 3d ago       │  ...  │ │
│  │  🔔  │ alice@co.com      │ Invited       │ Pending      │  ✗    │ │
│  └──────┴───────────────────┴───────────────┴──────────────┴───────┘ │
│                                                                       │
│  3 active members · 1 pending invite                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### User detail / actions

Clicking **...** on a user row opens an action menu:

```
┌──────────────────────────┐
│  Sarah R.                │
│  sarah@company.com       │
│  ────────────────────    │
│  Change org role…        │
│  Manage project access…  │
│  Reset password          │
│  Deactivate account      │
│  Remove from org         │
└──────────────────────────┘
```

### Invite User modal

```
┌────────────────────────────────────────────────────┐
│  Invite a user to Acme Corp                         │
│                                                     │
│  Email address                                      │
│  [ alice@company.com                              ] │
│                                                     │
│  Org role                                           │
│  [ ORG_MEMBER ▼ ]                                  │
│                                                     │
│  Projects to add (optional)                         │
│  [ My App      ▼ ]  Role: [ QA_ENGINEER ▼ ]  [+]  │
│  [ Add another project ]                            │
│                                                     │
│  [ Cancel ]                  [ Send Invite ]        │
└────────────────────────────────────────────────────┘
```

An invite email is sent with a time-limited token (72h). If the user doesn't have an
account, the invite link walks them through registration.

---

## Project Member Management — OWNER View

Project members are managed from the project's **Members** tab in the sidebar.
Each member has a **Project Role** and an **Environment Access** setting that
controls which environments they can run tests against.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  My App — Members                                    [ + Add Member ]        │
│                                                                              │
│  ┌──────┬──────────────┬───────────────┬────────────────────────────────┐   │
│  │      │ Name         │ Project Role  │ Environments                   │   │
│  ├──────┼──────────────┼───────────────┼────────────────────────────────┤   │
│  │  JD  │ Jamie D.     │ OWNER         │ All                [ Edit ]    │   │
│  │  SR  │ Sarah R.     │ QA_ENGINEER   │ QA only            [ Edit ]    │   │
│  │  TK  │ Tom K.       │ DEVELOPER     │ All                [ Edit ]    │   │
│  │  AB  │ Alice B.     │ QA_ENGINEER   │ Staging only       [ Edit ]    │   │
│  └──────┴──────────────┴───────────────┴────────────────────────────────┘   │
│                                                                              │
│  Note: members must already belong to the org.                              │
│  ORG_ADMIN and project OWNER always have access to all environments.        │
└─────────────────────────────────────────────────────────────────────────────┘
```

Clicking **[ Edit ]** on the Environments column opens an inline popover:

```
┌────────────────────────────────────────────┐
│  Environment access — Sarah R.              │
│                                             │
│  ( ) All environments                       │
│  (●) Restrict to:                           │
│    ☑  QA         (https://qa.myapp.com)    │
│    ☐  Staging    (https://staging.myapp.com)│
│    ☐  Production (https://myapp.com)        │
│                                             │
│  [ Save ]                                  │
└────────────────────────────────────────────┘
```

### Add Member modal

```
┌───────────────────────────────────────────────────────────┐
│  Add Member — My App                                       │
│                                                            │
│  User         [ Search org members…         ▼ ]           │
│                                                            │
│  Project role [ QA Engineer                 ▼ ]           │
│                                                            │
│  Environment access                                        │
│  (●) All environments                                      │
│  ( ) Restrict to specific environments                    │
│                                                            │
│  [ Cancel ]                          [ Add Member ]       │
└───────────────────────────────────────────────────────────┘
```

When "Restrict to specific environments" is selected, a checklist of the
project's environments appears. The selected IDs are saved to
`ProjectMember.allowedEnvironmentIds`.

**Enforcement:**
- API layer: `EnvironmentsService.findAll()` filters to allowed IDs when caller
  is not OWNER / ORG_ADMIN
- Run trigger: if the requested environment is not in `allowedEnvironmentIds`,
  the API returns `403 Forbidden`
- UI: environment dropdown in the run trigger dialog only shows allowed envs;
  phase environments the member cannot access show a 🔒 lock icon

---

## Platform Admin Panel (`/admin`)

Accessible only to users with `platformRole = PLATFORM_ADMIN` ("Super Admin").
Link appears at the bottom of the sidebar (shown only to platform admins).
A **badge counter** on the sidebar link shows pending approval count when > 0.

### Platform Admin — Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Admin                                                       │
│  [Overview]  [Registrations ●3]  [Organisations]  [All Users]        │
│  ─────────────────────────────────────────────────────────────────   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐      │
│  │  3 Orgs         │  │  47 Users        │  │  3 Pending ●    │      │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘      │
│                                                                       │
│  Organisations                                   [ + Create Org ]    │
│  ─────────────────────────────────────────────────────────────────   │
│  ┌────────────────┬──────────┬──────────┬────────────┬────────────┐  │
│  │ Name           │ Active   │ Pending  │ Projects   │            │  │
│  ├────────────────┼──────────┼──────────┼────────────┼────────────┤  │
│  │ Acme Corp      │ 12       │ 0        │ 5          │  ...       │  │
│  │ Globex Inc     │ 4        │ 2 ●      │ 2          │  ...       │  │
│  │ Initech        │ 31       │ 1 ●      │ 5          │  ...       │  │
│  └────────────────┴──────────┴──────────┴────────────┴────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Columns in the org table:
- **Active** — count of users with `accountStatus = ACTIVE` in that org
- **Pending ●** — count of users with `accountStatus IN (PENDING_ACTIVATION, PENDING_APPROVAL)` — shown in amber if > 0

---

### Platform Admin — Registrations

The **Registrations tab** is the primary tool for approving new account sign-ups.
Shows all users across all tenants, grouped and filterable by status.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Registrations                                                        │
│  ─────────────────────────────────────────────────────────────────   │
│  Filter: [All statuses ▼]  [All orgs ▼]  Search: [              ]   │
│                                                                       │
│  ── Pending Approval (3) ─────────────────────────────────────────   │
│  ┌──────┬──────────────────┬──────────────────┬──────────┬────────┐  │
│  │      │ Name             │ Email            │ Signed up│        │  │
│  ├──────┼──────────────────┼──────────────────┼──────────┼────────┤  │
│  │  JD  │ Jamie D.         │ jamie@acme.com   │ 10m ago  │[Review]│  │
│  │  SR  │ Sarah R.         │ sarah@globex.com │ 2h ago   │[Review]│  │
│  │  TK  │ Tom K.           │ tom@globex.com   │ 1d ago   │[Review]│  │
│  └──────┴──────────────────┴──────────────────┴──────────┴────────┘  │
│                                                                       │
│  ── Pending Email Verification (1) ───────────────────────────────   │
│  ┌──────┬──────────────────┬──────────────────┬──────────┬────────┐  │
│  │  MJ  │ Mike J.          │ mike@initech.com │ 3d ago   │[Resend]│  │
│  └──────┴──────────────────┴──────────────────┴──────────┴────────┘  │
│                                                                       │
│  ── Active (47) ──  ── Suspended (1) ──  ── Deactivated (3) ──       │
│  [ Show all active... ]  [ Show suspended... ]  [ Show deactivated ] │
└──────────────────────────────────────────────────────────────────────┘
```

#### Registration Review Modal

Clicking **[Review]** opens a detail panel for the pending user:

```
┌────────────────────────────────────────────────────────┐
│  Review Registration                                    │
│  ──────────────────────────────────────────────────    │
│  Name:        Jamie D.                                  │
│  Email:       jamie@acme.com            ✓ Verified      │
│  Signed up:   10 minutes ago                            │
│  Org:         Acme Corp  (domain match: acme.com)       │
│                                                         │
│  Note to user (shown in activation email, optional):   │
│  [ Welcome to the platform! ...                      ]  │
│                                                         │
│  On approval, grant org role:                          │
│  [ ORG_MEMBER ▼ ]                                      │
│                                                         │
│  [ Reject ]                      [ Approve & Activate ]│
└────────────────────────────────────────────────────────┘
```

On **Approve & Activate**:
1. `accountStatus` → `ACTIVE`
2. `approvedById`, `approvedAt`, `approverNote` set on User
3. If org domain matched → `OrgMember` record created with selected role
4. Activation confirmation email sent to the user

On **Reject**:
1. `accountStatus` → `DEACTIVATED`
2. Rejection email sent with optional reviewer note
3. User data retained but login blocked

---

### Platform Admin — Per-Tenant Registration State Table

Accessible from the Organisations tab by clicking an org name — shows a breakdown
of all registration states for that specific tenant:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Globex Inc — User Management              [Org Admin View]           │
│  [Users]  [Projects]  [Settings]  [Audit Log]                        │
│  ─────────────────────────────────────────────────────────────────   │
│  Registration status overview:                                        │
│  ┌──────────────────┬────────┬──────────────────────────────────┐    │
│  │ Status           │ Count  │ Action                           │    │
│  ├──────────────────┼────────┼──────────────────────────────────┤    │
│  │ ● Pending Approval│ 2     │ [ Review All ]                   │    │
│  │ ◑ Pending Email  │ 0      │ —                                │    │
│  │ ✓ Active         │ 4      │ —                                │    │
│  │ ⊘ Suspended      │ 0      │ —                                │    │
│  │ ✗ Deactivated    │ 1      │ [ Reactivate... ]                │    │
│  └──────────────────┴────────┴──────────────────────────────────┘    │
│                                                                       │
│  Users (7 total)                                                      │
│  ┌──────┬──────────────────┬───────────────┬──────────┬───────────┐  │
│  │      │ Name             │ Status        │ Last seen│ Actions   │  │
│  ├──────┼──────────────────┼───────────────┼──────────┼───────────┤  │
│  │  SR  │ Sarah R.         │ ● Pending     │ —        │ [ Review ]│  │
│  │  TK  │ Tom K.           │ ● Pending     │ —        │ [ Review ]│  │
│  │  JD  │ Jamie D.         │ ✓ Active      │ Today    │ [ ...   ] │  │
│  │  PL  │ Paul L.          │ ✗ Deactivated │ 3mo ago  │ [Reactivate]│ │
│  └──────┴──────────────────┴───────────────┴──────────┴───────────┘  │
│                                                                       │
│  Actions available to PLATFORM_ADMIN:                                 │
│  • Approve / reject pending registrations                            │
│  • Resend activation email to PENDING_ACTIVATION users               │
│  • Change a user's org role                                          │
│  • Send password reset email                                         │
│  • Suspend / unsuspend account                                       │
│  • Deactivate / reactivate account (disables login, keeps data)     │
│  • Hard delete user (GDPR — removes all personal data)              │
│  • Promote user to PLATFORM_ADMIN                                    │
└──────────────────────────────────────────────────────────────────────┘
```

---

### Platform Admin — All Users

A global user search across all orgs, filterable by status:

```
┌──────────────────────────────────────────────────────────────────────┐
│  All Users                                                            │
│  Search: [ sarah@               ]  Status: All ▼  Org: All ▼         │
│                                                                       │
│  sarah@company.com   Sarah R.   Acme Corp · ORG_MEMBER    ✓ Active   │
│  sarah.j@globex.com  Sarah J.   Globex Inc · ORG_ADMIN    ✓ Active   │
│  tom@globex.com      Tom K.     Globex Inc · —             ● Pending  │
└──────────────────────────────────────────────────────────────────────┘
```

Status filter options: All · Pending Approval · Pending Email · Active · Suspended · Deactivated

---

## API Endpoints

### Org management
```
POST   /organisations                  Create org (first user becomes ORG_ADMIN)
GET    /organisations                  List all orgs for the current user
GET    /organisations/:id              Get org details
PATCH  /organisations/:id              Update org name/logo (ORG_ADMIN)
DELETE /organisations/:id              Delete org (ORG_ADMIN — requires confirmation)

PATCH  /auth/me                        { activeOrgId } — switch active org
```

### Org members
```
GET    /organisations/:id/members      List members
POST   /organisations/:id/invites      Send invite email
DELETE /organisations/:id/invites/:id  Revoke pending invite
PATCH  /organisations/:id/members/:id  Change member's org role
DELETE /organisations/:id/members/:id  Remove member from org
```

### Project members
```
GET    /projects/:id/members           List project members
POST   /projects/:id/members           Add member with project role
PATCH  /projects/:id/members/:id       Change project role
DELETE /projects/:id/members/:id       Remove from project
```

### Platform admin
```
GET    /admin/organisations                     List all orgs with active/pending counts
GET    /admin/organisations/:id                 Per-tenant registration state table + members
GET    /admin/users                             List all users across all orgs (filterable by status)
GET    /admin/registrations                     Pending registrations queue (PENDING_ACTIVATION + PENDING_APPROVAL)
PATCH  /admin/users/:id                         Change platformRole / accountStatus
PATCH  /admin/users/:id/approve                 Approve registration → ACTIVE (+ optional org role grant)
PATCH  /admin/users/:id/reject                  Reject registration → DEACTIVATED (with optional note)
PATCH  /admin/users/:id/suspend                 Suspend active account
PATCH  /admin/users/:id/reactivate              Reactivate suspended or deactivated account
POST   /admin/users/:id/resend-activation       Resend activation email (PENDING_ACTIVATION)
POST   /admin/users/:id/reset-password          Send password reset email
DELETE /admin/users/:id                         Hard-delete user (GDPR)
```

### Platform config (registration settings)
```
GET    /admin/platform-config                   Current platform config
PATCH  /admin/platform-config                   Update: requireRegistrationApproval, etc.
```

`PlatformConfig` gains a new field:
```prisma
model PlatformConfig {
  // ... existing fields
  requireRegistrationApproval Boolean @default(false)
  // When true: new self-registrations enter PENDING_APPROVAL state after email verification
  // When false: new self-registrations go directly to ACTIVE after email verification
}
```

---

## Auth & Session Isolation

All API requests carry the user's JWT. The active org is encoded in the JWT
(or resolved from `User.lastActiveOrgId` on each request). Every query in the
API automatically scopes to `WHERE orgId = user.activeOrgId` — this is enforced
at the service layer, not left to individual controllers.

```typescript
// Applied globally via an interceptor
@Injectable()
export class OrgScopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    req.orgId = req.user.activeOrgId; // always present after auth guard
    return next.handle();
  }
}
```

A user who belongs to multiple orgs has separate data contexts — they cannot
accidentally read or write to another org's data.

---

## Audit Log

All sensitive actions are written to an `AuditLog` table:

```prisma
model AuditLog {
  id        String   @id @default(uuid())
  orgId     String
  userId    String
  action    String   // "user.invite", "user.remove", "project.delete", etc.
  targetId  String?  // the ID of the affected resource
  meta      Json?    // before/after values for role changes, etc.
  createdAt DateTime @default(now())
  @@map("audit_logs")
}
```

Visible to ORG_ADMIN in the org settings → Audit Log tab, and to PLATFORM_ADMIN
in the admin panel per-org view.

---

## Access Requests

Users can request access to an organisation or a specific project without needing
an invite link. Admins review and approve or reject requests with an optional message.

### Two request types

| Type | Who requests | Who approves | What happens on approve |
|------|-------------|--------------|------------------------|
| **ORG** | Any authenticated user who is not yet a member | `ORG_ADMIN` | `OrgMember` created with `ORG_MEMBER` role (or the role the admin selects) |
| **PROJECT** | Org member not currently on the project | Project `OWNER` or `ORG_ADMIN` | `ProjectMember` created with the role the admin selects |

### Data model

```prisma
enum AccessRequestType   { ORG PROJECT }
enum AccessRequestStatus { PENDING APPROVED REJECTED }

model AccessRequest {
  id            String              @id @default(uuid())
  type          AccessRequestType
  orgId         String
  org           Organisation        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  projectId     String?             // set for PROJECT type requests
  project       Project?            @relation(fields: [projectId], references: [id], onDelete: Cascade)
  requesterId   String
  requester     User                @relation("RequestsMade", fields: [requesterId], references: [id])
  status        AccessRequestStatus @default(PENDING)
  message       String?             // requester's reason / context
  grantedRole   String?             // OrgRole or ProjectRole set by admin on approval
  reviewedById  String?
  reviewedBy    User?               @relation("RequestsReviewed", fields: [reviewedById], references: [id])
  reviewerNote  String?             // optional rejection reason shown to requester
  reviewedAt    DateTime?
  createdAt     DateTime            @default(now())

  @@map("access_requests")
}
```

### Org access request flow

```
User is authenticated but not a member of Org "Acme Corp"
        ↓
They land on /org/acme-corp (public org join page)
OR they click a shared "Request Access" link
        ↓
Form: "Why do you need access?" (optional message)
[ Request Access ]
        ↓
AccessRequest { type: ORG, orgId, requesterId, message } created
        ↓
ORG_ADMINs notified (email + in-app notification bell)
        ↓
Admin opens pending requests list:
  "Jamie D. is requesting access to Acme Corp"
  Message: "I'm the new QA lead starting Monday"
  Role to grant: [ ORG_MEMBER ▼ ]
  [ Reject ]   [ Approve ]
        ↓
On Approve → OrgMember created, user notified by email
On Reject  → user notified with optional reviewer note
```

### Project access request flow

```
User is an org member but not on project "My App"
        ↓
They see "My App" in the projects list but cannot open it
        ↓
"Request Access" button on the project card
Optional message → submit
        ↓
AccessRequest { type: PROJECT, projectId, ... } created
Project OWNERs (and ORG_ADMIN) notified
        ↓
Owner approves with a project role → ProjectMember created
User notified
```

### Pending requests UI

**Admin view** — a "Requests" tab in org Settings and in the project Members page:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Pending Access Requests (2)                                          │
│  ─────────────────────────────────────────────────────────────────   │
│  ┌──────┬──────────────┬──────────────────────────────┬───────────┐  │
│  │      │ User         │ Message                       │           │  │
│  ├──────┼──────────────┼──────────────────────────────┼───────────┤  │
│  │  JD  │ Jamie D.     │ "New QA lead starting Monday" │ [ Review ]│  │
│  │  SR  │ Sarah R.     │ (no message)                  │ [ Review ]│  │
│  └──────┴──────────────┴──────────────────────────────┴───────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

Review modal:

```
┌────────────────────────────────────────────────────┐
│  Review Access Request                              │
│                                                     │
│  Jamie D. — jamie@company.com                       │
│  "New QA lead starting Monday"                      │
│                                                     │
│  Grant role:  [ QA_ENGINEER ▼ ]                    │
│  Projects:    [ My App ▼ ]  + role: [ QA_ENGINEER ] │
│                                                     │
│  Note to user (optional, shown on rejection):       │
│  [                                               ]  │
│                                                     │
│  [ Reject ]                     [ Approve ]         │
└────────────────────────────────────────────────────┘
```

**Requester view** — status visible on their profile / notifications:

```
🕐 Access request to Acme Corp — Pending (sent 2h ago)
✅ Access request to Acme Corp — Approved  (you are now ORG_MEMBER)
❌ Access request to Acme Corp — Rejected  "Please contact your manager first"
```

### API endpoints

```
POST   /organisations/:id/access-requests        Submit org access request
GET    /organisations/:id/access-requests        List pending requests (ORG_ADMIN)
PATCH  /organisations/:id/access-requests/:id    Approve or reject (ORG_ADMIN)

POST   /projects/:id/access-requests             Submit project access request
GET    /projects/:id/access-requests             List pending requests (OWNER / ORG_ADMIN)
PATCH  /projects/:id/access-requests/:id         Approve or reject

GET    /me/access-requests                       Current user's own requests + statuses
```

---

## SSO — Google & Microsoft (Azure AD)

The platform supports password-based login and two SSO providers out of the box.
SSO is configured at the **platform level** (env vars) and optionally enforced
per-organisation.

### Supported providers

| Provider | Protocol | NestJS strategy |
|----------|----------|----------------|
| **Google** | OAuth 2.0 / OIDC | `passport-google-oauth20` |
| **Microsoft / Azure AD** | OAuth 2.0 / OIDC (Entra ID) | `passport-azure-ad` (OIDCStrategy) |

### Environment variables

```bash
# Google SSO
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_CALLBACK_URL=https://qa-platform.company.com/auth/google/callback

# Microsoft / Azure AD SSO
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
AZURE_AD_TENANT_ID=...          # "common" for multi-tenant Azure apps
AZURE_AD_CALLBACK_URL=https://qa-platform.company.com/auth/microsoft/callback
```

If a provider's env vars are not set, its login button is not shown on the login page.

### Auth flow

```
User clicks "Sign in with Google"
        ↓
Redirect to Google OAuth consent screen
        ↓
Google redirects to /auth/google/callback with code
        ↓
NestJS GoogleStrategy exchanges code → { email, name, picture, googleId }
        ↓
Look up user by email in DB
        ┌──────────────────────────────────────────────────┐
        │  User exists + has googleId linked?              │
        │  → Log in, issue JWT                             │
        │                                                  │
        │  User exists, no googleId yet?                   │
        │  → Link Google to existing account               │
        │  → Log in, issue JWT                             │
        │                                                  │
        │  User does not exist?                            │
        │  → JIT provisioning: create User record          │
        │  → Check domain-based auto-join (see below)      │
        │  → Issue JWT, redirect to onboarding             │
        └──────────────────────────────────────────────────┘
```

### Account linking

A user who previously signed up with a password can link their Google or Microsoft
account from **Settings → Security → Linked Accounts**:

```
┌──────────────────────────────────────────────────────────────┐
│  Linked Accounts                                              │
│  ────────────────────────────────────────────────────────    │
│  🔵 Google     jamie@gmail.com         [ Unlink ]            │
│  🟦 Microsoft  jamie@company.com       [ Link Microsoft ]    │
│  🔑 Password   ●●●●●●●●               [ Change password ]   │
└──────────────────────────────────────────────────────────────┘
```

Rules:
- A user must always have **at least one login method**. They cannot unlink the last one.
- If a user has only SSO (no password), they can add a password from Settings.
- Unlinking requires re-authentication with that provider first.

### JIT Provisioning & Domain-based Auto-join

When a new user logs in via SSO for the first time, the platform checks whether their
email domain matches any organisation's configured **SSO domain**:

```prisma
model Organisation {
  // ...
  ssoDomain         String?   // e.g. "acme-corp.com" — enables domain-based auto-join
  ssoEnforced       Boolean   @default(false)  // if true, password login disabled for members
  allowedSsoDomains String[]  // additional domains that can auto-join (e.g. contractor domains)
}
```

```
New SSO user: jamie@acme-corp.com
        ↓
Org "Acme Corp" has ssoDomain = "acme-corp.com"
        ↓
Auto-join: OrgMember created with ORG_MEMBER role
User lands on Acme Corp's dashboard (no access request needed)
```

If no domain match is found, the user lands on the org-selection / access-request screen.

### SSO Enforcement (per org)

An ORG_ADMIN can enforce SSO for their organisation:

```
Org Settings → Security → Authentication

[ ] Require SSO login for all members
    When enabled: members cannot log in with passwords. Only Google or Microsoft SSO allowed.
    Existing password accounts are suspended until the user links an SSO provider.

SSO Domain: [ acme-corp.com ]  (auto-join new users from this domain)
```

When `ssoEnforced = true`:
- Password login attempts by org members return a 403 with a message directing them to SSO
- New members from the configured domain are auto-provisioned on first SSO login
- Platform admins are exempt (they can always log in with a password)

### Login page — SSO buttons

```
┌──────────────────────────────────────┐
│  Sign in to QA Platform              │
│                                      │
│  [ G  Continue with Google ]         │  ← shown if GOOGLE_CLIENT_ID is set
│  [ ⬛  Continue with Microsoft ]     │  ← shown if AZURE_AD_CLIENT_ID is set
│                                      │
│  ─────────── or ───────────          │
│                                      │
│  Email                               │
│  [                              ]    │
│  Password                            │
│  [                              ]    │
│  [ Sign in ]                         │
│                                      │
│  Forgot password?                    │
└──────────────────────────────────────┘
```

If the user's email domain matches an org with `ssoEnforced = true`, the password
fields are hidden and a message shown: *"Acme Corp requires SSO login. Please use
the button above."*

### NestJS Implementation

```typescript
// Google strategy
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService, private authService: AuthService) {
    super({
      clientID:     config.get('GOOGLE_CLIENT_ID'),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET'),
      callbackURL:  config.get('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: Profile) {
    const { emails, displayName, photos, id: googleId } = profile;
    return this.authService.findOrCreateSsoUser({
      provider: 'google',
      providerId: googleId,
      email: emails[0].value,
      name: displayName,
      avatarUrl: photos[0]?.value,
    });
  }
}

// Microsoft (Azure AD) strategy
@Injectable()
export class MicrosoftStrategy extends PassportStrategy(OIDCStrategy, 'microsoft') {
  constructor(config: ConfigService, private authService: AuthService) {
    super({
      identityMetadata: `https://login.microsoftonline.com/${config.get('AZURE_AD_TENANT_ID')}/v2.0/.well-known/openid-configuration`,
      clientID:         config.get('AZURE_AD_CLIENT_ID'),
      clientSecret:     config.get('AZURE_AD_CLIENT_SECRET'),
      redirectUrl:      config.get('AZURE_AD_CALLBACK_URL'),
      responseType:     'code',
      responseMode:     'query',
      scope:            ['openid', 'profile', 'email'],
    });
  }

  async validate(iss, sub, profile, accessToken, refreshToken, done) {
    const user = await this.authService.findOrCreateSsoUser({
      provider: 'microsoft',
      providerId: profile.oid,
      email: profile._json.email || profile._json.preferred_username,
      name: profile.displayName,
    });
    done(null, user);
  }
}
```

### Auth endpoints

```
GET  /auth/google                    Redirect to Google OAuth
GET  /auth/google/callback           Handle Google callback, issue JWT, redirect to app

GET  /auth/microsoft                 Redirect to Microsoft OAuth
GET  /auth/microsoft/callback        Handle Microsoft callback, issue JWT, redirect to app

POST /auth/sso/link                  Link SSO provider to existing account (authenticated)
DELETE /auth/sso/:provider           Unlink SSO provider (authenticated, must have another method)
```

### Data model additions for SSO

```prisma
model UserSsoAccount {
  id          String   @id @default(uuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider    String   // "google" | "microsoft"
  providerId  String   // the provider's unique user ID
  email       String   // email from the provider (may differ from User.email)
  linkedAt    DateTime @default(now())

  @@unique([provider, providerId])
  @@map("user_sso_accounts")
}
```

A user can have one `UserSsoAccount` per provider. The `User` table itself stays
clean — all provider-specific data lives in `UserSsoAccount`.
