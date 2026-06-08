import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Github, Plus, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { githubApi, type RepoRole, type RepoIndexStatus } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * Project Repositories — links the project's repos (BE + FE) against the org's
 * GitHub credential. Self-hides nothing: if no org credential exists, it shows
 * a CTA to configure one. Lives under the project Integrations tab.
 */
export function ProjectReposPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const credQ = useQuery({
    queryKey: ['git-credential', orgId],
    queryFn: () => githubApi.getCredential(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const reposQ = useQuery({
    queryKey: ['project-repos', projectId],
    queryFn: () => githubApi.listRepos(projectId),
    enabled: !!projectId,
  });

  const [owner, setOwner] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<RepoRole>('OTHER');
  const [branch, setBranch] = useState('');

  const link = useMutation({
    mutationFn: () =>
      githubApi.linkRepo(projectId, {
        repoOwner: owner.trim(),
        repoName: name.trim(),
        role,
        defaultBranch: branch.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-repos', projectId] });
      setOwner('');
      setName('');
      setBranch('');
      toast.success('Repo linked');
    },
    onError: (e: unknown) => toast.error('Could not link repo', errMsg(e)),
  });

  const unlink = useMutation({
    mutationFn: (repoId: string) => githubApi.unlinkRepo(projectId, repoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-repos', projectId] });
      toast.success('Repo unlinked');
    },
    onError: (e: unknown) => toast.error('Unlink failed', errMsg(e)),
  });

  const reindex = useMutation({
    mutationFn: (repoId: string) => githubApi.reindexRepo(projectId, repoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-repos', projectId] });
      toast.success('Queued for indexing');
    },
    onError: (e: unknown) => toast.error('Reindex failed', errMsg(e)),
  });

  const repos = reposQ.data ?? [];
  const hasCred = !!credQ.data;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-purple-300" />
          <h4 className="text-sm font-semibold text-white">Repositories</h4>
        </div>
        <p className="text-xs text-slate-400 -mt-2">
          Link this project's repos (e.g. a backend and a frontend). Used for deploy automation and
          codebase-aware AI test generation.
        </p>

        {!hasCred ? (
          <div
            className="rounded-lg p-3 text-xs"
            style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)' }}
          >
            <span className="text-slate-300">No GitHub credential for this org yet. </span>
            <Link to="/org/github" className="text-purple-300 hover:text-purple-200 font-medium">
              Connect GitHub →
            </Link>
          </div>
        ) : (
          <>
            {/* Linked repos */}
            {reposQ.isLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : repos.length === 0 ? (
              <p className="text-xs text-slate-500">No repos linked yet.</p>
            ) : (
              <div className="space-y-2">
                {repos.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-lg p-2.5"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    <div className="min-w-0">
                      <div className="text-sm text-slate-200 font-mono truncate">
                        {r.repoOwner}/{r.repoName}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                        <RoleChip role={r.role} /> · {r.defaultBranch} · <StatusChip status={r.status} />
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => reindex.mutate(r.id)} disabled={reindex.isPending} title="Queue for indexing">
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { if (window.confirm(`Unlink ${r.repoOwner}/${r.repoName}?`)) unlink.mutate(r.id); }}
                        disabled={unlink.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add form */}
            <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-white/5">
              <FieldlessInput value={owner} onChange={setOwner} placeholder="owner" className="w-28" />
              <span className="text-slate-500 pb-2">/</span>
              <FieldlessInput value={name} onChange={setName} placeholder="repo" className="w-32" />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as RepoRole)}
                className="bg-slate-900/60 border border-slate-700 rounded-md px-2 py-2 text-xs text-white"
              >
                <option value="FRONTEND">Frontend</option>
                <option value="BACKEND">Backend</option>
                <option value="INFRA">Infra</option>
                <option value="OTHER">Other</option>
              </select>
              <FieldlessInput value={branch} onChange={setBranch} placeholder="main" className="w-24" />
              <Button size="sm" onClick={() => link.mutate()} loading={link.isPending} disabled={!owner.trim() || !name.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Link
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FieldlessInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-slate-900/60 border border-slate-700 rounded-md px-2.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500 ${className ?? ''}`}
    />
  );
}

function RoleChip({ role }: { role: RepoRole }) {
  return <span className="uppercase tracking-wide">{role.toLowerCase()}</span>;
}

const STATUS_LABEL: Record<RepoIndexStatus, string> = {
  PENDING: 'not indexed',
  INDEXING: 'indexing…',
  READY: 'indexed',
  FAILED: 'index failed',
};
function StatusChip({ status }: { status: RepoIndexStatus }) {
  return <span>{STATUS_LABEL[status]}</span>;
}

function errMsg(e: unknown): string | undefined {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' ? m : undefined;
}
