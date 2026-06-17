import type { Step, StepType } from '../types';
import { isStableSelector } from '../types';
import { DslError } from './types';

/**
 * Tokenize the argument portion of a step line into an ordered list of tokens.
 * Double-quoted strings (with \" escapes) become one token; bare runs of
 * non-whitespace become a token each. Examples:
 *   `"[data-testid=email]" "{{X}}"` → ['[data-testid=email]', '{{X}}']
 *   `contains "Welcome"`            → ['contains', 'Welcome']
 *   `count 5`                       → ['count', '5']
 */
export function tokenizeArgs(rest: string, line: number): string[] {
  const tokens: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    if (m[1] !== undefined) tokens.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    else tokens.push(m[2]);
  }
  return tokens;
}

/** Escape a string for emission as a double-quoted DSL token. */
export function quote(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function requireSelector(sel: string | undefined, line: number): string {
  if (!sel) throw new DslError('expected a selector', line);
  if (!isStableSelector(sel)) {
    throw new DslError(
      `unstable selector "${sel}". Use [data-testid=…], [role=…], getByText(…), #id, or input[name|placeholder|aria-label=…] — raw CSS is not allowed.`,
      line,
    );
  }
  return sel;
}

type ParsedStep = { type: StepType; input: Record<string, unknown> };

/**
 * Parse one step line (verb + args) into a canonical {type, input}. Recognizes
 * friendly verbs; falls back to `step <TYPE> {json}` for anything else so every
 * step type round-trips. Throws DslError on malformed input / brittle selectors.
 */
export function parseStepLine(line: string, lineNo: number): ParsedStep {
  const trimmed = line.trim();
  const spaceIdx = trimmed.search(/\s/);
  const verb = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const a = tokenizeArgs(rest, lineNo);

  switch (verb) {
    case 'navigate':
    case 'goto':
      if (!a[0]) throw new DslError('navigate expects a url', lineNo);
      return { type: 'NAVIGATE', input: { url: a[0] } };
    case 'click':
      return { type: 'CLICK', input: { selector: requireSelector(a[0], lineNo) } };
    case 'dblclick':
      return { type: 'DBLCLICK', input: { selector: requireSelector(a[0], lineNo) } };
    case 'hover':
      return { type: 'HOVER', input: { selector: requireSelector(a[0], lineNo) } };
    case 'fill':
      return { type: 'FILL', input: { selector: requireSelector(a[0], lineNo), value: a[1] ?? '' } };
    case 'type':
      return { type: 'TYPE', input: { selector: requireSelector(a[0], lineNo), text: a[1] ?? '' } };
    case 'clear':
      return { type: 'CLEAR', input: { selector: requireSelector(a[0], lineNo) } };
    case 'select':
      return { type: 'SELECT', input: { selector: requireSelector(a[0], lineNo), value: a[1] ?? '' } };
    case 'check':
      return { type: 'CHECK', input: { selector: requireSelector(a[0], lineNo) } };
    case 'uncheck':
      return { type: 'UNCHECK', input: { selector: requireSelector(a[0], lineNo) } };
    case 'press':
      if (!a[0]) throw new DslError('press expects a key', lineNo);
      return { type: 'PRESS_KEY', input: { key: a[0] } };
    case 'scroll':
      return { type: 'SCROLL', input: a[0] ? { selector: requireSelector(a[0], lineNo) } : {} };
    case 'screenshot':
      return { type: 'SCREENSHOT', input: a[0] ? { name: a[0] } : {} };
    case 'wait': {
      const ms = Number(a[0]);
      if (!Number.isFinite(ms)) throw new DslError('wait expects a number of milliseconds', lineNo);
      return { type: 'WAIT_MS', input: { ms } };
    }
    case 'waitfor':
      return { type: 'WAIT_FOR_SELECTOR', input: { selector: requireSelector(a[0], lineNo), state: 'visible' } };
    case 'assert':
      return parseAssert(a, lineNo);
    case 'step': {
      // Generic escape hatch: `step <TYPE> {json}` for any non-friendly step.
      const type = (a[0] ?? '').toUpperCase();
      const jsonStart = rest.indexOf('{');
      let input: Record<string, unknown> = {};
      if (jsonStart !== -1) {
        try {
          input = JSON.parse(rest.slice(jsonStart));
        } catch {
          throw new DslError('step <TYPE> {json} — input is not valid JSON', lineNo);
        }
      }
      return { type: type as StepType, input };
    }
    default:
      throw new DslError(`unknown step verb "${verb}"`, lineNo);
  }
}

function parseAssert(a: string[], lineNo: number): ParsedStep {
  const kind = (a[0] ?? '').toLowerCase();
  switch (kind) {
    case 'text': {
      // assert text "<sel>" [contains|exact|regex] "<value>"
      const selector = requireSelector(a[1], lineNo);
      let matchMode = 'contains';
      let value: string;
      if (['contains', 'exact', 'regex'].includes((a[2] ?? '').toLowerCase())) {
        matchMode = a[2].toLowerCase();
        value = a[3] ?? '';
      } else {
        value = a[2] ?? '';
      }
      return { type: 'ASSERT_TEXT', input: { selector, text: value, matchMode } };
    }
    case 'visible':
      return { type: 'ASSERT_VISIBLE', input: { selector: requireSelector(a[1], lineNo), visible: true } };
    case 'hidden':
      return { type: 'ASSERT_VISIBLE', input: { selector: requireSelector(a[1], lineNo), visible: false } };
    case 'value':
      return { type: 'ASSERT_VALUE', input: { selector: requireSelector(a[1], lineNo), value: a[2] ?? '', matchMode: 'exact' } };
    case 'url': {
      // assert url [contains|exact] "<value>"
      let matchMode = 'contains';
      let value: string;
      if (['contains', 'exact'].includes((a[1] ?? '').toLowerCase())) {
        matchMode = a[1].toLowerCase();
        value = a[2] ?? '';
      } else {
        value = a[1] ?? '';
      }
      return { type: 'ASSERT_URL', input: { url: value, matchMode } };
    }
    case 'element': {
      // assert element "<sel>" [count <n>]
      const selector = requireSelector(a[1], lineNo);
      const input: Record<string, unknown> = { selector };
      if ((a[2] ?? '').toLowerCase() === 'count' && a[3] !== undefined) {
        const n = Number(a[3]);
        if (!Number.isFinite(n)) throw new DslError('assert element count expects a number', lineNo);
        input.count = n;
      }
      return { type: 'ASSERT_ELEMENT', input };
    }
    default:
      throw new DslError(`unknown assertion "${kind}" (expected text|visible|hidden|value|url|element)`, lineNo);
  }
}

/** Deterministic, human-readable name for a step (derived, not stored prose). */
export function defaultStepName(type: StepType, input: Record<string, unknown>): string {
  const sel = typeof input.selector === 'string' ? input.selector : '';
  switch (type) {
    case 'NAVIGATE': return `Navigate to ${input.url ?? ''}`.trim();
    case 'CLICK': return `Click ${sel}`.trim();
    case 'DBLCLICK': return `Double-click ${sel}`.trim();
    case 'HOVER': return `Hover ${sel}`.trim();
    case 'FILL': return `Fill ${sel}`.trim();
    case 'TYPE': return `Type into ${sel}`.trim();
    case 'CLEAR': return `Clear ${sel}`.trim();
    case 'SELECT': return `Select ${input.value ?? ''} in ${sel}`.trim();
    case 'CHECK': return `Check ${sel}`.trim();
    case 'UNCHECK': return `Uncheck ${sel}`.trim();
    case 'PRESS_KEY': return `Press ${input.key ?? ''}`.trim();
    case 'SCROLL': return sel ? `Scroll to ${sel}` : 'Scroll';
    case 'SCREENSHOT': return input.name ? `Screenshot ${input.name}` : 'Screenshot';
    case 'WAIT_MS': return `Wait ${input.ms ?? 0}ms`;
    case 'WAIT_FOR_SELECTOR': return `Wait for ${sel}`.trim();
    case 'ASSERT_TEXT': return `Assert text in ${sel}`.trim();
    case 'ASSERT_VISIBLE': return `${input.visible === false ? 'Assert hidden' : 'Assert visible'} ${sel}`.trim();
    case 'ASSERT_VALUE': return `Assert value of ${sel}`.trim();
    case 'ASSERT_URL': return 'Assert URL';
    case 'ASSERT_ELEMENT': return `Assert element ${sel}`.trim();
    default: return type;
  }
}

/** Serialize one step to a DSL line (friendly verb where possible). */
export function stepToLine(step: Step): string {
  const i = step.input ?? {};
  const sel = typeof i.selector === 'string' ? i.selector : '';
  switch (step.type) {
    case 'NAVIGATE': return `navigate ${quote(String(i.url ?? ''))}`;
    case 'CLICK': return `click ${quote(sel)}`;
    case 'DBLCLICK': return `dblclick ${quote(sel)}`;
    case 'HOVER': return `hover ${quote(sel)}`;
    case 'FILL': return `fill ${quote(sel)} ${quote(String(i.value ?? ''))}`;
    case 'TYPE': return `type ${quote(sel)} ${quote(String(i.text ?? i.value ?? ''))}`;
    case 'CLEAR': return `clear ${quote(sel)}`;
    case 'SELECT': return `select ${quote(sel)} ${quote(String(i.value ?? ''))}`;
    case 'CHECK': return `check ${quote(sel)}`;
    case 'UNCHECK': return `uncheck ${quote(sel)}`;
    case 'PRESS_KEY':
    case 'KEYBOARD': return `press ${quote(String(i.key ?? ''))}`;
    case 'SCROLL': return sel ? `scroll ${quote(sel)}` : 'scroll';
    case 'SCREENSHOT': return i.name ? `screenshot ${quote(String(i.name))}` : 'screenshot';
    case 'WAIT_MS':
    case 'WAIT': return `wait ${Number(i.ms ?? i.duration ?? 0)}`;
    case 'WAIT_FOR_SELECTOR': return `waitfor ${quote(sel)}`;
    case 'ASSERT_TEXT':
      return `assert text ${quote(sel)} ${String(i.matchMode ?? 'contains')} ${quote(String(i.text ?? i.expectedText ?? ''))}`;
    case 'ASSERT_VISIBLE':
      return `assert ${i.visible === false ? 'hidden' : 'visible'} ${quote(sel)}`;
    case 'ASSERT_VALUE':
      return `assert value ${quote(sel)} ${quote(String(i.value ?? ''))}`;
    case 'ASSERT_URL':
      return `assert url ${String(i.matchMode ?? 'contains')} ${quote(String(i.url ?? i.expectedUrl ?? ''))}`;
    case 'ASSERT_ELEMENT':
      return i.count !== undefined ? `assert element ${quote(sel)} count ${Number(i.count)}` : `assert element ${quote(sel)}`;
    default:
      // Generic escape hatch keeps every step type representable + round-trips.
      return `step ${step.type} ${JSON.stringify(i)}`;
  }
}
