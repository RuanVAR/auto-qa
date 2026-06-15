import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Folder, ChevronRight, HardDrive, X, Check, Plus } from 'lucide-react';
import { docsApi, pluginsApi, type DriveEntity, type PluginInstall } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * ORG_ADMIN base-folder picker for a Google Drive install.
 *
 * Browses the FULL Drive (My Drive + shared drives) so the admin can pick one
 * or more BASE FOLDERS. Everything the rest of the org can browse / link /
 * preview is scoped to these folders' subtrees — nothing else in the (possibly
 * personal) Drive is ever exposed. An install with no base folders is unusable.
 */
export function GoogleDriveFolderConfig({
  orgId, install, onClose,
}: {
  orgId: string;
  install: PluginInstall;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const installId = install.id;
  const connectedEmail = (install.config as { connectedEmail?: string } | null)?.connectedEmail;

  const [path, setPath] = useState<Array<{ id: string; name: string; driveId?: string }>>([]);
  // Selected base folders: id → display name.
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [seeded, setSeeded] = useState(false);

  const current = path.length > 0 ? path[path.length - 1] : null;

  // Existing base folders (resolved names) to seed the selection.
  const currentQ = useQuery({
    queryKey: ['gdrive-base-folders', orgId, installId],
    queryFn: () => docsApi.driveListEntities(orgId, installId, { kind: 'roots' }),
  });
  useMemo(() => {
    if (seeded || !currentQ.data) return;
    const m = new Map<string, string>();
    for (const e of currentQ.data.items) m.set(e.id, e.label);
    setSelected(m);
    setSeeded(true);
  }, [currentQ.data, seeded]);

  const browseQ = useQuery({
    queryKey: ['gdrive-config-browse', orgId, installId, current?.id ?? 'roots', current?.driveId ?? ''],
    queryFn: () =>
      pluginsApi.gdriveConfigBrowse(orgId, installId, current
        ? { kind: 'config-children', parent: { folderId: current.id, driveId: current.driveId } }
        : { kind: 'config-roots' }),
  });

  const save = useMutation({
    mutationFn: () => pluginsApi.gdriveSetBaseFolders(orgId, installId, [...selected.keys()], connectedEmail),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins', 'installs', orgId] });
      qc.invalidateQueries({ queryKey: ['gdrive-base-folders', orgId, installId] });
      toast.success('Base folders saved', `${selected.size} folder${selected.size === 1 ? '' : 's'} now available to the org.`);
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Save failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const toggle = (e: DriveEntity) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(e.id)) next.delete(e.id);
      else next.set(e.id, e.label);
      return next;
    });
  };

  const items = browseQ.data?.items ?? [];

  return (
    <Modal open onClose={onClose} title="Choose base folders" size="lg">
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          Pick the folder(s) the whole organisation may browse, link, and preview. Only these folders
          and their contents are ever exposed — nothing else in the connected Drive.
        </p>

        {/* Selected base folders */}
        <div className="rounded-lg p-2.5" style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.20)' }}>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Base folders ({selected.size})</div>
          {selected.size === 0 ? (
            <div className="text-xs text-amber-300/90">None yet — pick at least one below, or the plugin stays unusable.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[...selected.entries()].map(([id, name]) => (
                <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px]" style={{ background: 'rgba(var(--accent-rgb),0.18)', color: '#e9d5ff', border: '1px solid rgba(var(--accent-rgb),0.32)' }}>
                  <Folder className="w-3 h-3" /> {name}
                  <button onClick={() => setSelected((p) => { const n = new Map(p); n.delete(id); return n; })} title="Remove"><X className="w-3 h-3 opacity-70 hover:opacity-100" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-wrap min-w-0">
          <button className="hover:text-slate-200" onClick={() => setPath([])}>Drives</button>
          {path.map((p, i) => (
            <span key={p.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="w-3 h-3 text-slate-600" />
              <button className="hover:text-slate-200 truncate max-w-[140px]" onClick={() => setPath(path.slice(0, i + 1))}>{p.name}</button>
            </span>
          ))}
        </div>

        {/* Folder list */}
        <div className="rounded-lg max-h-[360px] overflow-y-auto" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
          {browseQ.isLoading ? (
            <div className="p-4 text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…</div>
          ) : items.length === 0 ? (
            <div className="p-4 text-xs text-slate-500">No folders here.</div>
          ) : (
            items.map((e) => {
              const isRootEntry = e.meta?.isRoot || e.meta?.isSharedDrive;
              const picked = selected.has(e.id);
              return (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2 border-b border-white/5 last:border-0 hover:bg-white/5">
                  {e.meta?.isSharedDrive ? <HardDrive className="w-4 h-4 text-sky-300" /> : e.meta?.isRoot ? <HardDrive className="w-4 h-4 text-emerald-300" /> : <Folder className="w-4 h-4 text-amber-300" />}
                  <button className="flex-1 truncate text-left text-sm text-slate-200 hover:text-white" onClick={() => setPath([...path, { id: e.id, name: e.label, driveId: e.meta?.driveId }])} title="Open folder">
                    {e.label}
                  </button>
                  {/* "My Drive" itself isn't selectable as a base folder — only real folders / shared drives. */}
                  {e.id !== 'root' && (
                    <button
                      onClick={() => toggle(e)}
                      className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px]"
                      style={picked
                        ? { background: 'rgba(16,185,129,0.16)', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)' }
                        : { background: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.7)', border: '1px solid rgba(255,255,255,0.12)' }}
                      title={picked ? 'Remove base folder' : 'Add as base folder'}
                    >
                      {picked ? <><Check className="w-3 h-3" /> Added</> : <><Plus className="w-3 h-3" /> {isRootEntry ? 'Add drive' : 'Add'}</>}
                    </button>
                  )}
                  <button className="shrink-0 text-slate-500 hover:text-slate-300" onClick={() => setPath([...path, { id: e.id, name: e.label, driveId: e.meta?.driveId }])} title="Open"><ChevronRight className="w-4 h-4" /></button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save base folders</Button>
        </div>
      </div>
    </Modal>
  );
}
