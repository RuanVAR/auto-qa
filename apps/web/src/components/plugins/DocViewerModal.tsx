import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Loader2, RefreshCw, FileText, Folder, File as FileIcon } from 'lucide-react';
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
        <BinaryPreview linkId={docId} title={title} />
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

/** PDF/image preview — fetch the JWT-protected bytes as a blob, then iframe it. */
function BinaryPreview({ linkId, title }: { linkId: string; title: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;
    setBlobUrl(null);
    setFailed(false);
    docsApi.getLinkedRaw(linkId)
      .then((blob) => {
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [linkId]);

  if (failed) return <div className="rounded-lg p-5 text-xs text-red-300" style={{ background: 'rgba(0,0,0,0.20)' }}>Could not load the file.</div>;
  if (!blobUrl) return <div className="rounded-lg p-5 text-xs text-slate-500 flex items-center gap-2" style={{ background: 'rgba(0,0,0,0.20)' }}><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading file…</div>;
  return <iframe src={blobUrl} title={title} className="w-full rounded-lg bg-white" style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.05)' }} />;
}

/** Browsable list of the files inside a linked Google Drive folder. */
function FolderView({ linkId }: { linkId: string }) {
  const q = useQuery({
    queryKey: ['doc-link-folder', linkId],
    queryFn: () => docsApi.getFolderChildren(linkId),
  });
  const items: DriveEntity[] = q.data?.items ?? [];
  return (
    <div className="rounded-lg p-2 max-h-[70vh] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {q.isLoading ? (
        <div className="p-3 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading folder…</div>
      ) : items.length === 0 ? (
        <div className="p-3 text-xs text-slate-500">This folder is empty.</div>
      ) : (
        items.map((it) => (
          <a
            key={it.id}
            href={it.meta?.webViewLink ?? `https://drive.google.com/file/d/${it.id}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-200 hover:bg-white/5"
          >
            {it.meta?.isFolder ? <Folder className="w-4 h-4 text-amber-300" /> : <FileIcon className="w-4 h-4 text-slate-400" />}
            <span className="flex-1 truncate">{it.label}</span>
            <ExternalLink className="w-3 h-3 text-slate-500" />
          </a>
        ))
      )}
    </div>
  );
}
