import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, BookOpen, ChevronRight, ChevronDown,
  FlaskConical, Cpu, ExternalLink, Loader,
  CheckCircle, XCircle, MinusCircle, Clock, Bug,
  ListChecks, TrendingUp, AlertCircle, Upload, Sparkles, Trash2, Layers, Plug, GripVertical,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { GenerateFeaturesModal } from '@/components/ai/GenerateFeaturesModal';
import { useAiConfigured } from '@/hooks/useAiConfigured';
import { api, statsApi, issuesApi, modulesApi, testsApi, featuresApi, pluginsApi } from '@/lib/api';
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
import { MiniRing } from '@/components/ui/MiniRing';
import { MetricInfo } from '@/components/ui/MetricInfo';
import type { MetricHelpKey } from '@/lib/metricHelp';
import { LatestReportCard } from '@/components/LatestReportCard';
import { ScopedIssuesPanel } from '@/components/issues/ScopedIssuesPanel';
import { WorkbenchTabs } from '@/components/WorkbenchTabs';
import { GenerateReportButton } from '@/components/GenerateReportButton';
import { ExportButton, ImportModal } from '@/components/ImportExport';
import { ClickUpRoutingHint } from '@/components/plugins/ClickUpRoutingHint';
import { FeatureClickUpRow } from '@/components/plugins/FeatureClickUpRow';
import { FeatureClickUpStatusControl } from '@/components/plugins/FeatureClickUpStatusControl';
import { ListSearchSort } from '@/components/ui/ListSearchSort';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { BulkActionBar } from '@/components/ui/BulkActionBar';

type FeatureSortKey = 'order' | 'updated_desc' | 'name_asc' | 'name_desc' | 'tests_desc' | 'tests_asc' | 'passRate_desc' | 'passRate_asc';
const FEATURE_SORT_LABELS: Record<FeatureSortKey, string> = {
  order: 'Manual order',
  updated_desc: 'Recently updated',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
  tests_desc: 'Most tests',
  tests_asc: 'Fewest tests',
  passRate_desc: 'Highest pass rate',
  passRate_asc: 'Lowest pass rate',
};
import { OpenInClickUpButton } from '@/components/plugins/OpenInClickUpButton';
import { ScopedDocsPanel } from '@/components/plugins/ScopedDocsPanel';
import { TestStatusBadge, type RunStatusValue } from '@/components/testing/TestStatusBadge';
import { StopRunButton } from '@/components/testing/StopRunButton';
import { useProjectRunSocket } from '@/hooks/useRunSocket';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Feature {
  id: string;
  name: string;
  description: string | null;
  tags?: string[];
  isDraft: boolean;
  activeVersionId: string | null;
  _count: { testDefinitions: number };
  order: number;
  updatedAt: string;
  /** The feature's own ClickUp link — carries the cached epic for the chip. */
  ticketLinks?: Array<{
    externalId: string;
    externalUrl: string;
    externalStatus: string | null;
    externalStatusColor: string | null;
    externalEpicName: string | null;
    externalEpicColor: string | null;
  }>;
}

interface FeatureStats {
  featureId: string;
  passed: number;
  failed: number;
  skipped: number;
  neverRun?: number;
  needsRetest?: number;
  outstanding: number;
  total: number;
  passRate: number | null;
  lastRunAt: string | null;
}

interface TestDefinition {
  id: string;
  name: string;
  type: 'UI' | 'API' | 'SHELL';
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
  tags: string[];
}

const EMPTY_FORM: FeatureFormState = { name: '', description: '', tags: [] };

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

