import { useState, useRef } from 'react';
import {
  Plus, Trash2, GripVertical, ChevronDown, ChevronUp, HelpCircle,
  Zap, Globe, MousePointer, Type, Eye, Timer, Camera, Code2, CheckSquare,
  X, Save, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StepType =
  | 'NAVIGATE' | 'WAIT_FOR_NAVIGATION'
  | 'CLICK' | 'DBLCLICK' | 'HOVER' | 'FILL' | 'TYPE' | 'CLEAR' | 'SELECT' | 'CHECK' | 'UNCHECK'
  | 'KEYBOARD' | 'PRESS_KEY' | 'SCROLL'
  | 'WAIT' | 'WAIT_MS' | 'WAIT_FOR_SELECTOR'
  | 'ASSERT_TEXT' | 'ASSERT_VISIBLE' | 'ASSERT_VALUE' | 'ASSERT_URL' | 'ASSERT_ELEMENT'
  | 'SCREENSHOT' | 'API_REQUEST' | 'EXECUTE_SCRIPT' | 'CUSTOM';

export interface StepInput {
  // Manual instruction (shown to QA in manual mode; auto-generated description used otherwise)
  description?: string;
  // NAVIGATE
  url?: string;
  waitUntil?: string;
  state?: string;
  // CLICK / HOVER
  selector?: string;
  button?: string;
  force?: boolean;
  // FILL / SELECT
  value?: string;
  text?: string;
  delay?: number;
  // ASSERT_TEXT
  matchMode?: string;
  caseSensitive?: boolean;
  // ASSERT_VALUE
  expectedValue?: string;
  // ASSERT_URL
  // ASSERT_VISIBLE
  shouldBeVisible?: boolean;
  // WAIT
  ms?: number;
  // KEYBOARD
  key?: string;
  // SCROLL
  x?: number;
  y?: number;
  // SCREENSHOT
  name?: string;
  label?: string;
  fullPage?: boolean;
  // API_REQUEST
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  // CUSTOM
  handler?: string;
  script?: string;
  options?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Step {
  index: number;
  name: string;
  type: StepType;
  input: StepInput;
  continueOnFail?: boolean;
  timeoutMs?: number;
  aiDescription?: string;
}

// ─── Step type metadata ───────────────────────────────────────────────────────

const STEP_CATEGORIES: { label: string; types: StepType[]; icon: React.ReactNode; color: string }[] = [
  { label: 'Navigation', types: ['NAVIGATE', 'WAIT_FOR_NAVIGATION'], icon: <Globe size={12} />, color: '#60a5fa' },
  { label: 'Interaction', types: ['CLICK', 'DBLCLICK', 'FILL', 'TYPE', 'CLEAR', 'SELECT', 'CHECK', 'UNCHECK', 'HOVER', 'KEYBOARD', 'PRESS_KEY', 'SCROLL'], icon: <MousePointer size={12} />, color: '#34d399' },
  { label: 'Assertions', types: ['ASSERT_TEXT', 'ASSERT_VISIBLE', 'ASSERT_VALUE', 'ASSERT_URL', 'ASSERT_ELEMENT'], icon: <CheckSquare size={12} />, color: '#c084fc' },
  { label: 'Waits', types: ['WAIT', 'WAIT_MS', 'WAIT_FOR_SELECTOR'], icon: <Timer size={12} />, color: '#fbbf24' },
  { label: 'Media', types: ['SCREENSHOT'], icon: <Camera size={12} />, color: '#f97316' },
  { label: 'API', types: ['API_REQUEST'], icon: <Zap size={12} />, color: '#38bdf8' },
  { label: 'Custom', types: ['EXECUTE_SCRIPT', 'CUSTOM'], icon: <Code2 size={12} />, color: '#fb7185' },
];

function stepColor(type: StepType): string {
  for (const cat of STEP_CATEGORIES) {
    if ((cat.types as string[]).includes(type)) return cat.color;
  }
  return '#94a3b8';
}

function defaultInput(type: StepType): StepInput {
  switch (type) {
    case 'NAVIGATE': return { url: '', waitUntil: 'load' };
    case 'WAIT_FOR_NAVIGATION': return { waitUntil: 'load' };
    case 'CLICK': return { selector: '', button: 'left', force: false };
    case 'DBLCLICK': return { selector: '', button: 'left', force: false };
    case 'HOVER': return { selector: '' };
    case 'FILL': return { selector: '', value: '' };
    case 'TYPE': return { selector: '', text: '', delay: 25 };
    case 'CLEAR': return { selector: '' };
    case 'SELECT': return { selector: '', value: '' };
    case 'CHECK': return { selector: '', force: false };
    case 'UNCHECK': return { selector: '', force: false };
    case 'KEYBOARD': return { key: 'Enter' };
    case 'PRESS_KEY': return { selector: '', key: 'Enter' };
    case 'SCROLL': return { x: 0, y: 300 };
    case 'WAIT': return { ms: 1000 };
    case 'WAIT_MS': return { ms: 1000 };
    case 'WAIT_FOR_SELECTOR': return { selector: '', state: 'visible' };
    case 'ASSERT_TEXT': return { selector: '', text: '', matchMode: 'contains', caseSensitive: true };
    case 'ASSERT_VISIBLE': return { selector: '', shouldBeVisible: true };
    case 'ASSERT_VALUE': return { selector: '', value: '', matchMode: 'exact', caseSensitive: true };
    case 'ASSERT_URL': return { url: '', matchMode: 'contains' };
    case 'ASSERT_ELEMENT': return { selector: '' };
    case 'SCREENSHOT': return { name: '', fullPage: false };
    case 'API_REQUEST': return { url: '', method: 'GET' };
    case 'EXECUTE_SCRIPT': return { script: 'return document.title;' };
    case 'CUSTOM': return { handler: '' };
    default: return {};
  }
}

function defaultName(type: StepType): string {
  const names: Record<string, string> = {
    NAVIGATE: 'Navigate to page', WAIT_FOR_NAVIGATION: 'Wait for navigation',
    CLICK: 'Click element', DBLCLICK: 'Double-click element', HOVER: 'Hover over element',
    FILL: 'Fill input field', TYPE: 'Type text', CLEAR: 'Clear input',
    SELECT: 'Select option', CHECK: 'Check checkbox', UNCHECK: 'Uncheck checkbox',
    KEYBOARD: 'Press key', PRESS_KEY: 'Focus and press key',
    SCROLL: 'Scroll page', WAIT: 'Wait', WAIT_MS: 'Wait milliseconds', WAIT_FOR_SELECTOR: 'Wait for selector',
    ASSERT_TEXT: 'Assert text content', ASSERT_VISIBLE: 'Assert element visible',
    ASSERT_VALUE: 'Assert input value', ASSERT_URL: 'Assert URL', ASSERT_ELEMENT: 'Assert element exists',
    SCREENSHOT: 'Take screenshot', API_REQUEST: 'API request',
    EXECUTE_SCRIPT: 'Execute browser script', CUSTOM: 'Custom handler',
  };
  return names[type] ?? type;
}

// ─── Selector Help Popover ────────────────────────────────────────────────────

function SelectorHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(p => !p)}
        className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
        style={{ color: 'rgba(238,238,248,0.4)', background: 'rgba(255,255,255,0.04)' }}
      >
        <HelpCircle size={11} /> Help
      </button>
      {open && (
        <div
          className="absolute right-0 top-7 z-50 rounded-xl p-4 w-72 text-xs space-y-2 shadow-2xl"
          style={{
            background: 'rgba(17,17,27,0.97)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(20px)',
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold" style={{ color: 'rgba(238,238,248,0.9)' }}>Selector Reference</span>
            <button onClick={() => setOpen(false)}><X size={12} style={{ color: 'rgba(238,238,248,0.4)' }} /></button>
          </div>
          <div>
            <p className="font-medium mb-1" style={{ color: '#34d399' }}>✓ Recommended (stable):</p>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>[data-testid="submit-btn"]</code>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>[role=button][name="Submit"]</code>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>[aria-label="Close dialog"]</code>
          </div>
          <div>
            <p className="font-medium mb-1" style={{ color: '#fbbf24' }}>⚠ Use carefully:</p>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>#login-form input[type="email"]</code>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>.card-body &gt; button:first-child</code>
          </div>
          <div>
            <p className="font-medium mb-1" style={{ color: '#f87171' }}>✕ Avoid (brittle):</p>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>:nth-child() positions</code>
            <code className="block" style={{ color: 'rgba(238,238,248,0.6)' }}>.css-auto-generated</code>
          </div>
          <p style={{ color: 'rgba(238,238,248,0.4)' }}>Tip: Add an AI Description to help self-healing if selectors break.</p>
        </div>
      )}
    </div>
  );
}

// ─── Field components ─────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
      {children}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${className ?? ''}`}
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(238,238,248,0.85)',
      }}
    />
  );
}

function SelectInput({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
      style={{
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(238,238,248,0.85)',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value} style={{ background: '#1a1a2e' }}>{o.label}</option>
      ))}
    </select>
  );
}

function SelectorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <FieldLabel>Selector *</FieldLabel>
        <SelectorHelp />
      </div>
      <TextInput value={value} onChange={onChange} placeholder="#element, [data-testid='btn']" />
    </div>
  );
}

function PlaywrightOptionsField({ input, onChange }: { input: StepInput | undefined; onChange: (patch: Partial<StepInput>) => void }) {
  const [value, setValue] = useState(() => input?.options ? JSON.stringify(input.options, null, 2) : '');
  const [error, setError] = useState('');

  return (
    <div>
      <FieldLabel>Playwright Options JSON <span style={{ color: 'rgba(238,238,248,0.28)', fontWeight: 400 }}>(optional pass-through)</span></FieldLabel>
      <textarea
        value={value}
        onChange={e => {
          const next = e.target.value;
          setValue(next);
          if (!next.trim()) {
            setError('');
            onChange({ options: undefined });
            return;
          }
          try {
            onChange({ options: JSON.parse(next) as Record<string, unknown> });
            setError('');
          } catch {
            setError('Invalid JSON; options will not be saved until fixed.');
          }
        }}
        rows={3}
        placeholder='{"timeout": 10000, "trial": false}'
        className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-none focus:outline-none"
        style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${error ? 'rgba(248,113,113,0.45)' : 'rgba(255,255,255,0.1)'}`, color: 'rgba(238,238,248,0.85)' }}
      />
      {error && <p className="text-[10px] mt-1" style={{ color: '#f87171' }}>{error}</p>}
    </div>
  );
}

