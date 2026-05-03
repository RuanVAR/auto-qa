# Exploratory Testing (Session-Based Test Management)

**Phase target:** Phase 5.5 (reclaim ghost slot) + Phase 11 extension.
**Status:** Planned — not yet implemented.

This doc specifies first-class exploratory testing as a session-based workflow distinct from scripted manual testing (`docs/MANUAL_TESTING.md`) and passive session tracking (`docs/SESSION_TRACKING.md`). It extends those two systems rather than replacing them.

Related docs:
- `docs/SESSION_TRACKING.md` — passive work-session timing (extended below)
- `docs/MANUAL_TESTING.md` — scripted step checklist (opposite workflow)
- `docs/AGENTIC_AI_TESTING.md` — AI Explorer agent (different concept — autonomous, not human-driven)
- `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` — Jira / ClickUp / Slack integration
- `docs/AI_LAYER.md` — LangChain abstraction, used for AI assist + gap analysis
- `docs/PM_INTEGRATIONS.md` — ticket creation flow

---

## 1. Core Concept — What Exploratory Testing Is (On This Platform)

A **Session** is a time-boxed, charter-driven investigation of a product area. The tester explores freely (no pre-written steps), takes live notes, captures screenshots + screen recording, files **findings** (bugs/questions/ideas/risks), and converts valuable findings into formal tests or tickets afterward. A **debrief** closes the session with metrics and sign-off.

This complements — does not replace — scripted manual and automated testing. Exploratory sessions are the discovery engine; scripted tests are the regression engine.

**First-class entities introduced:**
- `SessionCharter` — the objective and scope of a session
- `ExploratorySession` — the execution record (extends existing `WorkSession`)
- `SessionNote` — chronological live note stream
- `SessionFinding` — anything worth remembering (bug/question/idea/risk/praise)
- `SessionEvidence` — screenshots, DOM snapshots, network captures, video clips
- `Annotation` — shapes + text drawn on screenshots
- `CoverageArea` — the tree of areas tested vs untested
- `SessionDebrief` — structured review form

---

## 2. Data Model

All models scoped to `orgId` and soft-deleted per platform rules (`CLAUDE.md`). All use `id String @id @default(uuid())`.

### 2.1 `SessionCharter`

The plan for a session. A charter can be reused (spawn multiple sessions from the same charter over time).

```prisma
model SessionCharter {
  id             String     @id @default(uuid())
  orgId          String
  projectId      String
  featureId      String?    // optional — charters may cross features
  createdById    String

  title          String     // "Explore OAuth sign-in failure modes"
  objective      String     // long-form: what are we trying to learn?
  hypothesis     String?    // "Google OAuth breaks when user's token has expired"
  areasInScope   String[]   @default([])   // ["login", "oauth", "session-refresh"]
  areasOutOfScope String[]  @default([])
  risks          String[]   @default([])   // known risks / caveats
  durationTarget Int                        // minutes — 30/60/90/120

  riskRating     CharterRisk @default(MEDIUM)
  status         CharterStatus @default(ACTIVE)

  deletedAt      DateTime?
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt

  project        Project    @relation(fields: [projectId], references: [id])
  feature        Feature?   @relation(fields: [featureId], references: [id])
  createdBy      User       @relation(fields: [createdById], references: [id])
  sessions       ExploratorySession[]

  @@index([orgId, projectId])
  @@map("session_charters")
}

enum CharterRisk  { LOW  MEDIUM  HIGH  CRITICAL }
enum CharterStatus { ACTIVE  ARCHIVED  SUPERSEDED }
```

### 2.2 `ExploratorySession`

The live execution record. **Extends** — does not duplicate — the existing `WorkSession` from `docs/SESSION_TRACKING.md`. `ExploratorySession.workSessionId` is the link.

```prisma
model ExploratorySession {
  id               String    @id @default(uuid())
  orgId            String
  charterId        String
  testerId         String
  workSessionId    String?   // link to passive WorkSession (if one is open)

  environmentId    String
  startedAt        DateTime  @default(now())
  endedAt          DateTime?
  durationSec      Int?                     // computed when endedAt set

  status           SessionStatus @default(RUNNING)
  // TOUCHED via heartbeat; passes to ABANDONED after 60 min (mirrors MANUAL_TESTING timeout)
  lastHeartbeatAt  DateTime?

  // SBTM time split (seconds)
  setupSec         Int       @default(0)   // setting up, reading docs
  testSec          Int       @default(0)   // actively testing
  bugSec           Int       @default(0)   // writing bug reports
  // Tester taps T/B/S mode pill to switch — stopwatch per bucket

  screenRecordingUrl String?               // S3 key (RecordRTC output)
  pairSessionId    String?                 // see §7

  deletedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  charter          SessionCharter  @relation(fields: [charterId], references: [id])
  tester           User            @relation(fields: [testerId], references: [id])
  environment      Environment     @relation(fields: [environmentId], references: [id])
  workSession      WorkSession?    @relation(fields: [workSessionId], references: [id])

  notes            SessionNote[]
  findings         SessionFinding[]
  debrief          SessionDebrief?
  coverageMarks    CoverageMark[]
  participants     SessionParticipant[]     // pair testing

  @@index([orgId, testerId, status])
  @@map("exploratory_sessions")
}

enum SessionStatus {
  RUNNING
  PAUSED
  COMPLETED
  ABANDONED     // heartbeat expired
  CANCELLED
}
```

