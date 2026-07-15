import { runScript, type ScriptStepSink } from '../steps/script.runner';

// Minimal Page stub — scripts here don't drive a real browser.
const mockPage = { goto: async () => undefined, url: () => 'https://example.com/' } as never;
const noopSink: ScriptStepSink = { start: async () => ({}), end: async () => undefined };

describe('script.runner sandbox', () => {
  it('runs a basic script and captures console output', async () => {
    const res = await runScript(mockPage, 'ctx.log("hello", 42); expect(1).toBe(1);', {}, noopSink);
    expect(res.consoleLines).toEqual(['hello 42']);
  });

  it('exposes vars (read-only copy)', async () => {
    const res = await runScript(mockPage, 'ctx.log(vars.FOO); vars.FOO = "mutated";', { FOO: 'bar' }, noopSink);
    expect(res.consoleLines).toEqual(['bar']);
  });

  it('reports ctx.step lifecycle to the sink', async () => {
    const calls: string[] = [];
    const sink: ScriptStepSink = {
      start: async (n) => { calls.push(`start:${n}`); return { n }; },
      end: async (_h, ok) => { calls.push(`end:${ok}`); },
    };
    await runScript(mockPage, 'await ctx.step("s1", async () => { expect(true).toBeTruthy(); });', {}, sink);
    expect(calls).toEqual(['start:s1', 'end:true']);
  });

  it('marks a failing ctx.step as failed and rethrows', async () => {
    const sink: ScriptStepSink = { start: async () => ({}), end: async () => undefined };
    const endSpy = jest.spyOn(sink, 'end');
    await expect(
      runScript(mockPage, 'await ctx.step("boom", async () => { expect(1).toBe(2); });', {}, sink),
    ).rejects.toThrow();
    expect(endSpy).toHaveBeenCalledWith(expect.anything(), false, expect.stringContaining('toBe'));
  });

  it('blocks require()', async () => {
    await expect(runScript(mockPage, 'const fs = require("fs");', {}, noopSink)).rejects.toThrow();
  });

  it('blocks process access', async () => {
    await expect(runScript(mockPage, 'ctx.log(process.env.SECRET);', {}, noopSink)).rejects.toThrow();
  });

  it('blocks the constructor.constructor eval escape', async () => {
    // Classic sandbox breakout: reach Function via a literal's constructor.
    const escape = 'const F = (()=>{}).constructor; F("return process")();';
    await expect(runScript(mockPage, escape, {}, noopSink)).rejects.toThrow();
  });

  it('blocks eval / new Function (codeGeneration disabled)', async () => {
    await expect(runScript(mockPage, 'eval("1+1");', {}, noopSink)).rejects.toThrow();
    await expect(runScript(mockPage, 'new Function("return 1")();', {}, noopSink)).rejects.toThrow();
  });
});
