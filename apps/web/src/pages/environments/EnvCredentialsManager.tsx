import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, Loader2, X } from 'lucide-react';
import { environmentCredentialsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * Manage an environment's named login credentials (Phase 5c). Values are
 * encrypted at rest and never returned by the API — the list shows only the
 * credential name + which field keys it holds. At run time each credential is
 * injected as {{NAME_FIELD}} (e.g. a credential "login" with EMAIL/PASSWORD
 * becomes {{LOGIN_EMAIL}} / {{LOGIN_PASSWORD}}).
 */
export function EnvCredentialsManager({ projectId, envId }: { projectId: string; envId: string }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>([
    { key: 'EMAIL', value: '' },
    { key: 'PASSWORD', value: '' },
  ]);

  const key = ['env-credentials', projectId, envId];
  const { data: creds = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => environmentCredentialsApi.list(projectId, envId),
    enabled: !!envId,
  });

  const reset = () => { setAdding(false); setName(''); setRows([{ key: 'EMAIL', value: '' }, { key: 'PASSWORD', value: '' }]); };

  const save = useMutation({
    mutationFn: () => {
      const fields: Record<string, string> = {};
      for (const { key: k, value } of rows) { if (k.trim()) fields[k.trim()] = value; }
      return environmentCredentialsApi.upsert(projectId, envId, name.trim(), fields);
    },
    onSuccess: () => { toast.success('Credential saved'); qc.invalidateQueries({ queryKey: key }); reset(); },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed';
      toast.error(msg);
    },
  });

  const del = useMutation({
    mutationFn: (n: string) => environmentCredentialsApi.remove(projectId, envId, n),
    onSuccess: () => { toast.success('Credential deleted'); qc.invalidateQueries({ queryKey: key }); },
    onError: () => toast.error('Delete failed'),
  });

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center gap-2 mb-2">
        <KeyRound size={14} className="text-sky-600" />
        <span className="text-xs font-semibold text-gray-700">Login credentials</span>
        <span className="text-[11px] text-gray-400">encrypted · injected as {'{{NAME_FIELD}}'}</span>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 py-2"><Loader2 size={12} className="animate-spin" /> Loading…</div>
      ) : creds.length === 0 && !adding ? (
        <p className="text-xs text-gray-400 py-1">No credentials yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 mb-2">
          {creds.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-gray-50 text-xs">
              <span className="min-w-0">
                <span className="font-mono font-semibold text-gray-700">{c.name}</span>
                <span className="text-gray-400"> · {c.fields.join(', ') || 'no fields'}</span>
              </span>
              <button type="button" onClick={() => del.mutate(c.name)} className="text-gray-400 hover:text-red-500" title="Delete">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-2">
          <input
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs"
            placeholder="Credential name (e.g. login, admin)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className="w-1/3 border border-gray-200 rounded px-2 py-1.5 text-xs font-mono"
                placeholder="FIELD"
                value={r.key}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
              />
              <input
                className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-xs"
                placeholder="value"
                type="password"
                value={r.value}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500">
                <X size={13} />
              </button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])} className="text-[11px] text-sky-600 inline-flex items-center gap-1">
              <Plus size={11} /> Add field
            </button>
            <div className="flex items-center gap-2">
              <button type="button" onClick={reset} className="text-[11px] text-gray-500">Cancel</button>
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending || !name.trim()}
                className="text-[11px] px-2.5 py-1 rounded bg-sky-600 text-white disabled:opacity-50 inline-flex items-center gap-1"
              >
                {save.isPending ? <Loader2 size={11} className="animate-spin" /> : null} Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="text-[11px] text-sky-600 inline-flex items-center gap-1">
          <Plus size={12} /> Add credential
        </button>
      )}
    </div>
  );
}
