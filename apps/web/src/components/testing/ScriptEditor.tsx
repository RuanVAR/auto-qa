/**
 * ScriptEditor — CodeMirror editor for SCRIPT tests (full Playwright JS run
 * in the worker's vm sandbox). Lazy-loaded so CodeMirror stays out of the
 * main bundle. The script lives in `config.script`; this component owns just
 * the source string — the parent handles name/description/tags/save.
 */
import { Suspense, lazy } from 'react';
import { Info } from 'lucide-react';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

// javascript() language extension — loaded with the editor chunk.
import { javascript } from '@codemirror/lang-javascript';

export const SCRIPT_STARTER = `// Full Playwright script. Available globals:
//   page            — Playwright Page (navigation, clicks, assertions)
//   vars            — env variables + credentials (e.g. vars.PASSWORD)
//   expect(actual)  — toBe / toEqual / toContain / toBeTruthy
//   ctx.step(name, fn) — a named step (shows as a row + live progress)
//   ctx.log(...)    — captured to the run's console log
//
// No require/import/process — the script runs sandboxed.

await ctx.step('Open login page', async () => {
  await page.goto('/login');
  await page.locator('input#email').fill('user@example.com');
  await page.locator('input#password').fill(vars.PASSWORD);
  await page.locator('button[type="submit"]').click();
});

await ctx.step('Land on dashboard', async () => {
  await page.locator('a[href="/customers"]').waitFor({ state: 'visible' });
  expect(page.url()).toContain('/');
});
`;

export function ScriptEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2">
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
        style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'rgba(238,238,248,0.65)' }}
      >
        <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-400)' }} />
        <span>
          Runs sandboxed in the worker. Globals: <code>page</code>, <code>vars</code>,{' '}
          <code>expect</code>, <code>ctx.step()</code>, <code>ctx.log()</code>. No require/import/process.
        </span>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
        <Suspense fallback={<div className="p-4 text-xs text-gray-400">Loading editor…</div>}>
          <CodeMirror
            value={value}
            height="420px"
            theme="dark"
            extensions={[javascript()]}
            onChange={onChange}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          />
        </Suspense>
      </div>
    </div>
  );
}
