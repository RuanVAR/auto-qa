import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Loader2, RefreshCw, FileText, Folder, File as FileIcon, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { docsApi, type LinkedDoc, type LocalDoc, type DriveEntity } from '@/lib/api';

/**
 * Big-modal renderer for any doc kind (linked or local). For linked docs the
 * server tells us a `renderKind`:
 *   - 'markdown' → ReactMarkdown (ClickUp + default)
 *   - 'html'     → exported Google-native HTML in a sandboxed iframe
 *   - 'binary'   → PDF/image fetched as a blob and iframed
 *   - 'folder'   → a browsable file list of the linked Drive folder
 */
export function DocViewerModal({
  open,
  onClose,
  docKind,
  docId,
  link,
  onRefresh,
}: {
  open: boolean;
  onClose: () => void;
  docKind: 'local' | 'linked';
  docId: string;
  link?: LinkedDoc;
  onRefresh?: () => void;
}) {
  const localQ = useQuery({
    queryKey: ['docs', 'local-full', docId],
    queryFn: () => docsApi.getLocal(docId),
    enabled: open && docKind === 'local',
  });
  const linkedContentQ = useQuery({
    queryKey: ['doc-link-content', docId],
    queryFn: () => docsApi.getLinkedContent(docId),
    // Folder + binary links carry no markdown body, but /content still returns
    // metadata + the renderKind, so fetch for every linked kind.
    enabled: open && docKind === 'linked',
  });

  const renderKind = linkedContentQ.data?.renderKind ?? 'markdown';
  const title = docKind === 'local' ? localQ.data?.title ?? 'Doc' : link?.title ?? 'Doc';
  const markdown = docKind === 'local' ? localQ.data?.markdown ?? '' : linkedContentQ.data?.markdown ?? '';
  const isLoading = docKind === 'local' ? localQ.isLoading : linkedContentQ.isLoading;

  const sourceLabel =
    link?.install.pluginId === 'clickup' ? 'ClickUp'
      : link?.install.pluginId === 'gdrive' ? 'Google Drive'
      : link?.install.pluginId;

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="flex items-center justify-between mb-3 -mt-1">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {docKind === 'linked' ? (
            <>
              <ExternalLink className="w-3 h-3 text-purple-300" />
              <span>{sourceLabel} · {link?.externalId}{link?.pageId ? ` · page ${link.pageId.slice(0, 6)}` : ''}</span>
            </>
          ) : (
            <>
              <FileText className="w-3 h-3 text-slate-400" />
              <span>Local doc{(localQ.data as LocalDoc | undefined)?.editor ? ` · by ${(localQ.data as LocalDoc).editor!.name}` : ''}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {docKind === 'linked' && onRefresh && renderKind === 'markdown' && (
            <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="w-3 h-3 mr-1" /> Refresh</Button>
          )}
          {docKind === 'linked' && link?.externalUrl && (
            <a href={link.externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 px-2 py-1">
              Open in source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg p-5 text-xs text-slate-500 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.05)' }}>
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : docKind === 'linked' && renderKind === 'binary' ? (
        <BinaryPreview srcKey={docId} loadBlob={() => docsApi.getLinkedRaw(docId)} title={title} mimeType={linkedContentQ.data?.externalMimeType ?? link?.externalMimeType} externalUrl={link?.externalUrl} />
      ) : docKind === 'linked' && renderKind === 'folder' ? (
        <FolderView linkId={docId} />
      ) : docKind === 'linked' && renderKind === 'html' ? (
        <iframe
          // Sandboxed: render the exported HTML but block scripts/top-nav.
          sandbox="allow-same-origin"
          srcDoc={markdown}
          title={title}
          className="w-full rounded-lg bg-white"
          style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }}
        />
      ) : (
        <div className="rounded-lg p-5 max-h-[70vh] overflow-y-auto prose prose-invert max-w-none" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.05)' }}>
          {markdown ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown> : <div className="text-xs text-slate-500">No content.</div>}
        </div>
      )}
    </Modal>
  );
}

