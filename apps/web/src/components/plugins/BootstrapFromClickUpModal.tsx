import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronLeft, Loader2, Sparkles, FolderTree, ListChecks, FileCheck, Check, AlertTriangle, Square, CheckSquare, MinusSquare } from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import { pluginsApi, type PluginInstall, type BootstrapPreview, type BootstrapRunResult } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { CascadingSelect } from './CascadingSelect';

/**
 * "Generate from ClickUp" wizard.
 *
 * Four steps:
 *   1. Pick scope          (cascading workspace → space → folder)
 *   2. Pick depth          (module / feature / test)
 *   3. Preview             (counts + sample structure tree)
 *   4. Run                 (executes; shows summary + any errors)
 *
 * Idempotent: re-running picks up only what's new since.
 */
type Depth = 'module' | 'feature' | 'test';
type Step = 'scope' | 'depth' | 'preview' | 'run' | 'done';

export function BootstrapFromClickUpModal({
  open,
  onClose,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const qc = useQueryClient();
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId && open,
    staleTime: 30_000,
  });
  const install: PluginInstall | undefined = (installsQ.data ?? []).find(
    (i) => i.pluginId === 'clickup' && i.isEnabled && i.lastHealthOk,
  );

  // ── State ───────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('scope');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [depth, setDepth] = useState<Depth>('feature');
  const [preview, setPreview] = useState<BootstrapPreview | null>(null);
  const [runResult, setRunResult] = useState<BootstrapRunResult | null>(null);
  /** Task-ids the user has ticked. Default = all visible tasks (seeded after preview). */
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setStep('scope');
      setWorkspaceId(null);
      setSpaceId(null);
      setFolderId(null);
      setDepth('feature');
      setPreview(null);
      setRunResult(null);
      setSelectedTaskIds(new Set());
    }
  }, [open]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const previewMut = useMutation({
    mutationFn: () =>
      pluginsApi.bootstrapPreview(projectId, {
        scope: scopeForApi(folderId, spaceId),
        depth,
      }),
    onSuccess: (r) => {
      setPreview(r);
      // Default selection = every task whose feature isn't already linked.
      // Pre-ticking already-linked tasks would imply re-import; the run skips
      // them anyway, so default-untick keeps the count honest.
      const seed = new Set<string>();
      for (const list of r.samples) {
        for (const f of (list.features ?? list.sampleFeatures ?? [])) {
          if (!f.alreadyLinked) seed.add(f.taskId);
        }
      }
      setSelectedTaskIds(seed);
      setStep('preview');
    },
    onError: (err: unknown) => toast.error(extractErr(err, 'Preview failed')),
  });

  const runMut = useMutation({
    mutationFn: () =>
      pluginsApi.bootstrapRun(projectId, {
        scope: scopeForApi(folderId, spaceId),
        depth,
        // Always send selectedTaskIds (even empty) once the user has stepped
        // through preview — the API treats unset as "include all" which is
        // the legacy path for non-wizard callers. The wizard always opts in.
        selectedTaskIds: depth === 'module' ? undefined : [...selectedTaskIds],
      }),
    onSuccess: (r) => {
      setRunResult(r);
      setStep('done');
      qc.invalidateQueries({ queryKey: ['modules', projectId] });
      qc.invalidateQueries({ queryKey: ['plugin-bindings'] });
    },
    onError: (err: unknown) => toast.error(extractErr(err, 'Run failed')),
  });

  // ── Step content ────────────────────────────────────────────────────────
  if (!open) return null;
  const title = `Generate from ClickUp ${stepLabel(step)}`;

  return (
    <Modal open={open} onClose={onClose} title={title} size="xl">
      <div className="space-y-4">
        <StepIndicator step={step} />

        {!install ? (
          <div className="rounded-lg p-4 text-sm" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: '#fbbf24' }}>
            <AlertTriangle className="inline w-4 h-4 mr-1" />
            ClickUp install not healthy. Set it up under <strong>Org → Plugins</strong> first.
          </div>
        ) : step === 'scope' ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Pick the ClickUp scope to pull from. Each list inside the chosen scope becomes a module.
            </p>
            <CascadingSelect label="Workspace" orgId={orgId!} installId={install.id} kind="workspace" value={workspaceId} onChange={(id) => { setWorkspaceId(id); setSpaceId(null); setFolderId(null); }} />
            <CascadingSelect label="Space" orgId={orgId!} installId={install.id} kind="space" parent={{ workspaceId }} value={spaceId} onChange={(id) => { setSpaceId(id); setFolderId(null); }} />
            <CascadingSelect label="Folder" helpText='Choose "(no folder)" to pull folderless lists.' orgId={orgId!} installId={install.id} kind="folder" parent={{ spaceId }} value={folderId} onChange={(id) => setFolderId(id)} />
          </div>
        ) : step === 'depth' ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">How deep should the import go?</p>
            <DepthOption icon={FolderTree} value="module" current={depth} onPick={setDepth}
              title="Modules only"
              hint="One module per ClickUp list. Modules are bound to their list — features and tests come later."
            />
            <DepthOption icon={ListChecks} value="feature" current={depth} onPick={setDepth}
              title="Modules + Features"
              hint="Plus one feature per top-level task. Features auto-bind so subsequent issues land as subtasks."
            />
            <DepthOption icon={FileCheck} value="test" current={depth} onPick={setDepth}
              title="Modules + Features + Tests"
              hint="Plus one test stub per subtask. Tests start blank — you author the steps."
            />
          </div>
        ) : step === 'preview' ? (
          <PreviewBody
            preview={preview}
            loading={previewMut.isPending}
            depth={depth}
            selected={selectedTaskIds}
            onSelectedChange={setSelectedTaskIds}
          />
        ) : step === 'run' ? (
          <div className="text-sm text-slate-300 flex items-center gap-2 py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Creating modules / features / tests… this can take a minute on large lists.
          </div>
        ) : (
          <DoneBody result={runResult} />
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={runMut.isPending}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          <div className="flex items-center gap-2">
            {step === 'depth' && <Button variant="ghost" size="sm" onClick={() => setStep('scope')}><ChevronLeft className="w-3 h-3" /> Back</Button>}
            {step === 'preview' && <Button variant="ghost" size="sm" onClick={() => setStep('depth')}><ChevronLeft className="w-3 h-3" /> Back</Button>}

            {step === 'scope' && (
              <Button size="sm" onClick={() => setStep('depth')} disabled={!folderId && !spaceId}>
                Next <ChevronRight className="w-3 h-3" />
              </Button>
            )}
            {step === 'depth' && (
              <Button size="sm" onClick={() => previewMut.mutate()} loading={previewMut.isPending}>
                Preview <ChevronRight className="w-3 h-3" />
              </Button>
            )}
            {step === 'preview' && preview && (
              <Button size="sm" onClick={() => { setStep('run'); runMut.mutate(); }} loading={runMut.isPending}
                disabled={
                  preview.totals.modules + preview.totals.features + preview.totals.tests === 0
                  || (depth !== 'module' && selectedTaskIds.size === 0)
                }
              >
                <Sparkles className="w-3 h-3" />
                Create{depth !== 'module' && selectedTaskIds.size > 0 ? ` (${selectedTaskIds.size})` : ''}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function scopeForApi(folderId: string | null, spaceId: string | null): { folderId?: string; spaceId?: string } {
  if (folderId && folderId !== '__folderless__') return { folderId };
  if (spaceId) return { spaceId };
  return {};
}

function stepLabel(step: Step): string {
  switch (step) {
    case 'scope': return '— step 1 of 4: pick scope';
    case 'depth': return '— step 2 of 4: pick depth';
    case 'preview': return '— step 3 of 4: preview';
    case 'run': return '— creating…';
    case 'done': return '— done';
  }
}

function StepIndicator({ step }: { step: Step }) {
  const order: Step[] = ['scope', 'depth', 'preview', 'run', 'done'];
  const idx = order.indexOf(step);
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wide">
      {order.slice(0, 4).map((s, i) => (
        <span key={s} className={i <= idx ? 'text-purple-300' : ''}>
          {i > 0 && <span className="mx-1 text-slate-600">›</span>}
          {s === 'scope' ? 'scope' : s === 'depth' ? 'depth' : s === 'preview' ? 'preview' : 'create'}
        </span>
      ))}
    </div>
  );
}

function DepthOption({
  icon: Icon, value, current, onPick, title, hint,
}: {
  icon: typeof FolderTree;
  value: Depth;
  current: Depth;
  onPick: (v: Depth) => void;
  title: string;
  hint: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className="w-full text-left rounded-lg p-3 transition-all"
      style={{
        background: active ? 'rgba(139,92,246,0.10)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${active ? 'rgba(139,92,246,0.40)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      <div className="flex items-start gap-3">
        <Icon className={`w-4 h-4 mt-0.5 ${active ? 'text-purple-300' : 'text-slate-400'}`} />
        <div>
          <div className="text-sm text-slate-100 font-medium">{title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">{hint}</div>
        </div>
      </div>
    </button>
  );
}

function PreviewBody({
  preview,
  loading,
  depth,
  selected,
  onSelectedChange,
}: {
  preview: BootstrapPreview | null;
  loading: boolean;
  depth: 'module' | 'feature' | 'test';
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}) {
  // Build the cross-list status + task-type unions for the quick-filter chips.
  // Both axes are folded across every list so the user picks once instead of
  // per-list.
  const allStatuses = useMemo(() => {
    if (!preview) return [] as string[];
    const set = new Set<string>();
    for (const list of preview.samples) {
      for (const s of (list.statuses ?? [])) set.add(s);
    }
    return [...set].sort();
  }, [preview]);

  const allTaskTypes = useMemo(() => {
    if (!preview) return [] as string[];
    const set = new Set<string>();
    for (const list of preview.samples) {
      for (const t of (list.taskTypes ?? [])) set.add(t);
    }
    return [...set].sort();
  }, [preview]);

  if (loading) return <div className="text-sm text-slate-400 flex items-center gap-2 py-8 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Pulling from ClickUp…</div>;
  if (!preview) return null;

  const { totals, samples } = preview;
  if (totals.modules + totals.features + totals.tests === 0) {
    return (
      <div className="rounded-lg p-4 text-xs text-slate-400" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        Nothing new to create — every list / task in scope already has its module / feature.
      </div>
    );
  }

  // All non-already-linked task IDs in the preview — used by select-all helper
  // and to determine each list's tri-state checkbox.
  const allEligibleIds: string[] = samples.flatMap((b) =>
    (b.features ?? b.sampleFeatures ?? []).filter((f) => !f.alreadyLinked).map((f) => f.taskId),
  );

  const toggleOne = (taskId: string) => {
    const next = new Set(selected);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    onSelectedChange(next);
  };

  const setAll = (taskIds: string[], pick: boolean) => {
    const next = new Set(selected);
    for (const id of taskIds) {
      if (pick) next.add(id);
      else next.delete(id);
    }
    onSelectedChange(next);
  };

  const toggleStatus = (status: string) => {
    const idsWithStatus = samples.flatMap((b) =>
      (b.features ?? b.sampleFeatures ?? [])
        .filter((f) => !f.alreadyLinked && f.status === status)
        .map((f) => f.taskId),
    );
    const allOn = idsWithStatus.every((id) => selected.has(id));
    setAll(idsWithStatus, !allOn);
  };

  const toggleTaskType = (taskType: string) => {
    const idsOfType = samples.flatMap((b) =>
      (b.features ?? b.sampleFeatures ?? [])
        .filter((f) => !f.alreadyLinked && f.taskType === taskType)
        .map((f) => f.taskId),
    );
    const allOn = idsOfType.every((id) => selected.has(id));
    setAll(idsOfType, !allOn);
  };

  const showCheckboxes = depth !== 'module';
  const eligibleSelectedCount = allEligibleIds.filter((id) => selected.has(id)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <Pill label="modules" count={totals.modules} skipped={totals.skipped.modules} />
        <Pill label="features" count={totals.features} skipped={totals.skipped.features} />
        {totals.tests > 0 && <Pill label="tests" count={totals.tests} skipped={totals.skipped.tests} />}
      </div>

      {/* Task-type quick-filter — only render when the workspace has > 1
          distinct type (otherwise every task is the same type and the chip
          row is just clutter). Above status chips because filtering by type
          is usually the first cut (e.g. "skip Bugs, only generate for
          Action Items"). */}
      {showCheckboxes && allTaskTypes.length > 1 && (
        <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.20)' }}>
          <div className="text-[11px] text-slate-400">
            Quick-filter by task type — click to toggle all tasks of that type.
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {allTaskTypes.map((taskType) => {
              const idsOfType = samples.flatMap((b) =>
                (b.features ?? b.sampleFeatures ?? [])
                  .filter((f) => !f.alreadyLinked && f.taskType === taskType)
                  .map((f) => f.taskId),
              );
              const total = idsOfType.length;
              const on = idsOfType.filter((id) => selected.has(id)).length;
              const allOn = total > 0 && on === total;
              const noneOn = on === 0;
              return (
                <button
                  key={taskType}
                  type="button"
                  onClick={() => toggleTaskType(taskType)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
                  style={{
                    background: allOn ? 'rgba(168,85,247,0.25)' : noneOn ? 'rgba(255,255,255,0.04)' : 'rgba(168,85,247,0.12)',
                    border: `1px solid ${allOn ? 'rgba(168,85,247,0.55)' : 'rgba(255,255,255,0.10)'}`,
                    color: allOn ? '#d8b4fe' : noneOn ? 'rgba(238,238,248,0.55)' : 'rgba(238,238,248,0.85)',
                  }}
                  title={`${on}/${total} ${taskType} tasks selected`}
                >
                  {allOn ? <CheckSquare size={10} /> : noneOn ? <Square size={10} /> : <MinusSquare size={10} />}
                  {taskType}
                  <span className="opacity-70">{on}/{total}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showCheckboxes && allStatuses.length > 0 && (
        <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] text-slate-400">
              Quick-filter by status — click to toggle all tasks of that status.
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setAll(allEligibleIds, true)}
                className="text-[11px] px-2 py-1 rounded text-purple-300 hover:bg-purple-500/10 transition-colors"
              >
                Select all
              </button>
              <span className="text-slate-600">·</span>
              <button
                type="button"
                onClick={() => setAll(allEligibleIds, false)}
                className="text-[11px] px-2 py-1 rounded text-slate-400 hover:bg-white/5 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {allStatuses.map((status) => {
              const idsWithStatus = samples.flatMap((b) =>
                (b.features ?? b.sampleFeatures ?? [])
                  .filter((f) => !f.alreadyLinked && f.status === status)
                  .map((f) => f.taskId),
              );
              const total = idsWithStatus.length;
              const on = idsWithStatus.filter((id) => selected.has(id)).length;
              const allOn = total > 0 && on === total;
              const noneOn = on === 0;
              return (
                <button
                  key={status || '(no status)'}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
                  style={{
                    background: allOn ? 'rgba(139,92,246,0.20)' : noneOn ? 'rgba(255,255,255,0.04)' : 'rgba(139,92,246,0.10)',
                    border: `1px solid ${allOn ? 'rgba(139,92,246,0.50)' : 'rgba(255,255,255,0.10)'}`,
                    color: allOn ? '#c4b5fd' : noneOn ? 'rgba(238,238,248,0.55)' : 'rgba(238,238,248,0.85)',
                  }}
                  title={`${on}/${total} ${status || '(no status)'} tasks selected`}
                >
                  {allOn ? <CheckSquare size={10} /> : noneOn ? <Square size={10} /> : <MinusSquare size={10} />}
                  {status || '(no status)'}
                  <span className="opacity-70">{on}/{total}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-lg p-3 max-h-[560px] overflow-y-auto" style={{ background: 'rgba(0,0,0,0.30)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {samples.map((b) => {
          const features = b.features ?? b.sampleFeatures ?? [];
          const eligible = features.filter((f) => !f.alreadyLinked).map((f) => f.taskId);
          const listAllOn = eligible.length > 0 && eligible.every((id) => selected.has(id));
          const listNoneOn = eligible.every((id) => !selected.has(id));
          return (
            <div key={b.listId} className="text-xs space-y-0.5 mb-3">
              <div className="text-slate-100 font-medium flex items-center gap-1.5">
                {showCheckboxes && eligible.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setAll(eligible, !listAllOn)}
                    className="flex items-center justify-center"
                    title={`Toggle all in ${b.listName}`}
                  >
                    {listAllOn ? <CheckSquare size={11} className="text-purple-300" />
                     : listNoneOn ? <Square size={11} className="text-slate-500" />
                     : <MinusSquare size={11} className="text-purple-300/60" />}
                  </button>
                )}
                📁 <span className={b.moduleAlreadyExists ? 'line-through text-slate-500' : ''}>{b.listName}</span>
                {b.moduleAlreadyExists && <span className="text-[10px] text-slate-500 ml-1">(already imported)</span>}
                <span className="text-[10px] text-slate-500 ml-1">{b.topTasksCount} tasks{b.testsCount > 0 ? `, ${b.testsCount} subtasks` : ''}</span>
              </div>
              {features.map((f) => {
                const ticked = selected.has(f.taskId);
                return (
                  <div key={f.taskId} className="ml-3 flex items-start gap-1.5 group">
                    {showCheckboxes ? (
                      <button
                        type="button"
                        onClick={() => !f.alreadyLinked && toggleOne(f.taskId)}
                        disabled={f.alreadyLinked}
                        className="mt-0.5 flex items-center justify-center transition-colors"
                        title={f.alreadyLinked ? 'Already linked — will be skipped' : ticked ? 'Untick to skip' : 'Tick to include'}
                      >
                        {f.alreadyLinked
                          ? <Square size={11} className="text-slate-700" />
                          : ticked
                          ? <CheckSquare size={11} className="text-purple-300" />
                          : <Square size={11} className="text-slate-500" />}
                      </button>
                    ) : <span className="text-slate-500">├──</span>}
                    <div className="flex-1 min-w-0">
                      <div className={f.alreadyLinked ? 'text-slate-500' : ticked ? 'text-slate-200' : 'text-slate-400'}>
                        🎯 {f.taskName}
                        {/* Task type badge — uses purple to match the type chip filter row */}
                        {f.taskType && f.taskType !== 'Task' && (
                          <span
                            className="ml-2 text-[10px] px-1 py-0.5 rounded"
                            style={{ background: 'rgba(168,85,247,0.12)', color: '#d8b4fe', border: '1px solid rgba(168,85,247,0.25)' }}
                          >
                            {f.taskType}
                          </span>
                        )}
                        {f.status && (
                          <span
                            className="ml-2 text-[10px] px-1 py-0.5 rounded"
                            style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(238,238,248,0.55)' }}
                          >
                            {f.status}
                          </span>
                        )}
                        {f.alreadyLinked && <span className="ml-1 text-[10px] text-slate-500">(linked)</span>}
                      </div>
                      {f.tests.map((t) => (
                        <div key={t.id} className="ml-4 text-slate-500 text-[11px]">✓ {t.name}</div>
                      ))}
                      {f.moreTests > 0 && <div className="ml-4 text-slate-600 text-[11px]">… {f.moreTests} more tests</div>}
                    </div>
                  </div>
                );
              })}
              {features.length === 0 && b.topTasksCount > 0 && <div className="ml-3 text-slate-500">… {b.topTasksCount} features will be created</div>}
            </div>
          );
        })}
      </div>

      {showCheckboxes && (
        <p className="text-[11px] text-slate-500">
          <strong className="text-purple-200">{eligibleSelectedCount}</strong> of {allEligibleIds.length} tasks selected.
          Already-linked tasks are skipped automatically.
        </p>
      )}
    </div>
  );
}

function Pill({ label, count, skipped }: { label: string; count: number; skipped: number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs"
      style={{ background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.25)' }}
    >
      <strong className="text-purple-200">{count}</strong>
      <span className="text-slate-300">new {label}</span>
      {skipped > 0 && <span className="text-slate-500">· {skipped} skipped</span>}
    </span>
  );
}

function DoneBody({ result }: { result: BootstrapRunResult | null }) {
  if (!result) return null;
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-4" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.30)' }}>
        <div className="flex items-center gap-2 text-sm font-medium text-emerald-300">
          <Check className="w-4 h-4" /> Done
        </div>
        <div className="text-xs text-slate-300 mt-2">
          Created <strong>{result.created.modules}</strong> modules, <strong>{result.created.features}</strong> features, <strong>{result.created.tests}</strong> tests.
        </div>
        {(result.skipped.modules + result.skipped.features + result.skipped.tests) > 0 && (
          <div className="text-[11px] text-slate-400 mt-1">
            Skipped {result.skipped.modules}/{result.skipped.features}/{result.skipped.tests} (already imported).
          </div>
        )}
      </div>
      {result.errors.length > 0 && (
        <details className="rounded-lg p-3 text-xs" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.25)' }}>
          <summary className="cursor-pointer text-amber-300">{result.errors.length} error(s) during create</summary>
          <ul className="mt-2 space-y-1 text-slate-300">
            {result.errors.slice(0, 8).map((e, i) => (
              <li key={i}><code className="text-[11px]">{e.scope}/{e.externalId.slice(0, 8)}</code>: {e.message}</li>
            ))}
            {result.errors.length > 8 && <li className="text-slate-500">…and {result.errors.length - 8} more</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

function extractErr(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
}
