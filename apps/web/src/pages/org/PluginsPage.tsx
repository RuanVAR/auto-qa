import { useQuery } from '@tanstack/react-query';
import { Plug, ShieldCheck, AlertTriangle } from 'lucide-react';
import { pluginsApi, type PluginCatalogEntry, type PluginInstall } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';

/**
 * Plugin registry landing page.
 *
 * Phase 1: catalogue + installed list. Install / configure / health-check
 * actions land in Phase 2 alongside the per-plugin binding form (each plugin
 * supplies its own config UI via PluginConfigForm + manifest fieldHints).
 */
export default function PluginsPage() {
  const org = useActiveOrg();
  const orgId = org?.orgId ?? null;

  const catalogQ = useQuery({
    queryKey: ['plugins', 'catalog'],
    queryFn: () => pluginsApi.catalog(),
  });

  const installsQ = useQuery({
    queryKey: ['plugins', 'installs', orgId],
    queryFn: () => pluginsApi.listInstalls(orgId!),
    enabled: !!orgId,
  });

  if (catalogQ.isLoading || installsQ.isLoading) return <PageSpinner />;

  const catalog = catalogQ.data ?? [];
  const installs = installsQ.data ?? [];
  const installedByPluginId = new Map(installs.map((i) => [i.pluginId, i] as const));

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Plugins</h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect ClickUp, Jira, Slack and other tools so the platform can push tickets,
            sync phase status, attach artefacts and listen for inbound updates.
          </p>
        </div>
      </div>

      {catalog.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No plugins available yet"
          description="The plugin registry is wired up but no plugins have been registered. ClickUp ships next."
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalog.map((entry) => (
            <PluginCatalogCard
              key={entry.id}
              entry={entry}
              install={installedByPluginId.get(entry.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PluginCatalogCard({
  entry,
  install,
}: {
  entry: PluginCatalogEntry;
  install: PluginInstall | null;
}) {
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-purple-300" />
              <h3 className="text-sm font-semibold text-white">{entry.name}</h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">{entry.description}</p>
          </div>
          <InstallStatusPill install={install} />
        </div>

        <div className="flex flex-wrap gap-1">
          {entry.capabilities.map((cap) => (
            <Badge key={cap} variant="muted" className="text-[10px]">
              {cap}
            </Badge>
          ))}
        </div>

        <div className="text-[11px] text-slate-500">
          v{entry.version}
          {install && (
            <>
              {' · installed '}
              {install.displayLabel ? `as "${install.displayLabel}"` : ''}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function InstallStatusPill({ install }: { install: PluginInstall | null }) {
  if (!install) {
    return (
      <Badge variant="muted" className="text-[10px]">
        Not installed
      </Badge>
    );
  }
  if (!install.isEnabled) {
    return (
      <Badge variant="muted" className="text-[10px]">
        Disabled
      </Badge>
    );
  }
  if (install.lastHealthOk) {
    return (
      <Badge className="text-[10px] bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
        <ShieldCheck className="w-3 h-3 mr-1" />
        Healthy
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] bg-amber-500/10 border-amber-500/30 text-amber-300">
      <AlertTriangle className="w-3 h-3 mr-1" />
      Needs attention
    </Badge>
  );
}
