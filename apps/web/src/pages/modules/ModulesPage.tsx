import React, { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Pencil, Trash2, Layers, ChevronRight, ChevronDown,
  BookOpen, ExternalLink, Loader, CheckCircle, XCircle,
  MinusCircle, Clock, Bug,
} from 'lucide-react';
import { api, environmentsApi, statsApi, modulesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { MultiSelectFilter } from '@/components/filters/MultiSelectFilter';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { ListSearchSort } from '@/components/ui/ListSearchSort';
import { BulkActionBar } from '@/components/ui/BulkActionBar';

type ModuleSortKey = 'updated_desc' | 'name_asc' | 'name_desc' | 'features_desc' | 'features_asc';
const MODULE_SORT_LABELS: Record<ModuleSortKey, string> = {
  updated_desc: 'Recently updated',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
  features_desc: 'Most features',
  features_asc: 'Fewest features',
};

interface Module {
  id: string;
  name: string;
  description: string | null;
  tags?: string[];
  _count: { features: number };
  updatedAt: string;
}

interface ModuleFormState {
  name: string;
  description: string;
  tags: string[];
}

interface FeatureSummary {
  id: string;
  name: string;
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

const EMPTY_FORM: ModuleFormState = { name: '', description: '', tags: [] };

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function FeaturePassRatePill({ stats }: { stats: FeatureStats | undefined }) {
  if (!stats || stats.total === 0) return <span style={{ color: 'rgba(238,238,248,0.25)', fontSize: 11 }}>—</span>;
  const { passed, failed, skipped, passRate } = stats;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {passed > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] font-semibold"
          style={{ color: '#34d399' }}>
          <CheckCircle size={9} /> {passed}
        </span>
      )}
      {failed > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] font-semibold"
          style={{ color: '#f87171' }}>
          <XCircle size={9} /> {failed}
        </span>
      )}
      {skipped > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] font-semibold"
          style={{ color: '#94a3b8' }}>
          <MinusCircle size={9} /> {skipped}
        </span>
      )}
      {passRate !== null && (
        <span className="text-[10px] font-bold"
          style={{ color: passRate >= 80 ? '#34d399' : passRate >= 50 ? '#fbbf24' : '#f87171' }}>
          {passRate}%
        </span>
      )}
      {passed + failed + skipped === 0 && (
        <span className="flex items-center gap-0.5 text-[10px]"
          style={{ color: '#fbbf24' }}>
          <Clock size={9} /> Not run
        </span>
      )}
    </div>
  );
}

// ─── Expanded Features Row ────────────────────────────────────────────────────