### 2.3 `SessionNote`

Chronological note stream. One note per user input (line break or `Enter` commits a note). Slash-commands create typed entries.

```prisma
model SessionNote {
  id          String     @id @default(uuid())
  sessionId   String
  authorId    String

  at          DateTime   @default(now())   // note timestamp (monotonic — used for video sync)
  recordedAtMs Int?                        // ms offset into screen recording (for jump-to)

  body        String                       // markdown supported
  kind        NoteKind   @default(NOTE)
  tags        String[]   @default([])      // arbitrary user tags

  findingId   String?                      // if this note was promoted to a finding

  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  session     ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  author      User               @relation(fields: [authorId], references: [id])
  finding     SessionFinding?    @relation(fields: [findingId], references: [id])

  @@index([sessionId, at])
  @@map("session_notes")
}

enum NoteKind {
  NOTE       // plain
  BUG        // /bug
  QUESTION   // /question
  IDEA       // /idea
  RISK       // /risk
  PRAISE     // /praise
  TODO       // /todo
}
```

### 2.4 `SessionFinding`

A finding is anything worth acting on. Notes can be promoted to findings; evidence attaches to findings.

```prisma
model SessionFinding {
  id           String      @id @default(uuid())
  orgId        String
  sessionId    String
  authorId     String

  title        String
  description  String
  kind         FindingKind
  severity     FindingSeverity @default(MEDIUM)
  status       FindingStatus   @default(OPEN)

  // Where / what
  pageUrl      String?
  routePattern String?                       // "/users/:id/orders"
  featureId    String?                       // auto-inferred from route via code-map
  stepsToRepro String[]  @default([])       // auto-captured from DOM events (see §5.3)

  // Outcomes — what was done with this finding
  linkedTicketProvider String?               // "jira" | "clickup" | "github" | null
  linkedTicketId       String?               // external ticket id
  linkedTicketUrl      String?
  promotedTestCaseId   String?               // if converted into a test case
  addedToRiskRegister  Boolean @default(false)

  deletedAt    DateTime?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  session      ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  author       User               @relation(fields: [authorId], references: [id])
  feature      Feature?           @relation(fields: [featureId], references: [id])
  evidence     SessionEvidence[]
  notes        SessionNote[]

  @@index([orgId, sessionId, kind])
  @@map("session_findings")
}

enum FindingKind     { BUG  QUESTION  IDEA  RISK  PRAISE  USABILITY  PERF  A11Y  SECURITY }
enum FindingSeverity { LOW  MEDIUM  HIGH  CRITICAL }
enum FindingStatus   { OPEN  IN_TRIAGE  CONVERTED  WONT_FIX  RESOLVED }
```

### 2.5 `SessionEvidence` + `Annotation`

```prisma
model SessionEvidence {
  id          String   @id @default(uuid())
  orgId       String
  findingId   String?
  sessionId   String

  type        EvidenceType
  storageKey  String                     // S3 path: artifacts/{orgId}/sessions/{sessionId}/...
  mimeType    String
  sizeBytes   Int
  capturedAt  DateTime @default(now())
  recordedAtMs Int?                       // ms offset into session recording

  meta        Json?                       // type-specific payload (network HAR, DOM JSON etc.)

  session     ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  finding     SessionFinding?    @relation(fields: [findingId], references: [id])
  annotations Annotation[]

  @@index([sessionId])
  @@map("session_evidence")
}

enum EvidenceType {
  SCREENSHOT
  VIDEO_CLIP       // short clip extracted from full recording
  DOM_SNAPSHOT     // HTML snapshot
  NETWORK_HAR      // network requests .har
  CONSOLE_LOG      // browser console at time of capture
  FILE             // uploaded attachment
}

model Annotation {
  id          String   @id @default(uuid())
  evidenceId  String
  authorId    String

  kind        AnnotationKind
  // Geometry (normalised 0..1 coords so it scales with image size)
  x           Float
  y           Float
  width       Float?
  height      Float?
  text        String?
  colour      String   @default("#ef4444")   // hex
  strokeWidth Int      @default(3)

  // Blur regions use kind=BLUR and x/y/width/height — renderer applies CSS backdrop-filter

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  evidence    SessionEvidence @relation(fields: [evidenceId], references: [id], onDelete: Cascade)
  author      User            @relation(fields: [authorId], references: [id])

  @@map("session_annotations")
}

enum AnnotationKind { ARROW  BOX  CIRCLE  TEXT  HIGHLIGHT  BLUR }
```

### 2.6 `CoverageArea` + `CoverageMark`

Tree of testable areas — syncs from the Feature/Module tree but can have custom sub-nodes added by testers during planning.

