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

// ── South-African test-data helpers ──────────────────────────────────────

/** Standard Luhn (mod-10) check digit for a numeric string. SA IDs use this. */
function luhnCheckDigit(digits: string): number {
  let sum = 0;
  let dbl = true; // rightmost existing digit is doubled (check digit appended after)
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (dbl) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** A random date of birth (Date) for an age within [minAge, maxAge]. */
function randomDob(minAge: number, maxAge: number): Date {
  const now = new Date();
  const lo = Math.min(minAge, maxAge);
  const hi = Math.max(minAge, maxAge);
  const age = lo + Math.floor(Math.random() * (hi - lo + 1));
  const year = now.getFullYear() - age;
  const month = Math.floor(Math.random() * 12); // 0-11
  const day = 1 + Math.floor(Math.random() * 28); // 1-28, always valid
  return new Date(year, month, day);
}

/** Parse a "min-max" age arg (e.g. "18-65"); falls back to [18, 65]. */
function parseAgeRange(arg?: string): [number, number] {
  const m = (arg ?? '').match(/^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/);
  if (!m) return [18, 65];
  return [Number(m[1]), Number(m[2])];
}

/**
 * Generate a fully valid 13-digit South-African ID number:
 *   YYMMDD (DOB) + SSSS (gender; <5000 female, >=5000 male) + C (citizenship;
 *   0 = SA citizen) + A (8) + Z (Luhn check digit). Passes real SA ID validators.
 */
function generateSaId(arg?: string): string {
  const dob = randomDob(...parseAgeRange(arg));
  const yy = pad2(dob.getFullYear() % 100);
  const mm = pad2(dob.getMonth() + 1);
  const dd = pad2(dob.getDate());
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, '0'); // gender
  const citizenship = '0';
  const a = '8';
  const first12 = `${yy}${mm}${dd}${seq}${citizenship}${a}`;
  return `${first12}${luhnCheckDigit(first12)}`;
}

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
  // South-African data
  'id.sa': (arg) => generateSaId(arg),
  dob: (arg) => randomDob(...parseAgeRange(arg)).toISOString().slice(0, 10),
  'phone.sa': () => `+27${pick(['6', '7', '8'])}${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
  'passport.sa': () => `${pick([...'ABCDEFGHJKLMNPRTVWXYZ'])}${String(Math.floor(Math.random() * 100_000_000)).padStart(8, '0')}`,
};

/** Lookup table for the help popover / docs. Public so callers can list. */
export const GENERATOR_KEYS = Object.keys(GENERATORS).map(k => `$${k}`);

/**
 * Run a single generator by key (e.g. 'email', 'id.sa'). Powers the SCRIPT
 * sandbox's `data.*` helpers, which want fresh values per call rather than the
 * memoised `{{$token}}` step interpolation.
 */
export function generate(key: string, arg?: string): string {
  const fn = GENERATORS[key];
  if (!fn) throw new Error(`Unknown data generator: ${key}`);
  return fn(arg);
}

/**
 * Display metadata for the token picker UI. The worker is the source of truth
 * for the generator logic; this drives what the editor offers for insertion.
 */
export const GENERATOR_META: Array<{ token: string; label: string; arg?: string }> = [
  { token: '$email', label: 'Random email address' },
  { token: '$password', label: 'Strong password', arg: 'length' },
  { token: '$uuid', label: 'UUID v4' },
  { token: '$timestamp', label: 'ISO timestamp' },
  { token: '$epoch', label: 'Unix epoch (ms)' },
  { token: '$randomString', label: 'Random hex string', arg: 'length' },
  { token: '$randomInt', label: 'Random integer', arg: 'max' },
  { token: '$phone', label: 'US phone number' },
  { token: '$name.first', label: 'First name' },
  { token: '$name.last', label: 'Last name' },
  { token: '$name.full', label: 'Full name' },
  { token: '$date', label: "Today's date (YYYY-MM-DD)" },
  { token: '$id.sa', label: 'Valid SA ID number', arg: 'minAge-maxAge' },
  { token: '$dob', label: 'Date of birth', arg: 'minAge-maxAge' },
  { token: '$phone.sa', label: 'SA mobile number (+27)' },
  { token: '$passport.sa', label: 'SA passport number' },
];

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
