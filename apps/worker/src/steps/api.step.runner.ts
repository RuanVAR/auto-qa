/**
 * ApiStepRunner — executes API test steps (HTTP requests, assertions, extraction).
 *
 * Each step definition looks like:
 *   { type: 'REQUEST', input: { method, url, headers, body } }
 *   { type: 'ASSERT_STATUS', input: { expected: 200 } }
 *   { type: 'ASSERT_BODY', input: { path: '$.user.id', expected: '123' } }
 *   { type: 'ASSERT_HEADER', input: { header: 'Content-Type', expected: 'application/json' } }
 *   { type: 'EXTRACT', input: { path: '$.token', variable: 'AUTH_TOKEN' } }
 *   { type: 'DELAY', input: { ms: 500 } }
 */
export class ApiStepRunner {
  /** Variables extracted during the run (shared across steps in one run) */
  readonly variables: Record<string, string> = {};
  /** Memoised generator outputs — first {{$email}} mints, later refs reuse. */
  private readonly generated: Record<string, string> = {};

  constructor(private readonly baseUrl?: string, initialVariables: Record<string, string> = {}) {
    Object.assign(this.variables, initialVariables);
  }

  private lastResponse: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
  } | null = null;

  async runStep(step: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const type = step.type as string;
    const input = (step.input ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'REQUEST': {
        const method = (input.method as string ?? 'GET').toUpperCase();
        const rawUrl = input.url as string;
        if (!rawUrl) throw new Error('REQUEST step requires an input.url');
        const interpolated = this.interpolate(rawUrl);
        // Resolve relative URLs against the environment baseUrl
        const url =
          interpolated.startsWith('http://') || interpolated.startsWith('https://')
            ? interpolated
            : `${(this.baseUrl ?? '').replace(/\/$/, '')}/${interpolated.replace(/^\//, '')}`;
        const headers = this.buildHeaders(input.headers as Record<string, string> | undefined);
        const body = input.body ? JSON.stringify(input.body) : undefined;

        const res = await fetch(url, { method, headers, body });
        let resBody: unknown;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
          resBody = await res.json();
        } else {
          resBody = await res.text();
        }

        const resHeaders: Record<string, string> = {};
        res.headers.forEach((v, k) => { resHeaders[k] = v; });

        this.lastResponse = { status: res.status, headers: resHeaders, body: resBody };
        return { status: res.status, headers: resHeaders, body: resBody };
      }

      case 'ASSERT_STATUS': {
        if (!this.lastResponse) throw new Error('ASSERT_STATUS must follow a REQUEST step');
        const expected = input.expected as number;
        if (this.lastResponse.status !== expected) {
          throw new Error(`Expected HTTP ${expected}, got ${this.lastResponse.status}`);
        }
        return { passed: true, status: this.lastResponse.status };
      }

      case 'ASSERT_BODY': {
        if (!this.lastResponse) throw new Error('ASSERT_BODY must follow a REQUEST step');
        const path = input.path as string;
        const expected = input.expected;
        const actual = this.getJsonPath(this.lastResponse.body, path);
        if (String(actual) !== String(expected)) {
          throw new Error(`Body assertion failed: path "${path}" expected "${expected}", got "${actual}"`);
        }
        return { passed: true, path, actual };
      }

      case 'ASSERT_HEADER': {
        if (!this.lastResponse) throw new Error('ASSERT_HEADER must follow a REQUEST step');
        const header = (input.header as string).toLowerCase();
        const expected = input.expected as string;
        const actual = this.lastResponse.headers[header] ?? '';
        if (!actual.includes(expected)) {
          throw new Error(`Header assertion failed: "${header}" expected to contain "${expected}", got "${actual}"`);
        }
        return { passed: true, header, actual };
      }

      case 'ASSERT_CONTAINS': {
        if (!this.lastResponse) throw new Error('ASSERT_CONTAINS must follow a REQUEST step');
        const contains = input.value as string;
        const bodyStr = JSON.stringify(this.lastResponse.body);
        if (!bodyStr.includes(contains)) {
          throw new Error(`Body does not contain "${contains}"`);
        }
        return { passed: true };
      }

      case 'EXTRACT': {
        if (!this.lastResponse) throw new Error('EXTRACT must follow a REQUEST step');
        const path = input.path as string;
        const variable = input.variable as string;
        const value = this.getJsonPath(this.lastResponse.body, path);
        this.variables[variable] = String(value ?? '');
        return { extracted: { [variable]: this.variables[variable] } };
      }

      case 'DELAY': {
        const ms = (input.ms as number) ?? 1000;
        await new Promise(r => setTimeout(r, ms));
        return { delayed: ms };
      }

      default:
        throw new Error(`Unknown API step type: ${type}`);
    }
  }

  private interpolate(str: string): string {
    // Generators + plain vars share the engine — see step.runner.ts/interpolate.ts
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { interpolateString } = require('./interpolate') as typeof import('./interpolate');
    return interpolateString(str, { variables: this.variables, generated: this.generated });
  }

  private buildHeaders(raw?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (raw) Object.assign(headers, raw);
    // Interpolate variable tokens
    for (const [k, v] of Object.entries(headers)) {
      headers[k] = this.interpolate(v);
    }
    return headers;
  }

  /** Very lightweight JSON path resolution — supports dot notation and array index */
  private getJsonPath(obj: unknown, path: string): unknown {
    if (!path || path === '$') return obj;
    const clean = path.replace(/^\$\.?/, '');
    return clean.split('.').reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      const arrMatch = key.match(/^(\w+)\[(\d+)\]$/);
      if (arrMatch) {
        return (acc as Record<string, unknown[]>)[arrMatch[1]]?.[Number(arrMatch[2])];
      }
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }
}
