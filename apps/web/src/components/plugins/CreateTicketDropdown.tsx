import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ChevronDown, Loader2 } from 'lucide-react';
import { api, pluginsApi, type PluginInstall } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { usePluginCapability } from '@/hooks/usePluginCapability';

/**
 * "Create ticket ▾" trigger.
 *
 * Hidden when no plugin install satisfies the createIssue gate. When at least
 * one is enabled, renders a button (single install) or a popover dropdown
 * (multiple installs). Each click dispatches the createIssue capability
 * scoped to the relevant project binding so effective config resolves the
 * defaultListId + targetMode.
 *
 * On success: toast with a deep-link to the new external ticket; optional
 * `onCreated` callback fires so the surrounding feature (IssueTracker /
 * StepFailurePanel) can refresh + show the link in its own UI.
 */
export type CreateTicketScope =
  | { kind: 'feature'; featureId: string }
  | { kind: 'module'; moduleId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'issue'; issueId: string }
  | { kind: 'defect'; defectId: string };

export function CreateTicketDropdown({
  projectId,
  scope,
  title,
  description,
  severity,
  labels,
  size = 'sm',
  onCreated,
}: {
  projectId: string;
  scope: CreateTicketScope;
  title: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  labels?: string[];
  size?: 'sm' | 'md';
  onCreated?: (result: { externalId: string; externalUrl: string }) => void;
}) {
  const { enabled, installs, loading } = usePluginCapability('createIssue', { projectId });
  const [open, setOpen] = useState(false);

  // Only show installs that have a binding for this project — otherwise we
  // have nowhere to push the ticket.
  const bindingsQ = useQuery({
    queryKey: ['plugin-bindings', projectId],
    queryFn: () => api.get<Array<{ id: string; installId: string; bindingConfig: { defaultListId?: string } }>>(`/api/v1/projects/${projectId}/plugin-bindings`).then((r) => r.data),
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });

  const bindingsByInstall = new Map((bindingsQ.data ?? []).map((b) => [b.installId, b] as const));
  const installable = installs.filter((i) => {
    const b = bindingsByInstall.get(i.id);
    return !!b && !!b.bindingConfig?.defaultListId;
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    setTimeout(() => window.addEventListener('click', handler, { once: true }), 0);
    return () => window.removeEventListener('click', handler);
  }, [open]);

  if (loading) return null;
  if (!enabled || installable.length === 0) return null;

  return (
    <div className="relative inline-block">
      {installable.length === 1 ? (
        <CreateButton
          size={size}
          install={installable[0]}
          binding={bindingsByInstall.get(installable[0].id)!}
          projectId={projectId}
          scope={scope}
          payload={{ title, description, severity, labels }}
          onCreated={onCreated}
        />
      ) : (
        <>
          <Button
            size={size}
            variant="secondary"
            onClick={() => setOpen((o) => !o)}
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1" /> Create ticket
            <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
          {open && (
            <div
              className="absolute right-0 mt-1 z-30 min-w-[220px] rounded-lg shadow-lg"
              style={{ background: 'rgba(20,20,28,0.96)', border: '1px solid rgba(255,255,255,0.10)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {installable.map((install) => (
                <CreateMenuItem
                  key={install.id}
                  install={install}
                  binding={bindingsByInstall.get(install.id)!}
                  projectId={projectId}
                  scope={scope}
                  payload={{ title, description, severity, labels }}
                  onCreated={(r) => {
                    setOpen(false);
                    onCreated?.(r);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CreateButton(props: CreateProps) {
  const m = useCreateMutation(props);
  return (
    <Button size={props.size} variant="secondary" onClick={() => m.mutate()} loading={m.isPending}>
      <ExternalLink className="w-3.5 h-3.5 mr-1" /> Create ticket
    </Button>
  );
}

function CreateMenuItem(props: CreateProps) {
  const m = useCreateMutation(props);
  return (
    <button
      type="button"
      onClick={() => m.mutate()}
      disabled={m.isPending}
      className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-white/5"
    >
      {m.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 text-purple-300" />}
      <span className="flex-1">
        {props.install.pluginId === 'clickup' ? 'ClickUp' : props.install.pluginId}
        {props.install.displayLabel ? <span className="text-slate-400"> — {props.install.displayLabel}</span> : null}
      </span>
    </button>
  );
}

type CreateProps = {
  install: PluginInstall;
  binding: { id: string; bindingConfig: { defaultListId?: string } };
  projectId: string;
  scope: CreateTicketScope;
  payload: { title: string; description?: string; severity?: string; labels?: string[] };
  size?: 'sm' | 'md';
  onCreated?: (result: { externalId: string; externalUrl: string }) => void;
};

function useCreateMutation(props: CreateProps) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      pluginsApi.dispatch<{ externalId: string; externalUrl: string; externalTitle?: string }>(
        props.install.orgId,
        props.install.id,
        {
          capability: 'createIssue',
          bindingId: props.binding.id,
          payload: { scope: props.scope, ...props.payload },
        },
      ),
    onSuccess: (result) => {
      toast.success('Ticket created', `${result.externalId} → ${result.externalUrl}`);
      qc.invalidateQueries({ queryKey: ['issues'] });
      props.onCreated?.(result);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Failed to create ticket');
    },
  });
}
