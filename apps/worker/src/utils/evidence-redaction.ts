import { REDACTED, scrubDeep, scrubString } from '@qa-platform/shared';

// Keep this aligned with the environment editor/API masking rule. Named
// credentials are always secret; plain environment variables are secret only
// when their name signals that contract.
const SECRET_VARIABLE_NAME = /password|secret|token|key|auth|credential/i;

export type EvidenceRedactionContext = {
  secretNames: ReadonlySet<string>;
  secretValues: readonly string[];
};

export function createEvidenceRedactionContext(
  environmentVariables: Record<string, string>,
  credentialVariables: Record<string, string>,
): EvidenceRedactionContext {
  const secretNames = new Set<string>();
  for (const name of Object.keys(environmentVariables)) {
    if (SECRET_VARIABLE_NAME.test(name)) secretNames.add(name);
  }
  // EnvironmentCredential is an encrypted secret store. Every field it
  // expands is sensitive, regardless of whether the field is named PASSWORD.
  for (const name of Object.keys(credentialVariables)) secretNames.add(name);

  const values = new Set<string>();
  for (const name of secretNames) {
    const value = credentialVariables[name] ?? environmentVariables[name];
    if (value) values.add(value);
  }
  return { secretNames, secretValues: [...values].sort((a, b) => b.length - a.length) };
}

/** Remove secret variable references and their resolved values from evidence. */
export function redactEvidence(value: unknown, context: EvidenceRedactionContext): unknown {
  const replaceString = (raw: string): string => {
    let result = raw.replace(/{{\s*([^{}\s]+)\s*}}/g, (match, name: string) =>
      context.secretNames.has(name) ? REDACTED : match,
    );
    for (const secret of context.secretValues) result = result.split(secret).join(REDACTED);
    return scrubString(result);
  };

  const walk = (entry: unknown): unknown => {
    if (typeof entry === 'string') return replaceString(entry);
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([key, child]) => [key, walk(child)]));
    }
    return entry;
  };

  // scrubDeep provides a second, value-shape/key-name based line of defence
  // for literals that did not originate from environment interpolation.
  return scrubDeep(walk(value));
}

export function redactEvidenceText(value: string, context: EvidenceRedactionContext): string {
  return String(redactEvidence(value, context));
}

/** Selectors whose field values must be masked in failure screenshots. */
export function secretInputSelectors(
  step: Record<string, unknown>,
  context: EvidenceRedactionContext,
): string[] {
  const input = (step.input ?? {}) as Record<string, unknown>;
  const selector = typeof input.selector === 'string' ? input.selector : null;
  if (!selector) return [];
  const candidate = input.value ?? input.text;
  if (typeof candidate !== 'string') return [];

  const containsSecretReference = /{{\s*([^{}\s]+)\s*}}/g;
  let match: RegExpExecArray | null;
  while ((match = containsSecretReference.exec(candidate)) !== null) {
    if (context.secretNames.has(match[1])) return [selector];
  }
  return context.secretValues.some(secret => secret && candidate.includes(secret)) ? [selector] : [];
}
