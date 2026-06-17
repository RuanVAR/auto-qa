import type { Step } from '../types';
import type { DslSpec, DslTest } from './types';
import { stepToLine, quote } from './verbs';

const INDENT = '  ';

/** Serialize a parsed spec back to DSL text. parse(serialize(spec)) is stable. */
export function serializeSpec(spec: DslSpec): string {
  const lines: string[] = [];
  lines.push(`describe ${quote(spec.describe)} {`);
  for (const test of spec.tests) {
    const idTag = test.id ? ` #${test.id}` : '';
    lines.push(`${INDENT}it ${quote(test.name)}${idTag} {`);
    for (const step of test.steps) {
      lines.push(`${INDENT}${INDENT}${stepToLine(step)}`);
    }
    lines.push(`${INDENT}}`);
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

/** Build a spec object from a feature name + its tests (name + steps + id). */
export function specFromTests(
  describe: string,
  tests: Array<{ id?: string; name: string; steps: Step[] }>,
): DslSpec {
  return { describe, tests: tests.map((t): DslTest => ({ id: t.id, name: t.name, steps: t.steps })) };
}
