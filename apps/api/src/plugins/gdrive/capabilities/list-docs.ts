import type { PluginCtx } from '../../types';
import type { ListDocsInput, ListDocsOutput } from '../../capabilities/list-docs.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, FOLDER_MIME } from '../gdrive.client';
import { allowedParentsQuery } from '../scope';

/**
 * Search Drive for files (not folders) to link. In 'folders' mode the query
 * is constrained to the allow-listed folders' direct children so a top-level
 * search can't surface anything outside scope.
 */
export async function listDocs(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<ListDocsOutput> {
  const input = (payload ?? {}) as ListDocsInput;
  const client = new GoogleDriveClient(ctx.http);

  const clauses = ['trashed = false', `mimeType != '${FOLDER_MIME}'`];
  if (input.query?.trim()) {
    clauses.push(`name contains '${input.query.trim().replace(/'/g, "\\'")}'`);
  }
  const scopeClause = allowedParentsQuery(ctx.config);
  if (scopeClause) clauses.push(scopeClause);

  const { files, nextPageToken } = await client.listFiles({
    q: clauses.join(' and '),
    pageToken: input.cursor,
    pageSize: input.limit ?? 25,
    orderBy: 'modifiedTime desc',
    // Global search across My Drive + shared drives. Safe here because this is
    // a name/`q` search (not a `'<folderId>' in parents` traversal). In
    // 'folders' access mode the allow-list `q` constraint still scopes it.
    corpora: ctx.config.accessMode === 'folders' ? undefined : 'allDrives',
  });

  return {
    items: files.map((f) => ({
      externalId: f.id,
      externalUrl: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
      title: f.name,
      updatedAt: f.modifiedTime,
      mimeType: f.mimeType,
      isFolder: false,
    })),
    nextCursor: nextPageToken,
  };
}
