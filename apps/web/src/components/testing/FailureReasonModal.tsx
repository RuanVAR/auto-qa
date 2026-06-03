import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { XCircle, Camera, Video, Square, Trash2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { pluginsApi } from '@/lib/api';
import { FAILURE_CATEGORIES, type FailureCategory, failureCategoryMeta } from '@/lib/failureCategories';
import { useFeatureClickUpStatus, findQaFailedStatus, ClickUpStatusSelect } from '@/components/plugins/featureClickUpStatus';

// ─── FailureReasonModal ──────────────────────────────────────────────────────
// Shown when QA marks a test FAILED. Captures a structured reason — a category
// (drives the failure-type analytics) plus an optional free-text detail — so a
// failure is never just a red dot with no "why".

interface FailEvidenceItem {
  url: string;
  mimeType: string;
  filename: string;
  objectUrl?: string;
}

interface FailureReasonModalProps {
  open: boolean;
  /** Visually suppressed (but kept mounted, so state survives) while a capture
   *  or recording is in flight — lets the QA interact with the app. */
  hidden?: boolean;
  /** Name of the test being failed — shown for context. */
  testName?: string;
  /** Feature under test — enables the optional ClickUp ticket-status update. */
  featureId?: string | null;
  /** Evidence captured for this failure (managed by the parent). */
  evidence?: FailEvidenceItem[];
  /** True while a screen recording is currently in progress. */
  recording?: boolean;
  recordingElapsedMs?: number;
  /** Trigger a screenshot capture of the app under test. */
  onAddScreenshot?: () => void;
  /** Start (or stop) a screen recording of the app under test. */
  onToggleRecording?: () => void;
  /** Remove a captured evidence item by index. */
  onRemoveEvidence?: (idx: number) => void;
  onClose: () => void;
  /** Fired when the tester confirms — caller does the actual mark mutation. */
  onConfirm: (category: FailureCategory, note: string) => void;
  submitting?: boolean;
}

export function FailureReasonModal({
  open,
  hidden,
  testName,
  featureId,
  evidence = [],
  recording,
  recordingElapsedMs,
  onAddScreenshot,
  onToggleRecording,
  onRemoveEvidence,
  onClose,
  onConfirm,
  submitting,
}: FailureReasonModalProps) {
  const [category, setCategory] = useState<FailureCategory | ''>('');
  const [note, setNote] = useState('');
  const [cuStatus, setCuStatus] = useState('');
  // Opt-in CU actions — QA decides whether to touch the linked ClickUp ticket.
  const [pushStatus, setPushStatus] = useState(false);
  const [pushComment, setPushComment] = useState(false);
  // Apply sensible defaults only once per open, so refetches don't override
  // a choice the QA already toggled.
  const defaultsApplied = useRef(false);

  // Linked ClickUp task for this feature — lets QA flip the ticket (e.g. to a
  // "QA Failed" status) and/or log the reason as a comment when failing.
  const cuQuery = useFeatureClickUpStatus(featureId, open);
  const cuUpdate = useMutation({
    mutationFn: (status: string) => pluginsApi.setFeatureClickUpStatus(featureId!, status),
    onSuccess: (res) => toast.success('ClickUp updated', `Task moved to "${res.externalStatus}".`),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('ClickUp update failed', typeof msg === 'string' ? msg : 'Could not reach ClickUp.');
    },
  });
  const cuComment = useMutation({
    mutationFn: (comment: string) => pluginsApi.postFeatureClickUpComment(featureId!, comment),
    onSuccess: () => toast.success('ClickUp comment posted'),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('ClickUp comment failed', typeof msg === 'string' ? msg : 'Could not reach ClickUp.');
    },
  });
  const cuAttach = useMutation({
    mutationFn: (artifacts: { url: string; filename: string; contentType?: string; kind?: string }[]) =>
      pluginsApi.postFeatureClickUpAttachments(featureId!, artifacts),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('ClickUp attachment failed', typeof msg === 'string' ? msg : 'Could not upload evidence.');
    },
  });

  // Reset whenever the modal re-opens so a previous reason doesn't leak.
  useEffect(() => {
    if (open) {
      setCategory('');
      setNote('');
      setCuStatus('');
      setPushStatus(false);
      setPushComment(false);
      defaultsApplied.current = false;
    }
  }, [open]);

  // Once the list's statuses load, pre-fill sensible defaults a single time:
  // pre-select a "QA failed"-style status (and enable the status push if one
  // exists), and default the comment toggle on.
  useEffect(() => {
    if (!open || defaultsApplied.current || !cuQuery.data?.linked) return;
    defaultsApplied.current = true;
    const guess = findQaFailedStatus(cuQuery.data.statuses);
    if (guess && guess.status.toLowerCase() !== cuQuery.data.currentStatus.toLowerCase()) {
      setCuStatus(guess.status);
      setPushStatus(true);
    }
    setPushComment(true);
  }, [open, cuQuery.data]);

  const meta = failureCategoryMeta(category || null);

  const handleConfirm = () => {
    if (!category) return;
    if (cuQuery.data?.linked) {
      const cur = cuQuery.data.currentStatus?.toLowerCase();
      if (pushStatus && cuStatus && cuStatus.toLowerCase() !== cur) cuUpdate.mutate(cuStatus);
      if (pushComment) {
        const label = FAILURE_CATEGORIES.find((c) => c.value === category)?.label ?? category;
        const lines = [
          `🔴 QA failed${testName ? ` — ${testName}` : ''}`,
          `Reason: ${label}`,
          note.trim() ? `\n${note.trim()}` : '',
        ].filter(Boolean);
        cuComment.mutate(lines.join('\n'));
        // Ride the evidence along to the task as attachments.
        if (evidence.length > 0) {
          const artifacts = evidence.map((e, i) => {
            const isVideo = e.mimeType.startsWith('video');
            const ext = isVideo ? (e.mimeType.includes('webm') ? 'webm' : 'mp4') : (e.mimeType.split('/')[1] || 'png');
            return {
              url: e.url,
              filename: /\.[a-z0-9]+$/i.test(e.filename) ? e.filename : `evidence-${i + 1}.${ext}`,
              contentType: e.mimeType,
              kind: isVideo ? 'recording' : 'screenshot',
            };
          });
          cuAttach.mutate(artifacts);
        }
      }
    }
    onConfirm(category, note.trim());
  };

  // Kept mounted (state preserved) but invisible while the QA is capturing a
  // screenshot / recording the app behind the modal.
  if (hidden) return null;

  const fmtElapsed = (ms?: number) => {
    const s = Math.floor((ms ?? 0) / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <Modal open={open} onClose={onClose} title="Why did this test fail?" size="sm">
      <div className="space-y-4">
        <p className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.7)' }}>
          <XCircle size={15} style={{ color: '#f87171' }} />
          <span>
            Marking{' '}
            <span className="font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
              {testName ?? 'this test'}
            </span>{' '}
            as failed.
          </span>
        </p>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.65)' }}>
            Failure type <span style={{ color: '#f87171' }}>*</span>
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as FailureCategory)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            <option value="">Select a failure type…</option>
            {FAILURE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          {meta && (
            <p className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
              {meta.hint}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.65)' }}>
            What went wrong? <span style={{ color: 'rgba(238,238,248,0.4)' }}>(optional — use @name to notify a teammate)</span>
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="Add detail so the next person — or the developer — knows exactly what to look at… Tag someone with @name."
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
        </div>

        {/* Evidence — capture a screenshot (annotatable) or record the app.
            The modal hides itself during capture so the app is interactable,
            then restores with the reason intact. */}
        {(onAddScreenshot || onToggleRecording) && (
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.65)' }}>
              Evidence <span style={{ color: 'rgba(238,238,248,0.4)' }}>(optional)</span>
            </label>
            <div className="flex items-center gap-2">
              {onAddScreenshot && (
                <button
                  type="button"
                  onClick={onAddScreenshot}
                  disabled={submitting || recording}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(238,238,248,0.82)' }}
                >
                  <Camera size={13} /> Screenshot
                </button>
              )}
              {onToggleRecording && (
                <button
                  type="button"
                  onClick={onToggleRecording}
                  disabled={submitting}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={recording
                    ? { background: 'rgba(248,113,113,0.16)', border: '1px solid rgba(248,113,113,0.45)', color: '#fca5a5' }
                    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(238,238,248,0.82)' }}
                >
                  {recording ? <><Square size={12} /> Stop {fmtElapsed(recordingElapsedMs)}</> : <><Video size={13} /> Record</>}
                </button>
              )}
            </div>
            {evidence.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {evidence.map((e, idx) => {
                  const isVideo = e.mimeType.startsWith('video');
                  const src = e.objectUrl ?? e.url;
                  return (
                    <div key={`${e.url}-${idx}`} className="relative group rounded-lg overflow-hidden" style={{ width: 84, height: 56, border: '1px solid rgba(255,255,255,0.12)', background: '#000' }}>
                      {isVideo
                        ? <video src={src} className="w-full h-full object-cover" />
                        : <img src={src} alt={e.filename} className="w-full h-full object-cover" />}
                      {isVideo && (
                        <span className="absolute bottom-0.5 left-0.5 text-[9px] px-1 rounded" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                          <Video size={9} className="inline" />
                        </span>
                      )}
                      {onRemoveEvidence && (
                        <button
                          type="button"
                          onClick={() => onRemoveEvidence(idx)}
                          title="Remove"
                          className="absolute top-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: 'rgba(0,0,0,0.7)', color: '#fca5a5' }}
                        >
                          <Trash2 size={10} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {cuQuery.data?.linked && (
          <div className="space-y-3 rounded-lg border border-white/10 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.4)' }}>
              Linked ClickUp ticket
            </p>

            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: 'rgba(238,238,248,0.82)' }}>
              <input
                type="checkbox"
                checked={pushStatus}
                onChange={(e) => setPushStatus(e.target.checked)}
                disabled={submitting}
                className="accent-violet-500"
              />
              Update ClickUp ticket status
            </label>
            {pushStatus && (
              <ClickUpStatusSelect
                data={cuQuery.data}
                value={cuStatus}
                onChange={setCuStatus}
                disabled={cuUpdate.isPending || submitting}
                label="New status"
                hint="Applied to the linked ClickUp task when you mark the test failed."
              />
            )}

            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer" style={{ color: 'rgba(238,238,248,0.82)' }}>
              <input
                type="checkbox"
                checked={pushComment}
                onChange={(e) => setPushComment(e.target.checked)}
                disabled={submitting}
                className="accent-violet-500"
              />
              Post the failure reason as a ClickUp comment
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!category || submitting}
            loading={submitting}
            onClick={handleConfirm}
          >
            <XCircle size={13} className="mr-1" /> Mark failed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
