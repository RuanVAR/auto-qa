import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plug, ExternalLink } from 'lucide-react';
import { pluginsApi } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { PluginBindingClickUp } from './PluginBindingClickUp';

/**
 * Project-scoped plugin section.
 *
 * Renders one card per installed-and-healthy org plugin, then drops in the
 * plugin-specific binding form. Today only ClickUp ships, so this is the only
 * branch — but the dispatch table sits ready for Jira / Slack manifests.
 *
 * Plugins that are installed but unhealthy or disabled get a muted card with
 * a deep-link to /org/plugins so the org admin can fix the install.
 */
export function ProjectPluginsPanel({ projectId }: { projectId: string }) {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
  });

  if (!orgId) return null;
  if (installsQ.isLoading) return <PageSpinner />;

  const installs = installsQ.data ?? [];
  const usable = installs.filter((i) => i.isEnabled && !i.lastHealthError);

  if (installs.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="No plugins installed for this org yet"
        description="Install a plugin at the org level first, then come back here to bind it to this project."
        action={
          <Link to="/org/plugins" className="text-sm text-purple-300 hover:text-purple-200 inline-flex items-center gap-1">
            Open plugins page <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white">Integrations for this project</h3>
        <p className="text-xs text-slate-400 mt-1">
          Bind installed plugins to this project. Each binding controls where tickets land,
          how phases sync, and which capabilities the project can use.
        </p>
      </div>

      {usable.length === 0 && (
        <EmptyState
          icon={Plug}
          title="Plugins installed but not healthy"
          description="Visit the org plugins page to re-check health or fix credentials."
          action={
            <Link to="/org/plugins" className="text-sm text-purple-300 hover:text-purple-200 inline-flex items-center gap-1">
              Org plugins <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          }
        />
      )}

      {usable.map((install) => (
        <Card key={install.id}>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Plug className="w-4 h-4 text-purple-300" />
                  <h4 className="text-sm font-semibold text-white">
                    {install.pluginId === 'clickup' ? 'ClickUp' : install.pluginId}
                    {install.displayLabel ? ` — ${install.displayLabel}` : ''}
                  </h4>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">v{install.pluginVersion}</p>
              </div>
              <Badge className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                Healthy
              </Badge>
            </div>

            {install.pluginId === 'clickup' ? (
              <PluginBindingClickUp projectId={projectId} install={install} />
            ) : (
              <p className="text-xs text-slate-400">
                Binding UI for {install.pluginId} will appear here when its plugin module ships.
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
