import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, ArrowLeft, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import { aiCredentialsApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Phase 4 — AI audit page.
 *
 * Paginated list of AISummary rows for the active org. Filter by purpose
 * (g1/g2/g3/extract/run_summary/failure_explain). Each row is collapsible —
 * click to expand and see the truncated prompt + response preview.
 *
 * Cost + duration + token counts come straight from AISummary, so the
 * numbers here match the spend rollup on the Settings → AI page.
 */

const PURPOSE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All' },
  { value: 'g1', label: 'G1 — features from module' },
  { value: 'g2', label: 'G2 — tests from feature' },
  { value: 'g3', label: 'G3 — steps from test' },
  { value: 'extract', label: 'AC extraction' },
  { value: 'run_summary', label: 'Run summary' },
  { value: 'failure_explain', label: 'Failure explanation' },
  { value: 'generate_test', label: 'One-shot test gen (legacy)' },
];

export default function OrgAiAuditPage() {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const [purpose, setPurpose] = useState<string>('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const auditQ = useQuery({
    queryKey: ['ai-audit', orgId, purpose, cursor],
    queryFn: () =>
      aiCredentialsApi.audit(orgId!, {
        limit: 50,
        purpose: purpose || undefined,
        cursor: cursor || undefined,
      }),
    enabled: !!orgId,
  });

  if (!orgId) {
    return <div className="text-sm text-slate-400">Pick an organisation to view its AI audit log.</div>;
  }

  const items = auditQ.data?.items ?? [];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link to="/org" className="inline-flex items-center text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="w-3 h-3 mr-1" /> Organisation
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <FileText className="w-5 h-5 text-purple-300" />
          <h1 className="text-2xl font-semibold text-white">AI audit</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Every AI call this organisation has made — generation surfaces (G1 / G2 / G3),
          AC extraction, legacy run-summary / failure-explanation. Click a row to see the
          prompt + response preview.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-slate-400">Filter by purpose</label>
            <select
              value={purpose}
              onChange={(e) => {
                setPurpose(e.target.value);
                setCursor(null);
              }}
              className="bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-3 py-1.5"
            >
              {PURPOSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span className="text-[11px] text-slate-500">{items.length} rows</span>
          </div>

          {auditQ.isLoading ? (
            <div className="text-xs text-slate-500 py-4">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">
              No AI calls yet. Once you trigger a generation surface (or a run summary), it shows up here.
            </div>
          ) : (
            <ul className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {items.map((row) => {
                const isExpanded = expanded.has(row.id);
                return (
                  <li
                    key={row.id}
                    className="border-b border-white/5 last:border-b-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const next = new Set(expanded);
                        if (next.has(row.id)) next.delete(row.id);
                        else next.add(row.id);
                        setExpanded(next);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-white/3 flex items-center gap-3"
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <Sparkles className="w-3.5 h-3.5 text-purple-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-slate-100 flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded uppercase">
                            {row.purpose ?? row.type.toLowerCase()}
                          </span>
                          <span className="text-slate-300">{row.model}</span>
                          {row.promptVersion && (
                            <span className="text-[10px] text-slate-500 font-mono">{row.promptVersion}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-3">
                          <span>{new Date(row.createdAt).toLocaleString()}</span>
                          {row.durationMs != null && <span>{row.durationMs}ms</span>}
                          {row.inputTokens != null && (
                            <span>
                              {row.inputTokens} in / {row.outputTokens ?? '?'} out
                            </span>
                          )}
                          {row.costUsd != null && row.costUsd > 0 && (
                            <span className="font-mono">${row.costUsd.toFixed(6)}</span>
                          )}
                        </div>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Prompt (preview)</div>
                          <pre className="text-[11px] text-slate-300 bg-slate-900/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {row.promptPreview || '(empty)'}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Response (preview)</div>
                          <pre className="text-[11px] text-slate-300 bg-slate-900/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
                            {row.responsePreview || '(empty)'}
                          </pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {auditQ.data?.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" size="sm" onClick={() => setCursor(auditQ.data!.nextCursor!)}>
                Load older
              </Button>
            </div>
          )}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setCursor(null)}>
                ← Back to newest
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