// A feature row that can be dragged to reorder. `disabled` makes it inert
// (used when the list isn't in manual order). The drag-handle props are
// exposed to children so only the grip — not the whole row — initiates a drag,
// leaving the row's click-to-expand intact.
type DragHandle = { attributes: React.HTMLAttributes<HTMLElement>; listeners: Record<string, unknown> | undefined };
function SortableFeatureRow({
  id, disabled, onClick, className, children,
}: {
  id: string;
  disabled: boolean;
  onClick?: () => void;
  className?: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id, disabled });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: 'relative', zIndex: 20, opacity: 0.85, background: 'rgba(124,58,237,0.10)' } : {}),
  };
  return (
    <Tr ref={setNodeRef} style={style} onClick={onClick} className={className}>
      {children({ attributes: attributes as React.HTMLAttributes<HTMLElement>, listeners })}
    </Tr>
  );
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
  const neverRun = stats.neverRun ?? outstanding;
  const needsRetest = stats.needsRetest ?? 0;

  if (total === 0) return <span className="text-xs text-gray-400">No tests</span>;

  if (passed + failed + skipped === 0) {
    return (
      <span className="text-xs text-gray-400">
        ○ {total} test{total !== 1 ? 's' : ''} · Never tested
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2 text-xs flex-wrap">
      {passed > 0 && <span className="text-emerald-400">✅ {passed}</span>}
      {failed > 0 && <span className="text-red-400">❌ {failed}</span>}
      {skipped > 0 && <span className="text-gray-400">⊘ {skipped}</span>}
      {needsRetest > 0 && <span className="text-amber-400" title="Ran but no verdict — needs retest">↻ {needsRetest}</span>}
      {neverRun > 0 && <span className="text-gray-500" title="Never run">○ {neverRun}</span>}
      {passRate !== null && (
        <span
          className={cn(
            'font-semibold',
            passRate >= 80 ? 'text-emerald-400' : passRate >= 50 ? 'text-amber-400' : 'text-red-400',
          )}
          title="Pass rate over all test cases"
        >
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
      acc.neverRun += s.neverRun ?? (s.outstanding ?? 0);
      acc.needsRetest += s.needsRetest ?? 0;
      return acc;
    },
    { features: 0, tests: 0, passed: 0, failed: 0, skipped: 0, neverRun: 0, needsRetest: 0 },
  );
  const outstanding = totals.neverRun + totals.needsRetest;
  // Pass rate over ALL test cases (not just exercised ones) — matches the
  // backend stats.service definition so this client roll-up agrees with
  // the per-feature numbers and the project page.
  const passRate = totals.tests > 0 ? Math.round((totals.passed / totals.tests) * 100) : null;
  // "Never tested" = there are test cases but none have been exercised.
  const exercised = totals.passed + totals.failed + totals.skipped;
  const neverTested = totals.tests > 0 && exercised === 0;
  // Module-scoped feature coverage: a feature is "fully passed" only when it
  // has test cases and every one passed; "to test" = has untested cases.
  const featuresFullyPassed = stats.filter((s) => (s.total ?? 0) > 0 && s.passed === s.total).length;
  const featuresOutstanding = stats.filter((s) => (s.outstanding ?? 0) > 0).length;

  const { data: issueStats } = useQuery<{ open?: number; total?: number }>({
    queryKey: ['module-issue-stats', moduleId],
    queryFn: () => issuesApi.moduleStats(moduleId),
    enabled: !!moduleId,
    staleTime: 30_000,
  });
  const openIssues = issueStats?.open ?? 0;

  return (
    <div className="space-y-3">
      <div
        className="flex flex-col items-center gap-4 sm:flex-row sm:gap-5 rounded-2xl p-4 sm:p-5"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        }}
      >
        <ProgressDonut
          stats={{
            passed: totals.passed,
            failed: totals.failed,
            skipped: totals.skipped,
            neverRun: totals.neverRun,
            needsRetest: totals.needsRetest,
            outstanding,
            total: totals.tests,
          }}
          size={148}
        />
        <div className="w-full sm:flex-1 grid grid-cols-2 gap-3">
          <ModuleStatCard icon={<ListChecks size={15} style={{ color: 'var(--accent-400)' }} />} iconBg="rgba(var(--accent-rgb),0.20)"
            label="Features" value={totals.features} valueColor="var(--accent-400)" info="features" />
          <ModuleStatCard icon={<TrendingUp size={15} style={{ color: '#fbbf24' }} />} iconBg="rgba(245,158,11,0.18)"
            label={neverTested ? 'Never tested' : 'Pass Rate'}
            value={passRate === null || neverTested ? '—' : `${passRate}%`}
            valueColor={passRate === null || neverTested ? 'rgba(238,238,248,0.40)' : passRate >= 80 ? '#34d399' : passRate >= 50 ? '#fbbf24' : '#f87171'}
            info="passRate" />
          <ModuleStatCard icon={<CheckCircle size={15} style={{ color: '#34d399' }} />} iconBg="rgba(16,185,129,0.18)"
            label="Passed" value={totals.passed} valueColor="#34d399" info="passed" />
          <ModuleStatCard icon={<AlertCircle size={15} style={{ color: '#fbbf24' }} />} iconBg="rgba(245,158,11,0.15)"
            label="Issues" value={openIssues} valueColor={openIssues > 0 ? '#fbbf24' : 'rgba(238,238,248,0.40)'} info="openIssues" />
        </div>
      </div>

      {/* Feature coverage for THIS module — features fully passed vs total. */}
      <div
        className="rounded-xl p-3 sm:p-4 flex items-center gap-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <MiniRing passed={featuresFullyPassed} total={totals.features} />
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide font-semibold flex items-center gap-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Features passed
            <MetricInfo metric="featuresPassed" />
          </div>
          <div className="text-lg font-bold leading-tight" style={{ color: 'rgba(238,238,248,0.92)' }}>
            {featuresFullyPassed}
            <span className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.40)' }}> / {totals.features}</span>
          </div>
          <div className="text-[11px]" style={{ color: featuresOutstanding > 0 ? '#fbbf24' : 'rgba(238,238,248,0.40)' }}>
            {featuresOutstanding} still to test
          </div>
        </div>
      </div>
    </div>
  );
}

