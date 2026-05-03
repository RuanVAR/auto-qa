import React, { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, History, AlertTriangle, CheckCircle, GitBranch,
  FlaskConical, Clock, XCircle, Pause, Square, Loader, Eye, EyeOff,
  Zap, User, ExternalLink, ChevronRight, ChevronLeft, RefreshCw, Paperclip,
  Timer, X, TrendingUp, BarChart2, ListChecks, Video,
  Maximize2, Minimize2, Info, FileText, PanelLeftClose, PanelLeftOpen,
  Download, AlertCircle, Bug, MessageSquare, Wrench, PlusCircle,
  Camera, Mic, MicOff,
} from 'lucide-react';
import { featuresApi, featureVersionsApi, featureRunsApi, testsApi, environmentsApi, runsApi, uploadsApi, issuesApi } from '@/lib/api';
import type {
  VersionInfo, TestRunRef, FeatureRun, RunStep, Environment,
  IframeState, IssueType, IssueSeverity, IssueModalState, AttachedEvidence,
  ManualPlayerProps,
} from './FeaturePage/featurePage.types';
import {
  MAX_FILE_SIZE_MB, HEARTBEAT_INTERVAL_MS, INACTIVITY_WARNING_MS, LEFT_PANEL_KEY,
  stepInstruction,
} from './FeaturePage/featurePage.helpers';
import { NoEnvWarningModal } from './FeaturePage/parts/NoEnvWarningModal';
import { PublishModal } from './FeaturePage/parts/PublishModal';
import { VersionHistoryModal } from './FeaturePage/parts/VersionHistoryModal';
import { toast } from '@/components/ui/Toast';
import { useScreenRecording, formatRecordingDuration } from '@/hooks/useScreenRecording';
import { toast as uiToast } from '@/components/ui/Toast';
import { ExportButton } from '@/components/ImportExport';
import { ReportsCard } from '@/components/ReportsCard';
import { BackLink } from '@/components/BackLink';
import { useAuthStore } from '@/stores/authStore';
import { StepEditor, type Step } from '@/components/StepEditor';
import { useFeatureRunSocket } from '@/hooks/useFeatureRunSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import { useActiveEnv } from '@/stores/activeEnvStore';

