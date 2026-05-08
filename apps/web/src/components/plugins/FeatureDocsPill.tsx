import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, ExternalLink, RefreshCw, Search, Plus, X, Loader2 } from 'lucide-react';
import { api, pluginsApi, type PluginInstall } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useActiveOrg } from '@/stores/authStore';

/**
 * Compact doc-link pill for the feature header.
 *
 * Click → drawer-style popover listing linked docs with title + summary.
 * Each doc gets a "View cached" button (loads markdown into a modal),
 * "Refresh" (re-pulls via fetchDoc), and a deep link.
 *
 * "+ Link doc" opens a search-and-pick modal: types into the input → calls
 * `listDocs` on every install with that capability → user picks → POST link.
 */
type DocLink = {
  id: string;
  externalId: string;
  externalUrl: string;
  title: string;
  summary: string | null;
  cachedAt: string | null;
  cacheExpiresAt: string | null;
  install: { id: string; pluginId: string; displayLabel: string | null };
};

export function FeatureDocsPill({ featureId }: { featureId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewer, setViewer] = useState<DocLink | null>(null);

  const linksQ = useQuery({
    queryKey: ['doc-links', 'feature', featureId],
    queryFn: () => api.get<DocLink[]>(`/api/v1/features/${featureId}/doc-links`).then((r) => r.data),
  });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    setTimeout(() => window.addEventListener('click', handler, { once: true }), 0);
    return () => window.removeEventListener('click', handler);
  }, [open]);

  const refresh = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/doc-links/${id}/refresh`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-links', 'feature', featureId] });
      toast.success('Doc refreshed');
    },
    onError: () => toast.error('Refresh failed'),
  });

  const unlink = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/doc-links/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doc-links', 'feature', featureId] }),
  });

  const links = linksQ.data ?? [];

  return (
    <div className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.85)' }}
      >
        <FileText className="w-3 h-3" />
        {links.length > 0 ? `${links.length} doc${links.length === 1 ? '' : 's'}` : 'Docs'}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1 z-30 w-[380px] rounded-lg shadow-lg"
          style={{ background: 'rgba(20,20,28,0.96)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Linked specs</span>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setSearchOpen(true); }}>
              <Plus className="w-3 h-3 mr-1" /> Link doc
            </Button>
          </div>

          {links.length === 0 ? (
            <p className="text-xs text-slate-400 p-4">No specs linked. Use &ldquo;Link doc&rdquo; to find an external doc to attach.</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto py-1">
              {links.map((link) => (
                <li key={link.id} className="px-3 py-2 hover:bg-white/3 group">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => { setViewer(link); setOpen(false); }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-sm font-medium text-slate-100 truncate">{link.title}</div>
                      {link.summary && <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{link.summary}</div>}
                      <div className="text-[10px] text-slate-500 mt-1">
                        {link.install.pluginId === 'clickup' ? 'ClickUp' : link.install.pluginId} · {link.cachedAt ? `cached ${new Date(link.cachedAt).toLocaleString()}` : 'never fetched'}
                      </div>
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                      <button
                        type="button"
                        title="Refresh from source"
                        onClick={() => refresh.mutate(link.id)}
                        disabled={refresh.isPending}
                        className="text-slate-400 hover:text-slate-200"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending && refresh.variables === link.id ? 'animate-spin' : ''}`} />
                      </button>
                      <a href={link.externalUrl} target="_blank" rel="noopener noreferrer" title="Open in plugin" className="text-slate-400 hover:text-slate-200">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <button
                        type="button"
                        title="Unlink"
                        onClick={() => {
                          if (window.confirm(`Unlink "${link.title}"?`)) unlink.mutate(link.id);
                        }}
                        className="text-slate-400 hover:text-rose-300"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {searchOpen && <LinkDocModal featureId={featureId} onClose={() => setSearchOpen(false)} />}
      {viewer && <DocViewerModal docLinkId={viewer.id} title={viewer.title} externalUrl={viewer.externalUrl} onClose={() => setViewer(null)} />}
    </div>
  );
}

