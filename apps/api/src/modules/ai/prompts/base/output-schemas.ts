import { z } from 'zod';

/**
 * Single source of truth for AI generation outputs.
 *
 * Used three ways:
 *   1. Runtime validation of the LLM response (Zod parse + Zod refine)
 *   2. JSON schema block injected into the prompt (Gemini / OpenAI / Anthropic
 *      tool-call structured output is built from these)
 *   3. TypeScript types for the rest of the codebase via z.infer<>
 *
 * Drift between the three is impossible by construction.
 */

// Step types — kept in sync with `StepType` in schema.prisma. AI generation
// is restricted to UI steps for Phase 1 since UI is the only well-supported
// path through the runner today.
export const STEP_TYPES = [
  'NAVIGATE',
  'CLICK',
  'DBLCLICK',
  'FILL',
  'TYPE',
  'CLEAR',
  'SELECT',
  'CHECK',
  'UNCHECK',
  'HOVER',
  'PRESS_KEY',
  'SCROLL',
  'WAIT_FOR_SELECTOR',
  'WAIT_FOR_NAVIGATION',
  'WAIT_MS',
  'ASSERT_TEXT',
  'ASSERT_VISIBLE',
  'ASSERT_VALUE',
  'ASSERT_URL',
  'SCREENSHOT',
] as const;

export const StepTypeEnum = z.enum(STEP_TYPES);
export type StepTypeName = z.infer<typeof StepTypeEnum>;

// Selectors we accept. CSS paths are rejected — they're brittle and the
// recorder/healer can't reason about them later. Patterns allowed:
//   [data-testid="…"]
//   [role="…"][name="…"]
//   getByText("…")
//   #stable-id
//   input[name="email"], input[placeholder="…"], input[aria-label="…"]
const STABLE_SELECTOR_RE =
  /^(\[data-testid=|\[role=|getByText\(|#[a-z][\w-]*$|[a-z]+\[(name|placeholder|aria-label)=)/i;

export function isStableSelector(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  return STABLE_SELECTOR_RE.test(s.trim());
}

/**
 * Step input shape — keys vary by type, validated loosely as a record.
 * The selector-stability guard runs in step-level refine() below.
 */
export const stepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    type: StepTypeEnum,
    name: z.string().min(1).max(120),
    input: z.record(z.unknown()).default({}),
    continueOnFail: z.boolean().default(false),
    /**
     * Human-readable description of what the step is meant to verify or do.
     * Surfaces under each row in the preview UI; also used as a fallback
     * description if a step has to be downgraded to selector-less.
     */
    aiDescription: z.string().max(280).optional(),
  })
  .refine(
    (s) => {
      const sel = (s.input as { selector?: unknown }).selector;
      // Steps that don't carry a selector (NAVIGATE, WAIT_MS, etc.) are fine.
      if (sel == null) return true;
      return isStableSelector(sel);
    },
    {
      message:
        'Selector must use a stable pattern: [data-testid=…], [role=…], getByText(…), #id, or input[name|placeholder|aria-label=…]. Raw CSS paths are not allowed.',
      path: ['input', 'selector'],
    },
  );

export type StepSchema = z.infer<typeof stepSchema>;

/**
 * A generated test case carries traceability metadata in
 * `mappedAcceptanceCriteria` so reviewers can audit "which AC did this
 * cover?". Empty array is allowed for free-text generation paths.
 */
export const testCaseSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  mappedAcceptanceCriteria: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  steps: z.array(stepSchema).min(1),
});
export type TestCaseSchema = z.infer<typeof testCaseSchema>;

export const featureSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  extractedAc: z.array(z.string()).default([]),
});
export type FeatureSchema = z.infer<typeof featureSchema>;

// Wrappers — keep one object at the top level so providers that prefer
// JSON-schema tool calls have a stable named root.
export const g3OutputSchema = z.object({ steps: z.array(stepSchema).min(1) });
export const g2OutputSchema = z.object({ testCases: z.array(testCaseSchema).min(1) });
export const g1OutputSchema = z.object({ features: z.array(featureSchema).min(1) });
export const acExtractSchema = z.object({ acceptanceCriteria: z.array(z.string()).min(1) });

export type G3Output = z.infer<typeof g3OutputSchema>;
export type G2Output = z.infer<typeof g2OutputSchema>;
export type G1Output = z.infer<typeof g1OutputSchema>;
export type AcExtractOutput = z.infer<typeof acExtractSchema>;
