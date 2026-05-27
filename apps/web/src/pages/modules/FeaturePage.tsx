import React, { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, History, AlertTriangle, CheckCircle, GitBranch,
  FlaskConical, Clock, XCircle, Pause, Square, Loader, Eye, EyeOff,
  Zap, User, ExternalLink, ChevronRight, ChevronLeft, RefreshCw, Paperclip,
  Timer, X, TrendingUp, BarChart2, ListChecks, Video,
  Maximize2, Minimize2, Info, FileText, PanelLeftClose, PanelLeftOpen,
  Download, AlertCircle, Bug, MessageSquare, Wrench, PlusCircle,
  Camera, Mic, MicOff, MinusCircle, ArrowUpDown, Upload, Sparkles, Trash2,
} from 'lucide-react';
import { GenerateTestsModal } from '@/components/ai/GenerateTestsModal';
import { useAiConfigured } from '@/hooks/useAiConfigured';
import { featuresApi, featureVersionsApi, featureRunsApi, testsApi, environmentsApi, runsApi, uploadsApi, issuesApi, statsApi } from '@/lib/api';
import type {
  VersionInfo, TestRunRef, FeatureRun, RunStep, Environment,
  IframeState, IssueType, IssueSeverity, IssueModalState, AttachedEvidence,
  ManualPlayerProps,
} from './FeaturePage/featurePage.types';
import {
  MAX_FILE_SIZE_MB, HEARTBEAT_INTERVAL_MS, INACTIVITY_WARNING_MS, LEFT_PANEL_KEY,
  stepInstruction,
} from './FeaturePage/featurePage.helpers';
import { setManualRecMicEnabled } from '@/lib/manualRecMic';
import { NoEnvWarningModal } from './FeaturePage/parts/NoEnvWarningModal';
import { PublishModal } from './FeaturePage/parts/PublishModal';
import { VersionHistoryModal } from './FeaturePage/parts/VersionHistoryModal';
import { FeatureSettingsPanel } from './FeaturePage/parts/FeatureSettingsPanel';
import { FeatureDocsButton } from '@/components/plugins/FeatureDocsButton';
import { ClickUpRoutingHint } from '@/components/plugins/ClickUpRoutingHint';
import { PushFeatureToClickUpButton } from '@/components/plugins/PushFeatureToClickUpButton';
import { OpenInClickUpButton } from '@/components/plugins/OpenInClickUpButton';
import { FeatureClickUpStatusControl } from '@/components/plugins/FeatureClickUpStatusControl';
import { TicketLinksPanel } from '@/components/plugins/TicketLinksPanel';
import { ScopedDocsPanel } from '@/components/plugins/ScopedDocsPanel';
import { RecentRunsPanel } from '@/components/testing/RecentRunsPanel';
import { useProjectRunSocket } from '@/hooks/useRunSocket';
import { toast } from '@/components/ui/Toast';
import { useScreenRecording, formatRecordingDuration } from '@/hooks/useScreenRecording';
import { toast as uiToast } from '@/components/ui/Toast';
import { ExportButton, ImportModal } from '@/components/ImportExport';
import { LatestReportCard } from '@/components/LatestReportCard';
import { IssueRowActionsMenu } from '@/components/issues/IssueRowActionsMenu';
import { ScopedIssuesPanel } from '@/components/issues/ScopedIssuesPanel';
import { WorkbenchTabs } from '@/components/WorkbenchTabs';
import { NavDropdown } from '@/components/NavDropdown';
import { ProgressDonut } from '@/components/ProgressDonut';
import { modulesApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { StepEditor, type Step } from '@/components/StepEditor';
import { useFeatureRunSocket } from '@/hooks/useFeatureRunSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { BulkActionBar } from '@/components/ui/BulkActionBar';
import { FailureReasonModal } from '@/components/testing/FailureReasonModal';
import { FailureReasonChip } from '@/components/testing/FailureReasonChip';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import { useActiveEnv } from '@/stores/activeEnvStore';

// ─── Evidence & Issues (feature sidebar list) ─────────────────────────────────

const EVIDENCE_ISSUES_PAGE_SIZE = 20;
type EvidenceIssuesSort = 'newest' | 'oldest' | 'severity_desc' | 'status_open_first';

type FeatureEvidenceIssueRow = {
  id: string;
  type: string;
  status: string;
  severity: string;
  title: string;
  description?: string | null;
  screenshotUrls?: string[];
  recordingUrl?: string | null;
  createdAt: string;
  testDefinitionId?: string | null;
  testRunId?: string | null;
  runStepId?: string | null;
  testDefinition?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
};

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const STATUS_ORDER: Record<string, number> = {
  OPEN: 0,
  IN_PROGRESS: 1,
  RESOLVED: 2,
  WONT_FIX: 3,
  CLOSED: 4,
};

function sortFeatureEvidenceIssues<T extends FeatureEvidenceIssueRow>(
  items: T[],
  sort: EvidenceIssuesSort,
): T[] {
  const copy = [...items];
  const byDateDesc = (a: T, b: T) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  const byDateAsc = (a: T, b: T) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  switch (sort) {
    case 'newest':
      copy.sort(byDateDesc);
      break;
    case 'oldest':
      copy.sort(byDateAsc);
      break;
    case 'severity_desc':
      copy.sort((a, b) => {
        const sa = SEVERITY_ORDER[a.severity] ?? 99;
        const sb = SEVERITY_ORDER[b.severity] ?? 99;
        if (sa !== sb) return sa - sb;
        return byDateDesc(a, b);
      });
      break;
    case 'status_open_first':
      copy.sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 99;
        const sb = STATUS_ORDER[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        return byDateDesc(a, b);
      });
      break;
    default:
      copy.sort(byDateDesc);
  }
  return copy;
}

function evidenceIssueRunHref(projectId: string, i: FeatureEvidenceIssueRow): string | null {
  if (i.testRunId) return `/runs/${i.testRunId}`;
  if (i.testDefinitionId) return `/projects/${projectId}/tests/${i.testDefinitionId}/edit`;
  return null;
}

function FeatureEvidenceIssuesScroll({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  children,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      if (!hasNextPage || isFetchingNextPage) return;
      const { scrollTop, clientHeight, scrollHeight } = el;
      if (scrollHeight - scrollTop - clientHeight < 120) fetchNextPage();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return (
    <div
      ref={ref}
      className="overflow-y-auto overflow-x-hidden min-h-0 space-y-2 pr-1 -mr-0.5"
      style={{
        maxHeight: 'min(70vh, 32rem)',
        scrollbarGutter: 'stable',
      }}
    >
      {children}
      {isFetchingNextPage && (
        <div
          className="flex justify-center items-center gap-2 py-3 text-xs"
          style={{ color: 'rgba(238,238,248,0.45)' }}
        >
          <Loader size={14} className="animate-spin shrink-0" />
          Loading more…
        </div>
      )}
    </div>
  );
}

// ─── Manual Player ────────────────────────────────────────────────────────────
// Types + helpers moved to ./FeaturePage/featurePage.{types,helpers}.ts
// Full component extraction still TODO — tracked in split plan step 11.

// ─── Test status badge ────────────────────────────────────────────────────────

function TestStatusBadge({ status }: { status: string | undefined }) {
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
        style={{ background: 'rgba(245,158,11,0.10)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.20)' }}>
        <Clock size={9} /> Not run
      </span>
    );
  }
  if (status === 'PASSED') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(52,211,153,0.12)', color: '#34d399', border: '1px solid rgba(52,211,153,0.25)' }}>
      <CheckCircle size={9} /> Passed
    </span>
  );
  if (status === 'FAILED') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
      <XCircle size={9} /> Failed
    </span>
  );
  if (status === 'SKIPPED') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
      style={{ background: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.20)' }}>
      <MinusCircle size={9} /> Skipped
    </span>
  );
  return (
    <span className="inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase"
      style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(238,238,248,0.40)' }}>
      {status}
    </span>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, iconBg, label, value, valueColor, sub,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string | number;
  valueColor: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: iconBg }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>{label}</p>
        <p className="text-xl font-bold tabular-nums leading-tight mt-0.5" style={{ color: valueColor }}>{value}</p>
        {sub && <p className="text-[10px] mt-0.5" style={{ color: 'rgba(238,238,248,0.35)' }}>{sub}</p>}
      </div>
    </div>
  );
}

