import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, ArrowLeft, Square, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { activeSessionsApi, type ActiveSession } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';

/**
 * Org-admin view of every open manual test session. Manual sessions are
 * FeatureRuns left in RUNNING/PAUSED — usually because a tester closed the
 * tab without stopping. They auto-expire after an hour of no heartbeat, but
 * this page lets an admin see them live and force-end stuck ones now.
 */
export default function OrgActiveSessionsPage() {
  const orgId = useAuthStore((s) => s.activeOrgId);
  const qc = useQueryClient();
  const [confirmAll, setConfirmAll] = useState(false);

  const sessionsQ = useQuery({
    queryKey: ['active-sessions', orgId],
    queryFn: () => activeSessionsApi.list(orgId!),
    enabled: !!orgId,
    refetchInterval: 10_000, // keep the list fresh — sessions start/end often
  });

  const endOne = useMutation({
    mutationFn: (id: string) => activeSessionsApi.end(orgId!, id),
    onSuccess: () => {
      toast.success('Session ended');
      qc.invalidateQueries({ queryKey: ['active-sessions', orgId] });
    },
    onError: () => toast.error('Could not end session'),
  });

  const endAll = useMutation({
    mutationFn: () => activeSessionsApi.endAll(orgId!),
    onSuccess: (r) => {
      toast.success(`Ended ${r.ended} session${r.ended === 1 ? '' : 's'}`);
      setConfirmAll(false);
      qc.invalidateQueries({ queryKey: ['active-sessions', orgId] });
    },
    onError: () => toast.error('Could not end sessions'),
  });

  const sessions = sessionsQ.data ?? [];

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
  const staleMins = (iso: string | null) =>
    iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link to="/org" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 mb-2">
            <ArrowLeft size={12} /> Organisation
          </Link>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-purple-300" />
            <h1 className="text-2xl font-semibold text-white">Active sessions</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Open manual test sessions across the org. Force-end any that are stuck.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => sessionsQ.refetch()}>
            <RefreshCw size={13} className="mr-1" /> Refresh
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={sessions.length === 0 || endAll.isPending}
            onClick={() => setConfirmAll(true)}
          >
            <Square size={13} className="mr-1" /> End all
          </Button>
        </div>
      </div>

      {/* List */}
      <Card>
        <CardContent className="p-0">
          {sessionsQ.isLoading ? (
            <div className="p-8 text-center text-sm text-slate-400">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="p-10 text-center">
              <Activity className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p className="text-sm text-slate-400">No active manual sessions.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              {sessions.map((s: ActiveSession) => {
                const idle = staleMins(s.lastHeartbeatAt ?? s.startedAt ?? s.createdAt);
                const isStale = idle != null && idle >= 15;
                return (
                  <div key={s.id} className="flex items-center gap-4 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white truncate">{s.featureName}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{
                            background: s.status === 'PAUSED' ? 'rgba(251,191,36,0.15)' : 'rgba(16,185,129,0.15)',
                            color: s.status === 'PAUSED' ? '#fbbf24' : '#10b981',
                          }}
                        >
                          {s.status}
                        </span>
                        {isStale && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-400">
                            <AlertTriangle size={10} /> idle {idle}m
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {s.moduleName} · {s.user?.name ?? s.user?.email ?? 'Unknown user'} ·
                        {' '}started {fmt(s.startedAt ?? s.createdAt)}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={endOne.isPending}
                      onClick={() => endOne.mutate(s.id)}
                    >
                      Force end
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* End-all confirm */}
      {confirmAll && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.72)' }} onClick={() => setConfirmAll(false)} />
          <div
            className="relative w-full max-w-sm rounded-2xl p-5"
            style={{ background: 'rgba(18,18,32,0.98)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <h2 className="text-sm font-semibold text-white mb-2">End all active sessions?</h2>
            <p className="text-xs text-slate-400 mb-4">
              This force-ends all {sessions.length} open manual session{sessions.length === 1 ? '' : 's'} in the org.
              Any tester mid-session will lose their unsaved progress. This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmAll(false)}>Cancel</Button>
              <Button variant="danger" loading={endAll.isPending} onClick={() => endAll.mutate()}>
                End all {sessions.length}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
