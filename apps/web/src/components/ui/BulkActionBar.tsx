import { ReactNode } from 'react';
import { X } from 'lucide-react';

interface BulkActionBarProps {
  count: number;
  itemLabel: string;
  onClear: () => void;
  children: ReactNode;
}

/**
 * Sticky bottom bar that appears when one or more rows are selected for a
 * bulk operation. Used by Modules/Features/Tests tables. Actions are passed
 * in as children so each caller wires its own Move/Archive buttons.
 */
export function BulkActionBar({ count, itemLabel, onClear, children }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl"
      style={{
        background: 'rgba(20,22,30,0.96)',
        border: '1px solid rgba(139,92,246,0.45)',
        backdropFilter: 'blur(10px)',
      }}
      role="region"
      aria-label={`${count} ${itemLabel} selected`}
    >
      <span className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.92)' }}>
        {count} {count === 1 ? itemLabel : `${itemLabel}s`} selected
      </span>
      <div className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <div className="flex items-center gap-2">{children}</div>
      <div className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.12)' }} />
      <button
        onClick={onClear}
        className="p-1 rounded transition-colors"
        style={{ color: 'rgba(238,238,248,0.55)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(238,238,248,0.95)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(238,238,248,0.55)')}
        title="Clear selection"
        aria-label="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}
