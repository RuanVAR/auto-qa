/**
 * Clamp a user-supplied `limit` query param.
 *
 * List endpoints previously did `limit ? Number(limit) : 50` with no upper
 * bound, so a caller could request `?limit=1000000` and force a huge, slow
 * query (DoS + memory pressure). This clamps every limit to a sane ceiling.
 *
 * Returns `opts.def` when nothing usable was supplied (so callers that pass
 * `def: undefined` keep letting the service apply its own default), otherwise
 * a value in `[1, max]`.
 */
export function clampLimit(raw: unknown, opts: { def: number; max?: number }): number;
export function clampLimit(raw: unknown, opts?: { def?: number; max?: number }): number | undefined;
export function clampLimit(
  raw: unknown,
  opts: { def?: number; max?: number } = {},
): number | undefined {
  const max = opts.max ?? 100;
  if (raw === undefined || raw === null || raw === '') return opts.def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return opts.def;
  return Math.min(Math.floor(n), max);
}
