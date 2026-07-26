import { useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, ChevronLeft, CheckCircle, XCircle, Clock, X } from 'lucide-react';
import { testRunSessionsApi, modulesApi, featuresApi, testsApi } from '@/lib/api';
import { PageSpinner } from '@/components/ui/Spinner';
import {
  TestedVersions,
  type TestedRelease,
} from '@/components/runs/TestedVersion';

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
  testedReleases: TestedRelease[];
};

type ModuleOpt = { id: string; name: string };
type FeatureOpt = { id: string; name: string; moduleId?: string; module?: { id: string }; tags?: string[] };
type TestOpt = { id: string; name: string };

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

const selectCls = 'rounded-lg px-3 py-1.5 text-sm focus:outline-none';
const selectStyle = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.12)',
  color: 'rgba(238,238,248,0.9)',
} as const;

export function TestRunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const back = (location.state as { back?: { to: string; label: string } } | null)?.back;

  const moduleId = searchParams.get('moduleId') ?? '';
  const featureId = searchParams.get('featureId') ?? '';
  const testId = searchParams.get('testId') ?? '';
  const tag = searchParams.get('tag') ?? '';
  const status = searchParams.get('status') ?? '';
  // Default to the current user's runs; 'all' opts into the whole project.
  const scope = searchParams.get('scope') ?? 'mine';
  const hasFilters = !!(moduleId || featureId || testId || tag || status);

  // Update one filter param, cascading resets (module → clears feature+test,
  // feature → clears test). Preserve the back-context state across changes.
  const setParam = (key: string, val: string) => {
    const next = new URLSearchParams(searchParams);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key === 'moduleId') {
      next.delete('featureId');
      next.delete('testId');
    }
    if (key === 'featureId') next.delete('testId');
    setSearchParams(next, { replace: true, state: location.state });
  };
  const clearFilters = () =>
    setSearchParams(new URLSearchParams(), { replace: true, state: location.state });

  const { data, isLoading } = useQuery({
    queryKey: ['test-run-sessions', projectId, status, moduleId, featureId, testId, tag, scope],
    queryFn: () =>
      testRunSessionsApi.list(projectId!, {
        status: status || undefined,
        moduleId: moduleId || undefined,
        featureId: featureId || undefined,
        testId: testId || undefined,
        tag: tag || undefined,
        mine: scope !== 'all',
      }),
    enabled: !!projectId,
  });
  const rows: RunRow[] = data?.items ?? [];

  // Filter option sources.
  const { data: modules = [] } = useQuery<ModuleOpt[]>({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId!) as Promise<ModuleOpt[]>,
    enabled: !!projectId,
  });
  const { data: features = [] } = useQuery<FeatureOpt[]>({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId!) as Promise<FeatureOpt[]>,
    enabled: !!projectId,
  });
  const { data: tests = [] } = useQuery<TestOpt[]>({
    queryKey: ['tests-for-feature', projectId, featureId],
    queryFn: () => testsApi.list(projectId!, featureId) as Promise<TestOpt[]>,
    enabled: !!projectId && !!featureId,
  });

  const featureOpts = useMemo(
    () => features.filter((f) => !moduleId || (f.moduleId ?? f.module?.id) === moduleId),
    [features, moduleId],
  );
  const tagOpts = useMemo(
    () => Array.from(new Set(features.flatMap((f) => f.tags ?? []))).sort(),
    [features],
  );

  return (
    <div className="px-6 py-6 max-w-6xl mx-auto">
      <button
        type="button"
        onClick={() => navigate(back?.to ?? `/projects/${projectId}`)}
        className="inline-flex items-center gap-1 text-sm mb-3 transition-colors"
        style={{ color: 'rgba(238,238,248,0.5)' }}
      >
        <ChevronLeft size={15} /> {back?.label ?? 'Project'}
      </button>

      <div className="flex items-center gap-2 mb-4">
        <ClipboardList size={20} style={{ color: 'var(--accent-400)' }} />
        <h1 className="text-xl font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
          Test Runs
        </h1>
        {/* Scope: your own runs (default) vs everyone's in the project. */}
        <div className="ml-auto inline-flex rounded-lg overflow-hidden shrink-0" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
          {(['mine', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setParam('scope', s === 'mine' ? '' : 'all')}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={
                scope === s
                  ? { background: 'rgba(var(--accent-rgb),0.20)', color: 'var(--accent-300)' }
                  : { background: 'transparent', color: 'rgba(238,238,248,0.55)' }
              }
            >
              {s === 'mine' ? 'My runs' : 'All runs'}
            </button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select className={selectCls} style={selectStyle} value={moduleId} onChange={(e) => setParam('moduleId', e.target.value)}>
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select className={selectCls} style={selectStyle} value={featureId} onChange={(e) => setParam('featureId', e.target.value)}>
          <option value="">All features</option>
          {featureOpts.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        <select
          className={selectCls}
          style={{ ...selectStyle, opacity: featureId ? 1 : 0.5 }}
          value={testId}
          onChange={(e) => setParam('testId', e.target.value)}
          disabled={!featureId}
          title={featureId ? undefined : 'Pick a feature first to filter by test'}
        >
          <option value="">All tests</option>
          {tests.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select className={selectCls} style={selectStyle} value={tag} onChange={(e) => setParam('tag', e.target.value)}>
          <option value="">All tags</option>
          {tagOpts.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <select className={selectCls} style={selectStyle} value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
          <option value="ABANDONED">Abandoned</option>
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.04)' }}
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <div className="text-center py-16 text-sm" style={{ color: 'rgba(238,238,248,0.45)' }}>
          {hasFilters
            ? 'No test runs match these filters.'
            : 'No test runs yet. Start one from a feature with “Start Manual Run”.'}
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.03)', color: 'rgba(238,238,248,0.55)' }}>
                {['Run', 'Status', 'Results', 'Tested version', 'Started', 'Ended', 'Duration', 'From feature', 'Env', 'By'].map((h) => (
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
                    onClick={() =>
                      navigate(`/projects/${projectId}/test-runs/${r.id}`, {
                        state: { back: { to: `/projects/${projectId}/test-runs?${searchParams.toString()}`, label: 'Test Runs' } },
                      })
                    }
                    className="cursor-pointer transition-colors"
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-3 py-2.5 font-medium max-w-[220px] truncate" style={{ color: 'rgba(238,238,248,0.9)' }} title={r.name}>{r.name}</td>
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
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <TestedVersions releases={r.testedReleases} tone="dark" />
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}>{fmtDate(r.startedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}>{fmtDate(r.endedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.6)' }}><span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDuration(r.duration)}</span></td>
                    <td className="px-3 py-2.5 max-w-[160px] truncate" style={{ color: 'rgba(238,238,248,0.6)' }}>{r.startedFromFeature?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {r.environment?.name
                        ? <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.28)', color: '#7dd3fc' }}>{r.environment.name}</span>
                        : <span style={{ color: 'rgba(238,238,248,0.35)' }}>—</span>}
                    </td>
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
