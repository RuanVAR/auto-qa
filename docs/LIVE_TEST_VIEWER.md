# Live Test Viewer

## Overview

The Live Test Viewer streams the Playwright-controlled browser directly into the QA Platform UI in real time. When a feature run is started:

- **Automated mode** — the right panel shows a live canvas rendering of the browser, scrolling and clicking in front of the user as each step executes.
- **Manual mode** — the left panel shows a live preview of the app under test, while the right panel presents the step-by-step checklist. The user can collapse the preview to full-screen when needed.

This gives every team member visibility into what the automation is actually doing, and gives manual testers a persistent view of the app without needing to manage a separate window.

---

## Architecture — Streaming Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  WORKER (Node.js / BullMQ)                                       │
│                                                                  │
│  Playwright Page                                                 │
│       │                                                          │
│       │  context.newCDPSession(page)                             │
│       ▼                                                          │
│  CDP Session                                                     │
│       │  Page.startScreencast({ format: 'jpeg',                  │
│       │    quality: 80, maxWidth: 1280, maxHeight: 800 })        │
│       │                                                          │
│       │  on('Page.screencastFrame', frame => {                   │
│       │    redis.publish(`screencast:${sessionId}`, {            │
│       │      data: frame.data,        // base64 JPEG             │
│       │      sessionId: frame.sessionId                          │
│       │    })                                                     │
│       │    cdp.send('Page.screencastFrameAck', {                 │
│       │      sessionId: frame.sessionId })                       │
│       │  })                                                      │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │  Redis pub/sub
                          │  channel: screencast:{featureRunId}
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  API SERVER (NestJS / Socket.io)                                  │
│                                                                  │
│  ScreencastGateway                                               │
│       │  subscribeToScreencast(featureRunId)                     │
│       │    redis.subscribe(`screencast:${featureRunId}`)         │
│       │    on message → io.to(roomId).emit('screencast:frame',   │
│       │                   { data, timestamp })                   │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │  Socket.io (WebSocket)
                          │  event: screencast:frame
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  BROWSER (React / Canvas API)                                    │
│                                                                  │
│  LiveBrowserCanvas component                                     │
│       │  socket.on('screencast:frame', ({ data }) => {          │
│       │    const img = new Image()                               │
│       │    img.src = `data:image/jpeg;base64,${data}`           │
│       │    img.onload = () => ctx.drawImage(img, 0, 0)          │
│       │  })                                                      │
└─────────────────────────────────────────────────────────────────┘
```

### Why Canvas over `<img>` tag

| Approach | Flicker | CPU | Smoothness |
|----------|---------|-----|------------|
| `<img src=data:...>` update | High (decode + layout repaint per frame) | Higher | Choppy |
| `<canvas> ctx.drawImage()` | None (decoded off-screen, single blit) | Lower | Smooth 30fps |
| `<video>` + MediaSource | None | Lowest | Smoothest |

Canvas `drawImage()` is used. The video/MSE approach requires WebM/H.264 encoding in the worker, which adds complexity and latency without meaningful benefit at ≤30fps.

### Why Redis pub/sub (not direct WebSocket from worker)

- Workers are stateless BullMQ consumers — they may run on different machines than the API server.
- Redis pub/sub decouples worker instances from Socket.io rooms.
- The API gateway subscribes once per active `featureRunId` room and fans out to all browser tabs watching that run.
- When the run ends, the gateway unsubscribes and the Redis channel goes idle.

---

## Worker Implementation

### Starting the screencast

```typescript
// apps/worker/src/execution/screencast.service.ts

import { CDPSession } from 'playwright';

export class ScreencastService {
  private cdpSession: CDPSession | null = null;
  private frameCount = 0;

