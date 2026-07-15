import { useState } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, CheckCircle, XCircle, Clock, Bug, MinusCircle, FileText } from 'lucide-react';
import { testRunSessionsApi } from '@/lib/api';
import { PageSpinner } from '@/components/ui/Spinner';
import { GenerateReportButton } from '@/components/GenerateReportButton';
import { RunReportModal } from '@/components/runs/RunReportModal';

type Detail = {
  id: string;
  projectId: string;
  name: string;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  startedFromFeature: { id: string; name: string } | null;
  environment: { id: string; name: string; type: string } | null;
  createdBy: { id: string; name: string | null; email: string } | null;
  counts: { total: number; passed: number; failed: number; other: number };
  testRuns: Array<{
    id: string;
    status: string;
    bugCount: number;
    /** When this test's result was last set/updated (re-marks bump it). */
    completedAt: string | null;
    testDefinition: { id: string; name: string; feature: { id: string; name: string } | null } | null;
    environment: { id: string; name: string } | null;
  }>;
  issues: Array<{ id: string; title: string; type: string; severity: string; status: string; featureId: string | null; createdAt: string }>;
  latestReport: { id: string; title: string; format: string; generatedAt: string; emailedAt: string | null; recipientEmails: string[] } | null;
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
function resultIcon(status: string) {
  if (status === 'PASSED') return <CheckCircle size={14} style={{ color: '#34d399' }} />;
  if (status === 'FAILED') return <XCircle size={14} style={{ color: '#f87171' }} />;
  // ERROR = infra error, not a verdict → "needs testing" (neutral), not failed.
  return <MinusCircle size={14} style={{ color: 'rgba(238,238,248,0.4)' }} />;
}
// Show the RESULT, never the per-execution state (RUNNING/PENDING come from the
// underlying TestRun machinery — irrelevant to a manual run's results view).
function resultLabel(status: string): { text: string; color: string } {
  if (status === 'PASSED') return { text: 'Passed', color: '#34d399' };
  if (status === 'FAILED') return { text: 'Failed', color: '#f87171' };
  if (status === 'CANCELLED' || status === 'SKIPPED') return { text: 'Skipped', color: 'rgba(238,238,248,0.5)' };
  // ERROR (and anything else non-terminal) reads as "needs testing".
  return { text: status === 'ERROR' ? 'Needs testing' : 'Not tested', color: 'rgba(238,238,248,0.45)' };
}

export function TestRunDetailPage() {
  const { projectId, id } = useParams<{ projectId: string; id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [viewReport, setViewReport] = useState(false);
  const back = (location.state as { back?: { to: string; label: string } } | null)?.back;

  const { data, isLoading } = useQuery<Detail>({
    queryKey: ['test-run-session', id],
    queryFn: () => testRunSessionsApi.get(id!),
    enabled: !!id,
  });

  if (isLoading || !data) return <PageSpinner />;
  const run = data;
  const st = STATUS_STYLE[run.status] ?? STATUS_STYLE.ABANDONED;

  // Group results by feature so a multi-feature run reads clearly.
  const byFeature = new Map<string, { name: string; rows: Detail['testRuns'] }>();
  for (const tr of run.testRuns) {
    const f = tr.testDefinition?.feature;
    const key = f?.id ?? 'none';
    if (!byFeature.has(key)) byFeature.set(key, { name: f?.name ?? 'Unscoped', rows: [] });
    byFeature.get(key)!.rows.push(tr);
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(back?.to ?? `/projects/${projectId}/test-runs`)}
        className="inline-flex items-center gap-1 text-sm mb-3 transition-colors"
        style={{ color: 'rgba(238,238,248,0.5)' }}
      >
        <ChevronLeft size={15} /> {back?.label ?? 'Test Runs'}
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-gray-900">{run.name}</h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, border: `1px solid ${st.border}`, color: st.color }}>{st.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <span>Started {fmtDate(run.startedAt)}</span>
            <span>Ended {fmtDate(run.endedAt)}</span>
            <span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDuration(run.duration)}</span>
            {run.startedFromFeature && <span>From {run.startedFromFeature.name}</span>}
            {run.environment && <span>Env {run.environment.name}</span>}
            {run.createdBy && <span>By {run.createdBy.name ?? run.createdBy.email}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {run.latestReport && (
            <button
              type="button"
              onClick={() => setViewReport(true)}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium"
              style={{ background: 'rgba(var(--accent-rgb),0.16)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}
            >
              <FileText size={13} /> View report
            </button>
          )}
          <GenerateReportButton
            projectId={run.projectId}
            scope={{ type: 'RUN', testRunSessionId: run.id }}
            scopeTitle={run.name}
            variant="secondary"
            label={run.latestReport ? 'Regenerate' : 'Generate report'}
            onGenerated={() => qc.invalidateQueries({ queryKey: ['test-run-session', id] })}
          />
        </div>
      </div>

      {viewReport && run.latestReport && (
        <RunReportModal
          reportId={run.latestReport.id}
          title={run.latestReport.title}
          alreadyEmailed={!!run.latestReport.emailedAt}
          onClose={() => setViewReport(false)}
        />
      )}

      {/* Result tiles */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Tests', val: run.counts.total, color: 'rgba(238,238,248,0.85)' },
          { label: 'Passed', val: run.counts.passed, color: '#34d399' },
          { label: 'Failed', val: run.counts.failed, color: '#f87171' },
          { label: 'Bugs', val: run.issues.length, color: '#fbbf24' },
        ].map((t) => (
          <div key={t.label} className="rounded-xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="text-2xl font-semibold" style={{ color: t.color }}>{t.val}</div>
            <div className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.5)' }}>{t.label}</div>
          </div>
        ))}
      </div>

      {/* Tests grouped by feature (a run can span features) */}
      <h2 className="text-sm font-semibold text-gray-800 mb-2">Tests in this run</h2>
      {[...byFeature.values()].map((grp, gi) => (
        <div key={gi} className="mb-4 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="px-3 py-2 text-xs font-semibold" style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(238,238,248,0.6)' }}>{grp.name}</div>
          {grp.rows.map((tr) => (
            <div key={tr.id} className="flex items-center gap-2 px-3 py-2 text-sm" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.8)' }}>
              {resultIcon(tr.status)}
              <span className="flex-1 truncate">{tr.testDefinition?.name ?? 'Test'}</span>
              {tr.bugCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}
                  title={`${tr.bugCount} bug${tr.bugCount === 1 ? '' : 's'} logged on this test`}
                >
                  <Bug size={11} /> {tr.bugCount}
                </span>
              )}
              {tr.completedAt && (
                <span className="text-[11px] tabular-nums" style={{ color: 'rgba(238,238,248,0.4)' }} title="Result last updated">
                  {new Date(tr.completedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <span className="text-xs font-medium" style={{ color: resultLabel(tr.status).color }}>{resultLabel(tr.status).text}</span>
            </div>
          ))}
        </div>
      ))}
      {run.testRuns.length === 0 && <div className="text-sm py-4" style={{ color: 'rgba(238,238,248,0.45)' }}>No tests marked in this run yet.</div>}

      {/* Bugs logged during the run */}
      {run.issues.length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-800 mb-2 mt-6 flex items-center gap-1.5"><Bug size={15} style={{ color: '#fbbf24' }} /> Bugs logged ({run.issues.length})</h2>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            {run.issues.map((iss) => (
              <Link key={iss.id} to={`/projects/${projectId}/issues?issue=${iss.id}`} className="flex items-center gap-2 px-3 py-2 text-sm transition-colors" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.8)' }}>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}>{iss.severity}</span>
                <span className="flex-1 truncate">{iss.title}</span>
                <span className="text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>{iss.status}</span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
