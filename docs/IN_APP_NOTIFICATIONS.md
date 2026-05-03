# In-App Notifications & Email System

Full specification for the platform notification system — the notification centre in the top nav, real-time delivery, all notification types with their actions, per-user preferences, and the complete transactional email catalog.

Related docs:
- `docs/NOTIFICATIONS_AND_INTEGRATIONS.md` — external integrations (Slack, Teams, Jira, Webhook)
- `docs/TESTING_PHASES_AND_REPORTS.md` — handover and sign-off emails
- `docs/MULTI_TENANCY_AND_RBAC.md` — invite and access request flows

---

## 1. Architecture Overview

```
Event source (API or Worker)
        │
        │  NotificationService.create(event)
        ▼
Notification record written to DB
        │
        ├──► Socket.io emit → connected clients receive notification:new
        │       └── Bell badge count incremented in real-time
        │
        └──► EmailService.send() (if user preferences enable email for this type)
                └── Queued as BullMQ job in "emails" queue
                        └── EmailWorker renders template + sends via SMTP/SES
```

All notification delivery is **async and non-blocking** — the originating API request never waits for a notification to be delivered.

---

## 2. Data Model

```prisma
model Notification {
  id         String             @id @default(uuid())
  orgId      String
  userId     String             // recipient
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)

  type       NotificationType
  category   NotificationCategory
  title      String             // short, e.g. "Login Flow passed"
  body       String             // one-sentence detail, e.g. "5/5 tests passed in 14.2s on Staging"
  isRead     Boolean            @default(false)
  readAt     DateTime?

  // Deep-link destination — the page this notification takes you to
  actionUrl  String?            // e.g. "/projects/abc/runs/xyz"

  // Primary CTA button shown on the notification card
  actionLabel String?           // e.g. "View Report", "Review Heals", "Sign Off"

  // Secondary CTA (optional)
  secondaryActionUrl   String?
  secondaryActionLabel String?

  // Rich metadata for rendering (icons, colours, linked entities)
  meta       Json               // { featureId, featureRunId, projectId, ... }

  // Expiry — some notifications auto-dismiss (e.g. info toasts)
  expiresAt  DateTime?

  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt

  @@index([userId, isRead, createdAt])
  @@index([orgId, createdAt])
  @@map("notifications")
}

enum NotificationCategory {
  RUN           // test run results
  PHASE         // phase promotions, sign-off
  ASSIGNMENT    // you were assigned / added
  AI            // AI events: heals, suggestions, duplicates
  TEAM          // invites, access requests, member changes
  REPORT        // scheduled reports ready
  SYSTEM        // platform-level alerts
}

enum NotificationType {
  // RUN
  FEATURE_RUN_PASSED
  FEATURE_RUN_FAILED
  FEATURE_RUN_PARTIAL        // some tests passed, some failed
  TEST_CASE_FAILED           // single test failure within a run

  // PHASE
  FEATURE_PROMOTED           // feature moved to next phase
  PHASE_REQUIRES_SIGN_OFF    // all UAT tests passed — awaiting sign-off
  FEATURE_SIGNED_OFF         // feature sign-off confirmed
  PHASE_FAILED               // phase tests fell below pass threshold

  // ASSIGNMENT
  ASSIGNED_TO_PHASE          // you were assigned as tester for a phase
  ADDED_TO_PROJECT           // you were added to a project
  ROLE_CHANGED               // your project role was changed

  // AI
  SELECTOR_HEALS_DETECTED    // one or more selectors were healed this run
  DUPLICATE_TESTS_DETECTED   // AI found near-duplicate test cases
  TEST_SUGGESTIONS_READY     // AI generated new test suggestions
  FLAKY_TEST_FLAGGED         // a test crossed the flaky threshold

  // TEAM
  INVITE_ACCEPTED            // someone accepted your invite
  ACCESS_REQUEST_SUBMITTED   // someone requested access (for admins)
  ACCESS_REQUEST_APPROVED    // your access request was approved
  ACCESS_REQUEST_REJECTED    // your access request was rejected

  // REPORT
  SCHEDULED_REPORT_READY     // a scheduled report was generated and is ready
  SESSION_REPORT_SENT        // a QA session report was sent

  // SYSTEM
  ENVIRONMENT_UNREACHABLE    // health check failed for a project environment
  INTEGRATION_FAILED         // Slack/Jira/webhook delivery failed
  CREDIT_LOW                 // AI generation credits running low (if usage-based)
}
```

---

## 3. Bell Icon + Badge — Top Nav

The bell icon sits in the top-right nav, between the org switcher and user avatar:

```
┌─────────────────────────────────────────────────────────────────────┐
│  QA Platform    [Org: Acme Corp ▼]         🔔 3    [RB ▼]          │
└─────────────────────────────────────────────────────────────────────┘
```

The badge:
- Shows the **unread count** (`isRead: false` for the current user)
- Cap display at `99+` if count exceeds 99
- Badge colour: red for any unread `RUN_FAILED` or `PHASE_FAILED` notifications; amber for other unread; hidden when count = 0
- Updates **in real-time** via Socket.io without page refresh

### Real-time Badge Update

