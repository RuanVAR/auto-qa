/**
 * Centralised URL helpers for emails, redirects, and CORS.
 *
 * Two reasons this exists instead of inline `process.env.WEB_URL ?? 'http://localhost:3000'`:
 *
 *   1. A missing `WEB_URL` in production is a silent disaster — invite
 *      emails ship with `http://localhost:3000/invites/...` and recipients
 *      can't accept. The boot-time assertion in `assertProdUrls()` makes
 *      this fail fast at startup instead.
 *
 *   2. When the fallback URL changes (different dev port, different scheme),
 *      we change one constant instead of grepping a dozen files.
 *
 * Usage: import { webUrl, apiUrl } from '../../common/config/urls';
 */

const DEV_WEB_URL = 'http://localhost:3000';
const DEV_API_URL = 'http://localhost:3001';

/** Public web app URL — used for email links, OAuth redirects, CORS. */
export function webUrl(): string {
  const v = process.env.WEB_URL;
  return v && v.trim().length > 0 ? v.replace(/\/$/, '') : DEV_WEB_URL;
}

/** Public API URL — used to build callback URLs (Google OAuth) and uploaded-file URLs. */
export function apiUrl(): string {
  const v = process.env.API_URL;
  return v && v.trim().length > 0 ? v.replace(/\/$/, '') : DEV_API_URL;
}

/**
 * Boot-time safety net. Called from main.ts before listen(). Throws if
 * we're in production and WEB_URL isn't configured — better to fail fast
 * than to silently mail localhost links to real users.
 */
export function assertProdUrls(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!process.env.WEB_URL || process.env.WEB_URL.trim().length === 0) missing.push('WEB_URL');
  if (!process.env.API_URL || process.env.API_URL.trim().length === 0) missing.push('API_URL');
  if (missing.length > 0) {
    throw new Error(
      `Refusing to boot in production with missing required URL env vars: ${missing.join(', ')}. ` +
      `Set them in .env.production — emails and OAuth callbacks would otherwise default to localhost.`,
    );
  }
}
