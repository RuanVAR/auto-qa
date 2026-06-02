import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  CheckCircle, XCircle, MinusCircle, ArrowRight, FileText, Loader, PartyPopper, AlertTriangle,
} from 'lucide-react';
import { modulesApi, statsApi, reportsApi, api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

// ─── FeatureCompletionModal ──────────────────────────────────────────────────
// Shown when a QA marks the LAST test in a feature during a manual session.
// Drives the "what next" flow: continue to the next feature, jump to a
// different one in the module, or — when this was the last feature — surface
// the module rollup (sign-off report if everything passes, or the list of
// features that still need work).

interface FeatureSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

interface ModuleFeature {
  id: string;
  name: string;
  order: number;
}

interface FeatureStats {
  featureId: string;
  passed: number;
  failed: number;
  skipped: number;
  outstanding: number;
  total: number;
  passRate: number | null;
}

interface FeatureCompletionModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  moduleId: string;
  moduleName: string;
  currentFeatureId: string;
  currentFeatureName: string;
  /** Live tallies for the feature that was just finished. */
  summary: FeatureSummary;
  /** Start a manual run on the chosen feature + navigate to it. */
  onContinue: (targetFeatureId: string) => void;
  continuing: boolean;
}

/** A feature counts as "signed-off ready" when every test passed. */
function isFeaturePassing(s: FeatureStats | undefined): boolean {
  return !!s && s.total > 0 && s.failed === 0 && s.skipped === 0 && s.outstanding === 0;
}

