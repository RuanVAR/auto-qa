import axios from 'axios';
import { apiUrl } from '../../common/config/urls';
import { googleClientId, googleClientSecret } from '../../common/config/app';

/**
 * Google OAuth2 (authorization-code) helpers for the Drive plugin.
 *
 * The platform registers ONE Google OAuth client (GOOGLE_CLIENT_ID/SECRET);
 * each org connects its own Google account through it and we store that org's
 * refresh token (encrypted). Access tokens are minted on demand and cached.
 *
 * Scopes: read-only Drive (browse/preview/export) + email (for connectedAs).
 */
export const GDRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';

/**
 * The single redirect URI Google calls back. FIXED (no orgId in the path):
 * Google's authorized-redirect-URI list is exact-match with no path wildcards,
 * so a per-org URL couldn't be registered. The org is carried in `state`
 * instead (stashed in Redis at /start, read back here at /callback). Allow-list
 * this exact value in the GCP OAuth client; derived from API_URL per env.
 */
export function gdriveRedirectUri(): string {
  return `${apiUrl()}/api/v1/gdrive/oauth/callback`;
}

/**
 * Build the Google consent URL.
 *
 * `access_type=offline` + `prompt=consent` are BOTH required: without them
 * Google omits the refresh token on any re-authorisation, leaving the install
 * unable to mint access tokens. `state` is an opaque nonce we validate on
 * callback (CSRF + carries the pending-install context via Redis).
 */
export function buildConsentUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: gdriveRedirectUri(),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GDRIVE_SCOPES.join(' '),
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

/** Exchange an authorization code for tokens (yields the refresh token). */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { data } = await axios.post<TokenResponse>(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      code,
      grant_type: 'authorization_code',
      redirect_uri: gdriveRedirectUri(),
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  );
  return data;
}

/**
 * Exchange a refresh token for a fresh access token. Throws on `invalid_grant`
 * (revoked/expired refresh token) so the caller can flip the install unhealthy.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await axios.post<TokenResponse>(
    TOKEN_ENDPOINT,
    new URLSearchParams({
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, validateStatus: () => true },
  );
  if (res.status !== 200) {
    const err = (res.data as unknown as { error?: string; error_description?: string }) ?? {};
    throw new GoogleTokenError(err.error ?? `token_refresh_failed_${res.status}`, err.error_description);
  }
  return res.data;
}

/** Fetch the connected account's email — used for the healthcheck `connectedAs`. */
export async function getUserInfo(accessToken: string): Promise<{ email?: string }> {
  const { data } = await axios.get<{ email?: string }>(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}

/** Distinguishes a credential failure (→ PluginAuthError upstream) from a transient one. */
export class GoogleTokenError extends Error {
  constructor(public readonly code: string, description?: string) {
    super(`Google token error: ${code}${description ? ` — ${description}` : ''}`);
    this.name = 'GoogleTokenError';
  }
  /** invalid_grant = the refresh token is dead; re-consent required. */
  get isUnrecoverable(): boolean {
    return this.code === 'invalid_grant';
  }
}
