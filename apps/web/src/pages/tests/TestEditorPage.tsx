import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, ArrowLeft, Monitor, Globe, Terminal, Play, Zap, User, ExternalLink, AlertTriangle, Sparkles, History, Eye, StickyNote } from 'lucide-react';
import { GenerateStepsModal, type ProposedStep } from '@/components/ai/GenerateStepsModal';
import { LevelBadge, levelAccentVars } from '@/components/LevelBadge';
import { MarkdownDescription } from '@/components/MarkdownDescription';
import { useAiConfigured } from '@/hooks/useAiConfigured';
import { testsApi, runsApi, featureRunsApi, environmentsApi } from '@/lib/api';
import { ExportButton, VersionHistoryButton } from '@/components/ImportExport';
import { LogIssueButton, IssueStatsWidget, IssueListDrawer } from '@/components/IssueTracker';
import { TestNotesPanel } from '@/components/notes/TestNotesPanel';
import { StepEditor, type Step } from '@/components/StepEditor';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { ClickUpRoutingHint } from '@/components/plugins/ClickUpRoutingHint';
import { LiveRunModal } from '@/components/testing/LiveRunModal';
import { RecentRunsPanel } from '@/components/testing/RecentRunsPanel';
import { DataTokenPicker } from '@/components/testing/DataTokenPicker';
import { toast } from '@/components/ui/Toast';
import { ScopedDocsPanel } from '@/components/plugins/ScopedDocsPanel';
import { AcSourcePanel } from '@/components/plugins/ac-source/AcSourcePanel';
import { useProjectRunSocket } from '@/hooks/useRunSocket';

type TestType = 'UI' | 'API' | 'SHELL';

const BLANK_META: Record<TestType, object> = {
  UI: {
    name: 'My UI Test',
    description: '',
    type: 'UI',
    tags: [],
    steps: [
      { index: 0, name: 'Navigate to home', type: 'NAVIGATE', input: { url: '/' } },
    ],
    config: { browser: 'chromium', headless: true, timeout: 30000, retries: 1 },
  },
  API: {
    name: 'My API Test',
    description: '',
    type: 'API',
    tags: [],
    steps: [
      { index: 0, name: 'GET request', type: 'REQUEST', input: { method: 'GET', url: 'https://api.example.com/health' } },
      { index: 1, name: 'Assert 200', type: 'ASSERT_STATUS', input: { expected: 200 } },
    ],
    config: {},
  },
  SHELL: {
    name: 'My Shell Test',
    description: '',
    type: 'SHELL',
    tags: [],
    steps: [
      { index: 0, name: 'Run command', type: 'COMMAND', input: { command: 'echo "hello"' } },
      { index: 1, name: 'Assert exit 0', type: 'ASSERT_EXIT', input: { expected: 0 } },
    ],
    config: {},
  },
};

const STEP_PALETTES: Record<TestType, { type: string; description: string }[]> = {
  UI: [
    { type: 'NAVIGATE', description: 'Go to a URL' },
    { type: 'WAIT_FOR_NAVIGATION', description: 'Wait for navigation/load state' },
    { type: 'CLICK', description: 'Click an element' },
    { type: 'DBLCLICK', description: 'Double-click an element' },
    { type: 'FILL', description: 'Set an input value' },
    { type: 'TYPE', description: 'Type keystrokes into an input or page' },
    { type: 'CLEAR', description: 'Clear an input' },
    { type: 'SELECT', description: 'Select a dropdown option' },
    { type: 'CHECK', description: 'Check a checkbox/radio' },
    { type: 'UNCHECK', description: 'Uncheck a checkbox' },
    { type: 'HOVER', description: 'Hover over an element' },
    { type: 'KEYBOARD', description: 'Press a keyboard key' },
    { type: 'PRESS_KEY', description: 'Focus an element and press a key' },
    { type: 'SCROLL', description: 'Scroll to element or offset' },
    { type: 'WAIT', description: 'Wait for time or selector' },
    { type: 'WAIT_MS', description: 'Wait for milliseconds' },
    { type: 'WAIT_FOR_SELECTOR', description: 'Wait for selector state' },
    { type: 'ASSERT_TEXT', description: 'Assert element contains text' },
    { type: 'ASSERT_VISIBLE', description: 'Assert element is visible' },
    { type: 'ASSERT_VALUE', description: 'Assert input value' },
    { type: 'ASSERT_URL', description: 'Assert current URL' },
    { type: 'ASSERT_ELEMENT', description: 'Assert element exists in DOM' },
    { type: 'SCREENSHOT', description: 'Capture a screenshot' },
    { type: 'FILE_UPLOAD', description: 'Upload file(s) to a file input' },
    { type: 'API_REQUEST', description: 'Make a Playwright request from UI test' },
    { type: 'EXECUTE_SCRIPT', description: 'Run browser-context JavaScript' },
    { type: 'CUSTOM', description: 'Run a registered custom handler' },
  ],
  API: [
    { type: 'REQUEST', description: 'Make an HTTP request' },
    { type: 'ASSERT_STATUS', description: 'Assert response status code' },
    { type: 'ASSERT_BODY', description: 'Assert JSON body via path' },
    { type: 'ASSERT_HEADER', description: 'Assert response header value' },
    { type: 'ASSERT_CONTAINS', description: 'Assert body contains string' },
    { type: 'EXTRACT', description: 'Extract value from body to variable' },
    { type: 'DELAY', description: 'Wait N milliseconds' },
  ],
  SHELL: [
    { type: 'COMMAND', description: 'Run a shell command' },
    { type: 'ASSERT_EXIT', description: 'Assert exit code' },
    { type: 'ASSERT_OUTPUT', description: 'Assert stdout (exact match)' },
    { type: 'ASSERT_CONTAINS', description: 'Assert stdout contains string' },
  ],
};

