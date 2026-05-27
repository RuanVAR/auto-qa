import { cloneElement, useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  label: string;
  /** Single focusable child — the trigger. We clone it to attach handlers. */
  children: ReactElement;
  /** Delay before showing, in ms. Defaults to 250. */
  delay?: number;
  side?: 'top' | 'bottom';
}

/**
 * Lightweight tooltip rendered through a portal so it escapes
 * `overflow-*` ancestors (the standard offender being Table.tsx wrapping
 * rows in overflow-x-auto, which would clip a positioned tooltip).
 */
export function Tooltip({ label, children, delay = 250, side = 'top' }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const place = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({
      x: r.left + r.width / 2,
      y: side === 'top' ? r.top - 6 : r.bottom + 6,
    });
  };

  const show = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      place();
      setOpen(true);
    }, delay);
  };
  const hide = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  };

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  // Clone to inject ref + handlers without an extra wrapper that would
  // break flex/grid layouts.
  const child = children as ReactElement<any>;
  const childProps = (child.props ?? {}) as Record<string, any>;
  const cloned = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const orig = (child as any).ref;
      if (typeof orig === 'function') orig(node);
      else if (orig && typeof orig === 'object') (orig as any).current = node;
    },
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      place();
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
  } as any);

  return (
    <>
      {cloned}
      {open && coords &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords.x,
              top: coords.y,
              transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
              background: 'rgba(18,18,28,0.98)',
              color: 'rgba(238,238,248,0.92)',
              border: '1px solid rgba(139,92,246,0.28)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 11,
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 9999,
              boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            }}
          >
            {label}
          </div>,
          document.body,
        )}
    </>
  );
}
