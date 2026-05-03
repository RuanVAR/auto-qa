import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Activity, CheckCircle, XCircle, Bug, ChevronDown, FileText, Loader } from 'lucide-react';
import { workSessionsApi, reportsApi, api } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
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
  const setCurrent = useWorkSessionStore((s) => s.setCurrent);

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
              <SessionReportButton
                sessionId={data.session.id}
                fallbackProjectId={data.session.lastProjectId ?? null}
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
    </div>
  );
}

/**
 * "Generate Report" button on the active session card.
 *
 * Behaviour:
 *   - Reads projectId from the URL when on `/projects/:id/...` (most common
 *     case — tester is in a project context).
 *   - If not on a project page, the API derives projectId from the session's
 *     lastProjectId field. So even from the dashboard the button works.
 *   - Generates a SESSION-scoped report (HTML), then opens it inline in a
 *     new tab via the inline-download URL.
 */
function SessionReportButton({ sessionId, fallbackProjectId }: { sessionId: string; fallbackProjectId: string | null }) {
  const location = useLocation();
  // Prefer the URL — gives a stable scope tied to where the user is right
  // now. Fall back to the session's lastProjectId so the button still
  // works when triggered from non-project pages (Dashboard, Settings).
  const m = location.pathname.match(/^\/projects\/([^/]+)/);
  const projectId = m?.[1] ?? fallbackProjectId;
  const disabled = !projectId;

  const generate = useMutation({
    mutationFn: () => reportsApi.generate(projectId as string, {
      type: 'SESSION',
      workSessionId: sessionId,
      includeSession: true,
      includeProject: false,
      includeFeature: false,
      format: 'HTML',
    } as never),
    onSuccess: async (data: { report: { id: string; title: string } }) => {
      toast.success('Session report generated', data.report.title);
      // The download endpoint is JWT-guarded; window.open from a new tab
      // wouldn't carry the localStorage token. Fetch with axios (which
      // applies the auth interceptor) → blob → open via blob URL. The
      // browser revokes the URL when the tab closes; we also revoke
      // explicitly after a delay to free memory.
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

  return (
    <button
      onClick={() => generate.mutate()}
      disabled={generate.isPending || disabled}
      title={disabled
        ? 'No activity yet — visit a project to anchor the report scope'
        : 'Generate a report covering everything done in this session'}
      className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md transition-colors disabled:opacity-50"
      style={{
        background: 'rgba(168,85,247,0.18)',
        border: '1px solid rgba(168,85,247,0.40)',
        color: '#c4b5fd',
      }}
    >
      {generate.isPending
        ? <><Loader size={11} className="animate-spin" /> Generating…</>
        : <><FileText size={11} /> Report</>}
    </button>
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
