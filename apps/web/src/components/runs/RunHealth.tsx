/**
 * Shared run-outcome visuals for the Runs & Schedules page panels: outcome →
 * colour, and the compact last-N health strip. Used by SchedulesPanel and
 * PipelinesPanel so schedule runs and pipeline runs read identically.
 */

/** Outcome → dot colour. Covers TestRun, FeatureRun and PipelineRun statuses. */
export function statusColor(status: string): string {
  if (status === 'COMPLETE' || status === 'PASSED') return '#34d399';
  if (status === 'FAILED' || status === 'ERROR') return '#f87171';
  if (status === 'RUNNING' || status === 'PAUSED') return 'var(--accent-400)';
  return 'rgba(148,163,184,0.55)';
}

/** Recent outcomes, newest first in `runs` — reversed so time reads left → right. */
export function HealthStrip({ runs }: { runs: Array<{ id: string; status: string }> }) {
  return (
    <span className="flex shrink-0 items-center gap-1" title="Recent runs (oldest → newest)">
      {[...runs].reverse().map(r => (
        <span
          key={r.id}
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: statusColor(r.status) }}
        />
      ))}
    </span>
  );
}
