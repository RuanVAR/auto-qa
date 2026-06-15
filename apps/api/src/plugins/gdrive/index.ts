import type { PluginManifest } from '../types';
import {
  GdriveInstallConfigSchema,
  GdriveSecretsSchema,
  type GdriveInstallConfig,
  type GdriveSecrets,
} from './schemas';
import { gdriveHealthCheck } from './lifecycle';
import { refreshAccessToken, GoogleTokenError } from './oauth';
import { googleOAuthConfigured } from '../../common/config/app';
import { PluginAuthError } from '../plugin.errors';
import { listDocs } from './capabilities/list-docs';
import { fetchDoc } from './capabilities/fetch-doc';
import { fetchDocBinary } from './capabilities/fetch-doc-binary';
import { listEntities } from './capabilities/list-entities';

/**
 * Google Drive plugin — attach Drive files + link Drive folders as QA docs,
 * previewed in-app (Google-native → exported HTML; PDFs/images → streamed).
 *
 * Auth is OAuth2: the org admin connects a Google account once; we store that
 * org's refresh token (encrypted). `resolveAuthHeader` mints a short-lived
 * access token per dispatch and caches it in Redis until ~1 min before expiry.
 *
 * Access scope (install config): 'entire' = everything the connected account
 * can see; 'folders' = an admin-curated allow-list, enforced server-side in
 * every capability handler (see scope.ts).
 */
export const gdriveManifest: PluginManifest<GdriveInstallConfig, GdriveSecrets> = {
  id: 'gdrive',
  name: 'Google Drive',
  description:
    'Attach Google Drive files and link Drive folders to projects, modules, and features — browse and preview docs without leaving the platform.',
  version: '1.0.0',
  iconUrl: '/plugin-icons/gdrive.svg',

  capabilities: ['listDocs', 'fetchDoc', 'fetchDocBinary', 'listEntities'],

  configSchema: GdriveInstallConfigSchema,
  secretsSchema: GdriveSecretsSchema,

  baseURL: 'https://www.googleapis.com',
  // Drive per-user quotas are generous; a conservative ceiling keeps us well
  // under the per-project 12k/min limit even with several orgs active.
  rateLimit: { perMinute: 600 },

  // Installable only when the operator has set the Google OAuth client env.
  checkAvailability: () =>
    googleOAuthConfigured()
      ? { available: true }
      : {
          available: false,
          reason: 'Google OAuth is not configured on this deployment. Ask your operator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the API.',
        },

  /**
   * Exchange the stored refresh token for a short-lived access token, cached
   * in Redis (`gdrive:accesstoken:<installId>`, TTL = expires_in − 60s). A dead
   * refresh token (invalid_grant) becomes a PluginAuthError so the existing
   * dispatch path flips the install unhealthy and prompts re-consent.
   */
  resolveAuthHeader: async ({ secrets, installId, redis, logger }) => {
    const cacheKey = `gdrive:accesstoken:${installId}`;
    if (redis) {
      const cached = await redis.get(cacheKey).catch(() => null);
      if (cached) return `Bearer ${cached}`;
    }
    let token: { access_token: string; expires_in: number };
    try {
      token = await refreshAccessToken(secrets.refreshToken);
    } catch (err) {
      if (err instanceof GoogleTokenError && err.isUnrecoverable) {
        throw new PluginAuthError('Google refresh token rejected — reconnect the integration.', 'gdrive');
      }
      throw err;
    }
    if (redis) {
      const ttl = Math.max(30, (token.expires_in ?? 3600) - 60);
      await redis.set(cacheKey, token.access_token, 'EX', ttl).catch((e) => {
        logger.warn(`gdrive access-token cache write failed: ${(e as Error).message}`);
      });
    }
    return `Bearer ${token.access_token}`;
  },

  healthCheck: gdriveHealthCheck,

  handlers: {
    listDocs,
    fetchDoc,
    fetchDocBinary,
    listEntities,
  },
};