```typescript
// Frontend — in the TopNav component
const { socket } = useSocket();
const [unreadCount, setUnreadCount] = useState(0);

useEffect(() => {
  socket.on('notification:new', (notification: Notification) => {
    setUnreadCount(prev => prev + 1);
    showToast(notification);   // ephemeral toast (see §5)
  });

  socket.on('notification:read', ({ unreadCount }: { unreadCount: number }) => {
    setUnreadCount(unreadCount);
  });

  return () => {
    socket.off('notification:new');
    socket.off('notification:read');
  };
}, [socket]);
```

---

## 4. Notification Panel (Dropdown)

Clicking the bell opens a panel anchored to the top nav. It does **not** navigate away — it overlays the current page.

```
┌─────────────────────────────────────────────────────────────┐
│  Notifications                    [Mark all read]  [⚙ Prefs] │
├─────────────────────────────────────────────────────────────┤
│  Today                                                       │
│                                                             │
│  ●  ✅ Login Flow passed                          2 min ago  │
│     5/5 tests passed in 14.2s on Staging                    │
│     [View Report]   [View Summary]                          │
│                                                             │
│  ●  ❌ Checkout Flow failed                       8 min ago  │
│     3/6 tests passed · 3 failed on Staging                  │
│     [View Report]   [Create Ticket ▼]                       │
│                                                             │
│  ●  🔮 2 selector heals detected                 41 min ago  │
│     Login Flow: Step 2, Step 5 were healed                  │
│     [Review Heals]                                          │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  Yesterday                                                   │
│                                                             │
│     📋 Login Flow ready for sign-off             Yesterday   │
│     All UAT tests passed — awaiting your approval           │
│     [Sign Off Feature]                                      │
│                                                             │
│     👤 Emma Watson accepted your invite          Yesterday   │
│     Emma joined as QA Engineer on My App                    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│              [ View all notifications → ]                    │
└─────────────────────────────────────────────────────────────┘
```

### Panel Behaviour

| Behaviour | Detail |
|-----------|--------|
| **Unread indicator** | Blue dot (●) on the left of unread items |
| **Read on view** | Items are marked read when the panel is opened (after 1 second of panel being visible) |
| **Auto-close** | Panel closes when user clicks outside it or presses `Escape` |
| **Scroll** | Panel is max 480px tall, scrollable; shows 10 most recent items |
| **Empty state** | "You're all caught up 🎉" with a subtle illustration |
| **Loading state** | 3 skeleton rows while fetching |
| **Grouping** | Items grouped by day: Today, Yesterday, then date labels (e.g. "Mon Apr 14") |

### Mark All Read

Clicking `[Mark all read]`:
- Immediately clears the blue dots and resets badge count to 0 (optimistic update)
- Sends `PATCH /api/v1/notifications/read-all`
- On API error: reverts the optimistic update and shows a toast

---

## 5. Ephemeral Toast Notifications

When a new notification arrives via Socket.io while the user is active on the platform, an ephemeral toast slides in from the bottom-right:

```
┌──────────────────────────────────────────────┐
│  ✅ Login Flow passed                    [✕]  │
│  5/5 tests passed in 14.2s on Staging        │
│  [View Report]                               │
└──────────────────────────────────────────────┘
```

Toast behaviour:
- Auto-dismisses after **6 seconds**
- Hovering pauses the dismiss timer
- `[✕]` dismisses immediately
- Max 3 toasts visible at once; oldest dismissed first if limit reached
- Toasts stack vertically with 8px gap
- **Failure toasts** have a red left border and persist for **10 seconds** (not 6)
- Clicking anywhere on the toast body navigates to `notification.actionUrl` and dismisses it

Toast is **not shown** when:
- The user already has the notification panel open
- The user is already on the page that `actionUrl` points to
- The notification type is `SYSTEM` severity INFO (too low-value to interrupt)

---

## 6. Full Notifications Page (`/notifications`)

Accessed from `[View all notifications →]` in the panel or directly from the sidebar.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Notifications                                                       │
│                                                                      │
│  Filter:  [All ▼]  [All categories ▼]  [All projects ▼]            │
│                        [Mark all read]                               │
├─────────────────────────────────────────────────────────────────────┤
│  Today — 3 unread                                                    │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ●  ✅  Login Flow passed                           2 min ago  │  │
│  │    My App · Staging · 5/5 tests · 14.2s                      │  │
│  │    [View Report]   [View Summary]                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ ●  ❌  Checkout Flow failed                        8 min ago  │  │
│  │    My App · Staging · 3/6 passed · Payment, Shipping failed   │  │
│  │    [View Report]   [Create Ticket ▼]   [Notify Slack]         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │    ⚠  3 selector heals in Checkout Flow           31 min ago  │  │
│  │    Step 2 (Click add-to-cart), Step 5 (Fill qty), Step 8      │  │
│  │    [Review Heals]   [Update Selectors]                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Yesterday — all read                                                │
│  ...                                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Filters

| Filter | Options |
|--------|---------|
| Read status | All / Unread only / Read only |
| Category | All / Run / Phase / Assignment / AI / Team / Report / System |
| Project | All projects you have access to |

Filters update the URL (`/notifications?category=run&status=unread`) for shareability and browser back support.

### Pagination

Infinite scroll — loads 20 items per page. No full-page reload between pages.

---

## 7. Notification Types — Full Catalogue

Each notification type has: icon, colour category, title template, body template, CTA buttons, and whether it triggers email.

### 7.1 Run Notifications

---

**`FEATURE_RUN_PASSED`**

