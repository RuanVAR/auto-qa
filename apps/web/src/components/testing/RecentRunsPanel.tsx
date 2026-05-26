import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, History, Loader2, ExternalLink } from 'lucide-react';
import { runsApiFiltered } from '@/lib/api';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { RunDetailDrawer } from './RunDetailDrawer';

/**
 * RecentRunsPanel
 * ----------------
 * Collapsible "last N runs" panel for a specific test, designed to live at
 * the bottom of TestEditorPage. Eliminates the navigate-to-/runs round trip
 * that QA used to need to see what happened on the last execution.
 *
 * Data: GET /projects/:projectId/runs?testId=:testId (already-built endpoint,
 * supports the filter we need). React Query, 30s stale time. Refetches are
 * driven by the project run socket — when a run completes, the cache
 * invalidates and the panel updates in place.
 *
 * Click any row to open the RunDetailDrawer, which shows the full step
 * breakdown + artifacts (screenshots, trace, HAR) without a page navigation.
 */

interface Props {
  projectId: string;
  testId: string;
  /** Maximum rows to display. Default 10 keeps the panel scannable. */
  limit?: number;
}

type RunRow = {
  id: string;
  status: string;
  runMode: 'AUTOMATED' | 'MANUAL';
  trigger: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  errorMessage: string | null;
  createdAt: string;
  environment?: { id: string; name: string; type: string } | null;
  testDefinition?: { id: string; name: string; type: string } | null;
  _count?: { steps: number; artifacts: number };
};

type RunsListResponse = {
  items: RunRow[];
  total: number;
  page: number;
  limit: number;
};

/** Pretty-print a duration in ms as "1m 23s" or "456ms". */
function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const mm = Math.floor(s / 60);
  const ss = Math.round(s - mm * 60);
  return `${mm}m ${ss}s`;
}

/** Relative time string — "2m ago", "3h ago", "5d ago". */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function RecentRunsPanel({ projectId, testId, limit = 10 }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['runs', projectId, { testId, limit }],
    queryFn: () =>
      runsApiFiltered.list(projectId, { testId, limit }) as Promise<RunsListResponse>,
    enabled: !!projectId && !!testId,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];

  return (
    <>
      <div
        className="rounded-xl mt-4"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* Header — click to collapse/expand */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3"
          style={{ color: 'rgba(238,238,248,0.85)' }}
        >
          <div className="flex items-center gap-2">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <History size={14} style={{ color: '#a78bfa' }} />
            <span className="text-sm font-semibold">Recent runs</span>
            {!isLoading && (
              <span
                className="text-[11px] tabular-nums px-1.5 py-0.5 rounded"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  color: 'rgba(238,238,248,0.55)',
                }}
              >
                {data?.total ?? 0}
              </span>
            )}
          </div>
          {isLoading && <Loader2 size={13} className="animate-spin opacity-50" />}
        </button>

        {expanded && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {isLoading ? (
              <div
                className="px-4 py-6 flex items-center gap-2 text-xs"
                style={{ color: 'rgba(238,238,248,0.45)' }}
              >
                <Loader2 size={13} className="animate-spin" /> Loading runs…
              </div>
            ) : items.length === 0 ? (
              <div
                className="px-4 py-6 text-xs"
                style={{ color: 'rgba(238,238,248,0.4)' }}
              >
                No runs yet. Click <strong>Run Test</strong> above to trigger one.
              </div>
            ) : (
              <ul>
                {items.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.04]"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                    onClick={() => setSelectedRunId(r.id)}
                  >
                    {/* Status */}
                    <div style={{ minWidth: 90 }}>
                      <RunStatusBadge status={r.status} />
                    </div>

                    {/* Mode */}
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                      style={{
                        background:
                          r.runMode === 'AUTOMATED'
                            ? 'rgba(139,92,246,0.15)'
                            : 'rgba(16,185,129,0.12)',
                        color: r.runMode === 'AUTOMATED' ? '#c4b5fd' : '#34d399',
                      }}
                    >
                      {r.runMode === 'AUTOMATED' ? 'Auto' : 'Manual'}
                    </span>

                    {/* Env */}
                    {r.environment && (
                      <span
                        className="text-[11px] truncate max-w-[120px]"
                        style={{ color: 'rgba(238,238,248,0.55)' }}
                      >
                        {r.environment.name}
                      </span>
                    )}

                    {/* Duration */}
                    <span
                      className="text-[11px] tabular-nums"
                      style={{ color: 'rgba(238,238,248,0.55)' }}
                    >
                      {formatDuration(r.duration)}
                    </span>

                    {/* Step count + artifact count */}
                    {r._count && (
                      <span
                        className="text-[11px] tabular-nums"
                        style={{ color: 'rgba(238,238,248,0.35)' }}
                      >
                        {r._count.steps} step{r._count.steps !== 1 ? 's' : ''}
                        {r._count.artifacts > 0 && ` · ${r._count.artifacts} artifact${r._count.artifacts !== 1 ? 's' : ''}`}
                      </span>
                    )}

                    {/* Failure reason snippet */}
                    {r.status === 'FAILED' && r.errorMessage && (
                      <span
                        className="text-[11px] flex-1 truncate italic"
                        style={{ color: '#f87171' }}
                        title={r.errorMessage}
                      >
                        — {r.errorMessage}
                      </span>
                    )}

                    {/* Spacer that pushes the timestamp + chevron to the right */}
                    <div className="flex-1" />

                    {/* When */}
                    <span
                      className="text-[11px] whitespace-nowrap"
                      style={{ color: 'rgba(238,238,248,0.4)' }}
                    >
                      {relativeTime(r.completedAt ?? r.createdAt)}
                    </span>

                    <ExternalLink size={11} style={{ color: 'rgba(238,238,248,0.30)' }} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <RunDetailDrawer
        runId={selectedRunId}
        onClose={() => setSelectedRunId(null)}
      />
    </>
  );
}
