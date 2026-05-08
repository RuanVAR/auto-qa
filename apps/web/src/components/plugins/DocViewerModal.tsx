import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Loader2, RefreshCw, FileText } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { docsApi, type LinkedDoc, type LocalDoc } from '@/lib/api';

/**
 * Big-modal renderer for any doc kind (linked or local). Used from the
 * scoped docs panel and the testing view "view context" sheet so the
 * tester can read the full spec without leaving the run.
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
  link?: LinkedDoc;             // required when docKind === 'linked'
  onRefresh?: () => void;       // hook for the linked refresh button
}) {
  const localQ = useQuery({
    queryKey: ['docs', 'local-full', docId],
    queryFn: () => docsApi.getLocal(docId),
    enabled: open && docKind === 'local',
  });
  const linkedContentQ = useQuery({
    queryKey: ['doc-link-content', docId],
    queryFn: () => docsApi.getLinkedContent(docId),
    enabled: open && docKind === 'linked',
  });

  const title = docKind === 'local'
    ? localQ.data?.title ?? 'Doc'
    : link?.title ?? 'Doc';
  const markdown = docKind === 'local'
    ? localQ.data?.markdown ?? ''
    : linkedContentQ.data?.markdown ?? '';
  const isLoading = docKind === 'local' ? localQ.isLoading : linkedContentQ.isLoading;

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="flex items-center justify-between mb-3 -mt-1">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {docKind === 'linked' ? (
            <>
              <ExternalLink className="w-3 h-3 text-purple-300" />
              <span>{link?.install.pluginId === 'clickup' ? 'ClickUp' : link?.install.pluginId} · {link?.externalId}{link?.pageId ? ` · page ${link.pageId.slice(0, 6)}` : ''}</span>
            </>
          ) : (
            <>
              <FileText className="w-3 h-3 text-slate-400" />
              <span>Local doc{(localQ.data as LocalDoc | undefined)?.editor ? ` · by ${(localQ.data as LocalDoc).editor!.name}` : ''}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {docKind === 'linked' && onRefresh && (
            <Button size="sm" variant="ghost" onClick={onRefresh}><RefreshCw className="w-3 h-3 mr-1" /> Refresh</Button>
          )}
          {docKind === 'linked' && link?.externalUrl && (
            <a href={link.externalUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 px-2 py-1">
              Open in source <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
      <div className="rounded-lg p-5 max-h-[70vh] overflow-y-auto prose prose-invert max-w-none" style={{ background: 'rgba(0,0,0,0.20)', border: '1px solid rgba(255,255,255,0.05)' }}>
        {isLoading ? (
          <div className="text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
        ) : markdown ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        ) : (
          <div className="text-xs text-slate-500">No content.</div>
        )}
      </div>
    </Modal>
  );
}
