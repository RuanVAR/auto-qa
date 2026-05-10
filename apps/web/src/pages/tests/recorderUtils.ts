/**
 * Recorder helpers — compaction + tokenisation logic.
 *
 * `compactSteps` runs at Stop time. The raw event stream is too noisy to
 * save directly — accidental scrolls, hover-then-click patterns, every
 * keystroke as its own KEYBOARD event. The compactor's job is to produce
 * a clean test from the noisy log without losing user intent.
 *
 * `suggestTokenisations` runs at Save time. Hardcoded URLs / emails make
 * a recorded test unportable; we surface candidates for replacement.
 */

export interface CapturedStep {
  type: string;
  name: string;
  index?: number;
  capturedAt?: string;
  input?: Record<string, unknown>;
}

/**
 * Compact a raw capture stream into a clean test. Rules in priority order:
 *
 *   1. Drop trailing scrolls — final scroll-to-bottom is just the user
 *      reading. Keeping leading scrolls because they may be navigation
 *      ("scroll to load more").
 *   2. Coalesce consecutive FILL on same selector — keep the last value
 *      only. Typing "hello" produces 5 events; we want the final state.
 *   3. Drop SCROLL within ±400ms of CLICK on same path — browser
 *      auto-scrolls clicked elements into view.
 *   4. Drop HOVER immediately followed by CLICK on same selector — the
 *      hover was incidental.
 *   5. Drop empty NAVIGATE pairs — pushState/replaceState rewrite races.
 *   6. Drop redundant initial NAVIGATE if it equals the second step's URL.
 *
 * Idempotent — running over already-clean data is a no-op.
 */
export function compactSteps(raw: CapturedStep[]): CapturedStep[] {
  if (raw.length === 0) return raw;
  let out = raw.slice();

  // Rule 2 — coalesce FILL bursts.
  out = coalesceFillBursts(out);

  // Rule 4 — drop hover-before-click on same selector.
  out = dropHoverBeforeClick(out);

  // Rule 4b — drop a FILL immediately followed by SELECT / CHECK / UNCHECK
  // on the same selector. Some browsers / frameworks fire both 'input' and
  // 'change' on a single user pick; the FILL would crash Playwright at
  // replay (FILL doesn't work on <select> / checkboxes / radios).
  out = dropFillBeforeFormControl(out);

  // Rule 3 — drop scroll-after-click jitter.
  out = dropScrollAroundClick(out);

  // Rule 1 — drop trailing scrolls.
  while (out.length > 0 && out[out.length - 1].type === 'SCROLL') out.pop();

  // Rule 6 — drop a duplicate initial NAVIGATE.
  if (out.length >= 2 && out[0].type === 'NAVIGATE' && out[1].type === 'NAVIGATE') {
    const u0 = (out[0].input?.url ?? '') as string;
    const u1 = (out[1].input?.url ?? '') as string;
    if (u0 === u1) out.shift();
  }

  // Renumber so the saved indices are contiguous.
  return out.map((s, i) => ({ ...s, index: i }));
}

function coalesceFillBursts(steps: CapturedStep[]): CapturedStep[] {
  const out: CapturedStep[] = [];
  for (const s of steps) {
    if (s.type === 'FILL' && out.length > 0) {
      const prev = out[out.length - 1];
      if (
        prev.type === 'FILL' &&
        (prev.input?.selector ?? null) === (s.input?.selector ?? null)
      ) {
        // Replace prev with the newer value. Keep prev's name to avoid a
        // visual flicker in the live list.
        out[out.length - 1] = { ...prev, input: { ...prev.input, value: s.input?.value } };
        continue;
      }
    }
    out.push(s);
  }
  return out;
}

function dropFillBeforeFormControl(steps: CapturedStep[]): CapturedStep[] {
  const drop = new Set<number>();
  const FORM_CONTROL_TYPES = new Set(['SELECT', 'CHECK', 'UNCHECK']);
  for (let i = 0; i < steps.length - 1; i++) {
    const cur = steps[i];
    const next = steps[i + 1];
    if (cur.type !== 'FILL' || !FORM_CONTROL_TYPES.has(next.type)) continue;
    const a = (cur.input?.selector ?? '') as string;
    const b = (next.input?.selector ?? '') as string;
    if (a && a === b) drop.add(i);
  }
  return steps.filter((_, i) => !drop.has(i));
}

