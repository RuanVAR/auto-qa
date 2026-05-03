# Codebase-Aware AI Test Generation

## Overview

When a project's source code repository is connected, the AI test generator uses the
actual codebase as context. Instead of guessing selectors and routes, the AI reads
your real components, templates, and route definitions — producing test steps with
accurate selectors, real URL paths, and correct field names.

### Implementation guidance (backend)

Primary path for repository context should use a git client (`simple-git`) to clone/pull
repos into a controlled local workspace for indexing and retrieval. Provider REST APIs
(GitHub/GitLab) should be used for metadata and selective fallback reads, not as the
primary sync mechanism.

**Preferred split of responsibilities:**

- **Git client (`simple-git`)**: clone, pull, checkout, branch-specific reads, diff-friendly local context
- **Provider API calls**: list repos/branches, OAuth metadata, optional on-demand file fetch when indexing is not ready
- **RAG pipeline**: read from local/indexed code first; fall back to direct API file fetch only when explicitly requested or when repo is unindexed

This avoids overusing HTTP content APIs for full-repo workflows and keeps AI context
generation deterministic, fast, and branch-aware.

**Supported repo providers:**

| Provider | Auth method | Notes |
|----------|------------|-------|
| **GitHub** (cloud) | OAuth 2.0 or Personal Access Token | github.com |
| **GitLab** (cloud) | OAuth 2.0 or Personal Access Token | gitlab.com |
| **GitHub Enterprise** | Personal Access Token + custom base URL | Self-hosted |
| **GitLab Self-hosted** | Personal Access Token + custom base URL | Self-hosted |
| **Gitea** | Personal Access Token + custom base URL | Self-hosted |
| **Local path** | Docker volume mount | No auth needed |

A project can have **multiple repos connected** — e.g. a `frontend` repo and an
`api` repo. Both are indexed and the AI draws from whichever is most relevant
to the test being generated.

---

## The Big Picture — How It All Connects

```
ORG LEVEL (done once by ORG_ADMIN)
─────────────────────────────────────────────────────────────────
Org Settings → Source Code → Connect GitHub
  └─ OAuth with GitHub (or enter org-wide PAT)
  └─ Credential stored encrypted at org level
  └─ All projects in this org can now use it — no re-auth needed

PROJECT LEVEL (done once per project by OWNER/TECH_LEAD)
─────────────────────────────────────────────────────────────────
Project Settings → Source Code → Connect Repository
  └─ "Use org GitHub credential" (one click) OR enter own PAT
  └─ Pick repo from dropdown  →  pick branch  →  configure globs
  └─ Platform indexes the repo in the background (BullMQ job)
  └─ Status: READY  ·  1,842 chunks  ·  last synced 10min ago

FEATURE LEVEL (every time a QA engineer needs test cases)
─────────────────────────────────────────────────────────────────
Feature page → "✨ Generate Tests"
  └─ AI suggests files related to this feature's name (smart mapping)
  └─ Engineer confirms/adjusts file hints
  └─ AI retrieves relevant code via vector search (RAG)
  └─ AI generates tests using REAL selectors, routes, field names
  └─ Engineer reviews draft cards → Accept / Edit / Discard
  └─ "Accept All & Run ▶" → tests saved + immediately executed

ONGOING — AUTOMATIC
─────────────────────────────────────────────────────────────────
Push to tracked branch
  └─ Webhook fires → platform re-indexes changed files only
  └─ Tests generated from changed files get flagged:
     "LoginForm.tsx changed — 3 tests may be outdated  [Review]"

Coverage analysis (on-demand)
  └─ AI compares indexed codebase against test library
  └─ Produces heat map: which routes/components have coverage gaps
  └─ "POST /api/users — no tests found  [Generate →]"
```

---

## Why This Matters

**Without codebase context — AI guesses:**
```
Prompt: "Test the login flow"

AI generates:
  NAVIGATE  →  /login              ← might actually be /auth/signin
  FILL      →  #email              ← might actually be input[name="email"]
  CLICK     →  button[type=submit] ← might actually be [data-testid="login-btn"]
```

**With codebase context — AI reads your code:**
```
Prompt: "Test the login flow"
Repo:   frontend, branch: main
Files:  src/features/auth/LoginForm.tsx, src/router/authRoutes.ts

AI generates:
  NAVIGATE     →  /auth/signin              ← from authRoutes.ts
  FILL         →  input[name="email"]       ← from LoginForm.tsx
  FILL         →  input[name="password"]    ← from LoginForm.tsx
  CLICK        →  [data-testid="login-btn"] ← from LoginForm.tsx
  ASSERT_URL   →  /dashboard               ← from authRoutes.ts
  ASSERT_TEXT  →  .user-greeting → "Welcome back"  ← from Dashboard.tsx
```