| Field | Value |
|-------|-------|
| Icon | ✅ green |
| Title | `{featureName} passed` |
| Body | `{passCount}/{totalCount} tests passed in {duration}s on {envName}` |
| Primary CTA | **View Report** → `/projects/{p}/features/{f}/runs/{r}` |
| Secondary CTA | **View Summary** → run detail summary tab |
| Who receives | Project members with `notifyOnPass: true` in their preferences (default: MANAGER, OWNER) |
| Email | Optional (user pref). Default: off for ENGINEER/TESTER, on for MANAGER |

---

**`FEATURE_RUN_FAILED`**

| Field | Value |
|-------|-------|
| Icon | ❌ red |
| Title | `{featureName} failed` |
| Body | `{failCount}/{totalCount} tests failed on {envName} · {failedTestNames joined by ", "}` |
| Primary CTA | **View Report** → run detail |
| Secondary CTA | **Create Ticket ▼** → dropdown: configured bug trackers |
| Who receives | All active project members (configurable — default all roles) |
| Email | Default: on |

---

**`FEATURE_RUN_PARTIAL`**

| Field | Value |
|-------|-------|
| Icon | ⚠️ amber |
| Title | `{featureName} — partial results` |
| Body | `{passCount} passed, {failCount} failed on {envName}` |
| Primary CTA | **View Report** |
| Secondary CTA | **Retry Failed** → triggers retry run for failed test cases only |
| Who receives | Same as FAILED |
| Email | Default: on |

---

**`TEST_CASE_FAILED`**

Only fires when a single test case fails in isolation (e.g. a targeted single-test run), not as part of a feature run failure (to avoid double-notifying).

| Field | Value |
|-------|-------|
| Icon | ❌ red |
| Title | `"{testCaseName}" failed` |
| Body | `Failed at step {stepIndex}: {stepName} · {envName}` |
| Primary CTA | **View Step** → run detail scrolled to the failed step |
| Who receives | Test case owner + TECH_LEAD + MANAGER |
| Email | Default: on |

---

### 7.2 Phase Notifications

---

**`FEATURE_PROMOTED`**

| Field | Value |
|-------|-------|
| Icon | 🚀 blue |
| Title | `{featureName} promoted to {phaseName}` |
| Body | `Promoted by {promotedByName} · {previousPhaseName} → {phaseName}` |
| Primary CTA | **View Feature** → feature detail in new phase |
| Secondary CTA | **View Handover** → opens handover report/email preview |
| Who receives | All members assigned to the target phase + MANAGER + OWNER |
| Email | Handover email sent separately (see §12); this is the in-app notification |

---

**`PHASE_REQUIRES_SIGN_OFF`**

One of the most important actionable notifications — appears when all tests in the final phase pass and a sign-off is required before the feature is considered done.

| Field | Value |
|-------|-------|
| Icon | 📋 purple |
| Title | `{featureName} ready for sign-off` |
| Body | `All {phaseName} tests passed · Awaiting your approval to sign off` |
| Primary CTA | **Sign Off Feature** → opens sign-off modal directly |
| Secondary CTA | **View Report** → phase test results |
| Who receives | Users with MANAGER or OWNER role on the project |
| Urgency | High — amber border on notification card; toast persists 10s |
| Email | Default: on immediately |

---

**`FEATURE_SIGNED_OFF`**

| Field | Value |
|-------|-------|
| Icon | ✅ gold |
| Title | `{featureName} signed off` |
| Body | `Signed off by {signedOffByName} · {signOffMessage if set}` |
| Primary CTA | **View Feature** |
| Who receives | All project members + any listed in sign-off recipient list |
| Email | Sign-off email sent separately (see §12.3) |

---

**`PHASE_FAILED`**

| Field | Value |
|-------|-------|
| Icon | ❌ red |
| Title | `{featureName} failed in {phaseName}` |
| Body | `{failCount}/{totalCount} tests failed · Phase threshold not met` |
| Primary CTA | **View Failures** → feature run detail filtered to failed tests |
| Secondary CTA | **Re-run Phase** → trigger a new run in this phase |
| Who receives | MANAGER, OWNER, phase-assigned testers |
| Email | Default: on |

---

### 7.3 Assignment Notifications

---

**`ASSIGNED_TO_PHASE`**

| Field | Value |
|-------|-------|
| Icon | 👤 blue |
| Title | `You've been assigned to {phaseName} on {featureName}` |
| Body | `Assigned by {assignedByName} · {featureName} is currently {phaseStatus}` |
| Primary CTA | **View Feature** → feature detail |
| Who receives | The user being assigned |
| Email | Default: on |

---

**`ADDED_TO_PROJECT`**

| Field | Value |
|-------|-------|
| Icon | 🏗 blue |
| Title | `You've been added to {projectName}` |
| Body | `Added by {addedByName} as {roleName}` |
| Primary CTA | **Go to Project** → project dashboard |
| Who receives | The user being added |
| Email | Default: on |

---

**`ROLE_CHANGED`**

| Field | Value |
|-------|-------|
| Icon | 🔑 amber |
| Title | `Your role on {projectName} has changed` |
| Body | `{previousRole} → {newRole} · Changed by {changedByName}` |
| Primary CTA | **View Project** |
| Who receives | The affected user |
| Email | Default: off (low urgency) |

---

### 7.4 AI Notifications

---

**`SELECTOR_HEALS_DETECTED`**

