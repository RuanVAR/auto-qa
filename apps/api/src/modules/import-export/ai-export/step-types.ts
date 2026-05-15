import { StepType } from '@prisma/client';

/**
 * Hybrid: enum keeps the canonical list (always-fresh) and this file holds
 * the per-type human description + required-fields metadata. Add an entry
 * any time a new StepType lands in the schema; missing entries fall through
 * to a generic "see source" line so docs are never silently incomplete.
 */
type Meta = {
  category: 'ui' | 'api' | 'shell';
  description: string;
  required?: string[];
  optional?: string[];
  example: Record<string, unknown>;
};

const META: Partial<Record<StepType, Meta>> = {
  // ── UI ───────────────────────────────────────────────────────────────
  NAVIGATE: { category: 'ui', description: 'Navigate to a URL.', required: ['url'], optional: ['waitUntil'], example: { type: 'NAVIGATE', url: '/login' } },
  CLICK:    { category: 'ui', description: 'Click an element.', required: ['selector'], example: { type: 'CLICK', selector: '[data-testid=submit]' } },
  DBLCLICK: { category: 'ui', description: 'Double-click an element.', required: ['selector'], example: { type: 'DBLCLICK', selector: '.row' } },
  FILL:     { category: 'ui', description: 'Type a value into an input (replaces existing value).', required: ['selector', 'value'], example: { type: 'FILL', selector: '#email', value: 'user@example.com' } },
  TYPE:     { category: 'ui', description: 'Type a value, character-by-character (preserves existing value, slower than FILL).', required: ['selector', 'value'], example: { type: 'TYPE', selector: '#search', value: 'orders' } },
  CLEAR:    { category: 'ui', description: 'Clear an input.', required: ['selector'], example: { type: 'CLEAR', selector: '#search' } },
  SELECT:   { category: 'ui', description: 'Select an option in a <select>.', required: ['selector', 'value'], example: { type: 'SELECT', selector: '#country', value: 'ZA' } },
  CHECK:    { category: 'ui', description: 'Check a checkbox / radio.', required: ['selector'], example: { type: 'CHECK', selector: '#tos' } },
  UNCHECK:  { category: 'ui', description: 'Uncheck a checkbox.', required: ['selector'], example: { type: 'UNCHECK', selector: '#optin' } },
  ASSERT_TEXT:    { category: 'ui', description: 'Assert an element contains text.', required: ['selector', 'expected'], example: { type: 'ASSERT_TEXT', selector: 'h1', expected: 'Welcome' } },
  ASSERT_VISIBLE: { category: 'ui', description: 'Assert an element is visible.', required: ['selector'], example: { type: 'ASSERT_VISIBLE', selector: '.toast-success' } },
  ASSERT_VALUE:   { category: 'ui', description: 'Assert an input has a value.', required: ['selector', 'expected'], example: { type: 'ASSERT_VALUE', selector: '#email', expected: 'user@example.com' } },
  ASSERT_URL:     { category: 'ui', description: 'Assert the current URL matches.', required: ['expected'], optional: ['matchType'], example: { type: 'ASSERT_URL', expected: '/dashboard' } },
  ASSERT_ELEMENT: { category: 'ui', description: 'Assert an element exists in the DOM (not necessarily visible).', required: ['selector'], example: { type: 'ASSERT_ELEMENT', selector: '#audit-log' } },
  WAIT:               { category: 'ui', description: 'Generic wait — superseded by WAIT_FOR_SELECTOR / WAIT_MS. Avoid in new tests.', optional: ['ms'], example: { type: 'WAIT', ms: 500 } },
  WAIT_FOR_SELECTOR:  { category: 'ui', description: 'Wait until an element appears.', required: ['selector'], optional: ['timeout'], example: { type: 'WAIT_FOR_SELECTOR', selector: '.modal', timeout: 5000 } },
  WAIT_FOR_NAVIGATION:{ category: 'ui', description: 'Wait for a navigation to complete (after a click that triggers it).', optional: ['timeout'], example: { type: 'WAIT_FOR_NAVIGATION', timeout: 5000 } },
  WAIT_MS:    { category: 'ui', description: 'Hard pause for N milliseconds. Use sparingly.', required: ['ms'], example: { type: 'WAIT_MS', ms: 250 } },
  SCREENSHOT: { category: 'ui', description: 'Take a screenshot. Captured automatically on failure too.', optional: ['name', 'fullPage'], example: { type: 'SCREENSHOT', name: 'after-submit' } },
  KEYBOARD:   { category: 'ui', description: 'Press a key sequence ("Enter", "Tab", "Control+A").', required: ['key'], example: { type: 'KEYBOARD', key: 'Enter' } },
  PRESS_KEY:  { category: 'ui', description: 'Same as KEYBOARD — alias preserved for older tests. Prefer KEYBOARD in new tests.', required: ['key'], example: { type: 'PRESS_KEY', key: 'Escape' } },
  SCROLL:     { category: 'ui', description: 'Scroll an element (or window) into view.', required: ['selector'], optional: ['direction'], example: { type: 'SCROLL', selector: '.footer' } },
  HOVER:      { category: 'ui', description: 'Hover over an element.', required: ['selector'], example: { type: 'HOVER', selector: '.tooltip-target' } },
  EXECUTE_SCRIPT: { category: 'ui', description: 'Run arbitrary JS in the page context. Use only when no other step fits.', required: ['script'], example: { type: 'EXECUTE_SCRIPT', script: 'window.scrollTo(0, document.body.scrollHeight)' } },
  CUSTOM:     { category: 'ui', description: 'Escape hatch for plugin-defined steps. Don\'t generate unless the existing tests use it.', optional: ['payload'], example: { type: 'CUSTOM', payload: { handler: 'name', args: {} } } },

  // ── API ──────────────────────────────────────────────────────────────
  REQUEST:        { category: 'api', description: 'Make an HTTP request.', required: ['method', 'url'], optional: ['headers', 'body', 'as'], example: { type: 'REQUEST', method: 'POST', url: '/api/v1/login', body: { email: 'a@b.com', password: 'x' }, as: 'login' } },
  ASSERT_STATUS:  { category: 'api', description: 'Assert the previous response had a given status code.', required: ['expected'], example: { type: 'ASSERT_STATUS', expected: 200 } },
  ASSERT_BODY:    { category: 'api', description: 'Assert a JSON body field equals / contains a value.', required: ['path', 'expected'], optional: ['matchType'], example: { type: 'ASSERT_BODY', path: 'user.id', expected: '*' } },
  ASSERT_HEADER:  { category: 'api', description: 'Assert a response header value.', required: ['name', 'expected'], example: { type: 'ASSERT_HEADER', name: 'content-type', expected: 'application/json' } },
  EXTRACT:        { category: 'api', description: 'Extract a value from the previous response into a variable for later steps.', required: ['path', 'as'], example: { type: 'EXTRACT', path: 'user.id', as: 'userId' } },
  DELAY:          { category: 'api', description: 'Pause between requests.', required: ['ms'], example: { type: 'DELAY', ms: 100 } },
  API_REQUEST:    { category: 'api', description: 'Legacy alias for REQUEST. Don\'t use in new tests.', required: ['method', 'url'], example: { type: 'API_REQUEST', method: 'GET', url: '/api/v1/health' } },

  // ── Shell ────────────────────────────────────────────────────────────
  COMMAND:        { category: 'shell', description: 'Run a shell command in the worker container.', required: ['command'], optional: ['cwd', 'env'], example: { type: 'COMMAND', command: 'curl -fsSL http://api/health' } },
  ASSERT_EXIT:    { category: 'shell', description: 'Assert the previous command\'s exit code.', required: ['expected'], example: { type: 'ASSERT_EXIT', expected: 0 } },
  ASSERT_OUTPUT:  { category: 'shell', description: 'Assert stdout matches a value.', required: ['expected'], optional: ['stream'], example: { type: 'ASSERT_OUTPUT', expected: 'OK' } },
  ASSERT_CONTAINS:{ category: 'shell', description: 'Assert stdout contains a substring.', required: ['expected'], example: { type: 'ASSERT_CONTAINS', expected: 'database connected' } },
};

