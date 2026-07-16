/**
 * PipelinesPanel — ordered multi-feature automated runs for a project.
 *
 * A pipeline chains stages (feature + env + on-failure policy) SEQUENTIALLY
 * as one unit: one trigger, one aggregate result, one webhook. Differs from
 * promote() (a governance flow gated on sign-off) — a pipeline is pure
 * execution. Rendered on the Runs & Schedules page beside SchedulesPanel.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GitBranch, Play, Plus, Square, Terminal, Trash2, X } from 'lucide-react';
import {
  environmentsApi, featuresApi, pipelinesApi,
  type Pipeline, type PipelineRun, type PipelineStageResult,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { errMsg, formatDate } from '@/lib/utils';
import { HealthStrip, statusColor } from '@/components/runs/RunHealth';
import { CopyBlock } from '@/components/testing/CiTriggerModal';
import { selectAutomationEnvs } from '@/lib/automation';
import { usePipelineRunSocket } from '@/hooks/usePipelineRunSocket';

interface StageDraft {
  featureId: string;
  environmentId: string;
  onFailure: 'HALT' | 'CONTINUE';
}

const inputStyle = 'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs';

export function PipelinesPanel({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [builderFor, setBuilderFor] = useState<Pipeline | 'new' | null>(null);
  const [historyFor, setHistoryFor] = useState<Pipeline | null>(null);
  const [ciFor, setCiFor] = useState<Pipeline | null>(null);

  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines', projectId],
    queryFn: () => pipelinesApi.list(projectId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['pipelines', projectId] });

  const triggerMut = useMutation({
    mutationFn: (id: string) => pipelinesApi.trigger(id),
    onSuccess: () => { toast.success('Pipeline started'); invalidate(); },
    onError: (err) => toast.error(errMsg(err, 'Failed to start pipeline')),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => pipelinesApi.remove(id),
    onSuccess: () => { toast.success('Pipeline deleted'); invalidate(); },
    onError: (err) => toast.error(errMsg(err, 'Failed to delete pipeline')),
  });

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch size={14} className="text-violet-500" />
          <span className="text-sm font-semibold text-gray-900">Pipelines ({pipelines.length})</span>
          <span className="text-xs text-gray-400">ordered multi-feature automated runs</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setBuilderFor('new')}>
            <Plus size={13} /> New pipeline
          </Button>
        </div>

        {pipelines.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">
            None yet — chain features into one CI-triggerable run (e.g. API smoke → UI regression).
          </div>
        ) : (
          <div className="space-y-1">
            {pipelines.map(p => {
              const runs = p.runs ?? [];
              const last = runs[0];
              const live = last?.status === 'RUNNING' ? last : null;
              return (
                <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <button
                    type="button"
                    title={live ? 'Pipeline is running' : 'Run this pipeline now'}
                    disabled={!!live || triggerMut.isPending}
                    onClick={() => triggerMut.mutate(p.id)}
                    className="shrink-0 disabled:opacity-40"
                    style={{ color: 'var(--accent-400)' }}
                  >
                    <Play size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryFor(p)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    title="View this pipeline's run history"
                  >
                    <span className="truncate text-xs font-medium text-gray-700">{p.name}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{p.stages.length} stage{p.stages.length !== 1 ? 's' : ''}</span>
                    {runs.length > 0 && <HealthStrip runs={runs} />}
                    {live ? (
                      <span className="shrink-0 animate-pulse text-[11px] font-medium" style={{ color: 'var(--accent-400)' }}>
                        stage {live.currentStageOrder + 1}/{p.stages.length} running
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 text-[11px] tabular-nums" style={{ color: last ? statusColor(last.status) : 'rgba(148,163,184,0.7)' }}>
                        {last ? `last ${formatDate(last.startedAt)}` : 'never run'}
                      </span>
                    )}
                  </button>
                  <button type="button" onClick={() => setCiFor(p)} className="shrink-0 text-gray-300 hover:text-gray-500" title="Trigger from CI (GitHub Actions poll gate)">
                    <Terminal size={13} />
                  </button>
                  <button type="button" onClick={() => setBuilderFor(p)} className="shrink-0 text-[11px] text-gray-300 hover:text-gray-500" title="Edit pipeline">
                    edit
                  </button>
                  <button type="button" onClick={() => removeMut.mutate(p.id)} className="shrink-0 text-gray-300 hover:text-red-500" title="Delete pipeline (blocked while running)">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {builderFor && (
        <PipelineBuilderModal
          projectId={projectId}
          existing={builderFor === 'new' ? null : builderFor}
          onClose={() => setBuilderFor(null)}
          onSaved={() => { setBuilderFor(null); invalidate(); }}
        />
      )}
      {historyFor && (
        <PipelineHistoryModal projectId={projectId} pipeline={historyFor} onClose={() => setHistoryFor(null)} />
      )}
      {ciFor && <PipelineCiModal pipeline={ciFor} onClose={() => setCiFor(null)} />}
    </Card>
  );
}

// ─── Builder ─────────────────────────────────────────────────────────────────

function PipelineBuilderModal({
  projectId, existing, onClose, onSaved,
}: { projectId: string; existing: Pipeline | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [updatesFeatureStatus, setUpdatesFeatureStatus] = useState(existing?.updatesFeatureStatus ?? false);
  const [stages, setStages] = useState<StageDraft[]>(
    existing?.stages.map(s => ({ featureId: s.featureId, environmentId: s.environmentId, onFailure: s.onFailure }))
      ?? [{ featureId: '', environmentId: '', onFailure: 'HALT' }],
  );

  const { data: features = [] } = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId),
  });
  const { data: envs = [] } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId),
  });
  const automationEnvs = useMemo(() => selectAutomationEnvs(envs as Array<{ id: string; name: string; supportsAutomation?: boolean }>), [envs]);

  const saveMut = useMutation({
    mutationFn: () => existing
      ? pipelinesApi.update(existing.id, { name, updatesFeatureStatus, stages })
      : pipelinesApi.create(projectId, { name, updatesFeatureStatus, stages }),
    onSuccess: () => { toast.success(existing ? 'Pipeline updated' : 'Pipeline created'); onSaved(); },
    onError: (err) => toast.error(errMsg(err, 'Failed to save pipeline')),
  });

  const setStage = (i: number, patch: Partial<StageDraft>) =>
    setStages(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const move = (i: number, dir: -1 | 1) =>
    setStages(prev => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const valid = name.trim().length > 0 && stages.length > 0 && stages.every(s => s.featureId && s.environmentId);

  return (
    <Modal open onClose={onClose} title={existing ? `Edit pipeline — ${existing.name}` : 'New pipeline'} size="lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Release regression" className={inputStyle} maxLength={120} />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500">Stages (run in order, top → bottom)</label>
            <button
              type="button"
              onClick={() => setStages(prev => [...prev, { featureId: '', environmentId: '', onFailure: 'HALT' }])}
              disabled={stages.length >= 20}
              className="text-[11px] font-medium disabled:opacity-40"
              style={{ color: 'var(--accent-400)' }}
            >
              + Add stage
            </button>
          </div>
          <div className="space-y-1.5">
            {stages.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-lg border border-gray-100 px-2 py-1.5">
                <span className="w-5 shrink-0 text-center text-[11px] tabular-nums text-gray-400">{i + 1}</span>
                <select value={s.featureId} onChange={e => setStage(i, { featureId: e.target.value })} className={inputStyle}>
                  <option value="">Feature…</option>
                  {(features as Array<{ id: string; name: string }>).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select value={s.environmentId} onChange={e => setStage(i, { environmentId: e.target.value })} className={inputStyle}>
                  <option value="">Environment…</option>
                  {automationEnvs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select
                  value={s.onFailure}
                  onChange={e => setStage(i, { onFailure: e.target.value as 'HALT' | 'CONTINUE' })}
                  className={inputStyle}
                  title="What happens to the remaining stages if this one fails"
                >
                  <option value="HALT">On failure: halt</option>
                  <option value="CONTINUE">On failure: continue</option>
                </select>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="shrink-0 text-gray-300 hover:text-gray-500 disabled:opacity-30"><ArrowUp size={13} /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1} className="shrink-0 text-gray-300 hover:text-gray-500 disabled:opacity-30"><ArrowDown size={13} /></button>
                <button type="button" onClick={() => setStages(prev => prev.filter((_, idx) => idx !== i))} disabled={stages.length === 1} className="shrink-0 text-gray-300 hover:text-red-500 disabled:opacity-30"><X size={13} /></button>
              </div>
            ))}
          </div>
          {automationEnvs.length === 0 && (
            <p className="mt-1 text-[11px] text-yellow-600">
              No automation-enabled environments — turn on “Supports automation” on an environment first.
            </p>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs text-gray-600">
          <input type="checkbox" checked={updatesFeatureStatus} onChange={e => setUpdatesFeatureStatus(e.target.checked)} className="mt-0.5" />
          <span>
            Count results toward feature status
            <span className="block text-[11px] text-gray-400">
              Off (default): results live on the pipeline only — stage runs never change feature pass/fail state,
              stats, flaky detection or sign-off. On: stage runs behave like normal automated runs.
            </span>
          </span>
        </label>

        {existing && (
          <p className="text-[11px] text-gray-400">
            Edits never affect a run that is already in flight — it finishes on the definition it started with.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMut.mutate()} loading={saveMut.isPending} disabled={!valid}>
            {existing ? 'Save pipeline' : 'Create pipeline'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── History + live stage timeline ───────────────────────────────────────────

function PipelineHistoryModal({ projectId, pipeline, onClose }: { projectId: string; pipeline: Pipeline; onClose: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['pipeline-history', pipeline.id],
    queryFn: () => pipelinesApi.history(pipeline.id),
  });
  const liveRun = history.find(r => r.status === 'RUNNING') ?? null;
  usePipelineRunSocket(projectId, liveRun?.id ?? null);

  const stopMut = useMutation({
    mutationFn: (runId: string) => pipelinesApi.stopRun(runId),
    onSuccess: () => {
      toast.success('Pipeline stopped');
      qc.invalidateQueries({ queryKey: ['pipeline-history', pipeline.id] });
      qc.invalidateQueries({ queryKey: ['pipelines', projectId] });
    },
    onError: (err) => toast.error(errMsg(err, 'Failed to stop pipeline')),
  });

  return (
    <Modal open onClose={onClose} title={`Run history — ${pipeline.name}`} size="lg">
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          Every run of this pipeline, newest first. Click a run for its stage timeline.
        </p>
        {isLoading ? (
          <p className="py-4 text-xs text-gray-400">Loading…</p>
        ) : history.length === 0 ? (
          <p className="py-4 text-xs text-gray-400">No runs yet — hit ▶ on the pipeline row to start one.</p>
        ) : (
          <div className="max-h-96 space-y-1 overflow-auto">
            {history.map(run => (
              <div key={run.id} className="rounded-lg border border-gray-100">
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}
                  className="flex w-full items-center gap-3 px-2 py-2 text-left text-xs hover:bg-gray-50"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: statusColor(run.status) }} />
                  <span className="w-40 shrink-0 tabular-nums text-gray-700">{formatDate(run.startedAt)}</span>
                  <span className="shrink-0 font-medium" style={{ color: statusColor(run.status) }}>{run.status}</span>
                  <span className="shrink-0 text-gray-400">via {run.trigger}</span>
                  <span className="ml-auto shrink-0 tabular-nums text-gray-400">
                    {run.completedAt
                      ? `${((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000).toFixed(1)}s`
                      : `stage ${run.currentStageOrder + 1}/${run.stagesSnapshot.length}`}
                  </span>
                </button>
                {expanded === run.id && (
                  <div className="space-y-1 border-t border-gray-100 px-2 py-2">
                    <StageTimeline run={run} projectId={projectId} />
                    {run.status === 'RUNNING' && (
                      <div className="flex justify-end pt-1">
                        <Button size="sm" variant="secondary" onClick={() => stopMut.mutate(run.id)} loading={stopMut.isPending}>
                          <Square size={12} /> Stop pipeline
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function StageTimeline({ run, projectId }: { run: PipelineRun; projectId: string }) {
  const resultByOrder = new Map<number, PipelineStageResult>(run.stageResults.map(r => [r.order, r]));
  return (
    <div className="space-y-0.5">
      {run.stagesSnapshot.map(stage => {
        const result = resultByOrder.get(stage.order);
        const isCurrent = run.status === 'RUNNING' && run.currentStageOrder === stage.order && !result;
        const icon = result?.status === 'PASSED' ? '✓'
          : result?.status === 'FAILED' ? '✗'
          : result?.status === 'CANCELLED' ? '⊘'
          : result?.status === 'SKIPPED' ? '⊘'
          : isCurrent ? '●' : '○';
        const color = isCurrent ? 'var(--accent-400)' : result ? statusColor(result.status === 'SKIPPED' ? 'NOT_TESTED' : result.status) : 'rgba(148,163,184,0.55)';
        return (
          <div key={stage.order} className="flex items-center gap-2 rounded px-1.5 py-1 text-[11px]">
            <span className="w-3 shrink-0 text-center" style={{ color }}>{icon}</span>
            <span className="shrink-0 text-gray-400">Stage {stage.order + 1}</span>
            <span className="truncate text-gray-700">{stage.featureName} · {stage.envName}</span>
            {isCurrent && <span className="animate-pulse shrink-0" style={{ color }}>running…</span>}
            {result && result.status !== 'SKIPPED' && (result.passed > 0 || result.failed > 0) && (
              <span className="shrink-0 text-gray-500">{result.passed} passed{result.failed > 0 ? ` · ${result.failed} failed` : ''}</span>
            )}
            {result?.status === 'SKIPPED' && <span className="shrink-0 text-gray-400">skipped{result.errorMessage ? ` (${result.errorMessage})` : ''}</span>}
            {result?.errorMessage && result.status === 'FAILED' && (
              <span className="truncate text-red-400" title={result.errorMessage}>{result.errorMessage}</span>
            )}
            {result?.featureRunId && (
              <Link
                to={`/projects/${projectId}/runs?featureId=${stage.featureId}`}
                className="ml-auto shrink-0 hover:underline"
                style={{ color: 'var(--accent-400)' }}
                title="Open this feature's runs (the stage's test runs, logs, video, trace)"
              >
                view runs →
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── CI poll-gate modal ──────────────────────────────────────────────────────

function PipelineCiModal({ pipeline, onClose }: { pipeline: Pipeline; onClose: () => void }) {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://your-advantage-host';
  const yaml = `# .github/workflows/qa-pipeline-gate.yml
name: QA pipeline gate
on:
  release:
    types: [published]      # or: workflow_dispatch / push to main
jobs:
  qa-pipeline:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger AdVantage pipeline
        id: trigger
        env:
          QA_URL: ${base}
          QA_PAT: \${{ secrets.QA_PAT }}
        run: |
          RUN_ID=$(curl -sf -X POST "$QA_URL/api/v1/pipelines/${pipeline.id}/trigger" \\
            -H "Authorization: Bearer $QA_PAT" | jq -r .pipelineRunId)
          echo "run_id=$RUN_ID" >> "$GITHUB_OUTPUT"
      - name: Wait for result (poll gate)
        env:
          QA_URL: ${base}
          QA_PAT: \${{ secrets.QA_PAT }}
        run: |
          for i in $(seq 1 120); do   # 120 x 15s = 30 min budget
            STATUS=$(curl -sf "$QA_URL/api/v1/pipeline-runs/\${{ steps.trigger.outputs.run_id }}" \\
              -H "Authorization: Bearer $QA_PAT" | jq -r .status)
            echo "status: $STATUS"
            case "$STATUS" in
              COMPLETE) exit 0 ;;
              FAILED|CANCELLED) exit 1 ;;
            esac
            sleep 15
          done
          echo "timed out"; exit 1`;

  const curl = `curl -sf -X POST "$QA_URL/api/v1/pipelines/${pipeline.id}/trigger" \\
  -H "Authorization: Bearer $QA_PAT"
# then poll until terminal:
curl -sf "$QA_URL/api/v1/pipeline-runs/<pipelineRunId>" -H "Authorization: Bearer $QA_PAT"`;

  return (
    <Modal open onClose={onClose} title={`Trigger "${pipeline.name}" from CI`} size="lg">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          One job triggers the whole pipeline ({pipeline.stages.length} stage{pipeline.stages.length !== 1 ? 's' : ''}, run sequentially)
          and gates on the aggregate result — the workflow fails if any stage fails. Uses the same{' '}
          <code className="text-[11px]">QA_PAT</code> secret as single-feature triggers.
        </p>
        <CopyBlock label="GitHub Actions workflow (trigger + poll gate)" code={yaml} />
        <details>
          <summary className="cursor-pointer text-xs text-gray-500">Just the curl (any CI / script)</summary>
          <div className="mt-2"><CopyBlock label="curl (set QA_URL + QA_PAT)" code={curl} /></div>
        </details>
      </div>
    </Modal>
  );
}