```prisma
model CoverageArea {
  id          String   @id @default(uuid())
  orgId       String
  projectId   String
  parentId    String?                      // tree structure

  name        String
  kind        AreaKind @default(CUSTOM)
  sourceId    String?                      // featureId / moduleId if synced from platform tree

  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parent      CoverageArea?  @relation("Hierarchy", fields: [parentId], references: [id])
  children    CoverageArea[] @relation("Hierarchy")
  marks       CoverageMark[]

  @@index([orgId, projectId])
  @@map("coverage_areas")
}

enum AreaKind { MODULE  FEATURE  CUSTOM }

model CoverageMark {
  id          String     @id @default(uuid())
  sessionId   String
  areaId      String
  status      CoverageStatus                // TESTED / BLOCKED / OUT_OF_SCOPE
  note        String?
  markedAt    DateTime   @default(now())

  session     ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  area        CoverageArea       @relation(fields: [areaId], references: [id])

  @@unique([sessionId, areaId])
  @@map("coverage_marks")
}

enum CoverageStatus { UNTESTED  TESTED  PARTIAL  BLOCKED  OUT_OF_SCOPE }
```

### 2.7 `SessionDebrief`

```prisma
model SessionDebrief {
  id          String   @id @default(uuid())
  sessionId   String   @unique

  // PROOF framework
  past        String?  // what was done
  results     String?  // key findings
  outlook     String?  // what to explore next
  obstacles   String?  // blockers encountered
  feelings    String?  // tester confidence / concerns

  charterMet  Boolean  @default(false)
  coveragePct Int?     // 0..100 — AI-computed from CoverageMarks

  // Sign-off
  signedOffById String?
  signedOffAt   DateTime?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  session     ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  signedOffBy User?              @relation(fields: [signedOffById], references: [id])

  @@map("session_debriefs")
}
```

### 2.8 `SessionParticipant` (Pair Testing)

```prisma
model SessionParticipant {
  id          String   @id @default(uuid())
  sessionId   String
  userId      String
  role        ParticipantRole
  joinedAt    DateTime @default(now())
  leftAt      DateTime?

  session     ExploratorySession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  user        User               @relation(fields: [userId], references: [id])

  @@unique([sessionId, userId])
  @@map("session_participants")
}

enum ParticipantRole { DRIVER  NAVIGATOR  OBSERVER }
```

---

## 3. Feature: Session Charter — Planning Phase

### 3.1 Where

- New page: `/projects/:projectId/charters` — list all charters
- New page: `/projects/:projectId/charters/new` — create charter form
- Entry from `FeaturePage` header: `[✦ New Exploratory Session]` button
- Entry from charter list: `[▶ Start Session]` button per charter

### 3.2 Flow

1. User clicks `[✦ New Exploratory Session]` on a feature
2. Modal: choose **Start fresh** (new charter) or **Use existing charter** (dropdown)
3. Fresh: form with fields from `SessionCharter` model
4. AI-assist button `[✦ Suggest Charter]` — calls `POST /api/v1/charters/suggest` with `{ featureId, recentCommitSummary, recentBugs }`; LLM returns charter text pre-filled — user edits
5. Save charter → redirect to `/sessions/:sessionId/run` (session auto-started)

### 3.3 Tech

- Frontend: `CharterForm` component (React Hook Form + Zod validation)
- Backend: `CharterService.create()`, `CharterService.suggest()` — the latter calls `AIService.runTask('charter-suggestion', { ... })`
- AI task defined in `docs/AI_LAYER.md` — new task type `CHARTER_SUGGESTION`, prompt template in `apps/api/src/ai/prompts/charter-suggestion.hbs`
- Context injection: last 10 commits affecting the feature, last 10 bug findings for this area, existing tests for the feature

### 3.4 API

```
POST   /api/v1/projects/:projectId/charters            Create
GET    /api/v1/projects/:projectId/charters            List (filter by status, featureId)
GET    /api/v1/charters/:id                            Detail
PATCH  /api/v1/charters/:id                            Edit
DELETE /api/v1/charters/:id                            Soft delete
POST   /api/v1/charters/suggest                        AI suggestion
POST   /api/v1/charters/:id/sessions                   Start session from charter
```

---

## 4. Feature: Time-Box Timer

### 4.1 Where

In the **Session Run View** (full-screen layout — see §11). Timer lives in the top action bar, right side.

### 4.2 Flow

1. Session starts at `t=0` with `durationTarget` minutes from charter
2. Timer ticks visibly (`MM:SS`), green for `0..75%`, amber `75..100%`, red `> 100%`
3. At **75%** — soft toast: "15 min left. Start wrapping up?"
4. At **100%** — modal: "Target reached. Extend by 15 min, end session, or keep going (soft)?"
5. At **150%** — forced stop: session auto-moves to `ENDED_NEEDS_DEBRIEF`

### 4.3 Tech

- Frontend: `useSessionTimer(startedAt, durationTarget)` hook — returns `{ elapsed, remaining, percent, phase }`
- Phase enum: `GREEN | AMBER | RED | OVERTIME`
- Soft notifications via existing toast system (`docs/IN_APP_NOTIFICATIONS.md`)
- Auto-stop at 150%: backend cron `sessionTimeoutCron` runs every minute, marks sessions past 150% target as `ENDED_NEEDS_DEBRIEF` and emits socket event `session:auto-ended`
- Heartbeat: frontend `POST /sessions/:id/heartbeat` every 30s; if backend sees no heartbeat for 60 min → `ABANDONED`