/**
 * In-app preview for a binary linked doc — fetches the JWT-protected bytes from
 * /raw (so it works regardless of the viewer's own Google login) and renders by
 * type, fully client-side:
 *   - PDF / image           → native <iframe>
 *   - Word (.docx)          → docx-preview (lazy-loaded)
 *   - Excel (.xlsx / .xls)  → SheetJS → HTML tables (lazy-loaded)
 *   - anything else (.pptx) → "no in-app preview" + open-in-source / download
 */
export function BinaryPreview({ loadBlob, srcKey, title, mimeType, externalUrl }: { loadBlob: () => Promise<Blob>; srcKey: string; title: string; mimeType?: string | null; externalUrl?: string }) {
  const mime = (mimeType ?? '').toLowerCase();
  const isPdfOrImage = mime === 'application/pdf' || mime.startsWith('image/');
  const isDocx = mime.includes('wordprocessingml') || mime === 'application/msword';
  const isXlsx = mime.includes('spreadsheetml') || mime.includes('ms-excel');

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed' | 'unsupported'>('loading');
  const docxRef = useRef<HTMLDivElement>(null);
  const xlsxRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadBlob is recreated each render; srcKey is the stable identity.
  useEffect(() => {
    if (!isPdfOrImage && !isDocx && !isXlsx) { setStatus('unsupported'); return; }
    let cancelled = false;
    let created: string | null = null;
    setStatus('loading'); setBlobUrl(null);
    loadBlob()
      .then(async (blob) => {
        if (cancelled) return;
        if (isPdfOrImage) {
          created = URL.createObjectURL(blob);
          setBlobUrl(created);
          setStatus('ready');
        } else if (isDocx) {
          const { renderAsync } = await import('docx-preview');
          if (cancelled || !docxRef.current) return;
          docxRef.current.innerHTML = '';
          await renderAsync(blob, docxRef.current, undefined, { inWrapper: true, ignoreWidth: true, ignoreHeight: true });
          if (!cancelled) setStatus('ready');
        } else if (isXlsx) {
          const XLSX = await import('xlsx');
          const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' });
          // sheet_to_html HTML-escapes cell values; we inject into our own ref
          // (not dangerouslySetInnerHTML) to render one table per sheet.
          const html = wb.SheetNames
            .map((n) => `<h4 style="margin:14px 0 6px;font-weight:600">${n}</h4>${XLSX.utils.sheet_to_html(wb.Sheets[n])}`)
            .join('');
          if (cancelled || !xlsxRef.current) return;
          xlsxRef.current.innerHTML = html;
          setStatus('ready');
        }
      })
      .catch(() => { if (!cancelled) setStatus('failed'); });
    return () => { cancelled = true; if (created) URL.revokeObjectURL(created); };
  }, [srcKey, isPdfOrImage, isDocx, isXlsx]);

  const loader = (
    <div className="rounded-lg p-5 text-xs text-slate-500 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.20)' }}>
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading file…
    </div>
  );

  if (status === 'failed') return <div className="rounded-lg p-5 text-xs text-red-300" style={{ background: 'rgba(0,0,0,0.20)' }}>Could not load the file.</div>;
  if (status === 'unsupported') {
    return (
      <div className="rounded-lg p-5 text-xs text-slate-400 flex flex-col items-start gap-2" style={{ background: 'rgba(0,0,0,0.20)' }}>
        <span>No in-app preview for this file type.</span>
        {externalUrl && (
          <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-purple-300 hover:text-purple-200 inline-flex items-center gap-1">
            Open in source <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  if (isDocx) {
    // The container must stay mounted for renderAsync to target it.
    return (
      <div className="rounded-lg bg-white text-black overflow-auto" style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }}>
        {status === 'loading' && <div className="p-5 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading document…</div>}
        <div ref={docxRef} />
      </div>
    );
  }
  if (isXlsx) {
    // The container must stay mounted for the effect to inject the tables.
    return (
      <div
        className="rounded-lg bg-white text-black overflow-auto p-3 [&_table]:border-collapse [&_td]:border [&_td]:border-slate-300 [&_td]:px-2 [&_td]:py-1 [&_td]:text-xs"
        style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        {status === 'loading' && <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading spreadsheet…</div>}
        <div ref={xlsxRef} />
      </div>
    );
  }
  // PDF / image
  if (status !== 'ready' || !blobUrl) return loader;
  return <iframe src={blobUrl} title={title} className="w-full rounded-lg bg-white" style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }} />;
}

/**
 * Browsable list of the files inside a linked Google Drive folder. Subfolders
 * drill in-place (breadcrumb to go back); files open in-app in a preview modal
 * instead of navigating out to Drive.
 */
export function FolderView({ linkId }: { linkId: string }) {
  // Empty stack = the linked folder root; each entry is a drilled subfolder.
  const [stack, setStack] = useState<Array<{ id: string; name: string }>>([]);
  const [viewing, setViewing] = useState<DriveEntity | null>(null);
  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const q = useQuery({
    queryKey: ['doc-link-folder', linkId, current?.id ?? 'root'],
    queryFn: () => docsApi.getFolderChildren(linkId, current?.id),
  });
  const items: DriveEntity[] = q.data?.items ?? [];

  return (
    <div className="rounded-lg p-2 max-h-[70vh] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {stack.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap px-1 pb-1.5 mb-1 border-b border-white/5">
          <button type="button" className="hover:text-slate-200" onClick={() => setStack([])}>Folder</button>
          {stack.map((s, i) => (
            <span key={s.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3 h-3 text-slate-600" />
              <button type="button" className="hover:text-slate-200 truncate max-w-[160px]" onClick={() => setStack(stack.slice(0, i + 1))}>{s.name}</button>
            </span>
          ))}
        </div>
      )}
      {q.isLoading ? (
        <div className="p-3 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading folder…</div>
      ) : items.length === 0 ? (
        <div className="p-3 text-xs text-slate-500">This folder is empty.</div>
      ) : (
        items.map((it) => {
          const isFolder = !!it.meta?.isFolder;
          return (
            <div key={it.id} className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-200 hover:bg-white/5">
              <button
                type="button"
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
                onClick={() => (isFolder ? setStack([...stack, { id: it.id, name: it.label }]) : setViewing(it))}
              >
                {isFolder ? <Folder className="w-4 h-4 text-amber-300 shrink-0" /> : <FileIcon className="w-4 h-4 text-slate-400 shrink-0" />}
                <span className="flex-1 truncate">{it.label}</span>
                {isFolder && <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
              </button>
              <a
                href={it.meta?.webViewLink ?? `https://drive.google.com/file/d/${it.id}/view`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Google Drive"
                className="shrink-0 text-slate-500 hover:text-slate-300"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          );
        })
      )}
      {viewing && <DriveFilePreviewModal linkId={linkId} file={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

/**
 * In-app preview for a single file that lives inside a linked folder. The file
 * has no DocLink of its own, so it's fetched through the folder link's install:
 *   - Google-native (Doc/Sheet/Slide) → exported HTML in a sandboxed iframe
 *   - everything else (PDF/Office/image) → BinaryPreview via /children/:id/raw
 */
function DriveFilePreviewModal({ linkId, file, onClose }: { linkId: string; file: DriveEntity; onClose: () => void }) {
  const mime = file.meta?.mimeType ?? '';
  const isGoogleNative = mime.startsWith('application/vnd.google-apps.') && !file.meta?.isFolder;
  const externalUrl = file.meta?.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;

  const htmlQ = useQuery({
    queryKey: ['doc-link-child-content', linkId, file.id],
    queryFn: () => docsApi.getChildContent(linkId, file.id),
    enabled: isGoogleNative,
  });

  return (
    <Modal open onClose={onClose} title={file.label} size="xl">
      <div className="flex items-center justify-end mb-3 -mt-1">
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 px-2 py-1">
          Open in source <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {isGoogleNative ? (
        htmlQ.isLoading ? (
          <div className="rounded-lg p-5 text-xs text-slate-500 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.20)' }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : (
          <iframe
            sandbox="allow-same-origin"
            srcDoc={htmlQ.data?.markdown ?? ''}
            title={file.label}
            className="w-full rounded-lg bg-white"
            style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }}
          />
        )
      ) : (
        <BinaryPreview
          srcKey={`${linkId}:${file.id}`}
          loadBlob={() => docsApi.getChildRaw(linkId, file.id)}
          title={file.label}
          mimeType={mime}
          externalUrl={externalUrl}
        />
      )}
    </Modal>
  );
}
