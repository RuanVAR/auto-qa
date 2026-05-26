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
}
export function CategoryDonut({ title, data, emptyLabel = 'No data yet' }: Props) {
  const items = data
    .filter((d) => d.count > 0)
    .map((d) => {
      const meta = failureCategoryMeta(d.category);
      return {
        name: meta?.label ?? (d.category ?? 'Unclassified'),
        value: d.count,
        color: meta?.color ?? '#64748b',
      };
    });
  const total = items.reduce((s, i) => s + i.value, 0);

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
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={items} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                  {items.map((i) => (
                    <Cell key={i.name} fill={i.color} stroke="rgba(14,14,24,0.95)" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'rgba(14,14,24,0.96)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 8,
                    fontSize: 11,
                    color: 'rgba(238,238,248,0.92)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="text-[11px] space-y-1.5">
            {items
              .sort((a, b) => b.value - a.value)
              .map((i) => (
                <li key={i.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color }} />
                  <span className="truncate flex-1" style={{ color: 'rgba(238,238,248,0.75)' }}>{i.name}</span>
                  <span className="tabular-nums" style={{ color: 'rgba(238,238,248,0.60)' }}>{i.value}</span>
                  <span className="tabular-nums opacity-50" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    {Math.round((i.value / total) * 100)}%
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
