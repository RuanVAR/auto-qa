import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orgsApi, authApi } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';

/**
 * Platform display name. Build-time fallback from VITE_APP_NAME (wired from the
 * API's APP_NAME env), default "AdVantage". The live name is fetched from the
 * API at runtime via usePlatformBranding(); use usePlatformName() in components
 * and PLATFORM_NAME in non-hook / first-paint contexts.
 */
export const PLATFORM_NAME = (import.meta.env.VITE_APP_NAME as string | undefined) || 'AdVantage';
const DEFAULT_TITLE = PLATFORM_NAME;

export interface ResolvedBranding {
  /** null → caller uses the built-in "AdVantage" text. */
  name: string | null;
  /** null → caller uses the built-in shield asset. */
  logoUrl: string | null;
  /** Brand accent hex (#rrggbb); null → built-in purple. */
  primaryColor: string | null;
}

// Built-in accent — must match --accent in index.css (the CSS fallback).
const BUILTIN_ACCENT = '#7c3aed';

/** "#7c3aed" → "124, 58, 237" (the channel form --accent-rgb expects). null if invalid. */
function hexToRgbChannels(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/**
 * Apply (or clear) the brand accent at runtime by overriding the --accent /
 * --accent-rgb CSS variables on <html>. Every accent token derives from these
 * (see index.css), so the whole app recolours instantly. Passing null/invalid
 * removes the override → the index.css default (#7c3aed) applies.
 */
export function applyAccent(color?: string | null): void {
  const root = document.documentElement;
  const channels = color ? hexToRgbChannels(color) : null;
  if (color && channels) {
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-rgb', channels);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-rgb');
  }
}

/** Captured once, lazily, so we can restore the platform favicon when no
 *  org logo is active (e.g. after logout or for orgs without branding). */
let originalIcons: { el: HTMLLinkElement; href: string }[] | null = null;

function iconLinks(): HTMLLinkElement[] {
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="apple-touch-icon"]'),
  );
}

/**
 * Apply org branding to the browser chrome (tab title + favicon).
 * - title  → "<Org> — AdVantage" (falls back to the platform title)
 * - favicon → the org logo when set, else the original platform icons
 *
 * Imperative variant so non-hook contexts (auth pages on first paint) can
 * call it too.
 */
export function applyDocumentBranding(opts: { name?: string | null; logoUrl?: string | null }): void {
  document.title = opts.name ? `${opts.name} — ${PLATFORM_NAME}` : DEFAULT_TITLE;

  const links = iconLinks();
  if (originalIcons === null) {
    originalIcons = links.map((el) => ({ el, href: el.href }));
  }
  if (opts.logoUrl) {
    links.forEach((l) => { l.href = opts.logoUrl as string; });
  } else {
    originalIcons.forEach(({ el, href }) => { el.href = href; });
  }
}

/** React hook wrapper — re-applies whenever the org name/logo changes. */
export function useDocumentBranding(opts: { name?: string | null; logoUrl?: string | null }): void {
  useEffect(() => {
    applyDocumentBranding(opts);
  }, [opts.name, opts.logoUrl]);
}

/**
 * Platform-wide default branding (set by a platform admin), from the public
 * /auth/config endpoint. Cached via react-query — works pre- and post-login.
 */
export function usePlatformBranding(): { logoUrl: string | null; appName: string | null; primaryColor?: string | null } | null {
  const { data } = useQuery({
    queryKey: ['auth-config'],
    queryFn: authApi.getConfig,
    staleTime: 5 * 60 * 1000,
  });
  return data?.branding ?? null;
}

/**
 * The platform name to show in the UI: the API-provided name (driven by the
 * APP_NAME env / platform-admin branding) when available, else the build-time
 * VITE_APP_NAME fallback. Use this anywhere the product name is displayed.
 */
export function usePlatformName(): string {
  return usePlatformBranding()?.appName || PLATFORM_NAME;
}

/**
 * The resolved branding for the signed-in app, in precedence order:
 *   active org → platform default → built-in AdVantage.
 * Returns nulls where the caller should use the built-in shield / "AdVantage".
 */
export function useResolvedBranding(): ResolvedBranding {
  const org = useActiveOrg()?.org;
  const platform = usePlatformBranding();
  return {
    logoUrl: org?.logoUrl || platform?.logoUrl || null,
    name: org?.name || platform?.appName || null,
    primaryColor: org?.primaryColor || platform?.primaryColor || null,
  };
}

/**
 * Apply the active org's brand accent app-wide (→ platform default → built-in).
 * Call once near the app root (Shell); re-applies whenever the active org's
 * colour changes (e.g. on org switch or after saving on the Branding page).
 */
export function useApplyAccent(): void {
  const { primaryColor } = useResolvedBranding();
  useEffect(() => {
    applyAccent(primaryColor);
  }, [primaryColor]);
}

/**
 * Pre-login branding for the login/register pages. The platform-wide default
 * (set by a platform admin) is ALWAYS the baseline. A specific org's branding
 * only overrides it when reached via an explicit `?org=<slug>` link (e.g. a
 * branded login/invite link the org shares) — we deliberately do NOT silently
 * brand the shared login page from whatever org this browser last used, so the
 * platform name is what visitors see by default. Applies the result to the tab
 * title + favicon and returns it so the page can render the logo + name.
 */
export function usePreloginBranding(slugParam?: string | null): ResolvedBranding | null {
  const platform = usePlatformBranding();
  const [orgBranding, setOrgBranding] = useState<ResolvedBranding | null>(null);

  useEffect(() => {
    let active = true;
    const slug = slugParam || null;
    if (!slug) {
      setOrgBranding(null);
      return;
    }
    orgsApi.publicBranding(slug)
      .then((b) => { if (active) setOrgBranding({ name: b.name, logoUrl: b.logoUrl, primaryColor: b.primaryColor ?? null }); })
      .catch(() => { if (active) setOrgBranding(null); });
    return () => { active = false; };
  }, [slugParam]);

  // Resolution: org-slug branding → platform default → built-in.
  const resolved: ResolvedBranding | null = orgBranding
    ?? (platform ? { name: platform.appName, logoUrl: platform.logoUrl, primaryColor: platform.primaryColor ?? null } : null);

  // Keep the tab title + favicon + accent in step with whatever we resolved.
  useEffect(() => {
    applyDocumentBranding({ name: resolved?.name ?? null, logoUrl: resolved?.logoUrl ?? null });
    applyAccent(resolved?.primaryColor ?? null);
  }, [resolved?.name, resolved?.logoUrl, resolved?.primaryColor]);

  return resolved;
}
