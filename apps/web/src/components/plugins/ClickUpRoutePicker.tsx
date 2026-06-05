import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { CascadingSelect } from './CascadingSelect';

/**
 * Inline "no list configured yet" picker. Lets a user choose a ClickUp
 * workspace → space → folder → list and persist it as the default binding for a
 * module (or project) so future tickets route there. Used by the log-issue
 * modal when ClickUp is healthy for the org but the issue's feature/module has
 * no resolved list (the skipped-wizard case). On save it invalidates the
 * routing queries so the caller's "push to ClickUp" affordance lights up.
 */
export function ClickUpRoutePicker({
  orgId,
  installId,
  moduleId,
  projectId,
  onBound,
}: {
  orgId: string;
  installId: string;
  /** Persist at module scope when set; otherwise project scope. */
  moduleId?: string | null;
  projectId: string;
  onBound?: () => void;
}) {
  const qc = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);

  const scopeLabel = moduleId ? 'module' : 'project';
  const targetPath = moduleId ? `modules/${moduleId}` : `projects/${projectId}`;

  // Inherit the project's already-bound workspace/space so the user only picks
  // a list (the flat "space-lists" loader). Falls back to the full cascade
  // when no project space is resolvable.
  const routingPath = moduleId ? `modules/${moduleId}` : `projects/${projectId}`;
  const routingQ = useQuery({
    queryKey: ['clickup-routing', moduleId ? 'module' : 'project', moduleId ?? projectId],
    queryFn: () => api.get<{ workspaceId: string | null; spaceId: string | null }>(
      `/api/v1/${routingPath}/clickup-routing`,
    ).then((r) => r.data),
    staleTime: 60_000,
  });
  const inheritedWorkspaceId = routingQ.data?.workspaceId ?? null;
  const inheritedSpaceId = routingQ.data?.spaceId ?? null;

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/${targetPath}/plugin-bindings`, {
        installId,
        bindingConfig: {
          workspaceId: (inheritedSpaceId ? inheritedWorkspaceId : workspaceId) ?? undefined,
          spaceId: (inheritedSpaceId ?? spaceId) ?? undefined,
          folderId: inheritedSpaceId ? undefined : (folderId ?? undefined),
          defaultListId: listId,
        },
      }).then((r) => r.data),
    onSuccess: () => {
      toast.success('ClickUp list set', `Bugs in this ${scopeLabel} will route here from now on.`);
      // Light up the caller's push affordance + any routing hints.
      qc.invalidateQueries({ queryKey: ['clickup-routing'] });
      qc.invalidateQueries({ queryKey: ['plugin-bindings'] });
      onBound?.();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not set list', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  return (
    <div
      className="rounded-lg border p-3 space-y-2.5"
      style={{ background: 'rgba(251,191,36,0.06)', borderColor: 'rgba(251,191,36,0.25)' }}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#fbbf24' }}>
        <Plug className="w-3.5 h-3.5" /> No ClickUp list set for this {scopeLabel} yet
      </div>
      <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.5)' }}>
        Pick where bugs should be created — we'll route future bugs in this {scopeLabel} there automatically.
      </p>

      {inheritedSpaceId ? (
        <CascadingSelect
          label="List" helpText="Lists from this project's ClickUp space."
          orgId={orgId} installId={installId} kind="space-lists"
          parent={{ spaceId: inheritedSpaceId }} value={listId}
          onChange={(id) => setListId(id)}
        />
      ) : (
        <>
          <CascadingSelect
            label="Workspace" orgId={orgId} installId={installId} kind="workspace"
            value={workspaceId}
            onChange={(id) => { setWorkspaceId(id); setSpaceId(null); setFolderId(null); setListId(null); }}
          />
          <CascadingSelect
            label="Space" orgId={orgId} installId={installId} kind="space"
            parent={{ workspaceId }} value={spaceId}
            onChange={(id) => { setSpaceId(id); setFolderId(null); setListId(null); }}
          />
          <CascadingSelect
            label="Folder" helpText='Choose "(no folder)" for spaces with top-level lists.'
            orgId={orgId} installId={installId} kind="folder"
            parent={{ spaceId }} value={folderId}
            onChange={(id) => { setFolderId(id); setListId(null); }}
          />
          <CascadingSelect
            label="List" orgId={orgId} installId={installId} kind="list"
            parent={{ spaceId, folderId: folderId ?? null }} value={listId}
            onChange={(id) => setListId(id)}
          />
        </>
      )}

      <div className="flex justify-end pt-1">
        <Button size="sm" onClick={() => save.mutate()} disabled={!listId || save.isPending} loading={save.isPending}>
          <Save className="w-3.5 h-3.5 mr-1" /> Set list & route bugs here
        </Button>
      </div>
    </div>
  );
}
