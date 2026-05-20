# QA Platform Recorder — Chrome Extension

Records UI interactions on **any** website (including ones that block iframes
via `X-Frame-Options`) and streams them as Playwright-style test steps to the
QA Platform in real time.

This replaces the old iframe-based recorder, which silently dropped every
captured step when used against cross-origin sites because `BroadcastChannel`
is same-origin only.

## Architecture

```
┌─────────────────┐                                ┌─────────────────┐
│  Content script │ ◄──── chrome.runtime ────►     │   Background    │
│  (target page)  │                                │ service worker  │
└─────────────────┘                                └────────┬────────┘
                                                            │ Socket.IO
                                                            ▼
                                              ┌────────────────────────────┐
                                              │ API /recorder gateway      │
                                              │ apps/api/src/modules/      │
                                              │ recorder/                  │
                                              └────────────┬───────────────┘
                                                           │ Socket.IO
                                                           ▼
                                              ┌────────────────────────────┐
                                              │ RecorderPage (web UI)      │
                                              │ apps/web/src/pages/tests/  │
                                              │ RecorderPage.tsx           │
                                              └────────────────────────────┘
```

The extension and the RecorderPage join a short-lived **session** identified
by a 6-character code. The user types the code from the RecorderPage into the
extension popup; the API gateway pairs them and forwards steps.

## Files

| File                 | Role                                                                       |
| -------------------- | -------------------------------------------------------------------------- |
| `manifest.json`      | Manifest V3 declaration. Permissions, host_permissions, content scripts.   |
| `background.js`      | Service worker. Owns the Socket.IO connection. Routes step events.         |
| `content.js`         | Content script injected at `document_start` on every page. Captures DOM.   |
| `popup.html` / `.js` | Toolbar popup UI — session code entry, per-tab "Start recording" toggle.   |
| `vendor/socket.io.min.js` | Vendored socket.io-client (v4.8.1). MV3 disallows remote scripts.      |
| `icons/`             | Toolbar icons (16/32/48/128 px PNGs).                                      |

## Local install (unpacked — no registration required)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** on (top right)
3. Click **Load unpacked**
4. Pick the `apps/recorder-extension` folder
5. The QA Recorder icon appears in your toolbar — pin it for easy access

That's it. No Chrome Web Store account, no review, no signing.

## Using it

1. Open the QA Platform → open a feature → click **Record New Test**
2. Click **Record** in the top bar — a 6-character session code appears
3. Open the target app in a new tab (any URL, any X-Frame setting)
4. Click the QA Recorder icon in the toolbar
5. Type the code into the popup → **Connect**
6. Click **Start recording this tab**
7. Interact with the app — every click, fill, navigation, and key press is
   captured and streamed to the platform window
8. Back in the QA Platform window: review the steps, click **Stop**, then
   **Save**

## Configuring the API URL

The default API URL is `http://localhost:3001`. For staging / production,
expand the **Advanced** section in the popup and set the correct URL.
It's persisted to `chrome.storage.local`.

## Permissions explained

- `storage` — persists the API URL
- `scripting` + `<all_urls>` host_permissions — needed to run the content
  script on every site
- `activeTab` + `tabs` — needed to identify the currently active tab when the
  user clicks **Start recording this tab**

The extension does **not** read or modify network requests, cookies, or
storage on the target site. It only listens to DOM events.

## Privacy

- Password inputs are **redacted at capture time** in the content script —
  the actual value never leaves the page (the recorded step stores `••••••••`
  as a placeholder)
- No data is sent anywhere outside your QA Platform API
- Recording is **opt-in per tab** — the content script captures nothing until
  the user explicitly arms a tab via the popup

## Packaging for distribution

For private distribution (no Chrome Web Store):

```bash
cd apps/recorder-extension
zip -r ../qa-recorder-extension.zip . -x "*.git*" "README.md"
```

Send the zip to your team; they extract it and load unpacked.

For public Chrome Web Store distribution (later):

1. Sign up at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) ($5 one-time)
2. Upload the zip
3. Submit for review (~1–7 days first time, hours thereafter)
