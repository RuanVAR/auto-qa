/**
 * ShellStepRunner — executes shell command steps.
 *
 * Step types:
 *   COMMAND      — runs a shell command, captures exit code and output
 *   ASSERT_EXIT  — asserts the last command's exit code
 *   ASSERT_OUTPUT — asserts the last command's stdout (exact match)
 *   ASSERT_CONTAINS — asserts stdout contains a substring
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ShellStepRunner {
  private lastResult: { exitCode: number; stdout: string; stderr: string } | null = null;

  async runStep(step: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const type = step.type as string;
    const input = (step.input ?? {}) as Record<string, unknown>;

    switch (type) {
      case 'COMMAND': {
        const command = input.command as string;
        if (!command) throw new Error('COMMAND step requires input.command');
        const timeout = (input.timeout as number) ?? 30000;
        try {
          const { stdout, stderr } = await execAsync(command, { timeout });
          this.lastResult = { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
        } catch (err: unknown) {
          const e = err as { code?: number; stdout?: string; stderr?: string };
          this.lastResult = {
            exitCode: e.code ?? 1,
            stdout: (e.stdout ?? '').trim(),
            stderr: (e.stderr ?? '').trim(),
          };
        }
        return { ...this.lastResult };
      }

      case 'ASSERT_EXIT': {
        if (!this.lastResult) throw new Error('ASSERT_EXIT must follow a COMMAND step');
        const expected = (input.expected as number) ?? 0;
        if (this.lastResult.exitCode !== expected) {
          throw new Error(
            `Exit code assertion failed: expected ${expected}, got ${this.lastResult.exitCode}\nStderr: ${this.lastResult.stderr}`,
          );
        }
        return { passed: true, exitCode: this.lastResult.exitCode };
      }

      case 'ASSERT_OUTPUT': {
        if (!this.lastResult) throw new Error('ASSERT_OUTPUT must follow a COMMAND step');
        const expected = input.expected as string;
        if (this.lastResult.stdout !== expected) {
          throw new Error(
            `Output assertion failed: expected "${expected}", got "${this.lastResult.stdout}"`,
          );
        }
        return { passed: true };
      }

      case 'ASSERT_CONTAINS': {
        if (!this.lastResult) throw new Error('ASSERT_CONTAINS must follow a COMMAND step');
        const contains = input.value as string;
        if (!this.lastResult.stdout.includes(contains)) {
          throw new Error(`Output does not contain "${contains}". Got: "${this.lastResult.stdout}"`);
        }
        return { passed: true };
      }

      default:
        throw new Error(`Unknown Shell step type: ${type}`);
    }
  }
}
