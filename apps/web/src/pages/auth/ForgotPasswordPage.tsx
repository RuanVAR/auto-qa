import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Zap, Mail, ArrowLeft, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';

/**
 * "I forgot my password" entry point. Submits the user's email to
 * `POST /auth/forgot-password` and shows a fixed success message regardless
 * of whether the email exists in the DB — anti-enumeration.
 *
 * The actual reset email (with a 30-min JWT token) is sent server-side via
 * EmailService → MJML password-reset template. Token validation happens on
 * the corresponding /reset-password page.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Endpoint always returns 200/201 even for unknown emails — we just
      // optimistically show the same success state on any non-throw.
      await api.post('/api/v1/auth/forgot-password', { email: email.trim().toLowerCase() });
    } catch {
      // Even hard errors (rate limit, malformed) render as success — never
      // leak account existence by branching the UI on the error.
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  };

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
            Reset your password
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
          {submitted ? (
            <div className="text-center space-y-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full"
                   style={{ background: 'rgba(16,185,129,0.18)', border: '1px solid rgba(16,185,129,0.40)' }}>
                <CheckCircle size={18} style={{ color: '#34d399' }} />
              </div>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                Check your inbox.
              </p>
              <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                If <strong>{email}</strong> matches an account, a reset link is on its way.
                The link expires in <strong>30 minutes</strong>.
              </p>
              <p className="text-xs pt-2" style={{ color: 'rgba(238,238,248,0.40)' }}>
                Didn't get it? Check spam, or try again from the login page.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-xs mt-2"
                style={{ color: 'var(--accent-400)' }}
              >
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
                Enter the email associated with your account and we'll send you a link to reset your password.
              </p>

              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'rgba(238,238,248,0.70)' }}>
                  Email
                </label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2"
                        style={{ color: 'rgba(238,238,248,0.40)' }} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-3 py-2 rounded-lg text-sm"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      color: 'var(--text-primary)',
                    }}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full justify-center" loading={loading}>
                Send reset link
              </Button>

              <Link
                to="/login"
                className="flex items-center justify-center gap-1.5 text-xs"
                style={{ color: 'rgba(238,238,248,0.55)' }}
              >
                <ArrowLeft size={12} /> Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
