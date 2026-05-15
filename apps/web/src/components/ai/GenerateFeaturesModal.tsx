import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, Wand2, AlertTriangle, FolderTree } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { API_BASE, api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/Toast';

/**
 * Phase 3 — G1 (pass 1: features from a module).
 *
 * Streams feature proposals from POST /modules/:id/ai/features. The user
 * accepts a subset; POST /modules/:id/ai/features/apply creates the rows.
 * Pass 2 (G2 — tests per feature) is fired interactively from the feature
 * page once the user is on each newly-created feature.
 *
 * Frame format and SSE plumbing match G2/G3 — same phase pills, same
 * fetch+ReadableStream pattern.
 */

interface ProposedFeature {
  name: string;
  description?: string;
  extractedAc: string[];
}

interface GenerationResult {
  proposed: { features: ProposedFeature[] };
  aiSummaryId: string;
  costUsd: number;
  warnings: string[];
}

type Phase =
  | 'idle'
  | 'resolving-credential'
  | 'gathering-sources'
  | 'generating'
  | 'validating'
  | 'complete'
  | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  'resolving-credential': 'Resolving credential',
  'gathering-sources': 'Gathering sources',
  generating: 'Proposing features',
  validating: 'Validating output',
  complete: 'Complete',
  error: 'Error',
};

const PHASE_ORDER: Phase[] = ['resolving-credential', 'gathering-sources', 'generating', 'validating'];

