import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, Wand2, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { API_BASE } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/Toast';

/**
 * Phase 1 — G3 generation surface.
 *
 * Opens a modal, streams phase events from POST /tests/:id/ai/steps,
 * renders phase pills as they arrive, and on completion shows the
 * proposed steps with checkboxes + per-row editable name. The user
 * picks the subset to apply (default: all checked) and clicks
 * "Apply selected" — we hand the chosen rows back to the parent via
 * onApply so the editor merges them into the live step list.
 *
 * Important: we never auto-save. The user always reviews before persisting.
 */

export interface ProposedStep {
  index: number;
  type: string;
  name: string;
  input: Record<string, unknown>;
  continueOnFail?: boolean;
  aiDescription?: string;
}

interface GenerationResult {
  proposed: { steps: ProposedStep[] };
  aiSummaryId: string;
  acceptanceCriteria: string[];
  costUsd: number;
  warnings: string[];
}

type Phase =
  | 'idle'
  | 'resolving-credential'
  | 'gathering-sources'
  | 'extracting-ac'
  | 'generating'
  | 'validating'
  | 'complete'
  | 'error';

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Ready',
  'resolving-credential': 'Resolving credential',
  'gathering-sources': 'Gathering sources',
  'extracting-ac': 'Extracting acceptance criteria',
  generating: 'Generating steps',
  validating: 'Validating output',
  complete: 'Complete',
  error: 'Error',
};

export function GenerateStepsModal({
  open,
  onClose,
  testId,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  testId: string;
  onApply: (steps: ProposedStep[]) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [extraContext, setExtraContext] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [meta, setMeta] = useState<{ model?: string; acFound?: number }>({});
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setErrorMessage(null);
      setResult(null);
      setSelectedIndices(new Set());
      setMeta({});
      setExtraContext('');
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
      // Fastify + Nest serves SSE through reply.raw, so we use fetch directly
      // and parse `event:` / `data:` frames ourselves. Native EventSource
      // doesn't support POST bodies, which we need for `extraContext`.
      const res = await fetch(`${API_BASE}/api/v1/tests/${testId}/ai/steps`, {
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
            // Heartbeat / non-JSON line — ignore.
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
        setSelectedIndices(new Set(r.proposed.steps.map((s) => s.index)));
      }
      setPhase('complete');
      return;
    }
    setPhase(name);
    if (payload.data) {
      if (typeof payload.data.model === 'string') setMeta((m) => ({ ...m, model: payload.data!.model as string }));
      if (typeof payload.data.acFound === 'number') setMeta((m) => ({ ...m, acFound: payload.data!.acFound as number }));
    }
  }

  function apply() {
    if (!result) return;
    const chosen = result.proposed.steps.filter((s) => selectedIndices.has(s.index));
    if (chosen.length === 0) {
      toast.warning('Select at least one step to apply');
      return;
    }
    onApply(chosen);
  }

  const inFlight =
    phase !== 'idle' && phase !== 'complete' && phase !== 'error';

  return (
    <Modal open={open} onClose={onClose} title="Generate steps with AI" size="xl">
      <div className="space-y-4">
        {/* Input — additional context */}
        {phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              The model will read the test name, description and any attached / linked docs,
              extract acceptance criteria, then produce ordered steps that exercise them.
              You&rsquo;ll review the result before anything is saved.
            </p>
            <Field label="Additional context (optional)" hint="Paste extra notes, AC bullets, or a specific scenario you want covered.">
              <textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                rows={4}
                placeholder="e.g. Cover the case where the user submits with an already-registered email."
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
          </div>
        )}

        {/* Phase progress */}
        {inFlight && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-purple-300" />
              <span className="text-sm text-slate-200">{PHASE_LABEL[phase]}</span>
              {meta.model && <span className="text-xs text-slate-500">· {meta.model}</span>}
              {phase === 'generating' && meta.acFound != null && (
                <span className="text-xs text-slate-500">· {meta.acFound} AC extracted</span>
              )}
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['resolving-credential', 'gathering-sources', 'extracting-ac', 'generating', 'validating'] as Phase[]).map(
                (p) => {
                  const done =
                    (['resolving-credential', 'gathering-sources', 'extracting-ac', 'generating', 'validating'].indexOf(p) <
                      ['resolving-credential', 'gathering-sources', 'extracting-ac', 'generating', 'validating'].indexOf(phase));
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
                },
              )}
            </div>
          </div>
        )}

        {/* Error */}
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

        {/* Result */}
        {phase === 'complete' && result && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <div>
                <strong className="text-slate-200">{result.proposed.steps.length}</strong> steps proposed
                {' · '}
                <strong className="text-slate-200">{result.acceptanceCriteria.length}</strong> AC covered
                {result.costUsd > 0 && (
                  <>
                    {' · '}<span className="font-mono">${result.costUsd.toFixed(6)}</span>
                  </>
                )}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedIndices(new Set(result.proposed.steps.map((s) => s.index)))}
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

            {result.acceptanceCriteria.length > 0 && (
              <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Acceptance criteria</div>
                <ul className="space-y-0.5 text-slate-300">
                  {result.acceptanceCriteria.map((a, i) => (
                    <li key={i}>· {a}</li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="max-h-[400px] overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {result.proposed.steps.map((s) => {
                const checked = selectedIndices.has(s.index);
                return (
                  <li
                    key={s.index}
                    className="px-3 py-2 border-b border-white/5 last:border-b-0 hover:bg-white/3"
                  >
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(selectedIndices);
                          if (e.target.checked) next.add(s.index);
                          else next.delete(s.index);
                          setSelectedIndices(next);
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 flex items-center gap-2">
                          <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">
                            {s.type}
                          </span>
                          <span className="truncate">{s.name}</span>
                        </div>
                        {s.aiDescription && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{s.aiDescription}</div>
                        )}
                        {Object.keys(s.input).length > 0 && (
                          <div className="text-[11px] text-slate-500 mt-0.5 font-mono break-all">
                            {JSON.stringify(s.input)}
                          </div>
                        )}
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div className="text-[11px] text-slate-500">
            {phase === 'complete'
              ? `${selectedIndices.size} of ${result?.proposed.steps.length ?? 0} selected`
              : ' '}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={inFlight}>
              Close
            </Button>
            {phase === 'idle' && (
              <Button size="sm" onClick={startGeneration}>
                <Sparkles className="w-3.5 h-3.5 mr-1" /> Generate
              </Button>
            )}
            {phase === 'complete' && (
              <Button size="sm" onClick={apply} disabled={selectedIndices.size === 0}>
                <Wand2 className="w-3.5 h-3.5 mr-1" /> Apply selected
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
