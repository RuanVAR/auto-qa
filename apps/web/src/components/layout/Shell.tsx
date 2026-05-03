import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { TopNav } from './TopNav';
import { Toaster } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/lib/api';

export function Shell() {
  const { token, user, setUser } = useAuthStore();
  const location = useLocation();

  // Hydrate user profile from API if we have a token but no user loaded
  useEffect(() => {
    if (token && !user) {
      authApi.me().then(setUser).catch((err) => {
        // 401 is handled by axios interceptor → auto logout+redirect.
        // Log other errors so we're not swallowing real issues.
        // eslint-disable-next-line no-console
        if ((err as { response?: { status?: number } })?.response?.status !== 401) {
          console.error('[Shell] Failed to hydrate user profile', err);
        }
      });
    }
  }, [token, user, setUser]);

  return (
    <div className="page-glow relative min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Floating top nav (outside boundary — always visible, even on page errors) */}
      <TopNav />

      {/* Page content — padded to clear the fixed nav. Route-level boundary
          catches errors inside the current page without destroying the nav.
          resetKey=pathname auto-clears the error when the user navigates. */}
      <main className="relative z-10 pt-20 pb-12 px-8 max-w-[1400px] mx-auto">
        <ErrorBoundary variant="inline" resetKey={location.pathname} scope={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Global toast notifications */}
      <Toaster />
    </div>
  );
}
