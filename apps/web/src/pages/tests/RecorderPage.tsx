import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  ArrowLeft, Square, Pause, Trash2, GripVertical, ExternalLink,
  Copy, AlertTriangle, Save, Eye, Download, HelpCircle, Play,
  CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { environmentsApi, testsApi, recorderApi, runsApi, getFreshToken, API_BASE } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { LiveBrowserCanvas } from '@/components/LiveBrowserCanvas';
import { compactSteps, injectWaits, suggestTokenisations, type CapturedStep } from './recorderUtils';

// Socket.IO connects SAME-ORIGIN — no explicit host/port. The gateway runs
// on api:3002, but both the Vite dev proxy and the prod nginx proxy forward
// `/socket.io/` there. A relative `io('/recorder')` therefore works in dev
// (ws://localhost:3000) and prod (wss://<domain>) with no env vars and no
// mixed-content issue on HTTPS.

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

  type PairStatus = 'idle' | 'connecting' | 'waiting' | 'paired' | 'recorder-gone' | 'error';

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [steps, setSteps] = useState<CapturedStep[]>([]);
  // Between-step wait inserted at Stop time. Makes recordings more robust at
  // replay — most flaky failures are "selector not yet present" on the step
  // right after a click/nav that triggered a re-render. User can change or
  // zero this out in the top bar before stopping.
  const [stepDelayMs, setStepDelayMs] = useState(500);
  const [session, setSession] = useState<{ id: string; code: string } | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatus>('idle');
  const startedAtRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const authToken = useAuthStore(s => s.token);

  // ── Extension detection ────────────────────────────────────────────────
  //
  // The Chrome extension's content script (running on every page including
  // this one) listens for window.postMessage({kind:'qa-recorder:ping'}) and
  // replies with {kind:'qa-recorder:pong', version}. We use that to decide
  // whether to show the install flow or the normal record button.
  //
  // States:
  //   'checking' — first poll outstanding (briefly, ~600ms)
  //   'missing'  — no reply, show install flow
  //   'ready'    — extension responded, version stored

  type ExtState =
    | { kind: 'checking' }
    | { kind: 'missing' }
    | { kind: 'ready'; version: string };

  const [extState, setExtState] = useState<ExtState>({ kind: 'checking' });

  const probeExtension = useMemo(
    () => (timeoutMs = 800) => new Promise<{ version: string } | null>(resolve => {
      let done = false;
      function onMessage(e: MessageEvent) {
        if (e.source !== window) return;
        const d = e.data;
        if (!d || typeof d !== 'object') return;
        if (d.kind === 'qa-recorder:pong' || d.kind === 'qa-recorder:hello') {
          if (done) return;
          done = true;
          window.removeEventListener('message', onMessage);
          resolve({ version: String(d.version ?? '?') });
        }
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ kind: 'qa-recorder:ping' }, '*');
      setTimeout(() => {
        if (done) return;
        done = true;
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, timeoutMs);
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setExtState({ kind: 'checking' });
    probeExtension().then((r) => {
      if (cancelled) return;
      setExtState(r ? { kind: 'ready', version: r.version } : { kind: 'missing' });
    });
    // Also passively pick up the hello-on-load broadcast in case the user
    // installs the extension while sitting on this page (after refresh, a
    // fresh content script will broadcast hello).
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.kind === 'qa-recorder:hello' && !cancelled) {
        setExtState({ kind: 'ready', version: String(d.version ?? '?') });
      }
    };
    window.addEventListener('message', onMessage);
    return () => { cancelled = true; window.removeEventListener('message', onMessage); };
  }, [probeExtension]);

  async function reVerifyExtension() {
    setExtState({ kind: 'checking' });
    const r = await probeExtension(1500);
    setExtState(r ? { kind: 'ready', version: r.version } : { kind: 'missing' });
    if (r) {
      toast.success(`Extension detected (v${r.version})`);
    } else {
      // The single most common cause: tab was open when the extension was
      // installed, so the content script never attached here. Tell the user
      // exactly what to do — most won't notice the "reload page first"
      // sub-text in step 5.
      toast.error('Not detected. Click "Reload page" then try again — Chrome only attaches the content script to fresh page loads.');
    }
  }

  // Socket.IO connection to the /recorder namespace. Established when the
  // user clicks Record, torn down on Stop or unmount. The actual capture
  // happens in the Chrome extension's content script — see
  // apps/recorder-extension. We only receive paired-step events here.
  //
  // Auth: we DON'T use the raw token from the auth store — it may be
  // expired and the gateway would reject viewer:join with "jwt expired"
  // (which we'd see as a confusing "Connection error" toast). Use
  // getFreshToken() instead, which refreshes-if-needed via the same
  // pipeline as HTTP requests and redirects to /login on hard auth failure.
  useEffect(() => {
    if (!recording || !session || !authToken) return;
    let sock: Socket | null = null;
    let cancelled = false;

    async function connect() {
      const token = await getFreshToken();
      if (cancelled) return;
      if (!token) {
        // getFreshToken already redirected to /login on failure.
        return;
      }
      sock = io('/recorder', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
      socketRef.current = sock;
      setPairStatus('connecting');

      sock.on('connect', () => {
        sock!.emit('viewer:join', { sessionId: session!.id, token });
      });
      sock.on('viewer:joined', () => setPairStatus('waiting'));
      sock.on('peer:connected', (msg: { role: string }) => {
        if (msg.role === 'recorder') {
          setPairStatus('paired');
          toast.success('Extension paired — start interacting on the target site');
        }
      });
      sock.on('peer:disconnected', (msg: { role: string }) => {
        if (msg.role === 'recorder') setPairStatus('recorder-gone');
      });
      sock.on('step', (msg: { step: CapturedStep }) => {
        if (msg?.step) setSteps(prev => [...prev, msg.step]);
      });
      sock.on('error', async (err: { message?: string }) => {
        console.warn('[recorder] socket error', err);
        // If the gateway rejected our join because the token expired (rare,
        // since we just refreshed above — happens if the user left a tab
        // open across the full refresh-token lifetime), force a fresh
        // refresh + reconnect. If refresh fails, getFreshToken bounces to
        // /login on its own.
        const msg = err?.message ?? '';
        if (/expired/i.test(msg)) {
          const fresh = await getFreshToken(0);
          if (fresh && socketRef.current && session) {
            socketRef.current.emit('viewer:join', { sessionId: session.id, token: fresh });
            return;
          }
        }
        setPairStatus('error');
        toast.error(msg || 'Recorder error');
      });
      sock.on('session:expired', () => {
        toast.error('Recording session expired — start a new one');
        setPairStatus('error');
      });
      sock.on('disconnect', () => {
        if (recording) setPairStatus('error');
      });
    }
    connect();

    return () => {
      cancelled = true;
      sock?.disconnect();
      socketRef.current = null;
    };
  }, [recording, session, authToken]);

  const sessionMut = useMutation({
    mutationFn: () => recorderApi.createSession(),
    onSuccess: (s) => {
      setSession({ id: s.id, code: s.code });
      setRecording(true);
      setPaused(false);
      startedAtRef.current = Date.now();
    },
    onError: () => toast.error('Could not start session — try again'),
  });

  function startRecording() {
    if (!env) {
      toast.error('Pick an environment first');
      return;
    }
    setSteps([]);
    setSession(null);
    setPairStatus('idle');
    sessionMut.mutate();
  }

  function stopRecording() {
    setRecording(false);
    setPaused(false);
    setPairStatus('idle');
    setSession(null);
    // Compact AFTER stop — see recorderUtils.compactSteps for the rules
    // (drop scroll-jitter, coalesce typing, drop hover-before-click, etc.).
    // Then inject between-step waits using the user's current delay setting.
    setSteps(prev => injectWaits(compactSteps(prev), stepDelayMs));
  }

  function togglePause() {
    if (!socketRef.current) return;
    const action = paused ? 'resume' : 'pause';
    socketRef.current.emit('control', { action });
    setPaused(p => !p);
  }

  // ── Target URL ─────────────────────────────────────────────────────────

  const startUrl = useMemo(() => {
    if (!env) return null;
    return env.baseUrl.replace(/\/$/, '') + '/';
  }, [env]);

  // ── Save flow ──────────────────────────────────────────────────────────

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [newTestName, setNewTestName] = useState('Recorded test');
  const tokenSuggestions = useMemo(
    () => env ? suggestTokenisations(steps, env.baseUrl) : [],
    [steps, env],
  );
  const [acceptedTokens, setAcceptedTokens] = useState<Record<string, string>>({});

  // ── Preview run ────────────────────────────────────────────────────────
  //
  // Saves the current steps as a regular test (prefixed `[Preview]`),
  // triggers an automated run on the selected env, and shows the result in
  // a modal. The user then chooses to Keep (rename, navigate to editor) or
  // Discard (archive the test, throw away the run).
  //
  // Reuses the existing test + run infrastructure; no backend changes.

  const [previewState, setPreviewState] = useState<
    | { kind: 'idle' }
    | { kind: 'starting' }
    | { kind: 'running'; testId: string; runId: string; intendedName: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  async function startPreviewRun() {
    if (!env || steps.length === 0) {
      toast.error(steps.length === 0 ? 'Nothing to preview — record some steps first' : 'Pick an environment first');
      return;
    }
    setPreviewState({ kind: 'starting' });
    try {
      const finalSteps = applyTokens(steps, acceptedTokens);
      const intendedName = newTestName.trim() || 'Recorded test';
      // Step 1: persist as a regular test, prefixed so it's easy to spot
      // (and to discard later if user picks Discard).
      const created = await testsApi.create(projectId!, {
        name: `[Preview] ${intendedName}`,
        type: 'UI',
        tags: ['recorded', 'preview'],
        steps: finalSteps,
        config: {},
        featureId: featureId ?? undefined,
      }) as { id: string };
      // Step 2: kick off the automated run.
      const run = await runsApi.trigger(projectId!, {
        testDefinitionId: created.id,
        environmentId: envId,
        runMode: 'AUTOMATED',
      }) as { id: string };
      setPreviewState({ kind: 'running', testId: created.id, runId: run.id, intendedName });
    } catch (e) {
      const message = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (e as Error).message
        ?? 'Failed to start preview run';
      setPreviewState({ kind: 'error', message });
      toast.error(message);
    }
  }

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
          <label
            className="flex items-center gap-1.5 text-[11px] rounded-md px-2 py-1"
            title="A WAIT_MS step is auto-inserted between every captured step at Stop. Use 0 to disable, or edit individual waits in the step list."
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.55)' }}
          >
            <span>Step delay</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={100}
              value={stepDelayMs}
              onChange={e => setStepDelayMs(Math.max(0, Math.min(10000, Number(e.target.value) || 0)))}
              disabled={recording}
              className="w-14 rounded px-1.5 py-0.5 text-xs"
              style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
            />
            <span>ms</span>
          </label>
          <button
            onClick={() => setHelpOpen(true)}
            title="Recorder help & troubleshooting"
            className="p-1.5 rounded-md transition-colors hover:bg-white/10"
            style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
          >
            <HelpCircle size={14} />
          </button>
          {!recording ? (
            <Button
              size="sm"
              onClick={startRecording}
              disabled={!env || extState.kind !== 'ready'}
              title={extState.kind !== 'ready' ? 'Install the QA Recorder extension to start recording' : undefined}
            >
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
          <Button
            size="sm"
            variant="secondary"
            onClick={startPreviewRun}
            disabled={steps.length === 0 || recording || !env || previewState.kind !== 'idle'}
            title="Run the captured steps against the selected environment without saving — you can keep or discard the result after"
          >
            <Play size={12} className="mr-1" /> Preview Run
          </Button>
          <Button size="sm" onClick={() => setSaveModalOpen(true)} disabled={steps.length === 0 || recording}>
            <Save size={12} className="mr-1" /> Save…
          </Button>
        </div>
      </div>

      {/* Main split */}
      <div className="flex-1 grid grid-cols-[1fr_400px] min-h-0">
        {/* Pairing panel — no more iframe. The Chrome extension captures
            directly on whichever tab the user is on. */}
        <div className="relative">
          {recording ? (
            <ExtensionPairingPanel
              code={session?.code ?? null}
              status={pairStatus}
              targetUrl={startUrl ?? ''}
              onShowHelp={() => setHelpOpen(true)}
            />
          ) : extState.kind === 'missing' ? (
            <InstallExtensionPanel onVerify={reVerifyExtension} checking={false} />
          ) : extState.kind === 'checking' ? (
            <InstallExtensionPanel onVerify={reVerifyExtension} checking={true} />
          ) : (
            <IdlePreview
              env={env}
              testIdParam={testIdParam}
              steps={existingTest?.steps as CapturedStep[] | undefined}
              extensionVersion={extState.version}
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
                  onUpdate={(next) => setSteps(prev => prev.map((p, j) => (j === i ? next : p)))}
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

      {helpOpen && (
        <HelpModal
          onClose={() => setHelpOpen(false)}
          installed={extState.kind === 'ready'}
          extensionVersion={extState.kind === 'ready' ? extState.version : undefined}
          onReverify={reVerifyExtension}
        />
      )}

      {previewState.kind !== 'idle' && previewState.kind !== 'error' && (
        <PreviewRunModal
          state={previewState}
          projectId={projectId!}
          onClose={() => setPreviewState({ kind: 'idle' })}
          onKept={(testId) => {
            setPreviewState({ kind: 'idle' });
            navigate(`/projects/${projectId}/tests/${testId}/edit`);
          }}
          onDiscarded={() => setPreviewState({ kind: 'idle' })}
        />
      )}
    </div>
  );
}

// ── Idle preview (before recording starts) ──────────────────────────────────

function IdlePreview({
  env,
  testIdParam,
  steps,
  extensionVersion,
}: {
  env?: { name: string; baseUrl: string };
  testIdParam: string | null;
  steps?: CapturedStep[];
  extensionVersion?: string;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-12 text-center" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)' }}>
        <span className="w-3 h-3 rounded-full" style={{ background: 'white' }} />
      </div>
      <h2 className="text-lg font-bold mb-2" style={{ color: 'rgba(238,238,248,0.92)' }}>
        {testIdParam ? 'Ready to append' : 'Ready to record'}
      </h2>
      <p className="text-sm max-w-sm mb-3" style={{ color: 'rgba(238,238,248,0.55)' }}>
        {env
          ? <>Press <strong>Record</strong>, then pair the QA Recorder extension and start interacting with <code className="font-mono">{env.baseUrl}</code> in a new tab.</>
          : 'Pick an environment from the top bar to start.'}
      </p>
      {extensionVersion && (
        <div className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full mt-2" style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)', color: '#10b981' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#10b981' }} />
          QA Recorder extension v{extensionVersion} detected
        </div>
      )}
      {testIdParam && steps && steps.length > 0 && (
        <p className="text-xs mt-4" style={{ color: 'rgba(238,238,248,0.40)' }}>
          New steps will be appended after the existing {steps.length}.
        </p>
      )}
    </div>
  );
}

// ── Install extension panel ─────────────────────────────────────────────────
//
// Shown when the page loads and the extension isn't detected. Walks the user
// through: download zip → unpack → load unpacked → reload this page → verify.

function InstallExtensionPanel({
  onVerify, checking,
}: { onVerify: () => void; checking: boolean }) {
  const downloadUrl = `${API_BASE}/api/v1/recorder/extension.zip`;
  return (
    <div className="h-full flex flex-col items-center justify-center p-12 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl mb-3" style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' }}>
            <Download size={20} style={{ color: 'white' }} />
          </div>
          <h2 className="text-lg font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Install the QA Recorder extension
          </h2>
          <p className="text-sm mt-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
            One-time setup. Lets you record tests on any site, including ones that block iframes.
          </p>
        </div>

        <a
          href={downloadUrl}
          download="qa-recorder-extension.zip"
          className="block w-full text-center px-4 py-3 rounded-lg font-semibold text-sm"
          style={{ background: 'linear-gradient(135deg, #7c3aed, #5b21b6)', color: 'white' }}
        >
          <Download size={14} className="inline mr-1.5" />
          Download extension (.zip)
        </a>

        <ol className="space-y-3 text-sm" style={{ color: 'rgba(238,238,248,0.75)' }}>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>1.</span>
            <span>Download the zip above and unpack it to a permanent folder on your machine (e.g. <code className="font-mono text-[12px]" style={{ background: 'rgba(255,255,255,0.06)', padding: '0 4px', borderRadius: '3px' }}>~/qa-recorder-extension</code>).</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>2.</span>
            <div className="flex-1">
              <div>
                Open a new tab and paste this into the address bar:
                <CopyableUrl url="chrome://extensions" />
              </div>
              <div className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Chrome blocks websites from opening <code className="font-mono">chrome://</code> links — you have to paste it yourself. <kbd className="font-mono px-1.5 py-0.5 rounded text-[10.5px]" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>⌘T</kbd> opens a new tab, paste, press Enter.
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>3.</span>
            <span>Toggle <strong>Developer mode</strong> on (top-right of the Extensions page).</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>4.</span>
            <span>Click <strong>Load unpacked</strong> and pick the unpacked folder.</span>
          </li>
          <li className="flex gap-3 items-start" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 8, padding: '8px 10px' }}>
            <span className="font-mono font-bold w-5" style={{ color: '#fbbf24' }}>5.</span>
            <div>
              <strong style={{ color: '#fbbf24' }}>Come back to this tab and reload it</strong> (<kbd className="font-mono px-1.5 py-0.5 rounded text-[10.5px]" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>⌘R</kbd> or click the button below).
              <div className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
                Chrome only attaches the recorder to pages that load <em>after</em> the extension was installed — this tab was open before, so it has to be refreshed.
              </div>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>6.</span>
            <span>After reload, click <strong>Verify installation</strong> below — you should see a green badge.</span>
          </li>
        </ol>

        <div className="flex gap-2">
          <Button
            onClick={() => window.location.reload()}
            className="flex-1"
            title="Reload this page so the extension's content script attaches"
          >
            <span className="inline-block mr-2">↻</span>
            Reload page now
          </Button>
          <Button
            variant="secondary"
            onClick={onVerify}
            disabled={checking}
          >
            {checking ? (
              <>
                <span className="inline-block w-3 h-3 rounded-full mr-2 animate-pulse" style={{ background: '#fbbf24' }} />
                Checking…
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full mr-2 inline-block" style={{ background: '#10b981' }} />
                Verify installation
              </>
            )}
          </Button>
        </div>

        <p className="text-[11px] text-center" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Chrome only for now. Firefox / Edge ports coming soon.
        </p>
      </div>
    </div>
  );
}

// ── Extension pairing panel ─────────────────────────────────────────────────
//
// The Chrome extension owns the actual capture — see apps/recorder-extension.
// This panel just walks the user through pairing:
//   1. Install the extension (one time)
//   2. Open the target app in a new tab
//   3. Click the extension icon → type the code below → "Start recording"
//
// Replaced the old iframe + bookmarklet approach which silently dropped every
// captured step because BroadcastChannel is same-origin.

type PanelPairStatus = 'idle' | 'connecting' | 'waiting' | 'paired' | 'recorder-gone' | 'error';

function ExtensionPairingPanel({
  code, status, targetUrl, onShowHelp,
}: { code: string | null; status: PanelPairStatus; targetUrl: string; onShowHelp: () => void }) {
  const statusMeta = {
    idle:             { dot: '#9ca3af', label: 'Idle' },
    connecting:       { dot: '#fbbf24', label: 'Opening session…' },
    waiting:          { dot: '#fbbf24', label: 'Waiting for extension to pair' },
    paired:           { dot: '#10b981', label: 'Extension paired — recording live' },
    'recorder-gone':  { dot: '#ef4444', label: 'Extension disconnected' },
    error:            { dot: '#ef4444', label: 'Connection error' },
  }[status];

  return (
    <div className="h-full flex flex-col items-center justify-center p-12 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="max-w-md w-full space-y-5">
        {/* Status pill */}
        <div className="flex items-center justify-center gap-2 text-xs">
          <span className="w-2 h-2 rounded-full" style={{ background: statusMeta.dot }} />
          <span style={{ color: 'rgba(238,238,248,0.75)' }}>{statusMeta.label}</span>
        </div>

        {/* Session code — the prominent bit */}
        <div className="text-center space-y-2">
          <div className="text-[10px] uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Session code
          </div>
          <div
            className="font-mono font-bold tracking-[0.3em] py-5 rounded-xl"
            style={{
              fontSize: '32px',
              background: 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(91,33,182,0.15))',
              border: '1px solid rgba(124,58,237,0.30)',
              color: status === 'paired' ? '#10b981' : '#a78bfa',
              transition: 'color 0.3s',
            }}
          >
            {code ?? '······'}
          </div>
          {code && (
            <button
              onClick={() => { navigator.clipboard.writeText(code); toast.success('Code copied'); }}
              className="inline-flex items-center gap-1.5 text-[11px]"
              style={{ color: 'rgba(238,238,248,0.55)' }}
            >
              <Copy size={11} /> Copy code
            </button>
          )}
        </div>

        {/* Steps */}
        <ol className="space-y-2.5 text-sm" style={{ color: 'rgba(238,238,248,0.75)' }}>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>1.</span>
            <span>
              Install the <strong>QA Platform Recorder</strong> Chrome extension.{' '}
              <button
                onClick={onShowHelp}
                className="underline"
                style={{ color: '#a78bfa' }}
              >
                <Download size={11} className="inline" /> Install instructions
              </button>
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>2.</span>
            <span>
              Open the target app in a new tab.{' '}
              {targetUrl && (
                <a href={targetUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#a78bfa' }}>
                  <ExternalLink size={11} className="inline" /> Open {targetUrl}
                </a>
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>3.</span>
            <span>Click the extension icon, paste the code above, then press <strong>Start recording this tab</strong>.</span>
          </li>
          <li className="flex gap-3">
            <span className="font-mono font-bold w-5" style={{ color: '#a78bfa' }}>4.</span>
            <span>Interact with the app. Steps appear in this window in real time.</span>
          </li>
        </ol>

        {status === 'recorder-gone' && (
          <div className="p-3 rounded-lg text-xs" style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>
            <AlertTriangle size={12} className="inline mr-1.5" />
            The extension dropped — re-open it and click <em>Start recording this tab</em> again.
          </div>
        )}
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
  WAIT: '#94a3b8',
  WAIT_MS: '#94a3b8',
};

function StepRow({
  step, index, onDelete, onUpdate,
}: {
  step: CapturedStep;
  index: number;
  onDelete: () => void;
  onUpdate: (next: CapturedStep) => void;
}) {
  const [open, setOpen] = useState(false);
  const colour = TYPE_COLOURS[step.type] ?? 'rgba(238,238,248,0.6)';
  const value = (step.input?.value ?? step.input?.url ?? step.input?.key ?? '') as string;
  const sel = step.input?.selector as string | undefined;
  const isWait = step.type === 'WAIT_MS' || step.type === 'WAIT';
  const ms = (step.input?.ms ?? step.input?.duration ?? 0) as number;

  return (
    <div
      className="rounded-md text-xs"
      style={{
        background: isWait ? 'rgba(148,163,184,0.05)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${isWait ? 'rgba(148,163,184,0.15)' : 'rgba(255,255,255,0.06)'}`,
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <GripVertical size={11} style={{ color: 'rgba(238,238,248,0.25)' }} />
        <span className="font-mono w-5 text-center" style={{ color: 'rgba(238,238,248,0.40)' }}>{index + 1}</span>
        <span className="font-mono px-1.5 py-0.5 rounded text-[10px]" style={{ background: `${colour}20`, color: colour }}>{step.type}</span>
        {isWait ? (
          <div className="flex-1 flex items-center gap-1.5">
            <span style={{ color: 'rgba(238,238,248,0.65)' }}>Wait</span>
            <input
              type="number"
              min={0}
              max={60000}
              step={50}
              value={ms}
              onChange={(e) => {
                const next = Math.max(0, Math.min(60000, Number(e.target.value) || 0));
                onUpdate({
                  ...step,
                  name: `Wait ${next}ms`,
                  input: { ...step.input, ms: next },
                });
              }}
              className="w-16 rounded px-1.5 py-0.5 text-xs font-mono"
              style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.85)' }}
            />
            <span style={{ color: 'rgba(238,238,248,0.55)' }}>ms</span>
          </div>
        ) : (
          <span className="flex-1 truncate" style={{ color: 'rgba(238,238,248,0.85)' }}>{step.name}</span>
        )}
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
          {isWait && <div><span className="opacity-60">ms:</span> <code className="font-mono">{ms}</code></div>}
        </div>
      )}
    </div>
  );
}

// ── Helper: pasteable chrome:// URL ─────────────────────────────────────────
//
// Chrome blocks websites from opening `chrome://` URLs via JS or anchor tags.
// The next-best UX is "click to copy, then paste into a new tab" — this
// component renders the URL as a styled chip with a one-tap copy button.

function CopyableUrl({ url, label }: { url: string; label?: string }) {
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(url); toast.success(`Copied: ${url}`); }}
      title="Copy — then ⌘T to open a new tab and paste"
      className="inline-flex items-center gap-1.5 font-mono text-[12px] px-2 py-1 rounded-md mx-1 align-middle"
      style={{
        background: 'rgba(124,58,237,0.12)',
        border: '1px solid rgba(124,58,237,0.30)',
        color: '#c4b5fd',
        cursor: 'pointer',
      }}
    >
      <Copy size={11} />
      {label ?? url}
    </button>
  );
}

