import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Play, Pause, Square, RotateCcw, ChevronDown, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Circle, Loader, Monitor, Wifi,
  Zap, SkipForward, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2,
  Info, Bug, ExternalLink, FileText, Camera, Video, CheckSquare2, Mic, MicOff,
  StickyNote, Globe, Copy, Check, MoreHorizontal,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { featuresApi, featureRunsApi, environmentsApi, runsApi, testsApi, uploadsApi, issuesApi, docsApi, type LinkedDoc } from '@/lib/api';
import { DocViewerModal } from '@/components/plugins/DocViewerModal';
import { NotesPanel } from '@/components/notes/NotesPanel';
import { useFeatureRunSocket } from '@/hooks/useFeatureRunSocket';
import { useIsMobile } from '@/hooks/useIsMobile';
import { toast } from '@/components/ui/Toast';
import { useScreenRecording, formatRecordingDuration } from '@/hooks/useScreenRecording';
import { ActiveStepCard } from '@/components/testing/ActiveStepCard';
import { FeatureCompletionModal } from '@/components/testing/FeatureCompletionModal';
import { ScreenshotAnnotator } from '@/components/testing/ScreenshotAnnotator';
import { FailureReasonModal } from '@/components/testing/FailureReasonModal';
import { LogIssueModal, IssueDetailModal } from '@/components/IssueTracker';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/utils';
import { getManualRecMicEnabled, setManualRecMicEnabled, MANUAL_REC_MIC_EVENT } from '@/lib/manualRecMic';

// ─── Types ────────────────────────────────────────────────────────────────────

type RunMode = 'MANUAL' | 'AUTOMATED';

type Environment = { id: string; name: string; baseUrl: string };

type TestCase = {
  id: string;
  name: string;
  description?: string | null;
  type: string;
  steps: unknown[];
  featureId?: string | null;
  updatedAt: string;
};

type RunStep = {
  id: string;
  index: number;
  name: string;
  type: string;
  status: string;
  input: Record<string, unknown> | null;
  notes: string | null;
  completedAt: string | null;
  duration?: number | null;
  error?: string | null;
};

type FeatureRun = {
  id: string;
  status: string;
  runMode: string;
  testRuns: { id: string; status: string; testDefinition: { name: string; id: string } }[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'testing-view-left-width';
const DEFAULT_LEFT = 320;
const MIN_LEFT = 220;
const MAX_LEFT = 640;
/**
 * Below this width the verdict bar (Pass/Fail/Skip/Bug) drops its text labels
 * and shows icons-only — keeps the 4 buttons usable when the user has
 * dragged the sidebar narrow to give the iframe more room.
 */
const COMPACT_VERDICT_BAR_PX = 300;

/**
 * Statuses that mean a test is "done" for the purposes of resuming work.
 * Used by TestingView's auto-select to skip past tests already covered
 * by an earlier session and land on the first un-touched one.
 */
const TERMINAL_TEST_STATUSES = new Set(['PASSED', 'FAILED', 'SKIPPED', 'CANCELLED']);
// Per-project so the env id from project A doesn't get auto-applied to a
// session in project B (the backend rejects cross-project env IDs).
const lastEnvKeyFor = (projectId: string | undefined) =>
  projectId ? `testing-view-last-env.${projectId}` : 'testing-view-last-env';

function stepIcon(status: string, opts?: { mode?: 'MANUAL' | 'AUTOMATED' }) {
  switch (status) {
    case 'PASSED': return <CheckCircle size={13} className="text-emerald-400 shrink-0" />;
    case 'FAILED': return <XCircle size={13} className="text-red-400 shrink-0" />;
    case 'RUNNING':
      // Spinner is meaningful in AUTOMATED (Playwright is live-driving the
      // step). In MANUAL nothing is being processed in the background — the
      // tester is the actor, so a spinner is misleading. Caller passes mode.
      return opts?.mode === 'AUTOMATED'
        ? <Loader size={13} className="text-sky-400 animate-spin shrink-0" />
        : <Circle size={13} className="text-violet-400 shrink-0" />;
    case 'SKIPPED': return <span className="text-gray-400 text-xs shrink-0">⊘</span>;
    default: return <Circle size={13} className="text-gray-500 shrink-0" />;
  }
}

/**
 * Status icon for a test row in the left panel.
 *
 * The `mode` and `isCurrent` args matter for MANUAL runs: the backend
 * pre-marks every TestRun as RUNNING the moment the user opens the
 * session (so the rows are "live" for step-marking). Without context,
 * that makes every row spin like Playwright is hammering it. In MANUAL
 * mode we only spin the test the user is actually focused on; everything
 * else still in RUNNING shows as PENDING (the test is open but not
 * actively being worked on).
 *
 * AUTOMATED mode keeps the original behaviour — Playwright really is
 * driving exactly one running test at a time.
 */
function tcIcon(status: string, opts?: { mode?: 'MANUAL' | 'AUTOMATED'; isCurrent?: boolean }) {
  if (status === 'PASSED') return <CheckCircle size={14} className="text-emerald-400 shrink-0" />;
  if (status === 'FAILED') return <XCircle size={14} className="text-red-400 shrink-0" />;
  if (status === 'CANCELLED') return <SkipForward size={14} className="text-amber-300 shrink-0" />;
  if (status === 'RUNNING') {
    // AUTOMATED: Playwright is actively driving this test → spinner is real.
    // MANUAL: nothing is processing. Even the currently-focused test shouldn't
    // spin — we show a filled violet dot to mark "you are here" instead.
    if (opts?.mode === 'AUTOMATED') {
      return <Loader size={14} className="text-sky-400 animate-spin shrink-0" />;
    }
    if (opts?.isCurrent) {
      return (
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ background: 'var(--accent-400)', boxShadow: '0 0 6px rgba(var(--accent-rgb),0.6)' }}
        />
      );
    }
    return <Circle size={14} className="text-gray-500 shrink-0" />;
  }
  return <Circle size={14} className="text-gray-500 shrink-0" />;
}

// ─── Expandable step text (shared by both modes) ─────────────────────────────

