import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderOpen, ArrowRight, Layers, Archive, RotateCcw } from 'lucide-react';
import { projectsApi, statsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface EnvRollup {
  environment: { id: string; name: string; type: string };
  counts: { passed: number; failed: number; cancelled: number; error: number; running: number; pending: number };
  total: number;
  passRate: number | null;
  lastRunAt: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  deletedAt: string | null;
  _count: { testDefinitions: number; runs: number; environments: number };
}

// ─── Project card ─────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  canManage,
  onArchive,
  onRestore,
}: {
  project: Project;
  canManage: boolean;
  onArchive: (id: string, name: string) => void;
  onRestore: (id: string, name: string) => void;
}) {
  const navigate = useNavigate();
  const archived = !project.isActive || !!project.deletedAt;

  const { data: envStats = [] } = useQuery<EnvRollup[]>({
    queryKey: ['project-stats-by-env', project.id],
    queryFn: () => statsApi.getProjectStatsByEnv(project.id),
    // Don't waste round-trips fetching stats for archived projects — they're
    // listed for restore actions only, not for active work.
    enabled: !archived,
    staleTime: 60_000,
  });

  return (
    <div
      className="rounded-2xl border cursor-pointer group transition-all flex flex-col"
      style={{
        background: archived ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.04)',
        borderColor: archived ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)',
        opacity: archived ? 0.65 : 1,
      }}
      onMouseEnter={e => {
        if (archived) return;
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(139,92,246,0.45)';
        (e.currentTarget as HTMLDivElement).style.background  = 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={e => {
        if (archived) return;
        (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(255,255,255,0.09)';
        (e.currentTarget as HTMLDivElement).style.background  = 'rgba(255,255,255,0.04)';
      }}
      onClick={() => {
        // Archived cards don't navigate — admins use Restore from the
        // action bar at the bottom. Avoids the cognitive whiplash of
        // entering a project that's marked dead.
        if (archived) return;
        navigate(`/projects/${project.id}`);
      }}
    >
      {/* Top — icon + name + arrow */}
      <div className="p-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: archived ? 'rgba(148,163,184,0.18)' : 'rgba(139,92,246,0.18)' }}>
            {archived ? (
              <Archive size={16} style={{ color: '#94a3b8' }} />
            ) : (
              <Layers size={16} style={{ color: '#a78bfa' }} />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {archived && (
              <span
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}
              >
                archived
              </span>
            )}
            {!archived && (
              <ArrowRight size={14} style={{ color: 'rgba(255,255,255,0.20)' }} />
            )}
          </div>
        </div>
        <h3 className="font-semibold text-sm" style={{ color: 'rgba(238,238,248,0.92)' }}>
          {project.name}
        </h3>
        {project.description && (
          <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgba(238,238,248,0.40)' }}>
            {project.description}
          </p>
        )}
      </div>

      {/* Per-env progress bars — skipped for archived projects */}
      {!archived && envStats.length > 0 && (
        <div
          className="mx-4 mb-4 rounded-xl px-3 py-3 space-y-2.5"
          style={{
            background: 'rgba(0,0,0,0.18)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
          onClick={e => e.stopPropagation()}
        >
          {envStats.slice(0, 4).map(e => {
            const run = e.counts.passed + e.counts.failed + e.counts.cancelled + e.counts.error;
            const total = e.total;
            const progress = total > 0 ? Math.round((run / total) * 100) : 0;
            const hasRuns = total > 0;
            const color = !hasRuns ? 'rgba(255,255,255,0.15)'
              : progress >= 80 ? '#34d399'
              : progress >= 50 ? '#fbbf24'
              : '#f87171';

            return (
              <div key={e.environment.id}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium" style={{ color: 'rgba(238,238,248,0.65)' }}>
                    {e.environment.name}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums"
                    style={{ color: hasRuns ? color : 'rgba(238,238,248,0.25)' }}>
                    {hasRuns ? `${progress}%` : 'No runs'}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.08)' }}>
                  {hasRuns && (
                    <div className="h-full rounded-full"
                      style={{ width: `${progress}%`, background: color }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div
        className="flex items-center gap-4 text-xs px-5 py-3 mt-auto"
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          color: 'rgba(238,238,248,0.28)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <span>{project._count?.testDefinitions ?? 0} tests</span>
        <span>{project._count?.runs ?? 0} runs</span>
        <span>{project._count?.environments ?? 0} envs</span>
        {canManage && (
          <span className="ml-auto flex items-center gap-1.5">
            {archived ? (
              <button
                type="button"
                onClick={() => onRestore(project.id, project.name)}
                className="text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1"
                style={{
                  background: 'rgba(52,211,153,0.10)',
                  border: '1px solid rgba(52,211,153,0.30)',
                  color: '#6ee7b7',
                }}
                title="Restore this project — makes it active again"
              >
                <RotateCcw size={11} /> Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onArchive(project.id, project.name)}
                className="text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 opacity-60 hover:opacity-100"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(238,238,248,0.65)',
                }}
                title="Archive this project — hides it from the list but keeps all tests and runs"
              >
                <Archive size={11} /> Archive
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ProjectsPage() {
  const qc = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const isPlatformAdmin = user?.platformRole === 'PLATFORM_ADMIN';
  const isOrgAdmin = orgRole === 'ORG_ADMIN' || orgRole === 'ORG_OWNER';
  // Same gate as the API uses for archive/restore — admins manage, non-admins
  // see the list read-only. Platform admins bypass on the server, so they can
  // act here too.
  const canManageProjects = isOrgAdmin || isPlatformAdmin;
  const canCreateProject = canManageProjects;

  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [desc, setDesc] = useState('');

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects', { archived: showArchived }],
    queryFn: () => projectsApi.list({ includeArchived: showArchived }),
  });

  const create = useMutation({
    mutationFn: () => projectsApi.create({ name, slug, description: desc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created', `"${name}" is ready to go.`);
      setOpen(false);
      setName('');
      setSlug('');
      setDesc('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to create project', typeof msg === 'string' ? msg : 'Something went wrong. Please try again.');
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => projectsApi.archive(id),
    onSuccess: (_data, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project archived', (ctx as { name?: string })?.name ? `"${(ctx as { name: string }).name}" is now hidden from the list.` : 'Tests and runs are preserved — restore any time from "Show archived".');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not archive project', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const restore = useMutation({
    mutationFn: (id: string) => projectsApi.restore(id),
    onSuccess: (_data, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project restored', (ctx as { name?: string })?.name ? `"${(ctx as { name: string }).name}" is active again.` : 'Project is active again.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not restore project', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const handleArchive = (id: string, projectName: string) => {
    if (!window.confirm(`Archive "${projectName}"? It will be hidden from the projects list, but all tests, runs and reports are preserved and can be restored later.`)) return;
    archive.mutate(id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['projects'] });
        toast.success('Project archived', `"${projectName}" is now hidden. Tick "Show archived" to restore.`);
      },
    });
  };

  const handleRestore = (id: string, projectName: string) => {
    restore.mutate(id, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['projects'] });
        toast.success('Project restored', `"${projectName}" is active again.`);
      },
    });
  };

  if (isLoading) return <PageSpinner />;

  const projectList = projects as Project[];
  const activeCount = projectList.filter(p => p.isActive && !p.deletedAt).length;
  const archivedCount = projectList.length - activeCount;

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Projects</h2>
          <p className="text-sm text-white/40 mt-0.5">
            {activeCount} active
            {showArchived && archivedCount > 0 ? ` · ${archivedCount} archived` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canManageProjects && (
            <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="accent-violet-500"
              />
              Show archived
            </label>
          )}
          {canCreateProject && (
            <Button onClick={() => setOpen(true)}>
              <Plus size={15} /> New Project
            </Button>
          )}
        </div>
      </div>

      {/* Projects grid */}
      {projectList.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10">
          <EmptyState
            icon={FolderOpen}
            title="No projects yet"
            description="Create your first project to start defining and running tests."
            action={
              canCreateProject ? (
                <Button onClick={() => setOpen(true)}>
                  <Plus size={14} /> Create Project
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projectList.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              canManage={canManageProjects}
              onArchive={handleArchive}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="New Project">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Project Name</label>
            <input
              className={inputCls}
              placeholder="Admin Portal"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/(^-|-$)/g, ''),
                );
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Slug</label>
            <input
              className={`${inputCls} font-mono`}
              placeholder="admin-portal"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">
              Description <span className="text-white/30">(optional)</span>
            </label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!name.trim() || !slug.trim()}
              onClick={() => create.mutate()}
            >
              Create Project
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
