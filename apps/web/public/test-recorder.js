/**
 * Test Recorder capture script — slice 1.
 *
 * Loaded inside the recorded app (via iframe srcdoc wrapper or as a
 * bookmarklet). Listens for DOM events, derives a Playwright-style step,
 * and posts it to the parent window over a BroadcastChannel.
 *
 * Design constraints:
 *   - Vanilla JS, no React/Vue/JSX. Runs anywhere.
 *   - Captures EVERY meaningful event into a raw stream. Compaction (drop
 *     scroll-after-click, coalesce FILL on same input, etc.) is done on
 *     the recorder UI side at Stop time — see RecorderPage.
 *   - Selector engine runs in priority order; each candidate is tested
 *     for uniqueness via `document.querySelectorAll(s).length === 1`.
 *     Stores the winner as `selector`, the next two non-unique candidates
 *     as `fallbackSelectors[]`. Self-healing tries fallbacks before AI.
 *   - Password inputs are auto-redacted at capture time (value never leaves
 *     the page). Tokenisation of env-baseUrl / test-email values happens
 *     at save time on the recorder UI side, not here.
 */

(function () {
  // Idempotency guard — running this script twice on the same page is a
  // common mistake (bookmarklet pressed twice, dev hot-reload). Bail.
  if (window.__qaRecorder) {
    console.warn('[qa-recorder] already running; ignoring re-init');
    return;
  }

  const CHANNEL_NAME = 'qa-recorder';
  const channel = new BroadcastChannel(CHANNEL_NAME);

  const state = {
    sessionId: 'rec-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    paused: false,
    // Last input event per element — lets us coalesce typing into one FILL
    // step (we emit only on blur or when the user moves to a different
    // element).
    pendingInput: new Map(),
    startedAt: Date.now(),
  };

  // ── Selector engine ────────────────────────────────────────────────────

  /**
   * Try to build a stable, unique selector for `el`. Returns
   * { selector, strategy, fallbacks }. If nothing's unique, returns the
   * best CSS path we could derive.
   */
  function deriveSelector(el) {
    const candidates = [];

    // 1. Test attributes — most stable.
    for (const attr of ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'data-test']) {
      const v = el.getAttribute(attr);
      if (v) candidates.push({ strategy: 'testattr', selector: `[${attr}="${cssEscape(v)}"]` });
    }

    // 2. ARIA role + accessible name.
    const role = el.getAttribute('role') || implicitRole(el);
    const name = accessibleName(el);
    if (role && name) {
      candidates.push({ strategy: 'role', selector: `[role="${cssEscape(role)}"][aria-label="${cssEscape(name)}"]` });
    }

    // 3. Labelled form control.
    if (el.id) {
      const label = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (label) {
        const text = (label.textContent || '').trim();
        if (text) candidates.push({ strategy: 'label', selector: `#${cssEscape(el.id)}` });
      }
    }

    // 4. Placeholder (inputs).
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const ph = el.getAttribute('placeholder');
      if (ph) candidates.push({ strategy: 'placeholder', selector: `${el.tagName.toLowerCase()}[placeholder="${cssEscape(ph)}"]` });
    }

    // 5. Visible text — useful for buttons / links.
    if (['BUTTON', 'A'].includes(el.tagName)) {
      const text = (el.textContent || '').trim().slice(0, 80);
      if (text) candidates.push({ strategy: 'text', selector: `${el.tagName.toLowerCase()}:has-text("${cssQuote(text)}")` });
    }

    // 6. id (if it doesn't look auto-generated).
    if (el.id && !/^[a-z0-9_-]*[0-9a-f]{6,}$/i.test(el.id) && !/^:r[0-9a-z]+:$/.test(el.id)) {
      candidates.push({ strategy: 'id', selector: `#${cssEscape(el.id)}` });
    }

    // 7. CSS path — last resort.
    candidates.push({ strategy: 'css', selector: cssPath(el) });

    // Pick the first that's unique; carry the next two non-unique ones as
    // fallbacks for the executor's healing path.
    let winner = null;
    const fallbacks = [];
    for (const c of candidates) {
      if (!winner) {
        try {
          if (document.querySelectorAll(c.selector).length === 1) {
            winner = c;
            continue;
          }
        } catch { /* invalid selector — skip */ }
      }
      if (fallbacks.length < 2 && c.selector !== winner?.selector) fallbacks.push(c.selector);
    }
    if (!winner) winner = candidates[candidates.length - 1]; // CSS path
    return {
      selector: winner.selector,
      strategy: winner.strategy,
      fallbackSelectors: fallbacks,
    };
  }

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.classList && node.classList.length > 0) {
        const stable = Array.from(node.classList).filter(c =>
          // Drop classes that look auto-generated (CSS-in-JS, hash suffixes)
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

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/(["\\])/g, '\\$1');
  }
  function cssQuote(s) {
    return String(s).replace(/(["\\])/g, '\\$1');
  }

  function implicitRole(el) {
    const tag = el.tagName;
    if (tag === 'BUTTON') return 'button';
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'INPUT') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
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

  // ── Step emission ─────────────────────────────────────────────────────

  let stepCounter = 0;
  function emit(step) {
    if (state.paused) return;
    const enriched = {
      ...step,
      index: stepCounter++,
      capturedAt: new Date().toISOString(),
    };
    channel.postMessage({ kind: 'step', sessionId: state.sessionId, step: enriched });
  }

  function describe(el) {
    const sel = deriveSelector(el);
    return {
      selector: sel.selector,
      selectorStrategy: sel.strategy,
      fallbackSelectors: sel.fallbackSelectors,
      // Short text hint — used as the step's display name and also fed to
      // the AI healing layer if the selector goes stale.
      elementText: (el.textContent || '').trim().slice(0, 60),
      tagName: el.tagName,
    };
  }

  // ── Event handlers ────────────────────────────────────────────────────

  // Flush a pending FILL when the user moves on. This is what turns
  // hundreds of `input` events into one clean FILL step.
  function flushPendingInput(el) {
    const pending = state.pendingInput.get(el);
    if (!pending) return;
    state.pendingInput.delete(el);
    emit({
      type: pending.type,
      name: pending.name,
      input: pending.input,
    });
  }

  document.addEventListener('click', (e) => {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    // Flush any pending input on a different element (user clicked away).
    for (const [other] of state.pendingInput) {
      if (other !== el) flushPendingInput(other);
    }
    const d = describe(el);
    emit({
      type: 'CLICK',
      name: `Click ${d.elementText || d.tagName.toLowerCase()}`.slice(0, 80),
      input: {
        selector: d.selector,
        selectorStrategy: d.selectorStrategy,
        fallbackSelectors: d.fallbackSelectors,
      },
    });
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el || !('value' in el)) return;
    if (el.type === 'checkbox' || el.type === 'radio') return; // handled by 'change'
    const isPassword = el.type === 'password';
    const d = describe(el);
    state.pendingInput.set(el, {
      type: 'FILL',
      name: `Fill ${d.elementText || el.name || d.tagName.toLowerCase()}`.slice(0, 80),
      input: {
        selector: d.selector,
        selectorStrategy: d.selectorStrategy,
        fallbackSelectors: d.fallbackSelectors,
        // Redact passwords AT CAPTURE — value never travels to the parent.
        value: isPassword ? '••••••••' : el.value,
        redacted: isPassword || undefined,
      },
    });
  }, true);

  document.addEventListener('change', (e) => {
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

  // Flush pending FILL on blur — user moved focus elsewhere.
  document.addEventListener('blur', (e) => {
    flushPendingInput(e.target);
  }, true);

  // Meaningful keypresses only — Enter/Tab/Escape/arrows etc. Skip every
  // letter/digit (those are part of FILL).
  const MEANINGFUL_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete',
  ]);
  document.addEventListener('keydown', (e) => {
    if (!MEANINGFUL_KEYS.has(e.key)) return;
    // Skip arrow keys inside scrollable containers — too noisy.
    if (e.key.startsWith('Arrow') && e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') return;
    if (e.target && e.target.tagName === 'INPUT' && e.key === 'Enter') flushPendingInput(e.target);
    emit({
      type: 'KEYBOARD',
      name: `Press ${e.key}`,
      input: { key: e.key },
    });
  }, true);

  // Navigation — both full reload and SPA pushState/replaceState.
  let lastUrl = location.href;
  function emitNavIfChanged() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    // Send only the path — the test plays back against any environment.
    const path = location.pathname + location.search + location.hash;
    emit({
      type: 'NAVIGATE',
      name: `Navigate to ${path}`,
      input: { url: path, waitUntil: 'networkidle' },
    });
  }
  // Initial load — NAVIGATE is the first step of every recording.
  emit({
    type: 'NAVIGATE',
    name: `Navigate to ${location.pathname}`,
    input: { url: location.pathname + location.search + location.hash, waitUntil: 'networkidle' },
  });
  // SPA navigation hooks.
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function () { origPush.apply(this, arguments); emitNavIfChanged(); };
  history.replaceState = function () { origReplace.apply(this, arguments); emitNavIfChanged(); };
  window.addEventListener('popstate', emitNavIfChanged);

  // ── Control channel — the recorder UI can pause/stop us. ─────────────

  channel.addEventListener('message', (msg) => {
    if (!msg.data || msg.data.kind !== 'control' || msg.data.sessionId !== state.sessionId) return;
    if (msg.data.action === 'pause') state.paused = true;
    if (msg.data.action === 'resume') state.paused = false;
    if (msg.data.action === 'flush') {
      for (const [el] of state.pendingInput) flushPendingInput(el);
    }
  });

  // Announce ourselves so the recorder UI knows we connected.
  channel.postMessage({ kind: 'hello', sessionId: state.sessionId, url: location.href });

  // Visible cue so the user knows the recorder is live. Subtle red ring.
  const ring = document.createElement('div');
  ring.id = '__qa-recorder-ring';
  ring.style.cssText = 'position:fixed;inset:0;pointer-events:none;border:3px solid rgba(239,68,68,0.55);box-shadow:inset 0 0 0 1px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.3);z-index:2147483647;border-radius:4px;';
  document.documentElement.appendChild(ring);

  window.__qaRecorder = state;
})();
