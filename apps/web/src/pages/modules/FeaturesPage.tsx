import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, BookOpen, ChevronRight, ChevronDown,
  FlaskConical, Cpu, User, ExternalLink, Loader,
  CheckCircle, XCircle, MinusCircle, Clock, Bug,
  ListChecks, TrendingUp, AlertCircle,
} from 'lucide-react';
import { api, statsApi, issuesApi, modulesApi, testsApi } from '@/lib/api';
import { useActiveEnv } from '@/stores/activeEnvStore';
import { toast } from '@/components/ui/Toast';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { NavDropdown } from '@/components/NavDropdown';
import { ProgressDonut } from '@/components/ProgressDonut';
import { LatestReportCard } from '@/components/LatestReportCard';
import { GenerateReportButton } from '@/components/GenerateReportButton';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Feature {
  id: string;
  name: string;
  description: string | null;
  isDraft: boolean;
  activeVersionId: string | null;
  _count: { testDefinitions: number };
  updatedAt: string;
}

interface FeatureStats {
  featureId: string;
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  passRate: number | null;
  lastRunAt: string | null;
}

interface TestDefinition {
  id: string;
  name: string;
  type: 'UI' | 'API' | 'SHELL' | 'MANUAL';
  status: string;
  updatedAt: string;
}


interface IssueItem {
  id: string;
  type: string;
  testDefinitionId?: string;
}

interface FeatureFormState {
  name: string;
  description: string;
}

const EMPTY_FORM: FeatureFormState = { name: '', description: '' };

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  return `${d}d ago`;
}

function getFeatureStatus(feature: Feature): 'draft' | 'published' | 'has-changes' {
  if (feature.activeVersionId && feature.isDraft) return 'has-changes';
  if (feature.activeVersionId) return 'published';
  return 'draft';
}

function FeatureStatusBadge({ feature }: { feature: Feature }) {
  const status = getFeatureStatus(feature);
  if (status === 'published') return <Badge variant="success">Published</Badge>;
  if (status === 'has-changes') return <Badge variant="warning">Has changes</Badge>;
  return <Badge variant="warning" className="bg-amber-100 text-amber-700">Draft</Badge>;
}

function FeatureStatsStrip({ stats }: { stats: FeatureStats | undefined }) {
  if (!stats) return null;
  const { passed, failed, skipped, outstanding, total, passRate, lastRunAt } = stats;

  if (total === 0) return <span className="text-xs text-gray-400">No tests</span>;

  if (passed + failed + skipped === 0) {
    return (
      <span className="text-xs text-amber-400">
        ○ {outstanding} outstanding · Never tested
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      {passed > 0 && <span className="text-emerald-400">✅ {passed}</span>}
      {failed > 0 && <span className="text-red-400">❌ {failed}</span>}
      {skipped > 0 && <span className="text-gray-400">⊘ {skipped}</span>}
      {outstanding > 0 && <span className="text-amber-400">○ {outstanding}</span>}
      {passRate !== null && (
        <span className={cn(
          'font-semibold',
          passRate >= 80 ? 'text-emerald-400' : passRate >= 50 ? 'text-amber-400' : 'text-red-400',
        )}>
          {passRate}%
        </span>
      )}
      <span className="text-gray-500">{relativeTime(lastRunAt)}</span>
    </div>
  );
}

function ModuleSummaryStrip({ stats, moduleId }: { stats: FeatureStats[]; moduleId: string }) {
  const totals = stats.reduce(
    (acc, s) => {
      acc.features += 1;
      acc.tests += s.total ?? 0;
      acc.passed += s.passed ?? 0;
      acc.failed += s.failed ?? 0;
      acc.skipped += s.skipped ?? 0;
      return acc;
    },
    { features: 0, tests: 0, passed: 0, failed: 0, skipped: 0 },
  );
  const outstanding = Math.max(0, totals.tests - totals.passed - totals.failed - totals.skipped);
  const completed = totals.passed + totals.failed + totals.skipped;
  const passRate = completed > 0 ? Math.round((totals.passed / completed) * 100) : null;

  const { data: issueStats } = useQuery<{ open?: number; total?: number }>({
    queryKey: ['module-issue-stats', moduleId],
    queryFn: () => issuesApi.moduleStats(moduleId),
    enabled: !!moduleId,
    staleTime: 30_000,
  });
  const openIssues = issueStats?.open ?? 0;

  return (
    <div
      className="flex items-center gap-5 rounded-2xl p-5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
      }}
    >
      <ProgressDonut
        stats={{ passed: totals.passed, failed: totals.failed, skipped: totals.skipped, outstanding, total: totals.tests }}
        size={148}
      />
      <div className="flex-1 grid grid-cols-2 gap-3">
        <ModuleStatCard icon={<ListChecks size={15} style={{ color: '#a78bfa' }} />} iconBg="rgba(139,92,246,0.20)"
          label="Features" value={totals.features} valueColor="#a78bfa" />
        <ModuleStatCard icon={<TrendingUp size={15} style={{ color: '#fbbf24' }} />} iconBg="rgba(245,158,11,0.18)"
          label="Pass Rate" value={passRate !== null ? `${passRate}%` : '—'}
          valueColor={passRate === null ? 'rgba(238,238,248,0.40)' : passRate >= 80 ? '#34d399' : passRate >= 50 ? '#fbbf24' : '#f87171'} />
        <ModuleStatCard icon={<CheckCircle size={15} style={{ color: '#34d399' }} />} iconBg="rgba(16,185,129,0.18)"
          label="Passed" value={totals.passed} valueColor="#34d399" />
        <ModuleStatCard icon={<AlertCircle size={15} style={{ color: '#fbbf24' }} />} iconBg="rgba(245,158,11,0.15)"
          label="Issues" value={openIssues} valueColor={openIssues > 0 ? '#fbbf24' : 'rgba(238,238,248,0.40)'} />
      </div>
    </div>
  );
}

