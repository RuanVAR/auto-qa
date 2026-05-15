import { useCallback, useEffect, useRef, useState } from 'react';

// ─── useScreenRecording ──────────────────────────────────────────────────────
// Imperative hook wrapping `getDisplayMedia` + `MediaRecorder`. Gives a caller
// start/stop controls plus a live elapsed timer. When the user stops (via our
// API or the browser's native "stop sharing" bar), `onComplete` fires with the
// final Blob + duration.
//
// Requests audio alongside video so voice-over narration is captured. The
// browser shows its own native consent dialog — no extra UI needed.
//
// Usage:
//   const rec = useScreenRecording({
//     onComplete: async (blob, durationMs) => {
//       const url = await upload(blob);
//       openIssueModalWith({ videoUrl: url, durationMs });
//     },
//   });
//
//   <button onClick={rec.isRecording ? rec.stop : rec.start}>
//     {rec.isRecording ? `Stop (${rec.elapsedMs}ms)` : 'Record'}
//   </button>

export interface UseScreenRecordingOptions {
  /**
   * Fired when recording stops (either by `stop()` or the user clicking the
   * browser's native stop-sharing UI). Receives the final Blob + duration.
   */
  onComplete: (blob: Blob, durationMs: number) => void | Promise<void>;
  /**
   * Fired if starting the stream fails (permission denied, unsupported, etc.)
   * Receives a human-readable error message.
   */
  onError?: (message: string) => void;
}

export interface UseScreenRecordingReturn {
  /** True while MediaRecorder is actively capturing frames. */
  isRecording: boolean;
  /** Milliseconds elapsed since recording started (updates every 500ms). */
  elapsedMs: number;
  /** Last error message, or null if no error. */
  error: string | null;
  /** Request display-capture permission and begin recording. */
  start: () => Promise<void>;
  /** Stop the active recording. Triggers `onComplete`. */
  stop: () => void;
  /** Start with both screen capture AND a microphone track muxed in. */
  startWithMic: () => Promise<void>;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

export function useScreenRecording(opts: UseScreenRecordingOptions): UseScreenRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs to avoid stale-closure issues in event handlers
  const onCompleteRef = useRef(opts.onComplete);
  const onErrorRef = useRef(opts.onError);
  useEffect(() => { onCompleteRef.current = opts.onComplete; }, [opts.onComplete]);
  useEffect(() => { onErrorRef.current = opts.onError; }, [opts.onError]);

  // Cleanup on unmount — stop any active stream + timer
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startInternal = useCallback(async (withMic: boolean) => {
    setError(null);
    // Guard against double-start: if we already have an active stream,
    // stopping the old recorder before starting a new one. This prevents
    // orphaned MediaStreams from leaking if `start()` is called twice.
    if (streamRef.current || recorderRef.current?.state === 'recording') {
      // Ignore — user is already recording. Surface gently.
      return;
    }
    // Pre-flight: getDisplayMedia is gated by the "secure context" rule.
    // On plain HTTP `navigator.mediaDevices` itself is undefined, so the
    // generic "not supported" message hides the real reason (no TLS).
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      const msg =
        'Screen recording needs HTTPS. This page is served over plain HTTP, so the browser refuses to expose getDisplayMedia. Ask an admin to put TLS in front of the platform.';
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = 'Screen recording is not supported in this browser. Try the latest Chrome, Edge or Firefox.';
      setError(msg);
      onErrorRef.current?.(msg);
      return;
    }

    let stream: MediaStream | null = null;
    try {
      // Ask for both video + audio (browser shows native consent, user can
      // opt into "also share tab/system audio").
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      // Optionally capture the mic and mux it onto the same stream so the
      // tester's voice-over is preserved alongside the page's own audio.
      // Failing here (no mic / permission denied) is non-fatal — we still
      // record the screen.
      if (withMic && navigator.mediaDevices?.getUserMedia) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getAudioTracks().forEach(t => stream!.addTrack(t));
        } catch {
          // Permission denied or no mic — continue without narration.
        }
      }

      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType ?? 'video/webm' });
        const duration = Date.now() - startTimeRef.current;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        recorderRef.current = null;
        chunksRef.current = [];  // release captured blob parts
        setIsRecording(false);
        setElapsedMs(0);
        void onCompleteRef.current(blob, duration);
      };

      // If user clicks the browser's native "Stop sharing" bar, the video
      // track ends. Forward that to MediaRecorder so `onstop` fires too.
      stream.getVideoTracks()[0].onended = () => {
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      };

      recorder.start(250);
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setElapsedMs(0);

      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    } catch (err) {
      // Safety net: if anything failed after we acquired the stream but before
      // MediaRecorder took over, stop its tracks so we don't leak.
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      }
      streamRef.current = null;
      recorderRef.current = null;
      const raw = err instanceof Error ? err.message : 'Unknown error';
      const msg = raw.includes('Permission denied') || raw.includes('NotAllowedError')
        ? 'Screen recording permission denied.'
        : `Failed to start recording: ${raw}`;
      setError(msg);
      onErrorRef.current?.(msg);
    }
  }, []);

  const start = useCallback(() => startInternal(false), [startInternal]);
  const startWithMic = useCallback(() => startInternal(true), [startInternal]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  return { isRecording, elapsedMs, error, start, stop, startWithMic };
}

/** Format elapsed milliseconds as MM:SS (e.g. "01:23"). */
export function formatRecordingDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60).toString().padStart(2, '0');
  const s = (total % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
