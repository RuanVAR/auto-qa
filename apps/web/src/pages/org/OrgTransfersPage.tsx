import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Inbox, ChevronLeft, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { transfersApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { errMsg, formatDate } from '@/lib/utils';

type TransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

type TransferRow = {
  id: string;
  status: TransferStatus;
  direction: 'in' | 'out';
  message?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  expiresAt: string;
  project: { id: string; name: string; slug: string };
  fromOrg: { id: string; name: string };
  toOrg: { id: string; name: string };
  requestedBy?: { name: string; email: string } | null;
  reviewedBy?: { name: string; email: string } | null;
};

type PlanMember = { userId: string; name: string | null; email: string; role: string };

type Plan = {
  slugConflict: boolean;
  suggestedSlug: string;
  membersToPurge: PlanMember[];
  ownerNeedsReassign: boolean;
  currentOwner: PlanMember | null;
  docsToMove: number;
  bindingsToSever: { kind: string; label: string; count: number }[];
};

const STATUS_VARIANT: Record<TransferStatus, 'warning' | 'success' | 'danger' | 'muted'> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
};

// ── Review modal ─────────────────────────────────────────────────────────────

/**
 * Accepting moves the project immediately and irreversibly, so this modal
 * shows the CURRENT impact fetched fresh from the server rather than the
 * snapshot taken when the request was raised — the sending org can add members
 * or integrations in between, and the admin is consenting to what happens now.
 */