  async start(
    page: playwright.Page,
    featureRunId: string,
    redis: Redis,
  ): Promise<void> {
    this.cdpSession = await page.context().newCDPSession(page);

    await this.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: 1280,
      maxHeight: 800,
      everyNthFrame: 1,
    });

    this.cdpSession.on('Page.screencastFrame', async (event) => {
      this.frameCount++;

      // Publish frame to Redis — API gateway fans it out to Socket.io rooms
      await redis.publish(
        `screencast:${featureRunId}`,
        JSON.stringify({
          data: event.data,           // base64 JPEG
          timestamp: Date.now(),
          frameNumber: this.frameCount,
        }),
      );

      // MUST ack every frame or CDP stops sending
      await this.cdpSession!.send('Page.screencastFrameAck', {
        sessionId: event.sessionId,
      });
    });
  }

  async stop(): Promise<void> {
    if (this.cdpSession) {
      await this.cdpSession.send('Page.stopScreencast');
      this.cdpSession = null;
    }
  }
}
```

### Integration with the feature runner

```typescript
// apps/worker/src/execution/feature-runner.service.ts

async runFeature(featureRunId: string, job: Job): Promise<void> {
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Start streaming frames to Redis
  await this.screencastService.start(page, featureRunId, this.redis);

  try {
    for (const testRun of testRuns) {
      await this.runTestCase(page, testRun);
    }
  } finally {
    // Always stop screencast before closing browser
    await this.screencastService.stop();
    await browser.close();
  }
}
```

> **Headless streaming note:** `Page.startScreencast` works in headless Chromium. The
> browser renders off-screen and CDP captures each paint cycle. No display server required.

---

## API Gateway Implementation

```typescript
// apps/api/src/gateways/screencast.gateway.ts

@WebSocketGateway({ namespace: '/screencast', cors: true })
export class ScreencastGateway implements OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // featureRunId → Redis subscriber instance
  private subscribers = new Map<string, ReturnType<Redis['duplicate']>>();

  @SubscribeMessage('watch:run')
  async onWatchRun(
    @MessageBody() { featureRunId }: { featureRunId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const room = `run:${featureRunId}`;
    client.join(room);

    // Subscribe to Redis only once per run (idempotent)
    if (!this.subscribers.has(featureRunId)) {
      const sub = this.redis.duplicate();
      await sub.subscribe(`screencast:${featureRunId}`);

      sub.on('message', (_channel, message) => {
        const frame = JSON.parse(message);
        this.server.to(room).emit('screencast:frame', frame);
      });

      this.subscribers.set(featureRunId, sub);
    }
  }

  @SubscribeMessage('unwatch:run')
  async onUnwatch(
    @MessageBody() { featureRunId }: { featureRunId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`run:${featureRunId}`);
    await this.cleanupIfEmpty(featureRunId);
  }

  handleDisconnect(client: Socket) {
    // Leave all rooms on disconnect; clean up any empty subscriptions
    for (const [featureRunId] of this.subscribers) {
      client.leave(`run:${featureRunId}`);
      this.cleanupIfEmpty(featureRunId);
    }
  }

  private async cleanupIfEmpty(featureRunId: string) {
    const room = this.server.sockets.adapter.rooms.get(`run:${featureRunId}`);
    if (!room || room.size === 0) {
      const sub = this.subscribers.get(featureRunId);
      if (sub) {
        await sub.unsubscribe();
        sub.disconnect();
        this.subscribers.delete(featureRunId);
      }
    }
  }
}
```

---

## Frontend — LiveBrowserCanvas Component

```tsx
// apps/web/src/components/player/LiveBrowserCanvas.tsx

