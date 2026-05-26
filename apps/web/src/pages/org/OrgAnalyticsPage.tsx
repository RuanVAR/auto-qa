import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  BarChart3, Activity, AlertTriangle, Bug, Timer, Filter, X, ChevronRight,
  ChevronUp, ChevronDown,
} from 'lucide-react';
import {
  analyticsApi, modulesApi, featuresApi, projectsApi,
  type AnalyticsFilters,
} from '@/lib/api';
import { useActiveOrg, useAuthStore } from '@/stores/authStore';
import { PageSpinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { KpiCard } from '@/components/analytics/KpiCard';
import { RunsTrendChart } from '@/components/analytics/RunsTrendChart';
import { CategoryDonut } from '@/components/analytics/CategoryDonut';
import { TopFailuresList } from '@/components/analytics/TopFailuresList';
import { AssigneeLeaderboard } from '@/components/analytics/AssigneeLeaderboard';

/**
 * Org-level BI dashboard.
 *
 * Access:
 *  - ORG_ADMIN / PLATFORM_ADMIN → every project in the active org
 *  - Members (incl. MANAGER) → only projects they're a ProjectMember of
 *    (backend intersects with env-RBAC; we drive the project dropdown
 *    from /visible-projects so users don't see options they can't query).
 *
 * The filter bar at the top drives every widget below via React Query —
 * each card listens to its own query keyed on the filter object, so
 * changing any filter triggers exactly one round of refetches.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
type RangeKey = '7d' | '30d' | '90d' | 'custom';
const RANGE_LABEL: Record<Exclude<RangeKey, 'custom'>, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

// NOTE: deliberately not `w-full` here. In a flex container with flex-wrap
// each w-full child grabs the entire row and the bar stacks vertically —
// exactly the bug the user reported in the screenshot. minWidth via inline
// style keeps each select wide enough to read; the wrap happens naturally
// when the viewport runs out of horizontal space.
const inputCls =
  'rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500';
const inputStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.10)',
  color: 'rgba(238,238,248,0.90)',
};

export function OrgAnalyticsPage() {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const { user, orgRole } = useAuthStore();
  // Anyone in the org can land here; the backend resolveScope handles the
  // actual data visibility. Org admins + platform admins see everything.
  const canSeeFullOrg = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';

  // ── Filters ──────────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [featureId, setFeatureId] = useState('');
  const [userId, setUserId] = useState('');
  // Donut-click filters — set when the user clicks a slice. The donut
  // itself ignores its own filter so it keeps showing the full mix.
  const [failureCategory, setFailureCategory] = useState('');
  const [issueCategory, setIssueCategory] = useState('');
  const [range, setRange] = useState<RangeKey>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Cascade: clearing project clears module + feature.
  useEffect(() => {
    if (!projectId) { setModuleId(''); setFeatureId(''); setUserId(''); }
  }, [projectId]);
  useEffect(() => {
    if (!moduleId) setFeatureId('');
  }, [moduleId]);

  // Resolve the date range to ISO strings for the API.
  const { fromDate, toDate } = useMemo(() => {
    if (range === 'custom') {
      return { fromDate: customFrom || undefined, toDate: customTo || undefined };
    }
    const days = range === '7d' ? 7 : range === '90d' ? 90 : 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    return { fromDate: from.toISOString(), toDate: to.toISOString() };
  }, [range, customFrom, customTo]);

  const filters: AnalyticsFilters = useMemo(() => ({
    projectId: projectId || undefined,
    moduleId: moduleId || undefined,
    featureId: featureId || undefined,
    userId: userId || undefined,
    failureCategory: failureCategory || undefined,
    issueCategory: issueCategory || undefined,
    fromDate, toDate,
  }), [projectId, moduleId, featureId, userId, failureCategory, issueCategory, fromDate, toDate]);

  const hasFilters = !!(projectId || moduleId || featureId || userId || failureCategory || issueCategory || range !== '30d');
  const clearFilters = () => {
    setProjectId(''); setModuleId(''); setFeatureId(''); setUserId('');
    setFailureCategory(''); setIssueCategory('');
    setRange('30d'); setCustomFrom(''); setCustomTo('');
  };

  // Collapsible filter bar. Default: open. Once the user applies any
  // filter, we auto-collapse so the dashboard takes back the vertical
  // space — they can re-open via the chip strip's expand button. Manual
  // override (`filtersExpandedOverride`) lets us remember "user wants it
  // open" even after filters change.
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (hasFilters && !touched) {
      setFiltersOpen(false);
      setTouched(true);
    }
    if (!hasFilters) setTouched(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFilters]);

  // ── Dropdown source data ─────────────────────────────────────────────
  const visibleProjectsQ = useQuery({
    queryKey: ['analytics-visible-projects', orgId],
    queryFn: () => analyticsApi.visibleProjects(orgId!),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const projects = visibleProjectsQ.data ?? [];

  const modulesQ = useQuery({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId) as Promise<Array<{ id: string; name: string }>>,
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const featuresQ = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const membersQ = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.listMembers(projectId) as Promise<Array<{ user: { id: string; name: string; email: string } }>>,
    enabled: !!projectId,
    staleTime: 60_000,
  });

  // ── Widget queries — one per card; React Query deduplicates the shared key. ──
  const kpisQ = useQuery({
    queryKey: ['analytics-kpis', orgId, filters],
    queryFn: () => analyticsApi.kpis(orgId!, filters),
    enabled: !!orgId,
  });
  const trendQ = useQuery({
    queryKey: ['analytics-trend', orgId, filters],
    queryFn: () => analyticsApi.runsTrend(orgId!, filters),
    enabled: !!orgId,
  });
  const failCatQ = useQuery({
    queryKey: ['analytics-failcat', orgId, filters],
    queryFn: () => analyticsApi.failureCategories(orgId!, filters),
    enabled: !!orgId,
  });
  const issueCatQ = useQuery({
    queryKey: ['analytics-issuecat', orgId, filters],
    queryFn: () => analyticsApi.issueCategories(orgId!, filters),
    enabled: !!orgId,
  });
  const byFeatureQ = useQuery({
    queryKey: ['analytics-by-feature', orgId, filters],
    queryFn: () => analyticsApi.failuresByFeature(orgId!, { ...filters, limit: 10 }),
    enabled: !!orgId,
  });
  const byModuleQ = useQuery({
    queryKey: ['analytics-by-module', orgId, filters],
    queryFn: () => analyticsApi.failuresByModule(orgId!, { ...filters, limit: 10 }),
    enabled: !!orgId,
  });
  const byProjectQ = useQuery({
    queryKey: ['analytics-by-project', orgId, filters],
    queryFn: () => analyticsApi.failuresByProject(orgId!, filters),
    enabled: !!orgId && canSeeFullOrg,
  });
  const resolutionQ = useQuery({
    queryKey: ['analytics-resolution', orgId, filters],
    queryFn: () => analyticsApi.bugResolutionTime(orgId!, filters),
    enabled: !!orgId,
  });
  const leaderboardQ = useQuery({
    queryKey: ['analytics-leaderboard', orgId, filters],
    queryFn: () => analyticsApi.assigneeLeaderboard(orgId!, { ...filters, limit: 25 }),
    enabled: !!orgId,
  });

  if (!orgId) return <PageSpinner />;
  if (visibleProjectsQ.isLoading) return <PageSpinner />;
  if (projects.length === 0) {
    // Member with no project memberships in this org → friendly empty state.
    return (
      <div className="max-w-3xl mx-auto py-12">
        <EmptyState
          icon={BarChart3}
          title="No analytics to show"
          description="You don't have access to any projects in this organisation yet. Ask an admin to add you to a project."
        />
      </div>
    );
  }

  const k = kpisQ.data;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link to="/org" className="text-xs flex items-center gap-1 mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            <ChevronRight size={11} className="rotate-180" /> Organisation
          </Link>
          <h1 className="text-lg font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Analytics
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
            {canSeeFullOrg
              ? 'Full org-wide visibility across every project, module and feature.'
              : `Showing analytics for ${projects.length} project${projects.length === 1 ? '' : 's'} you're a member of.`}
          </p>
        </div>
      </div>

      {/* Filter bar — sticky on scroll so dashboards stay in context.
          Collapses to a compact chip strip after any filter is applied
          (auto-collapse once, user can re-open + re-close manually) so
          the dashboard takes back the vertical real estate. */}
      <div
        className="rounded-xl sticky top-16 z-10 backdrop-blur"
        style={{
          background: 'rgba(20,20,32,0.85)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {filtersOpen ? (
          <div className="p-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Filter size={13} style={{ color: 'rgba(238,238,248,0.55)' }} />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className={inputCls}
                style={{ ...inputStyle, minWidth: 160 }}
              >
                <option value="">All projects</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select
                value={moduleId}
                onChange={(e) => setModuleId(e.target.value)}
                disabled={!projectId}
                className={inputCls}
                style={{ ...inputStyle, minWidth: 140, opacity: projectId ? 1 : 0.5 }}
              >
                <option value="">All modules</option>
                {(modulesQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select
                value={featureId}
                onChange={(e) => setFeatureId(e.target.value)}
                disabled={!projectId}
                className={inputCls}
                style={{ ...inputStyle, minWidth: 160, opacity: projectId ? 1 : 0.5 }}
              >
                <option value="">All features</option>
                {(featuresQ.data ?? [])
                  .filter((f: { id: string; name: string; moduleId: string }) => !moduleId || f.moduleId === moduleId)
                  .map((f: { id: string; name: string }) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={!projectId}
                className={inputCls}
                style={{ ...inputStyle, minWidth: 160, opacity: projectId ? 1 : 0.5 }}
              >
                <option value="">All assignees</option>
                {(membersQ.data ?? []).map((m) => (
                  <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                ))}
              </select>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as RangeKey)}
                className={inputCls}
                style={{ ...inputStyle, minWidth: 120 }}
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="custom">Custom range</option>
              </select>
              {range === 'custom' && (
                <>
                  <input
                    type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                    className={inputCls} style={{ ...inputStyle, minWidth: 130 }}
                    title="From"
                  />
                  <input
                    type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                    className={inputCls} style={{ ...inputStyle, minWidth: 130 }}
                    title="To"
                  />
                </>
              )}
              <div className="flex items-center gap-2 ml-auto">
                {hasFilters && (
                  <button
                    type="button" onClick={clearFilters}
                    className="text-xs flex items-center gap-1" style={{ color: '#c4b5fd' }}
                  >
                    <X size={11} /> Clear
                  </button>
                )}
                {/* Collapse is always available, not gated on hasFilters —
                    user might just want a tidier dashboard before they've
                    even narrowed anything. */}
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors hover:bg-white/[0.06]"
                  style={{ color: 'rgba(238,238,248,0.65)' }}
                  title="Hide the filter bar — keeps your filters active, frees up screen real estate"
                >
                  <ChevronUp size={12} /> Collapse
                </button>
              </div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="w-full px-3 py-2 flex items-center gap-2 flex-wrap text-left transition-colors hover:bg-white/[0.04]"
            title="Show full filter controls"
          >
            <Filter size={12} style={{ color: '#c4b5fd' }} />
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.55)' }}>
              Filters
            </span>
            {/* Chip strip — at-a-glance summary of what's active. */}
            <ChipSummary
              project={projects.find((p) => p.id === projectId)?.name}
              module={(modulesQ.data ?? []).find((m) => m.id === moduleId)?.name}
              feature={(featuresQ.data ?? []).find((f: { id: string; name: string }) => f.id === featureId)?.name}
              assignee={(membersQ.data ?? []).find((m) => m.user.id === userId)?.user.name}
              failureCategory={failureCategory || undefined}
              issueCategory={issueCategory || undefined}
              range={range === 'custom' ? `${customFrom || '…'} → ${customTo || '…'}` : RANGE_LABEL[range]}
            />
            <div className="ml-auto flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(238,238,248,0.65)' }}>
              <ChevronDown size={12} /> Edit
            </div>
          </button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="AVG runs / day"
          value={k?.avgRunsPerDay ?? '—'}
          sub={k ? `${k.totalRuns} total` : undefined}
          icon={<Activity size={18} style={{ color: '#c4b5fd' }} />}
          accent="rgba(139,92,246,0.18)"
        />
        <KpiCard
          label="AVG fails / day"
          value={k?.avgFailsPerDay ?? '—'}
          sub={k ? `${trendQ.data?.days.reduce((s, d) => s + d.failed, 0) ?? 0} total failed` : undefined}
          icon={<AlertTriangle size={18} style={{ color: '#f87171' }} />}
          accent="rgba(239,68,68,0.18)"
          valueColor="#fca5a5"
        />
        <KpiCard
          label="Open bugs"
          value={k?.openIssues ?? '—'}
          sub={hasFilters ? 'in current scope' : 'across visible projects'}
          icon={<Bug size={18} style={{ color: '#fb7185' }} />}
          accent="rgba(251,113,133,0.18)"
        />
        <KpiCard
          label="AVG resolve time"
          value={formatResolutionMs(k?.avgResolutionMs)}
          sub={resolutionQ.data?.count ? `${resolutionQ.data.count} resolved` : 'no resolved bugs yet'}
          icon={<Timer size={18} style={{ color: '#34d399' }} />}
          accent="rgba(16,185,129,0.18)"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RunsTrendChart data={trendQ.data?.days ?? []} />
        <CategoryDonut
          title="Failures by reason"
          data={failCatQ.data ?? []}
          emptyLabel="No failed runs yet"
          selectedCategory={failureCategory || null}
          // Click a slice → narrow the whole dashboard to that category.
          // Click the SAME slice again → clear (toggle).
          onSelect={(cat) => setFailureCategory((prev) => prev === cat ? '' : cat)}
        />
      </div>

      {/* Top lists row — clicking a row drills the dashboard into that
          scope. Selecting a feature also pre-selects its module so the
          filter cascade stays consistent. Same for module → project. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <TopFailuresList
          title="Top failing features"
          data={(byFeatureQ.data ?? []).map((f) => ({
            id: f.featureId,
            name: f.featureName,
            sub: f.moduleName,
            total: f.total,
            failed: f.failed,
            passRate: f.passRate,
          }))}
          emptyLabel="No feature-scoped runs yet"
          selectedId={featureId || null}
          onSelect={(id) => {
            // Just set featureId — backend filters by it directly, no need
            // to cascade projectId/moduleId (those dropdowns will look
            // disabled until the user opens the filter bar and picks one
            // explicitly, which is fine; the data is already correctly
            // scoped). When the feature's module is already loaded in our
            // features query, set it too so the cascade reads consistently.
            const f = (featuresQ.data ?? []).find(
              (x: { id: string; moduleId: string }) => x.id === id,
            );
            if (f && projectId && !moduleId) setModuleId(f.moduleId);
            setFeatureId(id);
          }}
        />
        <TopFailuresList
          title="Top failing modules"
          data={(byModuleQ.data ?? []).map((m) => ({
            id: m.moduleId,
            name: m.moduleName,
            sub: `${m.featureCount} feature${m.featureCount === 1 ? '' : 's'}`,
            total: m.total,
            failed: m.failed,
            passRate: m.passRate,
          }))}
          emptyLabel="No module-scoped runs yet"
          selectedId={moduleId || null}
          onSelect={(id) => {
            setModuleId(id);
            setFeatureId(''); // drop the narrower filter
          }}
        />
      </div>

      {/* Issue category + project row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CategoryDonut
          title="Bugs by category"
          data={issueCatQ.data ?? []}
          emptyLabel="No bugs logged yet"
          selectedCategory={issueCategory || null}
          onSelect={(cat) => setIssueCategory((prev) => prev === cat ? '' : cat)}
        />
        {canSeeFullOrg && (
          <TopFailuresList
            title="Projects ranked by failures"
            data={(byProjectQ.data ?? []).map((p) => ({
              id: p.projectId,
              name: p.projectName,
              total: p.total,
              failed: p.failed,
              passRate: p.passRate,
            }))}
            emptyLabel="No project-scoped runs yet"
            selectedId={projectId || null}
            onSelect={(id) => {
              setProjectId(id);
              setModuleId(''); // drop narrower
              setFeatureId('');
            }}
          />
        )}
      </div>

      <AssigneeLeaderboard
        data={leaderboardQ.data ?? []}
        selectedId={userId || null}
        onSelect={(uid) => setUserId(uid)}
      />
    </div>
  );
}

/**
 * Compact chip summary of active filters — drives the collapsed-state
 * filter bar so the user can see what's filtered at a glance without
 * expanding the full UI. Renders nothing for unset fields so we never
 * end up with placeholder chips ("All projects", etc.) cluttering the row.
 */
function ChipSummary({
  project, module: mod, feature, assignee, failureCategory, issueCategory, range,
}: {
  project?: string; module?: string; feature?: string; assignee?: string;
  failureCategory?: string; issueCategory?: string;
  range: string;
}) {
  const chips: Array<{ label: string; value: string; tint: string }> = [];
  if (project) chips.push({ label: 'Project', value: project, tint: 'rgba(139,92,246,0.18)' });
  if (mod) chips.push({ label: 'Module', value: mod, tint: 'rgba(56,189,248,0.18)' });
  if (feature) chips.push({ label: 'Feature', value: feature, tint: 'rgba(52,211,153,0.18)' });
  if (assignee) chips.push({ label: 'User', value: assignee, tint: 'rgba(251,191,36,0.18)' });
  if (failureCategory) chips.push({ label: 'Failure', value: failureCategory, tint: 'rgba(239,68,68,0.18)' });
  if (issueCategory) chips.push({ label: 'Bug cat.', value: issueCategory, tint: 'rgba(251,113,133,0.18)' });
  chips.push({ label: 'Range', value: range, tint: 'rgba(255,255,255,0.06)' });
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {chips.map((c) => (
        <span
          key={c.label + c.value}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
          style={{
            background: c.tint,
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(238,238,248,0.85)',
          }}
        >
          <span style={{ opacity: 0.55 }}>{c.label}:</span>
          <span className="font-medium truncate max-w-[140px]">{c.value}</span>
        </span>
      ))}
    </div>
  );
}

function formatResolutionMs(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
