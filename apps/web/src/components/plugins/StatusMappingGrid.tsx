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

  // Local edit buffer keyed by phase name → { outbound, inbound }
  const [draft, setDraft] = useState<Record<string, { outbound: string; inbound: string }>>({});
  const [dirty, setDirty] = useState(false);

  // Hydrate from persisted mappings when the binding's mapping list changes.
  useEffect(() => {
    if (!phasesQ.data || !mappingsQ.data) return;
    const next: Record<string, { outbound: string; inbound: string }> = {};
    for (const phase of phasesQ.data) next[phase.name] = { outbound: '', inbound: '' };
    for (const m of mappingsQ.data) {
      if (m.targetType !== 'PHASE') continue;
      const slot = next[m.platformValue];
      if (!slot) continue;
      if (m.direction === 'OUTBOUND' || m.direction === 'BIDIRECTIONAL') slot.outbound = m.externalValue;
      if (m.direction === 'INBOUND' || m.direction === 'BIDIRECTIONAL') slot.inbound = m.externalValue;
    }
    setDraft(next);
    setDirty(false);
  }, [phasesQ.data, mappingsQ.data]);

  const statusOptions = statusesQ.data?.items ?? [];

  const flattened = useMemo<Mapping[]>(() => {
    const out: Mapping[] = [];
    for (const [phaseName, cell] of Object.entries(draft)) {
      const same = cell.outbound && cell.outbound === cell.inbound;
      if (same) {
        out.push({ direction: 'BIDIRECTIONAL', targetType: 'PHASE', platformValue: phaseName, externalValue: cell.outbound });
        continue;
      }
      if (cell.outbound) out.push({ direction: 'OUTBOUND', targetType: 'PHASE', platformValue: phaseName, externalValue: cell.outbound });
      if (cell.inbound) out.push({ direction: 'INBOUND', targetType: 'PHASE', platformValue: phaseName, externalValue: cell.inbound });
    }
    return out;
  }, [draft]);

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
    const next: Record<string, { outbound: string; inbound: string }> = {};
    for (const p of phasesQ.data) next[p.name] = { outbound: '', inbound: '' };
    for (const m of mappingsQ.data) {
      if (m.targetType !== 'PHASE') continue;
      const slot = next[m.platformValue];
      if (!slot) continue;
      if (m.direction === 'OUTBOUND' || m.direction === 'BIDIRECTIONAL') slot.outbound = m.externalValue;
      if (m.direction === 'INBOUND' || m.direction === 'BIDIRECTIONAL') slot.inbound = m.externalValue;
    }
    setDraft(next);
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
  if (phases.length === 0) {
    return <div className="text-xs text-slate-400">This project has no phases — add phases first.</div>;
  }

  const setCell = (phaseName: string, dir: 'outbound' | 'inbound', value: string) => {
    setDraft((prev) => ({ ...prev, [phaseName]: { ...(prev[phaseName] ?? { outbound: '', inbound: '' }), [dir]: value } }));
    setDirty(true);
  };

  return (
    <div className="space-y-3">
      <div>
        <h5 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">Status mappings</h5>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Outbound: when the platform promotes a feature into a phase, push this ClickUp status to every linked task.
          Inbound: when ClickUp reports this status on a linked task, suggest moving the platform issue to the matched phase.
        </p>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
            <tr>
              <th className="text-left px-3 py-2 font-medium text-slate-400">Project phase</th>
              <th className="text-left px-3 py-2 font-medium text-slate-400">→ Outbound (push to ClickUp)</th>
              <th className="text-left px-3 py-2 font-medium text-slate-400">← Inbound (from ClickUp)</th>
            </tr>
          </thead>
          <tbody>
            {phases.map((phase) => {
              const cell = draft[phase.name] ?? { outbound: '', inbound: '' };
              return (
                <tr key={phase.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td className="px-3 py-2 text-slate-200 font-medium">{phase.name}</td>
                  <td className="px-3 py-1.5">
                    <select
                      value={cell.outbound}
                      onChange={(e) => setCell(phase.name, 'outbound', e.target.value)}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">— no outbound —</option>
                      {statusOptions.map((s) => (
                        <option key={`o-${s.id}`} value={s.label}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      value={cell.inbound}
                      onChange={(e) => setCell(phase.name, 'inbound', e.target.value)}
                      className="w-full bg-slate-900/60 border border-slate-700 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="">— no inbound —</option>
                      {statusOptions.map((s) => (
                        <option key={`i-${s.id}`} value={s.label}>
                          {s.label}
                        </option>
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
          <Save className="w-3.5 h-3.5 mr-1" /> Save mappings
        </Button>
      </div>
    </div>
  );
}
