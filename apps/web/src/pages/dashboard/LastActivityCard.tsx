import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Clock, ArrowRight, CheckCircle, XCircle, Bug, Activity } from 'lucide-react';
import { workSessionsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

// ─── LastActivityCard ────────────────────────────────────────────────────────
// Shown on the Dashboard. If the user has a previous (ended) work session,
// displays a summary + a "Continue where you left off" button that jumps
// directly into the last test they worked on, in Test Mode.

interface LastSessionResponse {
  session: {
    id: string;
    startedAt: string;
    endedAt: string;
    endedReason: string | null;
    lastTestDefinitionId: string | null;
    lastFeatureId: string | null;
    lastModuleId: string | null;
    lastProjectId: string | null;
    lastActivityAt: string | null;
    lastActivityType: string | null;
  } | null;
  stats: {
    totalTestRuns: number;
    passed: number;
    failed: number;
    issuesLogged: number;
  } | null;
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function LastActivityCard() {
  const navigate = useNavigate();
  const { token } = useAuthStore();

  const { data } = useQuery<LastSessionResponse>({
    queryKey: ['work-session-last'],
    queryFn: () => workSessionsApi.last(),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });

  if (!data?.session || !data.stats) return null;
  const { session, stats } = data;

  const canContinue =
    !!session.lastProjectId &&
    !!session.lastModuleId &&
    !!session.lastFeatureId;

  const handleContinue = () => {
    if (!canContinue) return;
    // Navigate to the feature page. Test Mode opens automatically via a
    // query param the feature page reads on mount (implemented there).
    navigate(
      `/projects/${session.lastProjectId}/modules/${session.lastModuleId}/features/${session.lastFeatureId}?testMode=1`,
    );
  };

  return (
    <div
      className="rounded-2xl p-5 animate-fade-in"
      style={{
        background: 'linear-gradient(135deg, rgba(var(--accent-rgb),0.10), rgba(var(--accent-rgb),0.04))',
        border: '1px solid rgba(var(--accent-rgb),0.30)',
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}
          >
            <Activity size={18} style={{ color: 'var(--accent-300)' }} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: 'rgba(238,238,248,0.50)' }}>
              Last activity
            </p>
            <p className="text-sm font-semibold mt-0.5" style={{ color: 'rgba(238,238,248,0.92)' }}>
              {session.lastActivityAt
                ? `You tested ${formatRelative(session.lastActivityAt)}`
                : `Session ended ${formatRelative(session.endedAt)}`}
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs">
              <span className="flex items-center gap-1" style={{ color: '#34d399' }}>
                <CheckCircle size={11} /> {stats.passed}
              </span>
              <span className="flex items-center gap-1" style={{ color: '#f87171' }}>
                <XCircle size={11} /> {stats.failed}
              </span>
              <span className="flex items-center gap-1" style={{ color: '#fbbf24' }}>
                <Bug size={11} /> {stats.issuesLogged}
              </span>
              <span style={{ color: 'rgba(238,238,248,0.40)' }}>
                · {stats.totalTestRuns} test{stats.totalTestRuns !== 1 ? 's' : ''} total
              </span>
              <span className="flex items-center gap-1" style={{ color: 'rgba(238,238,248,0.35)' }}>
                <Clock size={10} /> {formatRelative(session.startedAt)}
              </span>
            </div>
          </div>
        </div>
        {canContinue && (
          <button
            onClick={handleContinue}
            className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg transition-all flex-shrink-0"
            style={{
              background: 'rgba(var(--accent-rgb),0.85)',
              color: '#fff',
              border: '1px solid rgba(var(--accent-rgb),0.55)',
              boxShadow: '0 4px 14px rgba(var(--accent-rgb),0.32)',
            }}
          >
            Continue testing <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
