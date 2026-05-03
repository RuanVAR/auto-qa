import { useState, useRef } from 'react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { Download, Upload, FileJson, Check, AlertCircle, Loader2, History, RotateCcw, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { importExportApi, testVersionsApi, moduleVersionsApi } from '@/lib/api';
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
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  return (
    <Button variant={variant} size={size} onClick={handleExport} loading={loading}>
      <Download size={13} />
      Export
    </Button>
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
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  targetModuleId?: string;
  modules?: { id: string; name: string }[];
  features?: { id: string; name: string }[];
  invalidateKeys?: string[][];
}

export function ImportModal({
  open,
  onClose,
  projectId,
  targetModuleId,
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
  const [selectedFeatureId, setSelectedFeatureId] = useState('');

  const reset = () => {
    setEnvelope(null); setPreview(null); setError(''); setSuccess(null);
    setSelectedModuleId(targetModuleId ?? ''); setSelectedFeatureId('');
    setConflictsOpen(false);
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
      const opts = selectedModuleId ? { targetModuleId: selectedModuleId } :
                   selectedFeatureId ? { targetFeatureId: selectedFeatureId } : {};
      const result = await importExportApi.previewImport(projectId, parsed, opts) as PreviewData;
      setPreview(result);
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
      } catch { /* keep existing preview */ } finally { setPreviewLoading(false); }
    }
  };

  const handleImport = async () => {
    if (!envelope || !preview?.valid) return;
    setImporting(true); setError('');
    try {
      const opts: { targetModuleId?: string; targetFeatureId?: string } = {};
      if (preview.exportType === 'feature' && selectedModuleId) opts.targetModuleId = selectedModuleId;
      if (preview.exportType === 'testCase' && selectedFeatureId) opts.targetFeatureId = selectedFeatureId;

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

  const needsModule  = preview?.valid && preview.exportType === 'feature'  && modules.length > 0;
  const needsFeature = preview?.valid && preview.exportType === 'testCase' && features.length > 0;
  const canImport = preview?.valid && !success && (!needsModule || !!selectedModuleId) && (!needsFeature || !!selectedFeatureId);

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
        {preview && !success && (
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}>
            <div className="flex items-center gap-2">
              <FileJson size={16} style={{ color: '#a78bfa' }} />
              <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Import Preview</span>
            </div>

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

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          {success ? (
            <Button onClick={handleClose}><Check size={13} /> Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={handleClose}>Cancel</Button>
              <Button loading={importing} disabled={!canImport} onClick={handleImport}>
                <Upload size={13} /> Import
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
