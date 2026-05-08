import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { pluginsApi } from '@/lib/api';

/**
 * Dropdown backed by `listEntities` dispatch.
 *
 * Disabled until every key in `parent` has a non-empty value — that's how
 * cascades like workspace → space → folder → list stay sane: you can't pick a
 * space until you've chosen a workspace.
 *
 * Keeps its own search query in local state but doesn't debounce — ClickUp's
 * `listEntities` is light enough on the server side and the UI feels snappier
 * with immediate filtering (we filter client-side for the tiny lists we get).
 */
export function CascadingSelect({
  label,
  helpText,
  orgId,
  installId,
  kind,
  parent,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  helpText?: string;
  orgId: string;
  installId: string;
  kind: string;
  parent?: Record<string, string | null | undefined>;
  value: string | null;
  onChange: (id: string | null, label: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');

  // Cascade gate — every parent key must be set before we fetch.
  const ready = useMemo(() => {
    if (!parent) return true;
    for (const v of Object.values(parent)) {
      if (v === null || v === undefined || v === '') return false;
    }
    return true;
  }, [parent]);

  const q = useQuery({
    queryKey: ['plugins', 'listEntities', installId, kind, parent],
    queryFn: () =>
      pluginsApi.dispatch<{ items: { id: string; label: string }[] }>(orgId, installId, {
        capability: 'listEntities',
        payload: { kind, parent: stripFalsy(parent ?? {}) },
      }),
    enabled: ready && !disabled,
    staleTime: 60_000,
  });

  // When the parent changes, clear our value if it's no longer valid.
  useEffect(() => {
    if (!q.data?.items || !value) return;
    const stillExists = q.data.items.some((i) => i.id === value);
    if (!stillExists) onChange(null, '');
  }, [q.data, value, onChange]);

  const items = q.data?.items ?? [];
  const filtered = query
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : items;

  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">{label}</span>
      <div className="relative mt-1">
        <select
          value={value ?? ''}
          onChange={(e) => {
            const id = e.target.value;
            const item = items.find((i) => i.id === id);
            onChange(id || null, item?.label ?? '');
          }}
          disabled={disabled || !ready || q.isLoading}
          className="block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          <option value="">
            {q.isLoading
              ? 'Loading…'
              : !ready
                ? `Pick the parent first`
                : (placeholder ?? `Choose ${label.toLowerCase()}…`)}
          </option>
          {filtered.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        {q.isFetching && !q.isLoading && (
          <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-purple-300" />
        )}
      </div>
      {items.length > 8 && (
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-1 block w-full bg-slate-900/40 border border-slate-700/60 rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-500"
        />
      )}
      {helpText && <p className="text-[11px] text-slate-500 mt-1">{helpText}</p>}
      {q.isError && (
        <p className="text-[11px] text-amber-300 mt-1">
          Failed to load — check the install&apos;s healthcheck.
        </p>
      )}
    </label>
  );
}

function stripFalsy(o: Record<string, string | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v) out[k] = v;
  return out;
}
