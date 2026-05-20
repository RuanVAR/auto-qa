/**
 * SelectorTester — modal for live-validating a selector against a target site
 * via the QA Recorder Chrome extension.
 *
 *   user clicks "Test selector" in the step editor
 *      → modal opens, creates a /recorder session
 *      → user pairs the extension popup with the code
 *      → user navigates to the target page (any tab the extension can see)
 *      → user clicks Test → roundtrips through socket → extension content
 *        script runs `document.querySelectorAll`, highlights matches, returns
 *        count + first 3 element samples
 *
 * Why this matters: the #1 debugging cost on recorded tests is brittle
 * selectors. Without this, the only way to verify a selector is to run the
 * full test in Playwright and wait for the failure 30s in.
 */
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { CheckCircle2, XCircle, Copy, Eye, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { recorderApi, getFreshToken, API_BASE } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';

const WS_URL = API_BASE.replace(/:\d+$/, '') + ':3002';

type PairStatus = 'idle' | 'connecting' | 'waiting' | 'paired' | 'error';

export interface SelectorTestResult {
  count: number;
  url?: string;
  error?: string;
  samples?: Array<{ tagName: string; text: string; outerHtml: string }>;
}

export function SelectorTester({
  selector, onClose,
}: {
  /** Pre-fill the selector field with this value. */
  selector: string;
  onClose: () => void;
}) {
  const authToken = useAuthStore((s) => s.token);
  const [sel, setSel] = useState(selector);
  const [session, setSession] = useState<{ id: string; code: string } | null>(null);
  const [status, setStatus] = useState<PairStatus>('idle');
  const [result, setResult] = useState<SelectorTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reqIdRef = useRef(0);

  // Open session immediately on mount.
  useEffect(() => {
    let cancelled = false;
    setStatus('connecting');
    recorderApi.createSession()
      .then((s) => { if (!cancelled) setSession({ id: s.id, code: s.code }); })
      .catch(() => {
        if (!cancelled) {
          setStatus('error');
          toast.error('Could not open session');
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Connect Socket.IO once we have a session + auth. Uses getFreshToken so
  // an expired JWT doesn't surface as a confusing "Connection error" — it
  // gets refreshed first via the same pipeline as HTTP requests.
  useEffect(() => {
    if (!session || !authToken) return;
    let sock: Socket | null = null;
    let cancelled = false;

    (async () => {
      const token = await getFreshToken();
      if (cancelled || !token) return;
      sock = io(`${WS_URL}/recorder`, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });
      socketRef.current = sock;
      sock.on('connect', () => {
        sock!.emit('viewer:join', { sessionId: session.id, token });
      });
      sock.on('viewer:joined', () => setStatus('waiting'));
      sock.on('peer:connected', (m: { role: string }) => {
        if (m.role === 'recorder') setStatus('paired');
      });
      sock.on('peer:disconnected', (m: { role: string }) => {
        if (m.role === 'recorder') setStatus('waiting');
      });
      sock.on('selector:test:result', (m: SelectorTestResult & { reqId: string }) => {
        setTesting(false);
        setResult(m);
      });
      sock.on('error', async (err: { message?: string }) => {
        const msg = err?.message ?? '';
        if (/expired/i.test(msg)) {
          const fresh = await getFreshToken(0);
          if (fresh && socketRef.current) {
            socketRef.current.emit('viewer:join', { sessionId: session.id, token: fresh });
            return;
          }
        }
        setStatus('error');
      });
      sock.on('session:expired', () => setStatus('error'));
      sock.on('disconnect', () => setStatus((s) => (s === 'paired' ? 'waiting' : s)));
    })();

    return () => {
      cancelled = true;
      sock?.disconnect();
      socketRef.current = null;
    };
  }, [session, authToken]);

  function runTest() {
    if (!socketRef.current || status !== 'paired') return;
    if (!sel.trim()) return;
    setTesting(true);
    setResult(null);
    const reqId = `req-${++reqIdRef.current}`;
    socketRef.current.emit('selector:test', { reqId, selector: sel });
    // Local timeout fallback so the spinner clears if the extension never
    // responds (e.g. content script unreachable on a chrome:// tab).
    setTimeout(() => {
      setTesting((cur) => {
        if (cur) {
          setResult({ count: 0, error: 'Timed out waiting for the extension' });
          return false;
        }
        return cur;
      });
    }, 5000);
  }

  const statusMeta = {
    idle:        { dot: '#9ca3af', label: 'Idle' },
    connecting:  { dot: '#fbbf24', label: 'Opening session…' },
    waiting:     { dot: '#fbbf24', label: 'Waiting for QA Recorder extension to pair' },
    paired:      { dot: '#10b981', label: 'Paired — ready to test' },
    error:       { dot: '#ef4444', label: 'Connection error' },
  }[status];

  return (
    <Modal open onClose={onClose} title="Test selector" size="lg">
      <div className="space-y-4">
        {/* Status + session code */}
        <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
          <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
            <span className="w-2 h-2 rounded-full" style={{ background: statusMeta.dot }} />
            <span style={{ color: 'rgba(238,238,248,0.85)' }}>{statusMeta.label}</span>
          </div>
          {session && (
            <div className="flex items-center gap-2">
              <code
                className="font-mono font-bold px-3 py-1.5 rounded-md tracking-[0.2em] text-base"
                style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.30)', color: '#c4b5fd' }}
              >
                {session.code}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(session.code); toast.success('Code copied'); }}
                title="Copy code — paste into the extension popup"
                className="p-1.5 rounded-md"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.55)' }}
              >
                <Copy size={12} />
              </button>
            </div>
          )}
        </div>

        {status !== 'paired' && (
          <ol className="space-y-1.5 text-[12.5px] pl-5 list-decimal" style={{ color: 'rgba(238,238,248,0.65)' }}>
            <li>Open the QA Recorder extension popup.</li>
            <li>Paste the code above → click <strong>Connect</strong>.</li>
            <li>Open the target site in any tab — no need to arm it.</li>
          </ol>
        )}

        {/* Selector input + Test button */}
        <div className="space-y-2">
          <label className="text-[10.5px] uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.50)' }}>
            Selector
          </label>
          <div className="flex gap-2">
            <input
              value={sel}
              onChange={(e) => setSel(e.target.value)}
              placeholder="#submit, [data-testid='btn'], button:has-text('Save')"
              className="flex-1 rounded-md px-3 py-2 text-sm font-mono focus:outline-none"
              style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.92)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') runTest(); }}
            />
            <Button onClick={runTest} disabled={status !== 'paired' || testing || !sel.trim()}>
              {testing ? <Loader2 size={13} className="animate-spin mr-1" /> : <Eye size={13} className="mr-1" />}
              Test
            </Button>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="rounded-lg px-3 py-3 space-y-2"
            style={{
              background: result.error
                ? 'rgba(239,68,68,0.08)'
                : result.count === 0
                  ? 'rgba(251,191,36,0.08)'
                  : 'rgba(16,185,129,0.08)',
              border: `1px solid ${
                result.error
                  ? 'rgba(239,68,68,0.25)'
                  : result.count === 0
                    ? 'rgba(251,191,36,0.25)'
                    : 'rgba(16,185,129,0.25)'
              }`,
            }}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {result.error ? (
                <><XCircle size={16} style={{ color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>{result.error}</span></>
              ) : result.count === 0 ? (
                <><XCircle size={16} style={{ color: '#fbbf24' }} /><span style={{ color: '#fbbf24' }}>No matching elements</span></>
              ) : result.count === 1 ? (
                <><CheckCircle2 size={16} style={{ color: '#10b981' }} /><span style={{ color: '#10b981' }}>1 element matched (unique — ideal)</span></>
              ) : (
                <><CheckCircle2 size={16} style={{ color: '#fbbf24' }} /><span style={{ color: '#fbbf24' }}>{result.count} elements matched (Playwright picks the first)</span></>
              )}
            </div>
            {result.url && (
              <div className="text-[11px]" style={{ color: 'rgba(238,238,248,0.50)' }}>
                on <code className="font-mono">{result.url}</code>
              </div>
            )}
            {result.samples && result.samples.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {result.samples.map((s, i) => (
                  <div key={i} className="rounded px-2 py-1.5 text-[11.5px] font-mono"
                    style={{ background: 'rgba(0,0,0,0.30)', color: 'rgba(238,238,248,0.75)' }}>
                    <div style={{ color: '#a78bfa' }}>&lt;{s.tagName.toLowerCase()}&gt;</div>
                    {s.text && <div className="mt-0.5 truncate" style={{ color: 'rgba(238,238,248,0.85)' }}>{s.text}</div>}
                    <div className="mt-0.5 truncate" style={{ color: 'rgba(238,238,248,0.50)' }}>{s.outerHtml}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
