import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, ArrowLeft, Monitor, Globe, Terminal, Play, Zap, User, ExternalLink, AlertTriangle } from 'lucide-react';
import { testsApi, runsApi, environmentsApi } from '@/lib/api';
import { ExportButton, VersionHistoryButton } from '@/components/ImportExport';
import { LogIssueButton, IssueStatsWidget, IssueListDrawer } from '@/components/IssueTracker';
import { StepEditor, type Step } from '@/components/StepEditor';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { ClickUpRoutingHint } from '@/components/plugins/ClickUpRoutingHint';
import { ScopedDocsPanel } from '@/components/plugins/ScopedDocsPanel';

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

  const [selectedType, setSelectedType] = useState<TestType>('UI');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [json, setJson] = useState(() => JSON.stringify(BLANK_META['UI'], null, 2));
  const [error, setError] = useState('');
  const [metaReady, setMetaReady] = useState(isNew);
  // Issue drawer
  const [issueDrawerOpen, setIssueDrawerOpen] = useState(false);

  // Solo run modal
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [runEnvId, setRunEnvId] = useState('');
  const [runMode, setRunMode] = useState<'AUTOMATED' | 'MANUAL'>('AUTOMATED');

  // Load existing test when editing
  const { data: existingTest, isLoading: loadingTest } = useQuery<Record<string, unknown>>({
    queryKey: ['test', testId],
    queryFn: () => testsApi.get(projectId!, testId!),
    enabled: !isNew && !!testId,
    staleTime: 60_000,
  });

  // Environments for the run modal
  const { data: environments = [] } = useQuery<{ id: string; name: string; baseUrl: string }[]>({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  const triggerRun = useMutation({
    mutationFn: () => runsApi.trigger(projectId!, {
      testDefinitionId: testId!,
      environmentId: runEnvId,
      runMode,
    }),
    onSuccess: () => {
      setRunModalOpen(false);
    },
  });

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

  const initialSteps: Step[] = isNew
    ? [{ index: 0, name: 'Navigate to home', type: 'NAVIGATE' as const, input: { url: '/' } }]
    : ((existingTest?.steps as Step[]) ?? []);

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
                background: 'rgba(139,92,246,0.25)',
                color: '#c4b5fd',
                border: '1px solid rgba(139,92,246,0.45)',
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
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Description <span style={{ color: 'rgba(238,238,248,0.30)' }}>(optional — Jira ticket summary, acceptance criteria, etc.)</span>
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="What does this test verify? You can paste Jira ticket text or acceptance criteria here — AI will use this when generating steps."
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.82)',
            }}
          />
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
                  style={{ background: 'rgba(139,92,246,0.18)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.28)' }}
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
      <div className="space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg transition-colors"
              style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h2 className="text-xl font-bold" style={{ color: 'rgba(238,238,248,0.92)' }}>
                {isNew ? 'New Test' : `Edit: ${name || 'Test'}`}
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Fill in the details below, then build your steps
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
            {!isNew && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setRunEnvId(environments[0]?.id ?? '');
                  setRunModalOpen(true);
                }}
              >
                <Play size={13} /> Run Test
              </Button>
            )}
          </div>
        </div>

        {MetaFields}

        <StepEditor
          testName={name || 'New UI Test'}
          initialSteps={initialSteps}
          onSave={handleSaveSteps}
          onCancel={() => navigate(-1)}
        />

        {/* Run this test solo modal */}
        <Modal open={runModalOpen} onClose={() => setRunModalOpen(false)} title={`Run: ${name || 'Test'}`}>
          <div className="space-y-4">
            <p className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
              Runs only this test in isolation. Make sure you have saved any recent changes first.
            </p>
            <div className="flex gap-2">
              {(['AUTOMATED', 'MANUAL'] as const).map(m => (
                <button key={m} type="button" onClick={() => setRunMode(m)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-all"
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
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={() => setRunModalOpen(false)}>Cancel</Button>
              <Button loading={triggerRun.isPending} disabled={!runEnvId || isNew}
                onClick={() => triggerRun.mutate()}>
                <Play size={14} /> Run Test
              </Button>
            </div>
          </div>
        </Modal>

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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'rgba(238,238,248,0.55)', background: 'rgba(255,255,255,0.05)' }}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
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
        <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-3 gap-4">
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
