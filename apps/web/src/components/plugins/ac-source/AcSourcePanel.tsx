import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink, RefreshCw, ExternalLink, Undo2, Hash, FileText, Check, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { acLinksApi, type AcSourceLink } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useActiveOrg } from '@/stores/authStore';
import { AcSourcePickerModal } from './AcSourcePickerModal';

/**
 * Mounts under a test's `description` field in the editor. Renders nothing
 * (other than a single "Link from ClickUp" button) when no AC source is
 * linked AND ClickUp is available. When linked, shows source + Sync action
 * with a confirm-before-replace modal.
 *
 * `onAfterApply` lets the parent refetch the test so the description shown
 * in the editor textarea updates.
 */
export function AcSourcePanel({
  testId,
  projectId,
  onAfterApply,
}: {
  testId: string;
  projectId: string;
  onAfterApply?: () => void;
}) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const q = useQuery({
    queryKey: ['ac-source', testId],
    queryFn: () => acLinksApi.get(testId),
    enabled: !!testId,
  });

  const sync = useMutation({
    mutationFn: () => acLinksApi.sync(testId),
    onSuccess: (res) => {
      qc.setQueryData(['ac-source', testId], (prev: { link: AcSourceLink | null; availableInstallId: string | null } | undefined) =>
        prev ? { ...prev, link: res.link } : prev,
      );
      setDiffOpen(true);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Sync failed';
      toast.error(msg);
    },
  });

  const apply = useMutation({
    mutationFn: () => acLinksApi.apply(testId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ac-source', testId] });
      toast.success('Description updated from ClickUp');
      setDiffOpen(false);
      onAfterApply?.();
    },
    onError: () => toast.error('Apply failed'),
  });

  const undo = useMutation({
    mutationFn: () => acLinksApi.undo(testId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ac-source', testId] });
      toast.success('Reverted to previous description');
      onAfterApply?.();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Undo failed';
      toast.error(msg);
    },
  });

  const unlink = useMutation({
    mutationFn: () => acLinksApi.unlink(testId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ac-source', testId] });
      toast.success('Unlinked');
    },
    onError: () => toast.error('Unlink failed'),
  });

  // Hide entirely if ClickUp is not available AND nothing is linked.
  // (If something is linked but the install was removed, we still show the
  // pill so the user can unlink it.)
  if (q.isLoading) return null;
  const link = q.data?.link ?? null;
  if (!link && !q.data?.availableInstallId) return null;

  // Unlinked state — show a single "Link from ClickUp" button.
  if (!link) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
          style={{
            background: 'rgba(var(--accent-rgb),0.10)',
            border: '1px solid rgba(var(--accent-rgb),0.28)',
            color: 'var(--accent-300)',
          }}
        >
          <Link2 size={11} /> Link AC from ClickUp
        </button>
        {pickerOpen && orgId && (
          <AcSourcePickerModal
            testId={testId}
            projectId={projectId}
            orgId={orgId}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </>
    );
  }

  const hasPendingSync = link.lastSyncedHash && link.lastSyncedHash !== link.lastAppliedHash;
  const canUndo = link.previousAppliedAt && (Date.now() - new Date(link.previousAppliedAt).getTime()) < 24 * 60 * 60 * 1000;

  // Linked state — pill with source info and Sync action.
  return (
    <>
      <div
        className="rounded-lg p-2.5 space-y-2"
        style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.22)' }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FileText size={11} className="text-purple-300 shrink-0" />
            <a
              href={link.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-purple-100 hover:text-white inline-flex items-center gap-1 truncate"
              title={`${link.pageTitle ?? ''}${link.sectionTitle ? ` › ${link.sectionTitle}` : ''}${link.itemTitle ? ` › ${link.itemTitle}` : ''}`}
            >
              <span className="truncate">{link.pageTitle ?? 'ClickUp doc'}</span>
              {link.sectionTitle && (
                <>
                  <Hash size={9} className="text-purple-300 shrink-0" />
                  <span className="truncate text-purple-200">{link.sectionTitle}</span>
                </>
              )}
              {link.itemTitle && (
                <>
                  <span className="text-purple-300 shrink-0">›</span>
                  <span className="truncate text-purple-200">{link.itemTitle}</span>
                </>
              )}
              <ExternalLink size={9} className="shrink-0 opacity-70" />
            </a>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-colors"
              style={{ background: 'rgba(var(--accent-rgb),0.16)', border: '1px solid rgba(var(--accent-rgb),0.35)', color: 'var(--accent-300)' }}
              title="Fetch latest content from ClickUp"
            >
              {sync.isPending ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              Sync
            </button>
            <button
              type="button"
              onClick={() => unlink.mutate()}
              disabled={unlink.isPending}
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] transition-colors"
              style={{ color: 'rgba(238,238,248,0.55)' }}
              title="Unlink — leaves the current description untouched"
            >
              <Unlink size={11} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
          <div>
            {link.lastSyncedAt
              ? <>Synced {timeAgo(link.lastSyncedAt)}{hasPendingSync && <span className="ml-1 text-amber-300">· changes pending</span>}</>
              : 'Not synced yet — press Sync to fetch'}
          </div>
          {canUndo && (
            <button
              type="button"
              onClick={() => undo.mutate()}
              disabled={undo.isPending}
              className="inline-flex items-center gap-1 hover:text-white transition-colors"
              title="Restore the previous description (within 24h)"
            >
              <Undo2 size={9} /> Undo last apply
            </button>
          )}
        </div>
      </div>

      {diffOpen && link && (
        <DiffModal
          link={link}
          syncResult={sync.data ?? null}
          isApplying={apply.isPending}
          onApply={() => apply.mutate()}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </>
  );
}

function DiffModal({
  link,
  syncResult,
  isApplying,
  onApply,
  onClose,
}: {
  link: AcSourceLink;
  syncResult: { currentDescription: string; hasChanges: boolean } | null;
  isApplying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const newContent = link.lastSyncedContent ?? '';
  const currentDescription = syncResult?.currentDescription ?? '';
  const noChange = !syncResult?.hasChanges;

  return (
    <Modal open onClose={onClose} title="Sync from ClickUp" size="lg">
      <div className="space-y-3">
        {noChange ? (
          <p className="text-xs flex items-center gap-2" style={{ color: 'rgba(74,222,128,0.85)' }}>
            <Check size={12} /> Already up to date — nothing to apply.
          </p>
        ) : (
          <p className="text-xs text-slate-400">
            Review the latest content from ClickUp. Applying replaces the current test description. You&apos;ll have 24 hours to undo.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Current description</div>
            <div
              className="rounded-md p-3 max-h-[360px] overflow-y-auto prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              {currentDescription
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentDescription}</ReactMarkdown>
                : <span className="text-slate-500 italic">(empty)</span>}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(196,181,253,0.85)' }}>From ClickUp</div>
            <div
              className="rounded-md p-3 max-h-[360px] overflow-y-auto prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5"
              style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.28)' }}
            >
              {newContent
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{newContent}</ReactMarkdown>
                : <span className="text-slate-500 italic">(empty)</span>}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={isApplying}>Cancel</Button>
          <Button onClick={onApply} loading={isApplying} disabled={noChange}>
            <Check className="w-3 h-3" /> Apply to description
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
