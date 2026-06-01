import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink, KeyRound, AlertTriangle } from 'lucide-react';
import { ssoApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useAuthProviders } from '@/hooks/useAuthProviders';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SsoAccount {
  provider: string; // 'google' | 'microsoft'
  email?: string | null;
}

// ── Provider metadata ─────────────────────────────────────────────────────────
//
// Backend stores providers UPPERCASE (`GOOGLE`, `MICROSOFT` — the SsoProvider
// Prisma enum). The list endpoint serialises them as-is. The discovery flag
// keys, by contrast, are lowercase (`google`, `microsoft`). That mismatch is
// why we have BOTH `key` (matches backend record) and `flagKey` (matches
// /auth/config) — they are not interchangeable.

const PROVIDERS: { key: string; flagKey: 'google' | 'microsoft'; label: string; icon: string }[] = [
  { key: 'GOOGLE',    flagKey: 'google',    label: 'Google',    icon: '🔵' },
  { key: 'MICROSOFT', flagKey: 'microsoft', label: 'Microsoft', icon: '🟦' },
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
  const [linking, setLinking] = useState<string | null>(null);
  const { providers: enabledProviders } = useAuthProviders();

  // Surface the result of a link round-trip (?linked / ?linkError) and clear
  // the query params so a refresh doesn't re-toast.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    const linkError = params.get('linkError');
    if (linked) {
      toast.success('Account linked', `Your ${linked} account is now linked.`);
      queryClient.invalidateQueries({ queryKey: ['sso-accounts'] });
    } else if (linkError) {
      toast.error('Linking failed', linkError);
    }
    if (linked || linkError) {
      params.delete('linked'); params.delete('linkError');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, [queryClient]);

  const startLink = async (flagKey: 'google' | 'microsoft') => {
    setLinking(flagKey);
    try {
      const { url } = await ssoApi.startLink(flagKey);
      window.location.href = url;
    } catch {
      toast.error('Could not start linking', 'Please try again.');
      setLinking(null);
    }
  };

  const { data: accounts = [], isLoading } = useQuery<SsoAccount[]>({
    queryKey: ['sso-accounts'],
    queryFn: ssoApi.listAccounts,
  });

  // Only show providers that are BOTH enabled on this deployment AND
  // configured in our PROVIDERS metadata. A provider that's been disabled
  // (env var flipped off) shouldn't offer a "Link" CTA that 404s.
  const visibleProviders = PROVIDERS.filter((p) => enabledProviders[p.flagKey]);

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
        {/* SSO providers — only those enabled on this deployment */}
        {visibleProviders.map((p) => {
          const linked = linkedProviders.has(p.key);
          const account = (accounts as SsoAccount[]).find(a => a.provider === p.key);

          return (
            <div
              key={p.key}
              className="flex items-center justify-between px-5 py-4"
              style={{
                borderBottom: '1px solid rgba(255,255,255,0.05)',
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
                  loading={linking === p.flagKey}
                  disabled={linking !== null}
                  onClick={() => startLink(p.flagKey)}
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
          provider={visibleProviders.find(p => p.key === confirmUnlink)?.label ?? confirmUnlink}
          linkedCount={linkedCount}
          hasPassword={hasPassword}
          onConfirm={() => unlinkMutation.mutate(confirmUnlink)}
          onClose={() => setConfirmUnlink(null)}
        />
      )}
    </div>
  );
}