import { useEffect, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';

interface Props {
  featureRunId: string;
  width?: number;
  height?: number;
}

export function LiveBrowserCanvas({ featureRunId, width = 1280, height = 800 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { socket } = useSocket('/screencast');

  useEffect(() => {
    if (!socket || !featureRunId) return;

    socket.emit('watch:run', { featureRunId });

    const handleFrame = ({ data }: { data: string; timestamp: number }) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = `data:image/jpeg;base64,${data}`;
    };

    socket.on('screencast:frame', handleFrame);

    return () => {
      socket.emit('unwatch:run', { featureRunId });
      socket.off('screencast:frame', handleFrame);
    };
  }, [socket, featureRunId]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="w-full h-full rounded-lg bg-gray-900 border border-gray-700"
      style={{ aspectRatio: `${width}/${height}` }}
    />
  );
}
```

### Idle / historical state

When no run is active, the canvas area is replaced with the **last run result panel**:

```tsx
{activeFeatureRunId ? (
  <LiveBrowserCanvas featureRunId={activeFeatureRunId} />
) : (
  <HistoricalRunPanel featureId={featureId} />
)}
```

The `HistoricalRunPanel` shows the most recent completed run with pass/fail badges, step timeline, AI summary, and selector heal warnings.

---

## Automated Mode — Full Player Layout

```
┌──────────────────────────┬────────────────────────────────────────┐
│  Feature: Login Flow     │  ┌────────────────────────────────────┐ │
│  ─────────────────────   │  │                                    │ │
│  Test Cases              │  │   LIVE BROWSER                     │ │
│  ✅ Login success        │  │   (Canvas — 1280×800)              │ │
│  ⟳  Login invalid  ← now │  │                                    │ │
│  ─  Password reset       │  │   [browser rendering live here]    │ │
│  ─  OAuth login          │  │                                    │ │
│  ─  Session expire       │  └────────────────────────────────────┘ │
│                          │                                          │
│  Environment             │  Step 3 of 7 — FILL email field         │
│  [ Staging        ▼ ]    │  ████████████░░░░░░  3/7               │
│                          │                                          │
│  ⏸ Pause   ⏹ Stop       │  ┌─ Step log ───────────────────────┐  │
│                          │  │ ✅ 1. Navigate to /auth/login     │  │
│  AI Summary              │  │ ✅ 2. Assert page title visible   │  │
│  ─────────────────────   │  │ ⟳  3. Fill email input field...  │  │
│  (shown after run)       │  │ ─  4. Fill password field         │  │
└──────────────────────────┴──└───────────────────────────────────┘──┘
```

---

## Automated Mode — Step Failure Actions

When a step fails, the player pauses and the failure panel appears **inline** below the canvas:

```
┌────────────────────────────────────────────────────────────────┐
│  ❌ Step 3 FAILED — Fill email input field                      │
│  Selector: #email  →  Element not found                         │
│                                                                 │
│  AI: "The email input appears to use class .login-email         │
│  in the current build. Selector #email was not found."          │
│                                                                 │
│  ┌──────── Actions ─────────────────────────────────────────┐  │
│  │  [ 💬 Add Comment ]  [ ⏭ Skip Step ]  [ ⏭ Skip Test ]   │  │
│  │  [ 🐛 Create Jira Ticket ]  [ 📣 Notify Slack/Teams ]    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [ ▶ Retry Step ]   [ ⏹ Abort Run ]                           │
└────────────────────────────────────────────────────────────────┘
```

### Action: Add Comment

- Opens an inline text field
- Tester types a note (e.g. "This selector changed in the last deploy")
- Comment is saved to `RunStep.manualNotes`
- After saving, run continues to next step automatically

### Action: Skip Step

- Marks current step as `SKIPPED` (new status variant)
- Moves immediately to the next step within the same test case
- Run continues; skipped steps appear in the report with the comment

### Action: Skip Test

- Marks the current `TestRun` as `SKIPPED`
- Moves to the first step of the next test case in the feature
- Does not abort the entire feature run

### Action: Create Jira Ticket

- Opens an inline Jira creation panel (if Jira integration is configured)
- Pre-populated fields:
  - **Summary:** `[QA] {TestDefinition.name} — Step {stepIndex} failed: {step.name}`
  - **Description:** AI failure explanation + step details
  - **Attachments:** screenshot at point of failure (auto-attached)
  - **Labels:** `qa-automated`, `regression`
  - **Priority:** derived from feature module (configurable default)
- User can edit any field before submitting
- On submit: Jira issue key returned, linked to `RunStep` record

### Action: Notify Slack / Teams

- If a Slack or Teams integration is configured, sends an immediate notification
- Message includes:
  - Feature run link
  - Step name and failure reason
  - AI explanation snippet
  - Screenshot thumbnail (as attachment / image block)
- Does not wait for run completion — fires immediately on the failed step
- Separate from the end-of-run report notification rule

### Action: Retry Step

- Re-attempts the failed step (up to `config.retries` limit, or one manual retry regardless)
- If a selector heal occurred on retry, surfaces the `SelectorHeal` inline

### Action: Abort Run

- Marks the `FeatureRun` as `ABORTED`
- Stops the BullMQ job
- No further notifications fire (unless "notify on abort" rule is set)

---

## Manual Mode — Player Layout

In manual mode **there is no Playwright running**. The tester is the automation. The left panel shows the real app in an `<iframe>` — the tester navigates it directly as they would in any browser. The right panel shows the step checklist.

```
┌──────────────────────────────┬──────────────────────────────────┐
│  [ Hide Preview ]            │  Manual Testing                   │
│                              │  ──────────────────────────────  │
│  ┌────────────────────────┐  │  Current: Login success           │
│  │                        │  │  Step 2 of 5                      │
│  │  <iframe>              │  │                                   │
│  │  https://staging.app   │  │  ┌──────────────────────────────┐ │
│  │                        │  │  │ Step 2 · FILL                │ │
│  │  (live interactive     │  │  │ Fill the email input field   │ │
│  │   app — zero latency)  │  │  │ Value: qa@test.com           │ │
│  │                        │  │  └──────────────────────────────┘ │
│  └────────────────────────┘  │                                   │
│                              │  Notes (optional):                │
│  [ ⛶ Open in New Tab ]      │  ┌──────────────────────────────┐ │
│  [ ⛶ Full Screen ]          │  │                              │ │
│                              │  └──────────────────────────────┘ │
│                              │                                   │
│                              │  [ 📎 Upload Screenshot ]         │
│                              │                                   │
│                              │  [ ❌ Fail ]    [ ✅ Pass ]       │
└──────────────────────────────┴──────────────────────────────────┘
```

### Preview panel — iframe with graceful fallback

The tester's app is just a URL (`environment.baseUrl`). No Playwright, no streaming — the iframe renders it directly.

```tsx
// ManualPreviewPanel.tsx
function ManualPreviewPanel({ baseUrl }: { baseUrl: string }) {
  const [embedBlocked, setEmbedBlocked] = useState(false);

  if (embedBlocked) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-400">
        <p>This app cannot be embedded (X-Frame-Options / CSP policy).</p>
        <a href={baseUrl} target="_blank" rel="noopener noreferrer"
           className="btn-primary">
          Open app in new tab →
        </a>
        <p className="text-sm">Keep this tab open for the step checklist.</p>
      </div>
    );
  }

  return (
    <iframe
      src={baseUrl}
      className="w-full h-full rounded border border-gray-700"
      onError={() => setEmbedBlocked(true)}
      // Note: X-Frame-Options violations don't fire onError in all browsers.
      // The environment can have embedAllowed: false to skip the iframe attempt entirely.
    />
  );
}
```

| Environment type | Preview |
|-----------------|---------|
| App with permissive headers | `<iframe>` — live, fully interactive, zero latency |
| App with `X-Frame-Options: DENY` | "Open in new tab" button — tester works in side-by-side windows |
| `embedAllowed: false` on Environment config | Skip iframe attempt, show "Open in new tab" directly |
| Mobile / physical device | No preview — tester uses their own device |

> **Key insight:** In manual mode the tester IS the browser. The platform's job is just to
> display the step checklist and record results. The iframe is a convenience — not a requirement.
> "Open in new tab" is a perfectly valid workflow.

### Full-screen mode

Clicking **⛶ Full Screen** hides the left panel entirely:

```
┌──────────────────────────────────────────────────────────────────┐
│  [ ◧ Show Preview ]   Step 2 of 5 — Fill email field            │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Step 2 · FILL                                            │   │
│  │ Fill the email input field with: qa@test.com             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Notes:  [                                               ]       │
│  [ 📎 Upload Screenshot ]                                        │
│  [ ❌ Fail ]                                    [ ✅ Pass ]      │
└──────────────────────────────────────────────────────────────────┘
```

Layout preference is persisted in `localStorage` so it survives page refresh.

---

## Manual Mode — Step Failure Actions

When the tester clicks **❌ Fail**, the same action panel appears (adapted for manual context):

```
┌──────────────────────────────────────────────────────────────┐
│  Step marked FAILED — Fill email input field                  │
│                                                               │
│  ┌──────── Actions ──────────────────────────────────────┐   │
│  │  [ 💬 Add Comment ]  [ ⏭ Next Step ]  [ ⏭ Next Test ] │   │
│  │  [ 🐛 Create Jira Ticket ]  [ 📣 Notify Slack/Teams ]  │   │
│  └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

