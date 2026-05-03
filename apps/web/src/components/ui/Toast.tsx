import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 4000; 0 = sticky
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ToastStore {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id'>) => string;
  remove: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    return id;
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

// ─── Convenience helpers ──────────────────────────────────────────────────────

export const toast = {
  success: (title: string, message?: string, duration?: number) =>
    useToastStore.getState().add({ type: 'success', title, message, duration }),
  error: (title: string, message?: string, duration?: number) =>
    useToastStore.getState().add({ type: 'error', title, message, duration: duration ?? 6000 }),
  warning: (title: string, message?: string, duration?: number) =>
    useToastStore.getState().add({ type: 'warning', title, message, duration }),
  info: (title: string, message?: string, duration?: number) =>
    useToastStore.getState().add({ type: 'info', title, message, duration }),
};

// ─── Single toast item ────────────────────────────────────────────────────────

const STYLES: Record<ToastType, { icon: typeof CheckCircle; color: string; bg: string; border: string; glow: string }> = {
  success: {
    icon: CheckCircle,
    color: '#34d399',
    bg: 'rgba(16,185,129,0.10)',
    border: 'rgba(16,185,129,0.28)',
    glow: 'rgba(16,185,129,0.15)',
  },
  error: {
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(239,68,68,0.10)',
    border: 'rgba(239,68,68,0.28)',
    glow: 'rgba(239,68,68,0.15)',
  },
  warning: {
    icon: AlertTriangle,
    color: '#fbbf24',
    bg: 'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.28)',
    glow: 'rgba(245,158,11,0.12)',
  },
  info: {
    icon: Info,
    color: '#60a5fa',
    bg: 'rgba(96,165,250,0.10)',
    border: 'rgba(96,165,250,0.25)',
    glow: 'rgba(96,165,250,0.12)',
  },
};

function ToastItem({ toast: t, onRemove }: { toast: Toast; onRemove: () => void }) {
  const duration = t.duration ?? 4000;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (duration === 0) return;
    timerRef.current = setTimeout(onRemove, duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [duration, onRemove]);

  const s = STYLES[t.type];
  const Icon = s.icon;

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '12px',
        background: 'rgba(14,14,24,0.97)',
        border: `1px solid ${s.border}`,
        backdropFilter: 'blur(24px)',
        boxShadow: `0 4px 24px rgba(0,0,0,0.55), 0 0 0 1px ${s.glow}`,
        minWidth: '280px',
        maxWidth: '380px',
        animation: 'toast-in 0.22s cubic-bezier(0.34,1.56,0.64,1)',
        position: 'relative',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          background: s.bg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          marginTop: '1px',
        }}
      >
        <Icon size={14} style={{ color: s.color }} />
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(238,238,248,0.92)', lineHeight: 1.3, margin: 0 }}>
          {t.title}
        </p>
        {t.message && (
          <p style={{ fontSize: '12px', color: 'rgba(238,238,248,0.50)', marginTop: '3px', lineHeight: 1.4, margin: '3px 0 0' }}>
            {t.message}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {duration > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '2px',
            borderRadius: '0 0 12px 12px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: s.color,
              opacity: 0.5,
              animation: `toast-progress ${duration}ms linear forwards`,
              transformOrigin: 'left',
            }}
          />
        </div>
      )}

      {/* Dismiss */}
      <button
        onClick={onRemove}
        style={{
          flexShrink: 0,
          width: '20px',
          height: '20px',
          borderRadius: '6px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(238,238,248,0.30)',
          padding: 0,
          marginTop: '1px',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'rgba(238,238,248,0.70)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'rgba(238,238,248,0.30)')}
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Toaster (mount once in Shell) ───────────────────────────────────────────

export function Toaster() {
  const { toasts, remove } = useToastStore();

  return (
    <>
      {/* Keyframes injected once */}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(12px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0)   scale(1); }
        }
        @keyframes toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>

      {/* Portal-like fixed container — bottom-right */}
      <div
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={() => remove(t.id)} />
          </div>
        ))}
      </div>
    </>
  );
}
