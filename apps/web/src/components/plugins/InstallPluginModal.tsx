import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plug, KeyRound } from 'lucide-react';
import { pluginsApi, type PluginCatalogEntry } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';
import { GoogleDriveConnect } from './GoogleDriveConnect';

/**
 * One-shot install dialog for any plugin in the catalog.
 *
 * Phase 2 keeps this minimal — it captures the secrets (everything in the
 * manifest's secretsSchema) plus a display label, then runs an initial
 * healthCheck via PluginService. Workspace / space / folder / list selection
 * happens later when the user binds the install to a project.
 *
 * For the MVP we only ask for `apiToken` because that's what every supported
 * plugin (ClickUp, Jira, Slack) uses today. When a plugin appears with a
 * different secret shape (OAuth refresh token, signed JWT, …) this modal
 * grows a manifest-driven auto-renderer that walks fieldHints with kind=secret.
 */
export function InstallPluginModal({
  open,
  onClose,
  entry,
  orgId,
}: {
  open: boolean;
  onClose: () => void;
  entry: PluginCatalogEntry;
  orgId: string;
}) {
  const qc = useQueryClient();
  const [apiToken, setApiToken] = useState('');
  const [displayLabel, setDisplayLabel] = useState('');

  const install = useMutation({
    mutationFn: () =>
      pluginsApi.install(orgId, {
        pluginId: entry.id,
        displayLabel: displayLabel || undefined,
        config: {},
        secrets: { apiToken: apiToken.trim() },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins', 'installs', orgId] });
      toast.success(`${entry.name} installed`);
      handleClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' ? msg : 'Install failed');
    },
  });

  const handleClose = () => {
    setApiToken('');
    setDisplayLabel('');
    onClose();
  };

  const submit = () => {
    if (!apiToken.trim()) {
      toast.error('API token is required');
      return;
    }
    install.mutate();
  };

  // OAuth2 plugins (Google Drive) connect via a redirect rather than a pasted
  // secret. Branch the whole modal body — the rest of this component is the
  // pasted-API-token path used by ClickUp/Jira/Slack.
  if (entry.id === 'gdrive') {
    return (
      <Modal open={open} onClose={handleClose} title={`Connect ${entry.name}`}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg p-3" style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.16)' }}>
            <Plug className="w-5 h-5 mt-0.5 text-purple-300" />
            <div className="text-sm text-slate-200">
              <p className="font-medium">{entry.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{entry.description}</p>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Display label (optional)</span>
            <input
              value={displayLabel}
              onChange={(e) => setDisplayLabel(e.target.value)}
              placeholder={`e.g. "${entry.name} — primary"`}
              className="mt-1 block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </label>

          <p className="text-xs text-slate-400">
            You&apos;ll be sent to Google to authorise read-only Drive access for this
            organisation. After connecting, everything the account can see is browsable;
            you can narrow it to specific folders from the plugin&apos;s settings.
          </p>

          <GoogleDriveConnect orgId={orgId} displayLabel={displayLabel} />

          <div className="flex justify-end">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={`Install ${entry.name}`}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg p-3" style={{ background: 'rgba(var(--accent-rgb),0.06)', border: '1px solid rgba(var(--accent-rgb),0.16)' }}>
          <Plug className="w-5 h-5 mt-0.5 text-purple-300" />
          <div className="text-sm text-slate-200">
            <p className="font-medium">{entry.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{entry.description}</p>
          </div>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide">Display label (optional)</span>
          <input
            value={displayLabel}
            onChange={(e) => setDisplayLabel(e.target.value)}
            placeholder={`e.g. "${entry.name} — primary"`}
            className="mt-1 block w-full bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">Useful when the same plugin is installed twice (e.g. dev + prod workspaces).</p>
        </label>

        <label className="block">
          <span className="text-xs font-medium text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
            <KeyRound className="w-3 h-3" /> API token
          </span>
          <input
            type="password"
            autoComplete="off"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="pk_…"
            className="mt-1 block w-full font-mono bg-slate-900/60 border border-slate-700 rounded-md px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
          <p className="text-[11px] text-slate-500 mt-1">
            Stored encrypted. We&apos;ll run a healthcheck immediately to confirm it works.
          </p>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleClose} disabled={install.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={install.isPending}>
            Install + verify
          </Button>
        </div>
      </div>
    </Modal>
  );
}