function LinkDocModal({ featureId, onClose }: { featureId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const [query, setQuery] = useState('');

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const docCapableInstalls = (installsQ.data ?? []).filter((i) => i.isEnabled && i.lastHealthOk);

  const searchQ = useQuery({
    queryKey: ['doc-search', orgId, query, docCapableInstalls.map((i) => i.id).join(',')],
    queryFn: async () => {
      const aggregated: Array<{ install: PluginInstall; doc: { externalId: string; externalUrl: string; title: string; summary?: string } }> = [];
      for (const install of docCapableInstalls) {
        try {
          const r = await api.post<{ items: Array<{ externalId: string; externalUrl: string; title: string; summary?: string }> }>(
            `/api/v1/orgs/${orgId}/plugin-installs/${install.id}/docs/search`,
            { query, limit: 25 },
          );
          for (const doc of r.data.items ?? []) aggregated.push({ install, doc });
        } catch {
          // best-effort across installs
        }
      }
      return aggregated;
    },
    enabled: !!orgId && docCapableInstalls.length > 0 && query.length >= 2,
  });

  const link = useMutation({
    mutationFn: (args: { installId: string; doc: { externalId: string; externalUrl: string; title: string; summary?: string } }) =>
      api.post(`/api/v1/features/${featureId}/doc-links`, {
        installId: args.installId,
        externalId: args.doc.externalId,
        externalUrl: args.doc.externalUrl,
        title: args.doc.title,
        summary: args.doc.summary,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-links', 'feature', featureId] });
      toast.success('Doc linked');
      onClose();
    },
    onError: () => toast.error('Link failed'),
  });

  return (
    <Modal open onClose={onClose} title="Link a doc" size="lg">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Search docs</span>
          <div className="relative mt-1">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type at least 2 characters…"
              className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>
        </label>

        {query.length < 2 ? (
          <p className="text-xs text-slate-400">Searches every healthy install with the listDocs capability.</p>
        ) : searchQ.isLoading ? (
          <div className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Searching…</div>
        ) : (searchQ.data ?? []).length === 0 ? (
          <p className="text-xs text-slate-400">No matches.</p>
        ) : (
          <ul className="max-h-[360px] overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            {(searchQ.data ?? []).map(({ install, doc }) => (
              <li
                key={`${install.id}-${doc.externalId}`}
                className="px-3 py-2 hover:bg-white/3 cursor-pointer"
                onClick={() => link.mutate({ installId: install.id, doc })}
              >
                <div className="text-sm text-slate-100">{doc.title}</div>
                {doc.summary && <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{doc.summary}</div>}
                <div className="text-[10px] text-slate-500 mt-1">
                  {install.pluginId === 'clickup' ? 'ClickUp' : install.pluginId}
                  {install.displayLabel ? ` — ${install.displayLabel}` : ''} · {doc.externalId}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function DocViewerModal({ docLinkId, title, externalUrl, onClose }: { docLinkId: string; title: string; externalUrl: string; onClose: () => void }) {
  const contentQ = useQuery({
    queryKey: ['doc-link-content', docLinkId],
    queryFn: () => api.get<{ markdown: string; cached: boolean }>(`/api/v1/doc-links/${docLinkId}/content`).then((r) => r.data),
  });

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-2">
        <div className="flex items-center justify-end gap-2">
          <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-300 hover:text-purple-200 inline-flex items-center gap-1">
            Open in source <ExternalLink className="w-3 h-3" />
          </a>
        </div>
        {contentQ.isLoading ? (
          <div className="text-xs text-slate-400 flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
        ) : (
          <pre className="whitespace-pre-wrap break-words text-xs text-slate-200 max-h-[60vh] overflow-y-auto p-3 rounded-md" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.07)' }}>
            {contentQ.data?.markdown ?? ''}
          </pre>
        )}
      </div>
    </Modal>
  );
}
