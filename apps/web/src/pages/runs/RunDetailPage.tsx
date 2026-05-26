import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, CheckCircle, XCircle, Clock, Image, FileArchive, Wifi, SkipForward } from 'lucide-react';
import { runsApi, aiApi, artifactsApi } from '@/lib/api';
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
  if (status === 'FAILED' || status === 'ERROR') return <XCircle size={14} className="text-red-500" />;
  return <Clock size={14} className="text-gray-300" />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RunData = Record<string, any>;

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
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

  const explain = useMutation({
    mutationFn: () => aiApi.explain(runId!),
    onSuccess: (d) => { setAiText(d as string); setAiLabel('AI Failure Explanation'); },
  });
  const summarise = useMutation({
    mutationFn: () => aiApi.summarise(runId!),
    onSuccess: (d) => { setAiText(d as string); setAiLabel('AI Run Summary'); },
  });

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
        <Link to={`/projects/${run.projectId as string}/runs`}>
          <button className="p-2 rounded-lg text-gray-400 hover:bg-gray-100"><ArrowLeft size={16} /></button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-gray-900">{(run.testDefinition as RunData | undefined)?.name ?? 'Run Detail'}</h2>
            <RunStatusBadge status={run.status as string} />
            {isLive && (
              <span className="flex items-center gap-1 text-xs text-sky-600 animate-pulse">
                <Wifi size={12} /> Live
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {(run.environment as RunData | undefined)?.name} · {formatDate(run.createdAt as string)} · {formatDuration(run.duration as number)}
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
        {/* Steps + failure panel */}
        <div className="lg:col-span-2 space-y-3">
          <h3 className="text-sm font-semibold text-gray-700">Steps ({steps.length})</h3>
          {steps.length === 0 && (
            <div className="text-sm text-gray-400 py-6 text-center bg-gray-50 rounded-xl border border-gray-200">
              {isLive ? 'Waiting for steps…' : 'No steps recorded.'}
            </div>
          )}
          {steps.map((step, i) => {
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
                  step.status === 'SKIPPED' ? 'bg-amber-50 border-amber-200' :
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
                    <div className="text-xs text-red-600 mt-1 font-mono">{step.errorMessage as string}</div>
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
