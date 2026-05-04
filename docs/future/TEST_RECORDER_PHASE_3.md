# Test Recorder — Phase 3: Coverage Expansion

> **Status:** Future / not committed
> **Prereqs:** `docs/TEST_RECORDER.md` MVP shipped + `docs/future/TEST_RECORDER_PHASE_2.md` largely shipped + clear demand for cross-origin / non-embeddable app coverage
> **Tentative phase:** Phase 9 or later
> **Decision check-in:** Re-evaluate after MVP + Phase 2 in production for 3+ months — only build Phase 3 if MVP friction is concentrated on cases Phase 3 solves

This doc captures the **coverage expansion layer**: getting the recorder to work on apps that the same-origin iframe approach can't reach.

---

## 3.1 Chrome Extension Recorder

**The problem in MVP and Phase 2:** anything that's not same-origin (or not iframe-friendly) can't be recorded properly. Production apps with strict CSP, OAuth flows that redirect to third-party domains, mobile-only flows tested in DevTools — all fall out.

**The fix:** browser extension that injects the recorder script via the extension's content script API — bypassing same-origin and X-Frame-Options entirely.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Chrome Extension                                                │
│  ┌──────────────────────────────┬─────────────────────────────┐ │
│  │  Background Service Worker   │  Content Script             │ │
│  │  - Auth handshake            │  - Injected into every page │ │
│  │  - WebSocket → platform API  │  - Same capture script      │ │
│  │  - Stores capture buffer     │  - Same selector engine     │ │
│  └──────────────────────────────┴─────────────────────────────┘ │
│                                                                  │
│  Browser Action (toolbar icon)                                   │
│  - "Start Recording on this tab"                                 │
│  - Live step count badge                                         │
│  - Stop / Save                                                   │
└──────────────────────────────────────────────────────────────────┘
                          ↓ WebSocket / postMessage
┌──────────────────────────────────────────────────────────────────┐
│  Platform Recorder Page (in another tab)                         │
│  - Same UI as MVP                                                │
│  - Receives steps from extension                                 │
│  - Save flow unchanged                                           │
└──────────────────────────────────────────────────────────────────┘
```

### How auth works

- User signs into platform in one tab
- Clicks "Connect extension" → platform issues short-lived JWT
- Extension stores JWT + opens WebSocket to platform with it
- Capture events stream over WebSocket

### Selector strategy

Same as MVP, but content script can also access:
- The page's source DOM via the extension API
- Network requests via `chrome.webRequest`
- iframes the page contains via the extension's content script (auto-injected into all frames)

### Distribution

- Listed on Chrome Web Store
- Auto-update via Chrome's mechanism
- Firefox version via Web Extensions API (mostly compatible)

### Effort

~3-4 weeks for the extension + ~1 week for platform-side handshake + ~1 week for store submission cycle (review takes 1-2 weeks externally). **Total: ~5-6 weeks elapsed.**

> **Open question:** Manifest v2 vs v3? v3 is mandatory now. Service workers replace background pages — capture buffer storage needs IndexedDB.

> **Open question:** Safari (WebKit) extension? Different store, different review. Defer until paid users ask.

> **Open question:** how much do we charge for this (or is it included free)? Distribution / support cost is non-trivial — may be a Pro tier feature.

---

## 3.2 Server-Side Playwright-Driven Recorder via CDP

**The problem:** some apps absolutely cannot be touched from the user's browser (corporate apps behind VPN, embedded mobile testing, apps that detect automation). User wants to record but the platform's machine is the only one with access.

**The fix:** reverse the existing CDP screencast pipeline. Instead of streaming frames OUT to the user, accept input events IN from the user.

### Architecture

```
[User in their browser]                    [Platform worker]
                                            ┌──────────────┐
   ⌨ types/clicks  ────────────────────►   │  Playwright  │
                                            │   Browser    │
       ◄────  CDP screencast frames        │   (headed)   │
                                            └──────────────┘
                                            CDP captures every
                                            DOM interaction +
                                            generates TestSteps
