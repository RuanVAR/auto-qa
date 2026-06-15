import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, Folder, File as FileIcon, ChevronRight, Link2, FolderPlus, HardDrive } from 'lucide-react';
import { docsApi, type DocScopeKind, type DriveEntity } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * Google Drive file/folder picker.
 *
 * - Browse: top-level folders → drill into subfolders (breadcrumb to go back),
 *   listing folders + files inside each.
 * - Search: type to search files by name across the install's allowed scope.
 * - Link a file: attaches it to the current scope (with its mime so the viewer
 *   renders it correctly).
 * - Link this folder: (project scope only) attaches the whole folder for a
 *   browsable file list.
 */
export function DriveBrowserModal({
  scope, scopeId, orgId, installId, onClose,
}: {
  scope: DocScopeKind;
  scopeId: string;
  orgId: string;
  installId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Each path entry carries the shared-drive context so descendants stay in
  // the right drive. Empty path = the roots view (My Drive + shared drives).
  const [path, setPath] = useState<Array<{ id: string; name: string; driveId?: string }>>([]);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [picked, setPicked] = useState<DriveEntity | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const inSearch = debounced.length > 0;
  const currentFolder = path.length > 0 ? path[path.length - 1] : null;

  // Search is global across My Drive + shared drives (listDocs). Browse shows
  // the roots (My Drive + shared drives) at the top, then the current folder's
  // contents, scoped to its shared drive when applicable.
  const searchQ = useQuery({
    queryKey: ['drive-search', orgId, installId, debounced],
    queryFn: () => docsApi.driveSearch(orgId, installId, { query: debounced, limit: 50 }),
    enabled: inSearch,
  });
  const browseQ = useQuery({
    queryKey: ['drive-browse', orgId, installId, currentFolder?.id ?? 'roots', currentFolder?.driveId ?? ''],
    queryFn: () =>
      docsApi.driveListEntities(orgId, installId, currentFolder
        ? { kind: 'folder-children', parent: { folderId: currentFolder.id, driveId: currentFolder.driveId } }
        : { kind: 'roots' }),
    enabled: !inSearch,
  });

  const link = useMutation({
    mutationFn: (target: { externalId: string; externalUrl: string; title: string; mimeType?: string; isFolder: boolean }) =>
      docsApi.link(scope, scopeId, {
        installId,
        externalId: target.externalId,
        externalUrl: target.externalUrl,
        title: target.title,
        externalMimeType: target.mimeType,
        isFolder: target.isFolder,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doc-links', scope, scopeId] });
      toast.success('Linked from Google Drive');
      onClose();
    },
    onError: () => toast.error('Link failed'),
  });

  const driveUrl = (id: string, isFolder: boolean) =>
    isFolder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/file/d/${id}/view`;

  return (
    <Modal open onClose={onClose} title="Add from Google Drive" size="lg">
      <div className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Drive files by name…"
            className="block w-full pl-9 pr-3 py-2 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white"
          />
        </div>

        {/* Breadcrumb + link-folder (browse mode only) */}
        {!inSearch && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap min-w-0">
              <button className="hover:text-slate-200" onClick={() => setPath([])}>Drives</button>
              {path.map((p, i) => (
                <span key={p.id} className="flex items-center gap-1 min-w-0">
                  <ChevronRight className="w-3 h-3 text-slate-600" />
                  <button className="hover:text-slate-200 truncate max-w-[140px]" onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button>
                </span>
              ))}
            </div>
            {/* Don't offer to link the whole of "My Drive" — only real folders / shared drives. */}
            {currentFolder && currentFolder.id !== 'root' && scope === 'project' && (
              <Button
                size="sm"
                variant="ghost"
                title="Link this whole folder — its files become a browsable list on the project"
                onClick={() => link.mutate({ externalId: currentFolder.id, externalUrl: driveUrl(currentFolder.id, true), title: currentFolder.name, mimeType: FOLDER_MIME, isFolder: true })}
                loading={link.isPending}
              >
                <FolderPlus className="w-3 h-3 mr-1" /> Link this folder
              </Button>
            )}
          </div>
        )}

        {/* List */}
        <div className="rounded-lg max-h-[400px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {(inSearch ? searchQ.isLoading : browseQ.isLoading) ? (
            <div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
          ) : inSearch ? (
            (searchQ.data?.items ?? []).length === 0 ? (
              <div className="p-4 text-xs text-slate-500">No files match “{debounced}”.</div>
            ) : (
              (searchQ.data?.items ?? []).map((f) => (
                <Row
                  key={f.externalId}
                  icon={<FileIcon className="w-4 h-4 text-slate-400" />}
                  label={f.title}
                  onClick={() => setPicked({ id: f.externalId, label: f.title, meta: { mimeType: f.mimeType, isFolder: false, webViewLink: f.externalUrl } })}
                />
              ))
            )
          ) : (browseQ.data?.items ?? []).length === 0 ? (
            <div className="p-4 text-xs text-slate-500">
              {path.length === 0
                ? 'No Drive folders are available. An organisation admin needs to choose base folders for the Google Drive plugin (Org → Plugins → Base folders).'
                : 'This folder is empty.'}
            </div>
          ) : (
            (browseQ.data?.items ?? []).map((e) => {
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
                    : setPicked(e))}
                />
              );
            })
          )}
        </div>

        {/* Picked-file confirm bar */}
        {picked && (
          <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.30)' }}>
            <FileIcon className="w-4 h-4 text-purple-300" />
            <div className="text-xs text-slate-200 flex-1 min-w-0">
              <div className="truncate font-medium">{picked.label}</div>
              <div className="text-[10px] text-slate-500 truncate">{picked.meta?.mimeType}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>Clear</Button>
            <Button
              size="sm"
              loading={link.isPending}
              onClick={() => link.mutate({ externalId: picked.id, externalUrl: picked.meta?.webViewLink ?? driveUrl(picked.id, false), title: picked.label, mimeType: picked.meta?.mimeType, isFolder: false })}
            >
              <Link2 className="w-3 h-3 mr-1" /> Link file
            </Button>
          </div>
        )}

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose} disabled={link.isPending}>Close</Button>
        </div>
      </div>
    </Modal>
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
