import { Info } from 'lucide-react';
import { failureCategoryMeta } from '@/lib/failureCategories';

// ─── FailureReasonChip ───────────────────────────────────────────────────────
// A compact "Reason" chip shown next to a FAILED test. Hovering reveals the
// captured failure category + detail — so a red status is never a dead end.

interface FailureReasonChipProps {
  reason: { category: string | null; note: string | null };
}

export function FailureReasonChip({ reason }: FailureReasonChipProps) {
  const meta = failureCategoryMeta(reason.category);

  return (
    <span className="relative group/reason inline-flex">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
        style={{
          background: 'rgba(239,68,68,0.10)',
          color: '#fca5a5',
          border: '1px solid rgba(239,68,68,0.28)',
        }}
        title="View failure reason"
        aria-label="View failure reason"
      >
        <Info size={9} /> Reason
      </button>
      {/* Pure-CSS hover popover — no click state needed. */}
      <div
        className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg p-2.5 opacity-0 pointer-events-none transition-opacity group-hover/reason:opacity-100"
        style={{
          background: 'rgba(22,22,34,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}
      >
        {meta && (
          <span
            className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded mb-1.5"
            style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            {meta.label}
          </span>
        )}
        <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(238,238,248,0.8)' }}>
          {reason.note?.trim() || 'No additional detail was added.'}
        </p>
      </div>
    </span>
  );
}
