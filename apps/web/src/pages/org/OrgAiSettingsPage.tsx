import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles,
  Save,
  Plug,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  ExternalLink,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import {
  aiCredentialsApi,
  type AiCredentialUpsert,
  type AiProvider,
  type AiTestResult,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';
import { EmbeddingSettingsSection } from '@/components/ai/EmbeddingSettingsSection';

/**
 * Org admin → AI BYOK page.
 *
 * Stores one credential per org (provider + model + encrypted API key +
 * monthly cap + per-user rate limit). The plaintext key never round-trips
 * to the browser after save — re-entering the masked sentinel field is
 * how the user signals "keep existing key" on subsequent saves.
 */

// Provider catalogue. Display labels + the per-provider model dropdown.
// Pricing labels are best-effort; the backend calculator is authoritative
// for actual billed amounts. Keep in lockstep with cost-calculator.service.ts.
const PROVIDERS: Array<{
  value: AiProvider;
  label: string;
  helpUrl?: string;
  models: Array<{ id: string; label: string; price?: string }>;
  needsBaseUrl?: boolean;
  needsAzure?: boolean;
  recommended?: boolean;
}> = [
  {
    value: 'GEMINI',
    label: 'Google Gemini',
    helpUrl: 'https://aistudio.google.com/app/apikey',
    recommended: true,
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (cheapest)', price: '$0.075 / $0.30 per M' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', price: '$1.25 / $5.00 per M' },
    ],
  },
  {
    value: 'OPENAI',
    label: 'OpenAI',
    helpUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', price: '$0.15 / $0.60 per M' },
      { id: 'gpt-4o', label: 'GPT-4o', price: '$2.50 / $10.00 per M' },
    ],
  },
  {
    value: 'ANTHROPIC',
    label: 'Anthropic Claude',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'claude-haiku-4-20250514', label: 'Claude Haiku 4', price: '$0.80 / $4.00 per M' },
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', price: '$3.00 / $15.00 per M' },
    ],
  },
  {
    value: 'AZURE',
    label: 'Azure OpenAI',
    needsAzure: true,
    models: [
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini (deployment name)' },
      { id: 'gpt-4o', label: 'gpt-4o (deployment name)' },
    ],
  },
  {
    value: 'OLLAMA',
    label: 'Ollama (self-hosted)',
    needsBaseUrl: true,
    models: [
      { id: 'llama3', label: 'llama3 (free, local)' },
      { id: 'llama3.1', label: 'llama3.1 (free, local)' },
    ],
  },
  {
    value: 'OPENAI_COMPATIBLE',
    label: 'OpenAI-compatible (vLLM / LM Studio / etc.)',
    needsBaseUrl: true,
    models: [{ id: 'local-model', label: 'local-model (custom)' }],
  },
];

const MASKED = '••••••••';

