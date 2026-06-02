import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, FolderOpen, Sparkles, ShieldCheck, Settings,
  LogOut, User, ChevronDown, Check, Building2, Bell, Menu, X,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { useAuthStore, useActiveOrg, useIsPlatformAdmin, useIsOrgAdmin } from '@/stores/authStore';
import { useResolvedBranding } from '@/hooks/useOrgBranding';
import { authApi, notificationsApi, workSessionsApi } from '@/lib/api';
import { WorkSessionBadge } from '@/components/layout/WorkSessionBadge';
import { WorkerStatusChip } from '@/components/layout/WorkerStatusChip';
import { EnvSwitcher } from '@/components/layout/EnvSwitcher';
import { ActiveSessionsPill } from '@/components/layout/ActiveSessionsPill';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

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
          color: count > 0 ? 'var(--accent-400)' : 'rgba(238,238,248,0.40)',
        }}
        title="Notifications"
        aria-label={count > 0 ? `Notifications (${count} unread)` : 'Notifications'}
      >
        <Bell size={14} />
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{ background: 'var(--accent)', color: '#fff', padding: '0 3px' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl overflow-hidden"
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
              Notifications {count > 0 && <span style={{ color: 'var(--accent-400)' }}>({count})</span>}
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
                    background: n.isRead ? 'transparent' : 'rgba(var(--accent-rgb),0.06)',
                  }}
                  onClick={() => { if (!n.isRead) markRead.mutate(n.id); }}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--accent)' }} />
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
                          style={{ color: 'var(--accent-400)' }}
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
  const brand = useResolvedBranding();
  const isPlatformAdmin = useIsPlatformAdmin();
  const isOrgAdmin = useIsOrgAdmin();

  const [orgOpen, setOrgOpen] = useState(false);
  const [switchingOrg, setSwitchingOrg] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const orgRef = useRef<HTMLDivElement>(null);

  // Lock body scroll while the mobile drawer is open so the page behind
  // doesn't scroll under it.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mobileOpen]);

  // Compose nav.
  // Platform admins operate the platform — they create + manage organisations
  // via Admin and don't do day-to-day QA work, so they get a focused nav
  // (personal Settings + Admin) without the org-member tabs (Dashboard,
  // Projects, AI, Org). Everyone else gets the standard org-member tabs, with
  // the Org link inserted before Settings for ORG_ADMINs.
  const NAV = isPlatformAdmin
    ? [
        BASE_NAV[3],                                                          // Settings (personal)
        { to: '/admin', icon: ShieldCheck, label: 'Admin' },
      ]
    : [
        ...BASE_NAV.slice(0, 3),                                              // Dashboard, Projects, AI
        ...(isOrgAdmin ? [{ to: '/org', icon: Building2, label: 'Org' }] : []),
        BASE_NAV[3],                                                          // Settings (personal)
      ];

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

  // Confirm-before-logout — a stray click on the small logout icon next to the
  // avatar was kicking people out mid-test and ending their QA work session.
  // Opens a styled confirm modal (replaces the old window.confirm()).
  const handleLogout = () => setLogoutConfirmOpen(true);

  const performLogout = async () => {
    setLoggingOut(true);
    // Logout order matters: /auth/logout blacklists the current access-token
    // JTI in Redis. Any request made with that JTI after this point gets a
    // 401. The server already calls endAllForUser() inside the logout handler
    // before the blacklist, but we also send the explicit end here as a
    // belt-and-suspenders guard — it must fire BEFORE /auth/logout so the
    // token is still valid when the work-sessions endpoint receives it.
    // Errors are swallowed — if the backend is unreachable we still want to
    // clear local auth and redirect the user out.
    try { await workSessionsApi.end('logout'); } catch { /* ignore */ }
    try { await authApi.logout(); } catch { /* ignore */ }
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
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 md:px-6 py-3">
      {/* Brand — resolved org → platform → built-in QA Platform */}
      <div className="flex items-center gap-2.5 min-w-0">
        <img
          src={brand.logoUrl || '/brand/shield-128.png'}
          alt={brand.name || 'QA Platform'}
          width={36}
          height={36}
          className="shrink-0"
          style={{
            objectFit: 'contain',
            filter: 'drop-shadow(0 0 14px rgba(var(--accent-rgb),0.45))',
          }}
          onError={(e) => { (e.target as HTMLImageElement).src = '/brand/shield-128.png'; }}
        />
        <span className="text-sm font-semibold truncate" style={{ color: 'rgba(238,238,248,0.90)' }}>
          {brand.name || 'QA Platform'}
        </span>
      </div>

      {/* Floating pill nav — absolutely centred (desktop only) */}
      <nav
        className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-0.5 rounded-full px-1.5 py-1.5"
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
                    background: 'rgba(var(--accent-rgb),0.38)',
                    boxShadow: '0 0 12px rgba(var(--accent-rgb),0.28)',
                  }
                : {}
            }
          >
            <Icon size={13} />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Right (desktop): Active sessions + Env switcher + Org switcher + user actions */}
      <div className="hidden md:flex items-center gap-2">
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
              <Building2 size={12} style={{ color: 'var(--accent-400)' }} />
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
                          background: 'rgba(var(--accent-rgb),0.15)',
                          color: 'var(--accent-400)',
                          border: '1px solid rgba(var(--accent-rgb),0.25)',
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

        {/* BullMQ worker chip — visible only when active or queued, so it
            doesn't sit permanently in the topbar with "0 running 0 queued". */}
        <WorkerStatusChip />

        {/* Work session badge — shows live QA activity stats */}
        <WorkSessionBadge />

        {/* Notification bell */}
        <NotificationBell />

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center overflow-hidden shrink-0"
          style={{
            background: 'rgba(var(--accent-rgb),0.20)',
            border: '1px solid rgba(var(--accent-rgb),0.35)',
          }}
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <User size={14} style={{ color: 'var(--accent-300)' }} />
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

      {/* Right (mobile): notifications + hamburger. The secondary desktop
          controls (env/org switchers, worker + session chips) move into the
          drawer or are desktop-only context, keeping the mobile bar uncluttered. */}
      <div className="flex md:hidden items-center gap-2">
        <NotificationBell />
        <button
          onClick={() => setMobileOpen(true)}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'rgba(238,238,248,0.80)',
          }}
          aria-label="Open menu"
        >
          <Menu size={18} />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.60)', backdropFilter: 'blur(2px)' }}
            onClick={() => setMobileOpen(false)}
          />
          {/* Panel */}
          <div
            className="absolute right-0 top-0 bottom-0 w-[82vw] max-w-xs flex flex-col"
            style={{
              background: 'rgba(14,14,24,0.98)',
              borderLeft: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '-8px 0 40px rgba(0,0,0,0.60)',
            }}
          >
            {/* Header: user + close */}
            <div
              className="flex items-center justify-between gap-3 px-4 py-3.5 border-b"
              style={{ borderColor: 'rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center overflow-hidden shrink-0"
                  style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.35)' }}
                >
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                  ) : (
                    <User size={16} style={{ color: 'var(--accent-300)' }} />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>
                    {user?.name ?? 'Account'}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'rgba(238,238,248,0.45)' }}>
                    {user?.email}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(238,238,248,0.60)' }}
                aria-label="Close menu"
              >
                <X size={16} />
              </button>
            </div>

            {/* Nav links */}
            <nav className="flex-1 overflow-y-auto py-2">
              {NAV.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                      isActive ? 'text-white' : 'text-white/60',
                    )
                  }
                  style={({ isActive }) =>
                    isActive ? { background: 'rgba(var(--accent-rgb),0.18)' } : {}
                  }
                >
                  <Icon size={17} />
                  {label}
                </NavLink>
              ))}

              {/* Org switcher (non-platform-admins with orgs) */}
              {!isPlatformAdmin && orgs.length > 0 && (
                <div className="mt-2 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
                  <div className="px-4 py-1.5 text-xs uppercase tracking-wide" style={{ color: 'rgba(238,238,248,0.30)' }}>
                    Organisation
                  </div>
                  {orgs.map((m) => (
                    <button
                      key={m.orgId}
                      onClick={() => { handleSwitchOrg(m.orgId); setMobileOpen(false); }}
                      disabled={switchingOrg === m.orgId}
                      className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left transition-colors"
                      style={{ color: 'rgba(238,238,248,0.78)' }}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Building2 size={15} style={{ color: 'var(--accent-400)' }} className="shrink-0" />
                        <span className="truncate">{m.org.name}</span>
                      </span>
                      {m.orgId === activeOrgId && <Check size={14} style={{ color: '#34d399' }} className="shrink-0" />}
                    </button>
                  ))}
                </div>
              )}
            </nav>

            {/* Logout */}
            <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
              <button
                onClick={() => { setMobileOpen(false); handleLogout(); }}
                className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(238,238,248,0.80)',
                }}
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout confirmation — replaces the native window.confirm() */}
      <Modal
        open={logoutConfirmOpen}
        onClose={() => { if (!loggingOut) setLogoutConfirmOpen(false); }}
        title="Log out?"
        size="sm"
      >
        <div className="space-y-5">
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(238,238,248,0.65)' }}>
            You'll be signed out on this device. Any in-progress test session will be
            ended and saved.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLogoutConfirmOpen(false)}
              disabled={loggingOut}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={loggingOut}
              onClick={performLogout}
            >
              <LogOut size={13} /> Log out
            </Button>
          </div>
        </div>
      </Modal>
    </header>
  );
}
