import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, XCircle, Clock, Ban, AlertTriangle, Timer } from 'lucide-react';

/**
 * TestStatusBadge — the live-aware status pill for a *test* (not a run).
 *
 * Two-pronged input by design: tests own both a historical "latestStatus"
 * (the most recent terminal result) and an optional "activeRun" (something
 * in flight right now). The badge prefers the active run whenever one is
 * present — so a test that just got triggered shows "Running 00:42" while
 * its underlying latestStatus still says "PASSED from yesterday".
 *
 * Distinct from ui/RunStatusBadge, which takes a single Run's status and is
 * used wherever we already have a Run object (RunsPage, DashboardPage,
 * RunDetailPage, FeaturePage). That one's per-run; this one's per-test.
 *
 * Why this exists: every test-list view used to render an inline "StatusPill"
 * that only handled terminal states (PASSED/FAILED/SKIPPED) and fell through
 * to "Not run" for everything else. So a test that was actively executing
 * right now still showed up as "Not run" — actively misleading.
 */

export type RunStatusValue =
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'NOT_TESTED'
  | 'TIMED_OUT'
  | 'ERROR'
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | null
  | undefined;

export interface TestStatusBadgeProps {
  /** Historical (most-recent-completed) status. Drives the badge when nothing is in flight. */
  latestStatus?: RunStatusValue;
  /** Currently in-flight run. When present it ALWAYS wins over latestStatus. */
  activeRun?: {
    status: 'PENDING' | 'QUEUED' | 'RUNNING';
    startedAt?: string | Date | null;
    /** When the run was created (used as fallback timer origin if startedAt is null). */
    createdAt?: string | Date | null;
  } | null;
  /** "Not run" fallback label. Default: 'Not run' */
  emptyLabel?: string;
  /** Suppress the live elapsed timer next to RUNNING. */
  hideTimer?: boolean;
  /** Compact mode — slightly smaller. */
  size?: 'sm' | 'md';
}

/** mm:ss formatter for the live RUNNING timer. */
function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
}

/**
 * Live ticking elapsed clock. Re-renders every 1s while the component is
 * mounted. Origin is whatever timestamp the run uses to anchor "started" —
 * startedAt if set (automated runs), otherwise createdAt (manual runs that
 * haven't been picked up yet, or PENDING).
 */
