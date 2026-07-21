import { describe, expect, it } from 'vitest';
import { correlateDiagnostic } from '../diagnostic-correlation';

const step = { startedAt: '2026-07-21T07:00:00.000Z', completedAt: '2026-07-21T07:00:05.000Z', errorMessage: 'Locator timed out' };

describe('correlateDiagnostic', () => {
  it('selects the strongest diagnostic emitted during the failed step', () => {
    const result = correlateDiagnostic(
      step,
      JSON.stringify([{ at: '2026-07-21T07:00:02.000Z', type: 'error', text: 'unrelated error' }]),
      JSON.stringify([{ at: '2026-07-21T07:00:04.800Z', type: 'response', url: 'https://api.example.test/users', status: 500 }]),
    );
    expect(result).toMatchObject({ source: 'network', status: 500 });
  });

  it('does not attach diagnostics outside the step window', () => {
    const result = correlateDiagnostic(
      step,
      JSON.stringify([{ at: '2026-07-21T06:59:40.000Z', type: 'pageerror', text: 'earlier failure' }]),
    );
    expect(result).toBeNull();
  });
});
