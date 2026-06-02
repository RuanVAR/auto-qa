import { useState } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

/**
 * Shared list-controls row used at the top of module/feature/test list views.
 *
 * Just the chrome — each page owns its own sort options (different axes per
 * entity type) and applies them to the list itself. This component handles:
 *
 *   - Search input with clear-button
 *   - Sort dropdown with a configurable options map
 *   - Optional right-aligned action slot (e.g. filter button)
 *
 * Mirrors the look used on ProjectDetailPage so all four list pages share
 * the same visual language.
 */
export function ListSearchSort<SortKey extends string>({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  sort,
  onSortChange,
  sortOptions,
  rightSlot,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  sort: SortKey;
  onSortChange: (value: SortKey) => void;
  sortOptions: Record<SortKey, string>;
  rightSlot?: React.ReactNode;
}) {
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2"
          style={{ color: 'rgba(238,238,248,0.40)' }}
        />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full pl-8 pr-8 py-1.5 rounded-lg text-sm outline-none transition-colors"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: 'rgba(238,238,248,0.92)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(139,92,246,0.40)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded transition-colors"
            style={{ color: 'rgba(238,238,248,0.50)' }}
            title="Clear search"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Sort */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setSortOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
          style={{
            background: sortOpen ? 'rgba(139,92,246,0.16)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${sortOpen ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.08)'}`,
            color: sortOpen ? '#c4b5fd' : 'rgba(238,238,248,0.85)',
          }}
        >
          Sort: <span className="font-medium">{sortOptions[sort]}</span>
          <ChevronDown size={11} />
        </button>
        {sortOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
            <div
              className="absolute right-0 top-full mt-1 z-20 rounded-lg overflow-hidden shadow-xl min-w-[200px] max-w-[calc(100vw-1.5rem)]"
              style={{
                background: 'rgba(14,14,22,0.97)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(139,92,246,0.30)',
              }}
            >
              {(Object.entries(sortOptions) as [SortKey, string][]).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    onSortChange(key);
                    setSortOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                  style={{
                    color: key === sort ? '#c4b5fd' : 'rgba(238,238,248,0.85)',
                    background: key === sort ? 'rgba(139,92,246,0.12)' : undefined,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {rightSlot}
    </div>
  );
}