function ReviewModal({ row, orgId, onClose }: { row: TransferRow; orgId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const { data, isLoading } = useQuery<{ currentPlan: Plan | null }>({
    queryKey: ['org-transfer', orgId, row.id],
    queryFn: () => transfersApi.getForReview(orgId, row.id),
  });
  const plan = data?.currentPlan ?? null;

  const done = (msg: string) => {
    queryClient.invalidateQueries({ queryKey: ['org-transfers', orgId] });
    queryClient.invalidateQueries({ queryKey: ['projects'] });
    toast.success(msg);
    onClose();
  };

  const acceptMutation = useMutation({
    mutationFn: () => transfersApi.accept(orgId, row.id, { note: note || undefined }),
    onSuccess: () => done(`${row.project.name} is now part of your organisation`),
    onError: (e) => toast.error(errMsg(e, 'Could not accept the transfer')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => transfersApi.reject(orgId, row.id, { note: note || undefined }),
    onSuccess: () => done('Transfer declined'),
    onError: (e) => toast.error(errMsg(e, 'Could not decline the transfer')),
  });

  const busy = acceptMutation.isPending || rejectMutation.isPending;

  return (
    <Modal open onClose={onClose} title="Review project transfer" size="md">
      <div className="space-y-5">
        <div
          className="p-4 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {row.project.name}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            From <strong>{row.fromOrg.name}</strong>
            {row.requestedBy ? ` · requested by ${row.requestedBy.name}` : ''} ·{' '}
            {formatDate(row.createdAt)}
          </div>
          {row.message && (
            <p className="text-xs italic mt-2" style={{ color: 'var(--text-muted)' }}>
              “{row.message}”
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="py-6 flex justify-center">
            <PageSpinner />
          </div>
        ) : plan ? (
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <AlertTriangle size={13} style={{ color: '#fbbf24' }} />
              <span
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                If you accept
              </span>
            </div>
            <ul className="space-y-1.5" data-testid="transfer-review-impacts">
              {plan.slugConflict && (
                <li className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  • The project URL will change to <code>{plan.suggestedSlug}</code> — that slug is
                  already taken here.
                </li>
              )}
              {plan.membersToPurge.length > 0 && (
                <li className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  • {plan.membersToPurge.length} member
                  {plan.membersToPurge.length === 1 ? '' : 's'} of {row.fromOrg.name} will lose
                  access:{' '}
                  <span style={{ color: 'var(--text-muted)' }}>
                    {plan.membersToPurge.map(m => m.name ?? m.email).join(', ')}
                  </span>
                </li>
              )}
              {plan.ownerNeedsReassign && (
                <li className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  • The current owner is not in your organisation — you will become the owner.
                </li>
              )}
              {plan.docsToMove > 0 && (
                <li className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  • {plan.docsToMove} document{plan.docsToMove === 1 ? '' : 's'} will move with the
                  project.
                </li>
              )}
              {plan.bindingsToSever.map(b => (
                <li key={b.kind} className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  • {b.count} × {b.label.toLowerCase()} will be disconnected — they belong to{' '}
                  {row.fromOrg.name}. You can reconnect them with your own integrations afterwards.
                </li>
              ))}
              {!plan.slugConflict &&
                !plan.membersToPurge.length &&
                !plan.ownerNeedsReassign &&
                !plan.docsToMove &&
                !plan.bindingsToSever.length && (
                  <li className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    • Nothing else is affected.
                  </li>
                )}
            </ul>
          </div>
        ) : null}

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Note (optional)
          </label>
          <textarea
            rows={2}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={`Shown to ${row.fromOrg.name}…`}
            className="w-full resize-none text-sm rounded-xl px-3 py-2"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'var(--text-primary)',
            }}
            data-testid="transfer-review-note"
          />
        </div>

        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Accepting moves the project straight away. Undoing it means transferring it back.
        </p>

        <div className="flex items-center gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={rejectMutation.isPending}
            disabled={busy}
            onClick={() => rejectMutation.mutate()}
            data-testid="transfer-reject"
          >
            Decline
          </Button>
          <Button
            size="sm"
            loading={acceptMutation.isPending}
            disabled={busy || isLoading}
            onClick={() => acceptMutation.mutate()}
            data-testid="transfer-accept"
          >
            Accept transfer
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function OrgTransfersPage() {
  const { activeOrgId } = useAuthStore();
  const orgId = activeOrgId ?? '';
  const [reviewing, setReviewing] = useState<TransferRow | null>(null);

  const { data: rows = [], isLoading } = useQuery<TransferRow[]>({
    queryKey: ['org-transfers', orgId],
    queryFn: () => transfersApi.listForOrg(orgId),
    enabled: !!orgId,
  });

  const incoming = rows.filter(r => r.direction === 'in' && r.status === 'PENDING');
  const rest = rows.filter(r => !(r.direction === 'in' && r.status === 'PENDING'));

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link
        to="/org"
        className="inline-flex items-center gap-1 text-xs hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Organisation
      </Link>

      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(var(--accent-rgb),0.18)' }}
        >
          <ArrowRightLeft size={16} style={{ color: 'var(--accent-400)' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Project transfers
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Review projects other organisations want to hand over to you
          </p>
        </div>
      </div>

      {/* Incoming, pending — the only rows that need a decision */}
      {incoming.length === 0 ? (
        <div
          className="rounded-2xl p-12 flex flex-col items-center gap-4 text-center"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <Inbox size={36} style={{ color: 'rgba(238,238,248,0.20)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            No transfers waiting on you
          </p>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)',
          }}
          data-testid="transfers-incoming"
        >
          {incoming.map((row, idx) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 px-5 py-4"
              style={{
                borderBottom: idx < incoming.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
              }}
            >
              <div className="min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {row.project.name}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  from {row.fromOrg.name}
                  {row.requestedBy ? ` · ${row.requestedBy.name}` : ''} · expires{' '}
                  {formatDate(row.expiresAt)}
                </div>
                {row.message && (
                  <div className="text-xs italic mt-0.5" style={{ color: 'rgba(238,238,248,0.35)' }}>
                    “{row.message}”
                  </div>
                )}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReviewing(row)}
                data-testid="transfer-review"
              >
                Review
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Everything else, both directions — a plain record */}
      {rest.length > 0 && (
        <div>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--text-muted)' }}
          >
            History
          </h3>
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            data-testid="transfers-history"
          >
            {rest.map((row, idx) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 px-5 py-3"
                style={{
                  borderBottom: idx < rest.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {row.direction === 'in' ? (
                    <ArrowDownLeft size={14} style={{ color: 'var(--text-muted)' }} />
                  ) : (
                    <ArrowUpRight size={14} style={{ color: 'var(--text-muted)' }} />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                      {row.project.name}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {row.direction === 'in' ? `from ${row.fromOrg.name}` : `to ${row.toOrg.name}`} ·{' '}
                      {formatDate(row.createdAt)}
                      {row.reviewedBy ? ` · ${row.reviewedBy.name}` : ''}
                    </div>
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[row.status]}>{row.status.toLowerCase()}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviewing && (
        <ReviewModal row={reviewing} orgId={orgId} onClose={() => setReviewing(null)} />
      )}
    </div>
  );
}

export default OrgTransfersPage;
