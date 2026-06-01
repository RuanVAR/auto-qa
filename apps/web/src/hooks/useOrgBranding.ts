import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { orgsApi, authApi } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';

const DEFAULT_TITLE = 'QA Automation Platform';

export interface ResolvedBranding {
  /** null → caller uses the built-in "QA Platform" text. */
  name: string | null;
  /** null → caller uses the built-in shield asset. */
  logoUrl: string | null;
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
 * - title  → "<Org> — QA Platform" (falls back to the platform title)
 * - favicon → the org logo when set, else the original platform icons
 *
 * Imperative variant so non-hook contexts (auth pages on first paint) can
 * call it too.
 */
export function applyDocumentBranding(opts: { name?: string | null; logoUrl?: string | null }): void {
  document.title = opts.name ? `${opts.name} — QA Platform` : DEFAULT_TITLE;

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
export function usePlatformBranding(): { logoUrl: string | null; appName: string | null } | null {
  const { data } = useQuery({
    queryKey: ['auth-config'],
    queryFn: authApi.getConfig,
    staleTime: 5 * 60 * 1000,
  });
  return data?.branding ?? null;
}

/**
 * The resolved branding for the signed-in app, in precedence order:
 *   active org → platform default → built-in QA Platform.
 * Returns nulls where the caller should use the built-in shield / "QA Platform".
 */
export function useResolvedBranding(): ResolvedBranding {
  const org = useActiveOrg()?.org;
  const platform = usePlatformBranding();
  return {
    logoUrl: org?.logoUrl || platform?.logoUrl || null,
    name: org?.name || platform?.appName || null,
  };
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
      .then((b) => { if (active) setOrgBranding({ name: b.name, logoUrl: b.logoUrl }); })
      .catch(() => { if (active) setOrgBranding(null); });
    return () => { active = false; };
  }, [slugParam]);

  // Resolution: org-slug branding → platform default → built-in.
  const resolved: ResolvedBranding | null = orgBranding
    ?? (platform ? { name: platform.appName, logoUrl: platform.logoUrl } : null);

  // Keep the tab title + favicon in step with whatever we resolved.
  useEffect(() => {
    applyDocumentBranding({ name: resolved?.name ?? null, logoUrl: resolved?.logoUrl ?? null });
  }, [resolved?.name, resolved?.logoUrl]);

  return resolved;
}
