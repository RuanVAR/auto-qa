import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle, Clock, Printer, ShieldCheck } from 'lucide-react';
import { api, signoffApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { SignaturePad } from '@/components/signoff/SignaturePad';

interface Approver {
  user: { id: string; name: string; email: string; avatarUrl?: string | null };
  signed: boolean;
  decision: 'APPROVED' | 'REJECTED' | null;
  signedAt: string | null;
  typedName: string | null;
  drawnSignature: string | null;
  note: string | null;
}
interface CellData {
  feature: { id: string; name: string; module: { id: string; name: string } };
  environment: { id: string; name: string; type: string };
  state: 'NOT_READY' | 'ELIGIBLE' | 'AWAITING' | 'SIGNED' | 'REJECTED';
  stats: { passed: number; failed: number; skipped: number; total: number; passRate: number | null } | null;
  approvers: Approver[];
  canSign: boolean;
  iAmApprover: boolean;
}

const TXT = 'var(--text-primary)';
const TXT2 = 'rgba(238,238,248,0.60)';
const TXT3 = 'rgba(238,238,248,0.40)';
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'var(--text-primary)' };
const STATE_BADGE: Record<string, React.CSSProperties> = {
  SIGNED:    { background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid rgba(16,185,129,0.28)' },
  REJECTED:  { background: 'rgba(239,68,68,0.15)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.28)' },
  AWAITING:  { background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.28)' },
  ELIGIBLE:  { background: 'rgba(124,58,237,0.20)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.32)' },
  NOT_READY: { background: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.45)', border: '1px solid rgba(255,255,255,0.08)' },
};
const STATE_LABEL: Record<string, string> = {
  SIGNED: 'Signed off', REJECTED: 'Rejected', AWAITING: 'Awaiting sign-off', ELIGIBLE: 'Ready to sign', NOT_READY: 'Not 100% passed',
};

export function FeatureSignoffPage() {
  const { projectId, featureId, envId } = useParams();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery<CellData>({
    queryKey: ['signoff-cell', featureId, envId],
    queryFn: () => signoffApi.cell(featureId!, envId!),
    enabled: !!featureId && !!envId,
  });

  const [typedName, setTypedName] = useState('');
  const [attested, setAttested] = useState(false);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const submit = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      signoffApi.submit(featureId!, envId!, { decision, typedName: typedName.trim(), drawnSignature: drawn ?? undefined, note: note.trim() || undefined }),
    onSuccess: () => {
      toast.success('Sign-off recorded');
      qc.invalidateQueries({ queryKey: ['signoff-cell', featureId, envId] });
      qc.invalidateQueries({ queryKey: ['signoff-overview', projectId] });
      setAttested(false); setDrawn(null); setNote('');
    },
    onError: (e: { response?: { data?: { message?: string } } }) =>
      toast.error(e?.response?.data?.message ?? 'Failed to record sign-off'),
  });

  async function printCertificate() {
    try {
      const res = await api.get(signoffApi.certificateUrl('feature', featureId!, envId!), { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data as Blob), '_blank');
    } catch { toast.error('Could not open certificate'); }
  }

  if (isLoading || !data) return <div className="p-8" style={{ color: TXT2 }}>Loading sign-off…</div>;

  const approvedCount = data.approvers.filter(a => a.signed && a.decision === 'APPROVED').length;
  const canSubmit = data.canSign && typedName.trim().length > 1 && attested && !submit.isPending;

  const sep = <span style={{ color: 'rgba(238,238,248,0.25)' }}>/</span>;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: TXT2 }}>
        <Link to="/projects" className="transition-opacity hover:opacity-80">Projects</Link>
        {sep}
        <Link to={`/projects/${projectId}`} className="transition-opacity hover:opacity-80">{data.feature.module.name}</Link>
        {sep}
        <Link to={`/projects/${projectId}/sign-off`} className="transition-opacity hover:opacity-80">Sign-off</Link>
        {sep}
        <span style={{ color: 'rgba(238,238,248,0.82)' }}>{data.feature.name}</span>
      </div>

      <Link to={`/projects/${projectId}/sign-off`} className="inline-flex items-center gap-1 text-sm transition-opacity hover:opacity-80" style={{ color: TXT2 }}>
        <ArrowLeft className="h-4 w-4" /> Back to sign-off overview
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: TXT }}>{data.feature.name}</h1>
          <p className="text-sm" style={{ color: TXT2 }}>
            {data.feature.module.name} · <span className="font-medium" style={{ color: 'rgba(238,238,248,0.82)' }}>{data.environment.name}</span>
          </p>
        </div>
        <span className="rounded-full px-3 py-1 text-sm font-medium" style={STATE_BADGE[data.state]}>{STATE_LABEL[data.state]}</span>
      </div>

      {/* Evidence */}
      <Card>
        <CardHeader><CardTitle>Test evidence</CardTitle></CardHeader>
        <CardContent>
          {data.stats ? (
            <div className="flex flex-wrap gap-6 text-sm">
              <Stat label="Pass rate" value={`${data.stats.passRate ?? 0}%`} accent="#34d399" />
              <Stat label="Passed" value={data.stats.passed} />
              <Stat label="Failed" value={data.stats.failed} accent={data.stats.failed ? '#f87171' : undefined} />
              <Stat label="Skipped" value={data.stats.skipped} />
              <Stat label="Total" value={data.stats.total} />
            </div>
          ) : <p className="text-sm" style={{ color: TXT2 }}>No stats available.</p>}
        </CardContent>
      </Card>

      {/* Approvers */}
      <Card>
        <CardHeader><CardTitle>Required approvers ({approvedCount}/{data.approvers.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.approvers.length === 0 && <p className="text-sm" style={{ color: TXT2 }}>No approvers configured for this environment yet.</p>}
          {data.approvers.map((a) => (
            <div key={a.user.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2">
                {a.signed
                  ? a.decision === 'APPROVED' ? <CheckCircle2 className="h-4 w-4" style={{ color: '#34d399' }} /> : <XCircle className="h-4 w-4" style={{ color: '#f87171' }} />
                  : <Clock className="h-4 w-4" style={{ color: '#fbbf24' }} />}
                <div>
                  <div className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.88)' }}>{a.user.name}</div>
                  {a.signed && <div className="text-xs" style={{ color: TXT3 }}>{a.typedName} · {a.signedAt ? new Date(a.signedAt).toLocaleString() : ''}</div>}
                </div>
              </div>
              {a.drawnSignature && <img src={a.drawnSignature} alt="signature" className="h-9 max-w-[120px] rounded object-contain" style={{ background: '#fff' }} />}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Sign-off form */}
      {data.canSign && (
        <Card>
          <CardHeader><CardTitle><span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" style={{ color: '#a78bfa' }} /> Your sign-off</span></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'rgba(238,238,248,0.82)' }}>Full name</label>
              <input
                value={typedName} onChange={(e) => setTypedName(e.target.value)}
                placeholder={me?.name ?? 'Type your full name'}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle}
              />
              {me?.name && !typedName && (
                <button className="mt-1 text-xs" style={{ color: '#a78bfa' }} onClick={() => setTypedName(me.name)}>Use “{me.name}”</button>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'rgba(238,238,248,0.82)' }}>Signature (optional)</label>
              <SignaturePad onChange={setDrawn} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" style={{ color: 'rgba(238,238,248,0.82)' }}>Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none" style={inputStyle} />
            </div>
            <label className="flex items-start gap-2 text-sm" style={{ color: TXT2 }}>
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
              <span>I approve <strong style={{ color: 'rgba(238,238,248,0.88)' }}>{data.feature.name}</strong> in <strong style={{ color: 'rgba(238,238,248,0.88)' }}>{data.environment.name}</strong> and confirm the evidence above.</span>
            </label>
            <div className="flex gap-2">
              <Button disabled={!canSubmit} onClick={() => submit.mutate('APPROVED')}>
                <CheckCircle2 className="mr-1 h-4 w-4" /> Approve & sign
              </Button>
              <Button variant="secondary" disabled={!typedName.trim() || submit.isPending} onClick={() => submit.mutate('REJECTED')}>
                <XCircle className="mr-1 h-4 w-4" /> Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!data.canSign && data.iAmApprover && (
        <p className="rounded-lg px-4 py-3 text-sm" style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.22)' }}>You have already signed off on this feature.</p>
      )}

      <div>
        <Button variant="secondary" onClick={printCertificate}><Printer className="mr-1 h-4 w-4" /> Print / Save certificate</Button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color: accent ?? 'rgba(238,238,248,0.88)' }}>{value}</div>
      <div className="text-xs uppercase tracking-wide" style={{ color: 'rgba(238,238,248,0.40)' }}>{label}</div>
    </div>
  );
}
