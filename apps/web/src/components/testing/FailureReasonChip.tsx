import { Info, Video } from 'lucide-react';
import { failureCategoryMeta } from '@/lib/failureCategories';

// ─── FailureReasonChip ───────────────────────────────────────────────────────
// A compact "Reason" chip shown next to a FAILED test. Hovering reveals the
// captured failure category + detail + any attached evidence — so a red status
// is never a dead end, and the evidence is reviewable later (survives logout).

interface FailureReasonChipProps {
  reason: {
    category: string | null;
    note: string | null;
    screenshotUrls?: string[];
    recordingUrl?: string | null;
  };
}

export function FailureReasonChip({ reason }: FailureReasonChipProps) {
  const meta = failureCategoryMeta(reason.category);
  const screenshots = reason.screenshotUrls ?? [];
  const hasEvidence = screenshots.length > 0 || !!reason.recordingUrl;

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
        {hasEvidence && (
          <div className="flex flex-wrap gap-1.5 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            {screenshots.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="block rounded overflow-hidden" style={{ width: 64, height: 44, border: '1px solid rgba(255,255,255,0.12)' }}>
                <img src={url} alt="Failure screenshot" className="w-full h-full object-cover" />
              </a>
            ))}
            {reason.recordingUrl && (
              <a href={reason.recordingUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center rounded gap-1 text-[10px] font-medium" style={{ width: 64, height: 44, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.4)', color: '#fca5a5' }}>
                <Video size={12} /> Video
              </a>
            )}
          </div>
        )}
      </div>
    </span>
  );
}
