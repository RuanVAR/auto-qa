import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, XCircle, CheckCircle, Activity, Filter, ArrowLeft, ChevronLeft, Eye, Zap, User } from 'lucide-react';
import { runsApiFiltered, runsApi, testsApi, environmentsApi, featuresApi, featureRunsApi, selectorHealsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { useProjectRunSocket } from '@/hooks/useRunSocket';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate, formatDuration, errMsg } from '@/lib/utils';
import { SchedulesPanel } from './SchedulesPanel';
import { PipelinesPanel } from './PipelinesPanel';

const RUN_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'CANCELLED', 'NOT_TESTED', 'ERROR'];

export function RunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Live updates via WebSocket — invalidates run list automatically when status changes
  useProjectRunSocket(projectId);
  // "Start Testing" modal — a run is a feature testing session (many tests),
  // not a single test. Mirrors the feature page: pick a feature, pick a mode
  // (automated only when the feature allows it), pick an env, then land in the
  // Testing view where the session runs and can roam to the next feature.
  const [open, setOpen] = useState(false);
  const [envId, setEnvId] = useState('');
  const [startFeatureId, setStartFeatureId] = useState('');
  const [runMode, setRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');
  // Active-session conflict (409): the user already has a manual session live.
  type ActiveRunConflict = { id: string; featureId: string; featureName: string; moduleId: string; projectId: string; startedAt: string; sameFeature: boolean };
  const [conflict, setConflict] = useState<ActiveRunConflict | null>(null);

  // URL-driven scope. When `?testId=` or `?featureId=` is present, this page
  // shows runs for one test / one feature only — set by the "Test Runs"
  // buttons on the test editor and feature page. No param = project-wide.
  const [searchParams] = useSearchParams();
  const scopeTestId = searchParams.get('testId') ?? '';
  const scopeFeatureId = searchParams.get('featureId') ?? '';
  const isScoped = !!(scopeTestId || scopeFeatureId);
  // `?scheduleFeatureId=` — the feature page's Schedule shortcut. Deliberately
  // not a scope param: it opens the schedule modal pre-filled on the
  // project-wide view, where the Schedules panel lives.
  const scheduleFeatureId = searchParams.get('scheduleFeatureId') ?? '';

  // Filter state
  const [filterStatus, setFilterStatus] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [filterTestId, setFilterTestId] = useState('');
  const [filterEnvId, setFilterEnvId] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // A scope change is effectively a fresh list — reset to page 1.
  useEffect(() => { setPage(1); }, [scopeTestId, scopeFeatureId]);

  const filters = {
    status: filterStatus || undefined,
    mode: filterMode || undefined,
    testId: scopeTestId || filterTestId || undefined,
    featureId: scopeFeatureId || undefined,
    envId: filterEnvId || undefined,
    page,
    limit,
  };

  const { data: runsData, isLoading, refetch } = useQuery({
    queryKey: ['runs', projectId, filters],
    queryFn: () => runsApiFiltered.list(projectId!, filters),
    enabled: !!projectId,
    staleTime: 15_000,
    // Socket (useProjectRunSocket) handles live updates. No polling needed.
    // Fallback: refetch every 60s only if any run is RUNNING, else never.
    refetchInterval: (query) => {
      const data = (query as unknown as { state: { data: unknown } }).state.data as { items?: { status: string }[] } | { status: string }[] | undefined;
      const items = Array.isArray(data) ? data : data?.items ?? [];
      const hasActive = items.some(r => r.status === 'RUNNING' || r.status === 'QUEUED');
      return hasActive ? 60_000 : false;
    },
  });

  const runs: Record<string, unknown>[] = (runsData as { items?: Record<string, unknown>[] })?.items ?? (Array.isArray(runsData) ? runsData as Record<string, unknown>[] : []);
  const total: number = (runsData as { total?: number })?.total ?? runs.length;
  const totalPages = Math.ceil(total / limit);

  // Stats follow the URL scope — per-test or per-feature page shows
  // per-test / per-feature pass rate, not project-wide. Was a stale
  // signal that confused users on empty scoped pages.
  const { data: stats } = useQuery({
    queryKey: ['run-stats', projectId, { testId: scopeTestId, featureId: scopeFeatureId }],
    queryFn: () => runsApi.stats(projectId!, {
      testId: scopeTestId || undefined,
      featureId: scopeFeatureId || undefined,
    }),
    enabled: !!projectId,
  });
  const { data: tests = [] } = useQuery({
    queryKey: ['tests', projectId],
    queryFn: () => testsApi.list(projectId!),
    enabled: !!projectId,
  });
  const { data: envs = [] } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });
  // Features for the "Start Testing" picker (project-wide, ordered by module).
  const { data: features = [] } = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId!),
    enabled: !!projectId && open,
  });
  // Automation availability is env-driven: offered when the project has at
  // least one automation-enabled environment.
  const automatedEnabled = (envs as Array<{ supportsAutomation?: boolean }>).some(e => e.supportsAutomation);
  const effectiveMode: 'AUTOMATED' | 'MANUAL' = automatedEnabled ? runMode : 'MANUAL';
  // Flaky tests (20–80% pass rate over the last 100 runs). Project-wide
  // signal only — hidden on scoped views and when nothing is flaky.
  const { data: flakyTests = [] } = useQuery({
    queryKey: ['flaky-tests', projectId],
    queryFn: () => runsApi.flaky(projectId!),
    enabled: !!projectId && !isScoped,
  });
  // Selector drift detection — heals awaiting promotion review
  // (docs/plan/04-PHASE-2-HEALING.md §2.7). Project-wide, same gate as flaky.
  const { data: pendingHeals = [] } = useQuery({
    queryKey: ['selector-heals-pending', projectId],
    queryFn: () => selectorHealsApi.listPending(projectId!),
    enabled: !!projectId && !isScoped,
  });
  const promoteHealMut = useMutation({
    mutationFn: (id: string) => selectorHealsApi.promote(id),
    onSuccess: () => { toast.success('Selector promoted'); qc.invalidateQueries({ queryKey: ['selector-heals-pending', projectId] }); },
    onError: (err) => toast.error(errMsg(err, 'Failed to promote')),
  });
  const dismissHealMut = useMutation({
    mutationFn: (id: string) => selectorHealsApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['selector-heals-pending', projectId] }),
    onError: (err) => toast.error(errMsg(err, 'Failed to dismiss')),
  });
  // Only fetched when feature-scoped — for the header label.
  const { data: scopedFeature } = useQuery({
    queryKey: ['feature', scopeFeatureId],
    queryFn: () => featuresApi.get(scopeFeatureId),
    enabled: !!scopeFeatureId,
  });

  const scopeLabel = scopeTestId
    ? ((tests as Record<string, string>[]).find(t => t.id === scopeTestId)?.name ?? 'this test')
    : scopeFeatureId
      ? ((scopedFeature as { name?: string } | undefined)?.name ?? 'this feature')
      : '';

  // Start a feature testing session, then hand off to the Testing view —
  // same flow as the feature page's "Start Testing" button.
  const startSession = useMutation({
    mutationFn: (vars?: { allowConcurrent?: boolean }) => featureRunsApi.start(startFeatureId, {
      runMode: effectiveMode,
      ...(envId ? { environmentId: envId } : {}),
      ...(vars?.allowConcurrent ? { allowConcurrent: true } : {}),
    }),
    onSuccess: (data: { featureRun?: { id: string }; testRuns?: { id: string }[] }) => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      setOpen(false);
      const params = new URLSearchParams({ mode: effectiveMode });
      if (data?.featureRun?.id) params.set('runId', data.featureRun.id);
      if (data?.testRuns?.[0]?.id) params.set('testRunId', data.testRuns[0].id);
      navigate(`/projects/${projectId}/features/${startFeatureId}/test?${params.toString()}`);
      toast.success(
        effectiveMode === 'AUTOMATED' ? 'Automated feature run started' : 'Manual session started',
        effectiveMode === 'AUTOMATED' ? 'Opening live Playwright preview.' : 'Step through each test and mark pass/fail.',
      );
    },
    onError: (err: unknown) => {
      // 409 with payload → the user already has an active manual session.
      // Open the conflict modal (Resume / End-and-start) instead of a toast.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { code?: string; activeRun?: ActiveRunConflict } } })?.response?.data;
      if (status === 409 && data?.code === 'ACTIVE_SESSION_CONFLICT' && data.activeRun) {
        setOpen(false);
        setConflict(data.activeRun);
        return;
      }
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not start testing', typeof msg === 'string' ? msg : 'Pick a different feature or environment and try again.');
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => runsApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', projectId] }),
  });

  function clearFilters() {
    setFilterStatus('');
    setFilterMode('');
    setFilterTestId('');
    setFilterEnvId('');
    setPage(1);
  }

  const hasFilters = !!(filterStatus || filterMode || filterTestId || filterEnvId);

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      {/* Back to project — its own row, top-left. Only on the project-wide
          view; the scoped view already has its own "All test runs" back link. */}
      {!isScoped && (
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="inline-flex items-center gap-1 text-sm transition-opacity opacity-80 hover:opacity-100"
          style={{ color: 'rgba(238,238,248,0.55)' }}
        >
          <ChevronLeft size={16} /> Project
        </button>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {isScoped && (
            <Link
              to={`/projects/${projectId}/runs`}
              className="inline-flex items-center gap-1 text-xs font-medium mb-1 text-sky-600 hover:text-sky-700"
            >
              <ArrowLeft size={12} /> All test runs
            </Link>
          )}
          {/* Title matches the entry point: the project-wide view also owns
              schedules; the scoped view is a plain run list. */}
          <h2 className="text-xl font-bold text-gray-900">{isScoped ? 'Test Runs' : 'Runs & Schedules'}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {scopeLabel && <span className="font-medium text-gray-700">{scopeLabel}</span>}
            {scopeLabel && ' · '}
            {total} run{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetch()}><RefreshCw size={14} /> Refresh</Button>
          <Button onClick={() => setOpen(true)}><Play size={14} /> Start Testing</Button>
        </div>
      </div>

      {/* Stats — hidden when scoped to a test/feature with no runs, since
          a row of zeros adds clutter without signal. */}
      {stats && !(isScoped && ((stats as Record<string, unknown>).total as number) === 0) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total" value={(stats as Record<string, unknown>).total as number} icon={Activity} color="sky" />
          <StatCard label="Passed" value={(stats as Record<string, unknown>).passed as number} icon={CheckCircle} color="green" />
          <StatCard label="Failed" value={(stats as Record<string, unknown>).failed as number} icon={XCircle} color="red" />
          <StatCard label="Pass Rate" value={`${(stats as Record<string, unknown>).passRate}%`} icon={CheckCircle} color={((stats as Record<string, unknown>).passRate as number) >= 80 ? 'green' : 'yellow'} />
        </div>
      )}

      {/* Flaky tests — flagged by any enabled flake-scoring monitor
          (docs/plan/05-PHASE-3-INTELLIGENCE.md §3.5: passOnRetry,
          transitionCount, failureRate — published, not an opaque score).
          Surfaced so unstable tests get fixed instead of eroding trust in
          the suite. Hidden when scoped or when nothing is flaky. */}
      {!isScoped && (flakyTests as Array<Record<string, unknown>>).length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-yellow-500" />
              <span className="text-sm font-semibold text-gray-900">
                Flaky tests ({(flakyTests as Array<Record<string, unknown>>).length})
              </span>
              <span className="text-xs text-gray-400" title="passOnRetry: needed a retry to pass. transitionCount: ≥3 pass/fail flips in the last 10 runs (Allure's rule). failureRate: opt-in, off by default.">
                flagged by: pass-on-retry · transition count · failure rate (opt-in)
              </span>
            </div>
            <div className="space-y-1">
              {(flakyTests as Array<{ id: string; name: string; passRate: number; passed: number; total: number; flaggedMonitors: string[] }>).map(t => (
                <Link
                  key={t.id}
                  to={`/projects/${projectId}/runs?testId=${t.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50"
                >
                  <span className="truncate text-xs text-gray-700">{t.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {t.flaggedMonitors.map(m => (
                      <span key={m} className="rounded-full bg-yellow-50 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 border border-yellow-200">
                        {m === 'passOnRetry' ? 'retry' : m === 'transitionCount' ? 'flip' : 'rate'}
                      </span>
                    ))}
                    <span className="text-xs font-medium tabular-nums text-yellow-600">
                      {t.passRate}% · {t.passed}/{t.total} passed
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selector drift detection — heals awaiting promotion review
          (docs/plan/04-PHASE-2-HEALING.md §2.7). Propose-by-default: nothing
          is ever silently rewritten into a test's stored steps. */}
      {!isScoped && (pendingHeals as Array<{ id: string; testDefinition: { id: string; name: string }; stepName: string; originalSelector: string | null; healedSelector: string; confidence: string }>).length > 0 && (
        <Card>
          <CardContent className="py-3">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-yellow-500" />
              <span className="text-sm font-semibold text-gray-900">
                Selector drift ({(pendingHeals as unknown[]).length})
              </span>
              <span className="text-xs text-gray-400">healed selectors awaiting review — never applied automatically</span>
            </div>
            <div className="space-y-1.5">
              {(pendingHeals as Array<{ id: string; testDefinition: { id: string; name: string }; stepName: string; originalSelector: string | null; healedSelector: string; confidence: string }>).map(h => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-gray-700">{h.testDefinition.name} — {h.stepName}</div>
                    <div className="truncate text-[11px] text-gray-400">
                      <span className="text-red-500">{h.originalSelector ?? '(unknown)'}</span>
                      {' → '}
                      <span className="text-green-600">{h.healedSelector}</span>
                      {' · '}{h.confidence}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => promoteHealMut.mutate(h.id)}
                      disabled={promoteHealMut.isPending}
                      title="Promote — make this the primary selector"
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"
                    >
                      <CheckCircle size={12} /> Promote
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissHealMut.mutate(h.id)}
                      disabled={dismissHealMut.isPending}
                      title="Dismiss — leave the test as-is"
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 disabled:opacity-40"
                    >
                      <XCircle size={12} /> Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pipelines — ordered multi-feature automated runs, one CI-triggerable unit. */}
      {!isScoped && automatedEnabled && <PipelinesPanel projectId={projectId!} />}

      {/* Scheduled runs — recurring automated runs (cron per feature+env or pipeline). */}
      {!isScoped && automatedEnabled && (
        <SchedulesPanel projectId={projectId!} presetFeatureId={scheduleFeatureId || undefined} />
      )}

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Filter size={14} style={{ color: 'rgba(238,238,248,0.35)' }} className="shrink-0" />
        {[
          { value: filterStatus, onChange: (v: string) => { setFilterStatus(v); setPage(1); }, placeholder: 'All statuses', options: RUN_STATUSES.map(s => ({ value: s, label: s })) },
          { value: filterMode, onChange: (v: string) => { setFilterMode(v); setPage(1); }, placeholder: 'All modes', options: [{ value: 'MANUAL', label: 'Manual' }, { value: 'AUTOMATED', label: 'Automated' }] },
          // The per-test dropdown is redundant when the page is already
          // scoped to a single test via the URL.
          ...(scopeTestId ? [] : [{ value: filterTestId, onChange: (v: string) => { setFilterTestId(v); setPage(1); }, placeholder: 'All tests', options: (tests as Record<string, string>[]).map(t => ({ value: t.id, label: t.name })) }]),
          { value: filterEnvId, onChange: (v: string) => { setFilterEnvId(v); setPage(1); }, placeholder: 'All environments', options: (envs as Record<string, string>[]).map(e => ({ value: e.id, label: e.name })) },
        ].map((f, i) => (
          <select
            key={i}
            value={f.value}
            onChange={e => f.onChange(e.target.value)}
            className="rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.75)',
              appearance: 'none',
              WebkitAppearance: 'none',
              paddingRight: '2rem',
            }}
          >
            <option value="" style={{ background: '#1a1a2e' }}>{f.placeholder}</option>
            {f.options.map(o => <option key={o.value} value={o.value} style={{ background: '#1a1a2e' }}>{o.label}</option>)}
          </select>
        ))}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs font-medium ml-auto transition-colors"
            style={{ color: 'var(--accent-400)' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-300)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--accent-400)')}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Runs table */}
      <Card>
        {runs.length === 0 ? (
          <CardContent>
            {/* Three distinct empty cases — the old generic "Try adjusting
                your filters" message was misleading when the empty was
                caused by URL scope (testId / featureId), not by the
                in-page selects. */}
            {(() => {
              if (scopeTestId) {
                return (
                  <EmptyState
                    icon={Play}
                    title="No runs for this test yet"
                    description={
                      scopeLabel
                        ? `“${scopeLabel}” has no runs visible to you. Trigger one to capture results — or check whether your environment access includes the env it normally runs in.`
                        : 'Trigger one to capture results — or check whether your environment access includes the env it normally runs in.'
                    }
                    action={
                      <Button onClick={() => setOpen(true)}>
                        <Play size={14} /> Start Testing
                      </Button>
                    }
                  />
                );
              }
              if (scopeFeatureId) {
                return (
                  <EmptyState
                    icon={Play}
                    title="No runs for this feature yet"
                    description={
                      scopeLabel
                        ? `No tests in “${scopeLabel}” have been run, or none are visible under your environment access.`
                        : 'No tests in this feature have been run yet.'
                    }
                  />
                );
              }
              if (hasFilters) {
                return (
                  <EmptyState
                    icon={Play}
                    title="No runs match your filters"
                    description="Try clearing one or more filters to widen the result."
                    action={
                      <Button variant="secondary" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    }
                  />
                );
              }
              return (
                <EmptyState
                  icon={Play}
                  title="No runs yet"
                  description="Start testing a feature to see results here."
                  action={
                    <Button onClick={() => setOpen(true)}>
                      <Play size={14} /> Start Testing
                    </Button>
                  }
                />
              );
            })()}
          </CardContent>
        ) : (
          <Table cards>
            <Thead>
              <Tr>
                <Th>Test</Th><Th>Mode</Th><Th>Environment</Th><Th>Status</Th><Th>Duration</Th><Th>Run by</Th><Th>Trigger</Th><Th>Started</Th><Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {runs.map(r => {
                const env = r.environment as Record<string, string> | null;
                const test = r.testDefinition as Record<string, string> | null;
                const runner = r.triggeredBy as Record<string, string> | null;
                const isManual = (r.runMode as string) === 'MANUAL';
                const isActive = ['PENDING', 'QUEUED', 'RUNNING'].includes(r.status as string);
                return (
                  <Tr key={r.id as string}>
                    <Td label="Test">
                      <Link to={`/runs/${r.id}`} className="font-medium text-gray-800 hover:text-sky-600">
                        {test?.name ?? '—'}
                      </Link>
                    </Td>
                    <Td label="Mode">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={
                          isManual
                            ? { background: 'rgba(168,85,247,0.12)', color: '#c084fc' }
                            : { background: 'rgba(56,189,248,0.12)', color: '#38bdf8' }
                        }
                      >
                        {isManual ? 'Manual' : 'Automated'}
                      </span>
                    </Td>
                    <Td label="Environment"><span className="text-gray-500">{env?.name ?? '—'}</span></Td>
                    <Td label="Status"><RunStatusBadge status={r.status as string} /></Td>
                    <Td label="Duration"><span className="text-gray-500 font-mono text-xs">{formatDuration(r.duration as number)}</span></Td>
                    <Td label="Run by"><span className="text-gray-500 text-xs">{runner?.name ?? runner?.email ?? '—'}</span></Td>
                    <Td label="Trigger"><span className="text-gray-400 text-xs">{r.trigger as string}</span></Td>
                    <Td label="Started"><span className="text-gray-400 text-xs">{formatDate(r.createdAt as string)}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1 justify-end">
                        <Link
                          to={`/runs/${r.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-sky-600 hover:bg-sky-50"
                        >
                          <Eye size={13} /> View
                        </Link>
                        {isActive && (
                          <button onClick={() => cancel.mutate(r.id as string)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500">
                            <XCircle size={13} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages} ({total} total)</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      {/* Start Testing modal — a run is a feature testing session. Pick a
          feature, then a mode (automated only when the feature allows it),
          then an environment, and hand off to the Testing view. */}
      <Modal open={open} onClose={() => setOpen(false)} title="Start Testing">
        <div className="space-y-4">
          {/* Feature picker */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Feature to test</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={startFeatureId}
              onChange={e => { setStartFeatureId(e.target.value); setRunMode('MANUAL'); }}
            >
              <option value="">Select a feature...</option>
              {(features as Array<{ id: string; name: string; module: { name: string } }>).map(f => (
                <option key={f.id} value={f.id}>{f.module.name} › {f.name}</option>
              ))}
            </select>
          </div>

          {/* Mode selector — AUTOMATED only offered when the feature allows it */}
          {startFeatureId && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mode</label>
              <div className="flex gap-2">
                {((automatedEnabled ? ['AUTOMATED', 'MANUAL'] : ['MANUAL']) as Array<'AUTOMATED' | 'MANUAL'>).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setRunMode(m)}
                    className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium border transition-colors ${
                      effectiveMode === m
                        ? (m === 'AUTOMATED' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'bg-emerald-50 border-emerald-300 text-emerald-700')
                        : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {m === 'AUTOMATED' ? <Zap size={14} /> : <User size={14} />}
                    {m === 'AUTOMATED' ? 'Automated' : 'Manual'}
                  </button>
                ))}
              </div>
              {!automatedEnabled && (
                <p className="text-[11px] text-gray-400 mt-1.5">No automation-enabled environment — turn on “Supports automation” for an environment to run automated tests.</p>
              )}
              <p className="text-xs text-gray-500 mt-1.5">
                {effectiveMode === 'AUTOMATED'
                  ? 'Playwright runs each test sequentially — watch the live stream in the Testing view.'
                  : 'Step through each test manually and mark pass/fail; you can continue to the next feature when done.'}
              </p>
            </div>
          )}

          {/* Environment */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Environment {effectiveMode === 'MANUAL' && <span className="text-gray-400 font-normal">(optional — used for app preview)</span>}
            </label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={envId}
              onChange={e => setEnvId(e.target.value)}
            >
              <option value="">Select an environment...</option>
              {(envs as Record<string, string>[]).map(e => <option key={e.id} value={e.id}>{e.name} — {e.baseUrl}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={startSession.isPending}
              disabled={!startFeatureId || (effectiveMode === 'AUTOMATED' && !envId)}
              onClick={() => startSession.mutate(undefined)}
            >
              <Play size={14} /> Start Testing
            </Button>
          </div>
        </div>
      </Modal>

      {/* Active-session conflict — only one manual session at a time. Offer
          Resume the existing one, end it and start the new one, or cancel. */}
      <Modal open={!!conflict} onClose={() => setConflict(null)} title="You already have an active session">
        {conflict && (
          <div className="space-y-4">
            <div className="rounded-lg p-3 text-xs bg-amber-50 border border-amber-200 text-amber-700">
              You can only have one manual session running at a time.
              {conflict.sameFeature
                ? ' This is the same feature — resuming will pick up where you left off.'
                : ' Starting a new one will end the previous session.'}
            </div>
            <div className="rounded-lg p-3 bg-gray-50 border border-gray-200">
              <p className="text-[10px] uppercase tracking-wider mb-1 text-gray-400">Existing session</p>
              <p className="text-sm font-medium text-gray-800">{conflict.featureName}</p>
              <p className="text-[11px] mt-0.5 text-gray-500">Started {new Date(conflict.startedAt).toLocaleString()}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConflict(null)}>Cancel</Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const run = conflict;
                  setConflict(null);
                  navigate(`/projects/${run.projectId}/modules/${run.moduleId}/features/${run.featureId}?testMode=1`);
                }}
              >
                Resume existing →
              </Button>
              <Button
                loading={startSession.isPending}
                onClick={async () => {
                  // Clear every active manual session (not just this one — a
                  // stale third session from a race would otherwise loop the
                  // modal), then retry with allowConcurrent.
                  try { await featureRunsApi.endAllMine(); } catch { /* retry below still succeeds */ }
                  qc.invalidateQueries({ queryKey: ['my-active-runs'] });
                  setConflict(null);
                  startSession.mutate({ allowConcurrent: true });
                }}
              >
                End all my sessions & start new
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
