/**
 * QA Platform Recorder — content script.
 *
 * Runs in every page (host_permissions: <all_urls>) at document_start. On
 * load, it asks the background service worker whether this tab is "armed"
 * (the user pressed Start in the popup). If armed, it attaches DOM event
 * listeners and forwards captured steps to the background, which relays
 * them over Socket.IO to the QA Platform.
 *
 * This is essentially `apps/web/public/test-recorder.js` adapted for the
 * extension context: BroadcastChannel → chrome.runtime.sendMessage.
 */

(function () {
  if (window.__qaRecorderContent) return;
  window.__qaRecorderContent = true;

  const state = {
    active: false,
    paused: false,
    pendingInput: new Map(),
    stepCounter: 0,
  };

  let ring = null;
  function showRing() {
    if (ring) return;
    ring = document.createElement('div');
    ring.id = '__qa-recorder-ring';
    ring.style.cssText = 'position:fixed;inset:0;pointer-events:none;border:3px solid rgba(239,68,68,0.55);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.3);z-index:2147483647;border-radius:4px;';
    (document.documentElement || document.body || document).appendChild(ring);
  }
  function hideRing() {
    if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
    ring = null;
  }

  // ─── Selector engine (same logic as test-recorder.js) ────────────────────

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/(["\\])/g, '\\$1');
  }
  function cssQuote(s) { return String(s).replace(/(["\\])/g, '\\$1'); }

  function implicitRole(el) {
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
      return 'textbox';
    }
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    return null;
  }

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || '').trim();
    }
    if (el.tagName === 'BUTTON' || el.tagName === 'A') {
      return (el.textContent || '').trim().slice(0, 80);
    }
    if (el.tagName === 'INPUT' && el.id) {
      const lbl = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lbl) return (lbl.textContent || '').trim();
    }
    return '';
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length > 0) {
        const stable = Array.from(node.classList).filter(c =>
          !/^[a-z]+-\w{4,}$/i.test(c) && !/^css-[a-z0-9]+$/i.test(c) && !/^_[\w]+$/.test(c)
        );
        if (stable.length > 0) part += '.' + stable.slice(0, 2).map(cssEscape).join('.');
      }
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === node.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  /**
   * Count elements with exactly this trimmed text for a given tag. Used to
   * verify text-based selectors — `document.querySelectorAll` can't evaluate
   * Playwright's `:text-is()` pseudo, so without this manual check a
   * perfectly-unique text selector would always lose to a brittle CSS path.
   */
  function exactTextMatchCount(tag, text) {
    let n = 0;
    const nodes = document.getElementsByTagName(tag);
    for (let i = 0; i < nodes.length; i++) {
      if ((nodes[i].textContent || '').trim() === text) n++;
    }
    return n;
  }

  function deriveSelector(el) {
    // Each candidate carries a `verify` mode so we can confirm uniqueness
    // the right way:
    //   'css'  → document.querySelectorAll(...).length === 1
    //   'text' → manual exact-text count (Playwright :text-is() pseudo)
    const cands = [];

    // 1. Test attributes — most stable, always preferred.
    for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'data-test']) {
      const v = el.getAttribute(attr);
      if (v) cands.push({ strategy: 'testattr', selector: `[${attr}="${cssEscape(v)}"]`, verify: 'css' });
    }

    // 2. Explicit ARIA — only when a real `aria-label` ATTRIBUTE exists.
    //    Previously we built `[role][aria-label]` from the *accessible name*
    //    (which for buttons/links is the text content) — that selector then
    //    matched 0 elements at verify time because there's no actual
    //    aria-label attribute, so it always fell through to a CSS path.
    const explicitAria = el.getAttribute('aria-label');
    const role = el.getAttribute('role') || implicitRole(el);
    if (role && explicitAria) {
      cands.push({
        strategy: 'role',
        selector: `[role="${cssEscape(role)}"][aria-label="${cssEscape(explicitAria)}"]`,
        verify: 'css',
      });
    }

    // 3. Labelled form control.
    if (el.id) {
      const lbl = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lbl && (lbl.textContent || '').trim()) {
        cands.push({ strategy: 'label', selector: `#${cssEscape(el.id)}`, verify: 'css' });
      }
    }

    // 4. Placeholder (inputs).
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const ph = el.getAttribute('placeholder');
      if (ph) cands.push({
        strategy: 'placeholder',
        selector: `${el.tagName.toLowerCase()}[placeholder="${cssEscape(ph)}"]`,
        verify: 'css',
      });
    }

    // 5. Visible text for buttons / links — verified by exact-text count.
    //    `:text-is()` is exact-match (vs `:has-text()` substring) so it
    //    aligns with our uniqueness check and won't ambiguously match a
    //    longer label that merely contains this text.
    if (['BUTTON', 'A'].includes(el.tagName)) {
      const txt = (el.textContent || '').trim();
      if (txt && txt.length <= 50) {
        cands.push({
          strategy: 'text',
          selector: `${el.tagName.toLowerCase()}:text-is("${cssQuote(txt)}")`,
          verify: 'text',
          verifyTag: el.tagName,
          verifyText: txt,
        });
      }
    }

    // 6. id (if it doesn't look auto-generated).
    if (el.id && !/^[a-z0-9_-]*[0-9a-f]{6,}$/i.test(el.id) && !/^:r[0-9a-z]+:$/.test(el.id)) {
      cands.push({ strategy: 'id', selector: `#${cssEscape(el.id)}`, verify: 'css' });
    }

    // 7. CSS path — last resort, brittle.
    cands.push({ strategy: 'css', selector: cssPath(el), verify: 'css' });

    function isUnique(c) {
      if (c.verify === 'text') {
        return exactTextMatchCount(c.verifyTag, c.verifyText) === 1;
      }
      try {
        return document.querySelectorAll(c.selector).length === 1;
      } catch {
        return false;
      }
    }

    let winner = null;
    const fallbacks = [];
    for (const c of cands) {
      if (!winner && isUnique(c)) {
        winner = c;
        continue;
      }
      if (fallbacks.length < 2 && c.selector !== winner?.selector) fallbacks.push(c.selector);
    }
    if (!winner) winner = cands[cands.length - 1];
    return { selector: winner.selector, strategy: winner.strategy, fallbackSelectors: fallbacks };
  }

  function describe(el) {
    const sel = deriveSelector(el);
    return {
      selector: sel.selector,
      selectorStrategy: sel.strategy,
      fallbackSelectors: sel.fallbackSelectors,
      elementText: (el.textContent || '').trim().slice(0, 60),
      tagName: el.tagName,
    };
  }

  // ─── Step emission ───────────────────────────────────────────────────────

  function emit(step) {
    if (!state.active) {
      console.log('[qa-recorder] step ignored: not active', step.type, step.name);
      return;
    }
    if (state.paused) {
      console.log('[qa-recorder] step ignored: paused', step.type);
      return;
    }
    const enriched = {
      ...step,
      index: state.stepCounter++,
      capturedAt: new Date().toISOString(),
      url: location.href,
    };
    console.log('[qa-recorder] captured', enriched.type, '·', enriched.name);
    try {
      chrome.runtime.sendMessage({ kind: 'content:step', step: enriched }).catch((e) => {
        console.warn('[qa-recorder] sendMessage failed', e);
      });
    } catch (e) {
      console.error('[qa-recorder] sendMessage threw — extension context invalidated', e);
      state.active = false;
      hideRing();
    }
  }

  function activate() {
    if (state.active) {
      console.log('[qa-recorder] already active, ignoring duplicate start');
      return;
    }
    state.active = true;
    state.paused = false;
    // Reset scroll baseline so the first emitted SCROLL is measured from
    // where the user was at activation, not from page-load position.
    lastScrollY = window.scrollY;
    lastScrollX = window.scrollX;
    showRing();
    console.log('[qa-recorder] activated on', location.href);
    emit({
      type: 'NAVIGATE',
      name: `Navigate to ${location.pathname}`,
      input: { url: location.pathname + location.search + location.hash, waitUntil: 'networkidle' },
    });
  }

  function flushPendingInput(el) {
    const pending = state.pendingInput.get(el);
    if (!pending) return;
    state.pendingInput.delete(el);
    emit({ type: pending.type, name: pending.name, input: pending.input });
  }

  // ─── Event handlers — attached once, gated by state.active ──────────────

  // Walk up the DOM to find the nearest "actionable" ancestor. Without
  // this, a click on an icon inside a button (very common: `<a><i>` or
  // `<button><svg>`) records the icon's selector — Playwright then clicks
  // the icon at replay, but the framework's delegated handler may be bound
  // to the wrapper and never fires. AdminLTE / Bootstrap / Material UI
  // libraries are notorious for this.
  function findActionable(el) {
    const ACTIONABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL']);
    const ACTIONABLE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'checkbox', 'radio', 'switch']);
    let cur = el;
    let walked = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && walked < 6) {
      if (ACTIONABLE_TAGS.has(cur.tagName)) return cur;
      const role = cur.getAttribute && cur.getAttribute('role');
      if (role && ACTIONABLE_ROLES.has(role)) return cur;
      // Explicit onclick attribute or a tabindex >= 0 means the element is
      // intentionally a click target even without a semantic tag.
      if (cur.hasAttribute && (cur.hasAttribute('onclick') || cur.getAttribute('tabindex') === '0')) return cur;
      cur = cur.parentElement;
      walked++;
    }
    return el;
  }

  document.addEventListener('click', (e) => {
    if (!state.active) return;
    const raw = e.target;
    if (!raw || raw.nodeType !== 1) return;
    const el = findActionable(raw);
    for (const [other] of state.pendingInput) {
      if (other !== el) flushPendingInput(other);
    }
    const d = describe(el);
    emit({
      type: 'CLICK',
      name: `Click ${d.elementText || d.tagName.toLowerCase()}`.slice(0, 80),
      input: { selector: d.selector, selectorStrategy: d.selectorStrategy, fallbackSelectors: d.fallbackSelectors },
    });
  }, true);

  document.addEventListener('input', (e) => {
    if (!state.active) return;
    const el = e.target;
    if (!el || !('value' in el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') return;
    if (el.tagName === 'SELECT') return;
    const isPassword = el.type === 'password';
    const d = describe(el);
    state.pendingInput.set(el, {
      type: 'FILL',
      name: `Fill ${d.elementText || el.name || d.tagName.toLowerCase()}`.slice(0, 80),
      input: {
        selector: d.selector,
        selectorStrategy: d.selectorStrategy,
        fallbackSelectors: d.fallbackSelectors,
        // Capture the exact string the user typed — including passwords.
        // Previously we substituted `••••••••` for password fields, but
        // that literal then replayed at Playwright time and broke logins.
        // The `wasPassword` hint stays so the UI / tokeniser can suggest
        // replacing it with a {{TEST_PASSWORD}} variable at save time.
        value: el.value,
        wasPassword: isPassword || undefined,
      },
    });
  }, true);

  document.addEventListener('change', (e) => {
    if (!state.active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'SELECT') {
      const d = describe(el);
      flushPendingInput(el);
      emit({
        type: 'SELECT',
        name: `Select ${el.value}`.slice(0, 80),
        input: { selector: d.selector, fallbackSelectors: d.fallbackSelectors, value: el.value },
      });
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      const d = describe(el);
      emit({
        type: el.checked ? 'CHECK' : 'UNCHECK',
        name: `${el.checked ? 'Check' : 'Uncheck'} ${d.elementText || el.name}`.slice(0, 80),
        input: { selector: d.selector, fallbackSelectors: d.fallbackSelectors },
      });
    }
  }, true);

  document.addEventListener('blur', (e) => {
    if (!state.active) return;
    flushPendingInput(e.target);
  }, true);

  // ── Scroll capture ──────────────────────────────────────────────────────
  //
  // Window scroll events fire on every pixel of movement — we'd emit
  // hundreds of SCROLL steps for a single user-initiated scroll. Instead we
  // debounce: wait for scrolling to STOP (300ms idle), then emit one SCROLL
  // step carrying the cumulative delta since the previous resting position.
  // The compactor (recorderUtils.dropScrollAroundClick) takes care of
  // dropping the small auto-scrolls Playwright's CLICK already handles.

  let lastScrollY = window.scrollY;
  let lastScrollX = window.scrollX;
  let scrollIdleTimer = null;
  const SCROLL_IDLE_MS = 300;
  const SCROLL_MIN_DELTA = 50; // ignore tiny accidental nudges

  window.addEventListener('scroll', () => {
    if (!state.active) return;
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => {
      const dy = window.scrollY - lastScrollY;
      const dx = window.scrollX - lastScrollX;
      lastScrollY = window.scrollY;
      lastScrollX = window.scrollX;
      if (Math.abs(dx) < SCROLL_MIN_DELTA && Math.abs(dy) < SCROLL_MIN_DELTA) return;
      // Flush any pending FILL — once the user scrolls they've moved on.
      for (const [el] of state.pendingInput) flushPendingInput(el);
      emit({
        type: 'SCROLL',
        name: `Scroll ${dy > 0 ? 'down' : dy < 0 ? 'up' : ''} ${Math.abs(dy)}px`.trim(),
        input: { x: dx, y: dy },
      });
    }, SCROLL_IDLE_MS);
  }, { passive: true });

  const MEANINGFUL_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete',
  ]);
  document.addEventListener('keydown', (e) => {
    if (!state.active) return;
    if (!MEANINGFUL_KEYS.has(e.key)) return;
    if (e.key.startsWith('Arrow') && e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
    if (e.target && e.target.tagName === 'INPUT' && e.key === 'Enter') flushPendingInput(e.target);
    emit({ type: 'KEYBOARD', name: `Press ${e.key}`, input: { key: e.key } });
  }, true);

  // Navigation. We emit the initial NAVIGATE when the script first activates,
  // and again on SPA pushState/replaceState/popstate.
  let lastUrl = location.href;
  function emitNavIfChanged() {
    if (!state.active) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const path = location.pathname + location.search + location.hash;
    emit({ type: 'NAVIGATE', name: `Navigate to ${path}`, input: { url: path, waitUntil: 'networkidle' } });
  }
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () { origPush.apply(this, arguments); emitNavIfChanged(); };
  history.replaceState = function () { origReplace.apply(this, arguments); emitNavIfChanged(); };
  window.addEventListener('popstate', emitNavIfChanged);

  // ─── Activation control from the background worker ──────────────────────

  function deactivate() {
    state.active = false;
    state.pendingInput.clear();
    hideRing();
    console.log('[qa-recorder] deactivated');
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    // Selector test from the test editor — query the DOM, return a summary,
    // briefly highlight matches so the user sees them on-screen.
    if (msg.kind === 'selector:test') {
      const result = runSelectorTest(msg.selector, msg.reqId);
      sendResponse(result);
      return true; // keep the message port open for async sendResponse
    }
    if (msg.kind !== 'control') return;
    console.log('[qa-recorder] control received:', msg.action);
    if (msg.action === 'start') activate();
    else if (msg.action === 'stop') deactivate();
    else if (msg.action === 'pause') state.paused = true;
    else if (msg.action === 'resume') state.paused = false;
  });

  function runSelectorTest(selector, reqId) {
    if (!selector || typeof selector !== 'string') {
      return { reqId, count: 0, error: 'Empty selector', url: location.href };
    }
    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      return { reqId, count: 0, error: `Invalid selector: ${e.message}`, url: location.href };
    }
    const samples = [];
    for (let i = 0; i < Math.min(nodes.length, 3); i++) {
      const el = nodes[i];
      samples.push({
        tagName: el.tagName,
        text: (el.textContent || '').trim().slice(0, 120),
        outerHtml: (el.outerHTML || '').slice(0, 240),
      });
    }
    // Quick visual highlight — 1.2s pulse outline on matched elements.
    nodes.forEach((el) => {
      try {
        const prev = el.style.outline;
        const prevTransition = el.style.transition;
        el.style.outline = '3px solid #c4b5fd';
        el.style.transition = 'outline 0.4s ease-out';
        setTimeout(() => { el.style.outline = prev; el.style.transition = prevTransition; }, 1200);
      } catch {}
    });
    return { reqId, count: nodes.length, samples, url: location.href };
  }

  console.log('[qa-recorder] content script attached on', location.href);

  // On load (or re-injection after navigation) ask the worker whether this
  // tab is currently armed. If so, immediately activate so steps don't drop.
  try {
    chrome.runtime.sendMessage({ kind: 'content:should-capture' }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[qa-recorder] should-capture probe failed:', chrome.runtime.lastError);
        return;
      }
      console.log('[qa-recorder] should-capture response:', resp);
      if (resp?.armed) activate();
    });
  } catch (e) {
    console.warn('[qa-recorder] should-capture threw:', e);
  }

  // ─── Detection ping ─────────────────────────────────────────────────────
  //
  // The QA Platform UI calls window.postMessage({ kind: 'qa-recorder:ping' })
  // when it wants to know whether the extension is installed. We reply with
  // version + readiness so the UI can render the right state ("install" vs
  // "ready to record"). Symmetric postMessage means we don't need to share
  // an extension ID with the platform — any page can probe, our reply is
  // harmless (just confirms the extension exists).
  const EXT_VERSION = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '0.0.0';
  window.addEventListener('message', (e) => {
    if (e.source !== window) return; // only same-window pings
    const data = e.data;
    if (!data || typeof data !== 'object' || data.kind !== 'qa-recorder:ping') return;
    window.postMessage({ kind: 'qa-recorder:pong', version: EXT_VERSION }, e.origin || '*');
    // A ping only ever comes from a QA Platform page — so this page's origin
    // IS the API URL (the API is same-origin behind nginx). Hand it to the
    // background so the popup's API URL auto-fills; the user never types it.
    try {
      chrome.runtime.sendMessage({ kind: 'platform-detected', origin: location.origin }).catch(() => {});
    } catch {}
  });
  // Announce on load so a freshly-loaded RecorderPage doesn't have to wait
  // for its first poll to discover us.
  window.postMessage({ kind: 'qa-recorder:hello', version: EXT_VERSION }, '*');
})();
