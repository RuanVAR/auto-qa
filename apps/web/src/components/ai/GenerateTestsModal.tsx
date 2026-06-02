import { useEffect, useRef, useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, XCircle, Wand2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { API_BASE, api } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { toast } from '@/components/ui/Toast';

/**
 * Phase 2 — G2 generation surface.
 *
 * Streams test-case proposals from POST /features/:id/ai/tests, lets the
 * user pick which to keep, then POSTs the chosen subset to
 *   /features/:id/ai/tests/apply
 * which creates TestDefinition rows tagged ['ai-generated','unreviewed'].
 *
 * The G3 modal handles steps for ONE test; this one handles cases (each
 * with their own steps) for ONE feature. Both share the same SSE frame
 * format, the same phase pills, and the same selector-stability /
 * AC-traceability guarantees from the backend.
 */

interface ProposedTestCase {
  name: string;
  description?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  mappedAcceptanceCriteria: string[];
  tags: string[];
  steps: Array<{
    index: number;
    type: string;
    name: string;
    input: Record<string, unknown>;
    aiDescription?: string;
    continueOnFail?: boolean;
  }>;
}

interface GenerationResult {
  proposed: { testCases: ProposedTestCase[] };
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
  generating: 'Generating test cases',
  validating: 'Validating output',
  complete: 'Complete',
  error: 'Error',
};

const PHASE_ORDER: Phase[] = [
  'resolving-credential',
  'gathering-sources',
  'extracting-ac',
  'generating',
  'validating',
];

export function GenerateTestsModal({
  open,
  onClose,
  featureId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  featureId: string;
  /** Fires after tests are persisted — parent invalidates queries. */
  onApplied: (created: Array<{ id: string; name: string }>) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [extraContext, setExtraContext] = useState('');
  const [testCountTarget, setTestCountTarget] = useState<number | ''>('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [meta, setMeta] = useState<{ model?: string; acFound?: number; targetCount?: number }>({});
  const [applying, setApplying] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setErrorMessage(null);
      setResult(null);
      setSelectedIndices(new Set());
      setExpanded(new Set());
      setMeta({});
      setExtraContext('');
      setTestCountTarget('');
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
      const res = await fetch(`${API_BASE}/api/v1/features/${featureId}/ai/tests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token ?? ''}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          extraContext: extraContext.trim() || undefined,
          testCountTarget: typeof testCountTarget === 'number' ? testCountTarget : undefined,
        }),
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
        // Default selection = every test case checked.
        setSelectedIndices(new Set(r.proposed.testCases.map((_, i) => i)));
      }
      setPhase('complete');
      return;
    }
    setPhase(name);
    if (payload.data) {
      const d = payload.data;
      if (typeof d.model === 'string') setMeta((m) => ({ ...m, model: d.model as string }));
      if (typeof d.acFound === 'number') setMeta((m) => ({ ...m, acFound: d.acFound as number }));
      if (typeof d.targetCount === 'number') setMeta((m) => ({ ...m, targetCount: d.targetCount as number }));
    }
  }

  async function applySelection() {
    if (!result) return;
    const chosen = result.proposed.testCases.filter((_, i) => selectedIndices.has(i));
    if (chosen.length === 0) {
      toast.warning('Select at least one test to apply');
      return;
    }
    setApplying(true);
    try {
      const r = await api.post<{ created: Array<{ id: string; name: string }>; skipped: Array<{ name: string; reason: string }> }>(
        `/api/v1/features/${featureId}/ai/tests/apply`,
        {
          testCases: chosen,
          aiSummaryId: result.aiSummaryId,
          ac: result.acceptanceCriteria,
          sourcePrompt: extraContext || undefined,
        },
      );
      const { created, skipped } = r.data;
      if (skipped.length > 0) {
        toast.warning(`${created.length} created, ${skipped.length} skipped`, skipped.map((s) => `${s.name}: ${s.reason}`).join('\n'));
      } else {
        toast.success(`${created.length} test${created.length === 1 ? '' : 's'} created`);
      }
      onApplied(created);
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Apply failed', typeof msg === 'string' ? msg : (err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const inFlight =
    phase !== 'idle' && phase !== 'complete' && phase !== 'error';

  return (
    <Modal open={open} onClose={onClose} title="Generate tests with AI" size="xl">
      <div className="space-y-4">
        {phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">
              The model reads the feature description and any attached / linked docs,
              extracts acceptance criteria, then produces a set of test cases covering
              happy + edge + negative paths. You&rsquo;ll review and pick which to save.
            </p>
            <Field
              label="Additional context (optional)"
              hint="Anything to emphasise — a specific scenario, a known edge case, AC the docs missed."
            >
              <textarea
                value={extraContext}
                onChange={(e) => setExtraContext(e.target.value)}
                rows={4}
                placeholder="e.g. Add explicit tests for the 'duplicate email' rejection path."
                className="block w-full bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
              />
            </Field>
            <Field label="Test count target (optional)" hint="Leave blank for auto (≈ ceil(AC × 1.5))">
              <input
                type="number"
                min={1}
                max={50}
                value={testCountTarget}
                onChange={(e) => setTestCountTarget(e.target.value ? Number(e.target.value) : '')}
                placeholder="auto"
                className="block w-32 bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-2"
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
              {phase === 'generating' && meta.acFound != null && (
                <span className="text-xs text-slate-500">
                  · {meta.acFound} AC · target ~{meta.targetCount}
                </span>
              )}
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
                        ? 'rgba(var(--accent-rgb),0.18)'
                        : done
                        ? 'rgba(16,185,129,0.12)'
                        : 'rgba(255,255,255,0.04)',
                      color: active ? 'var(--accent-200)' : done ? '#6ee7b7' : 'rgba(238,238,248,0.50)',
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
                <strong className="text-slate-200">{result.proposed.testCases.length}</strong> tests proposed
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
                  onClick={() => setSelectedIndices(new Set(result.proposed.testCases.map((_, i) => i)))}
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
              <div
                className="rounded-lg p-3 text-xs space-y-1"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Acceptance criteria extracted</div>
                <ul className="space-y-0.5 text-slate-300">
                  {result.acceptanceCriteria.map((a, i) => (
                    <li key={i}>· {a}</li>
                  ))}
                </ul>
              </div>
            )}

            <ul className="max-h-[450px] overflow-y-auto rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {result.proposed.testCases.map((tc, i) => {
                const checked = selectedIndices.has(i);
                const isExpanded = expanded.has(i);
                return (
                  <li key={i} className="border-b border-white/5 last:border-b-0 hover:bg-white/3">
                    <div className="px-3 py-2 flex items-start gap-2">
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
                      <button
                        type="button"
                        onClick={() => {
                          const next = new Set(expanded);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          setExpanded(next);
                        }}
                        className="text-slate-400 hover:text-slate-200 mt-0.5"
                      >
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 flex items-center gap-2 flex-wrap">
                          <span>{tc.name}</span>
                          <span
                            className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                            style={{
                              background:
                                tc.priority === 'HIGH'
                                  ? 'rgba(239,68,68,0.10)'
                                  : tc.priority === 'LOW'
                                  ? 'rgba(255,255,255,0.04)'
                                  : 'rgba(245,158,11,0.10)',
                              color:
                                tc.priority === 'HIGH'
                                  ? '#fca5a5'
                                  : tc.priority === 'LOW'
                                  ? '#94a3b8'
                                  : '#fbbf24',
                            }}
                          >
                            {tc.priority}
                          </span>
                          <span className="text-[10px] text-slate-500">{tc.steps.length} steps</span>
                        </div>
                        {tc.description && (
                          <div className="text-[11px] text-slate-400 mt-0.5">{tc.description}</div>
                        )}
                        {tc.mappedAcceptanceCriteria.length > 0 && (
                          <div className="text-[10px] text-slate-500 mt-1">
                            Covers:{' '}
                            {tc.mappedAcceptanceCriteria.map((a, idx) => (
                              <span key={idx} className="inline-block bg-purple-500/10 text-purple-300 px-1 py-0.5 rounded mr-1 mb-0.5">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {isExpanded && (
                      <ol className="ml-12 mr-3 mb-2 space-y-1 text-[11px]">
                        {tc.steps.map((s) => (
                          <li key={s.index} className="text-slate-300">
                            <span className="font-mono text-[9px] text-purple-300 bg-purple-500/10 px-1 py-0.5 rounded mr-1">
                              {s.type}
                            </span>
                            {s.name}
                            {s.aiDescription && (
                              <div className="text-slate-500 ml-4 italic">{s.aiDescription}</div>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/5">
          <div className="text-[11px] text-slate-500">
            {phase === 'complete'
              ? `${selectedIndices.size} of ${result?.proposed.testCases.length ?? 0} selected`
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
              <Button
                size="sm"
                onClick={applySelection}
                disabled={selectedIndices.size === 0 || applying}
                loading={applying}
              >
                <Wand2 className="w-3.5 h-3.5 mr-1" /> Save {selectedIndices.size} test{selectedIndices.size === 1 ? '' : 's'}
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