| Field | Value |
|-------|-------|
| Icon | 🔧 amber |
| Title | `{healCount} selector {heal/heals} in {featureName}` |
| Body | Lists up to 3 healed steps: `Step 2: #login-btn → [data-testid="login-submit"]` |
| Primary CTA | **Review Heals** → run detail → heals tab |
| Secondary CTA | **Update Selectors** → one-click apply all high-confidence heals to test definitions |
| Who receives | Test case owners + TECH_LEAD |
| Email | Default: on if healCount ≥ 3; off for single heals |

---

**`DUPLICATE_TESTS_DETECTED`**

| Field | Value |
|-------|-------|
| Icon | 📋 amber |
| Title | `Duplicate tests detected in {featureName}` |
| Body | `{count} test cases appear to overlap with existing tests · Review and merge` |
| Primary CTA | **Review Duplicates** → AI Intelligence → Duplicates view |
| Who receives | OWNER, QA_MANAGER on the project |
| Email | Default: off |

---

**`TEST_SUGGESTIONS_READY`**

| Field | Value |
|-------|-------|
| Icon | ✦ blue |
| Title | `AI found {count} new test suggestions for {featureName}` |
| Body | `Based on recent code changes and uncovered AC items` |
| Primary CTA | **Review Suggestions** → feature detail → suggestions panel |
| Who receives | QA_ENGINEER + OWNER |
| Email | Default: off |

---

**`FLAKY_TEST_FLAGGED`**

| Field | Value |
|-------|-------|
| Icon | ⚡ amber |
| Title | `"{testCaseName}" flagged as flaky` |
| Body | `{flipRate}% flip rate over last {runCount} runs · Quarantine recommended` |
| Primary CTA | **View Flaky Tests** → AI Intelligence → Flaky Tests |
| Secondary CTA | **Quarantine** → one-click quarantine action |
| Who receives | Test case owner + TECH_LEAD |
| Email | Default: on |

---

### 7.5 Team Notifications

---

**`INVITE_ACCEPTED`**

| Field | Value |
|-------|-------|
| Icon | 👋 green |
| Title | `{inviteeName} accepted your invite` |
| Body | `{inviteeName} joined {orgName} as {role}` |
| Primary CTA | **View Team** → org settings → members |
| Who receives | The user who sent the invite |
| Email | Default: off |

---

**`ACCESS_REQUEST_SUBMITTED`** *(admin-facing)*

| Field | Value |
|-------|-------|
| Icon | 🔔 blue |
| Title | `New access request from {requesterName}` |
| Body | `Requested access to {projectName} — awaiting your review` |
| Primary CTA | **Review Request** → opens the access request review modal directly |
| Who receives | ORG_ADMIN, project OWNER |
| Email | Default: on |
| Urgency | High — badge dot persists until actioned |

---

**`ACCESS_REQUEST_APPROVED`**

| Field | Value |
|-------|-------|
| Icon | ✅ green |
| Title | `Access request approved` |
| Body | `You now have {role} access to {projectName}` |
| Primary CTA | **Go to Project** |
| Who receives | The requester |
| Email | Default: on |

---

**`ACCESS_REQUEST_REJECTED`**

| Field | Value |
|-------|-------|
| Icon | ✕ red |
| Title | `Access request declined` |
| Body | `{rejectedByName} declined your request for {projectName}{noteIfSet}` |
| Primary CTA | **Request Again** → opens the access request modal pre-filled |
| Who receives | The requester |
| Email | Default: on |

---

### 7.6 Report Notifications

---

**`SCHEDULED_REPORT_READY`**

| Field | Value |
|-------|-------|
| Icon | 📊 blue |
| Title | `{period} report ready — {projectName}` |
| Body | `Pass rate: {passRate}% · {passCount} passed, {failCount} failed this {period}` |
| Primary CTA | **View Report** → project reports page |
| Secondary CTA | **Download PDF** → direct PDF download |
| Who receives | Report schedule recipients |
| Email | Always sends email — this is the primary delivery method; in-app is supplementary |

---

### 7.7 System Notifications

---

**`ENVIRONMENT_UNREACHABLE`**

| Field | Value |
|-------|-------|
| Icon | ⚡ red |
| Title | `{envName} environment unreachable` |
| Body | `Health check failed for {baseUrl} · Runs may fail until resolved` |
| Primary CTA | **Check Environment** → project settings → environments |
| Who receives | OWNER + ORG_ADMIN |
| Email | Default: on |
| Urgency | High |

---

**`INTEGRATION_FAILED`**

| Field | Value |
|-------|-------|
| Icon | ⚡ amber |
| Title | `Integration delivery failed — {integrationName}` |
| Body | `{notificationTrigger} notification to {Slack/Jira/etc.} failed · {errorSummary}` |
| Primary CTA | **View Integration** → project settings → integrations |
| Secondary CTA | **Retry** → re-fires the failed notification payload |
| Who receives | Project OWNER |
| Email | Default: off |

---

## 8. Notification Preferences

Each user configures preferences per notification type. Preferences are per-user, not per-project (simplicity over granularity — power users who want per-project control can mute individual projects).

### 8.1 Preferences Model

```prisma
model NotificationPreference {
  id     String           @id @default(uuid())
  userId String
  user   User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  type     NotificationType
  inApp    Boolean   @default(true)   // show in bell + toast
  email    Boolean   @default(false)  // send email
  emailDigest Boolean @default(false) // include in daily digest instead of immediate

  @@unique([userId, type])
  @@map("notification_preferences")
}
```

