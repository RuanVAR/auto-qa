import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { issuesApi } from '@/lib/api';
import { CreateTicketDropdown } from '@/components/plugins/CreateTicketDropdown';
import { TicketLinksPanel } from '@/components/plugins/TicketLinksPanel';
import { useAuthStore } from '@/stores/authStore';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  ExternalLink,
  Play,
  Trash2,
  X,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type IssueType = 'BUG' | 'SNAG' | 'QUERY';
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
  deletedAt?: string;
}

interface IssueViewer {
  id: string;
  name: string;
  lastViewedAt: string;
}

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
  recordingUrl?: string;
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
  deletedAt?: string;
  project?: { id: string; name: string };
  feature?: { id: string; name: string };
  module?: { id: string; name: string };
  testDefinition?: { id: string; name: string };
  statusHistory: IssueStatusHistoryEntry[];
  comments: IssueComment[];
  createdAt: string;
  updatedAt: string;
}

// ─── Config Maps ──────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<IssueType, { label: string; icon: string; color: string; bg: string }> = {
  BUG:   { label: 'Bug',   icon: '🐛', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
  SNAG:  { label: 'Snag',  icon: '📌', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  QUERY: { label: 'Query', icon: '❓', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30' },
};

const SEVERITY_CONFIG: Record<IssueSeverity, { label: string; color: string; bg: string }> = {
  LOW:      { label: 'Low',      color: 'text-slate-400',  bg: 'bg-slate-500/10 border-slate-500/30' },
  MEDIUM:   { label: 'Medium',   color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  HIGH:     { label: 'High',     color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
  CRITICAL: { label: 'Critical', color: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/30' },
};

const STATUS_CONFIG: Record<IssueStatus, { label: string; color: string; bg: string }> = {
  OPEN:        { label: 'Open',        color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-500/30' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/30' },
  RESOLVED:    { label: 'Resolved',    color: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/30' },
  WONT_FIX:    { label: "Won't Fix",   color: 'text-slate-400',  bg: 'bg-slate-500/10 border-slate-500/30' },
  CLOSED:      { label: 'Closed',      color: 'text-slate-500',  bg: 'bg-slate-600/10 border-slate-600/30' },
};

const STATUS_TRANSITIONS: Record<IssueStatus, IssueStatus[]> = {
  OPEN:        ['IN_PROGRESS', 'WONT_FIX', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'WONT_FIX', 'OPEN'],
  RESOLVED:    ['CLOSED', 'OPEN'],
  WONT_FIX:    ['OPEN'],
  CLOSED:      ['OPEN'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors';
const inputStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.05)' };

function linkifyText(text: string): React.ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:text-purple-300 underline break-all">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function renderMentions(text: string): React.ReactNode[] {
  const mentionRegex = /(@\w+)/g;
  const parts = text.split(mentionRegex);
  return parts.map((part, i) =>
    mentionRegex.test(part) ? (
      <span key={i} className="text-purple-400 font-bold">{part}</span>
    ) : (
      <React.Fragment key={i}>{linkifyText(part)}</React.Fragment>
    ),
  );
}

function Avatar({ name, size = 'sm' }: Readonly<{ name: string; size?: 'sm' | 'md' }>) {
  const dim = size === 'md' ? 'w-8 h-8 text-sm' : 'w-6 h-6 text-xs';
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-bold shrink-0`}
      style={{ background: 'rgba(124,58,237,0.5)' }}
    >
      {name[0]?.toUpperCase() ?? '?'}
    </div>
  );
}

function ScreenshotImage({ url, idx }: Readonly<{ url: string; idx: number }>) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex flex-col items-center gap-2 text-slate-400">
        <span className="text-4xl">🖼️</span>
        <span className="text-sm">Image unavailable</span>
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={`Screenshot ${idx + 1}`}
      className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={() => {}}
      onError={() => setBroken(true)}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function IssuePage() {
  const { issueId } = useParams<{ issueId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);

  // State
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [pendingStatus, setPendingStatus] = useState<IssueStatus | null>(null);
  const [comment, setComment] = useState('');
  const [copied, setCopied] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const commentRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightComment, setHighlightComment] = useState<string | null>(null);

  // ─── Queries ──────────────────────────────────────────────────────────────

  const { data: issue, isLoading, error } = useQuery<Issue>({
    queryKey: ['issue', issueId],
    queryFn: () => issuesApi.get(issueId!),
    enabled: !!issueId,
    staleTime: 60_000,
  });

  const { data: viewers = [] } = useQuery<IssueViewer[]>({
    queryKey: ['issue-viewers', issueId],
    queryFn: () => issuesApi.getViewers(issueId!),
    enabled: !!issueId,
    staleTime: 30_000,
  });

  const { data: comments = [] } = useQuery<IssueComment[]>({
    queryKey: ['issue-comments', issueId],
    queryFn: () => issuesApi.listComments(issueId!),
    enabled: !!issueId,
    staleTime: 15_000,
  });

  const { data: mentionableUsers = [] } = useQuery<{ id: string; name: string; email?: string }[]>({
    queryKey: ['issue-mentionable', issueId],
    queryFn: () => issuesApi.getMentionable(issueId!),
    enabled: !!issueId,
    staleTime: 120_000,
  });

  // @mention typeahead state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mentionAnchor = useRef<number>(-1);

  const filteredMentions = mentionQuery != null
    ? mentionableUsers.filter(u =>
        u.name.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        (u.email?.split('@')[0] ?? '').toLowerCase().includes(mentionQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  const insertMention = (u: { name: string; email?: string }) => {
    const ta = composerRef.current;
    if (!ta) return;
    const before = comment.slice(0, mentionAnchor.current);
    const after = comment.slice(ta.selectionStart);
    const handle = u.email?.split('@')[0] ?? u.name.toLowerCase().replace(/\s+/g, '.');
    const next = `${before}@${handle} ${after}`;
    setComment(next);
    setMentionQuery(null);
    setMentionIdx(0);
    requestAnimationFrame(() => {
      const cursor = before.length + handle.length + 2;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  };

  const handleComposerInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setComment(val);
    const pos = e.target.selectionStart;
    const textBefore = val.slice(0, pos);
    const atMatch = textBefore.match(/(^|[\s])@([a-z0-9_.\- ]*)$/i);
    if (atMatch) {
      mentionAnchor.current = textBefore.lastIndexOf('@');
      setMentionQuery(atMatch[2]);
      setMentionIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  // Record view on mount
  useEffect(() => {
    if (issue?.id) {
      issuesApi.recordView(issue.id).catch(() => {});
    }
  }, [issue?.id]);

  // Open screenshot from query param
  useEffect(() => {
    const screenshotParam = params.get('screenshot');
    const urls = Array.isArray(issue?.screenshotUrls) ? issue.screenshotUrls.filter(Boolean) : [];
    if (screenshotParam != null && urls.length > 0) {
      const idx = Number.parseInt(screenshotParam, 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < urls.length) {
        setLightboxIdx(idx);
      }
    }
  }, [params, issue?.screenshotUrls]);

  // Scroll to comment from query param
  useEffect(() => {
    const commentParam = params.get('comment');
    if (commentParam && comments.length > 0) {
      const el = commentRefs.current[commentParam];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightComment(commentParam);
        const timer = setTimeout(() => setHighlightComment(null), 2000);
        return () => clearTimeout(timer);
      }
    }
  }, [params, comments]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['issue', issueId] });
    qc.invalidateQueries({ queryKey: ['issue-comments', issueId] });
    qc.invalidateQueries({ queryKey: ['issue-viewers', issueId] });
    qc.invalidateQueries({ queryKey: ['issues'] });
    qc.invalidateQueries({ queryKey: ['issue-stats'] });
  }, [qc, issueId]);

  const changeStatusMut = useMutation({
    mutationFn: (data: { status: string; note?: string }) =>
      issuesApi.changeStatus(issueId!, data),
    onSuccess: () => {
      invalidate();
      setStatusDropdownOpen(false);
      setPendingStatus(null);
      setStatusNote('');
    },
  });

  const addCommentMut = useMutation({
    mutationFn: (content: string) => issuesApi.addComment(issueId!, content),
    onSuccess: () => {
      invalidate();
      setComment('');
    },
  });

  const deleteCommentMut = useMutation({
    mutationFn: (commentId: string) => issuesApi.deleteComment(commentId),
    onSuccess: () => invalidate(),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleCopyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/issues/${issue?.id}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCommentSubmit = () => {
    if (!comment.trim()) return;
    addCommentMut.mutate(comment.trim());
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent) => {
    if (mentionQuery != null && filteredMentions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, filteredMentions.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(filteredMentions[mentionIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCommentSubmit();
    }
  };

  // ─── Loading / Error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading issue…</p>
        </div>
      </div>
    );
  }

  if (error) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 403) {
      return (
        <div className="max-w-md mx-auto mt-24 text-center">
          <Card>
            <CardContent className="py-12 space-y-4">
              <div className="text-4xl">🔒</div>
              <h2 className="text-lg font-semibold text-slate-100">Access Denied</h2>
              <p className="text-sm text-slate-400">You don't have access to this project's issues.</p>
              <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    if (status === 410) {
      return (
        <div className="max-w-md mx-auto mt-24 text-center">
          <Card>
            <CardContent className="py-12 space-y-4">
              <div className="text-4xl">🗑️</div>
              <h2 className="text-lg font-semibold text-slate-100">Issue Deleted</h2>
              <p className="text-sm text-slate-400">This issue was deleted and is no longer available.</p>
              <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="max-w-md mx-auto mt-24 text-center">
        <Card>
          <CardContent className="py-12 space-y-4">
            <div className="text-4xl">⚠️</div>
            <h2 className="text-lg font-semibold text-slate-100">Something went wrong</h2>
            <p className="text-sm text-slate-400">Unable to load this issue. Please try again.</p>
            <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="max-w-md mx-auto mt-24 text-center">
        <Card>
          <CardContent className="py-12 space-y-4">
            <div className="text-4xl">🔍</div>
            <h2 className="text-lg font-semibold text-slate-100">Issue Not Found</h2>
            <p className="text-sm text-slate-400">The issue you're looking for doesn't exist or has been moved.</p>
            <Button variant="secondary" onClick={() => navigate(-1)}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Derived ──────────────────────────────────────────────────────────────

  const allowedTransitions = STATUS_TRANSITIONS[issue.status] ?? [];
  const typeCfg = TYPE_CONFIG[issue.type];
  const sevCfg = SEVERITY_CONFIG[issue.severity];
  const statCfg = STATUS_CONFIG[issue.status];
  const allComments = comments.length > 0 ? comments : issue.comments ?? [];
  const historyEntries = [...(issue.statusHistory ?? [])].reverse();
  const visibleHistory = historyExpanded ? historyEntries : historyEntries.slice(0, 3);

  const screenshotUrls = Array.isArray(issue.screenshotUrls)
    ? issue.screenshotUrls.filter((u): u is string => typeof u === 'string' && u.length > 0)
    : [];
  const recordingUrlNorm = issue.recordingUrl?.trim() ? issue.recordingUrl.trim() : undefined;
  const hasEvidence = screenshotUrls.length > 0 || !!recordingUrlNorm;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 space-y-6">
      {/* Back button */}
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      {/* ─── Issue Header ──────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
          {issue.project && (
            <>
              <Link to={`/projects/${issue.projectId}`} className="hover:text-slate-300 transition-colors">
                {issue.project.name}
              </Link>
              <span>/</span>
            </>
          )}
          {issue.module && (
            <>
              <Link
                to={`/projects/${issue.projectId}/modules/${issue.moduleId}/features`}
                className="hover:text-slate-300 transition-colors"
              >
                {issue.module.name}
              </Link>
              <span>/</span>
            </>
          )}
          {issue.feature && (
            <>
              <Link
                to={`/projects/${issue.projectId}/modules/${issue.moduleId}/features/${issue.featureId}`}
                className="hover:text-slate-300 transition-colors"
              >
                {issue.feature.name}
              </Link>
              <span>/</span>
            </>
          )}
          {issue.testDefinition && (
            <Link
              to={`/projects/${issue.projectId}/tests/${issue.testDefinitionId}/edit`}
              className="hover:text-slate-300 transition-colors"
            >
              {issue.testDefinition.name}
            </Link>
          )}
        </div>

        {/* Title + badges row */}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {/* Type badge */}
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${typeCfg.bg} ${typeCfg.color}`}>
                {typeCfg.icon} {typeCfg.label}
              </span>
              {/* Severity badge */}
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${sevCfg.bg} ${sevCfg.color}`}>
                {sevCfg.label}
              </span>
              {/* Status chip — interactive */}
              <div className="relative">
                <button
                  onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${statCfg.bg} ${statCfg.color} hover:opacity-80 transition-opacity`}
                >
                  {statCfg.label}
                  <ChevronDown className="w-3 h-3" />
                </button>
                {statusDropdownOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 z-50 rounded-lg p-3 space-y-2 min-w-[220px]"
                    style={{ background: 'rgba(20,20,30,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                  >
                    <p className="text-xs font-medium text-slate-300 mb-2">Change status to:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {allowedTransitions.map((s) => (
                        <button
                          key={s}
                          onClick={() => setPendingStatus(s)}
                          className={`px-2 py-1 rounded border text-xs transition-colors ${
                            pendingStatus === s
                              ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`
                              : 'border-white/10 text-slate-400 hover:border-white/20'
                          }`}
                          style={pendingStatus !== s ? { background: 'rgba(255,255,255,0.04)' } : undefined}
                        >
                          {STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>
                    {pendingStatus ? (
                      <>
                        <input
                          value={statusNote}
                          onChange={(e) => setStatusNote(e.target.value)}
                          placeholder="Optional note…"
                          className={`${inputCls} h-8 text-xs mt-2`}
                          style={inputStyle}
                        />
                        <div className="flex gap-2 justify-end mt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setStatusDropdownOpen(false); setPendingStatus(null); setStatusNote(''); }}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => changeStatusMut.mutate({ status: pendingStatus, note: statusNote || undefined })}
                            loading={changeStatusMut.isPending}
                          >
                            Update
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-end mt-1">
                        <Button variant="ghost" size="sm" onClick={() => setStatusDropdownOpen(false)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <h1 className="text-xl font-semibold text-slate-100 leading-tight">{issue.title}</h1>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Copy link */}
            <button
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {/* Viewers pill */}
            <div className="relative">
              <button
                onClick={() => setViewersOpen(!viewersOpen)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-white/20 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <Eye className="w-3.5 h-3.5" />
                Seen by {viewers.length}
              </button>
              {viewersOpen && viewers.length > 0 && (
                <div
                  className="absolute top-full right-0 mt-1 z-50 rounded-lg p-3 min-w-[200px] max-h-[200px] overflow-y-auto"
                  style={{ background: 'rgba(20,20,30,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}
                >
                  <p className="text-xs font-medium text-slate-300 mb-2">Viewers</p>
                  <div className="space-y-2">
                    {viewers.map((v) => (
                      <div key={v.id} className="flex items-center gap-2 text-xs">
                        <Avatar name={v.name} />
                        <div>
                          <span className="text-slate-200">{v.name}</span>
                          <span className="text-slate-500 ml-1.5">
                            {formatDistanceToNow(new Date(v.lastViewedAt), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Provenance Row ────────────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 rounded-lg"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {/* Reporter */}
        <div className="flex items-center gap-2 text-xs">
          <Avatar name={issue.reportedBy.name} />
          <div>
            <span className="text-slate-400">Reported by</span>{' '}
            <span className="text-slate-200 font-medium">{issue.reportedBy.name}</span>
            <span className="text-slate-500 ml-1.5">
              {formatDistanceToNow(new Date(issue.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>

        {/* Assignee */}
        <div className="flex items-center gap-2 text-xs">
          {issue.assignedTo ? (
            <>
              <Avatar name={issue.assignedTo.name} />
              <div>
                <span className="text-slate-400">Assigned to</span>{' '}
                <span className="text-slate-200 font-medium">{issue.assignedTo.name}</span>
              </div>
            </>
          ) : (
            <span className="text-slate-500 italic">Unassigned</span>
          )}
        </div>

        {/* Links */}
        {issue.testDefinitionId && (
          <Link
            to={`/projects/${issue.projectId}/tests/${issue.testDefinitionId}/edit`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <ExternalLink className="w-3 h-3" />
            Open test
          </Link>
        )}
        {issue.testRunId && (
          <Link
            to={`/runs/${issue.testRunId}`}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-purple-500/50 hover:text-purple-300 transition-colors"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          >
            <Play className="w-3 h-3" />
            View run
          </Link>
        )}

        {/* External ticket links + status pull-back */}
        <div className="w-full mt-2">
          <TicketLinksPanel scope="issue" scopeId={issue.id} />
        </div>

        {/* Create external ticket via the plugin registry */}
        <CreateTicketDropdown
          projectId={(issue.project?.id ?? issue.projectId) as string}
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
      </div>

      {/* ─── Description Block ─────────────────────────────────────────────── */}
      {issue.description && (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium text-slate-400 mb-2">Description</p>
            <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">
              {linkifyText(issue.description)}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Steps / Expected / Actual — responsive 3-column grid */}
      {(issue.stepsToReproduce || issue.expectedBehaviour || issue.actualBehaviour) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {issue.stepsToReproduce && (
            <div
              className="rounded-lg p-4 border"
              style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <p className="text-xs font-medium text-slate-400 mb-2">Steps to Reproduce</p>
              <pre className="text-xs text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                {issue.stepsToReproduce}
              </pre>
            </div>
          )}
          {issue.expectedBehaviour && (
            <div
              className="rounded-lg p-4 border"
              style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <p className="text-xs font-medium text-slate-400 mb-2">Expected Behaviour</p>
              <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                {issue.expectedBehaviour}
              </p>
            </div>
          )}
          {issue.actualBehaviour && (
            <div
              className="rounded-lg p-4 border border-red-900/30"
              style={{ background: 'rgba(220,38,38,0.06)' }}
            >
              <p className="text-xs font-medium text-red-400 mb-2">Actual Behaviour</p>
              <p className="text-xs text-red-300 whitespace-pre-wrap leading-relaxed">
                {issue.actualBehaviour}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── Evidence Block ────────────────────────────────────────────────── */}
      {hasEvidence && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-medium text-slate-400">Evidence</p>
              <p className="text-[10px] text-slate-500">
                Previews load from stored URLs. If nothing appears, use the links to open the original file.
              </p>
            </div>

            {/* Screenshot carousel */}
            {screenshotUrls.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {screenshotUrls.map((url, idx) => (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => setLightboxIdx(idx)}
                      className="shrink-0 w-24 h-16 rounded-lg overflow-hidden border border-white/10 hover:border-purple-500/50 transition-colors"
                      style={{ background: 'rgba(255,255,255,0.04)' }}
                    >
                      <img
                        src={url}
                        alt={`Screenshot ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {screenshotUrls.map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                    >
                      <ExternalLink className="w-3 h-3 shrink-0" />
                      Open screenshot {idx + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Video player */}
            {recordingUrlNorm && (
              <div className="space-y-2">
                <p className="text-xs text-slate-500">Recording</p>
                <video
                  src={recordingUrlNorm}
                  controls
                  playsInline
                  preload="metadata"
                  crossOrigin="anonymous"
                  className="w-full max-h-[400px] rounded-lg border border-white/10"
                  style={{ background: 'rgba(0,0,0,0.5)' }}
                />
                <a
                  href={recordingUrlNorm}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  Open recording in new tab
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Lightbox Overlay ──────────────────────────────────────────────── */}
      {lightboxIdx !== null && screenshotUrls.length > 0 && (
        <div
          role="dialog"
          aria-label="Screenshot viewer"
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setLightboxIdx(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setLightboxIdx(null);
            if (e.key === 'ArrowLeft') setLightboxIdx((lightboxIdx - 1 + screenshotUrls.length) % screenshotUrls.length);
            if (e.key === 'ArrowRight') setLightboxIdx((lightboxIdx + 1) % screenshotUrls.length);
          }}
          tabIndex={0}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(null); }}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
          {screenshotUrls.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIdx((lightboxIdx - 1 + screenshotUrls.length) % screenshotUrls.length);
                }}
                className="absolute left-4 text-white/60 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIdx((lightboxIdx + 1) % screenshotUrls.length);
                }}
                className="absolute right-4 text-white/60 hover:text-white transition-colors"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </>
          )}
          <ScreenshotImage url={screenshotUrls[lightboxIdx]} idx={lightboxIdx} />
          {screenshotUrls.length > 1 && (
            <div className="absolute bottom-6 flex gap-1.5">
              {screenshotUrls.map((_, idx) => (
                <button
                  type="button"
                  key={idx}
                  onClick={(e) => { e.stopPropagation(); setLightboxIdx(idx); }}
                  className={`w-2 h-2 rounded-full transition-colors ${idx === lightboxIdx ? 'bg-purple-400' : 'bg-white/30 hover:bg-white/50'}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Status History ────────────────────────────────────────────────── */}
      {historyEntries.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-medium text-slate-400 mb-3">Status History</p>
            <div className="space-y-2.5">
              {visibleHistory.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2.5 text-xs">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-slate-300 font-medium">{entry.changedBy.name}</span>
                    {entry.fromStatus ? (
                      <span className="text-slate-500">
                        {' '}changed from{' '}
                        <span className={STATUS_CONFIG[entry.fromStatus].color}>
                          {STATUS_CONFIG[entry.fromStatus].label}
                        </span>
                        {' '}to{' '}
                        <span className={STATUS_CONFIG[entry.toStatus].color}>
                          {STATUS_CONFIG[entry.toStatus].label}
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-500"> created issue</span>
                    )}
                    {entry.note && <span className="text-slate-400"> — {entry.note}</span>}
                    <span className="text-slate-600 ml-1.5">
                      · {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            {historyEntries.length > 3 && (
              <button
                onClick={() => setHistoryExpanded(!historyExpanded)}
                className="mt-3 text-xs text-purple-400 hover:text-purple-300 transition-colors"
              >
                {historyExpanded ? 'Show less' : `Show all (${historyEntries.length})`}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Comments Section ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-4">
          <p className="text-xs font-medium text-slate-400 mb-3">
            Comments {allComments.length > 0 && `(${allComments.length})`}
          </p>

          {/* Comments list */}
          {allComments.length > 0 && (
            <div className="space-y-3 mb-4">
              {allComments.map((c) => (
                <div
                  key={c.id}
                  ref={(el) => { commentRefs.current[c.id] = el; }}
                  className={`flex gap-2.5 transition-colors duration-500 rounded-lg ${
                    highlightComment === c.id ? 'ring-2 ring-purple-500/50' : ''
                  }`}
                >
                  <Avatar name={c.user.name} />
                  <div
                    className="flex-1 rounded-lg p-3"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-slate-200">{c.user.name}</span>
                      <span className="text-xs text-slate-500">
                        {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                      </span>
                      {/* Delete button — own comments or owner/tech_lead */}
                      {!c.deletedAt && c.user.id === user?.id && (
                        <button
                          onClick={() => deleteCommentMut.mutate(c.id)}
                          className="ml-auto text-slate-600 hover:text-red-400 transition-colors"
                          title="Delete comment"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {c.deletedAt ? (
                      <p className="text-xs text-slate-600 italic">[deleted]</p>
                    ) : (
                      <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {renderMentions(c.content)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Comment composer */}
          <div className="relative">
            <div className="flex gap-2">
              <textarea
                ref={composerRef}
                value={comment}
                onChange={handleComposerInput}
                onKeyDown={handleCommentKeyDown}
                onBlur={() => setTimeout(() => setMentionQuery(null), 150)}
                placeholder="Add a comment… use @ to mention (Ctrl+Enter to post)"
                rows={2}
                className={`flex-1 ${inputCls} resize-none text-xs`}
                style={inputStyle}
              />
              <Button
                onClick={handleCommentSubmit}
                loading={addCommentMut.isPending}
                disabled={!comment.trim()}
                size="sm"
              >
                Post
              </Button>
            </div>
            {mentionQuery != null && filteredMentions.length > 0 && (
              <div
                className="absolute bottom-full left-0 mb-1 w-72 max-h-52 overflow-y-auto rounded-lg shadow-xl z-50"
                style={{ background: '#1e1e30', border: '1px solid rgba(255,255,255,0.12)' }}
              >
                {filteredMentions.map((u, i) => (
                  <button
                    key={u.id}
                    type="button"
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                      i === mentionIdx ? 'bg-purple-500/20' : 'hover:bg-white/5',
                    )}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ background: 'rgba(124,58,237,0.5)' }}
                    >
                      {u.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span style={{ color: 'rgba(238,238,248,0.90)' }}>{u.name}</span>
                      {u.email && (
                        <span className="ml-1.5 text-slate-500">{u.email.split('@')[0]}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
