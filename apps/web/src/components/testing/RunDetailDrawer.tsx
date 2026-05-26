import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import {
  X, Loader2, CheckCircle2, XCircle, MinusCircle, Loader as LoaderIcon, ExternalLink,
  Clock, AlertTriangle, Zap, User, Globe,
} from 'lucide-react';
import { runsApi } from '@/lib/api';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { ArtifactGallery } from './ArtifactGallery';

/**
 * RunDetailDrawer
 * ---------------
 * Slide-in panel showing one run's per-step pass/fail + artifacts. Designed
 * to open from any "click a run row" affordance (the RecentRunsPanel today,
 * other lists later). Avoids a navigate-to-/runs/:runId round trip so the
 * tester stays in their editor context.
 *
 * Source of truth: GET /runs/:id (existing endpoint — returns run + steps +
 * artifacts in one shot). React Query polls every second while the run is
 * still in flight, then stops at terminal state. Identical poll strategy to
 * LiveRunModal.
 */

const TERMINAL = new Set(['PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'ERROR']);

interface Props {
  /** Open when non-null. Set to null to close. */
  runId: string | null;
  onClose: () => void;
}

type RunStepDetail = {
  id: string;
  index: number;
  name: string | null;
  type: string;
  status: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  input: unknown;
  notes: string | null;
};

type Artifact = {
  id: string;
  type: string;
  filename: string;
  path: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

type RunDetail = {
  id: string;
  status: string;
  runMode: 'AUTOMATED' | 'MANUAL';
  trigger: string;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  errorMessage: string | null;
  steps: RunStepDetail[];
  artifacts: Artifact[];
  environment: { id: string; name: string; baseUrl: string | null } | null;
  testDefinition: { id: string; name: string; type: string } | null;
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  if (s < 60) return `${s}s`;
  const mm = Math.floor(s / 60);
  const ss = Math.round(s - mm * 60);
  return `${mm}m ${ss}s`;
}

/** Per-step icon — mirrors LiveRunModal's StepStatusPill but a tighter icon-only variant. */
function StepIcon({ status }: { status: string }) {
  if (status === 'PASSED')
    return <CheckCircle2 size={14} style={{ color: '#34d399' }} />;
  if (status === 'FAILED')
    return <XCircle size={14} style={{ color: '#f87171' }} />;
  if (status === 'RUNNING')
    return <LoaderIcon size={14} className="animate-spin" style={{ color: '#c4b5fd' }} />;
  if (status === 'SKIPPED')
    return <MinusCircle size={14} style={{ color: '#94a3b8' }} />;
  return <Clock size={14} style={{ color: 'rgba(238,238,248,0.4)' }} />;
}

export function RunDetailDrawer({ runId, onClose }: Props) {
  const open = !!runId;

  // Lock body scroll while open (same UX rule as Modal — prevents the page
  // behind from scrolling when the user wheels inside the drawer).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const runQ = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.get(runId!) as Promise<RunDetail>,
    enabled: open,
    // Poll every second while in flight (same cadence as LiveRunModal). Stops
    // once we hit a terminal state — the drawer can be left open without
    // hammering the API.
    refetchInterval: (q) => {
      const r = q.state.data as RunDetail | undefined;
      return r && TERMINAL.has(r.status) ? false : 1000;
    },
  });

  if (!open) return null;
  const run = runQ.data;

  return createPortal(
    <div
      className="fixed inset-0 z-[10060] flex justify-end animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label="Run detail"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        className="relative h-full w-full max-w-2xl overflow-y-auto"
        style={{
          background: 'rgba(18,18,32,0.98)',
          borderLeft: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '-24px 0 64px rgba(0,0,0,0.50)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
          style={{
            background: 'rgba(18,18,32,0.98)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold truncate"
              style={{ color: 'rgba(238,238,248,0.92)' }}
            >
              {run?.testDefinition?.name ?? 'Run detail'}
            </h2>
            <p
              className="text-[11px] mt-0.5 font-mono truncate"
              style={{ color: 'rgba(238,238,248,0.40)' }}
            >
              {runId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{
              color: 'rgba(238,238,248,0.50)',
              background: 'rgba(255,255,255,0.05)',
            }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {runQ.isLoading && !run && (
            <div
              className="flex items-center gap-2 text-xs"
              style={{ color: 'rgba(238,238,248,0.50)' }}
            >
              <Loader2 size={13} className="animate-spin" /> Loading…
            </div>
          )}

          {run && (
            <>
              {/* Top-line stats */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <RunStatusBadge status={run.status} />
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
                  style={{
                    background:
                      run.runMode === 'AUTOMATED'
                        ? 'rgba(139,92,246,0.15)'
                        : 'rgba(16,185,129,0.12)',
                    color: run.runMode === 'AUTOMATED' ? '#c4b5fd' : '#34d399',
                  }}
                >
                  {run.runMode === 'AUTOMATED' ? <Zap size={10} /> : <User size={10} />}
                  {run.runMode}
                </span>
                {run.environment && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px]"
                    style={{ color: 'rgba(238,238,248,0.55)' }}
                  >
                    <Globe size={11} /> {run.environment.name}
                  </span>
                )}
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: 'rgba(238,238,248,0.55)' }}
                >
                  Duration: {formatDuration(run.duration)}
                </span>
              </div>

              {/* Top-level error banner — when the whole run errored before
                  any step was attempted, this is the only failure data we
                  have. */}
              {run.errorMessage && (
                <div
                  className="rounded-lg px-3 py-2.5 flex gap-2 text-xs"
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    color: '#f87171',
                  }}
                >
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span className="font-mono whitespace-pre-wrap break-words">
                    {run.errorMessage}
                  </span>
                </div>
              )}

              {/* Steps */}
              <div>
                <h3
                  className="text-[11px] font-semibold uppercase tracking-wider mb-2"
                  style={{ color: 'rgba(238,238,248,0.55)' }}
                >
                  Steps ({run.steps.length})
                </h3>
                <ul
                  className="rounded-xl overflow-hidden"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.05)',
                  }}
                >
                  {run.steps.length === 0 && (
                    <li
                      className="px-3 py-3 text-xs"
                      style={{ color: 'rgba(238,238,248,0.4)' }}
                    >
                      No step results captured for this run.
                    </li>
                  )}
                  {run.steps.map((s) => (
                    <li
                      key={s.id}
                      className="px-3 py-2.5 flex items-start gap-3"
                      style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <StepIcon status={s.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className="text-[10px] tabular-nums px-1.5 py-0.5 rounded"
                            style={{
                              background: 'rgba(255,255,255,0.05)',
                              color: 'rgba(238,238,248,0.45)',
                            }}
                          >
                            #{s.index + 1}
                          </span>
                          <span
                            className="text-[10px] font-mono"
                            style={{ color: '#a78bfa' }}
                          >
                            {s.type}
                          </span>
                          <span
                            className="text-xs font-medium truncate"
                            style={{ color: 'rgba(238,238,248,0.85)' }}
                          >
                            {s.name ?? <em className="opacity-60">(no name)</em>}
                          </span>
                          {s.duration != null && (
                            <span
                              className="text-[10px] tabular-nums ml-auto"
                              style={{ color: 'rgba(238,238,248,0.35)' }}
                            >
                              {formatDuration(s.duration)}
                            </span>
                          )}
                        </div>
                        {/* Failure detail */}
                        {s.status === 'FAILED' && s.errorMessage && (
                          <div
                            className="mt-1.5 text-[11px] font-mono whitespace-pre-wrap break-words rounded px-2 py-1.5"
                            style={{
                              background: 'rgba(239,68,68,0.08)',
                              border: '1px solid rgba(239,68,68,0.20)',
                              color: '#f87171',
                            }}
                          >
                            {s.errorMessage}
                          </div>
                        )}
                        {/* Manual notes */}
                        {s.notes && (
                          <div
                            className="mt-1.5 text-[11px] rounded px-2 py-1.5"
                            style={{
                              background: 'rgba(255,255,255,0.04)',
                              color: 'rgba(238,238,248,0.65)',
                            }}
                          >
                            {s.notes}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Artifacts */}
              {run.artifacts && run.artifacts.length > 0 && (
                <ArtifactGallery artifacts={run.artifacts} />
              )}

              {/* Footer — link to full run page for the rare case the drawer
                  isn't enough (e.g. AI summaries, selector heals, history). */}
              <div className="pt-2">
                <a
                  href={`/runs/${run.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] underline"
                  style={{ color: '#a78bfa' }}
                >
                  Open full run page <ExternalLink size={10} />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
