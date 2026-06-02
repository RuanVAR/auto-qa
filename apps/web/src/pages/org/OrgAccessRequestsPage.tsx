import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Inbox, User, ChevronLeft } from 'lucide-react';
import { accessRequestsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AccessRequest {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  message?: string | null;
  createdAt: string;
  requester: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

// ── Review Modal ──────────────────────────────────────────────────────────────

function ReviewModal({
  request,
  orgId,
  onClose,
}: {
  request: AccessRequest;
  orgId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [grantedRole, setGrantedRole] = useState<'ORG_MEMBER' | 'ORG_ADMIN'>('ORG_MEMBER');
  const [reviewerNote, setReviewerNote] = useState('');

  const approveMutation = useMutation({
    mutationFn: () =>
      accessRequestsApi.reviewOrgRequest(orgId, request.id, {
        action: 'APPROVED',
        grantedRole,
        reviewerNote: reviewerNote || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-access-requests', orgId] });
      onClose();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      accessRequestsApi.reviewOrgRequest(orgId, request.id, {
        action: 'REJECTED',
        reviewerNote: reviewerNote || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-access-requests', orgId] });
      onClose();
    },
  });

  const isLoading = approveMutation.isPending || rejectMutation.isPending;

  return (
    <Modal open onClose={onClose} title="Review Access Request" size="md">
      <div className="space-y-5">
        {/* Requester info */}
        <div
          className="flex items-center gap-3 p-4 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.30)' }}
          >
            {request.requester.avatarUrl ? (
              <img src={request.requester.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <User size={18} style={{ color: 'var(--accent-400)' }} />
            )}
          </div>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {request.requester.name}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {request.requester.email}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Requested {formatDate(request.createdAt)}
            </div>
          </div>
        </div>

        {/* Message */}
        {request.message && (
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Message
            </label>
            <p
              className="text-sm rounded-lg px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.07)',
                color: 'var(--text-primary)',
              }}
            >
              {request.message}
            </p>
          </div>
        )}

        {/* Role selector */}
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide mb-2" style={{ color: 'var(--text-muted)' }}>
            Grant Role
          </label>
          <div className="flex gap-2">
            {(['ORG_MEMBER', 'ORG_ADMIN'] as const).map(role => (
              <button
                key={role}
                onClick={() => setGrantedRole(role)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: grantedRole === role ? 'rgba(var(--accent-rgb),0.20)' : 'rgba(255,255,255,0.04)',
                  border: grantedRole === role ? '1px solid rgba(var(--accent-rgb),0.40)' : '1px solid rgba(255,255,255,0.07)',
                  color: grantedRole === role ? 'var(--accent-400)' : 'var(--text-muted)',
                }}
              >
                {role === 'ORG_ADMIN' ? '🛡 Org Admin' : '👤 Org Member'}
              </button>
            ))}
          </div>
        </div>

        {/* Reviewer note */}
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
            Note (optional)
          </label>
          <textarea
            rows={2}
            value={reviewerNote}
            onChange={e => setReviewerNote(e.target.value)}
            placeholder="Visible to the requester…"
            className="w-full resize-none text-sm rounded-xl px-3 py-2"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 justify-end pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={rejectMutation.isPending}
            disabled={isLoading}
            onClick={() => rejectMutation.mutate()}
          >
            Reject
          </Button>
          <Button
            size="sm"
            loading={approveMutation.isPending}
            disabled={isLoading}
            onClick={() => approveMutation.mutate()}
          >
            <ShieldCheck size={13} />
            Approve
          </Button>
        </div>

        {(approveMutation.isError || rejectMutation.isError) && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            Action failed. Please try again.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function OrgAccessRequestsPage() {
  const { activeOrgId } = useAuthStore();
  const orgId = activeOrgId ?? '';
  const [reviewing, setReviewing] = useState<AccessRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery<AccessRequest[]>({
    queryKey: ['org-access-requests', orgId],
    queryFn: () => accessRequestsApi.listOrgRequests(orgId),
    enabled: !!orgId,
  });

  const pending = (requests as AccessRequest[]).filter(r => r.status === 'PENDING');

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Link to="/org" className="inline-flex items-center gap-1 text-xs hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Organisation
      </Link>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(var(--accent-rgb),0.18)' }}
        >
          <ShieldCheck size={16} style={{ color: 'var(--accent-400)' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Access Requests
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Review pending requests to join your organisation
          </p>
        </div>
      </div>

      {/* Pending requests table */}
      {pending.length === 0 ? (
        <div
          className="rounded-2xl p-12 flex flex-col items-center gap-4 text-center"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <Inbox size={36} style={{ color: 'rgba(238,238,248,0.20)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
            No pending access requests
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
        >
          {/* Table header */}
          <div
            className="grid grid-cols-[1fr_auto_auto] items-center px-5 py-3 text-xs font-semibold uppercase tracking-wider"
            style={{
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              color: 'rgba(238,238,248,0.35)',
            }}
          >
            <span>Requester</span>
            <span className="mr-20">Status</span>
            <span>Action</span>
          </div>

          {/* Rows */}
          {pending.map((req, idx) => (
            <div
              key={req.id}
              className="grid grid-cols-[1fr_auto_auto] items-center px-5 py-4"
              style={{
                borderBottom: idx < pending.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
              }}
            >
              {/* User info */}
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: 'rgba(var(--accent-rgb),0.18)' }}
                >
                  {req.requester.avatarUrl ? (
                    <img src={req.requester.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <User size={14} style={{ color: 'var(--accent-400)' }} />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {req.requester.name}
                  </div>
                  <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {req.requester.email}
                  </div>
                  {req.message && (
                    <div className="text-xs mt-0.5 italic truncate" style={{ color: 'rgba(238,238,248,0.35)' }}>
                      "{req.message}"
                    </div>
                  )}
                  <div className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.25)' }}>
                    {formatDate(req.createdAt)}
                  </div>
                </div>
              </div>

              {/* Status badge */}
              <div className="mr-8">
                <Badge variant="warning">Pending</Badge>
              </div>

              {/* Review button */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReviewing(req)}
              >
                Review
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Review modal */}
      {reviewing && (
        <ReviewModal
          request={reviewing}
          orgId={orgId}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  );
}
