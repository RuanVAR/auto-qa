/**
 * Variable interpolation with built-in data generators.
 *
 * Token grammar inside test step inputs:
 *   {{KEY}}             — looks up `vars[KEY]`. Empty string if absent.
 *   {{$generator}}      — generator token (see GENERATORS below). First
 *                         occurrence within a runner mints a fresh value;
 *                         every subsequent reference in the same run
 *                         resolves to the SAME value. This is critical:
 *                         if step 2 fills {{$email}} into a register form
 *                         and step 5 fills {{$email}} into a login form,
 *                         they must match.
 *   {{$generator(arg)}} — generator with arity (e.g. {{$randomString(12)}}).
 *
 * The walker is recursive over strings/arrays/objects so a step input like
 *   { value: '{{$email}}', headers: { 'X-User': '{{USER_ID}}' } }
 * is fully resolved.
 */

import { randomBytes, randomUUID } from 'node:crypto';

export interface InterpolationContext {
  variables: Record<string, string>;
  /** Memoised generator outputs — first reference mints, rest reuse. */
  generated: Record<string, string>;
}

const FIRST_NAMES = [
  'Alex', 'Bailey', 'Casey', 'Dylan', 'Ellis', 'Frankie', 'Gray', 'Harper',
  'Indigo', 'Jamie', 'Kai', 'Lane', 'Morgan', 'Noah', 'Oakley', 'Parker',
];
const LAST_NAMES = [
  'Avery', 'Bennett', 'Carter', 'Dawson', 'Ellis', 'Foster', 'Grant', 'Hayes',
  'Ingram', 'Jensen', 'Knox', 'Lowe', 'Marsh', 'Nash', 'Ortiz', 'Park',
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

const GENERATORS: Record<string, (arg?: string) => string> = {
  email: () => `qa.${randomBytes(4).toString('hex')}@example.test`,
  password: (arg) => {
    const len = Math.max(8, Math.min(64, Number(arg) || 12));
    // 1 upper + 1 lower + 1 digit + 1 symbol guaranteed; rest random.
    const u = 'ABCDEFGHJKLMNPQRSTUVWXYZ', l = 'abcdefghijkmnpqrstuvwxyz', d = '23456789', s = '!@#$%&*';
    const all = u + l + d + s;
    let out = pick([...u]) + pick([...l]) + pick([...d]) + pick([...s]);
    while (out.length < len) out += all[Math.floor(Math.random() * all.length)];
    return out;
  },
  uuid: () => randomUUID(),
  timestamp: () => new Date().toISOString(),
  // Unix epoch ms — useful for unique tags/names.
  epoch: () => String(Date.now()),
  randomString: (arg) => {
    const len = Math.max(1, Math.min(64, Number(arg) || 8));
    return randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  },
  randomInt: (arg) => {
    const max = Math.max(1, Number(arg) || 1_000_000);
    return String(Math.floor(Math.random() * max));
  },
  phone: () => `+1555${Math.floor(Math.random() * 10_000_000).toString().padStart(7, '0')}`,
  'name.first': () => pick(FIRST_NAMES),
  'name.last': () => pick(LAST_NAMES),
  'name.full': () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
  date: () => new Date().toISOString().slice(0, 10),
};

/** Lookup table for the help popover / docs. Public so callers can list. */
export const GENERATOR_KEYS = Object.keys(GENERATORS).map(k => `$${k}`);

/**
 * Resolve a single `{{...}}` token. Returns the string value, or '' if the
 * token references an unknown variable (matches the legacy interpolate
 * behaviour — see step.runner.ts before this refactor).
 */
function resolveToken(rawToken: string, ctx: InterpolationContext): string {
  const token = rawToken.trim();
  if (!token.startsWith('$')) {
    // Plain variable reference.
    return ctx.variables[token] ?? '';
  }
  // Generator: $name OR $name(arg)
  const m = token.match(/^\$([\w.]+)(?:\(([^)]*)\))?$/);
  if (!m) return '';
  const [, name, arg] = m;
  const fn = GENERATORS[name];
  if (!fn) return '';
  // Memoise: same generator+arg returns the same value within a run.
  // Without this, {{$email}} on step 2 (register) and step 5 (login)
  // would be different addresses — useless for round-trip flows.
  const memoKey = arg ? `$${name}(${arg})` : `$${name}`;
  if (ctx.generated[memoKey] === undefined) ctx.generated[memoKey] = fn(arg);
  return ctx.generated[memoKey];
}

/** Interpolate every {{...}} token in a string. */
export function interpolateString(s: string, ctx: InterpolationContext): string {
  return s.replace(/\{\{([^}]+)\}\}/g, (_, token) => resolveToken(token, ctx));
}

/**
 * Recursively interpolate every string in an object/array tree. Returns a
 * fresh structure — does not mutate the input.
 */
export function interpolateValue(value: unknown, ctx: InterpolationContext): unknown {
  if (typeof value === 'string') return interpolateString(value, ctx);
  if (Array.isArray(value)) return value.map(v => interpolateValue(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, interpolateValue(v, ctx)]),
    );
  }
  return value;
}
