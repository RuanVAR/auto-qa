import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Monitor, X, Loader, Shield } from 'lucide-react';
import { authApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * Active sessions — one row per refresh-token (= one logged-in browser/device).
 * Revoking a session invalidates that device's refresh token, so the next
 * time its access token expires (≤15 min) it'll be kicked to /login.
 *
 * The session belonging to the current request is identifiable only loosely
 * — the API doesn't return a flag — but the row with the most recent
 * `lastUsedAt` is almost always the caller's, so we tag it.
 */
export function ActiveSessionsSection() {
  const qc = useQueryClient();
  const { data: sessions = [], isLoading, error } = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: () => authApi.listSessions(),
    refetchOnWindowFocus: true,
  });

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth-sessions'] });
      toast.success('Session revoked', 'That device will be signed out within 15 minutes.');
    },
    onError: () => toast.error('Failed to revoke session', 'Try again.'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader size={14} className="animate-spin" /> Loading sessions…
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">Couldn't load active sessions.</p>;
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-gray-500">No active sessions.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">
        One row per signed-in browser/device. Revoke any you don't recognise.
      </p>
      {sessions.map((s, i) => (
        <div
          key={s.id}
          className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2"
        >
          <Monitor size={16} className="text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-700 truncate">
                {parseUserAgent(s.userAgent)}
              </p>
              {i === 0 && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 flex items-center gap-1">
                  <Shield size={9} /> This device
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400">
              {s.ipAddress ?? 'unknown ip'} · last used {timeAgo(s.lastUsedAt)} · expires {fmtDate(s.expiresAt)}
            </p>
          </div>
          <button
            onClick={() => revoke.mutate(s.id)}
            disabled={revoke.isPending}
            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
            title="Revoke this session"
          >
            <X size={12} /> Revoke
          </button>
        </div>
      ))}
    </div>
  );
}

function parseUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  // Cheap-and-cheerful UA parsing — enough for "is this me on Chrome or
  // some bot from a different IP". For richer parsing we'd pull in
  // ua-parser-js but it's 200 KB; not worth it for this UI.
  const match = ua.match(/(Chrome|Firefox|Safari|Edge|curl|TestBrowser)\/[\d.]+/i);
  const browser = match ? match[0].split('/')[0] : 'Unknown browser';
  if (/iPhone/.test(ua)) return `${browser} on iPhone`;
  if (/Android/.test(ua)) return `${browser} on Android`;
  if (/Macintosh/.test(ua)) return `${browser} on Mac`;
  if (/Windows/.test(ua)) return `${browser} on Windows`;
  if (/Linux/.test(ua)) return `${browser} on Linux`;
  return browser;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