export default function OrgAiSettingsPage() {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const credQ = useQuery({
    queryKey: ['ai-credential', orgId],
    queryFn: () => aiCredentialsApi.get(orgId!),
    enabled: !!orgId,
  });

  const spendQ = useQuery({
    queryKey: ['ai-spend', orgId],
    queryFn: () => aiCredentialsApi.spend(orgId!),
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  // Form state. Hydrated from credQ on load; the masked sentinel for
  // apiKey signals "keep existing" if the user clicks Save without
  // re-typing the key.
  const [form, setForm] = useState<AiCredentialUpsert & { apiKeyDirty: boolean }>({
    provider: 'GEMINI',
    model: 'gemini-2.0-flash',
    apiKey: '',
    maxTokens: 4000,
    monthlyCapUsd: 50,
    rateLimitPerUserPerHour: 20,
    apiKeyDirty: false,
  });

  useEffect(() => {
    const c = credQ.data;
    if (!c) return;
    setForm({
      provider: c.provider,
      model: c.model,
      apiKey: c.apiKey ?? '',
      maxTokens: c.maxTokens,
      monthlyCapUsd: c.monthlyCapUsd,
      rateLimitPerUserPerHour: c.rateLimitPerUserPerHour,
      baseUrl: c.baseUrl ?? undefined,
      azureInstance: c.azureInstance ?? undefined,
      azureDeployment: c.azureDeployment ?? undefined,
      azureApiVersion: c.azureApiVersion ?? undefined,
      apiKeyDirty: false,
    });
  }, [credQ.data]);

  const providerCfg = PROVIDERS.find((p) => p.value === form.provider) ?? PROVIDERS[0];

  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const { apiKeyDirty, ...payload } = form;
      return aiCredentialsApi.upsert(orgId!, {
        ...payload,
        // Drop the apiKey field entirely when the user hasn't touched it,
        // so the backend preserves the existing encrypted value.
        apiKey: apiKeyDirty && payload.apiKey ? payload.apiKey : undefined,
      });
    },
    onSuccess: () => {
      toast.success('AI credential saved');
      qc.invalidateQueries({ queryKey: ['ai-credential', orgId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    },
  });

  const test = useMutation({
    mutationFn: () => {
      const { apiKeyDirty, ...payload } = form;
      return aiCredentialsApi.test(orgId!, {
        ...payload,
        apiKey: apiKeyDirty && payload.apiKey ? payload.apiKey : undefined,
      });
    },
    onSuccess: (r) => setTestResult(r),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Test failed');
    },
  });

  const remove = useMutation({
    mutationFn: () => aiCredentialsApi.remove(orgId!),
    onSuccess: () => {
      toast.success('AI credential removed');
      qc.invalidateQueries({ queryKey: ['ai-credential', orgId] });
      setForm((p) => ({ ...p, apiKey: '', apiKeyDirty: false }));
      setTestResult(null);
    },
  });

  if (!orgId) {
    return (
      <div className="text-sm text-slate-400">Pick an organisation to configure its AI credential.</div>
    );
  }

  const spend = spendQ.data;
  const spendPct = spend && form.monthlyCapUsd
    ? Math.min(100, Math.round((spend.totalUsd / form.monthlyCapUsd) * 100))
    : 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-baseline justify-between">
        <div>
          <Link to="/org" className="inline-flex items-center text-xs text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-3 h-3 mr-1" /> Organisation
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <Sparkles className="w-5 h-5 text-purple-300" />
            <h1 className="text-2xl font-semibold text-white">AI</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Bring your own key for AI generation. The API key is encrypted at rest (AES-256-GCM)
            and never returned in any response — only test calls and the configured provider see it.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-5 py-5">
          {/* Provider radio group */}
          <div>
            <label className="text-xs font-medium text-slate-300 uppercase tracking-wide">Provider</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {PROVIDERS.map((p) => {
                const active = form.provider === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() =>
                      setForm((s) => ({
                        ...s,
                        provider: p.value,
                        model: p.models[0]?.id ?? '',
                      }))
                    }
                    className="text-left rounded-lg p-3 transition-all"
                    style={{
                      background: active ? 'rgba(var(--accent-rgb),0.10)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${active ? 'rgba(var(--accent-rgb),0.40)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <Plug className={`w-3.5 h-3.5 ${active ? 'text-purple-300' : 'text-slate-400'}`} />
                      <span className="text-sm font-medium text-slate-100">{p.label}</span>
                      {p.recommended && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-200 uppercase tracking-wide">
                          recommended
                        </span>
                      )}
                    </div>
                    {p.helpUrl && (
                      <a
                        href={p.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[11px] text-slate-400 hover:text-slate-200 mt-1 inline-flex items-center gap-1"
                      >
                        Get key <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model picker */}
          <Field label="Model">
            <select
              value={form.model}
              onChange={(e) => setForm((s) => ({ ...s, model: e.target.value }))}
              className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
            >
              {providerCfg.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.price ? ` — ${m.price}` : ''}
                </option>
              ))}
            </select>
          </Field>

          {/* API key */}
          {!providerCfg.needsBaseUrl || providerCfg.value === 'OPENAI_COMPATIBLE' ? (
            <Field label="API key" hint={form.apiKeyDirty ? 'New key will be encrypted on save.' : 'Leave masked to keep existing key.'}>
              <input
                type="password"
                value={form.apiKey ?? ''}
                onChange={(e) =>
                  setForm((s) => ({ ...s, apiKey: e.target.value, apiKeyDirty: e.target.value !== MASKED }))
                }
                placeholder={providerCfg.value === 'OPENAI_COMPATIBLE' ? 'optional' : 'sk-…'}
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2 font-mono"
              />
            </Field>
          ) : null}

          {/* Azure-specific */}
          {providerCfg.needsAzure && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Endpoint URL or instance" hint='e.g. "my-company"'>
                <input
                  value={form.azureInstance ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, azureInstance: e.target.value }))}
                  className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
                />
              </Field>
              <Field label="Deployment name">
                <input
                  value={form.azureDeployment ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, azureDeployment: e.target.value }))}
                  className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
                />
              </Field>
              <Field label="API version" hint="default 2024-05-01-preview">
                <input
                  value={form.azureApiVersion ?? ''}
                  onChange={(e) => setForm((s) => ({ ...s, azureApiVersion: e.target.value }))}
                  className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
                />
              </Field>
              <Field label="API key">
                <input
                  type="password"
                  value={form.apiKey ?? ''}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, apiKey: e.target.value, apiKeyDirty: e.target.value !== MASKED }))
                  }
                  className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2 font-mono"
                />
              </Field>
            </div>
          )}

          {/* Self-hosted base URL */}
          {providerCfg.needsBaseUrl && !providerCfg.needsAzure && (
            <Field
              label="Base URL"
              hint={providerCfg.value === 'OLLAMA' ? 'default http://localhost:11434' : 'e.g. http://localhost:8000/v1'}
            >
              <input
                value={form.baseUrl ?? ''}
                onChange={(e) => setForm((s) => ({ ...s, baseUrl: e.target.value }))}
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
          )}

          {/* Quotas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Max tokens / call">
              <input
                type="number"
                min={64}
                max={32_000}
                value={form.maxTokens ?? 4000}
                onChange={(e) => setForm((s) => ({ ...s, maxTokens: Number(e.target.value) }))}
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
            <Field label="Monthly cap (USD)">
              <input
                type="number"
                min={1}
                step={1}
                value={form.monthlyCapUsd ?? 50}
                onChange={(e) => setForm((s) => ({ ...s, monthlyCapUsd: Number(e.target.value) }))}
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
            <Field label="Per-user per-hour limit">
              <input
                type="number"
                min={1}
                step={1}
                value={form.rateLimitPerUserPerHour ?? 20}
                onChange={(e) =>
                  setForm((s) => ({ ...s, rateLimitPerUserPerHour: Number(e.target.value) }))
                }
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className="rounded-lg p-3 text-xs"
              style={{
                background: testResult.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${testResult.ok ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
              }}
            >
              <div className="flex items-center gap-2 text-slate-100">
                {testResult.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <strong>{testResult.ok ? 'Connected' : 'Failed'}</strong>
                <span className="text-slate-400">— {testResult.model} · {testResult.latencyMs}ms</span>
                {testResult.ok && (
                  <span className="text-slate-400">· ${testResult.costUsd.toFixed(6)} for this call</span>
                )}
              </div>
              {testResult.error && (
                <div className="text-slate-400 mt-1 font-mono break-all">{testResult.error}</div>
              )}
              {testResult.sampleResponse && (
                <div className="text-slate-400 mt-1 italic">"{testResult.sampleResponse}"</div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
            <div>
              {credQ.data && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (window.confirm('Remove the AI credential for this organisation?')) remove.mutate();
                  }}
                  loading={remove.isPending}
                  className="text-red-300 hover:text-red-200"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Remove
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => test.mutate()}
                loading={test.isPending}
                disabled={!form.provider || !form.model}
              >
                {test.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plug className="w-3.5 h-3.5 mr-1" />}
                Test connection
              </Button>
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>
                <Save className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <EmbeddingSettingsSection orgId={orgId} />

      {/* Spend rollup */}
      <Card>
        <CardContent className="py-5">
          <h2 className="text-sm font-semibold text-white mb-3">This month&rsquo;s spend</h2>
          {!spend ? (
            <div className="text-xs text-slate-500">No data yet.</div>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-white">${spend.totalUsd.toFixed(4)}</span>
                <span className="text-xs text-slate-400">/ ${form.monthlyCapUsd?.toFixed(2) ?? '—'}</span>
                <span className="text-xs text-slate-500 ml-1">· {spend.callCount} calls · {spend.month}</span>
              </div>
              <div
                className="h-2 rounded-full mt-3 overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${spendPct}%`,
                    background:
                      spendPct >= 100
                        ? 'rgba(239,68,68,0.7)'
                        : spendPct >= 80
                        ? 'rgba(245,158,11,0.7)'
                        : 'rgba(var(--accent-rgb),0.7)',
                  }}
                />
              </div>
              {spendPct >= 80 && (
                <div className="text-xs text-amber-400 mt-2 inline-flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {spendPct}% of monthly cap consumed.
                </div>
              )}
              {Object.keys(spend.byPurpose).length > 0 && (
                <table className="text-xs text-slate-300 mt-4 w-full">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left font-medium pb-1">Purpose</th>
                      <th className="text-right font-medium pb-1">Spend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(spend.byPurpose).map(([k, v]) => (
                      <tr key={k} className="border-t border-white/5">
                        <td className="py-1">{k}</td>
                        <td className="py-1 text-right font-mono">${v.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-300 uppercase tracking-wide block mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}
