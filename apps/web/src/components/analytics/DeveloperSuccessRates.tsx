/**
 * Per-developer success table. For each feature's assigned developer, shows
 * test pass/fail across their features, the resulting pass rate, and the
 * number of bugs on those features. Anchored on Feature.developerId.
 */
interface Row {
  developerId: string;
  developerName: string;
  developerEmail: string;
  featureCount: number;
  testsPassed: number;
  testsFailed: number;
  bugCount: number;
  passRate: number | null;
}
interface Props {
  data: Row[];
  /** Clickable rows — sets the userId filter on the dashboard. */
  onSelect?: (userId: string) => void;
  /** Highlight the row currently set as the userId filter. */
  selectedId?: string | null;
}
function rateColor(rate: number | null): string {
  if (rate === null) return 'rgba(238,238,248,0.45)';
  return rate >= 80 ? '#34d399' : rate >= 50 ? '#fbbf24' : '#f87171';
}
export function DeveloperSuccessRates({ data, onSelect, selectedId }: Props) {
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
        Success rate by developer
      </p>
      {data.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-center px-4" style={{ color: 'rgba(238,238,248,0.40)' }}>
          No features have an assigned developer in this scope. Assign a developer on a feature's Settings tab.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ color: 'rgba(238,238,248,0.50)' }}>
                <th className="text-left py-1.5 px-2 font-semibold">Developer</th>
                <th className="text-right py-1.5 px-2 font-semibold">Features</th>
                <th className="text-right py-1.5 px-2 font-semibold">Passed</th>
                <th className="text-right py-1.5 px-2 font-semibold">Failed</th>
                <th className="text-right py-1.5 px-2 font-semibold">Pass rate</th>
                <th className="text-right py-1.5 px-2 font-semibold">Bugs</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => {
                const isSelected = selectedId === r.developerId;
                return (
                  <tr
                    key={r.developerId}
                    onClick={isClickable ? () => onSelect?.(r.developerId) : undefined}
                    className={isClickable ? 'cursor-pointer transition-colors hover:bg-white/[0.06]' : ''}
                    title={isClickable ? `Filter by ${r.developerName || r.developerEmail || 'developer'}` : undefined}
                    style={{
                      background: isSelected
                        ? 'rgba(var(--accent-rgb),0.14)'
                        : i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
                      color: 'rgba(238,238,248,0.85)',
                      outline: isSelected ? '1px solid rgba(var(--accent-rgb),0.40)' : undefined,
                    }}
                  >
                    <td className="py-1.5 px-2">
                      <div className="font-medium truncate">{r.developerName || '—'}</div>
                      {r.developerEmail && (
                        <div className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.45)' }}>
                          {r.developerEmail}
                        </div>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">{r.featureCount}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: '#34d399' }}>{r.testsPassed}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: r.testsFailed > 0 ? '#f87171' : 'rgba(238,238,248,0.5)' }}>{r.testsFailed}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums font-semibold" style={{ color: rateColor(r.passRate) }}>
                      {r.passRate === null ? '—' : `${r.passRate}%`}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums" style={{ color: r.bugCount > 0 ? '#fbbf24' : 'rgba(238,238,248,0.5)' }}>{r.bugCount}</td>
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
