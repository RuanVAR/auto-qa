import { create } from 'zustand';

// ─── Shape of an active/ended QA work session as returned by the API ────────
export interface WorkSessionSummary {
  id: string;
  startedAt: string;
  endedAt: string | null;
  lastActiveAt: string;
  lastActivityAt: string | null;
  lastActivityType: string | null;
  // Pointers for "continue where you left off"
  lastTestDefinitionId: string | null;
  lastFeatureId: string | null;
  lastModuleId: string | null;
  lastProjectId: string | null;
}

export interface WorkSessionStats {
  totalTestRuns: number;
  passed: number;
  failed: number;
  issuesLogged: number;
}

export interface ModuleBreakdown {
  moduleId: string;
  moduleName: string;
  features: Array<{
    featureId: string;
    featureName: string;
    testRuns: number;
    passed: number;
    failed: number;
    issues: number;
  }>;
}

export interface CurrentWorkSession {
  session: WorkSessionSummary;
  stats: WorkSessionStats;
  breakdown: ModuleBreakdown[];
}

// ─── Store ───────────────────────────────────────────────────────────────────
// Keeps the current session + last session in-memory alongside React Query.
// React Query is still the canonical cache; this store exists so the
// TopNav badge can read the count synchronously without waiting for a query
// to hydrate, and so mutations elsewhere can optimistically bump counters.

interface WorkSessionStore {
  current: CurrentWorkSession | null;
  setCurrent: (c: CurrentWorkSession | null) => void;
  /** Optimistic counter bump — used when a test is marked locally */
  bumpStat: (key: keyof WorkSessionStats, by?: number) => void;
}

export const useWorkSessionStore = create<WorkSessionStore>((set) => ({
  current: null,
  setCurrent: (c) => set({ current: c }),
  bumpStat: (key, by = 1) =>
    set((s) => {
      if (!s.current) return s;
      return {
        current: {
          ...s.current,
          stats: { ...s.current.stats, [key]: (s.current.stats[key] ?? 0) + by },
        },
      };
    }),
}));