---

## Part 0 — Org-Level GitHub / GitLab Credentials

### Why org-level credentials exist

Without org-level credentials, every project owner must separately authenticate with
GitHub — entering a PAT or doing OAuth individually. For an org with 20 projects this
means 20 separate tokens, all needing rotation when the PAT expires.

With org-level credentials: **an ORG_ADMIN authenticates once**. Every project in the
org inherits the credential. Connecting a new repo becomes a three-click operation.

### Data model

```prisma
enum OrgGitProvider { GITHUB GITLAB GITEA }

model OrgGitCredential {
  id           String          @id @default(uuid())
  orgId        String
  org          Organisation    @relation(fields: [orgId], references: [id], onDelete: Cascade)
  provider     OrgGitProvider
  baseUrl      String?         // null = cloud; set for self-hosted
  displayName  String          // "GitHub (acme-corp)" — shown in dropdowns
  accessToken  String          // AES-256 encrypted PAT or OAuth access token
  tokenType    String          @default("pat")  // "pat" | "oauth"
  oauthAccount String?         // GitHub username / GitLab username authenticated via OAuth
  scopes       String[]        // ["repo:read"] — recorded for audit
  expiresAt    DateTime?       // null = non-expiring PAT; set for OAuth tokens
  createdById  String
  createdBy    User            @relation(fields: [createdById], references: [id])
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  repoConnections RepoConnection[]   // projects using this credential

  @@unique([orgId, provider, baseUrl])
  @@map("org_git_credentials")
}
```

`RepoConnection` gains an optional `orgCredentialId String?` — when set, the indexer
uses the org credential instead of a project-level token.

### Org Settings → Source Code

