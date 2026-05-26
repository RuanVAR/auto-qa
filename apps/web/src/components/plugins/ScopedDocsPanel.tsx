import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, Plus, Search, ExternalLink, RefreshCw, Pencil, Save, Trash2, X, Loader2, Link2, BookOpen, FolderOpen, Maximize2 } from 'lucide-react';
import { DocViewerModal } from './DocViewerModal';
import {
  api,
  docsApi,
  pluginsApi,
  type DocScopeKind,
  type LocalDocSummary,
  type LocalDoc,
  type LinkedDoc,
  type PluginInstall,
} from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';

/**
 * Combined docs surface for any scope (project / module / feature / test).
 *
 * Two doc kinds in one list:
 *   - Local: authored in the platform via markdown editor (split edit/view)
 *   - Linked: pulled from a plugin install (today: ClickUp Docs v3)
 *
 * Layout: a split panel — left column lists docs (badge tells you which
 * kind), right column shows the active doc rendered as markdown with edit
 * affordances when local. Linked docs render their cached markdown with a
 * Refresh button to re-pull.
 */
export function ScopedDocsPanel({ scope, scopeId }: { scope: DocScopeKind; scopeId: string }) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const localQ = useQuery({
    queryKey: ['docs', 'local', scope, scopeId],
    queryFn: () => docsApi.listLocal(scope, scopeId),
    enabled: !!scopeId,
  });
  const linkedQ = useQuery({
    queryKey: ['doc-links', scope, scopeId],
    queryFn: () => docsApi.listLinked(scope, scopeId),
    enabled: !!scopeId,
  });

  // Gate the "Link external" button on whether the org actually has a
  // plugin that can serve docs AND that plugin is currently usable. Used
  // to be rendered unconditionally — users with no doc plugin clicked it
  // and got an empty modal, then a "not configured" toast a few seconds
  // later. Now: the modal can only open when at least one install is
  // (1) for a plugin whose catalog entry advertises the `listDocs`
  // capability, (2) isEnabled, and (3) lastHealthOk. Otherwise the
  // button renders disabled with a tooltip that points at org plugins.
  const catalogQ = useQuery({
    queryKey: ['plugins', 'catalog'],
    queryFn: () => pluginsApi.catalog(),
    enabled: !!orgId,
    staleTime: 5 * 60_000,
  });
  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });
  const docCapablePluginIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of catalogQ.data ?? []) {
      if (p.capabilities.includes('listDocs')) ids.add(p.id);
    }
    return ids;
  }, [catalogQ.data]);
  const usableDocInstalls = useMemo(
    () => (installsQ.data ?? []).filter(
      (i) => i.isEnabled && i.lastHealthOk && docCapablePluginIds.has(i.pluginId),
    ),
    [installsQ.data, docCapablePluginIds],
  );
  const installedButNotHealthy = useMemo(
    () => (installsQ.data ?? []).some(
      (i) => docCapablePluginIds.has(i.pluginId) && (!i.isEnabled || !i.lastHealthOk),
    ),
    [installsQ.data, docCapablePluginIds],
  );
  const canLinkExternal = usableDocInstalls.length > 0;
  // Loading guard — don't render a disabled button before we've fetched
  // catalog + installs (otherwise the button flicker-disables on every
  // page mount).
  const pluginsLoading = (catalogQ.isLoading || installsQ.isLoading) && !!orgId;

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [creatingLocal, setCreatingLocal] = useState(false);
  const [linkingExternal, setLinkingExternal] = useState(false);

  const merged: DocItem[] = useMemo(() => {
    const out: DocItem[] = [];
    for (const d of localQ.data ?? []) out.push({ kind: 'local', id: d.id, title: d.title, summary: d.summary, updatedAt: d.updatedAt, doc: d });
    for (const l of linkedQ.data ?? []) out.push({ kind: 'linked', id: l.id, title: l.title, summary: l.summary, updatedAt: l.cachedAt ?? null, link: l });
    return out;
  }, [localQ.data, linkedQ.data]);

  // Auto-select the first item once data lands.
  useEffect(() => {
    if (!activeKey && merged.length > 0) {
      setActiveKey(`${merged[0].kind}:${merged[0].id}`);
    }
  }, [activeKey, merged]);

  const active = merged.find((m) => `${m.kind}:${m.id}` === activeKey) ?? null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div className="flex items-center gap-2">
          <BookOpen className="w-3.5 h-3.5 text-purple-300" />
          <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Docs</h4>
          <span className="text-[10px] text-slate-500">{merged.length} total</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setCreatingLocal(true)}><Plus className="w-3 h-3 mr-1" /> New doc</Button>
          {/* Link external — three branches:
              (1) No doc-capable plugin in the catalog at all OR no install
                  for one → hide the button entirely. Surfacing it would
                  just open an empty modal and confuse the user.
              (2) An install exists but is disabled or unhealthy → render
                  the button DISABLED with a tooltip pointing at where to
                  fix it. We keep it visible so admins notice that a plugin
                  outage is the cause, not a missing feature.
              (3) Healthy install exists → normal clickable button. */}
          {orgId && !pluginsLoading && canLinkExternal && (
            <Button size="sm" variant="ghost" onClick={() => setLinkingExternal(true)}>
              <Link2 className="w-3 h-3 mr-1" /> Link external
            </Button>
          )}
          {orgId && !pluginsLoading && !canLinkExternal && installedButNotHealthy && (
            <Button
              size="sm"
              variant="ghost"
              disabled
              title="An external doc plugin is installed but disabled or unhealthy. Re-enable / re-authenticate it in Settings → Organisation → Plugins."
              style={{ opacity: 0.55, cursor: 'not-allowed' }}
            >
              <Link2 className="w-3 h-3 mr-1" /> Link external
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[200px_1fr] min-h-[280px]">
        {/* Left list */}
        <div className="border-r border-white/5 max-h-[480px] overflow-y-auto">
          {merged.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">
              {canLinkExternal
                ? 'No docs yet. Create one or link an external doc.'
                : 'No docs yet. Create one to get started.'}
            </div>
          ) : (
            <ul className="py-1">
              {merged.map((m) => (
                <li key={`${m.kind}:${m.id}`}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(`${m.kind}:${m.id}`)}
                    className="w-full text-left px-3 py-2 hover:bg-white/3 group"
                    style={{
                      background: activeKey === `${m.kind}:${m.id}` ? 'rgba(139,92,246,0.10)' : undefined,
                      borderLeft: activeKey === `${m.kind}:${m.id}` ? '2px solid #a78bfa' : '2px solid transparent',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      {m.kind === 'local' ? <FileText className="w-3 h-3 text-slate-400 shrink-0" /> : <ExternalLink className="w-3 h-3 text-purple-300 shrink-0" />}
                      <div className="text-sm text-slate-200 truncate flex-1">{m.title}</div>
                    </div>
                    {m.summary && <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{m.summary}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right viewer/editor */}
        <div className="min-w-0">
          {!active ? (
            <div className="p-6 text-xs text-slate-500 flex items-center justify-center min-h-[280px]">
              {merged.length === 0
                ? (canLinkExternal
                  ? 'Pick "New doc" or "Link external" to start.'
                  : 'Pick "New doc" to start.')
                : 'Pick a doc on the left to read it.'}
            </div>
          ) : active.kind === 'local' ? (
            <LocalDocView doc={active.doc} onClose={() => setActiveKey(null)} onChanged={() => {
              qc.invalidateQueries({ queryKey: ['docs', 'local', scope, scopeId] });
            }} />
          ) : (
            <LinkedDocView link={active.link} onChanged={() => {
              qc.invalidateQueries({ queryKey: ['doc-links', scope, scopeId] });
            }} />
          )}
        </div>
      </div>

      {creatingLocal && (
        <CreateLocalDocModal scope={scope} scopeId={scopeId} onClose={() => setCreatingLocal(false)} />
      )}
      {linkingExternal && orgId && (
        <LinkExternalDocModal
          scope={scope}
          scopeId={scopeId}
          orgId={orgId}
          onClose={() => setLinkingExternal(false)}
        />
      )}
    </div>
  );
}

type DocItem =
  | { kind: 'local'; id: string; title: string; summary: string | null; updatedAt: string | null; doc: LocalDocSummary }
  | { kind: 'linked'; id: string; title: string; summary: string | null; updatedAt: string | null; link: LinkedDoc };

// ── LocalDocView ─────────────────────────────────────────────────────────────

function LocalDocView({ doc, onChanged, onClose }: { doc: LocalDocSummary; onChanged: () => void; onClose: () => void }) {
  const qc = useQueryClient();
  const fullQ = useQuery({
    queryKey: ['docs', 'local-full', doc.id],
    queryFn: () => docsApi.getLocal(doc.id),
  });

  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    if (fullQ.data) {
      setTitle(fullQ.data.title);
      setMarkdown(fullQ.data.markdown);
    }
  }, [fullQ.data]);

  const save = useMutation({
    mutationFn: () => docsApi.updateLocal(doc.id, { title, markdown }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['docs', 'local-full', doc.id] });
      onChanged();
      setEditing(false);
      toast.success('Doc saved');
    },
    onError: () => toast.error('Save failed'),
  });

  const remove = useMutation({
    mutationFn: () => docsApi.deleteLocal(doc.id),
    onSuccess: () => {
      onChanged();
      onClose();
      toast.success('Doc deleted');
    },
    onError: () => toast.error('Delete failed'),
  });

  if (fullQ.isLoading) return <div className="p-6 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="flex flex-col max-h-[520px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 gap-2">
        {editing ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 bg-slate-900/60 border border-slate-700 rounded-md px-2 py-1 text-sm text-white" />
        ) : (
          <h3 className="text-sm font-semibold text-white truncate flex-1">{title}</h3>
        )}
        <div className="flex items-center gap-1.5 shrink-0">
          {editing ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setTitle(fullQ.data!.title); setMarkdown(fullQ.data!.markdown); }}><X className="w-3 h-3" /> Cancel</Button>
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}><Save className="w-3 h-3 mr-1" /> Save</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}><Maximize2 className="w-3 h-3 mr-1" /> Expand</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil className="w-3 h-3 mr-1" /> Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Delete "${doc.title}"?`)) remove.mutate(); }}><Trash2 className="w-3 h-3" /></Button>
            </>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="grid grid-cols-2 h-full">
            <textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              className="w-full h-[400px] bg-slate-900/60 border-r border-slate-700 px-3 py-3 text-xs font-mono text-white resize-none focus:outline-none"
              placeholder="# Markdown here"
            />
            <div className="overflow-y-auto px-4 py-3 prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || '*Empty preview*'}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 prose prose-invert prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || '_(empty)_'}</ReactMarkdown>
          </div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-white/5 text-[10px] text-slate-500 flex items-center justify-between">
        <span>Updated {new Date(doc.updatedAt).toLocaleString()} {doc.editor ? `· by ${doc.editor.name}` : ''}</span>
        <span>Local doc</span>
      </div>
      <DocViewerModal open={expanded} onClose={() => setExpanded(false)} docKind="local" docId={doc.id} />
    </div>
  );
}

// ── LinkedDocView ────────────────────────────────────────────────────────────

function LinkedDocView({ link, onChanged }: { link: LinkedDoc; onChanged: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const contentQ = useQuery({
    queryKey: ['doc-link-content', link.id],
    queryFn: () => docsApi.getLinkedContent(link.id),
  });

  const refresh = useMutation({
    mutationFn: () => docsApi.refreshLinked(link.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-link-content', link.id] });
      onChanged();
      toast.success('Refreshed from source');
    },
    onError: () => toast.error('Refresh failed'),
  });

  const unlink = useMutation({
    mutationFn: () => docsApi.unlink(link.id),
    onSuccess: () => {
      onChanged();
      toast.success('Unlinked');
    },
    onError: () => toast.error('Unlink failed'),
  });

  return (
    <div className="flex flex-col max-h-[520px]">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <ExternalLink className="w-3 h-3 text-purple-300 shrink-0" />
          <h3 className="text-sm font-semibold text-white truncate">{link.title}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setExpanded(true)}><Maximize2 className="w-3 h-3 mr-1" /> Expand</Button>
          <Button size="sm" variant="ghost" onClick={() => refresh.mutate()} loading={refresh.isPending}><RefreshCw className="w-3 h-3 mr-1" /> Refresh</Button>
          <a href={link.externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 px-2 py-1">
            Source <ExternalLink className="w-3 h-3" />
          </a>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm(`Unlink "${link.title}"?`)) unlink.mutate(); }}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 prose prose-invert prose-sm max-w-none">
        {contentQ.isLoading ? (
          <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Pulling content…</div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentQ.data?.markdown ?? '_(no content)_'}</ReactMarkdown>
        )}
      </div>
      <div className="px-4 py-2 border-t border-white/5 text-[10px] text-slate-500 flex items-center justify-between">
        <span>{link.install.pluginId === 'clickup' ? 'ClickUp' : link.install.pluginId} · {link.externalId}{link.pageId ? ` · page ${link.pageId.slice(0, 6)}` : ''}</span>
        <span>{link.cachedAt ? `Cached ${new Date(link.cachedAt).toLocaleString()}` : 'Not yet cached'}</span>
      </div>
      <DocViewerModal open={expanded} onClose={() => setExpanded(false)} docKind="linked" docId={link.id} link={link} onRefresh={() => refresh.mutate()} />
    </div>
  );
}

// ── CreateLocalDocModal ──────────────────────────────────────────────────────

function CreateLocalDocModal({ scope, scopeId, onClose }: { scope: DocScopeKind; scopeId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('# New doc\n\n');

  const create = useMutation({
    mutationFn: () => docsApi.createLocal(scope, scopeId, { title: title.trim(), markdown }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['docs', 'local', scope, scopeId] });
      toast.success('Doc created');
      onClose();
    },
    onError: () => toast.error('Create failed'),
  });

  return (
    <Modal open onClose={onClose} title="New doc" size="lg">
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Title</span>
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Auth flow notes" className="mt-1 block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Markdown</span>
          <textarea value={markdown} onChange={(e) => setMarkdown(e.target.value)} className="mt-1 block w-full h-[260px] bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-xs font-mono text-white resize-none" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending} loading={create.isPending}>Create</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── LinkExternalDocModal ─────────────────────────────────────────────────────

function LinkExternalDocModal({ scope, scopeId, orgId, onClose }: { scope: DocScopeKind; scopeId: string; orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [picked, setPicked] = useState<{ install: PluginInstall; doc: { externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string; updatedAt?: string } } | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);

  // Debounce the query before it becomes part of the queryKey — typeahead
  // was firing one search per keystroke × N installs and tripping the
  // global throttle in dev. 300ms is enough to feel snappy.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId),
    staleTime: 30_000,
  });
  const docInstalls = (installsQ.data ?? []).filter((i) => i.isEnabled && i.lastHealthOk);

  // Pull the bound space + folder from the cascade — the v3 docs endpoint
  // returns the entire workspace history otherwise, burying the relevant
  // docs under hundreds of unrelated ones. Routing-hint already does the
  // walk, just adds spaceId/folderId fields.
  const routingPath =
    scope === 'feature' ? `features/${scopeId}`
      : scope === 'module' ? `modules/${scopeId}`
        : scope === 'test' ? null  // test routing not implemented yet — falls through to unfiltered
          : `projects/${scopeId}`;
  const routingQ = useQuery({
    queryKey: ['clickup-routing', scope, scopeId],
    queryFn: () => api.get<{ workspaceId: string | null; spaceId: string | null; folderId: string | null }>(`/api/v1/${routingPath}/clickup-routing`).then((r) => r.data).catch(() => null),
    enabled: !!routingPath,
    staleTime: 30_000,
  });

  const scopeFilter = routingQ.data
    ? {
        // workspaceId is critical for multi-workspace PATs — without it
        // the backend falls back to getTeams()[0] which can be a different
        // workspace than the bound one, returning unrelated docs.
        workspaceId: routingQ.data.workspaceId ?? undefined,
        spaceId: routingQ.data.spaceId ?? undefined,
        folderId: routingQ.data.folderId ?? undefined,
      }
    : undefined;

  const searchQ = useQuery({
    queryKey: ['doc-search', orgId, debouncedQuery, docInstalls.map((i) => i.id).join(','), scopeFilter?.spaceId, scopeFilter?.folderId],
    queryFn: async () => {
      const results: Array<{ install: PluginInstall; doc: { externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string; updatedAt?: string } }> = [];
      for (const i of docInstalls) {
        try {
          const r = await docsApi.searchRemoteDocs(orgId, i.id, {
            query: debouncedQuery,
            limit: 100,
            parent: scopeFilter,
          });
          for (const d of r.items ?? []) results.push({ install: i, doc: d });
        } catch {
          // best-effort across installs
        }
      }
      return results;
    },
    enabled: docInstalls.length > 0 && !picked,
  });

  const pagesQ = useQuery({
    queryKey: ['doc-pages', picked?.install.id, picked?.doc.externalId],
    queryFn: () => docsApi.getDocPages(orgId, picked!.install.id, picked!.doc.externalId),
    enabled: !!picked,
  });

  const link = useMutation({
    mutationFn: () =>
      docsApi.link(scope, scopeId, {
        installId: picked!.install.id,
        externalId: picked!.doc.externalId,
        externalUrl: picked!.doc.externalUrl,
        title: picked!.doc.title,
        summary: picked!.doc.summary,
        pageId: pageId ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-links', scope, scopeId] });
      toast.success('Doc linked');
      onClose();
    },
    onError: () => toast.error('Link failed'),
  });

  return (
    <Modal open onClose={onClose} title="Link an external doc" size="lg">
      {!picked ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Search by title, or paste a ClickUp doc URL / id (e.g. <code className="text-slate-300">38kmh-117495</code>)
            to jump straight to it. Pick a specific page on the next step.
          </p>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Type at least 2 characters…" className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white" />
          </div>
          {searchQ.isLoading ? (
            <div className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading docs…</div>
          ) : (searchQ.data ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">{query ? 'No matches.' : 'No docs found in scope.'}</p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {(searchQ.data ?? []).map((item, idx) => (
                <li
                  key={`${item.install.id}-${item.doc.externalId}-${item.doc.pageId ?? 'doc'}-${idx}`}
                  className="px-3 py-2 hover:bg-white/3 cursor-pointer"
                  onClick={() => {
                    setPicked(item);
                    if (item.doc.pageId) setPageId(item.doc.pageId);
                  }}
                >
                  <div className="text-sm text-slate-100 flex items-center gap-1.5">
                    {item.doc.title}
                    {item.doc.pageId && <span className="text-[9px] uppercase tracking-wide text-purple-300 px-1 py-0.5 rounded bg-purple-500/10 border border-purple-500/30">page</span>}
                  </div>
                  {item.doc.summary && <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{item.doc.summary}</div>}
                  {/* Footer line — ClickUp lets multiple docs share a name; show
                      external id + updatedAt so duplicates are distinguishable
                      at a glance instead of looking like cache bugs. */}
                  <div className="text-[10px] text-slate-500 mt-1">
                    {item.install.pluginId === 'clickup' ? 'ClickUp' : item.install.pluginId} · {item.doc.externalId}
                    {item.doc.updatedAt && <> · updated {formatRelativeDate(item.doc.updatedAt)}</>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg p-3 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <FolderOpen className="w-4 h-4 text-purple-300 mt-0.5" />
            <div className="text-xs text-slate-300 flex-1">
              <div className="font-medium">{picked.doc.title}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{picked.doc.externalId}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setPicked(null); setPageId(null); }}>Change</Button>
          </div>

          <div>
            <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Link target</span>
            <div className="mt-1 space-y-1.5">
              <button type="button" onClick={() => setPageId(null)} className="w-full text-left px-3 py-2 rounded-md text-sm" style={{ background: pageId === null ? 'rgba(139,92,246,0.16)' : 'rgba(255,255,255,0.03)', border: `1px solid ${pageId === null ? 'rgba(139,92,246,0.40)' : 'rgba(255,255,255,0.07)'}` }}>
                <div className="text-slate-100">Whole doc</div>
                <div className="text-[11px] text-slate-500 mt-0.5">All pages stitched into a single markdown body.</div>
              </button>
              {pagesQ.isLoading ? (
                <div className="text-xs text-slate-400 flex items-center gap-2 px-3 py-2"><Loader2 className="w-3 h-3 animate-spin" />Loading pages…</div>
              ) : (pagesQ.data?.items ?? []).length > 1 ? (
                <div className="rounded-md max-h-[200px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                  {(pagesQ.data?.items ?? []).map((p) => (
                    <button key={p.id} type="button" onClick={() => setPageId(p.id)} className="w-full text-left px-3 py-1.5 hover:bg-white/3" style={{ background: pageId === p.id ? 'rgba(139,92,246,0.16)' : undefined }}>
                      <div className="text-sm text-slate-200">{p.label}</div>
                      <div className="text-[10px] text-slate-500">{p.id}</div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 px-3">Single-page doc — whole-doc link is the only option.</p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={link.isPending}>Cancel</Button>
            <Button onClick={() => link.mutate()} loading={link.isPending}><Link2 className="w-3 h-3" /> Link</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Short relative-time string used to disambiguate same-named docs in the
 * search results. "3d ago", "2mo ago", etc. Falls back to "—" on bad input.
 */
function formatRelativeDate(iso: string | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
