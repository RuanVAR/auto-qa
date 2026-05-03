# Manual Testing Mode

## Overview

The Feature Player supports two modes: **Automated** and **Manual**.

- **Automated** — the platform executes tests using Playwright (or API/Shell runners). No human involvement during execution.
- **Manual** — the platform walks the tester through each test case step-by-step as a checklist. The tester performs each action themselves and marks steps pass or fail with optional notes and screenshots.

Manual mode is useful for:
- Verifying exploratory or hard-to-automate scenarios
- Acceptance testing before a release
- QA sign-off flows where a human must verify outcomes
- Testing on physical devices or environments the automation cannot reach

Manual runs appear in run history alongside automated runs and trigger the same notification rules (email reports, Slack alerts, Jira tickets) on completion.

---

## Feature Player — Mode Toggle

The mode toggle sits at the top of the Feature Player:

```
┌─────────────────────────────────────────────────────────────┐
│  Feature: Login Flow          [ Automated ] [ Manual ]      │
│  Authentication · My App                                     │
└─────────────────────────────────────────────────────────────┘
```

Selecting **Manual** switches the right panel to a step-by-step checklist instead of the live browser viewer.

---

## Manual Mode — Player Layout

```
┌──────────────────────────┬──────────────────────────────────┐
│  Feature: Login Flow     │  Manual Testing                  │
│  ─────────────────────   │  ──────────────────────────────  │
│  Manual mode active      │  Current: Login with valid       │
│                          │  credentials — Step 2 of 5       │
│  1. Login success  ⟳     │                                  │
│  2. Login invalid  —     │  ┌─────────────────────────────┐ │
│  3. Password reset —     │  │ Step 2 · FILL               │ │
│  4. OAuth login    —     │  │ Fill the email input field   │ │
│  5. Session expire —     │  │ Selector: #email             │ │
│                          │  │ Value: qa@test.com           │ │
│  Environment             │  └─────────────────────────────┘ │
│  [ Staging        ▼ ]    │                                  │
│                          │  Notes (optional):               │
│  [ ▶ Start Manual ]      │  ┌─────────────────────────────┐ │
│                          │  │                             │ │
│                          │  └─────────────────────────────┘ │
│                          │                                  │
│                          │  [ 📎 Upload Screenshot ]        │
│                          │                                  │
│                          │  [ ❌ Fail ]    [ ✅ Pass ]      │
└──────────────────────────┴──────────────────────────────────┘
```

---

## Manual Test Flow

```
Tester clicks "Start Manual"
        ↓
System creates TestRun records { runMode: MANUAL, status: PENDING }
No BullMQ job is enqueued — no automation runs
        ↓
First test case opens in right panel
First step is shown as a checklist card
        ↓
Tester reads the step instruction
Performs the action manually in their browser/device
        ↓
Tester clicks [ ✅ Pass ] or [ ❌ Fail ]
Optionally adds notes + uploads a screenshot
        ↓
System records the step result:
  RunStep { status: PASSED/FAILED, manualNotes, screenshot }
        ↓
Auto-advances to next step
        ↓
When all steps in a test case are marked:
  → TestRun status set to PASSED or FAILED
  → Left panel shows result badge
  → AI writes a brief summary (same as automated)
  → Moves to next test case automatically
        ↓
When all test cases are complete:
  → FeatureRun marked COMPLETE
  → Notifications fire (same rules as automated)
  → "Send Report" / "Create Ticket" buttons appear
```

---

## Step Checklist Card

Each step is displayed as a human-readable instruction:

| Step type | What is shown to tester |
|-----------|------------------------|
| `NAVIGATE` | "Go to: /auth/login" |
| `FILL` | "Fill the **email** field with: `qa@test.com`" |
| `CLICK` | "Click: **Submit button** (`.btn-login`)" |
| `ASSERT_TEXT` | "Verify that the page shows: **Welcome back**" |
| `ASSERT_URL` | "Verify that the URL is: **/dashboard**" |
| `ASSERT_VISIBLE` | "Verify that this element is visible: `.user-avatar`" |
| `REQUEST` (API) | "Send POST to `/api/auth/login` and verify status 200" |
| `COMMAND` (Shell) | "Run: `pm2 status` and verify output contains `online`" |
| `SCREENSHOT` | "Take a screenshot of the current state (optional for manual)" |
| `WAIT` | "Wait **2 seconds** before proceeding" |

---

## Run History

Manual runs appear in run history with a `MANUAL` badge:

```
┌────────────────────────────┬──────────┬──────────┬──────────┐
│ Test                       │ Mode     │ Status   │ Date     │
├────────────────────────────┼──────────┼──────────┼──────────┤
│ Login Flow                 │ AUTO     │ ✅ PASSED │ 14 Apr   │
│ Login Flow                 │ MANUAL   │ ❌ FAILED │ 13 Apr   │
│ Login Flow                 │ AUTO     │ ✅ PASSED │ 12 Apr   │
└────────────────────────────┴──────────┴──────────┴──────────┘
```