// ── Help / troubleshooting modal ────────────────────────────────────────────
//
// Web pages cannot programmatically uninstall a Chrome extension — Chrome's
// security model only allows the user to remove extensions via the
// chrome://extensions page. So this modal is purely informational: it walks
// the user through every operation they might want to do (uninstall,
// reinstall, update, debug) and provides one-click links into the relevant
// Chrome internal pages.

function HelpModal({
  onClose, installed, extensionVersion, onReverify,
}: {
  onClose: () => void;
  installed: boolean;
  extensionVersion?: string;
  onReverify: () => void;
}) {
  const downloadUrl = `${API_BASE}/api/v1/recorder/extension.zip`;
  // Chrome blocks JS from window.open()-ing chrome:// URLs, so we render
  // these as copyable chips — click to copy, paste into a new tab.
  const ExtUrl = () => <CopyableUrl url="chrome://extensions" />;

  return (
    <Modal open onClose={onClose} title="Recorder help & troubleshooting" size="lg">
      <div className="space-y-5 text-sm" style={{ color: 'rgba(238,238,248,0.85)' }}>
        {/* Status banner */}
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px]"
          style={{
            background: installed ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
            border: `1px solid ${installed ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)'}`,
            color: installed ? '#10b981' : '#fca5a5',
          }}
        >
          <span className="w-2 h-2 rounded-full" style={{ background: installed ? '#10b981' : '#ef4444' }} />
          {installed
            ? <>Extension detected (v{extensionVersion ?? '?'}).</>
            : <>Extension not detected on this page.</>}
          <button onClick={onReverify} className="ml-auto underline text-[11px]">Re-check</button>
        </div>

        {/* FAQ-style accordion */}
        <details open className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Install or reinstall
          </summary>
          <ol className="px-4 pb-3 space-y-1.5 text-[12.5px]" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li>
              <a href={downloadUrl} download className="underline" style={{ color: '#a78bfa' }}>
                <Download size={11} className="inline mr-1" /> Download the latest extension (.zip)
              </a>
            </li>
            <li>Unpack the zip somewhere permanent (e.g. <code className="font-mono text-[11.5px]" style={{ background: 'rgba(255,255,255,0.07)', padding: '0 4px', borderRadius: 3 }}>~/qa-recorder-extension</code>).</li>
            <li>
              Open a new tab (<kbd className="font-mono px-1.5 py-0.5 rounded text-[10.5px]" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>⌘T</kbd>) and paste <ExtUrl /> into the address bar, then turn <strong>Developer mode</strong> on (top-right).
            </li>
            <li>Click <strong>Load unpacked</strong> → pick the unpacked folder.</li>
            <li>Come back here and <button onClick={onReverify} className="underline" style={{ color: '#a78bfa' }}>re-verify</button>. Reload the page first if it doesn't detect.</li>
          </ol>
        </details>

        <details className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Uninstall the extension
          </summary>
          <ol className="px-4 pb-3 space-y-1.5 text-[12.5px]" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li>Open <ExtUrl /> in a new tab.</li>
            <li>Find <strong>QA Platform Recorder</strong> in the list.</li>
            <li>Click <strong>Remove</strong> → confirm.</li>
            <li className="text-[11.5px]" style={{ color: 'rgba(238,238,248,0.50)' }}>
              <AlertTriangle size={10} className="inline mr-1" />
              Chrome won't let websites uninstall extensions for you — this has to be a manual step.
            </li>
          </ol>
        </details>

        <details className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Update to the latest version
          </summary>
          <ol className="px-4 pb-3 space-y-1.5 text-[12.5px]" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li>
              <a href={downloadUrl} download className="underline" style={{ color: '#a78bfa' }}>Download</a> a fresh zip.
            </li>
            <li>Replace your existing unpacked folder's contents with the new files.</li>
            <li>Open <ExtUrl /> → find the extension → click its <strong>⟳ Reload</strong> button.</li>
            <li>Reload this page so the new content script attaches.</li>
          </ol>
        </details>

        <details className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Recording isn't capturing steps
          </summary>
          <ul className="px-4 pb-3 space-y-1.5 text-[12.5px] list-disc list-inside" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li>Make sure the QA Recorder icon in your toolbar is set to <strong>● paired</strong> (green dot).</li>
            <li>Open the extension popup on the <em>target site's tab</em> (not on this platform tab) and click <strong>Start recording this tab</strong>.</li>
            <li>If you navigated between sites, the extension auto-re-arms — but only if the new tab is still tracked. Open the popup and re-arm if needed.</li>
            <li>Check the browser console on the target page for any <code className="font-mono">[qa-recorder]</code> errors.</li>
          </ul>
        </details>

        <details className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Page is detected as not installed, but it IS installed
          </summary>
          <ul className="px-4 pb-3 space-y-1.5 text-[12.5px] list-disc list-inside" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li>Reload this page — Chrome only attaches content scripts on fresh page loads.</li>
            <li>Open <ExtUrl /> and make sure the extension is <strong>Enabled</strong> (not greyed out).</li>
            <li>In incognito mode? Enable the extension for incognito on the extensions page.</li>
            <li>If you just installed it, give Chrome a moment, then click <button onClick={onReverify} className="underline" style={{ color: '#a78bfa' }}>re-verify</button>.</li>
          </ul>
        </details>

        <details className="rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <summary className="cursor-pointer px-3 py-2 font-medium text-[13px]" style={{ color: 'rgba(238,238,248,0.92)' }}>
            Privacy & permissions
          </summary>
          <ul className="px-4 pb-3 space-y-1.5 text-[12.5px] list-disc list-inside" style={{ color: 'rgba(238,238,248,0.70)' }}>
            <li><strong>Password fields are redacted at capture time</strong> — the actual value never leaves the page.</li>
            <li>Capture is <strong>opt-in per tab</strong> — nothing is recorded until you explicitly arm a tab via the popup.</li>
            <li>Steps are sent only to your QA Platform API — nowhere else.</li>
            <li>The extension does not read cookies, storage, or network traffic — only DOM events.</li>
          </ul>
        </details>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Preview run modal ──────────────────────────────────────────────────────
//
// Polls a triggered run every second until it reaches a terminal state, then
// offers the user a choice: keep the test (rename to drop the [Preview]
// prefix + navigate to the editor) or discard (archive the test, throw the
// run away). Same UI shape no matter the outcome — even a failed run is
// useful for debugging selectors before saving.

type PreviewRunState =
  | { kind: 'starting' }
  | { kind: 'running'; testId: string; runId: string; intendedName: string };

type RunSummary = {
  id: string;
  status: 'PENDING' | 'QUEUED' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | string;
  startedAt?: string | null;
  completedAt?: string | null;
  duration?: number | null;
  errorMessage?: string | null;
};

type RunStepSummary = {
  id: string;
  index: number;
  type: string;
  name?: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'SKIPPED' | string;
  errorMessage?: string | null;
};

const TERMINAL = new Set(['PASSED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);

function PreviewRunModal({
  state, projectId, onClose, onKept, onDiscarded,
}: {
  state: PreviewRunState;
  projectId: string;
  onClose: () => void;
  onKept: (testId: string) => void;
  onDiscarded: () => void;
}) {
  const running = state.kind === 'running' ? state : null;
  const runId = running?.runId;
  const testId = running?.testId;

  // Poll the run + its steps every second until terminal. Short interval is
  // fine — runs are typically a few seconds, and the existing /runs/:id
  // endpoint is cheap.
  const runQ = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.get(runId!) as Promise<RunSummary>,
    enabled: !!runId,
    refetchInterval: (q) => {
      const data = q.state.data as RunSummary | undefined;
      return data && TERMINAL.has(data.status) ? false : 1000;
    },
  });
  const stepsQ = useQuery({
    queryKey: ['run-steps', runId],
    queryFn: () => runsApi.getSteps(runId!) as Promise<RunStepSummary[]>,
    enabled: !!runId,
    refetchInterval: (q) => {
      const run = runQ.data;
      return run && TERMINAL.has(run.status) ? false : 1000;
    },
  });

  const isTerminal = !!runQ.data && TERMINAL.has(runQ.data.status);
  const passed = runQ.data?.status === 'PASSED';

  const keepMut = useMutation({
    mutationFn: async () => {
      if (!running) return;
      // Strip the [Preview] prefix and clear the 'preview' tag.
      await testsApi.update(projectId, running.testId, {
        name: running.intendedName,
        tags: ['recorded'],
      });
    },
    onSuccess: () => {
      toast.success('Test saved');
      if (running) onKept(running.testId);
    },
    onError: () => toast.error('Save failed'),
  });

  const discardMut = useMutation({
    mutationFn: async () => {
      if (!running) return;
      await testsApi.archive(projectId, running.testId);
    },
    onSuccess: () => {
      toast.success('Preview discarded');
      onDiscarded();
    },
    onError: () => toast.error('Discard failed'),
  });

  // Stop the run mid-flight. The API marks the run CANCELLED; the worker's
  // 1-second abort watchdog notices and SIGKILLs the headless Chrome —
  // there's no orphaned Playwright process left behind.
  const stopMut = useMutation({
    mutationFn: async () => {
      if (!running) return;
      await runsApi.cancel(running.runId);
    },
    onSuccess: () => {
      toast.success('Run cancelled — worker is killing the browser');
      // Don't close the modal — let the user see the run hit CANCELLED, then
      // decide whether to Keep (with partial results) or Discard.
    },
    onError: (err) => {
      // Surface the actual server message — usually "Run is already
      // passed/failed — nothing to cancel" which is benign (the run
      // outpaced the cancel click). Show as info, not error, and force a
      // poll so the modal flips to terminal state right away.
      const status = (err as { response?: { status?: number } }).response?.status;
      const msg = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (err as Error).message
        ?? 'Cancel failed';
      if (status === 409) {
        toast.success('Run already finished');
      } else {
        toast.error(msg);
      }
      // Either way, refresh the run state so the modal stops showing the
      // "running" controls.
      runQ.refetch();
      stepsQ.refetch();
    },
  });

  return (
    <Modal open onClose={onClose} title="Preview run" size="lg">
      <div className="space-y-4">
        {/* Status banner */}
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{
            background: isTerminal
              ? (passed ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)')
              : 'rgba(124,58,237,0.10)',
            border: `1px solid ${isTerminal
              ? (passed ? 'rgba(16,185,129,0.30)' : 'rgba(239,68,68,0.30)')
              : 'rgba(124,58,237,0.30)'}`,
          }}
        >
          {state.kind === 'starting' ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ color: '#a78bfa' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  Starting preview…
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  Saving the captured steps and queueing the run.
                </div>
              </div>
            </>
          ) : !isTerminal ? (
            <>
              <Loader2 size={18} className="animate-spin" style={{ color: '#a78bfa' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  {runQ.data?.status ?? 'Pending…'}
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  Worker is executing your recorded steps in headless Chrome.
                </div>
              </div>
            </>
          ) : passed ? (
            <>
              <CheckCircle2 size={20} style={{ color: '#10b981' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#10b981' }}>Passed</div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  All steps replayed cleanly{runQ.data?.duration != null && ` in ${(runQ.data.duration / 1000).toFixed(1)}s`}.
                </div>
              </div>
            </>
          ) : (
            <>
              <XCircle size={20} style={{ color: '#ef4444' }} />
              <div>
                <div className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                  {runQ.data?.status ?? 'Failed'}
                </div>
                <div className="text-[12px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
                  {runQ.data?.errorMessage || 'One or more steps did not replay successfully — see breakdown below.'}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Live browser view — streams the headless Chrome via the
            /screencast Socket.IO namespace. Only render while the run is
            actually executing; after terminal state the canvas would just
            show the last frame, which is misleading. */}
        {runId && !isTerminal && (
          <div
            className="rounded-lg overflow-hidden"
            style={{ background: '#000', border: '1px solid rgba(255,255,255,0.08)', aspectRatio: '16 / 10' }}
          >
            <LiveBrowserCanvas runId={runId} active={!isTerminal} />
          </div>
        )}

        {/* Steps table */}
        {stepsQ.data && stepsQ.data.length > 0 && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="grid grid-cols-[36px_60px_1fr_72px] text-[10px] uppercase tracking-wider px-3 py-2"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.50)' }}>
              <div>#</div>
              <div>Type</div>
              <div>Step</div>
              <div className="text-right">Status</div>
            </div>
            <div className="max-h-[260px] overflow-y-auto">
              {stepsQ.data
                .slice()
                .sort((a, b) => a.index - b.index)
                .map((s) => (
                <div key={s.id} className="grid grid-cols-[36px_60px_1fr_72px] items-center px-3 py-2 text-xs border-t"
                  style={{ borderColor: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.80)' }}>
                  <div className="font-mono" style={{ color: 'rgba(238,238,248,0.40)' }}>{s.index + 1}</div>
                  <div className="font-mono text-[10px]" style={{ color: TYPE_COLOURS[s.type] ?? 'rgba(238,238,248,0.6)' }}>{s.type}</div>
                  <div className="truncate">
                    <span>{s.name ?? s.type}</span>
                    {s.errorMessage && (
                      <div className="text-[11px] mt-0.5" style={{ color: '#fca5a5' }}>{s.errorMessage}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <StepStatusPill status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-2 pt-1">
          {!isTerminal ? (
            <>
              <Button variant="ghost" onClick={onClose} title="Close this modal — the run keeps going in the background. You can come back to it from the Runs list.">
                Run in background
              </Button>
              <Button
                variant="danger"
                onClick={() => stopMut.mutate()}
                loading={stopMut.isPending}
                disabled={stopMut.isPending}
                title="Cancel the run — the worker will SIGKILL the headless Chrome immediately so no compute is wasted"
              >
                <Square size={13} className="mr-1" /> Stop run
              </Button>
            </>
          ) : (
            <>
              {testId && (
                <a
                  href={`/runs/${runId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] underline self-center mr-auto"
                  style={{ color: 'rgba(238,238,248,0.55)' }}
                >
                  Open full run details ↗
                </a>
              )}
              <Button
                variant="danger"
                onClick={() => discardMut.mutate()}
                loading={discardMut.isPending}
                disabled={discardMut.isPending || keepMut.isPending}
              >
                <Trash2 size={13} className="mr-1" /> Discard
              </Button>
              <Button
                onClick={() => keepMut.mutate()}
                loading={keepMut.isPending}
                disabled={keepMut.isPending || discardMut.isPending}
              >
                <Save size={13} className="mr-1" /> Keep & open in editor
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function StepStatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    PASSED:  { bg: 'rgba(16,185,129,0.15)', fg: '#10b981', label: 'Passed' },
    FAILED:  { bg: 'rgba(239,68,68,0.15)',  fg: '#ef4444', label: 'Failed' },
    RUNNING: { bg: 'rgba(124,58,237,0.15)', fg: '#a78bfa', label: 'Running' },
    PENDING: { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(238,238,248,0.55)', label: 'Pending' },
    SKIPPED: { bg: 'rgba(251,191,36,0.15)', fg: '#fbbf24', label: 'Skipped' },
  };
  const m = map[status] ?? { bg: 'rgba(255,255,255,0.06)', fg: 'rgba(238,238,248,0.55)', label: status };
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: m.bg, color: m.fg }}>
      {m.label}
    </span>
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
