import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw } from 'lucide-react';
import { api, pluginsApi, type PluginInstall } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { CascadingSelect } from './CascadingSelect';

/**
 * ClickUp-specific project binding form.
 *
 * Cascading picker: workspace → space → folder → list. Picking "(no folder)"
 * routes the list query to the folderless endpoint. Subtask mode adds a
 * parent-task autocomplete that reads recent tasks from the chosen list.
 *
 * Capability set is fixed for now (the four read+write capabilities ClickUp
 * offers); a per-binding capability checklist + status mapping grid land in
 * a follow-up so the form fits one screen.
 *
 * The form upserts a single ProjectPluginBinding via the bindings controller.
 * Status mappings + module/feature-scoped overrides ship separately.
 */

type ClickUpBindingConfig = {
  workspaceId?: string;
  spaceId?: string;
  folderId?: string | null;
  defaultListId?: string;
  targetMode?: 'list' | 'subtask';
  defaultParentTaskId?: string;
};

type Binding = {
  id: string;
  installId: string;
  bindingConfig: ClickUpBindingConfig;
  enabledCapabilities: string[];
};

const DEFAULT_CAPABILITIES = [
  'createIssue',
  'linkTicket',
  'syncPhaseStatus',
  'pullTicketStatus',
  'fetchTicketContext',
  'attachArtifacts',
  'listEntities',
];

export function PluginBindingClickUp({
  projectId,
  install,
}: {
  projectId: string;
  install: PluginInstall;
}) {
  const qc = useQueryClient();
  const orgId = install.orgId;

  const bindingsQ = useQuery({
    queryKey: ['plugin-bindings', projectId],
    queryFn: () => api.get<Binding[]>(`/api/v1/projects/${projectId}/plugin-bindings`).then((r) => r.data),
  });

  const existing = bindingsQ.data?.find((b) => b.installId === install.id);

  const [config, setConfig] = useState<ClickUpBindingConfig>({});
  const [dirty, setDirty] = useState(false);

  // Hydrate from server. Re-hydrate when the binding list changes (e.g. after save).
  useEffect(() => {
    setConfig(existing?.bindingConfig ?? {});
    setDirty(false);
  }, [existing?.id, existing?.bindingConfig]);

  const patch = (p: Partial<ClickUpBindingConfig>) => {
    setConfig((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/projects/${projectId}/plugin-bindings`, {
        installId: install.id,
        bindingConfig: config,
        enabledCapabilities: DEFAULT_CAPABILITIES,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugin-bindings', projectId] });
      toast.success('Binding saved');
      setDirty(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    },
  });

  const reset = () => {
    setConfig(existing?.bindingConfig ?? {});
    setDirty(false);
  };

  // Folderless sentinel — listEntities returns "__folderless__" as a synthetic
  // first option, and we pass it back through to the list dropdown so it knows
  // to call /space/{id}/list instead of /folder/{id}/list.
  const folderIdForListQuery = config.folderId ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h4 className="text-sm font-semibold text-white">Binding for project</h4>
        <p className="text-xs text-slate-400 mt-0.5">
          Pick where new tickets land in ClickUp. Cascading dropdowns query your real workspace —
          nothing is created until you save and a capability fires.
        </p>
      </div>

      <CascadingSelect
        label="Workspace"
        helpText="Top-level ClickUp workspace (also called &lsquo;team&rsquo; in their API)."
        orgId={orgId}
        installId={install.id}
        kind="workspace"
        value={config.workspaceId ?? null}
        onChange={(id) => patch({ workspaceId: id ?? undefined, spaceId: undefined, folderId: undefined, defaultListId: undefined })}
      />

      <CascadingSelect
        label="Space"
        orgId={orgId}
        installId={install.id}
        kind="space"
        parent={{ workspaceId: config.workspaceId }}
        value={config.spaceId ?? null}
        onChange={(id) => patch({ spaceId: id ?? undefined, folderId: undefined, defaultListId: undefined })}
      />

      <CascadingSelect
        label="Folder"
        helpText='Choose "(no folder)" for spaces that hold lists at the top level.'
        orgId={orgId}
        installId={install.id}
        kind="folder"
        parent={{ spaceId: config.spaceId }}
        value={config.folderId ?? null}
        onChange={(id) => patch({ folderId: id, defaultListId: undefined })}
      />

      <CascadingSelect
        label="Default list"
        helpText="Where new tickets land. Status mapping + custom-field mapping use this list."
        orgId={orgId}
        installId={install.id}
        kind="list"
        parent={{ spaceId: config.spaceId, folderId: folderIdForListQuery }}
        value={config.defaultListId ?? null}
        onChange={(id) => patch({ defaultListId: id ?? undefined })}
      />

      <div className="space-y-2">
        <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Mode</span>
        <div className="inline-flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          {(['list', 'subtask'] as const).map((mode) => {
            const active = (config.targetMode ?? 'list') === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ targetMode: mode, defaultParentTaskId: mode === 'list' ? undefined : config.defaultParentTaskId })}
                className="px-3 py-1 text-xs font-semibold rounded-md transition-all"
                style={
                  active
                    ? { background: 'rgba(139,92,246,0.22)', color: '#e9d5ff' }
                    : { color: 'rgba(238,238,248,0.65)' }
                }
              >
                {mode === 'list' ? 'Top-level task' : 'Subtask'}
              </button>
            );
          })}
        </div>
      </div>

      {config.targetMode === 'subtask' && (
        <CascadingSelect
          label="Parent task"
          helpText="Pick the parent — every new ticket becomes a subtask of this task."
          orgId={orgId}
          installId={install.id}
          kind="parent-task"
          parent={{ listId: config.defaultListId }}
          value={config.defaultParentTaskId ?? null}
          onChange={(id) => patch({ defaultParentTaskId: id ?? undefined })}
        />
      )}

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
        <div className="text-[11px] text-slate-500">
          {existing ? (
            <>
              Saved {new Date(existing.bindingConfig ? Date.now() : Date.now()).toLocaleString()} —{' '}
              {existing.enabledCapabilities.length} capability{existing.enabledCapabilities.length === 1 ? '' : 's'} enabled
            </>
          ) : (
            <>Unsaved — fill the picker and Save to enable ClickUp for this project.</>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty || save.isPending}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
          <Button
            size="sm"
            onClick={() => save.mutate()}
            disabled={!dirty || !config.defaultListId || save.isPending}
            loading={save.isPending}
          >
            <Save className="w-3.5 h-3.5 mr-1" /> Save binding
          </Button>
        </div>
      </div>
    </div>
  );
}
