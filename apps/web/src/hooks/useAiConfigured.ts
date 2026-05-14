import { useQuery } from '@tanstack/react-query';
import { aiCredentialsApi } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';

/**
 * Single source of truth for "is AI ready to use for this org?".
 *
 * Cheap GET on `/api/v1/orgs/:orgId/ai-credential` cached for 60s so the
 * three Generate-* buttons (G1 / G2 / G3) don't fire it independently on
 * every render. When the org has no credential or it's marked inactive,
 * the consumer should disable / link-to-settings instead of opening the
 * generation modal.
 *
 * Returns:
 *   • configured  — true when a credential row exists AND is active
 *   • isLoading   — first fetch in flight (hide the button entirely)
 *   • orgId       — passes through so the consumer can compose links to
 *                   `/org/ai-settings` without re-reading auth state
 */
export function useAiConfigured(): {
  configured: boolean;
  isLoading: boolean;
  orgId: string | null;
} {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const q = useQuery({
    queryKey: ['ai-credential', orgId],
    queryFn: () => aiCredentialsApi.get(orgId!),
    enabled: !!orgId,
    staleTime: 60_000,
    retry: false,
  });

  return {
    configured: !!q.data && q.data.active,
    isLoading: q.isLoading,
    orgId,
  };
}
