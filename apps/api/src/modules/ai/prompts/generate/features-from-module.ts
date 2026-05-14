import { g1OutputSchema } from '../base/output-schemas';
import { QA_ENGINEER_PERSONA } from '../base/qa-engineer-persona';
import { buildSourceContext, SourceBundle } from '../base/source-context-builder';

/**
 * G1 — first pass: extract a list of features (name + description +
 * acceptance criteria) from a module's source bundle.
 *
 * Two-pass design: this prompt only proposes features. After the user
 * accepts a subset, the apply endpoint creates Feature rows. From there
 * the user runs G2 per feature to flesh out test cases (or we wire a
 * BullMQ fan-out in a follow-up).
 *
 * Why two-pass: a module can contain 10–30 features, each with several
 * tests. Producing everything in one prompt blows context, fails Zod
 * validation more often, and gives the reviewer a wall of text to triage.
 * Splitting into "features first, tests later" lets the reviewer prune
 * the noise before paying for the heavy generation work.
 *
 * @prompt-version: features-from-module@1.0
 */
export interface FeaturesFromModuleInput {
  moduleName: string;
  moduleDescription?: string | null;
  /** Names of features already in the module — dedupe hint. */
  existingFeatureNames?: string[];
  sources: SourceBundle;
}

export function featuresFromModulePrompt(input: FeaturesFromModuleInput) {
  const system = [
    QA_ENGINEER_PERSONA,
    '',
    'TASK',
    '====',
    'Given a module and its source material (free-text notes, attached docs, linked tickets), produce a list of FEATURES — discrete units of behaviour the QA team would test as a group.',
    '',
    'A feature is NOT a test case. It is a coherent slice of product behaviour. Examples:',
    '  • "User Registration" — registration UI + form validation + account creation',
    '  • "Forgot Password" — request reset + email link + new-password form',
    '  • "Profile Editing" — view profile + edit fields + save + cancel',
    '',
    'Each feature carries `extractedAc` — the acceptance criteria bullets you pulled from the sources. The reviewer uses this to decide whether the feature is worth keeping.',
    '',
    'OUTPUT — return ONLY this JSON object, no prose, no markdown fences:',
    '{',
    '  "features": [',
    '    {',
    '      "name": "User Registration",',
    '      "description": "Self-serve sign-up: email + password form, validation, account creation, redirect to dashboard.",',
    '      "extractedAc": [',
    '        "User can register with valid email and password",',
    '        "Registration rejects duplicate email",',
    '        "After success, user lands on /dashboard"',
    '      ]',
    '    },',
    '    ...',
    '  ]',
    '}',
    '',
    'SIZING — aim for 3–12 features. If the sources describe one tightly-scoped thing, return 1–3. If they describe a sprawling area, group by user-facing surface, not by every checkbox.',
    '',
    'NAMING — short, real product nouns. "User Registration", not "the registration system feature".',
    '',
    'DEDUPE — when existing feature names are listed, do NOT propose the same one again. Add only what is missing.',
    '',
    'When the sources are too vague to extract meaningful features, return { "features": [] } — better empty than fabricated.',
  ].join('\n');

  const existingBlock = input.existingFeatureNames?.length
    ? `[EXISTING FEATURES IN THIS MODULE — do not duplicate]\n` +
      input.existingFeatureNames.map((n) => `- ${n}`).join('\n')
    : '';

  const user = [
    `MODULE`,
    `======`,
    `Name: ${input.moduleName}`,
    input.moduleDescription ? `Description: ${input.moduleDescription}` : '',
    '',
    existingBlock,
    '',
    buildSourceContext(input.sources),
    '',
    'Return the JSON object now.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    system,
    user,
    schema: g1OutputSchema,
    promptVersion: 'features-from-module@1.0',
  };
}
