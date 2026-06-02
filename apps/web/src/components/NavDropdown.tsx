import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronDown, Check } from 'lucide-react';

interface NavDropdownItem {
  id: string;
  name: string;
  href: string;
}

interface NavDropdownProps {
  /** The text label shown inline (current module/feature name) */
  label: string;
  /** Link for the plain back-chevron to the left of the dropdown */
  backTo: string;
  /** Back chevron label */
  backLabel: string;
  /** All items to show in the dropdown */
  items: NavDropdownItem[];
  /** Currently active item id */
  activeId: string;
  /** Loading state — shows a subtle pulse on the label */
  loading?: boolean;
}

/**
 * Inline nav label that doubles as a dropdown picker.
 * Used in the FeaturesPage and FeaturePage headers so the user can jump
 * between modules (or features) without navigating back.
 *
 * Layout: [← backLabel]  [label ▾]
 */
export function NavDropdown({
  label,
  backTo,
  backLabel,
  items,
  activeId,
  loading = false,
}: NavDropdownProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', handler);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
      {/* ← back chevron. On mobile the label text is hidden (the chevron stays
          a tap target) so two of these breadcrumb switchers fit a phone. */}
      <button
        onClick={() => navigate(backTo)}
        title={backLabel}
        aria-label={backLabel}
        className="flex items-center gap-1 text-sm transition-opacity hover:opacity-100 shrink-0"
        style={{ color: 'rgba(238,238,248,0.55)' }}
      >
        <ChevronLeft size={16} />
        <span className="hidden sm:inline">{backLabel}</span>
      </button>

      {/* Dropdown trigger */}
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={[
            'flex items-center gap-1.5 text-sm font-semibold rounded-lg px-2.5 py-1 transition-all select-none',
            open
              ? 'opacity-100'
              : 'hover:opacity-100',
            loading ? 'animate-pulse' : '',
          ].join(' ')}
          style={{
            color: open ? '#c4b5fd' : 'rgba(238,238,248,0.88)',
            background: open ? 'rgba(139,92,246,0.14)' : 'transparent',
            border: open
              ? '1px solid rgba(139,92,246,0.35)'
              : '1px solid transparent',
          }}
        >
          <span className="max-w-[120px] sm:max-w-[200px] truncate">{label}</span>
          <ChevronDown
            size={13}
            className="shrink-0 transition-transform"
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              color: open ? '#a78bfa' : 'rgba(238,238,248,0.45)',
            }}
          />
        </button>

        {/* Dropdown panel */}
        {open && (
          <div
            className="absolute left-0 top-full mt-1.5 z-50 min-w-[200px] max-w-[320px] rounded-xl overflow-hidden py-1"
            style={{
              background: 'rgba(18,18,28,0.98)',
              border: '1px solid rgba(139,92,246,0.25)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
              backdropFilter: 'blur(12px)',
            }}
          >
            {items.length === 0 && (
              <p
                className="px-3 py-2 text-xs"
                style={{ color: 'rgba(238,238,248,0.40)' }}
              >
                No items
              </p>
            )}
            {items.map(item => {
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setOpen(false);
                    navigate(item.href);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors"
                  style={{
                    background: isActive
                      ? 'rgba(139,92,246,0.18)'
                      : 'transparent',
                    color: isActive
                      ? '#c4b5fd'
                      : 'rgba(238,238,248,0.80)',
                  }}
                  onMouseEnter={e =>
                    !isActive &&
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      'rgba(255,255,255,0.05)')
                  }
                  onMouseLeave={e =>
                    !isActive &&
                    ((e.currentTarget as HTMLButtonElement).style.background =
                      'transparent')
                  }
                >
                  <Check
                    size={12}
                    className="shrink-0"
                    style={{ opacity: isActive ? 1 : 0, color: '#a78bfa' }}
                  />
                  <span className="truncate">{item.name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
