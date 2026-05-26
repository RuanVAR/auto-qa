import type { ReactNode } from 'react';

/**
 * KpiCard — single big number with a label + optional sub-line.
 * Mirrors the visual language of the existing StatCard but with a larger
 * value and an icon slot, suited to the analytics dashboard header strip.
 */
interface Props {
  label: string;
  value: ReactNode;
  sub?: string;
  /** Icon node — sized 18px. */
  icon?: ReactNode;
  /** Accent colour for the value text. */
  valueColor?: string;
  /** Accent colour for the icon bubble. */
  accent?: string;
}
export function KpiCard({ label, value, sub, icon, valueColor, accent }: Props) {
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      {icon && (
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accent ?? 'rgba(139,92,246,0.18)' }}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <p
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: 'rgba(238,238,248,0.45)' }}
        >
          {label}
        </p>
        <p
          className="text-2xl font-bold tabular-nums leading-tight mt-0.5"
          style={{ color: valueColor ?? 'rgba(238,238,248,0.92)' }}
        >
          {value}
        </p>
        {sub && (
          <p className="text-[10px] mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>{sub}</p>
        )}
      </div>
    </div>
  );
}
