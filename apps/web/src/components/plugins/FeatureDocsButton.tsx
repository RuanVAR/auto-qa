import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { docsApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { ScopedDocsPanel } from './ScopedDocsPanel';

/**
 * Compact docs pill on the feature header.
 *
 * Replaces the older FeatureDocsPill (which only handled linked docs in a
 * popover). This one keeps the at-a-glance count + click affordance but
 * opens the unified ScopedDocsPanel — the same component used at project /
 * module / test scopes — so users get one consistent docs surface.
 */
export function FeatureDocsButton({ featureId }: { featureId: string }) {
  const [open, setOpen] = useState(false);

  const localQ = useQuery({
    queryKey: ['docs', 'local', 'feature', featureId, 'count'],
    queryFn: () => docsApi.listLocal('feature', featureId),
    staleTime: 30_000,
  });
  const linkedQ = useQuery({
    queryKey: ['doc-links', 'feature', featureId, 'count'],
    queryFn: () => docsApi.listLinked('feature', featureId),
    staleTime: 30_000,
  });

  const total = (localQ.data?.length ?? 0) + (linkedQ.data?.length ?? 0);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors"
        style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.85)' }}
      >
        <FileText className="w-3 h-3" />
        {total > 0 ? `${total} doc${total === 1 ? '' : 's'}` : 'Docs'}
      </button>

      {open && (
        <Modal open onClose={() => setOpen(false)} title="Feature docs" size="lg">
          <ScopedDocsPanel scope="feature" scopeId={featureId} />
        </Modal>
      )}
    </>
  );
}
