import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bug } from 'lucide-react';
import { issuesApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';

// ─── TestIssuesModal ─────────────────────────────────────────────────────────
// Quick peek at every issue logged against one test case. Opened from a test's
// bug-count badge; each row is clickable and routes to the full issue page.
// Rows light up with a purple border on hover for a clear click affordance.

interface IssueRow {
  id: string;
  title: string;
  status: string;
  severity: string;
  type: string;
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: '#fb7185',
  IN_PROGRESS: '#60a5fa',
  READY_FOR_QA: '#fb923c',
  RESOLVED: '#34d399',
  WONT_FIX: '#94a3b8',
  CLOSED: '#94a3b8',
};

export function TestIssuesModal({
  open,
  projectId,
  testDefinitionId,
  testName,
  onClose,
}: {
  open: boolean;
  projectId: string;
  testDefinitionId: string;
  testName: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery<{ items: IssueRow[] }>({
    queryKey: ['issues-for-test-definition', projectId, testDefinitionId],
    queryFn: () =>
      issuesApi.list(projectId, { testDefinitionId, limit: 50 }) as Promise<{ items: IssueRow[] }>,
    enabled: open && !!projectId && !!testDefinitionId,
  });

  const items = data?.items ?? [];

  const goToIssue = (id: string) => {
    onClose();
    navigate(`/issues/${id}`);
  };

  return (
    <Modal open={open} onClose={onClose} title={`Issues · ${testName}`} size="md">
      {isLoading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
      ) : items.length === 0 ? (
        <div className="py-8 text-center">
          <Bug size={22} className="mx-auto mb-2" style={{ color: 'rgba(238,238,248,0.3)' }} />
          <p className="text-sm text-slate-400">No issues logged against this test.</p>
        </div>
      ) : (
        <ul className="max-h-[55vh] overflow-y-auto space-y-1.5 pr-1">
          {items.map((row) => {
            const color = STATUS_COLOR[row.status] ?? '#94a3b8';
            return (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => goToIssue(row.id)}
                  className="w-full text-left rounded-lg px-3 py-2.5 border border-white/8 transition-colors hover:border-purple-500/60 hover:bg-purple-500/5"
                  style={{ background: 'rgba(255,255,255,0.03)' }}
                >
                  <p className="text-sm font-medium text-slate-100 line-clamp-2">{row.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] uppercase font-semibold tracking-wide">
                    <span className="text-slate-400">{row.type}</span>
                    <span className="text-slate-600">·</span>
                    <span style={{ color }}>{row.status.replace(/_/g, ' ')}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-slate-400">{row.severity}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
