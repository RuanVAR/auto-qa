import { g2OutputSchema } from '../base/output-schemas';
import { QA_ENGINEER_PERSONA } from '../base/qa-engineer-persona';
import { STEP_TYPES_CATALOGUE } from '../base/step-types-catalogue';
import { buildSourceContext, SourceBundle } from '../base/source-context-builder';

/**
 * G2 — generate a set of test cases (each with its own steps) for a feature.
 *
 * Entry point: feature page "Generate Tests with AI" button.
 *
 * Differences from G3:
 *   - Output is `testCases[]`, each carrying its own `steps[]` AND a
 *     `mappedAcceptanceCriteria: string[]` for traceability.
 *   - Test-count target defaults to ceil(acCount × 1.5) — covers happy +
 *     edge + cross-cutting per AC without exploding the response size.
 *   - The "don't duplicate" hint uses the existing test names in the
 *     feature so re-runs add fresh tests instead of re-paving them.
 *
 * @prompt-version: tests-from-feature@1.0
 */
export interface TestsFromFeatureInput {
  featureName: string;
  featureDescription?: string | null;
  /** AC the tests should cover. Pre-extracted via ac-from-source. */
  acceptanceCriteria: string[];
  /** Names of tests already on the feature — dedupe hint to the model. */
  existingTestNames?: string[];
  /** Target test count; defaults to max(3, ceil(ac × 1.5)) downstream. */
  testCountTarget?: number;
  sources?: SourceBundle;
}

export function testsFromFeaturePrompt(input: TestsFromFeatureInput) {
  const targetCount =
    input.testCountTarget ??
    Math.max(3, Math.ceil(Math.max(input.acceptanceCriteria.length, 1) * 1.5));

  const system = [
    QA_ENGINEER_PERSONA,
    '',
    STEP_TYPES_CATALOGUE,
    '',
    'TASK',
    '====',
    'Given a feature (name + description + its acceptance criteria), produce a set of test cases that cover the AC. Each test case is fully-formed: name, description, priority, the AC it covers, and the ordered steps that exercise it.',
    '',
    'OUTPUT — return ONLY this JSON object, no prose, no markdown fences:',
    '{',
    '  "testCases": [',
    '    {',
    '      "name": "Successful registration with valid details",',
    '      "description": "Happy-path: a brand-new email + valid password → account created, success toast, redirect to dashboard.",',
    '      "priority": "HIGH",',
    '      "mappedAcceptanceCriteria": ["User can register with valid email and password"],',
    '      "tags": ["registration", "happy-path"],',
    '      "steps": [ /* same shape as G3 — NAVIGATE → action → ASSERT_* */ ]',
    '    },',
    '    ...',
    '  ]',
    '}',
    '',
    `TARGETING — aim for ~${targetCount} test cases. Each AC should map to at least one test; high-risk AC (auth, payment, data-loss) deserve a happy + an edge + a negative.`,
    '',
    'COVERAGE SHAPE per AC where it makes sense:',
    '  • happy path             — golden flow that proves the AC works',
    '  • edge case              — boundary input (empty, max-length, special chars, locale)',
    '  • negative / rejection   — the failure mode the AC names ("rejects duplicate email")',
    '  • cross-cutting          — perms, session, locale — when the feature touches them',
    '',
    'NAMING — read like a QA engineer wrote them. "Successful registration with valid details", never "Test 1". Negative tests start with the rejection: "Registration rejects duplicate email".',
    '',
    'STEP STRUCTURE inside each test — same setup → action → confirmation rule as G3:',
    '  1. NAVIGATE to the right URL',
    '  2. WAIT_FOR_SELECTOR on the primary form element',
    '  3. FILL / CLICK / etc. — the action',
    '  4. ASSERT_* — the confirmation that maps back to the AC',
    '',
    'NEGATIVE / EDGE — trigger the failure, then ASSERT_TEXT on the error message. Do not just stop after the action.',
  ].join('\n');

  const acBlock = input.acceptanceCriteria.length
    ? `[ACCEPTANCE CRITERIA — each test case must declare which of these it covers]\n` +
      input.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : `[ACCEPTANCE CRITERIA — none extracted; infer testable behaviours from the description + sources]`;

  const user = [
    `FEATURE`,
    `=======`,
    `Name: ${input.featureName}`,
    input.featureDescription ? `Description: ${input.featureDescription}` : '',
    '',
    acBlock,
    '',
    input.sources
      ? buildSourceContext({ ...input.sources, existingTestNames: input.existingTestNames })
      : input.existingTestNames?.length
      ? `[EXISTING TESTS IN THIS FEATURE — do not duplicate]\n${input.existingTestNames.map((n) => `- ${n}`).join('\n')}`
      : '',
    '',
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system,
    user,
    schema: g2OutputSchema,
    promptVersion: 'tests-from-feature@1.0',
  };
}
