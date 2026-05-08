import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plug, ExternalLink, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

/**
 * Compact "where do tickets from this scope land in ClickUp?" hint.
 *
 * Lives in two places:
 *   - Inside create/edit modals — soft callout: "Tickets here will land in
 *     <list> (inherited from project)" so users know the integration is wired
 *     when they create the entity.
 *   - On entity headers (module page, feature page) — same info as a
 *     persistent badge.
 *
 * Resolves via the cascade endpoint: feature → module → project → install.
 *
 * Three render variants:
 *   - `inline` — small text + link, for inside modals + headers
 *   - `card` — full card with action, for empty-state setup CTA
 *   - `badge` — minimal pill for tight spaces
 */
type Routing = {
  install: { id: string; pluginId: string; healthy: boolean } | null;
  listId: string | null;
  listIdSource: 'feature' | 'module' | 'project' | 'install' | null;
  targetMode: 'list' | 'subtask' | null;
  parentTaskId: string | null;
  listIdInheritedLabel: string;
};

export function ClickUpRoutingHint({
  scope,
  variant = 'inline',
}: {
  scope:
    | { kind: 'project'; projectId: string }
    | { kind: 'module'; moduleId: string }
    | { kind: 'feature'; featureId: string };
  variant?: 'inline' | 'card' | 'badge';
}) {
  const path =
    scope.kind === 'project' ? `projects/${scope.projectId}`
      : scope.kind === 'module' ? `modules/${scope.moduleId}`
        : `features/${scope.featureId}`;

  const q = useQuery({
    queryKey: ['clickup-routing', scope.kind, (scope as { projectId?: string; moduleId?: string; featureId?: string }).projectId ?? (scope as { moduleId?: string }).moduleId ?? (scope as { featureId?: string }).featureId],
    queryFn: () => api.get<Routing>(`/api/v1/${path}/clickup-routing`).then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  });

  if (q.isLoading) return null;
  const data = q.data;

  // No project binding at all — show the unwired callout (only in card variant).
  if (!data || !data.install) {
    if (variant !== 'card') return null;
    return (
      <div className="rounded-lg p-3 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <Plug className="w-4 h-4 mt-0.5 text-slate-400" />
        <div className="text-sm text-slate-300 flex-1">
          <p className="text-xs">
            ClickUp isn&apos;t configured for this project yet. Tickets created from this scope won&apos;t push anywhere
            until an org admin installs ClickUp and binds a list.
          </p>
          <Link to="/org/plugins" className="text-[11px] text-purple-300 hover:text-purple-200 inline-flex items-center gap-1 mt-1">
            Set it up <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  if (!data.install.healthy) {
    return (
      <ScopedRow variant={variant} icon={AlertTriangle} iconClass="text-amber-300">
        <span className="text-amber-200">ClickUp install needs attention</span> —
        <Link to="/org/plugins" className="ml-1 text-purple-300 hover:text-purple-200 underline">re-check</Link>
      </ScopedRow>
    );
  }

  if (!data.listId) {
    return (
      <ScopedRow variant={variant} icon={Plug} iconClass="text-slate-400">
        ClickUp installed but no list bound for {scope.kind === 'project' ? 'this project' : scope.kind === 'module' ? 'this module' : 'this feature\'s ancestors'}.
        <SetupLink scope={scope} className="ml-1" />
      </ScopedRow>
    );
  }

  return (
    <ScopedRow variant={variant} icon={Plug} iconClass="text-purple-300">
      Tickets land in ClickUp list <code className="text-[11px] px-1 py-0.5 rounded" style={{ background: 'rgba(139,92,246,0.14)', color: '#e9d5ff' }}>{data.listId}</code>
      <span className="ml-1 text-slate-500">({data.listIdInheritedLabel})</span>
      {data.targetMode === 'subtask' && data.parentTaskId && (
        <> — <span className="text-slate-400">subtask under <code className="text-[11px]">{data.parentTaskId}</code></span></>
      )}
    </ScopedRow>
  );
}

function ScopedRow({
  variant,
  icon: Icon,
  iconClass,
  children,
}: {
  variant: 'inline' | 'card' | 'badge';
  icon: typeof Plug;
  iconClass: string;
  children: React.ReactNode;
}) {
  if (variant === 'badge') {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px]"
        style={{ background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.22)', color: 'rgba(238,238,248,0.85)' }}
      >
        <Icon className={`w-3 h-3 ${iconClass}`} />
        {children}
      </span>
    );
  }
  if (variant === 'card') {
    return (
      <div className="rounded-lg p-3 flex items-start gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <Icon className={`w-4 h-4 mt-0.5 ${iconClass}`} />
        <div className="text-xs text-slate-300 flex-1 leading-relaxed">{children}</div>
      </div>
    );
  }
  return (
    <p className="text-[11px] text-slate-400 inline-flex items-center gap-1.5">
      <Icon className={`w-3 h-3 ${iconClass}`} />
      {children}
    </p>
  );
}

function SetupLink({
  scope,
  className,
}: {
  scope: { kind: 'project'; projectId: string } | { kind: 'module'; moduleId: string } | { kind: 'feature'; featureId: string };
  className?: string;
}) {
  // Always link to /org/plugins for now — the most useful "set up" target
  // regardless of scope. Per-scope edit lives on the relevant page tab.
  return (
    <Link to="/org/plugins" className={`text-purple-300 hover:text-purple-200 underline ${className ?? ''}`}>
      Configure
    </Link>
  );
}
