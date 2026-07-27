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
    flushTimer: null,
  };

  // ─── Recording UI — viewport border + floating control bar ──────────────
  //
  // The border ring is an always-visible "this page is being recorded" cue.
  // The floating bar (bottom-centre) lets the user pause or stop the
  // recording WITHOUT reopening the extension popup — it shows a live step
  // count plus Pause / Stop buttons, and lives in a shadow root so the host
  // page's CSS can't restyle it.

  let ring = null;
  let bar = null;

  function showRing() {
    if (ring) return;
    ring = document.createElement('div');
    ring.id = '__qa-recorder-ring';
    ring.style.cssText = 'position:fixed;inset:0;pointer-events:none;border:3px solid rgba(239,68,68,0.55);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.3);z-index:2147483646;border-radius:4px;';
    (document.documentElement || document.body || document).appendChild(ring);
  }
  function hideRing() {
    if (ring && ring.parentNode) ring.parentNode.removeChild(ring);
    ring = null;
  }

  // Is this element one of our own injected overlays? Clicks inside the
  // shadow-rooted bar retarget to the #__qa-recorder-bar host, so an id
  // check is enough — and stops the recorder from recording its own UI.
  function isOwnUi(el) {
    return !!el && (el.id === '__qa-recorder-bar' || el.id === '__qa-recorder-ring');
  }

  function showBar() {
    showRing();
    if (bar) { syncBar(); return; }
    bar = document.createElement('div');
    bar.id = '__qa-recorder-bar';
    bar.style.cssText = 'position:fixed;left:0;bottom:0;width:0;height:0;z-index:2147483647;';
    const shadow = bar.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .wrap{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);
          display:flex;align-items:center;gap:10px;box-sizing:border-box;
          padding:8px 8px 8px 15px;border-radius:9999px;
          background:rgba(17,18,23,0.97);
          font:600 13px/1.2 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
          color:#fff;box-shadow:0 10px 34px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.09);
          pointer-events:auto;}
        .dot{width:9px;height:9px;border-radius:50%;background:#ef4444;flex:none;
          animation:qa-pulse 1.6s infinite;}
        @keyframes qa-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}
          70%{box-shadow:0 0 0 7px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
        .lbl{letter-spacing:.02em;white-space:nowrap}
        .count{opacity:.55;font-weight:500;white-space:nowrap}
        .paused .dot{background:#fbbf24;animation:none}
        .paused .lbl{opacity:.7}
        .sep{width:1px;height:18px;background:rgba(255,255,255,.14);flex:none}
        button{font:inherit;border:0;margin:0;cursor:pointer;border-radius:9999px;
          padding:7px 13px;color:#fff;white-space:nowrap;transition:filter .12s}
        button:hover{filter:brightness(1.18)}
        .pause{background:rgba(255,255,255,.13)}
        .stop{background:#ef4444}
      </style>
      <div class="wrap" id="wrap">
        <span class="dot"></span>
        <span class="lbl" id="lbl">Recording</span>
        <span class="count" id="count">0 steps</span>
        <span class="sep"></span>
        <button class="pause" id="pause" type="button">Pause</button>
        <button class="stop" id="stop" type="button">Stop</button>
      </div>`;
    (document.documentElement || document.body || document).appendChild(bar);
    shadow.getElementById('pause').addEventListener('click', () => {
      setPaused(!state.paused);
    });
    shadow.getElementById('stop').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ kind: 'content:stop' }).catch(() => {}); } catch {}
      deactivate();
    });
    syncBar();
  }

  function syncBar() {
    if (!bar || !bar.shadowRoot) return;
    const n = state.stepCounter;
    const count = bar.shadowRoot.getElementById('count');
    if (count) count.textContent = `${n} step${n === 1 ? '' : 's'}`;
  }

  function setPaused(p) {
    state.paused = p;
    if (bar && bar.shadowRoot) {
      const wrap = bar.shadowRoot.getElementById('wrap');
      const lbl = bar.shadowRoot.getElementById('lbl');
      const pauseBtn = bar.shadowRoot.getElementById('pause');
      if (wrap) wrap.classList.toggle('paused', p);
      if (lbl) lbl.textContent = p ? 'Paused' : 'Recording';
      if (pauseBtn) pauseBtn.textContent = p ? 'Resume' : 'Pause';
    }
  }

  function teardownBar() {
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    bar = null;
    hideRing();
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
   * Count elements of `tag` whose subtree text CONTAINS `text`, matching
   * Playwright's `:has-text()` rule: whitespace-normalised, case-insensitive,
   * substring. Used to verify a `tag:has-text(...)` selector resolves to a
   * single element — `document.querySelectorAll` can't evaluate the
   * `:has-text()` pseudo, so without this manual check a perfectly-unique
   * text selector would always lose to a brittle CSS path.
   */
  function hasTextMatchCount(tag, text) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const needle = norm(text);
    if (!needle) return 0;
    let n = 0;
    const nodes = document.getElementsByTagName(tag);
    for (let i = 0; i < nodes.length; i++) {
      if (norm(nodes[i].textContent).includes(needle)) n++;
    }
    return n;
  }

  function deriveSelector(el) {
    // Each candidate carries a `verify` mode so we can confirm uniqueness
    // the right way:
    //   'css'  → document.querySelectorAll(...).length === 1
    //   'text' → manual subtree-text count (Playwright :has-text() pseudo)
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

    // 5. Visible text for buttons / links — matched with Playwright's
    //    `:has-text()`. We deliberately do NOT use `:text-is()` here:
    //    `:text-is()` resolves to the SMALLEST element with that text, so
    //    `button:text-is("Login")` matches 0 elements whenever the label is
    //    wrapped — `<button><span>Login</span></button>` — because the span
    //    is the match and it isn't a <button>. `:has-text()` is an
    //    ancestor-inclusive match, so it resolves to the button itself.
    //    Uniqueness is verified with the same substring rule.
    if (['BUTTON', 'A'].includes(el.tagName)) {
      const txt = (el.textContent || '').trim();
      if (txt && txt.length <= 50) {
        cands.push({
          strategy: 'text',
          selector: `${el.tagName.toLowerCase()}:has-text("${cssQuote(txt)}")`,
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
        return hasTextMatchCount(c.verifyTag, c.verifyText) === 1;
      }
      try {
        return document.querySelectorAll(c.selector).length === 1;
      } catch {
        return false;
      }
    }

    let winner = null;
    const fallbacks = [];
    const fallbackStrategies = new Set();
    for (const c of cands) {
      if (!winner && isUnique(c)) {
        winner = c;
        continue;
      }
      // A fallback is useful only if it is itself unique and comes from a
      // different selector strategy. Two CSS paths or two attributes fail
      // together too often to provide genuine resilience.
      if (
        winner
        && fallbacks.length < 2
        && c.strategy !== winner.strategy
        && !fallbackStrategies.has(c.strategy)
        && c.selector !== winner.selector
        && isUnique(c)
      ) {
        fallbacks.push(c.selector);
        fallbackStrategies.add(c.strategy);
      }
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

  // ─── Step buffer — survives same-tab navigation ─────────────────────────
  //
  // A click that triggers navigation (a form submit, a link) used to lose
  // its step: the content script is torn down before the async
  // chrome.runtime.sendMessage to the background flushes. sessionStorage
  // DOES survive a same-tab navigation, so every captured step is written
  // there synchronously the instant it's captured, then re-flushed when the
  // next content script injects. Each step carries a unique `cid` so the
  // background can drop a step that arrives both live and via re-flush.

  const BUFFER_KEY = '__qa_recorder_buffer';
  const COUNTER_KEY = '__qa_recorder_counter';
  const SESSION_NONCE = Math.random().toString(36).slice(2, 9);

  function readBuffer() {
    try {
      const v = JSON.parse(sessionStorage.getItem(BUFFER_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }
  function writeBuffer(buf) {
    try { sessionStorage.setItem(BUFFER_KEY, JSON.stringify(buf)); } catch {}
  }
  function bufferStep(step) {
    const buf = readBuffer();
    buf.push(step);
    writeBuffer(buf);
  }
  function removeFromBuffer(cid) {
    writeBuffer(readBuffer().filter((s) => s.cid !== cid));
  }
  function clearBuffer() {
    try {
      sessionStorage.removeItem(BUFFER_KEY);
      sessionStorage.removeItem(COUNTER_KEY);
    } catch {}
  }

  // Send (or re-send) one step to the background. On a confirmed delivery the
  // step is dropped from the buffer; on failure it stays for the next flush.
  function sendStep(step) {
    try {
      chrome.runtime.sendMessage({ kind: 'content:step', step }, (resp) => {
        if (chrome.runtime.lastError) return; // worker asleep — retry on next flush
        if (resp && resp.received) removeFromBuffer(step.cid);
      });
    } catch (e) {
      console.error('[qa-recorder] sendMessage threw — extension context invalidated', e);
      state.active = false;
      teardownBar();
    }
  }

  function flushBuffer() {
    const buf = readBuffer();
    if (buf.length === 0) return;
    console.log('[qa-recorder] flushing', buf.length, 'buffered step(s)');
    for (const step of buf) sendStep(step);
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
    const idx = state.stepCounter++;
    const enriched = {
      ...step,
      cid: `${SESSION_NONCE}-${Date.now().toString(36)}-${idx}`,
      index: idx,
      capturedAt: new Date().toISOString(),
      url: location.href,
    };
    // Persist synchronously BEFORE the async send so a navigation triggered
    // by this very step (e.g. a form-submit click) can't lose it.
    try { sessionStorage.setItem(COUNTER_KEY, String(state.stepCounter)); } catch {}
    bufferStep(enriched);
    syncBar();
    console.log('[qa-recorder] captured', enriched.type, '·', enriched.name);
    sendStep(enriched);
  }

  function activate() {
    if (state.active) {
      console.log('[qa-recorder] already active, ignoring duplicate start');
      return;
    }
    state.active = true;
    state.paused = false;
    // Restore the running step index across same-tab navigations so steps
    // captured after a navigation keep a monotonic, non-colliding order.
    const savedCounter = parseInt(sessionStorage.getItem(COUNTER_KEY) || '', 10);
    if (Number.isFinite(savedCounter) && savedCounter > state.stepCounter) {
      state.stepCounter = savedCounter;
    }
    // Reset scroll baseline so the first emitted SCROLL is measured from
    // where the user was at activation, not from page-load position.
    lastScrollY = window.scrollY;
    lastScrollX = window.scrollX;
    showBar();
    // Re-send anything captured right before a navigation tore down the
    // previous content script (the classic lost form-submit click).
    flushBuffer();
    if (state.flushTimer) clearInterval(state.flushTimer);
    // Light safety net for a transient socket reconnect mid-recording.
    state.flushTimer = setInterval(() => {
      if (state.active && readBuffer().length > 0) flushBuffer();
    }, 5000);
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
    if (isOwnUi(raw)) return; // never record clicks on our own floating bar
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
        // Never transmit a password outside the target page. The recorder UI
        // requires an environment token before this step can be saved.
        value: isPassword ? '{{PASSWORD}}' : el.value,
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
    if (isOwnUi(e.target)) return; // ignore keys inside our own floating bar
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
    state.paused = false;
    state.pendingInput.clear();
    if (state.flushTimer) {
      clearInterval(state.flushTimer);
      state.flushTimer = null;
    }
    // The buffer is intentionally NOT cleared here — any step still awaiting
    // delivery drains as its ack arrives. The next explicit start clears it.
    teardownBar();
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
    if (msg.action === 'start') {
      // An explicit fresh start — drop any steps left over in the buffer
      // from a previous recording on this tab.
      clearBuffer();
      activate();
    } else if (msg.action === 'stop') {
      deactivate();
    } else if (msg.action === 'pause') {
      setPaused(true);
    } else if (msg.action === 'resume') {
      setPaused(false);
    }
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

  // ─── Iframe URL broadcaster ────────────────────────────────────────────
  //
  // When this content script is running INSIDE an iframe (window !== top),
  // post the current URL up to the parent on every navigation. The QA
  // Platform's TestingView listens for these messages so the address-bar
  // strip above the manual iframe stays accurate even for cross-origin
  // SUTs — the browser's same-origin policy would otherwise block the
  // parent page from reading contentWindow.location.
  //
  // Runs independently of recording state on purpose: testers want the
  // URL displayed during manual testing whether or not they're recording.
  try {
    if (window !== window.top) {
      let lastBroadcastUrl = null;
      const broadcastUrl = () => {
        try {
          if (location.href === lastBroadcastUrl) return;
          lastBroadcastUrl = location.href;
          window.parent.postMessage(
            { kind: 'qa-recorder:nav', url: location.href },
            '*',
          );
        } catch { /* parent unavailable — ignore */ }
      };
      broadcastUrl();
      const origPushBroadcast = history.pushState;
      const origReplaceBroadcast = history.replaceState;
      history.pushState = function () { origPushBroadcast.apply(this, arguments); broadcastUrl(); };
      history.replaceState = function () { origReplaceBroadcast.apply(this, arguments); broadcastUrl(); };
      window.addEventListener('popstate', broadcastUrl);
      window.addEventListener('hashchange', broadcastUrl);
      window.addEventListener('load', broadcastUrl);
    }
  } catch { /* defensive — content script failures shouldn't break the SUT */ }
})();
