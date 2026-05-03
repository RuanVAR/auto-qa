import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

type V = 'primary' | 'secondary' | 'danger' | 'ghost';

const VMap: Record<V, { className: string; style: React.CSSProperties }> = {
  primary: {
    className: 'text-white font-semibold',
    style: {
      background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
      border: '1px solid rgba(124,58,237,0.50)',
      boxShadow: '0 0 12px rgba(124,58,237,0.30)',
    },
  },
  secondary: {
    className: 'font-medium',
    style: {
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.10)',
      color: 'rgba(238,238,248,0.80)',
    },
  },
  danger: {
    className: 'font-medium',
    style: {
      background: 'rgba(220,38,38,0.15)',
      border: '1px solid rgba(220,38,38,0.30)',
      color: '#f87171',
    },
  },
  ghost: {
    className: 'font-medium',
    style: {
      background: 'transparent',
      border: '1px solid transparent',
      color: 'rgba(238,238,248,0.55)',
    },
  },
};

interface ButtonProps {
  children: React.ReactNode;
  variant?: V;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit';
  style?: React.CSSProperties;
  /** Pass-through for accessibility (icon-only buttons MUST supply this). */
  ariaLabel?: string;
  title?: string;
  'data-testid'?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  onClick,
  className,
  type = 'button',
  style,
  ariaLabel,
  title,
  'data-testid': dataTestId,
}: ButtonProps) {
  const sizes = { sm: 'px-3 py-1.5 text-xs rounded-lg', md: 'px-4 py-2 text-sm rounded-xl', lg: 'px-5 py-2.5 text-sm rounded-xl' };
  const { className: vClass, style: vStyle } = VMap[variant];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      data-testid={dataTestId}
      title={title}
      className={cn(
        'inline-flex items-center gap-2 transition-all duration-150',
        // focus-visible ring for keyboard nav (doesn't show on mouse-click focus)
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'hover:brightness-110 active:scale-[0.98]',
        sizes[size],
        vClass,
        className,
      )}
      style={{ ...vStyle, ...style }}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}
