import { useAuthProviders } from '@/hooks/useAuthProviders';

const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? 'http://localhost:3001';

interface Props {
  /**
   * When set, append the invite token to the SSO start URL so the
   * downstream callback can attach the new user to the right invite.
   * (Currently the backend accepts it via session state — the redirect
   * round-trips through Microsoft / Google but the token survives.)
   */
  inviteToken?: string | null;
}

/**
 * Renders the row of "Continue with X" buttons above the email/password
 * form on Login / Register / Invite pages. Buttons are gated by the
 * /auth/config discovery endpoint — disabled providers don't render and
 * the visual divider collapses, so a password-only deployment looks
 * identical to how it did before this feature.
 */
export function SsoButtons({ inviteToken }: Props) {
  const { providers, isLoading } = useAuthProviders();
  if (isLoading) {
    // Reserve vertical space to prevent layout shift while config loads —
    // ~56px matches a single rendered button + its margin.
    return <div style={{ height: 56 }} aria-hidden />;
  }
  if (!providers.google && !providers.microsoft) return null;

  // The OAuth start URL is hit as a top-level browser navigation (not an
  // xhr) so cookies + redirects work — we can't slip auth tokens in via
  // a header. Invite tokens piggy-back as a query param for the same reason.
  const buildUrl = (path: string) => {
    const url = new URL(`${API_BASE}${path}`);
    if (inviteToken) url.searchParams.set('inviteToken', inviteToken);
    return url.toString();
  };

  return (
    <>
      <div className="space-y-2">
        {providers.google && (
          <button
            type="button"
            onClick={() => { window.location.href = buildUrl('/api/v1/auth/google'); }}
            className="w-full flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(238,238,248,0.85)',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
              <path d="M47.532 24.552c0-1.636-.132-3.2-.38-4.704H24v9.02h13.22c-.58 3.04-2.3 5.616-4.88 7.344v6.1h7.9c4.62-4.26 7.292-10.54 7.292-17.76z" fill="#4285F4"/>
              <path d="M24 48c6.64 0 12.2-2.2 16.268-5.96l-7.9-6.1c-2.2 1.48-5.016 2.356-8.368 2.356-6.432 0-11.88-4.34-13.828-10.176H2.02v6.296C5.98 42.78 14.36 48 24 48z" fill="#34A853"/>
              <path d="M10.172 28.12A14.84 14.84 0 0 1 9.32 24c0-1.432.248-2.82.688-4.12V13.584H2.02A23.99 23.99 0 0 0 0 24c0 3.864.928 7.52 2.02 10.416l8.152-6.296z" fill="#FBBC05"/>
              <path d="M24 9.528c3.624 0 6.872 1.248 9.432 3.692l7.068-7.068C36.192 2.196 30.632 0 24 0 14.36 0 5.98 5.22 2.02 13.584l8.152 6.296C12.12 13.868 17.568 9.528 24 9.528z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        )}
        {providers.microsoft && (
          <button
            type="button"
            onClick={() => { window.location.href = buildUrl('/api/v1/auth/microsoft'); }}
            className="w-full flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(238,238,248,0.85)',
            }}
          >
            {/* Microsoft 4-square logo — official brand spec is solid quadrants
                of #F25022 / #7FBA00 / #00A4EF / #FFB900. */}
            <svg width="16" height="16" viewBox="0 0 23 23" fill="none">
              <rect width="10" height="10" x="1" y="1" fill="#F25022"/>
              <rect width="10" height="10" x="12" y="1" fill="#7FBA00"/>
              <rect width="10" height="10" x="1" y="12" fill="#00A4EF"/>
              <rect width="10" height="10" x="12" y="12" fill="#FFB900"/>
            </svg>
            Continue with Microsoft
          </button>
        )}
      </div>

      {/* Divider — only rendered when there's SSO above to separate from. */}
      <div className="relative flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
        <span className="text-xs" style={{ color: 'rgba(238,238,248,0.30)' }}>or</span>
        <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
      </div>
    </>
  );
}
