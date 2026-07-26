import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleOff,
  Github,
  GitBranch,
  KeyRound,
  Loader2,
  Plus,
  Copy,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  environmentsApi,
  githubApi,
  type GitHubRepositoryOption,
  type ProjectRepo,
  type ProjectRepoIndex,
  type RepoEnvBinding,
  type RepoIndexStatus,
  type RepoRole,
} from '@/lib/api';
import { useRepoIndexSocket } from '@/hooks/useRepoIndexSocket';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

interface ProjectEnvironment {
  id: string;
  name: string;
  type: string;
}

type VersionSource = 'AUTO' | 'CI_ONLY' | 'MANIFEST';
type VersionFormat = 'AUTO' | 'JSON' | 'TOML' | 'YAML' | 'XML' | 'PROPERTIES' | 'TEXT';

interface BindingDraft {
  branch: string;
  versionSource: VersionSource;
  versionFilePath: string;
  versionFileFormat: VersionFormat;
  versionSelector: string;
  componentName: string;
}

export function ProjectReposPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const linkedRepoId = new URLSearchParams(window.location.search).get('repo');
  const [expandedRepoId, setExpandedRepoId] = useState<string | null>(linkedRepoId);
  useRepoIndexSocket(projectId);

  const credentialQuery = useQuery({
    queryKey: ['git-credential', orgId],
    queryFn: () => githubApi.getCredential(orgId!),
    enabled: Boolean(orgId),
    staleTime: 30_000,
  });
  const repositoriesQuery = useQuery({
    queryKey: ['project-repos', projectId],
    queryFn: () => githubApi.listRepos(projectId),
  });
  const environmentsQuery = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId) as Promise<ProjectEnvironment[]>,
  });

  const availableRepositoriesQuery = useQuery({
    queryKey: ['available-project-repos', projectId],
    queryFn: () => githubApi.listAvailableRepos(projectId),
    enabled: Boolean(credentialQuery.data),
  });
  const [selectedRepository, setSelectedRepository] = useState('');
  const [role, setRole] = useState<RepoRole>('OTHER');
  const [branch, setBranch] = useState('');
  const availableRepositories = availableRepositoriesQuery.data ?? [];
  const repository = availableRepositories.find(
    (candidate) => candidate.fullName === selectedRepository,
  );

  const linkMutation = useMutation({
    mutationFn: () => githubApi.linkRepo(projectId, {
      repoOwner: repository!.owner,
      repoName: repository!.name,
      role,
      defaultBranch: branch.trim() || undefined,
    }),
    onSuccess: (repo) => {
      void queryClient.invalidateQueries({ queryKey: ['project-repos', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['available-project-repos', projectId] });
      setExpandedRepoId(repo.id);
      setSelectedRepository('');
      setBranch('');
      toast.success('Repository linked');
    },
    onError: (error: unknown) => toast.error('Could not link repository', errMsg(error)),
  });
  const unlinkMutation = useMutation({
    mutationFn: (repoId: string) => githubApi.unlinkRepo(projectId, repoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-repos', projectId] });
      toast.success('Repository unlinked');
    },
    onError: (error: unknown) => toast.error('Unlink failed', errMsg(error)),
  });
  const linkedRepositoryLoaded = repositoriesQuery.data
    ?.some((repo) => repo.id === linkedRepoId) ?? false;

  useEffect(() => {
    if (!linkedRepoId || !linkedRepositoryLoaded) return;
    const target = document.getElementById(`repo-index-${linkedRepoId}`);
    target?.scrollIntoView({ block: 'center' });
  }, [linkedRepoId, linkedRepositoryLoaded]);

  const repositories = repositoriesQuery.data ?? [];
  const hasCredential = Boolean(credentialQuery.data);

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Github className="w-4 h-4 text-sky-500" />
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
            Code repositories
          </h4>
        </div>

        {!hasCredential ? (
          <div className="flex items-center justify-between gap-3 border border-amber-300 bg-amber-50 p-3 dark:border-amber-700/60 dark:bg-amber-950/20">
            <span className="text-sm text-amber-900 dark:text-amber-200">
              GitHub is not connected for this organisation.
            </span>
            <Link to="/org/github" className={actionLinkClass}>
              Connect GitHub
            </Link>
          </div>
        ) : (
          <>
            {repositoriesQuery.isLoading ? (
              <LoadingRow label="Loading repositories" />
            ) : repositories.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-slate-400">
                No repositories linked.
              </p>
            ) : (
              <div className="divide-y divide-gray-200 border border-gray-200 dark:divide-white/10 dark:border-white/10">
                {repositories.map((repo) => (
                  <RepositoryRow
                    key={repo.id}
                    projectId={projectId}
                    repo={repo}
                    environments={environmentsQuery.data ?? []}
                    expanded={expandedRepoId === repo.id}
                    onToggle={() => setExpandedRepoId((current) => current === repo.id ? null : repo.id)}
                    onUnlink={() => {
                      if (window.confirm(`Unlink ${repo.repoOwner}/${repo.repoName}?`)) {
                        unlinkMutation.mutate(repo.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 border-t border-gray-200 pt-4 dark:border-white/10">
              <div className="min-w-64 flex-1 space-y-1">
                <label>
                  <span className="block text-xs font-medium text-gray-500 dark:text-slate-400">
                    Repository
                  </span>
                  <select
                    aria-label="Repository"
                    value={selectedRepository}
                    onChange={(event) => {
                      const fullName = event.target.value;
                      const selected = availableRepositories.find(
                        (candidate) => candidate.fullName === fullName,
                      );
                      setSelectedRepository(fullName);
                      setBranch(selected?.defaultBranch ?? '');
                    }}
                    disabled={
                      availableRepositoriesQuery.isLoading
                      || availableRepositoriesQuery.isError
                    }
                    className={`${selectClass} mt-1 w-full`}
                  >
                    <option value="">
                      {availableRepositoriesQuery.isLoading
                        ? 'Loading repositories…'
                        : availableRepositoriesQuery.isError
                          ? 'Could not load repositories'
                          : availableRepositories.length === 0
                            ? 'No additional repositories available'
                            : 'Choose repository…'}
                    </option>
                    {availableRepositories.map((candidate) => (
                      <option
                        key={candidate.fullName}
                        value={candidate.fullName}
                        disabled={candidate.archived}
                      >
                        {repositoryLabel(candidate)}
                      </option>
                    ))}
                  </select>
                </label>
                {availableRepositoriesQuery.isError && (
                  <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-300">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>GitHub repository discovery failed.</span>
                    <button
                      type="button"
                      onClick={() => void availableRepositoriesQuery.refetch()}
                      className="font-medium underline underline-offset-2"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
              <label className="space-y-1">
                <span className="block text-xs font-medium text-gray-500 dark:text-slate-400">Role</span>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as RepoRole)}
                  className={selectClass}
                >
                  <option value="FRONTEND">Frontend</option>
                  <option value="BACKEND">Backend</option>
                  <option value="INFRA">Infrastructure</option>
                  <option value="OTHER">Other</option>
                </select>
              </label>
              <LabeledInput
                label="Default branch"
                value={branch}
                onChange={setBranch}
                placeholder="main"
                className="w-28"
              />
              <Button
                size="sm"
                onClick={() => linkMutation.mutate()}
                loading={linkMutation.isPending}
                disabled={!repository}
              >
                <Plus className="w-3.5 h-3.5" />
                Link
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function repositoryLabel(repository: GitHubRepositoryOption): string {
  const qualifiers = [
    repository.private ? 'private' : 'public',
    repository.archived ? 'archived' : null,
  ].filter(Boolean);
  return `${repository.fullName} (${qualifiers.join(', ')})`;
}

function RepositoryRow({
  projectId,
  repo,
  environments,
  expanded,
  onToggle,
  onUnlink,
}: {
  projectId: string;
  repo: ProjectRepo;
  environments: ProjectEnvironment[];
  expanded: boolean;
  onToggle: () => void;
  onUnlink: () => void;
}) {
  return (
    <section id={`repo-index-${repo.id}`} className="scroll-mt-24">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center text-gray-500 hover:text-gray-900 dark:text-slate-400 dark:hover:text-white"
          aria-label={expanded ? 'Collapse repository' : 'Expand repository'}
          title={expanded ? 'Collapse repository' : 'Expand repository'}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-sm font-medium text-gray-900 dark:text-slate-100">
            {repo.repoOwner}/{repo.repoName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
            <span className="uppercase">{repo.role.toLowerCase()}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <GitBranch size={12} />
              {repo.defaultBranch}
            </span>
            <StatusChip status={repo.status} />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onUnlink}
          title="Unlink repository"
          aria-label={`Unlink ${repo.repoOwner}/${repo.repoName}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
      {expanded && (
        <RepositoryDetails
          projectId={projectId}
          repo={repo}
          environments={environments}
        />
      )}
    </section>
  );
}

function RepositoryDetails({
  projectId,
  repo,
  environments,
}: {
  projectId: string;
  repo: ProjectRepo;
  environments: ProjectEnvironment[];
}) {
  const queryClient = useQueryClient();
  const branchesQuery = useQuery({
    queryKey: ['repo-branches', projectId, repo.id],
    queryFn: () => githubApi.listBranches(projectId, repo.id),
    staleTime: 60_000,
  });
  const bindingsQuery = useQuery({
    queryKey: ['repo-env-bindings', projectId, repo.id],
    queryFn: () => githubApi.listEnvBindings(projectId, repo.id),
  });
  const indexesQuery = useQuery({
    queryKey: ['repo-indexes', projectId, repo.id],
    queryFn: () => githubApi.listIndexes(projectId, repo.id),
    refetchInterval: 10_000,
  });
  const [draftBindings, setDraftBindings] = useState<Record<string, BindingDraft>>({});
  const [webhookSetup, setWebhookSetup] = useState<{
    secret: string;
    endpoint: string;
  } | null>(null);

  useEffect(() => {
    setDraftBindings(Object.fromEntries(
      (bindingsQuery.data ?? []).map((binding) => [
        binding.environmentId,
        bindingToDraft(binding),
      ]),
    ));
  }, [bindingsQuery.data]);

  const originalBindings = useMemo(
    () => Object.fromEntries((bindingsQuery.data ?? []).map((binding) => [
      binding.environmentId,
      bindingToDraft(binding),
    ])),
    [bindingsQuery.data],
  );
  const bindingsChanged = JSON.stringify(draftBindings) !== JSON.stringify(originalBindings);

  const saveBindingsMutation = useMutation({
    mutationFn: () => githubApi.replaceEnvBindings(
      projectId,
      repo.id,
      environments.flatMap((environment) => {
        const selected = draftBindings[environment.id];
        return selected?.branch
          ? [{
              environmentId: environment.id,
              branch: selected.branch,
              versionSource: selected.versionSource,
              versionFilePath: selected.versionFilePath || undefined,
              versionFileFormat: selected.versionFileFormat,
              versionSelector: selected.versionSelector || undefined,
              componentName: selected.componentName || undefined,
            }]
          : [];
      }),
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['repo-env-bindings', projectId, repo.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['repo-indexes', projectId, repo.id],
      });
      toast.success('Branch bindings saved');
    },
    onError: (error: unknown) => toast.error('Could not save bindings', errMsg(error)),
  });
  const reindexMutation = useMutation({
    mutationFn: (indexId?: string) => indexId
      ? githubApi.reindexBranch(projectId, repo.id, indexId)
      : githubApi.reindexRepo(projectId, repo.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['repo-indexes', projectId, repo.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['project-repos', projectId] });
      toast.success('Index refresh queued');
    },
    onError: (error: unknown) => toast.error('Could not queue refresh', errMsg(error)),
  });
  const webhookMutation = useMutation({
    mutationFn: () => githubApi.rotateDeploymentWebhook(projectId, repo.id),
    onSuccess: (result) => {
      setWebhookSetup(result);
      toast.success('Deployment webhook secret rotated');
    },
    onError: (error: unknown) => toast.error('Could not rotate webhook secret', errMsg(error)),
  });

  const indexes = indexesQuery.data ?? [];
  const branches = branchesQuery.data ?? [];

  return (
    <div className="space-y-5 border-t border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-black/10">
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h5 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            Environment branches
          </h5>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={webhookMutation.isPending}
              onClick={() => webhookMutation.mutate()}
              title="Rotate GitHub deployment webhook"
            >
              <KeyRound size={13} />
              Webhook
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!bindingsChanged || branchesQuery.isLoading}
              loading={saveBindingsMutation.isPending}
              onClick={() => saveBindingsMutation.mutate()}
            >
              <Save size={13} />
              Save
            </Button>
          </div>
        </div>
        {webhookSetup && (
          <div className="mb-3 grid gap-2 border border-emerald-300 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950/20">
            <CopyValue label="Endpoint" value={webhookSetup.endpoint} />
            <CopyValue label="Secret" value={webhookSetup.secret} />
          </div>
        )}
        {environments.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No project environments configured.
          </p>
        ) : branchesQuery.isLoading ? (
          <LoadingRow label="Loading branches" />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {environments.map((environment) => (
              <div
                key={environment.id}
                className="space-y-3 border border-gray-200 bg-white px-3 py-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-800 dark:text-slate-200">
                      {environment.name}
                    </span>
                    <span className="block text-xs uppercase text-gray-400">
                      {environment.type.toLowerCase()}
                    </span>
                  </span>
                  <select
                    aria-label={`${environment.name} branch`}
                    value={draftBindings[environment.id]?.branch ?? ''}
                    onChange={(event) => setDraftBindings((current) => ({
                      ...current,
                      [environment.id]: {
                        ...(current[environment.id] ?? emptyBinding()),
                        branch: event.target.value,
                      },
                    }))}
                    className={`${selectClass} min-w-0 max-w-44`}
                  >
                    <option value="">Not bound</option>
                    {branches.map((branchOption) => (
                      <option key={branchOption.name} value={branchOption.name}>
                        {branchOption.name}
                      </option>
                    ))}
                  </select>
                </div>
                {draftBindings[environment.id]?.branch && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1">
                      <span className="block text-xs text-gray-500 dark:text-slate-400">Version source</span>
                      <select
                        value={draftBindings[environment.id]?.versionSource ?? 'AUTO'}
                        onChange={(event) => updateBinding(
                          setDraftBindings,
                          environment.id,
                          { versionSource: event.target.value as VersionSource },
                        )}
                        className={`${selectClass} w-full`}
                      >
                        <option value="AUTO">Auto detect</option>
                        <option value="CI_ONLY">CI only</option>
                        <option value="MANIFEST">Manifest path</option>
                      </select>
                    </label>
                    <LabeledInput
                      label="Component"
                      value={draftBindings[environment.id]?.componentName ?? ''}
                      onChange={(value) => updateBinding(
                        setDraftBindings,
                        environment.id,
                        { componentName: value },
                      )}
                      placeholder={repo.role === 'FRONTEND' ? 'Frontend' : repo.role === 'BACKEND' ? 'Backend' : repo.repoName}
                    />
                    {draftBindings[environment.id]?.versionSource === 'MANIFEST' && (
                      <>
                        <LabeledInput
                          label="Manifest path"
                          value={draftBindings[environment.id]?.versionFilePath ?? ''}
                          onChange={(value) => updateBinding(
                            setDraftBindings,
                            environment.id,
                            { versionFilePath: value },
                          )}
                          placeholder="apps/api/pyproject.toml"
                        />
                        <label className="space-y-1">
                          <span className="block text-xs text-gray-500 dark:text-slate-400">Format</span>
                          <select
                            value={draftBindings[environment.id]?.versionFileFormat ?? 'AUTO'}
                            onChange={(event) => updateBinding(
                              setDraftBindings,
                              environment.id,
                              { versionFileFormat: event.target.value as VersionFormat },
                            )}
                            className={`${selectClass} w-full`}
                          >
                            {['AUTO', 'JSON', 'TOML', 'YAML', 'XML', 'PROPERTIES', 'TEXT'].map((format) => (
                              <option key={format} value={format}>{format}</option>
                            ))}
                          </select>
                        </label>
                        <LabeledInput
                          label="Version field"
                          value={draftBindings[environment.id]?.versionSelector ?? ''}
                          onChange={(value) => updateBinding(
                            setDraftBindings,
                            environment.id,
                            { versionSelector: value },
                          )}
                          placeholder="project.version"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h5 className="text-xs font-semibold uppercase text-gray-500 dark:text-slate-400">
            Branch indexes
          </h5>
          {indexes.length === 0 && (
            <Button
              size="sm"
              variant="secondary"
              loading={reindexMutation.isPending}
              onClick={() => reindexMutation.mutate(undefined)}
            >
              <RefreshCw size={13} />
              Sync now
            </Button>
          )}
        </div>
        {indexesQuery.isLoading ? (
          <LoadingRow label="Loading index state" />
        ) : indexes.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">
            No branch indexes created.
          </p>
        ) : (
          <div className="space-y-2">
            {indexes.map((index) => (
              <BranchIndexRow
                key={index.id}
                index={index}
                syncing={reindexMutation.isPending}
                onSync={() => reindexMutation.mutate(index.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BranchIndexRow({
  index,
  syncing,
  onSync,
}: {
  index: ProjectRepoIndex;
  syncing: boolean;
  onSync: () => void;
}) {
  const activeRefresh =
    (index.status === 'INDEXING' || index.status === 'PENDING')
    && index.activeGeneration !== null;
  const busy = index.status === 'INDEXING' || index.status === 'PENDING';
  const files = index.totalFiles === null
    ? `${index.filesProcessed} files`
    : `${index.filesProcessed} / ${index.totalFiles} files`;

  return (
    <div
      id={`repo-index-${index.id}`}
      className="border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 font-mono text-sm font-medium text-gray-900 dark:text-white">
              <GitBranch size={13} />
              {index.branch}
            </span>
            <StatusChip status={index.status} refreshing={activeRefresh} />
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            {stageLabel(index.stage)} · {files} · {index.chunkCount.toLocaleString()} chunks
          </div>
        </div>
        <div className="flex items-center gap-2">
          {index.status === 'BLOCKED' && (
            <Link to="/org/ai-settings" className={actionLinkClass}>
              Configure embeddings
            </Link>
          )}
          {index.status !== 'BLOCKED' && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onSync}
              loading={syncing}
              disabled={busy}
            >
              <RefreshCw size={13} />
              {index.status === 'FAILED' ? 'Retry' : 'Sync now'}
            </Button>
          )}
        </div>
      </div>

      {busy && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-slate-400">
            <span>{stageLabel(index.stage)}</span>
            <span>{index.progressPercent}%</span>
          </div>
          <div className="h-1.5 overflow-hidden bg-gray-200 dark:bg-white/10">
            <div
              className="h-full bg-sky-500 transition-[width] duration-300"
              style={{ width: `${Math.max(0, Math.min(100, index.progressPercent))}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-slate-500">
        {index.commitSha && <span>Commit {index.commitSha.slice(0, 12)}</span>}
        {index.lastIndexedAt && (
          <span>
            Indexed {formatDistanceToNow(new Date(index.lastIndexedAt), { addSuffix: true })}
          </span>
        )}
        {index.lastRequestedAt && !index.lastIndexedAt && (
          <span>
            Requested {formatDistanceToNow(new Date(index.lastRequestedAt), { addSuffix: true })}
          </span>
        )}
      </div>

      {index.error && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium text-red-700 dark:text-red-300">
            Failure details
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-red-700 dark:text-red-300">
            {index.error}
          </p>
        </details>
      )}
    </div>
  );
}

function StatusChip({
  status,
  refreshing = false,
}: {
  status: RepoIndexStatus;
  refreshing?: boolean;
}) {
  const styles: Record<RepoIndexStatus, string> = {
    BLOCKED: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    PENDING: 'border-gray-300 bg-gray-50 text-gray-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300',
    INDEXING: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
    READY: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    FAILED: 'border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/30 dark:text-red-300',
  };
  const labels: Record<RepoIndexStatus, string> = {
    BLOCKED: 'Setup required',
    PENDING: refreshing ? 'Refreshing' : 'Queued',
    INDEXING: refreshing ? 'Refreshing' : 'Indexing',
    READY: 'Ready',
    FAILED: 'Failed',
  };
  const Icon = status === 'READY'
    ? CheckCircle2
    : status === 'FAILED'
      ? AlertCircle
      : status === 'BLOCKED'
        ? CircleOff
        : Loader2;
  return (
    <span className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11px] font-medium ${styles[status]}`}>
      <Icon size={11} className={status === 'PENDING' || status === 'INDEXING' ? 'animate-spin' : ''} />
      {labels[status]}
    </span>
  );
}

function stageLabel(stage: ProjectRepoIndex['stage']): string {
  const labels: Record<ProjectRepoIndex['stage'], string> = {
    QUEUED: 'Queued',
    AUTHENTICATING: 'Authenticating',
    DOWNLOADING: 'Downloading',
    SCANNING: 'Scanning files',
    CHUNKING: 'Chunking source',
    EMBEDDING: 'Generating embeddings',
    SAVING: 'Saving index',
    COMPLETE: 'Complete',
  };
  return labels[stage];
}

function LoadingRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-500 dark:text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${inputClass} ${className ?? ''}`}
      />
    </label>
  );
}

function bindingToDraft(binding: RepoEnvBinding): BindingDraft {
  return {
    branch: binding.branch,
    versionSource: binding.versionSource === 'CI_ONLY' || binding.versionSource === 'MANIFEST'
      ? binding.versionSource
      : 'AUTO',
    versionFilePath: binding.versionFilePath ?? '',
    versionFileFormat: binding.versionFileFormat ?? 'AUTO',
    versionSelector: binding.versionSelector ?? '',
    componentName: binding.componentName ?? '',
  };
}

function emptyBinding(): BindingDraft {
  return {
    branch: '',
    versionSource: 'AUTO',
    versionFilePath: '',
    versionFileFormat: 'AUTO',
    versionSelector: '',
    componentName: '',
  };
}

function updateBinding(
  setter: Dispatch<SetStateAction<Record<string, BindingDraft>>>,
  environmentId: string,
  patch: Partial<BindingDraft>,
) {
  setter((current) => ({
    ...current,
    [environmentId]: {
      ...(current[environmentId] ?? emptyBinding()),
      ...patch,
    },
  }));
}

function CopyValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-16 shrink-0 font-medium text-emerald-900 dark:text-emerald-200">{label}</span>
      <code className="min-w-0 flex-1 break-all text-emerald-900 dark:text-emerald-100">
        {value}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Copy ${label.toLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success(`${label} copied`);
        }}
        title={`Copy ${label.toLowerCase()}`}
      >
        <Copy size={13} />
      </Button>
    </div>
  );
}

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2.5 py-2 text-xs font-mono text-gray-900 placeholder-gray-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900/60 dark:text-white';
const selectClass =
  'rounded-md border border-gray-300 bg-white px-2 py-2 text-xs text-gray-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const actionLinkClass =
  'inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-200 dark:hover:bg-white/10';

function errMsg(error: unknown): string | undefined {
  const message = (
    error as { response?: { data?: { message?: string } } }
  )?.response?.data?.message;
  return typeof message === 'string' ? message : undefined;
}
