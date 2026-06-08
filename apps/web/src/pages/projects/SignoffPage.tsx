import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Minus, X, ShieldCheck, Settings, History, Stamp } from 'lucide-react';
import { signoffApi, projectsApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { SignaturePad } from '@/components/signoff/SignaturePad';
import { useAuthStore } from '@/stores/authStore';

type CellState = 'NOT_READY' | 'ELIGIBLE' | 'AWAITING' | 'SIGNED' | 'REJECTED';
interface Cell { state: CellState; signed: number; required: number; completedAt: string | null }
interface FeatureRow { id: string; name: string; cells: Record<string, Cell> }
interface ModuleRow { id: string; name: string; features: FeatureRow[]; rollup: Record<string, { state: 'NONE' | 'ELIGIBLE' | 'SIGNED'; signedAt: string | null }> }
interface Overview {
  project: { id: string; name: string };
  environments: { id: string; name: string; type: string }[];
  progress: { totalCells: number; signedCells: number; perEnv: { environmentId: string; name: string; signed: number; total: number }[] };
  modules: ModuleRow[];
  myPendingCount: number;
  isApprover: boolean;
  canManage: boolean;
}

function CellBadge({ cell, href }: { cell: Cell; href?: string }) {
  const map: Record<CellState, { icon: JSX.Element; cls: string; label: string }> = {
    SIGNED: { icon: <Check className="h-3.5 w-3.5" />, cls: 'bg-green-100 text-green-700 hover:bg-green-200', label: 'Signed' },
    REJECTED: { icon: <X className="h-3.5 w-3.5" />, cls: 'bg-red-100 text-red-700 hover:bg-red-200', label: 'Rejected' },
    AWAITING: { icon: <Clock className="h-3.5 w-3.5" />, cls: 'bg-amber-100 text-amber-700 hover:bg-amber-200', label: `${cell.signed}/${cell.required}` },
    ELIGIBLE: { icon: <ShieldCheck className="h-3.5 w-3.5" />, cls: 'bg-blue-100 text-blue-700 hover:bg-blue-200', label: 'Sign' },
    NOT_READY: { icon: <Minus className="h-3.5 w-3.5" />, cls: 'bg-slate-50 text-slate-300', label: '' },
  };
  const c = map[cell.state];
  const inner = (
    <span className={`inline-flex min-w-[58px] items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${c.cls}`}>
      {c.icon}{c.label}
    </span>
  );
  if (cell.state === 'NOT_READY' || !href) return inner;
  return <Link to={href}>{inner}</Link>;
}

export function SignoffPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [moduleSign, setModuleSign] = useState<{ moduleId: string; moduleName: string; envId: string; envName: string } | null>(null);

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ['signoff-overview', projectId],
    queryFn: () => signoffApi.overview(projectId!),
    enabled: !!projectId,
  });

  if (isLoading || !data) return <div className="p-8 text-slate-500">Loading sign-off…</div>;
  const envs = data.environments;

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sign-off</h1>
          <p className="text-sm text-slate-500">{data.project.name} · feature × environment sign-off matrix</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowHistory(true)}><History className="mr-1 h-4 w-4" /> History</Button>
          {data.canManage && <Button variant="secondary" onClick={() => setShowConfig(true)}><Settings className="mr-1 h-4 w-4" /> Approvers</Button>}
        </div>
      </div>

      {/* Progress */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-6 py-4">
          <div>
            <div className="text-2xl font-bold text-slate-900">{data.progress.signedCells}/{data.progress.totalCells}</div>
            <div className="text-xs uppercase tracking-wide text-slate-400">cells signed</div>
          </div>
          {data.progress.perEnv.map((e) => (
            <div key={e.environmentId}>
              <div className="text-lg font-semibold text-slate-700">{e.signed}/{e.total}</div>
              <div className="text-xs uppercase tracking-wide text-slate-400">{e.name}</div>
            </div>
          ))}
          {data.myPendingCount > 0 && (
            <div className="ml-auto rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              {data.myPendingCount} awaiting your sign-off
            </div>
          )}
        </CardContent>
      </Card>

      {/* Matrix */}
      {data.modules.map((m) => (
        <Card key={m.id}>
          <CardHeader><CardTitle>{m.name}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-4">Feature</th>
                  {envs.map((e) => <th key={e.id} className="pb-2 px-3 text-center">{e.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.features.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100">
                    <td className="py-2 pr-4 font-medium text-slate-700">{f.name}</td>
                    {envs.map((e) => (
                      <td key={e.id} className="px-3 py-2 text-center">
                        <CellBadge cell={f.cells[e.id]} href={`/projects/${projectId}/sign-off/features/${f.id}/environments/${e.id}`} />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* module rollup */}
                <tr className="border-t-2 border-slate-200 bg-slate-50/50">
                  <td className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Module sign-off</td>
                  {envs.map((e) => {
                    const r = m.rollup[e.id];
                    return (
                      <td key={e.id} className="px-3 py-2 text-center">
                        {r.state === 'SIGNED' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700"><Stamp className="h-3.5 w-3.5" /> Signed</span>
                        ) : r.state === 'ELIGIBLE' && data.canManage ? (
                          <button onClick={() => setModuleSign({ moduleId: m.id, moduleName: m.name, envId: e.id, envName: e.name })}
                            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">
                            <Stamp className="h-3.5 w-3.5" /> Sign off
                          </button>
                        ) : r.state === 'ELIGIBLE' ? (
                          <span className="text-xs text-blue-600">Ready</span>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}

      {moduleSign && (
        <ModuleSignoffModal
          {...moduleSign}
          onClose={() => setModuleSign(null)}
          onDone={() => { setModuleSign(null); qc.invalidateQueries({ queryKey: ['signoff-overview', projectId] }); }}
        />
      )}
      {showConfig && <ConfigModal projectId={projectId!} envs={envs} onClose={() => setShowConfig(false)} />}
      {showHistory && <HistoryModal projectId={projectId!} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

// ── Module sign-off modal ─────────────────────────────────────────────────────
function ModuleSignoffModal({ moduleId, moduleName, envId, envName, onClose, onDone }: {
  moduleId: string; moduleName: string; envId: string; envName: string; onClose: () => void; onDone: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [typedName, setTypedName] = useState(me?.name ?? '');
  const [drawn, setDrawn] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => signoffApi.signOffModule(moduleId, envId, { typedName: typedName.trim(), drawnSignature: drawn ?? undefined, note: note.trim() || undefined }),
    onSuccess: () => { toast.success('Module signed off'); onDone(); },
    onError: (e: { response?: { data?: { message?: string } } }) => toast.error(e?.response?.data?.message ?? 'Failed'),
  });
  return (
    <Modal open onClose={onClose} title={`Sign off ${moduleName} · ${envName}`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">All features in this module are signed off in {envName}. Confirm the official module sign-off below.</p>
        <input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Full name"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <SignaturePad onChange={setDrawn} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={typedName.trim().length < 2 || m.isPending} onClick={() => m.mutate()}><Stamp className="mr-1 h-4 w-4" /> Sign off module</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Config modal (approvers per env) ──────────────────────────────────────────
function ConfigModal({ projectId, envs, onClose }: { projectId: string; envs: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: config } = useQuery<{ approvers: { id: string; environmentId: string | null; user: { id: string; name: string } }[] }>({
    queryKey: ['signoff-config', projectId], queryFn: () => signoffApi.getConfig(projectId),
  });
  const { data: members } = useQuery<{ user: { id: string; name: string } }[] | { id: string; name: string }[]>({
    queryKey: ['project-members', projectId], queryFn: () => projectsApi.listMembers(projectId),
  });
  const memberList = (members ?? []).map((m) => ('user' in m ? m.user : m)) as { id: string; name: string }[];
  const [rows, setRows] = useState<{ environmentId: string | null; userId: string }[] | null>(null);
  const current = rows ?? (config?.approvers.map((a) => ({ environmentId: a.environmentId, userId: a.user.id })) ?? []);

  const save = useMutation({
    mutationFn: () => signoffApi.setConfig(projectId, current),
    onSuccess: () => { toast.success('Approvers saved'); qc.invalidateQueries({ queryKey: ['signoff-config', projectId] }); qc.invalidateQueries({ queryKey: ['signoff-overview', projectId] }); onClose(); },
    onError: () => toast.error('Failed to save'),
  });

  const toggle = (environmentId: string | null, userId: string) => {
    const exists = current.some((r) => r.environmentId === environmentId && r.userId === userId);
    setRows(exists ? current.filter((r) => !(r.environmentId === environmentId && r.userId === userId)) : [...current, { environmentId, userId }]);
  };

  return (
    <Modal open onClose={onClose} title="Sign-off approvers">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Select who must sign off per environment. Every selected approver must sign before a feature is signed off (consensus).</p>
        {[{ id: null as string | null, name: 'All environments' }, ...envs].map((env) => (
          <div key={env.id ?? 'all'}>
            <div className="mb-1 text-sm font-semibold text-slate-700">{env.name}</div>
            <div className="flex flex-wrap gap-2">
              {memberList.map((mem) => {
                const on = current.some((r) => r.environmentId === env.id && r.userId === mem.id);
                return (
                  <button key={mem.id} onClick={() => toggle(env.id, mem.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${on ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {mem.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save approvers</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── History modal ─────────────────────────────────────────────────────────────
function HistoryModal({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const { data } = useQuery<{ id: string; type: string; createdAt: string; actor: { name: string } | null; featureName: string | null; moduleName: string | null; environmentName: string | null }[]>({
    queryKey: ['signoff-history', projectId], queryFn: () => signoffApi.history(projectId),
  });
  return (
    <Modal open onClose={onClose} title="Sign-off history">
      <div className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
        {(data ?? []).length === 0 && <p className="text-slate-500">No sign-off activity yet.</p>}
        {(data ?? []).map((e) => (
          <div key={e.id} className="flex items-start gap-2 border-b border-slate-50 py-1.5">
            <span className="text-xs text-slate-400 w-32 shrink-0">{new Date(e.createdAt).toLocaleString()}</span>
            <span>
              <strong className="text-slate-700">{e.type.replace(/_/g, ' ').toLowerCase()}</strong>
              {e.featureName && <> · {e.featureName}</>}{e.moduleName && <> · {e.moduleName}</>}{e.environmentName && <> ({e.environmentName})</>}
              {e.actor && <span className="text-slate-400"> — {e.actor.name}</span>}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
