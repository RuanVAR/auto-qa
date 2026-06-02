import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plug, ChevronDown } from 'lucide-react';
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
 * Gating: ALL variants render nothing unless the org has a ClickUp install
 * that is installed AND healthy. We never advertise an absent or broken
 * integration on a module / feature surface — the install + re-check CTA
 * lives on Org → Plugins. (Forward note: this is a "PM-type" integration;
 * when Jira lands, the same gate applies per-provider.)
 *
 * Three render variants:
 *   - `inline` — small text + link, for inside modals + headers
 *   - `card` — full card
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
  collapsible = false,
}: {
  scope:
    | { kind: 'project'; projectId: string }
    | { kind: 'module'; moduleId: string }
    | { kind: 'feature'; featureId: string };
  variant?: 'inline' | 'card' | 'badge';
  /** Badge variant only — render a compact "ClickUp" chip that expands to
   *  the full routing detail on click. Keeps tight headers uncluttered. */
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

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

  // Gate: render nothing unless the org has a ClickUp install that is both
  // present AND healthy. No install, or an unhealthy one → every variant
  // stays silent. We never surface ClickUp UI on a module / feature page
  // for an org that hasn't got a working integration; the fix / setup CTA
  // lives on Org → Plugins.
  if (!data || !data.install || !data.install.healthy) return null;

  const content = !data.listId ? (
    <>
      ClickUp installed but no list bound for {scope.kind === 'project' ? 'this project' : scope.kind === 'module' ? 'this module' : 'this feature\'s ancestors'}.
      <SetupLink scope={scope} className="ml-1" />
    </>
  ) : (
    <>
      Tickets land in ClickUp list <code className="text-[11px] px-1 py-0.5 rounded" style={{ background: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent-200)' }}>{data.listId}</code>
      <span className="ml-1 text-slate-500">({data.listIdInheritedLabel})</span>
      {data.targetMode === 'subtask' && data.parentTaskId && (
        <> — <span className="text-slate-400">subtask under <code className="text-[11px]">{data.parentTaskId}</code></span></>
      )}
    </>
  );
  const iconClass = data.listId ? 'text-purple-300' : 'text-slate-400';

  // Collapsible badge — a compact "ClickUp" chip that toggles the full
  // routing detail inline. Stops the badge from crowding tight headers.
  if (variant === 'badge' && collapsible) {
    const pillStyle = {
      background: 'rgba(var(--accent-rgb),0.10)',
      border: '1px solid rgba(var(--accent-rgb),0.22)',
      color: 'rgba(238,238,248,0.85)',
    } as const;
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] transition-colors"
          style={pillStyle}
          title={expanded ? 'Hide ClickUp routing' : 'Show where tickets from here land in ClickUp'}
        >
          <Plug className={`w-3 h-3 ${iconClass}`} />
          ClickUp
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {expanded && (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px]" style={pillStyle}>
            {content}
          </span>
        )}
      </span>
    );
  }

  return (
    <ScopedRow variant={variant} icon={Plug} iconClass={iconClass}>
      {content}
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
        style={{ background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.22)', color: 'rgba(238,238,248,0.85)' }}
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