```
┌──────────────────────────────────────────────────────────────────────┐
│  Org Settings — Acme Corp                                             │
│  [General]  [Members]  [Security]  [Source Code]  [Billing]  ...    │
│                                                                       │
│  Source Code Credentials                [ + Add Credential ]         │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  🐙  GitHub (cloud)                               [ ... ]   │    │
│  │  Authenticated as: @acme-bot  ·  OAuth             [ Edit ] │    │
│  │  Used by: 12 projects                                        │    │
│  │  Token status: ✅ Active                                      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  🐙  GitHub Enterprise                            [ ... ]   │    │
│  │  https://github.acme-corp.com  ·  PAT              [ Edit ] │    │
│  │  Used by: 3 projects                                         │    │
│  │  Token status: ⚠️  Expires in 14 days — [Rotate Token]      │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

**Token expiry notifications:** Platform emails the ORG_ADMIN and shows a banner
in the org settings when an OAuth token is within 30 days of expiry or a PAT has
expired. Any project connected via an expired credential shows `⚠ Token expired —
re-authenticate in Org Settings`.

### Add Credential modal

```
┌────────────────────────────────────────────────────────┐
│  Add Source Code Credential                             │
│                                                         │
│  Provider                                               │
│  [ 🐙 GitHub (github.com)                    ▼ ]       │
│                                                         │
│  Authentication                                         │
│  (●) OAuth — connect with GitHub  (recommended)        │
│  ( ) Personal Access Token                             │
│                                                         │
│  [ Connect with GitHub ]                               │
│  Read-only access · repo:read scope                    │
│                                                         │
│  Display name (optional, for clarity)                   │
│  [ Acme Corp GitHub                              ]     │
│                                                         │
│  [ Cancel ]                        [ Save Credential ] │
└────────────────────────────────────────────────────────┘
```

### API endpoints (org credentials)

```
GET    /organisations/:id/git-credentials              List org credentials
POST   /organisations/:id/git-credentials              Add credential (PAT or OAuth start)
PATCH  /organisations/:id/git-credentials/:credId      Rotate token / update display name
DELETE /organisations/:id/git-credentials/:credId      Remove (warns if used by projects)
GET    /auth/github-org/callback                       GitHub OAuth callback for org cred
GET    /auth/gitlab-org/callback                       GitLab OAuth callback for org cred
```

---

## Part 1 — Project Settings: Connecting Repositories

### Project Settings → Source Code tab

```
┌──────────────────────────────────────────────────────────────────────┐
│  My App — Project Settings                                           │
│  [General]  [Environments]  [Phases]  [Source Code]  [Members]  ... │
│                                                                       │
│  Connected Repositories                    [ + Connect Repository ]  │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🐙 frontend                                                  │   │
│  │  github.com/acme/my-app-frontend  · branch: main             │   │
│  │  ✅ Indexed · 1,842 chunks · Last synced: 10 min ago          │   │
│  │  [ Sync Now ]  [ Settings ]  [ Disconnect ]                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  🦊 api                                                       │   │
│  │  gitlab.com/acme/my-app-api  · branch: develop               │   │
│  │  ✅ Indexed · 924 chunks · Last synced: 2h ago                │   │
│  │  [ Sync Now ]  [ Settings ]  [ Disconnect ]                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  Auto-sync: ON  (re-index on push to tracked branch via webhook)     │
└──────────────────────────────────────────────────────────────────────┘
```

---

### Connect Repository — wizard

Clicking **+ Connect Repository** opens a step-by-step modal.

#### Step 1 — Choose provider

```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          1 of 3  │
│                                                         │
│  Select your provider                                   │
│                                                         │
│  [ 🐙 GitHub        ]  [ 🦊 GitLab        ]            │
│  [ 🍵 Gitea         ]  [ 📁 Local Path    ]            │
│                                                         │
│  Self-hosted?                                           │
│  [ ] Use custom base URL                               │
│      [ https://github.mycompany.com          ]         │
│                                                         │
│  [ Cancel ]                               [ Next → ]   │
└────────────────────────────────────────────────────────┘
```

#### Step 2 — Authentication

**When org credential exists — one-click option shown first:**
```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          2 of 3  │
│  GitHub                                                 │
│                                                         │
│  ✅ Org credential available                             │
│  ┌──────────────────────────────────────────────────┐  │
│  │  🐙  GitHub (cloud)  ·  @acme-bot                │  │
│  │  Authenticated by your org admin                 │  │
│  └──────────────────────────────────────────────────┘  │
│  (●) Use org credential  (recommended)                 │
│  ( ) Use a different credential for this project       │
│                                                         │
│  [ ← Back ]                               [ Next → ]   │
└────────────────────────────────────────────────────────┘
```

**If "Use a different credential" is selected, OR no org credential exists:**
```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          2 of 3  │
│  GitHub                                                 │
│                                                         │
│  Authentication method                                  │
│  (●) OAuth  — sign in with GitHub (recommended)        │
│  ( ) Personal Access Token                             │
│                                                         │
│  OAuth:                                                 │
│  [ Sign in with GitHub ]                               │
│  Read-only access to repositories you choose.          │
│                                                         │
│  ─── OR ────────────────────────────────────────────   │
│                                                         │
│  Personal Access Token:                                 │
│  [ ghp_xxxxxxxxxxxxxxxxxxxx                        ]   │
│  Required scopes: repo (read)                           │
│  Tokens are stored encrypted and never returned         │
│  in API responses.                                      │
│                                                         │
│  [ ← Back ]                               [ Next → ]   │
└────────────────────────────────────────────────────────┘
```

**Gitea / GitHub Enterprise / Self-hosted GitLab — PAT only:**
```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          2 of 3  │
│  Gitea  ·  https://git.acme-corp.com                   │
│                                                         │
│  Personal Access Token                                  │
│  [ xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx              ]      │
│                                                         │
│  How to create a Gitea token:                          │
│  Settings → Applications → Generate Token              │
│  Required permissions: repository:read                  │
│                                                         │
│  [ ← Back ]                               [ Next → ]   │
└────────────────────────────────────────────────────────┘
```

**Local path:**
```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          2 of 3  │
│  Local Path                                            │
│                                                         │
│  Mount path inside the API container                   │
│  [ /mnt/repos/my-app                             ]     │
│                                                         │
│  Add this to docker-compose.yml:                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  api:                                            │  │
│  │    volumes:                                      │  │
│  │      - /your/local/path:/mnt/repos/my-app:ro     │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  [ ← Back ]                               [ Next → ]   │
└────────────────────────────────────────────────────────┘
```

#### Step 3 — Repository & Index Settings

```
┌────────────────────────────────────────────────────────┐
│  Connect a Repository                          3 of 3  │
│                                                         │
│  Display name (for AI prompts)                         │
│  [ frontend                                      ]     │
│                                                         │
│  Repository                                            │
│  [ acme / my-app-frontend              ▼ ]  (search)  │
│  ↑ dropdown populated via GitHub/GitLab API            │
│                                                         │
│  Default branch                                        │
│  [ main                                ▼ ]             │
│  ↑ dropdown from repo branches                         │
│                                                         │
│  Include file types                                    │
│  [x] .ts .tsx  [x] .js .jsx  [x] .vue  [x] .html      │
│  [ ] .css .scss  [x] .py  [ ] .json  [ ] .md           │
│                                                         │
│  Exclude paths (glob patterns, one per line)           │
│  ┌──────────────────────────────────────────────────┐  │
│  │ node_modules/**                                  │  │
│  │ dist/**                                          │  │
│  │ **/*.test.*                                      │  │
│  │ **/*.spec.*                                      │  │
│  └──────────────────────────────────────────────────┘  │
│                                                         │
│  Auto-sync on push (requires webhook)                  │
│  [ ✓ ] Re-index when changes are pushed to branch      │
│  Webhook URL: https://qa.co.com/api/v1/...  [ Copy ]  │
│                                                         │
│  [ ← Back ]              [ Connect & Start Indexing ]  │
└────────────────────────────────────────────────────────┘
```

After connecting, indexing starts as a BullMQ background job. The status card
shows `Indexing… (234 / 1,842 files)` with a progress bar until complete.

---

## Part 2 — AI Generate Tests on a Feature

### Entry point

On any feature page, the **Generate Tests** button appears in the header:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Login Flow                   v2.0 · Active      [ + Add Test Case ] │
│  Authentication · My App                         [ ✨ Generate Tests ]│
└──────────────────────────────────────────────────────────────────────┘
```

Clicking it opens the **AI Test Generation panel** as a side drawer.

---

### AI Test Generation panel — guided form

The panel walks the user through four inputs before generating. Each input
has a tooltip explaining why it helps.

```
┌─────────────────────────────────────────────────────────────┐
│  ✨ Generate Tests with AI                             [ ✕ ] │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  1. What should be tested?                                  │
│  ─────────────────────────                                  │
│  Describe the feature or user journey in plain English.     │
│                                                             │
│  [ Login flow — valid credentials, invalid credentials, ]   │
│  [ and password reset via email link                     ]  │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  2. Repository                                              │
│  ─────────────────────────                                  │
│  Which connected repo contains this feature's code?         │
│                                                             │
│  [ 🐙 frontend (acme/my-app-frontend)       ▼ ]            │
│  [ 🦊 api (acme/my-app-api)                   ]            │
│  [ Use both repos                              ]  ← default │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  3. Branch                                                  │
│  ─────────────────────────                                  │
│  The AI will read code from this branch.                    │
│                                                             │
│  [ main                                     ▼ ]            │
│    main                                                     │
│    develop                                                  │
│    feature/oauth-login                                      │
│    release/v2.1                                             │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  4. File / folder hints  (optional but recommended)         │
│  ───────────────────────────────────────────────────        │
│  Point the AI at specific files or directories.             │
│  Narrows the search — useful for large codebases.           │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ src/features/auth/                                  │   │
│  │ src/router/authRoutes.ts                            │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ℹ️  One path per line. Supports partial paths and dirs.    │
│     Leave blank to search the entire indexed codebase.      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Test type                                                  │
│  (●) UI — Playwright   ( ) API   ( ) Shell                 │
│                                                             │
│  How many test cases?                                       │
│  [ 3 ▼ ]  (1–10)                                           │
│                                                             │
│                          [ ✨ Generate Tests ]              │
└─────────────────────────────────────────────────────────────┘
```

---

### What happens when Generate is clicked

```
User submits the form
        ↓
1. Resolve file hints
   If file/folder hints provided:
     → Filter CodeChunk search to chunks matching those paths
   Else:
     → Search across all indexed chunks for this project
        ↓
2. Embed the prompt
   EmbeddingService.embed(userPrompt)
   → vector[1536]
        ↓
3. Vector similarity search (pgvector)
   SELECT * FROM code_chunks
   WHERE project_id = ? AND repo_id IN (selected repos)
     AND file_path LIKE ANY(path_filters)   -- if hints given
   ORDER BY embedding <-> $prompt_vector
   LIMIT 15
        ↓
4. Show "Reading code…" skeleton in the panel
        ↓
5. Send to AI
   SYSTEM: You are a QA engineer. Generate {n} JSON test definitions
           for the described feature. Use ONLY selectors, routes, and
           values that appear in the provided code context.
           Feature name: "{featureName}"
           Test type: UI (Playwright)

   CONTEXT:
   --- src/features/auth/LoginForm.tsx ---
   {chunk content}

   --- src/router/authRoutes.ts ---
   {chunk content}

   USER: {userPrompt}
        ↓
6. AI returns structured JSON (array of TestDefinition drafts)
        ↓
7. Display Review panel (see below)
```

---

### Review panel — after generation

Generated tests appear as editable cards before being saved.

```
┌─────────────────────────────────────────────────────────────┐
│  ✨ Generated Tests  (3)                           [ ✕ ]    │
│                                                             │
│  Code context used: ▼                                       │
│    src/features/auth/LoginForm.tsx                          │
│    src/router/authRoutes.ts                                 │
│    src/features/auth/PasswordReset.tsx                      │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  ┌─── Test 1 ──────────────────────────────────────────┐   │
│  │  Name: Login with valid credentials          [ Edit ]│   │
│  │  Type: UI                                            │   │
│  │  Steps:                                              │   │
│  │    1  NAVIGATE    /auth/signin                       │   │
│  │    2  FILL        input[name="email"] → {EMAIL}      │   │
│  │    3  FILL        input[name="password"] → {PASS}    │   │
│  │    4  CLICK       [data-testid="login-btn"]          │   │
│  │    5  ASSERT_URL  /dashboard                         │   │
│  │  [ ✓ Accept ]   [ ✗ Discard ]   [ ↺ Regenerate ]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Test 2 ──────────────────────────────────────────┐   │
│  │  Name: Login with invalid credentials        [ Edit ]│   │
│  │  Steps:                                              │   │
│  │    1  NAVIGATE    /auth/signin                       │   │
│  │    2  FILL        input[name="email"] → bad@test.com │   │
│  │    3  FILL        input[name="password"] → wrong     │   │
│  │    4  CLICK       [data-testid="login-btn"]          │   │
│  │    5  ASSERT_TEXT .error-msg → "Invalid credentials" │   │
│  │  [ ✓ Accept ]   [ ✗ Discard ]   [ ↺ Regenerate ]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─── Test 3 ──────────────────────────────────────────┐   │
│  │  Name: Password reset via email link         [ Edit ]│   │
│  │  ...                                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [ ✗ Discard All ]    [ ✓ Accept All & Save ]              │
│                        [ ✓ Accept All & Save & Run ▶ ]     │
└─────────────────────────────────────────────────────────────┘
```

**Accept** — adds the test to the feature as a draft (marked `isAiDraft: true`).
**Edit** — opens the full step editor inline for that test before accepting.
**Discard** — removes just that test.
**Regenerate** (per test) — re-runs AI for just that one test case.
**Accept All & Save & Run** — saves all accepted tests then immediately starts a Feature Player run.

---

## Part 3 — Advanced: Thinking Outside the Box

These features transform the repo connection from a passive "AI reads code" tool into
an active intelligence layer that understands your codebase structure and keeps tests
in sync with your code automatically.

---

### 3.1 Auto Feature ↔ Code Mapping

When a QA engineer creates a new feature called **"User Login"** or opens an existing
one for generation, the platform automatically searches the indexed codebase for files
most likely related to that feature — no manual file hint entry required.

```
Engineer creates feature: "User Login"
        ↓
Platform queries: "files related to user login"
via vector search on code_chunks
        ↓
Suggested files auto-populated in the generation form:
  ✓ src/features/auth/LoginForm.tsx        (confidence: 0.94)
  ✓ src/router/authRoutes.ts               (confidence: 0.91)
  ✓ src/api/auth.ts                        (confidence: 0.88)
  ✓ src/stores/authStore.ts                (confidence: 0.81)
  ○ src/components/Header.tsx              (confidence: 0.55) ← not suggested
```

The engineer sees the suggested files pre-populated in the drawer with checkboxes.
They can uncheck files that aren't relevant or add paths the AI missed.

**Result:** Zero manual file hunting. Junior QA engineers immediately get the right
context without knowing the codebase structure.

---

### 3.2 On-Demand File Fetch (No Index Required)

For repos that haven't been fully indexed yet, or for specific one-off generations,
the engineer can **paste a file path or folder path** and the platform fetches just
those files directly from the GitHub/GitLab API on demand — no background indexing job
needed.

```
Generation drawer → "4. File / folder hints"
  src/checkout/CheckoutForm.tsx
  src/checkout/orderRoutes.ts

  [ ] Use indexed chunks (full vector search)
  [✓] Fetch files directly from GitHub (on-demand, no index needed)
```

When on-demand fetch is selected:
1. Platform calls GitHub API: `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}`
2. File content fetched on the spot (max 10 files, max 200KB each)
3. Content injected into AI prompt directly (no embedding, no pgvector)
4. Generation proceeds immediately

**Trade-off:** On-demand is fast for targeted generation but doesn't benefit from
the broader vector similarity search that indexed mode provides. Indexed mode finds
related files you didn't know were relevant; on-demand mode only uses the exact
files you specify.

---

### 3.3 Smart Feature Discovery

After a repo is indexed, the platform can analyse the codebase structure and suggest
QA features/modules that don't yet exist in the platform.

```
AI analyses indexed code_chunks:
  → Finds React page components, routes, and API controllers
  → Compares against existing Features in the project
  → Identifies gaps

Result shown in: Project → AI Insights → "Feature Coverage Gaps"

┌──────────────────────────────────────────────────────────────┐
│  AI found 8 code areas with no test features:                │
│                                                              │
│  📄 Checkout Flow                                            │
│     Found: CheckoutPage.tsx, checkoutApi.ts, cartStore.ts   │
│     [ Create Feature → ]                                     │
│                                                              │
│  📄 User Profile Settings                                    │
│     Found: ProfilePage.tsx, settingsApi.ts                  │
│     [ Create Feature → ]                                     │
│                                                              │
│  📄 Password Reset                                           │
│     Found: PasswordResetForm.tsx, auth.ts#resetPassword     │
│     [ Create Feature → ]                                     │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

Clicking **Create Feature →** opens the new feature form pre-filled with the feature
name, suggested module, and the file hints already populated. One click → feature
created with context ready for test generation.

---

### 3.4 Coverage Heat Map

A visual map showing which parts of your codebase have test coverage and which don't.
Built by cross-referencing `CodeChunk` source files against the `filePaths` recorded
on every `TestDefinition` at generation time.

```
Project → AI Insights → Coverage Map

  Filter: [ All modules ▼ ]  [ All repos ▼ ]

  src/
  ├── auth/
  │   ├── LoginForm.tsx          ████████████  3 tests  ✓
  │   ├── RegisterForm.tsx       ████░░░░░░░░  1 test   △ partial
  │   └── PasswordReset.tsx      ░░░░░░░░░░░░  0 tests  ✗ [Generate →]
  ├── checkout/
  │   ├── CheckoutForm.tsx       ░░░░░░░░░░░░  0 tests  ✗ [Generate →]
  │   └── orderSummary.tsx       ░░░░░░░░░░░░  0 tests  ✗ [Generate →]
  └── api/
      ├── auth.ts                █████████░░░  4 tests  ✓
      └── orders.ts              ░░░░░░░░░░░░  0 tests  ✗ [Generate →]

  Legend:  ✓ covered  △ partial  ✗ no coverage
```

Each **[Generate →]** link opens the generation drawer with that file pre-filled as
the hint and a sensible feature name pre-populated. Coverage gaps become one-click
test generation opportunities.

**Coverage is tracked by storing `generatedFromFiles String[]` on each `TestDefinition`**
when it's created via the AI generation flow.

---

### 3.5 Change-Aware Test Alerts

When a webhook fires and the platform re-indexes changed files, it compares the
old chunk content against the new. If any `CodeChunk` that was used to generate
a `TestDefinition` has changed, that test gets flagged.

```
Push detected: 3 files changed in main
  src/auth/LoginForm.tsx   (changed)
  src/router/authRoutes.ts (changed)
  src/components/Header.tsx (changed)

Cross-reference with TestDefinition.generatedFromFiles:
  "Login with valid credentials"  → uses LoginForm.tsx  → ⚠ FLAG
  "Login with invalid credentials" → uses LoginForm.tsx → ⚠ FLAG
  "Navigate to dashboard"          → uses authRoutes.ts → ⚠ FLAG
```

Flagged tests appear in:
- Feature page: amber badge on the test name `⚠ Code changed`
- Project dashboard: "N tests may be outdated" alert
- Email digest (if enabled): daily summary of stale tests

Each flagged test shows a diff of what changed with two actions:
```
⚠ "Login with valid credentials" — LoginForm.tsx changed (commit a1b2c3d)
   Changed: #email-input → input[name="email"]
   [ Review & Update Test ]  [ Re-Generate ]  [ Mark as OK ]
```

**This closes the feedback loop between development and QA** — when a developer
renames a selector or changes a route, QA is notified instantly rather than
discovering it as a test failure.

---

### 3.6 Multi-Repo Cross-Stack Generation

For projects with multiple repos (e.g. frontend + backend + shared types), the AI can
combine context from all repos simultaneously to generate end-to-end tests that span
the full stack.

```
Feature: "User Checkout Flow"
Repos:
  ✓ frontend  (acme/checkout-ui)     → finds CheckoutForm.tsx, cart.ts
  ✓ backend   (acme/checkout-api)    → finds POST /api/orders, validationSchema.ts
  ✓ shared    (acme/shared-types)    → finds OrderRequest interface, CartItem type

AI combines all context:

  NAVIGATE  /checkout
  FILL      input[name="cardNumber"] → {{CARD_NUMBER}}  ← from CheckoutForm.tsx
  FILL      input[name="cvv"]        → {{CVV}}           ← from CheckoutForm.tsx
  CLICK     [data-testid="pay-btn"]
  API_REQUEST POST /api/orders        ← route from checkout-api
              body: { items: [...] }  ← shape from OrderRequest interface
  ASSERT_URL  /order-confirmation
  ASSERT_TEXT .order-id              ← selector from OrderConfirmation.tsx
```

The AI understands that `POST /api/orders` in the backend is what powers the checkout
button in the frontend — generating tests that verify the full request/response cycle,
not just the UI interaction.

---

## Data Model

```prisma
// ─── REPO CONNECTION ──────────────────────────────────────────────
enum RepoProvider    { GITHUB GITLAB GITEA LOCAL }
enum RepoIndexStatus { PENDING INDEXING READY FAILED }

model RepoConnection {
  id               String           @id @default(uuid())
  projectId        String           // NOT unique — a project can have multiple repos
  project          Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  orgCredentialId  String?          // when set, uses org-level credential instead of accessToken
  orgCredential    OrgGitCredential? @relation(fields: [orgCredentialId], references: [id])
  displayName      String           // "frontend", "api" — shown in dropdowns
  provider         RepoProvider
  baseUrl          String?          // custom base URL for self-hosted providers
  repoUrl          String?          // full clone URL; null for LOCAL
  repoOwner        String?          // e.g. "acme"
  repoName         String?          // e.g. "my-app-frontend"
  defaultBranch    String           @default("main")
  localPath        String?          // null for cloud providers
  accessToken      String?          // AES-256 encrypted; null when using orgCredentialId or LOCAL
  webhookSecret    String?          // for verifying push webhook payloads
  includeGlobs     String[]         // file extensions to include
  excludeGlobs     String[]         // paths to exclude
  autoSync         Boolean          @default(true)
  lastIndexedAt    DateTime?
  status           RepoIndexStatus  @default(PENDING)
  chunkCount       Int              @default(0)
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  chunks           CodeChunk[]

  @@map("repo_connections")
}

// TestDefinition gains:
//   generatedFromFiles String[]  — file paths used during AI generation
//                                   used for coverage heat map + change detection
// (already defined in ARCHITECTURE.md; add this field there)

// ─── CODE CHUNK (indexed + embedded) ──────────────────────────────
model CodeChunk {
  id           String         @id @default(uuid())
  projectId    String
  repoId       String
  repo         RepoConnection @relation(fields: [repoId], references: [id], onDelete: Cascade)
  filePath     String         // relative: "src/features/auth/LoginForm.tsx"
  chunkIndex   Int            // position within the file
  content      String         // raw code text
  embedding    Unsupported("vector(1536)")?  // pgvector
  createdAt    DateTime       @default(now())

  @@index([projectId])
  @@index([repoId])
  @@map("code_chunks")
}
```

---

## How Indexing Works

```
Repo connected → BullMQ IndexJob created
        ↓
IndexerService.run(repoConnectionId)
        ↓
Clone or pull repo at specified branch
(GitHub/GitLab/Gitea: git clone using token in URL)
(Local: read directly from mounted path)
        ↓
Walk file tree
  Filter by includeGlobs (*.ts, *.tsx, *.vue…)
  Exclude by excludeGlobs (node_modules/**, dist/**)
  Hard-exclude: *.env, *.key, *secret*, *password*
        ↓
For each file:
  Split into chunks at function/component boundaries
  (max 500 tokens per chunk, overlap 50 tokens)
        ↓
Batch embed all chunks
  OpenAI  → text-embedding-3-small  (1536 dims)
  Ollama  → nomic-embed-text        (768 dims)
  Azure   → text-embedding-ada-002  (1536 dims)
        ↓
Upsert into code_chunks (delete old, insert new)
        ↓
RepoConnection.status = READY
RepoConnection.chunkCount = N
RepoConnection.lastIndexedAt = now()
        ↓
Emit WebSocket event → project settings page updates live
```

**Re-index triggers:**
1. Manual "Sync Now" button in Project Settings
2. Push webhook from GitHub/GitLab/Gitea fires `POST /projects/:id/repo/:repoId/webhook`
3. Scheduled nightly sync (optional, configurable per repo)

---

## Webhook Setup

For auto-sync on code push, a webhook must be configured in the repo provider.

**GitHub:**
```
Repo → Settings → Webhooks → Add webhook
Payload URL: https://qa-platform.co/api/v1/projects/{id}/repo/{repoId}/webhook
Content type: application/json
Secret:       (copy from platform — used for HMAC verification)
Events:       Just the push event
```

**GitLab:**
```
Repo → Settings → Webhooks
URL:    https://qa-platform.co/api/v1/projects/{id}/repo/{repoId}/webhook
Token:  (copy from platform)
Trigger: Push events
```

**Gitea:**
```
Repo → Settings → Webhooks → Add Webhook → Gitea
Target URL: https://qa-platform.co/api/v1/projects/{id}/repo/{repoId}/webhook
Secret:     (copy from platform)
Trigger On: Push Events
```

The platform shows the webhook URL and secret directly in the repo settings card
with a "Copy" button for each.

---

## API Endpoints

```
# Repo management (per project)
GET    /projects/:id/repos                     List all connected repos
POST   /projects/:id/repos                     Connect a new repo
GET    /projects/:id/repos/:repoId             Get connection status + stats
PATCH  /projects/:id/repos/:repoId             Update settings (branch, globs, autoSync)
DELETE /projects/:id/repos/:repoId             Disconnect + delete all chunks
POST   /projects/:id/repos/:repoId/sync        Trigger manual re-index
POST   /projects/:id/repos/:repoId/webhook     Push webhook receiver

# Branch listing (called when user selects a repo in the generation form)
GET    /projects/:id/repos/:repoId/branches    List branches from provider API

# OAuth callbacks (repo-specific — separate from SSO)
GET    /auth/github-repo/callback              GitHub repo OAuth callback
GET    /auth/gitlab-repo/callback              GitLab repo OAuth callback

# AI test generation
POST   /features/:id/generate-tests            Generate tests for a feature
  Body: {
    prompt: string,
    repoIds: string[],       // which repos to search
    branch: string,          // branch to use
    filePaths?: string[],    // optional path hints
    testType: "UI"|"API"|"SHELL",
    count: number            // 1–10
  }
```

---

## Security

| Concern | How handled |
|---------|-------------|
| Token storage | AES-256-GCM encrypted, key from `REPO_TOKEN_SECRET` env var |
| Token exposure | Tokens never returned in any API response; masked in logs |
| Webhook authenticity | GitHub: HMAC-SHA256 of body with `X-Hub-Signature-256`; GitLab: `X-Gitlab-Token` header; Gitea: HMAC-SHA256 |
| Sensitive file exclusion | Hard-coded exclude: `**/.env*`, `**/*.key`, `**/secrets.*`, `**/credentials.*` |
| Read-only access | OAuth scopes: `repo:read` only; local path: `:ro` Docker mount |
| Re-index scope | Only re-indexes on push to configured `defaultBranch` (or manually triggered) |

---

## Environment Variables

```bash
# Required
REPO_TOKEN_SECRET=<min 32 chars>    # encrypts stored OAuth/PAT tokens

# GitHub OAuth for repo connections (separate from SSO GitHub login)
GITHUB_REPO_CLIENT_ID=
GITHUB_REPO_CLIENT_SECRET=
GITHUB_REPO_CALLBACK_URL=https://qa-platform.co/api/v1/auth/github-repo/callback

# GitLab OAuth for repo connections
GITLAB_REPO_CLIENT_ID=
GITLAB_REPO_CLIENT_SECRET=
GITLAB_REPO_CALLBACK_URL=https://qa-platform.co/api/v1/auth/gitlab-repo/callback

# Gitea — PAT only, no OAuth needed (URL set per-connection in UI)

# Embedding model (for indexing code chunks)
# Uses the same AI_PROVIDER as the rest of the platform.
# OpenAI/Azure use text-embedding-3-small / text-embedding-ada-002 automatically.
# For Ollama: set the embedding model name
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

> **Note:** GitHub/GitLab OAuth for _repo connections_ is separate from the SSO
> OAuth used for _user login_. They use different OAuth apps with different scopes
> (`repo:read` vs `openid profile email`) and different callback URLs.

---

## Where This Fits in the Implementation Plan

**Phase 5.5** in `IMPLEMENTATION_PLAN.md`. Depends on:
- Phase 2.0.1 — Module/Feature hierarchy (features must exist to attach generated tests to)
- Phase 1.1 — API test suite (RAG logic and embedding tested)
- pgvector extension enabled on PostgreSQL (`CREATE EXTENSION vector`)
