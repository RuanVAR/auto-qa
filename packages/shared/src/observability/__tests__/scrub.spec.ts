import { scrubString, scrubDeep, REDACTED } from '../scrub';

/**
 * These tests exist because this scrubber is the last thing standing between a
 * customer's password and a third-party error-tracking service. The worker
 * interpolates real credentials into step inputs, so anything that escapes here
 * escapes for real.
 */
describe('scrubString', () => {
  it.each([
    ['Bearer token', 'Authorization: Bearer abc123.def-456', 'abc123.def-456'],
    ['JWT', 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', 'eyJhbGci'],
    ['platform PAT', 'using qapt_fMgC4J4kljDixg8qm0fBteVHkS3Lz3ABu199wa8qZUY', 'qapt_'],
    ['OpenAI key', 'key sk-proj-abcdefghijklmnopqrstuvwxyz123456', 'sk-proj-'],
    ['Google secret', 'GOCSPX-1a2b3c4d5e6f7g8h', 'GOCSPX-'],
    ['GitHub PAT', 'ghp_abcdefghijklmnopqrstuvwxyz1234567890', 'ghp_'],
    ['postgres URL', 'postgresql://user:hunter2@db:5432/qa', 'hunter2'],
    ['redis URL', 'redis://:s3cret@cache:6379', 's3cret'],
  ])('redacts a %s', (_label, input, leak) => {
    const out = scrubString(input);
    expect(out).not.toContain(leak);
    expect(out).toContain(REDACTED);
  });

  it('leaves ordinary text untouched', () => {
    const msg = 'Timeout waiting for locator getByRole("button", { name: "Save" })';
    expect(scrubString(msg)).toBe(msg);
  });

  it('redacts every occurrence, not just the first', () => {
    const out = scrubString('a=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa b=ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(out).not.toMatch(/ghp_/);
  });
});

describe('scrubDeep', () => {
  it('redacts by key name regardless of value', () => {
    const out = scrubDeep({
      username: 'ruan',
      password: 'hunter2',
      apiKey: 'plain-looking',
      LOGIN_TOKEN: 'anything',
      nested: { clientSecret: 'x' },
    }) as Record<string, unknown>;

    expect(out.username).toBe('ruan'); // not a secret key — preserved
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.LOGIN_TOKEN).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).clientSecret).toBe(REDACTED);
  });

  it('redacts by value shape even under an innocent key', () => {
    // The realistic case: a step input named "value" holding an interpolated
    // credential. Key-name matching alone would miss this entirely.
    const out = scrubDeep({ value: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig' }) as Record<string, unknown>;
    expect(out.value).not.toContain('eyJhbGci');
  });

  it('walks arrays', () => {
    const out = scrubDeep([{ password: 'a' }, { note: 'fine' }]) as Array<Record<string, unknown>>;
    expect(out[0].password).toBe(REDACTED);
    expect(out[1].note).toBe('fine');
  });

  it('stops at depth 8 rather than recursing without bound', () => {
    let deep: Record<string, unknown> = { password: 'leaf' };
    for (let i = 0; i < 20; i++) deep = { nest: deep };
    // Must terminate and must not throw — this runs on the error path.
    expect(() => scrubDeep(deep)).not.toThrow();
    expect(JSON.stringify(scrubDeep(deep))).not.toContain('leaf');
  });

  it('preserves non-string primitives', () => {
    const out = scrubDeep({ count: 42, ok: true, missing: null }) as Record<string, unknown>;
    expect(out).toEqual({ count: 42, ok: true, missing: null });
  });

  it('handles a realistic worker step payload', () => {
    const out = scrubDeep({
      type: 'FILL',
      input: {
        selector: '#password',
        value: 'CustomerRealPassword123!',
        fallbackSelectors: ['[data-testid="pw"]'],
      },
      env: { LOGIN_PASSWORD: 'CustomerRealPassword123!', BASE_URL: 'https://app.example.com' },
    }) as Record<string, unknown>;

    const env = out.env as Record<string, unknown>;
    expect(env.LOGIN_PASSWORD).toBe(REDACTED);
    expect(env.BASE_URL).toBe('https://app.example.com'); // not a secret — kept

    // Known gap, asserted so it is explicit rather than assumed: a password
    // under a non-secret key with no credential-shaped pattern is NOT caught by
    // value matching. Provenance-based classification at resolve time is the
    // real fix (see plan item 1.4); this scrubber is defence in depth, not the
    // primary control.
    const input = out.input as Record<string, unknown>;
    expect(input.value).toBe('CustomerRealPassword123!');
  });
});