If no preference record exists for a user+type combination, the **system defaults** apply (defined in §7, "Email" column for each type).

### 8.2 Default Matrix

| Category | In-App Default | Email Default | Notes |
|----------|---------------|---------------|-------|
| Run: PASSED | ✅ | ❌ | Pass = low urgency for most roles |
| Run: FAILED | ✅ | ✅ | Always want email on failure |
| Run: PARTIAL | ✅ | ✅ | |
| Phase: PROMOTED | ✅ | ✅ (handover email) | Separate handover email handles this |
| Phase: SIGN_OFF_REQUIRED | ✅ | ✅ | High urgency — always on |
| Phase: SIGNED_OFF | ✅ | ✅ (sign-off email) | |
| Phase: FAILED | ✅ | ✅ | |
| Assignment: ASSIGNED_TO_PHASE | ✅ | ✅ | |
| Assignment: ADDED_TO_PROJECT | ✅ | ✅ | |
| Assignment: ROLE_CHANGED | ✅ | ❌ | |
| AI: SELECTOR_HEALS | ✅ | ❌ | In-app enough; email opt-in available |
| AI: DUPLICATES | ✅ | ❌ | |
| AI: SUGGESTIONS | ✅ | ❌ | |
| AI: FLAKY_TEST | ✅ | ✅ | |
| Team: INVITE_ACCEPTED | ✅ | ❌ | |
| Team: ACCESS_REQUEST | ✅ | ✅ | Admins need email for this |
| Report: SCHEDULED | ✅ | ✅ | Email is primary delivery |
| System: ENV_UNREACHABLE | ✅ | ✅ | |
| System: INTEGRATION_FAILED | ✅ | ❌ | |

### 8.3 Preferences UI — Settings Page

Located at `Settings → Notifications` (accessible from user avatar menu → Settings).

```
┌─────────────────────────────────────────────────────────────────────┐
│  Notification Preferences                                            │
│                                                                      │
│  Control how and when you receive notifications.                     │
│                                                                      │
│  ┌── Run Notifications ──────────────────────────────────────────┐  │
│  │                          In-App    Email    Daily Digest       │  │
│  │  Feature run passed        ☑        ☐          ☐             │  │
│  │  Feature run failed        ☑        ☑          ☐             │  │
│  │  Feature run partial       ☑        ☑          ☐             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌── Phase Notifications ────────────────────────────────────────┐  │
│  │  Feature promoted          ☑        ☑          ☐             │  │
│  │  Sign-off required         ☑        ☑          ☐             │  │
│  │  Feature signed off        ☑        ☑          ☐             │  │
│  │  Phase failed              ☑        ☑          ☐             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌── AI Notifications ───────────────────────────────────────────┐  │
│  │  Selector heals detected   ☑        ☐          ☑             │  │
│  │  Duplicate tests found     ☑        ☐          ☑             │  │
│  │  New test suggestions      ☑        ☐          ☑             │  │
│  │  Flaky test flagged        ☑        ☑          ☐             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌── Team Notifications ─────────────────────────────────────────┐  │
│  │  Invite accepted           ☑        ☐          ☐             │  │
│  │  Access request received   ☑        ☑          ☐             │  │
│  │  Access request approved   ☑        ☑          ☐             │  │
│  │  Access request rejected   ☑        ☑          ☐             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Daily Digest Time:  [08:00 ▼]  Timezone: [Africa/Johannesburg ▼]   │
│                                                                      │
│  [ Restore defaults ]                            [ Save preferences ]│
└─────────────────────────────────────────────────────────────────────┘
```

**Daily Digest** — if checked for a type, that notification type is batched and included in a once-daily email summary rather than sending immediate emails. The digest fires at the user's configured time. This prevents inbox spam for AI-type notifications that may fire frequently.

---

## 9. Muting

Users can mute notifications per project to stop receiving notifications from specific projects without changing global preferences.

### Mute a Project

Available from:
- The notification card three-dot menu: `[⋯]` → **Mute notifications from {projectName}**
- Project Settings sidebar → **Mute** toggle (for members)

```prisma
model NotificationMute {
  id        String   @id @default(uuid())
  userId    String
  projectId String
  mutedAt   DateTime @default(now())
  expiresAt DateTime?   // null = permanent until unmuted

  @@unique([userId, projectId])
  @@map("notification_mutes")
}
```

When a mute exists, `NotificationService.create()` skips creating both the in-app record and the email for that user+project combination.

Muted projects show a `🔕` badge on their project card in the dashboard. A global mute banner appears at the top of the notifications page: `"You have muted 2 projects. Unmute"`.

---

## 10. Notification Service — Implementation

File: `apps/api/src/notifications/notifications.service.ts`

### 10.1 Core Create Method

