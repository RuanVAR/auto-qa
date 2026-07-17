import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRightLeft, AlertTriangle, CheckCircle2, Building2 } from 'lucide-react';
import { transfersApi, projectsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { errMsg, formatDate } from '@/lib/utils';

type TransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';

type TransferRow = {
  id: string;
  status: TransferStatus;
  message?: string | null;
  decisionNote?: string | null;
  createdAt: string;
  expiresAt: string;
  toOrg: { id: string; name: string };
  requestedBy?: { name: string; email: string } | null;
  reviewedBy?: { name: string; email: string } | null;
};

type Preview = { plan: unknown; impacts: string[] };

const STATUS_VARIANT: Record<TransferStatus, 'warning' | 'success' | 'danger' | 'muted'> = {
  PENDING: 'warning',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'muted',
  EXPIRED: 'muted',
};

/**
 * Sending side of a cross-org project transfer.
 *
 * The org admin cannot browse other organisations — there is no directory — so
 * the only way to name a destination is a transfer code the other org gives
 * them out of band. The flow is deliberately two-step: resolve the code to a
 * name and an impact list first, then commit. Accepting is irreversible from
 * the sender's side, so they should never be guessing what they are handing
 * over.
 */
export function ProjectTransferPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [confirmed, setConfirmed] = useState<{ orgName: string; preview: Preview } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId),
    enabled: !!projectId,
  });

  const { data: transfers = [], isLoading } = useQuery<TransferRow[]>({
    queryKey: ['project-transfers', projectId],
    queryFn: () => transfersApi.listForProject(projectId),
    enabled: !!projectId,
  });

  const pending = transfers.find(t => t.status === 'PENDING');
  const history = transfers.filter(t => t.status !== 'PENDING');

  // A rejected code is an expected answer, not a failure: it resolves to a
  // reason we render inline by the input. Only a genuine request failure
  // (network, 403, 429) reaches onError and warrants a toast.
  const checkMutation = useMutation<
    { ok: true; orgName: string; preview: Preview } | { ok: false; reason: string }
  >({
    mutationFn: async () => {
      const res = await transfersApi.validateCode(projectId, code.trim());
      if (!res.valid) {
        const reasons: Record<string, string> = {
          UNKNOWN_CODE: 'That code does not match any organisation.',
          SAME_ORG: 'That is this project’s own organisation.',
          NOT_ACCEPTING: 'That organisation is not accepting transfers right now.',
        };
        return { ok: false, reason: reasons[res.reason] ?? 'That code is not valid.' };
      }
      // Only fetch the impact once the code is known good — the preview is the
      // expensive half and there is nothing to show without a destination.
      const preview: Preview = await transfersApi.preview(projectId, code.trim());
      return { ok: true, orgName: res.orgName as string, preview };
    },
    onSuccess: (res) => {
      if (res.ok) {
        setCodeError(null);
        setConfirmed({ orgName: res.orgName, preview: res.preview });
      } else {
        setConfirmed(null);
        setCodeError(res.reason);
      }
    },
    onError: (e) => toast.error(errMsg(e, 'Could not check that code')),
  });

  const requestMutation = useMutation({
    mutationFn: () => transfersApi.request(projectId, { code: code.trim(), message: message || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-transfers', projectId] });
      setConfirmed(null);
      setCode('');
      setMessage('');
      toast.success('Transfer requested — the receiving organisation has been notified');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not request the transfer')),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => transfersApi.cancel(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-transfers', projectId] });
      toast.success('Transfer request withdrawn');
    },
    onError: (e) => toast.error(errMsg(e, 'Could not withdraw the request')),
  });

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link
        to={`/projects/${projectId}`}
        className="inline-flex items-center gap-1 text-xs hover:opacity-80"
        style={{ color: 'var(--text-muted)' }}
        data-testid="transfer-back"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Back to project
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
            Transfer project
          </h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Move {project?.name ?? 'this project'} to another organisation
          </p>
        </div>
      </div>

      {pending ? (
        <Card>
          <CardHeader>
            <CardTitle>Transfer pending</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              Waiting for an admin of <strong>{pending.toOrg.name}</strong> to accept. The project
              moves the moment they do.
            </p>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Requested {formatDate(pending.createdAt)}
              {pending.requestedBy ? ` by ${pending.requestedBy.name}` : ''} · expires{' '}
              {formatDate(pending.expiresAt)}
            </div>
            {pending.message && (
              <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
                “{pending.message}”
              </p>
            )}
            <Button
              variant="danger"
              size="sm"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate(pending.id)}
              data-testid="transfer-withdraw"
            >
              Withdraw request
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Send to another organisation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Organisation transfer code
              </label>
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={e => {
                    setCode(e.target.value.toUpperCase());
                    setConfirmed(null);
                    setCodeError(null);
                  }}
                  placeholder="e.g. K7QW2MHT9ZDR"
                  className="flex-1 text-sm rounded-xl px-3 py-2 font-mono tracking-wider"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'var(--text-primary)',
                  }}
                  data-testid="transfer-code-input"
                />
                <Button
                  variant="secondary"
                  loading={checkMutation.isPending}
                  disabled={code.trim().length < 4}
                  onClick={() => checkMutation.mutate()}
                  data-testid="transfer-check-code"
                >
                  Check code
                </Button>
              </div>
              {codeError ? (
                <p className="text-xs mt-1.5" style={{ color: '#f87171' }} data-testid="transfer-code-error">
                  {codeError}
                </p>
              ) : (
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  Ask an admin of the receiving organisation for their code — you will see their name
                  before anything is sent.
                </p>
              )}
            </div>

            {confirmed && (
              <>
                <div
                  className="flex items-center gap-3 p-4 rounded-xl"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.25)',
                  }}
                  data-testid="transfer-destination"
                >
                  <Building2 size={18} style={{ color: '#4ade80' }} />
                  <div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Destination
                    </div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {confirmed.orgName}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle size={13} style={{ color: '#fbbf24' }} />
                    <span
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      If they accept
                    </span>
                  </div>
                  <ul className="space-y-1.5" data-testid="transfer-impacts">
                    {confirmed.preview.impacts.map((impact, i) => (
                      <li
                        key={i}
                        className="text-sm flex gap-2"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        <span style={{ color: 'var(--text-muted)' }}>•</span>
                        {impact}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Message (optional)
                  </label>
                  <textarea
                    rows={2}
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    placeholder="Shown to the receiving organisation’s admins…"
                    className="w-full resize-none text-sm rounded-xl px-3 py-2"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--text-primary)',
                    }}
                    data-testid="transfer-message"
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setConfirmed(null)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    loading={requestMutation.isPending}
                    onClick={() => requestMutation.mutate()}
                    data-testid="transfer-submit"
                  >
                    Request transfer to {confirmed.orgName}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {history.map(t => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 py-2"
                style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}
              >
                <div className="min-w-0">
                  <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    To <strong>{t.toOrg.name}</strong>
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(t.createdAt)}
                    {t.reviewedBy ? ` · reviewed by ${t.reviewedBy.name}` : ''}
                  </div>
                  {t.decisionNote && (
                    <div className="text-xs italic mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      “{t.decisionNote}”
                    </div>
                  )}
                </div>
                <Badge variant={STATUS_VARIANT[t.status]}>{t.status.toLowerCase()}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!pending && history.some(t => t.status === 'ACCEPTED') && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <CheckCircle2 size={12} /> This project has been transferred before.
        </p>
      )}
    </div>
  );
}

export default ProjectTransferPage;
