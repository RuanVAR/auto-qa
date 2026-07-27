import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Settings, Bell, Shield, Link2, Smartphone, KeyRound } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkedAccountsSection } from './LinkedAccountsSection';
import { ChangePasswordSection } from './ChangePasswordSection';
import { ActiveSessionsSection } from './ActiveSessionsSection';
import { ApiTokensSection } from './ApiTokensSection';
import { ClickUpPersonalTokenSection } from './ClickUpPersonalTokenSection';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

export function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
          <Settings size={16} className="text-gray-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900">Settings</h2>
          <p className="text-sm text-gray-500 mt-0.5">Preferences and account configuration</p>
        </div>
      </div>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-gray-500" />
            <CardTitle>Notifications</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <IndexNotificationPreferences />
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield size={14} className="text-gray-500" />
            <CardTitle>Account</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">API Access</label>
              <p className="text-sm text-gray-700">
                Use the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">Authorization: Bearer &lt;token&gt;</code> header on all API requests.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Access tokens expire after 15 minutes — the app refreshes them automatically using a 7-day refresh token.
              </p>
            </div>
            <div className="pt-2 flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  // Proper sign-out: revoke server-side state first so the
                  // residual access window collapses, then clear local creds.
                  try { await authApi.logout(); } catch { /* ignore */ }
                  useAuthStore.getState().logout();
                  window.location.href = '/login';
                }}
              >
                Sign out
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={async () => {
                  if (!confirm('Sign out of every device? You will need to log in again on each browser/computer.')) return;
                  try { await authApi.logoutAll(); } catch { /* ignore */ }
                  useAuthStore.getState().logout();
                  window.location.href = '/login';
                }}
              >
                Sign out everywhere
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security — Linked Accounts & Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 size={14} className="text-gray-500" />
            <CardTitle>Security</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <LinkedAccountsSection />
            <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <ChangePasswordSection />
          </div>
        </CardContent>
      </Card>

      {/* Developer access — personal access tokens for the MCP server + API. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-gray-500" />
            <CardTitle>Developer access (MCP / API tokens)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ApiTokensSection />
        </CardContent>
      </Card>

      {/* ClickUp personal token — self-renders only when ClickUp is installed. */}
      <ClickUpPersonalTokenSection />

      {/* Active sessions — refresh-token rows. Per-device revoke. */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone size={14} className="text-gray-500" />
            <CardTitle>Active sessions</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ActiveSessionsSection />
        </CardContent>
      </Card>
    </div>
  );
}

type IndexNotificationType = 'CODE_INDEX_READY' | 'CODE_INDEX_FAILED';
type ChannelPrefs = { inApp: boolean; email: boolean };
type NotificationPrefs = Record<string, ChannelPrefs>;

function IndexNotificationPreferences() {
  const storeUser = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const profileQuery = useQuery({
    queryKey: ['auth-me'],
    queryFn: authApi.me,
    initialData: storeUser ?? undefined,
  });
  const [prefs, setPrefs] = useState<NotificationPrefs>({});

  useEffect(() => {
    const saved = profileQuery.data?.notificationPrefs;
    if (saved && typeof saved === 'object') {
      setPrefs(saved as NotificationPrefs);
    }
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (next: NotificationPrefs) => authApi.updateNotificationPrefs(next),
    onSuccess: (result) => {
      if (!storeUser) return;
      setUser({
        ...storeUser,
        notificationPrefs: result.notificationPrefs as NotificationPrefs,
      });
    },
  });
  const resolved = (type: IndexNotificationType): ChannelPrefs => {
    const defaults = type === 'CODE_INDEX_FAILED'
      ? { inApp: true, email: true }
      : { inApp: true, email: false };
    return { ...defaults, ...(prefs[type] ?? {}) };
  };
  const update = (
    type: IndexNotificationType,
    channel: keyof ChannelPrefs,
    value: boolean,
  ) => {
    const next = {
      ...prefs,
      [type]: { ...resolved(type), [channel]: value },
    };
    setPrefs(next);
    saveMutation.mutate(next);
  };

  return (
    <div className="divide-y divide-gray-200 dark:divide-white/10">
      <NotificationChannelRow
        label="Repository index ready"
        values={resolved('CODE_INDEX_READY')}
        disabled={saveMutation.isPending}
        onChange={(channel, value) => update('CODE_INDEX_READY', channel, value)}
      />
      <NotificationChannelRow
        label="Repository index failed"
        values={resolved('CODE_INDEX_FAILED')}
        disabled={saveMutation.isPending}
        onChange={(channel, value) => update('CODE_INDEX_FAILED', channel, value)}
      />
      {saveMutation.isError && (
        <p className="pt-3 text-xs text-red-600 dark:text-red-300">
          Notification preferences could not be saved.
        </p>
      )}
    </div>
  );
}

function NotificationChannelRow({
  label,
  values,
  disabled,
  onChange,
}: {
  label: string;
  values: ChannelPrefs;
  disabled: boolean;
  onChange: (channel: keyof ChannelPrefs, value: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="text-sm font-medium text-gray-700 dark:text-slate-200">{label}</div>
      <div className="flex items-center gap-4">
        <ChannelToggle
          label="In app"
          value={values.inApp}
          disabled={disabled}
          onChange={(value) => onChange('inApp', value)}
        />
        <ChannelToggle
          label="Email"
          value={values.email}
          disabled={disabled}
          onChange={(value) => onChange('email', value)}
        />
      </div>
    </div>
  );
}

function ChannelToggle({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400">
      {label}
      <button
        type="button"
        role="switch"
        aria-label={`${label} notifications`}
        aria-checked={value}
        disabled={disabled}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${value ? 'bg-sky-500' : 'bg-gray-200 dark:bg-slate-700'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}
