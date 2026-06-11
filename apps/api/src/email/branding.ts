/**
 * Email branding — single source of truth for the visuals used in every
 * outgoing email. Override per-deployment via env vars. The MJML layout
 * pulls these values into the header / footer so a re-brand is a config
 * change, not a template edit.
 *
 * For now, logo can be either:
 *   - An https URL (preferred for production — image fetches are reliable
 *     across email clients).
 *   - An emoji fallback rendered as text (used in dev / Ethereal where
 *     hosting an image asset isn't worth it).
 */

export interface Branding {
  appName: string;
  tagline: string;
  primaryColor: string;       // accent — buttons + headings
  textColor: string;
  mutedTextColor: string;
  backgroundColor: string;
  /** Either a URL or a single emoji/character to use as a fallback. */
  logoUrl: string | null;
  logoFallback: string;       // shown when logoUrl is null (e.g. "⚡")
  supportEmail: string;
  webBaseUrl: string;         // used to build CTAs ("Open dashboard")
}

import { webUrl } from '../common/config/urls';
import { appName } from '../common/config/app';

export function loadBranding(env: NodeJS.ProcessEnv): Branding {
  return {
    appName: appName(env),
    tagline: env.EMAIL_TAGLINE ?? 'Automated & manual testing, one platform',
    primaryColor: env.EMAIL_PRIMARY_COLOR ?? '#7c3aed',
    textColor: env.EMAIL_TEXT_COLOR ?? '#0f172a',
    mutedTextColor: env.EMAIL_MUTED_COLOR ?? '#64748b',
    backgroundColor: env.EMAIL_BG_COLOR ?? '#f8fafc',
    // Default to the AdVantage app icon served by the web app (absolute URL so
    // it resolves in email clients). Overridable via EMAIL_LOGO_URL.
    logoUrl: env.EMAIL_LOGO_URL || `${webUrl()}/brand/app-icon-192.png`,
    logoFallback: env.EMAIL_LOGO_FALLBACK ?? 'A',
    supportEmail: env.EMAIL_SUPPORT ?? 'support@advantage.local',
    webBaseUrl: webUrl(),
  };
}
