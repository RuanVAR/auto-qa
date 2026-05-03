import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Zap, Mail, Lock, AlertCircle } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';

const API_BASE = (import.meta as unknown as { env: { VITE_API_URL?: string } }).env.VITE_API_URL ?? 'http://localhost:3001';

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth, setUser } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login({ email, password });
      // Store token
      localStorage.setItem('access_token', res.accessToken);
      setAuth(res.accessToken, res.platformRole, res.activeOrgId, res.orgRole);
      // Fetch full user profile
      const user = await authApi.me();
      setUser(user);
      // Route based on platformRole
      if (res.platformRole === 'PLATFORM_ADMIN') {
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
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
              boxShadow: '0 0 24px rgba(124,58,237,0.50)',
            }}
          >
            <Zap size={22} className="text-white" />
          </div>
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
          {/* SSO buttons */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => { window.location.href = `${API_BASE}/api/v1/auth/google`; }}
              className="w-full flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(238,238,248,0.85)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 48 48" fill="none">
                <path d="M47.532 24.552c0-1.636-.132-3.2-.38-4.704H24v9.02h13.22c-.58 3.04-2.3 5.616-4.88 7.344v6.1h7.9c4.62-4.26 7.292-10.54 7.292-17.76z" fill="#4285F4"/>
                <path d="M24 48c6.64 0 12.2-2.2 16.268-5.96l-7.9-6.1c-2.2 1.48-5.016 2.356-8.368 2.356-6.432 0-11.88-4.34-13.828-10.176H2.02v6.296C5.98 42.78 14.36 48 24 48z" fill="#34A853"/>
                <path d="M10.172 28.12A14.84 14.84 0 0 1 9.32 24c0-1.432.248-2.82.688-4.12V13.584H2.02A23.99 23.99 0 0 0 0 24c0 3.864.928 7.52 2.02 10.416l8.152-6.296z" fill="#FBBC05"/>
                <path d="M24 9.528c3.624 0 6.872 1.248 9.432 3.692l7.068-7.068C36.192 2.196 30.632 0 24 0 14.36 0 5.98 5.22 2.02 13.584l8.152 6.296C12.12 13.868 17.568 9.528 24 9.528z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            <button
              type="button"
              onClick={() => { window.location.href = `${API_BASE}/api/v1/auth/microsoft`; }}
              className="w-full flex items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(238,238,248,0.85)',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
              </svg>
              Continue with Microsoft
            </button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <span className="text-xs" style={{ color: 'rgba(238,238,248,0.30)' }}>or</span>
            <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
          </div>

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
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Password
              </label>
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
          <Link to="/register" style={{ color: '#a78bfa' }} className="font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
