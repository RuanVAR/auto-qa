/**
 * Secret scrubbing for anything leaving the system — error reports, logs,
 * persisted evidence.
 *
 * This lives in `shared` rather than beside a single caller on purpose. The
 * worker interpolates real customer credentials into step inputs, so the same
 * redaction has to apply in the API, in the worker, and anywhere else a payload
 * is externalised. Two copies of this logic would drift, and the failure mode of
 * drift is shipping a password to a third party.
 *
 * Pure functions with no dependencies, so it is safe to import from a browser
 * bundle as well as from Node.
 */

/** Keys whose values are replaced wholesale, matched case-insensitively. */
export const SECRET_KEY_PATTERN =
  /pass|secret|token|key|auth|credential|cookie|session|bearer/i;

/**
 * Values that look like credentials regardless of the key they arrived under.
 * Ordered roughly by how catastrophic a leak would be.
 */
export const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[\w.\-]+/gi, // authorization headers
  /\beyJ[\w-]*\.[\w-]*\.[\w-]*/g, // JWTs
  /\bqapt_[A-Za-z0-9]{20,}/g, // our own API tokens
  // Both OpenAI shapes: the legacy `sk-<40 chars>` and the current
  // `sk-proj-<...>`, which embeds hyphens — a character class without `-`
  // silently matches neither the project form nor anything after its first dash.
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bGOCSPX-[\w-]+/g, // Google client secrets
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub tokens (PAT, OAuth, user, server, refresh)
  /\bpostgres(?:ql)?:\/\/[^\s"']+/gi, // connection strings
  /\bredis:\/\/[^\s"']+/gi,
];

export const REDACTED = '[redacted]';

/** Redact credential-shaped substrings from a single string. */
export const scrubString = (s: string): string =>
  SECRET_VALUE_PATTERNS.reduce((acc, re) => acc.replace(re, REDACTED), s);

/**
 * Walk an arbitrary structure, redacting by key name and by value shape.
 *
 * Depth-limited because payloads can nest deeply (request bodies, Prisma
 * errors) and this runs on the error path — it must never become the reason a
 * request hangs.
 */
export const scrubDeep = (value: unknown, depth = 0): unknown => {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') return scrubString(value);
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : scrubDeep(v, depth + 1);
    }
    return out;
  }
  return value;
};
