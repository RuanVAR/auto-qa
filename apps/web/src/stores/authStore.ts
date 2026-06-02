import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OrgMembership {
  orgId: string;
  role: string;
  org: { id: string; name: string; slug: string; logoUrl?: string | null; primaryColor?: string | null };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  platformRole: 'USER' | 'PLATFORM_ADMIN';
  accountStatus: string;
  lastActiveOrgId: string | null;
  orgMemberships: OrgMembership[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  activeOrgId: string | null;
  orgRole: string | null;

  setAuth: (token: string, platformRole: string, activeOrgId: string | null, orgRole: string | null) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  switchOrg: (orgId: string, orgRole: string, newToken: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      activeOrgId: null,
      orgRole: null,

      setAuth: (token, _platformRole, activeOrgId, orgRole) =>
        set({ token, activeOrgId, orgRole }),

      setUser: (user) =>
        set({ user }),

      logout: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ token: null, user: null, activeOrgId: null, orgRole: null });
      },

      switchOrg: (orgId, orgRole, newToken) => {
        localStorage.setItem('access_token', newToken);
        set({ activeOrgId: orgId, orgRole, token: newToken });
      },
    }),
    {
      name: 'qa-auth',
      partialize: (state) => ({
        token: state.token,
        activeOrgId: state.activeOrgId,
        orgRole: state.orgRole,
      }),
    },
  ),
);

// Simple helper hooks
export const useIsAuthenticated = () => !!useAuthStore((s) => s.token);
export const useIsPlatformAdmin = () => useAuthStore((s) => s.user?.platformRole === 'PLATFORM_ADMIN');
export const useIsOrgAdmin = () => useAuthStore((s) => s.orgRole === 'ORG_ADMIN');
export const useActiveOrg = () => {
  const { user, activeOrgId } = useAuthStore();
  return user?.orgMemberships.find((m) => m.orgId === activeOrgId) ?? null;
};
