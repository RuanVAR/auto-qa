import { Info } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import { metricHelp, type MetricHelpKey } from '@/lib/metricHelp';
import { cn } from '@/lib/utils';

interface Props {
  /** Either a known metric key (pulls copy from metricHelp) … */
  metric?: MetricHelpKey;
  /** … or explicit free-text help. One of the two is required. */
  text?: string;
  /** Override the tooltip wrap width (px). Defaults to 260. */
  width?: number;
  className?: string;
  side?: 'top' | 'bottom';
}

/**
 * A small, unobtrusive "(i)" affordance shown next to a stat label / chart
 * title. On hover (or keyboard focus) it explains what the metric means and
 * how it's calculated, via the shared metricHelp dictionary so the copy is
 * consistent everywhere the same number appears.
 */
export function MetricInfo({ metric, text, width = 260, className, side = 'top' }: Props) {
  const label = text ?? (metric ? metricHelp[metric] : '');
  if (!label) return null;
  return (
    <Tooltip label={label} maxWidth={width} side={side}>
      <button
        type="button"
        // Pure hint — never submits / navigates. Stop clicks from bubbling
        // to a clickable card / row behind it.
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center rounded-full align-middle transition-opacity',
          'opacity-40 hover:opacity-100 focus:opacity-100 focus:outline-none cursor-help',
          className,
        )}
        style={{ color: 'rgba(238,238,248,0.65)' }}
      >
        <Info size={12} strokeWidth={2.25} />
      </button>
    </Tooltip>
  );
}
