import { ShellStepRunner } from '../steps/shell.step.runner';

describe('ShellStepRunner', () => {
  let runner: ShellStepRunner;

  beforeEach(() => {
    runner = new ShellStepRunner();
  });

  describe('COMMAND', () => {
    it('runs a simple command and captures exit code 0', async () => {
      const result = await runner.runStep({ type: 'COMMAND', input: { command: 'echo hello' } }) as Record<string, unknown>;
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello');
    });

    it('captures non-zero exit code without throwing', async () => {
      const result = await runner.runStep({ type: 'COMMAND', input: { command: 'exit 1', timeout: 5000 } }) as Record<string, unknown>;
      expect(result.exitCode).not.toBe(0);
    });

    it('throws when command is missing', async () => {
      await expect(runner.runStep({ type: 'COMMAND', input: {} })).rejects.toThrow('requires input.command');
    });
  });

  describe('ASSERT_EXIT', () => {
    it('passes when exit code matches', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'echo ok' } });
      const result = await runner.runStep({ type: 'ASSERT_EXIT', input: { expected: 0 } });
      expect(result).toMatchObject({ passed: true, exitCode: 0 });
    });

    it('throws when exit code does not match', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'false' } });
      await expect(runner.runStep({ type: 'ASSERT_EXIT', input: { expected: 0 } })).rejects.toThrow('Exit code assertion failed');
    });

    it('throws when no prior COMMAND', async () => {
      await expect(runner.runStep({ type: 'ASSERT_EXIT', input: { expected: 0 } })).rejects.toThrow('must follow a COMMAND');
    });
  });

  describe('ASSERT_OUTPUT', () => {
    it('passes when output matches exactly', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'echo hello' } });
      const result = await runner.runStep({ type: 'ASSERT_OUTPUT', input: { expected: 'hello' } });
      expect(result).toMatchObject({ passed: true });
    });

    it('throws on mismatch', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'echo hello' } });
      await expect(runner.runStep({ type: 'ASSERT_OUTPUT', input: { expected: 'world' } })).rejects.toThrow('Output assertion failed');
    });
  });

  describe('ASSERT_CONTAINS', () => {
    it('passes when output contains the substring', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'echo hello world' } });
      const result = await runner.runStep({ type: 'ASSERT_CONTAINS', input: { value: 'hello' } });
      expect(result).toMatchObject({ passed: true });
    });

    it('throws when output does not contain the substring', async () => {
      await runner.runStep({ type: 'COMMAND', input: { command: 'echo hello' } });
      await expect(runner.runStep({ type: 'ASSERT_CONTAINS', input: { value: 'foobar' } })).rejects.toThrow('does not contain');
    });
  });
});
