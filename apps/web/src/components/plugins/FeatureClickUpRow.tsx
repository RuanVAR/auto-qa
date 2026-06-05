import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, Unlink, Plus, Loader2 } from 'lucide-react';
import { api, pluginsApi } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { CascadingSelect } from './CascadingSelect';

/**
 * Linked-task row for the feature edit modal.
 *
 * Shows the current state of the feature ↔ ClickUp link and lets the user
 * link / replace / unlink without leaving the edit modal. Same backend as
 * the header dropdown, just a different surface for users who go "wait,
 * what's actually linked?" while editing.
 *
 * States rendered:
 *   - No install / unhealthy / no list resolvable → hidden
 *   - Linked → external title + url + status pill + Unlink + Replace
 *   - Unlinked → "No ClickUp parent task" + Link / Create
 */
type Routing = {
  install: { id: string; healthy: boolean } | null;
  listId: string | null;
  targetMode: string | null;
  parentTaskId: string | null;
};

type TicketLink = {
  id: string;
  externalId: string;
  externalUrl: string;
  externalTitle: string | null;
  externalStatus: string | null;
};

export function FeatureClickUpRow({ featureId }: { featureId: string }) {
  const qc = useQueryClient();
  const [linkModalOpen, setLinkModalOpen] = useState(false);

  const routingQ = useQuery({
    queryKey: ['clickup-routing', 'feature', featureId],
    queryFn: () => api.get<Routing>(`/api/v1/features/${featureId}/clickup-routing`).then((r) => r.data),
    staleTime: 15_000,
  });

  const linksQ = useQuery({
    queryKey: ['ticket-links', 'feature', featureId],
    queryFn: () => api.get<TicketLink[]>(`/api/v1/features/${featureId}/ticket-links`).then((r) => r.data),
    staleTime: 15_000,
  });

  const push = useMutation({
    mutationFn: () => pluginsApi.pushFeature(featureId),
    onSuccess: () => {
      invalidate(qc, featureId);
      toast.success('Pushed to ClickUp');
    },
    onError: (err: unknown) => toast.error(extractErr(err, 'Push failed')),
  });

  const unlink = useMutation({
    mutationFn: () => pluginsApi.unlinkFeature(featureId),
    onSuccess: () => {
      invalidate(qc, featureId);
      toast.success('Unlinked');
    },
    onError: (err: unknown) => toast.error(extractErr(err, 'Unlink failed')),
  });

  if (!routingQ.data || !routingQ.data.install?.healthy) {
    // ClickUp not installed/healthy for this org — nothing to show. (A missing
    // list no longer hides this: you can still "Link existing" without a list.)
    return null;
  }
  const hasList = !!routingQ.data.listId;

  const parentTaskId = routingQ.data.parentTaskId;
  const linkRow = (linksQ.data ?? []).find((l) => l.externalId === parentTaskId) ?? null;

  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="text-xs font-medium text-slate-300 uppercase tracking-wide mb-2 flex items-center gap-1.5">
        <Link2 className="w-3 h-3" /> ClickUp parent task
      </div>

      {parentTaskId && linkRow ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <a
              href={linkRow.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-purple-200 hover:text-purple-100 inline-flex items-center gap-1.5 group truncate max-w-full"
            >
              <span className="truncate">{linkRow.externalTitle || linkRow.externalId}</span>
              <ExternalLink className="w-3 h-3 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </a>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {linkRow.externalId}
              {linkRow.externalStatus && <> · status: <span className="text-slate-300">{linkRow.externalStatus}</span></>}
              {' · subtasks land under this'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLinkModalOpen(true)}
              disabled={unlink.isPending}
            >
              <Link2 className="w-3 h-3" /> Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (window.confirm('Unlink the parent task? Future tickets will be created at the top level until you re-link or push.')) {
                  unlink.mutate();
                }
              }}
              loading={unlink.isPending}
            >
              <Unlink className="w-3 h-3" /> Unlink
            </Button>
          </div>
        </div>
      ) : parentTaskId ? (
        <div className="text-xs text-slate-400">
          Linked to <code className="text-[11px]">{parentTaskId}</code> (details still loading…)
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-400">
            {hasList
              ? 'No parent task linked. Tickets created here become top-level tasks in the resolved list.'
              : 'No ClickUp list set for this module yet — you can still link this feature to an existing task.'}
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setLinkModalOpen(true)}>
              <Link2 className="w-3 h-3" /> Link existing
            </Button>
            {hasList && (
              <Button size="sm" onClick={() => push.mutate()} loading={push.isPending} disabled={push.isPending}>
                <Plus className="w-3 h-3" /> Create new
              </Button>
            )}
          </div>
        </div>
      )}

      {linkModalOpen && (
        <LinkOrReplaceModal
          featureId={featureId}
          installId={routingQ.data.install?.id ?? null}
          listId={routingQ.data.listId}
          onClose={() => setLinkModalOpen(false)}
          replacingExisting={!!parentTaskId}
        />
      )}
    </div>
  );
}

