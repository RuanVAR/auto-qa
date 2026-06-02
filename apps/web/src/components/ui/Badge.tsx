import { cn } from '@/lib/utils';

type V = 'default' | 'success' | 'danger' | 'warning' | 'info' | 'muted';

const V_MAP: Record<V, { className: string; style: React.CSSProperties }> = {
  default: {
    className: '',
    style: { background: 'rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.75)', border: '1px solid rgba(255,255,255,0.10)' },
  },
  success: {
    className: '',
    style: { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.25)' },
  },
  danger: {
    className: '',
    style: { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' },
  },
  warning: {
    className: '',
    style: { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' },
  },
  info: {
    className: '',
    style: { background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent-400)', border: '1px solid rgba(var(--accent-rgb),0.28)' },
  },
  muted: {
    className: '',
    style: { background: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.40)', border: '1px solid rgba(255,255,255,0.07)' },
  },
};

export function Badge({ children, variant = 'default', className }: { children: React.ReactNode; variant?: V; className?: string }) {
  const { className: vClass, style } = V_MAP[variant];
  return (
    <span
      className={cn('inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium', vClass, className)}
      style={style}
    >
      {children}
    </span>
  );
}
