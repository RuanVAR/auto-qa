import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/lib/api';
import { SettingsPage } from './SettingsPage';

const authState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    platformRole: 'USER' as const,
    accountStatus: 'ACTIVE',
    lastActiveOrgId: 'org-1',
    notificationPrefs: {
      CODE_INDEX_READY: { inApp: true, email: false },
    },
    orgMemberships: [],
  },
  setUser: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  authApi: {
    me: vi.fn(),
    updateNotificationPrefs: vi.fn(),
    logout: vi.fn(),
    logoutAll: vi.fn(),
  },
}));
vi.mock('@/stores/authStore', () => {
  const useAuthStore = <T,>(
    selector: (state: typeof authState) => T,
  ): T => selector(authState);
  return {
    useAuthStore: Object.assign(useAuthStore, {
      getState: () => authState,
    }),
  };
});
vi.mock('./LinkedAccountsSection', () => ({ LinkedAccountsSection: () => null }));
vi.mock('./ChangePasswordSection', () => ({ ChangePasswordSection: () => null }));
vi.mock('./ActiveSessionsSection', () => ({ ActiveSessionsSection: () => null }));
vi.mock('./ApiTokensSection', () => ({ ApiTokensSection: () => null }));
vi.mock('./ClickUpPersonalTokenSection', () => ({ ClickUpPersonalTokenSection: () => null }));

describe('SettingsPage code-index preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      platformRole: 'USER' as const,
      accountStatus: 'ACTIVE',
      lastActiveOrgId: 'org-1',
      notificationPrefs: {
        CODE_INDEX_READY: { inApp: true, email: false },
      },
      orgMemberships: [],
    };
    vi.mocked(authApi.me).mockResolvedValue(user);
    vi.mocked(authApi.updateNotificationPrefs).mockImplementation(async (prefs) => ({
      id: 'user-1',
      notificationPrefs: prefs,
    }));
  });

  it('persists ready and failed channel preferences through the API', async () => {
    renderSettings();
    const emailToggles = await screen.findAllByLabelText('Email notifications');

    expect(emailToggles[0]).toHaveAttribute('aria-checked', 'false');
    expect(emailToggles[1]).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(emailToggles[0]);

    expect(authApi.updateNotificationPrefs).toHaveBeenCalledWith({
      CODE_INDEX_READY: { inApp: true, email: true },
    });
  });
});

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}
