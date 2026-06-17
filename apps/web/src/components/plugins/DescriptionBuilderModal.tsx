import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Search, Loader2, Folder, File as FileIcon, ChevronRight, HardDrive, ChevronLeft, CheckSquare, Square, FileText } from 'lucide-react';
import { docsApi, pluginsApi, type DriveEntity, type PluginInstall } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * Small reusable trigger placed next to a description field. Opens the builder
 * and appends the chosen markdown to the current value (replaces when empty).
 * Renders nothing when there's no active org.
 */
export function BuildFromDocButton({ current, onChange, size = 'sm' }: { current: string; onChange: (next: string) => void; size?: 'sm' | 'xs' }) {
  const org = useActiveOrg();
  const [open, setOpen] = useState(false);
  if (!org) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-purple-300 hover:text-purple-200"
        style={{ fontSize: size === 'xs' ? 11 : 12 }}
      >
        <FileText className="w-3 h-3" /> Build from doc
      </button>
      {open && (
        <DescriptionBuilderModal
          orgId={org.orgId}
          onClose={() => setOpen(false)}
          onInsert={(md) => onChange(current.trim() ? `${current.trimEnd()}\n\n${md}` : md)}
        />
      )}
    </>
  );
}

type PickedFile = { installId: string; externalId: string; title: string; mimeType?: string };

/**
 * Build a description from a doc's sections. Pick a Drive file (browse the
 * org's base folders, or search) or a ClickUp doc → the server converts it to
 * markdown and splits it into heading sections → tick the sections you want →
 * insert them into the description being edited. One-shot: the result is plain
 * markdown in the field, no live link.
 */
export function DescriptionBuilderModal({ orgId, onInsert, onClose }: { orgId: string; onInsert: (markdown: string) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId),
    staleTime: 30_000,
  });
  const healthy = (installsQ.data ?? []).filter((i) => i.isEnabled && i.lastHealthOk);
  const gdrive = healthy.find((i) => i.pluginId === 'gdrive');
  const clickups = healthy.filter((i) => i.pluginId === 'clickup');

  return (
    <Modal open onClose={onClose} title="Build description from a doc" size="lg">
      {installsQ.isLoading ? (
        <div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
      ) : healthy.length === 0 ? (
        <div className="p-4 text-sm text-slate-400">
          No document sources are connected. An organisation admin can connect Google Drive or ClickUp in <span className="text-slate-200">Org → Plugins</span>.
        </div>
      ) : picked ? (
        <SectionPicker orgId={orgId} picked={picked} onBack={() => setPicked(null)} onInsert={(md) => { onInsert(md); onClose(); }} />
      ) : (
        <DocPicker orgId={orgId} gdrive={gdrive} clickups={clickups} onPick={setPicked} />
      )}
    </Modal>
  );
}

// ── Step 1: pick a doc (gdrive browse/search + clickup search) ────────────────

