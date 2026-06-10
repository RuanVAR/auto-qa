import { useState } from 'react';
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
  const [notifyEmail, setNotifyEmail] = useState(localStorage.getItem('notify_email') === 'true');

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
          </div>
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