### 4.4 Presets

Presets shown as pills: `30m  60m  90m  120m  Custom`. User can override during session via "Extend +15m" button (logged as `SessionEvent` for auditing).

---

## 5. Feature: Live Note Stream

### 5.1 Where

Left panel of the Session Run View. Always-focused text input at the top; reverse-chronological note list below.

### 5.2 Flow

1. User types — `Enter` commits a `NOTE` kind
2. `Shift+Enter` adds a line break within a note (multi-line allowed)
3. Slash-commands at start of input:
   - `/bug <text>` → creates `NoteKind.BUG`
   - `/question <text>` → `QUESTION`
   - `/idea <text>` → `IDEA`
   - `/risk <text>` → `RISK`
   - `/praise <text>` → `PRAISE`
   - `/todo <text>` → `TODO`
   - `/tag <tag1> <tag2> ...` → applies tags to next note
4. Each note gets a colour-coded left border per `NoteKind` (BUG red, QUESTION blue, IDEA amber, RISK orange, PRAISE green)
5. Hover a note → actions: `[Promote to Finding] [Edit] [Delete] [Jump to video]`
6. `Promote to Finding` opens the Finding form pre-filled with note body as description

### 5.3 Tech

- Frontend component: `NoteStream`
- State: Zustand store `sessionNotesStore` (`notes: SessionNote[]`, `addNote`, `editNote`, `promoteNote`)
- Slash-command parser: small state machine, commits `kind` before save
- Debounced autosave: each note saves 300ms after user stops typing (optimistic UI; reconciles with server `id`)
- Markdown rendered via `react-markdown` + `remark-gfm`
- Backend: `SessionNoteService.create()`, `.update()`, `.delete()`, `.promoteToFinding()`
- Socket.io: `session:note:new`, `session:note:updated` broadcast to the session room (used for pair testing)

### 5.4 Keyboard

| Shortcut | Action |
|---|---|
| `Cmd+K` | Focus note input |
| `Enter` | Commit note |
| `Shift+Enter` | Line break |
| `/` (at empty input) | Show slash-command picker |
| `Cmd+Shift+B` | Promote previous note to BUG finding |
| `Esc` | Cancel edit |

---

## 6. Feature: Screenshot + Annotation

### 6.1 Where

Triggered anywhere in the Session Run View. Screenshot opens in a modal with annotation toolbar.

### 6.2 Flow

1. User hits `Cmd+Shift+S` (or clicks 📸 icon)
2. Platform captures: (a) viewport of the app iframe/preview, (b) DOM snapshot, (c) current URL, (d) last 50 console logs, (e) network requests in last 30s
3. Annotation modal opens — left: canvas with screenshot; right: toolbar
4. Toolbar: `Arrow`, `Box`, `Circle`, `Text`, `Highlight`, `Blur`, `Undo`, `Redo`, `Delete`
5. User draws annotations; each is a `fabric.js` object serialised to `Annotation` records
6. Bottom bar: caption input + `[Attach to previous note]` / `[Create new finding]` / `[Save to session]`

### 6.3 Tech

- Screenshot capture:
  - **If app is in an iframe** (manual/exploratory mode): use `html2canvas` on the iframe document (requires same-origin OR server-side fallback via Puppeteer to hit the app URL)
  - **If app is in a new tab**: Chrome extension required (out of scope v1) OR user-triggered server-side Puppeteer screenshot
  - **Fallback**: browser Screen Capture API (`getDisplayMedia`) → single frame grab
- Annotation canvas: `fabric.js` (mature, battle-tested vector drawing)
- Blur rendering: `filter: blur(20px)` applied to cropped canvas region, flattened to raster on export
- Export: final annotated image rendered to PNG via `canvas.toDataURL()`, uploaded to S3
- DOM + network + console capture: injected content script on the preview iframe — publishes to parent via `postMessage`; parent merges into `SessionEvidence.meta`
- Server-side Puppeteer fallback service: `apps/worker/src/services/ScreenshotService.ts` — takes `{ url, sessionId, cookies }`, returns S3 key

### 6.4 Storage

Path: `artifacts/{orgId}/sessions/{sessionId}/evidence/{evidenceId}.png`

Annotations stored separately in the DB (not baked into the image — lets users re-edit).

### 6.5 API

```
POST   /api/v1/sessions/:id/evidence                  Create evidence (multipart)
POST   /api/v1/sessions/:id/evidence/capture          Server-side screenshot via Puppeteer
GET    /api/v1/evidence/:id                           Fetch with annotations
POST   /api/v1/evidence/:id/annotations               Add annotation
DELETE /api/v1/annotations/:id                        Remove annotation
```

---

## 7. Feature: Screen + Mic Recording

### 7.1 Where

Top action bar — `[● Record]` toggle. Active recording shows red pulsing dot + elapsed time.

### 7.2 Flow

