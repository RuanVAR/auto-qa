/**
 * SchedulesPanel — recurring AUTOMATED feature runs for a project.
 *
 * Lists RunSchedules (feature + env + cron) with an enable toggle, and a
 * create modal offering cadence presets plus a raw cron field with a live
 * next-3-fires preview (validated server-side via /run-schedules/preview).
 * Rendered on the project Runs page; FeaturePage links here pre-filled.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { environmentsApi, featuresApi, runSchedulesApi, type RunSchedule } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { formatDate } from '@/lib/utils';

const CRON_PRESETS: Array<{ label: string; expr: string }> = [
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily 02:00', expr: '0 2 * * *' },
  { label: 'Weekdays 06:00', expr: '0 6 * * 1-5' },
  { label: 'Weekly (Mon 02:00)', expr: '0 2 * * 1' },
];

export function SchedulesPanel({ projectId, presetFeatureId }: { projectId: string; presetFeatureId?: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [featureId, setFeatureId] = useState(presetFeatureId ?? '');
  const [environmentId, setEnvironmentId] = useState('');
  const [cronExpr, setCronExpr] = useState('0 2 * * *');

  const { data: schedules = [] } = useQuery({
    queryKey: ['run-schedules', projectId],
    queryFn: () => runSchedulesApi.list(projectId),
  });
  const { data: envs = [] } = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId),
  });
  const { data: features = [] } = useQuery({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId),
    enabled: open,
  });
  // Live next-fires preview — also the cron validation (400 on bad input).
  const { data: preview, isError: cronInvalid } = useQuery({
    queryKey: ['run-schedule-preview', projectId, cronExpr],
    queryFn: () => runSchedulesApi.preview(projectId, cronExpr),
    enabled: open && !!cronExpr.trim(),
    retry: false,
  });

  const automationEnvs = useMemo(
    () => (envs as Array<{ id: string; name: string; supportsAutomation?: boolean }>).filter(e => e.supportsAutomation),
    [envs],
  );

  const invalidate = () => qc.invalidateQueries({ queryKey: ['run-schedules', projectId] });
  const createMut = useMutation({
    mutationFn: () => runSchedulesApi.create(projectId, { featureId, environmentId, cronExpr }),
    onSuccess: () => { toast.success('Schedule created'); setOpen(false); invalidate(); },
    onError: (err) => toast.error((err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Failed to create schedule'),
  });
  const toggleMut = useMutation({
    mutationFn: (s: RunSchedule) => runSchedulesApi.update(s.id, { enabled: !s.enabled }),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => runSchedulesApi.remove(id),
    onSuccess: () => { toast.success('Schedule deleted'); invalidate(); },
  });

  return (
    <Card>
      <CardContent className="py-3">
        <div className="flex items-center gap-2 mb-2">
          <CalendarClock size={14} className="text-sky-500" />
          <span className="text-sm font-semibold text-gray-900">Scheduled runs ({schedules.length})</span>
          <span className="text-xs text-gray-400">recurring automated feature runs</span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setOpen(true)}>
            <Plus size={13} /> Schedule
          </Button>
        </div>

        {schedules.length === 0 ? (
          <div className="text-xs text-gray-400 py-2">
            None yet — schedule a feature to run automatically (e.g. nightly against Staging).
          </div>
        ) : (
          <div className="space-y-1">
            {schedules.map(s => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <button
                  type="button"
                  onClick={() => toggleMut.mutate(s)}
                  title={s.enabled ? 'Disable' : 'Enable'}
                  className="relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors"
                  style={{ background: s.enabled ? 'var(--accent-400)' : 'rgba(120,120,140,0.35)' }}
                >
                  <span
                    className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform"
                    style={{ transform: s.enabled ? 'translateX(14px)' : 'translateX(2px)' }}
                  />
                </button>
                <span className="truncate text-xs text-gray-700">
                  {s.feature?.name ?? s.featureId} · {s.environment?.name ?? s.environmentId}
                </span>
                <code className="shrink-0 text-[11px] text-gray-500">{s.cronExpr}</code>
                <span className="ml-auto shrink-0 text-[11px] text-gray-400 tabular-nums">
                  {s.enabled && s.nextRunAt ? `next ${formatDate(s.nextRunAt)}` : 'off'}
                </span>
                <button
                  type="button"
                  onClick={() => removeMut.mutate(s.id)}
                  className="shrink-0 text-gray-300 hover:text-red-500"
                  title="Delete schedule"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {open && (
        <Modal open onClose={() => setOpen(false)} title="Schedule automated runs">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Feature</label>
              <select
                value={featureId}
                onChange={e => setFeatureId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select a feature…</option>
                {(features as Array<{ id: string; name: string }>).map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Environment</label>
              <select
                value={environmentId}
                onChange={e => setEnvironmentId(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select an environment…</option>
                {automationEnvs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              {automationEnvs.length === 0 && (
                <p className="mt-1 text-[11px] text-yellow-600">
                  No automation-enabled environments — turn on “Supports automation” on an environment first.
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Cadence</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {CRON_PRESETS.map(p => (
                  <button
                    key={p.expr}
                    type="button"
                    onClick={() => setCronExpr(p.expr)}
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium border"
                    style={cronExpr === p.expr
                      ? { borderColor: 'var(--accent-400)', color: 'var(--accent-400)' }
                      : { borderColor: 'rgba(120,120,140,0.3)', color: 'rgba(120,120,140,0.9)' }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <input
                value={cronExpr}
                onChange={e => setCronExpr(e.target.value)}
                placeholder="0 2 * * *"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 font-mono text-sm"
              />
              {cronInvalid ? (
                <p className="mt-1 text-[11px] text-red-500">Invalid cron expression.</p>
              ) : preview?.next?.length ? (
                <p className="mt-1 text-[11px] text-gray-400">
                  Next: {preview.next.map(d => formatDate(d)).join(' · ')} (UTC)
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => createMut.mutate()}
                loading={createMut.isPending}
                disabled={!featureId || !environmentId || !cronExpr.trim() || cronInvalid}
              >
                Create schedule
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}
