import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useLocation } from 'react-router-dom';
import { Ticket, X } from 'lucide-react';
import { userClickupApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

const DISMISS_KEY = 'cu-token-nudge-dismissed';

/**
 * Non-blocking, dismissible banner nudging a user to add their personal ClickUp
 * token — only when the org's ClickUp is installed & healthy and they haven't
 * added one. Dismissal is per-browser (localStorage); adding a token (which is
 * cross-device) hides it everywhere via the shared ['user-clickup-token'] query.
 */
export function ClickUpTokenNudge() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  const { data: status } = useQuery({
    queryKey: ['user-clickup-token'],
    queryFn: () => userClickupApi.status(),
    enabled: !!token && !dismissed,
    staleTime: 60_000,
  });

  // Don't nag on the Settings page itself (that's where they'd add it).
  if (dismissed || location.pathname.startsWith('/settings')) return null;
  if (!status?.installed || !status.healthy || status.hasToken) return null;

  return (
    <div
      className="mb-4 flex items-center gap-3 rounded-xl px-4 py-2.5"
      style={{ background: 'rgba(var(--accent-rgb),0.10)', border: '1px solid rgba(var(--accent-rgb),0.28)' }}
    >
      <Ticket size={16} className="shrink-0" style={{ color: 'var(--accent-300)' }} />
      <span className="flex-1 text-sm" style={{ color: 'rgba(238,238,248,0.85)' }}>
        Connect your ClickUp account so the bugs, status changes and comments you push show up as{' '}
        <strong>you</strong> in ClickUp.
      </span>
      <button
        type="button"
        onClick={() => navigate('/settings')}
        className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', border: '1px solid rgba(var(--accent-rgb),0.5)' }}
      >
        Add my token
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
        className="shrink-0 p-1 rounded-lg"
        style={{ color: 'rgba(238,238,248,0.5)' }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