export function GenerateFeaturesModal({
  open,
  onClose,
  moduleId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  moduleId: string;
  onApplied: (created: Array<{ id: string; name: string; extractedAc: string[] }>) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [extraContext, setExtraContext] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [meta, setMeta] = useState<{ model?: string }>({});
  const [applying, setApplying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setErrorMessage(null);
      setResult(null);
      setSelectedIndices(new Set());
      setMeta({});
      setExtraContext('');
      setApplying(false);
      controllerRef.current?.abort();
      controllerRef.current = null;
    }
  }, [open]);

  async function startGeneration() {
    setPhase('resolving-credential');
    setErrorMessage(null);
    setResult(null);

    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE}/api/v1/modules/${moduleId}/ai/features`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({ extraContext: extraContext.trim() || undefined }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const lines = frame.split('\n');
          let evtName = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evtName = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!data) continue;
          try {
            const payload = JSON.parse(data);
            handlePhaseEvent(evtName as Phase, payload);
          } catch {
            // heartbeat / non-JSON — ignore
          }
        }
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'Generation failed';
      setPhase('error');
      setErrorMessage(msg);
      toast.error('AI generation failed', msg);
    }
  }

  function handlePhaseEvent(name: Phase, payload: { message?: string; data?: Record<string, unknown> }) {
    if (name === 'error') {
      setPhase('error');
      setErrorMessage(payload.message ?? 'Generation failed');
      return;
    }
    if (name === 'complete') {
      const r = payload.data?.result as GenerationResult | undefined;
      if (r) {
        setResult(r);
        setSelectedIndices(new Set(r.proposed.features.map((_, i) => i)));
      }
      setPhase('complete');
      return;
    }
    setPhase(name);
    if (payload.data?.model && typeof payload.data.model === 'string') {
      setMeta({ model: payload.data.model });
    }
  }

  async function applySelection() {
    if (!result) return;
    const chosen = result.proposed.features.filter((_, i) => selectedIndices.has(i));
    if (chosen.length === 0) {
      toast.warning('Select at least one feature to apply');
      return;
    }
    setApplying(true);
    try {
      const r = await api.post<{
        created: Array<{ id: string; name: string; extractedAc: string[] }>;
        skipped: Array<{ name: string; reason: string }>;
      }>(`/api/v1/modules/${moduleId}/ai/features/apply`, {
        features: chosen,
        aiSummaryId: result.aiSummaryId,
      });
      const { created, skipped } = r.data;
      if (skipped.length > 0) {
        toast.warning(
          `${created.length} created, ${skipped.length} skipped`,
          skipped.map((s) => `${s.name}: ${s.reason}`).join('\n'),
        );
      } else {
        toast.success(`${created.length} feature${created.length === 1 ? '' : 's'} created`);
      }
      onApplied(created);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Apply failed', typeof msg === 'string' ? msg : (err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const inFlight = phase !== 'idle' && phase !== 'complete' && phase !== 'error';

  return (
    <Modal open={open} onClose={onClose} title="Generate features with AI" size="xl">
      <div className="space-y-4">
        {phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              The model reads the module&rsquo;s description and any attached / linked docs, then proposes a list of
              features (each with extracted acceptance criteria). After you save the ones you want, run{' '}
              <strong className="text-slate-200">Generate Tests</strong> on each one to flesh out test cases.
            </p>
            <Field
              label="Additional context (optional)"
              hint="Anything to emphasise — sprint scope, areas to prioritise, AC the docs missed."
            >
              <textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                rows={4}
                placeholder="e.g. We're scoping Sprint 7. Focus on login, registration, and password reset."
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
          </div>
        )}

        {inFlight && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-300" />
              <span className="text-sm text-slate-200">{PHASE_LABEL[phase]}</span>
              {meta.model && <span className="text-xs text-slate-500">· {meta.model}</span>}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {PHASE_ORDER.map((p) => {
                const idx = PHASE_ORDER.indexOf(p);
                const curIdx = PHASE_ORDER.indexOf(phase);
                const done = curIdx > idx;
                const active = p === phase;
                return (
                  <span
                    key={p}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{
                      background: active
                        ? 'rgba(139,92,246,0.18)'
                        : done
                        ? 'rgba(16,185,129,0.12)'
                        : 'rgba(255,255,255,0.04)',
                      color: active ? '#e9d5ff' : done ? '#6ee7b7' : 'rgba(238,238,248,0.50)',
                    }}
                  >
                    {done && <CheckCircle2 className="inline w-2.5 h-2.5 mr-1" />}
                    {PHASE_LABEL[p]}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {phase === 'error' && errorMessage && (
          <div
            className="rounded-lg p-3 text-xs flex items-start gap-2"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <XCircle className="w-4 h-4 text-red-400 mt-0.5" />
            <div>
              <div className="text-slate-100 font-medium">Generation failed</div>
              <div className="text-slate-400 mt-1 font-mono break-all">{errorMessage}</div>
            </div>
          </div>
        )}

        {phase === 'complete' && result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div>
                <strong className="text-slate-200">{result.proposed.features.length}</strong> features proposed
                {result.costUsd > 0 && (
                  <>
                    {' · '}<span className="font-mono">${result.costUsd.toFixed(6)}</span>
                  </>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedIndices(new Set(result.proposed.features.map((_, i) => i)))}
                  className="text-[11px] text-purple-300 hover:text-purple-200"
                >
                  All
                </button>
                <span className="text-slate-600">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedIndices(new Set())}
                  className="text-[11px] text-slate-400 hover:text-slate-200"
                >
                  None
                </button>
              </div>
            </div>

            {result.warnings.length > 0 && (
              <div
                className="rounded-lg p-2 text-[11px] flex items-start gap-2"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5" />
                <ul className="space-y-0.5 text-slate-300">
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="max-h-[450px] overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {result.proposed.features.map((f, i) => {
                const checked = selectedIndices.has(i);
                return (
                  <li key={i} className="border-b border-white/5 last:border-b-0 hover:bg-white/3 px-3 py-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedIndices);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          setSelectedIndices(next);
                        }}
                        className="mt-1"
                      />
                      <FolderTree className="w-3.5 h-3.5 text-purple-300 mt-1" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100">{f.name}</div>
                        {f.description && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{f.description}</div>
                        )}
                        {f.extractedAc.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {f.extractedAc.map((ac, idx) => (
                              <li key={idx} className="text-[10px] text-slate-500">
                                · {ac}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div className="text-[11px] text-slate-500">
            {phase === 'complete'
              ? `${selectedIndices.size} of ${result?.proposed.features.length ?? 0} selected`
              : ' '}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={inFlight || applying}>
              Close
            </Button>
            {phase === 'idle' && (
              <Button size="sm" onClick={startGeneration}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> Generate
              </Button>
            )}
            {phase === 'complete' && (
              <Button size="sm" onClick={applySelection} disabled={selectedIndices.size === 0 || applying} loading={applying}>
                <Wand2 className="w-3.5 h-3.5 mr-1" /> Save {selectedIndices.size} feature{selectedIndices.size === 1 ? '' : 's'}
              </Button>
            )}
            {phase === 'error' && (
              <Button size="sm" onClick={startGeneration}>
                Retry
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
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
