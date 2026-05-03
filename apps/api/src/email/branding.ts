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

export function loadBranding(env: NodeJS.ProcessEnv): Branding {
  return {
    appName: env.EMAIL_APP_NAME ?? 'QA Platform',
    tagline: env.EMAIL_TAGLINE ?? 'Automated & manual testing, one platform',
    primaryColor: env.EMAIL_PRIMARY_COLOR ?? '#7c3aed',
    textColor: env.EMAIL_TEXT_COLOR ?? '#0f172a',
    mutedTextColor: env.EMAIL_MUTED_COLOR ?? '#64748b',
    backgroundColor: env.EMAIL_BG_COLOR ?? '#f8fafc',
    logoUrl: env.EMAIL_LOGO_URL || null,
    logoFallback: env.EMAIL_LOGO_FALLBACK ?? '⚡',
    supportEmail: env.EMAIL_SUPPORT ?? 'support@qaplatform.local',
    webBaseUrl: env.WEB_URL ?? 'http://localhost:3000',
  };
}
