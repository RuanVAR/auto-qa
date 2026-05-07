import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Sparkles, ShieldCheck, Settings,
  Zap, LogOut, User, ChevronDown, Check, Building2, Bell,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuthStore, useActiveOrg, useIsPlatformAdmin } from '@/stores/authStore';
import { authApi, notificationsApi, workSessionsApi } from '@/lib/api';
import { WorkSessionBadge } from '@/components/layout/WorkSessionBadge';
import { EnvSwitcher } from '@/components/layout/EnvSwitcher';
import { ActiveSessionsPill } from '@/components/layout/ActiveSessionsPill';

// ─── Notification Bell ───────────────────────────────────────────────────────

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  actionUrl?: string;
  actionLabel?: string;
  createdAt: string;
  category: string;
};

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: notificationsApi.unreadCount,
    staleTime: 60_000,
    refetchInterval: 90_000,   // poll every 90s — socket handles real-time
  });

  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.list({ limit: 10 }),
    enabled: open,
    staleTime: 30_000,
    refetchInterval: open ? 60_000 : false,
  });

  const markAllRead = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const count = countData?.count ?? 0;
  const notifications: NotificationItem[] = (notifData as { items?: NotificationItem[] } | undefined)?.items ?? [];

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center transition-colors"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          color: count > 0 ? '#a78bfa' : 'rgba(238,238,248,0.40)',
        }}
        title="Notifications"
        aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}
      >
        <Bell size={14} />
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: '#7c3aed', color: '#fff', padding: '0 3px' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden"
          style={{
            background: 'rgba(14,14,24,0.98)',
            border: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(24px)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.70)',
            zIndex: 100,
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between border-b"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>
              Notifications {count > 0 && <span style={{ color: '#a78bfa' }}>({count})</span>}
            </span>
            {count > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="text-xs transition-opacity hover:opacity-100"
                style={{ color: 'rgba(238,238,248,0.50)' }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Bell size={20} className="mx-auto mb-2" style={{ color: 'rgba(238,238,248,0.20)' }} />
                <p className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className="px-4 py-3 border-b transition-colors cursor-default"
                  style={{
                    borderColor: 'rgba(255,255,255,0.05)',
                    background: n.isRead ? 'transparent' : 'rgba(139,92,246,0.06)',
                  }}
                  onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: '#7c3aed' }} />
                    )}
                    <div className="flex-1">
                      <p className="text-xs font-semibold mb-0.5" style={{ color: 'rgba(238,238,248,0.90)' }}>
                        {n.title}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
                        {n.body}
                      </p>
                      {n.actionUrl && n.actionLabel && (
                        <a
                          href={n.actionUrl}
                          className="inline-flex items-center gap-1 text-xs font-medium mt-1.5 transition-opacity hover:opacity-100"
                          style={{ color: '#a78bfa' }}
                          onClick={e => { e.stopPropagation(); setOpen(false); }}
                        >
                          {n.actionLabel} →
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TopNav ──────────────────────────────────────────────────────────────────

const BASE_NAV = [
  { to: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/projects',   icon: FolderOpen,       label: 'Projects'  },
  { to: '/ai',         icon: Sparkles,          label: 'AI'        },
  { to: '/settings',   icon: Settings,          label: 'Settings'  },
];

export function TopNav() {
  const navigate = useNavigate();
  const { logout, user, switchOrg, activeOrgId } = useAuthStore();
  const activeOrg = useActiveOrg();
  const isPlatformAdmin = useIsPlatformAdmin();

  const [orgOpen, setOrgOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState<string | null>(null);
  const orgRef = useRef<HTMLDivElement>(null);

  const NAV = isPlatformAdmin
    ? [...BASE_NAV, { to: '/admin', icon: ShieldCheck, label: 'Admin' }]
    : BASE_NAV;

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (orgRef.current && !orgRef.current.contains(e.target as Node)) {
        setOrgOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    // Two-step logout, both best-effort:
    //   1. /auth/logout — revokes the refresh token in DB AND blacklists the
    //      current access-token JTI in Redis, so the residual ~15-min access
    //      window collapses immediately.
    //   2. /work-sessions/end — finalizes the QaWorkSession so stats roll
    //      up consistently. Doesn't affect auth, just bookkeeping.
    // Errors are swallowed — if the backend is unreachable, we still want
    // to clear local auth and get the user out.
    try { await authApi.logout(); } catch { /* ignore */ }
    try { await workSessionsApi.end('logout'); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  const handleSwitchOrg = async (orgId: string) => {
    if (orgId === activeOrgId) { setOrgOpen(false); return; }
    setSwitchingOrg(orgId);
    try {
      // End the current session for the previous org before switching so it
      // gets properly attributed. The new org will auto-start a session on
      // first activity after reload.
      try { await workSessionsApi.end('org-switch'); } catch { /* ignore */ }
      const res = await authApi.switchOrg(orgId);
      localStorage.setItem('access_token', res.accessToken);
      switchOrg(orgId, res.orgRole, res.accessToken);
      setOrgOpen(false);
      window.location.reload(); // Refresh to re-query with new org context
    } catch {
      // ignore
    } finally {
      setSwitchingOrg(null);
    }
  };

  const orgs = user?.orgMemberships ?? [];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3">
      {/* Brand */}
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
            boxShadow: '0 0 18px rgba(124,58,237,0.50)',
          }}
        >
          <Zap size={15} className="text-white" />
        </div>
        <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>
          QA Platform
        </span>
      </div>

      {/* Floating pill nav — absolutely centred */}
      <nav
        className="absolute left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full px-1.5 py-1.5"
        style={{
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all duration-150 select-none',
                isActive ? 'text-white' : 'text-white/50 hover:text-white/75',
              )
            }
            style={({ isActive }) =>
              isActive
                ? {
                    background: 'rgba(124,58,237,0.38)',
                    boxShadow: '0 0 12px rgba(124,58,237,0.28)',
                  }
                : {}
            }
          >
            <Icon size={13} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Right: Active sessions + Env switcher + Org switcher + user actions */}
      <div className="flex items-center gap-2">
        {/* Global active-sessions pill — shows count + dropdown across all
            features the user has open work on. Also drives the heartbeat
            keep-alive so sessions don't die when the user navigates. */}
        <ActiveSessionsPill />

        {/* Project-context env switcher — only renders when in a project route
            and the user has 2+ envs in it. Self-hides otherwise. */}
        <EnvSwitcher />

        {/* Org switcher — hidden for platform admins */}
        {!isPlatformAdmin && orgs.length > 0 && (
          <div className="relative" ref={orgRef}>
            <button
              onClick={() => setOrgOpen(v => !v)}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'rgba(238,238,248,0.75)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.10)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
            >
              <Building2 size={12} style={{ color: '#a78bfa' }} />
              <span className="max-w-[100px] truncate">
                {activeOrg?.org.name ?? 'Select org'}
              </span>
              <ChevronDown size={11} className={cn('transition-transform', orgOpen && 'rotate-180')} />
            </button>

            {orgOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-52 rounded-xl overflow-hidden py-1"
                style={{
                  background: 'rgba(18,18,32,0.95)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  backdropFilter: 'blur(24px)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
                }}
              >
                <div className="px-3 py-1.5 text-xs" style={{ color: 'rgba(238,238,248,0.30)' }}>
                  Organisations
                </div>
                {orgs.map((m) => (
                  <button
                    key={m.orgId}
                    onClick={() => handleSwitchOrg(m.orgId)}
                    disabled={switchingOrg === m.orgId}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors"
                    style={{ color: 'rgba(238,238,248,0.75)' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span className="truncate">{m.org.name}</span>
                    <span className="flex items-center gap-1 shrink-0 ml-2">
                      <span
                        className="text-xs rounded px-1.5 py-0.5"
                        style={{
                          background: 'rgba(124,58,237,0.15)',
                          color: '#a78bfa',
                          border: '1px solid rgba(124,58,237,0.25)',
                        }}
                      >
                        {m.role === 'ORG_OWNER' ? 'Owner' : m.role === 'ORG_ADMIN' ? 'Admin' : 'Member'}
                      </span>
                      {m.orgId === activeOrgId && <Check size={11} style={{ color: '#34d399' }} />}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Work session badge — shows live QA activity stats */}
        <WorkSessionBadge />

        {/* Notification bell */}
        <NotificationBell />

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden shrink-0"
          style={{
            background: 'rgba(124,58,237,0.20)',
            border: '1px solid rgba(124,58,237,0.35)',
          }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <User size={14} style={{ color: '#c4b5fd' }} />
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
            color: 'rgba(238,238,248,0.40)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
            e.currentTarget.style.color = 'rgba(238,238,248,0.80)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
            e.currentTarget.style.color = 'rgba(238,238,248,0.40)';
          }}
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
