import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, Paperclip, Loader, X, Camera, Video, Mic, MicOff } from 'lucide-react';
import { runsApi, uploadsApi } from '@/lib/api';
import { setManualRecMicEnabled } from '@/lib/manualRecMic';
import { toast } from '@/components/ui/Toast';
import { useScreenRecording, formatRecordingDuration } from '@/hooks/useScreenRecording';
import { stepInstruction } from '@/pages/modules/FeaturePage/featurePage.helpers';
import type { RunStep, AttachedEvidence } from '@/pages/modules/FeaturePage/featurePage.types';

const MAX_FILES = 5;
const MAX_FILE_SIZE_MB = 25;

/**
 * Expanded card shown for the "active" step inside a test (the first
 * non-terminal step in the run). Provides:
 *   - Step instruction
 *   - Input/params dump (read-only)
 *   - Notes textarea
 *   - File upload (up to 5 files per step, ≤25 MB each)
 *   - Per-step Pass / Fail buttons
 *
 * Extracted from ManualPlayer so TestingView's LeftPanel can offer the same
 * step-level UX without dragging in the whole portal-mode renderer.
 *
 * Capture (iframe screenshot) and Record (screen + audio) intentionally NOT
 * included here — they need iframe ref + media recorder plumbing that's
 * coupled to the parent layout. They remain on ManualPlayer for now and can
 * be lifted in a follow-up once the iframe ref is exposed.
 */
