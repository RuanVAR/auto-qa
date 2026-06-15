import type { PluginCtx } from '../../types';
import type { FetchDocBinaryInput, FetchDocBinaryOutput } from '../../capabilities/fetch-doc-binary.types';
import type { GdriveInstallConfig, GdriveSecrets } from '../schemas';
import { GoogleDriveClient, isGoogleNative, isFolderMime } from '../gdrive.client';
import { assertInScope } from '../scope';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * Stream the raw bytes of a binary Drive file (PDF, image). Google-native docs
 * have no bytes — they export to HTML via fetchDoc instead, so reject them.
 */
export async function fetchDocBinary(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
  payload: unknown,
): Promise<FetchDocBinaryOutput> {
  const { externalId } = (payload ?? {}) as FetchDocBinaryInput;
  if (!externalId) throw new PluginPermanentError('fetchDocBinary requires externalId', 'gdrive');

  const client = new GoogleDriveClient(ctx.http);
  await assertInScope(client, ctx.config, externalId);

  const file = await client.getFile(externalId);
  if (isFolderMime(file.mimeType) || isGoogleNative(file.mimeType)) {
    throw new PluginPermanentError(
      `${file.mimeType} has no raw bytes to stream (use fetchDoc for Google-native docs).`,
      'gdrive',
    );
  }

  const { buffer, contentType } = await client.downloadMedia(externalId);
  return { buffer, contentType: file.mimeType || contentType, filename: file.name };
}
