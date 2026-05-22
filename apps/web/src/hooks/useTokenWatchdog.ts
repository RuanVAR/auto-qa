import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { getFreshToken } from '@/lib/api';

/**
 * Proactive session watchdog.
 *
 * The axios interceptor only reacts to token expiry when a request happens
 * to fire — so an access token that died while the user was idle (or a
 * refresh token revoked server-side) just left the UI frozen on a stale
 * page with no feedback.
 *
 * This watchdog checks the token on a 60s heartbeat AND whenever the tab
 * regains focus (the classic "came back after lunch" case). `getFreshToken`
 * silently refreshes a near-expired token, or — when the refresh token is
 * also dead (i.e. the BE rejects it) — clears auth and bounces to /login.
 * So expiry now always resolves to either a seamless refresh or a clean
 * auto-logout, never a dead-but-rendered UI.
 */
export function useTokenWatchdog() {
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const check = () => { void getFreshToken(); };
    const onVisible = () => { if (!document.hidden) check(); };

    const id = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    // Run once on mount so a reload onto an already-dead token resolves now
    // instead of waiting up to a minute.
    check();

    return () => {
      clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [token]);
}
