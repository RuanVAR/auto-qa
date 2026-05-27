import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Mail, Lock, AlertCircle } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { SsoButtons } from '@/components/auth/SsoButtons';

function safeNextUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (/[\r\n]/.test(raw)) return null;
  if (/^\/[a-z]+:/i.test(raw)) return null;
  return raw;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, setUser } = useAuthStore();
  const nextUrl = safeNextUrl(searchParams.get('next'));
  const inviteTokenForRegister = nextUrl?.match(/^\/invites\/([^/]+)\/accept$/)?.[1] ?? null;
  // Email pre-seeded from InviteAcceptPage smart-routing
  const inviteEmail = searchParams.get('inviteEmail') ?? '';

  const [email, setEmail] = useState(inviteEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      // Store both tokens — access (15 min, used on every request) and
      // refresh (7 d, traded for a new pair when access expires). The
      // axios interceptor in api.ts handles the refresh transparently.
      localStorage.setItem('access_token', res.accessToken);
      if (res.refreshToken) localStorage.setItem('refresh_token', res.refreshToken);
      setAuth(res.accessToken, res.platformRole, res.activeOrgId, res.orgRole);
      // Fetch full user profile
      const user = await authApi.me();
      setUser(user);
      // Route: honour ?next= from shared links, else route based on role
      if (nextUrl) {
        navigate(nextUrl, { replace: true });
      } else if (res.platformRole === 'PLATFORM_ADMIN') {
        navigate('/admin', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(typeof msg === 'string' ? msg : 'Login failed. Please try again.');
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
          background: 'radial-gradient(ellipse, rgba(124,58,237,0.18) 0%, transparent 70%)',
          zIndex: 0,
        }}
      />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/brand/shield-256.png"
            alt="QA Platform"
            width={116}
            height={116}
            className="mb-3"
            style={{
              objectFit: 'contain',
              filter: 'drop-shadow(0 0 24px rgba(124,58,237,0.45))',
            }}
          />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
            QA Platform
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Sign in to your account
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-6 space-y-4"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.50)',
          }}
        >
          {/* SSO buttons + divider (each gated on /auth/config). The divider
              renders only when at least one SSO provider is available — a
              password-only deployment looks identical to before this feature. */}
          <SsoButtons inviteToken={inviteTokenForRegister} />

          {error && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
            >
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {inviteEmail && (
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                style={{ background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.28)', color: '#c4b5fd' }}
              >
                <Mail size={12} className="shrink-0" />
                Sign in as <strong className="ml-0.5">{inviteEmail}</strong> to accept your invite.
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Email
              </label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  data-testid="login-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-9"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  Password
                </label>
                <Link
                  to="/forgot-password"
                  className="text-[11px] hover:underline"
                  style={{ color: '#a78bfa' }}
                >
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input
                  data-testid="login-password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full pl-9"
                />
              </div>
            </div>

            <Button data-testid="login-submit" type="submit" loading={loading} className="w-full justify-center">
              Sign in
            </Button>
          </form>
        </div>

        <p className="text-center text-sm mt-4" style={{ color: 'var(--text-muted)' }}>
          Don't have an account?{' '}
          <Link
            to={inviteTokenForRegister ? `/register?inviteToken=${encodeURIComponent(inviteTokenForRegister)}` : '/register'}
            style={{ color: '#a78bfa' }}
            className="font-medium hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
