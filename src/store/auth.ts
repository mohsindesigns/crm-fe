import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setFavicon } from '@/lib/utils';

export interface Branding {
  brandName: string;
  logoUrl: string | null;
  primaryColor: string;
  customDomain: string | null;
  emailFrom: string | null;
}

export interface Role {
  id: string;
  name: string;
  key: string;
  permissions: Record<string, boolean>;
  color: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  orgId: string;
  avatarUrl: string | null;
  mustChangePassword?: boolean;
  role: Role;
}

interface AuthState {
  user: User | null;
  branding: Branding | null;
  accessToken: string | null;
  refreshToken: string | null;
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;
  setAuth: (user: User, branding: Branding, tokens: { access: string; refresh: string }) => void;
  updateBranding: (branding: Branding) => void;
  updateUser: (updates: Partial<User>) => void;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  /**
   * Only super_admin / admin may deactivate records anywhere in the CRM — mirrors
   * cadence-be/src/middleware/adminOnly.js. Note that nothing is ever destroyed:
   * "delete" buttons deactivate, and an admin can reactivate afterwards.
   */
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      branding: null,
      accessToken: null,
      refreshToken: null,
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      setAuth: (user, branding, tokens) => {
        localStorage.setItem('access_token', tokens.access);
        localStorage.setItem('refresh_token', tokens.refresh);
        set({ user, branding, accessToken: tokens.access, refreshToken: tokens.refresh });
        setFavicon(branding?.logoUrl);
      },

      updateBranding: (branding) => {
        set({ branding });
        setFavicon(branding?.logoUrl);
      },

      updateUser: (updates) => {
        const { user } = get();
        if (user) set({ user: { ...user, ...updates } });
      },

      logout: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, branding: null, accessToken: null, refreshToken: null });
      },

      hasPermission: (permission: string) => {
        const { user } = get();
        if (!user) return false;
        const roleKey = user.role?.key;
        if (roleKey === 'super_admin' || roleKey === 'admin') return true;
        return Boolean(user.role?.permissions?.[permission]);
      },

      isAdmin: () => {
        const roleKey = get().user?.role?.key;
        return roleKey === 'super_admin' || roleKey === 'admin';
      },
    }),
    {
      name: 'cadence-auth',
      partialize: (state) => ({
        user: state.user,
        branding: state.branding,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        if (state?.branding?.logoUrl) setFavicon(state.branding.logoUrl);
      },
    }
  )
);
