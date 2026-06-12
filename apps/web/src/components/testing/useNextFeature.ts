import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { modulesApi, statsApi } from '@/lib/api';

// Shared "what feature is next" derivation. Both the FeatureCompletionModal and
// the testing-view top bar (Next-feature button + finish-run choice) need to
// know the next testable feature in the module, in the same order the QA sees
// on the module page. Centralised here so they can't drift. Queries share their
// cache keys with the modal, so reusing this adds no extra network.

export interface ModuleFeature {
  id: string;
  name: string;
  order: number;
  updatedAt: string;
}

export interface FeatureStats {
  featureId: string;
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  passRate: number | null;
}

export interface FeatureSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

/** A feature counts as "signed-off ready" when every test passed. */
export function isFeaturePassing(s: FeatureStats | undefined): boolean {
  return !!s && s.total > 0 && s.failed === 0 && s.skipped === 0 && s.outstanding === 0;
}

export function useNextFeature(opts: {
  moduleId: string | undefined;
  currentFeatureId: string;
  /** Live tallies for the current feature, used to override possibly-stale stats. */
  summary?: FeatureSummary;
  enabled?: boolean;
}) {
  const { moduleId, currentFeatureId, summary, enabled = true } = opts;
  const on = enabled && !!moduleId;

  const { data: features = [], isLoading: featuresLoading } = useQuery<ModuleFeature[]>({
    queryKey: ['module-features-filter', moduleId],
    queryFn: () => modulesApi.listFeatures(moduleId as string) as Promise<ModuleFeature[]>,
    enabled: on,
    staleTime: 10_000,
  });

  const { data: statsList = [], isLoading: statsLoading } = useQuery<FeatureStats[]>({
    queryKey: ['feature-stats', moduleId],
    queryFn: () => statsApi.getFeatureStats(moduleId as string) as Promise<FeatureStats[]>,
    enabled: on,
    staleTime: 0,
  });

  const derived = useMemo(() => {
    // Match the module overview order (manual `order`, then name).
    const ordered = [...features].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
    );
    const statsByFeature = new Map(statsList.map((s) => [s.featureId, s]));

    // Override the current feature's stats with the live summary — the stats
    // endpoint can lag a beat behind the final mark.
    if (summary) {
      statsByFeature.set(currentFeatureId, {
        featureId: currentFeatureId,
        passed: summary.passed,
        failed: summary.failed,
        skipped: summary.skipped,
        outstanding: Math.max(0, summary.total - summary.passed - summary.failed - summary.skipped),
        total: summary.total,
        passRate: summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : null,
      });
    }

    // Only offer features that actually have tests — continuing onto a feature
    // with no test definitions errors server-side.
    const hasTests = (f: ModuleFeature) => (statsByFeature.get(f.id)?.total ?? 0) > 0;
    const idx = ordered.findIndex((f) => f.id === currentFeatureId);
    const next = idx >= 0 ? (ordered.slice(idx + 1).find(hasTests) ?? null) : null;
    const others = ordered.filter((f) => f.id !== currentFeatureId && hasTests(f));
    const needWork = ordered.filter(
      (f) => hasTests(f) && !isFeaturePassing(statsByFeature.get(f.id)),
    );

    return {
      nextFeature: next,
      isLastFeature: !next,
      otherFeatures: others,
      allPassing: ordered.length > 0 && needWork.length === 0,
      featuresNeedingWork: needWork.map((f) => ({ feature: f, stats: statsByFeature.get(f.id) })),
    };
  }, [features, statsList, currentFeatureId, summary]);

  return { ...derived, features, statsList, loading: featuresLoading || statsLoading };
}
