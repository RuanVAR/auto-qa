import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, RotateCcw, Info } from 'lucide-react';
import { api, pluginsApi, type PluginInstall } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

type ProjectPhase = { id: string; name: string; order: number };
type ListStatus = { id: string; label: string; meta?: { type?: string; color?: string } };
type Mapping = {
  direction: 'OUTBOUND' | 'INBOUND' | 'BIDIRECTIONAL';
  targetType: 'PHASE' | 'ISSUE_STATUS';
  platformValue: string;
  externalValue: string;
};

const ISSUE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX', 'CLOSED'] as const;
type TargetTab = 'PHASE' | 'ISSUE_STATUS';

/**
 * One row per ProjectPhase × one cell per direction.
 *
 * For Phase 2 we keep the model simple: each phase row carries an OUTBOUND
 * mapping (platform phase → external status) and an INBOUND mapping (external
 * status → platform phase). Bidirectional rows happen when the same
 * external status is picked on both sides — the backend stores them as two
 * mappings (one OUTBOUND + one INBOUND) so we don't lose direction granularity.
 *
 * Empty cells are not persisted — leaving a row's outbound or inbound blank
 * means "no mapping in that direction", which propagates into a `UNMAPPED`
 * suggestion at sync time when an inbound update arrives without a mapping.
 *
 * The grid is hidden until the binding has a `defaultListId` set, since list
 * statuses are list-scoped and there's nothing meaningful to map to otherwise.
 */
