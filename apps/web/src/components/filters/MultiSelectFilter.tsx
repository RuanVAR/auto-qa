import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Optional dot colour (used by the epic facet). */
  color?: string | null;
}

/**
 * Compact dropdown multi-select used for the tag / epic filter facets on the
 * module / feature / test browse lists. Closes on outside-click; shows a count
 * badge when ≥1 selected. Selection is an array of `value`s; parent owns state.
 */
export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  const count = selected.length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{
          background: count > 0 ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${count > 0 ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.12)'}`,
          color: count > 0 ? 'var(--accent-300)' : 'rgba(238,238,248,0.70)',
        }}
      >
        {label}
        {count > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[10px] font-semibold"
            style={{ background: 'rgba(var(--accent-rgb),0.35)', color: '#ede9fe' }}
          >
            {count}
          </span>
        )}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 left-0 min-w-[200px] max-w-[calc(100vw-1.5rem)] max-h-72 overflow-y-auto rounded-xl shadow-2xl py-1"
          style={{ background: 'rgba(14,14,22,0.98)', border: '1px solid rgba(var(--accent-rgb),0.30)', backdropFilter: 'blur(20px)' }}
        >
          {count > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] transition-colors"
              style={{ color: 'rgba(238,238,248,0.55)' }}
            >
              <X size={11} /> Clear selection
            </button>
          )}
          {options.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'rgba(238,238,248,0.40)' }}>
              No {label.toLowerCase()} yet
            </div>
          )}
          {options.map((opt) => {
            const on = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggle(opt.value)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left transition-colors hover:bg-white/5"
                style={{ color: on ? 'var(--accent-300)' : 'rgba(238,238,248,0.82)' }}
              >
                <span
                  className="flex items-center justify-center w-3.5 h-3.5 rounded shrink-0"
                  style={{
                    background: on ? 'rgba(var(--accent-rgb),0.30)' : 'transparent',
                    border: `1px solid ${on ? 'rgba(var(--accent-rgb),0.55)' : 'rgba(255,255,255,0.20)'}`,
                  }}
                >
                  {on && <Check size={10} />}
                </span>
                {opt.color && (
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: opt.color }} />
                )}
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
