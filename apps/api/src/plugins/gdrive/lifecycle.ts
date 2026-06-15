import type { PluginCtx } from '../types';
import type { GdriveInstallConfig, GdriveSecrets } from './schemas';
import { GoogleDriveClient } from './gdrive.client';

/**
 * `drive/v3/about` returns the connected account identity — doubles as the
 * cheapest "creds + connectivity work" probe. Runs through the same http
 * client as every dispatch, so a dead refresh token surfaces here as a
 * PluginAuthError (resolveAuthHeader throws) and flips the install unhealthy.
 */
export async function gdriveHealthCheck(
  ctx: PluginCtx<GdriveInstallConfig, GdriveSecrets>,
): Promise<{ ok: boolean; error?: string; connectedAs?: string }> {
  try {
    const client = new GoogleDriveClient(ctx.http);
    const about = await client.about();
    const email = about.user?.emailAddress;
    return { ok: true, connectedAs: email ?? about.user?.displayName ?? 'Google account' };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
