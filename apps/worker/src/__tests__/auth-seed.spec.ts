import { resolveAuthSeed, AUTH_SEED_VAR } from '../services/auth-seed';

/**
 * auth-seed had no test coverage at all, which is how it ended up being the one
 * outbound path in the worker that skipped the SSRF guard. The mint mode POSTs
 * to a user-supplied URL and injects whatever token comes back into the browser
 * — so an unguarded loginUrl pointing at cloud metadata would have seeded the
 * response of an internal endpoint into a real test session.
 */

const seed = (cfg: unknown) => ({ [AUTH_SEED_VAR]: JSON.stringify(cfg) });

describe('resolveAuthSeed — SSRF guard on mint mode', () => {
  const realFetch = global.fetch;
  let fetchSpy: jest.Mock;

  beforeEach(() => {
    fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  // Always blocked, regardless of configuration — these have no legitimate use
  // as a login endpoint and are the actual attack targets.
  it.each([
    ['AWS/GCP metadata', 'http://169.254.169.254/latest/meta-data/iam/'],
    ['GCP metadata host', 'http://metadata.google.internal/computeMetadata/v1/'],
    ['link-local', 'http://169.254.1.1/'],
    ['non-http scheme', 'file:///etc/passwd'],
  ])('refuses to POST to %s', async (_label, loginUrl) => {
    const out = await resolveAuthSeed(
      seed({ loginUrl, email: 'a@b.c', password: 'x' }),
    );

    // The guard must fire BEFORE the request — a blocked URL that was still
    // fetched has already leaked whatever the response contained.
    expect(fetchSpy).not.toHaveBeenCalled();
    // Failure degrades to unauthenticated rather than throwing: a bad seed
    // should make dependent tests fail honestly, not abort the whole run.
    expect(out).toBeNull();
  });

  // Loopback and RFC-1918 are deliberately ALLOWED by default: this is a
  // self-hosted platform and an environment's baseUrl frequently points at
  // localhost or a private host. Strict tenants opt in with
  // WORKER_SSRF_BLOCK_PRIVATE. Asserting both halves so the contract is
  // explicit rather than assumed.
  it('allows loopback by default (self-hosted apps under test)', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: { token: 't' } }) });

    const out = await resolveAuthSeed(
      seed({ loginUrl: 'http://127.0.0.1:3001/auth/login', email: 'a@b.c', password: 'x' }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ token: 't' });
  });

  it('blocks loopback when WORKER_SSRF_BLOCK_PRIVATE is on', async () => {
    process.env.WORKER_SSRF_BLOCK_PRIVATE = 'true';
    try {
      const out = await resolveAuthSeed(
        seed({ loginUrl: 'http://127.0.0.1:3001/auth/login', email: 'a@b.c', password: 'x' }),
      );
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(out).toBeNull();
    } finally {
      delete process.env.WORKER_SSRF_BLOCK_PRIVATE;
    }
  });

  it('allows a legitimate external login URL', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { token: 'jwt-value' } }),
    });

    const out = await resolveAuthSeed(
      seed({ loginUrl: 'https://app.example.com/auth/login', email: 'a@b.c', password: 'x' }),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ token: 'jwt-value' });
  });

  it('honours custom tokenPath and tokenKey', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ session: { accessToken: 'abc' } }),
    });

    const out = await resolveAuthSeed(
      seed({
        loginUrl: 'https://app.example.com/login',
        tokenPath: 'session.accessToken',
        tokenKey: 'auth_token',
        email: 'a@b.c',
        password: 'x',
      }),
    );

    expect(out).toEqual({ auth_token: 'abc' });
  });

  it('returns null when the login response has no token at the path', async () => {
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });

    const out = await resolveAuthSeed(
      seed({ loginUrl: 'https://app.example.com/login', email: 'a@b.c', password: 'x' }),
    );

    expect(out).toBeNull();
  });

  it('returns null on a non-2xx login', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const out = await resolveAuthSeed(
      seed({ loginUrl: 'https://app.example.com/login', email: 'a@b.c', password: 'x' }),
    );

    expect(out).toBeNull();
  });
});

describe('resolveAuthSeed — static mode', () => {
  it('injects a static localStorage payload without any network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const out = await resolveAuthSeed(seed({ localStorage: { token: 'static-jwt' } }));

    expect(out).toEqual({ token: 'static-jwt' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null when no seed variable is present', async () => {
    expect(await resolveAuthSeed({})).toBeNull();
  });

  it('returns null on malformed JSON rather than throwing', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await resolveAuthSeed({ [AUTH_SEED_VAR]: '{not json' })).toBeNull();
    jest.restoreAllMocks();
  });
});
