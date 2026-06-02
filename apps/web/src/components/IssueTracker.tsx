import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Check } from 'lucide-react';
import { issuesApi, pluginsApi, api, projectsApi } from '../lib/api';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { EvidenceUploader, type UploadedEvidence } from './EvidenceUploader';
import { toast } from '@/components/ui/Toast';
import { FAILURE_CATEGORIES, type FailureCategory } from '@/lib/failureCategories';

// ─── Types ────────────────────────────────────────────────────────────────────

type IssueType = 'BUG' | 'SNAG' | 'QUERY';

/**
 * Map the platform's three issue types to candidate ClickUp task-type names
 * (case-insensitive substring match). When the user picks a local type the
 * LogIssueModal auto-selects the best-matching ClickUp type so the pushed
 * ticket lands in the right category instead of always being a generic "Task".
 *
 * Order matters — first hit wins, so the most-specific match is listed first.
 */
const CLICKUP_TYPE_PATTERNS: Record<IssueType, string[]> = {
  BUG: ['bug', 'defect', 'clientbugticket'],
  SNAG: ['snag', 'issue', 'defect'],
  QUERY: ['query', 'question', 'clarification'],
};

/**
 * Find the first ClickUp task type whose name fuzzy-matches the local issue
 * type. Returns the type's stringified id, or null when nothing matches —
 * the LogIssueModal then falls back to the default "Task" type so we never
 * accidentally tag a Query as a Bug.
 */
function findClickUpTypeForLocal(
  local: IssueType,
  types: Array<{ id: string; label: string }>,
): string | null {
  const patterns = CLICKUP_TYPE_PATTERNS[local];
  for (const pattern of patterns) {
    const match = types.find((t) => t.label.toLowerCase().includes(pattern));
    if (match) return match.id;
  }
  return null;
}

type IssueSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type IssueStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX' | 'CLOSED';

