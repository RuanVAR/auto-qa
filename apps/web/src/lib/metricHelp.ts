/**
 * Single source of truth for the "what does this number mean / how is it
 * calculated" copy shown by the little (i) hints next to stat cards, donuts,
 * and rings. Keep these in sync with apps/api StatsService — the formulas
 * described here are exactly what the backend computes.
 *
 * Two metrics are easy to confuse, so the copy leans into the distinction:
 *   - Progress  = coverage  = (passed + failed + skipped) / total
 *   - Pass Rate = quality   = passed / total
 */
export const metricHelp = {
  testCases:
    'Total number of test cases defined in this scope (active, not deleted).',

  progress:
    'Coverage. The share of test cases that have been run at least once — counting passed, failed, or deliberately skipped. 100% means every case has been exercised. Formula: (passed + failed + skipped) ÷ total.',

  passRate:
    'Quality. The share of ALL test cases that currently pass. Never-run and skipped cases count against it, so it only reaches 100% once every case has a passing run. Formula: passed ÷ total cases.',

  passed:
    'Test cases whose most recent run passed.',

  failed:
    'Test cases whose most recent run failed.',

  skipped:
    'Test cases a tester deliberately skipped. They count as "addressed" for Progress, but not as passing — so they hold Pass Rate below 100%.',

  neverRun:
    'Test cases that have never been run.',

  needsRetest:
    'Test cases that were attempted but produced no verdict — timed out, errored, or were cancelled mid-run. They need to be run again.',

  outstanding:
    'Test cases with no current pass / fail / skip verdict. This is Never-run plus Needs-retest combined.',

  featuresPassed:
    'Features where every single test case passed. The ring shows that share of all features in this scope. A feature with even one un-passed case does not count.',

  featuresToTest:
    'Features that still have at least one test case without a current pass / fail / skip verdict.',

  modules:
    'Number of modules in this project (active, not deleted).',

  features:
    'Number of features across this scope (active, not deleted).',

  openIssues:
    'Issues logged against this scope that are still open (not resolved or closed).',

  lastRun:
    'When the most recent test run in this scope completed.',
} as const;

export type MetricHelpKey = keyof typeof metricHelp;