```typescript
async create(input: CreateNotificationInput): Promise<void> {
  // 1. Resolve recipients
  const recipients = await this.resolveRecipients(input);

  for (const userId of recipients) {
    // 2. Check mutes
    const muted = await this.isMuted(userId, input.projectId);
    if (muted) continue;

    // 3. Get preferences
    const prefs = await this.getPreferences(userId, input.type);

    // 4. Create DB record (if in-app enabled)
    let notification: Notification | null = null;
    if (prefs.inApp) {
      notification = await this.db.notification.create({
        data: {
          orgId:               input.orgId,
          userId,
          type:                input.type,
          category:            this.categoryFor(input.type),
          title:               this.renderTitle(input),
          body:                this.renderBody(input),
          actionUrl:           input.actionUrl,
          actionLabel:         input.actionLabel,
          secondaryActionUrl:  input.secondaryActionUrl,
          secondaryActionLabel: input.secondaryActionLabel,
          meta:                input.meta,
          expiresAt:           input.expiresAt,
        },
      });
    }

    // 5. Emit socket event
    if (notification) {
      this.gateway.emitToUser(userId, 'notification:new', notification);
    }

    // 6. Queue email (if email enabled and not digest)
    if (prefs.email && !prefs.emailDigest) {
      await this.emailQueue.add('send-notification-email', {
        userId,
        notificationType: input.type,
        meta: input.meta,
      });
    }

    // 7. Add to digest queue (if digest enabled)
    if (prefs.email && prefs.emailDigest) {
      await this.digestService.addToDigest(userId, input);
    }
  }
}
```

### 10.2 Recipient Resolution

```typescript
private async resolveRecipients(input: CreateNotificationInput): Promise<string[]> {
  // Explicit user IDs take priority
  if (input.recipientUserIds?.length) {
    return input.recipientUserIds;
  }

  // Role-based resolution
  if (input.recipientRoles?.length && input.projectId) {
    const members = await this.db.projectMember.findMany({
      where: {
        projectId: input.projectId,
        projectRole: { in: input.recipientRoles },
      },
      select: { userId: true },
    });
    return members.map(m => m.userId);
  }

  // Default: all active project members
  if (input.projectId) {
    const members = await this.db.projectMember.findMany({
      where: { projectId: input.projectId },
      select: { userId: true },
    });
    return members.map(m => m.userId);
  }

  return [];
}
```

### 10.3 Integration with Run Events

`NotificationService.create()` is called from:

```typescript
// In RunsService.handleRunComplete():
await this.notificationService.create({
  type:     featureRun.status === 'PASSED' ? 'FEATURE_RUN_PASSED'
          : featureRun.failCount === featureRun.totalCount ? 'FEATURE_RUN_FAILED'
          : 'FEATURE_RUN_PARTIAL',
  orgId:    featureRun.orgId,
  projectId: feature.projectId,
  meta: {
    featureRunId:  featureRun.id,
    featureId:     feature.id,
    featureName:   feature.name,
    projectId:     feature.projectId,
    projectName:   project.name,
    envName:       environment.name,
    passCount:     featureRun.passCount,
    failCount:     featureRun.failCount,
    totalCount:    featureRun.totalCount,
    duration:      featureRun.duration,
    failedTestNames: failedTests.map(t => t.name),
  },
  actionUrl:   `/projects/${feature.projectId}/features/${feature.id}/runs/${featureRun.id}`,
  actionLabel: 'View Report',
  secondaryActionUrl:   `/projects/${feature.projectId}/features/${feature.id}/runs/${featureRun.id}?tab=summary`,
  secondaryActionLabel: 'View Summary',
});
```

---

## 11. API Endpoints

```
GET    /api/v1/notifications                       Paginated list (query: ?status=unread&category=run&projectId=)
GET    /api/v1/notifications/unread-count          { count: number } — polled on reconnect
PATCH  /api/v1/notifications/:id/read              Mark single as read
PATCH  /api/v1/notifications/read-all              Mark all as read
DELETE /api/v1/notifications/:id                   Dismiss (soft delete)
DELETE /api/v1/notifications/clear-read            Delete all read notifications older than 30 days

GET    /api/v1/notifications/preferences           Get user's preferences
PATCH  /api/v1/notifications/preferences           Update preferences (body: { [type]: { inApp, email, emailDigest } })
POST   /api/v1/notifications/preferences/reset     Reset to system defaults

GET    /api/v1/notifications/mutes                 List muted projects
POST   /api/v1/notifications/mutes                 { projectId, expiresAt? } — mute a project
DELETE /api/v1/notifications/mutes/:projectId      Unmute
```

All endpoints require `Authorization: Bearer <token>`. Users can only access their own notifications.

---

## 12. Email System

### 12.1 Base Email Template

All emails share a common HTML wrapper with:
- Platform logo (configurable in Admin Settings)
- Org name in the header
- Consistent typography and colour scheme
- Unsubscribe footer with one-click preference link
- "View in platform" link for all notification emails

```html
<!-- Base structure (Mjml compiled to HTML) -->
<mj-body>
  <mj-section> <!-- Header -->
    <mj-image src="{platformLogoUrl}" width="120px" />
    <mj-text>{orgName}</mj-text>
  </mj-section>

  <mj-section> <!-- Content — injected per template -->
    {CONTENT}
  </mj-section>

  <mj-section> <!-- Footer -->
    <mj-text>
      You received this because you are a member of {orgName} on QA Platform.
      <a href="{preferencesUrl}">Manage notification preferences</a> ·
      <a href="{unsubscribeUrl}">Unsubscribe from all emails</a>
    </mj-text>
  </mj-section>
</mj-body>
```

### 12.2 Transactional Email Catalog

All emails sent by the platform, their triggers, and template notes:

---

#### Auth Emails

**Password Reset**
- Trigger: `POST /auth/forgot-password`
- Subject: `Reset your QA Platform password`
- Content: Reset link (expires 1 hour), security note if they didn't request it
- Template: Simple — logo, one-sentence body, large CTA button, expiry notice

