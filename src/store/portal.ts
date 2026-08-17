import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { setFavicon } from '@/lib/utils';

interface PortalContact {
  id: string;
  name: string;
  email: string;
  role: string | null;
}

interface PortalClient {
  id: string;
  name: string;
  currency: string;
}

export interface PortalBranding {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
}

interface PortalState {
  token: string | null;
  contact: PortalContact | null;
  client: PortalClient | null;
  branding: PortalBranding | null;
  hasHydrated: boolean;
  login: (token: string, contact: PortalContact, client: PortalClient, branding: PortalBranding) => void;
  setBranding: (branding: PortalBranding) => void;
  logout: () => void;
  setHydrated: () => void;
}

export const usePortalStore = create<PortalState>()(
  persist(
    (set) => ({
      token: null,
      contact: null,
      client: null,
      branding: null,
      hasHydrated: false,
      login: (token, contact, client, branding) => {
        set({ token, contact, client, branding });
        setFavicon(branding?.logoUrl);
      },
      setBranding: (branding) => {
        set({ branding });
        setFavicon(branding?.logoUrl);
      },
      logout: () => set({ token: null, contact: null, client: null }),
      setHydrated: () => set({ hasHydrated: true }),
    }),
    {
      name: 'portal-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHydrated();
        if (state?.branding?.logoUrl) setFavicon(state.branding.logoUrl);
      },
    }
  )
);