1. User toggles record ON at session start (or any time during)
2. Browser prompts for Screen Capture + Mic permission (first time only per origin)
3. RecordRTC starts recording in VP9+Opus (WebM)
4. Recording runs in background — chunks buffered every 10s to IndexedDB (crash-safe)
5. Every note and finding stamps `recordedAtMs` — the current ms offset into the recording
6. On session end → final WebM uploaded to S3 (chunked multipart upload)
7. Findings list gets a `[▶ Jump to moment]` button that opens the recording player at the exact `recordedAtMs`

### 7.3 Tech

- Library: `RecordRTC` (already in tech stack per `CLAUDE.md`)
- Config: `{ type: 'video', mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 2_500_000 }`
- Chunked buffering to IndexedDB via `idb-keyval` — flushes 10s chunks; on crash, `localStorage` flag `session:recording:{sessionId}:crashed=true` prompts "Recover last recording?" on reload
- Upload: chunked `PUT /api/v1/sessions/:id/recording?chunk=N` → server streams to S3 multipart; on last chunk, S3 finalises
- Player: `video.js` with `currentTime` API for jump-to-moment
- Size budget: cap recording at 2 GB per session (soft warning at 1.5 GB)

### 7.4 Privacy

- **Auto-blur prompts**: optional setting "auto-blur input[type=password]" in recording — implemented via injected content script that overlays opaque divs on password fields during the record stream
- Mic indicator always visible (cannot record without explicit toggle)

---

## 8. Feature: `SessionFinding` (Convert Notes to Findings)

### 8.1 Where

Right panel of Session Run View — Findings list. Also the "Promote to Finding" action on notes.

### 8.2 Flow — Auto-captured repro steps

When a finding is created, the platform pulls the last **50 DOM interaction events** captured by the injected content script and presents them as candidate repro steps. User edits/deletes freely.

DOM events tracked:
- Click (CSS selector + text content)
- Form input (selector + value — redacted if input is password)
- Navigation (URL change)
- Scroll (page + Y offset)
- Keypress (only global shortcuts, not every keystroke)

Each event serialised to a `TestStep`-compatible JSON (see `docs/STEP_DEFINITION_SPEC.md`) so findings can be promoted to test cases with zero re-authoring.

### 8.3 Flow — Finding form