export function FeatureCompletionModal({
  open,
  onClose,
  projectId,
  moduleId,
  moduleName,
  currentFeatureId,
  currentFeatureName,
  summary,
  onContinue,
  continuing,
}: FeatureCompletionModalProps) {
  const [pickTarget, setPickTarget] = useState('');

  const { data: features = [], isLoading: featuresLoading } = useQuery<ModuleFeature[]>({
    queryKey: ['module-features-filter', moduleId],
    queryFn: () => modulesApi.listFeatures(moduleId) as Promise<ModuleFeature[]>,
    enabled: open && !!moduleId,
    staleTime: 10_000,
  });

  const { data: statsList = [], isLoading: statsLoading } = useQuery<FeatureStats[]>({
    // No envId — module sign-off is across all envs. staleTime 0 so the
    // just-marked feature's numbers are fresh when the modal opens.
    queryKey: ['feature-stats', moduleId],
    queryFn: () => statsApi.getFeatureStats(moduleId) as Promise<FeatureStats[]>,
    enabled: open && !!moduleId,
    staleTime: 0,
  });

  const loading = featuresLoading || statsLoading;

  const {
    nextFeature,
    isLastFeature,
    otherFeatures,
    allPassing,
    featuresNeedingWork,
  } = useMemo(() => {
    const ordered = [...features].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    const statsByFeature = new Map(statsList.map((s) => [s.featureId, s]));

    // Override the just-finished feature's stats with the live summary — the
    // stats endpoint can lag a beat behind the final mark.
    statsByFeature.set(currentFeatureId, {
      featureId: currentFeatureId,
      passed: summary.passed,
      failed: summary.failed,
      skipped: summary.skipped,
      outstanding: Math.max(0, summary.total - summary.passed - summary.failed - summary.skipped),
      total: summary.total,
      passRate: summary.total > 0 ? Math.round((summary.passed / summary.total) * 100) : null,
    });

    const idx = ordered.findIndex((f) => f.id === currentFeatureId);
    const next = idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1] : null;
    const others = ordered.filter((f) => f.id !== currentFeatureId);

    const needWork = ordered.filter((f) => !isFeaturePassing(statsByFeature.get(f.id)));

    return {
      nextFeature: next,
      isLastFeature: idx === ordered.length - 1,
      otherFeatures: others,
      allPassing: ordered.length > 0 && needWork.length === 0,
      featuresNeedingWork: needWork.map((f) => ({ feature: f, stats: statsByFeature.get(f.id) })),
    };
  }, [features, statsList, currentFeatureId, summary]);

  // Generate the module sign-off report and open it in a new tab.
  const generateReport = useMutation({
    mutationFn: () =>
      reportsApi.generate(projectId, {
        type: 'MODULE',
        moduleId,
        includeCharts: true,
      }),
    onSuccess: async (data: { report: { id: string; title: string } }) => {
      toast.success('Module sign-off report generated', data.report.title);
      try {
        const resp = await api.get(`/api/v1/reports/${data.report.id}/preview`, {
          responseType: 'blob',
        });
        const blob = new Blob([resp.data], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {
        toast.error('Open failed', 'Report generated but could not be opened — find it in Reports.');
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not generate report', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Feature complete" size="md">
      <div className="space-y-4">
        {/* ── Just-finished feature summary ── */}
        <div
          className="rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Finished testing
          </p>
          <p className="text-sm font-semibold mb-2" style={{ color: 'rgba(238,238,248,0.95)' }}>
            {currentFeatureName}
          </p>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1" style={{ color: '#34d399' }}>
              <CheckCircle size={13} /> {summary.passed} passed
            </span>
            <span className="flex items-center gap-1" style={{ color: '#f87171' }}>
              <XCircle size={13} /> {summary.failed} failed
            </span>
            <span className="flex items-center gap-1" style={{ color: '#94a3b8' }}>
              <MinusCircle size={13} /> {summary.skipped} skipped
            </span>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs" style={{ color: 'rgba(238,238,248,0.45)' }}>
            <Loader size={14} className="animate-spin" /> Loading module progress…
          </div>
        ) : isLastFeature ? (
          // ── Last feature in the module → module rollup ──
          allPassing ? (
            <div
              className="rounded-xl p-4 text-center"
              style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.30)' }}
            >
              <PartyPopper size={26} className="mx-auto mb-2" style={{ color: '#34d399' }} />
              <p className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.95)' }}>
                Every feature in {moduleName} is passing
              </p>
              <p className="text-xs mt-1 mb-3" style={{ color: 'rgba(238,238,248,0.55)' }}>
                You&rsquo;ve tested all features. Generate the module sign-off report.
              </p>
              <Button
                onClick={() => generateReport.mutate()}
                loading={generateReport.isPending}
              >
                <FileText size={14} className="mr-1" /> Generate module sign-off report
              </Button>
            </div>
          ) : (
            <div
              className="rounded-xl p-4"
              style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.30)' }}
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold mb-1" style={{ color: '#fbbf24' }}>
                <AlertTriangle size={15} /> {featuresNeedingWork.length} feature
                {featuresNeedingWork.length !== 1 ? 's' : ''} still need work
              </p>
              <p className="text-xs mb-3" style={{ color: 'rgba(238,238,248,0.55)' }}>
                {moduleName} can&rsquo;t be signed off until every feature passes. Jump back in:
              </p>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {featuresNeedingWork.map(({ feature, stats }) => (
                  <button
                    key={feature.id}
                    type="button"
                    disabled={continuing}
                    onClick={() => onContinue(feature.id)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <span className="text-xs font-medium min-w-0 break-words" style={{ color: 'rgba(238,238,248,0.90)' }}>
                      {feature.name}
                    </span>
                    <span className="flex items-center gap-2 text-[10px] shrink-0">
                      {stats && stats.failed > 0 && (
                        <span style={{ color: '#f87171' }}>{stats.failed} failed</span>
                      )}
                      {stats && stats.skipped > 0 && (
                        <span style={{ color: '#94a3b8' }}>{stats.skipped} skipped</span>
                      )}
                      {stats && stats.outstanding > 0 && (
                        <span style={{ color: '#fbbf24' }}>{stats.outstanding} to run</span>
                      )}
                      {(!stats || stats.total === 0) && (
                        <span style={{ color: 'rgba(238,238,248,0.4)' }}>no tests</span>
                      )}
                      <ArrowRight size={11} style={{ color: 'var(--accent-400)' }} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )
        ) : (
          // ── Not the last feature → continue / jump ──
          <div className="space-y-3">
            {nextFeature && (
              <button
                type="button"
                disabled={continuing}
                onClick={() => onContinue(nextFeature.id)}
                className="w-full flex items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition-colors disabled:opacity-50"
                style={{ background: 'rgba(var(--accent-rgb),0.14)', border: '1px solid rgba(var(--accent-rgb),0.40)' }}
              >
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
                    Continue to next feature
                  </p>
                  <p className="text-sm font-semibold break-words" style={{ color: 'rgba(238,238,248,0.95)' }}>
                    {nextFeature.name}
                  </p>
                </div>
                {continuing ? (
                  <Loader size={16} className="animate-spin shrink-0" style={{ color: 'var(--accent-300)' }} />
                ) : (
                  <ArrowRight size={16} className="shrink-0" style={{ color: 'var(--accent-300)' }} />
                )}
              </button>
            )}

            {otherFeatures.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider mb-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  Or jump to a different feature
                </p>
                <div className="flex gap-2">
                  <select
                    value={pickTarget}
                    onChange={(e) => setPickTarget(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    <option value="">Select a feature…</option>
                    {otherFeatures.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <Button
                    disabled={!pickTarget || continuing}
                    loading={continuing && !!pickTarget}
                    onClick={() => pickTarget && onContinue(pickTarget)}
                  >
                    Go
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>
            {isLastFeature ? 'Done' : 'Stop for now'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