function ManualPlayer({ featureRun, environments, onStop, onClose, projectId, featureId, feature }: ManualPlayerProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Ref to the *loaded* preview iframe (the one the tester is interacting
  // with). Used by the Capture button to grab a screenshot programmatically
  // without an OS file picker. Only works when the iframe content is same
  // origin as this app — cross-origin app previews fall back to the file
  // picker because the browser blocks DOM access.
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const [capturing, setCapturing] = useState(false);

  const [leftPanelOpen, setLeftPanelOpen] = useState<boolean>(
    () => localStorage.getItem(LEFT_PANEL_KEY) !== 'false',
  );
  // Resizable side-panel width. Default bumped to 400px (was 300) per
  // QA feedback that the step descriptions were getting truncated. Persisted
  // so each tester's preferred width sticks across sessions.
  const SIDE_PANEL_KEY = 'manual-player-panel-width';
  const SIDE_PANEL_DEFAULT = 400;
  const SIDE_PANEL_MIN = 280;
  const SIDE_PANEL_MAX = 640;
  const [sidePanelWidth, setSidePanelWidth] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem(SIDE_PANEL_KEY) ?? '', 10);
    if (!Number.isFinite(saved) || saved <= 0) return SIDE_PANEL_DEFAULT;
    return Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, saved));
  });
  const sidePanelDragRef = useRef<{ active: boolean; startX: number; startW: number }>({
    active: false, startX: 0, startW: SIDE_PANEL_DEFAULT,
  });
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sidePanelDragRef.current.active) return;
      const delta = e.clientX - sidePanelDragRef.current.startX;
      const next = Math.min(
        SIDE_PANEL_MAX,
        Math.max(SIDE_PANEL_MIN, sidePanelDragRef.current.startW + delta),
      );
      setSidePanelWidth(next);
    };
    const onUp = () => {
      if (!sidePanelDragRef.current.active) return;
      sidePanelDragRef.current.active = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist on release rather than on every mousemove (which would thrash
      // localStorage and trigger unnecessary re-renders).
      setSidePanelWidth(w => {
        localStorage.setItem(SIDE_PANEL_KEY, String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  const startSidePanelDrag = (e: React.MouseEvent) => {
    sidePanelDragRef.current = { active: true, startX: e.clientX, startW: sidePanelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const [currentTestRunIndex, setCurrentTestRunIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepNotes, setStepNotes] = useState('');
  const [iframeState, setIframeState] = useState<IframeState>('loading');
  const [completed, setCompleted] = useState(false);
  const [attachedEvidence, setAttachedEvidence] = useState<AttachedEvidence[]>([]);
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  // User preference: capture microphone audio alongside screen audio.
  // Persisted in localStorage so the choice sticks across sessions — testers
  // who narrate their findings don't want to re-enable it every time.
  const [micEnabled, setMicEnabled] = useState<boolean>(() => {
    return localStorage.getItem('manual-rec-mic') === '1';
  });
  useEffect(() => { setManualRecMicEnabled(micEnabled); }, [micEnabled]);
  const [endSessionOpen, setEndSessionOpen] = useState(false);
  const [inactivityWarning, setInactivityWarning] = useState(false);
  // Default to FULLSCREEN — the manual testing surface is a dedicated work
  // mode and benefits from the whole viewport (steps + live app side-by-side).
  // User can collapse to inline via the Minimize button in the header if they
  // prefer the panel layout.
  const [browserFullscreen, setBrowserFullscreen] = useState(true);
  // Auto-open the iframe in fullscreen mode so the live preview loads
  // immediately. In inline mode users still gate via "Open app here".
  const [appOpenedInIframe, setAppOpenedInIframe] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  const [issueModal, setIssueModal] = useState<IssueModalState | null>(null);
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueSaved, setIssueSaved] = useState<string | null>(null); // saved issue id
  const lastActivityRef = useRef<number>(Date.now());

  const env = environments[0] as Environment | undefined;
  const activeTestRun = featureRun.testRuns[currentTestRunIndex] as TestRunRef | undefined;

  // Track every blob URL we create so we can revoke them on evidence removal
  // and unmount. Prevents memory ballooning in long manual sessions where a
  // user attaches many screenshots (was up to 400MB with base64 data URLs).
  const blobUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return () => {
      blobUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      blobUrlsRef.current.clear();
    };
  }, []);

  // Safety-net: forcibly close every portal when ManualPlayer unmounts.
  // React already cleans up portals, but if a render error happens partway
  // through, this ensures the DOM doesn't retain stranded overlays.
  useEffect(() => {
    return () => {
      setBrowserFullscreen(false);
      setInfoOpen(false);
      setIssueModal(null);
    };
  }, []);

  const { data: steps = [], isLoading: stepsLoading } = useQuery<RunStep[]>({
    queryKey: ['run-steps', activeTestRun?.id],
    queryFn: () => runsApi.getSteps(activeTestRun!.id),
    enabled: !!activeTestRun?.id,
    refetchInterval: false,
  });

  const currentStep = steps[currentStepIndex] as RunStep | undefined;
  const totalSteps = steps.length;
  const totalTests = featureRun.testRuns.length;

  // ─── Screen recording (audio + video) ───────────────────────────────────────
  // When recording stops, upload the video and open the same IssueModal used
  // for screenshots so the user can classify + describe before saving.
  const recording = useScreenRecording({
    onComplete: async (blob, durationMs) => {
      try {
        const filename = `recording-${Date.now()}.webm`;
        const file = new File([blob], filename, { type: blob.type || 'video/webm' });
        setUploadingScreenshot(true);
        const result = await uploadsApi.upload(file);
        const ev: AttachedEvidence = {
          token: result.token,
          url: result.url,
          filename: result.filename,
          mimeType: result.mimeType || blob.type || 'video/webm',
          // preview stays undefined — the modal renders a <video> element
          // directly from `evidence.url` when mimeType starts with "video/"
        };
        setAttachedEvidence(prev => [...prev, ev]);
        setRecordingUrl(ev.url);
        setIssueSaved(null);
        setIssueModal({
          evidence: ev,
          title: currentStep
            ? `Issue on: ${currentStep.name || stepInstruction(currentStep)}`
            : `Recording (${formatRecordingDuration(durationMs)})`,
          description: '',
          stepsToReproduce: '',
          type: 'BUG',
          severity: 'MEDIUM',
        });
      } catch {
        uiToast.error('Upload failed', 'The recording could not be uploaded. Please try again.');
      } finally {
        setUploadingScreenshot(false);
      }
    },
    onError: (msg) => uiToast.error('Recording error', msg),
  });

  // Iframe 10-second timeout
  useEffect(() => {
    if (!env?.baseUrl) return;
    setIframeState('loading');
    const timer = setTimeout(() => {
      setIframeState(s => s === 'loading' ? 'timeout' : s);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [env?.baseUrl]);

  // Heartbeat — handled globally by ActiveSessionsPill in the TopNav,
  // which calls bulkHeartbeat for every active run the user has. Removing
  // the per-player interval avoids 2× the network chatter and removes a
  // lingering interval that used to die only on player unmount.

  // Inactivity warning — 30 minutes
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current > INACTIVITY_WARNING_MS) {
        setInactivityWarning(true);
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  function recordActivity() {
    lastActivityRef.current = Date.now();
    setInactivityWarning(false);
  }

  function toggleLeftPanel() {
    setLeftPanelOpen(prev => {
      localStorage.setItem(LEFT_PANEL_KEY, String(!prev));
      return !prev;
    });
  }

  /**
   * Programmatic screenshot of the live preview iframe. Bypasses the OS file
   * picker so the tester can capture the current app state with one click and
   * land directly in the IssueModal — same downstream flow as a manual upload,
   * but matched to the moment they noticed the bug.
   *
   * Browser limitation: requires the iframe's document to be same-origin with
   * this page (cross-origin DOMs are not readable from JS). We catch and fall
   * back to a clear toast that nudges the user to the file picker.
   */
  async function captureIframeScreenshot() {
    if (capturing) return;
    if (attachedEvidence.length >= 5) {
      uiToast.warning('Attachment limit', 'Maximum 5 screenshots per step.');
      return;
    }
    const iframe = previewIframeRef.current;
    if (!iframe) {
      uiToast.error('Preview not ready', 'Open the app preview before capturing a screenshot.');
      return;
    }
    setCapturing(true);
    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) throw new Error('cross-origin');
      // Lazy-import keeps html-to-image out of the main bundle until needed.
      // toCanvas + WebP @ 0.85 — ~5–10× smaller than the default PNG.
      const { toCanvas } = await import('html-to-image');
      const canvas = await toCanvas(doc.documentElement, {
        cacheBust: true,
        pixelRatio: window.devicePixelRatio || 1,
      });
      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/webp', 0.85),
      );
      if (!blob) throw new Error('capture-failed');
      const file = new File([blob], `capture-${Date.now()}.webp`, { type: 'image/webp' });
      const result = await uploadsApi.upload(file);
      const preview = URL.createObjectURL(blob);
      blobUrlsRef.current.add(preview);
      const ev: AttachedEvidence = {
        token: result.token,
        url: result.url,
        filename: result.filename,
        mimeType: result.mimeType,
        preview,
      };
      setAttachedEvidence(prev => [...prev, ev]);
      // Open the issue modal immediately — that's the whole point: capture →
      // classify → save, no detour to the file system.
      setIssueSaved(null);
      setIssueModal({
        evidence: ev,
        title: currentStep ? `Issue on: ${currentStep.name || stepInstruction(currentStep)}` : '',
        description: '',
        stepsToReproduce: '',
        type: 'BUG',
        severity: 'MEDIUM',
      });
    } catch (err) {
      const reason = (err as Error)?.message;
      if (reason === 'cross-origin') {
        uiToast.warning(
          'Cannot auto-capture',
          'The preview app is on a different origin. Use the Screenshot button to upload an OS screenshot instead.',
        );
      } else {
        uiToast.error('Capture failed', 'Try again, or use the Screenshot button to upload manually.');
      }
    } finally {
      setCapturing(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';

    // Validate sizes + show toast per rejected file
    const valid = files.filter(f => {
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        uiToast.error(`File too large`, `"${f.name}" exceeds ${MAX_FILE_SIZE_MB} MB.`);
        return false;
      }
      return true;
    });
    if (valid.length === 0) return;

    // Cap total attachments at 5 per step
    if (attachedEvidence.length + valid.length > 5) {
      uiToast.warning('Attachment limit', 'Maximum 5 screenshots per step.');
      return;
    }

    // Only open the issue modal for the FIRST file — uploading 3 screenshots
    // at once should not fire 3 modals in sequence (only the last was visible).
    // Extra files are silently attached so the user can reference them later.
    setUploadingScreenshot(true);
    try {
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        const result = await uploadsApi.upload(file);
        // Use createObjectURL (cheap reference) instead of FileReader→data-URL
        // (3-4x memory bloat). The ref tracks every URL for revocation on
        // unmount + evidence removal. Saves hundreds of MB in long sessions.
        const preview = URL.createObjectURL(file);
        blobUrlsRef.current.add(preview);
        const ev: AttachedEvidence = {
          token: result.token,
          url: result.url,
          filename: result.filename,
          mimeType: result.mimeType,
          preview,
        };
        setAttachedEvidence(prev => [...prev, ev]);
        // Open issue modal only for the first file so the UX is linear
        if (i === 0) {
          setIssueSaved(null);
          setIssueModal({
            evidence: ev,
            title: currentStep ? `Issue on: ${currentStep.name || stepInstruction(currentStep)}` : '',
            description: '',
            stepsToReproduce: '',
            type: 'BUG',
            severity: 'MEDIUM',
          });
        }
      }
      if (valid.length > 1) {
        uiToast.info(
          `${valid.length - 1} additional screenshot${valid.length > 2 ? 's' : ''} attached`,
          `Log the current issue, then the rest stay available on this step.`,
        );
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      uiToast.error('Upload failed', typeof msg === 'string' ? msg : 'Please try again.');
    } finally {
      setUploadingScreenshot(false);
    }
  }

  function removeEvidence(idx: number) {
    setAttachedEvidence(prev => {
      const removed = prev[idx];
      if (removed?.preview && removed.preview.startsWith('blob:')) {
        URL.revokeObjectURL(removed.preview);
        blobUrlsRef.current.delete(removed.preview);
      }
      return prev.filter((_, i) => i !== idx);
    });
  }

  async function handleSaveIssue() {
    if (!issueModal) return;
    setIssueSaving(true);
    try {
      const isVideo = issueModal.evidence.mimeType?.startsWith('video/');
      const created = await issuesApi.create(projectId, {
        type: issueModal.type,
        severity: issueModal.severity,
        title: issueModal.title.trim() || 'Untitled Issue',
        description: issueModal.description || undefined,
        stepsToReproduce: issueModal.stepsToReproduce || undefined,
        // Route video evidence to recordingUrl, image evidence to screenshotUrls
        ...(isVideo
          ? { recordingUrl: issueModal.evidence.url }
          : { screenshotUrls: [issueModal.evidence.url] }),
        featureId,
        testDefinitionId: activeTestRun?.testDefinition
          ? // pass the test definition id so the issue is linked to the test
            // (testDefinition object has its id embedded at this level)
            (activeTestRun as unknown as { testDefinitionId?: string }).testDefinitionId
          : undefined,
        testRunId: activeTestRun?.id,
        runStepId: currentStep?.id,
      });
      setIssueSaved(created.id);
      uiToast.success(
        'Issue logged',
        `${issueModal.type} #${(created as { number?: number }).number ?? ''} created`.trim(),
      );
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      uiToast.error('Failed to save issue', typeof msg === 'string' ? msg : 'Please try again.');
    } finally {
      setIssueSaving(false);
    }
  }

  function handleDownloadScreenshot(ev: AttachedEvidence) {
    const a = document.createElement('a');
    a.href = ev.preview ?? ev.url;
    a.download = ev.filename;
    a.click();
  }

  function advanceStep() {
    setAttachedEvidence([]);
    setRecordingUrl(null);
    setStepNotes('');
    recordActivity();
    const nextStep = currentStepIndex + 1;
    if (nextStep < totalSteps) {
      setCurrentStepIndex(nextStep);
    } else {
      const nextTest = currentTestRunIndex + 1;
      if (nextTest < totalTests) {
        setCurrentTestRunIndex(nextTest);
        setCurrentStepIndex(0);
      } else {
        if (activeTestRun) {
          runsApi.completeRun(activeTestRun.id).then(() => {
            qc.invalidateQueries({ queryKey: ['feature-runs'] });
            setCompleted(true);
          });
        }
      }
    }
  }

  const markStatus = useMutation({
    mutationFn: async (status: 'PASSED' | 'FAILED') => {
      const evidenceUrls = [
        ...attachedEvidence.map(e => e.url),
        ...(recordingUrl ? [recordingUrl] : []),
      ];
      return runsApi.markStepStatus(activeTestRun!.id, currentStep!.id, {
        status,
        notes: stepNotes || undefined,
        evidenceUrls: evidenceUrls.length > 0 ? evidenceUrls : undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run-steps', activeTestRun?.id] });
      advanceStep();
    },
  });

  const abandonRun = useMutation({
    mutationFn: () => featureRunsApi.abandon(featureRun.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs'] });
      onStop();
    },
  });

  // Step tallies — memoized so any unrelated state change (e.g. typing into
  // stepNotes) doesn't re-walk the steps array three times.
  const { passedSteps, failedSteps, remainingSteps } = useMemo(() => {
    let passed = 0, failed = 0, pending = 0;
    for (const s of steps) {
      if (s.status === 'PASSED') passed++;
      else if (s.status === 'FAILED') failed++;
      else if (s.status === 'PENDING') pending++;
    }
    return { passedSteps: passed, failedSteps: failed, remainingSteps: pending };
  }, [steps]);

  // ── Empty testRuns guard ─────────────────────────────────────────────────────
  // If the run was just created and worker hasn't populated testRuns yet,
  // render a loading state (not portals!) so we don't leak DOM into document.body
  if (!activeTestRun) {
    return (
      <div className="rounded-2xl p-12 flex flex-col items-center gap-3"
        style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.20)' }}>
        <Loader size={28} className="animate-spin" style={{ color: '#a78bfa' }} />
        <p className="text-sm" style={{ color: 'rgba(238,238,248,0.70)' }}>
          Preparing manual testing session…
        </p>
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Waiting for the runner to initialize test cases.
        </p>
      </div>
    );
  }

  // ── Completion screen ────────────────────────────────────────────────────────
  if (completed) {
    return (
      <div
        className="rounded-2xl animate-fade-in border-2"
        style={{
          borderColor: 'rgba(16,185,129,0.4)',
          background: 'rgba(16,185,129,0.06)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.40)',
        }}
      >
        <div className="px-5 py-12 flex flex-col items-center gap-4">
          <CheckCircle size={40} className="text-green-400" />
          <h3 className="text-lg font-semibold" style={{ color: 'rgba(238,238,248,0.9)' }}>
            Testing Complete
          </h3>
          <p className="text-sm" style={{ color: 'rgba(238,238,248,0.5)' }}>
            All {totalTests} test{totalTests !== 1 ? 's' : ''} have been evaluated.
          </p>
        </div>
      </div>
    );
  }

  // ── Step list item ───────────────────────────────────────────────────────────
  function renderStepItem(step: RunStep, i: number) {
    const isActive = i === currentStepIndex;
    const isPassed = step.status === 'PASSED';
    const isFailed = step.status === 'FAILED';
    const isDone = isPassed || isFailed || step.status === 'SKIPPED';
    const isUpcoming = !isActive && !isDone;

    return (
      <div key={step.id}>
        {/* Compact row for all steps */}
        <div
          // items-start so the status dot, type badge, and step number stay
          // anchored to the first line when the step name wraps in a narrow
          // sidebar (rather than centring against a tall block of text).
          className="flex items-start gap-2 px-3 py-2 rounded-lg transition-all"
          style={{
            background: isActive ? 'rgba(139,92,246,0.12)' : 'transparent',
            border: isActive ? '1px solid rgba(139,92,246,0.28)' : '1px solid transparent',
          }}
        >
          {/* Status dot */}
          <div className="flex-shrink-0 w-4 flex items-center justify-center" style={{ paddingTop: 2 }}>
            {isPassed ? (
              <CheckCircle size={13} style={{ color: '#34d399' }} />
            ) : isFailed ? (
              <XCircle size={13} style={{ color: '#f87171' }} />
            ) : isActive ? (
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#a78bfa', boxShadow: '0 0 6px #a78bfa' }} />
            ) : (
              <div className="w-2 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.2)' }} />
            )}
          </div>
          {/* Type badge */}
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
            style={{
              background: isActive ? 'rgba(139,92,246,0.25)' : 'rgba(255,255,255,0.07)',
              color: isActive ? '#c4b5fd' : 'rgba(238,238,248,0.45)',
            }}
          >
            {step.type}
          </span>
          {/* Name — wraps across multiple lines when sidebar is narrow */}
          <span
            className="text-xs flex-1 min-w-0 break-words whitespace-normal"
            style={{
              color: isActive
                ? 'rgba(238,238,248,0.92)'
                : isDone
                ? 'rgba(238,238,248,0.5)'
                : 'rgba(238,238,248,0.38)',
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {step.name || stepInstruction(step)}
          </span>
          {/* Step number */}
          <span
            className="text-[10px] font-mono flex-shrink-0"
            style={{ color: 'rgba(238,238,248,0.25)' }}
          >
            #{i + 1}
          </span>
        </div>

        {/* Expanded controls for active step */}
        {isActive && (
          <div
            className="mx-2 mt-1 mb-2 rounded-xl p-4 space-y-3"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {/* Instruction */}
            <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
              {stepInstruction(step)}
            </p>

            {/* Input params */}
            {step.input && Object.keys(step.input).length > 0 && (
              <div
                className="rounded-lg px-2.5 py-2 text-xs font-mono"
                style={{ background: 'rgba(0,0,0,0.28)', color: 'rgba(238,238,248,0.5)' }}
              >
                {Object.entries(step.input).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: '#a78bfa' }}>{k}:</span> {String(v)}
                  </div>
                ))}
              </div>
            )}

            {/* Notes */}
            <textarea
              className="w-full rounded-lg px-3 py-2 text-xs resize-none focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(238,238,248,0.85)',
              }}
              rows={2}
              placeholder="Notes (optional)…"
              value={stepNotes}
              onChange={e => setStepNotes(e.target.value)}
            />

            {/* Evidence buttons */}
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={attachedEvidence.length >= 5 || uploadingScreenshot}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-all"
                style={{
                  background: attachedEvidence.length > 0 ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.04)',
                  border: attachedEvidence.length > 0 ? '1px solid rgba(139,92,246,0.3)' : '1px dashed rgba(255,255,255,0.14)',
                  color: attachedEvidence.length >= 5 || uploadingScreenshot ? 'rgba(238,238,248,0.25)' : attachedEvidence.length > 0 ? '#c4b5fd' : 'rgba(238,238,248,0.5)',
                  cursor: attachedEvidence.length >= 5 || uploadingScreenshot ? 'not-allowed' : 'pointer',
                }}
              >
                {uploadingScreenshot ? (
                  <><Loader size={11} className="animate-spin" /> Uploading…</>
                ) : (
                  <><Paperclip size={11} /> {attachedEvidence.length > 0 ? `${attachedEvidence.length} file${attachedEvidence.length !== 1 ? 's' : ''}` : 'Upload'}</>
                )}
              </button>
              <button
                type="button"
                onClick={captureIframeScreenshot}
                disabled={attachedEvidence.length >= 5 || capturing || uploadingScreenshot}
                title="Capture the current preview as a screenshot and log an issue"
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-all"
                style={{
                  background: 'rgba(56,189,248,0.10)',
                  border: '1px dashed rgba(56,189,248,0.30)',
                  color: capturing ? 'rgba(238,238,248,0.5)' : '#7dd3fc',
                  cursor: attachedEvidence.length >= 5 || capturing ? 'not-allowed' : 'pointer',
                }}
              >
                {capturing ? <><Loader size={11} className="animate-spin" /> Capturing…</> : <><Camera size={11} /> Capture</>}
              </button>
              <button
                type="button"
                onClick={recording.isRecording
                  ? recording.stop
                  : (micEnabled ? recording.startWithMic : recording.start)}
                title={recording.isRecording
                  ? 'Stop recording'
                  : micEnabled
                    ? 'Record screen + your microphone (browser will ask what to share — pick "This Tab" for cleanest output)'
                    : 'Record screen (browser will ask what to share — pick "This Tab" for cleanest output)'}
                className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs transition-all"
                style={{
                  background: recording.isRecording ? 'rgba(239,68,68,0.18)' : (recordingUrl ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.04)'),
                  border: recording.isRecording ? '1px solid rgba(239,68,68,0.45)' : (recordingUrl ? '1px solid rgba(139,92,246,0.4)' : '1px dashed rgba(255,255,255,0.14)'),
                  color: recording.isRecording ? '#f87171' : (recordingUrl ? '#a78bfa' : 'rgba(238,238,248,0.5)'),
                }}
              >
                {recording.isRecording ? (
                  <><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" /> Stop {formatRecordingDuration(recording.elapsedMs)}</>
                ) : (
                  <><Video size={11} /> {recordingUrl ? '✓ Recording' : 'Record'}</>
                )}
              </button>
              {/* Mic toggle — only visible when not recording (we don't allow
                  hot-swapping mid-recording; would require restarting the stream). */}
              {!recording.isRecording && (
                <button
                  type="button"
                  onClick={() => setMicEnabled(v => !v)}
                  title={micEnabled ? 'Microphone narration enabled — click to disable' : 'Click to also record your voice'}
                  className="rounded-lg px-2 transition-all"
                  style={{
                    background: micEnabled ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.04)',
                    border: micEnabled ? '1px solid rgba(139,92,246,0.40)' : '1px dashed rgba(255,255,255,0.14)',
                    color: micEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.5)',
                  }}
                >
                  {micEnabled ? <Mic size={11} /> : <MicOff size={11} />}
                </button>
              )}
            </div>

            {/* Evidence thumbnails */}
            {attachedEvidence.length > 0 && (
              <div className="space-y-1">
                {attachedEvidence.map((ev, idx) => (
                  <div
                    key={ev.token}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    {ev.mimeType.startsWith('image/') && ev.preview ? (
                      <img src={ev.preview} alt="" className="w-7 h-7 object-cover rounded flex-shrink-0" />
                    ) : (
                      <Paperclip size={11} className="flex-shrink-0" style={{ color: 'rgba(238,238,248,0.4)' }} />
                    )}
                    <span className="flex-1 text-xs truncate" style={{ color: 'rgba(238,238,248,0.55)' }}>{ev.filename}</span>
                    <span className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>✓</span>
                    <button type="button" onClick={() => removeEvidence(idx)} style={{ color: '#f87171' }}><X size={11} /></button>
                  </div>
                ))}
              </div>
            )}
            {recordingUrl && (
              <div
                className="flex items-center gap-1.5 rounded-lg px-2 py-1"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.22)' }}
              >
                <Video size={11} style={{ color: '#a78bfa' }} />
                <span className="flex-1 text-xs" style={{ color: '#a78bfa' }}>Screen recording attached</span>
                <button type="button" onClick={() => setRecordingUrl(null)} style={{ color: '#f87171' }}><X size={11} /></button>
              </div>
            )}

            {/* Pass / Fail */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                className="flex-1 justify-center"
                loading={markStatus.isPending}
                onClick={() => markStatus.mutate('FAILED')}
                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.08)' }}
              >
                <XCircle size={12} /> Fail
              </Button>
              <Button
                size="sm"
                className="flex-1 justify-center"
                loading={markStatus.isPending}
                onClick={() => markStatus.mutate('PASSED')}
                style={{ background: 'rgba(16,185,129,0.18)', color: '#34d399', border: '1px solid rgba(16,185,129,0.35)' }}
              >
                <CheckCircle size={12} /> Pass
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Inactivity warning */}
      {inactivityWarning && (
        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-4 mb-2"
          style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.3)' }}
        >
          <div className="flex items-center gap-2">
            <Timer size={14} style={{ color: '#fbbf24' }} />
            <span className="text-sm font-medium" style={{ color: '#fbbf24' }}>
              Inactive for 30 minutes — your progress is saved.
            </span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={recordActivity}>Continue</Button>
            <Button size="sm" variant="secondary" onClick={() => setEndSessionOpen(true)}
              style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.4)' }}>
              Stop Testing
            </Button>
          </div>
        </div>
      )}

      {/* ── Full-width player container ───────────────────────────────────────── */}
      <div
        className="rounded-2xl animate-fade-in border-2 overflow-hidden"
        style={{
          borderColor: 'rgba(139,92,246,0.35)',
          background: 'rgba(139,92,246,0.04)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.05)',
        }}
      >
        {/* ── Thin top bar ────────────────────────────────────────────────────── */}
        <div
          className="px-4 py-3 border-b flex items-center justify-between gap-3"
          style={{ borderColor: 'rgba(139,92,246,0.2)' }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <User size={13} style={{ color: '#a78bfa' }} />
              <span className="text-sm font-semibold" style={{ color: '#a78bfa' }}>Manual Testing</span>
            </div>
            <span className="text-xs font-mono flex-shrink-0" style={{ color: 'rgba(238,238,248,0.35)' }}>
              {featureRun.id.slice(0, 8)}…
            </span>
            {activeTestRun && (
              <span className="text-xs truncate hidden sm:block" style={{ color: 'rgba(238,238,248,0.45)' }}>
                {activeTestRun.testDefinition.name}
              </span>
            )}
            {currentStep && (
              <span
                className="text-xs flex-shrink-0 px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(139,92,246,0.15)', color: '#c4b5fd' }}
              >
                Step {currentStepIndex + 1}/{totalSteps}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {env?.baseUrl && (
              <a
                href={env.baseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all"
                style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
              >
                <ExternalLink size={11} /> Open App
              </a>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={recording.isRecording ? recording.stop : (micEnabled ? recording.startWithMic : recording.start)}
              title={recording.isRecording ? 'Stop recording' : (micEnabled ? 'Record screen + microphone' : 'Record screen')}
              style={{ color: '#a78bfa', borderColor: 'rgba(139,92,246,0.35)' }}
            >
              <Video size={12} /> Record
            </Button>
            {!recording.isRecording && (
              <button
                type="button"
                onClick={() => setMicEnabled(v => !v)}
                title={micEnabled ? 'Microphone narration on — click to disable' : 'Enable microphone narration'}
                className="inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs transition-all"
                style={{
                  background: micEnabled ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.05)',
                  border: micEnabled ? '1px solid rgba(139,92,246,0.40)' : '1px solid rgba(255,255,255,0.09)',
                  color: micEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.5)',
                }}
              >
                {micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
              </button>
            )}
            {onClose && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onClose}
              >
                <X size={12} /> Close
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEndSessionOpen(true)}
              style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.35)' }}
            >
              <Square size={12} /> Stop Testing
            </Button>
          </div>
        </div>

        {/* ── Body: left step panel + browser ─────────────────────────────────── */}
        <div className="flex relative" style={{ height: '680px' }}>

          {/* Left step panel — width is now drag-resizable (see sidePanelWidth) */}
          <div
            className="flex-shrink-0 border-r flex flex-col"
            style={{
              width: leftPanelOpen ? `${sidePanelWidth}px` : '0px',
              borderColor: 'rgba(255,255,255,0.08)',
              background: 'rgba(0,0,0,0.18)',
              overflow: 'hidden',
              transition: sidePanelDragRef.current.active ? 'none' : 'width 200ms',
            }}
          >
            {/* Inner container takes the same dynamic width */}
            <div className="h-full flex flex-col overflow-hidden" style={{ width: `${sidePanelWidth}px` }}>
              {/* Test header + progress bar */}
              {activeTestRun && (
                <div
                  className="px-4 py-3 border-b flex-shrink-0 space-y-2"
                  style={{ borderColor: 'rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    {/* min-w-0 + wrap so a long test name reflows down the
                        sidebar rather than being ellipsed when the user
                        narrows the panel. */}
                    <p className="text-xs font-semibold min-w-0 break-words whitespace-normal flex-1" style={{ color: 'rgba(238,238,248,0.7)' }}>
                      {activeTestRun.testDefinition.name}
                    </p>
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'rgba(238,238,248,0.35)' }}>
                      {currentTestRunIndex + 1}/{totalTests}
                    </span>
                  </div>
                  {/* Step progress pips */}
                  {steps.length > 0 && (
                    <div className="flex gap-1">
                      {steps.map((s, i) => (
                        <div
                          key={s.id}
                          className="h-1 flex-1 rounded-full transition-all duration-300"
                          style={{
                            background:
                              s.status === 'PASSED' ? '#34d399'
                              : s.status === 'FAILED' ? '#f87171'
                              : i === currentStepIndex ? '#a78bfa'
                              : 'rgba(255,255,255,0.1)',
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Scrollable step list */}
              <div className="flex-1 overflow-y-auto">
                {stepsLoading ? (
                  <div className="flex items-center justify-center p-10">
                    <Loader size={18} className="animate-spin" style={{ color: '#a78bfa' }} />
                  </div>
                ) : steps.length === 0 ? (
                  <div className="flex items-center justify-center p-8 text-center">
                    <p className="text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>No steps for this test.</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {steps.map((step, i) => renderStepItem(step, i))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Drag handle to resize the panel ──────────────────────────────────
             Visible only when the panel is open. Hovering/dragging gives a
             clear cursor cue; the position tracks sidePanelWidth so it stays
             pinned to the panel's right edge. */}
          {leftPanelOpen && (
            <div
              onMouseDown={startSidePanelDrag}
              title="Drag to resize the step panel"
              className="absolute z-10 top-0 bottom-0"
              style={{
                left: `${sidePanelWidth - 3}px`,
                width: '6px',
                cursor: 'col-resize',
              }}
            >
              <div
                className="w-px h-full mx-auto"
                style={{ background: 'rgba(139,92,246,0.18)' }}
              />
            </div>
          )}

          {/* ── Panel toggle tab ─────────────────────────────────────────────── */}
          <button
            onClick={toggleLeftPanel}
            title={leftPanelOpen ? 'Collapse step panel' : 'Open step panel'}
            className="absolute z-20 top-1/2 -translate-y-1/2 flex items-center justify-center"
            style={{
              left: leftPanelOpen ? `${sidePanelWidth - 4}px` : '0px',
              width: '18px',
              height: '52px',
              background: 'rgba(139,92,246,0.22)',
              border: '1px solid rgba(139,92,246,0.38)',
              borderLeft: leftPanelOpen ? '1px solid rgba(139,92,246,0.38)' : 'none',
              borderRadius: '0 8px 8px 0',
              color: '#a78bfa',
              cursor: 'pointer',
              transition: sidePanelDragRef.current.active ? 'none' : 'left 200ms',
            }}
          >
            {leftPanelOpen ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
          </button>

          {/* ── Browser / iframe panel ───────────────────────────────────────── */}
          <div className="flex-1 relative flex flex-col" style={{ background: 'rgba(0,0,0,0.25)', minWidth: 0 }}>
            {/* Mini label bar */}
            <div
              className="flex items-center justify-between px-3 py-1.5 flex-shrink-0 border-b gap-2"
              style={{ borderColor: 'rgba(255,255,255,0.06)', background: 'rgba(0,0,0,0.15)' }}
            >
              <span className="text-[11px] font-medium" style={{ color: 'rgba(238,238,248,0.35)' }}>
                Live App Preview
              </span>
              <div className="flex items-center gap-1.5 ml-auto">
                {iframeState === 'timeout' && (
                  <button
                    onClick={() => setIframeState('loading')}
                    className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded"
                    style={{ color: 'rgba(238,238,248,0.45)', background: 'rgba(255,255,255,0.05)' }}
                  >
                    <RefreshCw size={10} /> Retry
                  </button>
                )}
                {/* Info button */}
                <button
                  onClick={() => setInfoOpen(o => !o)}
                  title="Feature context"
                  className="flex items-center justify-center w-6 h-6 rounded-md transition-all"
                  style={{
                    background: infoOpen ? 'rgba(139,92,246,0.22)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${infoOpen ? 'rgba(139,92,246,0.45)' : 'rgba(255,255,255,0.09)'}`,
                    color: infoOpen ? '#c4b5fd' : 'rgba(238,238,248,0.45)',
                  }}
                >
                  <Info size={12} />
                </button>
                {/* Fullscreen toggle */}
                <button
                  onClick={() => setBrowserFullscreen(o => !o)}
                  title="Full-screen browser"
                  className="flex items-center justify-center w-6 h-6 rounded-md transition-all"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.09)',
                    color: 'rgba(238,238,248,0.45)',
                  }}
                >
                  <Maximize2 size={12} />
                </button>
              </div>
            </div>

            {/* Iframe states (inline, non-fullscreen) */}
            <div className="flex-1 relative">
              {/* Open-gate: user explicitly decides where to load the app */}
              {!appOpenedInIframe && env?.baseUrl && iframeState !== 'blocked' && iframeState !== 'timeout' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center"
                  style={{ background: 'rgba(10,10,18,0.4)' }}>
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.28)' }}
                  >
                    <ExternalLink size={24} style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="space-y-1 max-w-sm">
                    <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.82)' }}>
                      Ready to test
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.50)' }}>
                      Open <span className="font-mono text-xs" style={{ color: '#a78bfa' }}>{env.baseUrl}</span> here, or in a separate browser window so you can test side-by-side.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch">
                    <button
                      onClick={() => {
                        setAppOpenedInIframe(true);
                        setIframeState('loading');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl transition-all"
                      style={{
                        color: '#fff',
                        background: 'rgba(124,58,237,0.85)',
                        border: '1px solid rgba(139,92,246,0.55)',
                        boxShadow: '0 4px 16px rgba(124,58,237,0.32)',
                      }}
                    >
                      <Eye size={13} /> Open app here
                    </button>
                    <a
                      href={env.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-4 py-2 rounded-xl transition-all"
                      style={{
                        color: 'rgba(238,238,248,0.75)',
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.12)',
                      }}
                    >
                      <ExternalLink size={13} /> Open in new window
                    </a>
                  </div>
                </div>
              )}
              {appOpenedInIframe && iframeState === 'loading' && env?.baseUrl && (
                <>
                  <iframe
                    src={env.baseUrl}
                    className="absolute inset-0 w-full h-full border-0"
                    title="App Preview"
                    onLoad={() => setIframeState('loaded')}
                    onError={() => setIframeState('blocked')}
                  />
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                    <Loader size={22} className="animate-spin" style={{ color: '#a78bfa' }} />
                  </div>
                </>
              )}
              {appOpenedInIframe && iframeState === 'loaded' && env?.baseUrl && (
                <iframe
                  ref={previewIframeRef}
                  src={env.baseUrl}
                  className="absolute inset-0 w-full h-full border-0"
                  title="App Preview"
                />
              )}
              {(iframeState === 'timeout' || iframeState === 'blocked' || !env?.baseUrl) && (
                <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
                  <div
                    className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background: iframeState === 'blocked' ? 'rgba(239,68,68,0.15)' : 'rgba(251,191,36,0.15)' }}
                  >
                    {iframeState === 'blocked'
                      ? <XCircle size={24} style={{ color: '#f87171' }} />
                      : <Timer size={24} style={{ color: '#fbbf24' }} />}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.75)' }}>
                      {iframeState === 'blocked' ? 'Preview blocked by the app' : !env?.baseUrl ? 'No environment URL' : 'Preview timed out'}
                    </p>
                    <p className="text-xs max-w-xs" style={{ color: 'rgba(238,238,248,0.4)' }}>
                      {iframeState === 'blocked'
                        ? 'This app blocks iframe embedding. Open it in a new tab to test.'
                        : iframeState === 'timeout'
                        ? 'The app did not respond in 10 s. Check the environment URL.'
                        : 'Add a base URL to the environment to see the app preview here.'}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 items-center">
                    {env?.baseUrl && (
                      <a
                        href={env.baseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl"
                        style={{ color: '#a78bfa', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}
                      >
                        <ExternalLink size={13} /> Open in New Tab
                      </a>
                    )}
                    {iframeState === 'timeout' && (
                      <button
                        onClick={() => setIframeState('loading')}
                        className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl"
                        style={{ color: 'rgba(238,238,248,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        <RefreshCw size={13} /> Retry Preview
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>{/* end body flex */}
      </div>{/* end player container */}

      {/* ── Fullscreen browser overlay (portal → escapes Shell z-10 stacking context) */}
      {browserFullscreen && !completed && createPortal(
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: '#000' }}
        >
          {/* Fullscreen top bar */}
          <div
            className="flex items-center justify-between px-4 py-2 flex-shrink-0"
            style={{
              background: 'rgba(14,14,22,0.96)',
              borderBottom: '1px solid rgba(139,92,246,0.25)',
            }}
          >
            <div className="flex items-center gap-3">
              {/* Panel toggle */}
              <button
                onClick={toggleLeftPanel}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  background: leftPanelOpen ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${leftPanelOpen ? 'rgba(139,92,246,0.38)' : 'rgba(255,255,255,0.1)'}`,
                  color: leftPanelOpen ? '#c4b5fd' : 'rgba(238,238,248,0.55)',
                }}
                title={leftPanelOpen ? 'Hide step panel' : 'Show step panel'}
              >
                {leftPanelOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
                <span>{leftPanelOpen ? 'Hide Steps' : 'Show Steps'}</span>
              </button>
              {currentStep && (
                <div
                  className="flex items-center gap-2 px-3 py-1 rounded-lg"
                  style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)' }}
                >
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.22)', color: '#c4b5fd' }}>
                    {currentStep.type}
                  </span>
                  <span className="text-xs font-medium max-w-[300px] truncate" style={{ color: 'rgba(238,238,248,0.82)' }}>
                    {currentStep.name || stepInstruction(currentStep)}
                  </span>
                  <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.35)' }}>
                    {currentStepIndex + 1}/{totalSteps}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Screenshot — opens file picker and attaches to the current step */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={attachedEvidence.length >= 5 || uploadingScreenshot}
                title="Attach screenshot"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(238,238,248,0.70)',
                }}
              >
                {uploadingScreenshot ? <Loader size={12} className="animate-spin" /> : <Paperclip size={12} />}
                Screenshot
              </button>

              {/* Record — starts/stops screen + audio recording, then opens the issue modal */}
              <button
                onClick={recording.isRecording ? recording.stop : (micEnabled ? recording.startWithMic : recording.start)}
                title={recording.isRecording ? 'Stop recording' : (micEnabled ? 'Record screen + microphone' : 'Record screen (tab/system audio if you enable it in the share dialog)')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  background: recording.isRecording ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${recording.isRecording ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.12)'}`,
                  color: recording.isRecording ? '#f87171' : 'rgba(238,238,248,0.70)',
                }}
              >
                {recording.isRecording ? (
                  <>
                    <span className="inline-block w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                    Stop {formatRecordingDuration(recording.elapsedMs)}
                  </>
                ) : (
                  <>
                    <Video size={12} /> Record
                  </>
                )}
              </button>

              {!recording.isRecording && (
                <button
                  type="button"
                  onClick={() => setMicEnabled(v => !v)}
                  title={micEnabled ? 'Microphone on — click to disable' : 'Enable microphone'}
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-xs transition-all"
                  style={{
                    background: micEnabled ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${micEnabled ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.12)'}`,
                    color: micEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.55)',
                  }}
                >
                  {micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                </button>
              )}

              <button
                title="Feature context"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  background: infoOpen ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${infoOpen ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
                  color: infoOpen ? '#c4b5fd' : 'rgba(238,238,248,0.55)',
                }}
              >
                <Info size={12} /> Context
              </button>

              {/* Pass/Fail — mirror the floating bottom-bar so testers can mark
                  status without re-opening the step panel. Disabled when there's
                  no current step (e.g. all steps already completed). */}
              <div className="w-px h-5 mx-1" style={{ background: 'rgba(255,255,255,0.12)' }} />
              <button
                onClick={() => markStatus.mutate('FAILED')}
                disabled={markStatus.isPending || !currentStep}
                title="Mark current step Failed"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.40)', color: '#f87171' }}
              >
                <XCircle size={12} /> Fail
              </button>
              <button
                onClick={() => markStatus.mutate('PASSED')}
                disabled={markStatus.isPending || !currentStep}
                title="Mark current step Passed"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.38)', color: '#34d399' }}
              >
                <CheckCircle size={12} /> Pass
              </button>
              <div className="w-px h-5 mx-1" style={{ background: 'rgba(255,255,255,0.12)' }} />

              <button
                onClick={() => { setBrowserFullscreen(false); setLeftPanelOpen(true); localStorage.setItem(LEFT_PANEL_KEY, 'true'); }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: 'rgba(238,238,248,0.7)',
                }}
                title="Exit fullscreen"
              >
                <Minimize2 size={13} /> Exit Fullscreen
              </button>
            </div>
          </div>

          {/* Fullscreen body: optional left panel + browser */}
          <div className="flex flex-1 overflow-hidden relative">
            {/* Left step panel (slides in/out) */}
            <div
              className="flex-shrink-0 border-r flex flex-col transition-all duration-200"
              style={{
                width: leftPanelOpen ? '280px' : '0px',
                borderColor: 'rgba(255,255,255,0.08)',
                background: 'rgba(10,10,18,0.97)',
                overflow: 'hidden',
              }}
            >
              <div className="w-[280px] h-full flex flex-col overflow-hidden">
                {activeTestRun && (
                  <div className="px-4 py-3 border-b flex-shrink-0 space-y-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold truncate" style={{ color: 'rgba(238,238,248,0.7)' }}>
                        {activeTestRun.testDefinition.name}
                      </p>
                      <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: 'rgba(238,238,248,0.35)' }}>
                        {currentTestRunIndex + 1}/{totalTests}
                      </span>
                    </div>
                    {steps.length > 0 && (
                      <div className="flex gap-1">
                        {steps.map((s, i) => (
                          <div key={s.id} className="h-1 flex-1 rounded-full transition-all duration-300"
                            style={{
                              background: s.status === 'PASSED' ? '#34d399' : s.status === 'FAILED' ? '#f87171'
                                : i === currentStepIndex ? '#a78bfa' : 'rgba(255,255,255,0.1)',
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="flex-1 overflow-y-auto">
                  <div className="p-2 space-y-0.5">
                    {steps.map((step, i) => renderStepItem(step, i))}
                  </div>
                </div>
              </div>
            </div>

            {/* Fullscreen iframe — takes remaining space */}
            <div className="flex-1 relative">
              {!env?.baseUrl ? (
                <div className="flex items-center justify-center h-full" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  <p className="text-sm">No environment URL configured.</p>
                </div>
              ) : !appOpenedInIframe ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-8 text-center"
                  style={{ background: 'rgba(10,10,18,0.6)' }}>
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.32)' }}
                  >
                    <ExternalLink size={24} style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="space-y-1 max-w-md">
                    <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.85)' }}>
                      Ready to test
                    </p>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
                      Open <span className="font-mono" style={{ color: '#a78bfa' }}>{env.baseUrl}</span> here, or in a separate window.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch">
                    <button
                      onClick={() => setAppOpenedInIframe(true)}
                      className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-xl transition-all"
                      style={{
                        color: '#fff',
                        background: 'rgba(124,58,237,0.85)',
                        border: '1px solid rgba(139,92,246,0.55)',
                        boxShadow: '0 4px 16px rgba(124,58,237,0.32)',
                      }}
                    >
                      <Eye size={13} /> Open app here
                    </button>
                    <a
                      href={env.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 text-sm font-medium px-5 py-2.5 rounded-xl transition-all"
                      style={{
                        color: 'rgba(238,238,248,0.80)',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.14)',
                      }}
                    >
                      <ExternalLink size={13} /> Open in new window
                    </a>
                  </div>
                </div>
              ) : (
                <iframe
                  src={env.baseUrl}
                  className="absolute inset-0 w-full h-full border-0"
                  title="App Preview (Fullscreen)"
                />
              )}
            </div>
          </div>
        </div>
      , document.body)}

      {/* ── Floating action bar (panel hidden) — portaled above everything ─── */}
      {!leftPanelOpen && !completed && currentStep && createPortal(
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-2 px-4 py-2.5 rounded-2xl"
          style={{
            background: 'rgba(14,14,22,0.94)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(139,92,246,0.38)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(139,92,246,0.18)',
          }}
        >
          {/* Current step info */}
          <div
            className="flex items-center gap-2 pr-3"
            style={{ borderRight: '1px solid rgba(255,255,255,0.1)' }}
          >
            <span
              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(139,92,246,0.22)', color: '#c4b5fd' }}
            >
              {currentStep.type}
            </span>
            <span
              className="text-xs font-medium max-w-[180px] truncate"
              style={{ color: 'rgba(238,238,248,0.82)' }}
            >
              {currentStep.name || stepInstruction(currentStep)}
            </span>
            <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.3)' }}>
              {currentStepIndex + 1}/{totalSteps}
            </span>
          </div>

          {/* Info context */}
          <button
            onClick={() => setInfoOpen(o => !o)}
            title="Feature context"
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-all"
            style={{
              color: infoOpen ? '#c4b5fd' : 'rgba(238,238,248,0.55)',
              background: infoOpen ? 'rgba(139,92,246,0.18)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${infoOpen ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <Info size={12} />
          </button>

          {/* Screenshot */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={attachedEvidence.length >= 5 || uploadingScreenshot}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              color: attachedEvidence.length > 0 ? '#c4b5fd' : 'rgba(238,238,248,0.6)',
              background: attachedEvidence.length > 0 ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${attachedEvidence.length > 0 ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            {uploadingScreenshot ? <Loader size={11} className="animate-spin" /> : <Paperclip size={11} />}
            {attachedEvidence.length > 0 ? `${attachedEvidence.length} file${attachedEvidence.length !== 1 ? 's' : ''}` : 'Screenshot'}
          </button>

          {/* Record */}
          <button
            onClick={recording.isRecording ? recording.stop : (micEnabled ? recording.startWithMic : recording.start)}
            title={recording.isRecording ? 'Stop recording' : (micEnabled ? 'Record screen + microphone' : 'Record screen')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              color: recordingUrl ? '#a78bfa' : 'rgba(238,238,248,0.6)',
              background: recordingUrl ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${recordingUrl ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <Video size={11} /> {recordingUrl ? '✓ Rec' : 'Record'}
          </button>

          {!recording.isRecording && (
            <button
              type="button"
              onClick={() => setMicEnabled(v => !v)}
              title={micEnabled ? 'Microphone on' : 'Enable microphone'}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-xs transition-all"
              style={{
                color: micEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.5)',
                background: micEnabled ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.07)',
                border: `1px solid ${micEnabled ? 'rgba(139,92,246,0.35)' : 'rgba(255,255,255,0.1)'}`,
              }}
            >
              {micEnabled ? <Mic size={11} /> : <MicOff size={11} />}
            </button>
          )}

          <div className="w-px h-5 flex-shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />

          {/* Fail */}
          <Button
            size="sm"
            loading={markStatus.isPending}
            onClick={() => markStatus.mutate('FAILED')}
            style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.1)' }}
          >
            <XCircle size={12} /> Fail
          </Button>

          {/* Pass */}
          <Button
            size="sm"
            loading={markStatus.isPending}
            onClick={() => markStatus.mutate('PASSED')}
            style={{ background: 'rgba(16,185,129,0.2)', color: '#34d399', border: '1px solid rgba(16,185,129,0.38)' }}
          >
            <CheckCircle size={12} /> Pass
          </Button>
        </div>
      , document.body)}

      {/* ── Feature info panel (slide-in from right, fixed) — portaled above everything ── */}
      {infoOpen && !completed && createPortal(
        <div
          className="fixed right-0 top-0 h-full z-[10001] flex flex-col"
          style={{
            width: '340px',
            background: 'rgba(14,14,22,0.97)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderLeft: '1px solid rgba(139,92,246,0.25)',
            boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
          }}
        >
          {/* Panel header */}
          <div
            className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
            style={{ borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <div className="flex items-center gap-2">
              <FileText size={15} style={{ color: '#a78bfa' }} />
              <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.85)' }}>Feature Context</span>
            </div>
            <button
              onClick={() => setInfoOpen(false)}
              className="w-6 h-6 flex items-center justify-center rounded-md transition-all"
              style={{ color: 'rgba(238,238,248,0.4)', background: 'rgba(255,255,255,0.05)' }}
            >
              <X size={13} />
            </button>
          </div>

          {/* Panel body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

            {/* Feature name + status */}
            {feature?.name && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  Feature
                </p>
                <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.88)' }}>
                  {feature.name}
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  {feature.status && (
                    <span
                      className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase"
                      style={{
                        background: feature.status === 'ACTIVE' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.07)',
                        color: feature.status === 'ACTIVE' ? '#34d399' : 'rgba(238,238,248,0.45)',
                      }}
                    >
                      {feature.status}
                    </span>
                  )}
                  {featureId && <FeatureDocsButton featureId={featureId} />}
                  {featureId && <ClickUpRoutingHint scope={{ kind: 'feature', featureId }} variant="badge" collapsible />}
                  {featureId && <FeatureClickUpStatusControl featureId={featureId} />}
                  {featureId && <OpenInClickUpButton scope={{ kind: 'feature', featureId }} />}
                  {featureId && <PushFeatureToClickUpButton featureId={featureId} />}
                </div>
              </div>
            )}

            {/* Feature description */}
            {feature?.description && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  Description
                </p>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.6)' }}>
                  {feature.description}
                </p>
              </div>
            )}

            {/* Acceptance criteria */}
            {feature?.acceptanceCriteria && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  Acceptance Criteria
                </p>
                <div
                  className="rounded-xl px-4 py-3 text-xs leading-relaxed whitespace-pre-wrap"
                  style={{
                    background: 'rgba(139,92,246,0.07)',
                    border: '1px solid rgba(139,92,246,0.18)',
                    color: 'rgba(238,238,248,0.65)',
                  }}
                >
                  {feature.acceptanceCriteria}
                </div>
              </div>
            )}

            {/* Current test */}
            {activeTestRun && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  Current Test
                </p>
                <div
                  className="rounded-xl px-3 py-2.5 space-y-1"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <p className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.78)' }}>
                    {activeTestRun.testDefinition.name}
                  </p>
                  <p className="text-[10px]" style={{ color: 'rgba(238,238,248,0.35)' }}>
                    Test {currentTestRunIndex + 1} of {totalTests} · Step {currentStepIndex + 1}/{totalSteps}
                  </p>
                </div>
              </div>
            )}

            {/* Current step instruction */}
            {currentStep && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.3)' }}>
                  Current Step
                </p>
                <div
                  className="rounded-xl px-3 py-2.5 space-y-2"
                  style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'rgba(139,92,246,0.22)', color: '#c4b5fd' }}
                    >
                      {currentStep.type}
                    </span>
                    <span className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.78)' }}>
                      {currentStep.name}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.5)' }}>
                    {stepInstruction(currentStep)}
                  </p>
                </div>
              </div>
            )}

            {/* No content fallback */}
            {!feature?.name && !feature?.description && !feature?.acceptanceCriteria && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <Info size={28} style={{ color: 'rgba(238,238,248,0.15)' }} />
                <p className="text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
                  No feature description available. Add one in the feature settings.
                </p>
              </div>
            )}
          </div>
        </div>
      , document.body)}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />

      {/* Stop Testing confirmation modal */}
      <Modal
        open={endSessionOpen}
        onClose={() => setEndSessionOpen(false)}
        title="Stop Testing?"
      >
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'rgba(238,238,248,0.6)' }}>
            Your progress will be saved. Remaining steps will be marked as Skipped.
          </p>
          <div
            className="rounded-xl px-4 py-3 space-y-1.5"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle size={13} className="text-green-400" />
              <span style={{ color: 'rgba(238,238,248,0.7)' }}>{passedSteps} steps passed</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <XCircle size={13} className="text-red-400" />
              <span style={{ color: 'rgba(238,238,248,0.7)' }}>{failedSteps} steps failed</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock size={13} style={{ color: 'rgba(238,238,248,0.4)' }} />
              <span style={{ color: 'rgba(238,238,248,0.5)' }}>{remainingSteps} steps remaining (will be skipped)</span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setEndSessionOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={abandonRun.isPending}
              onClick={() => abandonRun.mutate()}
              style={{ background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.35)' }}
            >
              <Square size={13} /> Stop Testing
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Screenshot → Issue modal (portal, z-[10002]) ─────────────────────── */}
      {issueModal && createPortal(
        <div className="fixed inset-0 z-[10002] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
          <div
            className="w-full max-w-lg rounded-2xl flex flex-col overflow-hidden"
            style={{
              background: 'rgba(14,14,22,0.98)',
              border: '1px solid rgba(139,92,246,0.35)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
              maxHeight: '90vh',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
              style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <div className="flex items-center gap-2">
                <AlertCircle size={16} style={{ color: '#f87171' }} />
                <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.9)' }}>
                  {issueSaved
                    ? 'Issue Created'
                    : issueModal.evidence.mimeType?.startsWith('video/')
                      ? 'Log Issue from Recording'
                      : 'Log Issue from Screenshot'}
                </span>
              </div>
              <button onClick={() => setIssueModal(null)}
                className="w-6 h-6 flex items-center justify-center rounded-md transition-all"
                style={{ color: 'rgba(238,238,248,0.4)', background: 'rgba(255,255,255,0.05)' }}>
                <X size={13} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Evidence preview + download — renders <video> for video/*, <img> otherwise */}
              <div className="relative rounded-xl overflow-hidden"
                style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.08)' }}>
                {issueModal.evidence.mimeType?.startsWith('video/') ? (
                  <video
                    src={issueModal.evidence.url}
                    controls
                    className="w-full object-contain"
                    style={{ maxHeight: '260px' }}
                  />
                ) : issueModal.evidence.preview ? (
                  <img src={issueModal.evidence.preview} alt="Screenshot"
                    className="w-full object-contain max-h-44" />
                ) : (
                  <div className="h-24 flex items-center justify-center">
                    <Paperclip size={20} style={{ color: 'rgba(238,238,248,0.3)' }} />
                  </div>
                )}
                <button
                  onClick={() => handleDownloadScreenshot(issueModal.evidence)}
                  className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs transition-all"
                  style={{ background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.75)' }}
                >
                  <Download size={11} /> Download
                </button>
              </div>

              {issueSaved ? (
                /* Success state */
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
                    style={{ background: 'rgba(16,185,129,0.15)' }}>
                    <CheckCircle size={24} style={{ color: '#34d399' }} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.9)' }}>Issue logged successfully</p>
                    <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.4)' }}>
                      {issueModal.evidence.mimeType?.startsWith('video/')
                        ? 'The recording has been attached to the issue.'
                        : 'The screenshot has been attached to the issue.'}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Issue type selector */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: 'rgba(238,238,248,0.35)' }}>Issue Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'BUG', label: 'Bug', icon: Bug, color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.35)' },
                        { value: 'SNAG', label: 'Snag', icon: Wrench, color: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)' },
                        { value: 'QUERY', label: 'Query', icon: MessageSquare, color: '#60a5fa', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)' },
                      ] as const).map(opt => (
                        <button key={opt.value} type="button"
                          onClick={() => setIssueModal(m => m ? { ...m, type: opt.value } : m)}
                          className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-semibold transition-all"
                          style={{
                            background: issueModal.type === opt.value ? opt.bg : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${issueModal.type === opt.value ? opt.border : 'rgba(255,255,255,0.09)'}`,
                            color: issueModal.type === opt.value ? opt.color : 'rgba(238,238,248,0.45)',
                          }}>
                          <opt.icon size={14} />
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Severity */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: 'rgba(238,238,248,0.35)' }}>Severity</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([
                        { value: 'CRITICAL', color: '#f87171' },
                        { value: 'HIGH', color: '#fb923c' },
                        { value: 'MEDIUM', color: '#fbbf24' },
                        { value: 'LOW', color: '#34d399' },
                      ] as const).map(opt => (
                        <button key={opt.value} type="button"
                          onClick={() => setIssueModal(m => m ? { ...m, severity: opt.value } : m)}
                          className="py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                          style={{
                            background: issueModal.severity === opt.value
                              ? `${opt.color}22` : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${issueModal.severity === opt.value ? opt.color + '66' : 'rgba(255,255,255,0.09)'}`,
                            color: issueModal.severity === opt.value ? opt.color : 'rgba(238,238,248,0.4)',
                          }}>
                          {opt.value}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Title */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: 'rgba(238,238,248,0.35)' }}>Title</label>
                    <input
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(238,238,248,0.88)',
                      }}
                      placeholder="What went wrong?"
                      value={issueModal.title}
                      onChange={e => setIssueModal(m => m ? { ...m, title: e.target.value } : m)}
                    />
                  </div>

                  {/* Description */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: 'rgba(238,238,248,0.35)' }}>Description</label>
                    <textarea
                      className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(238,238,248,0.75)',
                      }}
                      rows={3}
                      placeholder="Describe the issue…"
                      value={issueModal.description}
                      onChange={e => setIssueModal(m => m ? { ...m, description: e.target.value } : m)}
                    />
                  </div>

                  {/* Steps to reproduce */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: 'rgba(238,238,248,0.35)' }}>Steps to Reproduce <span style={{ color: 'rgba(238,238,248,0.2)' }}>(optional)</span></label>
                    <textarea
                      className="w-full rounded-lg px-3 py-2 text-sm resize-none focus:outline-none"
                      style={{
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'rgba(238,238,248,0.75)',
                      }}
                      rows={2}
                      placeholder="1. Navigate to… 2. Click…"
                      value={issueModal.stepsToReproduce}
                      onChange={e => setIssueModal(m => m ? { ...m, stepsToReproduce: e.target.value } : m)}
                    />
                  </div>

                  {/* Current step context pill */}
                  {currentStep && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.18)' }}>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(139,92,246,0.22)', color: '#c4b5fd' }}>
                        {currentStep.type}
                      </span>
                      <span className="text-xs flex-1 truncate" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        Captured at step {currentStepIndex + 1}: {currentStep.name || stepInstruction(currentStep)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t flex-shrink-0 flex justify-end gap-2"
              style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              {issueSaved ? (
                <Button onClick={() => setIssueModal(null)}
                  style={{ background: 'rgba(139,92,246,0.18)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.38)' }}>
                  Done
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setIssueModal(null)}>
                    Skip
                  </Button>
                  <Button
                    loading={issueSaving}
                    onClick={handleSaveIssue}
                    disabled={!issueModal.title.trim()}
                    style={{ background: 'rgba(239,68,68,0.18)', color: '#f87171', border: '1px solid rgba(239,68,68,0.38)' }}
                  >
                    <AlertCircle size={13} /> Log Issue
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function FeaturePage() {
  const { projectId, moduleId, featureId } = useParams<{
    projectId: string;
    moduleId: string;
    featureId: string;
  }>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, orgRole } = useAuthStore();
  const canManage = orgRole === 'ORG_ADMIN' || user?.platformRole === 'PLATFORM_ADMIN';

  // Real-time refresh for RecentRunsPanel and per-test status badges.
  useProjectRunSocket(projectId);

  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  // G2 (Phase 2) — Generate Tests modal. Lives at feature-scope so the
  // button + modal share the same featureId; on apply we invalidate the
  // tests query so the freshly-created rows appear immediately.
  const [aiTestsOpen, setAiTestsOpen] = useState(false);
  // Disable the Generate Tests button when the org hasn't set up an AI
  // credential yet — click routes to Settings → AI instead.
  const { configured: aiConfigured, isLoading: aiCheckLoading } = useAiConfigured();
  const [publishDesc, setPublishDesc] = useState('');
  const [selectedEnvId, setSelectedEnvId] = useState('');
  const [runMode, setRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');
  // Single-test quick run
  const [soloTest, setSoloTest] = useState<Record<string, unknown> | null>(null);
  const [soloEnvId, setSoloEnvId] = useState('');
  const [soloRunMode, setSoloRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');

  // Expandable test case rows
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [featureWorkbenchTab, setFeatureWorkbenchTab] = useState<'tests' | 'insights' | 'docs' | 'settings'>('tests');
  const [importOpen, setImportOpen] = useState(false);
  const [evidenceIssuesSort, setEvidenceIssuesSort] = useState<EvidenceIssuesSort>('newest');
  // Optimistic status per testId — updated immediately on quickMark so the
  // row badge shows the result without waiting for query refetch.
  const [quickMarkStatus, setQuickMarkStatus] = useState<Record<string, 'PASSED' | 'FAILED'>>({});
  // Quick-Fail reason modal — captures the failure category + detail before
  // a quick-mark FAIL goes through.
  const [quickFailModal, setQuickFailModal] = useState<{ testId: string; testName: string } | null>(null);

  // No-env guard: track if user tried to open run modal with no envs
  const [noEnvWarning, setNoEnvWarning] = useState(false);

  // Testing Mode — only show ManualPlayer when the user explicitly opts in.
  // The feature page defaults to showing the test list; user clicks
  // "Open Testing Mode" to start/resume a guided walk-through.
  // testModeOpen removed — manual testing always navigates to TestingView

  // Switch-mode flow: when a run is active, swapping mode requires aborting
  // the current run and starting a fresh one in the target mode. We surface
  // this as an explicit confirmation so testers don't lose in-progress work
  // by accident.
  const [switchModeOpen, setSwitchModeOpen] = useState(false);

  // Sign-off and promote (handover) modal state. Bound to a specific FeatureRun
  // because the actions are per-run, not feature-wide.
  const [signoffModal, setSignoffModal] = useState<{ featureRun: FeatureRun } | null>(null);
  const [promoteModal, setPromoteModal] = useState<{ featureRun: FeatureRun & { environment?: { id: string; name: string } } } | null>(null);
  const [signoffNote, setSignoffNote] = useState('');
  const [promoteTargetEnvId, setPromoteTargetEnvId] = useState<string>('');
  const [promoteRunMode, setPromoteRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');

  // Auto-open testing mode when arriving via the "Continue testing" button
  // on the Dashboard's Last Activity card (URL contains ?testMode=1).
  // The effect fires after data has loaded so activeRun + envs are resolved.
  const autoOpenTestMode = searchParams.get('testMode') === '1';

  const { data: feature, isLoading: featureLoading } = useQuery({
    queryKey: ['feature', featureId],
    queryFn: () => featuresApi.get(featureId!),
    enabled: !!featureId,
  });

  // All project modules — powers the module quick-switch dropdown
  const { data: allModules = [], isLoading: modulesLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  // All features in this module — powers the feature quick-switch dropdown
  const { data: allFeatures = [], isLoading: featuresLoading } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['features', moduleId],
    queryFn: () => modulesApi.listFeatures(moduleId!),
    enabled: !!moduleId,
    staleTime: 60_000,
  });

  const { data: draftStatus } = useQuery({
    queryKey: ['feature-draft-status', featureId],
    queryFn: () => featuresApi.draftStatus(featureId!),
    enabled: !!featureId,
    staleTime: 60_000,
    // No polling — draft status only changes when user publishes, which
    // invalidates this key explicitly. Window focus refetch handles
    // multi-tab scenarios.
    refetchOnWindowFocus: true,
  });

  const { data: tests = [] } = useQuery({
    queryKey: ['tests', projectId, 'feature', featureId],
    queryFn: () => testsApi.list(projectId!),
    enabled: !!projectId,
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['feature-versions', featureId],
    queryFn: () => featureVersionsApi.list(featureId!),
    enabled: !!featureId && historyOpen,
  });

  // Active env from the TopNav switcher — null = "All envs" (no filter).
  // Including it in the queryKey ensures React Query caches per-env so flipping
  // back doesn't refetch what was already loaded.
  const activeEnvId = useActiveEnv(projectId);
  const { data: featureRuns = [] } = useQuery({
    queryKey: ['feature-runs', featureId, activeEnvId],
    queryFn: () => featureRunsApi.list(featureId!, activeEnvId ?? undefined),
    enabled: !!featureId,
    staleTime: 10_000,
    // Only poll while a run is active — socket handles real-time updates
    refetchInterval: (query) => {
      const runs = ((query as unknown as { state: { data: unknown } }).state.data as { status: string }[] | undefined) ?? [];
      const hasActive = runs.some(r => r.status === 'RUNNING' || r.status === 'PAUSED');
      return hasActive ? 8000 : false;
    },
  });

  // Single source of truth for the summary card — reads TestRun records
  // directly via StatsService.computeFeatureStats so both quick-marks and
  // automated FeatureRun child runs count. Previously the summary derived
  // from the latest FeatureRun's testRuns[], which silently dropped manual
  // quick-marks (their TestRun has featureRunId=null).
  const { data: featureStatsData } = useQuery<{
    passed: number; failed: number; skipped: number; outstanding: number;
    total: number; passRate: number | null; lastRunAt: string | null;
  }>({
    queryKey: ['feature-stats', featureId, activeEnvId],
    queryFn: () => statsApi.getSingleFeatureStats(featureId!, activeEnvId),
    enabled: !!featureId,
    staleTime: 10_000,
  });

  const { data: envs = [] } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  // Issues filed against this feature (from manual testing — bug, observation,
  // task). Rendered in the Evidence card below so testers can see at a glance
  // what's been logged + view the attached screenshots/recordings without
  // hunting through individual test runs.
  const { data: featureIssueStats } = useQuery<{
    total: number; open: number; inProgress: number; resolved: number;
    closed: number; wontFix: number;
    byType: { BUG: number; SNAG: number; QUERY: number };
  }>({
    queryKey: ['issue-stats', 'feature', featureId],
    queryFn: () => issuesApi.featureStats(featureId!),
    enabled: !!featureId,
    staleTime: 15_000,
  });

  const featureIssuesInfinite = useInfiniteQuery({
    queryKey: ['issues', projectId, 'feature', featureId],
    queryFn: async ({ pageParam }) =>
      issuesApi.list(projectId!, {
        featureId: featureId!,
        page: pageParam as number,
        limit: EVIDENCE_ISSUES_PAGE_SIZE,
      }) as Promise<{
        items: FeatureEvidenceIssueRow[];
        total: number;
        page: number;
        pages: number;
      }>,
    initialPageParam: 1,
    getNextPageParam: lastPage => (lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined),
    enabled: !!projectId && !!featureId,
    staleTime: 15_000,
  });

  const loadedFeatureEvidenceIssues = useMemo(
    () => featureIssuesInfinite.data?.pages.flatMap(p => p.items) ?? [],
    [featureIssuesInfinite.data],
  );

  const sortedEvidenceIssues = useMemo(
    () => sortFeatureEvidenceIssues(loadedFeatureEvidenceIssues, evidenceIssuesSort),
    [loadedFeatureEvidenceIssues, evidenceIssuesSort],
  );

  const evidencePanelStats = useMemo(() => {
    const apiTotal = featureIssuesInfinite.data?.pages[0]?.total;
    return {
      displayTotal: featureIssueStats?.total ?? apiTotal ?? loadedFeatureEvidenceIssues.length,
      displayOpen:
        featureIssueStats?.open
        ?? loadedFeatureEvidenceIssues.filter(i => i.status === 'OPEN').length,
      totalScreenshots: loadedFeatureEvidenceIssues.reduce(
        (n, i) => n + (i.screenshotUrls?.length ?? 0),
        0,
      ),
      totalRecordings: loadedFeatureEvidenceIssues.filter(i => !!i.recordingUrl).length,
      loadedCount: loadedFeatureEvidenceIssues.length,
      hasMore: featureIssuesInfinite.hasNextPage,
    };
  }, [
    loadedFeatureEvidenceIssues,
    featureIssuesInfinite.data?.pages,
    featureIssuesInfinite.hasNextPage,
    featureIssueStats?.total,
    featureIssueStats?.open,
  ]);

  const publish = useMutation({
    mutationFn: () =>
      featureVersionsApi.publish(featureId!, { name: publishName, description: publishDesc }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature', featureId] });
      qc.invalidateQueries({ queryKey: ['feature-draft-status', featureId] });
      qc.invalidateQueries({ queryKey: ['feature-versions', featureId] });
      setPublishOpen(false);
      setPublishName('');
      setPublishDesc('');
    },
  });

  const restore = useMutation({
    mutationFn: (versionId: string) => featureVersionsApi.restore(featureId!, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-draft-status', featureId] });
      setHistoryOpen(false);
    },
  });

  // Quick-mark a test PASSED/FAILED without entering test mode. Creates a
  // lightweight TestRun on the backend, attaches it to the current work
  // session, and refreshes the test list + stats. For when a QA just wants
  // to blast through tests they know pass without stepping through them.
  const quickMark = useMutation({
    mutationFn: ({ testId, status, failureCategory, failureNote }: {
      testId: string;
      status: 'PASSED' | 'FAILED';
      failureCategory?: string;
      failureNote?: string;
    }) =>
      testsApi.mark(testId, {
        status,
        environmentId: activeEnvId ?? selectedEnvId ?? undefined,
        failureCategory,
        failureNote,
      }),
    onMutate: ({ testId, status }) => {
      // Optimistically update the badge before the API call completes
      setQuickMarkStatus(prev => ({ ...prev, [testId]: status }));
    },
    onSuccess: (_data, vars) => {
      // Confirm optimistic status and flush all related caches
      setQuickMarkStatus(prev => ({ ...prev, [vars.testId]: vars.status }));
      qc.invalidateQueries({ queryKey: ['test-statuses', featureId] });
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      // Prefix invalidation — catches both `['feature-stats', moduleId]`
      // (FeaturesPage list rollup) and `['feature-stats', featureId, envId]`
      // (FeaturePage's own summary card) in one shot.
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
      qc.invalidateQueries({ queryKey: ['module-stats'] });
      qc.invalidateQueries({ queryKey: ['project-stats'] });
      qc.invalidateQueries({ queryKey: ['work-session-current'] });
      toast.success(
        vars.status === 'PASSED' ? 'Marked as passed' : 'Marked as failed',
        'Result saved to your work session.',
      );
    },
    onError: (err: unknown, vars) => {
      // Roll back optimistic update
      setQuickMarkStatus(prev => {
        const next = { ...prev };
        delete next[vars.testId];
        return next;
      });
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to mark test', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  // Soft-delete a test definition. The backend's archive endpoint sets
  // isActive=false + deletedAt; future list queries filter it out so the
  // row disappears immediately. Reversible from the test editor when we
  // wire restore there too — for now restore is API-only.
  const archiveTest = useMutation({
    mutationFn: (testId: string) => testsApi.archive(projectId!, testId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      qc.invalidateQueries({ queryKey: ['test-statuses', featureId] });
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
      toast.success('Test archived', 'Past runs are preserved.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not archive test', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  // ── Bulk selection on tests table ──────────────────────────────────────────
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(new Set());
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkMoveTarget, setBulkMoveTarget] = useState<string>('');

  const toggleSelectTest = (id: string) => {
    setSelectedTestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: projectFeatures = [] } = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId!),
    enabled: !!projectId && bulkMoveOpen,
    staleTime: 30_000,
  });

  const bulkArchiveTests = useMutation({
    mutationFn: (ids: string[]) => testsApi.bulkArchive(projectId!, ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      qc.invalidateQueries({ queryKey: ['test-statuses', featureId] });
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
      toast.success(`Archived ${res.archived} test${res.archived !== 1 ? 's' : ''}`, 'Past runs are preserved.');
      setSelectedTestIds(new Set());
      setBulkArchiveOpen(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Bulk archive failed', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  const bulkMoveTests = useMutation({
    mutationFn: ({ ids, target }: { ids: string[]; target: string }) => testsApi.bulkMove(projectId!, ids, target),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      qc.invalidateQueries({ queryKey: ['test-statuses'] });
      qc.invalidateQueries({ queryKey: ['feature-stats'] });
      toast.success(`Moved ${res.moved} test${res.moved !== 1 ? 's' : ''}`);
      setSelectedTestIds(new Set());
      setBulkMoveOpen(false);
      setBulkMoveTarget('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Bulk move failed', typeof msg === 'string' ? msg : 'Please try again.');
    },
  });

  type StartFeatureRunVars = {
    runMode?: 'AUTOMATED' | 'MANUAL';
    environmentId?: string;
    openTestingView?: boolean;
    /** Set true after the conflict modal's "End previous and start new"
     *  has abandoned the prior run — server then bypasses the guard. */
    allowConcurrent?: boolean;
  };

  // Server returns 409 with this shape when the user already has an active
  // manual session anywhere. Frontend stores the payload and renders the
  // conflict modal so the user picks Resume / End-and-start / Cancel.
  type ActiveRunConflict = {
    id: string;
    featureId: string;
    featureName: string;
    moduleId: string;
    projectId: string;
    startedAt: string;
    sameFeature: boolean;
  };
  const [conflict, setConflict] = useState<{ run: ActiveRunConflict; pendingVars: StartFeatureRunVars | undefined } | null>(null);

  const startRun = useMutation({
    mutationFn: (vars?: StartFeatureRunVars) => {
      const mode = vars?.runMode ?? runMode;
      const envId = vars?.environmentId ?? selectedEnvId;
      return featureRunsApi.start(featureId!, {
        environmentId: envId,
        runMode: mode,
        ...(vars?.allowConcurrent ? { allowConcurrent: true } : {}),
      });
    },
    onSuccess: (data: { featureRun?: { id: string }; testRuns?: { id: string }[] }, vars?: StartFeatureRunVars) => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      qc.invalidateQueries({ queryKey: ['my-active-runs'] });
      setRunOpen(false);
      const mode = vars?.runMode ?? runMode;
      // Both modes land in TestingView — the canonical rich surface (sidebar,
      // floating actions, fullscreen iframe, description-driven manual).
      // Caller can opt out via openTestingView=false.
      if (vars?.openTestingView !== false) {
        const params = new URLSearchParams({ mode });
        if (data?.featureRun?.id) params.set('runId', data.featureRun.id);
        if (data?.testRuns?.[0]?.id) params.set('testRunId', data.testRuns[0].id);
        navigate(`/projects/${projectId}/features/${featureId}/test?${params.toString()}`);
        toast.success(
          mode === 'AUTOMATED' ? 'Automated feature run started' : 'Manual session started',
          mode === 'AUTOMATED' ? 'Opening live Playwright preview.' : 'Step through tests and mark pass/fail.',
        );
        return;
      }
      toast.success('Testing started', 'Step through each test case and mark pass/fail.');
    },
    onError: (err: unknown, vars?: StartFeatureRunVars) => {
      // 409 with payload → open the conflict modal rather than a generic
      // error toast. The user sees what the conflict is and can choose.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { code?: string; activeRun?: ActiveRunConflict } } })?.response?.data;
      if (status === 409 && data?.code === 'ACTIVE_SESSION_CONFLICT' && data.activeRun) {
        // Close the chooser first — otherwise the conflict modal stacks
        // behind it and the user appears stuck on a non-responsive form.
        setRunOpen(false);
        setConflict({ run: data.activeRun, pendingVars: vars });
        return;
      }
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(
        'Failed to start testing',
        typeof msg === 'string' ? msg : 'Please try again or pick a different environment.',
      );
    },
  });

  // Single-test run (triggers one test definition directly, not via a FeatureRun)
  const startSoloRun = useMutation({
    mutationFn: () =>
      runsApi.trigger(projectId!, {
        testDefinitionId: soloTest?.id as string,
        environmentId: soloEnvId,
        // Force MANUAL when the feature has automated disabled — defence
        // in depth even though the AUTOMATED button is hidden in the
        // picker above. Backend would 400 either way with a clear hint.
        runMode: automatedEnabled ? soloRunMode : 'MANUAL',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      setSoloTest(null);
    },
  });

  const pauseRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.pause(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-runs', featureId] }),
  });
  const resumeRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.resume(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-runs', featureId] }),
  });
  const stopRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.stop(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feature-runs', featureId] }),
  });

  // End-current-session mutations. Separate from `stopRun` above so we can
  // give them dedicated success/error toasts + invalidate the *global*
  // active-runs query (powers the TopNav pill) — without that the pill
  // shows a stale count until its 60s poll tick.
  // MANUAL → abandon (no worker browser to clean up).
  // AUTOMATED → stop (worker listens for status=CANCELLED, tears down Playwright).
  const stopActiveRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.stop(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      qc.invalidateQueries({ queryKey: ['my-active-runs'] });
      toast.success('Session ended', 'Automated run cancelled — Playwright is shutting down.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to end session', typeof msg === 'string' ? msg : 'Try again.');
    },
  });
  const abandonActiveRun = useMutation({
    mutationFn: (id: string) => featureRunsApi.abandon(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      qc.invalidateQueries({ queryKey: ['my-active-runs'] });
      toast.success('Session ended', 'Manual session closed.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to end session', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const signoffRun = useMutation({
    mutationFn: (vars: { id: string; decision: 'APPROVED' | 'REJECTED'; note?: string }) =>
      featureRunsApi.signoff(vars.id, { decision: vars.decision, note: vars.note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      setSignoffModal(null);
      setSignoffNote('');
      toast.success('Sign-off recorded', 'The run is now ready to promote.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Sign-off failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const promoteRun = useMutation({
    mutationFn: (vars: { id: string; targetEnvironmentId: string; runMode?: 'AUTOMATED' | 'MANUAL'; note?: string }) =>
      featureRunsApi.promote(vars.id, {
        targetEnvironmentId: vars.targetEnvironmentId,
        runMode: vars.runMode,
        note: vars.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      setPromoteModal(null);
      setPromoteTargetEnvId('');
      toast.success('Promoted', 'New run created in the target environment.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Promotion failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const featureRunsList = featureRuns as FeatureRun[];
  const environmentsList = envs as Environment[];

  // Auto-select the first environment as soon as the list loads so the
  // "Test Feature" modal doesn't make users pick from a one-item dropdown.
  // Only sets if user hasn't picked one yet.
  useEffect(() => {
    if (!selectedEnvId && environmentsList.length > 0) {
      setSelectedEnvId(environmentsList[0].id);
    }
  }, [environmentsList, selectedEnvId]);

  // (auto-open-testMode effect lives further down — after featureTests + activeRun are declared)

  // Find active (running/paused) feature run
  const activeRun = featureRunsList.find(
    fr => fr.status === 'RUNNING' || fr.status === 'PAUSED',
  );

  const isManualRun = activeRun?.runMode === 'MANUAL';

  // ManualPlayer gets key=activeRun.id so React unmounts+remounts it with
  // fresh state each time a new run starts — no manual state reset needed

  // Live socket updates — must be called before any conditional return
  useFeatureRunSocket(featureId, activeRun?.id ?? null);

  // ?testMode=1 auto-open handler — must be before the conditional return below
  const autoOpenRan = useRef(false);
  const hasTestsForAutoOpen = (tests as Record<string, unknown>[])
    .some(t => (t.featureId as string | null) === featureId);
  useEffect(() => {
    if (!autoOpenTestMode || autoOpenRan.current) return;
    if (environmentsList.length === 0 || !hasTestsForAutoOpen) return;
    autoOpenRan.current = true;
    const sp = new URLSearchParams(searchParams);
    sp.delete('testMode');
    setSearchParams(sp, { replace: true });
    if (activeRun) {
      navigate(buildTestingViewUrl('MANUAL'));
    } else {
      const envId = selectedEnvId || environmentsList[0].id;
      setRunMode('MANUAL');
      startRun.mutate(
        { runMode: 'MANUAL', environmentId: envId, openTestingView: false },
        { onSuccess: () => navigate(buildTestingViewUrl('MANUAL')) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenTestMode, environmentsList.length, hasTestsForAutoOpen, activeRun?.id]);

  // Per-test latest-run status — fetched from the dedicated endpoint that
  // covers quick-marks, manual testing sessions, AND automated FeatureRuns
  // (not just the last FeatureRun's testRuns). Must be above the early
  // return so the hook count is stable across renders.
  const { data: latestTestStatuses } = useQuery({
    queryKey: ['test-statuses', featureId, activeEnvId ?? null],
    queryFn: () => testsApi.getLatestStatuses(featureId!, activeEnvId),
    staleTime: 30_000,
    enabled: !!featureId,
  });

  if (featureLoading) return <PageSpinner />;

  const f = feature as Record<string, unknown> | undefined;
  // Per-feature automated-testing flag (default false at DB level). Drives
  // the Run modals' mode pickers — when false, the AUTOMATED option is
  // hidden and runMode/soloRunMode default to MANUAL. Backend rejects
  // AUTOMATED triggers regardless, but hiding the option is the kinder UX.
  const automatedEnabled = Boolean((f as { automatedTestingEnabled?: boolean } | undefined)?.automatedTestingEnabled);
  const ds = draftStatus as {
    isDraft?: boolean;
    hasUnpublishedChanges?: boolean;
    activeVersion?: { label: string; name: string };
  } | undefined;
  const featureTests = (tests as Record<string, unknown>[]).filter(
    t => (t.featureId as string | null) === featureId,
  );

  const hasActiveVersion = !!(ds?.activeVersion);
  const hasChanges = !!(ds?.hasUnpublishedChanges);

  // Helper: build the URL into TestingView for the currently-active run.
  // Including `testRunId` (the running TestRun id, not the FeatureRun id) lets
  // TestingView subscribe to the screencast stream immediately on mount —
  // without it the canvas waits for the next polling cycle to discover what's
  // running, which made "Resume Live Run" appear blank for several seconds.
  const buildTestingViewUrl = (mode: 'AUTOMATED' | 'MANUAL') => {
    if (!activeRun) return `/projects/${projectId}/features/${featureId}/test?mode=${mode}`;
    const params = new URLSearchParams({ mode, runId: activeRun.id });
    const running = activeRun.testRuns?.find(t => t.status === 'RUNNING');
    const initial = running?.id ?? activeRun.testRuns?.[0]?.id;
    if (initial) params.set('testRunId', initial);
    return `/projects/${projectId}/features/${featureId}/test?${params.toString()}`;
  };

  // Summary card stats — sourced from StatsService.computeFeatureStats
  // (which queries TestRun records directly per the test definition list,
  // taking each test's most-recent terminal run). Counts EVERY pathway:
  // quick-mark / manual /  automated. Previous implementation derived
  // these from `completedRuns[0].testRuns` and missed quick-marks entirely
  // because TestRun.featureRunId is null on manual quick-marks.
  // `completedRuns` was previously used to gate the Passed / Failed cards
  // on "did a FeatureRun complete?" — but the counts come from per-test
  // most-recent runs, so that gate hid numbers that the donut beside it
  // was already showing. The gate was removed; this variable is no longer
  // referenced but the totalRuns count below is still used in the
  // Pass Rate sub-label, so the filter stays as documentation of intent.
  const totalRuns = featureRunsList.length;
  const totalPassed = featureStatsData?.passed ?? 0;
  const totalFailed = featureStatsData?.failed ?? 0;
  const totalSkipped = featureStatsData?.skipped ?? 0;
  const totalTests = featureStatsData?.total ?? featureTests.length;
  const passRate = featureStatsData?.passRate ?? null;
  const totalOutstanding = featureStatsData?.outstanding ?? Math.max(0, totalTests - totalPassed - totalFailed - totalSkipped);

  // (latestTestStatuses query was here previously — moved up above the
  // `if (featureLoading) return …` early-return guard. Calling a hook AFTER
  // a conditional return violates the Rules of Hooks: the first render
  // returns the spinner before the hook is reached, the second render
  // (after `featureLoading` flips to false) DOES call it — so React sees a
  // hook-count mismatch and the ErrorBoundary catches "Rendered more
  // hooks than during the previous render". Clicking "Try again" worked
  // because by then the spinner phase was skipped entirely. Keeping the
  // hook above the early return makes both renders identical.)

  // Merge persisted statuses with any optimistic local quick-mark overlays
  const testStatusMap = new Map<string, string>();
  // Structured failure reason per test (latest run) — drives "View reason".
  const testFailureMap = new Map<string, { category: string | null; note: string | null }>();
  for (const row of (latestTestStatuses ?? [])) {
    testStatusMap.set(row.testDefinitionId, row.status);
    if (row.status === 'FAILED' && (row.failureCategory || row.failureNote)) {
      testFailureMap.set(row.testDefinitionId, { category: row.failureCategory, note: row.failureNote });
    }
  }
  for (const [testId, status] of Object.entries(quickMarkStatus)) {
    testStatusMap.set(testId, status);
  }

  const moduleDropdownItems = allModules.map((m: { id: string; name: string }) => ({
    id: m.id,
    name: m.name,
    href: `/projects/${projectId}/modules/${m.id}/features`,
  }));

  const featureDropdownItems = allFeatures.map((feat: { id: string; name: string }) => ({
    id: feat.id,
    name: feat.name,
    href: `/projects/${projectId}/modules/${moduleId}/features/${feat.id}`,
  }));

  const moduleName = allModules.find((m: { id: string; name: string }) => m.id === moduleId)?.name ?? 'Module';

  return (
    <div className="space-y-5">
      {/* Nav breadcrumb + action toolbar — stacked into two rows so the
          buttons get a full row instead of squeezing against the breadcrumb. */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {/* Module switcher */}
          <NavDropdown
            label={moduleName}
            backTo={`/projects/${projectId}`}
            backLabel="Project"
            items={moduleDropdownItems}
            activeId={moduleId!}
            loading={modulesLoading}
          />
          <span style={{ color: 'rgba(238,238,248,0.25)' }}>/</span>
          {/* Feature switcher */}
          <NavDropdown
            label={(f?.name as string) ?? 'Feature'}
            backTo={`/projects/${projectId}/modules/${moduleId}/features`}
            backLabel="Features"
            items={featureDropdownItems}
            activeId={featureId!}
            loading={featuresLoading}
          />
        </div>

        {/* Action toolbar — its own row; wraps gracefully if still tight */}
        <div className="flex items-center flex-wrap gap-2">
          <ExportButton level="feature" id={featureId!} name={(f?.name as string) ?? 'feature'} />
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import
            </Button>
          )}
          {!hasActiveVersion ? (
            <>
              <Badge variant="warning">
                <AlertTriangle size={11} /> Unpublished draft
              </Badge>
              {canManage && (
                <Button
                  onClick={() => setPublishOpen(true)}
                  disabled={featureTests.length === 0}
                >
                  <GitBranch size={14} /> Publish v1.0…
                </Button>
              )}
            </>
          ) : hasChanges ? (
            <>
              <Badge variant="warning">
                <AlertTriangle size={11} /> Draft has changes
              </Badge>
              {canManage && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => restore.mutate(ds!.activeVersion as unknown as string)}
                  >
                    Discard changes
                  </Button>
                  <Button onClick={() => setPublishOpen(true)}>
                    <GitBranch size={14} /> Publish as v{(versions as VersionInfo[]).length + 1}.0…
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Badge variant="success">
                <CheckCircle size={11} /> {ds?.activeVersion?.label} — {ds?.activeVersion?.name}
              </Badge>
              <Button variant="secondary" onClick={() => setHistoryOpen(true)}>
                <History size={14} /> Version history
              </Button>
            </>
          )}
          {/* Single entry point. Mode (Manual vs Automated) is chosen *inside*
              the modal — the earlier dual-button toolbar made it look like
              users could run both simultaneously, which the FeatureRun model
              doesn't support (one run = one mode for its lifetime). When a
              run is already active, the primary button resumes it and a
              secondary "Switch mode" link aborts + reopens the chooser. */}
          <Button
            variant="secondary"
            onClick={() => navigate(`/projects/${projectId}/runs?featureId=${featureId}`)}
            title="View every test run recorded for this feature"
          >
            <History size={14} /> Test Runs
          </Button>
          {activeRun ? (
            <>
              {/* Active run: hide Start, expose Resume + End. End uses the
                  mode-appropriate verb (abandon for MANUAL, stop for
                  AUTOMATED — matches what the worker / state machine expects).
                  Switch-mode is reachable indirectly: end the current run,
                  then Start Testing again in the other mode. */}
              <Button
                onClick={() => navigate(buildTestingViewUrl((activeRun.runMode as 'AUTOMATED' | 'MANUAL') ?? 'MANUAL'))}
                title={`A ${activeRun.runMode === 'MANUAL' ? 'manual' : 'automated'} run started ${formatDate((activeRun as { startedAt?: string; createdAt?: string }).startedAt ?? (activeRun as { createdAt?: string }).createdAt ?? '')} is still active — click to resume`}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                Resume Current Session
              </Button>
              <Button
                variant="secondary"
                loading={abandonActiveRun.isPending || stopActiveRun.isPending}
                onClick={() => {
                  if (!confirm(`End this ${activeRun.runMode === 'MANUAL' ? 'manual' : 'automated'} session? Any in-progress steps will be cancelled.`)) return;
                  if (activeRun.runMode === 'MANUAL') {
                    abandonActiveRun.mutate(activeRun.id);
                  } else {
                    stopActiveRun.mutate(activeRun.id);
                  }
                }}
                title="End the active session — closes the run and unlocks the chooser"
                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
              >
                <Square size={13} /> End Current Session
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                if (environmentsList.length === 0) { setNoEnvWarning(true); return; }
                if (featureTests.length === 0) {
                  toast.error('No test cases', 'Add at least one test case before starting.');
                  return;
                }
                if (!hasActiveVersion) {
                  toast.error('Feature not published', 'Publish this feature before starting a test session.');
                  setPublishOpen(true);
                  return;
                }
                // `hasChanges` is surfaced by the "Draft has changes" badge above; no toast needed.
                if (!selectedEnvId) setSelectedEnvId(environmentsList[0].id);
                setRunMode('MANUAL');
                setRunOpen(true);
              }}
              title="Start a testing session — pick Manual or Automated in the next step"
            >
              <Play size={14} /> Test
            </Button>
          )}
        </div>
      </div>

      {f ? (
      <div
        className="flex items-center gap-5 rounded-2xl p-5 mb-3"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        }}
      >
        <ProgressDonut
          stats={{
            passed: totalPassed,
            failed: totalFailed,
            skipped: totalSkipped,
            outstanding: totalOutstanding,
            total: totalTests,
          }}
          size={148}
        />

        <div className="flex-1 grid grid-cols-2 gap-3">
          <StatCard
            icon={<ListChecks size={15} style={{ color: '#a78bfa' }} />}
            iconBg="rgba(139,92,246,0.20)"
            label="Test Cases"
            value={featureTests.length}
            valueColor="rgba(238,238,248,0.92)"
          />
          <StatCard
            icon={<TrendingUp size={15} style={{ color: '#fbbf24' }} />}
            iconBg="rgba(245,158,11,0.18)"
            label="Pass Rate"
            value={passRate !== null ? `${passRate}%` : '—'}
            valueColor={passRate === null ? 'rgba(238,238,248,0.40)' : passRate >= 80 ? '#34d399' : passRate >= 50 ? '#fbbf24' : '#f87171'}
            sub={totalRuns > 0 ? `${totalRuns} run${totalRuns !== 1 ? 's' : ''}` : undefined}
          />
          {/* Passed / Failed: sourced from featureStatsData (per-test most-
              recent terminal run — counts quick-marks, manual, automated,
              and feature-run-attached results alike). Previously gated on
              a completed FeatureRun, which made these blank whenever the
              tester quick-marked tests outside an orchestrated feature
              run — even though the donut beside them was already showing
              the numbers correctly. The two views are now consistent. */}
          <StatCard
            icon={<CheckCircle size={15} style={{ color: '#34d399' }} />}
            iconBg="rgba(16,185,129,0.18)"
            label="Passed"
            value={totalPassed}
            valueColor={totalPassed > 0 ? '#34d399' : 'rgba(238,238,248,0.40)'}
            sub={totalTests > 0 ? `of ${totalTests}` : undefined}
          />
          <StatCard
            icon={<XCircle size={15} style={{ color: '#f87171' }} />}
            iconBg="rgba(239,68,68,0.18)"
            label="Failed"
            value={totalFailed}
            valueColor={totalFailed > 0 ? '#f87171' : 'rgba(238,238,248,0.40)'}
            sub={totalTests > 0 ? `of ${totalTests}` : undefined}
          />
          <StatCard
            icon={<Bug size={15} style={{ color: '#fb7185' }} />}
            iconBg="rgba(251,113,133,0.18)"
            label="Open Bugs"
            value={featureIssueStats?.open ?? 0}
            valueColor={featureIssueStats && featureIssueStats.open > 0 ? '#fb7185' : 'rgba(238,238,248,0.40)'}
            sub={featureIssueStats && featureIssueStats.total > 0 ? `${featureIssueStats.total} total` : undefined}
          />
        </div>
      </div>
      ) : null}

      {/* External tracker bindings (ClickUp / Jira via plugin) — always-visible
          below the metrics, above the tabs. Panel fetches its own data via
          /features/:id/ticket-links so adding it doesn't require feature
          payload changes. Renders nothing when no bindings exist, so it's
          a no-op for features without plugin integration. */}
      {featureId && <TicketLinksPanel scope="feature" scopeId={featureId} />}

      <WorkbenchTabs
        value={featureWorkbenchTab}
        onValueChange={id => setFeatureWorkbenchTab(id as 'tests' | 'insights' | 'docs' | 'settings')}
        tabs={[
          {
            id: 'tests',
            label: 'Tests & evidence',
            description: 'Walk test cases with quick actions — evidence thumbnails stay beside the list.',
          },
          {
            id: 'insights',
            label: 'Reports & quality',
            description: 'Snapshot report, searchable issues, runs, sign-off, and promotion.',
          },
          {
            id: 'docs',
            label: 'Docs',
            description: 'Feature-level specs and notes. Manual markdown or linked from ClickUp.',
          },
          {
            id: 'settings',
            label: 'Settings',
            description: 'Per-feature toggles — automated testing on/off, defaults, etc.',
          },
        ]}
      />

      {featureWorkbenchTab === 'docs' && featureId && (
        <ScopedDocsPanel scope="feature" scopeId={featureId} />
      )}

      {featureWorkbenchTab === 'settings' && featureId && f && (
        <FeatureSettingsPanel
          featureId={featureId}
          automatedTestingEnabled={Boolean((f as { automatedTestingEnabled?: boolean }).automatedTestingEnabled)}
          canManage={canManage}
          featureName={String((f as { name?: string }).name ?? 'this feature')}
        />
      )}

      {featureWorkbenchTab === 'insights' && f ? (
      <>
      {/* Latest report — top of overview per user's chosen layout (#1).
          Tiny surface that surfaces the most-recent feature-scoped report.
          [View all reports →] inside the card deep-links to the project
          Reports tab pre-filtered to this feature (context preserved). */}
      <LatestReportCard
          projectId={projectId!}
          scope={{
            type: 'FEATURE',
            featureId: (f as { id: string }).id,
            moduleId: (f as { moduleId?: string }).moduleId,
          }}
        />

      <ScopedIssuesPanel
        scope="feature"
        projectId={projectId!}
        moduleId={moduleId!}
        featureId={featureId!}
        title="Issues"
      />

      {/* Feature run history (quality tab) */}
      <Card>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <h3 className="font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Run History</h3>
        </div>
        {featureRunsList.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={Play}
              title="No feature runs"
              description="Run the feature to see orchestrated test results here."
            />
          </CardContent>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Status</Th>
                <Th>Mode</Th>
                <Th>Env</Th>
                <Th>Tests</Th>
                <Th>Duration</Th>
                <Th>Started</Th>
                <Th>Sign-off / Promote</Th>
              </Tr>
            </Thead>
            <Tbody>
              {featureRunsList.map(fr => {
                const passed = fr.testRuns.filter(r => r.status === 'PASSED').length;
                const total = fr.testRuns.length;
                const allPassed = total > 0 && passed === total && fr.status === 'COMPLETE';
                const fullFr = fr as typeof fr & {
                  environment?: { id: string; name: string; type: string };
                  signoffs?: Array<{ id: string; decision: string; signedAt: string; signedBy: { name: string } }>;
                  promotedFromId?: string | null;
                };
                const lastSignoff = fullFr.signoffs?.[0];
                const isApproved = lastSignoff?.decision === 'APPROVED';
                return (
                  <Tr key={fr.id}>
                    <Td>
                      <RunStatusBadge status={fr.status} />
                      {fullFr.promotedFromId && (
                        <span className="ml-1.5" title="Promoted from a previous environment">
                          <Badge variant="muted">↳ promoted</Badge>
                        </span>
                      )}
                    </Td>
                    <Td>
                      {fr.runMode === 'MANUAL' && <Badge variant="muted">MANUAL</Badge>}
                    </Td>
                    <Td>
                      {fullFr.environment ? (
                        <Badge variant="default">{fullFr.environment.name}</Badge>
                      ) : (
                        <span className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>—</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-sm font-medium"
                        style={{ color: passed === total && total > 0 ? '#34d399' : passed === 0 ? 'rgba(238,238,248,0.55)' : '#fbbf24' }}>
                        {passed}/{total} passed
                      </span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        {formatDuration(fr.duration)}
                      </span>
                    </Td>
                    <Td>
                      <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        {formatDate(fr.createdAt)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        {lastSignoff ? (
                          <span title={`${lastSignoff.signedBy.name} · ${formatDate(lastSignoff.signedAt)}`}>
                            <Badge variant={isApproved ? 'success' : 'danger'}>
                              {isApproved ? '✓ Approved' : '✗ Rejected'}
                            </Badge>
                          </span>
                        ) : allPassed ? (
                          <button
                            onClick={() => setSignoffModal({ featureRun: fr })}
                            className="text-xs px-2 py-1 rounded-md transition-colors"
                            style={{ background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.40)', color: '#c4b5fd' }}
                            title="Approve this run for handover"
                          >
                            Sign off
                          </button>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'rgba(238,238,248,0.30)' }}>—</span>
                        )}
                        {isApproved && allPassed && (
                          <button
                            onClick={() => setPromoteModal({ featureRun: fullFr })}
                            className="text-xs px-2 py-1 rounded-md transition-colors"
                            style={{ background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.40)', color: '#7dd3fc' }}
                            title="Promote to another environment (handover)"
                          >
                            Promote →
                          </button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      {/* Per-test run history — feature-scoped. Lists every TestRun across
          all tests in this feature, newest first. Click any row → /runs/:id
          for full step + artifact detail (where failure screenshots live). */}
      {projectId && featureId && (
        <RecentRunsPanel
          projectId={projectId}
          featureId={featureId}
          title="Recent test runs"
          showTestName
          limit={20}
        />
      )}

      </>
      ) : null}

      {featureWorkbenchTab === 'tests' ? (
      <>
      {!!(f?.description) && (
        <div
          className="rounded-xl px-4 py-3"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(238,238,248,0.60)' }}>
            {f.description as string}
          </p>
        </div>
      )}

      {/* Two-column body: main test list + reports on the left, evidence
         sidebar on the right. Stacks to a single column below `lg`. The
         sidebar is `lg:col-span-1` so it takes ~1/3 of width on big screens
         — matches the user's "right of main container" request. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">

      {/* Test definitions */}
      <Card>
        <div className="px-5 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
          <h3 className="font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Test Cases</h3>
          {canManage && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={aiCheckLoading}
                onClick={() => {
                  if (aiConfigured) setAiTestsOpen(true);
                  else navigate('/org/ai-settings');
                }}
                title={
                  aiConfigured
                    ? 'Generate test cases from the feature description, attached docs, and acceptance criteria'
                    : 'AI is not configured — click to set up in Settings → AI'
                }
                style={!aiConfigured && !aiCheckLoading ? { opacity: 0.55 } : undefined}
              >
                <Sparkles className="w-3.5 h-3.5 mr-1" />
                {aiConfigured || aiCheckLoading ? 'Generate Tests' : 'Generate Tests (set up AI)'}
              </Button>
              <Link to={`/projects/${projectId}/features/${featureId}/record`}>
                <Button variant="secondary" size="sm" title="Record a new test by acting in the app">
                  <span className="w-2 h-2 rounded-full mr-1.5 inline-block" style={{ background: '#ef4444' }} /> Record Test
                </Button>
              </Link>
              <Link to={`/projects/${projectId}/tests/new/edit?featureId=${featureId}`}>
                <Button variant="secondary" size="sm">
                  + Add Test
                </Button>
              </Link>
            </div>
          )}
        </div>
        {featureTests.length === 0 ? (
          <CardContent>
            <EmptyState
              icon={FlaskConical}
              title="No test cases"
              description="Add test cases to this feature to start running them."
            />
          </CardContent>
        ) : (
          <Table>
            <Thead>
              <Tr>
                {canManage && (
                  <Th className="w-8 pl-3 pr-1">
                    <input
                      type="checkbox"
                      aria-label="Select all visible tests"
                      checked={featureTests.length > 0 && featureTests.every((t) => selectedTestIds.has(t.id as string))}
                      onChange={() => {
                        const ids = featureTests.map((t) => t.id as string);
                        const all = ids.every((id) => selectedTestIds.has(id));
                        setSelectedTestIds((prev) => {
                          const next = new Set(prev);
                          if (all) ids.forEach((id) => next.delete(id));
                          else ids.forEach((id) => next.add(id));
                          return next;
                        });
                      }}
                      className="cursor-pointer"
                    />
                  </Th>
                )}
                <Th className="w-5" />
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Type</Th>
                <Th>Steps</Th>
                <Th>Updated</Th>
                <Th className="w-44" />
              </Tr>
            </Thead>
            <Tbody>
              {featureTests.map(t => {
                const testSteps = (t.steps as Record<string, unknown>[]) ?? [];
                const isExpanded = expandedTestId === (t.id as string);
                const lastStatus = testStatusMap.get(t.id as string);
                return (
                  <Fragment key={t.id as string}>
                    {/* Main row */}
                    <Tr
                      className="group cursor-pointer"
                      onClick={() => setExpandedTestId(isExpanded ? null : (t.id as string))}
                    >
                      {canManage && (
                        <Td className="pl-3 pr-1 w-8" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`Select test ${t.name as string}`}
                            checked={selectedTestIds.has(t.id as string)}
                            onChange={() => toggleSelectTest(t.id as string)}
                            className="cursor-pointer"
                          />
                        </Td>
                      )}
                      <Td>
                        <span style={{ color: 'rgba(238,238,248,0.40)', display: 'flex', alignItems: 'center' }}>
                          {isExpanded
                            ? <ChevronRight size={14} style={{ transform: 'rotate(90deg)', transition: 'transform 0.15s' }} />
                            : <ChevronRight size={14} style={{ transition: 'transform 0.15s' }} />
                          }
                        </span>
                      </Td>
                      <Td>
                        <span className="font-medium" style={{ color: 'rgba(238,238,248,0.92)' }}>{t.name as string}</span>
                      </Td>
                      {/* Status badge — shows last run result or outstanding.
                          Failed tests get a hover "View reason" chip. */}
                      <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5">
                          <TestStatusBadge status={lastStatus} />
                          {lastStatus === 'FAILED' && testFailureMap.has(t.id as string) && (
                            <FailureReasonChip reason={testFailureMap.get(t.id as string)!} />
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge variant="muted">{t.type as string}</Badge>
                      </Td>
                      <Td>
                        <span style={{ color: 'rgba(238,238,248,0.75)' }}>{testSteps.length}</span>
                      </Td>
                      <Td>
                        <span className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
                          {formatDate(t.updatedAt as string)}
                        </span>
                      </Td>
                      <Td onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Quick Pass — marks test PASSED without entering test mode */}
                          <button
                            onClick={() => quickMark.mutate({ testId: t.id as string, status: 'PASSED' })}
                            disabled={quickMark.isPending}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                            style={{
                              background: 'rgba(52,211,153,0.15)',
                              color: '#34d399',
                              border: '1px solid rgba(52,211,153,0.28)',
                            }}
                            title="Mark as passed"
                          >
                            <CheckCircle size={11} /> Pass
                          </button>
                          {/* Quick Fail — opens the reason modal first so a
                              structured failure reason is always captured. */}
                          <button
                            onClick={() => setQuickFailModal({ testId: t.id as string, testName: t.name as string })}
                            disabled={quickMark.isPending}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                            style={{
                              background: 'rgba(239,68,68,0.15)',
                              color: '#f87171',
                              border: '1px solid rgba(239,68,68,0.28)',
                            }}
                            title="Mark as failed"
                          >
                            <XCircle size={11} /> Fail
                          </button>
                          {/* Test Mode — navigates to the full TestingView
                             page with this specific test pre-selected. If
                             there is already an active run it passes the
                             runId so the view reconnects to it. If not, it
                             starts a new manual run first. */}
                          <button
                            onClick={() => {
                              if (environmentsList.length === 0) { setNoEnvWarning(true); return; }
                              const testId = t.id as string;
                              // Reuse an active run — just navigate with it
                              if (activeRun) {
                                const p = new URLSearchParams({ mode: 'MANUAL', testCaseId: testId });
                                p.set('runId', activeRun.id);
                                navigate(`/projects/${projectId}/features/${featureId}/test?${p.toString()}`);
                                return;
                              }
                              // No active run — start one then navigate with testCaseId pre-selected
                              const envId = activeEnvId ?? selectedEnvId ?? environmentsList[0]?.id;
                              startRun.mutate(
                                { runMode: 'MANUAL', environmentId: envId, openTestingView: false },
                                {
                                  onSuccess: (data) => {
                                    const p = new URLSearchParams({ mode: 'MANUAL', testCaseId: testId });
                                    if (data?.featureRun?.id) p.set('runId', data.featureRun.id);
                                    navigate(`/projects/${projectId}/features/${featureId}/test?${p.toString()}`);
                                  },
                                },
                              );
                            }}
                            disabled={startRun.isPending}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                            style={{
                              background: 'rgba(139,92,246,0.15)',
                              color: '#c4b5fd',
                              border: '1px solid rgba(139,92,246,0.30)',
                            }}
                            title="Open this test in Test Mode"
                          >
                            <Play size={11} /> Test
                          </button>
                          {canManage && (
                            <Link
                              to={`/projects/${projectId}/tests/${t.id}/edit`}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                              style={{
                                background: 'rgba(255,255,255,0.06)',
                                color: 'rgba(238,238,248,0.60)',
                                border: '1px solid rgba(255,255,255,0.10)',
                              }}
                              onClick={e => e.stopPropagation()}
                            >
                              Edit
                            </Link>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!confirm(`Archive "${t.name as string}"? Past runs and reports are preserved — admins can restore later.`)) return;
                                archiveTest.mutate(t.id as string);
                              }}
                              disabled={archiveTest.isPending}
                              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                              style={{
                                background: 'rgba(239,68,68,0.10)',
                                color: '#fca5a5',
                                border: '1px solid rgba(239,68,68,0.25)',
                              }}
                              title="Archive this test (reversible)"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                        </div>
                      </Td>
                    </Tr>

                    {/* Expanded steps */}
                    {isExpanded && (
                      <Tr key={`${t.id as string}-steps`}>
                        <Td colSpan={canManage ? 8 : 7} style={{ padding: 0 }}>
                          <div
                            style={{
                              background: 'rgba(124,58,237,0.04)',
                              borderTop: '1px solid rgba(255,255,255,0.05)',
                              borderBottom: '1px solid rgba(255,255,255,0.05)',
                            }}
                          >
                            {testSteps.length === 0 ? (
                              <div className="px-8 py-4 text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
                                No steps defined yet.
                              </div>
                            ) : (
                              <div className="px-8 py-3 space-y-1.5">
                                {testSteps.map((step, idx) => {
                                  const s = step as RunStep;
                                  const instruction = stepInstruction(s);
                                  return (
                                    <div key={s.id ?? idx} className="flex items-start gap-3">
                                      {/* Step number */}
                                      <span
                                        className="shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold tabular-nums mt-0.5"
                                        style={{
                                          background: 'rgba(124,58,237,0.15)',
                                          color: '#a78bfa',
                                          border: '1px solid rgba(124,58,237,0.25)',
                                        }}
                                      >
                                        {idx + 1}
                                      </span>
                                      {/* Step type badge */}
                                      <span
                                        className="shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 mt-0.5 uppercase tracking-wide"
                                        style={{
                                          background: 'rgba(255,255,255,0.06)',
                                          color: 'rgba(238,238,248,0.45)',
                                          border: '1px solid rgba(255,255,255,0.08)',
                                        }}
                                      >
                                        {s.type}
                                      </span>
                                      {/* Instruction */}
                                      <span className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.70)' }}>
                                        {s.name ? (
                                          <>
                                            <span className="font-medium" style={{ color: 'rgba(238,238,248,0.88)' }}>{s.name}</span>
                                            {instruction !== s.name && (
                                              <span style={{ color: 'rgba(238,238,248,0.40)' }}> — {instruction}</span>
                                            )}
                                          </>
                                        ) : (
                                          instruction
                                        )}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </Td>
                      </Tr>
                    )}
                  </Fragment>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Card>

      </div>{/* /left main column */}

      {/* Right sidebar — Evidence & Issues. `sticky top` keeps it visible
         while the user scrolls a long test list, so logged bugs are always
         one glance away. */}
      <aside className="lg:col-span-1">
      <div className="lg:sticky lg:top-20">

      {/* ── Evidence & Issues card ───────────────────────────────────────────
         Surfaces every issue logged against this feature plus the screenshots
         and recordings attached to them. Without this card, testers had no
         way to find their captured evidence after closing the Testing Mode
         panel — the data existed in the DB but wasn't reachable from the
         feature overview, which made audits painful. */}
      {(() => {
        type IssueRow = {
          id: string; type: string; status: string; severity: string; title: string;
          description?: string | null; screenshotUrls?: string[]; recordingUrl?: string | null;
          createdAt: string;
          testDefinitionId?: string | null;
          testRunId?: string | null;
          runStepId?: string | null;
          testDefinition?: { id: string; name: string } | null;
          createdBy?: { id: string; name: string } | null;
        };
        // Resolve the best deep-link for an issue. Priority:
        //   1. testRunId  → /runs/:id (full step view, screenshots, errors)
        //   2. testDefinitionId → test editor page
        //   3. fall back to feature page anchor (no-op)
        const issueHref = (i: IssueRow): string | null => {
          if (i.testRunId) return `/runs/${i.testRunId}`;
          if (i.testDefinitionId) return `/projects/${projectId}/tests/${i.testDefinitionId}/edit`;
          return null;
        };
        const issues: IssueRow[] = sortedEvidenceIssues;
        const totalScreenshots = issues.reduce((n, i) => n + (i.screenshotUrls?.length ?? 0), 0);
        const totalRecordings = issues.filter(i => !!i.recordingUrl).length;
        const openCount = issues.filter(i => i.status === 'OPEN').length;
        return (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Bug size={14} style={{ color: '#a78bfa' }} />
                  <CardTitle>Evidence &amp; Issues</CardTitle>
                  <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    {issues.length} total · {openCount} open · {totalScreenshots} screenshot{totalScreenshots === 1 ? '' : 's'} · {totalRecordings} recording{totalRecordings === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {issues.length === 0 ? (
                <div className="text-sm text-center py-8" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  No issues logged for this feature yet. Use the Capture / Record buttons in Testing Mode to file one.
                </div>
              ) : (
                <div className="space-y-2">
                  {issues.slice(0, 20).map(issue => {
                    const screens = issue.screenshotUrls ?? [];
                    const sevColor =
                      issue.severity === 'CRITICAL' ? '#ef4444'
                      : issue.severity === 'HIGH' ? '#f97316'
                      : issue.severity === 'MEDIUM' ? '#f59e0b'
                      : '#94a3b8';
                    const statusColor =
                      issue.status === 'OPEN' ? '#fb7185'
                      : issue.status === 'IN_PROGRESS' ? '#fbbf24'
                      : issue.status === 'RESOLVED' || issue.status === 'CLOSED' ? '#34d399'
                      : '#94a3b8';
                    return (
                      <div
                        key={issue.id}
                        className="rounded-xl p-3 transition-colors hover:bg-white/[0.02]"
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          {/* Thumbnails strip — first 3 screenshots, click to open lightbox */}
                          <div className="flex gap-1.5 shrink-0">
                            {screens.slice(0, 3).map((url, i) => (
                              <a
                                key={i}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block w-14 h-14 rounded-lg overflow-hidden ring-1 ring-white/10 hover:ring-violet-400/60 transition-all"
                                style={{ background: 'rgba(0,0,0,0.4)' }}
                                title="Open full screenshot"
                              >
                                <img src={url} alt="" className="w-full h-full object-cover" />
                              </a>
                            ))}
                            {screens.length > 3 && (
                              <div
                                className="w-14 h-14 rounded-lg flex items-center justify-center text-xs"
                                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.55)' }}
                              >
                                +{screens.length - 3}
                              </div>
                            )}
                            {issue.recordingUrl && (
                              <a
                                href={issue.recordingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-14 h-14 rounded-lg flex flex-col items-center justify-center text-[10px] gap-0.5 ring-1 ring-violet-400/30 hover:ring-violet-400/70 transition-all"
                                style={{ background: 'rgba(139,92,246,0.10)', color: '#c4b5fd' }}
                                title="Play recording"
                              >
                                <Video size={16} />
                                <span>video</span>
                              </a>
                            )}
                          </div>

                          {/* Body */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: `${sevColor}20`, color: sevColor, border: `1px solid ${sevColor}40` }}
                              >
                                {issue.severity}
                              </span>
                              <span
                                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}38` }}
                              >
                                {issue.status.replace(/_/g, ' ')}
                              </span>
                              <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.4)' }}>
                                {issue.type}
                              </span>
                              {issue.testDefinition?.name && (
                                <span className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.50)' }}>
                                  on: {issue.testDefinition.name}
                                </span>
                              )}
                            </div>
                            <IssueRowActionsMenu
                              issueId={issue.id}
                              projectId={projectId!}
                              featureId={featureId!}
                              status={issue.status}
                              testDefinitionId={issue.testDefinitionId}
                              testRunId={issue.testRunId}
                              runStepId={issue.runStepId}
                            />
                            </div>
                            <Link
                              to={`/issues/${issue.id}`}
                              className="text-sm font-medium truncate block hover:underline"
                              style={{ color: 'rgba(238,238,248,0.92)' }}
                              title="Open dedicated issue page"
                            >
                              {issue.title}
                            </Link>
                            {issue.description && (
                              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgba(238,238,248,0.55)' }}>
                                {issue.description}
                              </p>
                            )}
                            <div className="flex items-center gap-2 text-[10px] mt-1.5" style={{ color: 'rgba(238,238,248,0.4)' }}>
                              <span>{formatDate(issue.createdAt)}</span>
                              {issue.createdBy?.name && <><span>·</span><span>{issue.createdBy.name}</span></>}
                              <span>·</span>
                              <Link
                                to={`/issues/${issue.id}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:opacity-90"
                                style={{ background: 'rgba(251,113,133,0.12)', border: '1px solid rgba(251,113,133,0.35)', color: '#fda4af' }}
                                title="Full issue page — shareable link"
                              >
                                Issue
                              </Link>
                              {(() => {
                                const href = issueHref(issue);
                                return href ? (
                                  <>
                                    <span>·</span>
                                    <button
                                      onClick={() => navigate(href)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
                                      style={{ background: 'rgba(168,85,247,0.18)', border: '1px solid rgba(168,85,247,0.35)', color: '#c4b5fd' }}
                                      title={issue.testRunId ? 'Open run with steps + screenshots' : 'Open test definition'}
                                    >
                                      <ExternalLink size={9} />
                                      {issue.testRunId ? 'Open run' : 'Open test'}
                                    </button>
                                  </>
                                ) : null;
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {issues.length > 20 && (
                    <div className="text-xs text-center pt-2" style={{ color: 'rgba(238,238,248,0.40)' }}>
                      Showing 20 of {issues.length}. Use the Issues page for full filtering.
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      </div>{/* /sticky inner */}
      </aside>{/* /right sidebar */}
      </div>{/* /grid */}

        </>
      ) : null}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={projectId!}
        targetModuleId={moduleId!}
        targetFeatureId={featureId!}
        modules={allModules}
        features={allFeatures}
        invalidateKeys={[
          ['feature', featureId!],
          ['features', moduleId!],
          ['tests', projectId!, 'feature', featureId!],
          ['issues', projectId!, 'feature', featureId!],
          ['issue-stats', 'feature', featureId!],
          ['tests', projectId!],
          ['test-statuses', featureId!],
        ]}
      />

      {/* ── Sign-off modal ────────────────────────────────────────────────── */}
      <Modal
        open={!!signoffModal}
        onClose={() => { setSignoffModal(null); setSignoffNote(''); }}
        title="Sign off this run"
      >
        {signoffModal && (
          <div className="space-y-4">
            <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
              Recording an APPROVED sign-off is required before this run can be promoted to another environment.
            </p>
            <textarea
              value={signoffNote}
              onChange={e => setSignoffNote(e.target.value)}
              rows={3}
              placeholder="Optional note — context for the next team (e.g. UAT)…"
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(238,238,248,0.85)' }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                loading={signoffRun.isPending}
                onClick={() => signoffRun.mutate({ id: signoffModal.featureRun.id, decision: 'REJECTED', note: signoffNote || undefined })}
                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
              >
                Reject
              </Button>
              <Button
                loading={signoffRun.isPending}
                onClick={() => signoffRun.mutate({ id: signoffModal.featureRun.id, decision: 'APPROVED', note: signoffNote || undefined })}
              >
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Switch-mode modal ─────────────────────────────────────────────────
          User has an active run in mode X and wants to switch to mode Y. We
          end the current run cleanly (stop or abandon based on mode) and
          re-open the chooser modal so they pick the new mode + env. */}
      <Modal
        open={switchModeOpen}
        onClose={() => setSwitchModeOpen(false)}
        title="Switch testing mode?"
      >
        {activeRun && (() => {
          const currentMode = activeRun.runMode as 'MANUAL' | 'AUTOMATED';
          const targetMode = currentMode === 'MANUAL' ? 'AUTOMATED' : 'MANUAL';
          const switching = abandonActiveRun.isPending || stopActiveRun.isPending;
          return (
            <div className="space-y-4">
              <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}>
                You're currently in <strong>{currentMode}</strong> mode. Switching to <strong>{targetMode}</strong> will end the current run — any uncompleted steps will be marked cancelled.
              </div>
              <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.70)' }}>
                After ending, you'll be returned to the mode chooser to confirm the new run's environment and settings.
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setSwitchModeOpen(false)} disabled={switching}>
                  Cancel
                </Button>
                <Button
                  loading={switching}
                  onClick={async () => {
                    try {
                      if (currentMode === 'MANUAL') {
                        await abandonActiveRun.mutateAsync(activeRun.id);
                      } else {
                        await stopActiveRun.mutateAsync(activeRun.id);
                      }
                    } catch {
                      /* server-side error already surfaced via mutation onError */
                    }
                    setSwitchModeOpen(false);
                    setRunMode(targetMode);
                    setRunOpen(true);
                  }}
                  style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5', background: 'rgba(239,68,68,0.10)' }}
                >
                  End {currentMode.toLowerCase()} run & switch
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ── Active session conflict modal ─────────────────────────────────── */}
      {/* Shown when the server returns 409 ACTIVE_SESSION_CONFLICT — the user
          already has another manual session live somewhere. Three exits:
          Resume the existing one, end it and start the new one, or cancel. */}
      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title="You already have an active session"
      >
        {conflict && (
          <div className="space-y-4">
            <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', color: '#fbbf24' }}>
              You can only have one manual session running at a time.
              {conflict.run.sameFeature
                ? ' This is the same feature — resuming will pick up where you left off.'
                : ' Starting a new one will end the previous session.'}
            </div>
            <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>Existing session</p>
              <p className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.92)' }}>{conflict.run.featureName}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
                Started {new Date(conflict.run.startedAt).toLocaleString()}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConflict(null)}>
                Cancel
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const run = conflict.run;
                  setConflict(null);
                  // Always MANUAL here — the conflict only fires for manual
                  // sessions. Route to FeaturePage so they land in the rich
                  // ManualPlayer (the canonical surface for manual work).
                  navigate(`/projects/${run.projectId}/modules/${run.moduleId}/features/${run.featureId}?testMode=1`);
                }}
              >
                Resume existing →
              </Button>
              <Button
                loading={startRun.isPending}
                onClick={async () => {
                  const { pendingVars } = conflict;
                  // Wipe EVERY active manual session this user has, not just
                  // the one the conflict modal pointed at. A previous bug
                  // had the user looping on the modal when a third stale
                  // session lingered from a race — `endAllMine` clears
                  // them in one shot before retry.
                  try {
                    await featureRunsApi.endAllMine();
                  } catch {
                    /* even if it races, retry below with allowConcurrent will succeed */
                  }
                  qc.invalidateQueries({ queryKey: ['my-active-runs'] });
                  setConflict(null);
                  startRun.mutate({ ...(pendingVars ?? {}), allowConcurrent: true });
                }}
                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
              >
                End all my sessions & start new
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Promote modal ─────────────────────────────────────────────────── */}
      <Modal
        open={!!promoteModal}
        onClose={() => { setPromoteModal(null); setPromoteTargetEnvId(''); }}
        title="Promote run to another environment"
      >
        {promoteModal && (() => {
          const sourceEnvId = promoteModal.featureRun.environment?.id;
          const targetCandidates = environmentsList.filter(e => e.id !== sourceEnvId);
          return (
            <div className="space-y-4">
              <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(56,189,248,0.10)', border: '1px solid rgba(56,189,248,0.25)', color: '#7dd3fc' }}>
                Promoting from <strong>{promoteModal.featureRun.environment?.name ?? 'unknown'}</strong> →
                creates a fresh run in the target env using the same test definitions.
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Target environment</label>
                <select
                  value={promoteTargetEnvId}
                  onChange={e => setPromoteTargetEnvId(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.9)' }}
                >
                  <option value="">— select an environment —</option>
                  {targetCandidates.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Run mode in target env</label>
                <div className="flex gap-2">
                  {(['MANUAL', 'AUTOMATED'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPromoteRunMode(m)}
                      className="flex-1 px-3 py-2 rounded-lg text-xs"
                      style={{
                        background: promoteRunMode === m ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${promoteRunMode === m ? 'rgba(168,85,247,0.40)' : 'rgba(255,255,255,0.10)'}`,
                        color: promoteRunMode === m ? '#c4b5fd' : 'rgba(238,238,248,0.7)',
                      }}
                    >
                      {m === 'MANUAL' ? '👤 Manual' : '⚡ Automated'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  {promoteRunMode === 'MANUAL'
                    ? 'UAT team steps through tests themselves and marks pass/fail.'
                    : 'Playwright re-runs the same tests automatically against the target env.'}
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  loading={promoteRun.isPending}
                  disabled={!promoteTargetEnvId}
                  onClick={() => promoteRun.mutate({
                    id: promoteModal.featureRun.id,
                    targetEnvironmentId: promoteTargetEnvId,
                    runMode: promoteRunMode,
                  })}
                >
                  Promote run →
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Solo test run modal */}
      <Modal
        open={!!soloTest}
        onClose={() => setSoloTest(null)}
        title={`Run: ${soloTest?.name as string ?? 'Test'}`}
      >
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
            Runs only this one test in isolation — result appears in the project Run History, not the Feature run panel.
          </p>

          {/* Mode — same automated-disabled gating as the Test Feature
              modal above. Only show AUTOMATED when the feature has it on. */}
          <div className="flex gap-2">
            {((automatedEnabled ? ['AUTOMATED', 'MANUAL'] : ['MANUAL']) as Array<'AUTOMATED' | 'MANUAL'>).map(m => {
              const effective = automatedEnabled ? soloRunMode : 'MANUAL';
              return (
                <button key={m} type="button" onClick={() => setSoloRunMode(m)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
                  style={effective === m ? {
                    background: m === 'AUTOMATED' ? 'rgba(139,92,246,0.20)' : 'rgba(16,185,129,0.15)',
                    border: `1px solid ${m === 'AUTOMATED' ? 'rgba(139,92,246,0.45)' : 'rgba(16,185,129,0.40)'}`,
                    color: m === 'AUTOMATED' ? '#c4b5fd' : '#34d399',
                  } : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(238,238,248,0.45)',
                  }}
                >
                  {m === 'AUTOMATED' ? <Zap size={14} /> : <User size={14} />}
                  {m === 'AUTOMATED' ? 'Automated' : 'Manual'}
                </button>
              );
            })}
          </div>
          {!automatedEnabled && (
            <div
              className="rounded-lg px-3 py-2 flex items-start gap-2 text-[11px]"
              style={{
                background: 'rgba(148,163,184,0.10)',
                border: '1px solid rgba(148,163,184,0.22)',
                color: 'rgba(238,238,248,0.65)',
              }}
            >
              <span>
                Automated testing is disabled. Enable it in <button
                  type="button"
                  className="underline"
                  style={{ color: '#a78bfa' }}
                  onClick={() => { setSoloTest(null); setFeatureWorkbenchTab('settings'); }}
                >Settings</button> to allow Preview / automated solo runs.
              </span>
            </div>
          )}

          {/* Environment */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.60)' }}>
              Environment
            </label>
            <select
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: soloEnvId ? 'rgba(238,238,248,0.90)' : 'rgba(238,238,248,0.40)',
              }}
              value={soloEnvId}
              onChange={e => setSoloEnvId(e.target.value)}
            >
              <option value="">Select environment…</option>
              {environmentsList.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
            {soloEnvId && (() => {
              const selEnv = environmentsList.find(e => e.id === soloEnvId);
              return selEnv ? (
                <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <ExternalLink size={11} style={{ color: 'rgba(238,238,248,0.35)', flexShrink: 0 }} />
                  <span className="text-xs font-mono truncate" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    {selEnv.baseUrl}
                  </span>
                </div>
              ) : null;
            })()}
          </div>

          {/* Step count warning */}
          {soloTest && (soloTest.steps as unknown[]).length === 0 && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
              <AlertTriangle size={13} />
              This test has no steps — it will complete instantly with no assertions.
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setSoloTest(null)}>Cancel</Button>
            <Button
              loading={startSoloRun.isPending}
              disabled={!soloEnvId}
              onClick={() => startSoloRun.mutate()}
            >
              <Play size={14} /> Run Test
            </Button>
          </div>
        </div>
      </Modal>

      {/* G2 — Generate tests with AI */}
      {featureId && (
        <GenerateTestsModal
          open={aiTestsOpen}
          onClose={() => setAiTestsOpen(false)}
          featureId={featureId}
          onApplied={() => {
            setAiTestsOpen(false);
            // Refresh anything keyed on the feature's tests so the newly
            // created rows appear in the table without a manual refresh.
            qc.invalidateQueries({ queryKey: ['tests', projectId] });
            qc.invalidateQueries({ queryKey: ['feature-tests', featureId] });
            qc.invalidateQueries({ queryKey: ['feature', featureId] });
          }}
        />
      )}

      {/* Publish modal */}
      <PublishModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        name={publishName}
        onNameChange={setPublishName}
        description={publishDesc}
        onDescriptionChange={setPublishDesc}
        testCount={featureTests.length}
        loading={publish.isPending}
        onPublish={() => publish.mutate()}
      />

      {/* Version History modal */}
      <VersionHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        versions={versions as VersionInfo[]}
        onRestore={(vid) => restore.mutate(vid)}
        restoring={restore.isPending}
      />

      {/* No environment warning */}
      <NoEnvWarningModal
        open={noEnvWarning}
        onClose={() => setNoEnvWarning(false)}
        onAddEnvironment={() => {
          setNoEnvWarning(false);
          navigate(`/projects/${projectId}/environments`);
        }}
      />

      {/* Test feature modal */}
      <Modal open={runOpen} onClose={() => setRunOpen(false)} title="Test Feature">
        <div className="space-y-4">

          {/* Mode selector. When the feature has automatedTestingEnabled=false
              the AUTOMATED button is hidden entirely (backend would reject it
              anyway — hiding the option is the cleaner UX). MANUAL renders
              full-width and an inline hint points at the Settings tab. */}
          <div className="flex gap-2">
            {((automatedEnabled ? ['AUTOMATED', 'MANUAL'] : ['MANUAL']) as Array<'AUTOMATED' | 'MANUAL'>).map(m => {
              // Force MANUAL on the underlying state when the user opened
              // the modal before the toggle was switched off elsewhere.
              const effectiveMode = automatedEnabled ? runMode : 'MANUAL';
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRunMode(m)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium transition-all"
                  style={effectiveMode === m ? {
                    background: m === 'AUTOMATED' ? 'rgba(139,92,246,0.20)' : 'rgba(16,185,129,0.15)',
                    border: `1px solid ${m === 'AUTOMATED' ? 'rgba(139,92,246,0.45)' : 'rgba(16,185,129,0.40)'}`,
                    color: m === 'AUTOMATED' ? '#c4b5fd' : '#34d399',
                  } : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(238,238,248,0.45)',
                  }}
                >
                  {m === 'AUTOMATED' ? <Zap size={14} /> : <User size={14} />}
                  {m === 'AUTOMATED' ? 'Automated' : 'Manual'}
                </button>
              );
            })}
          </div>

          {!automatedEnabled && (
            <div
              className="rounded-lg px-3 py-2 flex items-start gap-2 text-[11px]"
              style={{
                background: 'rgba(148,163,184,0.10)',
                border: '1px solid rgba(148,163,184,0.22)',
                color: 'rgba(238,238,248,0.65)',
              }}
            >
              <span>
                Automated testing is <strong>disabled</strong> for this feature. Enable
                it in <button
                  type="button"
                  className="underline"
                  style={{ color: '#a78bfa' }}
                  onClick={() => { setRunOpen(false); setFeatureWorkbenchTab('settings'); }}
                >Settings</button> to allow automated runs.
              </span>
            </div>
          )}

          {runMode === 'MANUAL' && (
            <p className="text-xs px-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
              You will step through each test manually. The app opens in a side panel and you mark each step pass or fail.
            </p>
          )}
          {runMode === 'AUTOMATED' && (
            <p className="text-xs px-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
              Playwright runs all {featureTests.length} test{featureTests.length !== 1 ? 's' : ''} sequentially in a headless browser. You can watch the live stream in the Testing view.
            </p>
          )}

          {/* Environment selector */}
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.60)' }}>
              Environment {runMode === 'MANUAL' && <span style={{ color: 'rgba(238,238,248,0.35)', fontWeight: 400 }}>(optional — used for app preview)</span>}
            </label>
            <select
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: selectedEnvId ? 'rgba(238,238,248,0.90)' : 'rgba(238,238,248,0.40)',
              }}
              value={selectedEnvId}
              onChange={e => setSelectedEnvId(e.target.value)}
            >
              <option value="">Select environment…</option>
              {environmentsList.map(env => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>

            {/* Show the URL of the selected environment */}
            {selectedEnvId && (() => {
              const selEnv = environmentsList.find(e => e.id === selectedEnvId);
              if (!selEnv) return null;
              // Warn if the env URL points at the app itself — iframe will
              // show the app's UI and users think they've been redirected.
              let sameOrigin = false;
              try {
                sameOrigin = new URL(selEnv.baseUrl).origin === window.location.origin;
              } catch { /* malformed URL — skip warning */ }
              return (
                <>
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <ExternalLink size={11} style={{ color: 'rgba(238,238,248,0.35)', flexShrink: 0 }} />
                    <span className="text-xs font-mono truncate" style={{ color: 'rgba(238,238,248,0.55)' }}>
                      {selEnv.baseUrl}
                    </span>
                  </div>
                  {sameOrigin && (
                    <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-lg"
                      style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
                      <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                      <span className="text-xs leading-relaxed" style={{ color: '#fbbf24' }}>
                        This environment URL is the QA platform itself. The preview iframe will load this app — you probably want to point it at the application you're testing.
                      </span>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Requirements / validation */}
          {runMode === 'AUTOMATED' && (
            <div className="rounded-xl px-4 py-3 space-y-2"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-xs font-semibold" style={{ color: 'rgba(238,238,248,0.50)' }}>Requirements</p>
              {[
                {
                  ok: featureTests.length > 0,
                  label: `${featureTests.length} test case${featureTests.length !== 1 ? 's' : ''} defined`,
                },
                {
                  ok: !!selectedEnvId,
                  label: 'Environment selected with a base URL',
                },
                {
                  ok: featureTests.every(t => (t.steps as unknown[]).length > 0),
                  label: `All tests have at least one step`,
                  warn: featureTests.some(t => (t.steps as unknown[]).length === 0),
                  warnLabel: `${featureTests.filter(t => (t.steps as unknown[]).length === 0).length} test(s) have no steps — they will be skipped`,
                },
              ].map(({ ok, label, warn, warnLabel }) => (
                <div key={label} className="flex items-start gap-2 text-xs">
                  {ok ? (
                    <CheckCircle size={13} style={{ color: '#34d399', flexShrink: 0, marginTop: 1 }} />
                  ) : warn ? (
                    <AlertTriangle size={13} style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }} />
                  ) : (
                    <XCircle size={13} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
                  )}
                  <span style={{ color: ok ? 'rgba(238,238,248,0.70)' : warn ? '#fbbf24' : '#f87171' }}>
                    {warn ? warnLabel : label}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={startRun.isPending}
              disabled={
                (automatedEnabled && runMode === 'AUTOMATED' && !selectedEnvId)
                || featureTests.length === 0
              }
              onClick={() => startRun.mutate({
                // Force MANUAL when automated is disabled on the feature —
                // defence in depth even though the AUTOMATED button is
                // hidden. Backend would 400 either way.
                runMode: automatedEnabled ? runMode : 'MANUAL',
                environmentId: selectedEnvId,
                // Both modes navigate to TestingView now — it's the canonical
                // rich surface (sidebar, floating actions, fullscreen, manual
                // description-driven mode). Only the autoOpen-from-URL path
                // sets this false (it's already navigating elsewhere).
                openTestingView: true,
              })}
            >
              <Play size={14} /> {automatedEnabled && runMode === 'AUTOMATED' ? 'Start Automated Run' : 'Start Manual Session'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Floating active-run session card ─────────────────────────────────
         Visible whenever a run is in progress on this feature. Fixed to the
         bottom-right so the user can never lose track of an active session
         no matter where they scroll. Replaces the previous "did I already
         start one?" anxiety with concrete state + a one-click way back into
         the live view. */}
      {activeRun && (() => {
        const passed = activeRun.testRuns?.filter(t => t.status === 'PASSED').length ?? 0;
        const failed = activeRun.testRuns?.filter(t => t.status === 'FAILED').length ?? 0;
        const total = activeRun.testRuns?.length ?? 0;
        const running = activeRun.testRuns?.find(t => t.status === 'RUNNING');
        const runIdx = running ? (activeRun.testRuns ?? []).findIndex(t => t.id === running.id) + 1 : passed + failed;
        const isAuto = activeRun.runMode === 'AUTOMATED';
        const isPaused = activeRun.status === 'PAUSED';
        const openSession = () => {
          navigate(buildTestingViewUrl(isAuto ? 'AUTOMATED' : 'MANUAL'));
        };
        return (
          <div
            className="fixed bottom-5 right-5 z-40 rounded-2xl shadow-2xl"
            style={{
              background: 'rgba(18,18,32,0.96)',
              border: `1px solid ${isPaused ? 'rgba(251,191,36,0.45)' : isAuto ? 'rgba(168,85,247,0.45)' : 'rgba(56,189,248,0.45)'}`,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
              minWidth: 320,
              maxWidth: 380,
              backdropFilter: 'blur(8px)',
            }}
          >
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    'inline-block w-2 h-2 rounded-full',
                    isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse',
                  )}
                />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                  {isPaused ? 'Paused' : isAuto ? 'Live · Automated' : 'Live · Manual'}
                </span>
                <div className="flex-1" />
                <button
                  onClick={openSession}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors"
                  style={{
                    background: 'rgba(168,85,247,0.18)',
                    border: '1px solid rgba(168,85,247,0.40)',
                    color: '#c4b5fd',
                  }}
                  title={isAuto ? 'Open the live test runner view' : 'Open the manual testing view'}
                >
                  Open ↗
                </button>
              </div>
              <div className="text-sm font-semibold text-gray-100 truncate">
                {(feature as { name?: string } | undefined)?.name ?? 'Feature'}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {running
                  ? `Running test ${runIdx} of ${total}: ${running.testDefinition?.name ?? ''}`
                  : isPaused
                    ? `Paused at ${runIdx}/${total}`
                    : `${runIdx} of ${total} complete`}
              </div>
              <div className="flex items-center gap-3 text-[11px] mt-2">
                <span className="text-emerald-400">✓ {passed}</span>
                <span className="text-red-400">✗ {failed}</span>
                <span className="text-gray-500">/ {total}</span>
                <div className="flex-1" />
                {isAuto && !isPaused && (
                  <button
                    onClick={() => pauseRun.mutate(activeRun.id)}
                    disabled={pauseRun.isPending}
                    className="px-2 py-1 rounded-md text-xs transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.85)' }}
                    title="Pause the run after the current test finishes"
                  >
                    Pause
                  </button>
                )}
                {isAuto && isPaused && (
                  <button
                    onClick={() => resumeRun.mutate(activeRun.id)}
                    disabled={resumeRun.isPending}
                    className="px-2 py-1 rounded-md text-xs transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(56,189,248,0.18)', border: '1px solid rgba(56,189,248,0.40)', color: '#7dd3fc' }}
                  >
                    Resume
                  </button>
                )}
                <button
                  onClick={() => {
                    if (confirm('Stop this run? Any in-flight test will be cancelled.')) {
                      stopRun.mutate(activeRun.id);
                    }
                  }}
                  disabled={stopRun.isPending}
                  className="px-2 py-1 rounded-md text-xs transition-colors disabled:opacity-50"
                  style={{ background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}
                  title="Stop the run and cancel remaining tests"
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk action bar for tests */}
      {canManage && (
        <BulkActionBar
          count={selectedTestIds.size}
          itemLabel="test"
          onClear={() => setSelectedTestIds(new Set())}
        >
          <Button size="sm" variant="secondary" onClick={() => setBulkMoveOpen(true)}>
            Move…
          </Button>
          <Button size="sm" variant="danger" onClick={() => setBulkArchiveOpen(true)}>
            <Trash2 size={12} className="mr-1" /> Archive
          </Button>
        </BulkActionBar>
      )}

      <Modal
        open={bulkArchiveOpen}
        onClose={() => setBulkArchiveOpen(false)}
        title="Archive selected tests"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Archive <span className="font-semibold text-gray-800">{selectedTestIds.size}</span> test
            {selectedTestIds.size !== 1 ? 's' : ''}? Past runs are preserved and an admin can restore later.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBulkArchiveOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={bulkArchiveTests.isPending}
              onClick={() => bulkArchiveTests.mutate(Array.from(selectedTestIds))}
            >
              Archive
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={bulkMoveOpen}
        onClose={() => { setBulkMoveOpen(false); setBulkMoveTarget(''); }}
        title="Move tests to another feature"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Move <span className="font-semibold text-gray-800">{selectedTestIds.size}</span> test
            {selectedTestIds.size !== 1 ? 's' : ''} to:
          </p>
          <select
            value={bulkMoveTarget}
            onChange={(e) => setBulkMoveTarget(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <option value="">Select target feature…</option>
            {(() => {
              const groups = new Map<string, { moduleName: string; features: Array<{ id: string; name: string }> }>();
              for (const f of projectFeatures) {
                if (f.id === featureId) continue;
                const g = groups.get(f.moduleId) ?? { moduleName: f.module.name, features: [] };
                g.features.push({ id: f.id, name: f.name });
                groups.set(f.moduleId, g);
              }
              return Array.from(groups.entries()).map(([modId, g]) => (
                <optgroup key={modId} label={g.moduleName}>
                  {g.features.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </optgroup>
              ));
            })()}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setBulkMoveOpen(false); setBulkMoveTarget(''); }}>
              Cancel
            </Button>
            <Button
              loading={bulkMoveTests.isPending}
              disabled={!bulkMoveTarget}
              onClick={() => bulkMoveTests.mutate({ ids: Array.from(selectedTestIds), target: bulkMoveTarget })}
            >
              Move
            </Button>
          </div>
        </div>
      </Modal>

      {/* Quick-Fail reason capture — a quick-mark FAIL always records a
          structured reason (category + detail). */}
      <FailureReasonModal
        open={!!quickFailModal}
        testName={quickFailModal?.testName}
        onClose={() => setQuickFailModal(null)}
        submitting={quickMark.isPending}
        onConfirm={(category, note) => {
          if (!quickFailModal) return;
          quickMark.mutate(
            { testId: quickFailModal.testId, status: 'FAILED', failureCategory: category, failureNote: note },
            { onSuccess: () => setQuickFailModal(null) },
          );
        }}
      />
    </div>
  );
}
