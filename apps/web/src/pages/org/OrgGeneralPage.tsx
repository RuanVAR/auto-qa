import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Copy } from 'lucide-react';
import { useActiveOrg, useAuthStore, useIsOrgAdmin } from '@/stores/authStore';
import { orgsApi, authApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  website?: string | null;
  description?: string | null;
  allowedSsoDomains?: string[];
  autoJoinEnabled?: boolean;
}

/**
 * Org admin → General. Edit the organisation's human details: display name,
 * website, and description. Logo lives on the Branding page; slug is shown
 * read-only because it's baked into URLs (branded login link, bookmarks).
 *
 * Saves via PATCH /orgs/:orgId { name, website, description } (ORG_ADMIN).
 * Members who aren't admins see the values read-only.
 */
export default function OrgGeneralPage() {
  const org = useActiveOrg();
  const isAdmin = useIsOrgAdmin();
  const setUser = useAuthStore((s) => s.setUser);
  const orgId = org?.orgId;

  const { data, isLoading } = useQuery<OrgDetail>({
    queryKey: ['org-detail', orgId],
    queryFn: () => orgsApi.getOrg(orgId!),
    enabled: !!orgId,
  });

  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // Access (domain auto-join) — separate save from the details above.
  const [domainsInput, setDomainsInput] = useState('');
  const [autoJoin, setAutoJoin] = useState(false);
  const [accessBusy, setAccessBusy] = useState(false);

  // Seed the form once the org loads.
  useEffect(() => {
    if (!data) return;
    setName(data.name ?? '');
    setWebsite(data.website ?? '');
    setDescription(data.description ?? '');
    setDomainsInput((data.allowedSsoDomains ?? []).join(', '));
    setAutoJoin(!!data.autoJoinEnabled);
  }, [data]);

  if (!org) {
    return <p className="text-sm text-slate-400">No active organisation selected.</p>;
  }

  const slug = data?.slug ?? org.org.slug;
  const dirty =
    !!data &&
    (name.trim() !== (data.name ?? '') ||
      website.trim() !== (data.website ?? '') ||
      description.trim() !== (data.description ?? ''));
  const canSave = isAdmin && dirty && name.trim().length > 0 && !busy;

  const save = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      await orgsApi.update(orgId, {
        name: name.trim(),
        website: website.trim(),
        description: description.trim(),
      });
      // Refresh the user so the new name shows in the nav / branding immediately.
      try { const me = await authApi.me(); setUser(me); } catch { /* non-fatal */ }
      toast.success('Saved', 'Organisation details updated.');
    } catch {
      toast.error('Save failed', 'Could not update organisation details. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (!data) return;
    setName(data.name ?? '');
    setWebsite(data.website ?? '');
    setDescription(data.description ?? '');
  };

  const parsedDomains = domainsInput.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  const accessDirty =
    !!data &&
    (autoJoin !== !!data.autoJoinEnabled ||
      parsedDomains.join(',') !== (data.allowedSsoDomains ?? []).join(','));

  const saveAccess = async () => {
    if (!orgId) return;
    setAccessBusy(true);
    try {
      await orgsApi.update(orgId, { allowedSsoDomains: parsedDomains, autoJoinEnabled: autoJoin });
      toast.success('Saved', 'Access settings updated.');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Save failed', typeof msg === 'string' ? msg : 'Could not update access settings.');
    } finally {
      setAccessBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-lg px-3 py-2 text-sm bg-white/5 border border-white/10 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-purple-500 disabled:opacity-60';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link to="/org" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="w-3.5 h-3.5" /> Organisation
        </Link>
        <div className="flex items-center gap-2 mt-3">
          <Building2 className="w-5 h-5 text-purple-300" />
          <h1 className="text-2xl font-semibold text-white">General</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Your organisation's name, website, and description. These appear across the app and on
          reports. The logo is on the{' '}
          <Link to="/org/branding" className="text-purple-300 hover:underline">Branding</Link> page.
        </p>
      </div>

      {!isAdmin && (
        <Card>
          <CardContent className="p-4 text-sm text-amber-300/90">
            Only organisation admins can edit these details. You can view them below.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Organisation name
            </label>
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              disabled={!isAdmin || isLoading}
              maxLength={120}
            />
          </div>

          {/* Website */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Website <span className="text-slate-600 normal-case">(optional)</span>
            </label>
            <input
              className={inputCls}
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://acme.com"
              disabled={!isAdmin || isLoading}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Description <span className="text-slate-600 normal-case">(optional)</span>
            </label>
            <textarea
              className={`${inputCls} resize-y min-h-[88px]`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short description of your organisation."
              disabled={!isAdmin || isLoading}
              maxLength={500}
            />
          </div>

          {/* Slug — read-only (it's in URLs / the branded login link) */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Slug
            </label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs text-slate-300 bg-black/30 rounded-lg px-3 py-2 truncate">{slug}</code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => { navigator.clipboard.writeText(slug); toast.success('Copied'); }}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
            <p className="text-xs text-slate-500 mt-1.5">
              Used in your branded login link and bookmarks — contact support if you need it changed.
            </p>
          </div>

          {isAdmin && (
            <div className="flex justify-end gap-2 border-t border-white/5 pt-4">
              <Button size="sm" variant="ghost" onClick={reset} disabled={!dirty || busy}>Reset</Button>
              <Button size="sm" onClick={save} loading={busy} disabled={!canSave}>Save changes</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Access: domain auto-join ── */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-white">Access</h2>
            <p className="text-xs text-slate-400 mt-1">
              Let people with a matching work email request to join this organisation. Requests are{' '}
              <strong>pending</strong> until an admin approves them and assigns a role.
            </p>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Allowed email domains
            </label>
            <input
              className={inputCls}
              value={domainsInput}
              onChange={(e) => setDomainsInput(e.target.value)}
              placeholder="acme.com, contractors.acme.com"
              disabled={!isAdmin || isLoading}
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Comma- or space-separated. Anyone registering with one of these domains can request to join.
            </p>
          </div>

          <button
            type="button"
            onClick={() => isAdmin && setAutoJoin((v) => !v)}
            disabled={!isAdmin}
            className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left"
            style={{ background: autoJoin ? 'rgba(var(--accent-rgb),0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${autoJoin ? 'rgba(var(--accent-rgb),0.30)' : 'rgba(255,255,255,0.08)'}` }}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-100">Auto-join</span>
              <span className="block text-[11px] text-slate-400">Show matching users a "request to join" option at registration.</span>
            </span>
            <span className="relative w-9 h-5 rounded-full transition-colors shrink-0" style={{ background: autoJoin ? 'var(--accent)' : 'rgba(255,255,255,0.12)' }}>
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: autoJoin ? 'translateX(18px)' : 'translateX(2px)' }} />
            </span>
          </button>

          {autoJoin && parsedDomains.length === 0 && (
            <p className="text-[11px] text-amber-300/90">Add at least one domain for auto-join to do anything.</p>
          )}

          {isAdmin && (
            <div className="flex justify-end border-t border-white/5 pt-4">
              <Button size="sm" onClick={saveAccess} loading={accessBusy} disabled={!accessDirty || accessBusy}>Save access settings</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
