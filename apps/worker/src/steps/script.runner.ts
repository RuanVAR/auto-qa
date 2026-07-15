import * as vm from 'node:vm';
import { Page } from 'playwright';
import { generate } from './interpolate';
import { assertSafeTargetUrl } from '../utils/ssrf-guard';

/**
 * SCRIPT test execution — full Playwright JS from `TestDefinition.config.script`,
 * run inside a hardened `node:vm` context.
 *
 * The sandbox is SCOPING, not a hard security boundary: the script receives a
 * live `page`, which already grants arbitrary in-page JS (same trust tier as
 * the EXECUTE_SCRIPT step). What the vm removes is ambient Node access —
 * no require/import/process/globalThis, no dynamic code generation.
 *
 * Exposed API (script body is wrapped in an async IIFE):
 *   page               — the Playwright Page
 *   vars               — env variables + credentials + built-ins (read-only copy)
 *   expect(actual)     — minimal matchers: toBe/toEqual/toContain/toBeTruthy
 *   ctx.step(name, fn) — a named step; reported as a RunStep row (live progress)
 *   ctx.log(...args)   — captured to the run's console buffer
 *   data.*             — fresh test data (email/name/saId/…) per call
 *   api.get/post/…     — SSRF-guarded HTTP calls via page.request (shares cookies)
 */

/** Fresh test data per call — mirrors the {{$token}} generators. */
function makeData() {
  const g = (key: string, arg?: number | string) =>
    generate(key, arg == null ? undefined : String(arg));
  return Object.freeze({
    email: () => g('email'),
    password: (len?: number) => g('password', len),
    uuid: () => g('uuid'),
    timestamp: () => g('timestamp'),
    epoch: () => g('epoch'),
    randomString: (len?: number) => g('randomString', len),
    randomInt: (max?: number) => Number(g('randomInt', max)),
    phone: () => g('phone'),
    date: () => g('date'),
    name: Object.freeze({
      first: () => g('name.first'),
      last: () => g('name.last'),
      full: () => g('name.full'),
    }),
    saId: (ageRange?: string) => g('id.sa', ageRange),
    dob: (ageRange?: string) => g('dob', ageRange),
    saPhone: () => g('phone.sa'),
    saPassport: () => g('passport.sa'),
  });
}

/**
 * First-class HTTP client — wraps page.request (Playwright's APIRequestContext,
 * so it shares the browser's cookies/auth) with an explicit SSRF check on every
 * call. Relative URLs resolve against the environment base URL.
 */
function makeApi(page: Page, baseURL: string | undefined) {
  const resolve = (url: string): string => {
    if (typeof url !== 'string' || !url) throw new Error('api call requires a URL string');
    try {
      return new URL(url).href;
    } catch {
      if (!baseURL) throw new Error(`Relative URL "${url}" needs an environment base URL to resolve`);
      return new URL(url, baseURL).href;
    }
  };
  const req = page.request as unknown as Record<string, (u: string, o?: unknown) => Promise<unknown>>;
  const method = (name: string) => async (url: string, opts?: unknown) => {
    const abs = resolve(url);
    await assertSafeTargetUrl(abs); // block cloud-metadata / link-local / private hosts
    return req[name](abs, opts);
  };
  return Object.freeze({
    get: method('get'),
    post: method('post'),
    put: method('put'),
    patch: method('patch'),
    delete: method('delete'),
    head: method('head'),
    fetch: method('fetch'),
  });
}

export interface ScriptStepSink {
  /** Called when a ctx.step() begins — returns a handle for end(). */
  start(name: string): Promise<unknown>;
  /** Called when the step settles. */
  end(handle: unknown, ok: boolean, error?: string): Promise<void>;
}

export interface ScriptRunResult {
  consoleLines: string[];
}

class ExpectError extends Error {}

function makeExpect() {
  return (actual: unknown) => ({
    toBe(expected: unknown) {
      if (actual !== expected) throw new ExpectError(`expect(...).toBe — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new ExpectError(`expect(...).toEqual — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toContain(needle: string) {
      if (typeof actual !== 'string' || !actual.includes(needle)) throw new ExpectError(`expect(...).toContain — "${needle}" not in ${JSON.stringify(actual)}`);
    },
    toBeTruthy() {
      if (!actual) throw new ExpectError(`expect(...).toBeTruthy — got ${JSON.stringify(actual)}`);
    },
  });
}

const fmt = (a: unknown[]): string =>
  a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ');

export async function runScript(
  page: Page,
  source: string,
  vars: Record<string, string>,
  sink: ScriptStepSink,
  baseURL?: string,
): Promise<ScriptRunResult> {
  const consoleLines: string[] = [];
  const log = (...args: unknown[]) => { consoleLines.push(fmt(args)); };

  const ctx = {
    log,
    async step(name: string, fn: () => Promise<unknown> | unknown): Promise<void> {
      if (typeof name !== 'string' || typeof fn !== 'function') {
        throw new Error('ctx.step(name, fn) requires a string name and a function');
      }
      const handle = await sink.start(name);
      try {
        await fn();
        await sink.end(handle, true);
      } catch (err) {
        await sink.end(handle, false, (err as Error)?.message ?? String(err));
        throw err;
      }
    },
  };

  // Null-prototype sandbox: nothing but what we hand over. A frozen console
  // shim keeps `console.log` working (captured, not printed).
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox.page = page;
  sandbox.vars = Object.freeze({ ...vars });
  sandbox.expect = makeExpect();
  sandbox.ctx = Object.freeze(ctx);
  sandbox.data = makeData();
  sandbox.api = makeApi(page, baseURL);
  sandbox.console = Object.freeze({ log, info: log, warn: log, error: log });

  // The wrapper returns the async function; we invoke it outside so the vm
  // only compiles code — the returned promise runs on the host loop with
  // the real page object. codeGeneration:false blocks eval/new Function.
  const wrapped = `(async () => {\n${source}\n})`;
  let fn: () => Promise<unknown>;
  try {
    fn = vm.runInNewContext(wrapped, vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } }), {
      timeout: 5000, // compile-time only — runtime is bounded by the executor's deadline race
      filename: 'test-script.js',
    }) as () => Promise<unknown>;
  } catch (err) {
    throw new Error(`Script failed to parse: ${(err as Error).message}`);
  }

  await fn();
  return { consoleLines };
}
