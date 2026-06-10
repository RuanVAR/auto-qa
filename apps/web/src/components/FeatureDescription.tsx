import { useQueryClient } from '@tanstack/react-query';
import { featuresApi } from '@/lib/api';
import { MarkdownDescription } from '@/components/MarkdownDescription';

/**
 * Feature description: Markdown-rendered, expandable, inline-editable.
 * Thin wrapper over MarkdownDescription that persists through PUT /features/:id.
 */
export function FeatureDescription({
  featureId,
  description,
  canManage,
}: {
  featureId: string;
  description: string | null | undefined;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  return (
    <MarkdownDescription
      value={description}
      canManage={canManage}
      placeholder="Describe this feature… Markdown supported (**bold**, lists, `code`, tables)."
      onSave={async (next) => {
        await featuresApi.update(featureId, { description: next });
        qc.invalidateQueries({ queryKey: ['feature', featureId] });
      }}
    />
  );
}
