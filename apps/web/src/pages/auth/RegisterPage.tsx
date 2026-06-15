import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { User, Mail, Lock, Building2, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Mail as MailIcon } from 'lucide-react';
import { SsoButtons } from '@/components/auth/SsoButtons';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { usePreloginBranding, PLATFORM_NAME } from '@/hooks/useOrgBranding';

type Step = 'account' | 'org' | 'done';

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, setUser, logout } = useAuthStore();
  const inviteToken = searchParams.get('inviteToken') ?? '';
  const isInviteFlow = inviteToken.length > 0;
  // Email pre-seeded by InviteAcceptPage smart-routing — lock it when present
  const inviteEmail = searchParams.get('inviteEmail') ?? '';
  // Pre-login org branding via ?org=<slug> (or the last remembered org).
  const branding = usePreloginBranding(searchParams.get('org'));

  const [step, setStep] = useState<Step>('account');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(5);

  const [form, setForm] = useState({
    name: '',
    email: inviteEmail,  // pre-populated from invite link
    password: '',
    confirmPassword: '',
    orgName: '',
  });

  // Domain auto-join: orgs that accept this email's domain. When matches exist
  // the org step offers "request to join" vs "create my own org".
  const [matchedOrgs, setMatchedOrgs] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [joinMode, setJoinMode] = useState<'join' | 'create'>('create');
  const [joinOrgId, setJoinOrgId] = useState<string | null>(null);
  const [pendingOrgName, setPendingOrgName] = useState<string | null>(null);

  // Look up matching auto-join orgs whenever we enter the org step (skip the
  // invite flow — invites already bind an org).
  useEffect(() => {
    if (step !== 'org' || isInviteFlow || !form.email.includes('@')) return;
    let cancelled = false;
    authApi.orgForDomain(form.email)
      .then((orgs) => {
        if (cancelled) return;
        setMatchedOrgs(orgs);
        if (orgs.length > 0) { setJoinMode('join'); setJoinOrgId(orgs[0].id); }
        else { setJoinMode('create'); setJoinOrgId(null); }
      })
      .catch(() => { if (!cancelled) { setMatchedOrgs([]); setJoinMode('create'); } });
    return () => { cancelled = true; };
  }, [step, isInviteFlow, form.email]);

  // Auto-redirect countdown once approval-pending screen is shown
  useEffect(() => {
    if (step !== 'done') return;
    setCountdown(5);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          navigate('/login', { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [step, navigate]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  const validateAccount = () => {
    if (!form.name.trim()) return 'Name is required.';
    if (!form.email.includes('@')) return 'Enter a valid email.';
    if (form.password.length < 8) return 'Password must be at least 8 characters.';
    if (form.password !== form.confirmPassword) return 'Passwords do not match.';
    return null;
  };

  const handleAccountNext = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateAccount();
    if (err) { setError(err); return; }
    setError('');
    if (isInviteFlow) {
      void handleSubmit(e);
      return;
    }
    setStep('org');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isJoin = !isInviteFlow && joinMode === 'join' && !!joinOrgId;
    if (!isInviteFlow && !isJoin && !form.orgName.trim()) { setError('Organisation name is required.'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await authApi.register({
        name: form.name,
        email: form.email,
        password: form.password,
        orgName: isInviteFlow || isJoin ? undefined : form.orgName,
        inviteToken: isInviteFlow ? inviteToken : undefined,
        joinOrgId: isJoin ? joinOrgId! : undefined,
      });

      if (res.requiresApproval) {
        // Clear any stale session so the ProtectedRoute cannot be bypassed
        logout();
        // A domain-join request is approved by the ORG admin, not the platform
        // admin — capture the org name so the done screen says the right thing.
        setPendingOrgName(res.pendingOrgName ?? (isJoin ? matchedOrgs.find(o => o.id === joinOrgId)?.name ?? null : null));
        setStep('done');
        return;
      }

      // Auto-login
      localStorage.setItem('access_token', res.accessToken);
      setAuth(res.accessToken, res.platformRole, res.activeOrgId, res.orgRole);
      const user = await authApi.me();
      setUser(user);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(typeof msg === 'string' ? msg : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      {/* Ambient glow */}
      <div
        className="fixed pointer-events-none"
        style={{
          top: '-10%', left: '50%', transform: 'translateX(-50%)',
          width: '800px', height: '500px',
          background: 'radial-gradient(ellipse, rgba(var(--accent-rgb),0.18) 0%, transparent 70%)',
          zIndex: 0,
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src={branding?.logoUrl || '/brand/shield-256.png'}
            alt={branding?.name || PLATFORM_NAME}
            width={116}
            height={116}
            className="mb-3"
            style={{
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 24px rgba(var(--accent-rgb),0.45))',
            }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/brand/shield-256.png'; }}
          />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {branding?.name ? `Join ${branding.name}` : 'Create your account'}
          </h1>
          {step !== 'done' && !isInviteFlow && (
            <div className="flex items-center gap-2 mt-3">
              {(['account', 'org'] as Step[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-all"
                    style={{
                      background: step === s ? 'var(--accent)' : (i < (['account', 'org'] as Step[]).indexOf(step) ? 'rgba(var(--accent-rgb),0.40)' : 'rgba(255,255,255,0.08)'),
                      color: step === s ? 'white' : (i < (['account', 'org'] as Step[]).indexOf(step) ? 'var(--accent-400)' : 'rgba(238,238,248,0.35)'),
                      border: step === s ? '1px solid rgba(var(--accent-rgb),0.6)' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {i + 1}
                  </div>
                  {i < 1 && <div className="w-8 h-px" style={{ background: 'rgba(255,255,255,0.12)' }} />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="rounded-2xl p-6 space-y-4"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.50)',
          }}
        >
          {/* ── Done (pending approval) ── */}
          {step === 'done' && (
            <div className="text-center py-6 space-y-5">
              {/* Icon */}
              <div className="relative mx-auto w-16 h-16">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(var(--accent-rgb),0.12)', border: '1px solid rgba(var(--accent-rgb),0.28)' }}
                >
                  <MailIcon size={30} style={{ color: 'var(--accent-400)' }} />
                </div>
                {/* Green check badge */}
                <div
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.4)' }}
                >
                  <CheckCircle size={13} style={{ color: '#34d399' }} />
                </div>
              </div>

              {/* Message */}
              <div className="space-y-2">
                <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {pendingOrgName ? 'Request sent!' : 'Account registered!'}
                </h2>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {pendingOrgName
                    ? `Your request to join ${pendingOrgName} has been sent.`
                    : 'Please keep an eye on your email for any further account updates.'}
                </p>
                <p className="text-xs" style={{ color: 'rgba(238,238,248,0.38)' }}>
                  {pendingOrgName
                    ? `An admin at ${pendingOrgName} will review your request shortly.`
                    : 'A platform administrator will review your request shortly.'}
                </p>
              </div>

              {/* Countdown bar */}
              <div className="space-y-2">
                <div
                  className="h-1 rounded-full overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${(countdown / 5) * 100}%`,
                      background: 'linear-gradient(90deg, var(--accent), var(--accent-400))',
                    }}
                  />
                </div>
                <p className="text-xs" style={{ color: 'rgba(238,238,248,0.35)' }}>
                  Redirecting to login in {countdown}s…
                </p>
              </div>

              {/* Manual link */}
              <button
                onClick={() => navigate('/login', { replace: true })}
                className="text-sm font-medium hover:underline transition-opacity"
                style={{ color: 'var(--accent-400)' }}
              >
                Go to login now →
              </button>
            </div>
          )}

          {error && step !== 'done' && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
            >
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* ── Step 1: Account ── */}
          {step === 'account' && (
            <>
              {/* SSO above the email/password form. For an invite-flow
                  register, the buttons start the SSO invite-acceptance flow
                  (/auth/sso/invite-init): the invite token rides a cookie
                  through OAuth and the callback creates + activates the
                  account, links the provider, and logs the invitee in — no
                  password needed. The IdP email must match the invite. */}
              <div className="mb-4 space-y-4">
                <SsoButtons inviteToken={isInviteFlow ? inviteToken : null} />
              </div>
            <form onSubmit={handleAccountNext} className="space-y-4">
              {isInviteFlow && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Complete your account to accept this organisation invite.
                </p>
              )}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Full name
                </label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input data-testid="register-name" type="text" value={form.name} onChange={set('name')} placeholder="Jane Smith" required className="w-full pl-9" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Email
                  {inviteEmail && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-normal"
                      style={{ background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.28)' }}>
                      pre-filled from invite
                    </span>
                  )}
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    data-testid="register-email"
                    type="email"
                    value={form.email}
                    onChange={set('email')}
                    placeholder="you@company.com"
                    required
                    readOnly={!!inviteEmail}
                    disabled={!!inviteEmail}
                    className="w-full pl-9"
                    style={inviteEmail ? { opacity: 0.75, cursor: 'not-allowed' } : undefined}
                  />
                </div>
                {inviteEmail && (
                  <p className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.40)' }}>
                    This is the email address the invite was sent to and cannot be changed.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Password
                </label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input data-testid="register-password" type="password" value={form.password} onChange={set('password')} placeholder="Min. 8 characters" required className="w-full pl-9" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Confirm password
                </label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input data-testid="register-confirm-password" type="password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="••••••••" required className="w-full pl-9" />
                </div>
              </div>
              <Button data-testid="register-account-next" type="submit" className="w-full justify-center">
                Continue <ArrowRight size={14} />
              </Button>
            </form>
            </>
          )}

          {/* ── Step 2: Organisation ── */}
          {step === 'org' && !isInviteFlow && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Domain auto-join choice — shown when the email matches an org
                  that accepts auto-join. Default: request to join; opt to
                  create your own instead. */}
              {matchedOrgs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Your email matches an existing organisation.
                  </p>
                  {matchedOrgs.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => { setJoinMode('join'); setJoinOrgId(o.id); }}
                      className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                      style={{
                        background: joinMode === 'join' && joinOrgId === o.id ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(255,255,255,0.03)',
                        border: `1px solid ${joinMode === 'join' && joinOrgId === o.id ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      <Building2 size={15} style={{ color: 'var(--accent-400)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>Request to join {o.name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>An admin approves before you get access.</div>
                      </div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { setJoinMode('create'); setJoinOrgId(null); }}
                    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: joinMode === 'create' ? 'rgba(var(--accent-rgb),0.14)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${joinMode === 'create' ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <ArrowRight size={15} style={{ color: 'var(--text-muted)' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Create my own organisation</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Start a fresh workspace as its admin.</div>
                    </div>
                  </button>
                </div>
              )}

              {joinMode === 'join' && matchedOrgs.length > 0 ? (
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setStep('account')} className="flex-1 justify-center">
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button type="submit" loading={loading} className="flex-1 justify-center">
                    Request to join <ArrowRight size={14} />
                  </Button>
                </div>
              ) : (
              <>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                Create your organisation workspace. You'll be set as the org admin.
              </p>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Organisation name
                </label>
                <div className="relative">
                  <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                  <input
                    data-testid="register-org-name"
                    type="text"
                    value={form.orgName}
                    onChange={set('orgName')}
                    placeholder="e.g. Acme Corp"
                    required
                    className="w-full pl-9"
                  />
                </div>
                {form.orgName && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    Slug: {form.orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={() => setStep('account')} className="flex-1 justify-center">
                  <ArrowLeft size={14} /> Back
                </Button>
                <Button data-testid="register-create-account" type="submit" loading={loading} className="flex-1 justify-center">
                  Create account <ArrowRight size={14} />
                </Button>
              </div>
              </>
              )}
            </form>
          )}
        </div>

        {step !== 'done' && (
          <p className="text-center text-sm mt-4" style={{ color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: 'var(--accent-400)' }} className="font-medium hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
