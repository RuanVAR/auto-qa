import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MoreVertical,
  Bug,
  FlaskConical,
  PlayCircle,
  ListVideo,
  CheckCircle,
  Archive,
} from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

export interface IssueRowActionsMenuProps {
  issueId: string;
  projectId: string;
  /** Required for "Open Testing Mode" link */
  featureId?: string | null;
  status: string;
  testDefinitionId?: string | null;
  testRunId?: string | null;
  runStepId?: string | null;
  compact?: boolean;
}

/** Build `/projects/.../features/.../test` deep link; null when feature is unknown. */
export function buildTestingModeHref(
  projectId: string,
  featureId: string | null | undefined,
  issueId: string,
  testDefinitionId?: string | null,
  testRunId?: string | null,
  runStepId?: string | null,
): string | null {
  if (!featureId) return null;
  const q = new URLSearchParams();
  if (testDefinitionId) q.set('testCaseId', testDefinitionId);
  if (testRunId) q.set('testRunId', testRunId);
  q.set('issue', issueId);
  if (runStepId) q.set('highlightStep', runStepId);
  return `/projects/${projectId}/features/${featureId}/test?${q.toString()}`;
}

export function IssueRowActionsMenu({
  issueId,
  projectId,
  featureId,
  status,
  testDefinitionId,
  testRunId,
  runStepId,
  compact = false,
}: IssueRowActionsMenuProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onDoc);
    };
  }, [open]);

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['issues'] });
    await qc.invalidateQueries({ queryKey: ['issues', projectId] });
    await qc.invalidateQueries({ queryKey: ['scoped-issues', projectId] });
    await qc.invalidateQueries({ queryKey: ['issue-stats-strip'] });
    if (featureId) {
      await qc.invalidateQueries({ queryKey: ['issues', projectId, 'feature', featureId] });
      await qc.invalidateQueries({ queryKey: ['issue-stats', 'feature', featureId] });
    }
    await qc.invalidateQueries({ queryKey: ['issue-stats'] });
  };

  const closeMut = useMutation({
    mutationFn: () => issuesApi.changeStatus(issueId, { status: 'CLOSED' }),
    onSuccess: async () => {
      toast.success('Issue closed');
      setOpen(false);
      await invalidate();
    },
    onError: () => toast.error('Could not close issue'),
  });

  const archiveMut = useMutation({
    mutationFn: () => issuesApi.remove(issueId),
    onSuccess: async () => {
      toast.success('Issue archived');
      setOpen(false);
      await invalidate();
    },
    onError: () => toast.error('Could not archive issue'),
  });

  const testingHref = buildTestingModeHref(
    projectId,
    featureId,
    issueId,
    testDefinitionId,
    testRunId,
    runStepId,
  );
  const testEditorHref = testDefinitionId
    ? `/projects/${projectId}/tests/${testDefinitionId}/edit`
    : null;
  const runHref = testRunId ? `/runs/${testRunId}` : null;

  const showClose = status !== 'CLOSED';

  const onArchive = () => {
    if (
      !globalThis.confirm(
        'Archive this issue? It disappears from this list but stays in the database (soft delete).',
      )
    ) {
      return;
    }
    archiveMut.mutate();
  };

  type Item = { key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean };

  const items: Item[] = [
    {
      key: 'issue',
      label: 'View issue page',
      icon: <Bug size={14} />,
      onClick: () => {
        setOpen(false);
        navigate(`/issues/${issueId}`);
      },
    },
    ...(testEditorHref
      ? [
          {
            key: 'editor',
            label: 'Open test (editor)',
            icon: <FlaskConical size={14} />,
            onClick: () => {
              setOpen(false);
              navigate(testEditorHref);
            },
          } satisfies Item,
        ]
      : []),
    ...(testingHref
      ? [
          {
            key: 'testing',
            label: 'Open Testing Mode',
            icon: <PlayCircle size={14} />,
            onClick: () => {
              setOpen(false);
              navigate(testingHref);
            },
          } satisfies Item,
        ]
      : []),
    ...(runHref
      ? [
          {
            key: 'run',
            label: 'View run',
            icon: <ListVideo size={14} />,
            onClick: () => {
              setOpen(false);
              navigate(runHref);
            },
          } satisfies Item,
        ]
      : []),
    ...(showClose
      ? [
          {
            key: 'close',
            label: 'Mark as closed',
            icon: <CheckCircle size={14} />,
            onClick: () => closeMut.mutate(),
          } satisfies Item,
        ]
      : []),
    {
      key: 'archive',
      label: 'Archive issue',
      icon: <Archive size={14} />,
      onClick: onArchive,
      danger: true,
    },
  ];

  const busy = closeMut.isPending || archiveMut.isPending;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        disabled={busy}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={[
          'rounded-lg flex items-center justify-center transition-colors',
          compact ? 'p-1' : 'p-1.5',
          open ? 'bg-white/10' : 'hover:bg-white/6',
        ].join(' ')}
        style={{ color: 'rgba(238,238,248,0.65)' }}
        title="Issue actions"
        aria-label="Issue actions"
        aria-expanded={open}
      >
        <MoreVertical size={compact ? 15 : 16} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-[60] min-w-[200px] max-w-[260px] rounded-xl overflow-hidden py-1"
          style={{
            background: 'rgba(18,18,28,0.98)',
            border: '1px solid rgba(139,92,246,0.28)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                item.onClick();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
              style={{
                color: item.danger ? '#fb7185' : 'rgba(238,238,248,0.88)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <span className="shrink-0 opacity-80">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