interface IssueUser {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

interface IssueStatusHistoryEntry {
  id: string;
  fromStatus?: IssueStatus;
  toStatus: IssueStatus;
  note?: string;
  changedBy: Pick<IssueUser, 'id' | 'name' | 'avatarUrl'>;
  createdAt: string;
}

interface IssueComment {
  id: string;
  content: string;
  user: Pick<IssueUser, 'id' | 'name' | 'avatarUrl'>;
  createdAt: string;
  updatedAt: string;
}

import { CreateTicketDropdown } from '@/components/plugins/CreateTicketDropdown';
import { TicketLinksPanel } from '@/components/plugins/TicketLinksPanel';

interface Issue {
  id: string;
  type: IssueType;
  status: IssueStatus;
  severity: IssueSeverity;
  title: string;
  description?: string;
  stepsToReproduce?: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  screenshotUrls: string[];
  projectId: string;
  moduleId?: string;
  featureId?: string;
  testDefinitionId?: string;
  testRunId?: string;
  runStepId?: string;
  reportedBy: IssueUser;
  assignedTo?: IssueUser;
  resolvedBy?: IssueUser;
  resolvedAt?: string;
  feature?: { id: string; name: string };
  module?: { id: string; name: string };
  testDefinition?: { id: string; name: string };
  statusHistory: IssueStatusHistoryEntry[];
  comments: IssueComment[];
  createdAt: string;
  updatedAt: string;
}

interface IssueStats {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  wontFix: number;
  closed: number;
  byType: { BUG: number; SNAG: number; QUERY: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<IssueType, { label: string; icon: string; color: string; bg: string }> = {
  BUG:   { label: 'Bug',   icon: '🐛', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
  SNAG:  { label: 'Snag',  icon: '📌', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  QUERY: { label: 'Query', icon: '❓', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30' },
};

const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; color: string }> = {
  LOW:      { label: 'Low',      color: 'text-slate-400' },
  MEDIUM:   { label: 'Medium',   color: 'text-amber-400' },
  HIGH:     { label: 'High',     color: 'text-orange-400' },
  CRITICAL: { label: 'Critical', color: 'text-red-400' },
};

const STATUS_CONFIG: Record<IssueStatus, { label: string; color: string; bg: string }> = {
  OPEN:        { label: 'Open',        color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  RESOLVED:    { label: 'Resolved',    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30' },
  WONT_FIX:    { label: "Won't Fix",   color: 'text-slate-400',  bg: 'bg-slate-500/10 border-slate-500/30' },
  CLOSED:      { label: 'Closed',      color: 'text-slate-500',  bg: 'bg-slate-600/10 border-slate-600/30' },
};

// ─── Shared input styles ──────────────────────────────────────────────────────
const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors';
const inputStyle = { background: 'rgba(255,255,255,0.05)' };

// ─── IssueStatusBadge ─────────────────────────────────────────────────────────

function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function IssueTypeBadge({ type }: { type: IssueType }) {
  const cfg = TYPE_CONFIG[type];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.color}`}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── IssueStatsWidget ─────────────────────────────────────────────────────────

interface IssueStatsWidgetProps {
  scope: 'project' | 'module' | 'feature' | 'test';
  scopeId: string;
  projectId?: string;
  onOpenList?: () => void;
}

export function IssueStatsWidget({ scope, scopeId, onOpenList }: IssueStatsWidgetProps) {
  const queryFn = (): Promise<IssueStats> => {
    if (scope === 'project') return issuesApi.projectStats(scopeId) as Promise<IssueStats>;
    if (scope === 'module')  return issuesApi.moduleStats(scopeId) as Promise<IssueStats>;
    if (scope === 'feature') return issuesApi.featureStats(scopeId) as Promise<IssueStats>;
    return issuesApi.testStats(scopeId) as Promise<IssueStats>;
  };

  const { data: stats } = useQuery<IssueStats>({
    queryKey: ['issue-stats', scope, scopeId],
    queryFn,
    staleTime: 30_000,
  });

  if (!stats || stats.total === 0) return null;

  return (
    <button
      onClick={onOpenList}
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
      title="View issues"
    >
      {stats.byType.BUG   > 0 && <span className="text-red-400">🐛 {stats.byType.BUG}</span>}
      {stats.byType.SNAG  > 0 && <span className="text-amber-400">📌 {stats.byType.SNAG}</span>}
      {stats.byType.QUERY > 0 && <span className="text-blue-400">❓ {stats.byType.QUERY}</span>}
      {(stats.byType.BUG + stats.byType.SNAG + stats.byType.QUERY) > 0 && (stats.open > 0 || stats.resolved > 0) && (
        <span className="text-slate-500">·</span>
      )}
      {stats.open > 0 && (
        <span className="text-red-400 font-medium">{stats.open} open</span>
      )}
      {stats.resolved > 0 && (
        <span className="text-slate-400">{stats.resolved} resolved</span>
      )}
    </button>
  );
}

// ─── LogIssueModal ────────────────────────────────────────────────────────────

interface LogIssueModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  featureId?: string;
  moduleId?: string;
  testDefinitionId?: string;
  testRunId?: string;
  runStepId?: string;
  existingScreenshots?: string[];
  /** Pre-seeded evidence (e.g. screenshot/recording captured in floating bar). */
  initialEvidence?: UploadedEvidence[];
}

export function LogIssueModal({
  open, onClose, projectId,
  featureId, moduleId, testDefinitionId, testRunId, runStepId,
  existingScreenshots = [],
  initialEvidence,
}: LogIssueModalProps) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<IssueType>('BUG');
  const [severity, setSeverity] = useState<IssueSeverity>('MEDIUM');
  // Root-cause classification — feeds the org analytics donut. Defaults
  // to FUNCTIONALITY (the most common case) so QA can ignore it for the
  // 90% path and tune it for the 10% that's design / regression / etc.
  const [category, setCategory] = useState<FailureCategory>('FUNCTIONALITY');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [error, setError] = useState('');
  const [evidence, setEvidence] = useState<UploadedEvidence[]>(initialEvidence ?? []);
  const [assignedToId, setAssignedToId] = useState('');

  const { data: projectMembers = [] } = useQuery<Array<{
    user: { id: string; name: string; email: string; accountStatus?: string };
  }>>({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.listMembers(projectId),
    enabled: open && !!projectId,
    staleTime: 60_000,
  });

  const assignableMembers = projectMembers.filter(
    m => (m.user.accountStatus ?? 'ACTIVE') === 'ACTIVE',
  );

  const reset = () => {
    setType('BUG'); setSeverity('MEDIUM'); setCategory('FUNCTIONALITY');
    setTitle('');
    setDescription(''); setSteps(''); setExpected(''); setActual('');
    setError(''); setEvidence(initialEvidence ?? []);
    setAssignedToId('');
  };

  // ── ClickUp routing preview ──
  // We resolve where this issue would land at the most specific scope we
  // know about (feature → module → project) so the user can confirm
  // before submission.
  const routingScope: 'feature' | 'module' | 'project' = featureId ? 'feature' : moduleId ? 'module' : 'project';
  const routingScopeId = featureId ?? moduleId ?? projectId;
  const routingQ = useQuery({
    queryKey: ['clickup-routing', routingScope, routingScopeId],
    queryFn: () => api.get<{ install: { healthy: boolean } | null; listId: string | null; targetMode: string | null; parentTaskId: string | null; listIdInheritedLabel: string }>(`/api/v1/${routingScope}s/${routingScopeId}/clickup-routing`).then((r) => r.data),
    staleTime: 30_000,
    enabled: open,
  });
  const clickupAvailable = !!routingQ.data?.install?.healthy && !!routingQ.data?.listId;
  const [pushToClickUp, setPushToClickUp] = useState(true);

  // Placement — only meaningful for feature-scoped issues. "feature-subtask"
  // nests the bug under the feature's ClickUp task (inherits its fields);
  // "module-list" drops it at the module list top level so PMs working in
  // ClickUp see every module bug in one place, linked back to the feature.
  const [placement, setPlacement] = useState<'feature-subtask' | 'module-list'>('feature-subtask');
  // Default the placement to whatever the cascade already resolves: if the
  // feature routes to a subtask, keep that; otherwise list level.
  useEffect(() => {
    if (routingScope !== 'feature' || !routingQ.data) return;
    setPlacement(
      routingQ.data.targetMode === 'subtask' && routingQ.data.parentTaskId
        ? 'feature-subtask'
        : 'module-list',
    );
  }, [routingScope, routingQ.data]);

  // ClickUp custom task types — fetched only when push is enabled and the
  // routing resolves. Workspaces that never customised types return [] and
  // we skip the picker. Numeric ids round-trip as strings to keep the
  // dispatch payload JSON-stable.
  const taskTypesQ = useQuery({
    queryKey: ['clickup-task-types', projectId],
    queryFn: () => pluginsApi.listClickUpTaskTypes(projectId),
    enabled: open && clickupAvailable && pushToClickUp,
    staleTime: 60_000,
  });
  const [selectedTaskTypeId, setSelectedTaskTypeId] = useState<string>(''); // '' = default "Task" type
  const [taskTypeAutoMapped, setTaskTypeAutoMapped] = useState(false);

  /**
   * Auto-map the local issue type to the closest-named ClickUp task type:
   *
   *   BUG   → "Bug" / "Defect" / "Snag"          (anything snag-like)
   *   SNAG  → "Snag" / "Issue" / "Defect" / "Bug"
   *   QUERY → "Query" / "Question" / "Clarification"
   *
   * Falls back to "" (default ClickUp Task type) when nothing matches —
   * better than guessing wrong and creating a Bug ticket for a Query.
   *
   * Runs whenever the local type changes OR the catalog finally loads.
   * The user can still override via the ClickUp-type dropdown — when they
   * do, we clear the auto-mapped flag so the dropdown loses the "auto"
   * label. If they then change the local type again, auto-mapping kicks
   * back in.
   */
  useEffect(() => {
    const types = taskTypesQ.data?.items;
    if (!types || types.length === 0) return;
    const matched = findClickUpTypeForLocal(type, types);
    setSelectedTaskTypeId(matched ?? '');
    setTaskTypeAutoMapped(matched !== null);
  }, [type, taskTypesQ.data]);

  const { mutate: create, isPending } = useMutation({
    mutationFn: async () => {
      const issue = await issuesApi.create(projectId, {
        type, severity, category, title, description,
        stepsToReproduce: steps,
        expectedBehaviour: expected,
        actualBehaviour: actual,
        screenshotUrls: [
          ...existingScreenshots,
          ...evidence.filter(e => e.mimeType.startsWith('image/')).map(e => e.url),
        ],
        recordingUrl: evidence.find(e => e.mimeType.startsWith('video/'))?.url,
        featureId, moduleId, testDefinitionId, testRunId, runStepId,
        ...(assignedToId ? { assignedToId } : {}),
      }) as { id: string };

      // Optional: push to ClickUp inline. Failure here surfaces to the user
      // but doesn't unmake the platform issue — same shape as the manual
      // "Create ticket" button on the issue detail page.
      if (pushToClickUp && clickupAvailable && issue?.id) {
        try {
          await pluginsApi.pushIssue(issue.id, {
            ...(selectedTaskTypeId ? { customItemId: selectedTaskTypeId } : {}),
            // Placement only applies to feature-scoped issues; the backend
            // ignores it otherwise.
            ...(routingScope === 'feature' ? { placement } : {}),
          });
        } catch (err) {
          const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
          throw new Error(`Issue logged but push to ClickUp failed: ${msg ?? 'unknown error'}`);
        }
      }
      return issue;
    },
    onSuccess: () => {
      // Invalidate every issue-related query key currently mounted somewhere
      // in the app so the new bug appears immediately wherever the user
      // navigates next — no manual page refresh required. React Query
      // matches prefixes, so each call below covers a family of keys.
      queryClient.invalidateQueries({ queryKey: ['issue-stats'] });            // ['issue-stats', 'test', id] · ['issue-stats', 'feature', id] · etc.
      queryClient.invalidateQueries({ queryKey: ['issue-stats-strip'] });      // ScopedIssuesPanel header strip (feature / module / project)
      queryClient.invalidateQueries({ queryKey: ['issues-for-test-definition'] }); // TestingView issue drawer
      queryClient.invalidateQueries({ queryKey: ['issues'] });                 // anything keyed ['issues', projectId, …]
      queryClient.invalidateQueries({ queryKey: ['scoped-issues'] });          // ScopedIssuesPanel list — was missing, caused "refresh to see new bug"
      queryClient.invalidateQueries({ queryKey: ['ticket-links'] });           // ClickUp ticket pill / panel
      reset();
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as Error)?.message;
      setError(typeof msg === 'string' ? msg : 'Failed to log issue. Please try again.');
    },
  });

  const handleSubmit = () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setError('');
    create();
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Log Issue" size="lg">
      <div className="space-y-4">
        {/* Type picker */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Type</label>
          <div className="flex gap-2">
            {(['BUG', 'SNAG', 'QUERY'] as IssueType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg border text-xs font-medium transition-colors ${
                  type === t
                    ? `${TYPE_CONFIG[t].bg} ${TYPE_CONFIG[t].color}`
                    : 'border-white/10 text-slate-400 hover:border-white/20'
                }`}
                style={{ background: type === t ? undefined : 'rgba(255,255,255,0.04)' }}
              >
                {TYPE_CONFIG[t].icon} {TYPE_CONFIG[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* Severity + Category — side-by-side on wider modals so the form
            doesn't lengthen too much; both pickers stack on narrow widths.
            Category is the new root-cause field that feeds the org
            analytics donut. Defaults to FUNCTIONALITY so QA can ignore it. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Severity</label>
            <select
              value={severity}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSeverity(e.target.value as IssueSeverity)}
              className={`${inputCls} h-9`}
              style={inputStyle}
            >
              {(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as IssueSeverity[]).map((s) => (
                <option key={s} value={s}>{SEVERITY_CONFIG[s].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Category
              <span
                className="ml-1.5 text-[10px] font-normal"
                style={{ color: 'rgba(238,238,248,0.40)' }}
                title="Root cause — feeds the org analytics donut. Pick whatever's closest; default is fine for 90% of bugs."
              >
                (root cause)
              </span>
            </label>
            <select
              value={category}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setCategory(e.target.value as FailureCategory)}
              className={`${inputCls} h-9`}
              style={inputStyle}
            >
              {FAILURE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">
            Title <span className="text-red-400">*</span>
          </label>
          <input
            value={title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="Brief description of the issue..."
            className={`${inputCls} h-9`}
            style={inputStyle}
          />
        </div>

        {/* Assignee */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Assign to</label>
          <select
            value={assignedToId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAssignedToId(e.target.value)}
            className={`${inputCls} h-9`}
            style={inputStyle}
          >
            <option value="">Unassigned</option>
            {assignableMembers.map((member) => (
              <option key={member.user.id} value={member.user.id}>
                {member.user.name} ({member.user.email})
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
            placeholder="What happened? Any additional context..."
            rows={2}
            className={`${inputCls} resize-none`}
            style={inputStyle}
          />
        </div>

        {/* Steps / Expected / Actual — only for bug/snag */}
        {type !== 'QUERY' && (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Steps to Reproduce</label>
              <textarea
                value={steps}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setSteps(e.target.value)}
                placeholder={"1. Go to...\n2. Click...\n3. See error"}
                rows={3}
                className={`${inputCls} resize-none font-mono text-xs`}
                style={inputStyle}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Expected</label>
                <textarea
                  value={expected}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setExpected(e.target.value)}
                  placeholder="What should happen..."
                  rows={2}
                  className={`${inputCls} resize-none text-xs`}
                  style={inputStyle}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Actual</label>
                <textarea
                  value={actual}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setActual(e.target.value)}
                  placeholder="What actually happened..."
                  rows={2}
                  className={`${inputCls} resize-none text-xs`}
                  style={inputStyle}
                />
              </div>
            </div>
          </>
        )}

        {existingScreenshots.length > 0 && (
          <p className="text-xs text-slate-400">
            📎 {existingScreenshots.length} screenshot{existingScreenshots.length > 1 ? 's' : ''} from this step will be attached
          </p>
        )}

        {/* Evidence */}
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.6)' }}>
            Evidence (screenshots / recordings)
          </label>
          <EvidenceUploader
            value={evidence}
            onChange={setEvidence}
            testName={title || undefined}
            accept="image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4"
            label="Add Screenshot or Recording"
          />
        </div>

        {/* ClickUp push prompt — visible whenever a list resolves at the issue's scope. */}
        {clickupAvailable && routingQ.data && (
          <div
            className="rounded-lg p-2.5 space-y-2"
            style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.18)' }}
          >
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={pushToClickUp}
                onChange={(e) => setPushToClickUp(e.target.checked)}
                className="mt-0.5 accent-purple-500"
              />
              <div className="text-xs text-slate-200 flex-1">
                <div className="font-medium">Also push to ClickUp</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {routingScope === 'feature' ? (
                    <>Create a ClickUp ticket from this issue — choose where it lands below. Evidence files attached automatically.</>
                  ) : (
                    <>
                      Will create a {routingQ.data.targetMode === 'subtask' ? 'subtask under' : 'top-level task in'}{' '}
                      <code className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent-200)' }}>
                        {routingQ.data.targetMode === 'subtask' && routingQ.data.parentTaskId ? routingQ.data.parentTaskId : `list ${routingQ.data.listId}`}
                      </code>
                      <span className="text-slate-500"> ({routingQ.data.listIdInheritedLabel})</span>. Evidence files attached automatically.
                    </>
                  )}
                </div>
              </div>
            </label>

            {/* Placement — feature-scoped issues only. Lets the reporter put
                the bug under the feature's task (inherits its custom fields,
                incl. epic) OR at the module list level so a PM working in
                ClickUp sees every module bug in one place. */}
            {pushToClickUp && routingScope === 'feature' && (
              <div className="pl-6 space-y-1.5">
                <div className="text-[11px] text-slate-400">Where should the ClickUp bug ticket go?</div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="clickup-placement"
                    checked={placement === 'feature-subtask'}
                    onChange={() => setPlacement('feature-subtask')}
                    className="mt-0.5 accent-purple-500"
                  />
                  <div className="text-[11px] text-slate-300">
                    <span className="font-medium text-slate-200">Subtask of the feature's ClickUp task</span>
                    <div className="text-slate-500">
                      Nests under the feature ticket and inherits its custom fields (incl. epic). Needs the feature linked to ClickUp.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="clickup-placement"
                    checked={placement === 'module-list'}
                    onChange={() => setPlacement('module-list')}
                    className="mt-0.5 accent-purple-500"
                  />
                  <div className="text-[11px] text-slate-300">
                    <span className="font-medium text-slate-200">Top-level task in the module list</span>
                    <div className="text-slate-500">
                      A PM working in ClickUp sees every module bug in one list. Linked back to the feature ticket.
                    </div>
                  </div>
                </label>
              </div>
            )}

            {/* Custom task-type picker — only rendered when push is enabled
                AND the workspace has > 0 custom types. Workspaces without
                custom task types just create the default "Task". */}
            {pushToClickUp && (taskTypesQ.data?.items.length ?? 0) > 0 && (
              <div className="pl-6">
                <label className="block text-[11px] text-slate-400 mb-1 flex items-center gap-1.5">
                  <span>ClickUp task type</span>
                  {taskTypeAutoMapped && selectedTaskTypeId && (
                    <span
                      className="text-[9px] uppercase tracking-wide px-1 py-0.5 rounded"
                      style={{
                        background: 'rgba(var(--accent-rgb),0.14)',
                        color: 'var(--accent-300)',
                        border: '1px solid rgba(var(--accent-rgb),0.35)',
                      }}
                      title={`Auto-mapped from your "${type}" pick — change the local type or pick another ClickUp type to override.`}
                    >
                      auto
                    </span>
                  )}
                  <span className="text-slate-500">(matches the type ClickUp will assign in the list)</span>
                </label>
                <select
                  value={selectedTaskTypeId}
                  onChange={(e) => {
                    setSelectedTaskTypeId(e.target.value);
                    setTaskTypeAutoMapped(false);
                  }}
                  className="w-full px-2 py-1.5 rounded text-xs"
                  style={{
                    background: 'rgba(0,0,0,0.30)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(238,238,248,0.92)',
                  }}
                >
                  <option value="">Task (default)</option>
                  {taskTypesQ.data?.items.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={isPending} disabled={!title.trim()}>
            {TYPE_CONFIG[type].icon} Log {TYPE_CONFIG[type].label}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── IssueDetailModal ─────────────────────────────────────────────────────────

interface IssueDetailModalProps {
  issueId: string | null;
  onClose: () => void;
}

export function IssueDetailModal({ issueId, onClose }: IssueDetailModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [changingStatus, setChangingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState<IssueStatus>('OPEN');
  const [statusNote, setStatusNote] = useState('');
  const [shareLinkCopied, setShareLinkCopied] = useState(false);

  useEffect(() => {
    setShareLinkCopied(false);
  }, [issueId]);

  const { data: issue, isLoading } = useQuery<Issue>({
    queryKey: ['issue', issueId],
    queryFn: () => issuesApi.get(issueId!) as Promise<Issue>,
    enabled: !!issueId,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['issue', issueId] });
    void queryClient.invalidateQueries({ queryKey: ['issue-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['issue-stats-strip'] });
    void queryClient.invalidateQueries({ queryKey: ['issues'] });
    void queryClient.invalidateQueries({ queryKey: ['issues-for-test-definition'] });
    void queryClient.invalidateQueries({ queryKey: ['scoped-issues'] });
  };

  const { mutate: changeStatus, isPending: changingStatusPending } = useMutation({
    mutationFn: () => issuesApi.changeStatus(issueId!, { status: newStatus, note: statusNote }),
    onSuccess: () => { invalidate(); setChangingStatus(false); setStatusNote(''); },
  });

  const { mutate: addComment, isPending: addingComment } = useMutation({
    mutationFn: () => issuesApi.addComment(issueId!, comment),
    onSuccess: () => { invalidate(); setComment(''); },
  });

  const handleViewInTest = () => {
    if (!issue) return;
    if (issue.testDefinition?.id) {
      navigate(`/projects/${issue.projectId}/tests/${issue.testDefinition.id}/edit`);
    } else if (issue.featureId) {
      navigate(`/projects/${issue.projectId}/features/${issue.featureId}`);
    } else {
      navigate(`/projects/${issue.projectId}`);
    }
    onClose();
  };

  const handleCopyShareUrl = async () => {
    if (!issue?.id) return;
    const url = `${window.location.origin}/issues/${issue.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareLinkCopied(true);
      toast.success('Link copied', 'Paste anywhere — recipient must sign in and have project access.');
      window.setTimeout(() => setShareLinkCopied(false), 2000);
    } catch {
      toast.error('Could not copy', url);
    }
  };

  return (
    <Modal open={!!issueId} onClose={onClose} title="Issue Detail" size="lg">
      {isLoading || !issue ? (
        <div className="flex items-center justify-center py-12 text-slate-400 text-sm">Loading…</div>
      ) : (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <IssueTypeBadge type={issue.type} />
                <IssueStatusBadge status={issue.status} />
                <span className={`text-xs font-medium ${SEVERITY_CONFIG[issue.severity].color}`}>
                  {SEVERITY_CONFIG[issue.severity].label}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-slate-100 leading-snug">{issue.title}</h3>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <button
                type="button"
                onClick={() => void handleCopyShareUrl()}
                title="Copy shareable issue URL (auth required to view)"
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:border-sky-500/45 hover:text-sky-300 transition-colors inline-flex items-center gap-1.5"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                {shareLinkCopied ? <Check size={14} className="text-emerald-400" /> : <Link2 size={14} />}
                {shareLinkCopied ? 'Copied' : 'Copy link'}
              </button>
              <button
                onClick={handleViewInTest}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/10 text-slate-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                View in test ↗
              </button>
            </div>
          </div>

          {/* Meta */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
            <span>Logged by <span className="text-slate-200">{issue.reportedBy.name}</span></span>
            <span>{formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}</span>
            {issue.feature  && <span>Feature: <span className="text-slate-200">{issue.feature.name}</span></span>}
            {issue.module   && <span>Module: <span className="text-slate-200">{issue.module.name}</span></span>}
            {issue.testDefinition && <span>Test: <span className="text-slate-200">{issue.testDefinition.name}</span></span>}
            {issue.assignedTo && <span>Assigned: <span className="text-slate-200">{issue.assignedTo.name}</span></span>}
          </div>

          {/* Description */}
          {issue.description && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Description</p>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{issue.description}</p>
            </div>
          )}

          {/* Steps / Expected / Actual */}
          {issue.stepsToReproduce && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-1">Steps to Reproduce</p>
              <pre className="text-xs text-slate-200 whitespace-pre-wrap rounded-lg p-3 border border-white/8" style={{ background: 'rgba(255,255,255,0.04)' }}>
                {issue.stepsToReproduce}
              </pre>
            </div>
          )}
          {(issue.expectedBehaviour || issue.actualBehaviour) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {issue.expectedBehaviour && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Expected</p>
                  <p className="text-xs text-slate-200 rounded-lg p-2 border border-white/8" style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {issue.expectedBehaviour}
                  </p>
                </div>
              )}
              {issue.actualBehaviour && (
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-1">Actual</p>
                  <p className="text-xs text-red-300 rounded-lg p-2 border border-red-900/30" style={{ background: 'rgba(220,38,38,0.08)' }}>
                    {issue.actualBehaviour}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* External ticket links + status pull-back */}
          <TicketLinksPanel scope="issue" scopeId={issue.id} />

          {/* Create external ticket via the plugin registry */}
          <CreateTicketDropdown
            projectId={issue.projectId}
            scope={{ kind: 'issue', issueId: issue.id }}
            title={issue.title}
            description={[
              issue.description ? `**Description**\n\n${issue.description}` : null,
              issue.stepsToReproduce ? `**Steps to reproduce**\n\n${issue.stepsToReproduce}` : null,
              issue.expectedBehaviour ? `**Expected**\n\n${issue.expectedBehaviour}` : null,
              issue.actualBehaviour ? `**Actual**\n\n${issue.actualBehaviour}` : null,
            ].filter(Boolean).join('\n\n')}
            severity={issue.severity?.toLowerCase() as 'low' | 'medium' | 'high' | 'critical' | undefined}
            labels={['qa-platform', issue.type?.toLowerCase()].filter(Boolean) as string[]}
          />

          {/* Change Status */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '12px' }}>
            {!changingStatus ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Status:</span>
                <IssueStatusBadge status={issue.status} />
                <button
                  onClick={() => { setChangingStatus(true); setNewStatus(issue.status); }}
                  className="text-xs px-2 py-1 rounded-lg border border-white/10 text-slate-300 hover:border-purple-500/50 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.04)' }}
                >
                  Change Status
                </button>
              </div>
            ) : (
              <div className="space-y-2 rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p className="text-xs font-medium text-slate-300">Change Status</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setNewStatus(s)}
                      className={`px-2 py-1 rounded border text-xs transition-colors ${
                        newStatus === s ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}` : 'border-white/10 text-slate-400 hover:border-white/20'
                      }`}
                      style={{ background: newStatus === s ? undefined : 'rgba(255,255,255,0.04)' }}
                    >
                      {STATUS_CONFIG[s].label}
                    </button>
                  ))}
                </div>
                <input
                  value={statusNote}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStatusNote(e.target.value)}
                  placeholder="Optional note (e.g. 'Fixed in build #42')…"
                  className={`${inputCls} h-8 text-xs`}
                  style={inputStyle}
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setChangingStatus(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={() => changeStatus()}
                    loading={changingStatusPending}
                    disabled={newStatus === issue.status}
                  >
                    Update Status
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Status History */}
          {issue.statusHistory.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">History</p>
              <div className="space-y-2">
                {issue.statusHistory.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-2 text-xs">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-slate-300">{entry.changedBy.name}</span>
                      {entry.fromStatus ? (
                        <span className="text-slate-500">
                          {' '}changed from{' '}
                          <span className={STATUS_CONFIG[entry.fromStatus].color}>{STATUS_CONFIG[entry.fromStatus].label}</span>
                          {' '}to{' '}
                          <span className={STATUS_CONFIG[entry.toStatus].color}>{STATUS_CONFIG[entry.toStatus].label}</span>
                        </span>
                      ) : (
                        <span className="text-slate-500"> created issue</span>
                      )}
                      {entry.note && <span className="text-slate-400"> — {entry.note}</span>}
                      <span className="text-slate-600 ml-1">
                        · {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comments */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">
              Comments {issue.comments.length > 0 && `(${issue.comments.length})`}
            </p>
            {issue.comments.length > 0 && (
              <div className="space-y-3 mb-3">
                {issue.comments.map((c) => (
                  <div key={c.id} className="flex gap-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{ background: 'rgba(var(--accent-rgb),0.5)' }}>
                      {c.user.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-slate-200">{c.user.name}</span>
                        <span className="text-xs text-slate-500">
                          {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 whitespace-pre-wrap">{c.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <textarea
                value={comment}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
                placeholder="Add a comment…"
                rows={2}
                className={`flex-1 ${inputCls} resize-none text-xs`}
                style={inputStyle}
              />
              <Button onClick={() => addComment()} loading={addingComment} disabled={!comment.trim()} size="sm">
                Post
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── IssueListDrawer ──────────────────────────────────────────────────────────

interface IssueListDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  moduleId?: string;
  featureId?: string;
  testDefinitionId?: string;
  scopeLabel?: string;
}

export function IssueListDrawer({
  open, onClose, projectId,
  moduleId, featureId, testDefinitionId, scopeLabel,
}: IssueListDrawerProps) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [search, setSearch]             = useState('');
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const params = {
    page, limit: 20,
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(typeFilter   ? { type: typeFilter }     : {}),
    ...(search       ? { search }               : {}),
    ...(moduleId         ? { moduleId }         : {}),
    ...(featureId        ? { featureId }        : {}),
    ...(testDefinitionId ? { testDefinitionId } : {}),
  };

  const { data, isLoading } = useQuery<{
    items: Issue[]; total: number; pages: number; page: number;
  }>({
    queryKey: ['issues', projectId, params],
    queryFn: () => issuesApi.list(projectId, params) as Promise<{ items: Issue[]; total: number; pages: number; page: number }>,
    enabled: open,
  });

  const { mutate: deleteIssue } = useMutation({
    mutationFn: (id: string) => issuesApi.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: ['issue-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['issue-stats-strip'] });
      void queryClient.invalidateQueries({ queryKey: ['scoped-issues'] });
    },
  });

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />}
      <div
        className={`fixed right-0 top-0 h-full z-50 w-full max-w-2xl flex flex-col transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ background: 'rgba(18,18,32,0.98)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderLeft: '1px solid rgba(255,255,255,0.08)', boxShadow: '-8px 0 40px rgba(0,0,0,0.6)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div>
            <h2 className="font-semibold text-slate-100 text-sm">Issues</h2>
            {scopeLabel && <p className="text-xs text-slate-400 mt-0.5">{scopeLabel}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">×</button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 px-5 py-3 flex-wrap" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <input
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…"
            className="h-7 px-2.5 text-xs rounded-lg border border-white/10 text-slate-100 placeholder:text-slate-500 focus:border-purple-500/50 focus:outline-none w-36"
            style={{ background: 'rgba(255,255,255,0.05)' }}
          />
          <select
            value={statusFilter || 'ALL'}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value === 'ALL' ? '' : e.target.value); setPage(1); }}
            className="h-7 px-2 text-xs rounded-lg border border-white/10 text-slate-100 focus:outline-none w-32"
            style={{ background: 'rgba(18,18,32,0.98)' }}
          >
            <option value="ALL">All statuses</option>
            {(Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            ))}
          </select>
          <select
            value={typeFilter || 'ALL'}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setTypeFilter(e.target.value === 'ALL' ? '' : e.target.value); setPage(1); }}
            className="h-7 px-2 text-xs rounded-lg border border-white/10 text-slate-100 focus:outline-none w-28"
            style={{ background: 'rgba(18,18,32,0.98)' }}
          >
            <option value="ALL">All types</option>
            {(Object.keys(TYPE_CONFIG) as IssueType[]).map((t) => (
              <option key={t} value={t}>{TYPE_CONFIG[t].icon} {TYPE_CONFIG[t].label}</option>
            ))}
          </select>
          <span className="text-xs text-slate-500 ml-auto">
            {data?.total ?? 0} issue{data?.total !== 1 ? 's' : ''}
          </span>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">Loading…</div>
          ) : !data?.items.length ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-500">
              <div className="text-4xl mb-2">🎉</div>
              <p className="text-sm font-medium text-slate-400">No issues found</p>
              <p className="text-xs mt-1">
                {statusFilter || typeFilter || search ? 'Try adjusting your filters' : 'No issues have been logged yet'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {data.items.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  onView={() => setSelectedIssueId(issue.id)}
                  onDelete={() => { if (confirm('Soft-delete this issue?')) deleteIssue(issue.id); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {data && data.pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              Previous
            </Button>
            <span className="text-xs text-slate-400">Page {page} of {data.pages}</span>
            <Button variant="secondary" size="sm" disabled={page === data.pages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        )}
      </div>

      <IssueDetailModal issueId={selectedIssueId} onClose={() => setSelectedIssueId(null)} />
    </>
  );
}

// ─── IssueRow ─────────────────────────────────────────────────────────────────

function IssueRow({ issue, onView, onDelete }: { issue: Issue; onView: () => void; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  const { mutate: quickStatus } = useMutation({
    mutationFn: (status: IssueStatus) => issuesApi.changeStatus(issue.id, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['issues'] });
      void queryClient.invalidateQueries({ queryKey: ['issue-stats'] });
      void queryClient.invalidateQueries({ queryKey: ['issue-stats-strip'] });
      void queryClient.invalidateQueries({ queryKey: ['scoped-issues'] });
      setShowStatusMenu(false);
    },
  });

  return (
    <div className="px-5 py-3 hover:bg-white/3 transition-colors">
      <div className="flex items-start gap-3">
        <span className="text-base mt-0.5 shrink-0">{TYPE_CONFIG[issue.type].icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <IssueStatusBadge status={issue.status} />
            <span className={`text-xs ${SEVERITY_CONFIG[issue.severity].color}`}>{SEVERITY_CONFIG[issue.severity].label}</span>
            {issue.feature && <span className="text-xs text-slate-500">{issue.feature.name}</span>}
          </div>
          <p className="text-sm text-slate-200 truncate font-medium">{issue.title}</p>
          {issue.description && <p className="text-xs text-slate-400 truncate mt-0.5">{issue.description}</p>}
          <p className="text-xs text-slate-500 mt-1">
            {issue.reportedBy.name} · {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
            {issue.testDefinition && ` · ${issue.testDefinition.name}`}
            {issue.assignedTo?.name && ` · Assigned to ${issue.assignedTo.name}`}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Quick status */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="text-xs px-2 py-1 rounded border border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200 transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >⟳</button>
            {showStatusMenu && (
              <div className="absolute right-0 top-8 z-10 rounded-lg py-1 w-36" style={{ background: 'rgba(18,18,32,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                {(Object.keys(STATUS_CONFIG) as IssueStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => quickStatus(s)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors ${STATUS_CONFIG[s].color} ${s === issue.status ? 'bg-white/5' : ''}`}
                  >
                    {STATUS_CONFIG[s].label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={onView}
            className="text-xs px-2 py-1 rounded border border-white/10 text-slate-400 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >View</button>
          <button
            onClick={onDelete}
            className="text-xs px-2 py-1 rounded border border-white/10 text-slate-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >✕</button>
        </div>
      </div>
    </div>
  );
}

// ─── LogIssueButton ───────────────────────────────────────────────────────────

interface LogIssueButtonProps {
  projectId: string;
  featureId?: string;
  moduleId?: string;
  testDefinitionId?: string;
  testRunId?: string;
  runStepId?: string;
  existingScreenshots?: string[];
  className?: string;
}

export function LogIssueButton({
  projectId, featureId, moduleId, testDefinitionId,
  testRunId, runStepId, existingScreenshots, className,
}: LogIssueButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className={className}
      >
        🐛 Log Issue
      </Button>
      <LogIssueModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        featureId={featureId}
        moduleId={moduleId}
        testDefinitionId={testDefinitionId}
        testRunId={testRunId}
        runStepId={runStepId}
        existingScreenshots={existingScreenshots}
      />
    </>
  );
}

// ─── IssueListDrawerButton ─────────────────────────────────────────────────────
// Drop-in wrapper that shows the stats widget AND opens the drawer on click.

interface IssueListDrawerButtonProps {
  projectId: string;
  scope: 'project' | 'module' | 'feature' | 'test';
  scopeId: string;
  scopeLabel?: string;
  moduleId?: string;
  featureId?: string;
  testDefinitionId?: string;
}

export function IssueListDrawerButton({
  projectId, scope, scopeId, scopeLabel,
  moduleId, featureId, testDefinitionId,
}: IssueListDrawerButtonProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <>
      <IssueStatsWidget scope={scope} scopeId={scopeId} projectId={projectId} onOpenList={() => setDrawerOpen(true)} />
      <IssueListDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        projectId={projectId}
        moduleId={moduleId}
        featureId={featureId}
        testDefinitionId={testDefinitionId}
        scopeLabel={scopeLabel}
      />
    </>
  );
}
