import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Zap, AlertCircle, Loader2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export function SsoCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth, setUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      setError(decodeURIComponent(errorParam));
      return;
    }

    if (!token) {
      setError('No authentication token received. Please try again.');
      return;
    }

    (async () => {
      try {
        // ── Wipe ALL state from any previous user before storing the new
        // session. Without this, React Query caches (['projects'],
        // ['notifications'], ['user'], ['orgs'], etc.), Zustand-persisted
        // activeOrgId/orgRole in localStorage, and any other side-channel
        // state from the prior login bleed into the new session — the
        // dashboard renders the OLD user's projects until each query
        // refetches, even though the JWT and permissions are correct.
        // Looks alarmingly like cross-user data leakage in the UI but is
        // purely a client-side cache problem.
        queryClient.clear();
        // Don't touch the freshly-issued access_token, but blow away
        // anything else that smells like persisted auth state.
        for (const key of Object.keys(localStorage)) {
          if (
            key === 'access_token' ||
            key === 'refresh_token'
          ) continue;
          if (
            key === 'qa-auth' ||                      // zustand persist key
            key.startsWith('activeOrgId') ||
            key.startsWith('orgRole') ||
            key.startsWith('lastActiveOrgId')
          ) {
            localStorage.removeItem(key);
          }
        }

        // Store the new token so api.ts interceptor picks it up
        localStorage.setItem('access_token', token);

        // Fetch user profile using the new token
        const user = await authApi.me();

        const activeOrgId = user.lastActiveOrgId ?? user.orgMemberships?.[0]?.orgId ?? null;
        const orgMembership = user.orgMemberships?.find(
          (m: { orgId: string; role: string }) => m.orgId === activeOrgId
        );
        const orgRole = orgMembership?.role ?? null;

        setAuth(token, user.platformRole, activeOrgId, orgRole);
        setUser(user);

        if (user.platformRole === 'PLATFORM_ADMIN') {
          navigate('/admin', { replace: true });
        } else {
          navigate('/dashboard', { replace: true });
        }
      } catch {
        localStorage.removeItem('access_token');
        setError('Failed to authenticate. The token may have expired. Please try again.');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        </div>

        {/* Card */}
        <div
          className="rounded-2xl p-8 flex flex-col items-center gap-5 text-center"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.50)',
          }}
        >
          {error ? (
            <>
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.30)' }}
              >
                <AlertCircle size={22} style={{ color: '#f87171' }} />
              </div>
              <div>
                <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  Sign-in failed
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {error}
                </p>
              </div>
              <Link
                to="/login"
                className="text-sm font-medium hover:underline"
                style={{ color: '#a78bfa' }}
              >
                Back to login
              </Link>
            </>
          ) : (
            <>
              <Loader2 size={32} className="animate-spin" style={{ color: '#a78bfa' }} />
              <div>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  Signing you in…
                </h2>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Please wait while we verify your identity.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
