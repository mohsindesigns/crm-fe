'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// Blocking "you forgot to check out" popup — fires when a check-in from a
// PREVIOUS attendance day is still open (see openSessionIsStale on
// GET /hr/me/attendance/status). Mounted once at the dashboard layout level,
// same pattern as NotificationBridge, so it's the very first thing an
// employee sees on whichever page they land on next — not a widget buried
// in Self Service they could easily miss. Deliberately has no dismiss/close:
// resolving it is the only way past it, same spirit as the forced
// password-change / onboarding gates in layout.tsx.
export default function StaleCheckoutGate() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role?.key === 'super_admin' || user?.role?.key === 'admin';

  // Shares the ['hr-me'] cache with layout.tsx and the self-service page —
  // no extra fetch beyond whatever already populated it.
  const { data: worker } = useQuery({
    queryKey: ['hr-me'],
    queryFn: () => api.get('/hr/me').then((r) => r.data).catch(() => null),
    enabled: !!user && !isAdmin,
  });

  // Same query key the self-service attendance widget uses, so resolving
  // the popup here also refreshes that widget without a separate invalidation.
  const { data: status } = useQuery({
    queryKey: ['hr-me-attendance-status'],
    queryFn: () => api.get('/hr/me/attendance/status').then((r) => r.data),
    enabled: !!user && !isAdmin && !!worker,
    refetchInterval: 60_000,
  });

  const stale = !!(status?.applicable && status?.openSessionIsStale && status?.openSession);
  const openSession = status?.openSession;

  const [checkOutTime, setCheckOutTime] = useState('');
  useEffect(() => {
    if (stale) setCheckOutTime(status?.openSessionSuggestedCheckOut || '');
  }, [stale, openSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (time: string) =>
      api.post('/hr/me/attendance/check-out-late', { checkOutTime: time }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-me-attendance-status'] });
      qc.invalidateQueries({ queryKey: ['hr-me-attendance'] });
      toast.success("Checked out — that day's attendance is settled.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save that check-out time.'),
  });

  if (!stale || !openSession) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">You forgot to check out</h2>
            <p className="text-xs text-gray-500 mt-1">
              You checked in on {openSession.date} at {String(openSession.checkIn).slice(0, 5)} and never checked
              out. Enter the time you actually left so that day&apos;s attendance is recorded correctly.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">
            Check-out time on {openSession.date}
          </label>
          <input
            type="time"
            value={checkOutTime}
            onChange={(e) => setCheckOutTime(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
        </div>

        {mutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {(mutation.error as any)?.response?.data?.message || 'Could not save that check-out time.'}
          </p>
        )}

        <button
          onClick={() => checkOutTime && mutation.mutate(checkOutTime)}
          disabled={!checkOutTime || mutation.isPending}
          className="w-full bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
        >
          {mutation.isPending ? 'Saving…' : 'Save check-out time'}
        </button>
      </div>
    </div>
  );
}
