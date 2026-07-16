/**
 * Client-side automation-readiness helpers. Automated testing is offered only
 * when (a) the project has an environment with "Supports automation" on, and
 * (b) the feature has an automatable test — a step-based test with steps, or a
 * SCRIPT test with source. Mirrors the API guards in
 * apps/api/src/common/util/automation.ts + feature-runs.service.start().
 *
 * These centralise what used to be six inline `envs.filter(e => e.supportsAutomation)`
 * duplications so every "Automated" surface gates the same way.
 */

export interface AutomationEnvLike {
  supportsAutomation?: boolean;
}

export interface AutomationTestLike {
  type?: string | null;
  steps?: unknown;
  config?: { script?: unknown } | null;
}

/** Envs that can run automation. The env-list API already excludes inactive envs. */
export function selectAutomationEnvs<T extends AutomationEnvLike>(envs: T[] | null | undefined): T[] {
  return (envs ?? []).filter((e) => e.supportsAutomation);
}

/** True when a worker could actually execute this test. */
export function isTestAutomatable(t: AutomationTestLike | null | undefined): boolean {
  if (!t) return false;
  if (t.type === 'SCRIPT') {
    const s = t.config?.script;
    return typeof s === 'string' && s.trim().length > 0;
  }
  return Array.isArray(t.steps) && t.steps.length > 0;
}

/** True when a feature has at least one automatable test. */
export function hasAutomatableTest(tests: AutomationTestLike[] | null | undefined): boolean {
  return (tests ?? []).some(isTestAutomatable);
}

/**
 * A human-readable reason Automated is unavailable, or null when it's ready.
 * Use as both the gate (`=== null`) and the disabled-tooltip text.
 */
export function automationBlockReason(opts: {
  envs: AutomationEnvLike[] | null | undefined;
  tests: AutomationTestLike[] | null | undefined;
}): string | null {
  if (selectAutomationEnvs(opts.envs).length === 0) {
    return 'No environment has "Supports automation" enabled — turn it on for an environment to run automated tests.';
  }
  if (!hasAutomatableTest(opts.tests)) {
    return 'This feature has no automatable test yet — add steps to a test, or create a SCRIPT test.';
  }
  return null;
}
