/**
 * ClickUp has no native "epic" — workspaces model it as a custom field on the
 * task (e.g. "MPOWA Epic", a coloured drop_down). These helpers locate that
 * field by name (case-insensitive contains "epic") and coerce its value to a
 * display label + colour. Shared by the feature status endpoint and the
 * inbound-sync service so the cached epic snapshot stays consistent.
 */

export type EpicCustomField = {
  name: string;
  type: string;
  value?: unknown;
  typeConfig?: {
    options?: Array<{ id?: string; name?: string; label?: string; color?: string | null; orderindex?: number }>;
  };
};

/**
 * Resolve the "epic" custom field to a display label + colour.
 *
 * Value shapes handled:
 *   - drop_down  → value is the selected option's orderindex / id → resolved
 *                  to its label + colour via typeConfig.options
 *   - labels     → array of option ids → resolved + joined
 *   - text/number→ used as-is
 *   - relationship/tasks → array of {name} → joined
 * Returns null when there's no epic field or it has no value.
 */
export function extractEpicFromCustomFields(
  fields?: EpicCustomField[],
): { name: string; color?: string } | null {
  if (!fields?.length) return null;
  const field = fields.find((f) => f.name?.toLowerCase().includes('epic'));
  const v = field?.value;
  if (!field || v === null || v === undefined || v === '') return null;

  const options = field.typeConfig?.options ?? [];
  const labelOf = (o?: { name?: string; label?: string; id?: string }) => o?.name ?? o?.label ?? o?.id;
  const resolveOption = (raw: unknown): { name: string; color?: string } | null => {
    const o = options.find(
      (op) => op.id === raw || op.orderindex === raw || String(op.orderindex) === String(raw),
    );
    if (!o) return null;
    return { name: labelOf(o) ?? String(raw), color: o.color ?? undefined };
  };

  // drop_down — value is a single option index/id.
  if (field.type === 'drop_down') {
    const r = resolveOption(v);
    if (r) return r;
  }
  // labels — value is an array of option ids.
  if (field.type === 'labels' && Array.isArray(v)) {
    const opts = v.map(resolveOption).filter((o): o is { name: string; color?: string } => !!o);
    if (opts.length) return { name: opts.map((o) => o.name).join(', '), color: opts[0].color };
  }

  // Plain scalar.
  if (typeof v === 'string' || typeof v === 'number') return { name: String(v) };

  // Relationship / tasks — array (or object) of {name|label}.
  const nameOf = (item: unknown): string | null => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      return (o.name as string) ?? (o.label as string) ?? null;
    }
    return null;
  };
  if (Array.isArray(v)) {
    const names = v.map(nameOf).filter((n): n is string => !!n);
    return names.length ? { name: names.join(', ') } : null;
  }
  const single = nameOf(v);
  return single ? { name: single } : null;
}
