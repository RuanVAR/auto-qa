/**
 * QA Platform Recorder — background service worker.
 *
 * Owns the Socket.IO connection to the platform's /recorder namespace and
 * acts as a router:
 *
 *   content scripts ↔  background  ↔  api /recorder
 *
 * The service worker is the right place for the socket because:
 *   - it survives across page navigations (the content script gets re-created
 *     on every navigation; if we held the socket there we'd reconnect on
 *     every page change and steps right after navigation could be lost)
 *   - the popup is ephemeral (closes when the user clicks away) so the
 *     popup can't own a long-lived connection
 *   - MV3 keeps the worker alive while a WebSocket is open
 */

importScripts('vendor/socket.io.min.js');

const DEFAULT_API_URL = 'http://localhost:3001';

let socket = null;
let session = { code: null, sessionId: null, apiUrl: DEFAULT_API_URL };
let paused = false;
// Tabs currently being captured. We only forward events from tabs the user
// explicitly armed via the popup; otherwise typing on every tab would stream
// into a session.
const recordingTabs = new Set();

// ─── Persistence ────────────────────────────────────────────────────────────

async function loadConfig() {
  const stored = await chrome.storage.local.get(['apiUrl']);
  if (stored.apiUrl) session.apiUrl = stored.apiUrl;
}

async function saveConfig() {
  await chrome.storage.local.set({ apiUrl: session.apiUrl });
}

// ─── Socket.IO lifecycle ────────────────────────────────────────────────────

// Derive the Socket.IO URL from the configured API URL.
//
//   Dev   — apiUrl is http://host:3001 (explicit port). The gateway runs on
//           a SEPARATE port 3002, so swap the port.
//   Prod  — apiUrl is https://<domain> (no explicit port). It sits behind a
//           reverse proxy that forwards /socket.io/ to the gateway, so we
//           connect to the apiUrl as-is; Socket.IO appends /socket.io/ and
//           uses wss:// automatically on an https origin.
//
// Trailing slashes and surrounding whitespace are stripped — otherwise
// `https://host/` + `/recorder` becomes `https://host//recorder`, an invalid
// Socket.IO namespace, and pairing silently fails.
function deriveSocketUrl(apiUrl) {
  const clean = (apiUrl || '').trim().replace(/\/+$/, '');
  if (/:\d+$/.test(clean)) {
    return clean.replace(/:\d+$/, ':3002');
  }
  return clean;
}

function connect(code, apiUrl) {
  disconnect();
  // Normalise the API URL — strip whitespace + trailing slashes so it's
  // stored and displayed cleanly.
  const normalisedApiUrl = (apiUrl || session.apiUrl || '').trim().replace(/\/+$/, '');
  session = { code, sessionId: null, apiUrl: normalisedApiUrl };
  saveConfig();

  const url = `${deriveSocketUrl(session.apiUrl)}/recorder`;

  socket = io(url, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    socket.emit('recorder:join', { code });
    broadcastStatus('connecting');
  });

  socket.on('recorder:joined', (data) => {
    session.sessionId = data.sessionId;
    broadcastStatus('paired');
  });

  socket.on('peer:connected', () => {
    cancelAutoDisconnect();
    broadcastStatus('paired');
  });
  socket.on('peer:disconnected', () => {
    broadcastStatus('viewer-gone');
    // Give the viewer a 60s grace window to reconnect (page reload, network
    // blip). If it doesn't come back, drop the socket entirely so the user
    // sees a clean "Disconnected" state instead of a stale "paired" badge.
    scheduleAutoDisconnect();
  });
  socket.on('session:expired', (msg) => {
    console.log('[qa-recorder] session expired:', msg?.reason);
    disconnect();
    broadcastStatus('session-expired', msg?.reason);
  });

  socket.on('control', (msg) => {
    if (msg.action === 'pause') paused = true;
    else if (msg.action === 'resume') paused = false;
    else if (msg.action === 'stop') {
      paused = true;
      // Tell every armed tab to stop capturing UI ring etc.
      for (const tabId of recordingTabs) {
        chrome.tabs.sendMessage(tabId, { kind: 'control', action: 'stop' }).catch(() => {});
      }
      recordingTabs.clear();
    }
  });

  // Selector test request from the viewer (test editor's "Test selector"
  // button). Forward to one armed tab (if any) and relay the response back.
  // If no tab is armed we can still test on the most-recently-active tab
  // that has our content script — try the active tab in the current window.
  socket.on('selector:test', async (msg) => {
    const reqId = msg?.reqId;
    const selector = msg?.selector;
    if (!reqId || typeof selector !== 'string') return;

    let targetTabId = null;
    if (recordingTabs.size > 0) {
      targetTabId = Array.from(recordingTabs)[0];
    } else {
      // Fall back to the active tab so users can test selectors without an
      // armed recording. The content script auto-injects on every page.
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id != null) targetTabId = tabs[0].id;
      } catch {}
    }

    if (targetTabId == null) {
      socket.emit('selector:test:result', { reqId, count: 0, error: 'No active tab' });
      return;
    }

    chrome.tabs.sendMessage(targetTabId, { kind: 'selector:test', selector, reqId }, (resp) => {
      if (chrome.runtime.lastError) {
        socket.emit('selector:test:result', {
          reqId,
          count: 0,
          error: `Content script unreachable on this tab — reload the target page. (${chrome.runtime.lastError.message})`,
        });
        return;
      }
      socket.emit('selector:test:result', resp || { reqId, count: 0, error: 'No response from content script' });
    });
  });

  socket.on('error', (err) => {
    console.warn('[qa-recorder] socket error', err);
    broadcastStatus('error', err?.message);
  });

  socket.on('disconnect', () => broadcastStatus('disconnected'));
}

