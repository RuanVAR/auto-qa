import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Mail, Plus, Pencil, Trash2, Play, Loader } from 'lucide-react';
import { reportSchedulesApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { toast } from '@/components/ui/Toast';
import { ReportScheduleModal, type ScheduleRow } from './ReportScheduleModal';

/**
 * ReportSchedulesCard
 * -------------------
 * Sits next to ReportsCard on the project Quality tab. Lists every
 * scheduled report (project / module / feature scoped), shows when each
 * one will fire next + when it last fired, and exposes Run-now / Edit /
 * Delete per row.
 *
 * Designed to match the visual language of ReportsCard exactly — same
 * header pattern, same row chip style, same compact action icons. The
 * Schedules API already existed (cron tick + send-email path verified end
 * to end on dev); this card is what makes it discoverable.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  projectId: string;
}

export function ReportSchedulesCard({ projectId }: Props) {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleRow | null>(null);

  const { data: schedules = [], isLoading } = useQuery<ScheduleRow[]>({
    queryKey: ['report-schedules', projectId],
    queryFn: () => reportSchedulesApi.list(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  // Run-now mutation. Generates the report immediately AND emails the
  // recipients via the existing report dispatch path — same flow as the
  // cron tick. Doesn't reset the schedule's next-fire calculation.
  const runNowMut = useMutation({
    mutationFn: (id: string) => reportSchedulesApi.runNow(id),
    onSuccess: () => {
      toast.success('Schedule fired', 'Report is generating and will be emailed shortly.');
      qc.invalidateQueries({ queryKey: ['report-schedules', projectId] });
      qc.invalidateQueries({ queryKey: ['reports', projectId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Run failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  // Delete with confirm. The server-side fix from commit 7c8bed4 makes
  // missing ids return clean 404 — we treat that as "already gone" success.
  const deleteMut = useMutation({
    mutationFn: (id: string) => reportSchedulesApi.remove(id),
    onSuccess: () => {
      toast.success('Schedule deleted');
      qc.invalidateQueries({ queryKey: ['report-schedules', projectId] });
    },
    onError: (err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        toast.success('Already gone', 'Schedule no longer exists.');
        qc.invalidateQueries({ queryKey: ['report-schedules', projectId] });
        return;
      }
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Delete failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  function handleDelete(s: ScheduleRow) {
    const ok = window.confirm(`Delete schedule “${s.name}”? It will stop sending immediately.`);
    if (!ok) return;
    deleteMut.mutate(s.id);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar size={14} style={{ color: '#7dd3fc' }} />
              <CardTitle>Scheduled reports</CardTitle>
              <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                {isLoading ? '…' : schedules.length} {schedules.length === 1 ? 'active' : 'active'}
              </span>
            </div>
            <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>
              <Plus size={12} /> Schedule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs py-6" style={{ color: 'rgba(238,238,248,0.55)' }}>
              <Loader size={12} className="animate-spin" /> Loading schedules…
            </div>
          ) : schedules.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: 'rgba(238,238,248,0.45)' }}>
              No scheduled reports yet. Click <strong>Schedule</strong> to set up an automatic delivery.
            </div>
          ) : (
            <div className="space-y-1.5">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="muted">{s.scope}</Badge>
                      <Badge variant="muted">{s.frequency}</Badge>
                      <span className="text-sm font-medium truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                        {s.name}
                      </span>
                    </div>
                    <div className="text-[11px] mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: 'rgba(238,238,248,0.55)' }}>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={10} /> {formatCadence(s)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Mail size={10} /> {s.recipients.length} recipient{s.recipients.length === 1 ? '' : 's'}
                      </span>
                      {s.lastSentAt && (
                        <span className="inline-flex items-center gap-1">
                          Last sent {relativeTime(s.lastSentAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => runNowMut.mutate(s.id)}
                    disabled={runNowMut.isPending}
                    title="Run this schedule immediately"
                    className="p-1.5 rounded transition-colors hover:bg-emerald-500/10 disabled:opacity-40"
                    style={{ color: '#34d399' }}
                  >
                    <Play size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEditing(s); setModalOpen(true); }}
                    title="Edit schedule"
                    className="p-1.5 rounded transition-colors hover:bg-white/[0.06]"
                    style={{ color: 'rgba(238,238,248,0.65)' }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s)}
                    disabled={deleteMut.isPending}
                    title="Delete schedule"
                    className="p-1.5 rounded transition-colors hover:bg-red-500/10 disabled:opacity-40"
                    style={{ color: '#f87171' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ReportScheduleModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); }}
        projectId={projectId}
        schedule={editing}
      />
    </>
  );
}

/** Human label for the cadence — "Mon · 09:00", "Daily · 09:00", "15th · 09:00". */
function formatCadence(s: ScheduleRow): string {
  if (s.frequency === 'DAILY') return `Daily · ${s.sendTime}`;
  if (s.frequency === 'WEEKLY' && s.dayOfWeek != null) {
    return `${DAY_NAMES[s.dayOfWeek]} · ${s.sendTime}`;
  }
  if (s.frequency === 'MONTHLY' && s.dayOfMonth != null) {
    const suffix = ordinalSuffix(s.dayOfMonth);
    return `${s.dayOfMonth}${suffix} · ${s.sendTime}`;
  }
  return s.sendTime;
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