```
┌─────────────────────────────────────────────────────────────┐
│  New Finding                                                │
│  ┌────────────────────────────────────────┐                │
│  │ Title: ...                             │                │
│  │ Kind:  [BUG ▼]   Severity: [HIGH ▼]    │                │
│  │ Description (markdown):                │                │
│  │ ┌────────────────────────────────────┐ │                │
│  │ │                                    │ │                │
│  │ └────────────────────────────────────┘ │                │
│  │                                        │                │
│  │ Auto-captured repro steps:             │                │
│  │   1. Click "#login"                    │                │
│  │   2. Fill "#email" = "user@test.com"   │                │
│  │   3. Click "#submit"                   │  [✏] [🗑]      │
│  │                                        │                │
│  │ Evidence:                              │                │
│  │   [screenshot-1.png] [+ Add more]     │                │
│  │                                        │                │
│  │ Linked feature:  [Login Flow ▼]        │                │
│  │                                        │                │
│  │ [Cancel]                [Save Finding] │                │
│  └────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### 8.4 Tech

- Content script: `apps/web/public/session-capture.js` — injected into preview iframe via `<iframe srcdoc>` wrapper or `postMessage` handshake
- Event buffer: rolling 50-event circular array; on finding-create the buffer snapshots and is attached as `stepsToRepro`
- Feature inference: `POST /api/v1/features/infer-from-url` — uses code-map (`docs/CODEBASE_AWARE_TESTING.md`) to map current route to feature
- DOM snapshot: on finding-create, `document.documentElement.outerHTML` of iframe is captured (size-capped at 500 KB) and stored as evidence

---

## 9. Feature: Convert Finding → Ticket / Test / Risk

### 9.1 Where

Actions menu on each `SessionFinding` card in the Findings list + detail view.

### 9.2 Flows

#### 9.2.1 Convert → Jira / ClickUp / GitHub ticket

1. Click `[Create Ticket ▼]` on finding → dropdown lists every installed `createIssue`-capable plugin (ClickUp, Jira, GitHub, Linear — via `docs/PLUGIN_REGISTRY.md` capability registry)
2. Modal pre-fills from finding: title, description (including repro steps + screenshot links), auto-captured repro steps
3. Target is resolved via cascading binding config (feature → module → project — see `PLUGIN_REGISTRY.md` §5 and `PM_INTEGRATIONS.md` §5). Target display shown read-only: e.g. "→ My QA Bugs list (ClickUp, subtask of Q2 QA epic)"
4. Attachments: all screenshots attached to the finding are pre-selected; session recording clip (extracted around `recordedAtMs`) added as attachment candidate subject to size/policy rules in `PM_INTEGRATIONS.md` §6.5
5. Submit → `PluginService.dispatch({ capability: 'createIssue', installId, payload, scope: { projectId, moduleId, featureId } })` → creates external ticket → writes `TicketLink` row linked to `findingId`
6. Toast: "Ticket ABC-123 created ✓"; finding card shows ticket badge with `TicketLink.externalUrl`

#### 9.2.2 Convert → Draft Test Case

1. Click `[Promote to Test Case]` on finding
2. Modal shows: pre-filled test case name + auto-generated steps (from `stepsToRepro`)
3. AI-assist button `[✦ Refine Steps]` — calls `TestGenerationService` with the repro steps as context + the finding description → returns polished steps with assertions
4. User picks target feature → save → creates `TestCase` with steps and links to `SessionFinding.promotedTestCaseId`
5. Finding status → `CONVERTED`

#### 9.2.3 Add to Risk Register

1. Click `[Add to Risk Register]` — only enabled for `RISK` or high-severity `BUG`/`SECURITY`
2. Risk register is a project-level table `ProjectRisk` (new model, minimal: id, orgId, projectId, title, description, severity, likelihood, mitigation, status, createdAt)
3. Finding's `addedToRiskRegister = true`

### 9.3 Tech

- Reuse `PmIntegrationService.createIssue()` from `docs/PM_INTEGRATIONS.md`
- Reuse `TestGenerationService.generate()` from `docs/AI_GENERATION_SPEC.md` — new input variant `fromExploratoryFinding`
- Risk register endpoints: `GET/POST/PATCH /projects/:id/risks`

### 9.4 API

```
POST /api/v1/findings/:id/create-ticket             { provider, projectKey, assigneeId }
POST /api/v1/findings/:id/promote-to-test-case      { featureId, refine?: boolean }
POST /api/v1/findings/:id/add-to-risk-register
```

---

## 10. Feature: Coverage Mind Map

### 10.1 Where

New tab inside Session Run View: `[📋 Notes] [🔬 Findings] [🗺 Coverage]`. Also accessible standalone at `/projects/:projectId/coverage`.

### 10.2 Flow

1. Project's feature/module tree auto-seeds the map (synced on project open)
2. Tester can add custom nodes (e.g. "Edge case: expired token") that don't exist in the feature tree
3. During session, right-click a node → `Mark tested` / `Mark partial` / `Mark blocked` / `Mark out-of-scope` → creates `CoverageMark`
4. Nodes colour-coded:
   - Grey = untested
   - Green = tested
   - Amber = partial
   - Red = blocked
   - Dashed outline = out-of-scope
5. At session end, coverage % = `tested / (total − out_of_scope) × 100`

### 10.3 Tech

- Canvas library: `reactflow` (already common for DAG UIs; supports drag + auto-layout)
- Tree sync: `POST /api/v1/projects/:id/coverage/sync` re-runs every time a Feature/Module is added
- Custom nodes added by tester persist on the `CoverageArea` model with `kind=CUSTOM`
- Right-click context menu uses Radix `<DropdownMenu>`

### 10.4 Value

Over many sessions, the map becomes a **living coverage artefact** — new team members see what's been explored and what's still dark. Managers can filter to "show me everything marked blocked in the last 30 days".

---

## 11. Feature: Session Run View — Full-Screen Layout

Similar pattern to the Testing View (`docs/FEATURE_PLAYER.md`) — full-viewport, shell wrapper bypassed.

### 11.1 Route

```
/sessions/:sessionId/run
```

Rendered outside `<Shell>` in `App.tsx` (same pattern as Testing View).

### 11.2 Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOP BAR                                                                 │
│  [← Charter: OAuth sign-in]  [Timer 47:23 / 60:00]  [● REC 12:04]        │
│                              [T|B|S mode pills]     [End Session] [✕]   │
├──────────────────┬────────────────────────────────┬──────────────────────┤
│                  │                                │                      │
│  LEFT            │  CENTRE                        │  RIGHT               │
│  (~320px)        │  (flex — app iframe)           │  (~380px)            │
│                  │                                │                      │
│  Notes stream    │  [app under test renders]     │  Tabs:                │
│  (+ input at     │                                │  [Findings]          │
│   top)           │                                │  [Evidence]          │
│                  │                                │  [Coverage]          │
│  /bug /idea      │                                │                      │
│  /question       │                                │  Findings list:      │
│                  │                                │   🔴 Login fails on  │
│                  │                                │   🟡 UX: label cut   │
│                  │                                │                      │
└──────────────────┴────────────────────────────────┴──────────────────────┘
```

- Three-pane; left and right panels adjustable (localStorage persisted widths)
- Centre pane: if URL is embeddable → iframe; if blocked → "Open in new tab" + floating recorder window (like `FloatingRecorder` in `docs/LIVE_TEST_VIEWER.md`)
- All three panes share session context via React Context + Zustand store

### 11.3 Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Focus note input |
| `Cmd+Shift+S` | Screenshot |
| `Cmd+Shift+F` | New finding |
| `Cmd+Shift+R` | Toggle recording |
| `Cmd+1/2/3` | Switch right panel tab (Findings/Evidence/Coverage) |
| `Cmd+Shift+E` | End session (opens debrief) |
| `Esc` | Close modal |

---

## 12. Feature: Pair Testing

### 12.1 Where

`[👥 Invite]` button in the Session top bar.

### 12.2 Flow

