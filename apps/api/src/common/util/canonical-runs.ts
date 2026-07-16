/**
 * The single definition of which TestRuns count toward canonical feature
 * state — latest test status, pass rates, coverage/quality, flaky detection,
 * analytics. Excluded:
 *  - preview runs (ephemeral debugging, never results)
 *  - result-isolated pipeline stage runs (excludedFromCanonical, stamped at
 *    creation from Pipeline.updatesFeatureStatus — a pipeline that opts in
 *    counts like any automated run)
 *
 * Spread into TestRun where-clauses: `where: { ...CANONICAL_RUN_FILTER, ... }`.
 */
export const CANONICAL_RUN_FILTER = {
  isPreview: false,
  excludedFromCanonical: false,
} as const;
