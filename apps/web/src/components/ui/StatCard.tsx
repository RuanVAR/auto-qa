import { LucideIcon, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

const COLOR_MAP = {
  sky:    { icon: 'rgba(139,92,246,0.25)', iconColor: '#a78bfa', glow: 'rgba(139,92,246,0.15)' },
  green:  { icon: 'rgba(16,185,129,0.20)', iconColor: '#34d399', glow: 'rgba(16,185,129,0.10)' },
  red:    { icon: 'rgba(239,68,68,0.20)',  iconColor: '#f87171', glow: 'rgba(239,68,68,0.10)' },
  yellow: { icon: 'rgba(245,158,11,0.20)', iconColor: '#fbbf24', glow: 'rgba(245,158,11,0.10)' },
  violet: { icon: 'rgba(124,58,237,0.25)', iconColor: '#c4b5fd', glow: 'rgba(124,58,237,0.15)' },
};

export function StatCard({
  label,
  value,
  icon: Icon,
  color = 'sky',
  trend,
  action,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  color?: 'sky' | 'green' | 'red' | 'yellow' | 'violet';
  trend?: string;
  action?: {
    label: string;
    onClick?: () => void;
    to?: string;
  };
}) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.sky;

  const actionEl = action ? (
    action.to ? (
      <Link
        to={action.to}
        className="flex items-center gap-1 text-xs font-medium transition-colors hover:underline"
        style={{ color: c.iconColor }}
      >
        {action.label}
        <ArrowRight size={11} />
      </Link>
    ) : (
      <button
        onClick={action.onClick}
        className="flex items-center gap-1 text-xs font-medium transition-colors hover:underline"
        style={{ color: c.iconColor, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {action.label}
        <ArrowRight size={11} />
      </button>
    )
  ) : null;

  return (
    <div
      className={`rounded-2xl p-5 relative overflow-hidden flex flex-col ${action ? 'justify-between' : ''}`}
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.05)`,
        minHeight: action ? 130 : undefined,
      }}
    >
      {/* Subtle colour glow behind the icon */}
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"
        style={{ background: `radial-gradient(circle, ${c.glow} 0%, transparent 70%)` }}
      />

      <div className="relative">
        <div className="flex items-start justify-between mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.58)' }}>
            {label}
          </span>
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: c.icon }}
          >
            <Icon size={17} style={{ color: c.iconColor }} />
          </div>
        </div>

        <div className="text-3xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {value}
        </div>
        {trend && (
          <div className="text-xs mt-1.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
            {trend}
          </div>
        )}
      </div>

      {actionEl && (
        <div className="relative mt-3 pt-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          {actionEl}
        </div>
      )}
    </div>
  );
}