1. Host clicks `[Invite]` → modal with shareable link: `/sessions/:id/join?token=xxx`
2. Link copies to clipboard; optionally share via Slack/email (reuses notification integrations)
3. Invitee opens link → joins as `OBSERVER` by default
4. Host can promote observer to `NAVIGATOR` (can add notes + findings) or `DRIVER` (additionally controls screenshots + recording)
5. Real-time sync via Socket.io room `session:{id}`
6. Presence cursors shown on left/right panels (not on the app iframe itself — privacy + CORS)
7. All notes tagged with `authorId`; findings show who created them

### 12.3 Tech

- Socket.io room join via token-signed URL (JWT with short TTL)
- Presence: `session:presence:join` / `session:presence:leave` events
- Shared state: notes + findings broadcast; screenshot/recording stays client-side for the driver only (no heavy video streaming in v1)
- Live cursors: `session:cursor:move` throttled to 20Hz

### 12.4 Permissions

| Role | Can do |
|---|---|
| DRIVER | Everything (screenshot, record, annotate, promote, end session) |
| NAVIGATOR | Add notes + findings, suggest findings |
| OBSERVER | Read-only; can add notes marked with 🗣 "suggestion" flag for driver to accept |

---

## 13. Feature: SBTM Metrics Dashboard

### 13.1 Where

- Per-session: end-of-session debrief screen
- Aggregate: `/projects/:projectId/analytics/exploratory`

### 13.2 Metrics

- **T/B/S time split** — Setup vs Test vs Bug time (stacked bar per session; heat map across week)
- **Bug yield per hour** — `findings.filter(BUG || SECURITY) / durationHours`
- **Charter completion %** — debrief's self-rated + AI-computed from coverage
- **Coverage delta** — new areas tested this session vs never-tested before
- **Finding severity mix** — pie chart of CRITICAL/HIGH/MED/LOW
- **Tester heat index** — which testers find the most high-severity bugs (leaderboard, opt-in)

### 13.3 Tech

- Aggregation queries in `ExploratoryAnalyticsService`
- Frontend: reuse Recharts (already in stack)
- Cached via Redis (`exploratory:analytics:{projectId}:{week}`) — 1h TTL, invalidated on session end

### 13.4 API

```
GET /api/v1/sessions/:id/metrics
GET /api/v1/projects/:id/analytics/exploratory?range=30d
```

---

## 14. Feature: Debrief Workflow

### 14.1 Where

End of session — cannot close session without completing debrief (for manager-tier charters; optional for LOW risk).

### 14.2 Flow

1. User clicks `[End Session]` → debrief modal opens
2. PROOF form: Past / Results / Outlook / Obstacles / Feelings — each is a textarea
3. AI-assist `[✦ Draft from session]` — LLM reads all notes + findings + coverage → pre-fills PROOF fields — user edits
4. Charter-met checkbox + coverage % (AI-suggested, editable)
5. If HIGH/CRITICAL charter risk → requires manager sign-off (routes via notification)
6. On submit: session `COMPLETED`, debrief saved, email digest sent to stakeholders
7. Post-debrief page: summary + links to findings + button `[Export PDF report]`

### 14.3 Tech

- New AI task `EXPLORATORY_DEBRIEF_DRAFT` in `docs/AI_LAYER.md`
- Prompt template input: session summary JSON (notes grouped by kind, findings list, coverage marks)
- PDF report: reuse Puppeteer from `docs/TESTING_PHASES_AND_REPORTS.md`; new template `exploratory-session-report.hbs`
- Manager sign-off: creates `SIGNOFF_REQUIRED` notification (per `docs/IN_APP_NOTIFICATIONS.md`)

---

## 15. Feature: AI Assist (Mid-Session + End)

### 15.1 Mid-Session Nudges

An AI agent runs in the background every 5 min; reads recent notes + coverage + charter; pushes non-intrusive nudges to the right panel:

- "You haven't tested error states for this form — try an invalid email"
- "The login test hasn't been exercised with an expired token yet"
- "Based on recent commits, network retry logic changed — worth exploring"

### 15.2 Tech

- New AI task `EXPLORATORY_NUDGE` in `docs/AI_LAYER.md`
- Runs every 5 min via BullMQ repeatable job scoped to active sessions
- Input: charter, last 10 notes, current URL, coverage tree, recent git commits for the feature
- Output: `{ nudges: [{ text, rationale, priority: 'low'|'med'|'high' }] }`
- Rate-limited: max 3 nudges per session per hour; dismissable
- Delivered via Socket.io `session:nudge:new` event → toast in right panel

### 15.3 End-of-Session Gap Analysis

On debrief submit, AI runs a final analysis:
- Coverage gap vs charter
- Suggested follow-up charters (seeded for next session)
- Duplicate-finding detection (cross-references with existing bug tickets via embedding similarity)
- Regression risk: "These 3 findings suggest test cases X, Y, Z should be added"

Output rendered in the post-debrief summary page + optionally exported to PDF report.

---

## 16. Integration Touch Points (Existing Systems)