function disconnect() {
  cancelAutoDisconnect();
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  session.sessionId = null;
  paused = false;
  for (const tabId of recordingTabs) {
    chrome.tabs.sendMessage(tabId, { kind: 'control', action: 'stop' }).catch(() => {});
  }
  recordingTabs.clear();
  broadcastStatus('disconnected');
}

// Grace window after the viewer drops before we kill the socket outright.
// If the user reloaded the QA Platform tab they'll reconnect quickly; if not
// (closed tab, gone for good), we don't want a stale "paired" appearance.
let autoDisconnectTimer = null;
const AUTO_DISCONNECT_GRACE_MS = 60_000;

function scheduleAutoDisconnect() {
  cancelAutoDisconnect();
  autoDisconnectTimer = setTimeout(() => {
    console.log('[qa-recorder] viewer never reconnected — auto-disconnecting');
    disconnect();
  }, AUTO_DISCONNECT_GRACE_MS);
}
function cancelAutoDisconnect() {
  if (autoDisconnectTimer) {
    clearTimeout(autoDisconnectTimer);
    autoDisconnectTimer = null;
  }
}

// ─── Status broadcast → popup ──────────────────────────────────────────────

let currentStatus = 'disconnected';
function broadcastStatus(status, detail) {
  currentStatus = status;
  // Update the badge so the user can see at a glance whether we're paired.
  const badge =
    status === 'paired' ? { text: '●', color: '#10b981' } :
    status === 'connecting' ? { text: '…', color: '#fbbf24' } :
    status === 'error' ? { text: '!', color: '#ef4444' } :
    { text: '', color: '#000000' };
  chrome.action.setBadgeText({ text: badge.text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});
  // Notify popup if open.
  chrome.runtime.sendMessage({ kind: 'status', status, detail }).catch(() => {});
}

// ─── Message routing ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.kind === 'popup:status') {
    sendResponse({
      status: currentStatus,
      session: { code: session.code, sessionId: session.sessionId, apiUrl: session.apiUrl },
      armedTabs: Array.from(recordingTabs),
    });
    return false;
  }
  if (msg.kind === 'popup:connect') {
    connect(msg.code, msg.apiUrl || session.apiUrl);
    sendResponse({ ok: true });
    return false;
  }
  if (msg.kind === 'popup:disconnect') {
    disconnect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg.kind === 'popup:arm-tab') {
    const tabId = msg.tabId;
    recordingTabs.add(tabId);
    chrome.tabs.sendMessage(tabId, { kind: 'control', action: 'start' }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  if (msg.kind === 'popup:disarm-tab') {
    const tabId = msg.tabId;
    recordingTabs.delete(tabId);
    chrome.tabs.sendMessage(tabId, { kind: 'control', action: 'stop' }).catch(() => {});
    sendResponse({ ok: true });
    return false;
  }
  // Content script forwarding a captured step.
  if (msg.kind === 'content:step') {
    const tabId = sender.tab?.id;
    if (!tabId || !recordingTabs.has(tabId)) {
      console.warn('[qa-recorder] step dropped: tab not armed', { tabId, armed: Array.from(recordingTabs) });
      return false;
    }
    if (paused) {
      console.log('[qa-recorder] step skipped: paused');
      return false;
    }
    if (!socket || !socket.connected || !session.sessionId) {
      console.warn('[qa-recorder] step dropped: socket not ready', {
        hasSocket: !!socket,
        connected: socket?.connected,
        sessionId: session.sessionId,
      });
      return false;
    }
    console.log('[qa-recorder] forwarding step:', msg.step?.type, msg.step?.name);
    socket.emit('step', { step: msg.step });
    return false;
  }
  // Content script asking whether it should activate on load.
  if (msg.kind === 'content:should-capture') {
    const tabId = sender.tab?.id;
    sendResponse({ armed: tabId != null && recordingTabs.has(tabId) });
    return false;
  }
});

// Clean up armed state when a recorded tab closes.
chrome.tabs.onRemoved.addListener((tabId) => {
  recordingTabs.delete(tabId);
});

// Re-arming after a navigation isn't needed — the content script runs at
// document_start on every page load and asks the background whether it
// should activate (recordingTabs lookup). So just keep that map alive.

loadConfig();
