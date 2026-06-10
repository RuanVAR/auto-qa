import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layers, ChevronDown, Check } from 'lucide-react';
import { environmentsApi } from '@/lib/api';
import { useActiveEnv, useActiveEnvStore } from '@/stores/activeEnvStore';
import { cn } from '@/lib/utils';

type Environment = { id: string; name: string; type: string; baseUrl: string };

/**
 * Project-context environment switcher. Lives in the TopNav next to the org
 * pill. Only visible when:
 *   1. The current URL is inside a `/projects/:projectId/...` path AND
 *   2. The user has 2+ envs in that project (single-env users don't need it).
 *
 * Persists the choice per-project via useActiveEnvStore so reports / run
 * history components can read it without prop drilling. Selecting "All envs"
 * resets the filter to null.
 *
 * Note: the env list is the API's already-filtered view — non-admins only see
 * envs they're allowed to access (see EnvironmentsController.findAll), so the
 * switcher inherently respects per-env RBAC.
 */
export function EnvSwitcher({ align = 'left' }: { align?: 'left' | 'right' } = {}) {
  const location = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  // Extract /projects/:projectId from the URL. Only show inside that scope.
  const m = location.pathname.match(/^\/projects\/([^/]+)/);
  const projectId = m?.[1];

  const { data: envs = [] } = useQuery<Environment[]>({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const activeEnvId = useActiveEnv(projectId);
  const setActiveEnv = useActiveEnvStore(s => s.setActiveEnv);

  // Server-persisted preference (per user + project) — survives a fresh login
  // on any device, not just same-browser localStorage.
  const prefQuery = useQuery({
    queryKey: ['env-preference', projectId],
    queryFn: () => environmentsApi.getPreference(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
  const syncedRef = useRef<string>('');

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Resolve a CONCRETE active env (no "all"): prefer a still-valid local pick,
  // then the server pref, else default to the first env. Persist the resolved
  // value back to the server when it isn't already stored there (first-time
  // default, or a stale/cross-device value), so every device converges.
  useEffect(() => {
    if (!projectId || envs.length === 0 || !prefQuery.isSuccess) return;
    const isValid = (id?: string | null) => !!id && envs.some(e => e.id === id);
    const serverPref = prefQuery.data?.environmentId ?? null;
    const target = isValid(activeEnvId) ? activeEnvId : isValid(serverPref) ? serverPref : envs[0]?.id ?? null;
    if (!target) return;
    if (target !== activeEnvId) setActiveEnv(projectId, target);
    const syncKey = `${projectId}:${target}`;
    if (serverPref !== target && syncedRef.current !== syncKey) {
      syncedRef.current = syncKey;
      environmentsApi.setPreference(projectId, target).catch(() => { /* best-effort */ });
    }
  }, [projectId, envs, prefQuery.isSuccess, prefQuery.data, activeEnvId, setActiveEnv]);

  // Hide when not in project context, when project has fewer than 2 envs,
  // or while the env list is still loading. The single-env case keeps the
  // header uncluttered for projects that don't need the affordance.
  if (!projectId || envs.length < 2) return null;

  const active = envs.find(e => e.id === activeEnvId) ?? null;
  const handleSelect = (envId: string) => {
    setActiveEnv(projectId, envId);
    syncedRef.current = `${projectId}:${envId}`;
    environmentsApi.setPreference(projectId, envId).catch(() => { /* best-effort */ });
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          background: active ? 'rgba(56,189,248,0.22)' : 'rgba(255,255,255,0.10)',
          border: `1px solid ${active ? 'rgba(56,189,248,0.50)' : 'rgba(255,255,255,0.18)'}`,
          color: active ? '#bae6fd' : 'rgba(238,238,248,0.92)',
        }}
        title={active ? `Active env: ${active.name} (${active.baseUrl})` : 'Select an environment'}
      >
        <Layers size={12} />
        <span className="max-w-[120px] truncate">
          {active?.name ?? '…'}
        </span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          className={cn('absolute mt-2 min-w-[220px] rounded-xl py-1.5 z-50', align === 'right' ? 'right-0' : 'left-0')}
          style={{
            background: 'rgba(28,28,44,1)',
            border: '1px solid rgba(255,255,255,0.18)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.60)',
          }}
        >
          {envs.map(e => {
            const selected = e.id === activeEnvId;
            return (
              <button
                key={e.id}
                onClick={() => handleSelect(e.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs transition-colors text-left hover:bg-white/10"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate" style={{ color: 'rgba(255,255,255,0.96)' }}>{e.name}</div>
                  <div className="text-[10px] truncate" style={{ color: 'rgba(238,238,248,0.70)' }}>
                    {e.type} · {e.baseUrl}
                  </div>
                </div>
                {selected && <Check size={12} style={{ color: '#7dd3fc' }} className="ml-2" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
