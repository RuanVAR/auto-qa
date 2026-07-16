/**
 * A test definition is "automatable" when a worker can actually execute it:
 * a SCRIPT test with source, or any step-based test with at least one step.
 * A feature with tests but none automatable can't run automated — the gate
 * that mirrors this on the client lives in apps/web/src/lib/automation.ts.
 */
export function isTestDefinitionAutomatable(td: {
  type?: string | null;
  steps?: unknown;
  config?: unknown;
}): boolean {
  if (td.type === 'SCRIPT') {
    const script = (td.config as { script?: unknown } | null | undefined)?.script;
    return typeof script === 'string' && script.trim().length > 0;
  }
  return Array.isArray(td.steps) && td.steps.length > 0;
}
