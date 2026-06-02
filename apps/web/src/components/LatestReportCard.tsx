import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, Download, ChevronRight } from 'lucide-react';
import { reportsApi, api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';
import { GenerateReportButton } from './GenerateReportButton';

type ReportType = 'FEATURE' | 'MODULE' | 'PROJECT' | 'PHASE' | 'SESSION';
type Format = 'HTML' | 'PDF';

type LatestReport = {
  id: string;
  title: string;
  type: ReportType;
  format: Format;
  generatedAt: string;
  generatedBy?: { name?: string | null; email?: string | null };
} | null;

interface Props {
  projectId: string;
  /** Scope this card represents. Drives both the API query and the
   *  default scope of the inline Generate button. */
  scope: { type: 'MODULE'; moduleId: string }
       | { type: 'FEATURE'; featureId: string; moduleId?: string };
  /** Where [View all reports →] navigates. Defaults to project Reports tab
   *  with the appropriate scope filter pre-applied via URL params. */
  viewAllPath?: string;
}

/**
 * Compact "latest report" widget for module + feature overview pages.
 *
 * Replaces the full Reports table previously rendered at module/feature scope.
 * Shows just the most recent report at this scope plus quick actions.
 * Comprehensive browse lives in the project Reports tab — link out via
 * `[View all reports →]`, with scope filter pre-populated so users land on
 * exactly the rows they care about (per user spec: "pass context").
 */
export function LatestReportCard({ projectId, scope, viewAllPath }: Props) {
  const queryParams = scope.type === 'FEATURE'
    ? { featureId: scope.featureId }
    : { moduleId: scope.moduleId };

  const { data: latest, isLoading } = useQuery<LatestReport>({
    queryKey: ['report-latest', projectId, queryParams],
    queryFn: () => reportsApi.latest(projectId, queryParams),
    enabled: !!projectId,
    staleTime: 15_000,
  });

  // Default deep link → project Reports tab pre-filtered to this scope.
  // The project page reads these query params to pre-populate filter chips.
  const defaultViewAll = `/projects/${projectId}?tab=quality`;
  const target = viewAllPath ?? defaultViewAll;

  async function openReport(reportId: string) {
    try {
      // Open the HTML preview — instant and available even before the PDF
      // artifact has finished rendering.
      const resp = await api.get(`/api/v1/reports/${reportId}/preview`, {
        responseType: 'blob',
      });
      const blob = new Blob([resp.data], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      globalThis.open(url, '_blank', 'noopener');
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error('Could not open report', 'Try generating a fresh report.');
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.55)' }}>
            <FileText size={14} /> Loading latest report…
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty state — no reports at this scope yet.
  if (!latest) {
    return (
      <Card>
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.6)' }}>
              <FileText size={14} style={{ color: 'var(--accent-400)' }} />
              <span>No reports generated yet for this {scope.type === 'FEATURE' ? 'feature' : 'module'}.</span>
            </div>
            <GenerateReportButton
              projectId={projectId}
              scope={scope}
              variant="primary"
              size="sm"
              label="Generate one"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Has at least one report — show the most recent.
  const generatedByLabel = latest.generatedBy?.name || latest.generatedBy?.email || 'unknown';

  return (
    <Card>
      <CardContent>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2">
              <FileText size={14} style={{ color: 'var(--accent-400)' }} />
              <span className="text-xs font-medium uppercase tracking-wide"
                    style={{ color: 'rgba(238,238,248,0.55)' }}>
                Latest report
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge>{latest.type}</Badge>
              <span className="text-sm font-medium truncate" title={latest.title}>
                {latest.title}
              </span>
            </div>
            <div className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
              {formatDate(latest.generatedAt)} · by {generatedByLabel} · {latest.format}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="secondary" onClick={() => void openReport(latest.id)}>
              <Download size={12} /> View
            </Button>
            <Link to={target} title="See all reports for this scope">
              <Button size="sm" variant="ghost">
                View all <ChevronRight size={12} />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