| System | How ET hooks in |
|---|---|
| `docs/SESSION_TRACKING.md` | `ExploratorySession` extends `WorkSession` via `workSessionId`; timers unified |
| `docs/MANUAL_TESTING.md` | Shares iframe preview + timeout logic + screenshot uploader |
| `docs/LIVE_TEST_VIEWER.md` | Shares `FloatingRecorder` for new-tab app mode |
| `docs/IN_APP_NOTIFICATIONS.md` | New notification types: `EXPLORATORY_SESSION_INVITED`, `DEBRIEF_SIGNOFF_REQUIRED`, `FINDING_CONVERTED_TO_TICKET` |
| `docs/PM_INTEGRATIONS.md` | Finding → ticket flow reuses `PmIntegrationService` |
| `docs/AI_LAYER.md` | 4 new AI tasks: `CHARTER_SUGGESTION`, `EXPLORATORY_NUDGE`, `EXPLORATORY_DEBRIEF_DRAFT`, `GAP_ANALYSIS` |
| `docs/AI_GENERATION_SPEC.md` | Promote-to-test-case flow reuses generation pipeline |
| `docs/CODEBASE_AWARE_TESTING.md` | Feature inference from URL via code-map |
| `docs/TESTING_PHASES_AND_REPORTS.md` | Session reports reuse PDF infrastructure |
| `docs/GLOBAL_SEARCH.md` | Findings and notes indexed for search |

---

## 17. Migration & Rollout

### 17.1 DB Migration

One new migration: `20260421030000_add_exploratory_testing`

Adds: `session_charters`, `exploratory_sessions`, `session_notes`, `session_findings`, `session_evidence`, `session_annotations`, `coverage_areas`, `coverage_marks`, `session_debriefs`, `session_participants`, `project_risks`, plus all new enums.

### 17.2 Phased Rollout (within the ET phase)

1. **17.2.1 — Data model + charters + sessions** (DB, services, charter CRUD page)
2. **17.2.2 — Session Run View skeleton** (layout, timer, heartbeat)
3. **17.2.3 — Note stream + slash-commands**
4. **17.2.4 — Screenshots + annotation toolbar**
5. **17.2.5 — Recording + IndexedDB buffering + upload**
6. **17.2.6 — Findings + repro auto-capture**
7. **17.2.7 — Convert-to-ticket / test / risk**
8. **17.2.8 — Coverage mind map**
9. **17.2.9 — Pair testing (Socket.io rooms + presence)**
10. **17.2.10 — Debrief + SBTM metrics**
11. **17.2.11 — AI nudges + charter suggestion + gap analysis**

---

## 18. Verification Checklist (Acceptance Criteria)

### Data model
- [ ] All 11 new models created with correct relations; migration runs cleanly
- [ ] `orgId` scoping and soft deletes on every model per platform rules

### Charter
- [ ] Can create, list, edit, archive charters from project
- [ ] AI-suggest charter returns usable pre-filled content in < 5s
- [ ] Charter risk rating drives debrief sign-off requirement

### Session
- [ ] Can start session from charter; opens Session Run View full-screen
- [ ] Timer phases change colour at 75% / 100% / 150%
- [ ] Heartbeat fires every 30s; session auto-ABANDONED at 60 min of silence
- [ ] T/B/S mode pills switch stopwatch buckets correctly

### Notes
- [ ] `Cmd+K` focuses note input
- [ ] Slash-commands create correct `NoteKind`
- [ ] Notes auto-save 300ms after input stops
- [ ] Pair testers see each other's notes via Socket.io in < 500ms

### Screenshots + annotations
- [ ] `Cmd+Shift+S` captures iframe screenshot
- [ ] Annotations render correctly at any image size (normalised coords)
- [ ] Blur annotations flatten correctly in exported PNG
- [ ] Fallback Puppeteer screenshot works when iframe is blocked

### Recording
- [ ] Recording chunks buffer to IndexedDB every 10s
- [ ] On crash + reload, "Recover last recording?" prompt appears
- [ ] Findings `[Jump to moment]` seeks recording to `recordedAtMs`
- [ ] Password fields auto-blur in recording when setting enabled

### Findings
- [ ] Auto-captured repro steps match user's last DOM interactions
- [ ] Promote-to-test-case creates valid `TestCase` with steps
- [ ] Create-ticket creates external ticket and links back
- [ ] Risk register only accepts RISK / high-severity findings

### Coverage map
- [ ] Feature tree auto-syncs on project open
- [ ] Right-click marks create `CoverageMark` and update colour immediately
- [ ] Coverage % calculation excludes `OUT_OF_SCOPE`

### Pair testing
- [ ] Invite link joins observer by default
- [ ] Role promotions take effect in < 1s
- [ ] Live cursors visible on left + right panels (not centre iframe)
- [ ] Observer can suggest; only driver can promote

### Debrief
- [ ] Cannot close HIGH-risk session without manager sign-off
- [ ] AI-drafted PROOF fields are pre-filled and editable
- [ ] PDF report generates with all findings + evidence thumbnails

### AI assist
- [ ] Mid-session nudges fire max 3/hour
- [ ] Nudges dismissable and persist dismissal
- [ ] Gap analysis generates on debrief submit

### Analytics
- [ ] SBTM dashboard renders T/B/S split per session
- [ ] Bug yield/hour leaderboard respects opt-in flag
- [ ] 30-day aggregates cached in Redis with 1h TTL
