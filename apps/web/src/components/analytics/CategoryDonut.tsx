import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { failureCategoryMeta } from '@/lib/failureCategories';

/**
 * Reusable donut for category breakdowns — used for both
 * TestRun.failureCategory and Issue.category since they share the
 * TestFailureCategory enum. Falls back to neutral grey for null values
 * (legacy runs / issues without a category set).
 */
interface Props {
  title: string;
  data: Array<{ category: string | null; count: number }>;
  /** "Failure reasons" vs "Bug reasons" — drives the empty-state copy. */
  emptyLabel?: string;
  /** Click a slice / legend row to filter the rest of the dashboard. */
  onSelect?: (category: string) => void;
  /** Highlight the slice currently being used as a filter. */
  selectedCategory?: string | null;
}
export function CategoryDonut({ title, data, emptyLabel = 'No data yet', onSelect, selectedCategory }: Props) {
  const isClickable = !!onSelect;
  const items = data
    .filter((d) => d.count > 0)
    .map((d) => {
      const meta = failureCategoryMeta(d.category);
      return {
        name: meta?.label ?? (d.category ?? 'Unclassified'),
        rawValue: d.category,
        value: d.count,
        color: meta?.color ?? '#64748b',
      };
    });
  const total = items.reduce((s, i) => s + i.value, 0);
  const handlePick = (raw: string | null) => {
    // null = "Unclassified" — not filterable since there's no enum value
    // to pass to the API. Skip the click silently.
    if (!onSelect || raw == null) return;
    onSelect(raw);
  };

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
      {total === 0 ? (
        <div className="h-48 flex items-center justify-center text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          {emptyLabel}
        </div>
      ) : (
        <div className="grid grid-cols-[160px_1fr] gap-4 items-center">
          {/* outline:none kills the default browser focus ring on the SVG —
              when the user clicked a slice they got a purple rectangle
              around the entire chart container, which looked like a
              selection state for the whole donut. The actual highlighted
              slice is the white-stroked Cell below. */}
          <div style={{ height: 160, outline: 'none' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={items} dataKey="value" nameKey="name"
                  innerRadius={48} outerRadius={72} paddingAngle={2}
                  isAnimationActive={false}
                >
                  {items.map((i) => {
                    const isSelected = selectedCategory === i.rawValue;
                    // De-emphasise non-selected slices when a filter is on
                    // so the user can see at a glance what's being applied.
                    const dim = selectedCategory && !isSelected;
                    const cellClickable = isClickable && i.rawValue !== null;
                    return (
                      <Cell
                        key={i.name}
                        fill={i.color}
                        stroke={isSelected ? '#fff' : 'rgba(14,14,24,0.95)'}
                        strokeWidth={isSelected ? 3 : 2}
                        opacity={dim ? 0.30 : 1}
                        // Per-cell onClick is more reliable than Pie.onClick
                        // in recharts — events bubble from the slice <path>
                        // not the parent group, and slices have their own
                        // pointer-events area.
                        onClick={cellClickable ? () => handlePick(i.rawValue) : undefined}
                        style={cellClickable ? { cursor: 'pointer', outline: 'none' } : { outline: 'none' }}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  /* Explicit colour on every layer — contentStyle.color
                     doesn't cascade into recharts' inner <p> elements, so
                     without itemStyle + labelStyle the tooltip text rendered
                     in the default near-black browser colour against our
                     dark surface (invisible). */
                  contentStyle={{
                    background: 'rgba(14,14,24,0.96)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  itemStyle={{ color: 'rgba(238,238,248,0.92)' }}
                  labelStyle={{ color: 'rgba(238,238,248,0.55)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="text-[11px] space-y-0.5">
            {items
              .sort((a, b) => b.value - a.value)
              .map((i) => {
                const isSelected = selectedCategory === i.rawValue;
                const clickable = isClickable && i.rawValue !== null;
                return (
                  <li
                    key={i.name}
                    onClick={clickable ? () => handlePick(i.rawValue) : undefined}
                    className={[
                      'flex items-center gap-2 rounded px-1.5 py-1',
                      clickable ? 'cursor-pointer transition-colors hover:bg-white/[0.05]' : '',
                    ].join(' ')}
                    title={clickable ? `Filter the dashboard by ${i.name}` : undefined}
                    style={{
                      background: isSelected ? 'rgba(var(--accent-rgb),0.14)' : undefined,
                      outline: isSelected ? '1px solid rgba(var(--accent-rgb),0.40)' : undefined,
                    }}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color }} />
                    <span className="truncate flex-1" style={{ color: 'rgba(238,238,248,0.75)' }}>{i.name}</span>
                    <span className="tabular-nums" style={{ color: 'rgba(238,238,248,0.60)' }}>{i.value}</span>
                    <span className="tabular-nums opacity-50" style={{ color: 'rgba(238,238,248,0.55)' }}>
                      {Math.round((i.value / total) * 100)}%
                    </span>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </div>
  );
}
