import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { MetricInfo } from '@/components/ui/MetricInfo';

export interface ProgressDonutStats {
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  /**
   * Optional split of `outstanding` into never-run vs needs-retest. When
   * provided, the donut + legend show them as two distinct segments
   * ("Never run" grey, "Needs retest" amber) instead of one lumped
   * "Outstanding". Falls back to the single roll-up when omitted, so older
   * callers keep working unchanged.
   */
  neverRun?: number;
  needsRetest?: number;
}

interface ProgressDonutProps {
  stats: ProgressDonutStats;
  /** px size of the rendered square — defaults to 160 */
  size?: number;
}

const COLORS = {
  passed:      '#34d399',
  failed:      '#f87171',
  skipped:     '#94a3b8',
  needsRetest: '#fbbf24',
  neverRun:    'rgba(255,255,255,0.10)',
  outstanding: 'rgba(255,255,255,0.10)',
};

const LABELS: Record<string, string> = {
  passed:      'Passed',
  failed:      'Failed',
  skipped:     'Skipped',
  needsRetest: 'Needs retest',
  neverRun:    'Never run',
  outstanding: 'Outstanding',
};

/**
 * Donut chart showing test result breakdown with a progress % in the centre.
 *
 * Progress = (passed + failed + skipped) / total × 100
 * i.e. "what fraction of test cases have been exercised at least once".
 */
export function ProgressDonut({ stats, size = 160 }: ProgressDonutProps) {
  const { passed, failed, skipped, outstanding, total } = stats;

  // Split outstanding when the caller passed the breakdown; otherwise treat
  // the whole roll-up as a single neutral segment.
  const hasSplit = stats.neverRun !== undefined || stats.needsRetest !== undefined;
  const neverRun = stats.neverRun ?? (hasSplit ? 0 : outstanding);
  const needsRetest = stats.needsRetest ?? 0;

  const run = passed + failed + skipped;
  const progress = total > 0 ? Math.round((run / total) * 100) : 0;

  // If nothing has been run yet, show a single grey ring so the chart
  // still renders rather than an empty hole.
  const segments =
    total === 0
      ? [{ name: 'neverRun', value: 1 }]
      : [
          { name: 'passed',      value: passed },
          { name: 'failed',      value: failed },
          { name: 'skipped',     value: skipped },
          { name: 'needsRetest', value: needsRetest },
          { name: 'neverRun',    value: neverRun },
        ].filter(s => s.value > 0);

  const progressColor =
    progress === 0
      ? 'rgba(238,238,248,0.30)'
      : progress >= 80
      ? '#34d399'
      : progress >= 50
      ? '#fbbf24'
      : '#f87171';

  const innerRadius = size * 0.30;
  const outerRadius = size * 0.46;

  return (
    <div className="relative flex items-center gap-6 shrink-0">
      {/* "(i)" explaining the Progress % + the segment breakdown. */}
      <div className="absolute -top-1 -left-1 z-10">
        <MetricInfo metric="progress" />
      </div>
      {/* Donut */}
      <div style={{ width: size, height: size, position: 'relative', flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={segments}
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              strokeWidth={0}
              paddingAngle={segments.length > 1 ? 2 : 0}
            >
              {segments.map(seg => (
                <Cell
                  key={seg.name}
                  fill={COLORS[seg.name as keyof typeof COLORS] ?? 'rgba(255,255,255,0.08)'}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Centre label */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: size * 0.175, color: progressColor }}
          >
            {progress}%
          </span>
          <span
            className="font-medium leading-none mt-1"
            style={{ fontSize: size * 0.085, color: 'rgba(238,238,248,0.45)' }}
          >
            progress
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2">
        {total === 0 ? (
          <LegendItem color={COLORS.neverRun} label="No tests" value="—" />
        ) : (
          Object.entries(
            hasSplit
              ? { passed, failed, skipped, needsRetest, neverRun }
              : { passed, failed, skipped, outstanding },
          )
            .filter(([, v]) => v > 0)
            .map(([key, value]) => (
              <LegendItem
                key={key}
                color={COLORS[key as keyof typeof COLORS]}
                label={LABELS[key]}
                value={value}
              />
            ))
        )}
        {total > 0 && (
          <div className="mt-1 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <LegendItem
              color="rgba(238,238,248,0.30)"
              label="Total"
              value={total}
              dim
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  value,
  dim = false,
}: {
  color: string;
  label: string;
  value: number | string;
  dim?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-full shrink-0"
        style={{ width: 8, height: 8, background: color }}
      />
      <span
        className="text-xs"
        style={{ color: dim ? 'rgba(238,238,248,0.35)' : 'rgba(238,238,248,0.60)' }}
      >
        {label}
      </span>
      <span
        className="text-xs font-semibold tabular-nums ml-auto pl-3"
        style={{ color: dim ? 'rgba(238,238,248,0.35)' : 'rgba(238,238,248,0.80)' }}
      >
        {value}
      </span>
    </div>
  );
}
