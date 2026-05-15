import { acExtractSchema } from '../base/output-schemas';
import { buildSourceContext, SourceBundle } from '../base/source-context-builder';

/**
 * Cheap pre-call: pull acceptance criteria out of a source bundle.
 *
 * Used by G2/G3 to seed mappedAcceptanceCriteria — running on the
 * cheapest available model (typically Gemini Flash) because the input
 * is short and the output is structured.
 *
 * @prompt-version: ac-extract@1.0
 */
export function acFromSourcePrompt(sources: SourceBundle) {
  const system = `You are extracting acceptance criteria from QA source material.

Return a JSON object: { "acceptanceCriteria": string[] }.

Each entry is ONE testable bullet, written in present tense, ≤120 chars. Examples:
- "User can register with valid email and password"
- "Registration rejects duplicate email with toast 'Email already in use'"
- "Password field masks input by default"

If the sources mention multiple flows (happy / edge / negative), include all of them as separate bullets. If sources mention behaviour that's NOT testable from the UI (logging, audit trails), skip it.

If the sources are too vague to extract real AC, return { "acceptanceCriteria": [] }.`;

  const user = buildSourceContext(sources) + `\n\nReturn the JSON now.`;

  return {
    system,
    user,
    schema: acExtractSchema,
    promptVersion: 'ac-extract@1.0',
  };
}