**Email Verification** *(on new account creation)*
- Trigger: User registers
- Subject: `Verify your email — QA Platform`
- Content: Verify link (expires 24 hours)

**Organisation Invite**
- Trigger: ORG_ADMIN sends invite
- Subject: `{inviterName} invited you to join {orgName} on QA Platform`
- Content: Inviter name + role, "Join now" CTA, 7-day expiry note, platform overview blurb for new users

---

#### Access & Membership Emails

**Access Request Received** *(to admin)*
- Trigger: `ACCESS_REQUEST_SUBMITTED`
- Subject: `New access request from {requesterName} — {orgName}`
- Content: Requester name/email, requested project + role, "Review Request" CTA linking directly to the review modal

**Access Request Approved**
- Trigger: `ACCESS_REQUEST_APPROVED`
- Subject: `Access approved — {projectName}`
- Content: Granted role, project name, "Go to Project" CTA

**Access Request Rejected**
- Trigger: `ACCESS_REQUEST_REJECTED`
- Subject: `Access request declined — {projectName}`
- Content: Decliner name, optional note from reviewer, "Request Again" CTA

**Added to Project**
- Trigger: `ADDED_TO_PROJECT`
- Subject: `You've been added to {projectName}`
- Content: Who added them, their role, "Go to Project" CTA

---

#### Run Result Emails

**Feature Run Failed**
- Trigger: `FEATURE_RUN_FAILED` (when user preference email = on)
- Subject: `❌ {featureName} failed — {passCount}/{totalCount} passed · {envName}`
- Content: Pass/fail counts, per-test result rows (with failure details for failed tests), AI summary, screenshot thumbnail for first failure, "View Full Report" CTA
- Conditionally includes: selector heal warnings if any heals occurred this run

**Feature Run Passed** *(optional — off by default)*
- Subject: `✅ {featureName} passed — {envName}`
- Content: Minimal — pass count, duration, "View Report" CTA

**Scheduled Report** *(daily/weekly)*
- Trigger: `SCHEDULED_REPORT_READY`
- Subject: `{period} QA Report — {projectName} · {passRate}% pass rate`
- Content: Summary stats (total runs, pass rate, avg duration), feature breakdown table with pass/fail per feature, top failures with run counts, "View Full Report" CTA, optional PDF attached

---

#### Phase & Sign-off Emails

**Phase Promotion / Handover**
- Trigger: Feature promoted to next phase
- Subject: `{featureName} promoted to {phaseName} — Handover Report`
- Content: Summary of completed phase (pass rate, run count, testers), handover notes from promoter, list of assigned testers for the new phase, "View Feature" CTA
- Attachment: Phase PDF report
- Recipients: Phase manager, new phase assignees, `ProjectPhase.handoverRecipients`

**Sign-off Required**
- Trigger: `PHASE_REQUIRES_SIGN_OFF`
- Subject: `Action required: {featureName} awaiting sign-off`
- Content: Phase summary (all tests passed), "Sign Off Feature" CTA (deep links into the sign-off modal), expires-in notice
- Recipients: MANAGER + OWNER on project

**Feature Signed Off**
- Trigger: `FEATURE_SIGNED_OFF`
- Subject: `✅ {featureName} signed off by {signedOffByName}`
- Content: Sign-off message, phase summary, list of all passed phases, "View Feature" CTA
- Recipients: All project members + sign-off recipient list

---

#### AI Emails

**Flaky Test Detected**
- Trigger: `FLAKY_TEST_FLAGGED`
- Subject: `⚡ Flaky test detected — "{testCaseName}" in {featureName}`
- Content: Flip rate, last N run results (pass/fail alternating), AI root cause analysis text, "Quarantine Test" CTA + "View Flaky Tests" CTA

**Selector Heals** *(digest or immediate if ≥3 heals)*
- Subject: `🔧 {count} selectors healed in {featureName}`
- Content: Table of healed selectors (step name, old selector → new selector, confidence), "Review Heals" CTA

---

#### Session Emails

**Session Report**
- Trigger: QA session completed + reviewed
- Subject: `QA Session Report — {featureName(s)} · {durationFormatted}`
- Content: Session duration, features tested, runs executed, bugs filed, AI summary, activity timeline, "View in Platform" CTA
- Attachment: PDF session report
- Recipients: Session owner + project managers for touched projects

---

#### System Emails

**Environment Unreachable**
- Subject: `⚡ Environment unreachable — {envName} on {projectName}`
- Content: Base URL, when the check failed, health check error message, "Check Environment" CTA
- Recipients: Project OWNER + ORG_ADMIN

**Integration Delivery Failed**
- Subject: `Integration alert — {integrationName} delivery failed`
- Content: Integration name/type, error detail, number of failed attempts, "Review Integration" CTA

**Daily Digest**
- Subject: `QA Digest — {date} · {orgName}`
- Content: All notifications marked for digest delivery since the last digest, grouped by category
- Recipients: Users who have any notification type set to `emailDigest: true`

---

### 12.3 Email Infrastructure

