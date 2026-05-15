import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Bug, ChevronDown, FileText, Loader, Mail, ExternalLink, Square } from 'lucide-react';
import { workSessionsApi, reportsApi, api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { SessionReportModal } from '@/components/GenerateReportButton';
import { useWorkSessionStore, type CurrentWorkSession } from '@/stores/workSessionStore';
import { useAuthStore } from '@/stores/authStore';

// ─── WorkSessionBadge ────────────────────────────────────────────────────────
// Lives in the TopNav next to the notification bell. Shows the live count of
// tests the user has worked on in their current session. Clicking opens a
// panel with a grouped breakdown (module → features → counts).

function formatElapsed(startIso: string): string {
  const start = new Date(startIso).getTime();
  const ms = Date.now() - start;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function WorkSessionBadge() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const { token } = useAuthStore();
  const qc = useQueryClient();
  const setCurrent = useWorkSessionStore((s) => s.setCurrent);

  // End-session mutation. Hits POST /work-sessions/end which sets endedAt on
  // the user's active QaWorkSession for the org. Stale sessions can pile up
  // when the user closes the tab mid-test and never logs out — there was no
  // UI to terminate them before this button.
  const endSession = useMutation({
    mutationFn: () => workSessionsApi.end('manual'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-session-current'] });
      qc.invalidateQueries({ queryKey: ['work-session-last'] });
      toast.success('Session ended', 'Your QA work session is closed.');
      setOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not end session', typeof msg === 'string' ? msg : 'Try again.');
    },
  });
  // Lifted out of SessionReportQuickActions so the modal survives the badge
  // panel closing (the panel's outside-click handler fires when clicking
  // inside the portal, which would unmount the child that holds this state).
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailModalProjectId, setEmailModalProjectId] = useState<string | null>(null);

  // Don't render or poll until authenticated
  const { data } = useQuery({
    queryKey: ['work-session-current'],
    queryFn: () => workSessionsApi.current() as Promise<CurrentWorkSession | null>,
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });

  useEffect(() => {
    setCurrent(data ?? null);
  }, [data, setCurrent]);

  // Close panel on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  if (!token || !data?.session) return null;

  const stats = data.stats;
  const total = stats.totalTestRuns;
  const hasActivity = total > 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: hasActivity ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${hasActivity ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.08)'}`,
          color: hasActivity ? '#c4b5fd' : 'rgba(238,238,248,0.45)',
        }}
        title="QA work session stats"
      >
        <Activity size={11} />
        {hasActivity ? (
          <>
            <span>{total} test{total !== 1 ? 's' : ''}</span>
            {stats.passed > 0 && (
              <span style={{ color: '#34d399' }}>· {stats.passed} ✓</span>
            )}
            {stats.failed > 0 && (
              <span style={{ color: '#f87171' }}>· {stats.failed} ✗</span>
            )}
          </>
        ) : (
          <span>Session</span>
        )}
        <ChevronDown size={10} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(14,14,24,0.98)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.70)',
            zIndex: 100,
          }}
        >
          {/* Header — includes a "Generate Report" CTA. SESSION-scoped report
              auto-derives projectId from the session itself if the user
              isn't currently on a project page (URL match). */}
          <div className="px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  Active QA session
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  Started {formatElapsed(data.session.startedAt)} ago
                </p>
              </div>
              <SessionReportQuickActions
                sessionId={data.session.id}
                fallbackProjectId={data.session.lastProjectId ?? null}
                onOpenEmailModal={(projectId) => {
                  setEmailModalProjectId(projectId);
                  setEmailModalOpen(true);
                }}
              />
            </div>
          </div>

          {/* Stats row */}
          <div className="px-4 py-3 grid grid-cols-4 gap-2 text-center border-b"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <Stat label="Tests" value={stats.totalTestRuns} color="rgba(238,238,248,0.85)" />
            <Stat label="Passed" value={stats.passed} color="#34d399" />
            <Stat label="Failed" value={stats.failed} color="#f87171" />
            <Stat label="Issues" value={stats.issuesLogged} color="#fbbf24" />
          </div>

          {/* End-session footer — sits below the header so it's always
              reachable even when the breakdown is long. Confirms before
              firing because ending kills the session row for good. */}
          <div className="px-4 py-2 border-b flex items-center justify-end"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <button
              type="button"
              disabled={endSession.isPending}
              onClick={() => {
                if (!window.confirm('End your QA work session? Any further test activity will start a new one.')) return;
                endSession.mutate();
              }}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-50"
              style={{
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.30)',
                color: '#fca5a5',
              }}
            >
              {endSession.isPending ? <Loader size={11} className="animate-spin" /> : <Square size={11} />}
              End session
            </button>
          </div>

          {/* Breakdown */}
          <div className="max-h-64 overflow-y-auto px-1 py-1">
            {data.breakdown.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
                  No activity yet — mark a test pass or fail to start tracking.
                </p>
              </div>
            ) : (
              data.breakdown.map((mod) => (
                <div key={mod.moduleId} className="px-3 py-2 rounded-lg">
                  <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                    style={{ color: 'rgba(238,238,248,0.55)' }}>
                    {mod.moduleName}
                  </p>
                  {mod.features.map((f) => (
                    <div key={f.featureId} className="flex items-center justify-between py-1">
                      <span className="text-xs truncate" style={{ color: 'rgba(238,238,248,0.75)' }}>
                        {f.featureName}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] flex-shrink-0">
                        {f.passed > 0 && (
                          <span className="flex items-center gap-0.5" style={{ color: '#34d399' }}>
                            <CheckCircle size={9} /> {f.passed}
                          </span>
                        )}
                        {f.failed > 0 && (
                          <span className="flex items-center gap-0.5" style={{ color: '#f87171' }}>
                            <XCircle size={9} /> {f.failed}
                          </span>
                        )}
                        {f.issues > 0 && (
                          <span className="flex items-center gap-0.5" style={{ color: '#fbbf24' }}>
                            <Bug size={9} /> {f.issues}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SessionReportModal lives outside the badge panel so it isn't
          unmounted when the panel closes (the panel's outside-click handler
          would otherwise destroy the modal mid-interaction). */}
      {emailModalProjectId && data?.session && (
        <SessionReportModal
          open={emailModalOpen}
          onClose={() => setEmailModalOpen(false)}
          projectId={emailModalProjectId}
          workSessionId={data.session.id}
          emailFirst
        />
      )}
    </div>
  );
}

/**
 * Quick actions for session reports: inline "View report" (same as the
 * previous one-click flow) and "Generate and email" (opens the shared report
 * modal with recipients). projectId resolution matches SessionReportButton.
 */
function SessionReportQuickActions({ sessionId, fallbackProjectId, onOpenEmailModal }: {
  sessionId: string;
  fallbackProjectId: string | null;
  onOpenEmailModal: (projectId: string) => void;
}) {
  const location = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const m = location.pathname.match(/^\/projects\/([^/]+)/);
  const projectId = m?.[1] ?? fallbackProjectId;
  const disabled = !projectId;

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const viewReport = useMutation({
    mutationFn: () =>
      reportsApi.generate(projectId as string, {
        type: 'SESSION',
        workSessionId: sessionId,
        includeSession: true,
        includeProject: false,
        includeFeature: false,
        format: 'HTML',
      }),
    onSuccess: async (data: { report: { id: string; title: string } }) => {
      setMenuOpen(false);
      toast.success('Session report generated', data.report.title);
      try {
        const resp = await api.get(`/api/v1/reports/${data.report.id}/download`, {
          params: { inline: 1 }, responseType: 'blob',
        });
        const blob = new Blob([resp.data], { type: resp.headers['content-type'] ?? 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        toast.error('Open failed', 'Could not open the rendered report.');
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not generate report', typeof msg === 'string' ? msg : 'Try again from a project page.');
    },
  });

  const busy = viewReport.isPending;

  return (
    <div className="relative shrink-0" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy || disabled}
        title={disabled
          ? 'No project context yet — open a project or run a test to anchor the report'
          : 'Session report actions'}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-50"
        style={{
          background: 'rgba(168,85,247,0.18)',
          border: '1px solid rgba(168,85,247,0.40)',
          color: '#c4b5fd',
        }}
      >
        {busy ? (
          <Loader size={11} className="animate-spin" />
        ) : (
          <FileText size={11} />
        )}
        Report
        <ChevronDown size={10} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {menuOpen && !disabled && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[200px] rounded-lg py-1 z-[120]"
          style={{
            background: 'rgba(22,22,34,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
          }}
        >
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-white/[0.06]"
            style={{ color: 'rgba(238,238,248,0.88)' }}
            disabled={busy}
            onClick={() => {
              viewReport.mutate();
            }}
          >
            <ExternalLink size={12} style={{ color: '#c4b5fd' }} />
            View report
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-white/[0.06]"
            style={{ color: 'rgba(238,238,248,0.88)' }}
            disabled={busy}
            onClick={() => {
              setMenuOpen(false);
              if (projectId) onOpenEmailModal(projectId);
            }}
          >
            <Mail size={12} style={{ color: '#c4b5fd' }} />
            Generate and email report
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="text-base font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'rgba(238,238,248,0.40)' }}>
        {label}
      </p>
    </div>
  );
}