function ExpandedFeatures({
  moduleId,
  projectId,
  navigate,
  indentColumns,
}: {
  moduleId: string;
  projectId: string;
  navigate: ReturnType<typeof useNavigate>;
  indentColumns: number;
}) {
  const { data: features, isLoading } = useQuery<FeatureSummary[]>({
    queryKey: ['features-for-module', moduleId],
    queryFn: () => api.get(`/api/v1/modules/${moduleId}/features`).then(r => r.data),
    staleTime: 30_000,
  });

  const { data: featureStatsData = [] } = useQuery<FeatureStats[]>({
    queryKey: ['feature-stats', moduleId],
    queryFn: () => statsApi.getFeatureStats(moduleId),
    staleTime: 60_000,
    enabled: !isLoading,
  });

  const statsMap = new Map<string, FeatureStats>();
  (featureStatsData as FeatureStats[]).forEach(s => statsMap.set(s.featureId, s));

  if (isLoading) {
    return (
      <tr>
        <td colSpan={indentColumns}>
          <div className="flex items-center gap-2 px-12 py-3" style={{ color: 'rgba(238,238,248,0.4)' }}>
            <Loader size={13} className="animate-spin" />
            <span className="text-xs">Loading features…</span>
          </div>
        </td>
      </tr>
    );
  }

  const list = features ?? [];

  if (list.length === 0) {
    return (
      <tr>
        <td colSpan={indentColumns}>
          <div className="px-12 py-4 text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
            No features in this module yet.
            <button
              className="ml-2 underline"
              style={{ color: '#a78bfa' }}
              onClick={() => navigate(`/projects/${projectId}/modules/${moduleId}/features`)}
            >
              Open module to add features →
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      {list.map(feature => {
        const stats = statsMap.get(feature.id);
        const status = feature.activeVersionId && feature.isDraft
          ? 'changes'
          : feature.activeVersionId
          ? 'published'
          : 'draft';
        return (
          <tr
            key={feature.id}
            className="transition-colors cursor-pointer"
            style={{
              background: 'rgba(124,58,237,0.04)',
              borderBottom: '1px solid rgba(255,255,255,0.04)',
            }}
            onClick={() => navigate(`/projects/${projectId}/modules/${moduleId}/features/${feature.id}`)}
          >
            {/* Indent spacers — match leading columns of parent table (checkbox col when admin, chevron col always) */}
            {indentColumns === 7 && <td className="w-8" />}
            <td className="w-8" />

            {/* Feature name */}
            <td className="pl-8 pr-3 py-2.5" colSpan={2}>
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full shrink-0" style={{ background: 'rgba(139,92,246,0.40)' }} />
                <BookOpen size={11} style={{ color: '#a78bfa' }} />
                <span className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.82)' }}>
                  {feature.name}
                </span>
                {feature._count.testDefinitions > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                    {feature._count.testDefinitions} test{feature._count.testDefinitions !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </td>

            {/* Publish status */}
            <td className="px-3 py-2.5">
              {status === 'published' && <Badge variant="success">Published</Badge>}
              {status === 'changes' && <Badge variant="warning">Has changes</Badge>}
              {status === 'draft' && <Badge variant="muted">Draft</Badge>}
            </td>

            {/* Pass rate / run results */}
            <td className="px-3 py-2.5">
              <FeaturePassRatePill stats={stats} />
            </td>

            {/* Open link */}
            <td className="px-3 py-2.5 text-right">
              <span className="text-[11px] flex items-center gap-1 ml-auto transition-opacity opacity-50 hover:opacity-100"
                style={{ color: '#a78bfa' }}>
                <ExternalLink size={10} /> Open
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

export function ModulesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Module | null>(null);
  const [form, setForm] = useState<ModuleFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [envPromptOpen, setEnvPromptOpen] = useState(false);

  // List controls
  const [moduleSearch, setModuleSearch] = useState('');
  const [moduleSort, setModuleSort] = useState<ModuleSortKey>('updated_desc');
  const [moduleTagFilter, setModuleTagFilter] = useState<string[]>([]);

  // Bulk selection — admin only
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  const { data: modules, isLoading } = useQuery<Module[]>({
    queryKey: ['modules', projectId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/modules`).then((r) => r.data),
    enabled: !!projectId,
  });

  // Distinct tags across the loaded modules — drives the tag filter facet.
  const allModuleTags = useMemo(() => {
    const set = new Set<string>();
    (modules ?? []).forEach((m) => (m.tags ?? []).forEach((t) => set.add(t)));
    return [...set].sort();
  }, [modules]);

  const visibleModules = useMemo(() => {
    if (!modules) return [] as Module[];
    const needle = moduleSearch.trim().toLowerCase();
    let filtered = needle
      ? modules.filter((m) =>
        m.name.toLowerCase().includes(needle) ||
        (m.description ?? '').toLowerCase().includes(needle) ||
        (m.tags ?? []).some((t) => t.toLowerCase().includes(needle)),
      )
      : modules;
    if (moduleTagFilter.length) {
      filtered = filtered.filter((m) => (m.tags ?? []).some((t) => moduleTagFilter.includes(t)));
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (moduleSort) {
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'features_desc': return b._count.features - a._count.features;
        case 'features_asc': return a._count.features - b._count.features;
        case 'updated_desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [modules, moduleSearch, moduleSort, moduleTagFilter]);

  const { data: environments = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['environments', projectId],
    queryFn: () => (projectId ? environmentsApi.list(projectId) : Promise.resolve([])),
    enabled: !!projectId,
  });

  const createMutation = useMutation({
    mutationFn: (data: ModuleFormState) =>
      api.post(`/api/v1/projects/${projectId}/modules`, data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      toast.success('Module created', `"${vars.name}" has been added.`);
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to create module', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: ModuleFormState }) =>
      // Module routes are project-scoped: PUT /projects/:projectId/modules/:id.
      // The bare /modules/:id path matches no route → 404 "failed to update".
      api.put(`/api/v1/projects/${projectId}/modules/${id}`, data).then((r) => r.data),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      toast.success('Module updated', `"${vars.data.name}" has been saved.`);
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to update module', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/projects/${projectId}/modules/${id}`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      // Backend is a soft-delete (sets deletedAt). Copy reflects that — "deleted"
      // suggested irreversible to users; "archived" matches projects + tests
      // behaviour and reads honestly.
      toast.success('Module archived', `The module is hidden from this list. Features and tests are preserved.`);
      setDeleteTarget(null);
      // Also close the edit modal if archive was triggered from there.
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to archive module', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  function openCreate() {
    if (environments.length === 0) {
      setEnvPromptOpen(true);
      return;
    }
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(mod: Module) {
    setEditing(mod);
    setForm({ name: mod.name, description: mod.description ?? '', tags: mod.tags ?? [] });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function handleDelete(mod: Module) {
    setDeleteTarget(mod);
  }

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
      const visibleIds = visibleModules.map((m) => m.id);
      const allSelected = visibleIds.every((id) => prev.has(id));
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
    mutationFn: (ids: string[]) => modulesApi.bulkArchive(projectId!, ids),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['modules', projectId] });
      toast.success(`Archived ${res.archived} module${res.archived !== 1 ? 's' : ''}`, 'Features and tests are preserved.');
      setSelectedIds(new Set());
      setBulkArchiveOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Bulk archive failed', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  function confirmDelete() {
    if (deleteTarget) {
      deleteMutation.mutate(deleteTarget.id);
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-gray-800">Modules</h1>
          {modules && (
            <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
              {modules.length}
            </span>
          )}
        </div>
        {canManage && (
          <Button onClick={openCreate} size="sm">
            <Plus size={14} />
            New Module
          </Button>
        )}
      </div>

      {/* List controls */}
      {modules && modules.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <ListSearchSort
              search={moduleSearch}
              onSearchChange={setModuleSearch}
              searchPlaceholder="Search modules by name, description or tag…"
              sort={moduleSort}
              onSortChange={setModuleSort}
              sortOptions={MODULE_SORT_LABELS}
            />
          </div>
          {allModuleTags.length > 0 && (
            <MultiSelectFilter
              label="Tags"
              options={allModuleTags.map((t) => ({ value: t, label: t }))}
              selected={moduleTagFilter}
              onChange={setModuleTagFilter}
            />
          )}
        </div>
      )}

      {/* Table */}
      {!modules || modules.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No modules yet"
          description="Modules group related features together. Create your first module to get started."
          action={
            canManage ? (
              <Button onClick={openCreate} size="sm">
                <Plus size={14} />
                New Module
              </Button>
            ) : undefined
          }
        />
      ) : visibleModules.length === 0 ? (
        <div
          className="text-center py-10 rounded-xl text-sm"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(238,238,248,0.55)' }}
        >
          No modules match &ldquo;<span className="text-purple-300">{moduleSearch}</span>&rdquo;.
          <button type="button" onClick={() => setModuleSearch('')} className="ml-2 text-purple-300 hover:text-purple-200 underline">
            Clear search
          </button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table cards>
              <Thead>
                <Tr>
                  {canManage && (
                    <Th className="w-8 pl-3 pr-1">
                      <input
                        type="checkbox"
                        aria-label="Select all visible modules"
                        checked={visibleModules.length > 0 && visibleModules.every((m) => selectedIds.has(m.id))}
                        onChange={toggleSelectAllVisible}
                        className="cursor-pointer"
                      />
                    </Th>
                  )}
                  <Th className="w-8" />
                  <Th>Name</Th>
                  <Th>Description</Th>
                  <Th>Features</Th>
                  <Th>Updated</Th>
                  <Th className="w-24" />
                </Tr>
              </Thead>
              <Tbody>
                {visibleModules.map((mod) => {
                  const isExpanded = expandedModuleId === mod.id;
                  const hasFeatures = mod._count.features > 0;
                  return (
                    <React.Fragment key={mod.id}>
                      {/* ── Module row ── */}
                      <Tr
                        className="group cursor-pointer"
                        onClick={() => setExpandedModuleId(isExpanded ? null : mod.id)}
                      >
                        {canManage && (
                          <Td className="pl-3 pr-1 w-8" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Select module ${mod.name}`}
                              checked={selectedIds.has(mod.id)}
                              onChange={() => toggleSelect(mod.id)}
                              className="cursor-pointer"
                            />
                          </Td>
                        )}
                        {/* Expand chevron */}
                        <Td className="pl-4 pr-1 w-8">
                          <span style={{ color: 'rgba(238,238,248,0.35)', display: 'flex', alignItems: 'center' }}>
                            {hasFeatures
                              ? isExpanded
                                ? <ChevronDown size={13} />
                                : <ChevronRight size={13} />
                              : <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.18)' }}>—</span>
                            }
                          </span>
                        </Td>

                        {/* Name */}
                        <Td label="Name">
                          <span className="font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>
                            {mod.name}
                          </span>
                        </Td>

                        {/* Description */}
                        <Td label="Description" className="max-w-xs truncate" style={{ color: 'rgba(238,238,248,0.50)' }}>
                          {mod.description ?? <span className="italic" style={{ color: 'rgba(238,238,248,0.25)' }}>—</span>}
                        </Td>

                        {/* Feature count */}
                        <Td label="Features">
                          {hasFeatures ? (
                            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                              style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}>
                              {mod._count.features} feature{mod._count.features !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span className="text-xs" style={{ color: 'rgba(238,238,248,0.30)' }}>0</span>
                          )}
                        </Td>

                        {/* Updated */}
                        <Td label="Updated" className="text-xs whitespace-nowrap" style={{ color: 'rgba(238,238,248,0.45)' }}>
                          {relativeTime(mod.updatedAt)}
                        </Td>

                        {/* Actions */}
                        <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            {canManage && (
                              <>
                                <button
                                  className="p-1 rounded transition-colors focus-visible:ring-2 focus-visible:ring-violet-400"
                                  style={{ color: 'rgba(238,238,248,0.40)' }}
                                  onMouseEnter={e => (e.currentTarget.style.color = 'rgba(238,238,248,0.90)')}
                                  onMouseLeave={e => (e.currentTarget.style.color = 'rgba(238,238,248,0.40)')}
                                  onClick={() => openEdit(mod)}
                                  title="Edit module"
                                  aria-label={`Edit module ${mod.name}`}
                                >
                                  <Pencil size={14} />
                                </button>
                                {/* Archive lives inside the edit modal (opens
                                    via the pencil icon above) — a separate
                                    trash icon next to Edit was making the
                                    destructive action one stray click away
                                    from saving a name change. */}
                              </>
                            )}
                          </div>
                        </Td>
                      </Tr>

                      {/* ── Expanded features ── */}
                      {isExpanded && hasFeatures && (
                        <ExpandedFeatures
                          moduleId={mod.id}
                          projectId={projectId!}
                          navigate={navigate}
                          indentColumns={canManage ? 7 : 6}
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
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit Module' : 'New Module'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Authentication"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Optional description…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Tags
            </label>
            <input
              type="text"
              value={form.tags.join(', ')}
              onChange={(e) => setForm((f) => ({
                ...f,
                tags: Array.from(new Set(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))).slice(0, 10),
              }))}
              placeholder="Comma-separated, e.g. auth, billing, smoke"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            {/* Destructive action lives on the left so it's visually separate
                from the Save/Cancel pair. Only shown when editing an existing
                module — there's nothing to archive on create. */}
            <div>
              {editing && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleDelete(editing)}
                  className="text-red-300 hover:text-red-200"
                  title="Archive this module — hides it from the list. Features and tests are preserved."
                >
                  <Trash2 size={13} className="mr-1" /> Archive folder
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeModal} type="button">
                Cancel
              </Button>
              <Button type="submit" loading={isSaving}>
                {editing ? 'Save changes' : 'Create module'}
              </Button>
            </div>
          </div>
        </form>
      </Modal>

      {/* Archive Confirmation Modal — backend is a soft-delete (deletedAt
          stamp), so the action is reversible by an admin via SQL today.
          Copy reflects that — telling users it's "permanent" would be wrong. */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Archive Module"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Archive{' '}
            <span className="font-semibold text-gray-800">{deleteTarget?.name}</span>? The module
            disappears from this list, but its features, tests and runs are preserved —
            an admin can restore it later if needed.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={confirmDelete}
            >
              Archive
            </Button>
          </div>
        </div>
      </Modal>

      {/* Bulk action bar */}
      {canManage && (
        <BulkActionBar
          count={selectedIds.size}
          itemLabel="module"
          onClear={() => setSelectedIds(new Set())}
        >
          <Button size="sm" variant="danger" onClick={() => setBulkArchiveOpen(true)}>
            <Trash2 size={12} className="mr-1" /> Archive
          </Button>
        </BulkActionBar>
      )}

      {/* Bulk archive confirmation */}
      <Modal
        open={bulkArchiveOpen}
        onClose={() => setBulkArchiveOpen(false)}
        title="Archive selected modules"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Archive <span className="font-semibold text-gray-800">{selectedIds.size}</span> module
            {selectedIds.size !== 1 ? 's' : ''}? They disappear from this list — features, tests
            and runs are preserved and an admin can restore them later.
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

      {/* Environment required prompt */}
      <Modal
        open={envPromptOpen}
        onClose={() => setEnvPromptOpen(false)}
        title="Create environment first"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            You need at least one environment before creating modules.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEnvPromptOpen(false)}>
              Later
            </Button>
            <Button
              onClick={() => {
                setEnvPromptOpen(false);
                navigate(`/projects/${projectId}/environments`);
              }}
            >
              Create env now
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
