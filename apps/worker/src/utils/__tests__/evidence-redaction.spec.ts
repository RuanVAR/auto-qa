import { REDACTED } from '@qa-platform/shared';
import { createEvidenceRedactionContext, redactEvidence, secretInputSelectors } from '../evidence-redaction';

describe('evidence redaction', () => {
  const context = createEvidenceRedactionContext(
    { BASE_URL: 'https://app.example.test', API_TOKEN: 'env-token' },
    { LOGIN_EMAIL: 'qa@example.test', LOGIN_PASSWORD: 'Password123!' },
  );

  it('redacts secret references and resolved credential bytes before persistence', () => {
    const result = redactEvidence({
      value: '{{LOGIN_PASSWORD}}',
      nested: ['Password123!', '{{API_TOKEN}}', '{{BASE_URL}}'],
    }, context) as Record<string, unknown>;

    expect(JSON.stringify(result)).not.toContain('Password123!');
    expect(JSON.stringify(result)).not.toContain('env-token');
    expect(JSON.stringify(result)).toContain(REDACTED);
    expect(JSON.stringify(result)).toContain('{{BASE_URL}}');
  });

  it('identifies the form control to mask when a secret is typed', () => {
    expect(secretInputSelectors({
      type: 'FILL', input: { selector: '[name=password]', value: '{{LOGIN_PASSWORD}}' },
    }, context)).toEqual(['[name=password]']);
    expect(secretInputSelectors({
      type: 'FILL', input: { selector: '[name=email]', value: '{{LOGIN_EMAIL}}' },
    }, context)).toEqual(['[name=email]']);
  });
});
