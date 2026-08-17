'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, LogIn, LogOut, MapPin } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import api from '@/lib/api';
import AttendanceStatusBadges from '@/components/AttendanceStatusBadges';

function getLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Your browser does not support location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Location access was denied. Enable it in your browser settings to mark attendance.')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

/**
 * Compact check-in / check-out card for the employee dashboard.
 * Same APIs as the Attendance self-service tab.
 */
export default function AttendanceCheckWidget() {
  const qc = useQueryClient();
  const [locating, setLocating] = useState<'in' | 'out' | null>(null);

  const { data: attendanceStatus, refetch } = useQuery({
    queryKey: ['hr-me-attendance-status'],
    queryFn: () => api.get('/hr/me/attendance/status').then((r) => r.data),
    refetchInterval: 60_000,
  });
  const todayRecord = attendanceStatus?.record || null;

  const checkInMutation = useMutation({
    mutationFn: (payload: { lat: number; lng: number }) =>
      api.post('/hr/me/attendance/check-in', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-me-attendance'] });
      qc.invalidateQueries({ queryKey: ['hr-me-attendance-status'] });
      toast.success('Checked in.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Check-in failed.'),
  });

  const checkOutMutation = useMutation({
    mutationFn: (payload: { lat: number; lng: number }) =>
      api.post('/hr/me/attendance/check-out', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-me-attendance'] });
      qc.invalidateQueries({ queryKey: ['hr-me-attendance-status'] });
      toast.success('Checked out.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Check-out failed.'),
  });

  async function handleCheckIn() {
    setLocating('in');
    try {
      const coords = await getLocation();
      await checkInMutation.mutateAsync(coords);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Could not get your location.');
    } finally {
      setLocating(null);
    }
  }

  async function handleCheckOut() {
    setLocating('out');
    try {
      const coords = await getLocation();
      await checkOutMutation.mutateAsync(coords);
      refetch();
    } catch (e: any) {
      toast.error(e.message || 'Could not get your location.');
    } finally {
      setLocating(null);
    }
  }

  // Admins, super admins and partners don't clock in against a shift — the
  // server reports applicable:false for them and the card is hidden entirely
  // rather than shown perpetually reading "Not checked in yet".
  if (attendanceStatus && attendanceStatus.applicable === false) return null;

  const holiday = attendanceStatus?.holiday || null;
  const isWeekend = !!attendanceStatus?.weekend;
  const shift = attendanceStatus?.shift || null;
  const weekendDays: number[] = attendanceStatus?.weekendDays ?? [0, 6];
  const workedWeekendOvertime = isWeekend && !!todayRecord?.checkIn;

  const statusLabel = holiday
    ? `Public holiday — ${holiday.name}`
    : isWeekend && !todayRecord?.checkIn
      ? 'Weekly off — check in if you are working overtime'
    : !todayRecord?.checkIn
      ? 'Not checked in yet'
      : !todayRecord?.checkOut
        ? `Checked in at ${todayRecord.checkIn?.slice(0, 5)}${isWeekend ? ' (overtime)' : ''}`
        : `Done — ${todayRecord.checkIn?.slice(0, 5)} → ${todayRecord.checkOut?.slice(0, 5)}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-brand-700" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-900">Today&apos;s Attendance</h3>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                <MapPin className="w-3 h-3" />
                Location required
              </span>
              {workedWeekendOvertime && todayRecord && (
                <AttendanceStatusBadges record={todayRecord} weekendDays={weekendDays} />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{statusLabel}</p>
            {shift?.startTime && (
              <p className="text-[11px] text-gray-400 mt-0.5">
                Shift {shift.startTime}–{shift.endTime}
                {shift.scheduleLabel && <span className="ml-1 text-brand-700 font-medium">· {shift.scheduleLabel}</span>}
                {isWeekend && !todayRecord?.checkOut && (
                  <span className="ml-1 text-purple-700 font-medium">· Weekend overtime available</span>
                )}
              </p>
            )}
            <Link
              href="/self-service?tab=attendance"
              className="inline-block text-xs font-medium text-brand-700 hover:text-brand-800 mt-1"
            >
              View full attendance →
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!todayRecord?.checkIn ? (
            <button
              type="button"
              onClick={handleCheckIn}
              disabled={locating === 'in' || checkInMutation.isPending}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors w-full sm:w-auto justify-center"
            >
              <LogIn className="w-4 h-4" />
              {locating === 'in' ? 'Getting location…' : isWeekend ? 'Check In (Overtime)' : 'Check In'}
            </button>
          ) : !todayRecord?.checkOut ? (
            <button
              type="button"
              onClick={handleCheckOut}
              disabled={locating === 'out' || checkOutMutation.isPending}
              className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors w-full sm:w-auto justify-center"
            >
              <LogOut className="w-4 h-4" />
              {locating === 'out' ? 'Getting location…' : 'Check Out'}
            </button>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-brand-800 bg-brand-50 px-3 py-2.5 rounded-lg">
              <CheckCircle className="w-4 h-4" />
              Checked out
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