export function ActiveStepCard({
  step,
  index,
  testRunId,
  featureRunId,
  iframeRef,
  onMarked,
}: {
  step: RunStep;
  index: number;
  testRunId: string;
  featureRunId?: string | null;
  /** Live preview iframe — needed by Capture (programmatic screenshot). When
   *  null/undefined, the Capture button is hidden. */
  iframeRef?: React.RefObject<HTMLIFrameElement>;
  onMarked?: (status: 'PASSED' | 'FAILED') => void;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState<AttachedEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [micEnabled, setMicEnabled] = useState<boolean>(
    () => localStorage.getItem('manual-rec-mic') === '1',
  );

  // Screen recording — `onComplete` fires when MediaRecorder stops (either
  // because we called stop() or because the user clicked the browser's
  // native "Stop sharing" UI). Upload the resulting blob and attach.
  const recording = useScreenRecording({
    onComplete: async (blob, durationMs) => {
      try {
        setUploading(true);
        const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
        const r = await uploadsApi.upload(file);
        setEvidence(prev => [...prev, {
          token: r.token,
          url: r.url,
          filename: `Recording (${formatRecordingDuration(durationMs)})`,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
        }]);
        toast.success('Recording attached', `${formatRecordingDuration(durationMs)} of screen capture saved.`);
      } catch (err) {
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        toast.error('Recording upload failed', typeof msg === 'string' ? msg : 'Try again.');
      } finally {
        setUploading(false);
      }
    },
    onError: (msg) => toast.error('Recording error', msg),
  });

  const markStatus = useMutation({
    mutationFn: (status: 'PASSED' | 'FAILED') =>
      runsApi.markStepStatus(testRunId, step.id, {
        status,
        notes: notes || undefined,
        evidenceUrls: evidence.map(e => e.url),
      }),
    onSuccess: (_d, status) => {
      qc.invalidateQueries({ queryKey: ['run-steps', testRunId] });
      if (featureRunId) qc.invalidateQueries({ queryKey: ['feature-runs'] });
      toast.success(`Step ${status === 'PASSED' ? 'passed' : 'failed'}`, 'Saved with notes & evidence.');
      // Reset local state — next active step picks up clean.
      setNotes('');
      setEvidence([]);
      onMarked?.(status);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to mark step', typeof msg === 'string' ? msg : 'Try again — see console.');
      // eslint-disable-next-line no-console
      console.error('markStepStatus failed', err);
    },
  });

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const valid: File[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        toast.error('File too large', `${f.name} exceeds ${MAX_FILE_SIZE_MB} MB.`);
        continue;
      }
      valid.push(f);
    }
    if (evidence.length + valid.length > MAX_FILES) {
      toast.error('Attachment limit', `Max ${MAX_FILES} files per step.`);
      return;
    }
    setUploading(true);
    try {
      for (const f of valid) {
        const r = await uploadsApi.upload(f);
        const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
        setEvidence(prev => [...prev, {
          token: r.token,
          url: r.url,
          filename: r.filename,
          mimeType: r.mimeType,
          sizeBytes: r.sizeBytes,
          preview,
        }]);
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Upload failed', typeof msg === 'string' ? msg : 'Try again.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  /** Programmatic screenshot of the live preview iframe — only works when
   *  the iframe document is same-origin (browser blocks DOM access otherwise).
   *  Falls back to a clear toast nudging the user toward the file picker. */
  async function captureIframe() {
    if (!iframeRef?.current) {
      toast.warning('Preview not ready', 'Open the app preview before capturing.');
      return;
    }
    if (evidence.length >= MAX_FILES) {
      toast.warning('Attachment limit', `Max ${MAX_FILES} files per step.`);
      return;
    }
    setCapturing(true);
    try {
      const doc = iframeRef.current.contentDocument;
      if (!doc?.documentElement) throw new Error('cross-origin');
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(doc.documentElement, {
        cacheBust: true,
        pixelRatio: window.devicePixelRatio || 1,
      });
      if (!blob) throw new Error('capture-failed');
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
      const r = await uploadsApi.upload(file);
      const preview = URL.createObjectURL(blob);
      setEvidence(prev => [...prev, {
        token: r.token,
        url: r.url,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        preview,
      }]);
      toast.success('Screenshot captured', 'Attached to this step.');
    } catch (err) {
      const reason = (err as Error)?.message;
      if (reason === 'cross-origin') {
        toast.warning(
          'Cannot auto-capture',
          'The app is on a different origin. Use Upload to attach an OS screenshot.',
        );
      } else {
        toast.error('Capture failed', 'Try again, or use Upload.');
      }
    } finally {
      setCapturing(false);
    }
  }

  function removeEvidence(idx: number) {
    setEvidence(prev => {
      const ev = prev[idx];
      if (ev?.preview) URL.revokeObjectURL(ev.preview);
      // Best-effort cleanup; ignore errors (file may already be GC'd server-side).
      uploadsApi.remove(ev.token).catch(() => { /* swallow */ });
      return prev.filter((_, i) => i !== idx);
    });
  }

  return (
    <div
      className="mx-2 mt-1 mb-2 rounded-xl p-4 space-y-3"
      style={{
        background: 'rgba(139,92,246,0.06)',
        border: '1px solid rgba(139,92,246,0.28)',
      }}
    >
      {/* Hidden input — triggered by the Upload button */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        accept="image/*,video/*,application/pdf"
        onChange={e => handleFiles(e.target.files)}
      />

      {/* Header — type badge + name + step number */}
      <div className="flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}
        >
          {step.type}
        </span>
        <span className="text-sm font-medium flex-1 truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
          {step.name || stepInstruction(step)}
        </span>
        <span className="text-[10px] font-mono" style={{ color: 'rgba(238,238,248,0.35)' }}>
          #{index + 1}
        </span>
      </div>

      {/* Plain-language instruction */}
      <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.65)' }}>
        {stepInstruction(step)}
      </p>

      {/* Input dump — read-only visibility into params */}
      {step.input && Object.keys(step.input).length > 0 && (
        <div
          className="rounded-lg px-2.5 py-2 text-[11px] font-mono"
          style={{ background: 'rgba(0,0,0,0.30)', color: 'rgba(238,238,248,0.55)' }}
        >
          {Object.entries(step.input).map(([k, v]) => (
            <div key={k}>
              <span style={{ color: '#a78bfa' }}>{k}:</span> {String(v)}
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      <textarea
        className="w-full rounded-lg px-3 py-2 text-xs resize-none focus:outline-none"
        style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.10)',
          color: 'rgba(238,238,248,0.85)',
        }}
        rows={2}
        placeholder="Notes (optional)…"
        value={notes}
        onChange={e => setNotes(e.target.value)}
      />

      {/* Evidence action row — Upload | Capture | Record | Mic toggle.
          Capture only renders when the parent passed an iframeRef; otherwise
          it'd be a dead button. Mic toggle is hidden mid-recording (would
          require restarting the stream, which is more confusing than helpful). */}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={evidence.length >= MAX_FILES || uploading}
          title="Attach a file (image, video, or PDF)"
          className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-all"
          style={{
            background: evidence.length > 0 ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.04)',
            border: evidence.length > 0 ? '1px solid rgba(139,92,246,0.30)' : '1px dashed rgba(255,255,255,0.14)',
            color: evidence.length >= MAX_FILES || uploading
              ? 'rgba(238,238,248,0.30)'
              : evidence.length > 0 ? '#c4b5fd' : 'rgba(238,238,248,0.65)',
            cursor: evidence.length >= MAX_FILES || uploading ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? (
            <><Loader size={11} className="animate-spin" /> Up…</>
          ) : (
            <><Paperclip size={11} /> {evidence.length > 0 ? `${evidence.length} file${evidence.length !== 1 ? 's' : ''}` : 'Upload'}</>
          )}
        </button>

        {iframeRef && (
          <button
            type="button"
            onClick={captureIframe}
            disabled={evidence.length >= MAX_FILES || capturing || uploading}
            title="Capture the current preview as a screenshot"
            className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-all"
            style={{
              background: 'rgba(56,189,248,0.10)',
              border: '1px dashed rgba(56,189,248,0.30)',
              color: capturing ? 'rgba(238,238,248,0.5)' : '#7dd3fc',
              cursor: evidence.length >= MAX_FILES || capturing ? 'not-allowed' : 'pointer',
            }}
          >
            {capturing ? <><Loader size={11} className="animate-spin" /> …</> : <><Camera size={11} /> Capture</>}
          </button>
        )}

        <button
          type="button"
          onClick={recording.isRecording
            ? recording.stop
            : (micEnabled ? recording.startWithMic : recording.start)}
          title={recording.isRecording
            ? 'Stop recording'
            : micEnabled
              ? 'Record screen + microphone (browser will ask what to share)'
              : 'Record screen (browser will ask what to share)'}
          className="flex-1 flex items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-all"
          style={{
            background: recording.isRecording ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.04)',
            border: recording.isRecording ? '1px solid rgba(239,68,68,0.45)' : '1px dashed rgba(255,255,255,0.14)',
            color: recording.isRecording ? '#f87171' : 'rgba(238,238,248,0.65)',
          }}
        >
          {recording.isRecording ? (
            <><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> {formatRecordingDuration(recording.elapsedMs)}</>
          ) : (
            <><Video size={11} /> Record</>
          )}
        </button>

        {!recording.isRecording && (
          <button
            type="button"
            onClick={() => setMicEnabled(v => {
              const next = !v;
              setManualRecMicEnabled(next);
              return next;
            })}
            title={micEnabled ? 'Microphone narration enabled — click to disable' : 'Enable microphone narration'}
            className="rounded-lg px-2 transition-all"
            style={{
              background: micEnabled ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)',
              border: micEnabled ? '1px solid rgba(139,92,246,0.40)' : '1px dashed rgba(255,255,255,0.14)',
              color: micEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.5)',
            }}
          >
            {micEnabled ? <Mic size={11} /> : <MicOff size={11} />}
          </button>
        )}
      </div>

      {/* Evidence list */}
      {evidence.length > 0 && (
        <div className="space-y-1">
          {evidence.map((ev, i) => (
            <div
              key={ev.token}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {ev.mimeType.startsWith('image/') && ev.preview ? (
                <img src={ev.preview} alt="" className="w-7 h-7 object-cover rounded flex-shrink-0" />
              ) : (
                <Paperclip size={11} className="flex-shrink-0" style={{ color: 'rgba(238,238,248,0.45)' }} />
              )}
              <span className="flex-1 text-xs truncate" style={{ color: 'rgba(238,238,248,0.65)' }}>{ev.filename}</span>
              <button type="button" onClick={() => removeEvidence(i)} style={{ color: '#f87171' }}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Pass / Fail */}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={markStatus.isPending}
          onClick={() => markStatus.mutate('FAILED')}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border: '1px solid rgba(239,68,68,0.40)',
            color: '#f87171',
          }}
        >
          <XCircle size={12} /> Fail
        </button>
        <button
          type="button"
          disabled={markStatus.isPending}
          onClick={() => markStatus.mutate('PASSED')}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'rgba(16,185,129,0.18)',
            border: '1px solid rgba(16,185,129,0.40)',
            color: '#34d399',
          }}
        >
          <CheckCircle size={12} /> Pass
        </button>
      </div>
    </div>
  );
}
