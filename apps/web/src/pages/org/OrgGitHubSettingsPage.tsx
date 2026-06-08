import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Github, CheckCircle2, XCircle, Loader2, Save, Trash2, Plug } from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import { githubApi, type GitAuthKind, type GitCredentialUpsert } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * Org-level GitHub credential — the per-organisation config shared by every
 * project. Mirrors the AI-settings page: masked secret with a "keep existing"
 * sentinel, Test connection, Remove. The secret is never returned by the API.
 */
export default function OrgGitHubSettingsPage() {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const qc = useQueryClient();

  const { data: cred, isLoading } = useQuery({
    queryKey: ['git-credential', orgId],
    queryFn: () => githubApi.getCredential(orgId!),
    enabled: !!orgId,
  });

  const [authKind, setAuthKind] = useState<GitAuthKind>('PAT');
  const [token, setToken] = useState('');
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [appInstallationId, setAppInstallationId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');

  // Hydrate the non-secret fields from the saved credential.
  useEffect(() => {
    if (!cred) return;
    setAuthKind(cred.authKind);
    setAppInstallationId(cred.appInstallationId ?? '');
    setBaseUrl(cred.baseUrl ?? '');
  }, [cred?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: () => {
      const body: GitCredentialUpsert = {
        authKind,
        baseUrl: baseUrl.trim() || undefined,
      };
      if (authKind === 'PAT') {
        if (token.trim()) body.token = token.trim();
      } else {
        if (appId.trim()) body.appId = appId.trim();
        if (privateKey.trim()) body.privateKey = privateKey.trim();
        if (appInstallationId.trim()) body.appInstallationId = appInstallationId.trim();
      }
      return githubApi.upsertCredential(orgId!, body);
    },
    onSuccess: (c) => {
      qc.setQueryData(['git-credential', orgId], c);
      setToken('');
      setPrivateKey('');
      c.lastHealthOk
        ? toast.success('GitHub connected', c.connectedAs ? `Connected as ${c.connectedAs}` : undefined)
        : toast.error('Saved, but health check failed', c.lastHealthError ?? undefined);
    },
    onError: (e: unknown) => toast.error('Save failed', errMsg(e)),
  });

  const test = useMutation({
    mutationFn: () => githubApi.testCredential(orgId!),
    onSuccess: (c) => {
      qc.setQueryData(['git-credential', orgId], c);
      c.lastHealthOk
        ? toast.success('Connection healthy', c.connectedAs ? `Connected as ${c.connectedAs}` : undefined)
        : toast.error('Connection failed', c.lastHealthError ?? undefined);
    },
    onError: (e: unknown) => toast.error('Test failed', errMsg(e)),
  });

  const remove = useMutation({
    mutationFn: () => githubApi.removeCredential(orgId!),
    onSuccess: () => {
      qc.setQueryData(['git-credential', orgId], null);
      toast.success('GitHub credential removed');
    },
    onError: (e: unknown) => toast.error('Remove failed', errMsg(e)),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <Link to="/org" className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200">
        <ArrowLeft className="w-4 h-4" /> Back to Organisation
      </Link>

      <div className="flex items-center gap-2">
        <Github className="w-5 h-5 text-purple-300" />
        <h1 className="text-2xl font-semibold text-white">GitHub</h1>
      </div>
      <p className="text-sm text-slate-400 -mt-3">
        One credential for the whole org. Projects link their repos against it (Repositories tab) to power
        deploy automation and codebase-aware AI test generation.
      </p>

      {cred && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
          style={{
            background: cred.lastHealthOk ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
            border: `1px solid ${cred.lastHealthOk ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}
        >
          {cred.lastHealthOk ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-slate-200">
            {cred.lastHealthOk ? `Connected${cred.connectedAs ? ` as ${cred.connectedAs}` : ''}` : 'Not healthy'}
          </span>
          {!cred.lastHealthOk && cred.lastHealthError && (
            <span className="text-red-300/80 text-xs truncate">— {cred.lastHealthError}</span>
          )}
        </div>
      )}

      <Card>
        <CardContent className="space-y-5 py-5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              <Field label="Auth method">
                <div className="flex gap-2">
                  {(['PAT', 'APP'] as GitAuthKind[]).map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setAuthKind(k)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                      style={
                        authKind === k
                          ? { background: 'rgba(var(--accent-rgb),0.22)', color: 'var(--accent-200)', border: '1px solid rgba(var(--accent-rgb),0.45)' }
                          : { color: 'rgba(238,238,248,0.6)', border: '1px solid rgba(255,255,255,0.1)' }
                      }
                    >
                      {k === 'PAT' ? 'Personal Access Token' : 'GitHub App'}
                    </button>
                  ))}
                </div>
              </Field>

              {authKind === 'PAT' ? (
                <Field label="Token" hint={cred?.hasSecret ? 'Saved — leave blank to keep the current token.' : 'Fine-grained or classic PAT with repo:read.'}>
                  <input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={cred?.hasSecret ? '••••••••  (saved)' : 'ghp_…'}
                    className={inputCls}
                  />
                </Field>
              ) : (
                <>
                  <Field label="App ID">
                    <input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="123456" className={inputCls} />
                  </Field>
                  <Field label="Private key (PEM)" hint={cred?.hasSecret ? 'Saved — leave blank to keep the current key.' : 'The .pem private key for your GitHub App.'}>
                    <textarea
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      placeholder={cred?.hasSecret ? '••••••••  (saved)' : '-----BEGIN RSA PRIVATE KEY-----'}
                      rows={3}
                      className={inputCls + ' font-mono text-xs'}
                    />
                  </Field>
                  <Field label="Installation ID" hint="Required to read repos with App auth.">
                    <input value={appInstallationId} onChange={(e) => setAppInstallationId(e.target.value)} placeholder="987654" className={inputCls} />
                  </Field>
                </>
              )}

              <Field label="Base URL" hint="Only for GitHub Enterprise. Leave blank for github.com.">
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://github.acme.com/api/v3" className={inputCls} />
              </Field>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                <div>
                  {cred && (
                    <Button variant="ghost" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
                      <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  {cred && (
                    <Button variant="ghost" size="sm" onClick={() => test.mutate()} loading={test.isPending} disabled={!orgId}>
                      <Plug className="w-3.5 h-3.5 mr-1" /> Test connection
                    </Button>
                  )}
                  <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!orgId}>
                    <Save className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const inputCls =
  'block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function errMsg(e: unknown): string | undefined {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' ? m : undefined;
}