Manual runs are included in analytics, pass rate calculations, and trend charts. They are labelled separately so teams can distinguish automated vs human-verified results.

---

## Notifications

Manual runs trigger the same notification rules as automated runs:
- Email report fires on `FEATURE_RUN_FAILED` or `SCHEDULED_REPORT`
- Jira ticket created on `TEST_CASE_FAILED`
- Webhook fires with the same payload structure, with `"runMode": "MANUAL"` added

This means a manager receives the same email report whether the run was automated or manual.

---

## Data Model Changes

```prisma
enum RunMode { AUTOMATED MANUAL }

model TestRun {
  // existing fields...
  runMode   RunMode @default(AUTOMATED)
}

model RunStep {
  // existing fields...
  manualNotes String?   // tester's free-text notes (manual mode only)
}
```

Screenshots uploaded by the tester in manual mode are stored the same way as automated screenshots — as `Artifact` records linked to the `RunStep`.

---

## API Endpoints

```
# Start a manual feature run
POST /features/:featureId/run
Body: { runMode: "MANUAL", environmentId: "..." }
→ Creates FeatureRun + TestRun records, returns featureRunId
  Does NOT enqueue any BullMQ jobs

# Tester marks a step
PATCH /runs/:runId/steps/:stepId
Body: { status: "PASSED" | "FAILED", notes?: "...", screenshot?: <multipart file> }

# Tester completes a test case (called automatically when all steps marked)
POST /runs/:runId/complete

# Tester skips a test case
POST /runs/:runId/skip { reason?: "..." }
```

---

## Iframe Inline Preview

For web app features, the Manual Testing panel can optionally show an inline iframe of the target application alongside the step checklist. This lets testers execute steps without leaving the platform.

### Enabling the iframe

The inline iframe is shown when:
1. The selected environment has `baseUrl` set
2. The environment does **not** set `iframeDisabled: true`
3. The target application does not block iframe embedding via `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`

Layout with iframe enabled:

```
┌─────────────────────────────────┬──────────────────────────────────┐
│  Step Checklist                 │  Application Preview             │
│  ──────────────────────────     │  ──────────────────────────────  │
│  Step 2 · FILL                  │  ┌──────────────────────────┐   │
│  Fill the email input           │  │                          │   │
│  ─────────────────              │  │    [iframe: app here]    │   │
│  Notes: [              ]        │  │                          │   │
│  [ 📎 Upload Screenshot ]        │  └──────────────────────────┘   │
│  [ ❌ Fail ]  [ ✅ Pass ]        │  [ ↗ Open in New Tab ]          │
└─────────────────────────────────┴──────────────────────────────────┘
```

### Iframe Timeout Handling

The iframe is considered **timed out** if it does not load within 10 seconds. Detection:

```typescript
// In the React component — wrap iframe in a load detector
const [iframeState, setIframeState] = useState<'loading' | 'loaded' | 'timeout' | 'blocked'>('loading');

useEffect(() => {
  const timer = setTimeout(() => {
    if (iframeState === 'loading') setIframeState('timeout');
  }, 10_000);
  return () => clearTimeout(timer);
}, []);

function handleIframeLoad() {
  clearTimeout(timer);
  setIframeState('loaded');
}

function handleIframeError() {
  setIframeState('blocked');
}
```

**On timeout:** The iframe area shows:

```
  ⚠ Preview timed out
  The application did not load within 10 seconds.
  ┌────────────────────────────────────┐
  │  [ ↗ Open in New Tab ]            │
  │  [ ↺ Retry Preview ]              │
  │  [ ✕ Dismiss Preview ]            │
  └────────────────────────────────────┘
```

**On blocked (X-Frame-Options):** The iframe area shows:

```
  🚫 Preview blocked
  This application cannot be embedded in an iframe.
  ┌────────────────────────────────────┐
  │  [ ↗ Open in New Tab ]            │
  │  [ ✕ Dismiss Preview ]            │
  └────────────────────────────────────┘
```

In both cases the step checklist continues to work normally — the preview is purely a convenience feature.

Detecting `X-Frame-Options` reliably from a same-origin error is not possible in the browser. The platform instead performs a **pre-flight HEAD request** from the API server to `environment.baseUrl` and checks the response headers before rendering the iframe:

```typescript
// GET /api/v1/environments/:id/iframe-check
// Returns: { embeddable: boolean, reason?: string }
```

If `embeddable: false`, the iframe is not shown at all — only the "Open in New Tab" button is displayed.

### Open in New Tab Fallback

`[ ↗ Open in New Tab ]` opens `environment.baseUrl` in a new browser tab. The step checklist remains in the original tab. The tester executes steps in the new tab and marks pass/fail in the platform tab.

This is the **primary workflow** for manual testing — the inline iframe is a secondary convenience. The checklist is designed to be usable without the preview.

---

## Screenshot Evidence Upload

Testers can upload screenshots as evidence for any step (pass or fail).

### Upload UX

`[ 📎 Upload Screenshot ]` opens the system file picker. Accepted formats: PNG, JPG, WEBP, GIF (static only).

After selection, the file is shown as a thumbnail below the button:

```
  ┌─────────────────────────────────────┐
  │  📎 Upload Screenshot               │
  │                                     │
  │  ┌─────────────┐                   │
  │  │  [thumbnail] │  login-error.png  │
  │  │             │  482 KB           │
  │  └─────────────┘  [ ✕ Remove ]    │
  └─────────────────────────────────────┘
```

The file is **not uploaded until the step is marked** (Pass or Fail). When the tester clicks `[ ✅ Pass ]` or `[ ❌ Fail ]`, the screenshot is uploaded in the same request as the step status update.

Multiple screenshots per step are supported (max 5 per step). Each additional upload shows as a separate thumbnail row.

### File Size Limits

| Limit | Value |
|-------|-------|
| Max per file | 10 MB |
| Max per step | 5 files × 10 MB = 50 MB |
| Max per run | 200 MB total across all steps |

Exceeding per-file limit: toast error shown, file rejected before upload.

Exceeding per-run limit: further uploads blocked with message: _"Run evidence limit reached (200 MB). Remove existing screenshots to upload more."_

### Storage

Screenshots are stored in the same S3-compatible store as automated run artifacts:

```
artifacts/{orgId}/{featureRunId}/{testRunId}/manual-step-{stepIndex}-evidence-{n}.png
```

`RunStep.screenshotUrls` (array) stores all evidence URLs for a step. The run report renders these as a gallery in the step result row.

---

## Checklist Auto-Save

The tester's progress is auto-saved after every step mark. No data is lost if the browser is closed mid-session.

### How It Works

When a step is marked (Pass/Fail), the `PATCH /runs/:runId/steps/:stepId` call persists the result immediately. The `RunStep` record is updated in real-time.

If the tester closes the browser and returns, the Manual Testing UI restores their session:
- The `FeatureRun` record has `status: RUNNING` and `runMode: MANUAL`
- The already-completed steps show their saved results
- The cursor is positioned at the first incomplete step

The UI detects an in-progress manual session on load:

```typescript
// In the Feature Player, on mount:
const activeManaualRun = await api.get(`/features/${featureId}/runs/active-manual`);
if (activeManualRun) {
  setRestoredRun(activeManualRun);
  showBanner('You have an in-progress manual run — resume?');
}
```

Banner:

```
  ↺ In-progress manual run found (started 2h ago)
  [ Resume Run ]   [ Discard and Start New ]
```

Notes typed in the notes textarea are saved to `localStorage` as a draft on every keystroke (`debounced 500ms`) and synced to the server when the step is marked.

---

## Session Timeout and Abandonment

### Inactivity Warning

If the tester has not marked a step for **30 minutes**, the platform shows an in-app warning banner:

```
  ⏱ Manual session inactive for 30 minutes
  Your progress is saved. Continue testing or the session will expire in 30 minutes.
  [ Continue ]   [ End Session ]
```

### Session Expiry

If there is no activity for **60 minutes** total, the session is automatically abandoned:

1. `FeatureRun.status` → `ABANDONED` (new terminal status)
2. All `RunStep` records that are still `PENDING` → `SKIPPED`
3. Any `RUNNING` steps → `SKIPPED`
4. A notification is sent if the feature has an email notification rule configured: _"Manual testing session for [Feature] was abandoned due to inactivity."_

`ABANDONED` is a new value in the `RunStatus` enum alongside `ABORTED`.

### Forced End Session

The tester can click `[ End Session ]` at any time. This opens a confirmation dialog:

```
  End Manual Testing Session?

  Progress so far:
    ✅ 3 steps passed
    ❌ 1 step failed
    ○ 4 steps remaining

  Remaining steps will be marked as Skipped.

  [ Cancel ]   [ End Session ]
```

On confirm: same outcome as session expiry (ABANDONED + remaining steps SKIPPED), but initiated immediately.

### Activity Detection

Activity is tracked server-side via a heartbeat:

```typescript
// Frontend: sends heartbeat every 5 minutes while the Manual Testing panel is open
setInterval(() => {
  api.post(`/runs/${featureRunId}/heartbeat`);
}, 5 * 60 * 1000);
```

```typescript
// API: POST /api/v1/runs/:featureRunId/heartbeat
// Updates FeatureRun.lastHeartbeatAt = now()
```

The worker process has a scheduled job (runs every 5 minutes) that checks for manual runs where `lastHeartbeatAt < now - 60 minutes` and marks them as ABANDONED.

---

## Evidence in Reports

Manual test run reports include the uploaded screenshots in each step row:

```
Step 2 — FILL — Enter email        ✅ PASSED
  Notes: Used the staging test account (qa+staging@example.com)
  Evidence:
  [📷 step-2-evidence-1.png]  [📷 step-2-evidence-2.png]

Step 4 — CLICK — Submit login      ❌ FAILED
  Notes: Button was greyed out — could not click. Possible issue with form validation.
  Evidence:
  [📷 step-4-failure.png]
```

In the PDF report (generated by Puppeteer), evidence images are embedded at reduced resolution (max 800px wide) to keep file size reasonable.
