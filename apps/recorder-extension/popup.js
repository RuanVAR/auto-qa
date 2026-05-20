/**
 * QA Platform Recorder — popup script.
 *
 * Talks to the background service worker via chrome.runtime.sendMessage.
 * Owns no long-lived state — every action round-trips to the background.
 */

const $ = (id) => document.getElementById(id);

const els = {
  status: $('status'),
  statusLabel: $('status').querySelector('.label'),
  connectView: $('connect-view'),
  connectedView: $('connected-view'),
  code: $('code'),
  connect: $('connect'),
  disconnect: $('disconnect'),
  armToggle: $('arm-toggle'),
  tabTitle: $('tab-title'),
  apiUrl: $('api-url'),
};

let activeTabId = null;
let armed = false;

function setStatus(status, detail) {
  // Map server-internal statuses onto popup CSS classes. 'session-expired'
  // and 'viewer-gone' share the warning style so it's obviously "not OK"
  // but distinguishable from a hard error.
  const cssStatus =
    status === 'viewer-gone' || status === 'session-expired' ? 'warning' :
    status === 'paired' ? 'paired' :
    status === 'connecting' ? 'connecting' :
    status === 'error' ? 'error' :
    'disconnected';
  els.status.className = `status-pill status-${cssStatus}`;
  const labels = {
    disconnected: 'Disconnected — enter a code to pair',
    connecting: 'Connecting…',
    paired: 'Paired with QA Platform',
    'viewer-gone': 'QA Platform tab disconnected — waiting for reconnect',
    'session-expired': detail === 'replaced'
      ? 'Session ended — the QA Platform started a new one'
      : 'Session expired — pair again with a fresh code',
    error: detail || 'Connection error',
  };
  els.statusLabel.textContent = labels[status] ?? status;
}

function showConnected(connected) {
  els.connectView.style.display = connected ? 'none' : 'block';
  els.connectedView.style.display = connected ? 'block' : 'none';
}

function updateArmButton() {
  if (armed) {
    els.armToggle.textContent = 'Stop recording this tab';
    els.armToggle.className = 'danger';
  } else {
    els.armToggle.textContent = 'Start recording this tab';
    els.armToggle.className = 'primary';
  }
}

async function refresh() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs[0]) {
    activeTabId = tabs[0].id;
    const host = (() => { try { return new URL(tabs[0].url).host; } catch { return tabs[0].url || ''; } })();
    els.tabTitle.textContent = host;
  }

  chrome.runtime.sendMessage({ kind: 'popup:status' }, (resp) => {
    if (!resp) return;
    setStatus(resp.status, resp.detail);
    // Show the "armed tab / disconnect" view whenever the extension's socket
    // is alive (paired OR waiting for viewer to come back). When the session
    // is fully expired/disconnected, switch back to the "enter code" view.
    const connected = resp.status === 'paired' || resp.status === 'viewer-gone';
    showConnected(connected);
    armed = activeTabId != null && resp.armedTabs?.includes(activeTabId);
    updateArmButton();
    if (resp.session?.apiUrl) els.apiUrl.value = resp.session.apiUrl;
  });
}

els.connect.addEventListener('click', async () => {
  const code = els.code.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) {
    alert('Enter the session code shown in the QA Platform.');
    return;
  }
  const apiUrl = els.apiUrl.value.trim() || 'http://localhost:3001';
  chrome.runtime.sendMessage({ kind: 'popup:connect', code, apiUrl }, () => {
    setStatus('connecting');
    setTimeout(refresh, 500);
  });
});

els.disconnect.addEventListener('click', () => {
  chrome.runtime.sendMessage({ kind: 'popup:disconnect' }, () => refresh());
});

els.armToggle.addEventListener('click', () => {
  if (activeTabId == null) return;
  const kind = armed ? 'popup:disarm-tab' : 'popup:arm-tab';
  chrome.runtime.sendMessage({ kind, tabId: activeTabId }, () => {
    armed = !armed;
    updateArmButton();
  });
});

// Live status updates pushed by the background worker.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.kind === 'status') setStatus(msg.status, msg.detail);
});

refresh();
