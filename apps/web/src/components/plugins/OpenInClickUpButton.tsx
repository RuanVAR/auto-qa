import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';

type Routing = {
  install: { id: string; pluginId: string; healthy: boolean } | null;
  listId: string | null;
  parentTaskId: string | null;
  workspaceId: string | null;
};

type Scope =
  | { kind: 'project'; projectId: string }
  | { kind: 'module'; moduleId: string }
  | { kind: 'feature'; featureId: string };

/**
 * Renders a small "Open in ClickUp" button for any scope that has a healthy
 * ClickUp binding. Returns null otherwise — the button is a passive surface,
 * never an empty state.
 *
 * URL strategy:
 *   - feature with parentTaskId → opens that task    (https://app.clickup.com/t/{taskId})
 *   - module / project / unlinked feature with workspaceId+listId → opens the list
 */
export function OpenInClickUpButton({ scope }: { scope: Scope }) {
  const path =
    scope.kind === 'project' ? `projects/${scope.projectId}`
      : scope.kind === 'module' ? `modules/${scope.moduleId}`
        : `features/${scope.featureId}`;

  const scopeKey =
    scope.kind === 'project' ? scope.projectId
      : scope.kind === 'module' ? scope.moduleId
        : scope.featureId;

  const q = useQuery({
    queryKey: ['clickup-routing', scope.kind, scopeKey],
    queryFn: () => api.get<Routing>(`/api/v1/${path}/clickup-routing`).then((r) => r.data),
    staleTime: 30_000,
    retry: false,
  });

  const data = q.data;
  if (!data || !data.install?.healthy) return null;

  // Prefer a direct task link when a parent task is bound; otherwise the list.
  let href: string | null = null;
  let label = 'Open in ClickUp';

  if (scope.kind === 'feature' && data.parentTaskId) {
    href = `https://app.clickup.com/t/${data.parentTaskId}`;
    label = 'Open task';
  } else if (data.workspaceId && data.listId) {
    href = `https://app.clickup.com/${data.workspaceId}/v/li/${data.listId}`;
    label = 'Open list';
  }

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${label} in ClickUp`}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
      style={{
        background: 'rgba(139,92,246,0.10)',
        border: '1px solid rgba(139,92,246,0.28)',
        color: '#c4b5fd',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139,92,246,0.20)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(139,92,246,0.10)')}
    >
      <ExternalLink size={11} />
      {label}
    </a>
  );
}
