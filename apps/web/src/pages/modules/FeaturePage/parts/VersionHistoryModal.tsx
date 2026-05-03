import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';
import type { VersionInfo } from '../featurePage.types';

interface Props {
  open: boolean;
  onClose: () => void;
  versions: VersionInfo[];
  /** Kick off a restore of the given versionId → draft */
  onRestore: (versionId: string) => void;
  restoring: boolean;
}

/**
 * Lists all published versions for this feature with the option to
 * restore a prior version to the draft.
 */
export function VersionHistoryModal({ open, onClose, versions, onRestore, restoring }: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Version History">
      <div className="space-y-3">
        {versions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No published versions yet.</p>
        ) : (
          versions.map(v => (
            <div
              key={v.id}
              className="flex items-center justify-between border border-gray-100 rounded-xl px-4 py-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-gray-800">{v.label}</span>
                  <span className="text-sm text-gray-600">{v.name}</span>
                  {v.isActive && <Badge variant="success">Active</Badge>}
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{formatDate(v.publishedAt)}</p>
              </div>
              <div className="flex gap-2">
                {!v.isActive && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onRestore(v.id)}
                    loading={restoring}
                  >
                    Restore to draft
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
