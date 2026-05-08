import React, { useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useActiveEnv } from '@/stores/activeEnvStore';
import {
  Plus, Search, X, ChevronDown, ChevronRight, Tag,
  MoreHorizontal, Pencil, Trash2, Layers,
  ListChecks, TrendingUp, CheckCircle, XCircle,
} from 'lucide-react';
import { ProgressDonut } from '@/components/ProgressDonut';
import { projectsApi, statsApi, api, issuesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { ExportButton, ImportModal } from '@/components/ImportExport';
import { IssueStatsWidget, IssueListDrawer } from '@/components/IssueTracker';
import { ReportsCard } from '@/components/ReportsCard';
import { ScopedIssuesPanel } from '@/components/issues/ScopedIssuesPanel';
import { WorkbenchTabs } from '@/components/WorkbenchTabs';
import { ProjectPluginsPanel } from '@/components/plugins/ProjectPluginsPanel';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { BackLink } from '@/components/BackLink';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModuleStats {
  moduleId: string;
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  passRate: number | null;
  lastRunAt: string | null;
}

interface Module {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  order: number;
  _count: { features: number };
  updatedAt: string;
}

interface ModuleFormState {
  name: string;
  description: string;
  tags: string[];
}

const EMPTY_FORM: ModuleFormState = { name: '', description: '', tags: [] };

type SortOption =
  | 'name_asc' | 'name_desc'
  | 'passRate_desc' | 'passRate_asc'
  | 'features_desc' | 'features_asc'
  | 'updated_desc' | 'outstanding_desc';

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
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function passRateColor(rate: number | null): string {
  if (rate === null) return 'text-amber-400';
  if (rate >= 80) return 'text-emerald-400';
  if (rate >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function sortModules(
  list: Module[],
  statsMap: Map<string, ModuleStats>,
  option: SortOption,
): Module[] {
  const arr = [...list];
  switch (option) {
    case 'name_asc': return arr.sort((a, b) => a.name.localeCompare(b.name));
    case 'name_desc': return arr.sort((a, b) => b.name.localeCompare(a.name));
    case 'passRate_desc':
      return arr.sort((a, b) => {
        const ra = statsMap.get(a.id)?.passRate ?? -1;
        const rb = statsMap.get(b.id)?.passRate ?? -1;
        return rb - ra;
      });
    case 'passRate_asc':
      return arr.sort((a, b) => {
        const ra = statsMap.get(a.id)?.passRate ?? Infinity;
        const rb = statsMap.get(b.id)?.passRate ?? Infinity;
        return ra - rb;
      });
    case 'features_desc':
      return arr.sort((a, b) => (b._count.features) - (a._count.features));
    case 'features_asc':
      return arr.sort((a, b) => (a._count.features) - (b._count.features));
    case 'updated_desc':
      return arr.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    case 'outstanding_desc':
      return arr.sort((a, b) => {
        const oa = statsMap.get(a.id)?.outstanding ?? 0;
        const ob = statsMap.get(b.id)?.outstanding ?? 0;
        return ob - oa;
      });
    default: return arr;
  }
}

// ─── Stats Strip ─────────────────────────────────────────────────────────────

function StatsStrip({ stats }: { stats: ModuleStats | undefined }) {
  if (!stats) return null;

  const { passed, failed, skipped, outstanding, total, passRate, lastRunAt } = stats;

  if (total === 0) {
    return (
      <div className="text-xs mt-2" style={{ color: 'rgba(238,238,248,0.42)' }}>No test cases yet</div>
    );
  }

  if (passed + failed + skipped === 0) {
    return (
      <div className="text-xs text-amber-400 mt-2">
        ○ {outstanding} outstanding · Never tested
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 mt-2 text-xs flex-wrap">
      {passed > 0 && <span className="text-emerald-400 font-medium">✅ {passed} passed</span>}
      {failed > 0 && <span className="text-red-400 font-medium">❌ {failed} failed</span>}
      {skipped > 0 && <span style={{ color: 'rgba(238,238,248,0.50)' }}>⊘ {skipped} skipped</span>}
      {outstanding > 0 && <span className="text-amber-400">○ {outstanding} outstanding</span>}
      {passRate !== null && (
        <span className={cn('font-semibold', passRateColor(passRate))}>{passRate}%</span>
      )}
      <span style={{ color: 'rgba(238,238,248,0.45)' }}>{relativeTime(lastRunAt)}</span>
    </div>
  );
}

// ─── Module Card ─────────────────────────────────────────────────────────────

interface ModuleCardProps {
  mod: Module;
  projectId: string;
  stats: ModuleStats | undefined;
  canManage: boolean;
  onEdit: (mod: Module) => void;
  onDelete: (mod: Module) => void;
  onTagClick: (tag: string) => void;
}

function ModuleCard({ mod, projectId, stats, canManage, onEdit, onDelete, onTagClick }: ModuleCardProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [issueDrawerOpen, setIssueDrawerOpen] = useState(false);

  const hasFailed = (stats?.failed ?? 0) > 0;
  const allPassed = stats && stats.total > 0 && stats.failed === 0 && stats.outstanding === 0 && stats.passed > 0;
  const featuresUrl = `/projects/${projectId}/modules/${mod.id}/features`;

  return (
    <div
      className={cn(
        'rounded-xl border transition-all duration-150 relative group cursor-pointer',
        'border-white/8 hover:border-white/20',
        hasFailed ? 'border-l-2 border-l-red-500' : allPassed ? 'border-l-2 border-l-emerald-500' : '',
      )}
      style={{ background: 'rgba(255,255,255,0.04)' }}
      onClick={() => navigate(featuresUrl)}
    >
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="font-semibold text-sm text-left transition-opacity"
                style={{ color: 'rgba(238,238,248,0.92)' }}
              >
                {mod.name}
              </span>
              {mod.tags.map(tag => (
                <button
                  key={tag}
                  onClick={e => { e.stopPropagation(); onTagClick(tag); }}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors"
                  style={{
                    background: 'rgba(124,58,237,0.15)',
                    color: '#a78bfa',
                    border: '1px solid rgba(124,58,237,0.25)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(124,58,237,0.15)')}
                >
                  {tag}
                </button>
              ))}
            </div>
            {mod.description && (
              <p className="text-xs mt-0.5 truncate max-w-lg" style={{ color: 'rgba(238,238,248,0.52)' }}>{mod.description}</p>
            )}
            <StatsStrip stats={stats} />
            <div onClick={e => e.stopPropagation()}>
              <IssueStatsWidget
                scope="module"
                scopeId={mod.id}
                projectId={projectId}
                onOpenList={() => setIssueDrawerOpen(true)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
            <span className="text-xs" style={{ color: 'rgba(238,238,248,0.38)' }}>
              {mod._count.features} feature{mod._count.features !== 1 ? 's' : ''}
            </span>

            {/* Subtle "Open →" label that brightens on row hover */}
            <span
              className="text-xs font-medium transition-opacity opacity-40 group-hover:opacity-90"
              style={{ color: '#a78bfa' }}
            >
              Open →
            </span>

            {canManage && (
              <div className="relative">
                <button
                  onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div
                      className="absolute right-0 top-full mt-1 w-36 rounded-lg overflow-hidden py-1 z-20"
                      style={{
                        background: 'rgba(18,18,32,0.98)',
                        border: '1px solid rgba(255,255,255,0.10)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.60)',
                      }}
                    >
                      <button
                        onClick={() => { onEdit(mod); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-left"
                        style={{ color: 'rgba(238,238,248,0.75)' }}
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        onClick={() => { onDelete(mod); setMenuOpen(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors text-left"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Issue list drawer */}
      <IssueListDrawer
        open={issueDrawerOpen}
        onClose={() => setIssueDrawerOpen(false)}
        projectId={projectId}
        moduleId={mod.id}
        scopeLabel={mod.name}
      />
    </div>
  );
}

// ─── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({
  tags,
  suggestions,
  onChange,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const [showSugs, setShowSugs] = useState(false);

  const filteredSugs = suggestions.filter(
    s => s.includes(input.toLowerCase()) && !tags.includes(s),
  );

  function addTag(raw: string) {
    const tag = raw.toLowerCase().trim().replace(/[^a-z0-9\-_]/g, '');
    if (!tag || tags.includes(tag) || tags.length >= 10) return;
    onChange([...tags, tag]);
    setInput('');
    setShowSugs(false);
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div className="relative">
      <div
        className="min-h-[38px] w-full rounded-lg px-2 py-1 flex flex-wrap gap-1"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.10)',
        }}
      >
        {tags.map(t => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs"
            style={{
              background: 'rgba(124,58,237,0.15)',
              color: '#a78bfa',
              border: '1px solid rgba(124,58,237,0.25)',
            }}
          >
            {t}
            <button onClick={() => removeTag(t)} style={{ color: '#a78bfa' }}>
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setShowSugs(true); }}
          onKeyDown={handleKey}
          onFocus={() => setShowSugs(true)}
          onBlur={() => setTimeout(() => setShowSugs(false), 150)}
          placeholder={tags.length === 0 ? '+ Add tag…' : ''}
          className="flex-1 min-w-[80px] outline-none text-xs bg-transparent py-1 px-1"
          style={{ border: 'none', boxShadow: 'none', background: 'transparent', color: 'rgba(238,238,248,0.85)' }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">Press Enter or comma to add · max 10 tags</p>

      {showSugs && (input || filteredSugs.length > 0) && (
        <div
          className="absolute left-0 top-full mt-1 w-full rounded-lg z-20 max-h-36 overflow-y-auto py-1"
          style={{
            background: 'rgba(18,18,32,0.98)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.60)',
          }}
        >
          {input.trim() && !tags.includes(input.toLowerCase().trim()) && (
            <button
              className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors"
              style={{ color: '#a78bfa' }}
              onClick={() => addTag(input)}
            >
              + Create tag: &quot;{input.toLowerCase().trim()}&quot;
            </button>
          )}
          {filteredSugs.map(s => (
            <button
              key={s}
              className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-white/5 transition-colors"
              onClick={() => addTag(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Project Stats Header ─────────────────────────────────────────────────────

function ProjectStatsHeader({ projectId, activeEnvId }: { projectId: string; activeEnvId: string | null }) {
  const { data: stats } = useQuery({
    queryKey: ['project-stats', projectId, activeEnvId],
    queryFn: () => statsApi.getProjectStats(projectId, activeEnvId),
  });

  if (!stats) return null;

  const { passed, failed, skipped, outstanding, total, passRate, lastRunAt } = stats as ModuleStats & { projectId: string };

  return (
    <div
      className="flex items-center gap-5 rounded-2xl p-5 mt-5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
      }}
    >
      <ProgressDonut
        stats={{ passed, failed, skipped, outstanding, total }}
        size={148}
      />
      <div className="flex-1 grid grid-cols-2 gap-3">
        <ProjectStatCard icon={<ListChecks size={15} style={{ color: '#a78bfa' }} />} iconBg="rgba(139,92,246,0.20)"
          label="Test Cases" value={total} valueColor="rgba(238,238,248,0.92)" />
        <ProjectStatCard icon={<TrendingUp size={15} style={{ color: '#fbbf24' }} />} iconBg="rgba(245,158,11,0.18)"
          label="Pass Rate"
          value={passRate !== null ? `${passRate}%` : '—'}
          valueColor={passRate === null ? 'rgba(238,238,248,0.40)' : passRate >= 80 ? '#34d399' : passRate >= 50 ? '#fbbf24' : '#f87171'}
          sub={relativeTime(lastRunAt)} />
        <ProjectStatCard icon={<CheckCircle size={15} style={{ color: '#34d399' }} />} iconBg="rgba(16,185,129,0.18)"
          label="Passed" value={passed} valueColor={passed > 0 ? '#34d399' : 'rgba(238,238,248,0.40)'} />
        <ProjectStatCard icon={<XCircle size={15} style={{ color: '#f87171' }} />} iconBg="rgba(239,68,68,0.18)"
          label="Failed" value={failed} valueColor={failed > 0 ? '#f87171' : 'rgba(238,238,248,0.40)'} />
      </div>
    </div>
  );
}

function ProjectStatCard({
  icon, iconBg, label, value, valueColor, sub,
}: {
  icon: React.ReactNode; iconBg: string; label: string;
  value: string | number; valueColor: string; sub?: string;
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
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'rgba(238,238,248,0.35)' }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Project Issue Bar ───────────────────────────────────────────────────────

function ProjectIssueBar({ projectId }: { projectId: string }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { data: stats } = useQuery<{
    total: number; open: number; inProgress: number; resolved: number;
    byType: { BUG: number; SNAG: number; QUERY: number };
  }>({
    queryKey: ['issue-stats', 'project', projectId],
    queryFn: () => issuesApi.projectStats(projectId),
    staleTime: 30_000,
  });

  if (!stats || stats.total === 0) return null;

  return (
    <>
      <button
        onClick={() => setDrawerOpen(true)}
        className="w-full flex items-center gap-4 px-4 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
      >
        <span className="text-xs font-medium text-amber-400">🐛 Issues</span>
        <div className="flex items-center gap-3 text-xs">
          {stats.open > 0 && <span className="text-red-400 font-medium">{stats.open} open</span>}
          {stats.inProgress > 0 && <span className="text-amber-400">{stats.inProgress} in progress</span>}
          {stats.resolved > 0 && <span className="text-green-400">{stats.resolved} resolved</span>}
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs text-slate-500">
          {stats.byType.BUG > 0 && <span>🐛 {stats.byType.BUG} bugs</span>}
          {stats.byType.SNAG > 0 && <span>📌 {stats.byType.SNAG} snags</span>}
          {stats.byType.QUERY > 0 && <span>❓ {stats.byType.QUERY} queries</span>}
          <span className="text-amber-500/60">View all →</span>
        </div>
      </button>
      <IssueListDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectId={projectId}
        scopeLabel="All project issues"
      />
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';
  const activeEnvId = useActiveEnv(projectId);

  // ── State ──
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [sortOption, setSortOption] = useState<SortOption>('updated_desc');
  const [groupByTag, setGroupByTag] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [projectWorkbenchTab, setProjectWorkbenchTab] = useState<'modules' | 'quality' | 'integrations'>('modules');

  // Import modal
  const [importOpen, setImportOpen] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMod, setEditingMod] = useState<Module | null>(null);
  const [form, setForm] = useState<ModuleFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<Module | null>(null);

  // ── Queries ──
  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: modules = [], isLoading: modulesLoading } = useQuery<Module[]>({
    queryKey: ['modules', projectId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/modules`).then(r => r.data),
    enabled: !!projectId,
  });

  const { data: moduleStatsData = [] } = useQuery<ModuleStats[]>({
    queryKey: ['module-stats', projectId, activeEnvId],
    queryFn: () => statsApi.getModuleStats(projectId!, activeEnvId),
    enabled: !!projectId,
  });

  const { data: tagsData } = useQuery<{ tags: string[] }>({
    queryKey: ['module-tags', projectId],
    queryFn: () => statsApi.getModuleTags(projectId!),
    enabled: !!projectId,
  });

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: (data: ModuleFormState) =>
      api.post(`/api/v1/projects/${projectId}/modules`, {
        name: data.name, description: data.description, tags: data.tags,
      }).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
      qc.invalidateQueries({ queryKey: ['module-tags', projectId] });
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
      api.put(`/api/v1/modules/${id}`, {
        name: data.name, description: data.description, tags: data.tags,
      }).then(r => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
      qc.invalidateQueries({ queryKey: ['module-tags', projectId] });
      toast.success('Module updated', `"${vars.data.name}" has been saved.`);
      closeModal();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to update module', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/modules/${id}`).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
      toast.success('Module deleted', 'The module has been removed.');
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to delete module', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  // ── Derived ──
  const statsMap = useMemo(() => {
    const m = new Map<string, ModuleStats>();
    (moduleStatsData as ModuleStats[]).forEach(s => m.set(s.moduleId, s));
    return m;
  }, [moduleStatsData]);

  const projectTags = tagsData?.tags ?? [];

  const filtered = useMemo(() => {
    let list = modules as Module[];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        m => m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q),
      );
    }
    if (activeTags.length > 0) {
      list = list.filter(m => activeTags.some(t => m.tags.includes(t)));
    }
    return sortModules(list, statsMap, sortOption);
  }, [modules, search, activeTags, sortOption, statsMap]);

  const grouped = useMemo(() => {
    if (!groupByTag) return null;
    const map = new Map<string, Module[]>();
    for (const m of filtered) {
      if (m.tags.length === 0) {
        map.set('__untagged__', [...(map.get('__untagged__') ?? []), m]);
      } else {
        for (const tag of m.tags) {
          map.set(tag, [...(map.get(tag) ?? []), m]);
        }
      }
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === '__untagged__') return 1;
      if (b === '__untagged__') return -1;
      return a.localeCompare(b);
    });
  }, [filtered, groupByTag]);

  // ── Modal helpers ──
  function openCreate() {
    setEditingMod(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(mod: Module) {
    setEditingMod(mod);
    setForm({ name: mod.name, description: mod.description ?? '', tags: [...mod.tags] });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingMod(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editingMod) {
      updateMutation.mutate({ id: editingMod.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  }

  function toggleTag(tag: string) {
    setActiveTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  if (projectLoading || modulesLoading) return <PageSpinner />;
  if (!project) return <div className="text-sm text-gray-500">Project not found.</div>;

  const SORT_LABELS: Record<SortOption, string> = {
    name_asc: 'Name A→Z', name_desc: 'Name Z→A',
    passRate_desc: 'Pass rate ↓', passRate_asc: 'Pass rate ↑',
    features_desc: 'Most features', features_asc: 'Fewest features',
    updated_desc: 'Recently updated', outstanding_desc: 'Outstanding tests',
  };

  const hasActiveFilters = search.trim() || activeTags.length > 0;

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <BackLink label="Projects" to="/projects" />
          <h2 className="text-xl font-bold mt-1" style={{ color: 'rgba(238,238,248,0.95)' }}>{project.name as string}</h2>
          {!!(project.description) && (
            <p className="text-sm mt-0.5" style={{ color: 'rgba(238,238,248,0.55)' }}>{project.description as string}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ExportButton level="project" id={projectId!} name={project.name as string} />
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              Import
            </Button>
          )}
        </div>
      </div>

      {/* Import modal */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId!}
        modules={(modules as { id: string; name: string }[])}
        invalidateKeys={[['modules', projectId!], ['project', projectId!]]}
      />

      {/* Quick links */}
      <div className="flex items-center gap-4 text-xs">
        <Link to={`/projects/${projectId}/environments`}
          className="transition-opacity hover:opacity-100"
          style={{ color: 'rgba(238,238,248,0.60)' }}>
          Environments
        </Link>
        <span style={{ color: 'rgba(238,238,248,0.25)' }}>·</span>
        <Link to={`/projects/${projectId}/runs`}
          className="transition-opacity hover:opacity-100"
          style={{ color: 'rgba(238,238,248,0.60)' }}>
          Run History
        </Link>
        <span style={{ color: 'rgba(238,238,248,0.25)' }}>·</span>
        <Link to={`/projects/${projectId}/tests`}
          className="transition-opacity hover:opacity-100"
          style={{ color: 'rgba(238,238,248,0.60)' }}>
          Test Definitions
        </Link>
        <span style={{ color: 'rgba(238,238,248,0.25)' }}>·</span>
        <Link to={`/projects/${projectId}/access`}
          className="transition-opacity hover:opacity-100"
          style={{ color: 'rgba(238,238,248,0.60)' }}>
          Access &amp; Members
        </Link>
      </div>

      <ProjectStatsHeader projectId={projectId!} activeEnvId={activeEnvId} />
      <ProjectIssueBar projectId={projectId!} />

      <WorkbenchTabs
        tabs={[
          {
            id: 'modules',
            label: 'Modules',
            description: 'Browse and organise modules — drill into features and tests.',
          },
          {
            id: 'quality',
            label: 'Reports & issues',
            description: 'Report library and full searchable issue list.',
          },
          {
            id: 'integrations',
            label: 'Integrations',
            description: 'Bind ClickUp / Jira / Slack to this project — pick lists, map statuses.',
          },
        ]}
        value={projectWorkbenchTab}
        onValueChange={id => setProjectWorkbenchTab(id as 'modules' | 'quality' | 'integrations')}
      />

      {projectWorkbenchTab === 'quality' && (
        <>
          <div className="border-t border-white/8" />
          <ReportsCard
            projectId={projectId!}
            defaultScope={{ type: 'PROJECT' }}
          />
          <ScopedIssuesPanel scope="project" projectId={projectId!} />
        </>
      )}

      {projectWorkbenchTab === 'integrations' && (
        <>
          <div className="border-t border-white/8" />
          <ProjectPluginsPanel projectId={projectId!} />
        </>
      )}

      {projectWorkbenchTab === 'modules' && (
        <>
      {/* Module list header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm" style={{ color: 'rgba(238,238,248,0.92)' }}>Modules</h3>
          {modules.length > 0 && (
            <span
              className="text-xs font-semibold rounded-full px-2 py-0.5"
              style={{ background: 'rgba(139,92,246,0.20)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.30)' }}
            >
              {filtered.length}{filtered.length !== modules.length ? ` of ${modules.length}` : ''}
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

      {/* Controls bar */}
      {(modules as Module[]).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search modules…"
              className="w-full pl-8 pr-8 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Tag filter */}
          <div className="relative">
            <button
              onClick={() => setTagFilterOpen(v => !v)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
                activeTags.length > 0
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-800',
              )}
            >
              <Tag size={12} />
              Tag {activeTags.length > 0 && `(${activeTags.length})`}
              <ChevronDown size={11} className={cn('transition-transform', tagFilterOpen && 'rotate-180')} />
            </button>
            {tagFilterOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setTagFilterOpen(false)} />
                <div
                  className="absolute left-0 top-full mt-1 w-52 rounded-xl overflow-hidden py-2 z-20"
                  style={{
                    background: 'rgba(18,18,32,0.98)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
                  }}
                >
                  <div className="px-3 pb-1 text-xs text-gray-500">Filter by tag</div>
                  {projectTags.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500 italic">No tags yet</div>
                  ) : (
                    projectTags.map(tag => (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-gray-700 hover:bg-white/5 transition-colors text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              'w-3.5 h-3.5 rounded border flex items-center justify-center',
                              activeTags.includes(tag)
                                ? 'bg-violet-500 border-violet-500'
                                : 'border-gray-500',
                            )}
                          >
                            {activeTags.includes(tag) && (
                              <span className="text-white text-[9px] font-bold">✓</span>
                            )}
                          </span>
                          {tag}
                        </span>
                      </button>
                    ))
                  )}
                  {activeTags.length > 0 && (
                    <button
                      onClick={() => setActiveTags([])}
                      className="w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 text-left transition-colors border-t border-white/5 mt-1 pt-2"
                    >
                      Clear tags
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Sort */}
          <div className="relative">
            <button
              onClick={() => setSortOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-400 hover:text-gray-800 transition-colors"
            >
              Sort: {SORT_LABELS[sortOption]}
              <ChevronDown size={11} className={cn('transition-transform', sortOpen && 'rotate-180')} />
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-1 w-48 rounded-xl overflow-hidden py-1 z-20"
                  style={{
                    background: 'rgba(18,18,32,0.98)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
                  }}
                >
                  {(Object.entries(SORT_LABELS) as [SortOption, string][]).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setSortOption(key); setSortOpen(false); }}
                      className={cn(
                        'w-full text-left px-3 py-2 text-xs transition-colors',
                        sortOption === key
                          ? 'text-violet-300 bg-violet-500/10'
                          : 'text-gray-700 hover:bg-white/5',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Group by tag */}
          <button
            onClick={() => setGroupByTag(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors',
              groupByTag
                ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-800',
            )}
          >
            <Layers size={12} />
            Group by tag
          </button>
        </div>
      )}

      {/* Active filter chips */}
      {hasActiveFilters && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-gray-500">
            Showing {filtered.length} of {(modules as Module[]).length} modules
          </span>
          {activeTags.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors"
            >
              {tag} <X size={10} />
            </button>
          ))}
          <button
            onClick={() => { setSearch(''); setActiveTags([]); }}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Module list */}
      {(modules as Module[]).length === 0 ? (
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
      ) : grouped ? (
        /* Group by tag view */
        <div className="space-y-4">
          {grouped.map(([tag, mods]) => (
            <GroupSection
              key={tag}
              tag={tag}
              modules={mods}
              projectId={projectId!}
              statsMap={statsMap}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onTagClick={toggleTag}
            />
          ))}
        </div>
      ) : (
        /* Flat list */
        <div className="space-y-3">
          {filtered.map(mod => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              projectId={projectId!}
              stats={statsMap.get(mod.id)}
              canManage={canManage}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onTagClick={toggleTag}
            />
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-sm text-gray-500">
              No modules match your filters.
            </div>
          )}
        </div>
      )}

        </>
      )}

      {/* Create / Edit Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={editingMod ? 'Edit Module' : 'New Module'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Authentication"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Tags</label>
            <TagInput
              tags={form.tags}
              suggestions={projectTags}
              onChange={tags => setForm(f => ({ ...f, tags }))}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={closeModal} type="button">Cancel</Button>
            <Button type="submit" loading={isSaving}>
              {editingMod ? 'Save changes' : 'Create module'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Module" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-700">
            Delete <span className="font-semibold">{deleteTarget?.name}</span>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Group Section ────────────────────────────────────────────────────────────

function GroupSection({
  tag, modules, projectId, statsMap, canManage, onEdit, onDelete, onTagClick,
}: {
  tag: string;
  modules: Module[];
  projectId: string;
  statsMap: Map<string, ModuleStats>;
  canManage: boolean;
  onEdit: (m: Module) => void;
  onDelete: (m: Module) => void;
  onTagClick: (t: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const label = tag === '__untagged__' ? 'Untagged' : tag;

  return (
    <div className="rounded-xl border border-white/8 overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)' }}>
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/3 transition-colors"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
          <span className="text-sm font-medium text-gray-800">{label}</span>
          <span className="text-xs text-gray-500">{modules.length} module{modules.length !== 1 ? 's' : ''}</span>
        </div>
      </button>
      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {modules.map(mod => (
            <ModuleCard
              key={mod.id}
              mod={mod}
              projectId={projectId}
              stats={statsMap.get(mod.id)}
              canManage={canManage}
              onEdit={onEdit}
              onDelete={onDelete}
              onTagClick={onTagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
