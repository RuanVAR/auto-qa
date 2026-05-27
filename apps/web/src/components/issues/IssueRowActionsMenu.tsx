import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MoreVertical,
  Eye,
  FlaskConical,
  PlayCircle,
  History,
  CheckCircle,
  Archive,
} from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { Tooltip } from '@/components/ui/Tooltip';

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
  /**
   * When true, omit navigation entries (view issue / test editor /
   * Testing Mode / view run) — the caller already renders these as
   * standalone icons next to the menu, so showing them again would just
   * duplicate the on-row affordances.
   */
  hideNavigationItems?: boolean;
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
  hideNavigationItems = false,
}: IssueRowActionsMenuProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  // Portal-render the menu so it escapes the Table's overflow-x-auto
  // wrapper (which establishes an overflow context that was clipping the
  // dropdown — that's why "..." appeared to do nothing).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const place = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      // Anchor menu's top-right at the button's bottom-right.
      setCoords({ x: r.right, y: r.bottom + 4 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent | KeyboardEvent) {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false);
        return;
      }
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
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

  type Item = { key: string; label: string; icon: ReactNode; onClick: () => void; danger?: boolean };

  const navItems: Item[] = hideNavigationItems
    ? []
    : [
        {
          key: 'issue',
          label: 'View issue details',
          icon: <Eye size={14} />,
          onClick: () => {
            setOpen(false);
            navigate(`/issues/${issueId}`);
          },
        },
        ...(testEditorHref
          ? [
              {
                key: 'editor',
                label: 'Edit test case',
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
                label: 'Open in Testing Mode',
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
                label: 'View test run history',
                icon: <History size={14} />,
                onClick: () => {
                  setOpen(false);
                  navigate(runHref);
                },
              } satisfies Item,
            ]
          : []),
      ];

  const items: Item[] = [
    ...navItems,
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
    <div className="relative shrink-0">
      <Tooltip label="More actions">
        <button
          ref={triggerRef}
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
            open ? 'bg-white/10' : 'hover:bg-white/[0.08]',
          ].join(' ')}
          style={{ color: 'rgba(238,238,248,0.65)' }}
          aria-label="Issue actions"
          aria-expanded={open}
        >
          <MoreVertical size={compact ? 15 : 16} />
        </button>
      </Tooltip>

      {open && coords &&
        createPortal(
          <div
            ref={menuRef}
            className="min-w-[180px] max-w-[240px] rounded-xl overflow-hidden py-1"
            style={{
              position: 'fixed',
              left: coords.x,
              top: coords.y,
              transform: 'translateX(-100%)',
              zIndex: 9999,
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
          </div>,
          document.body,
        )}
    </div>
  );
}