function LinkOrReplaceModal({
  featureId,
  installId,
  listId,
  onClose,
  replacingExisting,
}: {
  featureId: string;
  installId: string | null;
  listId: string | null;
  onClose: () => void;
  replacingExisting: boolean;
}) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const [ticketRef, setTicketRef] = useState('');
  // When the feature's list resolves we can offer a task picker instead of
  // making the user hunt for a URL. Paste stays available as the fallback.
  const canPickTask = !!orgId && !!installId && !!listId;

  const link = useMutation({
    mutationFn: () => pluginsApi.linkFeature(featureId, { ticketRef: ticketRef.trim() }),
    onSuccess: () => {
      invalidate(qc, featureId);
      toast.success(replacingExisting ? 'Replaced parent task' : 'Linked');
      onClose();
    },
    onError: (err: unknown) => toast.error(extractErr(err, 'Link failed')),
  });

  return (
    <Modal open onClose={onClose} title={replacingExisting ? 'Replace parent task' : 'Link existing ClickUp task'}>
      <div className="space-y-4">
        {canPickTask && (
          <div className="space-y-1.5">
            <CascadingSelect
              label="Pick a task from this list"
              orgId={orgId!}
              installId={installId!}
              kind="list-tasks"
              parent={{ listId: listId! }}
              value={null}
              onChange={(id) => { if (id) { setTicketRef(id); link.mutate(); } }}
              placeholder="Search tasks…"
            />
            <p className="text-[11px] text-slate-500">…or paste a task reference below.</p>
          </div>
        )}
        <p className="text-xs text-slate-400">
          Paste a ClickUp task URL, plain id, or custom id. {replacingExisting && 'The current parent will be replaced — existing TicketLink rows for the old parent stay in place but won\'t be the new subtask root.'}
        </p>
        <input
          autoFocus
          value={ticketRef}
          onChange={(e) => setTicketRef(e.target.value)}
          placeholder="https://app.clickup.com/t/abcdef  or  abcdef  or  QA-203"
          className="block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          onKeyDown={(e) => { if (e.key === 'Enter' && ticketRef.trim()) { e.preventDefault(); link.mutate(); } }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={link.isPending}>Cancel</Button>
          <Button onClick={() => link.mutate()} loading={link.isPending} disabled={!ticketRef.trim()}>
            {link.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
            {replacingExisting ? 'Replace' : 'Link task'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function invalidate(qc: ReturnType<typeof useQueryClient>, featureId: string) {
  qc.invalidateQueries({ queryKey: ['clickup-routing', 'feature', featureId] });
  qc.invalidateQueries({ queryKey: ['ticket-links', 'feature', featureId] });
  qc.invalidateQueries({ queryKey: ['plugin-bindings'] });
}

function extractErr(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
}
