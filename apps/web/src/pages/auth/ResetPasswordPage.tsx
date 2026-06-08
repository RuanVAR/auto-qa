import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Zap, Lock, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

/**
 * Password reset entry point. Lifecycle:
 *
 *   1. Mount — read `?token=…` from the URL. If absent, render an explainer
 *      with a link back to /forgot-password (no point showing the form).
 *   2. User enters the new password twice → POST /auth/reset-password.
 *   3. Server validates the token's signature, expiry (30 min), and `purpose:
 *      'pwreset'` claim. Any failure returns 403 with a message — render it.
 *   4. On success: clear any stale local auth (an attacker may have planted
 *      tokens in this browser), show a confirmation, and route to /login.
 *
 * Notes on flow:
 *   - The token is single-use only by virtue of expiry (30 min); we don't
 *     keep a server-side blacklist for reset tokens because they're scoped
 *     and brief. After a successful reset, every existing session is killed
 *     server-side (via tokens.revokeAllForUser in changePassword's sibling
 *     path), so an attacker who got hold of an old token is already locked
 *     out via the natural expiry path.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');

  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  // Belt-and-braces: clear any stale local auth on mount. If a user's token
  // was leaked + somebody opened the reset link in their browser, we don't
  // want a still-valid access token sitting in localStorage afterwards.
  useEffect(() => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }, []);

  // Surface a clear "no token" state. The reset-password page is meaningless
  // without one, so don't render the form — guide the user back to the
  // forgot flow instead.
  if (!token) {
    return (
      <Frame title="No reset token">
        <p className="text-xs mb-4" style={{ color: 'rgba(238,238,248,0.65)' }}>
          This page only works when opened from the link in a password-reset
          email. Request a fresh link below.
        </p>
        <Link to="/forgot-password">
          <Button className="w-full justify-center">
            Request a reset link
          </Button>
        </Link>
        <Link
          to="/login"
          className="flex items-center justify-center gap-1.5 text-xs mt-3"
          style={{ color: 'rgba(238,238,248,0.55)' }}
        >
          <ArrowLeft size={12} /> Back to sign in
        </Link>
      </Frame>
    );
  }

  if (done) {
    return (
      <Frame title="Password updated">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full"
               style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.40)' }}>
            <CheckCircle size={18} style={{ color: '#34d399' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Your password has been reset.
          </p>
          <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Sign in below with your new password. Any other devices you were
            signed into have been logged out for security.
          </p>
          <Button onClick={() => navigate('/login')} className="w-full justify-center mt-2">
            Go to sign in
          </Button>
        </div>
      </Frame>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw1.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pw1 !== pw2) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      await api.post('/api/v1/auth/reset-password', { token, newPassword: pw1 });
      setDone(true);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { message?: string } } })?.response;
      const msg = status?.data?.message;
      // 403 = bad / expired / wrong-purpose token. Surface verbatim so the
      // user knows whether to request a fresh link.
      if (status?.status === 403) {
        setError(typeof msg === 'string' ? msg : 'Reset link is invalid or expired. Request a new one.');
      } else if (status?.status === 400) {
        setError(typeof msg === 'string' ? msg : 'Password is too short. Use at least 8 characters.');
      } else {
        setError('Something went wrong. Try again, or request a fresh link.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Frame title="Set a new password">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
          Choose a new password. The link in your email expires 30 minutes
          after it was sent — request a fresh one if this one's stale.
        </p>

        <PasswordField
          label="New password"
          value={pw1}
          onChange={setPw1}
          autoFocus
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirm new password"
          value={pw2}
          onChange={setPw2}
          autoComplete="new-password"
        />

        {error && (
          <div
            className="flex items-start gap-2 p-2 rounded-lg text-xs"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
          >
            <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" className="w-full justify-center" loading={loading}>
          Update password
        </Button>

        <Link
          to="/forgot-password"
          className="flex items-center justify-center gap-1.5 text-xs"
          style={{ color: 'rgba(238,238,248,0.55)' }}
        >
          Need a new link? Request one here
        </Link>
      </form>
    </Frame>
  );
}

function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-base)' }}
    >
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(var(--accent-rgb),0.18)', border: '1px solid rgba(var(--accent-rgb),0.40)' }}
          >
            <Zap size={22} style={{ color: 'var(--accent-300)' }} />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            AdVantage
          </h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
            {title}
          </p>
        </div>
        <div
          className="rounded-2xl p-6"
          style={{
            background: 'rgba(18,18,32,0.85)',
            border: '1px solid rgba(255,255,255,0.08)',
            boxShadow: '0 24px 64px rgba(0,0,0,0.50)',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function PasswordField({
  label, value, onChange, autoFocus, autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.70)' }}>
        {label}
      </label>
      <div className="relative">
        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'rgba(238,238,248,0.40)' }} />
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={8}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
          style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'var(--text-primary)',
          }}
        />
      </div>
    </div>
  );
}
