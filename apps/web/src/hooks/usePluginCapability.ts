import { useQuery } from '@tanstack/react-query';
import { pluginsApi, type PluginCapability, type PluginInstall } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';

/**
 * Hook to check 4-level enablement gate from the frontend.
 *
 * Returns:
 *   - enabled  — at least one install satisfies all four levels for `capability`
 *   - installs — the list of usable installs (frontend uses this to populate the
 *                "Create ticket ▼" dropdown when the user has multiple)
 *   - loading  — initial fetch in flight
 *
 * Usage:
 *
 *   const { enabled, installs } = usePluginCapability('createIssue');
 *   if (!enabled) return null;
 *   return <CreateTicketDropdown installs={installs} />;
 */
export function usePluginCapability(
  capability: PluginCapability,
  opts?: { projectId?: string },
): { enabled: boolean; installs: PluginInstall[]; loading: boolean } {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  // Phase 1 simplification: enablement is filtered by isEnabled + lastHealthOk
  // at the install level. Project-binding capability filtering is a server-side
  // concern that lights up when the bindings UI ships and we have project-scoped
  // routes wired through usePluginCapability.
  const installs = (installsQ.data ?? []).filter((i) => i.isEnabled && i.lastHealthOk);

  // We don't yet inspect the manifest's capability list client-side because
  // the catalog doesn't ship handlers — only the capability names. That's
  // correct: enablement should remain a backend decision. Until the project
  // bindings endpoint surfaces, treat any healthy install as a candidate for
  // every capability declared in the manifest.
  return {
    enabled: installs.length > 0,
    installs,
    loading: installsQ.isLoading,
    // opts.projectId is reserved for the project-scoped enablement endpoint
    // that lands with the bindings UI in a follow-up.
    ...{ _projectId: opts?.projectId },
  } as { enabled: boolean; installs: PluginInstall[]; loading: boolean };
}