// ─── Type-specific field panels ───────────────────────────────────────────────

function StepFields({ step, onChange }: { step: Step; onChange: (input: StepInput) => void }) {
  // Default `input` to `{}` — older / partially-seeded steps store just
  // `{type, name}` with no input object. Without this guard every
  // type-specific field below errors with "Cannot read properties of
  // undefined (reading 'url' / 'selector' / 'options' / …)" on edit.
  const { type } = step;
  const input: StepInput = step.input ?? {};
  const set = (patch: Partial<StepInput>) => onChange({ ...input, ...patch });

  switch (type) {
    case 'NAVIGATE':
    case 'WAIT_FOR_NAVIGATION':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>{type === 'NAVIGATE' ? 'URL *' : 'URL pattern (optional)'}</FieldLabel>
            <TextInput value={input.url ?? ''} onChange={v => set({ url: v })} placeholder={type === 'NAVIGATE' ? 'https://example.com/login or /relative-path' : '**/dashboard or /checkout'} />
          </div>
          <div>
            <FieldLabel>Wait Until</FieldLabel>
            <SelectInput value={input.waitUntil ?? 'load'} onChange={v => set({ waitUntil: v })}
              options={[{ value: 'load', label: 'load' }, { value: 'domcontentloaded', label: 'domcontentloaded' }, { value: 'networkidle', label: 'networkidle' }, { value: 'commit', label: 'commit' }]} />
          </div>
        </div>
      );

    case 'CLICK':
    case 'DBLCLICK':
    case 'HOVER':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          {type !== 'HOVER' && (
            <div>
              <FieldLabel>Button</FieldLabel>
              <SelectInput value={input.button ?? 'left'} onChange={v => set({ button: v })}
                options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'middle', label: 'Middle' }]} />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <input type="checkbox" checked={!!input.force} onChange={e => set({ force: e.target.checked })}
              className="rounded" />
            Force click (bypass actionability checks)
          </label>
        </div>
      );

    case 'FILL':
    case 'TYPE':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>{type === 'TYPE' ? 'Text *' : 'Value *'}</FieldLabel>
            <TextInput
              value={(type === 'TYPE' ? input.text : input.value) ?? ''}
              onChange={v => set(type === 'TYPE' ? { text: v } : { value: v })}
              placeholder="Text value (supports {{ENV.VAR}} tokens)"
            />
          </div>
          {type === 'TYPE' && (
            <div>
              <FieldLabel>Delay Between Keystrokes (ms)</FieldLabel>
              <input type="number" min={0} value={input.delay ?? 25} onChange={e => set({ delay: Number(e.target.value) })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }} />
            </div>
          )}
        </div>
      );

    case 'CLEAR':
      return <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />;

    case 'SELECT':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>Option Value / Label *</FieldLabel>
            <TextInput value={input.value ?? ''} onChange={v => set({ value: v })} placeholder="Option value to select" />
          </div>
        </div>
      );

    case 'CHECK':
    case 'UNCHECK':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <input type="checkbox" checked={!!input.force} onChange={e => set({ force: e.target.checked })} />
            Force action
          </label>
        </div>
      );

    case 'KEYBOARD':
    case 'PRESS_KEY':
      return (
        <div className="space-y-3">
          {type === 'PRESS_KEY' && (
            <div>
              <FieldLabel>Selector to focus (optional)</FieldLabel>
              <TextInput value={input.selector ?? ''} onChange={v => set({ selector: v })} placeholder="#input" />
            </div>
          )}
          <div>
            <FieldLabel>Key *</FieldLabel>
            <TextInput value={input.key ?? ''} onChange={v => set({ key: v })} placeholder="Enter, Tab, Escape, ArrowUp, F5, …" />
          </div>
        </div>
      );

    case 'SCROLL':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>Selector (optional — blank = window scroll)</FieldLabel>
            <TextInput value={input.selector ?? ''} onChange={v => set({ selector: v })} placeholder="Optional scroll container" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>X offset (px)</FieldLabel>
              <input type="number" value={input.x ?? 0} onChange={e => set({ x: Number(e.target.value) })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }} />
            </div>
            <div>
              <FieldLabel>Y offset (px)</FieldLabel>
              <input type="number" value={input.y ?? 300} onChange={e => set({ y: Number(e.target.value) })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }} />
            </div>
          </div>
        </div>
      );

    case 'WAIT':
    case 'WAIT_MS':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>Duration (ms)</FieldLabel>
            <input type="number" min={100} max={30000}
              value={input.ms ?? 1000} onChange={e => set({ ms: Number(e.target.value), selector: undefined })}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }} />
          </div>
          {type === 'WAIT' && (
            <div>
              <FieldLabel>Or wait for selector</FieldLabel>
              <TextInput value={input.selector ?? ''} onChange={v => set({ selector: v || undefined, ms: v ? undefined : input.ms })} placeholder="#ready-state" />
            </div>
          )}
        </div>
      );

    case 'WAIT_FOR_SELECTOR':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>State</FieldLabel>
            <SelectInput value={input.state ?? 'visible'} onChange={v => set({ state: v })}
              options={[{ value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }, { value: 'attached', label: 'Attached' }, { value: 'detached', label: 'Detached' }]} />
          </div>
        </div>
      );

    case 'ASSERT_TEXT':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>Expected Text *</FieldLabel>
            <TextInput value={input.text ?? ''} onChange={v => set({ text: v })} placeholder="Text to verify" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Match Mode</FieldLabel>
              <SelectInput value={input.matchMode ?? 'contains'} onChange={v => set({ matchMode: v })}
                options={[{ value: 'contains', label: 'contains' }, { value: 'exact', label: 'exact' }, { value: 'regex', label: 'regex' }]} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
                <input type="checkbox" checked={input.caseSensitive !== false} onChange={e => set({ caseSensitive: e.target.checked })} />
                Case sensitive
              </label>
            </div>
          </div>
        </div>
      );

    case 'ASSERT_VALUE':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>Expected Value *</FieldLabel>
            <TextInput value={input.value ?? ''} onChange={v => set({ value: v })} placeholder="Input value to verify" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Match Mode</FieldLabel>
              <SelectInput value={input.matchMode ?? 'exact'} onChange={v => set({ matchMode: v })}
                options={[{ value: 'exact', label: 'exact' }, { value: 'contains', label: 'contains' }, { value: 'regex', label: 'regex' }]} />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
                <input type="checkbox" checked={input.caseSensitive !== false} onChange={e => set({ caseSensitive: e.target.checked })} />
                Case sensitive
              </label>
            </div>
          </div>
        </div>
      );

    case 'ASSERT_VISIBLE':
      return (
        <div className="space-y-3">
          <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />
          <div>
            <FieldLabel>Expect Element To Be</FieldLabel>
            <SelectInput value={input.shouldBeVisible !== false ? 'visible' : 'hidden'} onChange={v => set({ shouldBeVisible: v === 'visible' })}
              options={[{ value: 'visible', label: 'Visible' }, { value: 'hidden', label: 'Hidden' }]} />
          </div>
        </div>
      );

    case 'ASSERT_URL':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>Expected URL *</FieldLabel>
            <TextInput value={input.url ?? ''} onChange={v => set({ url: v })} placeholder="/dashboard or https://example.com/..." />
          </div>
          <div>
            <FieldLabel>Match Mode</FieldLabel>
            <SelectInput value={input.matchMode ?? 'contains'} onChange={v => set({ matchMode: v })}
              options={[{ value: 'contains', label: 'contains' }, { value: 'exact', label: 'exact' }, { value: 'regex', label: 'regex' }]} />
          </div>
        </div>
      );

    case 'ASSERT_ELEMENT':
      return <SelectorField value={input.selector ?? ''} onChange={v => set({ selector: v })} />;

    case 'SCREENSHOT':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>Label (optional)</FieldLabel>
            <TextInput value={input.name ?? ''} onChange={v => set({ name: v })} placeholder="e.g. after-login-success" />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <input type="checkbox" checked={!!input.fullPage} onChange={e => set({ fullPage: e.target.checked })} />
            Full page screenshot
          </label>
        </div>
      );

    case 'API_REQUEST':
      return (
        <div className="space-y-3">
          <div>
            <FieldLabel>URL *</FieldLabel>
            <TextInput value={input.url ?? ''} onChange={v => set({ url: v })} placeholder="https://api.example.com/endpoint" />
          </div>
          <div>
            <FieldLabel>Method</FieldLabel>
            <SelectInput value={input.method ?? 'GET'} onChange={v => set({ method: v })}
              options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }, { value: 'PATCH', label: 'PATCH' }, { value: 'DELETE', label: 'DELETE' }]} />
          </div>
          {!['GET', 'DELETE'].includes(input.method ?? 'GET') && (
            <div>
              <FieldLabel>Request Body (JSON)</FieldLabel>
              <textarea
                value={input.body ?? ''}
                onChange={e => set({ body: e.target.value })}
                rows={4}
                placeholder='{"key": "value"}'
                className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-none focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
              />
            </div>
          )}
        </div>
      );

    case 'EXECUTE_SCRIPT':
      return (
        <div className="space-y-3">
          <div
            className="rounded-lg px-3 py-2 text-xs flex items-start gap-2"
            style={{ background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)', color: '#fda4af' }}
          >
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            Runs inside the browser page context. Return a value if you want it captured in step output.
          </div>
          <div>
            <FieldLabel>Script *</FieldLabel>
            <textarea
              value={input.script ?? ''}
              onChange={e => set({ script: e.target.value })}
              rows={5}
              placeholder="return document.title;"
              className="w-full rounded-lg px-3 py-2 text-xs font-mono resize-none focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
            />
          </div>
        </div>
      );

    case 'CUSTOM':
      return (
        <div className="space-y-3">
          <div
            className="rounded-lg px-3 py-2 text-xs flex items-start gap-2"
            style={{ background: 'rgba(251,113,133,0.08)', border: '1px solid rgba(251,113,133,0.2)', color: '#fda4af' }}
          >
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            Custom steps require a registered worker-side handler.
          </div>
          <div>
            <FieldLabel>Handler *</FieldLabel>
            <TextInput value={input.handler ?? ''} onChange={v => set({ handler: v })} placeholder="registeredHandlerName" />
          </div>
        </div>
      );

    default:
      return (
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.4)' }}>
          No configuration fields for step type: {type}
        </p>
      );
  }
}

