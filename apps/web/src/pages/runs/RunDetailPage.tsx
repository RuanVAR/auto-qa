import { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles, CheckCircle, XCircle, Clock, Image, FileArchive, Wifi, SkipForward, Bug, ListChecks, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { runsApi, aiApi, artifactsApi, issuesApi, featureRunsApi } from '@/lib/api';
import { GenerateReportButton } from '@/components/GenerateReportButton';
import { downloadArtifact } from '@/components/testing/ArtifactImage';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { Badge } from '@/components/ui/Badge';
import { PageSpinner } from '@/components/ui/Spinner';
import { ScreenshotViewer } from '@/components/ScreenshotViewer';
import { LiveBrowserCanvas } from '@/components/LiveBrowserCanvas';
import { StepFailurePanel } from '@/components/StepFailurePanel';
import { useRunSocket } from '@/hooks/useRunSocket';
import { formatDate, formatDuration, cn } from '@/lib/utils';

function StepIcon({ status }: { status: string }) {
  if (status === 'PASSED') return <CheckCircle size={14} className="text-green-500" />;
  // Passed via a selector fallback — counts as passing, but must never be
  // visually indistinguishable from a clean pass (docs/plan §2.2, non-negotiable).
  if (status === 'PASSED_HEALED') return <Wrench size={14} className="text-amber-500" />;
  if (status === 'FAILED' || status === 'ERROR') return <XCircle size={14} className="text-red-500" />;
  return <Clock size={14} className="text-gray-300" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunData = Record<string, any>;

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [aiText, setAiText] = useState('');
  const [aiLabel, setAiLabel] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [failedStep, setFailedStep] = useState<RunData | null>(null);

  const { data: runRaw, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.get(runId!),
    enabled: !!runId,
    // Keep polling as fallback if socket not connected
    refetchInterval: (query) => {
      const status = (query.state.data as RunData | undefined)?.status as string | undefined;
      return status && ['PENDING', 'QUEUED', 'RUNNING'].includes(status) ? 5000 : false;
    },
  });
  const run = runRaw as RunData | undefined;

  // Live updates via WebSocket
  useRunSocket(runId, run?.projectId as string | undefined);

  // Auto-surface the first failed step in the failure panel
  useEffect(() => {
    if (!run) return;
    const steps = (run.steps ?? []) as RunData[];
    const failed = steps.find((s) => s.status === 'FAILED' || s.status === 'ERROR');
    setFailedStep(failed ?? null);
  }, [run]);

  const { data: artifacts = [] } = useQuery({
    queryKey: ['artifacts', runId],
    queryFn: () => artifactsApi.list(runId!),
    enabled: !!runId,
  });

  // Issues logged against this run (Issue.testRunId). Needs the run loaded
  // first because the issues endpoint is project-scoped.
  const projectId = run?.projectId as string | undefined;
  const { data: issuesData } = useQuery({
    queryKey: ['run-issues', projectId, runId],
    queryFn: () => issuesApi.list(projectId!, { testRunId: runId!, limit: 100 }),
    enabled: !!projectId && !!runId,
  });
  const issues = ((issuesData as { items?: RunData[] })?.items ?? []) as RunData[];

  // When this run is part of a feature run, the meaningful unit is the SET of
  // tests that ran together, each with its pass/fail result — not this one
  // test's steps. Load the feature run so we can lead with that test list.
  const featureRunId = run?.featureRunId as string | undefined;
  const { data: featureRunData } = useQuery({
    queryKey: ['feature-run', featureRunId],
    queryFn: () => featureRunsApi.get(featureRunId!),
    enabled: !!featureRunId,
  });
  const siblingTests = ((featureRunData as { testRuns?: RunData[] })?.testRuns ?? []) as RunData[];
  const isMultiTest = siblingTests.length > 1;
  // Steps are a drill-down once we're showing the test list — collapse by default.
  const [stepsOpen, setStepsOpen] = useState(false);

  const explain = useMutation({
    mutationFn: () => aiApi.explain(runId!),
    onSuccess: (d) => { setAiText(d as string); setAiLabel('AI Failure Explanation'); },
  });
  const summarise = useMutation({
    mutationFn: () => aiApi.summarise(runId!),
    onSuccess: (d) => { setAiText(d as string); setAiLabel('AI Run Summary'); },
  });

  /**
   * Back navigation. Testers reach this page from several places:
   *   - /projects/:id/runs (the runs list)
   *   - /projects/:id/tests/:testId/edit (TestEditorPage RecentRunsPanel)
   *   - /projects/:id/modules/:moduleId/features/:featureId (FeaturePage)
   *
   * The old "always go to /projects/:id/runs" was wrong for two of those
   * three sources. Use navigate(-1) so they land back where they were.
   * location.key === 'default' means this is the first entry in this
   * session (refresh / direct URL hit) — only then fall back to the project
   * runs list, because there's no prior history to pop.
   */
  const onBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
    } else if (run?.projectId) {
      navigate(`/projects/${run.projectId as string}/runs`);
    } else {
      navigate('/');
    }
  };

  if (isLoading) return <PageSpinner />;
  if (!run) return <div className="text-sm text-gray-500">Run not found.</div>;

  const steps = (run.steps ?? []) as RunData[];
  const arts = artifacts as RunData[];
  const screenshots = arts.filter(a => a.type === 'SCREENSHOT').map(a => {
    const meta = (a.metadata ?? {}) as { stepIndex?: number; stepName?: string; trigger?: string };
    return {
      id: a.id as string,
      url: `${API_BASE}/api/v1/artifacts/${a.id as string}/download?inline=1`,
      name: a.filename as string,
      stepIndex: meta.stepIndex,
      stepName: meta.stepName,
      trigger: meta.trigger,
    };
  });
  const traces = arts.filter(a => a.type === 'TRACE');

  const isLive = ['PENDING', 'QUEUED', 'RUNNING'].includes(run.status as string);

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900">{
              isMultiTest
                ? ((featureRunData as { feature?: { name?: string } } | undefined)?.feature?.name ?? 'Feature run')
                : ((run.testDefinition as RunData | undefined)?.name ?? 'Run Detail')
            }</h2>
            {isMultiTest ? (
              <Badge variant="muted" className="text-gray-700 bg-gray-50 border-gray-200">
                {siblingTests.filter(t => t.status === 'PASSED').length}/{siblingTests.length} passed
              </Badge>
            ) : (
              <RunStatusBadge status={run.status as string} />
            )}
            {/* A green run that leaned on selector drift detection must be
                visible at a glance (docs/plan §2.2). */}
            {!!((run.healCount as number | undefined) ?? 0) && (
              <span title="Steps that passed only after a selector fallback was used">
                <Badge variant="muted" className="text-amber-600 bg-amber-50 border-amber-200">
                  <Wrench size={10} className="mr-0.5" /> {run.healCount as number} healed
                </Badge>
              </span>
            )}
            <Badge
              variant="muted"
              className={run.runMode === 'MANUAL'
                ? 'text-violet-600 bg-violet-50 border-violet-200'
                : 'text-sky-600 bg-sky-50 border-sky-200'}
            >
              {run.runMode === 'MANUAL' ? 'Manual' : 'Automated'}
            </Badge>
            {isLive && (
              <span className="flex items-center gap-1 text-xs text-sky-600 animate-pulse">
                <Wifi size={12} /> Live
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {(run.environment as RunData | undefined)?.name} · {formatDate(run.createdAt as string)} · {formatDuration(run.duration as number)}
            {(run.triggeredBy as RunData | undefined)?.name && (
              <> · Run by {(run.triggeredBy as RunData).name as string}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" loading={summarise.isPending} onClick={() => summarise.mutate()}>
            <Sparkles size={13} /> Summarise
          </Button>
          {run.status === 'FAILED' && (
            <Button variant="secondary" size="sm" loading={explain.isPending} onClick={() => explain.mutate()}>
              <Sparkles size={13} /> Explain Failure
            </Button>
          )}
          {/* Session report — spans every feature touched in this run's work
              session. Only offered when the run is attached to a session. */}
          {run.workSessionId && projectId && (
            <GenerateReportButton
              projectId={projectId}
              scope={{ type: 'SESSION', workSessionId: run.workSessionId as string }}
              scopeTitle={(run.testDefinition as RunData | undefined)?.name as string | undefined}
              variant="secondary"
              size="sm"
              label="Report"
            />
          )}
        </div>
      </div>

      {!!(run.errorMessage) && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          <strong>Error:</strong> {run.errorMessage as string}
        </div>
      )}

      {aiText && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-violet-500" />
              <CardTitle>{aiLabel}</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{aiText}</pre>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Tests + steps drill-down + failure panel */}
        <div className="lg:col-span-2 space-y-3">
          {/* Tests in this run — the meaningful unit is each test + its result.
              Shown when this run is part of a multi-test feature run. */}
          {isMultiTest && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ListChecks size={14} className="text-sky-500" />
                  <CardTitle>Tests in this run ({siblingTests.length})</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="p-2">
                <div className="space-y-1">
                  {siblingTests.map((tr) => {
                    const td = tr.testDefinition as RunData | undefined;
                    const isCurrent = (tr.id as string) === runId;
                    return (
                      <Link
                        key={tr.id as string}
                        to={`/runs/${tr.id as string}`}
                        className={cn(
                          'flex items-center gap-3 p-2.5 rounded-lg border text-sm',
                          isCurrent ? 'bg-sky-50 border-sky-200' : 'bg-white border-gray-200 hover:bg-gray-50'
                        )}
                      >
                        <StepIcon status={tr.status as string} />
                        <span className="flex-1 min-w-0 truncate font-medium text-gray-800">
                          {td?.name ?? 'Untitled test'}
                          {isCurrent && <span className="ml-2 text-[11px] font-normal text-sky-600">· viewing</span>}
                        </span>
                        <RunStatusBadge status={tr.status as string} />
                        <span className="text-xs text-gray-400 font-mono shrink-0 w-14 text-right">{formatDuration(tr.duration as number)}</span>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Steps — a drill-down into the currently-viewed test. Collapsed by
              default once the test list leads; always open for a solo run. */}
          {isMultiTest ? (
            <button
              type="button"
              onClick={() => setStepsOpen(o => !o)}
              className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 hover:text-gray-900"
            >
              {stepsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              Steps ({steps.length}) <span className="font-normal text-gray-400">— {(run.testDefinition as RunData | undefined)?.name as string}</span>
            </button>
          ) : (
            <h3 className="text-sm font-semibold text-gray-700">Steps ({steps.length})</h3>
          )}
          {/* Failure clustering (docs/plan §3.2) — "3 distinct problems
              across N failed steps" rather than a wall of individually
              scary-looking red rows that are actually the same root cause. */}
          {(!isMultiTest || stepsOpen) && (() => {
            const failedFingerprints = new Set(
              steps.filter(s => (s.status === 'FAILED' || s.status === 'ERROR') && s.failureFingerprint)
                .map(s => s.failureFingerprint as string),
            );
            const failedCount = steps.filter(s => s.status === 'FAILED' || s.status === 'ERROR').length;
            if (failedFingerprints.size < 2) return null;
            return (
              <div className="text-xs text-gray-500 -mt-1">
                {failedFingerprints.size} distinct problem{failedFingerprints.size !== 1 ? 's' : ''} across {failedCount} failed step{failedCount !== 1 ? 's' : ''}
              </div>
            );
          })()}
          {(!isMultiTest || stepsOpen) && steps.length === 0 && (
            <div className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl border border-gray-200">
              {isLive ? 'Waiting for steps…' : 'No steps recorded.'}
            </div>
          )}
          {(!isMultiTest || stepsOpen) && steps.map((step, i) => {
            // Prefer artifact metadata.stepIndex (precise, set by worker).
            // Fall back to legacy filename pattern matching for older runs.
            const stepScreenshot =
              screenshots.find(s => s.stepIndex === i) ??
              screenshots.find(s => s.name.includes(`step-${i}`) || s.name.includes(`step_${i}`));
            const screenshotIdx = stepScreenshot ? screenshots.indexOf(stepScreenshot) : -1;
            const isFailed = step.status === 'FAILED' || step.status === 'ERROR';

            return (
              <div
                key={step.id as string}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border text-sm',
                  step.status === 'PASSED' ? 'bg-white border-gray-200' :
                  isFailed ? 'bg-red-50 border-red-200' :
                  step.status === 'SKIPPED' || step.status === 'PASSED_HEALED' ? 'bg-amber-50 border-amber-200' :
                  'bg-gray-50 border-gray-200'
                )}
              >
                <StepIcon status={step.status as string} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-800 truncate">{step.name as string}</span>
                    <Badge variant="muted">{step.type as string}</Badge>
                    {step.status === 'SKIPPED' && (
                      <Badge variant="muted" className="text-amber-600 bg-amber-50 border-amber-200">
                        <SkipForward size={10} className="mr-0.5" /> Skipped
                      </Badge>
                    )}
                    {step.status === 'PASSED_HEALED' && (
                      <span title="Selector drifted — resolved via fallback. The original selector stays stored as primary until a human promotes the fix.">
                        <Badge variant="muted" className="text-amber-600 bg-amber-50 border-amber-200">
                          <Wrench size={10} className="mr-0.5" /> Healed
                        </Badge>
                      </span>
                    )}
                    {screenshotIdx >= 0 && (
                      <button
                        onClick={() => setLightboxIndex(screenshotIdx)}
                        className="flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700"
                      >
                        <Image size={11} /> Screenshot
                      </button>
                    )}
                  </div>
                  {!!(step.errorMessage) && (
                    <div className="text-xs text-red-600 mt-1 font-mono">
                      {step.errorMessage as string}
                      {/* First-pass triage (docs/plan §3.4) — a proposed
                          bucket, never a silent guess; unclassified stays
                          unlabeled rather than shown wrong. */}
                      {!!step.triageBucket && (
                        <span className="ml-2 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-sans font-medium text-gray-500">
                          {(step.triageBucket as string).toLowerCase()}
                        </span>
                      )}
                    </div>
                  )}
                  {!!(step.notes) && (
                    <div className="text-xs text-gray-500 mt-1 italic">
                      Note: {step.notes as string}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 shrink-0 font-mono">{formatDuration(step.duration as number)}</span>
              </div>
            );
          })}

          {/* Step Failure Panel */}
          {failedStep && runId && (
            <StepFailurePanel
              runId={runId}
              projectId={run?.projectId as string | undefined}
              featureId={run?.featureId as string | undefined}
              step={{
                id: failedStep.id as string,
                index: failedStep.index as number,
                name: failedStep.name as string,
                errorMessage: failedStep.errorMessage as string | null | undefined,
              }}
              onActionComplete={() => {
                void queryClient.invalidateQueries({ queryKey: ['run', runId] });
              }}
            />
          )}
        </div>

        {/* Sidebar: live canvas + artifacts */}
        <div className="space-y-4">
          {/* Live Browser Canvas — only shown while run is active (AUTOMATED UI runs) */}
          {isLive && run.runMode !== 'MANUAL' && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-gray-700">Live Browser</h3>
              <LiveBrowserCanvas runId={runId!} active={isLive} />
            </div>
          )}

          <Card>
            <CardHeader><CardTitle>Screenshots ({screenshots.length})</CardTitle></CardHeader>
            <CardContent className={screenshots.length === 0 ? 'py-6' : 'p-3'}>
              {screenshots.length === 0 ? (
                <div className="text-center text-xs text-gray-400">None</div>
              ) : (
                <div className="space-y-1">
                  {screenshots.map((s, i) => (
                    <button
                      key={s.id}
                      onClick={() => setLightboxIndex(i)}
                      className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-gray-50 text-left"
                    >
                      <Image size={13} className="text-gray-400 shrink-0" />
                      <span className="truncate text-xs text-gray-700">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Traces ({traces.length})</CardTitle></CardHeader>
            <CardContent className={traces.length === 0 ? 'py-6' : 'p-3'}>
              {traces.length === 0 ? (
                <div className="text-center text-xs text-gray-400">None</div>
              ) : (
                traces.map(a => (
                  // Authenticated download — plain <a href> 401s because
                  // the API requires the Bearer token (browser doesn't send
                  // it on navigation requests). downloadArtifact fetches via
                  // axios + saves the blob.
                  <button
                    key={a.id as string}
                    type="button"
                    onClick={() => void downloadArtifact(a.id as string, a.filename as string)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 text-left"
                  >
                    <FileArchive size={13} className="text-gray-400" />
                    <span className="truncate text-xs text-gray-700">{a.filename as string}</span>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bug size={14} className="text-rose-500" />
                <CardTitle>Issues ({issues.length})</CardTitle>
              </div>
            </CardHeader>
            <CardContent className={issues.length === 0 ? 'py-6' : 'p-3'}>
              {issues.length === 0 ? (
                <div className="text-center text-xs text-gray-400">No issues logged for this run</div>
              ) : (
                <div className="space-y-1">
                  {issues.map(iss => (
                    <Link
                      key={iss.id as string}
                      to={`/issues/${iss.id as string}`}
                      className="flex items-start gap-2 w-full p-2 rounded-lg hover:bg-gray-50 text-left"
                    >
                      <Bug size={13} className="text-rose-400 shrink-0 mt-0.5" />
                      <span className="flex-1 min-w-0">
                        <span className="block truncate text-xs text-gray-700">{iss.title as string}</span>
                        <span className="flex items-center gap-1.5 mt-0.5">
                          <Badge variant="muted" className="text-[10px]">{iss.severity as string}</Badge>
                          <Badge variant="muted" className="text-[10px]">{iss.status as string}</Badge>
                        </span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Screenshot lightbox */}
      {lightboxIndex !== null && screenshots.length > 0 && (
        <ScreenshotViewer
          screenshots={screenshots}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
