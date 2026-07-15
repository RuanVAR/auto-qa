/**
 * ScriptEditor — CodeMirror editor for SCRIPT tests (full Playwright JS run
 * in the worker's vm sandbox). Lazy-loaded so CodeMirror stays out of the
 * main bundle. The script lives in `config.script`; this component owns just
 * the source string — the parent handles name/description/tags/save.
 */
import { Suspense, lazy, useRef, useState, type RefObject } from 'react';
// EditorView type re-exported by react-codemirror (type-only → no bundle cost).
import type { EditorView } from '@uiw/react-codemirror';
import { Braces, Check, Copy, Info } from 'lucide-react';
import { toast } from '@/components/ui/Toast';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

// javascript() language extension — loaded with the editor chunk.
import { javascript } from '@codemirror/lang-javascript';

export const SCRIPT_STARTER = `// Full Playwright script — runs sandboxed in the worker.
//
// Globals (no require / import / process):
//   page                Playwright Page — navigation, clicks, assertions
//   vars                env variables + credentials, e.g. vars.PASSWORD
//   expect(actual)      toBe / toEqual / toContain / toBeTruthy
//   ctx.step(name, fn)  a named step — shows as a row with live progress
//   ctx.log(...)        captured to the run's console log
//   data.*              fresh test data — data.email(), data.name.full(), data.saId()
//   api.*               HTTP calls — api.get(url), api.post(url, { data })
//
// Group the flow into ctx.step() blocks so each streams live:

const email = data.email();          // fresh random email for this run
const fullName = data.name.full();

await ctx.step('Register a new account', async () => {
  await page.goto('/register');
  await page.locator('input[name="name"]').fill(fullName);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(vars.PASSWORD);
  await page.locator('button[type="submit"]').click();
});

await ctx.step('Land on the dashboard', async () => {
  await page.locator('nav').waitFor({ state: 'visible' });
  expect(page.url()).toContain('/dashboard');
  await ctx.log('Signed in as', email);
});

await ctx.step('Verify the account via API', async () => {
  const res = await api.get('/api/users/me');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.email).toBe(email);
});
`;

// data.* helpers — mirror the worker's generators (interpolate.ts). Click to
// insert the call at the cursor. Values are minted fresh on every call.
const DATA_HELPERS: Array<{ insert: string; label: string }> = [
  { insert: 'data.email()', label: 'Random email address' },
  { insert: 'data.password(12)', label: 'Strong password' },
  { insert: 'data.name.full()', label: 'Full name' },
  { insert: 'data.name.first()', label: 'First name' },
  { insert: 'data.name.last()', label: 'Last name' },
  { insert: "data.saId('18-65')", label: 'Valid SA ID number (age range)' },
  { insert: "data.dob('18-65')", label: 'Date of birth' },
  { insert: 'data.saPhone()', label: 'SA mobile number (+27)' },
  { insert: 'data.saPassport()', label: 'SA passport number' },
  { insert: 'data.phone()', label: 'US phone number' },
  { insert: 'data.uuid()', label: 'UUID v4' },
  { insert: 'data.randomString(8)', label: 'Random hex string' },
  { insert: 'data.randomInt(1000)', label: 'Random integer' },
  { insert: 'data.timestamp()', label: 'ISO timestamp' },
  { insert: 'data.epoch()', label: 'Unix epoch (ms)' },
  { insert: 'data.date()', label: "Today's date" },
];

function DataHelperMenu({ viewRef }: { viewRef: RefObject<EditorView | null> }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const use = (text: string) => {
    const view = viewRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
      view.focus();
    } else {
      // Editor not ready — fall back to clipboard.
      navigator.clipboard?.writeText(text).then(() => toast.success(`Copied ${text}`)).catch(() => {});
    }
    setDone(text);
    setTimeout(() => setDone((d) => (d === text ? null : d)), 1200);
    setOpen(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px]"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.7)' }}
        title="Insert a fresh-data helper at the cursor — random name, email, SA ID number, etc."
      >
        <Braces size={12} /> Data helpers
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-1 z-50 w-72 max-h-80 overflow-auto rounded-xl p-1.5 shadow-xl"
            style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <p className="px-2 py-1.5 text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Click to insert at the cursor. Each call returns a new value.
            </p>
            {DATA_HELPERS.map(({ insert, label }) => (
              <button
                key={insert}
                type="button"
                onClick={() => use(insert)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-white/5"
              >
                <span className="min-w-0">
                  <code className="font-mono" style={{ color: 'var(--accent-300)' }}>{insert}</code>
                  <span className="block truncate" style={{ color: 'rgba(238,238,248,0.5)' }}>{label}</span>
                </span>
                {done === insert ? <Check size={13} style={{ color: '#34d399' }} /> : <Copy size={12} style={{ color: 'rgba(238,238,248,0.4)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ScriptEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const viewRef = useRef<EditorView | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(var(--accent-rgb),0.08)', color: 'rgba(238,238,248,0.65)' }}
        >
          <Info size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--accent-400)' }} />
          <span>
            Runs sandboxed in the worker. Globals: <code>page</code>, <code>vars</code>,{' '}
            <code>expect</code>, <code>ctx.step()</code>, <code>ctx.log()</code>, <code>data.*</code>{' '}
            (fresh test data), <code>api.*</code> (HTTP via <code>page.request</code>). No require/import/process.
          </span>
        </div>
        <div className="shrink-0 pt-0.5">
          <DataHelperMenu viewRef={viewRef} />
        </div>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
        <Suspense fallback={<div className="p-4 text-xs text-gray-400">Loading editor…</div>}>
          <CodeMirror
            value={value}
            height="420px"
            theme="dark"
            extensions={[javascript()]}
            onChange={onChange}
            onCreateEditor={(view) => { viewRef.current = view; }}
            basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true }}
          />
        </Suspense>
      </div>
    </div>
  );
}