// ─── Step Row ─────────────────────────────────────────────────────────────────

function StepRow({
  step,
  index,
  isOpen,
  onToggle,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  onChange,
  canMoveUp,
  canMoveDown,
}: {
  step: Step;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onChange: (s: Step) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const color = stepColor(step.type);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: isOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isOpen ? `${color}44` : 'rgba(255,255,255,0.07)'}`,
      }}
    >
      {/* Row header */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer select-none"
        onClick={onToggle}
      >
        <GripVertical size={14} style={{ color: 'rgba(238,238,248,0.2)' }} className="flex-shrink-0" />
        <span
          className="text-xs font-mono w-5 text-right flex-shrink-0"
          style={{ color: 'rgba(238,238,248,0.3)' }}
        >
          {index + 1}
        </span>
        <span
          className="text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: `${color}22`, color, border: `1px solid ${color}44` }}
        >
          {step.type}
        </span>
        <span className="flex-1 text-sm truncate" style={{ color: 'rgba(238,238,248,0.8)' }}>
          {step.name}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <div className="relative">
            <button
              className="p-1 rounded hover:bg-white/5 text-xs"
              style={{ color: 'rgba(238,238,248,0.35)' }}
              onClick={() => setMenuOpen(p => !p)}
            >
              ⋯
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-50 rounded-xl overflow-hidden shadow-2xl"
                style={{ background: 'rgba(17,17,27,0.97)', border: '1px solid rgba(255,255,255,0.12)', minWidth: 140 }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                {[
                  { label: 'Duplicate', action: () => { onDuplicate(); setMenuOpen(false); } },
                  { label: 'Move Up', action: () => { onMoveUp(); setMenuOpen(false); }, disabled: !canMoveUp },
                  { label: 'Move Down', action: () => { onMoveDown(); setMenuOpen(false); }, disabled: !canMoveDown },
                  { label: 'Delete', action: () => { onDelete(); setMenuOpen(false); }, danger: true },
                ].map(item => (
                  <button
                    key={item.label}
                    onClick={item.disabled ? undefined : item.action}
                    className="w-full text-left px-3 py-2 text-xs transition-colors"
                    style={{
                      color: item.danger ? '#f87171' : item.disabled ? 'rgba(238,238,248,0.2)' : 'rgba(238,238,248,0.7)',
                      cursor: item.disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isOpen ? (
            <ChevronUp size={13} style={{ color: 'rgba(238,238,248,0.3)' }} />
          ) : (
            <ChevronDown size={13} style={{ color: 'rgba(238,238,248,0.3)' }} />
          )}
        </div>
      </div>

      {/* Expanded panel */}
      {isOpen && (
        <div className="px-4 pb-4 pt-1 space-y-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          {/* Name + Type row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Step Name *</FieldLabel>
              <TextInput
                value={step.name}
                onChange={v => onChange({ ...step, name: v })}
                placeholder="Human-readable name"
              />
            </div>
            <div>
              <FieldLabel>Step Type</FieldLabel>
              <select
                value={step.type}
                onChange={e => {
                  const newType = e.target.value as StepType;
                  onChange({ ...step, type: newType, name: defaultName(newType), input: defaultInput(newType) });
                }}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
              >
                {STEP_CATEGORIES.map(cat => (
                  <optgroup key={cat.label} label={cat.label} style={{ background: '#1a1a2e' }}>
                    {cat.types.map(t => (
                      <option key={t} value={t} style={{ background: '#1a1a2e' }}>{t}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* Manual instruction — shown to QA in manual mode */}
          <div>
            <FieldLabel>Manual Instruction <span style={{ color: 'rgba(238,238,248,0.28)', fontWeight: 400 }}>(what QA sees in manual mode)</span></FieldLabel>
            <textarea
              value={step.input?.description ?? ''}
              onChange={e => onChange({ ...step, input: { ...(step.input ?? {}), description: e.target.value || undefined } })}
              placeholder="e.g. Log in with the test account credentials and verify the dashboard loads…"
              rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
              style={{
                background: 'rgba(96,165,250,0.06)',
                border: '1px solid rgba(96,165,250,0.2)',
                color: 'rgba(238,238,248,0.8)',
              }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'rgba(238,238,248,0.3)' }}>
              In automated mode the Playwright command runs instead. Leave blank to auto-generate from step type.
            </p>
          </div>

          {/* Type-specific fields */}
          <StepFields step={step} onChange={input => onChange({ ...step, input })} />

          {step.type !== 'CUSTOM' && step.type !== 'EXECUTE_SCRIPT' && (
            <PlaywrightOptionsField
              key={`${step.type}-${step.index}`}
              input={step.input}
              onChange={patch => onChange({ ...step, input: { ...step.input, ...patch } })}
            />
          )}

          {/* Common fields */}
          <div className="grid grid-cols-2 gap-3 pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div>
              <FieldLabel>Timeout (ms)</FieldLabel>
              <input
                type="number"
                min={100} max={120000}
                value={step.timeoutMs ?? ''}
                onChange={e => onChange({ ...step, timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="Default (30000)"
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
                <input
                  type="checkbox"
                  checked={!!step.continueOnFail}
                  onChange={e => onChange({ ...step, continueOnFail: e.target.checked })}
                />
                Continue on fail
              </label>
            </div>
          </div>
          <div>
            <FieldLabel>AI Description (helps self-healing)</FieldLabel>
            <TextInput
              value={step.aiDescription ?? ''}
              onChange={v => onChange({ ...step, aiDescription: v })}
              placeholder="e.g. The blue Submit button in the login form"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add Step Picker ──────────────────────────────────────────────────────────

function AddStepPicker({ onAdd }: { onAdd: (type: StepType) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = STEP_CATEGORIES.map(cat => ({
    ...cat,
    types: cat.types.filter(t => t.toLowerCase().includes(search.toLowerCase())),
  })).filter(cat => cat.types.length > 0);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(p => !p)}
      >
        <Plus size={13} /> Add Step
      </Button>
      {open && (
        <div
          className="absolute left-0 top-9 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(17,17,27,0.97)', border: '1px solid rgba(255,255,255,0.12)', width: 280 }}
        >
          <div className="p-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search step types…"
              className="w-full rounded-lg px-3 py-1.5 text-sm focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map(cat => (
              <div key={cat.label}>
                <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  {cat.label}
                </div>
                {cat.types.map(t => (
                  <button
                    key={t}
                    onClick={() => { onAdd(t); setOpen(false); setSearch(''); }}
                    className="w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-white/5"
                    style={{ color: 'rgba(238,238,248,0.75)' }}
                  >
                    <span className="font-mono" style={{ color: stepColor(t) }}>{t}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main StepEditor ──────────────────────────────────────────────────────────

interface StepEditorProps {
  testName: string;
  initialSteps: Step[];
  onSave: (steps: Step[]) => Promise<void>;
  onCancel: () => void;
  isSaving?: boolean;
}

export function StepEditor({ testName, initialSteps, onSave, onCancel, isSaving }: StepEditorProps) {
  const [steps, setSteps] = useState<Step[]>(initialSteps.length > 0 ? initialSteps : []);
  const [openIndex, setOpenIndex] = useState<number | null>(steps.length === 1 ? 0 : null);
  const [hasChanges, setHasChanges] = useState(false);

  function updateStep(idx: number, updated: Step) {
    setSteps(prev => prev.map((s, i) => i === idx ? updated : s));
    setHasChanges(true);
  }

  function addStep(type: StepType) {
    const newStep: Step = {
      index: steps.length,
      name: defaultName(type),
      type,
      input: defaultInput(type),
      continueOnFail: false,
    };
    setSteps(prev => [...prev, newStep]);
    setOpenIndex(steps.length);
    setHasChanges(true);
  }

  function deleteStep(idx: number) {
    setSteps(prev => {
      const next = prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, index: i }));
      return next;
    });
    if (openIndex === idx) setOpenIndex(null);
    setHasChanges(true);
  }

  function duplicateStep(idx: number) {
    setSteps(prev => {
      const clone = { ...prev[idx], index: prev.length };
      return [...prev, clone];
    });
    setHasChanges(true);
  }

  function moveStep(idx: number, dir: -1 | 1) {
    setSteps(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next.map((s, i) => ({ ...s, index: i }));
    });
    setOpenIndex(idx + dir);
    setHasChanges(true);
  }

  async function handleSave() {
    await onSave(steps.map((s, i) => ({ ...s, index: i })));
    setHasChanges(false);
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.09)',
        backdropFilter: 'blur(20px)',
      }}
    >
      {/* Header */}
      <div
        className="px-5 py-3 border-b flex items-center justify-between"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3">
          <Type size={14} style={{ color: '#a78bfa' }} />
          <span className="font-semibold text-sm" style={{ color: 'rgba(238,238,248,0.85)' }}>
            {testName}
          </span>
          {hasChanges && (
            <Badge variant="warning">
              <AlertTriangle size={10} /> Unsaved
            </Badge>
          )}
          <span className="text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
            {steps.length} step{steps.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <AddStepPicker onAdd={addStep} />
          <Button variant="secondary" size="sm" onClick={onCancel}>
            <X size={13} /> Close
          </Button>
          <Button
            size="sm"
            loading={isSaving}
            disabled={!hasChanges}
            onClick={handleSave}
          >
            <Save size={13} /> Save
          </Button>
        </div>
      </div>

      {/* Step list */}
      <div className="p-4 space-y-2" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {steps.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="text-sm text-center" style={{ color: 'rgba(238,238,248,0.4)' }}>
              No steps yet. Add your first step.
            </div>
            <AddStepPicker onAdd={addStep} />
          </div>
        ) : (
          steps.map((step, idx) => (
            <StepRow
              key={idx}
              step={step}
              index={idx}
              isOpen={openIndex === idx}
              onToggle={() => setOpenIndex(openIndex === idx ? null : idx)}
              onDelete={() => deleteStep(idx)}
              onDuplicate={() => duplicateStep(idx)}
              onMoveUp={() => moveStep(idx, -1)}
              onMoveDown={() => moveStep(idx, 1)}
              onChange={updated => updateStep(idx, updated)}
              canMoveUp={idx > 0}
              canMoveDown={idx < steps.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