export function StatusMappingGrid({
  projectId,
  bindingId,
  install,
  defaultListId,
}: {
  projectId: string;
  bindingId: string | null;
  install: PluginInstall;
  defaultListId: string | null;
}) {
  const qc = useQueryClient();
  const orgId = install.orgId;

  const phasesQ = useQuery({
    queryKey: ['project', projectId, 'phases'],
    queryFn: () => api.get<ProjectPhase[]>(`/api/v1/projects/${projectId}/phases`).then((r) => r.data),
    enabled: !!projectId,
  });

  const statusesQ = useQuery({
    queryKey: ['plugins', 'list-statuses', install.id, defaultListId],
    queryFn: () =>
      pluginsApi.dispatch<{ items: ListStatus[] }>(orgId, install.id, {
        capability: 'listEntities',
        payload: { kind: 'list-statuses', parent: { listId: defaultListId } },
      }),
    enabled: !!defaultListId,
    staleTime: 60_000,
  });

  const mappingsQ = useQuery({
    queryKey: ['plugin-bindings', projectId, bindingId, 'status-mappings'],
    queryFn: () =>
      api
        .get<Mapping[]>(`/api/v1/projects/${projectId}/plugin-bindings/${bindingId}/status-mappings`)
        .then((r) => r.data),
    enabled: !!bindingId,
  });

  // Two independent draft buffers — one per target tab. Each phase or status
  // row carries an outbound + inbound choice; flattening collapses identical
  // outbound/inbound to a single BIDIRECTIONAL row server-side.
  const [tab, setTab] = useState<TargetTab>('PHASE');
  const [draftPhase, setDraftPhase] = useState<Record<string, { outbound: string; inbound: string }>>({});
  const [draftIssue, setDraftIssue] = useState<Record<string, { outbound: string; inbound: string }>>({});
  const [dirty, setDirty] = useState(false);

  // Hydrate both drafts whenever the persisted mapping list changes.
  useEffect(() => {
    if (!phasesQ.data || !mappingsQ.data) return;
    const phaseDraft: Record<string, { outbound: string; inbound: string }> = {};
    for (const phase of phasesQ.data) phaseDraft[phase.name] = { outbound: '', inbound: '' };
    const issueDraft: Record<string, { outbound: string; inbound: string }> = {};
    for (const status of ISSUE_STATUSES) issueDraft[status] = { outbound: '', inbound: '' };
    for (const m of mappingsQ.data) {
      const target = m.targetType === 'PHASE' ? phaseDraft : issueDraft;
      const slot = target[m.platformValue];
      if (!slot) continue;
      if (m.direction === 'OUTBOUND' || m.direction === 'BIDIRECTIONAL') slot.outbound = m.externalValue;
      if (m.direction === 'INBOUND' || m.direction === 'BIDIRECTIONAL') slot.inbound = m.externalValue;
    }
    setDraftPhase(phaseDraft);
    setDraftIssue(issueDraft);
    setDirty(false);
  }, [phasesQ.data, mappingsQ.data]);

  const statusOptions = statusesQ.data?.items ?? [];

  const flattenDraft = (
    draft: Record<string, { outbound: string; inbound: string }>,
    targetType: 'PHASE' | 'ISSUE_STATUS',
  ): Mapping[] => {
    const out: Mapping[] = [];
    for (const [platformValue, cell] of Object.entries(draft)) {
      const same = cell.outbound && cell.outbound === cell.inbound;
      if (same) {
        out.push({ direction: 'BIDIRECTIONAL', targetType, platformValue, externalValue: cell.outbound });
        continue;
      }
      if (cell.outbound) out.push({ direction: 'OUTBOUND', targetType, platformValue, externalValue: cell.outbound });
      if (cell.inbound) out.push({ direction: 'INBOUND', targetType, platformValue, externalValue: cell.inbound });
    }
    return out;
  };

  const flattened = useMemo<Mapping[]>(
    () => [...flattenDraft(draftPhase, 'PHASE'), ...flattenDraft(draftIssue, 'ISSUE_STATUS')],
    [draftPhase, draftIssue],
  );

  const save = useMutation({
    mutationFn: () =>
      api
        .put(`/api/v1/projects/${projectId}/plugin-bindings/${bindingId}/status-mappings`, { mappings: flattened })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugin-bindings', projectId, bindingId, 'status-mappings'] });
      toast.success('Status mappings saved');
      setDirty(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    },
  });

  const reset = () => {
    if (!phasesQ.data || !mappingsQ.data) return;
    const phaseDraft: Record<string, { outbound: string; inbound: string }> = {};
    for (const p of phasesQ.data) phaseDraft[p.name] = { outbound: '', inbound: '' };
    const issueDraft: Record<string, { outbound: string; inbound: string }> = {};
    for (const status of ISSUE_STATUSES) issueDraft[status] = { outbound: '', inbound: '' };
    for (const m of mappingsQ.data) {
      const target = m.targetType === 'PHASE' ? phaseDraft : issueDraft;
      const slot = target[m.platformValue];
      if (!slot) continue;
      if (m.direction === 'OUTBOUND' || m.direction === 'BIDIRECTIONAL') slot.outbound = m.externalValue;
      if (m.direction === 'INBOUND' || m.direction === 'BIDIRECTIONAL') slot.inbound = m.externalValue;
    }
    setDraftPhase(phaseDraft);
    setDraftIssue(issueDraft);
    setDirty(false);
  };

  if (!bindingId || !defaultListId) {
    return (
      <div className="rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <Info className="w-3.5 h-3.5 mt-0.5 text-slate-500" />
        <span>Pick a default list and save the binding first — then you can map phases to ClickUp statuses.</span>
      </div>
    );
  }

  if (phasesQ.isLoading || statusesQ.isLoading || mappingsQ.isLoading) {
    return <div className="text-xs text-slate-400">Loading status mappings…</div>;
  }

  const phases = phasesQ.data ?? [];
  if (phases.length === 0 && tab === 'PHASE') {
    return <div className="text-xs text-slate-400">This project has no phases — add phases first.</div>;
  }

  const setCell = (
    target: TargetTab,
    rowKey: string,
    dir: 'outbound' | 'inbound',
    value: string,
  ) => {
    const setter = target === 'PHASE' ? setDraftPhase : setDraftIssue;
    setter((prev) => ({
      ...prev,
      [rowKey]: { ...(prev[rowKey] ?? { outbound: '', inbound: '' }), [dir]: value },
    }));
    setDirty(true);
  };

  const activeRows: Array<{ key: string; label: string; helper?: string }> =
    tab === 'PHASE'
      ? phases.map((p) => ({ key: p.name, label: p.name }))
      : ISSUE_STATUSES.map((s) => ({ key: s, label: s.replace('_', ' ') }));
  const activeDraft = tab === 'PHASE' ? draftPhase : draftIssue;

  return (
    <div className="space-y-3">
      <div>
        <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Status mappings</h5>
        <p className="text-[11px] text-slate-500 mt-0.5">
          {tab === 'PHASE' ? (
            <>Outbound: when the platform promotes a feature into a phase, push this ClickUp status to every linked task. Inbound is informational at the phase level.</>
          ) : (
            <>Outbound: when an issue moves to this status, push to ClickUp. Inbound: when ClickUp reports this status on a linked task, suggest applying the matched issue status (or auto-apply if enabled on the binding).</>
          )}
        </p>
      </div>

      <div className="inline-flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {(['PHASE', 'ISSUE_STATUS'] as const).map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className="px-3 py-1 text-xs font-semibold rounded-md transition-all"
              style={active ? { background: 'rgba(139,92,246,0.22)', color: '#e9d5ff' } : { color: 'rgba(238,238,248,0.65)' }}
            >
              {t === 'PHASE' ? 'Project phase' : 'Issue status'}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
            <tr>
              <th className="text-left px-3 py-2 font-medium text-slate-400">{tab === 'PHASE' ? 'Project phase' : 'Issue status'}</th>
              <th className="text-left px-3 py-2 font-medium text-slate-400">→ Outbound (push to ClickUp)</th>
              <th className="text-left px-3 py-2 font-medium text-slate-400">← Inbound (from ClickUp)</th>
            </tr>
          </thead>
          <tbody>
            {activeRows.map((row) => {
              const cell = activeDraft[row.key] ?? { outbound: '', inbound: '' };
              return (
                <tr key={row.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td className="px-3 py-2 text-slate-200 font-medium">{row.label}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={cell.outbound}
                      onChange={(e) => setCell(tab, row.key, 'outbound', e.target.value)}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">— no outbound —</option>
                      {statusOptions.map((s) => (
                        <option key={`o-${s.id}`} value={s.label}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={cell.inbound}
                      onChange={(e) => setCell(tab, row.key, 'inbound', e.target.value)}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">— no inbound —</option>
                      {statusOptions.map((s) => (
                        <option key={`i-${s.id}`} value={s.label}>{s.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty || save.isPending}>
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending} loading={save.isPending}>
          <Save className="w-3.5 h-3.5 mr-1" /> Save mappings (both tabs)
        </Button>
      </div>
    </div>
  );
}
