import { AlertTriangle, PlusCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

interface Props {
  open: boolean;
  onClose: () => void;
  onAddEnvironment: () => void;
}

/**
 * Shown when the user clicks "Test Feature" but the project has no
 * environments configured. Offers a direct CTA to the environments page.
 */
export function NoEnvWarningModal({ open, onClose, onAddEnvironment }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="No Environments Set Up" size="sm">
      <div className="space-y-4">
        <div
          className="flex items-start gap-3 rounded-xl p-4"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
        >
          <AlertTriangle size={18} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.90)' }}>
              No environments configured
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
              You need at least one environment with a base URL before you can start a test session. Environments tell the runner where to navigate to.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onAddEnvironment}>
            <PlusCircle size={14} /> Add Environment
          </Button>
        </div>
      </div>
    </Modal>
  );
}
