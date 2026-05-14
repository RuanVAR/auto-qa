import { g3OutputSchema } from '../base/output-schemas';
import { QA_ENGINEER_PERSONA } from '../base/qa-engineer-persona';
import { STEP_TYPES_CATALOGUE } from '../base/step-types-catalogue';
import { buildSourceContext, SourceBundle } from '../base/source-context-builder';

/**
 * G3 — generate ordered steps for an existing TestDefinition.
 *
 * Entry point: test editor "Generate Steps with AI" button.
 *
 * @prompt-version: steps-from-test@1.0
 */
export interface StepsFromTestInput {
  testName: string;
  testDescription?: string | null;
  /**
   * Existing steps on the test, if any. When non-empty the model is told
   * to extend rather than replace — useful when the user already roughed
   * in a couple of steps and wants the rest filled in.
   */
  existingSteps?: Array<{ index: number; type: string; name: string }>;
  /** AC the user wants this test to cover. Pre-extracted via ac-from-source. */
  acceptanceCriteria?: string[];
  sources?: SourceBundle;
}

export function stepsFromTestPrompt(input: StepsFromTestInput) {
  const system = [
    QA_ENGINEER_PERSONA,
    '',
    STEP_TYPES_CATALOGUE,
    '',
    'TASK',
    '====',
    'Given a single test case (name + description + the AC it should cover), produce the ordered list of steps that exercises it end-to-end.',
    '',
    'OUTPUT — return ONLY this JSON object, no prose, no markdown fences:',
    '{ "steps": [ { "index": 0, "type": "NAVIGATE", "name": "Open registration page", "input": { "url": "/register" }, "aiDescription": "…", "continueOnFail": false }, … ] }',
    '',
    'STRUCTURE — every test follows setup → action → confirmation:',
    '  1. NAVIGATE to the right URL',
    '  2. WAIT_FOR_SELECTOR on the primary form element (avoids timing flake)',
    '  3. FILL / CLICK / etc. — the action under test',
    '  4. ASSERT_* — confirm the outcome (URL change, toast text, redirected element)',
    '',
    'NEGATIVE / EDGE CASES — when the AC is "rejects X", the steps should TRIGGER the failure and ASSERT_TEXT on the error message. Do not just stop after the action.',
  ].join('\n');

  const acBlock = input.acceptanceCriteria?.length
    ? `[ACCEPTANCE CRITERIA — this test must cover all of these]\n` +
      input.acceptanceCriteria.map((a, i) => `${i + 1}. ${a}`).join('\n')
    : '';

  const existingBlock = input.existingSteps?.length
    ? `[EXISTING STEPS — extend, do not duplicate]\n` +
      input.existingSteps
        .map((s) => `${s.index}. [${s.type}] ${s.name}`)
        .join('\n')
    : '';

  const user = [
    `TEST CASE`,
    `=========`,
    `Name: ${input.testName}`,
    input.testDescription ? `Description: ${input.testDescription}` : '',
    '',
    acBlock,
    '',
    existingBlock,
    '',
    input.sources ? buildSourceContext(input.sources) : '',
    '',
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system,
    user,
    schema: g3OutputSchema,
    promptVersion: 'steps-from-test@1.0',
  };
}
