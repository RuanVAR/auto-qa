import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, Loader2 } from 'lucide-react';
import { runsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * StopRunButton
 * -------------
 * Tiny inline "force stop" affordance for an in-flight TestRun. Drop next
 * to a RUNNING/PENDING/QUEUED badge wherever a test list row is shown.
 *
 * The flow when clicked:
 *   1. Local confirmation (window.confirm — minimal friction; no popover
 *      mount cost on every row).
 *   2. POST /api/v1/runs/:id/cancel — sets status to CANCELLED in the DB.
 *   3. Worker's 1-second abort watchdog notices and SIGKILLs the headless
 *      browser. Total turnaround is ~1-2 seconds end to end.
 *   4. Local mutation invalidates the project runs cache, so the badge
 *      transitions Running → Cancelled the moment the WebSocket fires.
 *
 * 409 from the API means "the run finished or was already cancelled before
 * your click landed" — benign, surfaced as a toast.
 */

interface Props {
  runId: string;
  /** Compact = 18px icon, default = 14px. */
  size?: 'sm' | 'md';
  /** Optional CSS class for layout. */
  className?: string;
}

export function StopRunButton({ runId, size = 'sm', className }: Props) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const cancelMut = useMutation({
    mutationFn: () => runsApi.cancel(runId),
    onSuccess: () => {
      toast.success('Stop requested — worker is killing the browser');
      // Force the run + project list to refetch immediately so the badge
      // updates without waiting for the next WebSocket beat. The 1s worker
      // poll will follow up with the final CANCELLED status.
      qc.invalidateQueries({ queryKey: ['run', runId] });
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'tests-browse' ||
            q.queryKey[0] === 'test-active-runs' ||
            q.queryKey[0] === 'runs'),
      });
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 409) {
        // 409 = the run reached a terminal state before our cancel landed.
        toast.success('Run already finished');
      } else {
        const msg =
          (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          ?? (err as Error).message
          ?? 'Cancel failed';
        toast.error(msg);
      }
    },
  });

  const handleClick = (e: React.MouseEvent) => {
    // Stop propagation — when this button lives inside a clickable row
    // (e.g. RecentRunsPanel), we don't want the row's onClick to fire too.
    e.stopPropagation();
    if (confirming) return;
    setConfirming(true);
    const ok = window.confirm('Force stop this run? The Playwright browser will be killed mid-step.');
    setConfirming(false);
    if (!ok) return;
    cancelMut.mutate();
  };

  const iconPx = size === 'sm' ? 11 : 13;
  const busy = cancelMut.isPending || confirming;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      title="Force stop this run"
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors disabled:opacity-50 ${className ?? ''}`}
      style={{
        background: 'rgba(239,68,68,0.10)',
        border: '1px solid rgba(239,68,68,0.30)',
        color: '#f87171',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
      }}
    >
      {busy ? (
        <Loader2 size={iconPx} className="animate-spin" />
      ) : (
        <Square size={iconPx} strokeWidth={2.5} />
      )}
      <span>Stop</span>
    </button>
  );
}
