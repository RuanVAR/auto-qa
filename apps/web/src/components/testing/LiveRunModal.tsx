/**
 * LiveRunModal
 * ------------
 * A reusable "watch an automated run live" modal. Polls a triggered run +
 * its steps every second until terminal, streams the headless Chrome via the
 * /screencast Socket.IO namespace, and shows a per-step pass/fail breakdown.
 *
 * Used by:
 *   - the recorder (preview run — wraps it with Keep/Discard via `terminalActions`)
 *   - the test editor ("Run Test → Automated" — plain watch + open-full-run)
 *
 * Both paths trigger the exact same automated run (runsApi.trigger); this
 * modal is just the shared viewer.
 */

import type { ReactNode } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2, Square } from 'lucide-react';
import { runsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { LiveBrowserCanvas } from '@/components/LiveBrowserCanvas';

export type RunSummary = {
  id: string;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'ERROR' | string;
  startedAt?: string | null;
  completedAt?: string | null;
  duration?: number | null;
  errorMessage?: string | null;
};

export type RunStepSummary = {
  id: string;
  index: number;
  type: string;
  name?: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | string;
  errorMessage?: string | null;
};

/** Run statuses past which polling stops and the result is final. */
export const TERMINAL = new Set(['PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'ERROR']);

/** Per-step-type accent colour, shared with the recorder's step list. */
export const TYPE_COLOURS: Record<string, string> = {
  NAVIGATE: '#60a5fa',
  CLICK: 'var(--accent-400)',
  FILL: '#34d399',
  SELECT: '#fbbf24',
  CHECK: '#34d399',
  UNCHECK: '#9ca3af',
  KEYBOARD: '#f472b6',
  HOVER: '#9ca3af',
  SCROLL: '#9ca3af',
  WAIT: '#94a3b8',
  WAIT_MS: '#94a3b8',
};

export function StepStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PASSED:  { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Passed' },
    FAILED:  { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444', label: 'Failed' },
    RUNNING: { bg: 'rgba(var(--accent-rgb),0.15)', fg: 'var(--accent-400)', label: 'Running' },
    PENDING: { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(238,238,248,0.55)', label: 'Pending' },
    SKIPPED: { bg: 'rgba(251,191,36,0.15)', fg: '#fbbf24', label: 'Skipped' },
  };
  const m = map[status] ?? { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(238,238,248,0.55)', label: status };
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

interface LiveRunModalProps {
  open: boolean;
  /** The run to watch. Null while the run is still being created (`starting`). */
  runId: string | null;
  /** Show a "Starting…" banner before a runId exists (recorder preview). */
  starting?: boolean;
  title?: string;
  onClose: () => void;
  /** Extra footer buttons shown once the run reaches a terminal state. */
  terminalActions?: (run: RunSummary) => ReactNode;
}

export function LiveRunModal({
  open, runId, starting = false, title = 'Test run', onClose, terminalActions,
}: LiveRunModalProps) {
  // Poll the run + its steps every second until terminal. Short interval is
  // fine — runs are typically a few seconds and /runs/:id is cheap.
  const runQ = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.get(runId!) as Promise<RunSummary>,
    enabled: open && !!runId,
    refetchInterval: (q) => {
      const data = q.state.data as RunSummary | undefined;
      return data && TERMINAL.has(data.status) ? false : 1000;
    },
  });
  const stepsQ = useQuery({
    queryKey: ['run-steps', runId],
    queryFn: () => runsApi.getSteps(runId!) as Promise<RunStepSummary[]>,
    enabled: open && !!runId,
    refetchInterval: () => {
      const run = runQ.data;
      return run && TERMINAL.has(run.status) ? false : 1000;
    },
  });

  const isTerminal = !!runQ.data && TERMINAL.has(runQ.data.status);
  const passed = runQ.data?.status === 'PASSED';

  // Stop the run mid-flight. The API marks it CANCELLED; the worker's 1s
  // abort watchdog notices and SIGKILLs the headless Chrome.
  const stopMut = useMutation({
    mutationFn: async () => { if (runId) await runsApi.cancel(runId); },
    onSuccess: () => {
      toast.success('Run cancelled — worker is killing the browser');
    },
    onError: (err) => {
      const status = (err as { response?: { status?: number } }).response?.status;
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (err as Error).message ?? 'Cancel failed';
      // 409 = the run outpaced the cancel click — benign.
      if (status === 409) toast.success('Run already finished');
      else toast.error(msg);
      runQ.refetch();
      stepsQ.refetch();
    },
  });

  if (!open) return null;

  const steps = stepsQ.data ?? [];

  return (
    <Modal open onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {/* Status banner */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: isTerminal
              ? (passed ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)')
              : 'rgba(var(--accent-rgb),0.10)',
            border: `1px solid ${isTerminal
              ? (passed ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)')
              : 'rgba(var(--accent-rgb),0.30)'}`,
          }}
        >
          {starting && !runId ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  Starting…
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  Saving the steps and queueing the run.
                </div>
              </div>
            </>
          ) : !isTerminal ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent-400)' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  {runQ.data?.status ?? 'Pending…'}
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  Worker is executing the steps in headless Chrome.
                </div>
              </div>
            </>
          ) : passed ? (
            <>
              <CheckCircle2 size={20} style={{ color: '#10b981' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#10b981' }}>Passed</div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  All steps replayed cleanly{runQ.data?.duration != null && ` in ${(runQ.data.duration / 1000).toFixed(1)}s`}.
                </div>
              </div>
            </>
          ) : (
            <>
              <XCircle size={20} style={{ color: '#ef4444' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                  {runQ.data?.status ?? 'Failed'}
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  {runQ.data?.errorMessage || 'One or more steps did not replay successfully — see breakdown below.'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Live browser view — streams the headless Chrome. Only render while
            the run is executing; after terminal the canvas just shows a stale
            last frame, which is misleading. */}
        {runId && !isTerminal && (
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)', aspectRatio: '16 / 10' }}
          >
            <LiveBrowserCanvas runId={runId} active={!isTerminal} />
          </div>
        )}

        {/* Steps table */}
        {steps.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="grid grid-cols-[36px_60px_1fr_72px] text-[10px] uppercase tracking-wider px-3 py-2"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.50)' }}>
              <div>#</div>
              <div>Type</div>
              <div>Step</div>
              <div className="text-right">Status</div>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              {steps
                .slice()
                .sort((a, b) => a.index - b.index)
                .map((s) => (
                <div key={s.id} className="grid grid-cols-[36px_60px_1fr_72px] items-center px-3 py-2 text-xs border-t"
                  style={{ borderColor: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.80)' }}>
                  <div className="font-mono" style={{ color: 'rgba(238,238,248,0.40)' }}>{s.index + 1}</div>
                  <div className="font-mono text-[10px]" style={{ color: TYPE_COLOURS[s.type] ?? 'rgba(238,238,248,0.6)' }}>{s.type}</div>
                  <div className="truncate">
                    <span>{s.name ?? s.type}</span>
                    {s.errorMessage && (
                      <div className="text-[11px] mt-0.5" style={{ color: '#fca5a5' }}>{s.errorMessage}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <StepStatusPill status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-1">
          {!isTerminal ? (
            <>
              <Button
                variant="ghost"
                onClick={onClose}
                title="Close this modal — the run keeps going in the background. You can come back to it from the Test Runs list."
              >
                Run in background
              </Button>
              <Button
                variant="danger"
                onClick={() => stopMut.mutate()}
                loading={stopMut.isPending}
                disabled={stopMut.isPending || !runId}
                title="Cancel the run — the worker SIGKILLs the headless Chrome immediately"
              >
                <Square size={13} className="mr-1" /> Stop run
              </Button>
            </>
          ) : (
            <>
              {runId && (
                <a
                  href={`/runs/${runId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] underline self-center mr-auto"
                  style={{ color: 'rgba(238,238,248,0.55)' }}
                >
                  Open full run details ↗
                </a>
              )}
              {terminalActions && runQ.data
                ? terminalActions(runQ.data)
                : <Button variant="secondary" onClick={onClose}>Close</Button>}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
