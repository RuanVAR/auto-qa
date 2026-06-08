import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Minus, X, ShieldCheck, Settings, History, Stamp, ChevronDown } from 'lucide-react';
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

// ── theme tokens ──────────────────────────────────────────────────────────────
const TXT = 'var(--text-primary)';
const TXT2 = 'rgba(238,238,248,0.60)';
const TXT3 = 'rgba(238,238,248,0.40)';
// Needs sign-off (eligible / awaiting / rejected) → red; signed → green; not
// 100% passed yet → muted grey.
const RED: React.CSSProperties = { background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.30)' };
const PILL: Record<CellState, React.CSSProperties> = {
  SIGNED:    { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.30)' },
  REJECTED:  RED,
  AWAITING:  RED,
  ELIGIBLE:  RED,
  NOT_READY: { background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.30)', border: '1px solid rgba(255,255,255,0.06)' },
};

function CellBadge({ cell, href }: { cell: Cell; href?: string }) {
  const icon: Record<CellState, JSX.Element> = {
    SIGNED: <Check className="h-3.5 w-3.5" />, REJECTED: <X className="h-3.5 w-3.5" />,
    AWAITING: <Clock className="h-3.5 w-3.5" />, ELIGIBLE: <ShieldCheck className="h-3.5 w-3.5" />,
    NOT_READY: <Minus className="h-3.5 w-3.5" />,
  };
  const label = cell.state === 'SIGNED' ? 'Signed' : cell.state === 'REJECTED' ? 'Rejected'
    : cell.state === 'AWAITING' ? `${cell.signed}/${cell.required}` : cell.state === 'ELIGIBLE' ? 'Sign' : '';
  const inner = (
    <span className="inline-flex min-w-[58px] items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={PILL[cell.state]}>
      {icon[cell.state]}{label}
    </span>
  );
  if (cell.state === 'NOT_READY' || !href) return inner;
  return <Link to={href} className="transition-opacity hover:opacity-80">{inner}</Link>;
}

