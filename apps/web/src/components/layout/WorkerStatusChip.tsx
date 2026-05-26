import { useQuery } from '@tanstack/react-query';
import { Cpu } from 'lucide-react';
import { workerApi } from '@/lib/api';

/**
 * WorkerStatusChip
 * ----------------
 * Tiny topbar chip surfacing live BullMQ test-run queue state:
 *   ● 2/3 running · 4 queued
 *
 * Hidden when the queue is completely idle (nothing active, nothing waiting)
 * — testers don't need a permanent dot in their topbar for zero state.
 *
 * Polls every 5s. The endpoint is SkipThrottle and cheap (4 Redis XLEN-style
 * ops); much simpler than running a dedicated WebSocket event for queue
 * depth which would only matter when the user looks at the chip.
 */

export function WorkerStatusChip() {
  const { data } = useQuery({
    queryKey: ['worker-status'],
    queryFn: () => workerApi.status(),
    refetchInterval: 5_000,
    staleTime: 4_000,
    // Don't retry on transient failures — chip simply hides until next poll.
    retry: false,
  });

  // Hide the chip entirely when there's nothing to look at.
  if (!data) return null;
  if (data.active === 0 && data.waiting === 0) return null;

  // Colour shifts: green when comfortably below capacity, amber when fully
  // saturated, red when queue is piling up.
  const saturated = data.active >= data.concurrency;
  const piling = data.waiting > 3;

  const dotColour = piling ? '#f87171' : saturated ? '#fbbf24' : '#34d399';
  const borderColour = piling
    ? 'rgba(239,68,68,0.30)'
    : saturated
      ? 'rgba(245,158,11,0.30)'
      : 'rgba(52,211,153,0.30)';

  return (
    <div
      className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px]"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${borderColour}`,
        color: 'rgba(238,238,248,0.80)',
      }}
      title={`BullMQ test-run queue · concurrency ${data.concurrency}`}
    >
      {/* Pulsing dot — visual proof "the system is alive". The CSS class
          `animate-pulse` is part of Tailwind's default set; no extra config. */}
      <span
        className="w-1.5 h-1.5 rounded-full animate-pulse"
        style={{ background: dotColour }}
      />
      <Cpu size={11} style={{ color: 'rgba(238,238,248,0.55)' }} />
      <span className="tabular-nums">
        {data.active}/{data.concurrency}
      </span>
      <span className="opacity-60">running</span>
      {data.waiting > 0 && (
        <>
          <span className="opacity-30">·</span>
          <span className="tabular-nums">{data.waiting}</span>
          <span className="opacity-60">queued</span>
        </>
      )}
    </div>
  );
}
