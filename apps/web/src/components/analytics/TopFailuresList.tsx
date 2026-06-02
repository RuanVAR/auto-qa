/**
 * Generic "top N entities by failures" list. Re-used for feature / module /
 * project rollups since they all have the same {name, total, failed,
 * passRate} shape after their rollup query.
 *
 * Rows are clickable when `onSelect` is provided — used by the dashboard
 * to drill in: click a feature row → set featureId filter; click a module
 * row → setModuleId; click a project row → setProjectId. The clicked row
 * gets a highlight ring so it's clear what filter is active.
 */
interface Row {
  /** Stable key for React + identity passed to onSelect. */
  id: string;
  name: string;
  /** Optional secondary line (e.g. module name on a feature row). */
  sub?: string;
  total: number;
  failed: number;
  passRate: number | null;
}
interface Props {
  title: string;
  data: Row[];
  /** Empty-state message. */
  emptyLabel?: string;
  /** Make rows clickable. Receives the row id. */
  onSelect?: (id: string) => void;
  /** id of the row currently set as a filter — gets a highlight ring. */
  selectedId?: string | null;
}
export function TopFailuresList({ title, data, emptyLabel = 'No data yet', onSelect, selectedId }: Props) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: 'rgba(238,238,248,0.85)' }}>
        {title}
      </p>
      {data.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          {emptyLabel}
        </div>
      ) : (
        <ul className="text-xs space-y-1">
          {data.map((r, i) => {
            // Pass-rate dot — green/amber/red based on absolute thresholds
            // so users get instant signal without reading the number.
            const pr = r.passRate ?? -1;
            const dotColor = pr >= 80 ? '#34d399' : pr >= 50 ? '#fbbf24' : '#f87171';
            const isSelected = selectedId === r.id;
            const isClickable = !!onSelect;
            return (
              <li
                key={r.id}
                onClick={isClickable ? () => onSelect?.(r.id) : undefined}
                className={[
                  'flex items-center gap-3 px-2 py-1.5 rounded-lg',
                  isClickable ? 'cursor-pointer transition-colors hover:bg-white/[0.06]' : '',
                ].join(' ')}
                title={isClickable ? `Filter by ${r.name}` : undefined}
                style={{
                  background: isSelected
                    ? 'rgba(var(--accent-rgb),0.14)'
                    : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                  border: isSelected ? '1px solid rgba(var(--accent-rgb),0.40)' : '1px solid transparent',
                }}
              >
                <span className="text-[10px] tabular-nums w-5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  {i + 1}.
                </span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: dotColor }} />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium" style={{ color: 'rgba(238,238,248,0.85)' }}>{r.name}</div>
                  {r.sub && (
                    <div className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.45)' }}>{r.sub}</div>
                  )}
                </div>
                <span className="tabular-nums" style={{ color: '#f87171' }}>{r.failed}</span>
                <span className="tabular-nums opacity-60" style={{ color: 'rgba(238,238,248,0.55)' }}>/ {r.total}</span>
                {pr >= 0 && (
                  <span className="tabular-nums w-12 text-right" style={{ color: dotColor }}>
                    {pr}%
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
