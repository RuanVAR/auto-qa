import { cn } from '@/lib/utils';

export type WorkbenchTabDef = {
  id: string;
  label: string;
  /** Shown below the tabs on lg+ layouts */
  description?: string;
};

type WorkbenchTabsProps = {
  tabs: readonly WorkbenchTabDef[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
};

/**
 * Two-step workbench chrome: tab A = primary execution surface (modules / features /
 * tests), tab B = quality & reporting (stats, reports, issue explorer).
 */
export function WorkbenchTabs({ tabs, value, onValueChange, className }: WorkbenchTabsProps) {
  const active = tabs.find((t) => t.id === value);
  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="tablist"
        aria-label="Workbench"
        className="inline-flex flex-wrap gap-1 p-1 rounded-xl"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {tabs.map((tab) => {
          const sel = tab.id === value;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => onValueChange(tab.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              )}
              style={
                sel
                  ? {
                      background: 'rgba(139,92,246,0.22)',
                      color: '#e9d5ff',
                      border: '1px solid rgba(167,139,250,0.45)',
                      boxShadow: '0 0 0 1px rgba(167,139,250,0.12)',
                    }
                  : {
                      color: 'rgba(238,238,248,0.55)',
                      border: '1px solid transparent',
                    }
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {active?.description ? (
        <p className="text-[11px] leading-snug max-w-2xl" style={{ color: 'rgba(238,238,248,0.42)' }}>
          {active.description}
        </p>
      ) : null}
    </div>
  );
}