function ModuleStatCard({
  icon, iconBg, label, value, valueColor, info,
}: {
  icon: React.ReactNode; iconBg: string; label: string;
  value: string | number; valueColor: string; info?: MetricHelpKey;
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
          {label}
          {info && <MetricInfo metric={info} />}
        </p>
        <p className="text-xl font-bold tabular-nums leading-tight mt-0.5" style={{ color: valueColor }}>{value}</p>
      </div>
    </div>
  );
}

// ─── Test type icon ───────────────────────────────────────────────────────────

function TestTypeIcon({ type }: { type: string }) {
  if (type === 'API') return <FlaskConical size={11} style={{ color: '#38bdf8' }} />;
  return <Cpu size={11} style={{ color: '#34d399' }} />;
}

// ─── Expanded tests row ───────────────────────────────────────────────────────

function ExpandedTests({
  featureId,
  projectId,
  moduleId,
  navigate,
  activeEnvId,
  indentColumns,
}: {
  featureId: string;
  projectId: string;
  moduleId: string;
  navigate: ReturnType<typeof useNavigate>;
  activeEnvId?: string | null;
  indentColumns: number;
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

  // In-flight runs — drives the "Running…" pill that overrides historical
  // status. Short stale time so the run-socket invalidation feels snappy;
  // the WebSocket triggers the actual refetch.
  const { data: activeRuns } = useQuery({
    queryKey: ['test-active-runs', featureId, activeEnvId ?? null],
    queryFn: () => testsApi.getActiveRuns(featureId, activeEnvId),
    staleTime: 5_000,
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
  // Build testDefinitionId → active run map (PENDING/QUEUED/RUNNING).
  const activeRunMap = new Map<string, NonNullable<typeof activeRuns>[number]>();
  for (const r of (activeRuns ?? [])) {
    if (!activeRunMap.has(r.testDefinitionId)) activeRunMap.set(r.testDefinitionId, r);
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
        <td colSpan={indentColumns}>
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
        <td colSpan={indentColumns}>
          <div className="px-12 py-4 text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
            No test definitions linked to this feature yet.
            <button
              className="ml-2 underline"
              style={{ color: 'var(--accent-400)' }}
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
        const activeRun = activeRunMap.get(test.id);
        const issueCount = issueCountMap.get(test.id) ?? 0;
        return (
          <tr
            key={test.id}
            className="transition-colors"
            style={{
              background: 'rgba(var(--accent-rgb),0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            {/* Indent spacers — match leading columns of parent table */}
            {indentColumns === 7 && <td className="w-8" />}
            <td className="w-8" />

            {/* Test name + type */}
            <td className="pl-8 pr-3 py-2.5" colSpan={2}>
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.40)' }} />
                <TestTypeIcon type={test.type} />
                <span className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.78)' }}>
                  {test.name}
                </span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: test.type === 'API' ? 'rgba(56,189,248,0.12)' : 'rgba(52,211,153,0.12)',
                    color: test.type === 'API' ? '#38bdf8' : '#34d399',
                  }}
                >
                  {test.type}
                </span>
              </div>
            </td>

            {/* Run status — live-aware: in-flight runs show a spinner + timer
                badge that overrides the historical pass/fail pill. Stop
                button appears alongside whenever there's a runId to cancel. */}
            <td className="px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <TestStatusBadge
                  latestStatus={runStatus as RunStatusValue}
                  activeRun={activeRun ? {
                    status: activeRun.status,
                    startedAt: activeRun.startedAt,
                    createdAt: activeRun.createdAt,
                  } : null}
                />
                {activeRun && <StopRunButton runId={activeRun.id} />}
              </div>
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
                style={{ color: 'var(--accent-400)' }}
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

  // Subscribe to project-wide run updates so the expanded-tests rows reflect
  // status flips (PENDING → RUNNING → PASSED) in real time. Without this the
  // ExpandedTests cache only refetches when the user expands/collapses.
  useProjectRunSocket(projectId);
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';
  const activeEnvId = useActiveEnv(projectId);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Feature | null>(null);
  const [form, setForm] = useState<FeatureFormState>(EMPTY_FORM);
  // "Add feature" → also create the ClickUp ticket. Default on when CU is
  // healthy for this module so the ticket isn't forgotten.
  const [createInClickUp, setCreateInClickUp] = useState(true);
  const [expandedFeatureId, setExpandedFeatureId] = useState<string | null>(null);
  const [moduleWorkbenchTab, setModuleWorkbenchTab] = useState<'features' | 'quality' | 'docs'>('features');
  const [importOpen, setImportOpen] = useState(false);
  const [aiFeaturesOpen, setAiFeaturesOpen] = useState(false);
  // Disable Generate Features when the org hasn't set up an AI credential
  // yet — click routes to Settings → AI instead.
  const { configured: aiConfigured, isLoading: aiCheckLoading } = useAiConfigured();

  // List controls
  const [featureSearch, setFeatureSearch] = useState('');
  const [featureSort, setFeatureSort] = useState<FeatureSortKey>('updated_desc');
  const [featureTagFilter, setFeatureTagFilter] = useState<string[]>([]);
  const [featureEpicFilter, setFeatureEpicFilter] = useState<string[]>([]);

  // Bulk selection — admin only
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('');

  const { data: moduleData } = useQuery({
    queryKey: ['module', moduleId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/modules/${moduleId}`).then(r => r.data),
    enabled: !!moduleId,
  });

  // ClickUp routing for this module — tells us whether a new feature can have
  // a ClickUp ticket created alongside it, and where that ticket lands.
  const { data: clickupRouting } = useQuery({
    queryKey: ['clickup-routing', 'module', moduleId],
    queryFn: () => api.get<{
      install: { healthy: boolean } | null;
      listId: string | null;
      targetMode: string | null;
      parentTaskId: string | null;
      listIdInheritedLabel: string;
    }>(`/api/v1/modules/${moduleId}/clickup-routing`).then(r => r.data),
    enabled: !!moduleId,
    staleTime: 60_000,
  });
  const clickupAvailable = !!clickupRouting?.install?.healthy && !!clickupRouting?.listId;

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

  // Apply search filter + sort to features list before rendering.
  // Distinct tags + epics across the module's features — drive the facets.
  const allFeatureTags = useMemo(() => {
    const set = new Set<string>();
    (features ?? []).forEach((f) => (f.tags ?? []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [features]);
  const allFeatureEpics = useMemo(() => {
    const map = new Map<string, string | null>();
    (features ?? []).forEach((f) => {
      const ep = f.ticketLinks?.[0];
      if (ep?.externalEpicName) map.set(ep.externalEpicName, ep.externalEpicColor);
    });
    return [...map.entries()].map(([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name));
  }, [features]);

  const visibleFeatures = useMemo(() => {
    if (!features) return [] as Feature[];
    const needle = featureSearch.trim().toLowerCase();
    let filtered = needle
      ? features.filter((f) =>
        f.name.toLowerCase().includes(needle) ||
        (f.description ?? '').toLowerCase().includes(needle) ||
        (f.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
      )
      : features;
    if (featureTagFilter.length) {
      filtered = filtered.filter((f) => (f.tags ?? []).some((t) => featureTagFilter.includes(t)));
    }
    if (featureEpicFilter.length) {
      filtered = filtered.filter((f) => {
        const ep = f.ticketLinks?.[0]?.externalEpicName;
        return ep ? featureEpicFilter.includes(ep) : false;
      });
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const sa = statsMap.get(a.id);
      const sb = statsMap.get(b.id);
      switch (featureSort) {
        case 'order': return (a.order ?? 0) - (b.order ?? 0);
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'tests_desc': return b._count.testDefinitions - a._count.testDefinitions;
        case 'tests_asc': return a._count.testDefinitions - b._count.testDefinitions;
        case 'passRate_desc': return (sb?.passRate ?? -1) - (sa?.passRate ?? -1);
        case 'passRate_asc': return (sa?.passRate ?? 101) - (sb?.passRate ?? 101);
        case 'updated_desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [features, featureSearch, featureSort, statsMap, featureTagFilter, featureEpicFilter]);

  const moduleName = (moduleData as { name?: string } | undefined)?.name ?? 'Module';

  // ── Drag-to-reorder ──────────────────────────────────────────────────────
  // Reordering only makes sense in manual-order mode with no active filters —
  // any other sort/filter would make a dropped position ambiguous.
  const dragEnabled =
    featureSort === 'order' &&
    !featureSearch.trim() &&
    featureTagFilter.length === 0 &&
    featureEpicFilter.length === 0;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => featuresApi.reorder(moduleId!, orderedIds),
    // Revert to server truth on failure; the optimistic cache update already
    // moved the row.
    onError: () => { queryClient.invalidateQueries({ queryKey: ['features', moduleId] }); },
  });
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = visibleFeatures.map((f) => f.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const newOrderIds = arrayMove(ids, oldIndex, newIndex);
    // Optimistically rewrite each feature's `order` so the list re-sorts now.
    const orderMap = new Map(newOrderIds.map((fid, i) => [fid, i]));
    queryClient.setQueryData<Feature[]>(['features', moduleId], (prev) =>
      prev ? prev.map((f) => (orderMap.has(f.id) ? { ...f, order: orderMap.get(f.id)! } : f)) : prev,
    );
    reorderMutation.mutate(newOrderIds);
  };

  const createMutation = useMutation({
    mutationFn: async (data: FeatureFormState) => {
      const feature = await api.post(`/api/v1/modules/${moduleId}/features`, data).then(r => r.data) as { id: string };
      // Best-effort ClickUp ticket creation. A ClickUp failure must NOT undo
      // the feature — we return the error so onSuccess can warn instead.
      let clickupError: string | null = null;
      if (createInClickUp && clickupAvailable && feature?.id) {
        try {
          await pluginsApi.pushFeature(feature.id);
        } catch (err) {
          const m = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
          clickupError = typeof m === 'string' ? m : 'ClickUp ticket could not be created.';
        }
      }
      return { feature, clickupError };
    },
    onSuccess: ({ clickupError }, vars) => {
      queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
      const pushed = createInClickUp && clickupAvailable;
      if (clickupError) {
        toast.error(
          'Feature created — ClickUp ticket failed',
          `"${vars.name}" was saved, but the ClickUp ticket wasn't created: ${clickupError} Use "Push to ClickUp" on the feature to retry.`,
        );
      } else {
        toast.success(
          'Feature created',
          pushed ? `"${vars.name}" added + ClickUp ticket created.` : `"${vars.name}" has been added.`,
        );
      }
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

  // Soft-delete via deletedAt on the server — copy says "archive" to match
  // projects + modules + tests and signal reversibility.
  const archiveMutation = useMutation({
    mutationFn: (id: string) => featuresApi.archive(id),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to archive feature', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const visibleIds = visibleFeatures.map((f) => f.id);
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        visibleIds.forEach((id) => next.delete(id));
        return next;
      }
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const bulkArchiveMutation = useMutation({
    mutationFn: (ids: string[]) => featuresApi.bulkArchive(projectId!, ids),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
      queryClient.invalidateQueries({ queryKey: ['feature-stats'] });
      toast.success(`Archived ${res.archived} feature${res.archived !== 1 ? 's' : ''}`, 'Tests and runs are preserved.');
      setSelectedIds(new Set());
      setBulkArchiveOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Bulk archive failed', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: ({ ids, target }: { ids: string[]; target: string }) =>
      featuresApi.bulkMove(projectId!, ids, target),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
      queryClient.invalidateQueries({ queryKey: ['feature-stats'] });
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      toast.success(`Moved ${res.moved} feature${res.moved !== 1 ? 's' : ''}`);
      setSelectedIds(new Set());
      setBulkMoveOpen(false);
      setBulkMoveTarget('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Bulk move failed', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  function handleArchive(feature: Feature) {
    if (!window.confirm(`Archive "${feature.name}"? It disappears from this list but tests and runs are preserved — admins can restore later.`)) return;
    archiveMutation.mutate(feature.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
        queryClient.invalidateQueries({ queryKey: ['module-stats'] });
        queryClient.invalidateQueries({ queryKey: ['feature-stats'] });
        toast.success('Feature archived', `"${feature.name}" is hidden. Tests and runs are preserved.`);
        closeModal();
      },
    });
  }

  function openCreate() { setEditing(null); setForm(EMPTY_FORM); setModalOpen(true); }
  function openEdit(feature: Feature) {
    setEditing(feature);
    setForm({ name: feature.name, description: feature.description ?? '', tags: feature.tags ?? [] });
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
    // The route is /projects/:projectId/modules/:moduleId/features — the
    // bare /modules/:moduleId path doesn't exist in App.tsx, so this href
    // used to 404 when users switched modules via the dropdown.
    href: `/projects/${projectId}/modules/${m.id}/features`,
  }));

  return (
    <div className="space-y-5">
      {/* Header — module switcher dropdown + feature count + action */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <NavDropdown
            label={moduleName}
            backTo={`/projects/${projectId}`}
            backLabel="Project"
            items={moduleDropdownItems}
            activeId={moduleId!}
            loading={modulesLoading}
          />
          <span style={{ color: 'rgba(238,238,248,0.25)' }}>/</span>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-lg font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>Features</h1>
            {features && (
              <span
                className="text-xs font-semibold rounded-full px-2 py-0.5"
                style={{ background: 'rgba(var(--accent-rgb),0.20)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.30)' }}
              >
                {features.length}
              </span>
            )}
            {moduleId && <ClickUpRoutingHint scope={{ kind: 'module', moduleId }} variant="badge" collapsible />}
            {moduleId && <OpenInClickUpButton scope={{ kind: 'module', moduleId }} />}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
          <ExportButton level="module" id={moduleId!} name={moduleName} variant="secondary" size="sm" />
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
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={aiCheckLoading}
                onClick={() => {
                  if (aiConfigured) setAiFeaturesOpen(true);
                  else navigate('/org/ai-settings');
                }}
                title={
                  aiConfigured
                    ? "Propose features from the module's description, attached docs, and acceptance criteria"
                    : 'AI is not configured — click to set up in Settings → AI'
                }
                style={!aiConfigured && !aiCheckLoading ? { opacity: 0.55 } : undefined}
              >
                <Sparkles size={14} />
                {aiConfigured || aiCheckLoading ? 'Generate Features' : 'Generate Features (set up AI)'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Upload size={14} />
                Import
              </Button>
              <Button onClick={openCreate} size="sm">
                <Plus size={14} />
                New Feature
              </Button>
            </>
          )}
        </div>
      </div>

      {/* G1 — Generate features with AI */}
      {moduleId && (
        <GenerateFeaturesModal
          open={aiFeaturesOpen}
          onClose={() => setAiFeaturesOpen(false)}
          moduleId={moduleId}
          onApplied={() => {
            setAiFeaturesOpen(false);
            queryClient.invalidateQueries({ queryKey: ['features', moduleId] });
            queryClient.invalidateQueries({ queryKey: ['module', moduleId] });
          }}
        />
      )}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId!}
        targetModuleId={moduleId!}
        modules={allModules}
        invalidateKeys={[
          ['features', moduleId!],
          ['feature-stats', moduleId!],
          ['module', moduleId!],
          ['modules', projectId!],
          ['issue-stats', 'module', moduleId!],
        ]}
      />

      <ModuleSummaryStrip
        stats={featureStatsData as FeatureStats[]}
        moduleId={moduleId!}
      />

      <WorkbenchTabs
        tabs={[
          {
            id: 'features',
            label: 'Features',
            description: 'Open a feature to run tests and manage cases.',
          },
          {
            id: 'quality',
            label: 'Reports & issues',
            description: 'Latest report snapshot and the searchable module issue list.',
          },
          {
            id: 'docs',
            label: 'Docs',
            description: 'Module-level specs. Manual markdown or linked from ClickUp.',
          },
        ]}
        value={moduleWorkbenchTab}
        onValueChange={id => setModuleWorkbenchTab(id as 'features' | 'quality' | 'docs')}
      />

      {moduleWorkbenchTab === 'quality' && (
        <>
          <LatestReportCard
            projectId={projectId!}
            scope={{ type: 'MODULE', moduleId: moduleId! }}
          />
          <ScopedIssuesPanel
            scope="module"
            projectId={projectId!}
            moduleId={moduleId!}
            title="Module issues"
          />
        </>
      )}

      {moduleWorkbenchTab === 'docs' && moduleId && (
        <ScopedDocsPanel scope="module" scopeId={moduleId} />
      )}

      {moduleWorkbenchTab === 'features' && (
        <>
      {/* List controls — search + sort + tag/epic facets. */}
      {features && features.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-full sm:flex-1 sm:min-w-[220px]">
            <ListSearchSort
              search={featureSearch}
              onSearchChange={setFeatureSearch}
              searchPlaceholder="Search features by name, description or tag…"
              sort={featureSort}
              onSortChange={setFeatureSort}
              sortOptions={FEATURE_SORT_LABELS}
            />
          </div>
          {allFeatureTags.length > 0 && (
            <MultiSelectFilter
              label="Tags"
              options={allFeatureTags.map((t) => ({ value: t, label: t }))}
              selected={featureTagFilter}
              onChange={setFeatureTagFilter}
            />
          )}
          {allFeatureEpics.length > 0 && (
            <MultiSelectFilter
              label="Epics"
              options={allFeatureEpics.map((e) => ({ value: e.name, label: e.name, color: e.color }))}
              selected={featureEpicFilter}
              onChange={setFeatureEpicFilter}
            />
          )}
        </div>
      )}

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
      ) : visibleFeatures.length === 0 ? (
        <div
          className="text-center py-10 rounded-xl text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(238,238,248,0.55)' }}
        >
          No features match &ldquo;<span className="text-purple-300">{featureSearch}</span>&rdquo;.
          <button
            type="button"
            onClick={() => setFeatureSearch('')}
            className="ml-2 text-purple-300 hover:text-purple-200 underline"
          >
            Clear search
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
        <Card>
          <CardContent className="p-0">
            <Table cards>
              <Thead>
                <Tr>
                  {canManage && (
                    <Th className="w-8 pl-3 pr-1">
                      <input
                        type="checkbox"
                        aria-label="Select all visible features"
                        checked={visibleFeatures.length > 0 && visibleFeatures.every((f) => selectedIds.has(f.id))}
                        onChange={toggleSelectAllVisible}
                        className="cursor-pointer"
                      />
                    </Th>
                  )}
                  {dragEnabled && <Th className="w-8" />}
                  <Th className="w-8" />
                  <Th>Name</Th>
                  <Th>Status</Th>
                  <Th>Test Results</Th>
                  <Th>Updated</Th>
                  <Th className="w-36" />
                </Tr>
              </Thead>
              <Tbody>
                <SortableContext items={visibleFeatures.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                {visibleFeatures.map(feature => {
                  const stats = statsMap.get(feature.id);
                  const isExpanded = expandedFeatureId === feature.id;
                  const testCount = feature._count.testDefinitions;

                  return (
                    <React.Fragment key={feature.id}>
                      {/* ── Feature row ── */}
                      <SortableFeatureRow
                        id={feature.id}
                        disabled={!dragEnabled}
                        onClick={() => toggleExpand(feature.id)}
                        className={cn(
                          'cursor-pointer transition-colors group',
                          isExpanded ? 'bg-violet-500/5' : 'hover:bg-white/3',
                        )}
                      >
                        {({ attributes, listeners }) => (<>
                        {dragEnabled && (
                          <Td className="pl-2 pr-0 w-8" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <button
                              type="button"
                              aria-label="Drag to reorder feature"
                              className="flex items-center justify-center w-5 h-5 rounded cursor-grab active:cursor-grabbing touch-none"
                              style={{ color: 'rgba(238,238,248,0.35)' }}
                              {...attributes}
                              {...listeners}
                            >
                              <GripVertical size={14} />
                            </button>
                          </Td>
                        )}
                        {canManage && (
                          <Td className="pl-3 pr-1 w-8" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select feature ${feature.name}`}
                              checked={selectedIds.has(feature.id)}
                              onChange={() => toggleSelect(feature.id)}
                              className="cursor-pointer"
                            />
                          </Td>
                        )}
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
                        <Td label="Name">
                          <div>
                            <span
                              className="font-medium text-sm"
                              style={{ color: 'rgba(238,238,248,0.88)' }}
                            >
                              {feature.name}
                            </span>
                            {testCount > 0 && (
                              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                                style={{ background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent-300)' }}>
                                {testCount} test{testCount !== 1 ? 's' : ''}
                              </span>
                            )}
                            {/* Linked ClickUp ticket — cached id + status,
                                clickable to open the task. The status text
                                + colour come straight from ClickUp's last
                                pull, so the list shows at a glance "this
                                feature is linked AND where it stands". */}
                            {feature.ticketLinks?.[0]?.externalUrl && (() => {
                              const link = feature.ticketLinks[0];
                              const shortId =
                                link.externalId && link.externalId.length > 8
                                  ? '…' + link.externalId.slice(-6)
                                  : link.externalId;
                              return (
                                <a
                                  href={link.externalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full align-middle transition hover:brightness-125"
                                  style={{
                                    background: 'rgba(var(--accent-rgb),0.10)',
                                    border: '1px solid rgba(var(--accent-rgb),0.30)',
                                    color: 'rgba(238,238,248,0.85)',
                                  }}
                                  title={`Linked ClickUp task ${link.externalId}${link.externalStatus ? ` — ${link.externalStatus}` : ''} (click to open)`}
                                >
                                  <Plug size={9} className="text-purple-300" />
                                  <span className="font-mono">#{shortId}</span>
                                </a>
                              );
                            })()}
                            {/* Editable ClickUp status — lazy: statuses only
                                fetched when the pill is opened, so a long list
                                doesn't fan out a probe per row on mount. */}
                            {feature.ticketLinks?.[0]?.externalUrl && (
                              <span
                                className="ml-2 align-middle inline-flex"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <FeatureClickUpStatusControl
                                  featureId={feature.id}
                                  lazy
                                  hideEpic
                                  initial={{
                                    status: feature.ticketLinks[0].externalStatus,
                                    statusColor: feature.ticketLinks[0].externalStatusColor,
                                    externalUrl: feature.ticketLinks[0].externalUrl,
                                  }}
                                />
                              </span>
                            )}
                            {/* Linked ClickUp epic — cached on the feature's
                                TicketLink, rendered in the epic's own colour. */}
                            {feature.ticketLinks?.[0]?.externalEpicName && (() => {
                              const c = feature.ticketLinks[0].externalEpicColor;
                              return (
                                <span
                                  className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full align-middle"
                                  style={{
                                    background: c ? `${c}22` : 'rgba(56,189,248,0.14)',
                                    color: c ?? '#7dd3fc',
                                    border: `1px solid ${c ? `${c}55` : 'rgba(56,189,248,0.30)'}`,
                                  }}
                                  title={`ClickUp epic: ${feature.ticketLinks[0].externalEpicName}`}
                                >
                                  <Layers size={9} />
                                  {feature.ticketLinks[0].externalEpicName}
                                </span>
                              );
                            })()}
                            {feature.description && (
                              <p className="text-xs truncate max-w-xs mt-0.5"
                                style={{ color: 'rgba(238,238,248,0.45)' }}>
                                {feature.description}
                              </p>
                            )}
                          </div>
                        </Td>

                        <Td label="Status">
                          <div onClick={e => e.stopPropagation()}>
                            <FeatureStatusBadge feature={feature} />
                          </div>
                        </Td>

                        <Td label="Test Results">
                          <div onClick={e => e.stopPropagation()}>
                            <FeatureStatsStrip stats={stats} />
                          </div>
                        </Td>

                        <Td label="Updated" className="text-xs whitespace-nowrap">
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
                              style={{ background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}
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
                        </>)}
                      </SortableFeatureRow>

                      {/* ── Expanded tests sub-rows ── */}
                      {isExpanded && testCount > 0 && (
                        <ExpandedTests
                          featureId={feature.id}
                          projectId={projectId!}
                          moduleId={moduleId!}
                          navigate={navigate}
                          activeEnvId={activeEnvId}
                          indentColumns={(canManage ? 7 : 6) + (dragEnabled ? 1 : 0)}
                        />
                      )}
                    </React.Fragment>
                  );
                })}
                </SortableContext>
              </Tbody>
            </Table>
          </CardContent>
        </Card>
        </DndContext>
      )}

        </>
      )}

      {/* Bulk action bar */}
      {canManage && (
        <BulkActionBar
          count={selectedIds.size}
          itemLabel="feature"
          onClear={() => setSelectedIds(new Set())}
        >
          <Button size="sm" variant="secondary" onClick={() => setBulkMoveOpen(true)}>
            Move…
          </Button>
          <Button size="sm" variant="danger" onClick={() => setBulkArchiveOpen(true)}>
            <Trash2 size={12} className="mr-1" /> Archive
          </Button>
        </BulkActionBar>
      )}

      {/* Bulk archive confirmation */}
      <Modal
        open={bulkArchiveOpen}
        onClose={() => setBulkArchiveOpen(false)}
        title="Archive selected features"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Archive <span className="font-semibold text-gray-800">{selectedIds.size}</span> feature
            {selectedIds.size !== 1 ? 's' : ''}? They disappear from this list — tests and runs are
            preserved and an admin can restore them later.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBulkArchiveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={bulkArchiveMutation.isPending}
              onClick={() => bulkArchiveMutation.mutate(Array.from(selectedIds))}
            >
              Archive
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk move modal */}
      <Modal
        open={bulkMoveOpen}
        onClose={() => { setBulkMoveOpen(false); setBulkMoveTarget(''); }}
        title="Move features to another module"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Move <span className="font-semibold text-gray-800">{selectedIds.size}</span> feature
            {selectedIds.size !== 1 ? 's' : ''} from <span className="font-semibold text-gray-800">{moduleName}</span> to:
          </p>
          <select
            value={bulkMoveTarget}
            onChange={(e) => setBulkMoveTarget(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">Select target module…</option>
            {allModules.filter((m) => m.id !== moduleId).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setBulkMoveOpen(false); setBulkMoveTarget(''); }}>
              Cancel
            </Button>
            <Button
              loading={bulkMoveMutation.isPending}
              disabled={!bulkMoveTarget}
              onClick={() => bulkMoveMutation.mutate({ ids: Array.from(selectedIds), target: bulkMoveTarget })}
            >
              Move
            </Button>
          </div>
        </div>
      </Modal>

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
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Tags</label>
            <input
              type="text"
              value={form.tags.join(', ')}
              onChange={e => setForm(f => ({
                ...f,
                tags: Array.from(new Set(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))).slice(0, 10),
              }))}
              placeholder="Comma-separated, e.g. login, smoke, regression"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          {/* ClickUp routing — read-only at create-time; full link/unlink controls on edit */}
          {moduleId && !editing && <ClickUpRoutingHint scope={{ kind: 'module', moduleId }} variant="card" />}

          {/* Create the ClickUp ticket alongside the feature. The routing card
              above already shows + confirms WHERE the ticket lands. */}
          {!editing && clickupAvailable && (
            <label
              className="flex items-start gap-2 cursor-pointer rounded-lg p-2.5"
              style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.18)' }}
            >
              <input
                type="checkbox"
                checked={createInClickUp}
                onChange={(e) => setCreateInClickUp(e.target.checked)}
                className="mt-0.5 accent-purple-500"
              />
              <span className="text-xs text-slate-200">
                <span className="font-medium">Also create a ClickUp ticket for this feature</span>
                <span className="block text-[11px] text-slate-400 mt-0.5">
                  Creates the ticket at the location shown above and links it to this feature.
                </span>
              </span>
            </label>
          )}
          {editing && (
            <>
              <ClickUpRoutingHint scope={{ kind: 'feature', featureId: editing.id }} variant="card" />
              <FeatureClickUpRow featureId={editing.id} />
            </>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            {/* Destructive action lives on the left so it's visually separate
                from Save/Cancel. Only shown when editing an existing feature
                — same UX as the modules edit modal. */}
            <div>
              {editing && canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleArchive(editing)}
                  loading={archiveMutation.isPending}
                  className="text-red-300 hover:text-red-200"
                  title="Archive this feature — hides it. Tests and runs are preserved."
                >
                  <Trash2 size={13} className="mr-1" /> Archive feature
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeModal} type="button">Cancel</Button>
              <Button type="submit" loading={isSaving}>
                {editing ? 'Save changes' : 'Create feature'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  );
}