const TYPE_ICONS: Record<TestType, React.ReactNode> = {
  UI: <Monitor size={14} />,
  API: <Globe size={14} />,
  SHELL: <Terminal size={14} />,
};

export function TestEditorPage() {
  const { projectId, testId } = useParams<{ projectId: string; testId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const featureId = searchParams.get('featureId') ?? undefined;
  const qc = useQueryClient();
  const isNew = testId === 'new';

  // Subscribe to project-wide run events so the RecentRunsPanel below
  // refreshes the moment a run completes — no manual reload required.
  // The hook noops when projectId is undefined.
  useProjectRunSocket(projectId);

  const [selectedType, setSelectedType] = useState<TestType>('UI');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [json, setJson] = useState(() => JSON.stringify(BLANK_META['UI'], null, 2));
  const [error, setError] = useState('');
  // UI tests get both a visual StepEditor and a raw JSON escape hatch.
  // 'visual' is the default — it's safer (no syntax errors) and more
  // discoverable. 'json' is the power-user view for cases the form-based
  // editor can't fully express (custom step inputs, bulk find-and-replace
  // across selectors, manually-authored fallback selectors, etc.).
  const [uiEditorView, setUiEditorView] = useState<'visual' | 'json'>('visual');
  const [metaReady, setMetaReady] = useState(isNew);
  // Issue drawer
  const [issueDrawerOpen, setIssueDrawerOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  // Solo run modal
  const [runModalOpen, setRunModalOpen] = useState(false);
  // Background by default: kicking off a run shouldn't trap the user in a
  // modal. Live viewer is an explicit opt-in via the modal checkbox.
  // Persisted to localStorage so testers who DO want to watch every run
  // don't have to re-tick each time.
  const [watchLive, setWatchLive] = useState<boolean>(() => {
    try { return localStorage.getItem('runEditor.watchLive') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('runEditor.watchLive', watchLive ? '1' : '0'); } catch { /* ignore */ }
  }, [watchLive]);
  const [runEnvId, setRunEnvId] = useState('');
  const [runMode, setRunMode] = useState<'AUTOMATED' | 'MANUAL'>('AUTOMATED');
  // Preview mode flag — controlled by which header button opened the modal.
  // "Run Test" = false (logged real run). "Preview" = true (ephemeral debug
  // run that's filtered out of history, stats, badges). When true the modal
  // hides the runMode/watch-live controls (preview is always automated +
  // always watched) and the trigger sends isPreview=true.
  const [previewMode, setPreviewMode] = useState(false);
  // Live-run viewer — opened after triggering an automated run so QA watches
  // the Playwright replay stream + per-step results without leaving the page.
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  // Tag the open LiveRunModal as preview so it can show a PREVIEW badge
  // and "not logged" copy. Set at trigger time; cleared on modal close.
  const [livePreview, setLivePreview] = useState(false);

  // Load existing test when editing
  const { data: existingTest, isLoading: loadingTest } = useQuery<Record<string, unknown>>({
    queryKey: ['test', testId],
    queryFn: () => testsApi.get(projectId!, testId!),
    enabled: !isNew && !!testId,
    staleTime: 60_000,
  });

  // Environments for the run modal
  const { data: environments = [] } = useQuery<{ id: string; name: string; baseUrl: string; supportsAutomation?: boolean }[]>({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  // Automation availability is env-driven: AUTOMATED + Preview are offered when
  // the project has at least one automation-enabled environment. There is no
  // per-feature automation flag.
  const automationAvailable = environments.some(e => e.supportsAutomation);

  // Automated run — queues in BullMQ via the single-test trigger endpoint.
  // Default UX is background: kick it off, close the modal, surface a toast,
  // and let the RecentRunsPanel below show the live status. The "Watch
  // live" checkbox in the modal opts in to the full Playwright replay
  // viewer for the rare case the tester wants to see it execute.
  //
  // This run is REAL — it lands in run history, contributes to pass rate,
  // emits artifacts. Distinct from the recorder's [Preview] flow, which
  // creates a temporary test definition and offers Keep/Discard at the end,
  // and distinct from the new Preview button (below) which fires an
  // ephemeral isPreview=true run that's hidden from all history.
  const triggerAutomated = useMutation({
    mutationFn: () => runsApi.trigger(projectId!, {
      testDefinitionId: testId!,
      environmentId: runEnvId,
      runMode: 'AUTOMATED',
    }),
    onSuccess: (data: { id: string }) => {
      setRunModalOpen(false);
      setLivePreview(false);
      // Optimistic refresh — without this, the new PENDING row only
      // appears after the worker picks the job up and emits run:updated
      // (could be a few seconds on a busy queue).
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'runs' || q.queryKey[0] === 'tests-browse' ||
            q.queryKey[0] === 'test-active-runs'),
      });
      if (watchLive) {
        setLiveRunId(data.id);
      } else {
        // Background run — the new row already shows up in the panel below
        // with a "Running …" badge (live timer ticks). Tester can click it
        // to open the run detail page if they want to drill in.
        toast.success('Run started', 'Watch it live below in Recent Runs.');
      }
    },
  });

  // Preview run — same backend trigger endpoint, but with isPreview=true so
  // the resulting TestRun is filtered out of history, stats, donut, badges
  // everywhere. Designed for "edit → preview → see what breaks → edit again"
  // iteration without polluting metrics. Always opens LiveRunModal because
  // the entire point is to watch what happens.
  const triggerPreview = useMutation({
    mutationFn: () => runsApi.trigger(projectId!, {
      testDefinitionId: testId!,
      environmentId: runEnvId,
      runMode: 'AUTOMATED',
      isPreview: true,
    }),
    onSuccess: (data: { id: string }) => {
      setRunModalOpen(false);
      setPreviewMode(false);
      setLivePreview(true);
      setLiveRunId(data.id);
      // NB: deliberately no cache invalidation here — preview runs must not
      // appear in RecentRunsPanel, the runs page, etc.
    },
  });

  // Manual run — starts a FeatureRun (the manual player works at feature
  // granularity) then navigates into the TestingView pre-scoped to this test.
  const effectiveFeatureId = featureId || (existingTest?.featureId as string | undefined);
  const triggerManual = useMutation({
    mutationFn: () => featureRunsApi.start(effectiveFeatureId!, {
      runMode: 'MANUAL',
      environmentId: runEnvId || undefined,
      // openTestingView is a UI-only flag (other call sites keep it local); it
      // is not on TriggerFeatureRunDto, so sending it now 400s under
      // forbidNonWhitelisted. Navigation below is unconditional anyway.
    }),
    onSuccess: (data: { featureRun?: { id: string } }) => {
      setRunModalOpen(false);
      const params = new URLSearchParams({ mode: 'MANUAL', testCaseId: testId! });
      if (data?.featureRun?.id) params.set('runId', data.featureRun.id);
      navigate(`/projects/${projectId}/features/${effectiveFeatureId}/test?${params.toString()}`);
    },
  });

  // Three trigger paths share one modal — preview takes precedence over the
  // automated/manual choice (preview is always Playwright + always watched).
  // When the parent feature has automated testing disabled, force MANUAL —
  // the AUTOMATED tab is already hidden in the picker but defense in depth.
  const effectiveRunModeForTrigger = automationAvailable ? runMode : 'MANUAL';
  const triggerRun = previewMode
    ? triggerPreview
    : effectiveRunModeForTrigger === 'MANUAL'
      ? triggerManual
      : triggerAutomated;

  useEffect(() => {
    if (!existingTest || isNew || metaReady) return;
    setName((existingTest.name as string) ?? '');
    setDescription((existingTest.description as string) ?? '');
    setTagsInput(((existingTest.tags as string[]) ?? []).join(', '));
    setJson(JSON.stringify({
      name: existingTest.name,
      description: existingTest.description,
      type: existingTest.type,
      tags: existingTest.tags,
      steps: existingTest.steps,
      config: existingTest.config,
      featureId: existingTest.featureId,
    }, null, 2));
    setMetaReady(true);
  }, [existingTest, isNew, metaReady]);

  const testType = isNew
    ? selectedType
    : ((existingTest?.type as TestType) ?? 'UI');

  const baseSteps: Step[] = isNew
    ? [{ index: 0, name: 'Navigate to home', type: 'NAVIGATE' as const, input: { url: '/' } }]
    : ((existingTest?.steps as Step[]) ?? []);

  // AI-applied steps are appended to whatever the editor was showing and
  // the editor is remounted (via the changed key below) so it picks them
  // up. We don't auto-save — the user reviews + saves manually.
  const [aiAppendedSteps, setAiAppendedSteps] = useState<Step[]>([]);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  // Disable the Generate Steps button when the org hasn't set up an AI
  // credential yet — clicking the disabled button routes the user to
  // Settings → AI instead of opening a modal that would just fail.
  const { configured: aiConfigured, isLoading: aiCheckLoading } = useAiConfigured();

  const initialSteps: Step[] = aiAppendedSteps.length
    ? [...baseSteps, ...aiAppendedSteps].map((s, i) => ({ ...s, index: i }))
    : baseSteps;
  const stepEditorKey = `${testId ?? 'new'}-${aiAppendedSteps.length}`;

  function handleAiApply(picked: ProposedStep[]) {
    setAiAppendedSteps((prev) => [
      ...prev,
      ...picked.map((s) => ({
        index: 0, // re-indexed in the merge above
        name: s.name,
        type: s.type as Step['type'],
        input: s.input,
        continueOnFail: s.continueOnFail,
      })),
    ]);
    setAiModalOpen(false);
  }

  function parsedTags(): string[] {
    return tagsInput.split(',').map(t => t.trim()).filter(Boolean);
  }

  function handleTypeChange(type: TestType) {
    setSelectedType(type);
    try {
      const current = JSON.parse(json) as Record<string, unknown>;
      setJson(JSON.stringify({ ...current, type }, null, 2));
    } catch {
      setJson(JSON.stringify(BLANK_META[type], null, 2));
    }
  }

  const saveMeta = useMutation({
    mutationFn: () => {
      const p = JSON.parse(json) as Record<string, unknown>;
      return isNew ? testsApi.create(projectId!, { ...p, ...(featureId ? { featureId } : {}) }) : testsApi.update(projectId!, testId!, p);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tests', projectId] });
      navigate(-1);
    },
    onError: (err: Error) => setError(err.message),
  });

  async function handleSaveSteps(steps: Step[]) {
    const tags = parsedTags();
    const payload = isNew
      ? { ...BLANK_META['UI'], name: name || 'My UI Test', description, tags, steps, ...(featureId ? { featureId } : {}) }
      : {
          name,
          description,
          tags,
          steps,
          type: (existingTest?.type as TestType | undefined) ?? 'UI',
          config: existingTest?.config ?? undefined,
          featureId: (existingTest?.featureId as string | undefined) ?? featureId,
        };
    if (isNew) {
      await testsApi.create(projectId!, payload);
    } else {
      await testsApi.update(projectId!, testId!, payload);
    }
    qc.invalidateQueries({ queryKey: ['tests', projectId] });
    qc.invalidateQueries({ queryKey: ['test', testId] });
    navigate(-1);
  }

  function handleJsonSave() {
    setError('');
    try { JSON.parse(json); } catch { setError('Invalid JSON'); return; }
    saveMeta.mutate();
  }

  if (!isNew && loadingTest) return <PageSpinner />;

  // ── Shared meta fields (name / description / tags / type selector) ────────────
  const MetaFields = (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* Type selector */}
        <div className="flex items-center gap-2">
          {(['UI', 'API', 'SHELL'] as TestType[]).map(type => (
            <button
              key={type}
              onClick={() => {
                if (isNew) handleTypeChange(type);
              }}
              disabled={!isNew}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all"
              style={testType === type ? {
                background: 'rgba(var(--accent-rgb),0.25)',
                color: 'var(--accent-300)',
                border: '1px solid rgba(var(--accent-rgb),0.45)',
              } : {
                background: 'rgba(255,255,255,0.04)',
                color: 'rgba(238,238,248,0.45)',
                border: '1px solid rgba(255,255,255,0.08)',
                cursor: isNew ? 'pointer' : 'default',
              }}
            >
              {TYPE_ICONS[type]} {type}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Test name <span style={{ color: '#f87171' }}>*</span>
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. User can log in with valid credentials"
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.92)',
            }}
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Description <span style={{ color: 'rgba(238,238,248,0.30)' }}>(optional — Jira ticket summary, acceptance criteria, etc.)</span>
          </label>
          {!isNew && testId && projectId && (
            <AcSourcePanel
              testId={testId}
              projectId={projectId}
              onAfterApply={() => qc.invalidateQueries({ queryKey: ['test', testId] })}
            />
          )}
          <MarkdownDescription
            value={description}
            canManage
            hideLabel
            emptyHint="Add a description — paste a Jira ticket summary, acceptance criteria, etc."
            placeholder="What does this test verify? Paste Jira ticket text or acceptance criteria — Markdown supported. AI uses this when generating steps."
            onSave={async (next) => {
              setDescription(next ?? '');
              if (!isNew && testId && projectId) {
                await testsApi.update(projectId, testId, { description: next });
                qc.invalidateQueries({ queryKey: ['test', testId] });
              }
            }}
          />

          {/* Prose → AI → Playwright is the primary authoring loop: describe the
              test above, generate the steps, review, run. The visual editor
              below is for tweaking what's generated. (Phase 3a) */}
          {!isNew && testId && (
            <div
              className="mt-3 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl px-4 py-3"
              style={{
                background: 'rgba(var(--accent-rgb),0.10)',
                border: '1px solid rgba(var(--accent-rgb),0.30)',
              }}
            >
              <div className="flex items-start gap-2.5 flex-1">
                <Sparkles size={16} style={{ color: 'var(--accent-400)', flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                    Generate steps from your description
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    Write what the test should verify above, then let AI draft the Playwright steps.
                    Review and tweak them in the editor below before running.
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                disabled={aiCheckLoading}
                onClick={() => { if (aiConfigured) setAiModalOpen(true); else navigate('/org/ai-settings'); }}
                title={aiConfigured ? 'Generate steps from the description + feature docs' : 'AI is not configured — click to set up'}
                style={{ flexShrink: 0 }}
              >
                <Sparkles size={14} />
                {aiConfigured || aiCheckLoading ? 'Generate steps' : 'Set up AI'}
              </Button>
            </div>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Tags <span style={{ color: 'rgba(238,238,248,0.30)' }}>(comma-separated)</span>
          </label>
          <input
            type="text"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            placeholder="e.g. login, auth, smoke, regression"
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.82)',
            }}
          />
          {parsedTags().length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {parsedTags().map(tag => (
                <span
                  key={tag}
                  className="text-xs rounded-full px-2 py-0.5 font-medium"
                  style={{ background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.28)' }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // UI tests get the visual step editor
  if (testType === 'UI') {
    return (
      <div className="space-y-4 max-w-5xl mx-auto" style={levelAccentVars('test')}>
        {/* Header — title on its own full-width row, action buttons wrap onto
            the row below so they never crush the title or overflow off-screen. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg transition-colors shrink-0"
              style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <LevelBadge level="test" className="mb-1.5" />
              <h2 className="text-xl font-bold truncate" title={isNew ? 'New Test' : `Edit: ${name || 'Test'}`} style={{ color: 'rgba(238,238,248,0.92)' }}>
                {isNew ? 'New Test' : `Edit: ${name || 'Test'}`}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Fill in the details below, then build your steps
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!isNew && testId && projectId && (
              <IssueStatsWidget
                scope="test"
                scopeId={testId}
                projectId={projectId}
                onOpenList={() => setIssueDrawerOpen(true)}
              />
            )}
            {!isNew && testId && (
              <>
                <VersionHistoryButton type="test" id={testId} onRestored={() => void window.location.reload()} />
                <ExportButton level="testCase" id={testId} name={name || 'test'} />
              </>
            )}
            {!isNew && testId && projectId && (
              <LogIssueButton
                projectId={projectId}
                testDefinitionId={testId}
                featureId={featureId}
              />
            )}
            {!isNew && testId && projectId && (
              <Button variant="secondary" size="sm" onClick={() => setNotesOpen(true)}>
                <StickyNote size={14} /> Notes
              </Button>
            )}
            {!isNew && (
              <Button
                variant="secondary"
                size="sm"
                disabled={aiCheckLoading}
                onClick={() => {
                  if (aiConfigured) setAiModalOpen(true);
                  else navigate('/org/ai-settings');
                }}
                title={
                  aiConfigured
                    ? 'Generate steps from the test name + feature docs'
                    : 'AI is not configured — click to set up in Settings → AI'
                }
                style={!aiConfigured && !aiCheckLoading ? { opacity: 0.55 } : undefined}
              >
                <Sparkles size={13} />
                {aiConfigured || aiCheckLoading ? 'Generate Steps' : 'Generate Steps (set up AI)'}
              </Button>
            )}
            {!isNew && testId && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/projects/${projectId}/runs?testId=${testId}`)}
                title="View every past run of this test"
              >
                <History size={13} /> Test Runs
              </Button>
            )}
            {/* Preview button — hidden entirely when the parent feature has
                automated testing disabled. Preview is an AUTOMATED-only
                debug tool; without the feature flag the backend would
                reject the trigger anyway, so don't tease it. */}
            {!isNew && automationAvailable && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRunEnvId(environments[0]?.id ?? '');
                  setPreviewMode(true);
                  setRunModalOpen(true);
                }}
                title="Run this test live without logging to history — for debugging"
              >
                <Eye size={13} /> Preview
              </Button>
            )}
            {!isNew && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRunEnvId(environments[0]?.id ?? '');
                  setPreviewMode(false);
                  setRunModalOpen(true);
                }}
              >
                <Play size={13} /> Run Test
              </Button>
            )}
          </div>
        </div>

        {MetaFields}

        {/* Visual ↔ Raw JSON toggle. Raw JSON is the escape hatch for things
            the visual editor can't express — bulk find-and-replace across
            selectors, manually-authored fallbackSelectors, exotic step
            inputs, etc. */}
        <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-lg p-1 w-fit text-xs"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => setUiEditorView('visual')}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: uiEditorView === 'visual' ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
              color: uiEditorView === 'visual' ? 'var(--accent-300)' : 'rgba(238,238,248,0.55)',
              fontWeight: uiEditorView === 'visual' ? 600 : 400,
            }}
          >
            Visual editor
          </button>
          <button
            onClick={() => setUiEditorView('json')}
            className="px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: uiEditorView === 'json' ? 'rgba(var(--accent-rgb),0.18)' : 'transparent',
              color: uiEditorView === 'json' ? 'var(--accent-300)' : 'rgba(238,238,248,0.55)',
              fontWeight: uiEditorView === 'json' ? 600 : 400,
            }}
            title="Raw JSON view — edit step inputs directly, including fields the visual editor doesn't expose"
          >
            Raw JSON
          </button>
        </div>
          <DataTokenPicker />
        </div>

        {uiEditorView === 'visual' ? (
          <StepEditor
            key={stepEditorKey}
            testName={name || 'New UI Test'}
            initialSteps={initialSteps}
            onSave={handleSaveSteps}
            onCancel={() => navigate(-1)}
          />
        ) : (
          <StepsJsonEditor
            initialSteps={initialSteps}
            onSave={handleSaveSteps}
            onCancel={() => navigate(-1)}
          />
        )}

        {/* Recent runs — click any row → /runs/:id (full step + artifact
            detail). Only on saved tests — new tests have no id to query. */}
        {!isNew && testId && projectId && (
          <RecentRunsPanel projectId={projectId} testId={testId} />
        )}

        {!isNew && testId && (
          <GenerateStepsModal
            open={aiModalOpen}
            onClose={() => setAiModalOpen(false)}
            testId={testId}
            onApply={handleAiApply}
          />
        )}

        {/* Live viewer for an automated/preview run triggered from the
            test editor — streams the Playwright replay + per-step results.
            When this run is a preview (livePreview), prepend "Preview:"
            and the modal renders a "Not logged" banner inside (handled by
            LiveRunModal once it picks up isPreview semantics; for now the
            title is the signal). */}
        <LiveRunModal
          open={!!liveRunId}
          runId={liveRunId}
          title={`${livePreview ? 'Preview' : 'Run'}: ${name || 'Test'}`}
          onClose={() => { setLiveRunId(null); setLivePreview(false); }}
        />

        {/* Run this test solo modal — repurposed for both "Run" (logged) and
            "Preview" (ephemeral). previewMode controls the copy + which
            mutation fires on submit. Preview always uses AUTOMATED + Watch
            Live, so the runMode tabs and watch-live checkbox are hidden. */}
        <Modal
          open={runModalOpen}
          onClose={() => { setRunModalOpen(false); setPreviewMode(false); }}
          title={previewMode ? `Preview: ${name || 'Test'}` : `Run: ${name || 'Test'}`}
        >
          <div className="space-y-4">
            {previewMode ? (
              <div
                className="rounded-lg px-3 py-2.5 flex gap-2 text-xs"
                style={{
                  background: 'rgba(56,189,248,0.08)',
                  border: '1px solid rgba(56,189,248,0.25)',
                  color: 'rgba(238,238,248,0.78)',
                }}
              >
                <Eye size={14} style={{ color: '#38bdf8', flexShrink: 0, marginTop: 1 }} />
                <span>
                  <strong style={{ color: '#7dd3fc' }}>Preview run</strong> — Playwright will
                  execute this test live so you can watch it break. The result
                  is <strong>not logged</strong>: it doesn't appear in Recent
                  Runs, doesn't count toward pass rate, doesn't bump the
                  donut. Use this to debug, then hit Run Test once you're
                  happy.
                </span>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
                Runs only this test in isolation. The result is logged in run
                history alongside every other run — distinct from the recorder
                <em> Preview</em> flow, which creates a temporary throwaway test.
                Save your steps first if you've changed anything.
              </p>
            )}
            {!previewMode && (
              <div className="flex gap-2">
                {/* Hide AUTOMATED button when the parent feature has it
                    disabled — keeps the UX consistent with what the backend
                    will accept and forces MANUAL by removal of the choice. */}
                {((automationAvailable ? ['AUTOMATED', 'MANUAL'] : ['MANUAL']) as Array<'AUTOMATED' | 'MANUAL'>).map(m => {
                  const effective = automationAvailable ? runMode : 'MANUAL';
                  return (
                    <button key={m} type="button" onClick={() => setRunMode(m)}
                      className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
                      style={effective === m ? {
                        background: m === 'AUTOMATED' ? 'rgba(var(--accent-rgb),0.20)' : 'rgba(16,185,129,0.15)',
                        border: `1px solid ${m === 'AUTOMATED' ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(16,185,129,0.40)'}`,
                        color: m === 'AUTOMATED' ? 'var(--accent-300)' : '#34d399',
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
            )}
            {!previewMode && !automationAvailable && (
              <div
                className="rounded-lg px-3 py-2 flex items-start gap-2 text-[11px]"
                style={{
                  background: 'rgba(148,163,184,0.10)',
                  border: '1px solid rgba(148,163,184,0.22)',
                  color: 'rgba(238,238,248,0.65)',
                }}
              >
                <span>
                  No automation-enabled environment. Turn on “Supports automation”
                  for an environment to unlock automated runs and Preview.
                </span>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.60)' }}>
                Environment
              </label>
              <select
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: runEnvId ? 'rgba(238,238,248,0.90)' : 'rgba(238,238,248,0.40)',
                }}
                value={runEnvId}
                onChange={e => setRunEnvId(e.target.value)}
              >
                <option value="">Select environment…</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
              {runEnvId && (() => {
                const sel = environments.find(e => e.id === runEnvId);
                return sel ? (
                  <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <ExternalLink size={11} style={{ color: 'rgba(238,238,248,0.35)', flexShrink: 0 }} />
                    <span className="text-xs font-mono truncate" style={{ color: 'rgba(238,238,248,0.55)' }}>
                      {sel.baseUrl}
                    </span>
                  </div>
                ) : null;
              })()}
            </div>
            {initialSteps.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                <AlertTriangle size={13} />
                No steps defined — save your steps first before running.
              </div>
            )}
            {runMode === 'MANUAL' && !effectiveFeatureId && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.28)', color: '#fbbf24' }}>
                <AlertTriangle size={13} />
                Manual testing requires a feature context. Open this test from a feature page to run it manually.
              </div>
            )}
            {runMode === 'MANUAL' && effectiveFeatureId && (
              <p className="text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Opens the manual test player and navigates directly to this test case.
              </p>
            )}

            {/* Watch-live toggle — only meaningful for automated *logged*
                runs. Preview is implicitly always-watched (the whole point)
                so we hide the checkbox; manual mode has its own
                full-screen player. */}
            {!previewMode && runMode === 'AUTOMATED' && (
              <label
                className="flex items-start gap-2 cursor-pointer rounded-lg px-3 py-2.5 transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <input
                  type="checkbox"
                  checked={watchLive}
                  onChange={(e) => setWatchLive(e.target.checked)}
                  className="accent-violet-500 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.85)' }}>
                    Watch live
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                    {watchLive
                      ? 'Opens a live viewer with the Playwright replay stream.'
                      : 'Runs in the background — track it in Recent Runs below or click the row to open the full run page.'}
                  </div>
                </div>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="secondary"
                onClick={() => { setRunModalOpen(false); setPreviewMode(false); }}
              >
                Cancel
              </Button>
              <Button
                loading={triggerRun.isPending}
                disabled={!runEnvId || isNew || (!previewMode && effectiveRunModeForTrigger === 'MANUAL' && !effectiveFeatureId)}
                onClick={() => triggerRun.mutate()}
              >
                {previewMode
                  ? <><Eye size={14} /> Preview Run</>
                  : effectiveRunModeForTrigger === 'MANUAL'
                    ? <><Play size={14} /> Start Manual Test</>
                    : <><Play size={14} /> Run Test</>
                }
              </Button>
            </div>
          </div>
        </Modal>

        {/* Test notes (shared + personal) */}
        {!isNew && testId && projectId && (
          <Modal open={notesOpen} onClose={() => setNotesOpen(false)} title="Notes" size="lg">
            <div className="h-[60vh]">
              <TestNotesPanel testId={testId} testName={name} projectId={projectId} onClose={() => setNotesOpen(false)} />
            </div>
          </Modal>
        )}

        {/* Issue list drawer */}
        {!isNew && testId && projectId && (
          <IssueListDrawer
            open={issueDrawerOpen}
            onClose={() => setIssueDrawerOpen(false)}
            projectId={projectId}
            testDefinitionId={testId}
            scopeLabel="This Test"
          />
        )}
      </div>
    );
  }

  // API / SHELL tests keep the JSON editor
  const palette = STEP_PALETTES[testType];
  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header — stacks on mobile (see the form-editor header above). */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg transition-colors shrink-0"
            style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>
              {isNew ? 'New Test' : `Edit: ${name || 'Test'}`}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>Edit the JSON step definition below</p>
            {featureId && (
              <div className="mt-1.5">
                <ClickUpRoutingHint scope={{ kind: 'feature', featureId }} variant="badge" />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">
          {!isNew && testId && (
            <ExportButton level="testCase" id={testId} name={name || 'test'} />
          )}
          <Button onClick={handleJsonSave} loading={saveMeta.isPending}><Save size={14} /> Save Test</Button>
        </div>
      </div>

      {MetaFields}

      {!isNew && testId && (
        <ScopedDocsPanel scope="test" scopeId={testId} />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* JSON editor — 2/3 width */}
        <div className="col-span-2">
          <Card>
            <CardContent className="p-0">
              <textarea
                className="w-full font-mono text-xs text-gray-800 p-5 focus:outline-none resize-none bg-transparent"
                rows={42}
                value={json}
                onChange={(e) => setJson(e.target.value)}
                spellCheck={false}
              />
            </CardContent>
          </Card>
        </div>

        {/* Step palette — 1/3 width */}
        <div className="space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
              {TYPE_ICONS[testType]}
              {testType} Step Types
            </h4>
            <div className="space-y-2">
              {palette.map(s => (
                <div key={s.type}>
                  <div className="font-mono text-xs text-sky-700 font-semibold">{s.type}</div>
                  <div className="text-xs text-gray-400">{s.description}</div>
                </div>
              ))}
            </div>
          </div>

          {testType === 'API' && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs">
              <p className="font-semibold text-blue-700 mb-1">Variable interpolation</p>
              <p className="text-blue-500">Use <code className="font-mono bg-blue-100 px-1 rounded">{'{{VAR_NAME}}'}</code> in URL or body. Extract via <code className="font-mono bg-blue-100 px-1 rounded">EXTRACT</code> step.</p>
            </div>
          )}

          {testType === 'SHELL' && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs">
              <p className="font-semibold text-amber-700 mb-1">Shell execution</p>
              <p className="text-amber-600">Commands run via <code className="font-mono bg-amber-100 px-1 rounded">child_process.exec</code>. Non-zero exit codes are captured without throwing.</p>
            </div>
          )}
        </div>
      </div>

      {/* Recent runs — same panel as the UI variant above, mirrored here for
          API and SHELL tests. Sits below the step palette. */}
      {!isNew && testId && projectId && (
        <RecentRunsPanel projectId={projectId} testId={testId} />
      )}

      {/* Issue list drawer */}
      {!isNew && testId && projectId && (
        <IssueListDrawer
          open={issueDrawerOpen}
          onClose={() => setIssueDrawerOpen(false)}
          projectId={projectId}
          testDefinitionId={testId}
          scopeLabel="This Test"
        />
      )}
    </div>
  );
}

/**
 * Raw JSON editor for UI test steps — the power-user escape hatch.
 *
 * Renders the current steps as pretty-printed JSON in a textarea. Validates
 * on save: must parse as JSON, must be an array, every entry must have a
 * `type` field. Anything else is up to the user. Useful for bulk
 * find-and-replace (e.g. swap a hostname in every selector), manually
 * authoring `fallbackSelectors[]`, or pasting steps from an external tool.
 */
function StepsJsonEditor({
  initialSteps, onSave, onCancel,
}: {
  initialSteps: Step[];
  onSave: (steps: Step[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [json, setJson] = useState(() => JSON.stringify(initialSteps, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      setError(`JSON parse error: ${(e as Error).message}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      setError('Top-level value must be an array of step objects');
      return;
    }
    for (let i = 0; i < parsed.length; i++) {
      const s = parsed[i] as { type?: unknown };
      if (!s || typeof s !== 'object' || typeof s.type !== 'string' || !s.type) {
        setError(`Step ${i + 1} is missing a non-empty "type" field`);
        return;
      }
    }
    setSaving(true);
    try {
      // Re-index so the saved positions are contiguous regardless of what
      // the user wrote.
      const reindexed = (parsed as Step[]).map((s, i) => ({ ...s, index: i }));
      await onSave(reindexed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          rows={32}
          className="w-full font-mono text-xs p-4 focus:outline-none resize-none bg-transparent"
          style={{ color: 'rgba(238,238,248,0.85)' }}
        />
      </div>
      {error && (
        <div className="rounded-lg px-3 py-2 text-xs"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}>
          {error}
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.50)' }}>
          Top-level must be an array of step objects. Each step needs <code className="font-mono">type</code> and (usually) an <code className="font-mono">input</code> field.
        </p>
        <div className="flex gap-2 shrink-0">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save JSON</Button>
        </div>
      </div>
    </div>
  );
}
