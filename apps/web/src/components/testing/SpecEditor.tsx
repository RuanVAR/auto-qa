import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Save, CheckCircle2, AlertTriangle, FileCode2 } from 'lucide-react';
import { featureSpecApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * SpecEditor — feature-level "describe/it" authoring surface (Phase 3b).
 *
 * Edits a text spec where each `it` block is one test definition. Saving
 * syncs the feature's TestDefinitions to match (create/update/delete). The
 * DSL is parsed/validated server-side via featureSpecApi so the parser stays
 * a single source of truth in @qa-platform/shared.
 */
export function SpecEditor({ featureId, canEdit = true }: { featureId: string; canEdit?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [validation, setValidation] = useState<{ ok: boolean; error?: string; line?: number } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['feature-spec', featureId],
    queryFn: () => featureSpecApi.get(featureId),
    enabled: !!featureId,
  });

  // Seed the editor when the spec loads (and we have no unsaved edits).
  useEffect(() => {
    if (data && !dirty) setText(data.text);
  }, [data, dirty]);

  const save = useMutation({
    mutationFn: () => featureSpecApi.save(featureId, text),
    onSuccess: (res) => {
      setDirty(false);
      setValidation({ ok: true });
      toast.success(`Spec saved — ${res.created} created, ${res.updated} updated, ${res.deleted} removed`);
      // Tests + stats changed → refresh the surfaces that read them.
      qc.invalidateQueries({ queryKey: ['feature-spec', featureId] });
      qc.invalidateQueries({ queryKey: ['tests'] });
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed';
      setValidation({ ok: false, error: msg });
      toast.error(msg);
    },
  });

  const validate = useMutation({
    mutationFn: () => featureSpecApi.validate(featureId, text),
    onSuccess: (res) => {
      setValidation(res);
      if (res.ok) toast.success('Spec is valid');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm" style={{ color: 'rgba(238,238,248,0.45)' }}>
        <Loader2 size={14} className="animate-spin" /> Loading spec…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.85)' }}>
          <FileCode2 size={15} style={{ color: 'var(--accent-400)' }} />
          Spec — one <code className="font-mono text-xs">it</code> block per test
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => validate.mutate()} disabled={validate.isPending}>
              {validate.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Validate
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save spec
            </Button>
          </div>
        )}
      </div>

      <textarea
        className="w-full rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none"
        style={{
          minHeight: 360,
          background: 'rgba(255,255,255,0.04)',
          border: `1px solid ${validation && !validation.ok ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.12)'}`,
          color: 'rgba(238,238,248,0.92)',
          lineHeight: 1.6,
        }}
        spellCheck={false}
        value={text}
        readOnly={!canEdit}
        onChange={(e) => { setText(e.target.value); setDirty(true); setValidation(null); }}
        placeholder={'describe "Feature" {\n  it "does a thing" {\n    navigate "/path"\n    click "[data-testid=go]"\n    assert text "[role=alert]" contains "Done"\n  }\n}'}
      />

      {validation && !validation.ok && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.30)', color: '#fca5a5' }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{validation.error}</span>
        </div>
      )}
      {validation?.ok && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)', color: '#6ee7b7' }}>
          <CheckCircle2 size={13} /> Spec is valid.
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.4)' }}>
        Verbs: navigate, click, fill, type, select, check, press, waitfor, screenshot, assert
        text/visible/value/url/element. Selectors must be stable
        (<code className="font-mono">[data-testid=…]</code>, <code className="font-mono">[role=…]</code>,
        <code className="font-mono">#id</code>). Use <code className="font-mono">step TYPE {'{json}'}</code> for anything else.
      </p>
    </div>
  );
}