export function SignoffPage() {
  const { projectId } = useParams();
  const qc = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [moduleSign, setModuleSign] = useState<{ moduleId: string; moduleName: string; envId: string; envName: string } | null>(null);
  const [filter, setFilter] = useState<'all' | 'signed' | 'unsigned'>('all');

  const { data, isLoading } = useQuery<Overview>({
    queryKey: ['signoff-overview', projectId],
    queryFn: () => signoffApi.overview(projectId!),
    enabled: !!projectId,
  });

  if (isLoading || !data) return <div className="p-8" style={{ color: TXT2 }}>Loading sign-off…</div>;
  const envs = data.environments;

  // Status filter: a feature is "signed off" when every applicable cell is
  // SIGNED (and at least one is); "needs sign-off" when any cell is eligible /
  // awaiting / rejected. In "all" mode keep every module (incl. ones with only
  // a module-rollup and no feature rows).
  const isSigned = (f: FeatureRow) => {
    const cells = envs.map((e) => f.cells[e.id]).filter(Boolean);
    return cells.length > 0 && cells.every((c) => c.state === 'SIGNED' || c.state === 'NOT_READY') && cells.some((c) => c.state === 'SIGNED');
  };
  const needsSignoff = (f: FeatureRow) => envs.some((e) => ['ELIGIBLE', 'AWAITING', 'REJECTED'].includes(f.cells[e.id]?.state));
  const matchFilter = (f: FeatureRow) => filter === 'all' ? true : filter === 'signed' ? isSigned(f) : needsSignoff(f);
  const modules = filter === 'all'
    ? data.modules
    : data.modules.map((m) => ({ ...m, features: m.features.filter(matchFilter) })).filter((m) => m.features.length > 0);

  const sep = <span style={{ color: 'rgba(238,238,248,0.25)' }}>/</span>;
  const FILTERS: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'unsigned', label: 'Needs sign-off' }, { key: 'signed', label: 'Signed off' },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm" style={{ color: TXT2 }}>
        <Link to="/projects" className="transition-opacity hover:opacity-80">Projects</Link>
        {sep}
        <Link to={`/projects/${projectId}`} className="transition-opacity hover:opacity-80">{data.project.name}</Link>
        {sep}
        <span style={{ color: 'rgba(238,238,248,0.82)' }}>Sign-off</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: TXT }}>Sign-off</h1>
          <p className="text-sm" style={{ color: TXT2 }}>{data.project.name} · feature × environment sign-off matrix</p>
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
            <div className="text-2xl font-bold" style={{ color: TXT }}>{data.progress.signedCells}/{data.progress.totalCells}</div>
            <div className="text-xs uppercase tracking-wide" style={{ color: TXT3 }}>cells signed</div>
          </div>
          {data.progress.perEnv.map((e) => (
            <div key={e.environmentId}>
              <div className="text-lg font-semibold" style={{ color: 'rgba(238,238,248,0.82)' }}>{e.signed}/{e.total}</div>
              <div className="text-xs uppercase tracking-wide" style={{ color: TXT3 }}>{e.name}</div>
            </div>
          ))}
          {data.myPendingCount > 0 && (
            <div className="ml-auto rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.25)' }}>
              {data.myPendingCount} awaiting your sign-off
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status filter */}
      <div className="flex items-center gap-1 rounded-lg p-1 w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
            style={filter === f.key ? { background: 'var(--accent)', color: '#fff' } : { color: TXT2, background: 'transparent' }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Matrix */}
      {modules.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm"><span style={{ color: TXT2 }}>No features match this filter.</span></CardContent></Card>
      ) : modules.map((m) => (
        <Card key={m.id}>
          <CardHeader><CardTitle>{m.name}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                {envs.map((e) => <col key={e.id} style={{ width: 150 }} />)}
              </colgroup>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: TXT3 }}>
                  <th className="pb-2 pr-4">Feature</th>
                  {envs.map((e) => <th key={e.id} className="pb-2 px-3 text-center">{e.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {m.features.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td className="py-2 pr-4 font-medium truncate" style={{ color: 'rgba(238,238,248,0.82)' }} title={f.name}>{f.name}</td>
                    {envs.map((e) => (
                      <td key={e.id} className="px-3 py-2 text-center">
                        <CellBadge cell={f.cells[e.id]} href={`/projects/${projectId}/sign-off/features/${f.id}/environments/${e.id}`} />
                      </td>
                    ))}
                  </tr>
                ))}
                {/* module rollup */}
                <tr style={{ borderTop: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}>
                  <td className="py-2 pr-4 text-xs font-semibold uppercase tracking-wide" style={{ color: TXT2 }}>Module sign-off</td>
                  {envs.map((e) => {
                    const r = m.rollup[e.id];
                    return (
                      <td key={e.id} className="px-3 py-2 text-center">
                        {r.state === 'SIGNED' ? (
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium" style={PILL.SIGNED}><Stamp className="h-3.5 w-3.5" /> Signed</span>
                        ) : r.state === 'ELIGIBLE' && data.canManage ? (
                          <button onClick={() => setModuleSign({ moduleId: m.id, moduleName: m.name, envId: e.id, envName: e.name })}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-opacity hover:opacity-90"
                            style={{ background: 'var(--accent)', color: '#fff' }}>
                            <Stamp className="h-3.5 w-3.5" /> Sign off
                          </button>
                        ) : r.state === 'ELIGIBLE' ? (
                          <span className="text-xs" style={{ color: '#a78bfa' }}>Ready</span>
                        ) : <span className="text-xs" style={{ color: TXT3 }}>—</span>}
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

const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' };

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
        <p className="text-sm" style={{ color: TXT2 }}>All features in this module are signed off in {envName}. Confirm the official module sign-off below.</p>
        <input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="Full name"
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
        <SignaturePad onChange={setDrawn} />
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note (optional)"
          className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={typedName.trim().length < 2 || m.isPending} onClick={() => m.mutate()}><Stamp className="mr-1 h-4 w-4" /> Sign off module</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Multi-select dropdown (scales with many members) ──────────────────────────
function ApproverMultiSelect({ members, selectedIds, onToggle }: {
  members: { id: string; name: string }[]; selectedIds: string[]; onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const selected = members.filter((m) => selectedIds.includes(m.id));
  const filtered = members.filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((o) => !o)} className="flex min-h-[40px] flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer" style={inputStyle}>
        {selected.length === 0 && <span className="text-sm" style={{ color: TXT3 }}>Select approvers…</span>}
        {selected.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
            style={{ background: 'rgba(124,58,237,0.20)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.32)' }}>
            {m.name}
            <button onClick={(e) => { e.stopPropagation(); onToggle(m.id); }} className="transition-opacity hover:opacity-70"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0" style={{ color: TXT3 }} />
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg shadow-xl" style={{ background: '#14141c', border: '1px solid rgba(255,255,255,0.12)' }}>
          <div className="p-2">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…"
              className="w-full rounded-md px-2 py-1.5 text-sm focus:outline-none" style={inputStyle} />
          </div>
          <div className="max-h-56 overflow-y-auto pb-1">
            {filtered.length === 0 && <div className="px-3 py-2 text-sm" style={{ color: TXT3 }}>No members</div>}
            {filtered.map((m) => {
              const on = selectedIds.includes(m.id);
              return (
                <button key={m.id} onClick={() => onToggle(m.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-white/5" style={{ color: 'rgba(238,238,248,0.82)' }}>
                  <span className="flex h-4 w-4 items-center justify-center rounded border" style={{ borderColor: on ? '#a78bfa' : 'rgba(255,255,255,0.25)', background: on ? 'rgba(124,58,237,0.45)' : 'transparent' }}>
                    {on && <Check className="h-3 w-3" style={{ color: '#fff' }} />}
                  </span>
                  {m.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
        <p className="text-sm" style={{ color: TXT2 }}>Select who must sign off per environment. Every selected approver must sign before a feature is signed off (consensus).</p>
        {memberList.length === 0 && <span className="text-xs" style={{ color: TXT3 }}>No project members found.</span>}
        {[{ id: null as string | null, name: 'All environments' }, ...envs].map((env) => (
          <div key={env.id ?? 'all'}>
            <div className="mb-1 text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.82)' }}>{env.name}</div>
            <ApproverMultiSelect
              members={memberList}
              selectedIds={current.filter((r) => r.environmentId === env.id).map((r) => r.userId)}
              onToggle={(uid) => toggle(env.id, uid)}
            />
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
        {(data ?? []).length === 0 && <p style={{ color: TXT2 }}>No sign-off activity yet.</p>}
        {(data ?? []).map((e) => (
          <div key={e.id} className="flex items-start gap-2 py-1.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span className="text-xs w-32 shrink-0" style={{ color: TXT3 }}>{new Date(e.createdAt).toLocaleString()}</span>
            <span style={{ color: TXT2 }}>
              <strong style={{ color: 'rgba(238,238,248,0.82)' }}>{e.type.replace(/_/g, ' ').toLowerCase()}</strong>
              {e.featureName && <> · {e.featureName}</>}{e.moduleName && <> · {e.moduleName}</>}{e.environmentName && <> ({e.environmentName})</>}
              {e.actor && <span style={{ color: TXT3 }}> — {e.actor.name}</span>}
            </span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