function DocPicker({ orgId, gdrive, clickups, onPick }: { orgId: string; gdrive?: PluginInstall; clickups: PluginInstall[]; onPick: (f: PickedFile) => void }) {
  const [path, setPath] = useState<Array<{ id: string; name: string; driveId?: string }>>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const inSearch = debounced.length > 0;
  const currentFolder = path.length > 0 ? path[path.length - 1] : null;

  // Search across every source: Drive via listDocs (carries mimeType) + each
  // ClickUp install. ClickUp rows have no mime → server treats them as markdown.
  const searchQ = useQuery({
    queryKey: ['descbuilder-search', orgId, debounced, gdrive?.id, clickups.map((c) => c.id).join(',')],
    queryFn: async () => {
      const rows: Array<{ installId: string; externalId: string; title: string; mimeType?: string }> = [];
      if (gdrive) {
        try {
          const r = await docsApi.driveSearch(orgId, gdrive.id, { query: debounced, limit: 50 });
          for (const d of r.items ?? []) rows.push({ installId: gdrive.id, externalId: d.externalId, title: d.title, mimeType: d.mimeType });
        } catch { /* best-effort */ }
      }
      for (const c of clickups) {
        try {
          const r = await docsApi.searchRemoteDocs(orgId, c.id, { query: debounced, limit: 50 });
          for (const d of r.items ?? []) rows.push({ installId: c.id, externalId: d.externalId, title: d.title });
        } catch { /* best-effort */ }
      }
      return rows;
    },
    enabled: inSearch,
  });

  // Browse Drive base folders → drill. Only available when a Drive install exists.
  const browseQ = useQuery({
    queryKey: ['descbuilder-browse', orgId, gdrive?.id, currentFolder?.id ?? 'roots', currentFolder?.driveId ?? ''],
    queryFn: () =>
      docsApi.driveListEntities(orgId, gdrive!.id, currentFolder
        ? { kind: 'folder-children', parent: { folderId: currentFolder.id, driveId: currentFolder.driveId } }
        : { kind: 'roots' }),
    enabled: !inSearch && !!gdrive,
  });

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={gdrive ? 'Search Drive + ClickUp docs by name…' : 'Search ClickUp docs by name…'}
          className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white"
        />
      </div>

      {!inSearch && gdrive && (
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap min-w-0">
          <button type="button" className="hover:text-slate-200" onClick={() => setPath([])}>Drives</button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3 h-3 text-slate-600" />
              <button type="button" className="hover:text-slate-200 truncate max-w-[140px]" onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button>
            </span>
          ))}
        </div>
      )}

      <div className="rounded-lg max-h-[400px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        {(inSearch ? searchQ.isLoading : browseQ.isLoading) ? (
          <div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : inSearch ? (
          (searchQ.data ?? []).length === 0 ? (
            <div className="p-4 text-xs text-slate-500">No docs match “{debounced}”.</div>
          ) : (
            (searchQ.data ?? []).map((f) => (
              <Row key={`${f.installId}:${f.externalId}`} icon={<FileIcon className="w-4 h-4 text-slate-400" />} label={f.title} onClick={() => onPick(f)} />
            ))
          )
        ) : !gdrive ? (
          <div className="p-4 text-xs text-slate-500">Type to search ClickUp docs.</div>
        ) : (browseQ.data?.items ?? []).length === 0 ? (
          <div className="p-4 text-xs text-slate-500">
            {path.length === 0
              ? 'No Drive folders are available. An organisation admin needs to choose base folders for Google Drive (Org → Plugins).'
              : 'This folder is empty.'}
          </div>
        ) : (
          (browseQ.data?.items ?? []).map((e: DriveEntity) => {
            const isFolder = !!e.meta?.isFolder;
            const icon = e.meta?.isSharedDrive
              ? <HardDrive className="w-4 h-4 text-sky-300" />
              : e.meta?.isRoot
                ? <HardDrive className="w-4 h-4 text-emerald-300" />
                : isFolder
                  ? <Folder className="w-4 h-4 text-amber-300" />
                  : <FileIcon className="w-4 h-4 text-slate-400" />;
            return (
              <Row
                key={e.id}
                icon={icon}
                label={e.label}
                trailing={isFolder ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : undefined}
                onClick={() => (isFolder
                  ? setPath([...path, { id: e.id, name: e.label, driveId: e.meta?.driveId }])
                  : onPick({ installId: gdrive.id, externalId: e.id, title: e.label, mimeType: e.meta?.mimeType }))}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Step 2: convert + pick sections ───────────────────────────────────────────

function SectionPicker({ orgId, picked, onBack, onInsert }: { orgId: string; picked: PickedFile; onBack: () => void; onInsert: (md: string) => void }) {
  const convertQ = useQuery({
    queryKey: ['descbuilder-convert', orgId, picked.installId, picked.externalId],
    queryFn: () => docsApi.convertDoc(orgId, picked.installId, { externalId: picked.externalId, mimeType: picked.mimeType }),
    retry: false,
  });
  const sections = convertQ.data?.sections ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [wholeDoc, setWholeDoc] = useState(false);

  // Default to whole-document when the doc has no detectable headings.
  useEffect(() => {
    if (convertQ.data && sections.length === 0) setWholeDoc(true);
  }, [convertQ.data, sections.length]);

  const assembled = useMemo(() => {
    if (wholeDoc) return (convertQ.data?.markdown ?? '').trim();
    return sections
      .filter((s) => selected.has(s.slug))
      .map((s) => `${'#'.repeat(Math.min(s.level, 6))} ${s.title}\n\n${s.content}`.trim())
      .join('\n\n')
      .trim();
  }, [wholeDoc, selected, sections, convertQ.data]);

  const toggle = (slug: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(slug)) next.delete(slug); else next.add(slug);
    return next;
  });
  const allSelected = sections.length > 0 && selected.size === sections.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(sections.map((s) => s.slug)));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1"><ChevronLeft className="w-3.5 h-3.5" /> Back</button>
        <div className="text-xs text-slate-400 truncate min-w-0">{picked.title}</div>
      </div>

      {convertQ.isLoading ? (
        <div className="p-6 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Converting document…</div>
      ) : convertQ.isError ? (
        <div className="p-4 text-xs text-red-300" style={{ background: 'rgba(0,0,0,0.20)', borderRadius: 8 }}>Could not convert this document. It may be too large or an unsupported type.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* Section list */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Sections</span>
              {sections.length > 0 && (
                <button type="button" onClick={toggleAll} className="text-[11px] text-purple-300 hover:text-purple-200" disabled={wholeDoc}>{allSelected ? 'Clear all' : 'Select all'}</button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-200 px-2 py-1.5 rounded-md hover:bg-white/5 cursor-pointer">
              <input type="checkbox" checked={wholeDoc} onChange={(e) => setWholeDoc(e.target.checked)} className="accent-purple-500" />
              Whole document
            </label>
            <div className="rounded-lg max-h-[320px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)', opacity: wholeDoc ? 0.4 : 1, pointerEvents: wholeDoc ? 'none' : 'auto' }}>
              {sections.length === 0 ? (
                <div className="p-3 text-xs text-slate-500">No headings detected — use “Whole document”.</div>
              ) : (
                sections.map((s) => (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => toggle(s.slug)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 border-b border-white/5 last:border-0"
                    style={{ paddingLeft: `${8 + (s.level - 1) * 14}px` }}
                  >
                    {selected.has(s.slug) ? <CheckSquare className="w-4 h-4 text-purple-300 shrink-0" /> : <Square className="w-4 h-4 text-slate-500 shrink-0" />}
                    <span className="flex-1 truncate text-sm text-slate-200">{s.title}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Live preview */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Preview</span>
            <div className="rounded-lg p-3 max-h-[358px] overflow-y-auto prose prose-invert prose-sm max-w-none" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {assembled ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{assembled}</ReactMarkdown> : <div className="text-xs text-slate-500">Select sections to preview.</div>}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>Back</Button>
        <Button onClick={() => onInsert(assembled)} disabled={!assembled}>Insert into description</Button>
      </div>
    </div>
  );
}

function Row({ icon, label, trailing, onClick }: { icon: React.ReactNode; label: string; trailing?: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 border-b border-white/5 last:border-0">
      {icon}
      <span className="flex-1 truncate text-sm text-slate-200">{label}</span>
      {trailing}
    </button>
  );
}
