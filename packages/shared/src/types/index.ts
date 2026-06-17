// Run lifecycle status — mirrors the Prisma `RunStatus` enum.
export type RunStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT'
  | 'ERROR'
  | 'NOT_TESTED'
  | 'SKIPPED';

/**
 * Canonical, complete list of step types — the single source of truth shared
 * across web (StepEditor), the AI output schema, the DSL, and the worker.
 * MUST stay in sync with the `StepType` enum in apps/api/prisma/schema.prisma
 * (the DB is the ultimate source; this mirrors it for the TS side).
 */
export const STEP_TYPES = [
  // UI (Playwright) step types
  'NAVIGATE',
  'CLICK',
  'DBLCLICK',
  'FILL',
  'TYPE',
  'CLEAR',
  'SELECT',
  'CHECK',
  'UNCHECK',
  'ASSERT_TEXT',
  'ASSERT_VISIBLE',
  'ASSERT_VALUE',
  'ASSERT_URL',
  'ASSERT_ELEMENT',
  'WAIT',
  'WAIT_FOR_SELECTOR',
  'WAIT_FOR_NAVIGATION',
  'WAIT_MS',
  'SCREENSHOT',
  'KEYBOARD',
  'PRESS_KEY',
  'SCROLL',
  'HOVER',
  'EXECUTE_SCRIPT',
  'STORE',
  'CUSTOM',
  // API step types
  'REQUEST',
  'ASSERT_STATUS',
  'ASSERT_BODY',
  'ASSERT_HEADER',
  'EXTRACT',
  'DELAY',
  // Shell step types
  'COMMAND',
  'ASSERT_EXIT',
  'ASSERT_OUTPUT',
  'ASSERT_CONTAINS',
  // Kept for backwards compatibility
  'API_REQUEST',
] as const;

export type StepType = (typeof STEP_TYPES)[number];

/** True when `s` is one of the canonical step types. */
export function isStepType(s: unknown): s is StepType {
  return typeof s === 'string' && (STEP_TYPES as readonly string[]).includes(s);
}

/**
 * Canonical step shape stored in TestDefinition.steps (JSON array). Keys in
 * `input` vary per step type; the selector-stability guard runs on the
 * `selector` key only.
 */
export interface Step {
  index: number;
  name: string;
  type: StepType;
  input: Record<string, unknown>;
  continueOnFail?: boolean;
  timeoutMs?: number;
  /** Human-readable intent; fallback when a selector is unstable. */
  aiDescription?: string;
}

// Selectors we accept. CSS paths are rejected — they're brittle and the
// recorder/healer can't reason about them later. Kept identical to the rule in
// apps/api/.../ai/prompts/base/output-schemas.ts so authoring surfaces agree.
//   [data-testid="…"], [role="…"], getByText("…"), #stable-id,
//   input[name|placeholder|aria-label="…"]
const STABLE_SELECTOR_RE =
  /^(\[data-testid=|\[role=|getByText\(|#[a-z][\w-]*$|[a-z]+\[(name|placeholder|aria-label)=)/i;

export function isStableSelector(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  return STABLE_SELECTOR_RE.test(s.trim());
}