```

- User opens the recorder page → platform spins up a Playwright browser on a worker
- CDP `Page.startScreencast` streams frames to user's canvas (existing `LIVE_TEST_VIEWER.md` infra)
- User's keyboard and mouse events on the canvas are sent via WebSocket → CDP `Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`
- Playwright records via its codegen mechanism + emits to our step format

### Use cases

- **Mobile testing**: user records on a virtual mobile device emulated in the platform
- **VPN-only apps**: platform's worker is on the VPN; user records from anywhere
- **Anti-automation apps**: bot-detection might fire; user can solve CAPTCHAs that appear via the canvas

### Effort

~4-6 weeks. The hard parts:
- Latency tuning — clicks must feel instant despite cross-network round-trip
- Concurrency — each recording session ties up a browser instance (cost: ~$0.05/hr)
- Mobile emulation — iOS Safari can't be Playwright'd, only WebKit
- Canvas input handling — pixel coords need to map to viewport coords accurately

> **Open question:** can we share the existing `apps/worker` Playwright pool, or does this need a separate "interactive worker" pool? Lean: separate, since interactive sessions tie up browsers indefinitely vs short test runs.

---

## 3.3 File Upload Capture

**The problem in MVP:** when user clicks a file input during recording, browser opens native file picker. We can't see what file was selected (security boundary). Step is recorded as an unusable `CLICK` on the input.

**The fix:** intercept the click, prompt the user via platform UI:

```javascript
fileInput.addEventListener('click', (e) => {
  e.preventDefault();
  channel.send('upload-prompt', { selector: ... });
});

// In recorder UI:
// Modal: "What file should this step upload?"
//   [Drag file here]
//   [Or browse from this project's test fixtures...]
//   [Or use a placeholder for runtime selection]
```

User chooses:
- **Drag a file** → uploaded to platform's artifact store; step records `storageKey`; replay reads from storage and uploads to the form
- **Use test fixture** → reference an existing fixture in project's `TestData` collection
- **Runtime placeholder** → step records `{{TEST_FIXTURE_FILE_X}}`; user provides at run time

### Tech

- New step type `UPLOAD_FILE` added to STEP_DEFINITION_SPEC
- Capture script intercepts `click` on `input[type=file]`
- Recorder UI modal handles file ingestion
- Executor handles file upload via Playwright's `setInputFiles()`

### Effort

~2 weeks.

> **Open question:** size limits for uploaded fixtures? 10 MB seems sensible (matches screenshot limits). Larger files → user-provided cloud URLs.

---

## 3.4 Cypress Studio-Style "Edit Existing Test" Recorder Mode

**The problem:** user has a 30-step test, the 17th step broke when the app changed. They want to "replay until step 16, then re-record from there." Currently they have to re-record from scratch or hand-edit step 17.

**The fix:** "Edit in Recorder" action on TestCase opens the recorder in playback-then-record mode:

1. Recorder loads test, plays steps 1-16 in the iframe (using existing executor)
2. At step 16 success, switches to record mode
3. User performs new step 17, 18, ...
4. Old steps 17+ either:
   - **Replaced** by new recording (default)
   - **Inserted before** old steps (insertion mode toggle)
5. Save → updated TestCase

### Tech

- Recorder gains a "playback engine" — runs the existing executor in the user's browser (or in a worker streamed back via screencast)
- Right pane uses CDP screencast during playback, then switches to live iframe at step 17
- Diff view on save: original vs new

### Effort

~4 weeks. Significant — this needs a working in-browser playback path.

> **Open question:** can we reuse the worker's executor entirely (CDP path), or do we need a lightweight in-browser executor? Worker reuse is simpler but requires keeping a browser session open.

---

## 3.5 Mobile Recording (Real Devices)

**The far-future use case:** record on real iPhones / real Androids via device farm integration (BrowserStack, Sauce Labs, Appium).

This is genuinely huge effort and probably never makes sense for our platform unless we go mobile-first. **Cataloged here only so we don't reinvent it later.**

---

## 3.6 Cross-Browser Recording (Firefox / Safari)

MVP records in any browser the user is using. Extension Phase covers Chrome + Firefox. Safari needs a separate WebKit extension. **Defer until paid users specifically request.**

---

## 3.7 Roll-up

**Phase 3 estimated total:** ~12-16 weeks if all sections are built. Most users will never need most of Phase 3 — pick based on actual demand, not aesthetics.

**Likely highest-value if any of these become priorities:**
1. §3.3 file upload capture — small effort, common request
2. §3.4 edit-in-recorder mode — biggest workflow improvement for power users
3. §3.1 Chrome extension — unlocks the cases the iframe approach can't reach

**Likely defer indefinitely:**
- §3.2 server-side CDP recorder — too much infra cost; users with corporate VPNs are usually OK with manual scripts
- §3.5 mobile recording — out of platform scope

---

## 3.8 What might make all of Phase 3 unnecessary

Two scenarios that would change the calculus:

1. **Browser becomes recorder-friendly.** If Chrome adds a native "Record interactions" Web Standard API (rumored for years, never delivered), much of §3.1 becomes free.
2. **Agentic AI takes over.** If our Phase 8 agentic testing matures to the point where users describe a flow in natural language and the agent autonomously generates AND validates the test, the recorder becomes a niche tool only used for visual verification. Phase 3 gets smaller proportionally.

Worth re-checking the roadmap every 6 months — both of these are plausibly 1-2 years out.
