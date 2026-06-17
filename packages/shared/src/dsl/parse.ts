import type { Step } from '../types';
import { DslError, type DslSpec, type DslTest } from './types';
import { parseStepLine, defaultStepName } from './verbs';

const DESCRIBE_RE = /^describe\s+"((?:\\.|[^"\\])*)"\s*\{$/;
// it "name" [#id] {   — the optional #id carries the TestDefinition id for sync
const IT_RE = /^it\s+"((?:\\.|[^"\\])*)"\s*(?:#(\S+)\s*)?\{$/;

function unescape(s: string): string {
  return s.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Parse a feature spec into one `describe` with N `it` blocks. Each `it`
 * becomes a DslTest (→ TestDefinition). Throws DslError with a line number on
 * malformed structure or brittle selectors.
 */
export function parseSpec(text: string): DslSpec {
  const rawLines = text.split(/\r?\n/);
  let describe: string | null = null;
  const tests: DslTest[] = [];
  let current: DslTest | null = null;
  let mode: 'top' | 'in_describe' | 'in_it' = 'top';
  let stepIndex = 0;

  for (let n = 0; n < rawLines.length; n++) {
    const lineNo = n + 1;
    const line = rawLines[n].trim();
    if (!line || line.startsWith('//')) continue;

    if (mode === 'top') {
      const m = DESCRIBE_RE.exec(line);
      if (!m) throw new DslError('expected `describe "<name>" {`', lineNo);
      describe = unescape(m[1]);
      mode = 'in_describe';
      continue;
    }

    if (mode === 'in_describe') {
      if (line === '}') {
        mode = 'top';
        continue;
      }
      const m = IT_RE.exec(line);
      if (!m) throw new DslError('expected `it "<name>" {` or `}`', lineNo);
      current = { id: m[2], name: unescape(m[1]), steps: [] };
      stepIndex = 0;
      mode = 'in_it';
      continue;
    }

    // mode === 'in_it'
    if (line === '}') {
      if (current) tests.push(current);
      current = null;
      mode = 'in_describe';
      continue;
    }
    const { type, input } = parseStepLine(line, lineNo);
    const step: Step = { index: stepIndex++, name: defaultStepName(type, input), type, input };
    current!.steps.push(step);
  }

  if (mode !== 'top') throw new DslError('unexpected end of spec — missing closing `}`');
  if (describe === null) throw new DslError('empty spec — expected a `describe` block');
  return { describe, tests };
}
