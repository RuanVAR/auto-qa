import React, { useEffect, useRef, useState } from 'react';
import { uploadsApi } from '../lib/api';
import { Button } from './ui/Button';

export interface RecordingResult {
  token: string;
  url: string;
  filename: string;
  durationMs: number;
  notes: string;
}

type RecordingState = 'idle' | 'recording' | 'reviewing' | 'uploading';

interface FloatingRecorderProps {
  testName?: string;
  onRecordingAttached: (result: RecordingResult) => void;
  onDiscard?: () => void;
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60).toString().padStart(2, '0');
  const secs = (totalSecs % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FloatingRecorder({
  testName,
  onRecordingAttached,
  onDiscard,
}: FloatingRecorderProps) {
  const [state, setState] = useState<RecordingState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recordingBlob, setRecordingBlob] = useState<Blob | null>(null);
  const [recordingObjectUrl, setRecordingObjectUrl] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [notes, setNotes] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (recordingObjectUrl) URL.revokeObjectURL(recordingObjectUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen recording is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      streamRef.current = stream;
      chunksRef.current = [];

      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        const elapsed = Date.now() - startTimeRef.current;
        setDurationMs(elapsed);
        setRecordingBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordingObjectUrl(url);
        setState('reviewing');
        if (timerRef.current) clearInterval(timerRef.current);
        stream.getTracks().forEach(t => t.stop());
      };

      // Handle user stopping via browser native stop
      stream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      };

      recorder.start(250);
      startTimeRef.current = Date.now();
      setState('recording');
      setElapsedMs(0);

      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Permission denied') || message.includes('NotAllowedError')) {
        setError('Screen recording permission denied.');
      } else {
        setError('Failed to start recording: ' + message);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleAttach = async () => {
    if (!recordingBlob) return;
    setUploadError(null);
    setState('uploading');
    try {
      const filename = `recording-${Date.now()}.webm`;
      const file = new File([recordingBlob], filename, { type: 'video/webm' });
      const result = await uploadsApi.upload(file);
      const recResult: RecordingResult = {
        token: result.token,
        url: result.url,
        filename: result.filename,
        durationMs,
        notes,
      };
      if (recordingObjectUrl) URL.revokeObjectURL(recordingObjectUrl);
      setRecordingObjectUrl(null);
      setRecordingBlob(null);
      setNotes('');
      setState('idle');
      onRecordingAttached(recResult);
    } catch {
      setUploadError('Upload failed. Please try again.');
      setState('reviewing');
    }
  };

  const handleSaveLocally = () => {
    if (!recordingObjectUrl || !recordingBlob) return;
    const a = document.createElement('a');
    a.href = recordingObjectUrl;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
  };

  const handleDiscardReview = () => {
    if (recordingObjectUrl) URL.revokeObjectURL(recordingObjectUrl);
    setRecordingObjectUrl(null);
    setRecordingBlob(null);
    setNotes('');
    setUploadError(null);
    setState('idle');
    onDiscard?.();
  };

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {error && (
          <div className="rounded-lg px-3 py-2 text-xs text-red-300 max-w-xs text-right"
            style={{ background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)' }}>
            {error}
          </div>
        )}

        {state === 'recording' && (
          <div className="flex items-center gap-2 rounded-full px-3 py-1 text-xs text-white font-mono"
            style={{ background: 'rgba(220,38,38,0.85)', border: '1px solid rgba(220,38,38,0.5)' }}>
            <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
            {formatDuration(elapsedMs)}
          </div>
        )}

        {state === 'idle' && (
          <button
            onClick={startRecording}
            className="flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ background: 'rgba(124,58,237,0.9)', border: '1px solid rgba(124,58,237,0.6)', boxShadow: '0 4px 20px rgba(124,58,237,0.4)' }}
          >
            <span style={{ fontSize: '10px', color: '#f87171' }}>⏺</span>
            Record
          </button>
        )}

        {state === 'recording' && (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
            style={{ background: 'rgba(220,38,38,0.9)', border: '1px solid rgba(220,38,38,0.6)', boxShadow: '0 4px 20px rgba(220,38,38,0.4)' }}
          >
            <span style={{ fontSize: '10px' }}>⏹</span>
            Stop
          </button>
        )}

        {state === 'uploading' && (
          <button
            disabled
            className="flex items-center gap-2 px-4 py-2 rounded-full font-medium text-sm text-white opacity-70 shadow-lg"
            style={{ background: 'rgba(124,58,237,0.9)' }}
          >
            Uploading…
          </button>
        )}
      </div>

      {/* Review Modal */}
      {(state === 'reviewing' || state === 'uploading') && recordingObjectUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)' }}
        >
          <div
            className="w-full max-w-2xl rounded-2xl p-6 space-y-5 mx-4"
            style={{ background: 'rgba(18,18,32,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 20px 60px rgba(0,0,0,0.8)' }}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-100">Review Recording</h2>
                {testName && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    Will attach to: <span className="text-purple-300">{testName}</span>
                  </p>
                )}
              </div>
              <button
                onClick={handleDiscardReview}
                disabled={state === 'uploading'}
                className="text-slate-400 hover:text-slate-200 text-xl leading-none"
              >×</button>
            </div>

            {/* Video preview */}
            <video
              src={recordingObjectUrl}
              controls
              className="w-full rounded-xl border border-white/10"
              style={{ maxHeight: '300px' }}
            />

            {/* Info */}
            <div className="flex gap-4 text-xs text-slate-400">
              <span>Duration: <span className="text-slate-200">{formatDuration(durationMs)}</span></span>
              {recordingBlob && (
                <span>Size: <span className="text-slate-200">{formatSize(recordingBlob.size)}</span></span>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-slate-400 mb-1.5">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Describe what this recording shows..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 border border-white/10 focus:border-purple-500 focus:outline-none resize-none"
                style={{ background: 'rgba(255,255,255,0.05)' }}
                disabled={state === 'uploading'}
              />
            </div>

            {uploadError && (
              <p className="text-xs text-red-400">{uploadError}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 justify-end pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDiscardReview}
                disabled={state === 'uploading'}
              >
                Discard
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSaveLocally}
                disabled={state === 'uploading'}
              >
                Save Locally
              </Button>
              <Button
                size="sm"
                onClick={handleAttach}
                loading={state === 'uploading'}
                disabled={state === 'uploading'}
              >
                Attach to Test
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
