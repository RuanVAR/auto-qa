import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug, ShieldCheck, AlertTriangle, RefreshCw, Trash2, ChevronLeft } from 'lucide-react';
import { pluginsApi, type PluginCatalogEntry, type PluginInstall } from '@/lib/api';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { toast } from '@/components/ui/Toast';
import { InstallPluginModal } from '@/components/plugins/InstallPluginModal';

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
  const [installModal, setInstallModal] = useState<PluginCatalogEntry | null>(null);

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
      <Link to="/org" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Organisation
      </Link>
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
              orgId={orgId}
              onInstallClick={() => setInstallModal(entry)}
            />
          ))}
        </div>
      )}

      {installModal && orgId && (
        <InstallPluginModal
          open={!!installModal}
          onClose={() => setInstallModal(null)}
          entry={installModal}
          orgId={orgId}
        />
      )}
    </div>
  );
}

function PluginCatalogCard({
  entry,
  install,
  orgId,
  onInstallClick,
}: {
  entry: PluginCatalogEntry;
  install: PluginInstall | null;
  orgId: string | null;
  onInstallClick: () => void;
}) {
  const qc = useQueryClient();

  const recheck = useMutation({
    mutationFn: () => pluginsApi.healthCheck(orgId!, install!.id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['plugins', 'installs', orgId] });
      toast.success(r.ok ? `Healthy${r.connectedAs ? ` — ${r.connectedAs}` : ''}` : `Health failed: ${r.error ?? 'unknown'}`);
    },
    onError: () => toast.error('Healthcheck request failed'),
  });

  const uninstall = useMutation({
    mutationFn: () => pluginsApi.uninstall(orgId!, install!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins', 'installs', orgId] });
      toast.success(`${entry.name} uninstalled`);
    },
    onError: () => toast.error('Uninstall failed'),
  });

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
              {install.lastHealthAt && ` · checked ${new Date(install.lastHealthAt).toLocaleString()}`}
            </>
          )}
          {install?.lastHealthError && (
            <p className="text-[11px] text-amber-300 mt-1">{install.lastHealthError}</p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          {!install && (
            <Button size="sm" onClick={onInstallClick}>
              Install
            </Button>
          )}
          {install && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => recheck.mutate()}
                loading={recheck.isPending}
              >
                <RefreshCw className="w-3 h-3 mr-1" />
                Re-check
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (window.confirm(`Uninstall ${entry.name}? Secrets will be zeroed and project bindings will stop.`)) {
                    uninstall.mutate();
                  }
                }}
                loading={uninstall.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Uninstall
              </Button>
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
