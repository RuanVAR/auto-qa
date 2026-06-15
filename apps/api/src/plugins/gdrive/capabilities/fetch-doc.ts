import type { PluginCtx } from '../../types';
import type { FetchDocInput, FetchDocOutput } from '../../capabilities/fetch-doc.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, isGoogleNative } from '../gdrive.client';
import { assertInScope } from '../scope';
import { PluginAuthError, PluginPermanentError } from '../../plugin.errors';

/**
 * Export a Google-native doc (Doc/Sheet/Slide) to HTML for inline preview.
 *
 * Only Google-native types are handled here — they have no binary bytes and
 * MUST be exported. PDFs/images carry bytes and stream through the /raw
 * endpoint instead; calling fetchDoc on one is a caller bug → reject clearly.
 */
export async function fetchDoc(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<FetchDocOutput> {
  const { externalId } = (payload ?? {}) as FetchDocInput;
  if (!externalId) throw new PluginPermanentError('fetchDoc requires externalId', 'gdrive');

  const client = new GoogleDriveClient(ctx.http);
  await assertInScope(client, ctx.config, externalId);

  const file = await client.getFile(externalId);
  if (!isGoogleNative(file.mimeType)) {
    throw new PluginPermanentError(
      `fetchDoc only handles Google-native docs; ${file.mimeType} is a binary file (use /raw).`,
      'gdrive',
    );
  }

  let html: string;
  try {
    html = await client.exportFile(externalId, 'text/html');
  } catch (err) {
    // The shared http layer maps 403 → PluginAuthError, but Drive also returns
    // 403 for exportSizeLimitExceeded (Docs >10 MB). Disambiguate: if creds
    // still work (about() succeeds), it's a content-level limit, not auth — so
    // surface a friendly permanent error WITHOUT flipping the install unhealthy.
    if (err instanceof PluginAuthError) {
      const credsOk = await client.about().then(() => true).catch(() => false);
      if (credsOk) {
        throw new PluginPermanentError(
          'This document is too large to preview in-app. Open it in Google Drive instead.',
          'gdrive',
        );
      }
    }
    throw err;
  }

  return {
    externalId,
    externalUrl: file.webViewLink ?? `https://drive.google.com/file/d/${externalId}/view`,
    title: file.name,
    markdown: html,
    updatedAt: file.modifiedTime ?? new Date().toISOString(),
    contentType: 'html',
  };
}
