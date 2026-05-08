/**
 * Resolve effective binding config by deep-merging a stack of layers.
 *
 * Order is most-specific FIRST, falling back to less-specific. Typical call:
 *
 *     effectiveConfig(featureBinding, moduleBinding, projectBinding, pluginDefaults)
 *
 * Semantics:
 *   - `null` or `undefined` at any layer means "inherit from below".
 *     This is how a feature override clears its own value back to the module/project default.
 *   - Plain objects deep-merge.
 *   - Arrays REPLACE entirely. Concatenation would silently mix scope-specific
 *     and inherited entries, which is rarely the intent and very hard to undo.
 *   - Primitives (string/number/bool) override.
 *
 * The function is pure — no allocations on the input layers — and returns a
 * new object that callers can freeze if they wish.
 */
export function effectiveConfig<T extends Record<string, unknown>>(
  ...layersFromMostToLeastSpecific: Array<Partial<T> | null | undefined>
): T {
  // Walk from least-specific (last arg) toward most-specific (first arg) so
  // each subsequent override layers on top of the accumulator.
  const layers = [...layersFromMostToLeastSpecific].reverse();
  let acc: Record<string, unknown> = {};
  for (const layer of layers) {
    acc = mergeLayer(acc, layer);
  }
  return acc as T;
}

function mergeLayer(
  base: Record<string, unknown>,
  override: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (override == null) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const ov = override[key];
    // Explicit null/undefined = "inherit" — don't overwrite the base value.
    if (ov === null || ov === undefined) continue;

    if (Array.isArray(ov)) {
      // Arrays replace.
      out[key] = [...ov];
      continue;
    }

    if (isPlainObject(ov)) {
      const baseVal = base[key];
      if (isPlainObject(baseVal)) {
        out[key] = mergeLayer(
          baseVal as Record<string, unknown>,
          ov as Record<string, unknown>,
        );
      } else {
        // Override a primitive with an object — replace.
        out[key] = deepClone(ov);
      }
      continue;
    }

    // Primitive override.
    out[key] = ov;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(deepClone) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>)) {
    out[k] = deepClone((v as Record<string, unknown>)[k]);
  }
  return out as T;
}
