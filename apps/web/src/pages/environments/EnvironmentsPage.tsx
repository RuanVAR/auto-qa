import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  Copy,
  ExternalLink,
  GitCommit,
  Globe,
  GripVertical,
  History,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { EnvCredentialsManager } from './EnvCredentialsManager';
import {
  API_BASE,
  environmentsApi,
  type EnvironmentRelease,
  type EnvironmentReleaseSource,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { toast } from '@/components/ui/Toast';

const ENV_TYPES = ['LOCAL','STAGING','PRODUCTION','INTERNAL','CUSTOM'];

interface Environment {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  description?: string | null;
  embedAllowed: boolean;
  supportsAutomation: boolean;
  order: number;
  isActive: boolean;
  variables?: Record<string, string> | null;
  slowMoMs?: number | null;
  currentRelease?: EnvironmentRelease | null;
}

/**
 * Tells the editor whether to mask a value as a secret. Matches the
 * server-side rule (environments.service.ts:8) so what the UI flags as a
 * secret is exactly what the API masks on read.
 */
const SECRET_KEY_PATTERN = /password|secret|token|key|auth|credential/i;

export function EnvironmentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [formMode, setFormMode] = useState<{ kind: 'create' } | { kind: 'edit'; env: Environment } | null>(null);
  const [releaseEnv, setReleaseEnv] = useState<Environment | null>(null);
  const [showDeploymentSetup, setShowDeploymentSetup] = useState(false);

  const { data: envs = [], isLoading } = useQuery<Environment[]>({
    queryKey: ['environments', projectId, { includeArchived: showArchived }],
    queryFn: () => environmentsApi.list(projectId!, { includeArchived: showArchived }),
    enabled: !!projectId,
  });

  const reorder = useMutation({
    mutationFn: ({ id, newOrder }: { id: string; newOrder: number }) =>
      environmentsApi.update(projectId!, id, { order: newOrder }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['environments', projectId] }),
  });

  const archive = useMutation({
    mutationFn: (id: string) => environmentsApi.archive(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['environments', projectId] });
      toast.success('Environment archived');
    },
    onError: () => toast.error('Archive failed'),
  });

  const restore = useMutation({
    mutationFn: (id: string) => environmentsApi.restore(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['environments', projectId] });
      toast.success('Environment restored');
    },
    onError: () => toast.error('Restore failed'),
  });

  if (isLoading) return <PageSpinner />;

  const typeVariant = (t: string) =>
    ({ LOCAL: 'muted', STAGING: 'info', PRODUCTION: 'warning', INTERNAL: 'default', CUSTOM: 'muted' } as Record<string, 'muted' | 'info' | 'warning' | 'default'>)[t] ?? 'default';

  const active = envs.filter(e => e.isActive);
  const archived = envs.filter(e => !e.isActive);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/projects/${projectId}`)}
            className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <ChevronLeft size={16} /> Back
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">Environments</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {active.length} active{showArchived && archived.length > 0 ? `, ${archived.length} archived` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.65)' }}>
            <input
              type="checkbox"
              checked={showArchived}
              onChange={e => setShowArchived(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300"
            />
            Show archived
          </label>
          <Button variant="secondary" onClick={() => setShowDeploymentSetup(true)}>
            <KeyRound size={14} /> CI setup
          </Button>
          <Button onClick={() => setFormMode({ kind: 'create' })}><Plus size={14} /> New Environment</Button>
        </div>
      </div>

      <Card>
        {active.length === 0 && archived.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Globe}
              title="No environments yet"
              description="Add an environment to run tests against. The Base URL is used by automated and manual tests."
              action={<Button onClick={() => setFormMode({ kind: 'create' })}><Plus size={14} /> Add</Button>}
            />
          </CardContent>
        ) : (
          <Table cards>
            <Thead>
              <Tr>
                <Th className="w-8" />
                <Th>Order</Th>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Base URL</Th>
                <Th>Version</Th>
                <Th>Iframe</Th>
                <Th>Description</Th>
                <Th className="text-right pr-4">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {active.map((e, idx) => (
                <EnvRow
                  key={e.id}
                  env={e}
                  idx={idx}
                  totalActive={active.length}
                  onReorder={delta => reorder.mutate({ id: e.id, newOrder: e.order + delta })}
                  onEdit={() => setFormMode({ kind: 'edit', env: e })}
                  onRelease={() => setReleaseEnv(e)}
                  onArchive={() => {
                    if (window.confirm(`Archive "${e.name}"? It will stop appearing in test/run pickers but can be restored later.`)) {
                      archive.mutate(e.id);
                    }
                  }}
                  typeVariant={typeVariant}
                />
              ))}
              {showArchived && archived.length > 0 && (
                <Tr>
                  <Td colSpan={9} className="px-4 py-2 text-[10px] uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.40)', background: 'rgba(255,255,255,0.02)' }}>
                    Archived ({archived.length})
                  </Td>
                </Tr>
              )}
              {showArchived && archived.map((e) => (
                <EnvRow
                  key={e.id}
                  env={e}
                  idx={0}
                  totalActive={archived.length}
                  archived
                  onReorder={() => {}}
                  onEdit={() => setFormMode({ kind: 'edit', env: e })}
                  onRelease={() => setReleaseEnv(e)}
                  onArchive={() => restore.mutate(e.id)}
                  typeVariant={typeVariant}
                />
              ))}
            </Tbody>
          </Table>
        )}
      </Card>

      {formMode && (
        <EnvironmentFormModal
          mode={formMode.kind}
          initial={formMode.kind === 'edit' ? formMode.env : undefined}
          onClose={() => setFormMode(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['environments', projectId] });
            setFormMode(null);
          }}
          projectId={projectId!}
        />
      )}
      {releaseEnv && (
        <ReleaseHistoryModal
          projectId={projectId!}
          environment={releaseEnv}
          onClose={() => setReleaseEnv(null)}
        />
      )}
      {showDeploymentSetup && (
        <DeploymentSetupModal
          projectId={projectId!}
          environments={active}
          onClose={() => setShowDeploymentSetup(false)}
        />
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

function EnvRow({
  env,
  idx,
  totalActive,
  archived,
  onReorder,
  onEdit,
  onRelease,
  onArchive,
  typeVariant,
}: {
  env: Environment;
  idx: number;
  totalActive: number;
  archived?: boolean;
  onReorder: (delta: number) => void;
  onEdit: () => void;
  onRelease: () => void;
  onArchive: () => void;
  typeVariant: (t: string) => 'muted' | 'info' | 'warning' | 'default';
}) {
  return (
    <Tr className={archived ? 'opacity-50' : undefined}>
      <Td className="pl-4">
        <GripVertical size={14} style={{ color: 'rgba(238,238,248,0.25)' }} />
      </Td>
      <Td label="Order">
        {archived ? (
          <span className="text-[10px] uppercase" style={{ color: 'rgba(238,238,248,0.45)' }}>—</span>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-xs font-mono w-5 text-center" style={{ color: 'rgba(238,238,248,0.55)' }}>{env.order ?? idx}</span>
            <div className="flex flex-col">
              <button
                disabled={idx === 0}
                onClick={() => onReorder(-1)}
                className="text-[10px] leading-none px-0.5 disabled:opacity-20 hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(238,238,248,0.50)' }}
                title="Move up"
              >▲</button>
              <button
                disabled={idx === totalActive - 1}
                onClick={() => onReorder(1)}
                className="text-[10px] leading-none px-0.5 disabled:opacity-20 hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(238,238,248,0.50)' }}
                title="Move down"
              >▼</button>
            </div>
          </div>
        )}
      </Td>
      <Td label="Name">
        <span className="font-medium" style={{ color: 'rgba(238,238,248,0.88)' }}>{env.name}</span>
        {archived && <Badge variant="muted" className="ml-2">Archived</Badge>}
      </Td>
      <Td label="Type"><Badge variant={typeVariant(env.type)}>{env.type}</Badge></Td>
      <Td label="Base URL"><span className="font-mono text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>{env.baseUrl}</span></Td>
      <Td label="Version">
        <button
          type="button"
          onClick={onRelease}
          className="group text-left"
          title="View deployment history"
        >
          {env.currentRelease ? (
            <>
              <span className="block font-mono text-xs font-semibold text-gray-800 group-hover:text-sky-600 dark:text-slate-100 dark:group-hover:text-sky-300">
                {env.currentRelease.version}
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-400">
                <GitCommit size={10} />
                {sourceLabel(env.currentRelease.source)}
              </span>
            </>
          ) : (
            <span className="text-xs text-gray-400">Not published</span>
          )}
        </button>
      </Td>
      <Td label="Iframe">
        {env.embedAllowed
          ? <Badge variant="default">Embedded</Badge>
          : <Badge variant="muted">New tab</Badge>}
      </Td>
      <Td label="Description"><span className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>{env.description ?? '—'}</span></Td>
      <Td label="Actions" className="text-right pr-4">
        <div className="inline-flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit} title="Edit"><Pencil size={12} /></Button>
          {archived ? (
            <Button size="sm" variant="ghost" onClick={onArchive} title="Restore"><ArchiveRestore size={12} /></Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onArchive} title="Archive"><Archive size={12} /></Button>
          )}
        </div>
      </Td>
    </Tr>
  );
}

function ReleaseHistoryModal({
  projectId,
  environment,
  onClose,
}: {
  projectId: string;
  environment: Environment;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const releases = useQuery({
    queryKey: ['environment-releases', projectId, environment.id],
    queryFn: () => environmentsApi.listReleases(projectId, environment.id),
  });
  const infer = useMutation({
    mutationFn: () => environmentsApi.inferRelease(projectId, environment.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['environment-releases', projectId, environment.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['environments', projectId] });
      toast.success('Environment version refreshed');
    },
    onError: (error: unknown) => toast.error(
      'Version refresh failed',
      apiError(error),
    ),
  });

  return (
    <Modal open onClose={onClose} title={`${environment.name} releases`} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-mono text-lg font-semibold text-white">
              {environment.currentRelease?.version ?? 'No release'}
            </div>
            {environment.currentRelease && (
              <div className="mt-1 text-xs text-slate-400">
                {sourceLabel(environment.currentRelease.source)} ·{' '}
                {formatDistanceToNow(new Date(environment.currentRelease.deployedAt), {
                  addSuffix: true,
                })}
              </div>
            )}
          </div>
          <Button
            variant="secondary"
            size="sm"
            loading={infer.isPending}
            onClick={() => infer.mutate()}
          >
            <RefreshCw size={13} />
            Refresh from repository
          </Button>
        </div>

        {releases.isLoading ? (
          <PageSpinner />
        ) : releases.data?.length ? (
          <div className="divide-y divide-white/10 border border-white/10">
            {releases.data.map((release) => (
              <ReleaseRow key={release.id} release={release} />
            ))}
          </div>
        ) : (
          <div className="border border-white/10 px-4 py-8 text-center text-sm text-slate-400">
            No deployment has been published for this environment.
          </div>
        )}
      </div>
    </Modal>
  );
}

function ReleaseRow({ release }: { release: EnvironmentRelease }) {
  const statusVariant = {
    SUCCESS: 'success',
    FAILED: 'danger',
    PENDING: 'warning',
    ROLLED_BACK: 'muted',
  } as const;
  return (
    <details className="group px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-3">
        <History size={14} className="shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-slate-100">
              {release.version}
            </span>
            <Badge variant={statusVariant[release.status]}>{release.status}</Badge>
            <Badge variant={release.source === 'REPO_INFERRED' ? 'warning' : 'info'}>
              {sourceLabel(release.source)}
            </Badge>
            {release.differsFromIndex && <Badge variant="warning">Index differs</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>{new Date(release.deployedAt).toLocaleString()}</span>
            {release.commitSha && <span className="font-mono">{release.commitSha.slice(0, 12)}</span>}
          </div>
        </div>
        {release.pipelineUrl && (
          <a
            href={release.pipelineUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-slate-400 hover:text-sky-300"
            title="Open deployment pipeline"
          >
            <ExternalLink size={14} />
          </a>
        )}
      </summary>
      <div className="mt-3 space-y-2 pl-7">
        {release.components.length > 0 ? release.components.map((component) => (
          <div
            key={component.id}
            className="grid gap-2 border border-white/10 px-3 py-2 text-xs sm:grid-cols-[minmax(7rem,1fr)_minmax(6rem,1fr)_auto]"
          >
            <div>
              <div className="font-medium text-slate-200">{component.componentName}</div>
              {component.projectRepo && (
                <div className="mt-0.5 font-mono text-slate-500">
                  {component.projectRepo.repoOwner}/{component.projectRepo.repoName}
                </div>
              )}
            </div>
            <div>
              <div className="font-mono text-slate-200">{component.version ?? 'Version not supplied'}</div>
              {component.manifestPath && (
                <div className="mt-0.5 truncate text-slate-500">{component.manifestPath}</div>
              )}
            </div>
            <div className="text-right">
              {component.commitSha && (
                <div className="font-mono text-slate-300">{component.commitSha.slice(0, 12)}</div>
              )}
              {component.differsFromIndex && (
                <div className="mt-0.5 text-amber-300">Branch index differs</div>
              )}
            </div>
          </div>
        )) : (
          <div className="text-xs text-slate-500">No component metadata supplied.</div>
        )}
      </div>
    </details>
  );
}

function DeploymentSetupModal({
  projectId,
  environments,
  onClose,
}: {
  projectId: string;
  environments: Environment[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('GitHub Actions');
  const [environmentId, setEnvironmentId] = useState('');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const tokens = useQuery({
    queryKey: ['deploy-tokens', projectId],
    queryFn: () => environmentsApi.listDeployTokens(projectId),
  });
  const issue = useMutation({
    mutationFn: () => environmentsApi.issueDeployToken(projectId, {
      name,
      allowedEnvironmentIds: environmentId ? [environmentId] : [],
    }),
    onSuccess: (result) => {
      setIssuedToken(result.token);
      void queryClient.invalidateQueries({ queryKey: ['deploy-tokens', projectId] });
      toast.success('Deployment token created');
    },
    onError: (error: unknown) => toast.error('Token creation failed', apiError(error)),
  });
  const revoke = useMutation({
    mutationFn: (tokenId: string) => environmentsApi.revokeDeployToken(projectId, tokenId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deploy-tokens', projectId] });
      toast.success('Deployment token revoked');
    },
    onError: (error: unknown) => toast.error('Token revocation failed', apiError(error)),
  });
  const endpoint = environmentId
    ? `${API_BASE}/api/v1/projects/${projectId}/environments/${environmentId}/deployments`
    : null;

  return (
    <Modal open onClose={onClose} title="CI deployment setup" size="lg">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-400">Token name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={releaseInputClass} />
          </label>
          <label className="space-y-1">
            <span className="block text-xs font-medium text-slate-400">Environment scope</span>
            <select
              value={environmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
              className={releaseInputClass}
            >
              <option value="">All environments</option>
              {environments.map((environment) => (
                <option key={environment.id} value={environment.id}>{environment.name}</option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={!name.trim()}
            loading={issue.isPending}
            onClick={() => issue.mutate()}
          >
            <Plus size={13} />
            Create token
          </Button>
        </div>

        {issuedToken && (
          <div className="border border-emerald-700 bg-emerald-950/30 p-3">
            <div className="text-xs font-medium text-emerald-300">New token</div>
            <code className="mt-2 block break-all text-xs text-emerald-100">{issuedToken}</code>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              aria-label="Copy deployment token"
              title="Copy deployment token"
              onClick={() => {
                void navigator.clipboard.writeText(issuedToken);
                toast.success('Token copied');
              }}
            >
              <Copy size={13} />
            </Button>
          </div>
        )}

        {endpoint && (
          <div className="border border-white/10 p-3">
            <div className="text-xs font-medium text-slate-400">Deployment endpoint</div>
            <code className="mt-2 block break-all text-xs text-slate-200">{endpoint}</code>
          </div>
        )}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase text-slate-400">Active tokens</h3>
          <div className="divide-y divide-white/10 border border-white/10">
            {(tokens.data ?? []).map((token) => (
              <div key={token.id} className="flex items-center gap-3 px-3 py-2">
                <KeyRound size={13} className="text-slate-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-200">{token.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-slate-500">{token.prefix}</div>
                </div>
                <Badge variant={token.status === 'active' ? 'success' : 'muted'}>{token.status}</Badge>
                {token.status === 'active' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Revoke deployment token"
                    onClick={() => revoke.mutate(token.id)}
                  >
                    <Trash2 size={13} />
                  </Button>
                )}
              </div>
            ))}
            {!tokens.isLoading && (tokens.data?.length ?? 0) === 0 && (
              <div className="px-3 py-5 text-center text-sm text-slate-500">No deployment tokens.</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function sourceLabel(source: EnvironmentReleaseSource): string {
  const labels: Record<EnvironmentReleaseSource, string> = {
    CI_API: 'CI verified',
    GITHUB_DEPLOYMENT: 'GitHub deployment',
    REPO_INFERRED: 'Repository inferred',
    MANUAL: 'Manual',
  };
  return labels[source];
}

function apiError(error: unknown): string | undefined {
  const message = (error as { response?: { data?: { message?: string } } })
    ?.response?.data?.message;
  return typeof message === 'string' ? message : undefined;
}

const releaseInputClass =
  'w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500';

// ── Modal (create + edit) ──────────────────────────────────────────────────

function EnvironmentFormModal({
  mode,
  initial,
  projectId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Environment;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'STAGING');
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '');
  const [desc, setDesc] = useState(initial?.description ?? '');
  const [embedAllowed, setEmbedAllowed] = useState(initial?.embedAllowed ?? true);
  const [supportsAutomation, setSupportsAutomation] = useState(initial?.supportsAutomation ?? false);
  const [order, setOrder] = useState(initial?.order ?? 0);
  const [slowMoMs, setSlowMoMs] = useState(initial?.slowMoMs ?? 0);
  // Variables — referenced inside step inputs as {{KEY}}. The API masks
  // values whose key matches /password|secret|token|.../i on read, so a
  // freshly opened edit modal shows '••••••••' for secrets — re-enter the
  // value to update it. We don't send rows whose value is still the
  // masked placeholder (preserves existing secret on partial save).
  const [vars, setVars] = useState<Array<{ key: string; value: string }>>(
    initial?.variables
      ? Object.entries(initial.variables).map(([k, v]) => ({ key: k, value: String(v) }))
      : [],
  );

  // Re-sync form fields if `initial` changes (rare — happens if user clicks
  // edit on a different row without closing the modal first).
  useEffect(() => {
    if (initial) {
      setName(initial.name);
      setType(initial.type);
      setBaseUrl(initial.baseUrl);
      setDesc(initial.description ?? '');
      setEmbedAllowed(initial.embedAllowed);
      setSupportsAutomation(initial.supportsAutomation ?? false);
      setOrder(initial.order);
      setSlowMoMs(initial.slowMoMs ?? 0);
      setVars(
        initial.variables
          ? Object.entries(initial.variables).map(([k, v]) => ({ key: k, value: String(v) }))
          : [],
      );
    }
  }, [initial]);

  const save = useMutation({
    mutationFn: () => {
      // Drop empty rows + rows where the user left a masked secret untouched.
      const variables: Record<string, string> = {};
      for (const { key, value } of vars) {
        const k = key.trim();
        if (!k) continue;
        if (SECRET_KEY_PATTERN.test(k) && value === '••••••••') continue;
        variables[k] = value;
      }
      // slowMoMs is not on the env DTO / Prisma model (only an orphaned DB
      // column), so the API already silently dropped it — sending it now 400s
      // under forbidNonWhitelisted. Omit it; the slow-mo input is currently
      // unwired end-to-end (separate follow-up to wire or remove it).
      const payload = { name, type, baseUrl, description: desc, embedAllowed, supportsAutomation, order, variables };
      return mode === 'edit' && initial
        ? environmentsApi.update(projectId, initial.id, payload)
        : environmentsApi.create(projectId, payload);
    },
    onSuccess: () => {
      toast.success(mode === 'edit' ? 'Environment updated' : 'Environment created');
      onSaved();
    },
    onError: () => toast.error(mode === 'edit' ? 'Update failed' : 'Create failed'),
  });

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? `Edit ${initial?.name ?? 'Environment'}` : 'New Environment'}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="Staging"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Type</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            {ENV_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="https://staging.example.com"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
          />
          <p className="text-xs text-gray-400 mt-1">
            Used as the target URL for all automated runs and manual test previews against this environment.
          </p>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <input
            id="embedAllowed"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            checked={embedAllowed}
            onChange={e => setEmbedAllowed(e.target.checked)}
          />
          <label htmlFor="embedAllowed" className="text-sm text-gray-700 cursor-pointer">
            <span className="font-medium">Allow iframe embedding</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Enable if the app allows embedding (no <code className="font-mono">X-Frame-Options: DENY</code>).
              Disable to open the app in a new tab during manual testing instead.
            </span>
          </label>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
          <input
            id="supportsAutomation"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
            checked={supportsAutomation}
            onChange={e => setSupportsAutomation(e.target.checked)}
          />
          <label htmlFor="supportsAutomation" className="text-sm text-gray-700 cursor-pointer">
            <span className="font-medium">Supports automation</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Mark this environment as a valid target for automated (Playwright) runs. Automated
              tests and previews are blocked unless their target environment has this enabled.
            </span>
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Description <span className="font-normal text-gray-400">(optional)</span></label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="e.g. Shared staging server, resets nightly"
            value={desc ?? ''}
            onChange={e => setDesc(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Display order <span className="font-normal text-gray-400">(0 = first)</span>
            </label>
            <input
              type="number"
              min={0}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={order}
              onChange={e => setOrder(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Playwright slow-mo (ms) <span className="font-normal text-gray-400">(0 = full speed)</span>
            </label>
            <input
              type="number"
              min={0}
              max={2000}
              step={50}
              placeholder="0"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              value={slowMoMs}
              onChange={e => setSlowMoMs(Number(e.target.value))}
            />
            <p className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.40)' }}>
              Pause this many ms between every Playwright action — useful for visual debugging on Local. Leave 0 for UAT/Prod.
            </p>
          </div>
        </div>

        {/* Variables editor — referenced from step inputs as {{KEY}} */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.65)' }}>
              Variables <span className="font-normal" style={{ color: 'rgba(238,238,248,0.40)' }}>— reference as <code className="font-mono">{'{{KEY}}'}</code> in any step</span>
            </label>
            <button
              type="button"
              onClick={() => setVars(v => [...v, { key: '', value: '' }])}
              className="text-xs px-2 py-1 rounded-md flex items-center gap-1"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.80)' }}
            >
              + Add
            </button>
          </div>
          {vars.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              No variables. Add one (e.g. <code className="font-mono">ADMIN_EMAIL</code>) to use it across all tests run against this env.
            </p>
          ) : (
            <div className="space-y-1.5">
              {vars.map((row, i) => {
                const isSecret = SECRET_KEY_PATTERN.test(row.key);
                return (
                  <div key={i} className="flex gap-1.5">
                    <input
                      placeholder="KEY"
                      value={row.key}
                      onChange={e => setVars(v => v.map((r, j) => j === i ? { ...r, key: e.target.value } : r))}
                      className="flex-1 rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.85)' }}
                    />
                    <input
                      placeholder={isSecret ? '(secret — will be masked on read)' : 'value'}
                      value={row.value}
                      type={isSecret && row.value === '••••••••' ? 'text' : isSecret ? 'password' : 'text'}
                      onChange={e => setVars(v => v.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                      className="flex-[2] rounded-md px-2 py-1.5 text-xs font-mono focus:outline-none"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.85)' }}
                    />
                    <button
                      type="button"
                      onClick={() => setVars(v => v.filter((_, j) => j !== i))}
                      className="px-2 rounded-md text-xs"
                      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}
                      title="Remove"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              <p className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.40)' }}>
                Keys matching <code className="font-mono">password / secret / token / key / auth / credential</code> are masked when this env is read back from the API. Re-enter the value to update; leave masked to preserve.
              </p>
            </div>
          )}
        </div>

        {/* Encrypted per-env login credentials (Phase 5c). Only on an existing
            env — a credential needs an env id to attach to. */}
        {mode === 'edit' && initial?.id && (
          <EnvCredentialsManager projectId={projectId} envId={initial.id} />
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} disabled={!name || !baseUrl} onClick={() => save.mutate()}>
            {mode === 'edit' ? 'Save Changes' : 'Add Environment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
