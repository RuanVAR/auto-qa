import { useEffect, useState } from 'react';
import { XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FAILURE_CATEGORIES, type FailureCategory, failureCategoryMeta } from '@/lib/failureCategories';

// ─── FailureReasonModal ──────────────────────────────────────────────────────
// Shown when QA marks a test FAILED. Captures a structured reason — a category
// (drives the failure-type analytics) plus an optional free-text detail — so a
// failure is never just a red dot with no "why".

interface FailureReasonModalProps {
  open: boolean;
  /** Name of the test being failed — shown for context. */
  testName?: string;
  onClose: () => void;
  /** Fired when the tester confirms — caller does the actual mark mutation. */
  onConfirm: (category: FailureCategory, note: string) => void;
  submitting?: boolean;
}

export function FailureReasonModal({
  open,
  testName,
  onClose,
  onConfirm,
  submitting,
}: FailureReasonModalProps) {
  const [category, setCategory] = useState<FailureCategory | ''>('');
  const [note, setNote] = useState('');

  // Reset whenever the modal re-opens so a previous reason doesn't leak.
  useEffect(() => {
    if (open) {
      setCategory('');
      setNote('');
    }
  }, [open]);

  const meta = failureCategoryMeta(category || null);

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

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!category || submitting}
            loading={submitting}
            onClick={() => category && onConfirm(category, note.trim())}
          >
            <XCircle size={13} className="mr-1" /> Mark failed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
