import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Copy, Check, RefreshCw, Trash2, Loader, AlertTriangle, BookOpen } from 'lucide-react';
import { apiTokensApi, API_BASE, type ApiToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';

/**
 * Personal access tokens for the MCP server + direct API access. The plaintext
 * `qapt_…` is shown exactly once (on create / regenerate); afterwards only the
 * non-secret prefix + usage metadata are visible.
 */
export function ApiTokensSection() {
  const qc = useQueryClient();
  const { data: tokens = [], isLoading } = useQuery({ queryKey: ['api-tokens'], queryFn: apiTokensApi.list });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<number | ''>(90);
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['api-tokens'] });

  const create = useMutation({
    mutationFn: () => apiTokensApi.create({ name: name.trim(), expiresInDays: expiry === '' ? null : expiry }),
    onSuccess: (r) => { invalidate(); setRevealed({ token: r.token, name: r.record.name }); setCreating(false); setName(''); },
    onError: (e: unknown) => toast.error('Could not create token', errMsg(e)),
  });
  const regenerate = useMutation({
    mutationFn: (id: string) => apiTokensApi.regenerate(id),
    onSuccess: (r) => { invalidate(); setRevealed({ token: r.token, name: r.record.name }); },
    onError: (e: unknown) => toast.error('Could not regenerate token', errMsg(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiTokensApi.revoke(id),
    onSuccess: () => { invalidate(); toast.success('Token revoked'); },
    onError: (e: unknown) => toast.error('Could not revoke token', errMsg(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-gray-500">
          Tokens let your AI tools (Claude Code, Cursor) and scripts reach the platform via the MCP server with
          <strong> your own access</strong>. Treat them like passwords.
        </p>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          <BookOpen size={13} /> How to connect &amp; test
        </button>
      </div>

      <McpGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {revealed && <RevealPanel token={revealed.token} name={revealed.name} onDone={() => setRevealed(null)} />}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500"><Loader size={14} className="animate-spin" /> Loading…</div>
      ) : tokens.length === 0 && !creating ? (
        <p className="text-sm text-gray-500">No tokens yet.</p>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <TokenRow key={t.id} t={t}
              onRegenerate={() => { if (confirm(`Regenerate "${t.name}"? The current token stops working immediately.`)) regenerate.mutate(t.id); }}
              onRevoke={() => { if (confirm(`Revoke "${t.name}"? This cannot be undone.`)) revoke.mutate(t.id); }}
              busy={regenerate.isPending || revoke.isPending}
            />
          ))}
        </div>
      )}

      {creating ? (
        <div className="rounded-lg border border-gray-200 p-3 space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <label className="flex-1 text-xs font-medium text-gray-500">
              Name
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Cursor on my laptop"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500" />
            </label>
            <label className="text-xs font-medium text-gray-500">
              Expires
              <select value={expiry} onChange={(e) => setExpiry(e.target.value === '' ? '' : Number(e.target.value))}
                className="mt-1 block rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={365}>1 year</option>
                <option value="">Never</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => { setCreating(false); setName(''); }}>Cancel</Button>
            <Button size="sm" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>
              {create.isPending ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />} Create token
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setCreating(true)}><Plus size={13} /> New token</Button>
      )}
    </div>
  );
}

function TokenRow({ t, onRegenerate, onRevoke, busy }: { t: ApiToken; onRegenerate: () => void; onRevoke: () => void; busy: boolean }) {
  const chip = t.status === 'active'
    ? 'bg-emerald-50 text-emerald-700'
    : t.status === 'expired' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500';
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
      <KeyRound size={16} className="text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-700 truncate">{t.name}</p>
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${chip}`}>{t.status}</span>
        </div>
        <p className="text-xs text-gray-400">
          <code className="font-mono">{t.prefix}…</code>
          {' · '}{t.lastUsedAt ? `last used ${timeAgo(t.lastUsedAt)}${t.lastUsedIp ? ` from ${t.lastUsedIp}` : ''}` : 'never used'}
          {' · '}{t.expiresAt ? `expires ${fmtDate(t.expiresAt)}` : 'no expiry'}
        </p>
      </div>
      {t.status !== 'revoked' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onRegenerate} disabled={busy} title="Regenerate" className="text-xs text-gray-500 hover:text-gray-700 px-1.5 py-1 rounded hover:bg-gray-50 disabled:opacity-50"><RefreshCw size={13} /></button>
          <button onClick={onRevoke} disabled={busy} title="Revoke" className="text-xs text-red-600 hover:text-red-700 px-1.5 py-1 rounded hover:bg-red-50 disabled:opacity-50"><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

function RevealPanel({ token, name, onDone }: { token: string; name: string; onDone: () => void }) {
  const url = mcpUrl();
  const config = JSON.stringify({ mcpServers: { 'qa-platform': { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
        <AlertTriangle size={15} /> Copy your token for "{name}" now — you won't see it again
      </div>
      <CopyField label="Token" value={token} mono />
      <CopyField label="MCP client config (Claude Code / Cursor)" value={config} mono multiline />
      <div className="flex justify-end">
        <Button size="sm" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function CopyField({ label, value, mono, multiline }: { label: string; value: string; mono?: boolean; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ } };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-amber-800/80 uppercase tracking-wide">{label}</span>
        <button onClick={copy} className="text-xs flex items-center gap-1 text-amber-800 hover:text-amber-900">
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      {multiline ? (
        <pre className={`text-[11px] bg-white border border-amber-200 rounded p-2 overflow-x-auto ${mono ? 'font-mono' : ''}`}>{value}</pre>
      ) : (
        <div className={`text-xs bg-white border border-amber-200 rounded px-2 py-1.5 break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
      )}
    </div>
  );
}

function McpGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = mcpUrl();
  const claudeCmd = `claude mcp add --transport http qa-platform \\\n  ${url} \\\n  --header "Authorization: Bearer qapt_YOUR_TOKEN"`;
  const jsonCfg = JSON.stringify(
    { mcpServers: { 'qa-platform': { url, headers: { Authorization: 'Bearer qapt_YOUR_TOKEN' } } } },
    null, 2,
  );
  const connDetails = `Transport: Streamable HTTP\nURL:       ${url}\nHeader:    Authorization: Bearer qapt_YOUR_TOKEN`;
  return (
    <Modal open={open} onClose={onClose} title="Connect an MCP client" size="lg">
      <div className="space-y-5 text-sm text-slate-300">
        <p className="text-xs text-slate-400">
          Works with <strong className="text-slate-200">any MCP client</strong> that speaks Streamable HTTP — Claude Code,
          Cursor, Claude Desktop, Windsurf, VS Code, and others. The client's AI agent can then read your tests, features,
          docs and acceptance criteria — and create/update them or trigger runs — all with <strong className="text-slate-200">your</strong> access,
          audited under your account.
        </p>

        <Step n={1} title="Create a token">
          Use <strong className="text-slate-200">New token</strong> above. Copy the <Inline>qapt_…</Inline> value
          shown once — you'll paste it below in place of <Inline>qapt_YOUR_TOKEN</Inline>.
        </Step>

        <Step n={2} title="Add the server to your client">
          <div className="space-y-3 mt-1">
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Config JSON — Cursor, Claude Desktop, Windsurf, VS Code, …</div>
              <CopyCode value={jsonCfg} />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Or enter the connection details manually</div>
              <CopyCode value={connDetails} />
            </div>
            <div>
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Claude Code — one-line CLI</div>
              <CopyCode value={claudeCmd} />
            </div>
          </div>
        </Step>

        <Step n={3} title="Verify it connected">
          <p className="text-xs text-slate-400">
            Your client should list <Inline>qa-platform</Inline> as connected, and the platform tools
            (<Inline>list_projects</Inline>, <Inline>get_feature_context</Inline>, …) become available — then ask your agent
            something like <em>"list my QA projects"</em> or <em>"show the test context for feature X"</em>. (In Claude Code,
            run <Inline>claude mcp list</Inline> to confirm.)
          </p>
        </Step>

        <p className="text-[11px] text-slate-500 border-t border-white/10 pt-3">
          Tools are scoped to projects you can access. Revoke a token any time above — the connection stops immediately.
          The server URL is <Inline>{url}</Inline>.
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  );
}

function Inline({ children }: { children: React.ReactNode }) {
  return <code className="bg-white/10 text-slate-200 px-1 py-0.5 rounded text-[0.95em] font-mono">{children}</code>;
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full bg-purple-500/20 text-purple-300 text-xs font-semibold flex items-center justify-center">{n}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-100">{title}</div>
        <div className="text-xs text-slate-400 mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function CopyCode({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ } };
  return (
    <div className="relative group">
      <pre className="text-[11px] font-mono bg-slate-950/60 border border-white/10 text-slate-200 rounded-md p-2.5 pr-9 overflow-x-auto whitespace-pre">{value}</pre>
      <button onClick={copy} title="Copy" className="absolute top-1.5 right-1.5 text-slate-400 hover:text-white p-1 rounded">
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** MCP endpoint URL — derived from VITE_API_URL (the same base the app uses for
 *  every API call), so it reflects the real public server URL set at prod build
 *  time. Falls back to the current origin if VITE_API_URL is unset. */
function mcpUrl(): string {
  const base = (API_BASE || window.location.origin).replace(/\/+$/, '');
  return `${base}/api/v1/mcp`;
}

function errMsg(e: unknown): string | undefined {
  const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof m === 'string' ? m : undefined;
}
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
}
