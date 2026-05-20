import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plug, ChevronDown, Plus, Link2, Loader2 } from 'lucide-react';
import { api, pluginsApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * "Push to ClickUp ▾" — split action for a feature.
 *
 * Two paths into the same end-state (FeaturePluginBinding with subtask mode +
 * a parent task id):
 *
 *   Create new task   → backend dispatches createIssue, makes a fresh task
 *   Link existing…    → user pastes URL/id, backend dispatches linkTicket
 *
 * Hidden when:
 *   - no install / unhealthy / no resolvable list (nothing to push to)
 *   - the feature already has a parent task wired (use the edit modal to
 *     replace / unlink)
 */
export function PushFeatureToClickUpButton({ featureId }: { featureId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const routingQ = useQuery({
    queryKey: ['clickup-routing', 'feature', featureId],
    queryFn: () =>
      api.get<{ install: { healthy: boolean } | null; listId: string | null; targetMode: string | null; parentTaskId: string | null }>(
        `/api/v1/features/${featureId}/clickup-routing`,
      ).then((r) => r.data),
    staleTime: 30_000,
  });

  const push = useMutation({
    mutationFn: () => pluginsApi.pushFeature(featureId),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['clickup-routing', 'feature', featureId] });
      qc.invalidateQueries({ queryKey: ['ticket-links', 'feature', featureId] });
      qc.invalidateQueries({ queryKey: ['plugin-bindings'] });
      toast.success('Pushed to ClickUp', `${r.externalId} → ${r.externalUrl}`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Push failed');
    },
  });

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Track the timer so cleanup can cancel it — an unmount within the 0ms
    // tick would otherwise strand the listener (never removed).
    const t = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', handler);
    };
  }, [open]);

  const data = routingQ.data;
  if (!data || !data.install?.healthy || !data.listId) return null;
  if (data.targetMode === 'subtask' && data.parentTaskId) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={push.isPending}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50"
        style={{ background: 'rgba(139,92,246,0.10)', borderColor: 'rgba(139,92,246,0.30)', color: 'rgba(238,238,248,0.85)' }}
      >
        <Plug className="w-3 h-3" />
        {push.isPending ? 'Pushing…' : 'Push to ClickUp'}
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-30 min-w-[220px] rounded-lg shadow-lg overflow-hidden"
          style={{ background: 'rgba(20,20,28,0.96)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <button
            type="button"
            onClick={() => { setOpen(false); push.mutate(); }}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5"
          >
            <Plus className="w-3.5 h-3.5 mt-0.5 text-purple-300" />
            <div>
              <div className="text-slate-100">Create new task</div>
              <div className="text-[11px] text-slate-500">Creates a fresh ClickUp task in the resolved list</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setLinkOpen(true); }}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5 border-t border-white/5"
          >
            <Link2 className="w-3.5 h-3.5 mt-0.5 text-purple-300" />
            <div>
              <div className="text-slate-100">Link existing task…</div>
              <div className="text-[11px] text-slate-500">Paste a URL or task id; no new task is created</div>
            </div>
          </button>
        </div>
      )}

      {linkOpen && <LinkExistingTaskModal featureId={featureId} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

function LinkExistingTaskModal({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [ticketRef, setTicketRef] = useState('');

  const link = useMutation({
    mutationFn: () => pluginsApi.linkFeature(featureId, { ticketRef: ticketRef.trim() }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['clickup-routing', 'feature', featureId] });
      qc.invalidateQueries({ queryKey: ['ticket-links', 'feature', featureId] });
      qc.invalidateQueries({ queryKey: ['plugin-bindings'] });
      toast.success('Linked', `${r.externalTitle ?? r.externalId} → ${r.externalUrl}`);
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Link failed');
    },
  });

  const submit = () => {
    if (!ticketRef.trim()) {
      toast.error('Paste a ClickUp URL or task id');
      return;
    }
    link.mutate();
  };

  return (
    <Modal open onClose={onClose} title="Link existing ClickUp task">
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          Paste a ClickUp task URL, plain task id (<code className="text-[11px]">86c9pw8ah</code>), or custom id (<code className="text-[11px]">QA-203</code>).
          The task becomes the feature&apos;s parent — every future ticket created under the feature lands as a subtask of it.
        </p>

        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <Link2 className="w-3 h-3" /> Task reference
          </span>
          <input
            autoFocus
            value={ticketRef}
            onChange={(e) => setTicketRef(e.target.value)}
            placeholder="https://app.clickup.com/t/abcdef  or  abcdef  or  QA-203"
            className="mt-1 block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
            }}
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={link.isPending}>Cancel</Button>
          <Button onClick={submit} loading={link.isPending} disabled={!ticketRef.trim()}>
            {link.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
            Link task
          </Button>
        </div>
      </div>
    </Modal>
  );
}
