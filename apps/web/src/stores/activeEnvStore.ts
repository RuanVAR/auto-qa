import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-project active environment. Lets the TopNav env switcher persist a
 * tester's preferred env (e.g. "Bob always works in UAT for TWAK Project")
 * so reports, run history, and feature pages can filter by it without making
 * the user re-pick on every page load.
 *
 * Stored as a `{ projectId → environmentId }` map so a user juggling many
 * projects sees the right env in each.
 *
 * Down-stream consumption pattern:
 *   const activeEnvId = useActiveEnv(projectId);
 *   const { data } = useQuery(['feature-runs', featureId, activeEnvId], () =>
 *     featureRunsApi.list(featureId, activeEnvId ?? undefined),
 *   );
 *
 * `null` means "all envs" — use it as the default before any explicit pick.
 */
interface ActiveEnvState {
  byProject: Record<string, string | null>;
  setActiveEnv: (projectId: string, envId: string | null) => void;
  clearProject: (projectId: string) => void;
}

export const useActiveEnvStore = create<ActiveEnvState>()(
  persist(
    (set) => ({
      byProject: {},
      setActiveEnv: (projectId, envId) =>
        set((s) => ({ byProject: { ...s.byProject, [projectId]: envId } })),
      clearProject: (projectId) =>
        set((s) => {
          const next = { ...s.byProject };
          delete next[projectId];
          return { byProject: next };
        }),
    }),
    { name: 'qa-active-env' },
  ),
);

/** Convenience selector hook — null means "all envs". */
export function useActiveEnv(projectId: string | undefined): string | null {
  return useActiveEnvStore((s) => (projectId ? s.byProject[projectId] ?? null : null));
}