The **Add Comment** and **Create Jira Ticket** flows are identical to automated mode. Screenshots uploaded via **📎 Upload Screenshot** are attached to the Jira ticket automatically if the ticket is created on the same step.

---

## Jira Ticket Creation — Detail

### Prerequisites
- Project has a Jira integration configured (server URL, API token, project key)
- Integration is enabled on the project's Integrations page

### Payload sent to Jira REST API

```json
{
  "fields": {
    "project": { "key": "QA" },
    "summary": "[QA] Login Flow — Step 3 failed: Fill email input field",
    "description": {
      "type": "doc",
      "version": 1,
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "**AI Failure Analysis:**\nThe email input appears to use class .login-email in the current build. Selector #email was not found." }]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "**Step details:**\nType: FILL\nSelector: #email\nValue: qa@test.com\nRun ID: run_abc123\nEnvironment: Staging" }]
        },
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "**Run link:** https://qa-platform.company.com/features/feat_xyz/runs/run_abc123" }]
        }
      ]
    },
    "issuetype": { "name": "Bug" },
    "labels": ["qa-automated", "regression"],
    "priority": { "name": "Medium" }
  }
}
```

Screenshot attachment is uploaded separately via `POST /rest/api/3/issue/{issueKey}/attachments`.

### Inline Jira creation panel (in player)

