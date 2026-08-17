'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import api from '@/lib/api';

/** Full-screen Messages shell — no CRM sidebar (takeover mode). */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const updateUser = useAuthStore((s) => s.updateUser);
  const updateBranding = useAuthStore((s) => s.updateBranding);
  const canAccess = hasPermission('projects.read');
  // Prevent /auth/me → updateUser → effect → /auth/me loop (user identity in deps).
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!canAccess) {
      router.replace('/dashboard');
      return;
    }
    if (refreshedRef.current) return;
    refreshedRef.current = true;
    api.get('/auth/me').then((r) => {
      if (r.data?.user) updateUser(r.data.user);
      if (r.data?.branding) updateBranding(r.data.branding);
    }).catch(() => {});
  }, [hasHydrated, user?.id, canAccess, router, updateUser, updateBranding]);

  if (!hasHydrated || !user || !canAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-100">
      {children}
    </div>
  );
}
