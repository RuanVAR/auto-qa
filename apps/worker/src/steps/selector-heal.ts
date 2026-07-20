/**
 * Selector drift detection — pure logic shared by the resolution cascade in
 * step.runner.ts. Kept dependency-free (no Playwright, no Prisma) so it is
 * cheaply unit-testable and so the safety rules below are auditable in one
 * place rather than scattered through the runner.
 *
 * Naming: this is "selector drift detection", never "self-healing" — see
 * docs/plan/04-PHASE-2-HEALING.md §2 for why that distinction is deliberate
 * and commercially load-bearing.
 */

export type SelectorStrategy = 'testattr' | 'role' | 'label' | 'placeholder' | 'text' | 'id' | 'css';

/**
 * Confidence priors by selector strategy. These encode how each strategy
 * fails, not how "good" it looks — see docs/plan/04-PHASE-2-HEALING.md §2.1.
 */
export const CONFIDENCE_BY_STRATEGY: Record<SelectorStrategy, number> = {
  testattr: 0.99,
  role: 0.95,
  label: 0.90,
  placeholder: 0.85,
  text: 0.70,
  id: 0.60,
  css: 0.40,
};

export type ConfidenceBucket = 'high' | 'medium' | 'low';

export function confidenceBucket(n: number): ConfidenceBucket {
  return n >= 0.9 ? 'high' : n >= 0.65 ? 'medium' : 'low';
}

/**
 * The `low` bucket floor (0.65) is a fixed, non-negotiable ceiling used by the
 * cascading-heal guard (rule 3 below) — distinct from `healSensitivity`, which
 * is a per-project *configurable* floor that may be set below this. Even a
 * project that has opted into lower-confidence auto-heals still stops healing
 * for the rest of a run once one of them lands in `low`.
 */
export const LOW_CONFIDENCE_CEILING = 0.65;

/** Default project-level confidence floor — `low` never auto-heals by default. */
export const DEFAULT_HEAL_SENSITIVITY = 0.65;

/** Third consecutive heal on the same step fails it instead of healing again. */
export const HEAL_GIVE_UP_THRESHOLD = 3;

/**
 * Infer which authoring strategy produced a selector string, mirroring the
 * recorder's own candidate generation (apps/recorder-extension/content.js:226-289)
 * and the getBy* parsing in normalizeToLocator (step.runner.ts). Deliberately
 * conservative on ambiguity: a bare `#id` selector could have come from either
 * the `label` or `id` recorder strategy (both emit `#id`-shaped CSS with no
 * other marker) — classified as the lower-confidence `id` rather than guessing
 * `label`, since under-confidence only means a heal needs floor clearance, never
 * an over-confident wrong one.
 */
export function inferStrategy(selector: string): SelectorStrategy {
  const s = selector.trim();
  if (/^getByTestId\(/i.test(s) || /\[data-(testid|test|qa|cy)[-\w]*=/i.test(s)) return 'testattr';
  if (/^getByRole\(/i.test(s) || /^\[role=/i.test(s)) return 'role';
  if (/^getByLabel\(/i.test(s)) return 'label';
  if (/^getByPlaceholder\(/i.test(s) || /\[placeholder=/i.test(s)) return 'placeholder';
  if (/^getBy(Text|Title|AltText)\(/i.test(s) || /:has-text\(/i.test(s) || /^text=/i.test(s)) return 'text';
  if (/^#[\w-]+$/.test(s)) return 'id';
  return 'css';
}

/**
 * Step types whose failure is a statement about the product, not about the
 * selector. Never healed — healing these is how a genuine regression ships
 * green. (docs/plan/04-PHASE-2-HEALING.md §2.4, rule 1.) Locator resolution for
 * these still runs, but primary-only: no fallback cascade.
 */
export const NEVER_HEAL_STEP_TYPES: ReadonlySet<string> = new Set([
  'ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL',
  'ASSERT_ELEMENT', 'ASSERT_STATUS', 'ASSERT_BODY', 'ASSERT_HEADER',
  'ASSERT_EXIT', 'ASSERT_OUTPUT', 'ASSERT_CONTAINS',
]);