```
┌────────────────────────────────────────────────────┐
│  Create Jira Ticket                                 │
│                                                     │
│  Summary:                                           │
│  [QA] Login Flow — Step 3 failed: Fill email...    │
│                                                     │
│  Type:    [ Bug        ▼ ]                          │
│  Priority:[ Medium     ▼ ]                          │
│  Labels:  [ qa-automated  ] [ regression  ] [+]    │
│                                                     │
│  Description: (AI-generated, editable)              │
│  ┌────────────────────────────────────────────────┐ │
│  │ AI Failure Analysis:                           │ │
│  │ The email input appears to use class...        │ │
│  └────────────────────────────────────────────────┘ │
│                                                     │
│  Attachments: ✅ failure-screenshot.png             │
│                                                     │
│  [ Cancel ]                    [ Create Ticket ]   │
└────────────────────────────────────────────────────┘
```

After creating: **JIRA-1234** badge appears on the `RunStep` row in the run detail view, linking directly to the Jira issue.

---

## Slack / Teams — Immediate Step Failure Notification

When **📣 Notify** is triggered from the failure panel, a targeted message fires immediately (not waiting for run end).

### Slack Block Kit message

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "❌ Test Step Failed" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Feature:*\nLogin Flow" },
        { "type": "mrkdwn", "text": "*Step:*\nStep 3 — Fill email input field" },
        { "type": "mrkdwn", "text": "*Environment:*\nStaging" },
        { "type": "mrkdwn", "text": "*Run Mode:*\nAutomated" }
      ]
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*AI Analysis:*\nThe email input appears to use `.login-email` in the current build. Selector `#email` was not found." }
    },
    {
      "type": "image",
      "title": { "type": "plain_text", "text": "Screenshot at failure" },
      "image_url": "https://qa-platform.company.com/artifacts/screenshot_abc.png?token=...",
      "alt_text": "Screenshot at point of failure"
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "View Run" }, "url": "https://qa-platform..." },
        { "type": "button", "text": { "type": "plain_text", "text": "View Jira Ticket" }, "url": "https://company.atlassian.net/browse/QA-1234" }
      ]
    }
  ]
}
```

### Teams Adaptive Card

```json
{
  "type": "AdaptiveCard",
  "body": [
    { "type": "TextBlock", "text": "❌ Test Step Failed", "weight": "Bolder", "size": "Medium" },
    { "type": "FactSet", "facts": [
      { "title": "Feature", "value": "Login Flow" },
      { "title": "Step", "value": "Step 3 — Fill email input field" },
      { "title": "Environment", "value": "Staging" }
    ]},
    { "type": "TextBlock", "text": "AI: The email input appears to use `.login-email`...", "wrap": true },
    { "type": "Image", "url": "https://qa-platform.company.com/artifacts/screenshot_abc.png?token=..." }
  ],
  "actions": [
    { "type": "Action.OpenUrl", "title": "View Run", "url": "https://qa-platform..." },
    { "type": "Action.OpenUrl", "title": "View Jira Ticket", "url": "https://company.atlassian.net/browse/QA-1234" }
  ]
}
```

---

## Performance Considerations

### Frame rate vs bandwidth

| Quality setting | Frame size (approx) | Bandwidth @ 30fps |
|----------------|--------------------|--------------------|
| JPEG quality 80, 1280×800 | ~60–100 KB | ~2.4–3 Mbps |
| JPEG quality 60, 1280×800 | ~30–50 KB | ~1.2–1.5 Mbps |
| JPEG quality 60, 960×600  | ~18–30 KB | ~0.7–0.9 Mbps |

Default config: **quality 80, 1280×800** — suitable for LAN / fast internet. Project config can override.

### Frame rate adaptive throttling

The worker tracks how fast Redis `publish` calls succeed. If the round-trip time exceeds 200ms, `everyNthFrame` is increased from 1 to 2 (halving frame rate to 15fps) to reduce backpressure. This keeps the stream playable under moderate network load.

### Multiple watchers

Multiple browser tabs can watch the same run simultaneously. The API gateway subscribes to Redis once per `featureRunId` and fans out to all members of the Socket.io room — Redis receives only one copy of each frame regardless of viewer count.

### Memory — `screencastFrameAck`

CDP will not deliver the next frame until `Page.screencastFrameAck` is sent for the current one. This creates natural back-pressure: the worker cannot flood Redis faster than it can publish. If Redis is unavailable, frames are dropped (not queued) to prevent memory growth.

---

## Data Model Additions

```prisma
model FeatureRun {
  // existing fields...
  screencastEnabled Boolean @default(true)
}

