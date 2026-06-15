import type { PluginCtx } from '../../types';
import type { ListEntitiesInput, ListEntitiesOutput } from '../../capabilities/list-entities.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, FOLDER_MIME, isFolderMime } from '../gdrive.client';
import { assertInScope } from '../scope';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * Browse Drive. Two audiences:
 *
 * MEMBER (scoped — only ever sees the install's base folders):
 *   - 'roots'           → the configured base folders (the allow-list). In the
 *                         legacy 'entire' mode this is My Drive + shared drives.
 *   - 'folders'         → folders only inside parent.folderId.
 *   - 'folder-children' → folders + files inside parent.folderId.
 *
 * ADMIN config picker (UNSCOPED — used to CHOOSE the base folders, so it must
 * see the whole Drive; reached only via the ORG_ADMIN dispatch endpoint):
 *   - 'config-roots'    → My Drive + every shared drive, to start picking.
 *   - 'config-children' → folders inside parent.folderId (drive-aware).
 *
 * Shared-drive context (`parent.driveId`) scopes a query to that shared drive.
 */
export async function listEntities(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<ListEntitiesOutput> {
  const input = (payload ?? {}) as ListEntitiesInput;
  const client = new GoogleDriveClient(ctx.http);
  const folderId = input.parent?.folderId;
  let driveId = input.parent?.driveId;

  // ── My Drive + shared drives as entry points (used by both the admin config
  //    picker and the legacy 'entire' member roots) ──────────────────────────
  const driveEntryPoints = async (): Promise<ListEntitiesOutput['items']> => {
    const items: ListEntitiesOutput['items'] = [
      { id: 'root', label: 'My Drive', meta: { isFolder: true, isRoot: true } },
    ];
    try {
      for (const d of await client.listDrives()) {
        items.push({ id: d.id, label: d.name, meta: { isFolder: true, isSharedDrive: true, driveId: d.id } });
      }
    } catch {
      /* shared drives optional */
    }
    return items;
  };

  // ── ADMIN config picker (unscoped) ─────────────────────────────────────────
  if (input.kind === 'config-roots') {
    return { items: await driveEntryPoints() };
  }
  if (input.kind === 'config-children') {
    if (folderId && folderId !== 'root' && !driveId) {
      const meta = await client.getFile(folderId).catch(() => null);
      if (meta?.driveId) driveId = meta.driveId;
    }
    return listFolders(client, folderId, driveId, input);
  }

  // ── MEMBER roots → the configured base folders ─────────────────────────────
  if (input.kind === 'roots') {
    if (ctx.config.accessMode === 'entire') return { items: await driveEntryPoints() };
    // 'folders' mode: surface each configured base folder (resolve its name).
    const items: ListEntitiesOutput['items'] = [];
    for (const id of ctx.config.allowedFolderIds) {
      const meta = await client.getFile(id).catch(() => null);
      items.push({
        id,
        label: meta?.name ?? id,
        meta: { isFolder: true, isBaseFolder: true, driveId: meta?.driveId },
      });
    }
    return { items };
  }

  if (input.kind !== 'folders' && input.kind !== 'folder-children') {
    throw new PluginPermanentError(`Unknown listEntities kind: ${input.kind}`, 'gdrive');
  }

  // ── MEMBER scoped browse ───────────────────────────────────────────────────
  const realFolder = folderId && folderId !== 'root';
  if (realFolder) await assertInScope(client, ctx.config, folderId!);
  if (realFolder && !driveId) {
    const meta = await client.getFile(folderId!).catch(() => null);
    if (meta?.driveId) driveId = meta.driveId;
  }
  return listFolders(client, folderId, driveId, input, input.kind === 'folder-children');
}

/** Shared list helper for folder browsing. `withFiles` includes non-folders. */
async function listFolders(
  client: GoogleDriveClient,
  folderId: string | undefined,
  driveId: string | undefined,
  input: ListEntitiesInput,
  withFiles = false,
): Promise<ListEntitiesOutput> {
  const clauses = ['trashed = false'];
  clauses.push(folderId ? `'${folderId.replace(/'/g, "\\'")}' in parents` : `'root' in parents`);
  if (!withFiles) clauses.push(`mimeType = '${FOLDER_MIME}'`);
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
        driveId: f.driveId ?? driveId,
      },
    })),
    nextCursor: nextPageToken,
  };
}
