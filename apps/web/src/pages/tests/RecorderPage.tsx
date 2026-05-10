import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeft, Play, Square, Pause, Trash2, GripVertical, ExternalLink,
  Copy, AlertTriangle, Save, RefreshCw, Eye,
} from 'lucide-react';
import { environmentsApi, testsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { compactSteps, suggestTokenisations, type CapturedStep } from './recorderUtils';

/**
 * Test Recorder — full-screen authoring page.
 *
 * Two modes via query param:
 *   - ?testId=<id>      → append captured steps to that test
 *   - (no testId)       → save as a new test (uses ?featureId for routing)
 *
 * Layout:
 *   - Left:  app preview (iframe of <env.baseUrl><startPath>) OR popup
 *            launcher card if X-Frame is blocked. Top bar with env switcher,
 *            ●/■ Record, ⏸ Pause, save controls.
 *   - Right: live step list. Each captured step renders as a row. User can
 *            delete, mark as "do not record next time", reorder before save.
 *
 * Communication with the captured app uses BroadcastChannel('qa-recorder')
 * — see /apps/web/public/test-recorder.js for the capture-side script.
 */
export function RecorderPage() {
  const { projectId, featureId } = useParams<{ projectId: string; featureId: string }>();
  const [params] = useSearchParams();
  const testIdParam = params.get('testId');
  const navigate = useNavigate();

  const envsQ = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });
  const envs: Array<{ id: string; name: string; baseUrl: string; type: string }> = envsQ.data ?? [];
  const [envId, setEnvId] = useState<string>('');
  useEffect(() => {
    if (!envId && envs.length > 0) setEnvId(envs[0].id);
  }, [envs, envId]);
  const env = envs.find(e => e.id === envId);

  const existingTestQ = useQuery({
    queryKey: ['test', testIdParam],
    queryFn: () => testsApi.get(projectId!, testIdParam!),
    enabled: !!testIdParam,
  });
  const existingTest = existingTestQ.data as
    | { id: string; name: string; steps: Array<Record<string, unknown>> }
    | undefined;

  // ── Recording state ────────────────────────────────────────────────────

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [steps, setSteps] = useState<CapturedStep[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [iframeBlocked, setIframeBlocked] = useState(false);
  const startedAtRef = useRef<number | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // BroadcastChannel listens whenever recording is on. Capture script ↗
  // /public/test-recorder.js posts {kind:'hello'|'step', sessionId, ...}.
  useEffect(() => {
    if (!recording) return;
    const ch = new BroadcastChannel('qa-recorder');
    channelRef.current = ch;
    ch.onmessage = (msg) => {
      const data = msg.data as { kind: string; sessionId?: string; step?: CapturedStep };
      if (data.kind === 'hello') {
        setSessionId(data.sessionId ?? null);
        toast.success('Recorder connected');
      } else if (data.kind === 'step' && data.step) {
        setSteps(prev => [...prev, data.step!]);
      }
    };
    return () => { ch.close(); channelRef.current = null; };
  }, [recording]);

  function startRecording() {
    if (!env) {
      toast.error('Pick an environment first');
      return;
    }
    setSteps([]);
    setSessionId(null);
    setIframeBlocked(false);
    startedAtRef.current = Date.now();
    setRecording(true);
    setPaused(false);
  }

  function stopRecording() {
    setRecording(false);
    setPaused(false);
    // Compact AFTER stop — see recorderUtils.compactSteps for the rules
    // (drop scroll-jitter, coalesce typing, drop hover-before-click, etc.).
    setSteps(prev => compactSteps(prev));
  }

  function togglePause() {
    if (!channelRef.current || !sessionId) return;
    const action = paused ? 'resume' : 'pause';
    channelRef.current.postMessage({ kind: 'control', sessionId, action });
    setPaused(p => !p);
  }

  // ── Iframe vs popup detection ──────────────────────────────────────────

  const startUrl = useMemo(() => {
    if (!env) return null;
    // Slice 2 will use the existing test's last NAVIGATE step here. For
    // now (slice 1) we always start at the env baseUrl root.
    return env.baseUrl.replace(/\/$/, '') + '/';
  }, [env]);

  // If the iframe fails to load (X-Frame-Options: DENY) we offer the
  // bookmarklet path. No reliable cross-origin onerror, so we use a load
  // timer + a sentinel postMessage check.
  useEffect(() => {
    if (!recording || !iframeRef.current) return;
    const t = window.setTimeout(() => {
      try {
        // Same-origin probe — throws on cross-origin / blocked frames.
        const win = iframeRef.current?.contentWindow;
        // accessing href throws on cross-origin
        if (win) void win.location.href;
        // If we got here AND the URL never moved past about:blank, treat
        // as blocked (the iframe might be present but not loading anything).
        const href = win?.location?.href ?? '';
        if (!href || href === 'about:blank') setIframeBlocked(true);
      } catch {
        // Cross-origin frame — that's actually fine for capture (the script
        // injected via srcdoc wrapper handles it). We mark blocked only
        // when the embed is outright refused.
      }
    }, 4000);
    return () => window.clearTimeout(t);
  }, [recording, startUrl]);

  // ── Save flow ──────────────────────────────────────────────────────────

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [newTestName, setNewTestName] = useState('Recorded test');
  const tokenSuggestions = useMemo(
    () => env ? suggestTokenisations(steps, env.baseUrl) : [],
    [steps, env],
  );
  const [acceptedTokens, setAcceptedTokens] = useState<Record<string, string>>({});

  const saveAppend = useMutation({
    mutationFn: () => {
      const finalSteps = applyTokens(steps, acceptedTokens);
      return testsApi.appendSteps(projectId!, testIdParam!, {
        steps: finalSteps as unknown as Array<Record<string, unknown>>,
        meta: {
          recordedAt: new Date(startedAtRef.current ?? Date.now()).toISOString(),
          recordedDurationSec: Math.round(((Date.now() - (startedAtRef.current ?? Date.now()))) / 1000),
        },
      });
    },
    onSuccess: () => {
      toast.success(`${steps.length} steps appended`);
      navigate(`/projects/${projectId}/tests/${testIdParam}/edit`);
    },
    onError: () => toast.error('Append failed'),
  });

  const saveNew = useMutation({
    mutationFn: () => {
      const finalSteps = applyTokens(steps, acceptedTokens);
      return testsApi.create(projectId!, {
        name: newTestName.trim() || 'Recorded test',
        type: 'UI',
        tags: ['recorded'],
        steps: finalSteps,
        config: {},
        featureId: featureId ?? undefined,
      });
    },
    onSuccess: (created) => {
      toast.success('Test saved');
      const id = (created as { id: string }).id;
      navigate(`/projects/${projectId}/tests/${id}/edit`);
    },
    onError: () => toast.error('Save failed'),
  });

  function save() {
    if (steps.length === 0) {
      toast.error('Nothing to save — record some steps first');
      return;
    }
    if (testIdParam) saveAppend.mutate();
    else saveNew.mutate();
  }

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: 'var(--bg-base)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(14,14,22,0.95)' }}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (recording && !window.confirm('Stop recording and discard?')) return;
              navigate(-1);
            }}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
              {testIdParam ? `Append to: ${existingTest?.name ?? '…'}` : 'Record New Test'}
            </div>
            <div className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              {recording ? (paused ? 'Paused' : 'Recording…') : 'Idle'} · {steps.length} step{steps.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={envId}
            onChange={e => setEnvId(e.target.value)}
            disabled={recording}
            className="rounded-md px-2 py-1 text-xs"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
          >
            {envs.map(e => <option key={e.id} value={e.id} style={{ background: '#1a1a2e' }}>{e.name} — {e.baseUrl}</option>)}
          </select>
          {!recording ? (
            <Button size="sm" onClick={startRecording} disabled={!env}>
              <span className="w-2 h-2 rounded-full mr-1.5" style={{ background: '#ef4444' }} /> Record
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={togglePause}>
                <Pause size={12} className="mr-1" /> {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button size="sm" variant="danger" onClick={stopRecording}>
                <Square size={12} className="mr-1" /> Stop
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => setSaveModalOpen(true)} disabled={steps.length === 0 || recording}>
            <Save size={12} className="mr-1" /> Save…
          </Button>
        </div>
      </div>

      {/* Main split */}
      <div className="flex-1 grid grid-cols-[1fr_400px] min-h-0">
        {/* App preview */}
        <div className="relative">
          {!recording ? (
            <IdlePreview env={env} testIdParam={testIdParam} steps={existingTest?.steps as CapturedStep[] | undefined} />
          ) : iframeBlocked ? (
            <BookmarkletFallback startUrl={startUrl ?? ''} />
          ) : (
            <iframe
              ref={iframeRef}
              src={startUrl ?? 'about:blank'}
              className="w-full h-full"
              style={{ border: 'none', background: 'white' }}
              srcDoc={undefined}
              // Important: the capture script is injected by the iframe's
              // own page (via the srcdoc wrapper or a dev-mode injection).
              // For slice 1 we rely on the bookmarklet path being explicit
              // when iframe embedding is denied.
            />
          )}
        </div>

        {/* Step list */}
        <div className="border-l flex flex-col min-h-0" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider font-semibold flex items-center justify-between" style={{ borderColor: 'rgba(255,255,255,0.07)', color: 'rgba(238,238,248,0.50)' }}>
            <span>Live captured steps</span>
            <button
              onClick={() => setSteps([])}
              disabled={steps.length === 0}
              className="text-[10px] uppercase disabled:opacity-30"
              style={{ color: 'rgba(238,238,248,0.55)' }}
            >
              Clear
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {steps.length === 0 ? (
              <div className="text-xs text-center py-12" style={{ color: 'rgba(238,238,248,0.40)' }}>
                {recording ? 'Acting in the app… steps will appear here.' : 'Press Record to start.'}
              </div>
            ) : (
              steps.map((s, i) => (
                <StepRow
                  key={i}
                  step={s}
                  index={i}
                  onDelete={() => setSteps(prev => prev.filter((_, j) => j !== i))}
                />
              ))
            )}
          </div>
          {tokenSuggestions.length > 0 && (
            <div className="px-3 py-2 border-t text-[11px]" style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(251,191,36,0.05)' }}>
              <div className="flex items-center gap-1.5" style={{ color: '#fbbf24' }}>
                <AlertTriangle size={11} />
                <span className="font-medium">{tokenSuggestions.length} value{tokenSuggestions.length === 1 ? '' : 's'} can be tokenised at save</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save modal */}
      {saveModalOpen && (
        <Modal open onClose={() => setSaveModalOpen(false)} title={testIdParam ? 'Append to test' : 'Save recorded test'} size="lg">
          <div className="space-y-4">
            {!testIdParam && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.65)' }}>Test name</label>
                <input
                  className="w-full rounded-md px-3 py-2 text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
                  value={newTestName}
                  onChange={e => setNewTestName(e.target.value)}
                />
              </div>
            )}
            {tokenSuggestions.length > 0 && (
              <div className="rounded-lg p-3 space-y-2" style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.20)' }}>
                <p className="text-xs font-medium" style={{ color: '#fbbf24' }}>Replace literal values with variables?</p>
                <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  Hardcoding the env URL or your own email locks the test to your dev box. Tokenise so it plays back anywhere.
                </p>
                <div className="space-y-1.5">
                  {tokenSuggestions.map((sug, i) => (
                    <label key={i} className="flex items-start gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={acceptedTokens[sug.literal] === sug.token}
                        onChange={e => setAcceptedTokens(t => {
                          const next = { ...t };
                          if (e.target.checked) next[sug.literal] = sug.token;
                          else delete next[sug.literal];
                          return next;
                        })}
                      />
                      <span style={{ color: 'rgba(238,238,248,0.85)' }}>
                        Replace <code className="font-mono px-1 rounded" style={{ background: 'rgba(255,255,255,0.06)' }}>{sug.literal}</code> with <code className="font-mono px-1 rounded" style={{ background: 'rgba(139,92,246,0.18)', color: '#c4b5fd' }}>{sug.token}</code>
                        <span className="block text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>{sug.reason}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
              {steps.length} step{steps.length === 1 ? '' : 's'} will be {testIdParam ? 'appended to the existing test' : 'saved as a new test'}.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSaveModalOpen(false)}>Cancel</Button>
              <Button
                onClick={() => { save(); setSaveModalOpen(false); }}
                loading={saveAppend.isPending || saveNew.isPending}
              >
                {testIdParam ? 'Append' : 'Save Test'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Idle preview (before recording starts) ──────────────────────────────────

function IdlePreview({
  env,
  testIdParam,
  steps,
}: {
  env?: { name: string; baseUrl: string };
  testIdParam: string | null;
  steps?: CapturedStep[];
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-12 text-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}>
        <span className="w-3 h-3 rounded-full" style={{ background: 'white' }} />
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: 'rgba(238,238,248,0.92)' }}>
        {testIdParam ? 'Ready to append' : 'Ready to record'}
      </h2>
      <p className="text-sm max-w-sm mb-6" style={{ color: 'rgba(238,238,248,0.55)' }}>
        {env
          ? <>Will load <code className="font-mono">{env.baseUrl}</code> in the preview pane and capture every click, fill, navigation, and key press.</>
          : 'Pick an environment from the top bar to start.'}
      </p>
      {testIdParam && steps && steps.length > 0 && (
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          New steps will be appended after the existing {steps.length}.
        </p>
      )}
    </div>
  );
}

// ── Bookmarklet fallback ────────────────────────────────────────────────────

function BookmarkletFallback({ startUrl }: { startUrl: string }) {
  // The bookmarklet — copy-pastes the capture script into the page on click.
  // Same script the iframe path uses; lives at /test-recorder.js.
  const recorderScriptUrl = `${window.location.origin}/test-recorder.js`;
  const bookmarklet = `javascript:void(fetch(${JSON.stringify(recorderScriptUrl)}).then(r=>r.text()).then(t=>{var s=document.createElement('script');s.text=t;document.documentElement.appendChild(s);}));`;

  return (
    <div className="h-full flex flex-col items-center justify-center p-12 text-center overflow-y-auto" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(251,191,36,0.18)' }}>
        <AlertTriangle size={20} style={{ color: '#fbbf24' }} />
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: 'rgba(238,238,248,0.92)' }}>App can't be embedded</h2>
      <p className="text-sm max-w-md mb-6" style={{ color: 'rgba(238,238,248,0.60)' }}>
        Your app sends <code className="font-mono">X-Frame-Options: DENY</code>. We'll record it in a new tab via a bookmarklet — drag the button below to your bookmarks bar, then open the app and click the bookmark.
      </p>
      <div className="space-y-3 max-w-md w-full">
        <a
          href={bookmarklet}
          onClick={e => e.preventDefault()}
          draggable
          className="block px-4 py-3 rounded-lg font-mono text-xs cursor-grab active:cursor-grabbing"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: 'white', textAlign: 'center' }}
        >
          ● QA Recorder — drag me to bookmarks bar
        </a>
        <Button variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(bookmarklet); toast.success('Bookmarklet copied'); }}>
          <Copy size={12} className="mr-1" /> Copy bookmarklet code
        </Button>
        <a
          href={startUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block px-4 py-2 rounded-lg text-sm"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
        >
          <ExternalLink size={12} className="inline mr-1.5" /> Open {startUrl} in new tab
        </a>
        <p className="text-[11px] mt-3" style={{ color: 'rgba(238,238,248,0.40)' }}>
          The recorder window stays open here — captured steps appear in the right pane in real time.
        </p>
      </div>
    </div>
  );
}