/**
 * Wraps a raw type-specific example (e.g. `{ type: 'NAVIGATE', url: '/login' }`)
 * into the platform's actual step shape:
 *
 *   {
 *     "index": 0,
 *     "name": "Open the login page",          // human-readable label
 *     "type": "NAVIGATE",
 *     "input": { "url": "/login" },           // type-specific fields LIVE HERE
 *     "aiDescription": "…"                    // optional one-liner
 *   }
 *
 * The flat shape (`{ type, url }`) used to be illustrated by the earlier
 * doc and confused generated tests — the step editor and worker both
 * read from `step.input`, so a flat-shape import would leave the editor
 * showing empty fields and the worker would do nothing on run.
 */
function wrapExample(typeName: string, index: number, name: string, raw: Record<string, unknown>): Record<string, unknown> {
  // Pull `type` out of the raw example; everything else is input.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type: _t, ...input } = raw;
  return {
    index,
    name,
    type: typeName,
    input,
    aiDescription: `Sample ${typeName} step — replace with what the test should actually do here.`,
  };
}

// Friendly names for each step type — used as the `name` field of the
// generated example so agents see what a good human-readable name looks
// like. Falls back to title-cased type name when missing.
const EXAMPLE_NAMES: Partial<Record<StepType, string>> = {
  NAVIGATE: 'Open the page',
  CLICK: 'Click submit',
  DBLCLICK: 'Double-click row to edit',
  FILL: 'Enter the value',
  TYPE: 'Type the search term',
  CLEAR: 'Clear the field',
  SELECT: 'Pick a country',
  CHECK: 'Accept terms',
  UNCHECK: 'Opt out of newsletter',
  ASSERT_TEXT: 'Heading reads "Welcome"',
  ASSERT_VISIBLE: 'Success toast appears',
  ASSERT_VALUE: 'Email field has the value',
  ASSERT_URL: 'Land on /dashboard',
  ASSERT_ELEMENT: 'Audit log row exists',
  WAIT: 'Brief pause',
  WAIT_FOR_SELECTOR: 'Wait for modal to appear',
  WAIT_FOR_NAVIGATION: 'Wait for redirect to finish',
  WAIT_MS: 'Hard pause (avoid)',
  SCREENSHOT: 'Capture after submit',
  KEYBOARD: 'Press Enter',
  PRESS_KEY: 'Press Escape to close',
  SCROLL: 'Scroll footer into view',
  HOVER: 'Hover the tooltip target',
  EXECUTE_SCRIPT: 'Scroll to bottom via JS',
  CUSTOM: 'Plugin-defined step',
  REQUEST: 'POST login',
  ASSERT_STATUS: 'Login returned 200',
  ASSERT_BODY: 'Response body has user.id',
  ASSERT_HEADER: 'Response is JSON',
  EXTRACT: 'Capture the user id for later steps',
  DELAY: 'Brief pause between requests',
  API_REQUEST: 'GET health (legacy)',
  COMMAND: 'Run health check',
  ASSERT_EXIT: 'Command succeeded',
  ASSERT_OUTPUT: 'Output matches "OK"',
  ASSERT_CONTAINS: 'Output contains marker',
};