function ModuleStatCard({
  icon, iconBg, label, value, valueColor,
}: {
  icon: React.ReactNode; iconBg: string; label: string;
  value: string | number; valueColor: string;
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: iconBg }}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>{label}</p>
        <p className="text-xl font-bold tabular-nums leading-tight mt-0.5" style={{ color: valueColor }}>{value}</p>
      </div>
    </div>
  );
}

// ─── Test type icon ───────────────────────────────────────────────────────────

function TestTypeIcon({ type }: { type: string }) {
  if (type === 'MANUAL') return <User size={11} style={{ color: '#a78bfa' }} />;
  if (type === 'API') return <FlaskConical size={11} style={{ color: '#38bdf8' }} />;
  return <Cpu size={11} style={{ color: '#34d399' }} />;
}

// ─── Test run status pill ────────────────────────────────────────────────────

function TestRunStatusPill({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(245,158,11,0.10)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.20)' }}>
        <Clock size={9} /> Not run
      </span>
    );
  }
  if (status === 'PASSED') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(52,211,153,0.10)', color: '#34d399', border: '1px solid rgba(52,211,153,0.20)' }}>
      <CheckCircle size={9} /> Passed
    </span>
  );
  if (status === 'FAILED') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '1px solid rgba(239,68,68,0.20)' }}>
      <XCircle size={9} /> Failed
    </span>
  );
  if (status === 'SKIPPED') return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(148,163,184,0.10)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.20)' }}>
      <MinusCircle size={9} /> Skipped
    </span>
  );
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase"
      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(238,238,248,0.40)' }}>
      {status}
    </span>
  );
}

// ─── Expanded tests row ───────────────────────────────────────────────────────

