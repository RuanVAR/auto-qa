import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';

/**
 * Daily "tested vs failed" area chart. Tested = runs that reached a verdict
 * (passed + failed + skipped); Failed is overlaid (not stacked) so you read
 * "of N tested today, F failed" directly. Drives the "runs over time" widget.
 */
interface Props {
  data: Array<{ date: string; tested: number; failed: number; total?: number; passed?: number; skipped?: number }>;
}
export function RunsTrendChart({ data }: Props) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <p className="text-xs font-semibold mb-3" style={{ color: 'rgba(238,238,248,0.85)' }}>
        Runs over time
      </p>
      {data.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          No runs in this date range.
        </div>
      ) : (
        <div style={{ height: 200 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="testedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.40} />
                  <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="passedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#34d399" stopOpacity={0.30} />
                  <stop offset="100%" stopColor="#34d399" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="failedG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f87171" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#f87171" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: 'rgba(238,238,248,0.45)', fontSize: 10 }} />
              <YAxis tick={{ fill: 'rgba(238,238,248,0.45)', fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                /* recharts' contentStyle.color doesn't cascade to inner
                   <p> elements — we have to set itemStyle/labelStyle too
                   or the text renders in the default near-black browser
                   colour against our dark surface. Same fix applied to
                   CategoryDonut. */
                contentStyle={{
                  background: 'rgba(14,14,24,0.96)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 8,
                  fontSize: 11,
                }}
                itemStyle={{ color: 'rgba(238,238,248,0.92)' }}
                labelStyle={{ color: 'rgba(238,238,248,0.55)' }}
              />
              {/* Overlaid, NOT stacked: 'Tested' is the daily verdict total;
                  'Passed' and 'Failed' sit inside it (passed + failed + skipped
                  = tested). Tested drawn first so the smaller bands read on top. */}
              <Area type="monotone" dataKey="tested" stroke="#38bdf8" strokeWidth={2} fill="url(#testedG)" name="Tested" />
              <Area type="monotone" dataKey="passed" stroke="#34d399" strokeWidth={2} fill="url(#passedG)" name="Passed" />
              <Area type="monotone" dataKey="failed" stroke="#f87171" strokeWidth={2} fill="url(#failedG)" name="Failed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
