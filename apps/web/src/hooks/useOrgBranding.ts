import { useEffect, useState } from 'react';
import { orgsApi } from '@/lib/api';

const DEFAULT_TITLE = 'QA Automation Platform';
const LAST_ORG_SLUG = 'lastOrgSlug';

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

/** Remember the org slug so returning users get their branded login by default. */
export function rememberOrgSlug(slug: string | null | undefined): void {
  try {
    if (slug) localStorage.setItem(LAST_ORG_SLUG, slug);
  } catch { /* private mode / storage disabled — non-fatal */ }
}

/**
 * Pre-login branding for the login/register pages. Resolves the org slug
 * from the `?org=` param, falling back to the last remembered slug, fetches
 * the public branding, and applies it to the tab title + favicon. Returns the
 * branding (or null) so the page can render the org logo + name.
 */
export function usePreloginBranding(slugParam?: string | null): { name: string; logoUrl: string | null } | null {
  const [branding, setBranding] = useState<{ name: string; logoUrl: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    const slug = slugParam || (() => { try { return localStorage.getItem(LAST_ORG_SLUG); } catch { return null; } })();
    if (!slug) {
      setBranding(null);
      applyDocumentBranding({});
      return;
    }
    orgsApi.publicBranding(slug)
      .then((b) => {
        if (!active) return;
        setBranding({ name: b.name, logoUrl: b.logoUrl });
        applyDocumentBranding({ name: b.name, logoUrl: b.logoUrl });
      })
      .catch(() => {
        if (!active) return;
        setBranding(null);
        applyDocumentBranding({});
      });
    return () => { active = false; };
  }, [slugParam]);

  return branding;
}
