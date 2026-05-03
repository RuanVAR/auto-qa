import { ApiStepRunner } from '../steps/api.step.runner';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function makeFetchResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: {
      get: (key: string) => headers[key] ?? (key === 'content-type' ? 'application/json' : null),
      forEach: (cb: (v: string, k: string) => void) => Object.entries(headers).forEach(([k, v]) => cb(v, k)),
    },
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  };
}

describe('ApiStepRunner', () => {
  let runner: ApiStepRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new ApiStepRunner();
  });

  describe('REQUEST', () => {
    it('makes a GET request and stores response', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, { id: 1, name: 'test' }));
      const result = await runner.runStep({ type: 'REQUEST', input: { method: 'GET', url: 'https://api.example.com/users/1' } });
      expect(result).toMatchObject({ status: 200 });
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/users/1', expect.objectContaining({ method: 'GET' }));
    });

    it('makes a POST request with body', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(201, { id: 2 }));
      const result = await runner.runStep({ type: 'REQUEST', input: { method: 'POST', url: 'https://api.example.com/users', body: { name: 'Alice' } } });
      expect(result).toMatchObject({ status: 201 });
    });

    it('interpolates variables in URL', async () => {
      runner.variables['USER_ID'] = '42';
      mockFetch.mockResolvedValue(makeFetchResponse(200, {}));
      await runner.runStep({ type: 'REQUEST', input: { method: 'GET', url: 'https://api.example.com/users/{{USER_ID}}' } });
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/users/42', expect.anything());
    });

    it('throws when url is missing', async () => {
      await expect(runner.runStep({ type: 'REQUEST', input: { method: 'GET' } })).rejects.toThrow('requires an input.url');
    });
  });

  describe('ASSERT_STATUS', () => {
    it('passes when status matches', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, {}));
      await runner.runStep({ type: 'REQUEST', input: { method: 'GET', url: 'https://example.com' } });
      const result = await runner.runStep({ type: 'ASSERT_STATUS', input: { expected: 200 } });
      expect(result).toMatchObject({ passed: true });
    });

    it('throws when status does not match', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(404, {}));
      await runner.runStep({ type: 'REQUEST', input: { method: 'GET', url: 'https://example.com' } });
      await expect(runner.runStep({ type: 'ASSERT_STATUS', input: { expected: 200 } })).rejects.toThrow('Expected HTTP 200, got 404');
    });

    it('throws when no prior REQUEST', async () => {
      await expect(runner.runStep({ type: 'ASSERT_STATUS', input: { expected: 200 } })).rejects.toThrow('must follow a REQUEST');
    });
  });

  describe('ASSERT_BODY', () => {
    beforeEach(async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, { user: { id: '123', name: 'Alice' } }));
      await runner.runStep({ type: 'REQUEST', input: { method: 'GET', url: 'https://example.com' } });
    });

    it('passes on matching json path', async () => {
      const result = await runner.runStep({ type: 'ASSERT_BODY', input: { path: '$.user.id', expected: '123' } });
      expect(result).toMatchObject({ passed: true });
    });

    it('throws on mismatch', async () => {
      await expect(runner.runStep({ type: 'ASSERT_BODY', input: { path: '$.user.name', expected: 'Bob' } })).rejects.toThrow('Body assertion failed');
    });
  });

  describe('EXTRACT', () => {
    it('stores extracted value in variables', async () => {
      mockFetch.mockResolvedValue(makeFetchResponse(200, { token: 'abc123' }));
      await runner.runStep({ type: 'REQUEST', input: { method: 'POST', url: 'https://example.com/login' } });
      await runner.runStep({ type: 'EXTRACT', input: { path: '$.token', variable: 'AUTH_TOKEN' } });
      expect(runner.variables['AUTH_TOKEN']).toBe('abc123');
    });
  });

  describe('DELAY', () => {
    it('waits for the specified ms', async () => {
      const start = Date.now();
      await runner.runStep({ type: 'DELAY', input: { ms: 50 } });
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });
  });
});
