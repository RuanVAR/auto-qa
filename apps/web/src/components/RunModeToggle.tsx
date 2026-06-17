import { Zap, User, Layers } from 'lucide-react';

/**
 * Stats run-mode filter. `null` = combined (both modes). Used to track
 * automated vs manual progress separately (Phase 2). Pass the value to the
 * `mode` arg of statsApi.* / featureRunsApi.list.
 */
export type RunModeFilter = 'AUTOMATED' | 'MANUAL' | null;

const OPTIONS: { value: RunModeFilter; label: string; icon: typeof Zap }[] = [
  { value: null, label: 'All', icon: Layers },
  { value: 'AUTOMATED', label: 'Automated', icon: Zap },
  { value: 'MANUAL', label: 'Manual', icon: User },
];

/**
 * Compact segmented control for choosing which run mode the surrounding
 * stats/run lists reflect. Theme-agnostic (uses CSS accent vars), so it sits
 * fine on both light and dark surfaces.
 */
export function RunModeToggle({
  value,
  onChange,
  size = 'md',
}: {
  value: RunModeFilter;
  onChange: (v: RunModeFilter) => void;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs';
  const icon = size === 'sm' ? 11 : 13;
  return (
    <div
      role="tablist"
      aria-label="Run mode filter"
      className="inline-flex items-center gap-0.5 rounded-lg p-0.5"
      style={{ background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.20)' }}
    >
      {OPTIONS.map(opt => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.label}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 rounded-md font-medium transition-all ${pad}`}
            style={
              active
                ? { background: 'var(--accent-500, #6366f1)', color: '#fff' }
                : { background: 'transparent', color: 'rgba(148,163,184,0.85)' }
            }
          >
            <Icon size={icon} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
