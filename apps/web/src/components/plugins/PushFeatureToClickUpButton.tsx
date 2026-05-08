import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plug } from 'lucide-react';
import { api, pluginsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * "Push this feature to ClickUp as a parent task" button.
 *
 * Renders only when:
 *   1. ClickUp is healthy at org scope
 *   2. The cascade resolves a defaultListId (project or module binding)
 *   3. The feature doesn't already have a parent task linked
 *
 * On click: backend creates the parent task, auto-creates the
 * FeaturePluginBinding (`targetMode=subtask`, `defaultParentTaskId`), and
 * records a TicketLink. After that, every subsequent push under the feature
 * (failed steps, manual issues) lands as a subtask of the parent task.
 */
export function PushFeatureToClickUpButton({ featureId }: { featureId: string }) {
  const qc = useQueryClient();

  // Show only when routing resolves AND no parent binding exists yet.
  const routingQ = useQuery({
    queryKey: ['clickup-routing', 'feature', featureId],
    queryFn: () => api.get<{ install: { healthy: boolean } | null; listId: string | null; targetMode: string | null; parentTaskId: string | null }>(`/api/v1/features/${featureId}/clickup-routing`).then((r) => r.data),
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

  const data = routingQ.data;
  // Hide if no install / unhealthy / no list resolved.
  if (!data || !data.install?.healthy || !data.listId) return null;
  // If the feature already has a parent task wired up, hide — there's no
  // value in creating another. Future "re-link" UX can replace this gate.
  if (data.targetMode === 'subtask' && data.parentTaskId) return null;

  return (
    <button
      type="button"
      onClick={() => push.mutate()}
      disabled={push.isPending}
      title="Create a ClickUp parent task for this feature; subsequent issues land as subtasks"
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors disabled:opacity-50"
      style={{ background: 'rgba(139,92,246,0.10)', borderColor: 'rgba(139,92,246,0.30)', color: 'rgba(238,238,248,0.85)' }}
    >
      <Plug className="w-3 h-3" />
      Push to ClickUp
      <ExternalLink className="w-2.5 h-2.5" />
    </button>
  );
}
