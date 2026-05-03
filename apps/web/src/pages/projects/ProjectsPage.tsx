import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderOpen, ArrowRight, Layers } from 'lucide-react';
import { projectsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';

export function ProjectsPage() {
  const qc = useQueryClient();
  const { user, orgRole } = useAuthStore();
  const canCreateProject =
    orgRole === 'ORG_ADMIN' ||
    orgRole === 'ORG_OWNER' ||
    user?.platformRole === 'PLATFORM_ADMIN';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [desc, setDesc] = useState('');
  const { data: projects = [], isLoading } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list });
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

  if (isLoading) return <PageSpinner />;

  const inputCls =
    'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Projects</h2>
          <p className="text-sm text-white/40 mt-0.5">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>
        {canCreateProject && (
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> New Project
          </Button>
        )}
      </div>

      {/* Projects grid */}
      {projects.length === 0 ? (
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
          {projects.map((p: Record<string, unknown>) => {
            const c = p._count as Record<string, number>;
            return (
              <Link key={p.id as string} to={`/projects/${p.id}`} className="block group">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-5 hover:border-violet-500/50 hover:bg-white/8 transition-all">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
                      <Layers size={18} className="text-violet-400" />
                    </div>
                    <ArrowRight
                      size={14}
                      className="text-white/20 group-hover:text-violet-400 mt-1 transition-colors"
                    />
                  </div>
                  <h3 className="font-semibold text-white text-sm mb-1">{p.name as string}</h3>
                  {!!(p.description) && (
                    <p className="text-xs text-white/40 mb-3 line-clamp-2">{p.description as string}</p>
                  )}
                  <div className="flex gap-4 text-xs text-white/30 mt-3 pt-3 border-t border-white/5">
                    <span>{c?.testDefinitions ?? 0} tests</span>
                    <span>{c?.runs ?? 0} runs</span>
                    <span>{c?.environments ?? 0} envs</span>
                  </div>
                </div>
              </Link>
            );
          })}
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
