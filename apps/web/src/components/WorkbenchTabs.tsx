import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
 * Two-step workbench chrome: tab A = primary execution surface (modules /
 * features / tests), tab B = quality & reporting (stats, reports, issue
 * explorer).
 *
 * The tab row never wraps — it stays a single horizontal strip and scrolls
 * when it can't fit (e.g. on a phone). Left/right chevron affordances appear
 * only when there's more to scroll in that direction, and selecting a tab
 * scrolls it to the centre so its neighbours stay reachable on both sides.
 * On a wide screen everything fits, so no scrolling/arrows appear and it
 * looks like a plain pill group.
 */
export function WorkbenchTabs({ tabs, value, onValueChange, className }: WorkbenchTabsProps) {
  const active = tabs.find((t) => t.id === value);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanLeft(scrollLeft > 1);
    setCanRight(scrollLeft + clientWidth < scrollWidth - 1);
  }, []);

  // Centre a tab button within the scroll container (without scrolling the page).
  const centerEl = useCallback((el: HTMLElement | null, behavior: ScrollBehavior = 'smooth') => {
    const c = scrollRef.current;
    if (!c || !el) return;
    const target = el.offsetLeft - (c.clientWidth - el.clientWidth) / 2;
    c.scrollTo({ left: Math.max(0, target), behavior });
  }, []);

  // Recompute arrow visibility on mount, when the tab set changes, and on resize.
  useEffect(() => {
    updateArrows();
    const onResize = () => updateArrows();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [updateArrows, tabs.length]);

  // Keep the active tab centred when it changes (instant — no animation on load).
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-tab-active="true"]');
    centerEl(el ?? null, 'auto');
    updateArrows();
  }, [value, centerEl, updateArrows]);

  const nudge = (dir: -1 | 1) => {
    const c = scrollRef.current;
    if (!c) return;
    c.scrollBy({ left: dir * Math.max(120, c.clientWidth * 0.6), behavior: 'smooth' });
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="relative inline-block max-w-full align-top">
        {/* Left scroll affordance — only when there's content off the left edge. */}
        {canLeft && (
          <button
            type="button"
            aria-label="Scroll tabs left"
            onClick={() => nudge(-1)}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center pl-1.5 pr-5 rounded-l-xl"
            style={{ background: 'linear-gradient(to right, rgba(12,12,20,0.97) 45%, transparent)' }}
          >
            <ChevronLeft size={16} style={{ color: 'rgba(238,238,248,0.80)' }} />
          </button>
        )}

        <div
          ref={scrollRef}
          role="tablist"
          aria-label="Workbench"
          onScroll={updateArrows}
          className="no-scrollbar inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-xl"
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
                data-tab-active={sel}
                onClick={(e) => { onValueChange(tab.id); centerEl(e.currentTarget); }}
                className="shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={
                  sel
                    ? {
                        background: 'rgba(var(--accent-rgb),0.22)',
                        color: 'var(--accent-200)',
                        border: '1px solid rgba(var(--accent-rgb),0.45)',
                        boxShadow: '0 0 0 1px rgba(var(--accent-rgb),0.12)',
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

        {/* Right scroll affordance — only when there's content off the right edge. */}
        {canRight && (
          <button
            type="button"
            aria-label="Scroll tabs right"
            onClick={() => nudge(1)}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center pr-1.5 pl-5 rounded-r-xl"
            style={{ background: 'linear-gradient(to left, rgba(12,12,20,0.97) 45%, transparent)' }}
          >
            <ChevronRight size={16} style={{ color: 'rgba(238,238,248,0.80)' }} />
          </button>
        )}
      </div>
      {active?.description ? (
        <p className="text-[11px] leading-snug max-w-2xl" style={{ color: 'rgba(238,238,248,0.42)' }}>
          {active.description}
        </p>
      ) : null}
    </div>
  );
}
