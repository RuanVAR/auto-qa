import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Lock body scroll while open. Two reasons:
  //   1. Stops the page behind from scrolling when the user wheels inside
  //      the modal — they expect the modal to scroll, not the page.
  //   2. Prevents a layout shift when the scrollbar disappears.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Close on Escape — standard accessibility expectation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const w = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  // Portal to document.body. Ancestors with `transform`, `filter`, or
  // `will-change` set establish a new containing block that breaks
  // `position: fixed` — the modal would anchor to the ancestor instead
  // of the viewport (which is exactly the bug we hit on FeaturesPage).
  // Portaling sidesteps every parent's CSS context. z-[10050] still beats
  // ManualPlayer's z-[10002] portals.
  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className={cn('relative w-full max-h-[90vh] overflow-y-auto', w[size])}
        style={{
          background: 'rgba(18,18,32,0.95)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: '20px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.60), inset 0 1px 0 rgba(255,255,255,0.07)',
        }}
      >
        {/* Header */}
        <div
          className="sticky top-0 flex items-center justify-between px-5 py-4 z-10"
          style={{
            borderBottom: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(18,18,32,0.95)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderTopLeftRadius: '20px',
            borderTopRightRadius: '20px',
          }}
        >
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
            style={{ color: 'rgba(238,238,248,0.40)', background: 'rgba(255,255,255,0.05)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.10)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
