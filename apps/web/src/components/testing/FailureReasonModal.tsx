import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { XCircle } from 'lucide-react';
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

interface FailureReasonModalProps {
  open: boolean;
  /** Name of the test being failed — shown for context. */
  testName?: string;
  /** Feature under test — enables the optional ClickUp ticket-status update. */
  featureId?: string | null;
  onClose: () => void;
  /** Fired when the tester confirms — caller does the actual mark mutation. */
  onConfirm: (category: FailureCategory, note: string) => void;
  submitting?: boolean;
}

export function FailureReasonModal({
  open,
  testName,
  featureId,
  onClose,
  onConfirm,
  submitting,
}: FailureReasonModalProps) {
  const [category, setCategory] = useState<FailureCategory | ''>('');
  const [note, setNote] = useState('');
  const [cuStatus, setCuStatus] = useState('');

  // Linked ClickUp task for this feature — lets QA flip the ticket (e.g. to a
  // "QA Failed" status) at the same time as recording the failure.
  const cuQuery = useFeatureClickUpStatus(featureId, open);
  const cuUpdate = useMutation({
    mutationFn: (status: string) => pluginsApi.setFeatureClickUpStatus(featureId!, status),
    onSuccess: (res) => toast.success('ClickUp updated', `Task moved to "${res.externalStatus}".`),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('ClickUp update failed', typeof msg === 'string' ? msg : 'Could not reach ClickUp.');
    },
  });

  // Reset whenever the modal re-opens so a previous reason doesn't leak.
  useEffect(() => {
    if (open) {
      setCategory('');
      setNote('');
      setCuStatus('');
    }
  }, [open]);

  // Pre-select a "QA failed"-style status once the list's statuses load.
  useEffect(() => {
    if (!open || !cuQuery.data?.linked) return;
    const guess = findQaFailedStatus(cuQuery.data.statuses);
    if (guess && guess.status.toLowerCase() !== cuQuery.data.currentStatus.toLowerCase()) {
      setCuStatus(guess.status);
    }
  }, [open, cuQuery.data]);

  const meta = failureCategoryMeta(category || null);

  const handleConfirm = () => {
    if (!category) return;
    const cur = cuQuery.data?.currentStatus?.toLowerCase();
    if (cuStatus && cuStatus.toLowerCase() !== cur) cuUpdate.mutate(cuStatus);
    onConfirm(category, note.trim());
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
            What went wrong? <span style={{ color: 'rgba(238,238,248,0.4)' }}>(optional)</span>
          </label>
          <textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            placeholder="Add detail so the next person — or the developer — knows exactly what to look at…"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
          />
        </div>

        {cuQuery.data?.linked && (
          <ClickUpStatusSelect
            data={cuQuery.data}
            value={cuStatus}
            onChange={setCuStatus}
            disabled={cuUpdate.isPending || submitting}
            label="Update ClickUp ticket status"
            hint="Applied to the linked ClickUp task when you mark the test failed."
          />
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
