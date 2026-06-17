import type { Step } from '../types';

/** One `it(...)` block — maps 1:1 to a TestDefinition under the feature. */
export interface DslTest {
  /**
   * Stable TestDefinition id, encoded in the spec as `#<id>` after the test
   * name so re-saving matches existing tests instead of recreating them.
   * Undefined for a newly-authored `it` block (sync creates a fresh test).
   */
  id?: string;
  name: string;
  steps: Step[];
}

/** A parsed feature spec — one `describe` containing N `it` blocks. */
export interface DslSpec {
  describe: string;
  tests: DslTest[];
}

/** Raised on malformed DSL or a brittle selector. Carries the 1-based line. */
export class DslError extends Error {
  constructor(message: string, public readonly line?: number) {
    super(line ? `Line ${line}: ${message}` : message);
    this.name = 'DslError';
  }
}
