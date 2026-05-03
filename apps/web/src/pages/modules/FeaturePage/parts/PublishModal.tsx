import { GitBranch } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Name input — controlled from parent so the parent keeps the form state */
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  /** How many test cases will be captured in the snapshot */
  testCount: number;
  /** Mutation in flight */
  loading: boolean;
  onPublish: () => void;
}

/**
 * Captures a snapshot of the current feature + all its test cases as a
 * named version. Shown when the user clicks "Publish vX" in the feature header.
 */
export function PublishModal({
  open, onClose, name, onNameChange, description, onDescriptionChange,
  testCount, loading, onPublish,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Publish Feature Version">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          A snapshot of all {testCount} test case{testCount !== 1 ? 's' : ''} will be captured and versioned.
        </p>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Version name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            placeholder="e.g. Login flow complete"
            value={name}
            onChange={e => onNameChange(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Description (optional)
          </label>
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            rows={3}
            placeholder="What changed in this version?"
            value={description}
            onChange={e => onDescriptionChange(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={loading} disabled={!name.trim()} onClick={onPublish}>
            <GitBranch size={14} /> Publish Version
          </Button>
        </div>
      </div>
    </Modal>
  );
}
