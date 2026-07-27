import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Loader2,
  Plug,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  embeddingCredentialsApi,
  EmbeddingCredentialUpsert,
  EmbeddingProvider,
  EmbeddingTestResult,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';

const MASKED = '••••••••';

const PROVIDERS: Array<{
  value: EmbeddingProvider;
  label: string;
  defaultModel: string;
  needsBaseUrl?: boolean;
  needsAzure?: boolean;
  keyOptional?: boolean;
}> = [
  {
    value: 'OPENAI',
    label: 'OpenAI',
    defaultModel: 'text-embedding-3-small',
  },
  {
    value: 'GEMINI',
    label: 'Google Gemini',
    defaultModel: 'text-embedding-004',
  },
  {
    value: 'AZURE',
    label: 'Azure OpenAI',
    defaultModel: 'text-embedding-3-small',
    needsBaseUrl: true,
    needsAzure: true,
  },
  {
    value: 'OLLAMA',
    label: 'Ollama',
    defaultModel: 'nomic-embed-text',
    needsBaseUrl: true,
    keyOptional: true,
  },
  {
    value: 'OPENAI_COMPATIBLE',
    label: 'OpenAI-compatible',
    defaultModel: 'text-embedding-3-small',
    needsBaseUrl: true,
  },
];

type EmbeddingForm = EmbeddingCredentialUpsert & { apiKeyDirty: boolean };

export function EmbeddingSettingsSection({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const credential = useQuery({
    queryKey: ['embedding-credential', orgId],
    queryFn: () => embeddingCredentialsApi.get(orgId),
  });
  const [form, setForm] = useState<EmbeddingForm>({
    provider: 'OPENAI',
    model: 'text-embedding-3-small',
    apiKey: '',
    apiKeyDirty: false,
  });
  const [testResult, setTestResult] = useState<EmbeddingTestResult | null>(null);

  useEffect(() => {
    if (!credential.data) return;
    setForm({
      provider: credential.data.provider,
      model: credential.data.model,
      baseUrl: credential.data.baseUrl ?? undefined,
      azureDeployment: credential.data.azureDeployment ?? undefined,
      azureApiVersion: credential.data.azureApiVersion ?? undefined,
      apiKey: credential.data.apiKey ?? '',
      apiKeyDirty: false,
    });
  }, [credential.data]);

  const provider = useMemo(
    () => PROVIDERS.find((item) => item.value === form.provider) ?? PROVIDERS[0],
    [form.provider],
  );
  const payload = (): EmbeddingCredentialUpsert => {
    const { apiKeyDirty, ...values } = form;
    return {
      ...values,
      apiKey: apiKeyDirty && values.apiKey ? values.apiKey : undefined,
    };
  };

  const save = useMutation({
    mutationFn: () => embeddingCredentialsApi.upsert(orgId, payload()),
    onSuccess: (result) => {
      queryClient.setQueryData(['embedding-credential', orgId], result);
      setTestResult({
        ok: true,
        model: result.model,
        dimension: result.dimension,
        latencyMs: 0,
      });
      toast.success('Embedding credential saved');
    },
    onError: (error: unknown) => toast.error(apiMessage(error, 'Save failed')),
  });
  const test = useMutation({
    mutationFn: () => embeddingCredentialsApi.test(orgId, payload()),
    onSuccess: setTestResult,
    onError: (error: unknown) => toast.error(apiMessage(error, 'Test failed')),
  });
  const remove = useMutation({
    mutationFn: () => embeddingCredentialsApi.remove(orgId),
    onSuccess: () => {
      queryClient.setQueryData(['embedding-credential', orgId], null);
      setForm((current) => ({
        ...current,
        apiKey: '',
        apiKeyDirty: false,
      }));
      setTestResult(null);
      toast.success('Embedding credential removed');
    },
  });

  return (
    <Card>
      <CardContent className="space-y-5 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-300" />
              <h2 className="text-sm font-semibold text-white">Code embeddings</h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Used by repository indexing and code retrieval. Anthropic chat credentials cannot generate embeddings.
            </p>
          </div>
          {credential.data && (
            <div className="text-right shrink-0">
              <div className="text-xs font-medium text-emerald-300">{credential.data.dimension} dimensions</div>
              <div className="text-[11px] text-slate-500">{credential.data.model}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Provider">
            <select
              value={form.provider}
              onChange={(event) => {
                const next = PROVIDERS.find((item) => item.value === event.target.value);
                if (!next) return;
                setForm((current) => ({
                  ...current,
                  provider: next.value,
                  model: next.defaultModel,
                  baseUrl: next.value === 'OLLAMA'
                    ? 'http://host.docker.internal:11434'
                    : undefined,
                  azureDeployment: undefined,
                  azureApiVersion: undefined,
                }));
                setTestResult(null);
              }}
              className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
            >
              {PROVIDERS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Embedding model">
            <input
              value={form.model}
              onChange={(event) => setForm((current) => ({
                ...current,
                model: event.target.value,
              }))}
              className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
            />
          </Field>
        </div>

        {provider.needsBaseUrl && (
          <Field label={provider.needsAzure ? 'Azure endpoint URL' : 'Base URL'}>
            <input
              value={form.baseUrl ?? ''}
              onChange={(event) => setForm((current) => ({
                ...current,
                baseUrl: event.target.value,
              }))}
              placeholder={provider.value === 'OLLAMA'
                ? 'http://host.docker.internal:11434'
                : 'https://embeddings.example.com'}
              className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
            />
          </Field>
        )}

        {provider.needsAzure && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Deployment">
              <input
                value={form.azureDeployment ?? ''}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  azureDeployment: event.target.value,
                }))}
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
            <Field label="API version">
              <input
                value={form.azureApiVersion ?? ''}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  azureApiVersion: event.target.value,
                }))}
                placeholder="2024-02-01"
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
          </div>
        )}

        <Field
          label={provider.keyOptional ? 'API key (optional)' : 'API key'}
          hint={form.apiKeyDirty ? 'New key will be encrypted on save.' : 'Leave masked to keep the saved key.'}
        >
          <input
            type="password"
            value={form.apiKey ?? ''}
            onChange={(event) => setForm((current) => ({
              ...current,
              apiKey: event.target.value,
              apiKeyDirty: event.target.value !== MASKED,
            }))}
            className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2 font-mono"
          />
        </Field>

        <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-400">
            Changing provider or model queues a full reindex. The current compatible generation remains searchable until replacement succeeds.
          </p>
        </div>

        {testResult && (
          <div className={`flex items-center gap-2 text-xs ${testResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>
            {testResult.ok
              ? <CheckCircle2 className="w-4 h-4" />
              : <XCircle className="w-4 h-4" />}
            <span>
              {testResult.ok
                ? `${testResult.model} · ${testResult.dimension} dimensions${testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}`
                : testResult.error}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div>
            {credential.data && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (window.confirm('Remove the embedding credential? Repository indexes will be blocked.')) {
                    remove.mutate();
                  }
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
              disabled={!form.model}
            >
              {test.isPending
                ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : <Plug className="w-3.5 h-3.5 mr-1" />}
              Test connection
            </Button>
            <Button
              size="sm"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.model}
            >
              <Save className="w-3.5 h-3.5 mr-1" /> Save
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-300 uppercase tracking-wide block mb-1">
        {label}
      </label>
      {children}
      {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

function apiMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })
    .response?.data?.message;
  return typeof message === 'string' ? message : fallback;
}
