import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Check, X, Sparkles, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * Shows the external ticket links attached to an Issue, Feature, or Defect.
 *
 * Each link card carries:
 *   - external title + status pill (color from the upstream system)
 *   - "open in ClickUp" deep link
 *   - refresh button — pulls latest status via InboundSyncService
 *   - last-synced-ago timestamp
 *   - any pending TicketStatusSuggestion: "External status went to 'X' — Apply / Dismiss"
 *
 * The component intentionally renders nothing if there are no links, so
 * surrounding pages don't need to gate it themselves.
 */
type TicketLink = {
  id: string;
  externalId: string;
  externalUrl: string;
  externalTitle: string | null;
  externalStatus: string | null;
  externalStatusColor: string | null;
  externalStatusType: string | null;
  lastInboundSyncAt: string | null;
  install: { id: string; pluginId: string; displayLabel: string | null };
  suggestions: Array<{
    id: string;
    externalStatus: string;
    mappedStatus: string | null;
    suggestionKind: 'AUTO_APPLIED' | 'PENDING_APPROVAL' | 'UNMAPPED';
  }>;
};

export function TicketLinksPanel({
  scope,
  scopeId,
  projectId,
}: {
  scope: 'issue' | 'feature' | 'defect';
  scopeId: string;
  projectId?: string;
}) {
  const qc = useQueryClient();
  const path = scope === 'issue'
    ? `issues/${scopeId}/ticket-links`
    : scope === 'feature'
      ? `features/${scopeId}/ticket-links`
      : `projects/${projectId}/defects/${scopeId}/ticket-links`;
  const queryKey = ['ticket-links', scope, scopeId];

  const linksQ = useQuery({
    queryKey,
    queryFn: () => api.get<TicketLink[]>(`/api/v1/${path}`).then((r) => r.data),
  });

  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ticket-links/${id}/refresh`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Refresh failed');
    },
  });

  const apply = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ticket-status-suggestions/${id}/apply`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ['issues'] });
      toast.success('Applied — issue status updated');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Apply failed');
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/ticket-status-suggestions/${id}/dismiss`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const links = linksQ.data ?? [];
  if (links.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wide">External tickets</div>
      <div className="space-y-2">
        {links.map((link) => (
          <div
            key={link.id}
            className="rounded-lg p-3 space-y-2"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <a
                  href={link.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-purple-200 hover:text-purple-100 inline-flex items-center gap-1.5 group"
                >
                  <span className="truncate">
                    {link.externalTitle || link.externalId}
                  </span>
                  <ExternalLink className="w-3 h-3 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </a>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {link.install.pluginId === 'clickup' ? 'ClickUp' : link.install.pluginId} · {link.externalId}
                  {link.lastInboundSyncAt && (
                    <> · synced {new Date(link.lastInboundSyncAt).toLocaleTimeString()}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {link.externalStatus && (
                  <span
                    className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                    style={
                      link.externalStatusColor
                        ? {
                            background: `${link.externalStatusColor}1a`,
                            border: `1px solid ${link.externalStatusColor}55`,
                            color: link.externalStatusColor,
                          }
                        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.75)', border: '1px solid rgba(255,255,255,0.10)' }
                    }
                  >
                    {link.externalStatus}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => refresh.mutate(link.id)}
                  disabled={refresh.isPending}
                  title="Pull latest status"
                  className="text-slate-400 hover:text-slate-200 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending && refresh.variables === link.id ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {link.suggestions.map((s) => (
              <SuggestionRow
                key={s.id}
                suggestion={s}
                onApply={() => apply.mutate(s.id)}
                onDismiss={() => dismiss.mutate(s.id)}
                applying={apply.isPending && apply.variables === s.id}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  onApply,
  onDismiss,
  applying,
}: {
  suggestion: { id: string; externalStatus: string; mappedStatus: string | null; suggestionKind: string };
  onApply: () => void;
  onDismiss: () => void;
  applying: boolean;
}) {
  const isUnmapped = suggestion.suggestionKind === 'UNMAPPED' || !suggestion.mappedStatus;

  return (
    <div
      className="flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5"
      style={{
        background: isUnmapped ? 'rgba(245,158,11,0.08)' : 'rgba(99,102,241,0.10)',
        border: `1px solid ${isUnmapped ? 'rgba(245,158,11,0.25)' : 'rgba(99,102,241,0.25)'}`,
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {isUnmapped ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        ) : (
          <Sparkles className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
        )}
        <span className="text-xs text-slate-200 truncate">
          {isUnmapped
            ? `External status "${suggestion.externalStatus}" has no mapping yet`
            : <>External moved to <strong>{suggestion.externalStatus}</strong> → apply <strong>{suggestion.mappedStatus}</strong>?</>}
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {!isUnmapped && (
          <Button size="sm" onClick={onApply} loading={applying}>
            <Check className="w-3 h-3" /> Apply
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          <X className="w-3 h-3" /> Dismiss
        </Button>
      </div>
    </div>
  );
}
