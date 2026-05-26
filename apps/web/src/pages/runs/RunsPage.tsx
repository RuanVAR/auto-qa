import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, RefreshCw, XCircle, CheckCircle, Activity, Filter, ArrowLeft } from 'lucide-react';
import { runsApiFiltered, runsApi, testsApi, environmentsApi, featuresApi } from '@/lib/api';
import { useProjectRunSocket } from '@/hooks/useRunSocket';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate, formatDuration } from '@/lib/utils';

const RUN_STATUSES = ['PENDING', 'QUEUED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED', 'ERROR'];

export function RunsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  // Live updates via WebSocket — invalidates run list automatically when status changes
  useProjectRunSocket(projectId);
  const [open, setOpen] = useState(false);
  const [envId, setEnvId] = useState('');
  const [testId, setTestId] = useState('');

  // URL-driven scope. When `?testId=` or `?featureId=` is present, this page
  // shows runs for one test / one feature only — set by the "Test Runs"
  // buttons on the test editor and feature page. No param = project-wide.
  const [searchParams] = useSearchParams();
  const scopeTestId = searchParams.get('testId') ?? '';
  const scopeFeatureId = searchParams.get('featureId') ?? '';
  const isScoped = !!(scopeTestId || scopeFeatureId);

  // Filter state
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTestId, setFilterTestId] = useState('');
  const [filterEnvId, setFilterEnvId] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // A scope change is effectively a fresh list — reset to page 1.
  useEffect(() => { setPage(1); }, [scopeTestId, scopeFeatureId]);

  const filters = {
    status: filterStatus || undefined,
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

  const trigger = useMutation({
    mutationFn: () => runsApi.trigger(projectId!, { environmentId: envId, testDefinitionId: testId }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs', projectId] }); setOpen(false); },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => runsApi.cancel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs', projectId] }),
  });

  function clearFilters() {
    setFilterStatus('');
    setFilterTestId('');
    setFilterEnvId('');
    setPage(1);
  }

  const hasFilters = !!(filterStatus || filterTestId || filterEnvId);

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
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
          <h2 className="text-xl font-bold text-gray-900">Test Runs</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {scopeLabel && <span className="font-medium text-gray-700">{scopeLabel}</span>}
            {scopeLabel && ' · '}
            {total} run{total !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetch()}><RefreshCw size={14} /> Refresh</Button>
          <Button onClick={() => setOpen(true)}><Play size={14} /> Trigger Run</Button>
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

      {/* Filter bar */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-xl px-4 py-3"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Filter size={14} style={{ color: 'rgba(238,238,248,0.35)' }} className="shrink-0" />
        {[
          { value: filterStatus, onChange: (v: string) => { setFilterStatus(v); setPage(1); }, placeholder: 'All statuses', options: RUN_STATUSES.map(s => ({ value: s, label: s })) },
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
            style={{ color: '#a78bfa' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#c4b5fd')}
            onMouseLeave={e => (e.currentTarget.style.color = '#a78bfa')}
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
                      <Button
                        onClick={() => {
                          setTestId(scopeTestId);
                          setOpen(true);
                        }}
                      >
                        <Play size={14} /> Trigger Run
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
                  description="Trigger a test run to see results here."
                  action={
                    <Button onClick={() => setOpen(true)}>
                      <Play size={14} /> Trigger Run
                    </Button>
                  }
                />
              );
            })()}
          </CardContent>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Test</Th><Th>Environment</Th><Th>Status</Th><Th>Duration</Th><Th>Trigger</Th><Th>Started</Th><Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {runs.map(r => {
                const env = r.environment as Record<string, string> | null;
                const test = r.testDefinition as Record<string, string> | null;
                const isActive = ['PENDING', 'QUEUED', 'RUNNING'].includes(r.status as string);
                return (
                  <Tr key={r.id as string}>
                    <Td>
                      <Link to={`/runs/${r.id}`} className="font-medium text-gray-800 hover:text-sky-600">
                        {test?.name ?? '—'}
                      </Link>
                    </Td>
                    <Td><span className="text-gray-500">{env?.name ?? '—'}</span></Td>
                    <Td><RunStatusBadge status={r.status as string} /></Td>
                    <Td><span className="text-gray-500 font-mono text-xs">{formatDuration(r.duration as number)}</span></Td>
                    <Td><span className="text-gray-400 text-xs">{r.trigger as string}</span></Td>
                    <Td><span className="text-gray-400 text-xs">{formatDate(r.createdAt as string)}</span></Td>
                    <Td>
                      {isActive && (
                        <button onClick={() => cancel.mutate(r.id as string)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500">
                          <XCircle size={13} />
                        </button>
                      )}
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

      {/* Trigger modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Trigger Test Run">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Test Definition</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={testId}
              onChange={e => setTestId(e.target.value)}
            >
              <option value="">Select a test...</option>
              {(tests as Record<string, string>[]).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
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
            <Button loading={trigger.isPending} disabled={!testId || !envId} onClick={() => trigger.mutate()}>
              <Play size={14} /> Trigger Run
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
