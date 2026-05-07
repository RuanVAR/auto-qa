import { useState } from 'react';
import { Settings, Moon, Sun, Monitor, Bell, Shield, Palette, Link2, Smartphone } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LinkedAccountsSection } from './LinkedAccountsSection';
import { ChangePasswordSection } from './ChangePasswordSection';
import { ActiveSessionsSection } from './ActiveSessionsSection';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

type Theme = 'light' | 'dark' | 'system';

const themes: { value: Theme; label: string; icon: React.ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun size={14} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
  { value: 'system', label: 'System', icon: <Monitor size={14} /> },
];

export function SettingsPage() {
  const [theme, setTheme] = useState<Theme>((localStorage.getItem('theme') as Theme) ?? 'system');
  const [notifyEmail, setNotifyEmail] = useState(localStorage.getItem('notify_email') === 'true');
  const [notifySlack, setNotifySlack] = useState(localStorage.getItem('notify_slack') === 'true');

  const saveTheme = (t: Theme) => {
    setTheme(t);
    localStorage.setItem('theme', t);
  };

  const toggleNotify = (key: string, val: boolean, setter: (v: boolean) => void) => {
    setter(val);
    localStorage.setItem(key, String(val));
  };

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

      {/* Appearance */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-gray-500" />
            <CardTitle>Appearance</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Theme</label>
              <div className="flex gap-2">
                {themes.map(t => (
                  <button
                    key={t.value}
                    onClick={() => saveTheme(t.value)}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      theme === t.value
                        ? 'border-sky-500 bg-sky-50 text-sky-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">Theme preference is stored locally and applies to this browser.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-gray-500" />
            <CardTitle>Notifications</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <ToggleRow
              label="Email notifications"
              description="Receive run completion summaries via email"
              value={notifyEmail}
              onChange={v => toggleNotify('notify_email', v, setNotifyEmail)}
            />
            <ToggleRow
              label="Slack notifications"
              description="Post run results to your configured Slack channel"
              value={notifySlack}
              onChange={v => toggleNotify('notify_slack', v, setNotifySlack)}
            />
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Configure notification channels in <a href="/admin" className="text-sky-600 hover:underline">Admin → Configuration</a>.
          </p>
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

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        <div className="text-xs text-gray-400">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${value ? 'bg-sky-500' : 'bg-gray-200'}`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}
