import * as vm from 'vm';
import { Page } from 'playwright';

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
 */

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
