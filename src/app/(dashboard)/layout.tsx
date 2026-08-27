'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import Sidebar from '@/components/layout/Sidebar';
import NotificationBridge from '@/components/NotificationBridge';
import MessagesWidget from '@/components/messages/MessagesWidget';
import StaleCheckoutGate from '@/components/attendance/StaleCheckoutGate';
import api from '@/lib/api';
import { requiredPermissionFor } from '@/lib/routePermissions';
import { toast } from 'sonner';

// Employees whose profile isn't complete must finish onboarding before using the app.
const ONBOARDING_PATH = '/self-service';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateBranding = useAuthStore((s) => s.updateBranding);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const isAdmin = user?.role?.key === 'super_admin' || user?.role?.key === 'admin';

  // Route-level permission enforcement. Hiding a Sidebar link only hides the
  // link — it does not stop someone from typing the URL directly, which is
  // exactly what it used to allow (a non-admin user could load /admin, see
  // fully-rendered tabs, and only discover they lacked access when a save
  // failed). requiredPermissionFor() is the single source of truth also used
  // by Sidebar.tsx to decide which links to show.
  const requiredPermission = requiredPermissionFor(pathname);
  const isAuthorizedForRoute = !requiredPermission || hasPermission(requiredPermission);

  // Refresh user+role+branding from server on mount so permissions and the logo/favicon
  // are never stale — branding may have changed in a completely different session.
  useEffect(() => {
    if (!hasHydrated || !user) return;
    api.get('/auth/me').then((r) => {
      if (r.data?.user) updateUser(r.data.user);
      if (r.data?.branding) updateBranding(r.data.branding);
    }).catch(() => {});
  }, [hasHydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the current user's worker record to decide whether onboarding is still required.
  // Shares the ['hr-me'] cache with the self-service page, so submitting the profile there
  // refetches here and lifts the gate automatically.
  const { data: worker } = useQuery({
    queryKey: ['hr-me'],
    queryFn: async () => {
      try {
        const res = await api.get('/hr/me');
        return res.data;
      } catch (e: any) {
        const msg = e?.response?.data?.message || '';
        if (e?.response?.status === 403 && msg.toLowerCase().includes('inactive')) {
          return { status: 'inactive' };
        }
        return null;
      }
    },
    enabled: hasHydrated && !!user && !isAdmin && !user?.mustChangePassword,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
  const needsOnboarding =
    !isAdmin && (worker?.status === 'invited' || worker?.status === 'profile_pending');
  const isInactiveWorker = !isAdmin && worker?.status === 'inactive';

  useEffect(() => {
    if (!hasHydrated || !user || isAdmin) return;
    if (isInactiveWorker) {
      toast.error('Your account has been set to Inactive. Please contact HR.');
      logout();
      router.replace('/login');
    }
  }, [hasHydrated, user, isAdmin, isInactiveWorker, logout, router]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user) { router.replace('/login'); return; }
    // 1) Force temporary-password change first
    if (user.mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
      return;
    }
    if (user.mustChangePassword) return;
    // 2) Then force profile completion for employees who haven't finished onboarding
    if (needsOnboarding && pathname !== ONBOARDING_PATH) {
      router.replace(ONBOARDING_PATH);
      return;
    }
    // 3) Route-level permission gate — bounce anyone who lacks the permission
    // this route requires straight back to the dashboard, before the page's
    // own content (and any data it fetches) ever renders.
    if (!isAuthorizedForRoute) {
      toast.error("You don't have permission to access that page.");
      router.replace('/dashboard');
    }
  }, [user, hasHydrated, pathname, router, needsOnboarding, isAuthorizedForRoute]);

  if (!hasHydrated) return null;
  if (!user) return null;
  if (isInactiveWorker) return null;
  // Never render the page's own content for an unauthorized route, even for a
  // single frame — the redirect above fires from an effect (after render), so
  // without this the actual admin/billing/etc. page (and whatever data it
  // fetches) would still flash on screen first.
  if (!isAuthorizedForRoute) return null;

  // During forced onboarding (or the temporary-password change) hide the sidebar so the
  // user has a single, focused task and can't wander off into a half-accessible app.
  const focusedMode = needsOnboarding || !!user.mustChangePassword;

  if (focusedMode) {
    return (
      <div className="flex h-screen overflow-hidden">
        <main className="flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Session-wide, so message alerts reach you on any screen — not only
          while Messages is open. Renders nothing. */}
      <NotificationBridge />
      {/* Blocking "forgot to check out" popup — mounted here (not on any one
          page) so it's the first thing in front of the user on whichever
          page they land on next. Renders nothing unless a stale open
          session exists. */}
      <StaleCheckoutGate />
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">{children}</main>
      </div>
      <MessagesWidget />
    </div>
  );
}