function useElapsed(origin: string | Date | null | undefined): string {
  const [, force] = useState(0);
  useEffect(() => {
    if (!origin) return;
    const interval = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [origin]);
  if (!origin) return '00:00';
  const startMs = typeof origin === 'string' ? new Date(origin).getTime() : origin.getTime();
  return formatElapsed(Date.now() - startMs);
}

// ──────────────────────────────────────────────────────────────────────────
// Styles. Inline style objects (matches the rest of this codebase's pattern
// of dark-themed tinted pills) so the component drops into any page without
// pulling in a tailwind ring class set.

const PILL_BASE =
  'inline-flex items-center gap-1 rounded font-semibold whitespace-nowrap leading-tight';

const SIZE: Record<'sm' | 'md', string> = {
  sm: 'text-[10px] px-1.5 py-0.5',
  md: 'text-xs px-2 py-1',
};

interface Style {
  bg: string;
  fg: string;
  border: string;
}

const PASSED_STYLE: Style = {
  bg: 'rgba(52,211,153,0.12)',
  fg: '#34d399',
  border: 'rgba(52,211,153,0.25)',
};
const FAILED_STYLE: Style = {
  bg: 'rgba(239,68,68,0.12)',
  fg: '#f87171',
  border: 'rgba(239,68,68,0.25)',
};
const SKIPPED_STYLE: Style = {
  bg: 'rgba(148,163,184,0.12)',
  fg: '#94a3b8',
  border: 'rgba(148,163,184,0.25)',
};
const ERROR_STYLE: Style = {
  bg: 'rgba(244,114,182,0.12)',
  fg: '#f472b6',
  border: 'rgba(244,114,182,0.25)',
};
const PENDING_STYLE: Style = {
  bg: 'rgba(245,158,11,0.10)',
  fg: '#fbbf24',
  border: 'rgba(245,158,11,0.22)',
};
const QUEUED_STYLE: Style = {
  bg: 'rgba(56,189,248,0.12)',
  fg: '#38bdf8',
  border: 'rgba(56,189,248,0.30)',
};
const RUNNING_STYLE: Style = {
  bg: 'rgba(var(--accent-rgb),0.16)',
  fg: 'var(--accent-300)',
  border: 'rgba(var(--accent-rgb),0.40)',
};

function applyStyle(s: Style): React.CSSProperties {
  return { background: s.bg, color: s.fg, border: `1px solid ${s.border}` };
}

// ──────────────────────────────────────────────────────────────────────────

export function TestStatusBadge({
  latestStatus,
  activeRun,
  emptyLabel = 'Not run',
  hideTimer,
  size = 'sm',
}: TestStatusBadgeProps) {
  const cls = `${PILL_BASE} ${SIZE[size]}`;
  // Live timer hook MUST be called unconditionally — React rules of hooks.
  // We compute it always; the rendering path below decides whether to use it.
  const elapsed = useElapsed(activeRun?.startedAt ?? activeRun?.createdAt ?? null);

  // Active run wins over historical status. RUNNING > QUEUED > PENDING.
  if (activeRun) {
    if (activeRun.status === 'RUNNING') {
      return (
        <span className={cls} style={applyStyle(RUNNING_STYLE)} title="Currently running">
          <Loader2 size={size === 'sm' ? 10 : 12} className="animate-spin" />
          <span>Running</span>
          {!hideTimer && <span className="tabular-nums opacity-80">{elapsed}</span>}
        </span>
      );
    }
    if (activeRun.status === 'QUEUED') {
      return (
        <span className={cls} style={applyStyle(QUEUED_STYLE)} title="Waiting for a worker slot">
          <Timer size={size === 'sm' ? 10 : 12} />
          <span>Queued</span>
        </span>
      );
    }
    // PENDING — created but not yet picked up. Common for manual runs that
    // haven't been started by a tester, or automated runs the queue hasn't
    // dispatched yet.
    return (
      <span className={cls} style={applyStyle(PENDING_STYLE)} title="Pending — not started yet">
        <Clock size={size === 'sm' ? 10 : 12} />
        <span>Pending</span>
      </span>
    );
  }

  // No active run — fall back to last-known terminal status.
  switch (latestStatus) {
    case 'PASSED':
      return (
        <span className={cls} style={applyStyle(PASSED_STYLE)}>
          <CheckCircle2 size={size === 'sm' ? 10 : 12} />
          <span>Passed</span>
        </span>
      );
    case 'FAILED':
      return (
        <span className={cls} style={applyStyle(FAILED_STYLE)}>
          <XCircle size={size === 'sm' ? 10 : 12} />
          <span>Failed</span>
        </span>
      );
    case 'CANCELLED':
    case 'SKIPPED':
    case 'NOT_TESTED':
      return (
        <span className={cls} style={applyStyle(SKIPPED_STYLE)}>
          <Ban size={size === 'sm' ? 10 : 12} />
          {/* SKIPPED is a first-class explicit skip; CANCELLED is a stopped run;
              NOT_TESTED was never evaluated. (Legacy un-backfilled skips would
              have been CANCELLED, but the migration promoted them to SKIPPED.) */}
          <span>{latestStatus === 'NOT_TESTED' ? 'Not tested' : latestStatus === 'CANCELLED' ? 'Cancelled' : 'Skipped'}</span>
        </span>
      );
    case 'TIMED_OUT':
      return (
        <span className={cls} style={applyStyle(ERROR_STYLE)} title="Timed out">
          <AlertTriangle size={size === 'sm' ? 10 : 12} />
          <span>Timed out</span>
        </span>
      );
    case 'ERROR':
      // ERROR = infra error (e.g. a reaped run), not a verdict — surface it as
      // "needs testing" (neutral), so it reads as outstanding rather than failed.
      return (
        <span className={cls} style={applyStyle(SKIPPED_STYLE)} title="Errored during run — needs testing">
          <Ban size={size === 'sm' ? 10 : 12} />
          <span>Needs testing</span>
        </span>
      );
    default:
      // null / undefined / unknown → "Not run".
      return (
        <span className={cls} style={applyStyle(PENDING_STYLE)}>
          <span>{emptyLabel}</span>
        </span>
      );
  }
}
