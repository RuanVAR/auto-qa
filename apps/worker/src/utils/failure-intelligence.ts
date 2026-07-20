import { createHash } from 'node:crypto';

/**
 * Failure fingerprinting and first-pass triage
 * (docs/plan/05-PHASE-3-INTELLIGENCE.md §3.2, §3.4).
 *
 * Both computed once, at write time, from the same errorMessage the row
 * already carries. Pure and dependency-free so they're cheaply unit-testable
 * and the normalisation rules are auditable in one place.
 */

/**
 * Collapse a raw error message into a stable fingerprint so the same
 * underlying problem groups across tests, runs and environments.
 *
 * Everything stripped here is incidental — it varies run to run while the
 * defect stays the same. Getting this list wrong in either direction is the
 * whole difficulty: strip too little and every failure is unique; strip too
 * much and unrelated failures collapse together.
 *
 * ⚠️ Effectiveness varies by project (arXiv 2401.15788 — de-duplication
 * ranged from 100% specificity to entirely ineffective across the corpora
 * studied). Not marketed as a guarantee; see docs/plan/10-RESEARCH-BASIS.md.
 */
export function normaliseFailureMessage(msg: string): string {
  return msg
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<timestamp>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/:\d{2,5}\b/g, ':<port>')
    .replace(/\/[\w.-]+\/(?=[\w.-]+\.\w+)/g, '<path>/')
    .replace(/\bnth=\d+/g, 'nth=<n>')
    // No trailing \b: digits immediately followed by a unit suffix (30000ms,
    // 1920px) are still \w on both sides of the digit run, so \b\d+\b would
    // never match the boundary and "30000ms" vs "45000ms" would fingerprint
    // as different messages despite being the same timeout error.
    .replace(/\d+/g, '<n>')
    .trim()
    .slice(0, 500);
}

/** 16 hex chars — enough to make accidental collisions negligible without a full sha256. */
export function fingerprintFailure(msg: string): string {
  return createHash('sha256').update(normaliseFailureMessage(msg)).digest('hex').slice(0, 16);
}

export type TriageBucket = 'PRODUCT' | 'AUTOMATION' | 'ENVIRONMENT';

/**
 * First-pass triage. Deliberately heuristic and deliberately conservative —
 * it proposes a bucket, it does not decide one. Anything unmatched stays
 * unclassified rather than being guessed into a bucket, because a wrong
 * confident label is worse than no label.
 */
export function triageFailure(message: string, stepType?: string): TriageBucket | null {
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|502|503|504|net::ERR/.test(message)) return 'ENVIRONMENT';
  // `s` flag: Playwright timeouts put "waiting for locator" on a separate
  // "Call log:" line after "Timeout ... exceeded", so `.` must cross `\n`.
  if (/strict mode violation|no element|not found|Timeout[\s\S]*waiting for locator/i.test(message)) return 'AUTOMATION';
  if (stepType?.startsWith('ASSERT_')) return 'PRODUCT';
  return null;
}
