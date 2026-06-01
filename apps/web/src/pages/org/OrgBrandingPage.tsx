import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Image as ImageIcon, Upload, Trash2, Copy, Building2 } from 'lucide-react';
import { useActiveOrg, useAuthStore, useIsOrgAdmin } from '@/stores/authStore';
import { uploadsApi, orgsApi, authApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toast';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — icons should be small
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
const SHIELD = '/brand/shield-256.png';

/**
 * Org admin → Branding. Upload a logo/icon for the organisation. Once set,
 * members of this org see it in place of the QA Platform mark (top nav,
 * browser tab, report PDFs, emails) and on their branded login link.
 *
 * Upload reuses the shared uploads pipeline (stored via the StorageProvider,
 * i.e. Azure in prod); the returned public URL is saved on the org via
 * PATCH /orgs/:orgId { logoUrl }.
 */
export default function OrgBrandingPage() {
  const org = useActiveOrg();
  const isAdmin = useIsOrgAdmin();
  const setUser = useAuthStore((s) => s.setUser);
  const fileRef = useRef<HTMLInputElement>(null);

  const [pending, setPending] = useState<{ file: File; objectUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!org) {
    return <p className="text-sm text-slate-400">No active organisation selected.</p>;
  }
  const orgId = org.orgId;
  const currentLogo = org.org.logoUrl ?? null;
  const slug = org.org.slug;
  const brandedLoginUrl = `${window.location.origin}/login?org=${encodeURIComponent(slug)}`;

  const refreshAuth = async () => {
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      /* non-fatal — a manual refresh will pick it up */
    }
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Unsupported file', 'Please choose an image (PNG, JPG, WebP or SVG).');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('File too large', 'Logo must be 2 MB or smaller.');
      return;
    }
    setPending({ file, objectUrl: URL.createObjectURL(file) });
  };

  const saveLogo = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const uploaded = await uploadsApi.upload(pending.file);
      await orgsApi.update(orgId, { logoUrl: uploaded.url });
      URL.revokeObjectURL(pending.objectUrl);
      setPending(null);
      await refreshAuth();
      toast.success('Logo updated', 'Your organisation branding is now live.');
    } catch {
      toast.error('Save failed', 'Could not save the logo. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const removeLogo = async () => {
    setBusy(true);
    try {
      await orgsApi.update(orgId, { logoUrl: null });
      await refreshAuth();
      toast.success('Logo removed', 'Reverted to the default QA Platform branding.');
    } catch {
      toast.error('Remove failed', 'Could not remove the logo. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (pending) URL.revokeObjectURL(pending.objectUrl);
    setPending(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <Link to="/org" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="w-3.5 h-3.5" /> Organisation
        </Link>
        <div className="flex items-center gap-2 mt-3">
          <ImageIcon className="w-5 h-5 text-purple-300" />
          <h1 className="text-2xl font-semibold text-white">Branding</h1>
        </div>
        <p className="text-sm text-slate-400 mt-1">
          Upload your organisation's logo. Members of{' '}
          <strong className="text-slate-200">{org.org.name}</strong> will see it instead of the
          QA Platform mark — in the app, on report PDFs, in emails, and on your branded login link.
        </p>
      </div>

      {!isAdmin && (
        <Card>
          <CardContent className="p-4 text-sm text-amber-300/90">
            Only organisation admins can change branding. You can view the current logo below.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-5 space-y-5">
          {/* Current logo */}
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">Current logo</p>
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden border border-white/10"
                style={{ background: 'rgba(255,255,255,0.04)' }}
              >
                <img
                  src={currentLogo ?? SHIELD}
                  alt={org.org.name}
                  className="w-full h-full object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).src = SHIELD; }}
                />
              </div>
              <div className="text-sm text-slate-400">
                {currentLogo ? 'Custom organisation logo' : 'Using the default QA Platform logo'}
                {currentLogo && isAdmin && (
                  <button
                    onClick={removeLogo}
                    disabled={busy}
                    className="ml-3 inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    <Trash2 className="w-3 h-3" /> Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Upload */}
          {isAdmin && (
            <div className="border-t border-white/5 pt-5">
              {!pending ? (
                <>
                  <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={pickFile} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border border-dashed border-white/20 text-slate-300 hover:border-purple-500/50 hover:text-purple-200 transition-colors w-full justify-center"
                    style={{ background: 'rgba(255,255,255,0.02)' }}
                  >
                    <Upload className="w-4 h-4" />
                    Choose a logo image
                  </button>
                  <p className="text-xs text-slate-500 mt-2">
                    PNG, JPG, WebP or SVG · up to 2 MB · a square image works best.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-4">
                  <div
                    className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden border border-purple-500/30 shrink-0"
                    style={{ background: 'rgba(124,58,237,0.08)' }}
                  >
                    <img src={pending.objectUrl} alt="Preview" className="w-full h-full object-contain" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-300 truncate">{pending.file.name}</p>
                    <p className="text-xs text-slate-500">{(pending.file.size / 1024).toFixed(0)} KB</p>
                    <div className="flex gap-2 mt-2">
                      <Button size="sm" onClick={saveLogo} loading={busy} disabled={busy}>Save logo</Button>
                      <Button size="sm" variant="ghost" onClick={discard} disabled={busy}>Discard</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Branded login link */}
      <Card>
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-purple-300" />
            <p className="text-sm font-medium text-white">Branded login link</p>
          </div>
          <p className="text-xs text-slate-400">
            Share this link so your team sees your logo on the login page before they sign in.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs text-slate-300 bg-black/30 rounded-lg px-3 py-2 truncate">{brandedLoginUrl}</code>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { navigator.clipboard.writeText(brandedLoginUrl); toast.success('Copied'); }}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
