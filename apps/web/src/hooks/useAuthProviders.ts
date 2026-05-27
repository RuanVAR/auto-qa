import { useQuery } from '@tanstack/react-query';
import { authApi } from '@/lib/api';

/**
 * Returns which auth providers (Google, Microsoft, password) are enabled
 * on this deployment. Public endpoint — safe to call from logged-out pages.
 *
 * Cached for 5 min because the answer only changes on a backend redeploy,
 * and we want the Login / Register / Invite pages to render their SSO
 * buttons without a flash of "loading…" on every navigation.
 */
export function useAuthProviders() {
  const q = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: authApi.getConfig,
    staleTime: 5 * 60 * 1000,
    // Don't burn a request on every focus regain — env can't change at runtime.
    refetchOnWindowFocus: false,
    retry: 1,
  });
  // Sensible defaults so a slow / failing /auth/config never hides every
  // sign-in option from the user. Password is always available; SSO buttons
  // stay hidden until we have an affirmative "true" from the server.
  const providers = q.data?.providers ?? { password: true, google: false, microsoft: false };
  return {
    providers,
    isLoading: q.isLoading,
  };
}
