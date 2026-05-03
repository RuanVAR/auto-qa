import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink, KeyRound, AlertTriangle } from 'lucide-react';
import { ssoApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? 'http://localhost:3001';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SsoAccount {
  provider: string; // 'google' | 'microsoft'
  email?: string | null;
}

// ── Provider metadata ─────────────────────────────────────────────────────────

const PROVIDERS: { key: string; label: string; icon: string; linkPath: string }[] = [
  { key: 'google',    label: 'Google',    icon: '🔵', linkPath: '/api/v1/auth/google' },
  { key: 'microsoft', label: 'Microsoft', icon: '🟦', linkPath: '/api/v1/auth/microsoft' },
];

// ── Unlink Confirm Modal ──────────────────────────────────────────────────────

function UnlinkConfirmModal({
  provider,
  linkedCount,
  hasPassword,
  onConfirm,
  onClose,
}: {
  provider: string;
  linkedCount: number;
  hasPassword: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isLastMethod = linkedCount <= 1 && !hasPassword;

  return (
    <Modal open onClose={onClose} title={`Unlink ${provider}`} size="sm">
      <div className="space-y-4">
        {isLastMethod ? (
          <div
            className="flex items-start gap-3 p-3 rounded-xl"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: '#f87171' }} />
            <p className="text-sm" style={{ color: '#f87171' }}>
              You must have at least one login method. Set a password before unlinking this account.
            </p>
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Are you sure you want to unlink your <strong style={{ color: 'var(--text-primary)' }}>{provider}</strong> account? You can re-link it at any time.
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            size="sm"
            disabled={isLastMethod}
            onClick={() => { onConfirm(); onClose(); }}
          >
            <Unlink size={12} />
            Unlink
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LinkedAccountsSection() {
  const queryClient = useQueryClient();
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);

  const { data: accounts = [], isLoading } = useQuery<SsoAccount[]>({
    queryKey: ['sso-accounts'],
    queryFn: ssoApi.listAccounts,
  });

  const unlinkMutation = useMutation({
    mutationFn: (provider: string) => ssoApi.unlinkAccount(provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sso-accounts'] }),
  });

  const linkedProviders = new Set((accounts as SsoAccount[]).map(a => a.provider));
  const linkedCount = linkedProviders.size;
  // Assume password exists if no SSO accounts — simplistic heuristic
  const hasPassword = !isLoading && (accounts as SsoAccount[]).length === 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Link2 size={14} style={{ color: 'var(--text-muted)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Linked Accounts
        </h3>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        {/* SSO providers */}
        {PROVIDERS.map((p, idx) => {
          const linked = linkedProviders.has(p.key);
          const account = (accounts as SsoAccount[]).find(a => a.provider === p.key);

          return (
            <div
              key={p.key}
              className="flex items-center justify-between px-5 py-4"
              style={{
                borderBottom: idx < PROVIDERS.length - 1 || true ? '1px solid rgba(255,255,255,0.05)' : undefined,
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{p.icon}</span>
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p.label}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {linked ? (account?.email ?? 'Linked') : 'Not linked'}
                  </div>
                </div>
              </div>

              {linked ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setConfirmUnlink(p.key)}
                  disabled={unlinkMutation.isPending}
                >
                  <Unlink size={12} />
                  Unlink
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { window.location.href = `${API_BASE}${p.linkPath}`; }}
                >
                  <Link2 size={12} />
                  Link
                </Button>
              )}
            </div>
          );
        })}

        {/* Password row */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-lg">🔑</span>
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Password
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                ••••••••
              </div>
            </div>
          </div>
          <a
            href="/settings?section=password"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.80)',
            }}
          >
            <KeyRound size={11} />
            Change password
          </a>
        </div>
      </div>

      {/* Unlink confirm modal */}
      {confirmUnlink && (
        <UnlinkConfirmModal
          provider={PROVIDERS.find(p => p.key === confirmUnlink)?.label ?? confirmUnlink}
          linkedCount={linkedCount}
          hasPassword={hasPassword}
          onConfirm={() => unlinkMutation.mutate(confirmUnlink)}
          onClose={() => setConfirmUnlink(null)}
        />
      )}
    </div>
  );
}