model RunStep {
  // existing fields...
  manualNotes String?      // free-text tester notes (manual mode)
  jiraIssueKey String?     // e.g. "QA-1234" — set when ticket created from player
  status      RunStepStatus
}

enum RunStepStatus {
  PENDING
  RUNNING
  PASSED
  FAILED
  SKIPPED    // ← new: tester/operator skipped this step
  ABORTED    // ← new: run was aborted mid-step
}
```

---

## Configuration

### Per-feature screencast config

```json
{
  "config": {
    "browser": "chromium",
    "headless": true,
    "screencast": {
      "enabled": true,
      "quality": 80,
      "maxWidth": 1280,
      "maxHeight": 800
    }
  }
}
```

### Environment variable

```
SCREENCAST_ENABLED=true          # platform-wide default (can be overridden per feature)
SCREENCAST_QUALITY=80            # JPEG quality 1–100
SCREENCAST_MAX_WIDTH=1280
SCREENCAST_MAX_HEIGHT=800
```

---

## Where This Fits in the Implementation Plan

This is **Phase 3.1** in `IMPLEMENTATION_PLAN.md` — Live Test Viewer. It depends on:

- Phase 3.0 (Feature Player base) — FeatureRun state machine and WebSocket foundation
- Phase 2.0.4 (AI Execution Engine) — failure explanations surfaced in the failure panel
- Phase 5.3 (Notifications) — Slack/Teams/Jira integrations reused by the inline action panel

The core screencast pipeline (worker → Redis → Socket.io → Canvas) can be built standalone.
Jira/Slack/Teams actions reuse integration plugins already built for Phase 5.3.
