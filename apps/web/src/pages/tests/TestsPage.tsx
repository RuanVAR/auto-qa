import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FlaskConical, Pencil, Search, BookOpen, PlayCircle, ChevronRight,
  Layers, ListChecks, CheckCircle, XCircle, Bug,
} from 'lucide-react';
import { testsApi, modulesApi, featuresApi, projectsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';

type StatusFilter = '' | 'PASSED' | 'FAILED' | 'OUTSTANDING';
type SortKey = 'updated_desc' | 'name_asc' | 'name_desc' | 'created_desc' | 'created_asc';

const SORT_LABELS: Record<SortKey, string> = {
  updated_desc: 'Recently updated',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
  created_desc: 'Newest',
  created_asc: 'Oldest',
};

const PAGE_SIZE = 25;

// ─── Status pill ──────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string | null }) {
  if (status === 'PASSED') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>Passed</span>;
  }
  if (status === 'FAILED') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>Failed</span>;
  }
  if (status === 'CANCELLED' || status === 'SKIPPED') {
    return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.25)' }}>Skipped</span>;
  }
  return <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.10)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.22)' }}>Not run</span>;
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${color}1f` }}>{icon}</div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>{label}</p>
        <p className="text-lg font-bold tabular-nums leading-tight" style={{ color }}>{value}</p>
      </div>
    </div>
  );
}

const selectClass = 'rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500';

export function TestsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';

  // ── Filters ──
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [featureId, setFeatureId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [tag, setTag] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [hasBugs, setHasBugs] = useState(false);
  const [sort, setSort] = useState<SortKey>('updated_desc');
  const [page, setPage] = useState(1);

  // Debounce the search box so we don't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change resets to page 1.
  useEffect(() => {
    setPage(1);
  }, [search, moduleId, featureId, status, tag, assignedToId, hasBugs, sort]);

  // ── Data ──
  const { data: summary } = useQuery({
    queryKey: ['tests-summary', projectId],
    queryFn: () => testsApi.summary(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
  });

  const { data: modules = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const { data: features = [] } = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const { data: members = [] } = useQuery<Array<{ user: { id: string; name: string } }>>({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.listMembers(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['tests-browse', projectId, { search, moduleId, featureId, status, tag, assignedToId, hasBugs, sort, page }],
    queryFn: () => testsApi.browse(projectId!, {
      page,
      limit: PAGE_SIZE,
      search: search || undefined,
      moduleId: moduleId || undefined,
      featureId: featureId || undefined,
      tags: tag || undefined,
      assignedToId: assignedToId || undefined,
      hasBugs: hasBugs ? '1' : undefined,
      status: status || undefined,
      sort,
    }),
    enabled: !!projectId,
    placeholderData: (prev) => prev,
  });

  // Feature dropdown narrows to the selected module.
  const featureOptions = (features as Array<{ id: string; name: string; moduleId: string }>)
    .filter((f) => !moduleId || f.moduleId === moduleId);

  const anyFilter = !!(search || moduleId || featureId || status || tag || assignedToId || hasBugs);
  function clearFilters() {
    setSearchInput(''); setSearch(''); setModuleId(''); setFeatureId('');
    setStatus(''); setTag(''); setAssignedToId(''); setHasBugs(false);
  }

  if (isLoading && !data) return <PageSpinner />;

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = data?.pages ?? 1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link to={`/projects/${projectId}`} className="text-xs flex items-center gap-1 mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            <ChevronRight size={11} className="rotate-180" /> Project
          </Link>
          <h1 className="text-lg font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>All tests</h1>
        </div>
        {canManage && (
          <Link to="/ai"><Button variant="secondary" size="sm">✨ Generate with AI</Button></Link>
        )}
      </div>

      {/* Stats strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
          <StatCard icon={<Layers size={15} style={{ color: '#a78bfa' }} />} label="Modules" value={summary.modules} color="#a78bfa" />
          <StatCard icon={<BookOpen size={15} style={{ color: '#38bdf8' }} />} label="Features" value={summary.features} color="#38bdf8" />
          <StatCard icon={<ListChecks size={15} style={{ color: '#c4b5fd' }} />} label="Tests" value={summary.tests} color="#c4b5fd" />
          <StatCard icon={<CheckCircle size={15} style={{ color: '#34d399' }} />} label="Passed" value={summary.passed} color="#34d399" />
          <StatCard icon={<XCircle size={15} style={{ color: '#f87171' }} />} label="Failed" value={summary.failed} color="#f87171" />
          <StatCard icon={<Bug size={15} style={{ color: '#fbbf24' }} />} label="Open bugs" value={summary.openBugs} color="#fbbf24" />
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-40" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search tests by name, description or tag…"
                className="w-full rounded-lg border border-white/10 bg-white/5 pl-8 pr-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
              {Object.entries(SORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select value={moduleId} onChange={(e) => { setModuleId(e.target.value); setFeatureId(''); }} className={selectClass}>
              <option value="">All modules</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select value={featureId} onChange={(e) => setFeatureId(e.target.value)} className={selectClass}>
              <option value="">All features</option>
              {featureOptions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectClass}>
              <option value="">Any status</option>
              <option value="PASSED">Passed</option>
              <option value="FAILED">Failed</option>
              <option value="OUTSTANDING">Not run</option>
            </select>
            <select value={tag} onChange={(e) => setTag(e.target.value)} className={selectClass}>
              <option value="">Any tag</option>
              {(summary?.tags ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={selectClass} title="Tests whose linked bug is assigned to…">
              <option value="">Any bug assignee</option>
              {members.map((m) => <option key={m.user.id} value={m.user.id}>{m.user.name}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer px-1" style={{ color: 'rgba(238,238,248,0.75)' }}>
              <input type="checkbox" checked={hasBugs} onChange={(e) => setHasBugs(e.target.checked)} className="accent-violet-500" />
              With bugs
            </label>
            {anyFilter && (
              <button type="button" onClick={clearFilters} className="text-xs underline" style={{ color: '#c4b5fd' }}>
                Clear filters
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FlaskConical}
                title={anyFilter ? 'No tests match these filters' : 'No tests yet'}
                description={anyFilter ? 'Try widening or clearing the filters.' : 'Create a test from a feature, or generate one with AI.'}
              />
            </div>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Test</Th>
                  <Th>Feature · Module</Th>
                  <Th>Tags</Th>
                  <Th>Steps</Th>
                  <Th>Bugs</Th>
                  <Th>Status</Th>
                  <Th>Updated</Th>
                  <Th className="w-28" />
                </Tr>
              </Thead>
              <Tbody>
                {items.map((t) => (
                  <Tr key={t.id} className="group">
                    <Td>
                      <div className="flex items-center gap-2">
                        <FlaskConical size={13} className="shrink-0" style={{ color: '#a78bfa' }} />
                        <span className="font-medium text-sm min-w-0 break-words" style={{ color: 'rgba(238,238,248,0.9)' }}>{t.name}</span>
                      </div>
                    </Td>
                    <Td>
                      {t.featureName ? (
                        <span className="text-xs" style={{ color: 'rgba(238,238,248,0.6)' }}>
                          {t.featureName}
                          {t.moduleName && <span style={{ color: 'rgba(238,238,248,0.35)' }}> · {t.moduleName}</span>}
                        </span>
                      ) : (
                        <span className="text-xs italic" style={{ color: 'rgba(238,238,248,0.3)' }}>Unassigned</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {t.tags.slice(0, 3).map((tg) => <Badge key={tg} variant="muted">{tg}</Badge>)}
                        {t.tags.length > 3 && <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.4)' }}>+{t.tags.length - 3}</span>}
                      </div>
                    </Td>
                    <Td><span className="text-xs tabular-nums" style={{ color: 'rgba(238,238,248,0.7)' }}>{t.stepCount}</span></Td>
                    <Td>
                      {t.bugCount > 0 ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit" style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '1px solid rgba(239,68,68,0.22)' }}>
                          <Bug size={9} /> {t.bugCount}
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.2)' }}>—</span>
                      )}
                    </Td>
                    <Td><StatusPill status={t.latestStatus} /></Td>
                    <Td><span className="text-xs whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.45)' }}>{formatDate(t.updatedAt)}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        {t.featureId && t.moduleId && (
                          <button
                            title="Open feature"
                            onClick={() => navigate(`/projects/${projectId}/modules/${t.moduleId}/features/${t.featureId}`)}
                            className="p-1.5 rounded transition-colors" style={{ color: 'rgba(238,238,248,0.5)' }}
                          >
                            <BookOpen size={14} />
                          </button>
                        )}
                        <Link
                          to={`/projects/${projectId}/tests/${t.id}/edit`}
                          title="Edit test"
                          className="p-1.5 rounded transition-colors" style={{ color: 'rgba(238,238,248,0.5)' }}
                        >
                          <Pencil size={14} />
                        </Link>
                        {t.featureId && (
                          <button
                            title="Open in test mode"
                            onClick={() => navigate(`/projects/${projectId}/features/${t.featureId}/test?mode=MANUAL&testCaseId=${t.id}`)}
                            className="p-1.5 rounded transition-colors" style={{ color: '#c4b5fd' }}
                          >
                            <PlayCircle size={14} />
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}

          {/* Pagination */}
          {total > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <span className="text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>
                {total} test{total !== 1 ? 's' : ''}{isFetching ? ' · updating…' : ''}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 disabled:opacity-30"
                  style={{ color: '#c4b5fd' }}
                >
                  Previous
                </button>
                <span className="text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>Page {page} / {pages}</span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 disabled:opacity-30"
                  style={{ color: '#c4b5fd' }}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