function ExpandedTests({
  featureId,
  projectId,
  moduleId,
  navigate,
  activeEnvId,
}: {
  featureId: string;
  projectId: string;
  moduleId: string;
  navigate: ReturnType<typeof useNavigate>;
  activeEnvId?: string | null;
}) {
  const { data: allTests, isLoading } = useQuery<TestDefinition[]>({
    queryKey: ['tests-for-feature', featureId, projectId],
    queryFn: () =>
      api.get(`/api/v1/projects/${projectId}/tests`).then(r =>
        (r.data as (TestDefinition & { featureId?: string })[]).filter(
          t => t.featureId === featureId,
        ),
      ),
    staleTime: 30_000,
  });

  // Latest TestRun per testDefinitionId — covers quick-mark, manual testing,
  // and automated runs (not just FeatureRun-attached results).
  const { data: latestStatuses } = useQuery({
    queryKey: ['test-statuses', featureId, activeEnvId ?? null],
    queryFn: () => testsApi.getLatestStatuses(featureId, activeEnvId),
    staleTime: 30_000,
    enabled: !isLoading,
  });

  // Issues for this feature → per-test issue counts
  const { data: issuesData } = useQuery({
    queryKey: ['feature-issues-expanded', featureId, projectId],
    queryFn: () => issuesApi.list(projectId, { featureId }),
    staleTime: 60_000,
    enabled: !isLoading,
  });

  // Build testDefinitionId → run status map
  const testStatusMap = new Map<string, string>();
  for (const row of (latestStatuses ?? [])) {
    testStatusMap.set(row.testDefinitionId, row.status);
  }

  // Build testDefinitionId → issue count map
  const issueCountMap = new Map<string, number>();
  const issues: IssueItem[] = Array.isArray(issuesData)
    ? issuesData
    : ((issuesData as { items?: IssueItem[] } | undefined)?.items ?? []);
  for (const issue of issues) {
    if (issue.testDefinitionId) {
      issueCountMap.set(issue.testDefinitionId, (issueCountMap.get(issue.testDefinitionId) ?? 0) + 1);
    }
  }

  if (isLoading) {
    return (
      <tr>
        <td colSpan={6}>
          <div className="flex items-center gap-2 px-12 py-3" style={{ color: 'rgba(238,238,248,0.4)' }}>
            <Loader size={13} className="animate-spin" />
            <span className="text-xs">Loading tests…</span>
          </div>
        </td>
      </tr>
    );
  }

  const tests = allTests ?? [];

  if (tests.length === 0) {
    return (
      <tr>
        <td colSpan={6}>
          <div className="px-12 py-4 text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
            No test definitions linked to this feature yet.
            <button
              className="ml-2 underline"
              style={{ color: '#a78bfa' }}
              onClick={() =>
                navigate(`/projects/${projectId}/modules/${moduleId}/features/${featureId}`)
              }
            >
              Open feature to add tests →
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      {tests.map(test => {
        const runStatus = testStatusMap.get(test.id);
        const issueCount = issueCountMap.get(test.id) ?? 0;
        return (
          <tr
            key={test.id}
            className="transition-colors"
            style={{
              background: 'rgba(124,58,237,0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            {/* Indent spacer */}
            <td className="w-8" />

            {/* Test name + type */}
            <td className="pl-8 pr-3 py-2.5" colSpan={2}>
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full shrink-0" style={{ background: 'rgba(139,92,246,0.40)' }} />
                <TestTypeIcon type={test.type} />
                <span className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.78)' }}>
                  {test.name}
                </span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: test.type === 'MANUAL' ? 'rgba(139,92,246,0.15)' : test.type === 'API' ? 'rgba(56,189,248,0.12)' : 'rgba(52,211,153,0.12)',
                    color: test.type === 'MANUAL' ? '#c4b5fd' : test.type === 'API' ? '#38bdf8' : '#34d399',
                  }}
                >
                  {test.type}
                </span>
              </div>
            </td>

            {/* Run status */}
            <td className="px-3 py-2.5">
              <TestRunStatusPill status={runStatus} />
            </td>

            {/* Issue count */}
            <td className="px-3 py-2.5">
              {issueCount > 0 ? (
                <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded w-fit"
                  style={{ background: 'rgba(239,68,68,0.10)', color: '#f87171', border: '1px solid rgba(239,68,68,0.20)' }}>
                  <Bug size={9} /> {issueCount} issue{issueCount !== 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.20)' }}>—</span>
              )}
            </td>

            {/* Open link */}
            <td className="px-3 py-2.5 text-right">
              <button
                className="text-[11px] flex items-center gap-1 ml-auto transition-opacity opacity-50 hover:opacity-100"
                style={{ color: '#a78bfa' }}
                onClick={() =>
                  navigate(`/projects/${projectId}/modules/${moduleId}/features/${featureId}`)
                }
              >
                <ExternalLink size={10} /> View
              </button>
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function FeaturesPage() {
  const { projectId, moduleId } = useParams<{ projectId: string; moduleId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';
  const activeEnvId = useActiveEnv(projectId);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Feature | null>(null);
  const [form, setForm] = useState<FeatureFormState>(EMPTY_FORM);
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(null);

  const { data: moduleData } = useQuery({
    queryKey: ['module', moduleId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/modules/${moduleId}`).then(r => r.data),
    enabled: !!moduleId,
  });

  // All project modules — powers the quick-switch dropdown in the header
  const { data: allModules = [], isLoading: modulesLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const { data: features, isLoading } = useQuery<Feature[]>({
    queryKey: ['features', moduleId],
    queryFn: () => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
    enabled: !!moduleId,
  });

  const { data: featureStatsData = [] } = useQuery<FeatureStats[]>({
    queryKey: ['feature-stats', moduleId, activeEnvId],
    queryFn: () => statsApi.getFeatureStats(moduleId!, activeEnvId),
    enabled: !!moduleId,
  });

  const statsMap = new Map<string, FeatureStats>();
  (featureStatsData as FeatureStats[]).forEach(s => statsMap.set(s.featureId, s));

  const moduleName = (moduleData as { name?: string } | undefined)?.name ?? 'Module';

  const createMutation = useMutation({
    mutationFn: (data: FeatureFormState) =>
      api.post(`/api/v1/modules/${moduleId}/features`, data).then(r => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
      toast.success('Feature created', `"${vars.name}" has been added.`);
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to create feature', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FeatureFormState }) =>
      api.put(`/api/v1/features/${id}`, data).then(r => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
      toast.success('Feature updated', `"${vars.data.name}" has been saved.`);
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to update feature', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(feature: Feature) {
    setEditing(feature);
    setForm({ name: feature.name, description: feature.description ?? '' });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); setForm(EMPTY_FORM); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) updateMutation.mutate({ id: editing.id, data: form });
    else createMutation.mutate(form);
  }

  function toggleExpand(featureId: string) {
    setExpandedFeatureId(prev => (prev === featureId ? null : featureId));
  }

  function openFeature(featureId: string) {
    navigate(`/projects/${projectId}/modules/${moduleId}/features/${featureId}`);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <PageSpinner />;

  const moduleDropdownItems = allModules.map(m => ({
    id: m.id,
    name: m.name,
    href: `/projects/${projectId}/modules/${m.id}`,
  }));

  return (
    <div className="space-y-5">
      {/* Header — module switcher dropdown + feature count + action */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <NavDropdown
            label={moduleName}
            backTo={`/projects/${projectId}`}
            backLabel="Project"
            items={moduleDropdownItems}
            activeId={moduleId!}
            loading={modulesLoading}
          />
          <span style={{ color: 'rgba(238,238,248,0.25)' }}>/</span>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>Features</h1>
            {features && (
              <span
                className="text-xs font-semibold rounded-full px-2 py-0.5"
                style={{ background: 'rgba(139,92,246,0.20)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.30)' }}
              >
                {features.length}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Module-scoped report generation. Sits next to [+ New Feature] per
              the user's chosen layout: header is the home for primary actions
              (create + generate), body is for content. */}
          <GenerateReportButton
            projectId={projectId!}
            scope={{ type: 'MODULE', moduleId: moduleId! }}
            scopeTitle={moduleName}
            variant="secondary"
            size="sm"
          />
          {canManage && (
            <Button onClick={openCreate} size="sm">
              <Plus size={14} />
              New Feature
            </Button>
          )}
        </div>
      </div>

      {/* ── Module-level summary strip ───────────────────────────────────────
         Aggregates per-feature stats into a single module rollup so testers
         get a "how is this module doing" view at a glance — was missing per
         user feedback. Numbers are summed client-side from the per-feature
         stats already in featureStatsData (no extra round-trip). */}
      <ModuleSummaryStrip
        stats={featureStatsData as FeatureStats[]}
        moduleId={moduleId!}
      />

      {/* Module-scoped Latest report card.
       *  Replaces the previous full ReportsCard (table + generate) — the
       *  comprehensive Reports browse lives ONLY at project scope now.
       *  Generation here happens via the page header [Generate Report] button
       *  (added separately so it sits next to [+ New Feature]).
       *  See user UX iteration: "remove report table from module/feature, show
       *  latest as a small surface, browse all from the project page".
       */}
      <LatestReportCard
        projectId={projectId!}
        scope={{ type: 'MODULE', moduleId: moduleId! }}
      />

      {/* Table */}
      {!features || features.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No features yet"
          description="Features represent individual pieces of functionality to be tested. Add your first feature to get started."
          action={
            canManage ? (
              <Button onClick={openCreate} size="sm">
                <Plus size={14} />
                New Feature
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <Thead>
                <Tr>
                  <Th className="w-8" />
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Test Results</Th>
                  <Th>Updated</Th>
                  <Th className="w-36" />
                </Tr>
              </Thead>
              <Tbody>
                {features.map(feature => {
                  const stats = statsMap.get(feature.id);
                  const isExpanded = expandedFeatureId === feature.id;
                  const testCount = feature._count.testDefinitions;

                  return (
                    <React.Fragment key={feature.id}>
                      {/* ── Feature row ── */}
                      <Tr
                        className={cn(
                          'cursor-pointer transition-colors group',
                          isExpanded ? 'bg-violet-500/5' : 'hover:bg-white/3',
                        )}
                        onClick={() => toggleExpand(feature.id)}
                      >
                        {/* Expand chevron */}
                        <Td className="pl-4 pr-1 py-3 w-8">
                          <div className="flex items-center justify-center w-5 h-5 rounded transition-colors"
                            style={{ color: 'rgba(238,238,248,0.4)' }}>
                            {testCount > 0
                              ? isExpanded
                                ? <ChevronDown size={13} />
                                : <ChevronRight size={13} />
                              : <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.2)' }}>—</span>
                            }
                          </div>
                        </Td>

                        {/* Name + description */}
                        <Td>
                          <div>
                            <span
                              className="font-medium text-sm"
                              style={{ color: 'rgba(238,238,248,0.88)' }}
                            >
                              {feature.name}
                            </span>
                            {testCount > 0 && (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                                {testCount} test{testCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {feature.description && (
                              <p className="text-xs truncate max-w-xs mt-0.5"
                                style={{ color: 'rgba(238,238,248,0.45)' }}>
                                {feature.description}
                              </p>
                            )}
                          </div>
                        </Td>

                        <Td>
                          <div onClick={e => e.stopPropagation()}>
                            <FeatureStatusBadge feature={feature} />
                          </div>
                        </Td>

                        <Td>
                          <div onClick={e => e.stopPropagation()}>
                            <FeatureStatsStrip stats={stats} />
                          </div>
                        </Td>

                        <Td className="text-xs whitespace-nowrap">
                          <div onClick={e => e.stopPropagation()}>
                            <span style={{ color: 'rgba(238,238,248,0.45)' }}>
                              {new Date(feature.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </Td>

                        {/* Actions */}
                        <Td>
                          <div className="flex items-center gap-1.5 justify-end" onClick={e => e.stopPropagation()}>
                            <Button
                              size="sm"
                              onClick={() => openFeature(feature.id)}
                              className="text-xs"
                              style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.3)' }}
                            >
                              Open Feature →
                            </Button>
                            {canManage && (
                              <button
                                className="p-1 rounded text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                                onClick={() => openEdit(feature)}
                                title="Edit"
                              >
                                <Pencil size={14} />
                              </button>
                            )}
                          </div>
                        </Td>
                      </Tr>

                      {/* ── Expanded tests sub-rows ── */}
                      {isExpanded && testCount > 0 && (
                        <ExpandedTests
                          featureId={feature.id}
                          projectId={projectId!}
                          moduleId={moduleId!}
                          navigate={navigate}
                          activeEnvId={activeEnvId}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
              </Tbody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Feature' : 'New Feature'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. User login flow"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeModal} type="button">Cancel</Button>
            <Button type="submit" loading={isSaving}>
              {editing ? 'Save changes' : 'Create feature'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
