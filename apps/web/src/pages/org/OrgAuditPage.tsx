import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ScrollText, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import { orgAuditApi, type AuditRow } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

/**
 * Org-admin audit viewer. Every action attributed to this org — web, API-token,
 * and (later) MCP traffic. Filter by user, action, source, and date; expand a
 * row to see what data was touched (before/after) plus IP / user-agent / token.
 */
const ACTION_OPTIONS = [
  ['', 'All actions'], ['API_CALL', 'API call'], ['CREATE', 'Create'], ['UPDATE', 'Update'],
  ['DELETE', 'Delete'], ['ARCHIVE', 'Archive'], ['RESTORE', 'Restore'],
  ['API_TOKEN_ISSUED', 'Token issued'], ['API_TOKEN_REGENERATED', 'Token regenerated'],
  ['API_TOKEN_REVOKED', 'Token revoked'], ['MCP_TOOL_CALL', 'MCP tool call'],
] as const;
const SOURCE_OPTIONS = [['', 'All sources'], ['web', 'Web app'], ['api-token', 'API token'], ['mcp', 'MCP']] as const;

export default function OrgAuditPage() {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;
  const [userId, setUserId] = useState('');
  const [action, setAction] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const membersQ = useQuery({ queryKey: ['org-members', orgId], queryFn: () => orgAuditApi.members(orgId!), enabled: !!orgId });
  const auditQ = useQuery({
    queryKey: ['org-audit', orgId, userId, action, source, from, to, cursor],
    queryFn: () => orgAuditApi.list(orgId!, {
      limit: 50, cursor: cursor || undefined,
      userId: userId || undefined, action: action || undefined, source: source || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
    }),
    enabled: !!orgId,
  });

  if (!orgId) return <div className="text-sm text-slate-400">Pick an organisation to view its audit log.</div>;
  const items = auditQ.data?.items ?? [];
  const resetCursor = () => setCursor(null);

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <Link to="/org" className="inline-flex items-center text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="w-3 h-3 mr-1" /> Organisation
        </Link>
        <div className="flex items-center gap-2 mt-1">
          <ScrollText className="w-5 h-5 text-purple-300" />
          <h1 className="text-2xl font-semibold text-white">Audit log</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Who did what, from where, via the web app / an API token / MCP — and exactly what changed.
          Expand a row for the before/after detail.
        </p>
      </div>

      <Card>
        <CardContent className="py-4 space-y-3">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            <Select value={userId} onChange={(v) => { setUserId(v); resetCursor(); }}>
              <option value="">All users</option>
              {(membersQ.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
            </Select>
            <Select value={action} onChange={(v) => { setAction(v); resetCursor(); }}>
              {ACTION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select value={source} onChange={(v) => { setSource(v); resetCursor(); }}>
              {SOURCE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <DateInput label="From" value={from} onChange={(v) => { setFrom(v); resetCursor(); }} />
            <DateInput label="To" value={to} onChange={(v) => { setTo(v); resetCursor(); }} />
            <span className="text-[11px] text-slate-500 ml-auto">{items.length} rows</span>
          </div>

          {auditQ.isLoading ? (
            <div className="text-xs text-slate-500 py-4">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-xs text-slate-500 py-6 text-center">No audit entries match these filters.</div>
          ) : (
            <ul className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
              {items.map((row) => (
                <Row key={row.id} row={row} open={expanded.has(row.id)} onToggle={() => {
                  const next = new Set(expanded);
                  next.has(row.id) ? next.delete(row.id) : next.add(row.id);
                  setExpanded(next);
                }} />
              ))}
            </ul>
          )}

          {auditQ.data?.nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" size="sm" onClick={() => setCursor(auditQ.data!.nextCursor!)}>Load older</Button>
            </div>
          )}
          {cursor && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={resetCursor}>← Back to newest</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ row, open, onToggle }: { row: AuditRow; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-b border-white/5 last:border-b-0">
      <button type="button" onClick={onToggle} className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-3">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-100 flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded">{row.action}</span>
            <span className="text-slate-300 truncate">{row.entity}</span>
            <SourceChip source={row.source} />
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{new Date(row.createdAt).toLocaleString()}</span>
            <span>· {row.user?.email ?? 'system'}</span>
            {row.ip && <span>· {row.ip}</span>}
            {row.apiTokenId && <span>· token {row.apiTokenId.slice(0, 8)}…</span>}
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <Meta label="Target" value={`${row.entity} / ${row.entityId}`} />
          {row.userAgent && <Meta label="User agent" value={row.userAgent} />}
          {row.apiTokenId && <Meta label="Token id" value={row.apiTokenId} />}
          {row.before != null && <JsonBlock label="Before" value={row.before} />}
          {row.after != null && <JsonBlock label="After" value={row.after} />}
        </div>
      )}
    </li>
  );
}

function SourceChip({ source }: { source: string | null }) {
  if (!source) return null;
  const color = source === 'mcp' ? 'text-sky-300 bg-sky-500/10' : source === 'api-token' ? 'text-amber-300 bg-amber-500/10' : 'text-slate-400 bg-white/5';
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{source}</span>;
}
function Meta({ label, value }: { label: string; value: string }) {
  return <div className="text-[11px]"><span className="text-slate-500 uppercase tracking-wider">{label}: </span><span className="text-slate-300 font-mono break-all">{value}</span></div>;
}
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <pre className="text-[11px] text-slate-300 bg-slate-900/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
function Select({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-slate-900/60 border border-slate-700 rounded-md text-sm text-white px-2.5 py-1.5">
      {children}
    </select>
  );
}
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-[11px] text-slate-500 flex items-center gap-1">
      {label}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="bg-slate-900/60 border border-slate-700 rounded-md text-xs text-white px-2 py-1" />
    </label>
  );
}
