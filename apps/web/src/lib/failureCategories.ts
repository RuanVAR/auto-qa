// Failure-reason taxonomy — mirrors the Prisma `TestFailureCategory` enum.
// Captured when QA marks a test FAILED; drives the "view reason" popover and
// the failure-type analytics doughnut.

export type FailureCategory =
  | 'FUNCTIONALITY'
  | 'DESIGN_MISMATCH'
  | 'MISSING_ELEMENT'
  | 'CONTENT_ERROR'
  | 'DATA_VALIDATION'
  | 'PERFORMANCE'
  | 'INTEGRATION'
  | 'CRASH_ERROR'
  | 'REGRESSION'
  | 'ENVIRONMENT'
  | 'TEST_ISSUE'
  | 'OTHER';

export interface FailureCategoryMeta {
  value: FailureCategory;
  label: string;
  /** One-line hint shown under the dropdown to disambiguate categories. */
  hint: string;
  /** Chip colour. */
  color: string;
}

export const FAILURE_CATEGORIES: FailureCategoryMeta[] = [
  { value: 'FUNCTIONALITY', label: 'Functionality', hint: 'Behaves wrong / doesn’t work as specified', color: '#f87171' },
  { value: 'DESIGN_MISMATCH', label: 'Design / UI mismatch', hint: 'The UI doesn’t match the design', color: '#fb923c' },
  { value: 'MISSING_ELEMENT', label: 'Missing element', hint: 'An expected component / element is absent', color: '#fbbf24' },
  { value: 'CONTENT_ERROR', label: 'Content / copy', hint: 'Wrong text, copy, labels or translations', color: '#facc15' },
  { value: 'DATA_VALIDATION', label: 'Data / validation', hint: 'Wrong data shown, or validation broken', color: '#a3e635' },
  { value: 'PERFORMANCE', label: 'Performance', hint: 'Slow, laggy or timed out', color: '#34d399' },
  { value: 'INTEGRATION', label: 'Integration / API', hint: 'External service or API failure', color: '#22d3ee' },
  { value: 'CRASH_ERROR', label: 'Crash / error', hint: 'The app crashed or threw an error', color: '#f43f5e' },
  { value: 'REGRESSION', label: 'Regression', hint: 'Used to work — newly broken', color: '#c084fc' },
  { value: 'ENVIRONMENT', label: 'Environment / setup', hint: 'Environment issue, not a product defect', color: '#94a3b8' },
  { value: 'TEST_ISSUE', label: 'Test issue (false fail)', hint: 'The test itself is wrong', color: '#64748b' },
  { value: 'OTHER', label: 'Other', hint: 'Doesn’t fit a category — see the note', color: '#a8a29e' },
];

const BY_VALUE = new Map(FAILURE_CATEGORIES.map((c) => [c.value, c]));

export function failureCategoryMeta(value: string | null | undefined): FailureCategoryMeta | null {
  if (!value) return null;
  return BY_VALUE.get(value as FailureCategory) ?? null;
}
