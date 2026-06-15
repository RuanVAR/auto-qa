import type { PluginCtx } from '../../types';
import type { ListEntitiesInput, ListEntitiesOutput } from '../../capabilities/list-entities.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, FOLDER_MIME, isFolderMime } from '../gdrive.client';
import { assertInScope } from '../scope';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * Browse Drive for the binding-picker cascades + the folder browser. Two kinds:
 *
 *   - 'folders'         → folders only, for the access-scope folder picker and
 *                         for navigating into subfolders. parent.folderId =
 *                         subfolders of that folder; absent = top-level (My
 *                         Drive root).
 *   - 'folder-children' → everything (folders + files) inside parent.folderId,
 *                         for the in-app folder view of a linked folder.
 *
 * Every request that names a folderId is scope-checked. The 'folders' picker
 * with no parent (install-time, before a scope is saved) is allowed so the
 * admin can choose what to allow-list.
 */
export async function listEntities(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<ListEntitiesOutput> {
  const input = (payload ?? {}) as ListEntitiesInput;
  const client = new GoogleDriveClient(ctx.http);
  const folderId = input.parent?.folderId;

  if (input.kind !== 'folders' && input.kind !== 'folder-children') {
    throw new PluginPermanentError(`Unknown listEntities kind: ${input.kind}`, 'gdrive');
  }

  // Scope-gate any explicit folder. (The folder picker browsing top-level in
  // 'entire' mode has no folderId and needs no gate.)
  if (folderId) await assertInScope(client, ctx.config, folderId);

  const foldersOnly = input.kind === 'folders';
  const clauses = ['trashed = false'];
  clauses.push(folderId ? `'${folderId.replace(/'/g, "\\'")}' in parents` : `'root' in parents`);
  if (foldersOnly) clauses.push(`mimeType = '${FOLDER_MIME}'`);
  if (input.query?.trim()) clauses.push(`name contains '${input.query.trim().replace(/'/g, "\\'")}'`);

  const { files, nextPageToken } = await client.listFiles({
    q: clauses.join(' and '),
    pageSize: input.limit ?? 100,
    orderBy: 'folder,name',
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
      },
    })),
    nextCursor: nextPageToken,
  };
}
