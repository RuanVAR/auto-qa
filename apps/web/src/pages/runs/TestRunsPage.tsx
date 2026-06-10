import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ChevronLeft, CheckCircle, XCircle, Clock } from 'lucide-react';
import { testRunSessionsApi } from '@/lib/api';
import { PageSpinner } from '@/components/ui/Spinner';

type RunRow = {
  id: string;
  name: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  startedFromFeature: { id: string; name: string } | null;
  environment: { id: string; name: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  _count: { testRuns: number; issues: number };
  results: { passed: number; failed: number; other: number };
};

const STATUS_STYLE: Record<string, { bg: string; border: string; color: string; label: string }> = {
  ACTIVE: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)', color: '#60a5fa', label: 'Active' },
  COMPLETED: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.4)', color: '#34d399', label: 'Completed' },
  ABANDONED: { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.3)', color: '#94a3b8', label: 'Abandoned' },
};

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function TestRunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>('');

  const { data, isLoading } = useQuery({
    queryKey: ['test-run-sessions', projectId, status],
    queryFn: () => testRunSessionsApi.list(projectId!, status ? { status } : undefined),
    enabled: !!projectId,
  });
  const rows: RunRow[] = data?.items ?? [];

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      <Link to={`/projects/${projectId}/runs`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ChevronLeft size={15} /> Runs
      </Link>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <ClipboardList size={20} style={{ color: 'var(--accent-400)' }} />
          <h1 className="text-xl font-semibold text-gray-900">Test Runs</h1>
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg px-3 py-1.5 text-sm focus:outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="ABANDONED">Abandoned</option>
        </select>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'rgba(238,238,248,0.45)' }}>
          No test runs yet. Start one from a feature with “Start Manual Run”.
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(238,238,248,0.55)' }}>
                {['Run', 'Status', 'Results', 'Started', 'Ended', 'Duration', 'From feature', 'By'].map((h) => (
                  <th key={h} className="text-left font-medium px-3 py-2.5 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.ABANDONED;
                return (
                  <tr
                    key={r.id}
                    onClick={() => navigate(`/projects/${projectId}/test-runs/${r.id}`)}
                    className="cursor-pointer transition-colors"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900 max-w-[220px] truncate" title={r.name}>{r.name}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>{st.label}</span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2" style={{ color: 'rgba(238,238,248,0.7)' }}>
                        <span className="inline-flex items-center gap-1" style={{ color: '#34d399' }}><CheckCircle size={12} />{r.results.passed}</span>
                        <span className="inline-flex items-center gap-1" style={{ color: '#f87171' }}><XCircle size={12} />{r.results.failed}</span>
                        <span style={{ color: 'rgba(238,238,248,0.4)' }}>/ {r._count.testRuns}</span>
                        {r._count.issues > 0 && <span style={{ color: '#fbbf24' }}>· {r._count.issues} bug{r._count.issues !== 1 ? 's' : ''}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}>{fmtDate(r.startedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}>{fmtDate(r.endedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}><span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDuration(r.duration)}</span></td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" style={{ color: 'rgba(238,238,248,0.6)' }}>{r.startedFromFeature?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}>{r.createdBy?.name ?? r.createdBy?.email ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
