import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, Plug } from 'lucide-react';
import { api, pluginsApi, type PluginInstall } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { CascadingSelect } from './CascadingSelect';

/**
 * Module-scoped binding override for ClickUp.
 *
 * Lets each module pin its own ClickUp list. The cascading effective config
 * resolves at dispatch time:
 *   feature override → module override → project default → install config
 *
 * No status mappings here — those stay project-scoped (ISSUE_STATUS routing
 * is one mapping table per project, not per module). Just a list picker that
 * overrides the project's defaultListId for this module's hierarchy.
 *
 * If the project has no ClickUp install yet, this section renders a hint
 * pointing the user back to /org/plugins. If the install exists but no
 * project binding, this section is still useful — the module override
 * stands on its own.
 */

type ClickUpModuleBindingConfig = {
  workspaceId?: string;
  spaceId?: string;
  folderId?: string | null;
  defaultListId?: string;
};

type ModuleBinding = {
  id: string;
  installId: string;
  bindingConfig: ClickUpModuleBindingConfig;
};

type ProjectBinding = {
  id: string;
  installId: string;
  bindingConfig: ClickUpModuleBindingConfig;
};

export function ModuleBindingClickUp({ projectId, moduleId }: { projectId: string; moduleId: string }) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Pick the first healthy ClickUp install. Single-install model — multi-install
  // becomes a real selector when a second install lands.
  const install: PluginInstall | undefined = (installsQ.data ?? []).find(
    (i) => i.pluginId === 'clickup' && i.isEnabled && i.lastHealthOk,
  );

  const moduleBindingsQ = useQuery({
    queryKey: ['plugin-bindings', 'module', moduleId],
    queryFn: () => api.get<ModuleBinding[]>(`/api/v1/modules/${moduleId}/plugin-bindings`).then((r) => r.data),
    enabled: !!moduleId,
  });

  const projectBindingsQ = useQuery({
    queryKey: ['plugin-bindings', projectId],
    queryFn: () => api.get<ProjectBinding[]>(`/api/v1/projects/${projectId}/plugin-bindings`).then((r) => r.data),
    enabled: !!projectId,
  });

  // Resolved cascade — gives us the project's already-bound workspace/space so
  // the module picker can inherit them and only ask for a list.
  const routingQ = useQuery({
    queryKey: ['clickup-routing', 'module', moduleId],
    queryFn: () => api.get<{ workspaceId: string | null; spaceId: string | null }>(
      `/api/v1/modules/${moduleId}/clickup-routing`,
    ).then((r) => r.data),
    enabled: !!moduleId,
    staleTime: 60_000,
  });
  const inheritedWorkspaceId = routingQ.data?.workspaceId ?? null;
  const inheritedSpaceId = routingQ.data?.spaceId ?? null;

  const existing = moduleBindingsQ.data?.find((b) => b.installId === install?.id);
  const projectFallback = projectBindingsQ.data?.find((b) => b.installId === install?.id);

  const [config, setConfig] = useState<ClickUpModuleBindingConfig>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setConfig(existing?.bindingConfig ?? {});
    setDirty(false);
  }, [existing?.id, existing?.bindingConfig]);

  const patch = (p: Partial<ClickUpModuleBindingConfig>) => {
    setConfig((prev) => ({ ...prev, ...p }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/modules/${moduleId}/plugin-bindings`, {
        installId: install!.id,
        bindingConfig: config,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugin-bindings', 'module', moduleId] });
      toast.success('Module binding saved');
      setDirty(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    },
  });

  const clear = useMutation({
    mutationFn: () => api.delete(`/api/v1/modules/${moduleId}/plugin-bindings/${existing!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugin-bindings', 'module', moduleId] });
      setConfig({});
      setDirty(false);
      toast.success('Module override cleared — falling back to project default');
    },
  });

  if (!orgId || installsQ.isLoading) return null;

  // Only ever surface ClickUp linkage when the org actually has a ClickUp
  // install that is enabled AND healthy — otherwise render nothing.
  if (!install) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-purple-300" />
              <h4 className="text-sm font-semibold text-white">ClickUp — module override</h4>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Pin a ClickUp list for this module. Tickets created from any feature, run, or issue
              under this module land in this list. Leave blank to fall back to the project default
              {projectFallback?.bindingConfig?.defaultListId ? (
                <> (<span className="text-slate-300">list <code className="text-[11px]">{projectFallback.bindingConfig.defaultListId}</code></span>).</>
              ) : (
                <> (no project default set yet).</>
              )}
            </p>
          </div>
          {existing ? (
            <Badge className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
              Override active
            </Badge>
          ) : (
            <Badge variant="muted" className="text-[10px]">
              Inheriting project default
            </Badge>
          )}
        </div>

        {inheritedSpaceId ? (
          // Project already pinned the space — inherit it and only ask for the
          // list. The flat "space-lists" loader shows every list in that space
          // (folderless + folder-nested), so no workspace/space/folder steps.
          <CascadingSelect
            label="Default list (this module)"
            helpText="Lists from the project's ClickUp space. Tickets from anywhere under this module use this list unless a feature overrides."
            orgId={orgId}
            installId={install.id}
            kind="space-lists"
            parent={{ spaceId: inheritedSpaceId }}
            value={config.defaultListId ?? null}
            onChange={(id) => patch({
              defaultListId: id ?? undefined,
              spaceId: inheritedSpaceId,
              workspaceId: inheritedWorkspaceId ?? undefined,
            })}
          />
        ) : (
          // No project binding yet — fall back to the full cascade so a module
          // can still stand on its own.
          <>
            <CascadingSelect
              label="Workspace"
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
              helpText='Choose "(no folder)" for spaces with top-level lists.'
              orgId={orgId}
              installId={install.id}
              kind="folder"
              parent={{ spaceId: config.spaceId }}
              value={config.folderId ?? null}
              onChange={(id) => patch({ folderId: id, defaultListId: undefined })}
            />
            <CascadingSelect
              label="Default list (this module)"
              helpText="Tickets from anywhere under this module use this list unless a feature overrides."
              orgId={orgId}
              installId={install.id}
              kind="list"
              parent={{ spaceId: config.spaceId, folderId: config.folderId ?? null }}
              value={config.defaultListId ?? null}
              onChange={(id) => patch({ defaultListId: id ?? undefined })}
            />
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/5">
          {existing && (
            <Button variant="ghost" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
              Clear override
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => { setConfig(existing?.bindingConfig ?? {}); setDirty(false); }} disabled={!dirty}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || !config.defaultListId || save.isPending} loading={save.isPending}>
            <Save className="w-3.5 h-3.5 mr-1" /> Save override
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