```typescript
// apps/api/src/email/email.service.ts

interface EmailJob {
  to:         string[];
  cc?:        string[];
  subject:    string;
  template:   EmailTemplate;
  context:    Record<string, unknown>;
  attachments?: EmailAttachment[];
}

enum EmailTemplate {
  PASSWORD_RESET       = 'password-reset',
  EMAIL_VERIFICATION   = 'email-verification',
  ORG_INVITE           = 'org-invite',
  ACCESS_REQUEST       = 'access-request',
  ACCESS_APPROVED      = 'access-approved',
  ACCESS_REJECTED      = 'access-rejected',
  ADDED_TO_PROJECT     = 'added-to-project',
  RUN_FAILED           = 'run-failed',
  RUN_PASSED           = 'run-passed',
  SCHEDULED_REPORT     = 'scheduled-report',
  PHASE_HANDOVER       = 'phase-handover',
  SIGN_OFF_REQUIRED    = 'sign-off-required',
  FEATURE_SIGNED_OFF   = 'feature-signed-off',
  FLAKY_TEST           = 'flaky-test',
  SELECTOR_HEALS       = 'selector-heals',
  SESSION_REPORT       = 'session-report',
  ENV_UNREACHABLE      = 'env-unreachable',
  DAILY_DIGEST         = 'daily-digest',
}
```

Templates are rendered using **Handlebars** (via `@nestjs-modules/mailer` + `hbs`). Template files live at `apps/api/src/email/templates/*.hbs`.

Email sending uses **Nodemailer** with the SMTP config set in Admin Settings. SES can be used by configuring the SMTP bridge endpoint.

BullMQ queue `emails` handles all outbound email with:
- 3 retry attempts, exponential backoff
- Failed emails logged to `EmailDeliveryLog` model
- Retry UI in Admin Panel → Email tab

```prisma
model EmailDeliveryLog {
  id          String   @id @default(uuid())
  to          String[]
  subject     String
  template    String
  status      String   // sent | failed | bounced
  errorDetail String?
  sentAt      DateTime?
  createdAt   DateTime @default(now())
  @@map("email_delivery_logs")
}
```

---

## 13. Unsubscribe

Every email contains a signed one-click unsubscribe link:

```
https://platform/unsubscribe?token={signedToken}
```

The token encodes `{ userId, type: 'all' | NotificationType }`. Clicking it:
1. Sets `NotificationPreference.email = false` for the encoded type (or all types if `type: 'all'`)
2. Shows a simple confirmation page: _"You've been unsubscribed from [type] emails. [Manage all preferences]"_

No login required — the signed token is sufficient authentication for this low-risk action.

---

## 14. Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `notification:new` | Server → Client | Full `Notification` object |
| `notification:read` | Server → Client | `{ notificationId, unreadCount }` |
| `notification:read-all` | Server → Client | `{ unreadCount: 0 }` |
| `notification:deleted` | Server → Client | `{ notificationId }` |

Notifications are emitted to the user's personal Socket.io room: `user:{userId}`.

```typescript
// NotificationsGateway
this.server.to(`user:${userId}`).emit('notification:new', notification);
```

Clients join their user room on socket connection:

```typescript
// Frontend — in useSocket hook, after connection:
socket.emit('join:user-room');
// Server confirms and adds socket to room `user:{userId}`
```

---

## 15. Retention & Cleanup

- Notifications older than **90 days** are automatically deleted (regardless of read state)
- Read notifications older than **30 days** can be manually cleared by the user via the `/notifications` page
- `expiresAt` field on individual notifications allows per-notification TTL (e.g. ephemeral system alerts that are no longer relevant after an event resolves)
- Scheduled cleanup runs nightly via a BullMQ cron job

---

## 16. Implementation Plan Additions

These tasks are added to Phase 5 in `IMPLEMENTATION_PLAN.md`:

| # | Task |
|---|------|
| 5.M.1 | Prisma: `Notification`, `NotificationPreference`, `NotificationMute`, `EmailDeliveryLog` models + migration |
| 5.M.2 | `NotificationsService.create()` with recipient resolution, mute check, pref check |
| 5.M.3 | `NotificationsGateway` — `notification:new` socket event, user room join |
| 5.M.4 | All notification type constants, title/body templates, category mapping |
| 5.M.5 | Wire `NotificationService.create()` into `RunsService.handleRunComplete()` |
| 5.M.6 | Wire into `PhaseEngine` (promoted, sign-off required, signed off, failed) |
| 5.M.7 | Wire into `AccessRequestsService` (submitted, approved, rejected) |
| 5.M.8 | Wire into `ProjectMembersService` (added, role changed) |
| 5.M.9 | Wire into `SelectorHealService` / `FlakyDetectionService` |
| 5.M.10 | Notification REST API (list, read, read-all, delete, preferences, mutes) |
| 5.M.11 | Bell icon + badge component in TopNav with real-time socket update |
| 5.M.12 | Notification panel dropdown (10-item feed, grouped by day, CTA buttons) |
| 5.M.13 | Full `/notifications` page with filters + infinite scroll |
| 5.M.14 | Toast notification component (auto-dismiss, stack, failure persistence) |
| 5.M.15 | Preferences UI in Settings → Notifications |
| 5.M.16 | Mute project UI (notification card menu + project settings toggle) |
| 5.M.17 | Email templates: all 18 templates in Handlebars |
| 5.M.18 | Base email template (Mjml → HTML, logo, footer, unsubscribe link) |
| 5.M.19 | `EmailService` with BullMQ queue, retry, `EmailDeliveryLog` |
| 5.M.20 | Daily digest aggregation + send job |
| 5.M.21 | Unsubscribe endpoint + confirmation page |
| 5.M.22 | Admin panel → Email → delivery log + retry UI |
| 5.M.23 | Notification cleanup cron job (90-day retention) |
