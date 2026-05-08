import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bug, ArrowDownAZ, Search, ExternalLink, PlayCircle, ListVideo, FlaskConical } from 'lucide-react';
import { issuesApi, featuresApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate, cn } from '@/lib/utils';
import { IssueRowActionsMenu, buildTestingModeHref } from '@/components/issues/IssueRowActionsMenu';

export type IssuesExplorerScope = 'project' | 'module' | 'feature';

type IssueRow = {
  id: string;
  title: string;
  status: string;
  severity: string;
  type: string;
  createdAt: string;
  moduleId?: string | null;
  featureId?: string | null;
  testDefinitionId?: string | null;
  testRunId?: string | null;
  runStepId?: string | null;
  module?: { id: string; name: string } | null;
  feature?: { id: string; name: string } | null;
  testDefinition?: { id: string; name: string } | null;
  reportedBy?: { name: string };
};

type SortKey = 'createdAt' | 'title' | 'status' | 'severity' | 'module' | 'feature';

interface ListResponse {
  items: IssueRow[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}

const STATUS_OPTS = ['', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'CLOSED'] as const;
const TYPE_OPTS = ['', 'BUG', 'SNAG', 'QUERY'] as const;
/** Aligned with Prisma `IssueSeverity` (no INFO tier). */
const SEVERITY_OPTS = ['', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

function sortItems(items: IssueRow[], key: SortKey, dir: 'asc' | 'desc'): IssueRow[] {
  const m = [...items];
  const mul = dir === 'asc' ? 1 : -1;
  m.sort((a, b) => {
    let va: string | number = '';
    let vb: string | number = '';
    switch (key) {
      case 'createdAt':
        va = new Date(a.createdAt).getTime();
        vb = new Date(b.createdAt).getTime();
        break;
      case 'title':
        va = a.title.toLowerCase();
        vb = b.title.toLowerCase();
        break;
      case 'status':
        va = a.status;
        vb = b.status;
        break;
      case 'severity':
        va = a.severity;
        vb = b.severity;
        break;
      case 'module':
        va = a.module?.name ?? '';
        vb = b.module?.name ?? '';
        break;
      case 'feature':
        va = a.feature?.name ?? '';
        vb = b.feature?.name ?? '';
        break;
      default:
        return 0;
    }
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    return String(va).localeCompare(String(vb)) * mul;
  });
  return m;
}

export interface ScopedIssuesPanelProps {
  projectId: string;
  /** Set for module + feature scopes */
  moduleId?: string;
  featureId?: string;
  scope: IssuesExplorerScope;
  /** Stat strip: open + total (same numbers you’d echo in a report summary) */
  showStatStrip?: boolean;
  title?: string;
}

export function ScopedIssuesPanel({
  projectId,
  moduleId,
  featureId,
  scope,
  showStatStrip = true,
  title,
}: ScopedIssuesPanelProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('');
  const [type, setType] = useState<string>('');
  const [severity, setSeverity] = useState<string>('');
  const [search, setSearch] = useState('');
  const [featureFilter, setFeatureFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data: stats } = useQuery({
    queryKey: ['issue-stats-strip', scope, projectId, moduleId ?? '', featureId ?? ''],
    queryFn: async () => {
      if (scope === 'feature' && featureId)
        return issuesApi.featureStats(featureId);
      if (scope === 'module' && moduleId) return issuesApi.moduleStats(moduleId);
      return issuesApi.projectStats(projectId);
    },
    enabled: !!projectId && (scope === 'project' || (scope === 'module' && !!moduleId) || (scope === 'feature' && !!featureId)),
    staleTime: 20_000,
  });

  const { data: featuresInModule = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['module-features-filter', moduleId],
    queryFn: () => featuresApi.list(moduleId!) as Promise<{ id: string; name: string }[]>,
    enabled: scope === 'module' && !!moduleId,
    staleTime: 60_000,
  });

  const limit = scope === 'project' ? 25 : 200;

  const listParams = useMemo(() => {
    const p: Record<string, string | number> = {
      limit,
      page: scope === 'project' ? page : 1,
    };
    if (scope === 'module' && moduleId) p.moduleId = moduleId;
    if (scope === 'feature' && featureId) p.featureId = featureId;
    if (scope === 'module' && featureFilter) p.featureId = featureFilter;
    if (status) p.status = status;
    if (type) p.type = type;
    if (severity) p.severity = severity;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [
    scope, moduleId, featureId, featureFilter, status, type, severity, search, page, limit,
  ]);

  const { data: rawList, isLoading } = useQuery({
    queryKey: ['scoped-issues', projectId, scope, moduleId, featureId, listParams],
    queryFn: () =>
      issuesApi.list(projectId, listParams as Parameters<typeof issuesApi.list>[1]) as Promise<ListResponse | IssueRow[]>,
    enabled: !!projectId,
    staleTime: 15_000,
  });

  const { items: pageItems, total, pages } = useMemo(() => {
    const unwrap = (r: ListResponse | IssueRow[] | undefined) => {
      if (!r) return { items: [] as IssueRow[], total: 0, pages: 1 };
      if (Array.isArray(r)) return { items: r, total: r.length, pages: 1 };
      return { items: r.items ?? [], total: r.total, pages: r.pages ?? 1 };
    };
    return unwrap(rawList as ListResponse | IssueRow[] | undefined);
  }, [rawList]);

  /** Stats are global; the table is paginated. If the user was on page 2+ and issues
   *  were removed or filters shrank the result set, page can be past the last page
   *  — the API returns 0 rows while stats still show a non-zero total. */
  useEffect(() => {
    if (scope !== 'project') return;
    if (pages < 1) return;
    if (page > pages) setPage(1);
  }, [scope, pages, page]);

  useEffect(() => {
    setPage(1);
  }, [projectId, scope, moduleId, featureId]);

  const sortedItems = useMemo(
    () => sortItems(pageItems, sortKey, sortDir),
    [pageItems, sortKey, sortDir],
  );

  const showModuleCol = scope === 'project';
  const showFeatureCol = scope === 'project' || scope === 'module';
  const showScopeFilters = scope === 'module';

  const openCount =
    stats && 'open' in stats && 'inProgress' in stats
      ? (stats as { open: number; inProgress: number }).open +
        (stats as { open: number; inProgress: number }).inProgress
      : null;
  const totalCount = stats && 'total' in stats ? (stats as { total: number }).total : null;

  const heading =
    title ??
    (scope === 'project'
      ? 'Project issues'
      : scope === 'module'
        ? 'Module issues'
        : 'Feature issues');

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <Bug size={14} style={{ color: '#fb7185' }} />
            <CardTitle>{heading}</CardTitle>
            {showStatStrip && stats && totalCount !== null && openCount !== null && (
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: 'rgba(251,113,133,0.14)',
                  color: '#fda4af',
                  border: '1px solid rgba(251,113,133,0.28)',
                }}
              >
                {openCount} open · {totalCount} total
              </span>
            )}
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col gap-2 pt-2',
            showScopeFilters ? 'lg:flex-row lg:flex-wrap lg:items-end' : 'sm:flex-row sm:flex-wrap sm:items-end',
          )}
          style={{ gap: '8px 12px' }}
        >
          {showScopeFilters && (
            <label className="flex flex-col gap-0.5 min-w-[140px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Feature
              </span>
              <select
                value={featureFilter}
                onChange={e => {
                  setFeatureFilter(e.target.value);
                  setPage(1);
                }}
                className="text-xs rounded-lg px-2 py-1.5 border border-white/10 bg-white/5 text-slate-100"
              >
                <option value="">All features</option>
                {featuresInModule.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-0.5 min-w-[120px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Status
            </span>
            <select
              value={status}
              onChange={e => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="text-xs rounded-lg px-2 py-1.5 border border-white/10 bg-white/5 text-slate-100"
            >
              {STATUS_OPTS.map(s => (
                <option key={s || 'all'} value={s}>
                  {s ? s.replace('_', ' ') : 'All'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5 min-w-[100px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Type
            </span>
            <select
              value={type}
              onChange={e => {
                setType(e.target.value);
                setPage(1);
              }}
              className="text-xs rounded-lg px-2 py-1.5 border border-white/10 bg-white/5 text-slate-100"
            >
              {TYPE_OPTS.map(t => (
                <option key={t || 'all'} value={t}>
                  {t || 'All'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5 min-w-[100px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Severity
            </span>
            <select
              value={severity}
              onChange={e => {
                setSeverity(e.target.value);
                setPage(1);
              }}
              className="text-xs rounded-lg px-2 py-1.5 border border-white/10 bg-white/5 text-slate-100"
            >
              {SEVERITY_OPTS.map(s => (
                <option key={s || 'all'} value={s}>
                  {s || 'All'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5 flex-1 min-w-[160px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Search title
            </span>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 opacity-40" />
              <input
                value={search}
                onChange={e => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter…"
                className="w-full text-xs rounded-lg pl-7 pr-2 py-1.5 border border-white/10 bg-white/5 text-slate-100 placeholder:text-slate-500"
              />
            </div>
          </label>

          <label className="flex flex-col gap-0.5 min-w-[140px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Sort
            </span>
            <div className="flex items-center gap-1">
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="text-xs rounded-lg px-2 py-1.5 border border-white/10 bg-white/5 text-slate-100 flex-1"
              >
                <option value="createdAt">Logged</option>
                <option value="title">Title</option>
                <option value="status">Status</option>
                <option value="severity">Severity</option>
                {showModuleCol && <option value="module">Module</option>}
                {showFeatureCol && <option value="feature">Feature</option>}
              </select>
              <button
                type="button"
                title={sortDir === 'desc' ? 'Descending' : 'Ascending'}
                onClick={() => setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))}
                className="p-1.5 rounded-lg border border-white/10 shrink-0"
                style={{ color: 'rgba(238,238,248,0.7)' }}
              >
                <ArrowDownAZ size={14} className={sortDir === 'asc' ? 'rotate-180' : ''} />
              </button>
            </div>
          </label>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {isLoading ? (
          <div className="py-10 text-center text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Loading issues…
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="px-4 pb-6">
            <EmptyState icon={Bug} title="No issues" description="Nothing matches these filters yet." />
          </div>
        ) : (
          <>
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-[min(20%,9.5rem)] text-left">Actions</Th>
                  <Th>Title</Th>
                  {showModuleCol && <Th>Module</Th>}
                  {showFeatureCol && <Th>Feature</Th>}
                  <Th>Status</Th>
                  <Th>Severity</Th>
                  <Th>Type</Th>
                  <Th>Test</Th>
                  <Th>Logged</Th>
                </Tr>
              </Thead>
              <Tbody>
                {sortedItems.map(row => {
                  const rowFeatureId = row.featureId ?? featureId ?? null;
                  const testingHrefPanel = buildTestingModeHref(
                    projectId,
                    rowFeatureId,
                    row.id,
                    row.testDefinitionId,
                    row.testRunId,
                    row.runStepId,
                  );
                  const testEditorHrefPanel = row.testDefinitionId
                    ? `/projects/${projectId}/tests/${row.testDefinitionId}/edit`
                    : null;
                  const runHrefPanel = row.testRunId ? `/runs/${row.testRunId}` : null;

                  const actionBtn =
                    'inline-flex rounded-lg items-center justify-center p-1.5 transition-colors shrink-0 hover:bg-white/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50';
                  const actionIconProps = {
                    size: 15 as const,
                    className: 'shrink-0',
                    style: { color: 'rgba(238,238,248,0.65)' },
                  };

                  return (
                  <Tr key={row.id} className="hover:bg-white/[0.02]">
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-0.5 flex-wrap">
                        <Link
                          to={`/issues/${row.id}`}
                          className={actionBtn}
                          title="Open issue page"
                          aria-label="Open issue page"
                        >
                          <ExternalLink {...actionIconProps} />
                        </Link>
                        {testEditorHrefPanel && (
                          <Link
                            to={testEditorHrefPanel}
                            className={actionBtn}
                            title="Open test in editor"
                            aria-label="Open test in editor"
                          >
                            <FlaskConical {...actionIconProps} />
                          </Link>
                        )}
                        {testingHrefPanel && (
                          <Link
                            to={testingHrefPanel}
                            className={actionBtn}
                            title="Open Testing Mode"
                            aria-label="Open Testing Mode"
                          >
                            <PlayCircle {...actionIconProps} />
                          </Link>
                        )}
                        {runHrefPanel && (
                          <Link
                            to={runHrefPanel}
                            className={actionBtn}
                            title="View run"
                            aria-label="View run"
                          >
                            <ListVideo {...actionIconProps} />
                          </Link>
                        )}
                        <IssueRowActionsMenu
                          compact
                          issueId={row.id}
                          projectId={projectId}
                          featureId={rowFeatureId ?? undefined}
                          status={row.status}
                          testDefinitionId={row.testDefinitionId}
                          testRunId={row.testRunId}
                          runStepId={row.runStepId}
                        />
                      </div>
                    </Td>
                    <Td>
                      <Link
                        to={`/issues/${row.id}`}
                        className="font-medium text-sm hover:underline"
                        style={{ color: 'rgba(238,238,248,0.92)' }}
                      >
                        {row.title}
                      </Link>
                    </Td>
                    {showModuleCol && (
                      <Td className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        {row.module?.name ?? '—'}
                      </Td>
                    )}
                    {showFeatureCol && (
                      <Td className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        {row.feature?.name ?? '—'}
                      </Td>
                    )}
                    <Td>
                      <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded border border-white/10">
                        {row.status.replace('_', ' ')}
                      </span>
                    </Td>
                    <Td className="text-xs">{row.severity}</Td>
                    <Td className="text-xs">{row.type}</Td>
                    <Td className="text-xs max-w-[10rem]">
                      <span className="truncate block" title={row.testDefinition?.name}>
                        {row.testDefinition?.name ?? '—'}
                      </span>
                    </Td>
                    <Td className="text-xs whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.50)' }}>
                      {formatDate(row.createdAt)}
                    </Td>
                  </Tr>
                  );
                })}
              </Tbody>
            </Table>

            {scope === 'project' && pages > 1 && (
              <div className="flex items-center justify-center gap-3 py-3 border-t border-white/8">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 disabled:opacity-30"
                  style={{ color: '#c4b5fd' }}
                >
                  Previous
                </button>
                <span className="text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>
                   Page {page} / {pages} ({total} issues)
                </span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => setPage(p => Math.min(pages, p + 1))}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 disabled:opacity-30"
                  style={{ color: '#c4b5fd' }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