function ExpandableStepText({ text, className }: { text: string; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > 90;
  return (
    <>
      <span
        className={cn(
          'block leading-snug',
          !expanded && isLong && 'line-clamp-2',
          className,
        )}
      >
        {text}
      </span>
      {isLong && (
        <button
          type="button"
          className="text-[10px] text-sky-400 hover:text-sky-300 mt-0.5"
          onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

function manualStepText(step: RunStep, index: number) {
  const description = typeof step.input?.description === 'string' ? step.input.description.trim() : '';
  return description || step.name || `Step ${index + 1}`;
}

type TestIssueStats = { total: number; open: number };

/** Picker when a test has multiple linked issues; single issue opens detail directly. */
function TestLinkedIssuesPeekModal({
  open,
  projectId,
  testDefinitionId,
  testName,
  onClose,
  onOpenIssue,
}: {
  open: boolean;
  projectId: string;
  testDefinitionId: string;
  testName: string;
  onClose: () => void;
  onOpenIssue: (issueId: string) => void;
}) {
  type Row = { id: string; title: string; status: string; severity: string; type: string };
  const { data, isLoading } = useQuery<{ items: Row[] }>({
    queryKey: ['issues-for-test-definition', projectId, testDefinitionId],
    queryFn: () =>
      issuesApi.list(projectId, { testDefinitionId, limit: 50 }) as Promise<{ items: Row[] }>,
    enabled: open && !!projectId && !!testDefinitionId,
  });

  const autoHandled = useRef(false);
  useEffect(() => {
    if (!open) {
      autoHandled.current = false;
      return;
    }
    if (autoHandled.current || !data?.items?.length) return;
    if (data.items.length === 1) {
      autoHandled.current = true;
      onOpenIssue(data.items[0].id);
      onClose();
    }
  }, [open, data?.items, onOpenIssue, onClose]);

  return (
    <Modal open={open} onClose={onClose} title={`Linked issues · ${testName}`} size="md">
      {isLoading && (
        <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>
      )}
      {!isLoading && data?.items?.length === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">
          No issues match this test anymore. Stats will refresh on the next sync.
        </p>
      )}
      {!isLoading && (data?.items?.length ?? 0) > 1 && (
        <ul className="max-h-[50vh] overflow-y-auto space-y-1 pr-1">
          {data!.items.map(row => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => { onOpenIssue(row.id); onClose(); }}
                className="w-full text-left rounded-lg px-3 py-2.5 transition-colors border border-white/8 hover:border-purple-500/40 hover:bg-white/5"
                style={{ background: 'rgba(255,255,255,0.03)' }}
              >
                <p className="text-sm font-medium text-slate-100 line-clamp-2">{row.title}</p>
                <div className="flex flex-wrap gap-2 mt-1.5 text-[10px] uppercase font-semibold tracking-wide text-slate-500">
                  <span className="text-slate-400">{row.type}</span>
                  <span>·</span>
                  <span>{row.status.replace(/_/g, ' ')}</span>
                  <span>·</span>
                  <span>{row.severity}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

// ─── Left Panel ───────────────────────────────────────────────────────────────

function LeftPanel({
  featureId,
  projectId,
  selectedTestId,
  onSelectTest,
  activeRun,
  mode,
  iframeRef,
  onMarkTestRun,
  onLogBug,
  markingTestRun,
  highlightStepId,
  issueStatsByTestId,
  onOpenLinkedIssues,
  compactActions,
}: {
  featureId: string;
  projectId: string;
  selectedTestId: string | null;
  onSelectTest: (id: string) => void;
  mode: RunMode;
  activeRun: FeatureRun | null;
  iframeRef?: React.RefObject<HTMLIFrameElement>;
  onMarkTestRun?: (testRunId: string, status: 'PASSED' | 'FAILED' | 'SKIPPED') => void;
  onLogBug?: (testRunId: string) => void;
  markingTestRun?: boolean;
  highlightStepId?: string | null;
  issueStatsByTestId: Map<string, TestIssueStats>;
  onOpenLinkedIssues: (testId: string, testName: string) => void;
  /** True when the sidebar is narrow enough that the verdict bar must drop labels. */
  compactActions?: boolean;
}) {
  const { data: rawTests = [] } = useQuery<TestCase[]>({
    queryKey: ['tests', projectId, featureId],
    queryFn: () => testsApi.list(projectId, featureId),
    enabled: !!projectId && !!featureId,
  });

  // Display in execution order, not the API's "most recently edited first".
  // If a run is active we mirror its testRun order (the worker executes them
  // in this exact sequence). Otherwise rely on API order — which is
  // createdAt asc, matching what FeaturePage shows. Previously this fell
  // back to alphabetical, which silently desynced the sidebar from the
  // page's order and made "click test C, the wrong test opens" look like
  // a navigation bug.
  // Memoised — recomputing this on every keystroke / hover noticeably lags
  // the panel because each parent re-render allocated a new sorted array,
  // breaking child referential equality and forcing every row to re-render.
  const tests = useMemo(() => {
    if (activeRun?.testRuns?.length) {
      const orderMap = new Map<string, number>();
      activeRun.testRuns.forEach((tr, i) => orderMap.set(tr.testDefinition.id, i));
      return [...rawTests].sort((a, b) => {
        const ai = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const bi = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }
    return rawTests; // API order — createdAt asc, same as FeaturePage
  }, [rawTests, activeRun?.testRuns]);

  // Get the active testRun for the selected test
  const activeTestRun = activeRun?.testRuns.find(
    tr => tr.testDefinition.id === selectedTestId,
  );

  const { data: steps = [] } = useQuery<RunStep[]>({
    queryKey: ['run-steps', activeTestRun?.id],
    queryFn: () => runsApi.getSteps(activeTestRun!.id),
    enabled: !!activeTestRun?.id,
    // AUTOMATED: socket pushes step updates; poll is a safety fallback while
    // the run is RUNNING. MANUAL: tester is the actor, so step transitions
    // happen via mutations that invalidate this query directly — polling
    // would just create background noise.
    refetchInterval: mode === 'AUTOMATED' && activeRun?.status === 'RUNNING' ? 8000 : false,
  });

  // Memoised — same reasoning as `tests`. The map only changes when test-run
  // statuses change, not on hover / drag / iframe-state churn.
  const runStatusMap = useMemo(() => {
    const m = new Map<string, string>();
    activeRun?.testRuns.forEach(tr => m.set(tr.testDefinition.id, tr.status));
    return m;
  }, [activeRun?.testRuns]);

  // MANUAL mode: per-step checklist persisted to localStorage so the tester
  // sees what they'd already ticked off after navigating away and back.
  // Keyed on testRunId — different runs of the same test get a fresh slate.
  // Auto-cleared once the run reaches a terminal status (below).
  const STEP_CHECKLIST_KEY = activeTestRun?.id
    ? `qa.testing.checkedSteps.v1.${activeTestRun.id}`
    : null;
  const [checkedSteps, setCheckedSteps] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (!STEP_CHECKLIST_KEY) { setCheckedSteps(new Set()); return; }
    try {
      const raw = localStorage.getItem(STEP_CHECKLIST_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          setCheckedSteps(new Set(parsed.filter((n): n is number => typeof n === 'number')));
          return;
        }
      }
    } catch { /* parse error — fall through to empty set */ }
    setCheckedSteps(new Set());
  }, [STEP_CHECKLIST_KEY]);
  // Persist on change. Empty set → drop the key to avoid leaving stale
  // entries for runs the tester abandoned mid-flow.
  useEffect(() => {
    if (!STEP_CHECKLIST_KEY) return;
    try {
      if (checkedSteps.size === 0) localStorage.removeItem(STEP_CHECKLIST_KEY);
      else localStorage.setItem(STEP_CHECKLIST_KEY, JSON.stringify([...checkedSteps]));
    } catch { /* quota / privacy mode — ignore */ }
  }, [checkedSteps, STEP_CHECKLIST_KEY]);
  // Purge once the run reaches a terminal status — Pass/Fail/Skip means the
  // checklist is no longer needed, and we don't want to balloon localStorage.
  useEffect(() => {
    const status = activeTestRun?.status;
    if (!STEP_CHECKLIST_KEY || !status) return;
    if (status === 'PASSED' || status === 'FAILED' || status === 'SKIPPED') {
      try { localStorage.removeItem(STEP_CHECKLIST_KEY); } catch { /* ignore */ }
    }
  }, [activeTestRun?.status, STEP_CHECKLIST_KEY]);
  const toggleChecked = useCallback((idx: number) => {
    setCheckedSteps(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  // Expandable step text — tracks which step indices have their description expanded
  const [expandedStepTexts, setExpandedStepTexts] = useState<Set<number>>(new Set());
  useEffect(() => { setExpandedStepTexts(new Set()); }, [selectedTestId]);
  const toggleStepText = useCallback((idx: number) => {
    setExpandedStepTexts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }, []);

  // Deep-link: highlight a specific step and scroll it into view
  const [flashingStepId, setFlashingStepId] = useState<string | null>(null);
  const stepListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlightStepId || !steps.length) return;
    const matchingStep = steps.find(s => s.id === highlightStepId);
    if (!matchingStep) return;

    // Auto-expand the owning test by selecting it (if not already selected)
    const ownerTest = activeRun?.testRuns.find(tr =>
      tr.testDefinition.id === selectedTestId
    );
    if (!ownerTest) return;

    setFlashingStepId(highlightStepId);

    requestAnimationFrame(() => {
      const el = stepListRef.current?.querySelector(`[data-step-id="${highlightStepId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    const timer = setTimeout(() => setFlashingStepId(null), 2000);
    return () => clearTimeout(timer);
  }, [highlightStepId, steps, selectedTestId, activeRun?.testRuns]);

  return (
    <div className="flex flex-col h-full" style={{ background: 'rgba(10,10,20,0.95)' }}>
      {/* Panel header */}
      <div
        className="px-4 py-3 border-b flex items-center justify-between shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.08)' }}
      >
        <span className="text-xs font-semibold text-gray-100">
          Test Cases ({tests.length})
        </span>
        <div className="flex items-center gap-2 text-xs">
          {activeRun && (
            <>
              <span className="text-emerald-400">
                ✅ {activeRun.testRuns.filter(t => t.status === 'PASSED').length}
              </span>
              <span className="text-red-400">
                ❌ {activeRun.testRuns.filter(t => t.status === 'FAILED').length}
              </span>
              <span className="text-amber-300">
                ⏭ {activeRun.testRuns.filter(t => t.status === 'CANCELLED').length}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Test case list */}
      <div ref={stepListRef} className="flex-1 overflow-y-auto">
        {tests.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-gray-500">No test cases</div>
        )}
        {tests.map((tc, idx) => {
          const status = runStatusMap.get(tc.id) ?? 'PENDING';
          const isSelected = tc.id === selectedTestId;
          const isExpanded = isSelected;
          const issueSt = issueStatsByTestId.get(tc.id);

          return (
            <div key={tc.id}>
              {/* Row */}
              <button
                onClick={() => onSelectTest(tc.id)}
                className={cn(
                  // items-start so the status icon + index stay anchored to
                  // the first line when the name wraps to multiple rows in a
                  // narrow sidebar (rather than vertically centring against
                  // a tall block of text).
                  'w-full flex items-start gap-2 px-4 py-2.5 text-left transition-colors text-xs',
                  isSelected
                    ? 'bg-sky-500/10 border-l-2 border-l-sky-500'
                    : 'hover:bg-white/3 border-l-2 border-l-transparent',
                  status === 'FAILED' && !isSelected ? 'bg-red-500/5' : '',
                )}
              >
                {tcIcon(status, {
                  mode: (activeRun?.runMode as 'MANUAL' | 'AUTOMATED' | undefined),
                  isCurrent: tc.id === selectedTestId,
                })}
                <span className="shrink-0 font-medium" style={{ color: 'rgba(238,238,248,0.75)' }}>{idx + 1}</span>
                <span
                  className={cn(
                    // min-w-0 so the flex child can shrink below its content
                    // width; break-words + whitespace-normal lets long names
                    // wrap onto multiple lines instead of being ellipsed when
                    // the user narrows the sidebar.
                    'flex-1 min-w-0 break-words whitespace-normal',
                    isSelected && 'font-semibold',
                    status === 'CANCELLED' && !isSelected && 'line-through',
                  )}
                  style={{
                    color: isSelected
                      ? '#ffffff'
                      : status === 'PASSED'
                        ? 'rgba(238,238,248,0.78)'
                        : status === 'CANCELLED'
                          ? 'rgba(238,238,248,0.55)'
                          : 'rgba(238,238,248,0.95)',
                  }}
                >
                  {tc.name}
                </span>
                {issueSt && issueSt.total > 0 && (
                  <button
                    type="button"
                    title={
                      issueSt.open > 0
                        ? `${issueSt.total} linked issue(s) — ${issueSt.open} open · click to review`
                        : `${issueSt.total} linked issue(s) — click to review`
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenLinkedIssues(tc.id, tc.name);
                    }}
                    className="shrink-0 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition-colors hover:brightness-110"
                    style={{
                      background: issueSt.open > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(var(--accent-rgb),0.14)',
                      border: `1px solid ${issueSt.open > 0 ? 'rgba(239,68,68,0.35)' : 'rgba(var(--accent-rgb),0.35)'}`,
                      color: issueSt.open > 0 ? '#fca5a5' : 'var(--accent-300)',
                    }}
                  >
                    <Bug size={11} strokeWidth={2.5} />
                    <span className="tabular-nums">{issueSt.total}</span>
                  </button>
                )}
              </button>

              {/* Expanded steps */}
              {isExpanded && steps.length > 0 && (() => {
                if (mode === 'MANUAL') {
                  // MANUAL mode: read-only checklist — tester ticks steps as
                  // reviewed, then uses the verdict bar to mark the whole test.
                  const testRunDone = activeTestRun && (
                    activeTestRun.status === 'PASSED' ||
                    activeTestRun.status === 'FAILED' ||
                    activeTestRun.status === 'CANCELLED'
                  );
                  return (
                    <div className="border-l-2 border-l-sky-500/30 ml-[30px] mr-2 mb-2">
                      {steps.map((step, idx) => {
                        const checked = checkedSteps.has(idx);
                        const stepText = manualStepText(step, idx);
                        const textIsLong = stepText.length > 90;
                        const isTextExpanded = expandedStepTexts.has(idx);
                        return (
                          <button
                            key={step.id}
                            type="button"
                            data-step-id={step.id}
                            onClick={() => toggleChecked(idx)}
                            className={cn(
                              'w-full flex items-start gap-2 px-3 py-2 text-xs rounded-lg mx-1 my-0.5 text-left transition-colors',
                              checked ? 'bg-emerald-500/5' : 'hover:bg-white/3',
                              flashingStepId === step.id && 'pulse-flash-ring',
                            )}
                          >
                            {checked
                              ? <CheckSquare2 size={14} className="text-emerald-400 shrink-0 mt-px" />
                              : <Square size={14} className="text-gray-700 shrink-0 mt-px" />
                            }
                            <div className="flex-1 min-w-0">
                              <span
                                className={cn(
                                  'block leading-snug',
                                  // Theme uses inverted gray: low numbers = dark bg, 800/900 = light text.
                                  checked ? 'text-emerald-400/90 line-through' : 'text-gray-900',
                                  !isTextExpanded && textIsLong && 'line-clamp-2',
                                )}
                              >
                                {stepText}
                              </span>
                              {textIsLong && (
                                <span
                                  className="text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer mt-0.5 inline-block"
                                  onClick={(e) => { e.stopPropagation(); toggleStepText(idx); }}
                                >
                                  {isTextExpanded ? 'Show less' : 'Show more'}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono text-gray-700 shrink-0 tabular-nums">#{idx + 1}</span>
                          </button>
                        );
                      })}

                      {/* Verdict bar — visible only when there's an active test run that isn't already terminal.
                          When sidebar is narrow (compactActions), drop text labels — icons only with native
                          tooltips. Each button stays equally clickable; flex-1 keeps the 4-button row aligned. */}
                      {activeTestRun && !testRunDone && (
                        <div
                          className="flex items-center gap-1.5 px-2 py-2 mt-2 mx-1 rounded-lg"
                          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                        >
                          <button
                            onClick={() => onMarkTestRun?.(activeTestRun.id, 'PASSED')}
                            disabled={markingTestRun}
                            title="Mark test as passed"
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-40"
                            style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.35)', color: '#34d399' }}
                          >
                            <CheckCircle size={12} />
                            {!compactActions && <span>Pass</span>}
                          </button>
                          <button
                            onClick={() => onMarkTestRun?.(activeTestRun.id, 'FAILED')}
                            disabled={markingTestRun}
                            title="Mark test as failed"
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-40"
                            style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}
                          >
                            <XCircle size={12} />
                            {!compactActions && <span>Fail</span>}
                          </button>
                          <button
                            onClick={() => onMarkTestRun?.(activeTestRun.id, 'SKIPPED')}
                            disabled={markingTestRun}
                            title="Skip this test"
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-40"
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.55)' }}
                          >
                            <SkipForward size={12} />
                            {!compactActions && <span>Skip</span>}
                          </button>
                          <button
                            onClick={() => onLogBug?.(activeTestRun.id)}
                            disabled={markingTestRun}
                            title="Log a bug for this test"
                            className="flex items-center justify-center gap-1 py-1.5 rounded-md text-[11px] font-medium transition-all disabled:opacity-40"
                            style={{
                              background: 'rgba(var(--accent-rgb),0.12)',
                              border: '1px solid rgba(var(--accent-rgb),0.35)',
                              color: 'var(--accent-300)',
                              minWidth: 36,
                              paddingLeft: compactActions ? 8 : 10,
                              paddingRight: compactActions ? 8 : 10,
                            }}
                          >
                            <Bug size={12} />
                            {!compactActions && <span>Bug</span>}
                          </button>
                        </div>
                      )}

                      {/* Already-judged badge */}
                      {activeTestRun && testRunDone && (
                        <div className="flex items-center gap-2 px-3 py-2 mt-1 mx-1 text-[11px]">
                          <span
                            className="font-semibold px-2 py-0.5 rounded"
                            style={{
                              background:
                                activeTestRun.status === 'PASSED' ? 'rgba(16,185,129,0.18)'
                                : activeTestRun.status === 'FAILED' ? 'rgba(239,68,68,0.18)'
                                : 'rgba(245,158,11,0.18)',
                              color:
                                activeTestRun.status === 'PASSED' ? '#34d399'
                                : activeTestRun.status === 'FAILED' ? '#f87171'
                                : '#fbbf24',
                            }}
                          >
                            {activeTestRun.status === 'CANCELLED' ? 'SKIPPED' : activeTestRun.status}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }

                // AUTOMATED mode: keep original behaviour — compact status rows
                // with ActiveStepCard for the active step.
                const activeIdx = steps.findIndex(s =>
                  s.status === 'PENDING' || s.status === 'PAUSED' || s.status === 'RUNNING'
                );
                return (
                  <div className="border-l-2 border-l-sky-500/30 ml-[30px] mr-2 mb-2">
                    {steps.map((step, idx) => {
                      const isActive = idx === activeIdx;
                      if (isActive && activeTestRun?.id) {
                        return (
                          <ActiveStepCard
                            key={step.id}
                            step={step as unknown as Parameters<typeof ActiveStepCard>[0]['step']}
                            index={idx}
                            testRunId={activeTestRun.id}
                            featureRunId={activeRun?.id ?? null}
                            iframeRef={iframeRef}
                          />
                        );
                      }
                      return (
                        <div
                          key={step.id}
                          data-step-id={step.id}
                          className={cn(
                            'flex items-start gap-2 px-3 py-1.5 text-xs rounded-lg mx-1 my-0.5',
                            step.status === 'FAILED' ? 'bg-red-500/10' : '',
                            flashingStepId === step.id && 'pulse-flash-ring',
                          )}
                        >
                          {stepIcon(step.status, { mode })}
                          <div className="flex-1 min-w-0">
                            <ExpandableStepText
                              text={step.name}
                              className={cn(
                                step.status === 'FAILED' ? 'text-red-300'
                                : step.status === 'PASSED' ? 'text-emerald-400/85'
                                : 'text-gray-800',
                              )}
                            />
                            {step.status === 'FAILED' && step.error && (
                              <ExpandableStepText
                                text={step.error}
                                className="text-red-400 text-[10px] mt-0.5"
                              />
                            )}
                          </div>
                          <span className="text-[10px] font-mono text-gray-700 tabular-nums">#{idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Right Panel — Description-driven Manual work pane ──────────────────────
//
// In MANUAL mode we don't show the granular Playwright step JSON (NAVIGATE,
// WAIT, HOVER, …) — that's automation spec, not a tester's checklist. Instead
// we show the test case's name + description and let the tester evaluate the
// whole test, then mark Pass/Fail/Skip from the floating bar (or sidebar list).
// The iframe sits below as the live app preview the tester interacts with.

function ManualWorkPane({
  baseUrl,
  test,
  activeRun,
  fullscreen,
  onToggleFullscreen,
  iframeRef,
  linkedIssueSummary,
  onReviewLinkedIssues,
}: {
  baseUrl: string;
  test: { id: string; name: string; description?: string | null } | null;
  activeRun: FeatureRun | null;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement>;
  linkedIssueSummary?: TestIssueStats | null;
  onReviewLinkedIssues?: () => void;
}) {
  const testRunStatus = activeRun?.testRuns.find(tr => tr.testDefinition.id === test?.id)?.status;
  const linkSt =
    linkedIssueSummary && linkedIssueSummary.total > 0 ? linkedIssueSummary : null;
  const hasLinkedIssues = !!linkSt;

  // Track the iframe's current URL so the tester can see what page they're
  // on — important for bug reports and visual validation. Three sources, in
  // priority order:
  //   1. QA recorder extension `qa-recorder:nav` postMessage — works for any
  //      iframe (same-origin OR cross-origin) as long as the tester has the
  //      extension installed. Marked readable.
  //   2. contentWindow.location.href read — same-origin only; cross-origin
  //      reads throw SecurityError and we fall back.
  //   3. Env baseUrl as the starting address — shown with a "start" badge so
  //      the tester knows it's not live-tracking iframe navigation.
  const [iframeUrl, setIframeUrl] = useState<string>(baseUrl);
  const [iframeUrlReadable, setIframeUrlReadable] = useState<boolean>(true);
  // `stale` = the iframe definitely navigated (load event fired again) but we
  // can't read the new URL because the SUT is cross-origin and no extension
  // is broadcasting. Cleared when any source successfully updates the URL or
  // when the tester edits the URL bar by hand.
  const [iframeUrlStale, setIframeUrlStale] = useState<boolean>(false);
  useEffect(() => { setIframeUrl(baseUrl); setIframeUrlReadable(true); setIframeUrlStale(false); }, [baseUrl]);
  useEffect(() => {
    const iframe = iframeRef?.current;
    if (!iframe) return;
    let loadCount = 0;
    const tryRead = (fromLoadEvent: boolean) => {
      try {
        const href = iframe.contentWindow?.location.href;
        if (href && href !== 'about:blank') {
          setIframeUrl(href);
          setIframeUrlReadable(true);
          setIframeUrlStale(false);
          return;
        }
        setIframeUrlReadable(false);
        // load fired but we can't read — second+ loads are nav events the
        // tester just made. Flag stale so the URL bar prompts them to update.
        if (fromLoadEvent && loadCount > 1) setIframeUrlStale(true);
      } catch {
        setIframeUrlReadable(false);
        if (fromLoadEvent && loadCount > 1) setIframeUrlStale(true);
      }
    };
    const onLoad = () => { loadCount += 1; tryRead(true); };
    iframe.addEventListener('load', onLoad);
    const initial = setTimeout(() => tryRead(false), 250);
    const poll = setInterval(() => tryRead(false), 1500);
    // Recorder-extension URL broadcasts — only accept messages from our own
    // iframe's contentWindow so a random tab can't spoof the address bar.
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { kind?: string; url?: string } | null;
      if (!data || typeof data !== 'object' || data.kind !== 'qa-recorder:nav') return;
      if (e.source !== iframe.contentWindow) return;
      if (typeof data.url !== 'string' || !data.url) return;
      setIframeUrl(data.url);
      setIframeUrlReadable(true);
      setIframeUrlStale(false);
    };
    window.addEventListener('message', onMessage);
    return () => {
      iframe.removeEventListener('load', onLoad);
      clearTimeout(initial);
      clearInterval(poll);
      window.removeEventListener('message', onMessage);
    };
  }, [iframeRef, baseUrl]);

  // "Open in new tab" should follow the iframe to whatever URL the user has
  // navigated to. Only works when the SUT is same-origin to the QA platform —
  // cross-origin reads of contentWindow.location throw a SecurityError, in
  // which case we fall back to the env baseUrl (the iframe's initial src).
  const openCurrentInNewTab = () => {
    let target = baseUrl;
    try {
      const href = iframeRef?.current?.contentWindow?.location.href;
      if (href && href !== 'about:blank') target = href;
    } catch { /* cross-origin — keep baseUrl */ }
    window.open(target, '_blank', 'noopener,noreferrer');
  };
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionCanExpand, setDescriptionCanExpand] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);

  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionCanExpand(false);
  }, [test?.id]);

  useEffect(() => {
    if (!test?.description || descriptionExpanded) return;

    const measureOverflow = () => {
      const el = descriptionRef.current;
      if (!el) return;
      setDescriptionCanExpand(el.scrollHeight > el.clientHeight + 1);
    };

    const frame = requestAnimationFrame(measureOverflow);
    window.addEventListener('resize', measureOverflow);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measureOverflow);
    };
  }, [test?.description, descriptionExpanded]);

  return (
    <div className="flex flex-col h-full">
      {/* Description header — hidden in fullscreen so the iframe gets max real estate */}
      {!fullscreen && test && (
        <div
          className={cn(
            'px-5 py-4 border-b shrink-0',
            descriptionExpanded && 'max-h-[45vh] overflow-y-auto',
          )}
          style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(14,14,22,0.5)' }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  Manual Test
                </span>
                {testRunStatus && (
                  <span
                    className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{
                      background:
                        testRunStatus === 'PASSED' ? 'rgba(16,185,129,0.18)'
                        : testRunStatus === 'FAILED' ? 'rgba(239,68,68,0.18)'
                        : testRunStatus === 'CANCELLED' ? 'rgba(245,158,11,0.18)'
                        : 'rgba(255,255,255,0.06)',
                      color:
                        testRunStatus === 'PASSED' ? '#34d399'
                        : testRunStatus === 'FAILED' ? '#f87171'
                        : testRunStatus === 'CANCELLED' ? '#fbbf24'
                        : 'rgba(238,238,248,0.55)',
                    }}
                  >
                    {testRunStatus === 'CANCELLED' ? 'SKIPPED' : testRunStatus}
                  </span>
                )}
                {linkSt && onReviewLinkedIssues && (
                  <button
                    type="button"
                    onClick={onReviewLinkedIssues}
                    title={
                      linkSt.open > 0
                        ? `${linkSt.total} linked · ${linkSt.open} open — review or update status`
                        : `${linkSt.total} linked — review`
                    }
                    className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors hover:brightness-110"
                    style={{
                      background: linkSt.open > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb),0.12)',
                      border: `1px solid ${linkSt.open > 0 ? 'rgba(239,68,68,0.38)' : 'rgba(var(--accent-rgb),0.38)'}`,
                      color: linkSt.open > 0 ? '#fca5a5' : 'var(--accent-300)',
                    }}
                  >
                    <Bug size={11} strokeWidth={2.5} />
                    {linkSt.open > 0
                      ? `${linkSt.open} open / ${linkSt.total}`
                      : `${linkSt.total} linked`}
                  </button>
                )}
                {descriptionExpanded && (descriptionCanExpand || !!test.description) && (
                  <button
                    type="button"
                    onClick={() => setDescriptionExpanded(false)}
                    className="ml-auto text-[11px] font-medium underline underline-offset-2"
                    style={{ color: 'rgba(196,181,253,0.95)' }}
                  >
                    Hide
                  </button>
                )}
              </div>
              <h2 className="text-base font-semibold leading-tight" style={{ color: 'rgba(238,238,248,0.95)' }}>
                {test.name}
              </h2>
              {test.description && (
                <>
                  <p
                    ref={descriptionRef}
                    className={cn(
                      'text-xs leading-relaxed mt-2 max-w-3xl whitespace-pre-wrap transition-all',
                      !descriptionExpanded && 'max-h-28 overflow-hidden',
                    )}
                    style={{ color: 'rgba(238,238,248,0.70)' }}
                  >
                    {test.description}
                  </p>
                  {(descriptionCanExpand || descriptionExpanded) && (
                    <button
                      type="button"
                      onClick={() => setDescriptionExpanded(prev => !prev)}
                      className="mt-1 text-[11px] font-medium underline underline-offset-2"
                      style={{ color: 'rgba(196,181,253,0.95)' }}
                    >
                      {descriptionExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </>
              )}
              {!test.description && (
                <p className="text-xs italic mt-2" style={{ color: 'rgba(238,238,248,0.40)' }}>
                  No description — open the test in the editor to add one.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onToggleFullscreen}
                title="Maximise live preview"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.70)' }}
              >
                <Maximize2 size={12} /> Full preview
              </button>
              <button
                type="button"
                onClick={openCurrentInNewTab}
                title="Open the iframe's current URL in a new tab (falls back to base URL if cross-origin)"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.70)' }}
              >
                <ExternalLink size={12} /> Open in tab
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Iframe — fullscreen mode hides everything else */}
      <div className="flex-1 relative overflow-hidden">
        {fullscreen && (
          <button
            onClick={onToggleFullscreen}
            title="Exit full preview"
            className="absolute top-3 right-3 z-10 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            style={{ background: 'rgba(14,14,22,0.92)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(238,238,248,0.85)' }}
          >
            <Minimize2 size={12} /> Exit fullscreen
          </button>
        )}
        {fullscreen && test && linkSt && onReviewLinkedIssues && (
          <button
            type="button"
            onClick={onReviewLinkedIssues}
            title="Review linked issues"
            className="absolute top-3 left-3 z-10 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
            style={{
              background: linkSt.open > 0 ? 'rgba(239,68,68,0.14)' : 'rgba(var(--accent-rgb),0.14)',
              border: `1px solid ${linkSt.open > 0 ? 'rgba(239,68,68,0.42)' : 'rgba(var(--accent-rgb),0.42)'}`,
              color: linkSt.open > 0 ? '#fca5a5' : 'var(--accent-300)',
            }}
          >
            <Bug size={12} strokeWidth={2.5} />
            {linkSt.total} issue{linkSt.total === 1 ? '' : 's'}
            {linkSt.open > 0 ? ` (${linkSt.open} open)` : ''}
          </button>
        )}
        {/* Address bar above + iframe below; flex-col so the URL strip
            takes its intrinsic row height and the iframe fills the rest.
            Hidden URL bar in fullscreen so the iframe gets the full viewport. */}
        <div className="flex flex-col h-full">
          {!fullscreen && (
            <IframeUrlBar
              url={iframeUrl}
              readable={iframeUrlReadable}
              stale={iframeUrlStale}
              onManualUpdate={(next) => {
                setIframeUrl(next);
                setIframeUrlReadable(true);
                setIframeUrlStale(false);
              }}
            />
          )}
          <div className="flex-1 min-h-0">
            <ManualIframe baseUrl={baseUrl} iframeRef={iframeRef} />
          </div>
        </div>
      </div>

      {!test && !fullscreen && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Select a test from the sidebar</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Address-bar strip shown above the manual iframe ─────────────────────────
//
// Lets the tester see + copy the iframe's current URL. Same-origin SUTs get a
// live URL via contentWindow.location polling in ManualWorkPane; cross-origin
// SUTs fall back to the env baseUrl with a small "starting URL" hint so the
// tester knows the address isn't tracking iframe navigation.

function IframeUrlBar({
  url,
  readable,
  stale,
  onManualUpdate,
}: {
  url: string;
  readable: boolean;
  stale: boolean;
  onManualUpdate: (next: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(url);
  useEffect(() => { if (!editing) setDraft(url); }, [url, editing]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== url) onManualUpdate(trimmed);
    setEditing(false);
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — silently no-op */ }
  };
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b"
      style={{
        background: stale ? 'rgba(251,191,36,0.10)' : 'rgba(14,14,22,0.85)',
        borderColor: stale ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.07)',
      }}
    >
      <Globe size={12} style={{ color: stale ? '#fbbf24' : readable ? '#86efac' : 'rgba(238,238,248,0.40)', flexShrink: 0 }} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(url); setEditing(false); }
          }}
          placeholder="Paste the URL you're on"
          className="flex-1 bg-transparent text-[11px] font-mono outline-none"
          style={{ color: 'rgba(238,238,248,0.95)' }}
        />
      ) : (
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          title={readable ? 'Iframe current URL — click to select' : 'Cross-origin iframe — click the pencil to enter the URL manually'}
          className="flex-1 bg-transparent text-[11px] font-mono outline-none truncate"
          style={{ color: readable ? 'rgba(238,238,248,0.85)' : 'rgba(238,238,248,0.55)' }}
        />
      )}
      {stale && !editing && (
        <button
          type="button"
          onClick={() => { setDraft(''); setEditing(true); }}
          title="Page changed — paste the current URL"
          className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium"
          style={{ background: 'rgba(251,191,36,0.18)', border: '1px solid rgba(251,191,36,0.45)', color: '#fbbf24' }}
        >
          Page changed — update
        </button>
      )}
      {!readable && !stale && !editing && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
          style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.45)' }}
          title="The SUT is on a different origin, so the browser blocks reading the iframe's URL. This is the page's starting address — click the pencil to enter the URL manually."
        >
          start
        </span>
      )}
      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit URL manually"
          className="flex items-center justify-center w-6 h-6 rounded-md transition-colors shrink-0"
          style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          ✏️
        </button>
      )}
      <button
        type="button"
        onClick={onCopy}
        title="Copy URL"
        className="flex items-center justify-center w-6 h-6 rounded-md transition-colors shrink-0"
        style={{ color: copied ? '#86efac' : 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

// ─── Right Panel — Manual iframe (live preview only) ──────────────────────────

function ManualIframe({ baseUrl, iframeRef }: { baseUrl: string; iframeRef?: React.RefObject<HTMLIFrameElement> }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'timeout' | 'blocked'>('loading');

  useEffect(() => {
    setState('loading');
    const t = setTimeout(() => {
      setState(s => s === 'loading' ? 'timeout' : s);
    }, 10_000);
    return () => clearTimeout(t);
  }, [baseUrl]);

  if (state === 'timeout' || state === 'blocked') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
        <Monitor size={40} className="text-gray-600" />
        <div>
          <p className="text-sm text-gray-300 font-medium">
            {state === 'timeout' ? 'Preview timed out' : 'Preview blocked'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            The site may block embedding. Use "Open in New Tab" to test.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              let target = baseUrl;
              try {
                const href = iframeRef?.current?.contentWindow?.location.href;
                if (href && href !== 'about:blank') target = href;
              } catch { /* cross-origin — keep baseUrl */ }
              window.open(target, '_blank', 'noopener,noreferrer');
            }}
            className="px-3 py-1.5 text-xs rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 transition-colors"
          >
            ↗ Open in New Tab
          </button>
          <button
            onClick={() => setState('loading')}
            className="px-3 py-1.5 text-xs rounded-lg bg-white/5 text-gray-300 hover:bg-white/10 transition-colors"
          >
            ↺ Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* The floating "Open in New Tab" overlay that used to sit at top-2
          right-2 was removed — the header above the iframe already has
          "Full preview" + "Open in tab", and the overlay was both visually
          stacking those affordances and obscuring sign-in UI in the upper-
          right corner of typical SUT pages. */}
      <iframe
        ref={iframeRef}
        src={baseUrl}
        className="w-full h-full border-0"
        onLoad={() => setState('loaded')}
        onError={() => setState('blocked')}
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
          <Loader size={24} className="text-sky-400 animate-spin" />
        </div>
      )}
    </div>
  );
}

// ─── Right Panel — Live Browser Canvas (Automated) ───────────────────────────

// Same-origin Socket.IO — Vite proxy (dev) / nginx (prod) forward
// `/socket.io/` to the screencast gateway on api:3002.

function LiveBrowserCanvas({ testRunId }: { testRunId: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasFrame, setHasFrame] = useState(false);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Create and connect socket once on mount
  useEffect(() => {
    const sock = io('/screencast', {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    socketRef.current = sock;

    sock.on('connect', () => setConnected(true));
    sock.on('disconnect', () => setConnected(false));

    // Worker publishes frames as { frameBase64 }, but earlier code expected
    // { data }. Accept either so this keeps working if the worker's payload
    // shape is updated.
    const handleFrame = (payload: { frameBase64?: string; data?: string; timestamp?: number }) => {
      const b64 = payload.frameBase64 ?? payload.data;
      if (!b64) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const img = new Image();
      img.onload = () => {
        // Only resize canvas if dimensions differ (avoids layout reflow every frame)
        if (canvas.width !== img.width || canvas.height !== img.height) {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        ctx.drawImage(img, 0, 0);
        setHasFrame(true);
      };
      img.src = `data:image/jpeg;base64,${b64}`;
    };

    sock.on('screencast:frame', handleFrame);

    return () => {
      sock.off('connect');
      sock.off('disconnect');
      sock.off('screencast:frame', handleFrame);
      sock.disconnect();
      socketRef.current = null;
    };
  }, []); // mount only

  // Watch/unwatch the active TestRun when it changes
  useEffect(() => {
    const sock = socketRef.current;
    if (!sock) return;
    if (testRunId) {
      sock.emit('watch:run', testRunId);
    }
    return () => {
      if (testRunId && sock) sock.emit('unwatch:run', testRunId);
    };
  }, [testRunId]);

  // Reset canvas when a new run starts
  useEffect(() => {
    setHasFrame(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, [testRunId]);

  return (
    <div
      className="relative w-full h-full flex items-center justify-center"
      style={{ background: 'rgb(4,4,10)' }}
    >
      {/* Canvas — shown once frames arrive */}
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{
          display: hasFrame ? 'block' : 'none',
          objectFit: 'contain',
          imageRendering: 'auto',
        }}
      />

      {/* Overlay — shown while waiting for frames */}
      {!hasFrame && (
        <div className="flex flex-col items-center gap-4 text-center select-none">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Monitor size={28} className="text-gray-600" />
          </div>
          <div>
            <p className="text-gray-300 font-medium text-sm">
              {testRunId ? 'Waiting for browser stream…' : 'Live Browser View'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {testRunId
                ? 'Playwright is launching — first frame coming shortly'
                : 'Select ⚡ Automated and click Start All to see Playwright run live'}
            </p>
          </div>
          {testRunId && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader size={12} className="text-sky-400 animate-spin" />
              <span>Streaming…</span>
            </div>
          )}
        </div>
      )}

      {/* Connection indicator */}
      <div
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px]"
        style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Wifi size={9} className={connected ? 'text-emerald-400' : 'text-gray-600'} />
        <span className={connected ? 'text-emerald-400' : 'text-gray-600'}>
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>

      {/* Frame indicator when live */}
      {hasFrame && (
        <div
          className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px]"
          style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-gray-300">REC</span>
        </div>
      )}
    </div>
  );
}

// ─── Main TestingView ─────────────────────────────────────────────────────────

export function TestingView() {
  const { projectId, featureId } = useParams<{ projectId: string; featureId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const preselectedTestId = searchParams.get('testCaseId');
  const requestedMode = searchParams.get('mode') as RunMode | null;
  const requestedTestRunId = searchParams.get('testRunId');
  const deepLinkIssueId = searchParams.get('issue');
  const highlightStepId = searchParams.get('highlightStep');

  const [mode, setMode] = useState<RunMode>(requestedMode === 'AUTOMATED' ? 'AUTOMATED' : 'MANUAL');
  const [selectedTestId, setSelectedTestId] = useState<string | null>(preselectedTestId);
  const [envOpen, setEnvOpen] = useState(false);

  // Mid-run mode-switch flow.
  //   target  — which mode the user wants to switch to (modal trigger)
  //   phase   — 'confirm' before user agrees, 'aborting' while we wait for the
  //             worker's run:abortCompleted ack, 'configure' for the auto-setup
  //             panel after a manual→auto switch is confirmed.
  //   pendingAbortFeatureRunId — the run we're waiting to fully abort. Cleared
  //             on the abortCompleted event so we know it is safe to switch.
  type SwitchPhase = 'confirm' | 'aborting' | 'configure';
  const [switchModal, setSwitchModal] = useState<{ target: RunMode; phase: SwitchPhase } | null>(null);
  const [pendingAbortFeatureRunId, setPendingAbortFeatureRunId] = useState<string | null>(null);
  // Immediately-known TestRun ID from startRun response — used to subscribe to
  // screencast without waiting for the 3s polling cycle to catch the RUNNING status
  const [immediateTestRunId, setImmediateTestRunId] = useState<string | null>(requestedTestRunId);
  // Live preview iframe ref — passed down to ManualWorkPane (sets it) and to
  // ActiveStepCard (reads it for programmatic Capture). Lives at this level
  // so both halves of the layout share the same ref.
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // ── Floating-bar evidence (screenshot + recording) ────────────────────────
  // A single captured item shown in a preview modal; user then decides whether
  // to attach it to an issue or discard it.
  const [floatingPreview, setFloatingPreview] = useState<{
    url: string; mimeType: string; filename: string; objectUrl?: string;
  } | null>(null);
  const [floatingCapturing, setFloatingCapturing] = useState(false);

  // Annotator state — when set, we render the marker.js wrapper on top of
  // the preview modal. On Save the annotated blob re-runs through
  // finalizeCapture so the floatingPreview is replaced with the marked-up
  // version (and the original blob is GC'd via revokeObjectURL).
  const [annotating, setAnnotating] = useState(false);

  // Floating action bar can be collapsed to a tiny pill in the bottom-right,
  // useful when it covers something in the iframe under test. Persists per
  // user (localStorage) so the choice survives reloads.
  const [floatingBarCollapsed, setFloatingBarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('testingview.floatingBar.collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('testingview.floatingBar.collapsed', floatingBarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [floatingBarCollapsed]);
  const [recMicEnabled, setRecMicEnabled] = useState(getManualRecMicEnabled);
  useEffect(() => {
    const onMic = (e: Event) => {
      const ce = e as CustomEvent<{ enabled?: boolean }>;
      if (typeof ce.detail?.enabled === 'boolean') setRecMicEnabled(ce.detail.enabled);
    };
    window.addEventListener(MANUAL_REC_MIC_EVENT, onMic as EventListener);
    return () => window.removeEventListener(MANUAL_REC_MIC_EVENT, onMic as EventListener);
  }, []);

  const floatingRecording = useScreenRecording({
    onComplete: async (blob, durationMs) => {
      const objectUrl = URL.createObjectURL(blob);
      try {
        const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
        const filename = `Recording (${formatRecordingDuration(durationMs)})`;
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
        const r = await uploadsApi.upload(file);
        setFloatingPreview({ url: r.url, mimeType: r.mimeType, filename, objectUrl });
      } catch {
        URL.revokeObjectURL(objectUrl);
        toast.error('Recording upload failed', 'Try again.');
      }
    },
    onError: (msg) => toast.error('Recording error', msg),
  });

  /**
   * Grab a single frame from `navigator.mediaDevices.getDisplayMedia` —
   * the user is prompted to pick a tab / window / screen. Used as the
   * fallback when same-origin DOM capture fails because the iframe is
   * cross-origin (X-Frame-Options blocks `contentDocument`).
   *
   * Browser permission gate is intentional: user knows when their screen
   * is being captured. After grabbing one frame we stop the stream so we
   * don't leave a recording running.
   */
  const captureViaDisplayMedia = useCallback(async (): Promise<
    { ok: true; blob: Blob } | { ok: false; reason: 'insecure-context' | 'unsupported' | 'denied' | 'unknown' }
  > => {
    // getDisplayMedia is gated by the "secure context" rule. On plain HTTP
    // (e.g. dev server reached by raw IP without TLS) the entire
    // navigator.mediaDevices object is undefined — there is no permission
    // prompt, no recoverable error, just silent failure. We surface this
    // as a distinct reason so the toast can tell the truth ("HTTPS required")
    // instead of the misleading "user cancelled".
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { ok: false, reason: 'insecure-context' };
    }
    if (!navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'unsupported' };
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // `displaySurface: 'browser'` hints "prefer the browser tab picker"
        // — non-standard but Chromium uses it. Cast through unknown so
        // strict TS lets us pass it.
        video: { displaySurface: 'browser' } as unknown as MediaTrackConstraints,
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) return { ok: false, reason: 'unknown' };

      // Prefer ImageCapture (Chromium/Edge). It grabs a single frame
      // without needing a hidden <video> element.
      const ICAny = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;
      if (ICAny) {
        const ic = new ICAny(track);
        const bitmap = await ic.grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, reason: 'unknown' };
        ctx.drawImage(bitmap, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/webp', 0.85),
        );
        return blob ? { ok: true, blob } : { ok: false, reason: 'unknown' };
      }

      // Safari / Firefox fallback — render the stream to a hidden <video>,
      // wait one frame, paint it onto a canvas.
      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 120));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width) return { ok: false, reason: 'unknown' };
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.85),
      );
      return blob ? { ok: true, blob } : { ok: false, reason: 'unknown' };
    } catch (err) {
      // NotAllowedError = user clicked "Cancel" on the picker; everything
      // else (NotFoundError / SecurityError / etc.) we treat as opaque.
      const name = (err as { name?: string })?.name;
      return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'unknown' };
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, []);

  /**
   * Cross-origin iframe screenshot via Chromium's Region Capture API.
   * The browser crops the share-this-tab stream to the iframe's pixels
   * inside the compositor, so we never read cross-origin DOM. The user
   * still sees the share prompt once (browser-mandated for cross-origin
   * capture), but the resulting frame is iframe-only — no surrounding
   * tab chrome or QA platform UI.
   *
   * Chrome / Edge 104+. Falls back to manual crop on Firefox / Safari.
   */
  const captureViaCropTarget = useCallback(async (
    iframe: HTMLIFrameElement,
  ): Promise<{ ok: true; blob: Blob } | { ok: false; reason: 'unsupported' | 'denied' | 'unknown' | 'insecure-context' }> => {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      return { ok: false, reason: 'insecure-context' };
    }
    const CT = (window as unknown as { CropTarget?: { fromElement: (el: Element) => Promise<unknown> } }).CropTarget;
    if (!CT || !navigator.mediaDevices?.getDisplayMedia) return { ok: false, reason: 'unsupported' };

    let stream: MediaStream | null = null;
    try {
      const cropTarget = await CT.fromElement(iframe);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' } as unknown as MediaTrackConstraints,
        audio: false,
        // Non-standard hints, Chromium-only — pre-select current tab + allow it.
        ...({ preferCurrentTab: true, selfBrowserSurface: 'include' } as Record<string, unknown>),
      });
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & {
        cropTo?: (target: unknown) => Promise<void>;
      };
      if (!track) return { ok: false, reason: 'unknown' };
      if (typeof track.cropTo !== 'function') return { ok: false, reason: 'unsupported' };
      await track.cropTo(cropTarget);

      // Same single-frame grab path as captureViaDisplayMedia.
      const ICAny = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { grabFrame: () => Promise<ImageBitmap> } }).ImageCapture;
      let blob: Blob | null = null;
      if (ICAny) {
        const ic = new ICAny(track);
        const bitmap = await ic.grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return { ok: false, reason: 'unknown' };
        ctx.drawImage(bitmap, 0, 0);
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
      } else {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        await new Promise((r) => setTimeout(r, 120));
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width) return { ok: false, reason: 'unknown' };
        ctx.drawImage(video, 0, 0);
        blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
      }
      return blob ? { ok: true, blob } : { ok: false, reason: 'unknown' };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      return { ok: false, reason: name === 'NotAllowedError' ? 'denied' : 'unknown' };
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
    }
  }, []);

  /**
   * Crop an already-captured full-tab/window frame to the iframe's
   * bounding rect. Used as a Firefox / Safari fallback when CropTarget
   * isn't available. Only correct when the user picks "this tab" in the
   * picker (rect is page-relative). For window/screen picks, this still
   * usually produces a usable crop because the browser viewport occupies
   * a predictable region — but we don't promise it.
   */
  const cropBlobToIframe = useCallback(async (
    blob: Blob,
    iframe: HTMLIFrameElement,
  ): Promise<Blob | null> => {
    const rect = iframe.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    const bmp = await createImageBitmap(blob);
    // Tab-capture frames are scaled to the captured surface. Best-effort
    // scale factor: assume the source covers the document viewport, so
    // 1px in the iframe rect corresponds to `bmp.width / window.innerWidth`
    // pixels in the captured frame. Holds when user picks "this tab".
    const sx = bmp.width / window.innerWidth;
    const sy = bmp.height / window.innerHeight;
    const cx = Math.max(0, Math.round(rect.left * sx));
    const cy = Math.max(0, Math.round(rect.top * sy));
    const cw = Math.min(bmp.width - cx, Math.round(rect.width * sx));
    const ch = Math.min(bmp.height - cy, Math.round(rect.height * sy));
    if (cw < 4 || ch < 4) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, cx, cy, cw, ch, 0, 0, cw, ch);
    return new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.85));
  }, []);

  /**
   * Upload a captured PNG blob and set it as the floating preview so the
   * "Attach to Issue" button surfaces it. Shared by both capture paths
   * (same-origin DOM capture + cross-origin getDisplayMedia fallback) so
   * they end up at the same state.
   */
  const finalizeCapture = useCallback(async (blob: Blob): Promise<void> => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      // Format-agnostic — captures are WebP now (5–10× smaller than PNG)
      // but fall back gracefully for any blob type.
      const mime = blob.type || 'image/png';
      const ext = mime === 'image/webp' ? 'webp' : mime === 'image/jpeg' ? 'jpg' : 'png';
      const file = new File([blob], `capture-${Date.now()}.${ext}`, { type: mime });
      const r = await uploadsApi.upload(file);
      setFloatingPreview({
        url: r.url,
        mimeType: mime,
        filename: `Screenshot ${new Date().toLocaleTimeString()}`,
        objectUrl,
      });
    } catch (err) {
      // Upload failed — revoke the blob URL so it doesn't leak (the preview
      // that would normally own + revoke it is never created).
      URL.revokeObjectURL(objectUrl);
      throw err;
    }
  }, []);

  const captureFloatingIframe = useCallback(async () => {
    const iframe = previewIframeRef.current;
    if (!iframe) {
      toast.warning('Preview not ready', 'Open the app preview before capturing.');
      return;
    }
    setFloatingCapturing(true);
    try {
      // Path 1: same-origin iframe — fast, no permission prompt.
      const doc = iframe.contentDocument;
      if (doc?.documentElement) {
        // toCanvas + WebP @ 0.85 — ~5–10× smaller than html-to-image's
        // default PNG toBlob, fine quality for QA evidence.
        const { toCanvas } = await import('html-to-image');
        const canvas = await toCanvas(doc.documentElement, {
          cacheBust: true,
          pixelRatio: window.devicePixelRatio || 1,
        });
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, 'image/webp', 0.85),
        );
        if (!blob) throw new Error('capture-failed');
        await finalizeCapture(blob);
        return;
      }

      // Path 2: Region Capture — Chromium 104+ crops the share-this-tab
      // stream to the iframe rect inside the compositor, producing an
      // iframe-only frame. Still requires the share prompt (browser-
      // mandated for cross-origin capture); Chrome 120+ lets the user
      // tick "Remember on this site" to make subsequent clicks silent.
      const crop = await captureViaCropTarget(iframe);
      if (crop.ok) {
        await finalizeCapture(crop.blob);
        return;
      }
      if (crop.reason === 'denied') {
        toast.warning('Capture cancelled', 'You closed the picker — try again and pick this tab.');
        return;
      }
      if (crop.reason === 'insecure-context') {
        toast.error(
          'Screen capture needs HTTPS',
          'This page is served over plain HTTP, so the browser refuses to expose screen-capture APIs. Ask an admin to put TLS in front of the platform.',
          0,
        );
        return;
      }

      // Path 3: Firefox / Safari (no CropTarget) — fall back to the full
      // getDisplayMedia capture + manual crop to the iframe rect. The
      // user still sees the picker; the resulting image is iframe-only
      // when they pick "this tab".
      toast.info(
        'Screen share prompt incoming',
        'Cross-origin iframe — pick THIS TAB in the browser prompt for a clean crop.',
      );
      const r = await captureViaDisplayMedia();
      if (!r.ok) {
        // Surface the truth instead of "you cancelled" — most of these
        // failure modes the user has no control over.
        switch (r.reason) {
          case 'insecure-context':
            toast.error(
              'Screen capture needs HTTPS',
              'This page is served over plain HTTP, so the browser refuses to expose screen-capture APIs. Ask an admin to put TLS in front of the platform.',
              0, // sticky — the user needs to read this
            );
            break;
          case 'unsupported':
            toast.error(
              'Browser doesn’t support screen capture',
              'Try the latest Chrome, Edge or Firefox. Mobile browsers and older Safari don’t expose getDisplayMedia.',
            );
            break;
          case 'denied':
            toast.warning('Capture cancelled', 'You closed the picker — try again and pick a tab / window.');
            break;
          default:
            toast.error('Capture failed', 'The browser returned no frame. Try again.');
        }
        return;
      }
      // Best-effort crop to iframe rect. If the user picked a window/screen
      // rather than the tab the crop math may be off; fall back to the
      // uncropped frame so they still get something usable.
      const cropped = await cropBlobToIframe(r.blob, iframe).catch(() => null);
      await finalizeCapture(cropped ?? r.blob);
    } catch (err) {
      const msg = (err as Error)?.message;
      if (msg === 'capture-failed') {
        toast.error('Capture failed', 'Try again — DOM render returned no image.');
      } else {
        toast.error('Capture failed', 'Try again.');
      }
    } finally {
      setFloatingCapturing(false);
    }
  }, [captureViaDisplayMedia, finalizeCapture]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>(() => {
    try { return localStorage.getItem(lastEnvKeyFor(projectId)) ?? ''; } catch { return ''; }
  });
  // When the route's projectId changes, re-read the per-project stored env id
  // (the initial useState only fires once on mount, so route changes wouldn't
  // otherwise pick up the right value).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(lastEnvKeyFor(projectId)) ?? '';
      setSelectedEnvId(stored);
    } catch { setSelectedEnvId(''); }
  }, [projectId]);

  // Drag resize
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_LEFT;
  });

  // Sidebar collapse state — when true, the test-cases list is hidden and a
  // floating action bar appears at the bottom of the right pane.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => localStorage.getItem('testing-view-sidebar-collapsed') === '1',
  );

  // Mobile: the desktop split-pane (list + preview side-by-side) can't fit a
  // phone, so below md we show ONE pane at a time via a tab toggle. Selecting a
  // test jumps to the preview; the toggle jumps back to the list. Desktop is
  // unaffected (isMobile is false ≥768px).
  const isMobile = useIsMobile();
  const [mobilePane, setMobilePane] = useState<'list' | 'preview'>('list');
  // Mobile floating-bar "more actions" slide-up menu (screenshot / record /
  // mic / log issue / context / notes) — keeps the bar itself compact.
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(v => {
      const next = !v;
      localStorage.setItem('testing-view-sidebar-collapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Fullscreen iframe — when true, the iframe expands to fill the entire
  // viewport above the floating bar (sidebar still toggleable from the bar).
  const [iframeFullscreen, setIframeFullscreen] = useState(false);

  // Slide-in context panel (feature description + acceptance criteria).
  const [contextOpen, setContextOpen] = useState(false);

  // Slide-in notes panel (personal per-project notes).
  const [notesOpen, setNotesOpen] = useState(false);

  // Linked docs for the feature — surfaced in the context panel so the
  // tester can pop open a full-screen doc reader without leaving the run.
  const linkedDocsQ = useQuery({
    queryKey: ['doc-links', 'feature', featureId],
    queryFn: () => docsApi.listLinked('feature', featureId!),
    enabled: !!featureId && contextOpen,
  });
  const [docViewerLink, setDocViewerLink] = useState<LinkedDoc | null>(null);

  // Issue modal — opened when the tester clicks Bug on a test or after Fail.
  const [issueModalTestRunId, setIssueModalTestRunId] = useState<string | null>(null);
  const [issueModalEvidence, setIssueModalEvidence] = useState<{ url: string; mimeType: string; filename: string; objectUrl?: string } | null>(null);
  /**
   * Sidebar resize uses pointer events with pointer-capture instead of the
   * older mouse-events + document-level listeners pattern. Why:
   *
   *   - The iframe in the right pane has its own document. When dragging
   *     mouse-style, a `mouseup` released while the cursor was over the
   *     iframe never bubbled up — `dragging.current` stayed true and the
   *     next click went straight back into drag mode (the "drag stays
   *     enabled" symptom).
   *
   *   - `setPointerCapture` on the handle reroutes every subsequent
   *     pointermove / pointerup / pointercancel to the handle itself
   *     regardless of what's physically under the cursor. iframes can't
   *     swallow them.
   *
   *   - We also flip `pointer-events: none` on the body while dragging so
   *     that fast crossings over the iframe don't paint a flashing
   *     cursor — defensive, costs nothing.
   */
  const dragStartX = useRef(0);
  const widthAtDragStart = useRef(DEFAULT_LEFT);
  /** True while the user is actively dragging — used to keep the handle highlighted during drag. */
  const [isDragging, setIsDragging] = useState(false);

  const handleDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Left button only (mouse) or primary touch / pen
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStartX.current = e.clientX;
    widthAtDragStart.current = leftWidth;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftWidth]);

  const handleDragPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const delta = e.clientX - dragStartX.current;
    const newW = Math.min(MAX_LEFT, Math.max(MIN_LEFT, widthAtDragStart.current + delta));
    setLeftWidth(newW);
  }, [isDragging]);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore — capture may have been released already
    }
    setLeftWidth((w) => {
      localStorage.setItem(STORAGE_KEY, String(w));
      return w;
    });
  }, [isDragging]);

  /** Double-click the handle to snap back to the default width. */
  const handleDragReset = useCallback(() => {
    setLeftWidth(DEFAULT_LEFT);
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_LEFT));
  }, []);

  // Data
  const { data: feature } = useQuery({
    queryKey: ['feature', featureId],
    queryFn: () => featuresApi.get(featureId!),
    enabled: !!featureId,
  });

  // Feature-scoped test cases. Same query key as LeftPanel so React Query
  // dedupes the call automatically.
  const { data: allTests = [] } = useQuery<TestCase[]>({
    queryKey: ['tests', projectId, featureId],
    queryFn: () => testsApi.list(projectId!, featureId!),
    enabled: !!projectId && !!featureId,
  });
  const featureTests = allTests;
  const selectedTest = featureTests.find(t => t.id === selectedTestId) ?? null;

  // Persisted per-test statuses (PASSED / FAILED / SKIPPED from any prior
  // run path — quick-mark, manual session, automated). Used by the
  // auto-select effect below to pick the first NOT-YET-COMPLETED test
  // when the user lands on the page without a `testCaseId` URL param.
  // Without this, the wizard always lands on the first test even when the
  // tester has already marked tests 1-5 — they'd have to manually scroll
  // to test 6.
  const { data: latestTestStatuses } = useQuery<Array<{ testDefinitionId: string; status: string }>>({
    queryKey: ['test-statuses', featureId, /* envId */ null],
    queryFn: () => testsApi.getLatestStatuses(featureId!) as Promise<Array<{ testDefinitionId: string; status: string }>>,
    enabled: !!featureId,
    staleTime: 10_000,
  });

  const testIssueStatQueries = useQueries({
    queries: featureTests.map(tc => ({
      queryKey: ['issue-stats', 'test', tc.id],
      queryFn: () => issuesApi.testStats(tc.id) as Promise<{ total: number; open: number }>,
      enabled: !!projectId && featureTests.length > 0,
      staleTime: 25_000,
    })),
  });

  const issueStatsByTestId = useMemo(() => {
    const m = new Map<string, TestIssueStats>();
    featureTests.forEach((tc, i) => {
      const d = testIssueStatQueries[i]?.data;
      if (d) m.set(tc.id, { total: d.total ?? 0, open: d.open ?? 0 });
    });
    return m;
  }, [featureTests, testIssueStatQueries]);

  const selectedIssueStats = selectedTestId ? issueStatsByTestId.get(selectedTestId) ?? null : null;

  const [linkedIssuesPeek, setLinkedIssuesPeek] = useState<{ testId: string; testName: string } | null>(null);
  const [linkedIssueDetailId, setLinkedIssueDetailId] = useState<string | null>(null);

  const openLinkedIssuesPeek = useCallback((testId: string, testName: string) => {
    setLinkedIssuesPeek({ testId, testName });
  }, []);

  const handlePickLinkedIssue = useCallback((issueId: string) => {
    setLinkedIssueDetailId(issueId);
  }, []);

  // Deep-link: fetch issue info when ?issue= is present
  const { data: deepLinkIssue } = useQuery<{ id: string; title: string; type: string }>({
    queryKey: ['issue-deeplink', deepLinkIssueId],
    queryFn: () => issuesApi.get(deepLinkIssueId!),
    enabled: !!deepLinkIssueId,
    staleTime: 60_000,
  });

  // Auto-select a test when none is set — picks the running test if there is
  // one, otherwise the first not-yet-completed test from the active run, then
  // falls back to the first test alphabetically. Without this, the floating
  // action bar shows disabled Pass/Fail/Skip/Bug because the actions need a
  // test selected, which the user couldn't do with the sidebar collapsed.

  // Note: MANUAL and AUTOMATED both render here now. The earlier mode→
  // FeaturePage redirect is removed because /test is the canonical rich
  // surface (collapsible sidebar, floating actions, fullscreen iframe,
  // description-driven manual mode). FeaturePage's in-page ManualPlayer
  // remains for backwards compatibility but new entry paths should land
  // here.

  const { data: envs = [] } = useQuery<Environment[]>({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  const { data: featureRuns = [] } = useQuery({
    queryKey: ['feature-runs', featureId],
    queryFn: () => featureRunsApi.list(featureId!),
    enabled: !!featureId,
    staleTime: 10_000,
    // Socket handles real-time; only poll every 10s if there's an active run
    refetchInterval: (query) => {
      const runs = ((query as unknown as { state: { data: unknown } }).state.data as { status: string }[] | undefined) ?? [];
      const hasActive = runs.some(r => r.status === 'RUNNING' || r.status === 'PAUSED');
      return hasActive ? 10_000 : false;
    },
  });

  const environmentsList = envs as Environment[];
  const selectedEnv = environmentsList.find(e => e.id === selectedEnvId) ?? environmentsList[0];

  const featureRunsList = featureRuns as FeatureRun[];
  const activeRun = featureRunsList.find(
    r => r.status === 'RUNNING' || r.status === 'PAUSED',
  ) ?? null;
  const effectiveMode = (activeRun?.runMode as RunMode | undefined) ?? mode;
  const runningTestRun = activeRun?.testRuns.find(tr => tr.status === 'RUNNING') ?? null;
  const runningTestIndex = runningTestRun ? activeRun!.testRuns.findIndex(tr => tr.id === runningTestRun.id) : -1;
  // Derive counts in a single pass and memo so they only churn when statuses
  // actually change. Earlier this iterated testRuns three times *every* render
  // — cheap individually, but compounds with the rest of the view.
  const { passedCount, failedCount, skippedCount } = useMemo(() => {
    const counts = { passedCount: 0, failedCount: 0, skippedCount: 0 };
    activeRun?.testRuns.forEach(t => {
      if (t.status === 'PASSED') counts.passedCount++;
      else if (t.status === 'FAILED') counts.failedCount++;
      else if (t.status === 'CANCELLED') counts.skippedCount++;
    });
    return counts;
  }, [activeRun?.testRuns]);

  // Auto-select first env. Also self-heals if the stored selectedEnvId
  // belongs to a different project (the backend rejects it with a
  // ForbiddenException, which surfaces as "Environment does not belong to
  // this project") — drop the stale id and pick env[0].
  useEffect(() => {
    if (environmentsList.length === 0) return;
    const stillValid = !!selectedEnvId && environmentsList.some((e) => e.id === selectedEnvId);
    if (!selectedEnvId || !stillValid) {
      const envId = environmentsList[0].id;
      setSelectedEnvId(envId);
      try { localStorage.setItem(lastEnvKeyFor(projectId), envId); } catch { /* ignore */ }
    }
  }, [environmentsList, selectedEnvId, projectId]);

  // Auto-select a test so the floating action bar isn't stuck disabled.
  //
  // Priority (most specific to most generic):
  //   1. URL `?testCaseId=…` — already applied as the initial state for
  //      selectedTestId, so this guard short-circuits the effect.
  //   2. Active run is in progress — pick its RUNNING / PENDING test (so
  //      automated runs auto-scroll to whatever the worker's on now).
  //   3. Some tests have a terminal status (PASSED/FAILED/SKIPPED) from
  //      prior runs — pick the FIRST test that doesn't, so a tester
  //      resuming work lands on "next to do" not back at test 1.
  //   4. Fall-through: featureTests[0] — first test in created order.
  useEffect(() => {
    if (selectedTestId) return;

    // Active run path — mirrors what the worker is currently doing.
    if (activeRun?.testRuns?.length) {
      const running = activeRun.testRuns.find(tr => tr.status === 'RUNNING');
      const pending = activeRun.testRuns.find(tr =>
        tr.status === 'PENDING' || tr.status === 'PAUSED' || tr.status === 'RUNNING'
      );
      const target = running ?? pending ?? activeRun.testRuns[0];
      if (target?.testDefinition?.id) {
        setSelectedTestId(target.testDefinition.id);
        return;
      }
    }

    if (featureTests.length === 0) return;

    // Resume path — find the first feature test (in API/createdAt order)
    // whose latest persisted status isn't terminal. If everything's
    // already terminal we'll fall through to featureTests[0] below so the
    // page isn't blank — tester might want to re-run the first one anyway.
    if (latestTestStatuses && latestTestStatuses.length > 0) {
      const statusMap = new Map(latestTestStatuses.map((row) => [row.testDefinitionId, row.status]));
      const firstUntested = featureTests.find((t) => !TERMINAL_TEST_STATUSES.has(statusMap.get(t.id) ?? ''));
      if (firstUntested) {
        setSelectedTestId(firstUntested.id);
        return;
      }
    }

    setSelectedTestId(featureTests[0].id);
  }, [selectedTestId, activeRun?.testRuns, featureTests, latestTestStatuses]);

  const featureName = (feature as { name?: string } | undefined)?.name ?? 'Feature';
  const moduleId = (feature as { module?: { id?: string } } | undefined)?.module?.id ?? '';

  // Sync local mode to match active run's runMode (so loading the view with an
  // already-running automated run shows the Automated canvas, not the iframe)
  useEffect(() => {
    if (activeRun?.runMode) {
      setMode(activeRun.runMode as RunMode);
    }
  }, [activeRun?.id]);

  // Auto-reattach canvas when navigating back to an already-running automated test.
  // Derive a stable string (the running TestRun ID) rather than the full array so
  // this effect only fires when the *running* test changes, not on every re-render.
  const runningTestRunId =
    activeRun && effectiveMode === 'AUTOMATED'
      ? (runningTestRun?.id ?? null)
      : null;

  useEffect(() => {
    // Always sync to the currently-running test, not just on first detection.
    // The earlier "set once" version meant the canvas stayed subscribed to
    // test 1's screencast channel even after the run advanced to test 2/3/4
    // — so frames published for the new test never reached the canvas.
    if (runningTestRunId && runningTestRunId !== immediateTestRunId) {
      setImmediateTestRunId(runningTestRunId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningTestRunId]); // immediateTestRunId intentionally excluded — read but not depended on

  // Live socket — also listen for the abort-completed signal so we know
  // when it's safe to flip into manual mode after stopping an automated run.
  useFeatureRunSocket(featureId ?? undefined, activeRun?.id ?? null, (payload) => {
    // Only act if this is the run we're waiting on (or its parent featureRun)
    if (
      pendingAbortFeatureRunId &&
      (payload.runId === pendingAbortFeatureRunId || payload.featureRunId === pendingAbortFeatureRunId)
    ) {
      setPendingAbortFeatureRunId(null);
      setSwitchModal(curr => {
        if (!curr || curr.phase !== 'aborting') return curr;
        // After aborting from auto, drop into manual mode immediately. No
        // configuration step needed — the user just gets the manual canvas.
        if (curr.target === 'MANUAL') {
          setMode('MANUAL');
          return null;
        }
        // After aborting from manual (rare — abandon path), advance to the
        // auto-config panel so they can pick env + start-from-here.
        return { target: 'AUTOMATED', phase: 'configure' };
      });
    }
  });

  // Clear immediateTestRunId when the run finishes so a fresh run gets a fresh subscription
  useEffect(() => {
    if (!activeRun) setImmediateTestRunId(null);
  }, [activeRun?.id]);

  // Conflict modal — surfaces ACTIVE_SESSION_CONFLICT 409s from start (the
  // server rejects a second concurrent manual session). Mirrors the modal
  // on FeaturePage; previously TestingView had no UI for this and the
  // Re-run button just failed silently when a stale session existed.
  type ConflictActiveRun = {
    id: string;
    featureId: string;
    featureName: string;
    moduleId: string;
    moduleName: string;
    projectId: string;
    startedAt: string | null;
    status: string;
    sameFeature: boolean;
  };
  type ConflictPendingOverrides = {
    runMode?: RunMode;
    startFromTestDefinitionId?: string;
  };
  const [conflictModal, setConflictModal] = useState<{
    run: ConflictActiveRun;
    /** What we tried to start so we can retry with allowConcurrent. */
    pendingOverrides: ConflictPendingOverrides | undefined;
  } | null>(null);

  // Common invalidation set — bumps the FeaturePage cache, the TopNav active
  // session pill, and the test-list badges so every consumer reflects the
  // new state in one go. The single-key invalidations that used to be on
  // each mutation here missed ['my-active-runs'] (TopNav stayed stale) and
  // ['runs', projectId] / ['tests-browse'] (test cards stayed stale).
  const invalidateRunCaches = () => {
    qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
    qc.invalidateQueries({ queryKey: ['my-active-runs'] });
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        (q.queryKey[0] === 'runs' || q.queryKey[0] === 'tests-browse' ||
          q.queryKey[0] === 'test-active-runs'),
    });
  };

  // Mutations
  const startRun = useMutation({
    mutationFn: (overrides?: { runMode?: RunMode; startFromTestDefinitionId?: string; allowConcurrent?: boolean }) =>
      featureRunsApi.start(featureId!, {
        environmentId: selectedEnvId || selectedEnv?.id,
        runMode: overrides?.runMode ?? mode,
        ...(overrides?.startFromTestDefinitionId
          ? { startFromTestDefinitionId: overrides.startFromTestDefinitionId }
          : {}),
        ...(overrides?.allowConcurrent ? { allowConcurrent: true } : {}),
      }),
    onSuccess: (data: { featureRun: { id: string }; testRuns: { id: string }[] }) => {
      // Subscribe to screencast immediately without waiting for the polling cycle
      if (data?.testRuns?.[0]?.id) {
        setImmediateTestRunId(data.testRuns[0].id);
      }
      invalidateRunCaches();
    },
    onError: (err: unknown, overrides) => {
      // 409 ACTIVE_SESSION_CONFLICT — server detected another active manual
      // session. Pop the recovery modal instead of failing silently. Without
      // this, hitting Re-run when a stale session lingered gave no feedback.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { code?: string; activeRun?: ConflictActiveRun } } })?.response?.data;
      if (status === 409 && data?.code === 'ACTIVE_SESSION_CONFLICT' && data.activeRun) {
        setConflictModal({
          run: data.activeRun,
          pendingOverrides: overrides as ConflictPendingOverrides | undefined,
        });
        return;
      }
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not start run', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  const pauseRun = useMutation({
    mutationFn: () => featureRunsApi.pause(activeRun!.id),
    onSuccess: invalidateRunCaches,
  });

  const resumeRun = useMutation({
    mutationFn: () => featureRunsApi.resume(activeRun!.id),
    onSuccess: invalidateRunCaches,
  });

  const stopRun = useMutation({
    mutationFn: () => featureRunsApi.stop(activeRun!.id),
    onSuccess: () => {
      invalidateRunCaches();
      toast.success('Session ended', 'Run stopped. The TopNav pill will refresh.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to stop run', typeof msg === 'string' ? msg : 'Try again or use the org-admin "Force stop".');
    },
  });

  // "Feature complete" modal — opened when the LAST test in the feature is
  // marked. Holds the just-finished feature's tallies so the modal can show
  // a summary without waiting on a stats refetch.
  const [completion, setCompletion] = useState<{
    passed: number; failed: number; skipped: number; total: number;
  } | null>(null);

  // Continue testing on another feature: start a fresh manual run there and
  // navigate. The current run has already auto-completed server-side (the
  // last mark flips it to COMPLETE), so this won't hit the conflict guard.
  const continueToFeature = useMutation({
    mutationFn: (targetFeatureId: string) =>
      featureRunsApi.start(targetFeatureId, { runMode: 'MANUAL' }),
    onSuccess: (data: { featureRun?: { id: string } }, targetFeatureId) => {
      setCompletion(null);
      const params = new URLSearchParams({ mode: 'MANUAL' });
      if (data?.featureRun?.id) params.set('runId', data.featureRun.id);
      navigate(`/projects/${projectId}/features/${targetFeatureId}/test?${params.toString()}`);
      toast.success('Continuing', 'Manual session started on the next feature.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not continue', typeof msg === 'string' ? msg : 'Try again from the feature page.');
    },
  });

  // Description-driven manual: mark the whole TestRun in one shot. The backend
  // also flips any non-terminal child steps to match so reports stay coherent.
  // "Why did it fail?" modal — opened before a FAILED mark so QA always
  // captures a structured reason. Holds the run being failed.
  const [failureModal, setFailureModal] = useState<{ testRunId: string; testName: string } | null>(null);

  const markTestRun = useMutation({
    mutationFn: (vars: {
      testRunId: string;
      status: 'PASSED' | 'FAILED' | 'SKIPPED';
      notes?: string;
      failureCategory?: string;
      failureNote?: string;
    }) =>
      runsApi.markTestRunStatus(vars.testRunId, {
        status: vars.status,
        notes: vars.notes,
        failureCategory: vars.failureCategory,
        failureNote: vars.failureNote,
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      qc.invalidateQueries({ queryKey: ['my-active-runs'] });
      // Refresh the stats sources so FeaturePage's summary card + the per-test
      // badges reflect this mark when the user navigates back. Prefix
      // invalidation catches every (featureId, envId) variant of the keys.
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
      qc.invalidateQueries({ queryKey: ['module-stats'] });
      qc.invalidateQueries({ queryKey: ['project-stats'] });
      qc.invalidateQueries({ queryKey: ['test-statuses', featureId] });
      toast.success(
        vars.status === 'PASSED' ? 'Test passed' : vars.status === 'FAILED' ? 'Test failed' : 'Test skipped',
        'Status saved.',
      );
      // Auto-advance to the next not-yet-terminal test so the tester can keep
      // moving without re-clicking the sidebar after every mark.
      const next = activeRun?.testRuns.find(tr =>
        tr.id !== vars.testRunId &&
        (tr.status === 'PENDING' || tr.status === 'PAUSED' || tr.status === 'RUNNING'),
      );
      if (next?.testDefinition?.id) {
        setSelectedTestId(next.testDefinition.id);
      } else if (activeRun && activeRun.testRuns.length > 0) {
        // No next test → this was the LAST test in the feature. The backend
        // has flipped the FeatureRun to COMPLETE; surface the completion
        // modal (continue to next feature / module sign-off rollup).
        const TERMINAL = ['PASSED', 'FAILED', 'SKIPPED', 'CANCELLED', 'ERROR'];
        const counts = { passed: 0, failed: 0, skipped: 0, total: activeRun.testRuns.length };
        for (const tr of activeRun.testRuns) {
          // Apply the just-marked status to the row we acted on — the cached
          // activeRun still shows its pre-mark state.
          const st = tr.id === vars.testRunId ? vars.status : tr.status;
          if (st === 'PASSED') counts.passed++;
          else if (st === 'FAILED') counts.failed++;
          else if (st === 'SKIPPED' || st === 'CANCELLED') counts.skipped++;
          else if (!TERMINAL.includes(st)) { /* still running — shouldn't happen here */ }
        }
        setCompletion(counts);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to mark test', typeof msg === 'string' ? msg : 'Try again — see console for details.');
      // eslint-disable-next-line no-console
      console.error('markTestRun failed', err);
    },
  });

  const skipCurrent = useMutation({
    mutationFn: () => featureRunsApi.skipCurrent(activeRun!.id),
    onSuccess: () => {
      setImmediateTestRunId(null);
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
    },
  });

  const isRunActive = !!activeRun;

  // Mode-switch helpers ──────────────────────────────────────────────────────
  const handleModeButton = (target: RunMode) => {
    if (target === effectiveMode) return;
    if (!isRunActive) {
      // No active run: just switch the local mode flag.
      setMode(target);
      return;
    }
    // Active run: open the confirmation modal. Confirming will stop/abandon
    // the current run and (for AUTOMATED target) advance to the config panel.
    setSwitchModal({ target, phase: 'confirm' });
  };

  // Used by the modal Confirm button.
  const confirmSwitch = async () => {
    if (!switchModal || !activeRun) return;
    const target = switchModal.target;
    setSwitchModal({ target, phase: 'aborting' });
    setPendingAbortFeatureRunId(activeRun.id);

    // Timeout fallback — if the abort-completed socket event never lands
    // (transient WS disconnect, gateway hiccup, page visibility throttle),
    // the user used to be stuck in "aborting" forever. After 5 seconds,
    // force-advance and rely on the DB state instead (the run is already
    // CANCELLED at this point, the socket was just slow). Cleared the
    // moment the socket handler fires.
    const fallbackTimer = window.setTimeout(() => {
      setPendingAbortFeatureRunId((curr) => {
        if (!curr) return curr;
        toast.warning(
          'Switching anyway',
          'No abort confirmation arrived within 5 s — the run was cancelled but the live signal was lost.',
        );
        setSwitchModal((s) => {
          if (!s || s.phase !== 'aborting') return s;
          if (s.target === 'MANUAL') {
            setMode('MANUAL');
            return null;
          }
          return { target: 'AUTOMATED', phase: 'configure' };
        });
        return null;
      });
    }, 5_000);

    try {
      // Manual runs have no worker browser to clean up — abandon is the
      // right verb. Auto runs go through stop, which the worker watches.
      if (effectiveMode === 'AUTOMATED') {
        await featureRunsApi.stop(activeRun.id);
      } else {
        await featureRunsApi.abandon(activeRun.id);
      }
      invalidateRunCaches();
    } catch (err) {
      // Abort failed — back out the modal so user can retry. Never silently
      // unlock manual mode in this state, the worker may still hold the browser.
      window.clearTimeout(fallbackTimer);
      setPendingAbortFeatureRunId(null);
      setSwitchModal({ target, phase: 'confirm' });
      throw err;
    }
  };

  const cancelSwitch = () => {
    setSwitchModal(null);
  };

  // Used by the auto-config panel Start buttons.
  const launchAutoFromConfig = (opts: { startFromCurrent: boolean }) => {
    const sid = opts.startFromCurrent && selectedTestId ? selectedTestId : undefined;
    setMode('AUTOMATED');
    setSwitchModal(null);
    startRun.mutate({ runMode: 'AUTOMATED', ...(sid ? { startFromTestDefinitionId: sid } : {}) });
  };

  // Status text
  function statusText() {
    if (!activeRun) return 'Ready';
    if (activeRun.status === 'PAUSED') return 'Paused';
    const total = activeRun.testRuns.length;
    if (total === 0) return 'Running…';
    // Find the currently RUNNING test, fall back to the last completed
    const runningIdx = runningTestIndex;
    const done = activeRun.testRuns.filter(t => t.status === 'PASSED' || t.status === 'FAILED' || t.status === 'CANCELLED').length;
    const current = runningIdx >= 0 ? runningIdx + 1 : Math.min(done, total);
    return `Running — Test ${current} of ${total}`;
  }

  function goBack() {
    if (moduleId) {
      navigate(`/projects/${projectId}/modules/${moduleId}/features/${featureId}`);
    } else {
      navigate(`/projects/${projectId}`);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgb(8,8,16)' }}
    >
      {/* ── Top Action Bar ── (wraps on mobile so its controls aren't clipped;
          single fixed-height row on desktop) */}
      <div
        className="min-h-14 md:h-14 flex flex-wrap md:flex-nowrap items-center px-3 md:px-4 gap-2 md:gap-3 py-2 md:py-0 shrink-0"
        style={{
          background: 'rgba(10,10,24,0.98)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        {/* Back link */}
        <button
          onClick={goBack}
          className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200 transition-colors shrink-0"
        >
          <ChevronLeft size={16} />
          <span className="max-w-[160px] truncate">{featureName}</span>
        </button>

        <div className="w-px h-5 bg-white/10 shrink-0" />

        {/* Environment selector */}
        <div className="relative">
          <button
            disabled={isRunActive}
            onClick={() => setEnvOpen(v => !v)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors border',
              isRunActive
                ? 'opacity-50 cursor-not-allowed border-white/5 text-gray-500'
                : 'border-white/10 text-gray-300 hover:bg-white/5',
            )}
          >
            {selectedEnv?.name ?? 'No environments'}
            <ChevronDown size={11} />
          </button>
          {envOpen && !isRunActive && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setEnvOpen(false)} />
              <div
                className="absolute left-0 top-full mt-1 w-48 rounded-lg overflow-hidden py-1 z-20"
                style={{
                  background: 'rgba(18,18,32,0.98)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.60)',
                }}
              >
                {environmentsList.map(env => (
                  <button
                    key={env.id}
                    onClick={() => {
                      setSelectedEnvId(env.id);
                      try { localStorage.setItem(lastEnvKeyFor(projectId), env.id); } catch { /* ignore */ }
                      setEnvOpen(false);
                    }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-xs transition-colors',
                      env.id === selectedEnvId ? 'text-sky-300 bg-sky-500/10' : 'text-gray-300 hover:bg-white/5',
                    )}
                  >
                    {env.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Mode toggle */}
        <div
          className="flex rounded-lg overflow-hidden border text-xs shrink-0"
          style={{
            borderColor: effectiveMode === 'AUTOMATED' ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.10)',
            boxShadow: effectiveMode === 'AUTOMATED' ? '0 0 24px rgba(var(--accent-rgb),0.18)' : undefined,
          }}
        >
          {(['MANUAL', 'AUTOMATED'] as RunMode[]).map(m => (
            <button
              key={m}
              onClick={() => handleModeButton(m)}
              title={
                isRunActive && effectiveMode !== m
                  ? `Switch to ${m === 'MANUAL' ? 'Manual' : 'Automated'} (will stop the current run)`
                  : undefined
              }
              className={cn(
                'px-3 py-1.5 transition-colors font-medium',
                effectiveMode === m
                  ? m === 'AUTOMATED'
                    ? 'bg-violet-500/30 text-violet-200'
                    : 'bg-sky-500/20 text-sky-300'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5',
              )}
            >
              {m === 'MANUAL' ? '👤 Manual' : '⚡ Automated'}
            </button>
          ))}
        </div>

        {/* Run controls */}
        <div className="flex items-center gap-2">
          {!activeRun ? (
            <button
              onClick={() => startRun.mutate(undefined)}
              disabled={startRun.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 transition-colors border border-emerald-500/30 disabled:opacity-50"
            >
              <Play size={12} />
              {mode === 'MANUAL' ? 'Start Manual Session' : 'Start All'}
            </button>
          ) : activeRun.status === 'RUNNING' ? (
            <>
              <button
                onClick={() => pauseRun.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-300 hover:bg-white/10 transition-colors border border-white/10"
              >
                <Pause size={12} /> Pause
              </button>
              {effectiveMode === 'AUTOMATED' && (
                <button
                  onClick={() => skipCurrent.mutate()}
                  disabled={!runningTestRun || skipCurrent.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors border border-amber-500/25 disabled:opacity-40"
                  title={runningTestRun ? 'Cancel the current test and continue with the next queued test' : 'No test is currently running'}
                >
                  <SkipForward size={12} /> Skip Test
                </button>
              )}
              <button
                onClick={() => stopRun.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
              >
                <Square size={12} /> Stop
              </button>
            </>
          ) : activeRun.status === 'PAUSED' ? (
            <>
              <button
                onClick={() => resumeRun.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 transition-colors border border-sky-500/30"
              >
                <Play size={12} /> Resume
              </button>
              <button
                onClick={() => stopRun.mutate()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors border border-red-500/20"
              >
                <Square size={12} /> Stop
              </button>
            </>
          ) : (
            <button
              onClick={() => startRun.mutate(undefined)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-white/5 text-gray-300 hover:bg-white/10 transition-colors border border-white/10"
            >
              <RotateCcw size={12} /> Re-run
            </button>
          )}
        </div>

        {/* Status indicator */}
        <div className="flex-1 text-center text-xs text-gray-400">{statusText()}</div>

        {/* Close */}
        <button
          onClick={goBack}
          className="p-2 rounded-lg text-gray-500 hover:text-gray-200 hover:bg-white/5 transition-colors shrink-0"
          title="Close testing view"
        >
          <X size={16} />
        </button>
      </div>

      {effectiveMode === 'AUTOMATED' && (
        <div
          className="h-11 shrink-0 flex items-center justify-between px-4 border-b"
          style={{
            background: 'linear-gradient(90deg, rgba(var(--accent-rgb),0.22), rgba(14,165,233,0.10), rgba(8,8,16,0.85))',
            borderColor: 'rgba(var(--accent-rgb),0.24)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-violet-500/25 border border-violet-400/30">
              <Zap size={14} className="text-violet-200" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-white">
                Automated Playwright run {activeRun ? 'is active' : 'ready'}
              </p>
              <p className="text-[11px] text-violet-100 truncate">
                {runningTestRun
                  ? `Running test ${runningTestIndex + 1} of ${activeRun?.testRuns.length}: ${runningTestRun.testDefinition.name}`
                  : activeRun
                    ? `Passed ${passedCount} · Failed ${failedCount} · Skipped ${skippedCount}`
                    : 'Select an environment and click Start All to launch the browser stream.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-medium shrink-0">
            <span className="text-emerald-300">Passed {passedCount}</span>
            <span className="text-red-300">Failed {failedCount}</span>
            <span className="text-amber-300">Skipped {skippedCount}</span>
          </div>
        </div>
      )}

      {/* ── Body ────────────────────────────────────────────────────────────
         Layout responds to sidebar/fullscreen state:
           - Sidebar visible: test-case list (left) + content pane (right)
           - Sidebar collapsed: content pane fills viewport, floating bar
             at bottom replaces the list affordances (collapse toggle,
             current-test info, Pass/Fail/Skip/Bug actions, Context).
           - Fullscreen iframe: pane goes edge-to-edge, sidebar still
             toggleable from the floating bar.
       */}
      {/* Mobile pane toggle (Tests ⇄ Preview) — desktop shows both side-by-side. */}
      {isMobile && (
        <div className="flex items-center gap-1 p-1.5 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {([['list', 'Tests'], ['preview', 'Preview']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setMobilePane(key)}
              className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
              style={
                mobilePane === key
                  ? { background: 'rgba(var(--accent-rgb),0.30)', color: '#fff' }
                  : { background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.55)' }
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left panel — hidden when sidebar collapsed (desktop) or when the
            mobile toggle is on Preview. Full-width on mobile. */}
        {(isMobile ? mobilePane === 'list' : !sidebarCollapsed) && (
          <>
            <div
              className={isMobile ? 'w-full overflow-hidden' : 'flex-shrink-0 overflow-hidden'}
              style={
                isMobile
                  ? ({ width: '100%' } as React.CSSProperties)
                  : ({
                      width: leftWidth,
                      minWidth: MIN_LEFT,
                      maxWidth: MAX_LEFT,
                      borderRight: '1px solid rgba(255,255,255,0.06)',
                    } as React.CSSProperties)
              }
            >
              <LeftPanel
                featureId={featureId!}
                projectId={projectId!}
                selectedTestId={selectedTestId}
                onSelectTest={(id) => { setSelectedTestId(id); if (isMobile) setMobilePane('preview'); }}
                activeRun={activeRun}
                mode={effectiveMode}
                iframeRef={previewIframeRef}
                onMarkTestRun={(testRunId, status) => {
                  // A FAILED mark always routes through the reason modal —
                  // PASSED / SKIPPED mark immediately.
                  if (status === 'FAILED') {
                    const tr = activeRun?.testRuns.find(r => r.id === testRunId);
                    setFailureModal({ testRunId, testName: tr?.testDefinition?.name ?? 'this test' });
                  } else {
                    markTestRun.mutate({ testRunId, status });
                  }
                }}
                onLogBug={(testRunId) => setIssueModalTestRunId(testRunId)}
                markingTestRun={markTestRun.isPending}
                highlightStepId={highlightStepId}
                issueStatsByTestId={issueStatsByTestId}
                onOpenLinkedIssues={openLinkedIssuesPeek}
                compactActions={leftWidth < COMPACT_VERDICT_BAR_PX}
              />
            </div>

            {/* Drag handle — desktop only (mobile shows one pane at a time).
                Wider hit area (12px) with a visible 2px line in the middle.
                Centered grip dots show on hover so the affordance is
                unambiguous. Double-click resets to default. Pointer events +
                setPointerCapture so the iframe in the right pane can't swallow
                mouseup and strand the drag. */}
            <div
              hidden={isMobile}
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              onDoubleClick={handleDragReset}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar — drag, or double-click to reset"
              title="Drag to resize · double-click to reset"
              className="relative w-3 cursor-col-resize shrink-0 group"
              style={{ touchAction: 'none' }}
            >
              {/* Center line — fattens + brightens on hover/drag */}
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all"
                style={{
                  width: isDragging ? 3 : 1,
                  background: isDragging ? 'rgba(56,189,248,0.85)' : 'rgba(255,255,255,0.10)',
                }}
              />
              {/* Hover hint expands the line subtly without the drag-state colour */}
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all opacity-0 group-hover:opacity-100 pointer-events-none"
                style={{ width: 2, background: 'rgba(56,189,248,0.45)' }}
              />
              {/* Grip dots — always faintly visible, brighten on hover/drag */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div
                  className="flex flex-col gap-[3px] transition-opacity"
                  style={{ opacity: isDragging ? 1 : 0.30 }}
                >
                  <div className="w-[3px] h-[3px] rounded-full" style={{ background: isDragging ? '#7dd3fc' : 'rgba(255,255,255,0.55)' }} />
                  <div className="w-[3px] h-[3px] rounded-full" style={{ background: isDragging ? '#7dd3fc' : 'rgba(255,255,255,0.55)' }} />
                  <div className="w-[3px] h-[3px] rounded-full" style={{ background: isDragging ? '#7dd3fc' : 'rgba(255,255,255,0.55)' }} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* Sidebar collapse toggle — shows in the gutter when sidebar is
            visible, plus on the floating bar when collapsed. Desktop only —
            mobile uses the Tests/Preview toggle instead. */}
        {!isMobile && !sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="Hide sidebar"
            className="absolute z-20 flex items-center justify-center w-6 h-12 rounded-r-md transition-colors"
            style={{
              left: leftWidth,
              top: 12,
              background: 'rgba(var(--accent-rgb),0.18)',
              border: '1px solid rgba(var(--accent-rgb),0.35)',
              borderLeft: 'none',
              color: 'var(--accent-300)',
            }}
          >
            <PanelLeftClose size={12} />
          </button>
        )}

        {/* Right pane — on mobile shown only on the Preview tab. We toggle with
            `hidden` (display:none) rather than unmounting so the iframe / live
            run keeps its state when switching back to the Tests list. */}
        <div className={`flex-1 overflow-hidden relative flex flex-col${isMobile && mobilePane !== 'preview' ? ' hidden' : ''}`}>
          {/* Issue deep-link banner */}
          {deepLinkIssueId && deepLinkIssue && (
            <div
              className="flex items-center gap-2 px-4 py-2 text-xs shrink-0"
              style={{ background: 'rgba(var(--accent-rgb),0.08)', borderBottom: '1px solid rgba(var(--accent-rgb),0.25)' }}
            >
              <span>🐛</span>
              <span
                className="font-semibold px-1.5 py-0.5 rounded text-[10px] uppercase"
                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
              >
                {(deepLinkIssue as Record<string, string>).type ?? 'BUG'}
              </span>
              <span className="truncate" style={{ color: 'rgba(238,238,248,0.85)' }}>
                {(deepLinkIssue as Record<string, string>).title}
              </span>
              <Link
                to={`/issues/${deepLinkIssueId}`}
                className="ml-auto shrink-0 text-purple-400 hover:text-purple-300 font-medium"
              >
                Open issue ↗
              </Link>
              <button
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete('issue');
                  next.delete('highlightStep');
                  setSearchParams(next, { replace: true });
                }}
                className="shrink-0 text-gray-500 hover:text-gray-300"
                title="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {effectiveMode === 'MANUAL' ? (
            selectedEnv ? (
              <ManualWorkPane
                baseUrl={selectedEnv.baseUrl}
                test={selectedTest}
                activeRun={activeRun}
                fullscreen={iframeFullscreen}
                onToggleFullscreen={() => setIframeFullscreen(v => !v)}
                iframeRef={previewIframeRef}
                linkedIssueSummary={
                  selectedIssueStats && selectedIssueStats.total > 0 ? selectedIssueStats : null
                }
                onReviewLinkedIssues={
                  selectedTest
                    ? () => openLinkedIssuesPeek(selectedTest.id, selectedTest.name)
                    : undefined
                }
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Monitor size={40} className="text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">No environment configured</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Add an environment in project settings
                  </p>
                </div>
              </div>
            )
          ) : (
            /* Automated — live Playwright screencast via CDP → Redis → Socket.io */
            <LiveBrowserCanvas
              testRunId={
                immediateTestRunId ??
                runningTestRun?.id ??
                null
              }
            />
          )}
        </div>

        {/* ── Floating action bar (visible when sidebar collapsed) ──
            Mirrors the affordances normally on the sidebar: collapse toggle,
            current-test info, and (for MANUAL) the Pass/Fail/Skip/Bug actions.
            Sits above the iframe so it's always reachable in fullscreen.

            Now rendered regardless of sidebar state — earlier it only showed
            when the sidebar was collapsed, but users wanted constant access
            to the verdict + capture controls without having to hide the
            test list first. The toggle button flips its icon based on
            sidebar state so it can both open and close it.

            Can be collapsed to a tiny pill in the bottom-right corner via
            the chevron-right button at the bar's end.

            On mobile it only renders on the Preview tab — over the Tests list
            it would float on top of the per-test verdict controls. */}
        {(!isMobile || mobilePane === 'preview') && (!floatingBarCollapsed ? (
          isMobile ? (
            /* ── Compact mobile action bar ──
               Primary verdict actions stay inline (icon-only); the capture /
               issue / context actions fold into a single burger that slides
               up so the bar fits a phone. */
            <div
              className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-2 py-1.5 rounded-2xl shadow-2xl max-w-[calc(100vw-1.25rem)]"
              style={{
                background: 'rgba(14,14,22,0.96)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(var(--accent-rgb),0.38)',
              }}
            >
              {effectiveMode === 'MANUAL' && (() => {
                const sel = activeRun?.testRuns.find(tr => tr.testDefinition.id === selectedTestId) ?? null;
                const disabled = !sel || markTestRun.isPending;
                return (
                  <>
                    <button
                      onClick={() => sel && setFailureModal({ testRunId: sel.id, testName: sel.testDefinition?.name ?? 'this test' })}
                      disabled={disabled}
                      title="Fail"
                      className="flex items-center justify-center w-9 h-9 rounded-lg transition-all disabled:opacity-40"
                      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.40)', color: '#f87171' }}
                    >
                      <XCircle size={16} />
                    </button>
                    <button
                      onClick={() => sel && markTestRun.mutate({ testRunId: sel.id, status: 'SKIPPED' })}
                      disabled={disabled}
                      title="Skip"
                      className="flex items-center justify-center w-9 h-9 rounded-lg transition-all disabled:opacity-40"
                      style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.40)', color: '#fbbf24' }}
                    >
                      <SkipForward size={16} />
                    </button>
                    <button
                      onClick={() => sel && markTestRun.mutate({ testRunId: sel.id, status: 'PASSED' })}
                      disabled={disabled}
                      title="Pass"
                      className="flex items-center justify-center w-9 h-9 rounded-lg transition-all disabled:opacity-40"
                      style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.40)', color: '#34d399' }}
                    >
                      <CheckCircle size={16} />
                    </button>
                    <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.12)' }} />
                  </>
                );
              })()}

              {/* Burger — slides up the secondary actions */}
              <div className="relative">
                <button
                  onClick={() => setMobileActionsOpen(o => !o)}
                  title="More actions"
                  className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
                  style={{
                    background: mobileActionsOpen ? 'rgba(var(--accent-rgb),0.22)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${mobileActionsOpen ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.10)'}`,
                    color: mobileActionsOpen ? 'var(--accent-300)' : 'rgba(238,238,248,0.70)',
                  }}
                >
                  <MoreHorizontal size={17} />
                </button>
                {mobileActionsOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMobileActionsOpen(false)} />
                    <div
                      className="absolute bottom-full right-0 mb-2 z-40 flex flex-col gap-0.5 p-1.5 rounded-xl shadow-2xl min-w-[190px]"
                      style={{ background: 'rgba(18,18,30,0.98)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}
                    >
                      <button
                        onClick={() => { captureFloatingIframe(); setMobileActionsOpen(false); }}
                        disabled={floatingCapturing}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors disabled:opacity-40"
                        style={{ color: 'rgba(238,238,248,0.85)' }}
                      >
                        {floatingCapturing ? <Loader size={14} className="animate-spin" /> : <Camera size={14} />} Screenshot
                      </button>
                      <button
                        onClick={() => { floatingRecording.isRecording ? floatingRecording.stop() : (recMicEnabled ? floatingRecording.startWithMic() : floatingRecording.start()); setMobileActionsOpen(false); }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors"
                        style={{ color: floatingRecording.isRecording ? '#f87171' : 'rgba(238,238,248,0.85)' }}
                      >
                        {floatingRecording.isRecording
                          ? <><span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse" /> Stop recording ({formatRecordingDuration(floatingRecording.elapsedMs)})</>
                          : <><Video size={14} /> Record screen</>}
                      </button>
                      {!floatingRecording.isRecording && (
                        <button
                          onClick={() => { const next = !recMicEnabled; setRecMicEnabled(next); setManualRecMicEnabled(next); }}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors"
                          style={{ color: recMicEnabled ? 'var(--accent-300)' : 'rgba(238,238,248,0.85)' }}
                        >
                          {recMicEnabled ? <Mic size={14} /> : <MicOff size={14} />} {recMicEnabled ? 'Mic on — voice-over' : 'Enable mic'}
                        </button>
                      )}
                      {effectiveMode === 'MANUAL' && (() => {
                        const sel = activeRun?.testRuns.find(tr => tr.testDefinition.id === selectedTestId) ?? null;
                        return (
                          <button
                            onClick={() => { if (sel) setIssueModalTestRunId(sel.id); setMobileActionsOpen(false); }}
                            disabled={!sel}
                            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors disabled:opacity-40"
                            style={{ color: 'var(--accent-300)' }}
                          >
                            <Bug size={14} /> Log issue
                          </button>
                        );
                      })()}
                      <div className="h-px my-0.5" style={{ background: 'rgba(255,255,255,0.08)' }} />
                      <button
                        onClick={() => { setContextOpen(o => !o); setNotesOpen(false); setMobileActionsOpen(false); }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors"
                        style={{ color: 'rgba(238,238,248,0.85)' }}
                      >
                        <Info size={14} /> Feature context
                      </button>
                      <button
                        onClick={() => { setNotesOpen(o => !o); setContextOpen(false); setMobileActionsOpen(false); }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors"
                        style={{ color: 'rgba(238,238,248,0.85)' }}
                      >
                        <StickyNote size={14} /> My notes
                      </button>
                      {selectedIssueStats && selectedIssueStats.total > 0 && selectedTest && (
                        <button
                          onClick={() => { openLinkedIssuesPeek(selectedTest.id, selectedTest.name); setMobileActionsOpen(false); }}
                          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs text-left transition-colors"
                          style={{ color: '#fbbf24' }}
                        >
                          <FileText size={14} /> Issues ({selectedIssueStats.total})
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Collapse to pill */}
              <button
                onClick={() => setFloatingBarCollapsed(true)}
                title="Hide action bar"
                className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
                style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          ) : (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-2 rounded-2xl shadow-2xl"
            style={{
              background: 'rgba(14,14,22,0.96)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(var(--accent-rgb),0.38)',
            }}
          >
            <button
              onClick={toggleSidebar}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ color: 'var(--accent-300)', background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.40)' }}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            </button>

            {selectedTest && (
              <div
                className="flex items-center gap-2 px-3 py-1 rounded-lg"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
              >
                <span className="text-[11px] font-medium max-w-[260px] truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                  {selectedTest.name}
                </span>
                {selectedIssueStats && selectedIssueStats.total > 0 && (
                  <button
                    type="button"
                    onClick={() => openLinkedIssuesPeek(selectedTest.id, selectedTest.name)}
                    title="Review linked issues"
                    className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: selectedIssueStats.open > 0 ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb),0.12)',
                      color: selectedIssueStats.open > 0 ? '#fca5a5' : 'var(--accent-300)',
                    }}
                  >
                    <Bug size={10} strokeWidth={2.5} /> {selectedIssueStats.total}
                  </button>
                )}
              </div>
            )}

            <button
              onClick={() => { setContextOpen(o => !o); setNotesOpen(false); }}
              title="Feature context"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: contextOpen ? 'rgba(var(--accent-rgb),0.22)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${contextOpen ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.10)'}`,
                color: contextOpen ? 'var(--accent-300)' : 'rgba(238,238,248,0.70)',
              }}
            >
              <Info size={12} /> Context
            </button>

            <button
              onClick={() => { setNotesOpen(o => !o); setContextOpen(false); }}
              title="My notes"
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-colors"
              style={{
                background: notesOpen ? 'rgba(251,191,36,0.18)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${notesOpen ? 'rgba(251,191,36,0.45)' : 'rgba(255,255,255,0.10)'}`,
                color: notesOpen ? '#fbbf24' : 'rgba(238,238,248,0.70)',
              }}
            >
              <StickyNote size={12} /> Notes
            </button>

            {effectiveMode === 'MANUAL' && (() => {
              const sel = activeRun?.testRuns.find(tr => tr.testDefinition.id === selectedTestId) ?? null;
              const disabled = !sel || markTestRun.isPending;
              return (
                <>
                  <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.12)' }} />
                  <button
                    onClick={() => sel && setFailureModal({
                      testRunId: sel.id,
                      testName: sel.testDefinition?.name ?? 'this test',
                    })}
                    disabled={disabled}
                    title="Mark this test Failed"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.40)', color: '#f87171' }}
                  >
                    <XCircle size={12} /> Fail
                  </button>
                  <button
                    onClick={() => sel && markTestRun.mutate({ testRunId: sel.id, status: 'SKIPPED' })}
                    disabled={disabled}
                    title="Skip this test"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.40)', color: '#fbbf24' }}
                  >
                    <SkipForward size={12} /> Skip
                  </button>
                  <button
                    onClick={() => sel && markTestRun.mutate({ testRunId: sel.id, status: 'PASSED' })}
                    disabled={disabled}
                    title="Mark this test Passed"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.40)', color: '#34d399' }}
                  >
                    <CheckCircle size={12} /> Pass
                  </button>
                  <button
                    onClick={() => sel && setIssueModalTestRunId(sel.id)}
                    disabled={!sel}
                    title="File an issue against this test"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40"
                    style={{ background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.40)', color: 'var(--accent-300)' }}
                  >
                    <Bug size={12} /> Bug
                  </button>
                  {selectedIssueStats && selectedIssueStats.total > 0 && selectedTest && (
                    <button
                      type="button"
                      onClick={() => openLinkedIssuesPeek(selectedTest.id, selectedTest.name)}
                      title="Review linked issues — change status or add comments"
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                      style={{
                        background: selectedIssueStats.open > 0 ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
                        border: `1px solid ${selectedIssueStats.open > 0 ? 'rgba(239,68,68,0.40)' : 'rgba(245,158,11,0.35)'}`,
                        color: selectedIssueStats.open > 0 ? '#fca5a5' : '#fbbf24',
                      }}
                    >
                      <FileText size={12} /> Issues ({selectedIssueStats.total})
                    </button>
                  )}

                  <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.12)' }} />

                  {/* Screenshot capture */}
                  <button
                    onClick={captureFloatingIframe}
                    disabled={floatingCapturing}
                    title="Capture screenshot of preview"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px dashed rgba(255,255,255,0.18)', color: 'rgba(238,238,248,0.65)' }}
                  >
                    {floatingCapturing ? <Loader size={12} className="animate-spin" /> : <Camera size={12} />}
                  </button>

                  {/* Screen recording */}
                  <button
                    onClick={floatingRecording.isRecording ? floatingRecording.stop : (recMicEnabled ? floatingRecording.startWithMic : floatingRecording.start)}
                    title={floatingRecording.isRecording ? 'Stop recording' : (recMicEnabled ? 'Record screen + microphone' : 'Record screen')}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                    style={{
                      background: floatingRecording.isRecording ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.05)',
                      border: floatingRecording.isRecording ? '1px solid rgba(239,68,68,0.45)' : '1px dashed rgba(255,255,255,0.18)',
                      color: floatingRecording.isRecording ? '#f87171' : 'rgba(238,238,248,0.65)',
                    }}
                  >
                    {floatingRecording.isRecording ? (
                      <><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> {formatRecordingDuration(floatingRecording.elapsedMs)}</>
                    ) : (
                      <Video size={12} />
                    )}
                  </button>
                  {!floatingRecording.isRecording && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !recMicEnabled;
                        setRecMicEnabled(next);
                        setManualRecMicEnabled(next);
                      }}
                      title={recMicEnabled ? 'Microphone on — click to record voice-over with screen' : 'Enable microphone for voice-over'}
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-xs transition-all"
                      style={{
                        background: recMicEnabled ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.05)',
                        border: recMicEnabled ? '1px solid rgba(var(--accent-rgb),0.40)' : '1px dashed rgba(255,255,255,0.18)',
                        color: recMicEnabled ? 'var(--accent-300)' : 'rgba(238,238,248,0.5)',
                      }}
                    >
                      {recMicEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                    </button>
                  )}
                </>
              );
            })()}

            {/* Collapse to pill */}
            <div className="w-px h-5" style={{ background: 'rgba(255,255,255,0.12)' }} />
            <button
              onClick={() => setFloatingBarCollapsed(true)}
              title="Hide action bar"
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
              style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)' }}
            >
              <ChevronRight size={13} />
            </button>
          </div>
          )
        ) : (
          <button
            onClick={() => setFloatingBarCollapsed(false)}
            title="Show action bar"
            className="absolute bottom-4 right-4 z-30 flex items-center justify-center w-9 h-9 rounded-full shadow-2xl transition-colors"
            style={{
              background: 'rgba(14,14,22,0.96)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(var(--accent-rgb),0.45)',
              color: 'var(--accent-300)',
            }}
          >
            <ChevronLeft size={15} />
          </button>
        ))}

        {/* The old right-side persistent capture bar was removed — the
            center floating bar above now renders regardless of sidebar
            state and carries Capture / Record / Mic alongside the verdict
            controls, so the right-side bar became a duplicate. */}

        {/* ── Slide-in context panel (feature description + AC) ── */}
        {contextOpen && (
          <div
            className="absolute right-0 top-0 h-full z-40 flex flex-col"
            style={{
              width: 360,
              background: 'rgba(14,14,22,0.97)',
              backdropFilter: 'blur(20px)',
              borderLeft: '1px solid rgba(var(--accent-rgb),0.30)',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2">
                <FileText size={14} style={{ color: 'var(--accent-400)' }} />
                <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Feature Context</span>
              </div>
              <button
                onClick={() => setContextOpen(false)}
                className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                style={{ color: 'rgba(238,238,248,0.50)', background: 'rgba(255,255,255,0.05)' }}
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Feature</p>
                <p className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.92)' }}>{featureName}</p>
              </div>
              {(feature as { description?: string | null } | undefined)?.description && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Description</p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(238,238,248,0.78)' }}>
                    {(feature as { description?: string }).description}
                  </p>
                </div>
              )}
              {(feature as { acceptanceCriteria?: string | null } | undefined)?.acceptanceCriteria && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Acceptance Criteria</p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: 'rgba(238,238,248,0.78)' }}>
                    {(feature as { acceptanceCriteria?: string }).acceptanceCriteria}
                  </p>
                </div>
              )}
              {selectedTest && (
                <div className="pt-3 mt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Selected Test</p>
                  <p className="text-sm font-medium mb-1" style={{ color: 'rgba(238,238,248,0.90)' }}>{selectedTest.name}</p>
                  {selectedTest.description && (
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.65)' }}>
                      {selectedTest.description}
                    </p>
                  )}
                </div>
              )}
              {(linkedDocsQ.data?.length ?? 0) > 0 && (
                <div className="pt-3 mt-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                  <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'rgba(238,238,248,0.45)' }}>Linked docs</p>
                  <div className="space-y-1.5">
                    {(linkedDocsQ.data ?? []).map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setDocViewerLink(d)}
                        className="w-full text-left px-2.5 py-2 rounded-md flex items-start gap-2 transition-colors"
                        style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.20)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.16)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(var(--accent-rgb),0.08)')}
                      >
                        <FileText size={12} style={{ color: 'var(--accent-400)', marginTop: 2, flexShrink: 0 }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>{d.title}</p>
                          <p className="text-[10px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
                            {d.install.pluginId === 'clickup' ? 'ClickUp' : d.install.pluginId} · click to open
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* ── Slide-in notes panel (personal project notes) ── */}
        {notesOpen && projectId && (
          <NotesPanel projectId={projectId} onClose={() => setNotesOpen(false)} />
        )}

        {docViewerLink && (
          <DocViewerModal
            open={!!docViewerLink}
            onClose={() => setDocViewerLink(null)}
            docKind="linked"
            docId={docViewerLink.id}
            link={docViewerLink}
          />
        )}
      </div>

      {/* ── Mode-switch modal ──────────────────────────────────────────────
         Three phases:
           confirm    — explain consequences, ask user to confirm
           aborting   — fired stop/abandon; waiting for the worker's
                        run:abortCompleted socket event before unlocking
           configure  — (auto target only) pick env + Start All / From Here
      */}
      {switchModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget && switchModal.phase !== 'aborting') cancelSwitch();
          }}
        >
          <div
            className="rounded-xl p-6 max-w-md w-full mx-4"
            style={{
              background: 'rgb(18,18,32)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            {switchModal.phase === 'confirm' && (
              <>
                <h3 className="text-base font-semibold text-gray-100 mb-2">
                  {switchModal.target === 'MANUAL'
                    ? 'Stop automated run and switch to manual?'
                    : 'End manual session and switch to automated?'}
                </h3>
                <p className="text-xs text-gray-400 mb-4">
                  {switchModal.target === 'MANUAL'
                    ? 'The current automated run will be cancelled and the browser closed. Manual mode will unlock once the worker confirms cleanup.'
                    : 'Your manual session will be ended. You\'ll then pick an environment and decide whether to run all tests or start from the current one.'}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={cancelSwitch}
                    className="px-3 py-1.5 rounded-lg text-xs text-gray-300 hover:bg-white/5 border border-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { confirmSwitch().catch(() => {}); }}
                    className="px-3 py-1.5 rounded-lg text-xs bg-red-500/20 text-red-200 hover:bg-red-500/30 border border-red-500/30"
                  >
                    {switchModal.target === 'MANUAL' ? 'Stop & Switch' : 'End & Switch'}
                  </button>
                </div>
              </>
            )}

            {switchModal.phase === 'aborting' && (
              <>
                <h3 className="text-base font-semibold text-gray-100 mb-2 flex items-center gap-2">
                  <Loader size={14} className="animate-spin text-sky-400" />
                  Stopping run…
                </h3>
                <p className="text-xs text-gray-400">
                  Waiting for the worker to close the browser. The other mode
                  will unlock as soon as cleanup is fully confirmed.
                </p>
              </>
            )}

            {switchModal.phase === 'configure' && (
              <>
                <h3 className="text-base font-semibold text-gray-100 mb-3">
                  Configure automated run
                </h3>
                <div className="text-xs text-gray-400 mb-2">Environment</div>
                <div className="rounded-lg border border-white/10 mb-4">
                  {environmentsList.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-gray-500">No environments configured</div>
                  ) : (
                    environmentsList.map(env => (
                      <button
                        key={env.id}
                        onClick={() => {
                          setSelectedEnvId(env.id);
                          try { localStorage.setItem(lastEnvKeyFor(projectId), env.id); } catch { /* ignore */ }
                        }}
                        className={cn(
                          'w-full text-left px-3 py-2 text-xs transition-colors',
                          env.id === selectedEnvId ? 'text-sky-300 bg-sky-500/10' : 'text-gray-300 hover:bg-white/5',
                        )}
                      >
                        {env.name}
                      </button>
                    ))
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => launchAutoFromConfig({ startFromCurrent: false })}
                    disabled={!selectedEnvId && environmentsList.length === 0}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 border border-emerald-500/30 disabled:opacity-50"
                  >
                    Start All Tests
                  </button>
                  <button
                    onClick={() => launchAutoFromConfig({ startFromCurrent: true })}
                    disabled={!selectedTestId || (!selectedEnvId && environmentsList.length === 0)}
                    title={!selectedTestId ? 'Select a test in the left panel first' : undefined}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 border border-violet-500/30 disabled:opacity-40"
                  >
                    Start From Current Test
                  </button>
                  <button
                    onClick={cancelSwitch}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-white/5 border border-white/10"
                  >
                    Cancel
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-3">
                  {selectedTestId
                    ? 'Current test: tests before it will be skipped if you choose "Start From Current Test".'
                    : 'No test selected — only "Start All Tests" is available.'}
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Active-session conflict recovery — fires when startRun returns
          409 ACTIVE_SESSION_CONFLICT. Same three exits as FeaturePage's
          modal: Cancel, Resume existing, or "End all my sessions" + retry
          with allowConcurrent. The "End all my sessions" path calls the
          new /me/active-feature-runs/end-all endpoint to wipe stragglers
          from earlier races, then retries the start. */}
      {conflictModal && (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          onClick={() => setConflictModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(18,18,32,0.98)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 24px 64px rgba(0,0,0,0.60)',
            }}
          >
            <div className="px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              <h2 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                You already have an active session
              </h2>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div
                className="rounded-lg p-3 text-xs"
                style={{
                  background: 'rgba(251,191,36,0.10)',
                  border: '1px solid rgba(251,191,36,0.30)',
                  color: '#fbbf24',
                }}
              >
                Only one manual session can run at a time. If this isn't the
                session you remember stopping, you may have stragglers from
                an earlier race — use <strong>End all my sessions</strong>
                to wipe them in one shot.
              </div>
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <p
                  className="text-[10px] uppercase tracking-wider mb-1"
                  style={{ color: 'rgba(238,238,248,0.45)' }}
                >
                  Existing session
                </p>
                <p
                  className="text-sm font-medium"
                  style={{ color: 'rgba(238,238,248,0.92)' }}
                >
                  {conflictModal.run.featureName}
                </p>
                {conflictModal.run.startedAt && (
                  <p
                    className="text-[11px] mt-0.5"
                    style={{ color: 'rgba(238,238,248,0.55)' }}
                  >
                    Started {new Date(conflictModal.run.startedAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConflictModal(null)}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    color: 'rgba(238,238,248,0.75)',
                    border: '1px solid rgba(255,255,255,0.10)',
                  }}
                >
                  Cancel
                </button>
                {!conflictModal.run.sameFeature && (
                  <button
                    type="button"
                    onClick={() => {
                      const run = conflictModal.run;
                      setConflictModal(null);
                      navigate(`/projects/${run.projectId}/modules/${run.moduleId}/features/${run.featureId}?testMode=1`);
                    }}
                    className="px-3 py-1.5 rounded-lg text-sm"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      color: 'rgba(238,238,248,0.85)',
                      border: '1px solid rgba(255,255,255,0.10)',
                    }}
                  >
                    Resume existing →
                  </button>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    const overrides = conflictModal.pendingOverrides;
                    setConflictModal(null);
                    try {
                      const r = await featureRunsApi.endAllMine();
                      toast.success(
                        'Cleared stragglers',
                        `Ended ${r.ended} stale session${r.ended === 1 ? '' : 's'}.`,
                      );
                    } catch {
                      /* end-all is best-effort — retry with allowConcurrent below
                         will pick up anything left over. */
                    }
                    qc.invalidateQueries({ queryKey: ['my-active-runs'] });
                    startRun.mutate({ ...(overrides ?? {}), allowConcurrent: true });
                  }}
                  className="px-3 py-1.5 rounded-lg text-sm"
                  style={{
                    background: 'rgba(239,68,68,0.12)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239,68,68,0.40)',
                  }}
                  disabled={startRun.isPending}
                >
                  End all my sessions & start new
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Capture preview modal ────────────────────────────────────────────
         Shown immediately after a screenshot or recording is captured.
         User can attach it to an issue or discard it. */}
      {floatingPreview && (() => {
        const isVideo = floatingPreview.mimeType.startsWith('video/');
        const sel = activeRun?.testRuns.find(tr => tr.testDefinition.id === selectedTestId) ?? null;
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
            onClick={() => {
              if (floatingPreview.objectUrl) URL.revokeObjectURL(floatingPreview.objectUrl);
              setFloatingPreview(null);
            }}
          >
            <div
              className="relative flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{
                background: 'rgba(14,14,22,0.98)',
                border: '1px solid rgba(var(--accent-rgb),0.35)',
                maxWidth: 560,
                width: '90vw',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <div className="flex items-center gap-2">
                  {isVideo
                    ? <Video size={14} style={{ color: 'var(--accent-400)' }} />
                    : <Camera size={14} style={{ color: 'var(--accent-400)' }} />
                  }
                  <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                    {floatingPreview.filename}
                  </span>
                </div>
                <button
                  onClick={() => {
                    // Revoke the blob URL — same as the backdrop / Discard
                    // paths. Without this, closing via X leaks the Blob.
                    if (floatingPreview.objectUrl) URL.revokeObjectURL(floatingPreview.objectUrl);
                    setFloatingPreview(null);
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: 'rgba(238,238,248,0.50)' }}
                >
                  <X size={14} />
                </button>
              </div>

              {/* Preview */}
              <div className="flex items-center justify-center p-4 bg-black/30" style={{ minHeight: 240 }}>
                {isVideo ? (
                  <video
                    src={floatingPreview.objectUrl ?? floatingPreview.url}
                    controls
                    className="rounded-lg max-h-64 max-w-full"
                    style={{ background: '#000' }}
                  />
                ) : (
                  <img
                    src={floatingPreview.objectUrl ?? floatingPreview.url}
                    alt="Captured screenshot"
                    className="rounded-lg max-h-64 max-w-full object-contain"
                    style={{ boxShadow: '0 0 0 1px rgba(255,255,255,0.08)' }}
                  />
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <button
                  onClick={() => {
                    if (floatingPreview.objectUrl) URL.revokeObjectURL(floatingPreview.objectUrl);
                    setFloatingPreview(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.55)' }}
                >
                  Discard
                </button>
                {!isVideo && (
                  <button
                    onClick={() => setAnnotating(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.18)', color: 'rgba(238,238,248,0.82)' }}
                  >
                    ✏️ Annotate
                  </button>
                )}
                <button
                  onClick={() => {
                    setIssueModalEvidence(floatingPreview);
                    setFloatingPreview(null);
                    if (sel) setIssueModalTestRunId(sel.id);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.50)', color: 'var(--accent-300)' }}
                >
                  <Bug size={12} /> Attach to Issue
                </button>
              </div>

              {annotating && (
                <ScreenshotAnnotator
                  imageUrl={floatingPreview.objectUrl ?? floatingPreview.url}
                  onCancel={() => setAnnotating(false)}
                  onSave={async (blob) => {
                    setAnnotating(false);
                    try {
                      // Re-upload the annotated blob and replace the preview
                      // entry so "Attach to Issue" picks up the new version.
                      // Revoke the previous objectUrl so the original blob
                      // is GC'd — only the annotated one is kept.
                      const prevObj = floatingPreview.objectUrl;
                      const file = new File([blob], `annotated-${Date.now()}.webp`, { type: blob.type || 'image/webp' });
                      const r = await uploadsApi.upload(file);
                      const objectUrl = URL.createObjectURL(blob);
                      setFloatingPreview({
                        url: r.url,
                        mimeType: file.type,
                        filename: `Screenshot ${new Date().toLocaleTimeString()} (annotated)`,
                        objectUrl,
                      });
                      if (prevObj) URL.revokeObjectURL(prevObj);
                    } catch {
                      toast.error('Annotation upload failed', 'The annotated image could not be uploaded. Try again.');
                    }
                  }}
                />
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Issue logging modal ─────────────────────────────────────────────
         Opened by the floating-bar Bug button or from the capture preview.
         Pre-populated with any evidence captured in the floating bar. */}
      {issueModalTestRunId && (() => {
        const sel = activeRun?.testRuns.find(tr => tr.id === issueModalTestRunId) ?? null;
        const preEvidence = issueModalEvidence
          ? [{
              token: '',
              url: issueModalEvidence.url,
              filename: issueModalEvidence.filename,
              mimeType: issueModalEvidence.mimeType,
              notes: '',
              objectUrl: issueModalEvidence.objectUrl,
            }]
          : undefined;
        return (
          <LogIssueModal
            open
            onClose={() => { setIssueModalTestRunId(null); setIssueModalEvidence(null); }}
            projectId={projectId!}
            featureId={featureId!}
            testDefinitionId={sel?.testDefinition?.id}
            testRunId={issueModalTestRunId}
            initialEvidence={preEvidence}
          />
        );
      })()}

      {/* Linked issues — list picker (or auto-open when exactly one) */}
      {linkedIssuesPeek && (
        <TestLinkedIssuesPeekModal
          open
          projectId={projectId!}
          testDefinitionId={linkedIssuesPeek.testId}
          testName={linkedIssuesPeek.testName}
          onClose={() => setLinkedIssuesPeek(null)}
          onOpenIssue={handlePickLinkedIssue}
        />
      )}
      <IssueDetailModal
        issueId={linkedIssueDetailId}
        onClose={() => setLinkedIssueDetailId(null)}
      />

      {/* Failure-reason capture — every FAILED mark routes through here so a
          structured reason (category + detail) is always recorded. */}
      <FailureReasonModal
        open={!!failureModal}
        testName={failureModal?.testName}
        onClose={() => setFailureModal(null)}
        submitting={markTestRun.isPending}
        onConfirm={(category, note) => {
          if (!failureModal) return;
          markTestRun.mutate(
            { testRunId: failureModal.testRunId, status: 'FAILED', failureCategory: category, failureNote: note },
            { onSuccess: () => setFailureModal(null) },
          );
        }}
      />

      {/* Feature-complete flow — opens when the last test in the feature is
          marked. Continue to next feature, jump to another, or (on the last
          feature) module sign-off rollup. */}
      {completion && featureId && projectId && (() => {
        const mod = (feature as { module?: { id: string; name: string } } | undefined)?.module;
        if (!mod) return null;
        return (
          <FeatureCompletionModal
            open={!!completion}
            onClose={() => setCompletion(null)}
            projectId={projectId}
            moduleId={mod.id}
            moduleName={mod.name}
            currentFeatureId={featureId}
            currentFeatureName={(feature as { name?: string } | undefined)?.name ?? 'This feature'}
            summary={completion}
            onContinue={(targetFeatureId) => continueToFeature.mutate(targetFeatureId)}
            continuing={continueToFeature.isPending}
          />
        );
      })()}
    </div>
  );
}
