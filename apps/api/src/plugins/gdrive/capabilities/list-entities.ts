import type { PluginCtx } from '../../types';
import type { ListEntitiesInput, ListEntitiesOutput } from '../../capabilities/list-entities.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, FOLDER_MIME, isFolderMime } from '../gdrive.client';
import { assertInScope } from '../scope';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * Browse Drive for the folder picker + linked-folder views. Kinds:
 *
 *   - 'roots'           → top-level entry points: "My Drive" plus each shared
 *                         drive the account belongs to. The user drills into one.
 *   - 'folders'         → folders only (access-scope picker / subfolder nav).
 *   - 'folder-children' → folders + files inside parent.folderId.
 *
 * Shared-drive awareness: `parent.driveId` scopes the query to that shared
 * drive (corpora='drive'); My Drive uses the default corpora. When a folderId
 * is given without a driveId (e.g. a linked shared-drive folder), we detect the
 * drive from the folder's metadata so traversal still works.
 *
 * Every explicit folderId is scope-checked (no-op in 'entire' mode).
 */
export async function listEntities(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<ListEntitiesOutput> {
  const input = (payload ?? {}) as ListEntitiesInput;
  const client = new GoogleDriveClient(ctx.http);
  const folderId = input.parent?.folderId;
  let driveId = input.parent?.driveId;

  // ── Top-level entry points: My Drive + shared drives ──────────────────────
  if (input.kind === 'roots') {
    const items: ListEntitiesOutput['items'] = [
      { id: 'root', label: 'My Drive', meta: { isFolder: true, isRoot: true } },
    ];
    // Shared drives only apply in 'entire' access mode — 'folders' mode scopes
    // to an allow-list of My Drive folders.
    if (ctx.config.accessMode !== 'folders') {
      try {
        const drives = await client.listDrives();
        for (const d of drives) {
          items.push({ id: d.id, label: d.name, meta: { isFolder: true, isSharedDrive: true, driveId: d.id } });
        }
      } catch {
        /* shared drives are optional — never fail the picker over them */
      }
    }
    return { items };
  }

  if (input.kind !== 'folders' && input.kind !== 'folder-children') {
    throw new PluginPermanentError(`Unknown listEntities kind: ${input.kind}`, 'gdrive');
  }

  const realFolder = folderId && folderId !== 'root';
  if (realFolder) await assertInScope(client, ctx.config, folderId!);

  // Detect the shared drive if the caller didn't thread it through (linked
  // shared-drive folder views only carry the folderId).
  if (realFolder && !driveId) {
    const meta = await client.getFile(folderId!).catch(() => null);
    if (meta?.driveId) driveId = meta.driveId;
  }

  const foldersOnly = input.kind === 'folders';
  const clauses = ['trashed = false'];
  clauses.push(folderId ? `'${folderId.replace(/'/g, "\\'")}' in parents` : `'root' in parents`);
  if (foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`);
  if (input.query?.trim()) clauses.push(`name contains '${input.query.trim().replace(/'/g, "\\'")}'`);

  const { files, nextPageToken } = await client.listFiles({
    q: clauses.join(' and '),
    pageSize: input.limit ?? 100,
    orderBy: 'folder,name',
    driveId,
  });

  return {
    items: files.map((f) => ({
      id: f.id,
      label: f.name,
      meta: {
        mimeType: f.mimeType,
        isFolder: isFolderMime(f.mimeType),
        webViewLink: f.webViewLink,
        modifiedTime: f.modifiedTime,
        iconLink: f.iconLink,
        // Thread the drive context down so the next drill stays in this drive.
        driveId: f.driveId ?? driveId,
      },
    })),
    nextCursor: nextPageToken,
  };
}