/** Generates the conventions/02-step-types.md content. */
export function buildStepTypesMarkdown(): string {
  const lines: string[] = [];
  lines.push('# Step types');
  lines.push('');
  lines.push('Every value below is a valid `step.type` in test JSON. Required fields');
  lines.push('must be present or the importer rejects the test. Optional fields are');
  lines.push('included for context.');
  lines.push('');
  lines.push('Generated from the platform\'s `StepType` enum. If a step type appears');
  lines.push('here without a description, it exists in the schema but no spec sheet');
  lines.push('has been written — reach for one of the documented types instead.');
  lines.push('');

  // ── Hard shape contract — put this at the top because every step in every
  // generated test MUST conform. Agents using earlier versions of this doc
  // produced flat-shape steps (`{ type, url }`) that silently passed import
  // but left the step editor blank and the worker doing nothing.
  lines.push('## Step shape — non-negotiable');
  lines.push('');
  lines.push('Every step is an object with EXACTLY these top-level fields:');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    index: 0,
    name: 'Human-readable label',
    type: 'NAVIGATE',
    input: { url: '/login' },
    continueOnFail: false,
    aiDescription: 'Optional one-line description of what the step verifies.',
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('- `index` — 0-based, contiguous, ascending. No gaps.');
  lines.push('- `name` — short, present-tense. Required by the schema; importer auto-fills with `"Step N"` if you skip it, which looks bad in the UI.');
  lines.push('- `type` — one of the enum values listed below.');
  lines.push('- `input` — object that holds ALL type-specific fields (`url`, `selector`, `value`, `expected`, …). The step runner reads from `step.input.X`, not from the top level. **Putting fields at the top level next to `type` means the worker won\'t see them.**');
  lines.push('- `continueOnFail` — optional, default `false`.');
  lines.push('- `aiDescription` — optional, but recommended. Surfaces in the editor under each row.');
  lines.push('');
  lines.push('Every type-specific example below is presented in the wrapped form so you can copy-paste directly.');

  for (const cat of ['ui', 'api', 'shell'] as const) {
    const heading = cat === 'ui' ? 'UI steps' : cat === 'api' ? 'API steps' : 'Shell steps';
    lines.push('', `## ${heading}`, '');

    const types = Object.values(StepType).filter((t) => META[t]?.category === cat);
    types.forEach((t, idx) => {
      const meta = META[t]!;
      lines.push(`### \`${t}\``);
      lines.push('');
      lines.push(meta.description);
      if (meta.required?.length) {
        lines.push('');
        lines.push(`**Required \`input\` fields:** ${meta.required.map((f) => `\`${f}\``).join(', ')}`);
      }
      if (meta.optional?.length) {
        lines.push('');
        lines.push(`**Optional \`input\` fields:** ${meta.optional.map((f) => `\`${f}\``).join(', ')}`);
      }
      lines.push('');
      lines.push('Example (wrapped — copy this shape, not just the inner fields):');
      lines.push('');
      lines.push('```json');
      const wrapped = wrapExample(t, idx, EXAMPLE_NAMES[t] ?? t, meta.example);
      lines.push(JSON.stringify(wrapped, null, 2));
      lines.push('```');
      lines.push('');
    });

    // Surface any enum members in this category we don't have metadata for.
    const undocumented = Object.values(StepType).filter((t) => !META[t]);
    if (cat === 'shell' && undocumented.length > 0) {
      lines.push('', '## Undocumented step types', '');
      lines.push('These exist in the platform schema but have no description in the bundle:');
      lines.push('');
      for (const t of undocumented) lines.push(`- \`${t}\``);
      lines.push('');
      lines.push('Don\'t emit these in generated tests — pick a documented type that fits the same purpose.');
    }
  }

  return lines.join('\n');
}
