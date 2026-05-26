/**
 * Per-user productivity table. Drives the manager-facing per-assignee
 * dashboard — runs triggered, issues reported, issues resolved, avg
 * resolution time. Hides users with zero activity on every axis.
 */
interface Row {
  userId: string;
  userName: string;
  userEmail: string;
  runsTriggered: number;
  issuesReported: number;
  issuesResolved: number;
  avgResolutionMs: number;
}
interface Props {
  data: Row[];
  /** Clickable rows — sets the userId filter on the dashboard. */
  onSelect?: (userId: string) => void;
  /** Highlight the row currently set as the userId filter. */
  selectedId?: string | null;
}
function formatMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
export function AssigneeLeaderboard({ data, onSelect, selectedId }: Props) {
  const isClickable = !!onSelect;
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: 'rgba(238,238,248,0.85)' }}>
        Per-user activity
      </p>
      {data.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          No user activity in this date range.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'rgba(238,238,248,0.50)' }}>
                <th className="text-left py-1.5 px-2 font-semibold">User</th>
                <th className="text-right py-1.5 px-2 font-semibold">Runs</th>
                <th className="text-right py-1.5 px-2 font-semibold">Bugs reported</th>
                <th className="text-right py-1.5 px-2 font-semibold">Bugs resolved</th>
                <th className="text-right py-1.5 px-2 font-semibold">Avg resolve</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => {
                const isSelected = selectedId === r.userId;
                return (
                <tr
                  key={r.userId}
                  onClick={isClickable ? () => onSelect?.(r.userId) : undefined}
                  className={isClickable ? 'cursor-pointer transition-colors hover:bg-white/[0.06]' : ''}
                  title={isClickable ? `Filter by ${r.userName || r.userEmail || 'user'}` : undefined}
                  style={{
                    background: isSelected
                      ? 'rgba(168,85,247,0.14)'
                      : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                    color: 'rgba(238,238,248,0.85)',
                    outline: isSelected ? '1px solid rgba(168,85,247,0.40)' : undefined,
                  }}
                >
                  <td className="py-1.5 px-2">
                    <div className="font-medium truncate">{r.userName || '—'}</div>
                    {r.userEmail && (
                      <div className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.45)' }}>
                        {r.userEmail}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.runsTriggered}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.issuesReported}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{r.issuesResolved}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{formatMs(r.avgResolutionMs)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