// ── Step row ────────────────────────────────────────────────────────────────

const TYPE_COLOURS: Record<string, string> = {
  NAVIGATE: '#60a5fa',
  CLICK: '#a78bfa',
  FILL: '#34d399',
  SELECT: '#fbbf24',
  CHECK: '#34d399',
  UNCHECK: '#9ca3af',
  KEYBOARD: '#f472b6',
  HOVER: '#9ca3af',
  SCROLL: '#9ca3af',
};

function StepRow({ step, index, onDelete }: { step: CapturedStep; index: number; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const colour = TYPE_COLOURS[step.type] ?? 'rgba(238,238,248,0.6)';
  const value = (step.input?.value ?? step.input?.url ?? step.input?.key ?? '') as string;
  const sel = step.input?.selector as string | undefined;
  return (
    <div
      className="rounded-md text-xs"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <GripVertical size={11} style={{ color: 'rgba(238,238,248,0.25)' }} />
        <span className="font-mono w-5 text-center" style={{ color: 'rgba(238,238,248,0.40)' }}>{index + 1}</span>
        <span className="font-mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${colour}20`, color: colour }}>{step.type}</span>
        <span className="flex-1 truncate" style={{ color: 'rgba(238,238,248,0.85)' }}>{step.name}</span>
        <button onClick={() => setOpen(o => !o)} className="p-0.5" title="Toggle details">
          <Eye size={11} style={{ color: 'rgba(238,238,248,0.45)' }} />
        </button>
        <button onClick={onDelete} className="p-0.5" title="Delete step">
          <Trash2 size={11} style={{ color: 'rgba(239,68,68,0.7)' }} />
        </button>
      </div>
      {open && (
        <div className="px-3 pb-2 space-y-1 text-[11px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
          {sel && <div><span className="opacity-60">selector:</span> <code className="font-mono">{sel}</code></div>}
          {value !== '' && <div><span className="opacity-60">value:</span> <code className="font-mono">{String(value)}</code></div>}
        </div>
      )}
    </div>
  );
}

// ── Apply user-accepted tokenisations to all steps before save ─────────────

function applyTokens(steps: CapturedStep[], tokens: Record<string, string>): CapturedStep[] {
  if (Object.keys(tokens).length === 0) return steps;
  return steps.map(s => {
    if (!s.input) return s;
    const newInput: Record<string, unknown> = { ...s.input };
    for (const k of Object.keys(newInput)) {
      const v = newInput[k];
      if (typeof v === 'string') {
        let nv = v;
        for (const [literal, token] of Object.entries(tokens)) {
          if (nv.includes(literal)) nv = nv.split(literal).join(token);
        }
        newInput[k] = nv;
      }
    }
    return { ...s, input: newInput };
  });
}