// ─── Manual Player ────────────────────────────────────────────────────────────
// Types + helpers moved to ./FeaturePage/featurePage.{types,helpers}.ts
// Full component extraction still TODO — tracked in split plan step 11.

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
  useEffect(() => { localStorage.setItem('manual-rec-mic', micEnabled ? '1' : '0'); }, [micEnabled]);
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
      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(doc.documentElement, {
        cacheBust: true,
        pixelRatio: window.devicePixelRatio || 1,
      });
      if (!blob) throw new Error('capture-failed');
      const file = new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' });
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
          className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all"
          style={{
            background: isActive ? 'rgba(139,92,246,0.12)' : 'transparent',
            border: isActive ? '1px solid rgba(139,92,246,0.28)' : '1px solid transparent',
          }}
        >
          {/* Status dot */}
          <div className="flex-shrink-0 w-4 flex items-center justify-center">
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
          {/* Name */}
          <span
            className="text-xs truncate flex-1"
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
              onClick={recording.isRecording ? recording.stop : recording.start}
              style={{ color: '#a78bfa', borderColor: 'rgba(139,92,246,0.35)' }}
            >
              <Video size={12} /> Record
            </Button>
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
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold truncate" style={{ color: 'rgba(238,238,248,0.7)' }}>
                      {activeTestRun.testDefinition.name}
                    </p>
                    <span className="text-[10px] ml-2 flex-shrink-0" style={{ color: 'rgba(238,238,248,0.35)' }}>
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
                onClick={recording.isRecording ? recording.stop : recording.start}
                title={recording.isRecording ? 'Stop recording' : 'Start screen + audio recording'}
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

              <button
                onClick={() => setInfoOpen(o => !o)}
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
            onClick={recording.isRecording ? recording.stop : recording.start}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              color: recordingUrl ? '#a78bfa' : 'rgba(238,238,248,0.6)',
              background: recordingUrl ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.07)',
              border: `1px solid ${recordingUrl ? 'rgba(139,92,246,0.4)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <Video size={11} /> {recordingUrl ? '✓ Rec' : 'Record'}
          </button>

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

  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [selectedEnvId, setSelectedEnvId] = useState('');
  const [runMode, setRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');
  // Single-test quick run
  const [soloTest, setSoloTest] = useState<Record<string, unknown> | null>(null);
  const [soloEnvId, setSoloEnvId] = useState('');
  const [soloRunMode, setSoloRunMode] = useState<'AUTOMATED' | 'MANUAL'>('MANUAL');

  // Expandable test case rows
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);

  // No-env guard: track if user tried to open run modal with no envs
  const [noEnvWarning, setNoEnvWarning] = useState(false);

  // Testing Mode — only show ManualPlayer when the user explicitly opts in.
  // The feature page defaults to showing the test list; user clicks
  // "Open Testing Mode" to start/resume a guided walk-through.
  const [testModeOpen, setTestModeOpen] = useState(false);

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

  const { data: envs = [] } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  // Issues filed against this feature (from manual testing — bug, observation,
  // task). Rendered in the Evidence card below so testers can see at a glance
  // what's been logged + view the attached screenshots/recordings without
  // hunting through individual test runs.
  const { data: featureIssues = [] } = useQuery<unknown[]>({
    queryKey: ['issues', projectId, 'feature', featureId],
    queryFn: () => issuesApi.list(projectId!, { featureId: featureId!, limit: 50 }),
    enabled: !!projectId && !!featureId,
    staleTime: 15_000,
  });

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
    mutationFn: ({ testId, status }: { testId: string; status: 'PASSED' | 'FAILED' }) =>
      testsApi.mark(testId, { status, environmentId: selectedEnvId || undefined }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      qc.invalidateQueries({ queryKey: ['feature-runs', featureId] });
      qc.invalidateQueries({ queryKey: ['work-session-current'] });
      toast.success(
        vars.status === 'PASSED' ? 'Marked as passed' : 'Marked as failed',
        'Result saved to your work session.',
      );
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Failed to mark test', typeof msg === 'string' ? msg : 'Please try again.');
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
        runMode: soloRunMode,
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
    if (!selectedEnvId) setSelectedEnvId(environmentsList[0].id);
    if (activeRun) {
      setTestModeOpen(true);
    } else {
      const envId = selectedEnvId || environmentsList[0].id;
      setRunMode('MANUAL');
      startRun.mutate({ runMode: 'MANUAL', environmentId: envId, openTestingView: false }, { onSuccess: () => setTestModeOpen(true) });
    }
    const sp = new URLSearchParams(searchParams);
    sp.delete('testMode');
    setSearchParams(sp, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenTestMode, environmentsList.length, hasTestsForAutoOpen, activeRun?.id]);

  if (featureLoading) return <PageSpinner />;

  const f = feature as Record<string, unknown> | undefined;
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

  // Derive stats from completed runs
  const completedRuns = featureRunsList.filter(fr => fr.status === 'COMPLETE');
  const lastRun = completedRuns[0] ?? null;
  const totalRuns = featureRunsList.length;
  const totalPassed = lastRun ? lastRun.testRuns.filter(tr => tr.status === 'PASSED').length : 0;
  const totalFailed = lastRun ? lastRun.testRuns.filter(tr => tr.status === 'FAILED').length : 0;
  const totalTests = lastRun ? lastRun.testRuns.length : featureTests.length;
  const passRate = totalTests > 0 && lastRun ? Math.round((totalPassed / totalTests) * 100) : null;

  return (
    <div className="space-y-5">
      {/* Breadcrumb + header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <BackLink
            label="Features"
            to={`/projects/${projectId}/modules/${moduleId}/features`}
          />
          <div>
            <nav className="text-xs mb-1 flex items-center gap-1.5" style={{ color: 'rgba(238,238,248,0.50)' }}>
              <Link to="/projects" className="hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(238,238,248,0.55)' }}>Projects</Link>
              <span style={{ color: 'rgba(238,238,248,0.30)' }}>/</span>
              <Link to={`/projects/${projectId}`} className="hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(238,238,248,0.55)' }}>Modules</Link>
              <span style={{ color: 'rgba(238,238,248,0.30)' }}>/</span>
              <Link
                to={`/projects/${projectId}/modules/${moduleId}/features`}
                className="hover:opacity-100 transition-opacity"
                style={{ color: 'rgba(238,238,248,0.55)' }}
              >
                Features
              </Link>
            </nav>
            <h2 className="text-xl font-bold" style={{ color: 'rgba(238,238,248,0.95)' }}>{(f?.name as string) ?? 'Feature'}</h2>
            {!!(f?.description) && (
              <p className="text-sm mt-0.5" style={{ color: 'rgba(238,238,248,0.55)' }}>{f.description as string}</p>
            )}
          </div>
        </div>

        {/* Version status banner */}
        <div className="flex items-center gap-2">
          <ExportButton level="feature" id={featureId!} name={(f?.name as string) ?? 'feature'} />
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
                if (!selectedEnvId) setSelectedEnvId(environmentsList[0].id);
                // Default the chooser to MANUAL — that's the more common
                // entry path from this surface (automated runs typically
                // come from the Run History "re-run" affordance).
                setRunMode('MANUAL');
                setRunOpen(true);
              }}
              title="Start a testing session — pick Manual or Automated in the next step"
            >
              <Play size={14} /> Start Testing
            </Button>
          )}
        </div>
      </div>

      {/* Stat cards strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total test cases */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.30)',
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(139,92,246,0.20)' }}>
            <ListChecks size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.50)' }}>Test Cases</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: 'rgba(238,238,248,0.92)' }}>{featureTests.length}</p>
          </div>
        </div>

        {/* Passed */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.30)',
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(16,185,129,0.18)' }}>
            <CheckCircle size={16} style={{ color: '#34d399' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.50)' }}>Passed</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: lastRun ? '#34d399' : 'rgba(238,238,248,0.40)' }}>
              {lastRun ? totalPassed : '—'}
            </p>
            {lastRun && <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.40)' }}>last run</p>}
          </div>
        </div>

        {/* Failed */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.30)',
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.18)' }}>
            <XCircle size={16} style={{ color: '#f87171' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.50)' }}>Failed</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5" style={{ color: lastRun && totalFailed > 0 ? '#f87171' : 'rgba(238,238,248,0.40)' }}>
              {lastRun ? totalFailed : '—'}
            </p>
            {lastRun && <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.40)' }}>last run</p>}
          </div>
        </div>

        {/* Pass rate */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.30)',
          }}
        >
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.18)' }}>
            <TrendingUp size={16} style={{ color: '#fbbf24' }} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.50)' }}>Pass Rate</p>
            <p className="text-2xl font-bold tabular-nums mt-0.5"
              style={{
                color: passRate === null
                  ? 'rgba(238,238,248,0.40)'
                  : passRate >= 80 ? '#34d399'
                  : passRate >= 50 ? '#fbbf24'
                  : '#f87171',
              }}
            >
              {passRate !== null ? `${passRate}%` : '—'}
            </p>
            {totalRuns > 0 && <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.40)' }}>{totalRuns} run{totalRuns !== 1 ? 's' : ''} total</p>}
          </div>
        </div>
      </div>

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
            <Link to={`/projects/${projectId}/tests/new/edit?featureId=${featureId}`}>
              <Button variant="secondary" size="sm">
                + Add Test
              </Button>
            </Link>
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
                <Th className="w-5" />
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Steps</Th>
                <Th>Updated</Th>
                <Th className="w-36" />
              </Tr>
            </Thead>
            <Tbody>
              {featureTests.map(t => {
                const testSteps = (t.steps as Record<string, unknown>[]) ?? [];
                const isExpanded = expandedTestId === (t.id as string);
                return (
                  <Fragment key={t.id as string}>
                    {/* Main row */}
                    <Tr
                      className="group cursor-pointer"
                      onClick={() => setExpandedTestId(isExpanded ? null : (t.id as string))}
                    >
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
                          {/* Quick Fail — marks test FAILED without entering test mode */}
                          <button
                            onClick={() => quickMark.mutate({ testId: t.id as string, status: 'FAILED' })}
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
                          {/* Test Mode — step-by-step guided */}
                          <button
                            onClick={() => {
                              if (environmentsList.length === 0) { setNoEnvWarning(true); return; }
                              if (!selectedEnvId) setSelectedEnvId(environmentsList[0].id);
                              if (activeRun) { setTestModeOpen(true); return; }
                              const envId = selectedEnvId || environmentsList[0].id;
                              setRunMode('MANUAL');
                              startRun.mutate({ runMode: 'MANUAL', environmentId: envId, openTestingView: false }, { onSuccess: () => setTestModeOpen(true) });
                            }}
                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all"
                            style={{
                              background: 'rgba(139,92,246,0.15)',
                              color: '#c4b5fd',
                              border: '1px solid rgba(139,92,246,0.30)',
                            }}
                            title="Open this test in Test Mode"
                          >
                            <Play size={11} /> Test Mode
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
                        </div>
                      </Td>
                    </Tr>

                    {/* Expanded steps */}
                    {isExpanded && (
                      <Tr key={`${t.id as string}-steps`}>
                        <Td colSpan={6} style={{ padding: 0 }}>
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

      {/* ── Progress Reports card (R2) ────────────────────────────────────── */}
      <ReportsCard
        projectId={projectId!}
        defaultScope={{
          type: 'FEATURE',
          featureId: featureId!,
          title: (feature as { name?: string } | undefined)?.name,
        }}
      />

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
        // The list endpoint returns `{ items, total, ... }` (paginated). The
        // earlier code assumed a bare array; that crashed with
        // "issues.reduce is not a function" in the UI. Unwrap defensively.
        const raw = featureIssues as { items?: IssueRow[] } | IssueRow[] | undefined;
        const issues: IssueRow[] = Array.isArray(raw) ? raw : (raw?.items ?? []);
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
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
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
                                {issue.status.replace('_', ' ')}
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
                            <p className="text-sm font-medium truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                              {issue.title}
                            </p>
                            {issue.description && (
                              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'rgba(238,238,248,0.55)' }}>
                                {issue.description}
                              </p>
                            )}
                            <div className="flex items-center gap-2 text-[10px] mt-1.5" style={{ color: 'rgba(238,238,248,0.4)' }}>
                              <span>{formatDate(issue.createdAt)}</span>
                              {issue.createdBy?.name && <><span>·</span><span>{issue.createdBy.name}</span></>}
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

      {/* Live player panel — only when user explicitly opens Testing Mode */}
      {activeRun && (
        isManualRun ? (
          testModeOpen ? (
            <ManualPlayer
              key={activeRun.id}
              featureRun={activeRun}
              environments={environmentsList}
              onStop={() => { stopRun.mutate(activeRun.id); setTestModeOpen(false); }}
              onClose={() => setTestModeOpen(false)}
              projectId={projectId!}
              featureId={featureId!}
              feature={feature ? {
                name: feature.name,
                description: feature.description ?? undefined,
                acceptanceCriteria: (feature as unknown as Record<string, string>).acceptanceCriteria ?? undefined,
                status: feature.status,
              } : undefined}
            />
          ) : (
            /* Compact resume banner — testing mode is closed but run is still active */
            <div
              className="rounded-2xl px-5 py-3.5 flex items-center justify-between gap-3 animate-fade-in"
              style={{
                border: '1px solid rgba(139,92,246,0.35)',
                background: 'rgba(139,92,246,0.06)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'rgba(139,92,246,0.20)' }}>
                  <User size={14} style={{ color: '#a78bfa' }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>
                    Testing mode is active
                  </p>
                  <p className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
                    Run id <span className="font-mono">{activeRun.id.slice(0, 8)}…</span> — resume to continue, or stop to end it.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Button size="sm" onClick={() => setTestModeOpen(true)}>
                  <Play size={13} /> Resume testing
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={stopRun.isPending}
                  onClick={() => stopRun.mutate(activeRun.id)}
                  style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.35)' }}
                >
                  <Square size={13} /> Stop testing
                </Button>
              </div>
            </div>
          )
        ) : (
          /* Automated player card */
          <div
            className="rounded-2xl overflow-hidden animate-fade-in"
            style={{ border: '1px solid rgba(139,92,246,0.35)', background: 'rgba(139,92,246,0.06)' }}
          >
            <div className="px-5 py-4 flex items-center justify-between"
              style={{ borderBottom: '1px solid rgba(139,92,246,0.20)' }}>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <Loader size={14} className="animate-spin" style={{ color: '#a78bfa' }} />
                  <h3 className="font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                    {activeRun.status === 'PAUSED'
                      ? 'Feature Run Paused'
                      : 'Feature Run In Progress'}
                  </h3>
                </div>
                <span className="text-xs font-mono" style={{ color: '#a78bfa' }}>
                  {activeRun.id.slice(0, 8)}…
                </span>
              </div>
              <div className="flex items-center gap-2">
                {activeRun.status === 'RUNNING' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={pauseRun.isPending}
                    onClick={() => pauseRun.mutate(activeRun.id)}
                  >
                    <Pause size={13} /> Pause
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={resumeRun.isPending}
                    onClick={() => resumeRun.mutate(activeRun.id)}
                  >
                    <Play size={13} /> Resume
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={stopRun.isPending}
                  onClick={() => stopRun.mutate(activeRun.id)}
                  className="text-red-600 hover:bg-red-50 border-red-200"
                >
                  <Square size={13} /> Stop
                </Button>
              </div>
            </div>
            <CardContent className="py-3 space-y-2">
              {activeRun.testRuns.map((tr, idx) => {
                const icon =
                  tr.status === 'PASSED' ? (
                    <CheckCircle size={13} className="text-green-500" />
                  ) : tr.status === 'FAILED' ? (
                    <XCircle size={13} className="text-red-500" />
                  ) : tr.status === 'RUNNING' ? (
                    <Loader size={13} className="text-sky-500 animate-spin" />
                  ) : tr.status === 'CANCELLED' ? (
                    <XCircle size={13} className="text-gray-400" />
                  ) : (
                    <Clock size={13} className="text-gray-300" />
                  );
                return (
                  <div key={tr.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs w-5 text-right" style={{ color: 'rgba(238,238,248,0.35)' }}>
                      {idx + 1}
                    </span>
                    {icon}
                    <span style={{ color: 'rgba(238,238,248,0.82)' }}>{tr.testDefinition.name}</span>
                    <span
                      className="ml-auto text-xs font-medium"
                      style={{
                        color: tr.status === 'PASSED'
                          ? '#34d399'
                          : tr.status === 'FAILED'
                          ? '#f87171'
                          : tr.status === 'RUNNING'
                          ? '#a78bfa'
                          : 'rgba(238,238,248,0.40)',
                      }}
                    >
                      {tr.status}
                    </span>
                  </div>
                );
              })}
            </CardContent>
          </div>
        )
      )}

      {/* Feature run history */}
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
                  const { run, pendingVars } = conflict;
                  try {
                    await featureRunsApi.abandon(run.id);
                  } catch {
                    /* even if the abandon races, retry below with allowConcurrent will succeed */
                  }
                  qc.invalidateQueries({ queryKey: ['my-active-runs'] });
                  setConflict(null);
                  startRun.mutate({ ...(pendingVars ?? {}), allowConcurrent: true });
                }}
                style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}
              >
                End previous & start new
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

          {/* Mode */}
          <div className="flex gap-2">
            {(['AUTOMATED', 'MANUAL'] as const).map(m => (
              <button key={m} type="button" onClick={() => setSoloRunMode(m)}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
                style={soloRunMode === m ? {
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
            ))}
          </div>

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

          {/* Mode selector */}
          <div className="flex gap-2">
            {(['AUTOMATED', 'MANUAL'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setRunMode(m)}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-medium transition-all"
                style={runMode === m ? {
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
            ))}
          </div>

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
              disabled={(runMode === 'AUTOMATED' && !selectedEnvId) || featureTests.length === 0}
              onClick={() => startRun.mutate({
                runMode,
                environmentId: selectedEnvId,
                // Both modes navigate to TestingView now — it's the canonical
                // rich surface (sidebar, floating actions, fullscreen, manual
                // description-driven mode). Only the autoOpen-from-URL path
                // sets this false (it's already navigating elsewhere).
                openTestingView: true,
              })}
            >
              <Play size={14} /> {runMode === 'AUTOMATED' ? 'Start Automated Run' : 'Start Manual Session'}
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
      {activeRun && !testModeOpen && (() => {
        const passed = activeRun.testRuns?.filter(t => t.status === 'PASSED').length ?? 0;
        const failed = activeRun.testRuns?.filter(t => t.status === 'FAILED').length ?? 0;
        const total = activeRun.testRuns?.length ?? 0;
        const running = activeRun.testRuns?.find(t => t.status === 'RUNNING');
        const runIdx = running ? (activeRun.testRuns ?? []).findIndex(t => t.id === running.id) + 1 : passed + failed;
        const isAuto = activeRun.runMode === 'AUTOMATED';
        const isPaused = activeRun.status === 'PAUSED';
        const openSession = () => {
          if (isAuto) {
            navigate(buildTestingViewUrl('AUTOMATED'));
          } else {
            setTestModeOpen(true);
          }
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
    </div>
  );
}
