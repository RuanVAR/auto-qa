import type { PrismaService } from '../prisma/prisma.service';

/**
 * Duration-balanced enqueue ordering (docs/plan/06-PHASE-4-SCALE.md §4.4).
 *
 * Playwright's native sharding splits by test count/file, never duration —
 * with a fixed-size worker pool, a long test that happens to start last sets
 * the run's total wall-clock. Ordering the enqueue window longest-first
 * (LPT — Longest Processing Time first, the classic bin-packing heuristic)
 * keeps that tail short.
 *
 * Computed on demand from canonical run history rather than a maintained
 * rolling column: avoids a background job to keep it fresh, and the ordering
 * only matters at the moment of enqueue anyway.
 */

interface P50Row { testDefinitionId: string; p50: number | null }

/** p50 duration (ms) per testDefinitionId, from canonical PASSED/FAILED history. Missing entries mean no history yet. */
export async function getP50Durations(
  prisma: PrismaService,
  testDefinitionIds: string[],
): Promise<Map<string, number>> {
  if (testDefinitionIds.length === 0) return new Map();
  const rows = await prisma.$queryRaw<P50Row[]>`
    SELECT "testDefinitionId",
           percentile_cont(0.5) WITHIN GROUP (ORDER BY duration) AS p50
    FROM test_runs
    WHERE "testDefinitionId" = ANY(${testDefinitionIds})
      AND duration IS NOT NULL
      AND status IN ('PASSED', 'FAILED')
      AND "isPreview" = false
      AND "excludedFromCanonical" = false
    GROUP BY "testDefinitionId"
  `;
  return new Map(rows.filter(r => r.p50 != null).map(r => [r.testDefinitionId, Number(r.p50)]));
}

/**
 * Sort candidates longest-first by known p50 duration. Candidates with no
 * duration history yet (new tests) sort after everything with known
 * duration — treating an unknown as short is the safer default (a single
 * misplaced long unknown costs one run's worth of tail; treating every
 * unknown as long would needlessly front-load a run full of brand-new
 * tests). Ties broken by the original (createdAt) order for stability.
 */
export function orderByDurationDesc<T extends { testDefinitionId: string }>(
  candidates: T[],
  p50ByTestDefinition: Map<string, number>,
): T[] {
  return candidates
    .map((c, index) => ({ c, index, duration: p50ByTestDefinition.get(c.testDefinitionId) ?? -1 }))
    .sort((a, b) => (b.duration - a.duration) || (a.index - b.index))
    .map(({ c }) => c);
}
