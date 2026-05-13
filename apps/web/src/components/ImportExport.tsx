import { useState, useRef, useEffect } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { Download, Upload, FileJson, Check, AlertCircle, Loader2, History, RotateCcw, ChevronDown, ChevronUp, AlertTriangle, Sparkles, Clipboard } from 'lucide-react';
import { importExportApi, testVersionsApi, moduleVersionsApi, api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadJson(data: object, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Export Button ────────────────────────────────────────────────────────────

interface ExportButtonProps {
  level: 'project' | 'module' | 'feature' | 'testCase';
  id: string;
  name: string;
  variant?: 'secondary' | 'ghost';
  size?: 'sm' | 'md';
}

export function ExportButton({ level, id, name, variant = 'secondary', size = 'sm' }: ExportButtonProps) {
  const [loading, setLoading] = useState<null | 'data' | 'ai-zip' | 'ai-prompt' | 'ai-bundle'>(null);
  const [open, setOpen] = useState(false);
  /** When non-null, the explainer modal is open. The kind tells which action runs on confirm. */
  const [explainerOpen, setExplainerOpen] = useState<null | 'ai-zip' | 'ai-prompt' | 'ai-bundle'>(null);
  /** Once the bundle download + clipboard copy completes, hold the prompt text so the modal can display it for manual re-copy. */
  const [bundlePrompt, setBundlePrompt] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // AI export only supports project/module/feature scope (no test-level bundle).
  const aiAvailable = level !== 'testCase';

  const handleDataExport = async () => {
    setLoading('data');
    setOpen(false);
    try {
      let data: object;
      const date = new Date().toISOString().slice(0, 10);
      const slug = slugify(name);
      switch (level) {
        case 'project':  data = await importExportApi.exportProject(id);  downloadJson(data, `${slug}-project-export-${date}.json`);  break;
        case 'module':   data = await importExportApi.exportModule(id);   downloadJson(data, `${slug}-module-export-${date}.json`);   break;
        case 'feature':  data = await importExportApi.exportFeature(id);  downloadJson(data, `${slug}-feature-export-${date}.json`);  break;
        case 'testCase': data = await importExportApi.exportTestCase(id); downloadJson(data, `${slug}-test-export-${date}.json`);     break;
      }
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setLoading(null);
    }
  };

  const aiPath = (kind: 'zip' | 'prompt') => {
    const base = level === 'project' ? `projects/${id}` : level === 'module' ? `modules/${id}` : `features/${id}`;
    return `/api/v1/${base}/ai-export${kind === 'prompt' ? '/prompt' : ''}`;
  };

  const handleAiZip = async () => {
    setLoading('ai-zip');
    setOpen(false);
    try {
      const r = await api.get(aiPath('zip'), { responseType: 'blob' });
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${slugify(name)}-${level}-ai-export-${date}.zip`;
      const url = URL.createObjectURL(r.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('AI export failed', e);
    } finally {
      setLoading(null);
    }
  };

  const handleAiPrompt = async () => {
    setLoading('ai-prompt');
    setOpen(false);
    try {
      const r = await api.get(aiPath('prompt'), { responseType: 'text' });
      const text = typeof r.data === 'string' ? r.data : String(r.data);
      await navigator.clipboard.writeText(text);
      // toast: lightweight inline alert via window.alert if no toast util easily reachable from here
      // (the test guide mentions inline copying — consumer pages can wire their own toast)
      // eslint-disable-next-line no-alert
      alert('AI prompt copied to clipboard. Paste into your LLM chat to start a session.');
    } catch (e) {
      console.error('AI prompt copy failed', e);
    } finally {
      setLoading(null);
    }
  };

  /**
   * The combined flow — downloads the zip AND copies the prompt to clipboard
   * in one click. The prompt explicitly tells the LLM the zip is attached so
   * the agent reads the bundle instead of inventing tests from the prompt
   * alone. This is the default surface; the two single-action items stay in
   * the dropdown for power users.
   */
  const handleAiBundle = async (): Promise<{ promptText: string } | null> => {
    setLoading('ai-bundle');
    try {
      // Kick both requests off in parallel — they're independent on the server.
      const [zipResp, promptResp] = await Promise.all([
        api.get(aiPath('zip'), { responseType: 'blob' }),
        api.get(aiPath('prompt'), { responseType: 'text' }),
      ]);

      // Trigger download
      const date = new Date().toISOString().slice(0, 10);
      const filename = `${slugify(name)}-${level}-ai-export-${date}.zip`;
      const url = URL.createObjectURL(zipResp.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Copy prompt to clipboard
      const promptText = typeof promptResp.data === 'string' ? promptResp.data : String(promptResp.data);
      try {
        await navigator.clipboard.writeText(promptText);
      } catch {
        // clipboard may fail in non-secure contexts — the modal still shows the
        // prompt in a textarea so the user can copy manually.
      }
      return { promptText };
    } catch (e) {
      console.error('AI bundle failed', e);
      return null;
    } finally {
      setLoading(null);
    }
  };

  // Outside-click close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('click', handler), 0);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  if (!aiAvailable) {
    return (
      <Button variant={variant} size={size} onClick={handleDataExport} loading={loading === 'data'}>
        <Download size={13} />
        Export
      </Button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <Button variant={variant} size={size} onClick={() => setOpen((o) => !o)} loading={loading !== null}>
        <Download size={13} />
        Export <ChevronDown size={11} />
      </Button>
      {open && (
        <div
          className="absolute right-0 mt-1 z-30 min-w-[260px] rounded-lg shadow-lg overflow-hidden"
          style={{ background: 'rgba(20,20,28,0.96)', border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <button
            type="button"
            onClick={handleDataExport}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5"
          >
            <FileJson className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
            <div>
              <div className="text-slate-100">Data export (JSON)</div>
              <div className="text-[11px] text-slate-500">The structured envelope; round-trip safe via Import.</div>
            </div>
          </button>
          {/* Primary AI action — downloads the zip AND copies the prompt in one click. */}
          <button
            type="button"
            onClick={() => { setOpen(false); setExplainerOpen('ai-bundle'); }}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5 border-t border-white/5"
          >
            <Sparkles className="w-3.5 h-3.5 mt-0.5 text-purple-300" />
            <div>
              <div className="text-slate-100">Generate test cases with AI ✨</div>
              <div className="text-[11px] text-slate-500">Downloads the bundle zip + copies the prompt. Paste prompt into Claude / Gemini, attach the zip.</div>
            </div>
          </button>
          {/* Advanced: separate one-shot actions for users who want only the zip or only the prompt. */}
          <button
            type="button"
            onClick={() => { setOpen(false); setExplainerOpen('ai-zip'); }}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5 border-t border-white/5"
          >
            <Download className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
            <div>
              <div className="text-slate-100">Bundle zip only</div>
              <div className="text-[11px] text-slate-500">Data + docs + ticket context + conventions. No prompt copy.</div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); setExplainerOpen('ai-prompt'); }}
            className="w-full px-3 py-2 text-left text-sm flex items-start gap-2 hover:bg-white/5 border-t border-white/5"
          >
            <Clipboard className="w-3.5 h-3.5 mt-0.5 text-slate-400" />
            <div>
              <div className="text-slate-100">Prompt only</div>
              <div className="text-[11px] text-slate-500">Copies just the agent instructions (no attachments).</div>
            </div>
          </button>
        </div>
      )}

      {explainerOpen && (
        <AIExportExplainerModal
          kind={explainerOpen}
          scopeName={name}
          scopeLevel={level as 'project' | 'module' | 'feature'}
          loading={loading === 'ai-bundle' || loading === explainerOpen}
          bundlePrompt={bundlePrompt}
          onClose={() => { setExplainerOpen(null); setBundlePrompt(null); }}
          onConfirm={async () => {
            const k = explainerOpen;
            if (k === 'ai-bundle') {
              // Keep modal open; populate bundlePrompt so user sees the
              // prompt textarea for manual re-copy if clipboard failed.
              const res = await handleAiBundle();
              if (res) setBundlePrompt(res.promptText);
              return;
            }
            setExplainerOpen(null);
            if (k === 'ai-zip') void handleAiZip();
            else if (k === 'ai-prompt') void handleAiPrompt();
          }}
        />
      )}
    </div>
  );
}

// ── AI export explainer modal ─────────────────────────────────────────────────

function AIExportExplainerModal({
  kind, scopeName, scopeLevel, loading, bundlePrompt, onClose, onConfirm,
}: {
  kind: 'ai-zip' | 'ai-prompt' | 'ai-bundle';
  scopeName: string;
  scopeLevel: 'project' | 'module' | 'feature';
  loading: boolean;
  /** Set after the combined bundle action succeeds — display the prompt text for manual re-copy. */
  bundlePrompt: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isZip = kind === 'ai-zip';
  const isBundle = kind === 'ai-bundle';
  const isPrompt = kind === 'ai-prompt';
  const title = isBundle
    ? 'Generate test cases with AI'
    : isZip
      ? 'Bundle zip (no prompt copy)'
      : 'Prompt only (no zip)';

  return (
    <Modal open onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {/* Post-success state for the combined bundle action: show the prompt
            in a textarea so the user can re-copy if their clipboard didn't
            accept the auto-copy (e.g. non-secure context, focus issue). */}
        {isBundle && bundlePrompt ? (
          <>
            <div className="rounded-lg p-3 flex items-start gap-3" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <Check className="w-4 h-4 mt-0.5 text-emerald-300" />
              <div className="text-xs text-slate-200 space-y-1">
                <p>
                  <strong className="text-emerald-200">Zip downloaded · prompt copied to clipboard.</strong>
                </p>
                <p className="text-slate-300">
                  Open Claude / Gemini / ChatGPT → paste the prompt → attach the zip file from your Downloads folder.
                </p>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Prompt (re-copy if needed)</h4>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(bundlePrompt)}
                  className="text-[11px] px-2 py-0.5 rounded text-purple-300 hover:bg-purple-500/10 transition-colors inline-flex items-center gap-1"
                >
                  <Clipboard size={11} /> Copy again
                </button>
              </div>
              <textarea
                readOnly
                value={bundlePrompt}
                className="w-full rounded-md text-[11px] font-mono p-2 max-h-[300px] resize-none"
                style={{
                  background: 'rgba(0,0,0,0.30)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(238,238,248,0.75)',
                  minHeight: 180,
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <Button onClick={onClose}><Check size={13} /> Done</Button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg p-3 flex items-start gap-3" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.18)' }}>
              <Sparkles className="w-4 h-4 mt-0.5 text-purple-300" />
              <div className="text-xs text-slate-200">
                <p>
                  {isBundle && <>Downloads the bundle zip <strong>AND</strong> copies the agent prompt to your clipboard in one click — </>}
                  {isZip && <>Downloads the bundle zip </>}
                  {isPrompt && <>Copies the agent prompt to your clipboard </>}
                  for the {scopeLevel} <strong>{scopeName}</strong>.
                </p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">What's inside the bundle</h4>
              <ul className="space-y-1.5 text-xs text-slate-300">
                {!isPrompt && <li className="flex gap-2"><FileJson className="w-3.5 h-3.5 mt-0.5 text-slate-400 shrink-0" /><span><code>data.json</code> — full export envelope (round-trip safe via Import).</span></li>}
                {scopeLevel === 'feature' && !isPrompt && <li className="flex gap-2"><span className="text-slate-500 shrink-0">🎯</span><span><code>target-feature.md</code> — focused brief on THIS feature with embedded AC + ticket context (read first).</span></li>}
                <li className="flex gap-2"><span className="text-slate-500 shrink-0">📖</span><span><code>conventions/</code> — data model, all 30+ step types (auto-generated), test anatomy + import rules.</span></li>
                {!isPrompt && <li className="flex gap-2"><span className="text-slate-500 shrink-0">📄</span><span><code>docs/</code> — every linked / local doc as markdown.</span></li>}
                {!isPrompt && <li className="flex gap-2"><span className="text-slate-500 shrink-0">🎫</span><span><code>ticket-context/</code> — ClickUp ticket descriptions + acceptance criteria for every linked feature.</span></li>}
                {!isPrompt && <li className="flex gap-2"><span className="text-slate-500 shrink-0">✨</span><span><code>examples/</code> — well-formed tests as style templates (cascades from feature → module → project → org).</span></li>}
                <li className="flex gap-2"><span className="text-slate-500 shrink-0">📝</span><span><code>README.md</code> — agent prompt + data-driven analysis of existing tests.</span></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">How to use it</h4>
              <ol className="space-y-1 text-xs text-slate-300 list-decimal list-inside">
                {isBundle ? (
                  <>
                    <li>Click <strong>Generate</strong> — the zip downloads and the prompt is copied to your clipboard.</li>
                    <li>Open your AI chat (Claude, Gemini, ChatGPT) → paste the prompt → attach the zip.</li>
                    <li>Ask: <em>"Generate concrete steps for the existing tests in the feature, using the linked ticket / AC as source."</em></li>
                    <li>Save the agent&apos;s JSON output, come back here → <strong>Import</strong> → drop file → choose <strong>Merge into this feature</strong>.</li>
                  </>
                ) : isZip ? (
                  <>
                    <li>Drop the zip into your AI agent — Claude / ChatGPT / Gemini all accept zips.</li>
                    <li>Ask the agent to generate tests; it reads <code>target-feature.md</code> + <code>examples/</code> for context.</li>
                    <li>Use Import → Merge to load the agent&apos;s output back.</li>
                  </>
                ) : (
                  <>
                    <li>Paste into your AI chat — gives the agent the data model + step-types + style summary.</li>
                    <li>For full context (linked tickets, examples) you&apos;ll also need the bundle zip.</li>
                  </>
                )}
              </ol>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
              <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
              <Button onClick={onConfirm} loading={loading}>
                {isBundle && <><Sparkles size={13} /> Generate (download + copy)</>}
                {isZip && <><Download size={13} /> Download zip</>}
                {isPrompt && <><Clipboard size={13} /> Copy prompt</>}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Conflict item display ────────────────────────────────────────────────────

interface ConflictItem {
  type: 'module' | 'feature' | 'testCase';
  originalName: string;
  resolvedName: string;
}

const typeLabel: Record<string, string> = { module: 'Module', feature: 'Feature', testCase: 'Test case' };

// ─── Import Modal ─────────────────────────────────────────────────────────────

interface PreviewItem {
  path: string;
  kind: 'module' | 'feature' | 'test';
  name: string;
  conflict?: boolean;
  children?: PreviewItem[];
}

interface PreviewData {
  valid: boolean;
  error?: string;
  exportType: string;
  exportedAt: string;
  sourceName: string;
  modulesCount: number;
  featuresCount: number;
  testCasesCount: number;
  conflicts: ConflictItem[];
  items: PreviewItem[];
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetModuleId?: string;
  /** When opening from a feature page — pre-selects destination for test-case imports. */
  targetFeatureId?: string;
  modules?: { id: string; name: string }[];
  features?: { id: string; name: string }[];
  invalidateKeys?: string[][];
}

export function ImportModal({
  open,
  onClose,
  projectId,
  targetModuleId,
  targetFeatureId,
  modules = [],
  features = [],
  invalidateKeys = [],
}: ImportModalProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [envelope, setEnvelope] = useState<object | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState<{ modulesCreated: number; featuresCreated: number; testCasesCreated: number; conflicts: ConflictItem[] } | null>(null);
  const [error, setError] = useState('');
  const [conflictsOpen, setConflictsOpen] = useState(false);

  const [selectedModuleId, setSelectedModuleId] = useState(targetModuleId ?? '');
  const [selectedFeatureId, setSelectedFeatureId] = useState(targetFeatureId ?? '');
  /** Selection of paths the user wants to import. null = all (default after preview). */
  const [pathSelection, setPathSelection] = useState<Set<string> | null>(null);
  /**
   * Merge mode — only offered when opening from a feature page (targetFeatureId
   * set) AND the uploaded envelope is feature-level. When true, the import
   * upserts tests by name INTO the current feature rather than creating a new
   * sibling feature suffixed `(imported)`.
   */
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeResult, setMergeResult] = useState<{ updated: number; created: number; skipped: number; items: Array<{ name: string; action: 'updated' | 'created' | 'skipped' }> } | null>(null);

  const reset = () => {
    setEnvelope(null); setPreview(null); setError(''); setSuccess(null);
    setSelectedModuleId(targetModuleId ?? ''); setSelectedFeatureId(targetFeatureId ?? '');
    setConflictsOpen(false);
    setMergeMode(false); setMergeResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleClose = () => { reset(); onClose(); };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setPreview(null); setEnvelope(null); setSuccess(null); setConflictsOpen(false);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as object;
      setEnvelope(parsed);

      setPreviewLoading(true);
      const opts: { targetModuleId?: string; targetFeatureId?: string } = {};
      if (selectedModuleId) opts.targetModuleId = selectedModuleId;
      if (selectedFeatureId) opts.targetFeatureId = selectedFeatureId;
      const result = await importExportApi.previewImport(projectId, parsed, opts) as PreviewData;
      setPreview(result);
      // Seed selection with every path so default behaviour = import everything.
      // User unchecks rows they don't want.
      setPathSelection(new Set(collectAllPaths(result.items ?? [])));
      // Default merge mode ON when the upload is feature-level and we're
      // opened from a feature page — most common intent on this surface.
      setMergeMode(result.exportType === 'feature' && !!targetFeatureId);
    } catch {
      setError('Invalid JSON file. Please select a valid export file.');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Re-run preview when target selectors change (to get accurate conflict list)
  const handleModuleChange = async (moduleId: string) => {
    setSelectedModuleId(moduleId);
    if (envelope && moduleId) {
      setPreviewLoading(true);
      try {
        const result = await importExportApi.previewImport(projectId, envelope, { targetModuleId: moduleId }) as PreviewData;
        setPreview(result);
        setPathSelection(new Set(collectAllPaths(result.items ?? [])));
      } catch { /* keep existing preview */ } finally { setPreviewLoading(false); }
    }
  };

  const handleFeatureChange = async (featureId: string) => {
    setSelectedFeatureId(featureId);
    if (envelope && featureId) {
      setPreviewLoading(true);
      try {
        const result = await importExportApi.previewImport(projectId, envelope, { targetFeatureId: featureId }) as PreviewData;
        setPreview(result);
        setPathSelection(new Set(collectAllPaths(result.items ?? [])));
      } catch { /* keep existing preview */ } finally { setPreviewLoading(false); }
    }
  };

  const handleImport = async () => {
    if (!envelope || !preview?.valid) return;
    setImporting(true); setError('');
    try {
      // Merge-into-existing-feature path: upserts tests by name inside the
      // current feature. No `(imported)` sibling feature is created, existing
      // TestRun history / DocLinks / AcSource links survive because test
      // IDs are preserved.
      if (mergeMode && preview.exportType === 'feature' && selectedFeatureId) {
        const r = await importExportApi.mergeIntoFeature(selectedFeatureId, envelope);
        setMergeResult(r);
        invalidateKeys.forEach(key => void qc.invalidateQueries({ queryKey: key }));
        return;
      }

      const opts: { targetModuleId?: string; targetFeatureId?: string; selection?: string[] } = {};
      if (preview.exportType === 'feature' && selectedModuleId) opts.targetModuleId = selectedModuleId;
      if (preview.exportType === 'testCase' && selectedFeatureId) opts.targetFeatureId = selectedFeatureId;
      if (pathSelection) opts.selection = [...pathSelection];

      const result = await importExportApi.importIntoProject(projectId, envelope, opts) as {
        modulesCreated: number; featuresCreated: number; testCasesCreated: number; conflicts: ConflictItem[];
      };
      setSuccess(result);
      invalidateKeys.forEach(key => void qc.invalidateQueries({ queryKey: key }));
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Import failed';
      setError(msg);
    } finally {
      setImporting(false);
    }
  };

  // When merging into an existing feature we don't need a module selector — the
  // featureId is the destination. Otherwise feature-level imports need a module.
  const needsModule  = preview?.valid && preview.exportType === 'feature'  && !mergeMode && modules.length > 0;
  const needsFeature = preview?.valid && preview.exportType === 'testCase' && features.length > 0;
  const canImport = preview?.valid && !success && !mergeResult && (!needsModule || !!selectedModuleId) && (!needsFeature || !!selectedFeatureId);

  const inputCls   = 'w-full rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-violet-500';
  const inputStyle = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' };

  const conflictList = success?.conflicts ?? preview?.conflicts ?? [];

  return (
    <Modal open={open} onClose={handleClose} title="Import">
      <div className="space-y-4 min-w-[440px]">

        {/* File picker */}
        {!success && (
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'rgba(238,238,248,0.60)' }}>
              Select export file (.json)
            </label>
            <input
              ref={fileRef} type="file" accept=".json,application/json" onChange={handleFile}
              className="block w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-violet-500/20 file:text-violet-300 hover:file:bg-violet-500/30 cursor-pointer"
              style={{ color: 'rgba(238,238,248,0.55)' }}
            />
          </div>
        )}

        {/* Loading preview */}
        {previewLoading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.50)' }}>
            <Loader2 size={14} className="animate-spin" /> Reading file…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Preview card */}
        {preview && !success && !mergeResult && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <div className="flex items-center gap-2">
              <FileJson size={16} style={{ color: '#a78bfa' }} />
              <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Import Preview</span>
            </div>

            {/* Mode toggle — only shown when feature-level upload AND we have a target feature
                (i.e. modal was opened from a feature page). Merge updates tests in place
                rather than creating a new sibling feature. */}
            {preview.exportType === 'feature' && targetFeatureId && (
              <div
                className="rounded-lg p-2.5 space-y-1.5"
                style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.22)' }}
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgba(196,181,253,0.85)' }}>
                  How should this be imported?
                </div>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={mergeMode}
                    onChange={() => setMergeMode(true)}
                    className="mt-1"
                  />
                  <span className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.85)' }}>
                    <strong>Merge into this feature</strong>
                    <span style={{ color: 'rgba(238,238,248,0.55)' }}> — match tests by name. Update existing, create new ones. Existing test history is preserved (each match snapshots before overwrite for undo).</span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!mergeMode}
                    onChange={() => setMergeMode(false)}
                    className="mt-1"
                  />
                  <span className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.85)' }}>
                    <strong>Create as new feature</strong>
                    <span style={{ color: 'rgba(238,238,248,0.55)' }}> — adds a sibling feature in the same module. Original feature stays untouched. Name conflicts get an `(imported)` suffix.</span>
                  </span>
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs" style={{ color: 'rgba(238,238,248,0.60)' }}>
              <span>Type</span>
              <span className="capitalize font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>{preview.exportType}</span>
              <span>Source</span>
              <span className="font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>{preview.sourceName || '—'}</span>
              <span>Exported</span>
              <span>{preview.exportedAt ? new Date(preview.exportedAt).toLocaleDateString() : '—'}</span>
            </div>

            <div className="flex gap-4 text-xs pt-1 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)', color: 'rgba(238,238,248,0.55)' }}>
              {preview.modulesCount > 0  && <span><b style={{ color: 'rgba(238,238,248,0.90)' }}>{preview.modulesCount}</b> module{preview.modulesCount !== 1 ? 's' : ''}</span>}
              {preview.featuresCount > 0 && <span><b style={{ color: 'rgba(238,238,248,0.90)' }}>{preview.featuresCount}</b> feature{preview.featuresCount !== 1 ? 's' : ''}</span>}
              {preview.testCasesCount > 0 && <span><b style={{ color: 'rgba(238,238,248,0.90)' }}>{preview.testCasesCount}</b> test case{preview.testCasesCount !== 1 ? 's' : ''}</span>}
            </div>

            {/* Selectable item tree — uncheck rows to skip them */}
            {preview.items?.length > 0 && (
              <PreviewItemTree
                items={preview.items}
                selection={pathSelection ?? new Set(collectAllPaths(preview.items))}
                onChange={(next) => setPathSelection(next)}
              />
            )}

            {/* Conflict warning */}
            {preview.conflicts?.length > 0 && (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(251,191,36,0.30)', background: 'rgba(251,191,36,0.06)' }}>
                <button
                  onClick={() => setConflictsOpen(p => !p)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
                  style={{ color: '#fbbf24' }}
                >
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    {preview.conflicts.length} name conflict{preview.conflicts.length !== 1 ? 's' : ''} — will be renamed
                  </span>
                  {conflictsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                {conflictsOpen && (
                  <div className="px-3 pb-3 space-y-1.5">
                    {preview.conflicts.map((c, i) => (
                      <div key={i} className="text-xs" style={{ color: 'rgba(238,238,248,0.60)' }}>
                        <span className="uppercase mr-1.5 px-1 py-0.5 rounded text-[10px]"
                          style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(238,238,248,0.45)' }}>
                          {typeLabel[c.type]}
                        </span>
                        <span style={{ color: 'rgba(238,238,248,0.75)' }}>"{c.originalName}"</span>
                        <span className="mx-1.5">→</span>
                        <span style={{ color: '#a78bfa' }}>"{c.resolvedName}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Target selectors */}
        {needsModule && (
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.60)' }}>Target module</label>
            <select className={inputCls} style={inputStyle} value={selectedModuleId} onChange={e => void handleModuleChange(e.target.value)}>
              <option value="">— Select a module —</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        )}
        {needsFeature && (
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.60)' }}>Target feature</label>
            <select className={inputCls} style={inputStyle} value={selectedFeatureId} onChange={e => void handleFeatureChange(e.target.value)}>
              <option value="">— Select a feature —</option>
              {features.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.20)' }}>
            <div className="flex items-center gap-2">
              <Check size={16} style={{ color: '#34d399' }} />
              <span className="text-sm font-semibold" style={{ color: '#34d399' }}>Import successful</span>
            </div>
            <p className="text-xs" style={{ color: 'rgba(238,238,248,0.60)' }}>
              Created: {[
                success.modulesCreated  ? `${success.modulesCreated} module${success.modulesCreated !== 1 ? 's' : ''}`        : '',
                success.featuresCreated ? `${success.featuresCreated} feature${success.featuresCreated !== 1 ? 's' : ''}`     : '',
                success.testCasesCreated ? `${success.testCasesCreated} test case${success.testCasesCreated !== 1 ? 's' : ''}` : '',
              ].filter(Boolean).join(', ')}
            </p>
            {conflictList.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-xs font-medium" style={{ color: '#fbbf24' }}>
                  {conflictList.length} item{conflictList.length !== 1 ? 's' : ''} renamed to avoid conflicts:
                </p>
                {conflictList.map((c, i) => (
                  <div key={i} className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    "{c.originalName}" → <span style={{ color: '#a78bfa' }}>"{c.resolvedName}"</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Merge success */}
        {mergeResult && (
          <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.30)' }}>
            <div className="flex items-center gap-2">
              <Check size={16} style={{ color: '#c4b5fd' }} />
              <span className="text-sm font-semibold" style={{ color: '#c4b5fd' }}>Merge complete</span>
            </div>
            <p className="text-xs" style={{ color: 'rgba(238,238,248,0.65)' }}>
              <strong style={{ color: 'rgba(238,238,248,0.92)' }}>{mergeResult.updated}</strong> updated · <strong style={{ color: 'rgba(238,238,248,0.92)' }}>{mergeResult.created}</strong> created
              {mergeResult.skipped > 0 && <> · <strong style={{ color: '#fbbf24' }}>{mergeResult.skipped}</strong> skipped</>}
            </p>
            {mergeResult.items.length > 0 && (
              <div className="mt-1 max-h-[180px] overflow-y-auto space-y-0.5">
                {mergeResult.items.map((it, i) => (
                  <div key={i} className="text-[11px] flex items-center gap-1.5" style={{ color: 'rgba(238,238,248,0.65)' }}>
                    <span
                      className="inline-block w-12 text-center px-1 py-0.5 rounded uppercase text-[9px] font-semibold"
                      style={{
                        background: it.action === 'updated' ? 'rgba(251,191,36,0.15)' : it.action === 'created' ? 'rgba(52,211,153,0.15)' : 'rgba(148,163,184,0.10)',
                        color: it.action === 'updated' ? '#fbbf24' : it.action === 'created' ? '#34d399' : '#94a3b8',
                      }}
                    >
                      {it.action}
                    </span>
                    <span className="truncate">{it.name}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px]" style={{ color: 'rgba(238,238,248,0.40)' }}>
              Each updated test has a snapshot labelled &ldquo;Before merge-import&rdquo; in its version history.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          {(success || mergeResult) ? (
            <Button onClick={handleClose}><Check size={13} /> Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button loading={importing} disabled={!canImport} onClick={handleImport}>
                <Upload size={13} /> {mergeMode && preview?.exportType === 'feature' ? 'Merge' : 'Import'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ─── Version History Button + Modal ──────────────────────────────────────────

interface VersionHistoryProps {
  type: 'test' | 'module';
  id: string;
  onRestored?: () => void;
}

interface VersionEntry {
  id: string;
  versionNumber: number;
  label: string;
  savedAt: string;
  snapshot: {
    name: string;
    description?: string;
    type?: string;
    tags?: string[];
  };
}

export function VersionHistoryButton({ type, id, onRestored }: VersionHistoryProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <History size={13} />
        History
      </Button>
      <VersionHistoryModal type={type} id={id} open={open} onClose={() => setOpen(false)} onRestored={onRestored} />
    </>
  );
}

function VersionHistoryModal({ type, id, open, onClose, onRestored }: VersionHistoryProps & { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const { data: versions = [], isLoading } = useQuery<VersionEntry[]>({
    queryKey: [type === 'test' ? 'test-versions' : 'module-versions', id],
    queryFn: () => type === 'test' ? testVersionsApi.list(id) : moduleVersionsApi.list(id),
    enabled: open,
  });

  const handleRestore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      if (type === 'test') {
        await testVersionsApi.restore(id, versionId);
        void qc.invalidateQueries({ queryKey: ['test', id] });
      } else {
        await moduleVersionsApi.restore(id, versionId);
        void qc.invalidateQueries({ queryKey: ['module', id] });
        void qc.invalidateQueries({ queryKey: ['modules'] });
      }
      setRestored(versionId);
      onRestored?.();
    } catch (e) {
      console.error('Restore failed', e);
    } finally {
      setRestoring(null);
    }
  };

  const handleClose = () => { setRestored(null); onClose(); };

  return (
    <Modal open={open} onClose={handleClose} title="Version History">
      <div className="space-y-3 min-w-[420px]">
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.50)' }}>
          Last {versions.length} snapshots — automatically saved before each edit. Click Restore to revert.
        </p>

        {isLoading && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.50)' }}>
            <Loader2 size={14} className="animate-spin" /> Loading history…
          </div>
        )}

        {!isLoading && versions.length === 0 && (
          <div className="text-sm text-center py-6" style={{ color: 'rgba(238,238,248,0.35)' }}>
            No saved versions yet. Edit and save this {type === 'test' ? 'test case' : 'module'} to create a snapshot.
          </div>
        )}

        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.id} className="rounded-xl p-3 flex items-start justify-between gap-3"
              style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${restored === v.id ? 'rgba(16,185,129,0.30)' : 'rgba(255,255,255,0.08)'}` }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold" style={{ color: 'rgba(238,238,248,0.85)' }}>v{v.versionNumber}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa' }}>{v.label}</span>
                  {restored === v.id && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,185,129,0.12)', color: '#34d399' }}>Restored ✓</span>
                  )}
                </div>
                <div className="text-xs truncate font-medium" style={{ color: 'rgba(238,238,248,0.70)' }}>
                  "{v.snapshot?.name}"
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.38)' }}>
                  {fmtDate(v.savedAt)}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                loading={restoring === v.id}
                disabled={!!restoring || restored === v.id}
                onClick={() => void handleRestore(v.id)}
              >
                <RotateCcw size={11} />
                Restore
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={handleClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Selectable preview tree ─────────────────────────────────────────────────

function collectAllPaths(items: PreviewItem[]): string[] {
  const out: string[] = [];
  const walk = (nodes: PreviewItem[]) => {
    for (const n of nodes) {
      out.push(n.path);
      if (n.children) walk(n.children);
    }
  };
  walk(items);
  return out;
}

function descendantPaths(item: PreviewItem): string[] {
  const out: string[] = [item.path];
  if (item.children) for (const c of item.children) out.push(...descendantPaths(c));
  return out;
}

function PreviewItemTree({
  items, selection, onChange,
}: {
  items: PreviewItem[];
  selection: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allPaths = collectAllPaths(items);
  const allSelected = allPaths.every((p) => selection.has(p));
  const noneSelected = allPaths.every((p) => !selection.has(p));

  const toggleAll = () => {
    if (allSelected) onChange(new Set());
    else onChange(new Set(allPaths));
  };

  const togglePath = (path: string) => {
    const next = new Set(selection);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    onChange(next);
  };

  // Toggling a parent flips the whole subtree to the parent's new state.
  const toggleSubtree = (item: PreviewItem) => {
    const paths = descendantPaths(item);
    const next = new Set(selection);
    const allOn = paths.every((p) => next.has(p));
    if (allOn) for (const p of paths) next.delete(p);
    else for (const p of paths) next.add(p);
    onChange(next);
  };

  const totalSelected = [...selection].length;

  return (
    <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-[11px] uppercase tracking-wide text-slate-400">
          What will be imported · <span className="text-slate-200">{totalSelected}</span> / {allPaths.length} selected
        </span>
        <button type="button" onClick={toggleAll} className="text-[11px] text-purple-300 hover:text-purple-200">
          {allSelected ? 'Deselect all' : noneSelected ? 'Select all' : 'Select all'}
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto py-1">
        {items.map((item) => (
          <PreviewItemNode key={item.path} item={item} depth={0} selection={selection} onTogglePath={togglePath} onToggleSubtree={toggleSubtree} />
        ))}
      </div>
    </div>
  );
}

function PreviewItemNode({
  item, depth, selection, onTogglePath, onToggleSubtree,
}: {
  item: PreviewItem;
  depth: number;
  selection: Set<string>;
  onTogglePath: (path: string) => void;
  onToggleSubtree: (item: PreviewItem) => void;
}) {
  const isSelected = selection.has(item.path);
  const hasChildren = (item.children?.length ?? 0) > 0;
  const childPaths = hasChildren ? descendantPaths(item).slice(1) : [];
  const allChildrenSelected = hasChildren && childPaths.every((p) => selection.has(p));
  const someChildrenSelected = hasChildren && childPaths.some((p) => selection.has(p));
  const indeterminate = hasChildren && someChildrenSelected && !allChildrenSelected;

  const icon = item.kind === 'module' ? '📁' : item.kind === 'feature' ? '🎯' : '✓';

  return (
    <>
      <label
        className="flex items-center gap-2 px-3 py-1 hover:bg-white/3 cursor-pointer"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        <input
          type="checkbox"
          checked={isSelected}
          ref={(el) => { if (el) el.indeterminate = !isSelected && indeterminate; }}
          onChange={() => (hasChildren ? onToggleSubtree(item) : onTogglePath(item.path))}
          className="accent-purple-500 shrink-0"
        />
        <span className="text-[11px] shrink-0 w-4">{icon}</span>
        <span className="text-sm text-slate-200 truncate flex-1">{item.name}</span>
        {item.conflict && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'rgba(251,191,36,0.10)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}>
            renamed
          </span>
        )}
      </label>
      {item.children?.map((c) => (
        <PreviewItemNode key={c.path} item={c} depth={depth + 1} selection={selection} onTogglePath={onTogglePath} onToggleSubtree={onToggleSubtree} />
      ))}
    </>
  );
}