function dropHoverBeforeClick(steps: CapturedStep[]): CapturedStep[] {
  const drop = new Set<number>();
  for (let i = 0; i < steps.length - 1; i++) {
    const cur = steps[i];
    const next = steps[i + 1];
    if (cur.type === 'HOVER' && next.type === 'CLICK') {
      const a = (cur.input?.selector ?? '') as string;
      const b = (next.input?.selector ?? '') as string;
      if (a && a === b) drop.add(i);
    }
  }
  return steps.filter((_, i) => !drop.has(i));
}

function dropScrollAroundClick(steps: CapturedStep[]): CapturedStep[] {
  const drop = new Set<number>();
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].type !== 'SCROLL') continue;
    const t = steps[i].capturedAt ? Date.parse(steps[i].capturedAt!) : 0;
    // Look ±1 step for a CLICK within 400ms.
    for (const j of [i - 1, i + 1]) {
      const neighbour = steps[j];
      if (!neighbour || neighbour.type !== 'CLICK') continue;
      const tn = neighbour.capturedAt ? Date.parse(neighbour.capturedAt) : 0;
      if (Math.abs(tn - t) <= 400) drop.add(i);
    }
  }
  return steps.filter((_, i) => !drop.has(i));
}

// ── Tokenisation suggestions ──────────────────────────────────────────────

export interface TokenSuggestion {
  literal: string;
  token: string;
  reason: string;
}

/**
 * Walk every captured value/url and find literals that should become
 * variables. A test that hardcodes "https://staging.foo" or your own
 * email won't survive being run by anyone else; surfacing these at save
 * time prevents the brittle-test trap.
 */
export function suggestTokenisations(steps: CapturedStep[], envBaseUrl: string): TokenSuggestion[] {
  const suggestions = new Map<string, TokenSuggestion>();
  const baseHost = safeHost(envBaseUrl);

  for (const s of steps) {
    if (!s.input) continue;
    for (const v of Object.values(s.input)) {
      if (typeof v !== 'string' || v.length === 0) continue;

      // Env baseUrl host appearing in any value → {{BASE_URL}}
      if (baseHost && v.includes(baseHost)) {
        const literal = stripToHost(v, baseHost);
        if (literal) {
          suggestions.set(literal, {
            literal,
            token: '{{BASE_URL}}',
            reason: 'Matches the active environment\'s host — tokenise so the test plays back against any env.',
          });
        }
      }

      // JWT-shaped strings → {{TOKEN}}
      if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(v)) {
        suggestions.set(v, {
          literal: v,
          token: '{{TOKEN}}',
          reason: 'Looks like a JWT — should be supplied at runtime, not hardcoded.',
        });
      }

      // UUIDs → {{ENTITY_ID}} (just flag; user picks if it matters)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
        suggestions.set(v, {
          literal: v,
          token: '{{ENTITY_ID}}',
          reason: 'Looks like a UUID — likely refers to a record that won\'t exist on other envs.',
        });
      }

      // Email-shaped → {{TEST_EMAIL}}
      if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
        suggestions.set(v, {
          literal: v,
          token: '{{TEST_EMAIL}}',
          reason: 'Email address — usually the test user\'s account. Tokenise per-env.',
        });
      }
    }
  }
  return Array.from(suggestions.values());
}

function safeHost(url: string): string | null {
  try { return new URL(url).host; } catch { return null; }
}

function stripToHost(value: string, host: string): string | null {
  // Find the protocol + host slice we actually want to tokenise. Returns
  // the maximal substring centred on `host` so we replace the URL prefix
  // not the path that follows.
  const m = value.match(new RegExp(`https?:\\/\\/${escapeRe(host)}`));
  return m ? m[0] : null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
