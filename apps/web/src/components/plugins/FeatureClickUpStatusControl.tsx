import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2, ExternalLink, Layers } from 'lucide-react';
import { pluginsApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

// ─── FeatureClickUpStatusControl ─────────────────────────────────────────────
// Live status pill for a feature's linked ClickUp task, shown in the feature
// overview header. Click → dropdown of the list's statuses → confirmation
// modal (double-confirm: deliberate pick + explicit confirm) → outbound write.
// Renders nothing when the feature has no linked ClickUp task.

interface StatusOption {
  status: string;
  color?: string;
  type?: string;
}

const FALLBACK_COLOR = '#94a3b8';

interface InitialDisplay {
  status?: string | null;
  statusColor?: string | null;
  externalUrl?: string | null;
}

export function FeatureClickUpStatusControl({
  featureId,
  scope = 'feature',
  lazy = false,
  hideEpic = false,
  initial,
}: {
  /** Entity id — a featureId or, when scope='issue', an issueId. */
  featureId: string;
  /** Which entity's linked ClickUp task to drive. Defaults to 'feature'. */
  scope?: 'feature' | 'issue';
  /** When true, statuses are only fetched once the menu is first opened. Use in
   *  long lists so we don't fan out one ClickUp probe per row on mount. */
  lazy?: boolean;
  /** Suppress the epic pill (e.g. list rows that already show their own). */
  hideEpic?: boolean;
  /** Cached status to paint immediately in lazy mode before the live fetch. */
  initial?: InitialDisplay;
}) {
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [opened, setOpened] = useState(!lazy);
  const [pending, setPending] = useState<StatusOption | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const statusKey = scope === 'issue' ? 'issue-clickup-status' : 'feature-clickup-status';

  const { data, isLoading, isError } = useQuery({
    queryKey: [statusKey, featureId],
    queryFn: () => scope === 'issue'
      ? pluginsApi.getIssueClickUpStatus(featureId)
      : pluginsApi.getFeatureClickUpStatus(featureId),
    enabled: !!featureId && opened,
    staleTime: 30_000,
    // 404 (no linked task) is expected — don't retry, just hide the control.
    retry: false,
  });

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const update = useMutation({
    mutationFn: (status: string) => scope === 'issue'
      ? pluginsApi.setIssueClickUpStatus(featureId, status)
      : pluginsApi.setFeatureClickUpStatus(featureId, status),
    onSuccess: (res) => {
      toast.success('ClickUp updated', `Task moved to "${res.externalStatus}".`);
      setPending(null);
      qc.invalidateQueries({ queryKey: [statusKey, featureId] });
      // Keep the linked-ticket panel / row snapshot in sync.
      qc.invalidateQueries({ queryKey: ['ticket-links', scope, featureId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('ClickUp update failed', typeof msg === 'string' ? msg : 'Could not reach ClickUp — try again.');
    },
  });

  // Authoritatively unlinked → hide. A pull error (e.g. the linked task was
  // deleted → ClickUp 404) only hides the control when there's no cached
  // snapshot to fall back on; otherwise keep the pill so QA still sees the
  // status + can open the task, instead of the control silently vanishing.
  if (opened && data && !data.linked) return null;
  if (opened && isError && !initial) return null;

  // Eager mode shows a placeholder during the first load; lazy mode paints the
  // cached `initial` chip immediately and defers the probe to first open.
  if (!lazy && (isLoading || !data)) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]"
        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.5)' }}
      >
        <Loader2 size={11} className="animate-spin" /> ClickUp…
      </span>
    );
  }

  const currentStatus = data?.currentStatus || initial?.status || 'unknown';
  const currentColor = data?.currentStatusColor ?? initial?.statusColor ?? FALLBACK_COLOR;
  const externalUrl = data?.externalUrl ?? initial?.externalUrl ?? undefined;

  return (
    <div className="relative inline-flex items-center gap-1.5" ref={ref}>
      {/* Linked ClickUp epic — read from the task's custom fields. Uses the
          epic option's own colour when ClickUp provides one. */}
      {!hideEpic && data?.epic && (() => {
        const c = data.epic.color;
        return (
          <span
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              background: c ? `${c}22` : 'rgba(56,189,248,0.12)',
              border: `1px solid ${c ? `${c}66` : 'rgba(56,189,248,0.30)'}`,
              color: c ?? '#7dd3fc',
            }}
            title={`ClickUp epic: ${data.epic.name}`}
          >
            <Layers size={11} />
            <span className="uppercase tracking-wide opacity-60">Epic</span>
            <span className="max-w-[160px] truncate">{data.epic.name}</span>
          </span>
        );
      })()}
      <button
        type="button"
        onClick={() => { setOpened(true); setMenuOpen((v) => !v); }}
        title="Linked ClickUp task status — click to change"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(238,238,248,0.85)',
        }}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: currentColor }} />
        <span className="uppercase tracking-wide" style={{ color: 'rgba(238,238,248,0.5)' }}>ClickUp</span>
        <span className="capitalize">{currentStatus}</span>
        <ChevronDown size={11} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 min-w-[220px] rounded-lg py-1 z-[120] max-h-72 overflow-y-auto"
          style={{
            background: 'rgba(22,22,34,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
          }}
        >
          <div
            className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
            style={{ color: 'rgba(238,238,248,0.4)' }}
          >
            Move ClickUp task to…
          </div>
          {!data && !isError && (
            <div className="px-3 py-2 flex items-center gap-1.5 text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              <Loader2 size={11} className="animate-spin" /> Loading statuses…
            </div>
          )}
          {!data && isError && (
            <div className="px-3 py-2 text-[11px]" style={{ color: '#fbbf24' }}>
              Couldn’t load statuses from ClickUp — the task may have been deleted or moved.
            </div>
          )}
          {data && data.statuses.length === 0 && (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              No statuses available for this list.
            </div>
          )}
          {data?.statuses.map((s) => {
            const isCurrent = s.status.toLowerCase() === data.currentStatus.toLowerCase();
            return (
              <button
                key={s.status}
                type="button"
                disabled={isCurrent}
                onClick={() => {
                  setMenuOpen(false);
                  setPending(s);
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.06] disabled:opacity-45 disabled:cursor-default"
                style={{ color: 'rgba(238,238,248,0.88)' }}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color ?? FALLBACK_COLOR }} />
                <span className="flex-1 capitalize">{s.status}</span>
                {isCurrent && (
                  <span className="text-[9px] uppercase tracking-wide" style={{ color: 'rgba(238,238,248,0.4)' }}>
                    current
                  </span>
                )}
              </button>
            );
          })}
          <div className="border-t mt-1 pt-1" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] transition-colors hover:bg-white/[0.06]"
              style={{ color: 'var(--accent-300)' }}
            >
              <ExternalLink size={11} /> Open in ClickUp
            </a>
          </div>
        </div>
      )}

      {/* Confirmation — the second deliberate step before the outbound write. */}
      <Modal
        open={!!pending}
        onClose={() => !update.isPending && setPending(null)}
        title="Update ClickUp ticket?"
        size="sm"
      >
        {pending && data && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This writes to the real ClickUp board. Move{' '}
              <span className="font-semibold text-gray-800">{data.externalTitle ?? data.externalId}</span>{' '}
              from{' '}
              <span className="font-semibold capitalize" style={{ color: currentColor }}>
                {data.currentStatus}
              </span>{' '}
              to{' '}
              <span className="font-semibold capitalize" style={{ color: pending.color ?? FALLBACK_COLOR }}>
                {pending.status}
              </span>
              ?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPending(null)} disabled={update.isPending}>
                Cancel
              </Button>
              <Button onClick={() => update.mutate(pending.status)} loading={update.isPending}>
                Yes, update ClickUp
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
