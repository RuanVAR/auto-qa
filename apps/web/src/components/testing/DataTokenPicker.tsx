import { useState } from 'react';
import { Braces, Copy, Check } from 'lucide-react';
import { toast } from '@/components/ui/Toast';

/**
 * Data-token reference + click-to-copy. Lists the worker's interpolation
 * generators ({{$id.sa}}, {{$email}}, …) so authors can drop dynamic test data
 * into any step field. Display-only mirror of GENERATOR_META in the worker's
 * interpolate.ts (the source of truth for the actual generation).
 */
const TOKENS: Array<{ token: string; label: string; arg?: string }> = [
  { token: '$id.sa', label: 'Valid SA ID number', arg: 'minAge-maxAge' },
  { token: '$dob', label: 'Date of birth', arg: 'minAge-maxAge' },
  { token: '$phone.sa', label: 'SA mobile number (+27)' },
  { token: '$passport.sa', label: 'SA passport number' },
  { token: '$email', label: 'Random email address' },
  { token: '$password', label: 'Strong password', arg: 'length' },
  { token: '$name.first', label: 'First name' },
  { token: '$name.last', label: 'Last name' },
  { token: '$name.full', label: 'Full name' },
  { token: '$uuid', label: 'UUID v4' },
  { token: '$randomString', label: 'Random hex string', arg: 'length' },
  { token: '$randomInt', label: 'Random integer', arg: 'max' },
  { token: '$timestamp', label: 'ISO timestamp' },
  { token: '$epoch', label: 'Unix epoch (ms)' },
  { token: '$date', label: "Today's date" },
  { token: '$phone', label: 'US phone number' },
];

export function DataTokenPicker() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (token: string, arg?: string) => {
    const text = `{{${token}${arg ? `(${arg})` : ''}}}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(token);
      toast.success(`Copied ${text}`);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      toast.error('Copy failed — clipboard unavailable');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.7)' }}
        title="Insert dynamic test data tokens — same value reused within a run"
      >
        <Braces size={13} /> Data tokens
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-1 z-50 w-72 max-h-80 overflow-auto rounded-xl p-1.5 shadow-xl"
            style={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <p className="px-2 py-1.5 text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Click to copy. Same token = same value within a run.
            </p>
            {TOKENS.map(({ token, label, arg }) => (
              <button
                key={token}
                type="button"
                onClick={() => copy(token, arg)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-white/5"
              >
                <span className="min-w-0">
                  <code className="font-mono" style={{ color: 'var(--accent-300)' }}>
                    {`{{${token}${arg ? `(${arg})` : ''}}}`}
                  </code>
                  <span className="block truncate" style={{ color: 'rgba(238,238,248,0.5)' }}>{label}</span>
                </span>
                {copied === token ? <Check size={13} style={{ color: '#34d399' }} /> : <Copy size={12} style={{ color: 'rgba(238,238,248,0.4)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
