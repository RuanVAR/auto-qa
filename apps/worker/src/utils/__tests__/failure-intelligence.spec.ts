import { normaliseFailureMessage, fingerprintFailure, triageFailure } from '../failure-intelligence';

describe('normaliseFailureMessage', () => {
  it('strips uuids, timestamps, hex, ports, paths and numbers', () => {
    const msg = 'Request abc123 (id 550e8400-e29b-41d4-a716-446655440000) at 2026-07-20T12:00:00.000Z '
      + 'to localhost:3001 failed at 0xdeadbeef, /app/apps/worker/dist/foo.js:42, nth=3, retried 5 times';
    const n = normaliseFailureMessage(msg);
    expect(n).not.toMatch(/550e8400/);
    expect(n).not.toMatch(/2026-07-20/);
    expect(n).not.toMatch(/0xdeadbeef/);
    expect(n).not.toMatch(/:3001/);
    expect(n).toContain('<port>');
    expect(n).toContain('<uuid>');
    expect(n).toContain('<timestamp>');
    expect(n).toContain('<hex>');
  });

  it('truncates to 500 chars', () => {
    expect(normaliseFailureMessage('x'.repeat(1000)).length).toBeLessThanOrEqual(500);
  });
});

describe('fingerprintFailure', () => {
  it('is stable for the same underlying problem across incidental differences', () => {
    const a = fingerprintFailure('Timeout 30000ms exceeded waiting for locator("#submit") at 2026-07-20T10:00:00.000Z');
    const b = fingerprintFailure('Timeout 45000ms exceeded waiting for locator("#submit") at 2026-07-20T14:32:11.500Z');
    expect(a).toBe(b);
  });

  it('differs for genuinely different problems', () => {
    const a = fingerprintFailure('Timeout waiting for locator("#submit")');
    const b = fingerprintFailure('Expected status 200, got 500');
    expect(a).not.toBe(b);
  });

  it('is a 16-char hex string', () => {
    expect(fingerprintFailure('anything')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('triageFailure', () => {
  it('buckets network/infra errors as ENVIRONMENT', () => {
    expect(triageFailure('connect ECONNREFUSED 127.0.0.1:3001')).toBe('ENVIRONMENT');
    expect(triageFailure('Request failed with status code 503')).toBe('ENVIRONMENT');
    expect(triageFailure('net::ERR_CONNECTION_REFUSED at https://example.com')).toBe('ENVIRONMENT');
  });

  it('buckets selector/locator failures as AUTOMATION', () => {
    expect(triageFailure('strict mode violation: locator resolved to 2 elements')).toBe('AUTOMATION');
    expect(triageFailure('Timeout 30000ms exceeded waiting for locator("#submit")')).toBe('AUTOMATION');
  });

  it('buckets the real multi-line Playwright timeout format (Timeout and the call log are on separate lines)', () => {
    const msg = "locator.click: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#missing')";
    expect(triageFailure(msg)).toBe('AUTOMATION');
  });

  it('buckets assertion step failures as PRODUCT', () => {
    expect(triageFailure('Expected "Welcome" in "Goodbye"', 'ASSERT_TEXT')).toBe('PRODUCT');
  });

  it('stays unclassified rather than guessing', () => {
    expect(triageFailure('Something unexpected happened')).toBeNull();
  });

  it('network pattern takes precedence over step type', () => {
    // An assertion step that failed because the backend was down is an
    // environment problem, not a product one, even though it's ASSERT_*.
    expect(triageFailure('Request failed with status code 502', 'ASSERT_STATUS')).toBe('ENVIRONMENT');
  });
});
