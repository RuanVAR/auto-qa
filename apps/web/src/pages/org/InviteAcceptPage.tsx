import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Building2, Mail, UserPlus, LogIn, Loader2 } from 'lucide-react';
import { authApi, orgsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { PageSpinner } from '@/components/ui/Spinner';

type InvitePreview =
  | { valid: false; reason: string }
  | { valid: true; email: string; orgName: string; role: string; userExists: boolean };

export function InviteAcceptPage() {
  const navigate = useNavigate();
  const { token = '' } = useParams<{ token: string }>();
  const { setUser, token: authToken } = useAuthStore();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [acceptState, setAcceptState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [acceptMessage, setAcceptMessage] = useState('');

  // Step 1: always fetch the invite preview first (no auth required).
  // This gives us the invitee email + org name + whether they have an account
  // before we decide which flow to show.
  useEffect(() => {
    let cancelled = false;
    orgsApi.previewInvite(token)
      .then((data: InvitePreview) => { if (!cancelled) setPreview(data); })
      .catch(() => {
        if (!cancelled) setPreview({ valid: false, reason: 'not_found' });
      });
    return () => { cancelled = true; };
  }, [token]);

  // Step 2: if the user is already authenticated, attempt to accept immediately.
  useEffect(() => {
    if (!authToken || !preview?.valid) return;
    let cancelled = false;
    setAcceptState('loading');
    orgsApi.acceptInvite(token)
      .then(async (res: { message?: string }) => {
        if (cancelled) return;
        setAcceptMessage(res?.message ?? 'Invite accepted');
        const me = await authApi.me();
        if (!cancelled) {
          setUser(me);
          setAcceptState('success');
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setAcceptMessage(typeof msg === 'string' ? msg : 'Invite could not be accepted.');
        setAcceptState('error');
      });
    return () => { cancelled = true; };
  }, [token, authToken, preview, setUser]);

  // Still loading the preview
  if (!preview) return <PageSpinner />;

  // Invite token is invalid / expired / already used
  if (!preview.valid) {
    const reasons: Record<string, string> = {
      not_found:       'This invite link is invalid or has been removed.',
      expired:         'This invite has expired. Ask your admin to send a new one.',
      already_accepted:'This invite has already been accepted.',
      cancelled:       'This invite was cancelled by the organisation admin.',
      invalid:         'This invite is no longer valid.',
    };
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-md rounded-2xl p-6 space-y-4 border border-white/10 bg-white/5">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0" style={{ color: '#f87171' }} />
            <div>
              <h1 className="text-lg font-semibold text-white">Invite unavailable</h1>
              <p className="text-sm text-gray-300 mt-1">{reasons[preview.reason] ?? 'This invite is no longer valid.'}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => navigate('/login')}>Go to login</Button>
          </div>
        </div>
      </div>
    );
  }

  // Invite is valid — authenticated user: show accept status
  if (authToken) {
    const isLoading = acceptState === 'loading' || acceptState === 'idle';
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-md rounded-2xl p-6 space-y-4 border border-white/10 bg-white/5">
          <InviteHeader email={preview.email} orgName={preview.orgName} role={preview.role} />
          {isLoading && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'rgba(238,238,248,0.55)' }}>
              <Loader2 size={14} className="animate-spin" /> Accepting invite…
            </div>
          )}
          {acceptState === 'success' && (
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-white">{acceptMessage}</p>
                <p className="text-xs mt-0.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
                  You're now a member of <strong>{preview.orgName}</strong>.
                </p>
              </div>
            </div>
          )}
          {acceptState === 'error' && (
            <div className="flex items-start gap-3">
              <AlertCircle size={18} className="mt-0.5 shrink-0" style={{ color: '#f87171' }} />
              <p className="text-sm" style={{ color: '#f87171' }}>{acceptMessage}</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            {acceptState === 'success' && (
              <Button onClick={() => navigate('/dashboard')}>Go to dashboard</Button>
            )}
            {acceptState === 'error' && (
              <Button variant="secondary" onClick={() => navigate('/org/team')}>Open team page</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Invite is valid — unauthenticated user: smart-route based on userExists
  // Encode the invitee email into the URL so the target form can pre-populate it.
  const encodedEmail = encodeURIComponent(preview.email);
  const registerUrl = `/register?inviteToken=${encodeURIComponent(token)}&inviteEmail=${encodedEmail}`;
  const loginUrl    = `/login?next=${encodeURIComponent(`/invites/${token}/accept`)}&inviteEmail=${encodedEmail}`;

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: '-10%', left: '50%', transform: 'translateX(-50%)',
          width: '700px', height: '400px',
          background: 'radial-gradient(ellipse, rgba(var(--accent-rgb),0.16) 0%, transparent 70%)',
          zIndex: 0,
        }}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.50)',
        }}
      >
        <InviteHeader email={preview.email} orgName={preview.orgName} role={preview.role} />

        <div className="h-px" style={{ background: 'rgba(255,255,255,0.07)' }} />

        {preview.userExists ? (
          // Existing account — steer them to sign in
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'rgba(238,238,248,0.70)' }}>
              We found an account for <span className="font-semibold text-white">{preview.email}</span>.
              Sign in to accept the invite instantly.
            </p>
            <Link to={loginUrl} className="block">
              <Button className="w-full justify-center">
                <LogIn size={15} /> Sign in and accept invite
              </Button>
            </Link>
            <p className="text-xs text-center" style={{ color: 'rgba(238,238,248,0.35)' }}>
              Not you?{' '}
              <Link to="/login" style={{ color: 'var(--accent-400)' }} className="hover:underline">
                Sign in with a different account
              </Link>
            </p>
          </div>
        ) : (
          // New user — steer them to register
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'rgba(238,238,248,0.70)' }}>
              Create an account for <span className="font-semibold text-white">{preview.email}</span>{' '}
              to join <span className="font-semibold text-white">{preview.orgName}</span>.
              Your email is already filled in.
            </p>
            <Link to={registerUrl} className="block">
              <Button className="w-full justify-center">
                <UserPlus size={15} /> Create account and accept invite
              </Button>
            </Link>
            <p className="text-xs text-center" style={{ color: 'rgba(238,238,248,0.35)' }}>
              Already have an account?{' '}
              <Link to={loginUrl} style={{ color: 'var(--accent-400)' }} className="hover:underline">
                Sign in instead
              </Link>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function InviteHeader({ email, orgName, role }: { email: string; orgName: string; role: string }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'rgba(var(--accent-rgb),0.18)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}
        >
          <Building2 size={18} style={{ color: 'var(--accent-300)' }} />
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-widest font-semibold" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Organisation invite
          </p>
          <p className="text-base font-bold text-white">{orgName}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
          style={{ background: 'rgba(var(--accent-rgb),0.14)', border: '1px solid rgba(var(--accent-rgb),0.28)', color: 'var(--accent-300)' }}
        >
          <Mail size={11} /> {email}
        </span>
        <span
          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(238,238,248,0.60)' }}
        >
          Role: {role.replace('ORG_', '').replace('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}
        </span>
      </div>
    </div>
  );
}
