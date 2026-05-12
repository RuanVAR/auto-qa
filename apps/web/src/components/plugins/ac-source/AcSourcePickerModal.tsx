import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, FolderOpen, Link2, ChevronLeft, FileText, Hash, ListOrdered, Dot } from 'lucide-react';
import { api, acLinksApi, docsApi, pluginsApi, type PluginInstall, type PageSection, type SectionItem } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

type PickedDoc = {
  install: PluginInstall;
  doc: { externalId: string; externalUrl: string; title: string; summary?: string; pageId?: string };
};

/**
 * Three-step picker for linking a test's description (AC) to a ClickUp doc
 * section.
 *   1. Search for a doc within the project's bound space/folder.
 *   2. Pick the page within that doc.
 *   3. Pick the section (heading) or "whole page".
 *
 * Same UX shell as LinkExternalDocModal in ScopedDocsPanel; differs only in
 * the third step (section picker) and the API it persists through.
 */
export function AcSourcePickerModal({
  testId,
  projectId,
  orgId,
  onClose,
}: {
  testId: string;
  projectId: string;
  orgId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [picked, setPicked] = useState<PickedDoc | null>(null);
  const [pageId, setPageId] = useState<string | null>(null);
  const [sectionSlug, setSectionSlug] = useState<string | null>(null);
  const [sectionPickedAt, setSectionPickedAt] = useState<number | null>(null); // advances to step 4
  const [itemFingerprint, setItemFingerprint] = useState<string | null>(null);
  const [pageQuery, setPageQuery] = useState('');
  const [sectionQuery, setSectionQuery] = useState('');
  const [itemQuery, setItemQuery] = useState('');

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

  // Narrow doc search to the project's bound space/folder for sane results.
  const routingQ = useQuery({
    queryKey: ['clickup-routing', 'project', projectId],
    queryFn: () => api.get<{ spaceId: string | null; folderId: string | null }>(`/api/v1/projects/${projectId}/clickup-routing`).then((r) => r.data).catch(() => null),
    staleTime: 30_000,
  });
  const scopeFilter = routingQ.data
    ? { spaceId: routingQ.data.spaceId ?? undefined, folderId: routingQ.data.folderId ?? undefined }
    : undefined;

  const searchQ = useQuery({
    queryKey: ['doc-search', orgId, debouncedQuery, docInstalls.map((i) => i.id).join(','), scopeFilter?.spaceId, scopeFilter?.folderId],
    queryFn: async () => {
      const results: PickedDoc[] = [];
      for (const i of docInstalls) {
        try {
          const r = await docsApi.searchRemoteDocs(orgId, i.id, { query: debouncedQuery, limit: 100, parent: scopeFilter });
          for (const d of r.items ?? []) results.push({ install: i, doc: d });
        } catch {
          // best-effort
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

  // Section list — only fires once a page is picked
  const sectionsQ = useQuery({
    queryKey: ['ac-source-sections', testId, picked?.install.id, picked?.doc.externalId, pageId],
    queryFn: () => acLinksApi.listSections(testId, {
      installId: picked!.install.id,
      docId: picked!.doc.externalId,
      pageId: pageId!,
    }),
    enabled: !!picked && !!pageId,
  });

  // Items list — fires once a section has been picked (step 4)
  const itemsQ = useQuery({
    queryKey: ['ac-source-items', testId, picked?.install.id, picked?.doc.externalId, pageId, sectionSlug, sectionPickedAt],
    queryFn: () => acLinksApi.listSectionItems(testId, {
      installId: picked!.install.id,
      docId: picked!.doc.externalId,
      pageId: pageId!,
      sectionSlug,
    }),
    enabled: !!picked && !!pageId && sectionPickedAt !== null,
  });

  const save = useMutation({
    mutationFn: () => {
      const sectionTitle = sectionSlug
        ? (sectionsQ.data?.sections.find((s) => s.slug === sectionSlug)?.title ?? null)
        : null;
      const item = itemFingerprint
        ? itemsQ.data?.items.find((i) => i.fingerprint === itemFingerprint)
        : undefined;
      const externalUrl = sectionsQ.data?.externalUrl ?? picked!.doc.externalUrl;
      return acLinksApi.set(testId, {
        installId: picked!.install.id,
        docId: picked!.doc.externalId,
        pageId: pageId!,
        sectionSlug,
        pageTitle: sectionsQ.data?.pageTitle ?? picked!.doc.title,
        sectionTitle,
        itemFingerprint: itemFingerprint ?? null,
        itemTitle: item?.title ?? null,
        externalUrl,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ac-source', testId] });
      toast.success('AC source linked');
      onClose();
    },
    onError: () => toast.error('Link failed'),
  });

  // Step indicator
  const step = !picked ? 1 : !pageId ? 2 : sectionPickedAt === null ? 3 : 4;
  const title = step === 1 ? 'Find ClickUp doc'
    : step === 2 ? 'Pick a page'
    : step === 3 ? 'Pick a section'
    : 'Pick an item';

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-[11px] mb-3" style={{ color: 'rgba(238,238,248,0.50)' }}>
        <span className={step === 1 ? 'text-purple-300 font-medium' : ''}>1. Doc</span>
        <ChevronLeft size={10} className="rotate-180" />
        <span className={step === 2 ? 'text-purple-300 font-medium' : ''}>2. Page</span>
        <ChevronLeft size={10} className="rotate-180" />
        <span className={step === 3 ? 'text-purple-300 font-medium' : ''}>3. Section</span>
        <ChevronLeft size={10} className="rotate-180" />
        <span className={step === 4 ? 'text-purple-300 font-medium' : ''}>4. Item</span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Search for a ClickUp doc within this project&apos;s scope. The section you pick will be used as this test&apos;s acceptance criteria.</p>
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
                  className="px-3 py-2 hover:bg-white/5 cursor-pointer"
                  onClick={() => {
                    setPicked(item);
                    if (item.doc.pageId) setPageId(item.doc.pageId);
                  }}
                >
                  <div className="text-sm text-slate-100 flex items-center gap-1.5">
                    <FileText size={11} className="text-purple-300" />
                    {item.doc.title}
                    {item.doc.pageId && <span className="text-[9px] uppercase tracking-wide text-purple-300 px-1 py-0.5 rounded bg-purple-500/10 border border-purple-500/30">page</span>}
                  </div>
                  {item.doc.summary && <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{item.doc.summary}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {step === 2 && picked && (() => {
        const pages = pagesQ.data?.items ?? [];
        const needle = pageQuery.trim().toLowerCase();
        const filtered = needle ? pages.filter((p) => p.label.toLowerCase().includes(needle)) : pages;
        return (
          <div className="space-y-3">
            <DocChip picked={picked} onChange={() => { setPicked(null); setPageId(null); setSectionSlug(null); setSectionPickedAt(null); setItemFingerprint(null); setPageQuery(''); setSectionQuery(''); setItemQuery(''); }} />
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={pageQuery}
                onChange={(e) => setPageQuery(e.target.value)}
                placeholder="Filter pages…"
                className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white"
              />
            </div>
            {pagesQ.isLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2 px-3 py-2"><Loader2 className="w-3 h-3 animate-spin" />Loading pages…</div>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-slate-400 px-3 py-2">{needle ? 'No pages match.' : 'No pages in this doc.'}</p>
            ) : (
              <div className="rounded-md max-h-[360px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPageId(p.id)}
                    className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                  >
                    <div className="text-sm text-slate-200 flex items-center gap-1.5"><FileText size={11} className="text-purple-300" />{p.label}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {step === 3 && picked && pageId && (() => {
        const sections = sectionsQ.data?.sections ?? [];
        const needle = sectionQuery.trim().toLowerCase();
        const filtered = needle ? sections.filter((s) => s.title.toLowerCase().includes(needle)) : sections;
        const advance = (slug: string | null) => { setSectionSlug(slug); setItemFingerprint(null); setSectionPickedAt(Date.now()); };
        return (
        <div className="space-y-3">
          <DocChip picked={picked} onChange={() => { setPicked(null); setPageId(null); setSectionSlug(null); setSectionPickedAt(null); setItemFingerprint(null); setPageQuery(''); setSectionQuery(''); setItemQuery(''); }} />
          <p className="text-xs text-slate-400">
            Pick the section that contains your acceptance criteria. You&apos;ll choose a specific item next.
          </p>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={sectionQuery}
              onChange={(e) => setSectionQuery(e.target.value)}
              placeholder="Filter sections…"
              className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white"
            />
          </div>

          <div className="space-y-1.5">
            {!needle && (
              <button
                type="button"
                onClick={() => advance(null)}
                className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-white/5"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <div className="text-slate-100">Whole page</div>
                <div className="text-[11px] text-slate-500 mt-0.5">No section filter — pick from all top-level items on the page.</div>
              </button>
            )}

            {sectionsQ.isLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2 px-3 py-2"><Loader2 className="w-3 h-3 animate-spin" />Loading sections…</div>
            ) : sections.length === 0 ? (
              <p className="text-[11px] text-slate-500 px-3 py-2">No headings in this page — use whole page above.</p>
            ) : filtered.length === 0 ? (
              <p className="text-[11px] text-slate-500 px-3 py-2">No sections match.</p>
            ) : (
              <div className="rounded-md max-h-[320px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                {filtered.map((s: PageSection) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => advance(s.slug)}
                    className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                    style={{ paddingLeft: `${12 + (s.level - 1) * 14}px` }}
                  >
                    <div className="text-sm text-slate-200 flex items-center gap-1.5">
                      <Hash size={10} className="text-purple-300" />
                      {s.title}
                      <span className="text-[9px] text-slate-500">H{s.level}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
        );
      })()}

      {step === 4 && picked && pageId && (() => {
        const items = itemsQ.data?.items ?? [];
        const needle = itemQuery.trim().toLowerCase();
        const filtered = needle ? items.filter((i) => i.title.toLowerCase().includes(needle) || i.preview.toLowerCase().includes(needle)) : items;
        const sectionLabel = sectionSlug
          ? sectionsQ.data?.sections.find((s) => s.slug === sectionSlug)?.title ?? 'Selected section'
          : 'Whole page';
        return (
        <div className="space-y-3">
          <DocChip picked={picked} onChange={() => { setPicked(null); setPageId(null); setSectionSlug(null); setSectionPickedAt(null); setItemFingerprint(null); setPageQuery(''); setSectionQuery(''); setItemQuery(''); }} />

          <div className="flex items-center justify-between rounded-lg p-2.5" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.22)' }}>
            <div className="text-xs flex items-center gap-1.5 min-w-0">
              <Hash size={10} className="text-purple-300 shrink-0" />
              <span className="text-purple-100 font-medium truncate">{sectionLabel}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => { setSectionPickedAt(null); setItemFingerprint(null); setItemQuery(''); }}>Change section</Button>
          </div>

          <p className="text-xs text-slate-400">
            Pick the specific AC item that this test verifies. We&apos;ll anchor the link to the item&apos;s title — it survives reordering, breaks on rename.
          </p>

          {items.length > 0 && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                placeholder="Filter items…"
                className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white"
              />
            </div>
          )}

          <div className="space-y-1.5">
            {!needle && (
              <button
                type="button"
                onClick={() => setItemFingerprint(null)}
                className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors"
                style={{
                  background: itemFingerprint === null ? 'rgba(139,92,246,0.16)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${itemFingerprint === null ? 'rgba(139,92,246,0.40)' : 'rgba(255,255,255,0.07)'}`,
                }}
              >
                <div className="text-slate-100">
                  {items.length > 0 ? 'Whole section (all items)' : 'Whole section'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {items.length > 0 ? `Includes all ${items.length} items in this section.` : 'No list items detected — link the full section content.'}
                </div>
              </button>
            )}

            {itemsQ.isLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2 px-3 py-2"><Loader2 className="w-3 h-3 animate-spin" />Loading items…</div>
            ) : filtered.length === 0 && needle ? (
              <p className="text-[11px] text-slate-500 px-3 py-2">No items match.</p>
            ) : items.length > 0 ? (
              <div className="rounded-md max-h-[320px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
                {filtered.map((i: SectionItem) => (
                  <button
                    key={i.fingerprint}
                    type="button"
                    onClick={() => setItemFingerprint(i.fingerprint)}
                    className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors"
                    style={{
                      background: itemFingerprint === i.fingerprint ? 'rgba(139,92,246,0.16)' : undefined,
                    }}
                  >
                    <div className="text-sm text-slate-200 flex items-start gap-1.5">
                      {i.marker === 'ordered'
                        ? <ListOrdered size={11} className="text-purple-300 mt-0.5 shrink-0" />
                        : <Dot size={14} className="text-purple-300 mt-px shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">
                          {i.marker === 'ordered' && <span className="text-purple-300 mr-1">{i.index}.</span>}
                          {i.title}
                        </div>
                        {i.preview && (
                          <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{i.preview}</div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              <Link2 className="w-3 h-3" /> Link {itemFingerprint ? 'item' : 'section'}
            </Button>
          </div>
        </div>
        );
      })()}
    </Modal>
  );
}

function DocChip({ picked, onChange }: { picked: PickedDoc; onChange: () => void }) {
  return (
    <div className="rounded-lg p-2.5 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <FolderOpen className="w-4 h-4 text-purple-300 mt-0.5" />
      <div className="text-xs text-slate-300 flex-1 min-w-0">
        <div className="font-medium truncate">{picked.doc.title}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{picked.doc.externalId}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onChange}>Change</Button>
    </div>
  );
}
