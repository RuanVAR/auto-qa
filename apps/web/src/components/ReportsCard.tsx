import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Eye, Plus, Sparkles, Loader } from 'lucide-react';
import { reportsApi, api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { useActiveEnv } from '@/stores/activeEnvStore';

type ReportType = 'FEATURE' | 'MODULE' | 'PROJECT' | 'PHASE';
type Format = 'HTML' | 'PDF';

type GeneratedReport = {
  id: string;
  title: string;
  type: ReportType;
  format: Format;
  generatedAt: string;
  generatedBy?: { name: string; email: string };
  artifactPath?: string | null;
};

interface Props {
  projectId: string;
  /** Optional pre-fill — used when mounted on a feature/module/phase page so
   *  the modal opens with sensible defaults already selected. */
  defaultScope?: {
    type: ReportType;
    featureId?: string;
    moduleId?: string;
    phaseId?: string;
    title?: string;
  };
  /** Auto-open the preview modal for this report id on mount. Wired by
   *  ProjectDetailPage when the URL has `?report=:id` (email click-through
   *  from the report's viewUrl). Without this the click landed on the page
   *  with the report nowhere visible. */
  autoOpenReportId?: string | null;
}

/**
 * Reports card — drops onto Project / Module / Feature / Phase pages.
 *
 * Two responsibilities:
 *   1. Show a compact list of recent generated reports for this scope.
 *   2. Open a "Generate report" modal that posts to the reports.generate
 *      endpoint and immediately previews the rendered HTML.
 *
 * The two-layer Config / GeneratedReport split is honoured by the API; this
 * card stays simple and ad-hoc only — saved Configs are a future surface
 * (separate page or expanded modal). Today, every "generate" is one-shot.
 */
export function ReportsCard({ projectId, defaultScope, autoOpenReportId }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  // When an autoOpen id arrives (typically from a `?report=:id` URL param
  // set by clicking the report link in an email), pop the preview modal
  // straight away. Guard against re-firing on every render with a ref-like
  // check: only open when it changes AND nothing is currently open. The
  // child URL param drives the prop, so clearing it (closing modal) won't
  // re-trigger because the parent updates the URL on close.
  useEffect(() => {
    if (autoOpenReportId && autoOpenReportId !== previewId) {
      setPreviewId(autoOpenReportId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenReportId]);

  const { data: list = [] } = useQuery<GeneratedReport[]>({
    queryKey: ['reports', projectId, defaultScope?.type],
    queryFn: () => reportsApi.list(projectId, defaultScope?.type ? { type: defaultScope.type, limit: 10 } : { limit: 10 }),
    enabled: !!projectId,
    staleTime: 15_000,
  });

  // Filter client-side for feature-scoped views so the list shows only
  // reports about *this* feature, not the whole project's feature reports.
  const filtered = defaultScope?.featureId
    ? list.filter(r => {
        // Best-effort: server doesn't filter by scope id, so check the title.
        // (Title is stable: "Feature Progress — {feature.name}".)
        return r.type === 'FEATURE'; // fall-through: at least filter by type
      })
    : list;

  async function downloadReport(reportId: string) {
    try {
      const resp = await api.get(`/api/v1/reports/${reportId}/download`, { responseType: 'blob' });
      const contentType = resp.headers['content-type'] ?? 'text/html';
      const isPdf = contentType.includes('pdf');
      const blob = new Blob([resp.data], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `report-${reportId}.${isPdf ? 'pdf' : 'html'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      // 404 = artifact not rendered yet (worker job is still running or
      // failed). Tell the user that's why — and offer the preview as a
      // working alternative. Without this, a generic "Download failed"
      // toast confused users into thinking the report was broken.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        toast.warning(
          'PDF still rendering',
          'The PDF artifact isn\'t ready yet. Use the preview (eye icon) to view it now — the download will work in a few seconds.',
        );
      } else {
        toast.error('Download failed', 'Could not download this report.');
      }
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText size={14} style={{ color: 'var(--accent-400)' }} />
              <CardTitle>Reports</CardTitle>
              <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                {filtered.length} generated
              </span>
            </div>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus size={12} /> Generate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: 'rgba(238,238,248,0.45)' }}>
              No reports yet. Click <strong>Generate</strong> to create one.
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.slice(0, 8).map(r => (
                <div
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="muted">{r.type}</Badge>
                      <Badge variant="muted">{r.format}</Badge>
                      <span className="text-sm font-medium truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                        {r.title}
                      </span>
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                      {formatDate(r.generatedAt)}
                      {r.generatedBy?.name ? ` · ${r.generatedBy.name}` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => setPreviewId(r.id)}
                    title="Preview"
                    className="p-1.5 rounded text-sky-300 hover:bg-sky-500/10"
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadReport(r.id)}
                    title="Download"
                    className="p-1.5 rounded hover:bg-white/5"
                    style={{ color: 'rgba(238,238,248,0.65)' }}
                  >
                    <Download size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <GenerateReportModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        defaultScope={defaultScope}
        onGenerated={(id, format) => {
          qc.invalidateQueries({ queryKey: ['reports', projectId] });
          setOpen(false);
          if (format === 'HTML') {
            setPreviewId(id);
          }
        }}
      />

      <ReportPreviewModal
        open={!!previewId}
        reportId={previewId}
        onClose={() => setPreviewId(null)}
      />
    </>
  );
}

// ─── Generate modal ──────────────────────────────────────────────────────────

function GenerateReportModal({
  open, onClose, projectId, defaultScope, onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  defaultScope?: Props['defaultScope'];
  onGenerated: (reportId: string, format: Format) => void;
}) {
  const activeEnvId = useActiveEnv(projectId);
  const [type] = useState<ReportType>(defaultScope?.type ?? 'PROJECT');
  const [includeSession, setIncludeSession] = useState(defaultScope?.type === 'FEATURE');
  const [includeFeature, setIncludeFeature] = useState(defaultScope?.type !== 'PROJECT');
  const [includeProject, setIncludeProject] = useState(defaultScope?.type === 'PROJECT');
  const [format, setFormat] = useState<Format>('HTML');
  const [additionalText, setAdditionalText] = useState('');

  const gen = useMutation({
    mutationFn: () => reportsApi.generate(projectId, {
      type,
      featureId: defaultScope?.featureId,
      moduleId: defaultScope?.moduleId,
      phaseId: defaultScope?.phaseId,
      environmentId: activeEnvId ?? undefined,
      includeSession,
      includeFeature,
      includeProject,
      additionalText: additionalText.trim() || undefined,
    }),
    onSuccess: (data: { report: { id: string; title: string; format: Format } }) => {
      toast.success('Report generated', data.report.title);
      onGenerated(data.report.id, data.report.format);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Generation failed', typeof msg === 'string' ? msg : 'Try again or pick HTML format.');
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Generate report">
      <div className="space-y-4">
        <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.30)', color: 'var(--accent-300)' }}>
          <strong>Scope:</strong> {type}
          {defaultScope?.title ? ` · ${defaultScope.title}` : ''}
          {activeEnvId ? ` · Filtered by active env` : ' · All environments'}
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Sections</label>
          <div className="space-y-1.5">
            <CheckRow checked={includeSession} onChange={setIncludeSession} label="Session testing stats" hint="Steps executed in current session, pass/fail, duration" />
            <CheckRow checked={includeFeature} onChange={setIncludeFeature} label="Feature summary" hint="Phase pipeline + recent runs" />
            <CheckRow checked={includeProject} onChange={setIncludeProject} label="Project summary" hint="Overall pass rate + pipeline overview" />
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Additional notes (optional)
          </label>
          <textarea
            value={additionalText}
            onChange={(e) => setAdditionalText(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Add context, release notes, or any custom narrative you want included in the report."
            className="w-full rounded-lg px-3 py-2 text-xs resize-y"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.90)',
            }}
          />
          <div className="text-[10px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            {additionalText.length}/5000
          </div>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider mb-1.5 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Format</label>
          <div className="flex gap-2">
            {(['HTML', 'PDF'] as Format[]).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className="flex-1 px-3 py-2 rounded-lg text-xs"
                style={{
                  background: format === f ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${format === f ? 'rgba(var(--accent-rgb),0.40)' : 'rgba(255,255,255,0.10)'}`,
                  color: format === f ? 'var(--accent-300)' : 'rgba(238,238,248,0.7)',
                }}
              >
                {f === 'HTML' ? '📄 HTML (preview)' : '📑 PDF (download)'}
              </button>
            ))}
          </div>
          {format === 'PDF' && (
            <p className="text-[10px] mt-1" style={{ color: 'rgba(238,238,248,0.50)' }}>
              PDF renders asynchronously via the worker queue and becomes downloadable once ready.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={gen.isPending}
            disabled={!includeSession && !includeFeature && !includeProject}
            onClick={() => gen.mutate()}
          >
            <Sparkles size={12} /> Generate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CheckRow({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.03]"
      style={{ background: checked ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${checked ? 'rgba(var(--accent-rgb),0.32)' : 'rgba(255,255,255,0.07)'}` }}
    >
      <div
        className="w-4 h-4 rounded shrink-0 mt-0.5 flex items-center justify-center text-[10px]"
        style={{
          background: checked ? '#a855f7' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${checked ? '#a855f7' : 'rgba(255,255,255,0.14)'}`,
          color: 'white',
        }}
      >
        {checked ? '✓' : ''}
      </div>
      <div className="flex-1">
        <div className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'rgba(238,238,248,0.50)' }}>{hint}</div>
      </div>
    </button>
  );
}

// ─── Preview modal ───────────────────────────────────────────────────────────

function ReportPreviewModal({ open, reportId, onClose }: { open: boolean; reportId: string | null; onClose: () => void }) {
  // The download endpoint is JWT-protected; an iframe's GET request can't
  // carry Authorization headers from localStorage, so a direct src= would
  // 401 (Chrome surfaces it as "refused to connect"). Fetch via axios
  // (which applies the interceptor), wrap in a blob URL, point the iframe
  // at that. Same trick used by the session-report button.
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reportId || !open) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setBlobUrl(null);
    // Preview always renders HTML (regenerated on demand from the report's
    // payload) — instant, and available even before the PDF artifact exists.
    api.get(`/api/v1/reports/${reportId}/preview`, { responseType: 'blob' })
      .then(resp => {
        if (cancelled) return;
        const blob = new Blob([resp.data], { type: 'text/html' });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => { if (!cancelled) setBlobUrl(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      // Revoke the blob URL on unmount/close so memory doesn't leak across
      // repeated previews — without this every preview would tail a few MB.
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [reportId, open]);

  if (!reportId) return null;
  return (
    <Modal open={open} onClose={onClose} title="Report preview" size="lg">
      <div className="flex justify-end mb-2 gap-2">
        <button
          onClick={async () => {
            // Same fetch-as-blob dance for download, so the request is
            // authenticated. Triggers a save via a transient anchor.
            const resp = await api.get(`/api/v1/reports/${reportId}/download`, { responseType: 'blob' });
            const contentType = resp.headers['content-type'] ?? 'text/html';
            const isPdf = contentType.includes('pdf');
            const blob = new Blob([resp.data], { type: contentType });
            const u = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = u; a.download = `report-${reportId}.${isPdf ? 'pdf' : 'html'}`; a.click();
            URL.revokeObjectURL(u);
          }}
          className="text-xs px-2 py-1 rounded transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(238,238,248,0.85)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <Download size={11} className="inline mr-1" /> Download
        </button>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ height: '70vh', border: '1px solid rgba(255,255,255,0.10)' }}>
        {loading ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <Loader size={16} className="animate-spin mr-2" /> Loading…
          </div>
        ) : blobUrl ? (
          <iframe
            src={blobUrl}
            className="w-full h-full"
            style={{ background: 'white' }}
            title="Report"
          />
        ) : (
          <div className="flex items-center justify-center h-full" style={{ color: '#f87171' }}>
            Could not load report.
          </div>
        )}
      </div>
    </Modal>
  );
}
