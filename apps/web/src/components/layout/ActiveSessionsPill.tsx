import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, ChevronDown, Pause, Square } from 'lucide-react';
import { featureRunsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

type ActiveRun = {
  id: string;
  runMode: 'MANUAL' | 'AUTOMATED';
  status: 'RUNNING' | 'PAUSED';
  startedAt: string;
  feature: { id: string; name: string; module: { id: string; name: string; projectId: string; project: { id: string; name: string } } };
  _count?: { testRuns: number };
};

const HEARTBEAT_MS = 5 * 60 * 1000; // 5 min — matches the per-run interval that used to live in ManualPlayer

/**
 * Active-sessions pill — top-bar surface that shows every in-progress run
 * the caller has open across the whole platform, and drives the global
 * heartbeat so sessions stay alive while the user navigates.
 *
 * Two responsibilities:
 *   1. Display: count + dropdown listing each run with its feature, with
 *      "Open" + "Stop" actions per row. The previous floating card only
 *      showed the run on the current FeaturePage, so a user with a
 *      forgotten session on Feature A had no signal while sitting on B.
 *   2. Heartbeat: ping `bulkHeartbeat` every 5 min while the user is
 *      logged in. Replaces the ManualPlayer-bound heartbeat which only
 *      fired while that one component was mounted.
 *
 * Hidden when the user has no active runs.
 */
export function ActiveSessionsPill() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore(s => !!s.token);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data: runs = [] } = useQuery<ActiveRun[]>({
    queryKey: ['my-active-runs'],
    queryFn: () => featureRunsApi.myActive(),
    enabled: isAuthenticated,
    // Refresh every minute — cheap, and keeps the pill in sync with status
    // changes (PAUSED transitions, completes from worker, etc).
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // Heartbeat keep-alive. Hits the bulk endpoint whenever the user has
  // any active run; suppresses when the user is logged out or has none.
  useEffect(() => {
    if (!isAuthenticated || runs.length === 0) return;
    const tick = () => featureRunsApi.bulkHeartbeat().catch(() => { /* swallowed */ });
    // Fire one immediately so a freshly-mounted Shell ticks before the
    // first 5-min interval — important when reloading the tab on a run
    // that's been idle ~14:30.
    tick();
    const id = setInterval(tick, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [isAuthenticated, runs.length]);

  // Outside-click close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const stopRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.stop(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-active-runs'] }),
  });

  const abandon = useMutation({
    mutationFn: (id: string) => featureRunsApi.abandon(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-active-runs'] }),
  });

  if (!isAuthenticated || runs.length === 0) return null;

  const pausedCount = runs.filter(r => r.status === 'PAUSED').length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title={`${runs.length} active session${runs.length === 1 ? '' : 's'}`}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: 'rgba(34,197,94,0.12)',
          border: '1px solid rgba(34,197,94,0.32)',
          color: '#86efac',
        }}
      >
        <Activity size={12} className={cn(pausedCount === 0 && 'animate-pulse')} />
        <span>{runs.length} active</span>
        {pausedCount > 0 && (
          <span className="text-[10px] px-1 rounded" style={{ background: 'rgba(251,191,36,0.20)', color: '#fbbf24' }}>
            {pausedCount} paused
          </span>
        )}
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-[340px] rounded-xl py-1 z-50"
          style={{
            background: 'rgba(18,18,32,0.98)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.60)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="px-3 py-2 border-b text-[11px] uppercase tracking-wider font-semibold"
            style={{ borderColor: 'rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.55)' }}>
            Your active sessions
          </div>

          {runs.map(r => (
            <div
              key={r.id}
              className="px-3 py-2.5 border-b transition-colors hover:bg-white/[0.03]"
              style={{ borderColor: 'rgba(255,255,255,0.05)' }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: r.runMode === 'MANUAL' ? 'rgba(56,189,248,0.18)' : 'rgba(168,85,247,0.18)',
                    color: r.runMode === 'MANUAL' ? '#7dd3fc' : '#c4b5fd',
                  }}
                >
                  {r.runMode}
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    background: r.status === 'PAUSED' ? 'rgba(251,191,36,0.18)' : 'rgba(52,211,153,0.18)',
                    color: r.status === 'PAUSED' ? '#fbbf24' : '#34d399',
                  }}
                >
                  {r.status}
                </span>
                <span className="ml-auto text-[10px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  {timeAgo(r.startedAt)}
                </span>
              </div>
              <p className="text-sm font-medium truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                {r.feature.name}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.50)' }}>
                {r.feature.module.project.name} · {r.feature.module.name}
              </p>
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={() => {
                    setOpen(false);
                    navigate(
                      `/projects/${r.feature.module.projectId}/features/${r.feature.id}/test?mode=${r.runMode}&runId=${r.id}`,
                    );
                  }}
                  className="text-[11px] px-2 py-1 rounded-md transition-colors"
                  style={{ background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.35)', color: '#c4b5fd' }}
                >
                  Open ↗
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`End session on "${r.feature.name}"?`)) return;
                    if (r.runMode === 'MANUAL') abandon.mutate(r.id);
                    else stopRun.mutate(r.id);
                  }}
                  className="text-[11px] px-2 py-1 rounded-md transition-colors"
                  style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
                >
                  {r.runMode === 'MANUAL' ? <><Square size={10} className="inline mr-0.5" /> End</> : <><Pause size={10} className="inline mr-0.5" /> Stop</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
