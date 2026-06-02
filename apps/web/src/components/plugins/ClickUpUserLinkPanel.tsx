import { useMemo, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink, Users, Loader, Check } from 'lucide-react';
import { clickupLinksApi, type ClickUpMemberRow } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * Org-admin panel to map ClickUp workspace members → QA users, so assigning an
 * issue here also assigns the linked ClickUp task. Only renders when the org
 * has a healthy ClickUp install. Pre-fills links by email auto-match.
 */
export function ClickUpUserLinkPanel({ orgId }: { orgId: string }) {
  const qc = useQueryClient();

  const { data: health } = useQuery({
    queryKey: ['clickup-links', 'health', orgId],
    queryFn: () => clickupLinksApi.health(orgId),
    enabled: !!orgId,
    staleTime: 30_000,
  });

  const healthy = !!health?.healthy;

  const { data, isLoading } = useQuery({
    queryKey: ['clickup-links', 'members', orgId],
    queryFn: () => clickupLinksApi.members(orgId),
    enabled: !!orgId && healthy,
  });

  // Local per-row selection (qaUserId) — seeded from existing link or email suggestion.
  const [sel, setSel] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!data) return;
    const next: Record<number, string> = {};
    for (const m of data.members) next[m.clickupUserId] = m.linkedQaUserId ?? m.suggestedQaUserId ?? '';
    setSel(next);
  }, [data]);

  const linkMut = useMutation({
    mutationFn: (m: { clickupUserId: number; qaUserId: string; username: string; email: string | null }) =>
      clickupLinksApi.link(orgId, {
        qaUserId: m.qaUserId,
        clickupUserId: m.clickupUserId,
        clickupUsername: m.username,
        clickupEmail: m.email ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clickup-links', 'members', orgId] });
      toast.success('Link saved');
    },
    onError: (e) => toast.error('Could not save link', (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Try again.'),
  });

  const unlinkMut = useMutation({
    mutationFn: (qaUserId: string) => clickupLinksApi.unlink(orgId, qaUserId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clickup-links', 'members', orgId] });
      toast.success('Link removed');
    },
  });

  const unmatchedCount = useMemo(
    () => (data?.members ?? []).filter((m) => !m.linkedQaUserId && (m.suggestedQaUserId || sel[m.clickupUserId])).length,
    [data, sel],
  );

  if (!orgId || (health && !health.installed)) return null;
  if (health && health.installed && !health.healthy) {
    return (
      <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-2 mb-1"><Users size={15} style={{ color: 'var(--accent-400)' }} /><h3 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>ClickUp user links</h3></div>
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.5)' }}>ClickUp is disabled or unhealthy — reconnect it to manage user links.</p>
      </div>
    );
  }
  if (!healthy) return null;

  const saveRow = (m: ClickUpMemberRow) => {
    const qaUserId = sel[m.clickupUserId];
    if (!qaUserId) return;
    linkMut.mutate({ clickupUserId: m.clickupUserId, qaUserId, username: m.username, email: m.email });
  };

  const saveAllMatched = () => {
    for (const m of data?.members ?? []) {
      const qaUserId = sel[m.clickupUserId];
      if (qaUserId && qaUserId !== m.linkedQaUserId) {
        linkMut.mutate({ clickupUserId: m.clickupUserId, qaUserId, username: m.username, email: m.email });
      }
    }
  };

  return (
    <div className="rounded-2xl p-5 space-y-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users size={15} style={{ color: 'var(--accent-400)' }} />
          <h3 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>ClickUp user links</h3>
        </div>
        {unmatchedCount > 0 && (
          <button
            type="button"
            onClick={saveAllMatched}
            disabled={linkMut.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.45)', color: 'var(--accent-300)' }}
          >
            {linkMut.isPending ? <Loader size={12} className="animate-spin" /> : <Check size={12} />}
            Save {unmatchedCount} matched
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
        Map each ClickUp member to a QA user. When a QA user is assigned to an issue that pushes to ClickUp, the ClickUp task is assigned to their linked account. Unlinked users can still be assigned in QA — the ClickUp task is just left unassigned.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs py-3" style={{ color: 'rgba(238,238,248,0.5)' }}>
          <Loader size={13} className="animate-spin" /> Loading workspace members…
        </div>
      ) : (data?.members.length ?? 0) === 0 ? (
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.4)' }}>No ClickUp members found in this workspace.</p>
      ) : (
        <div className="space-y-1.5">
          {data!.members.map((m) => {
            const linked = !!m.linkedQaUserId;
            const isSuggestion = !linked && !!m.suggestedQaUserId && sel[m.clickupUserId] === m.suggestedQaUserId;
            return (
              <div key={m.clickupUserId} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.color ?? '#7c3aed' }} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium truncate" style={{ color: 'rgba(238,238,248,0.9)' }}>{m.username}</div>
                    {m.email && <div className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.45)' }}>{m.email}</div>}
                  </div>
                </div>
                <span className="text-[11px]" style={{ color: 'rgba(238,238,248,0.35)' }}>→</span>
                <select
                  value={sel[m.clickupUserId] ?? ''}
                  onChange={(e) => setSel((s) => ({ ...s, [m.clickupUserId]: e.target.value }))}
                  className="text-xs rounded-lg px-2 py-1.5 min-w-[180px]"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
                >
                  <option value="">— not linked —</option>
                  {data!.qaUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}{u.email ? ` (${u.email})` : ''}</option>
                  ))}
                </select>
                {isSuggestion && <span className="text-[10px] shrink-0" style={{ color: '#34d399' }}>email match</span>}
                {linked ? (
                  <button type="button" onClick={() => unlinkMut.mutate(m.linkedQaUserId!)} title="Unlink"
                    className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)' }}>
                    <Unlink size={12} />
                  </button>
                ) : (
                  <button type="button" onClick={() => saveRow(m)} disabled={!sel[m.clickupUserId] || linkMut.isPending} title="Link"
                    className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0 disabled:opacity-40" style={{ color: 'var(--accent-300)', background: 'rgba(var(--accent-rgb),0.15)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}>
                    <Link2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
