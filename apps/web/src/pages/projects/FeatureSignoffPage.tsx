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

const STATE_BADGE: Record<string, { label: string; cls: string }> = {
  SIGNED: { label: 'Signed off', cls: 'bg-green-100 text-green-700' },
  REJECTED: { label: 'Rejected', cls: 'bg-red-100 text-red-700' },
  AWAITING: { label: 'Awaiting sign-off', cls: 'bg-amber-100 text-amber-700' },
  ELIGIBLE: { label: 'Ready to sign', cls: 'bg-blue-100 text-blue-700' },
  NOT_READY: { label: 'Not 100% passed', cls: 'bg-slate-100 text-slate-500' },
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

  if (isLoading || !data) return <div className="p-8 text-slate-500">Loading sign-off…</div>;

  const badge = STATE_BADGE[data.state];
  const canSubmit = data.canSign && typedName.trim().length > 1 && attested && !submit.isPending;

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-5">
      <Link to={`/projects/${projectId}/sign-off`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="h-4 w-4" /> Back to sign-off overview
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{data.feature.name}</h1>
          <p className="text-sm text-slate-500">
            {data.feature.module.name} · <span className="font-medium">{data.environment.name}</span>
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${badge.cls}`}>{badge.label}</span>
      </div>

      {/* Evidence */}
      <Card>
        <CardHeader><CardTitle>Test evidence</CardTitle></CardHeader>
        <CardContent>
          {data.stats ? (
            <div className="flex flex-wrap gap-6 text-sm">
              <Stat label="Pass rate" value={`${data.stats.passRate ?? 0}%`} accent="text-green-600" />
              <Stat label="Passed" value={data.stats.passed} />
              <Stat label="Failed" value={data.stats.failed} accent={data.stats.failed ? 'text-red-600' : undefined} />
              <Stat label="Skipped" value={data.stats.skipped} />
              <Stat label="Total" value={data.stats.total} />
            </div>
          ) : <p className="text-sm text-slate-500">No stats available.</p>}
        </CardContent>
      </Card>

      {/* Approvers */}
      <Card>
        <CardHeader><CardTitle>Required approvers ({data.approvers.filter(a => a.signed && a.decision === 'APPROVED').length}/{data.approvers.length})</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {data.approvers.length === 0 && <p className="text-sm text-slate-500">No approvers configured for this environment yet.</p>}
          {data.approvers.map((a) => (
            <div key={a.user.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <div className="flex items-center gap-2">
                {a.signed
                  ? a.decision === 'APPROVED' ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-red-600" />
                  : <Clock className="h-4 w-4 text-amber-500" />}
                <div>
                  <div className="text-sm font-medium text-slate-800">{a.user.name}</div>
                  {a.signed && <div className="text-xs text-slate-400">{a.typedName} · {a.signedAt ? new Date(a.signedAt).toLocaleString() : ''}</div>}
                </div>
              </div>
              {a.drawnSignature && <img src={a.drawnSignature} alt="signature" className="h-9 max-w-[120px] object-contain" />}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Sign-off form */}
      {data.canSign && (
        <Card>
          <CardHeader><CardTitle><span className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-600" /> Your sign-off</span></CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Full name</label>
              <input
                value={typedName} onChange={(e) => setTypedName(e.target.value)}
                placeholder={me?.name ?? 'Type your full name'}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              {me?.name && !typedName && (
                <button className="mt-1 text-xs text-blue-600" onClick={() => setTypedName(me.name)}>Use “{me.name}”</button>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Signature (optional)</label>
              <SignaturePad onChange={setDrawn} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Note (optional)</label>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5" />
              I approve <strong>{data.feature.name}</strong> in <strong>{data.environment.name}</strong> and confirm the evidence above.
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
        <p className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">You have already signed off on this feature.</p>
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
      <div className={`text-2xl font-bold ${accent ?? 'text-slate-800'}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  );
}
