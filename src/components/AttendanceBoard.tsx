'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MapPin, MapPinOff, Pencil, CalendarCheck } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Pagination from '@/components/Pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn, formatPeriod, titleCase } from '@/lib/utils';
import { attendanceSourceLabel, shouldTreatUnmarkedAsAbsent, nowInKarachi } from '@/lib/attendanceDate';
import AttendanceStatusBadges, { attendanceLabelClass } from '@/components/AttendanceStatusBadges';
import { marksAttendance } from '@/lib/routePermissions';
import { useAuthStore } from '@/store/auth';

const MARKABLE_STATUSES = ['present', 'absent', 'leave', 'half_day', 'holiday', 'weekend'];

// Org-wide attendance: Attendance Log, Today's Attendance, manual marking, and Monthly Summary.
//
// Attendance is normally self-marked by each employee (GPS check-in), so this is
// primarily a review surface — but people do forget to check in, and there was
// previously no way to record a day that was genuinely worked. Admins with
// hr.manage can now correct any single day, and mark a whole day at once (a
// public holiday, or sweeping a day's non-markers as absent).
const EMPLOYEE_LINK_CLASS = 'text-brand-700 underline underline-offset-2 decoration-brand-300 hover:text-brand-900 hover:decoration-brand-700 cursor-pointer';

function workerAttendanceHref(workerId: string, month: string) {
  return `/hr/workers/${workerId}?tab=attendance&month=${month}`;
}

export default function AttendanceBoard() {
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManage = hasPermission('hr.manage');
  // Which worker/date cell is being edited, plus the row being composed.
  const [markForm, setMarkForm] = useState<{
    workerId: string; date: string; status: string; checkIn: string; checkOut: string; note: string;
  } | null>(null);
  const [bulkForm, setBulkForm] = useState<{ date: string; status: string; note: string; overwrite: boolean } | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attLogPage, setAttLogPage] = useState(1);
  useEffect(() => { setAttLogPage(1); }, [month]);
  // Attendance Log's exact-date filter — when set, the log switches from "every
  // record this month" to "every active worker's status on this one day"
  // (including the ones with no record at all, so it's actually possible to see
  // who hasn't marked).
  const [logDate, setLogDate] = useState(() => nowInKarachi().date);

  const { data: workers = [], isLoading: loadingWorkers } = useQuery({
    queryKey: ['hr-workers'],
    queryFn: () => api.get('/hr/workers').then((r) => r.data),
  });

  const { data: attendanceResp, isLoading: loadingAttendance } = useQuery({
    queryKey: ['hr-attendance', month, attLogPage],
    queryFn: () => api.get('/hr/attendance', { params: { month, page: attLogPage, limit: 50 } }).then((r) => r.data),
  });
  const attendance: any[] = attendanceResp?.data || [];

  const { data: attendanceSummary, isLoading: loadingAttSummary } = useQuery({
    queryKey: ['hr-attendance-summary', month],
    queryFn: () => api.get('/hr/attendance/summary', { params: { month } }).then((r) => r.data),
  });

  const { data: logDateResp, isLoading: loadingLogDate } = useQuery({
    queryKey: ['hr-attendance-day', logDate],
    queryFn: () => api.get('/hr/attendance', { params: { date: logDate, page: 1, limit: 500 } }).then((r) => r.data),
    enabled: !!logDate,
  });
  const logDateAttendance: any[] = logDateResp?.data || [];

  // Same "attendance day" the self-marking flow uses (Asia/Karachi, 12PM→12PM
  // shift), not the browser's local date — so this always matches what today's
  // check-ins actually landed on.
  const today = nowInKarachi().date;
  const { data: todayResp, isLoading: loadingToday } = useQuery({
    queryKey: ['hr-attendance-day', today],
    queryFn: () => api.get('/hr/attendance', { params: { date: today, page: 1, limit: 500 } }).then((r) => r.data),
  });
  const todayAttendance: any[] = todayResp?.data || [];

  // Admins, super admins and partners never mark attendance, so they're not
  // listed in the roll call and can't be marked absent for it.
  const isAttendanceWorker = (w: any) => w.status === 'active' && marksAttendance(w.user?.role?.key);
  const activeWorkers = (workers as any[]).filter(isAttendanceWorker);

  const todayCounts = activeWorkers.reduce((acc: Record<string, number>, w: any) => {
    const rec = todayAttendance.find((x: any) => x.workerId === w.id);
    const status = rec?.status || (shouldTreatUnmarkedAsAbsent(today) ? 'absent' : 'not_marked');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  function refreshAttendance() {
    qc.invalidateQueries({ queryKey: ['hr-attendance'] });
    qc.invalidateQueries({ queryKey: ['hr-attendance-day'] });
    qc.invalidateQueries({ queryKey: ['hr-attendance-summary'] });
  }

  const markAttendance = useMutation({
    mutationFn: (payload: any) => api.post('/hr/attendance', payload).then((r) => r.data),
    onSuccess: () => {
      refreshAttendance();
      setMarkForm(null);
      toast.success('Attendance recorded.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not record attendance.'),
  });

  const bulkMark = useMutation({
    mutationFn: (payload: any) => api.post('/hr/attendance/bulk-mark', payload).then((r) => r.data),
    onSuccess: (data: any) => {
      refreshAttendance();
      setBulkForm(null);
      toast.success(
        `Marked ${data?.marked ?? 0} employee(s) for ${data?.date}`
        + (data?.skipped ? ` · ${data.skipped} already had a record and were left alone.` : '.')
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bulk marking failed.'),
  });

  function openMarkForm(workerId: string, date: string, existing?: any) {
    setMarkForm({
      workerId,
      date,
      status: existing?.status || 'present',
      checkIn: existing?.checkIn ? String(existing.checkIn).slice(0, 5) : '',
      checkOut: existing?.checkOut ? String(existing.checkOut).slice(0, 5) : '',
      note: existing?.note || '',
    });
  }

  return (
    <div className="space-y-5">
      {/* Attendance Log */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Attendance Log</h3>
            {logDate && (
              <p className="text-xs text-gray-400 mt-0.5">
                Every active worker for this day — including anyone who hasn&apos;t marked yet
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!logDate && (
              <input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            )}
            <input
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              placeholder="Pick an exact date"
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            {logDate && (
              <button
                onClick={() => setLogDate('')}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1.5"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="w-full min-w-160">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Worker</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Date</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check In</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check Out</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Source</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                {canManage && logDate && <TableHead className="px-5 py-3 w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100">
              {logDate ? (
                loadingLogDate || loadingWorkers ? (
                  <TableRow><TableCell colSpan={canManage ? 7 : 6} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
                ) : activeWorkers.length === 0 ? (
                  <TableRow><TableCell colSpan={canManage ? 7 : 6} className="px-5 py-8 text-sm text-gray-400 text-center">No active workers found.</TableCell></TableRow>
                ) : (
                  activeWorkers
                    .map((w: any) => ({ w, a: logDateAttendance.find((x: any) => x.workerId === w.id) }))
                    // Not-marked first — that's the whole point of picking a specific day.
                    .sort((x, y) => (x.a ? 1 : 0) - (y.a ? 1 : 0))
                    .map(({ w, a }) => {
                      const mapLink = (lat: any, lng: any) =>
                        lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
                      const checkInMap = a ? mapLink(a.checkInLat, a.checkInLng) : null;
                      const checkOutMap = a ? mapLink(a.checkOutLat, a.checkOutLng) : null;
                      const showAbsent = !a && logDate && shouldTreatUnmarkedAsAbsent(logDate);
                      const displayStatus = a?.status || (showAbsent ? 'absent' : null);
                      return (
                        <TableRow key={w.id} className={cn('hover:bg-gray-50', !a && !showAbsent && 'bg-amber-50/40', showAbsent && 'bg-red-50/30')}>
                          <TableCell className="px-5 py-3.5 text-sm font-medium">
                            {w.id ? (
                              <Link href={workerAttendanceHref(w.id, month)} className={EMPLOYEE_LINK_CLASS}>
                                {w.user?.name}
                              </Link>
                            ) : (
                              <span className="text-gray-900">{w.user?.name}</span>
                            )}
                          </TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">{logDate}</TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                            {a?.checkIn ? (
                              <span className="flex items-center gap-1.5">
                                {a.checkIn.slice(0, 5)}
                                {checkInMap ? (
                                  <a href={checkInMap} target="_blank" rel="noreferrer" title="View check-in location" className="text-brand-700 hover:text-brand-900">
                                    <MapPin className="w-3.5 h-3.5" />
                                  </a>
                                ) : (
                                  <MapPinOff className="w-3.5 h-3.5 text-gray-300" />
                                )}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                            {a?.checkOut ? (
                              <span className="flex items-center gap-1.5">
                                {a.checkOut.slice(0, 5)}
                                {checkOutMap ? (
                                  <a href={checkOutMap} target="_blank" rel="noreferrer" title="View check-out location" className="text-brand-700 hover:text-brand-900">
                                    <MapPin className="w-3.5 h-3.5" />
                                  </a>
                                ) : (
                                  <MapPinOff className="w-3.5 h-3.5 text-gray-300" />
                                )}
                              </span>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="px-5 py-3.5">
                            {a && (
                              <span className={cn('px-2 py-0.5 text-[10px] font-medium rounded-full uppercase tracking-wide',
                                a.source === 'self' ? 'bg-violet-50 text-violet-600'
                                  : a.source === 'system' ? 'bg-slate-100 text-slate-600'
                                    : 'bg-gray-100 text-gray-500')}>
                                {attendanceSourceLabel(a.source)}
                              </span>
                            )}
                            {showAbsent && (
                              <span className="px-2 py-0.5 text-[10px] font-medium rounded-full uppercase tracking-wide bg-slate-100 text-slate-600">
                                System
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-5 py-3.5">
                            {displayStatus ? (
                              a ? (
                                <AttendanceStatusBadges record={a} />
                              ) : showAbsent ? (
                                <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', attendanceLabelClass('Absent'))}>
                                  Absent
                                </span>
                              ) : null
                            ) : (
                              <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', attendanceLabelClass('Not Marked'))}>
                                Not Marked
                              </span>
                            )}
                          </TableCell>
                          {canManage && (
                            <TableCell className="px-5 py-3.5 text-right">
                              <button
                                type="button"
                                title={a ? 'Correct this record' : 'Mark this employee for this day'}
                                onClick={() => openMarkForm(w.id, logDate, a)}
                                className="p-1.5 text-gray-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })
                )
              ) : loadingAttendance ? (
                <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
              ) : attendance.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">No attendance records for this month.</TableCell></TableRow>
              ) : (
                (attendance as any[]).map((a: any) => {
                  const mapLink = (lat: any, lng: any) =>
                    lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
                  const checkInMap = mapLink(a.checkInLat, a.checkInLng);
                  const checkOutMap = mapLink(a.checkOutLat, a.checkOutLng);
                  return (
                  <TableRow key={a.id} className="hover:bg-gray-50">
                    <TableCell className="px-5 py-3.5 text-sm font-medium">
                      {a.workerId || a.worker?.id ? (
                        <Link href={workerAttendanceHref(String(a.workerId || a.worker?.id), month)} className={EMPLOYEE_LINK_CLASS}>
                          {a.worker?.user?.name}
                        </Link>
                      ) : (
                        <span className="text-gray-900">{a.worker?.user?.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">{(a.date || '').slice(0, 10)}</TableCell>
                    <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                      {a.checkIn ? (
                        <span className="flex items-center gap-1.5">
                          {a.checkIn.slice(0, 5)}
                          {checkInMap ? (
                            <a href={checkInMap} target="_blank" rel="noreferrer" title="View check-in location" className="text-brand-700 hover:text-brand-900">
                              <MapPin className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <MapPinOff className="w-3.5 h-3.5 text-gray-300" />
                          )}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                      {a.checkOut ? (
                        <span className="flex items-center gap-1.5">
                          {a.checkOut.slice(0, 5)}
                          {checkOutMap ? (
                            <a href={checkOutMap} target="_blank" rel="noreferrer" title="View check-out location" className="text-brand-700 hover:text-brand-900">
                              <MapPin className="w-3.5 h-3.5" />
                            </a>
                          ) : (
                            <MapPinOff className="w-3.5 h-3.5 text-gray-300" />
                          )}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <span className={cn('px-2 py-0.5 text-[10px] font-medium rounded-full uppercase tracking-wide',
                        a.source === 'self' ? 'bg-violet-50 text-violet-600'
                          : a.source === 'system' ? 'bg-slate-100 text-slate-600'
                            : 'bg-gray-100 text-gray-500')}>
                        {attendanceSourceLabel(a.source)}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <AttendanceStatusBadges record={a} />
                    </TableCell>
                  </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
        {!logDate && (
          <Pagination
            page={attendanceResp?.page || 1}
            totalPages={attendanceResp?.totalPages || 1}
            total={attendanceResp?.total || 0}
            limit={attendanceResp?.limit || 50}
            onPageChange={setAttLogPage}
          />
        )}
      </div>

      {/* Today's Attendance — a one-glance roll call, right below the log. */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Today&apos;s Attendance — {today}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Live roll call for {activeWorkers.length} active employee{activeWorkers.length === 1 ? '' : 's'}</p>
          </div>
          {loadingToday || loadingWorkers ? (
            <span className="text-xs text-gray-400">Loading…</span>
          ) : (
            <div className="flex items-center gap-4 text-xs flex-wrap">
              <span className="text-gray-500">Present <strong className="text-brand-800">{todayCounts.present || 0}</strong></span>
              <span className="text-gray-500">Absent <strong className="text-red-600">{todayCounts.absent || 0}</strong></span>
              <span className="text-gray-500">Leave <strong className="text-amber-600">{todayCounts.leave || 0}</strong></span>
              <span className="text-gray-500">Half-day <strong className="text-blue-600">{todayCounts.half_day || 0}</strong></span>
              <span className="text-gray-500">Not marked <strong className="text-gray-900">{todayCounts.not_marked || 0}</strong></span>
              <button
                type="button"
                onClick={() => setLogDate(today)}
                className="text-brand-700 hover:text-brand-900 font-medium underline underline-offset-2 decoration-brand-300"
              >
                View log
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Manual marking — the fallback when someone forgot to check in */}
      {canManage && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Mark attendance manually</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                For anyone who forgot to check in, or to close out a public holiday for the whole team.
                Manual rows are labelled &quot;Admin&quot; in the log below.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMarkForm(markForm
                  ? null
                  : { workerId: '', date: logDate || new Date().toISOString().slice(0, 10), status: 'present', checkIn: '', checkOut: '', note: '' })}
                className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <Pencil className="w-3.5 h-3.5" />
                One employee
              </button>
              <button
                type="button"
                onClick={() => setBulkForm(bulkForm
                  ? null
                  : { date: logDate || new Date().toISOString().slice(0, 10), status: 'holiday', note: '', overwrite: false })}
                className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <CalendarCheck className="w-3.5 h-3.5" />
                Whole day
              </button>
            </div>
          </div>

          {markForm && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1 border-t border-gray-100">
              <div className="lg:col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Employee</label>
                <select
                  value={markForm.workerId}
                  onChange={(e) => setMarkForm({ ...markForm, workerId: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="">Select an employee…</option>
                  {activeWorkers.map((w: any) => (
                    <option key={w.id} value={w.id}>{w.user?.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Date</label>
                <input
                  type="date"
                  value={markForm.date}
                  onChange={(e) => setMarkForm({ ...markForm, date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
                <select
                  value={markForm.status}
                  onChange={(e) => setMarkForm({ ...markForm, status: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  {MARKABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>{titleCase(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Check in</label>
                <input
                  type="time"
                  value={markForm.checkIn}
                  onChange={(e) => setMarkForm({ ...markForm, checkIn: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Check out</label>
                <input
                  type="time"
                  value={markForm.checkOut}
                  onChange={(e) => setMarkForm({ ...markForm, checkOut: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Reason / note</label>
                <input
                  value={markForm.note}
                  onChange={(e) => setMarkForm({ ...markForm, note: e.target.value })}
                  placeholder="e.g. Forgot to check in — confirmed present by team lead"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-2">
                <button
                  onClick={() => markAttendance.mutate({
                    ...markForm,
                    checkIn: markForm.checkIn || null,
                    checkOut: markForm.checkOut || null,
                  })}
                  disabled={!markForm.workerId || !markForm.date || markAttendance.isPending}
                  className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {markAttendance.isPending ? 'Saving…' : 'Save attendance'}
                </button>
                <button onClick={() => setMarkForm(null)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {bulkForm && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-gray-100">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Date</label>
                <input
                  type="date"
                  value={bulkForm.date}
                  onChange={(e) => setBulkForm({ ...bulkForm, date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Mark everyone as</label>
                <select
                  value={bulkForm.status}
                  onChange={(e) => setBulkForm({ ...bulkForm, status: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  {MARKABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>{titleCase(s)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Note</label>
                <input
                  value={bulkForm.note}
                  onChange={(e) => setBulkForm({ ...bulkForm, note: e.target.value })}
                  placeholder="e.g. Eid al-Fitr"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <label className="sm:col-span-3 flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bulkForm.overwrite}
                  onChange={(e) => setBulkForm({ ...bulkForm, overwrite: e.target.checked })}
                  className="w-4 h-4 mt-0.5 rounded accent-brand-700"
                />
                <span>
                  Overwrite existing records
                  <span className="block text-xs text-gray-400">
                    Off by default, so anyone who did check in that day keeps their real record.
                  </span>
                </span>
              </label>
              <div className="sm:col-span-3 flex items-center gap-2">
                <button
                  onClick={() => bulkMark.mutate(bulkForm)}
                  disabled={!bulkForm.date || bulkMark.isPending}
                  className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                >
                  {bulkMark.isPending ? 'Marking…' : `Mark ${activeWorkers.length} employee(s)`}
                </button>
                <button onClick={() => setBulkForm(null)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-2 rounded-lg hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Monthly Summary */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Monthly Summary — {formatPeriod(month)}</h3>
            <p className="text-xs text-gray-400 mt-0.5">Per-employee day-type totals for the selected month</p>
          </div>
          {attendanceSummary && (
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-500">Present <strong className="text-gray-900">{attendanceSummary.total.present}</strong></span>
              <span className="text-gray-500">Absent <strong className="text-gray-900">{attendanceSummary.total.absent}</strong></span>
              <span className="text-gray-500">Leave <strong className="text-gray-900">{attendanceSummary.total.leave}</strong></span>
              <span className="text-gray-500">Half-day <strong className="text-gray-900">{attendanceSummary.total.halfDay}</strong></span>
            </div>
          )}
        </div>
        {loadingAttSummary ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</p>
        ) : !attendanceSummary || attendanceSummary.rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">No active employees found.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="w-full text-sm">
              <TableHeader>
                <TableRow className="text-left text-xs text-gray-400 border-b border-gray-200 bg-gray-100">
                  <TableHead className="px-5 py-2.5 font-medium">Employee</TableHead>
                  <TableHead className="px-5 py-2.5 font-medium">Present</TableHead>
                  <TableHead className="px-5 py-2.5 font-medium">Absent</TableHead>
                  <TableHead className="px-5 py-2.5 font-medium">Leave</TableHead>
                  <TableHead className="px-5 py-2.5 font-medium">Half-day</TableHead>
                  <TableHead className="px-5 py-2.5 font-medium">Marked / Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-50">
                {attendanceSummary.rows.map((r: any) => (
                  <TableRow key={r.workerId}>
                    <TableCell className="px-5 py-2.5 font-medium">
                      {r.workerId ? (
                        <Link href={workerAttendanceHref(r.workerId, month)} className={EMPLOYEE_LINK_CLASS}>
                          {r.name}
                        </Link>
                      ) : (
                        <span className="text-gray-900">{r.name}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-5 py-2.5 text-brand-800">{r.present}</TableCell>
                    <TableCell className="px-5 py-2.5 text-red-600">{r.absent}</TableCell>
                    <TableCell className="px-5 py-2.5 text-amber-600">{r.leave}</TableCell>
                    <TableCell className="px-5 py-2.5 text-blue-600">{r.halfDay}</TableCell>
                    <TableCell className="px-5 py-2.5 text-gray-400">{r.totalMarked} / {attendanceSummary.daysInMonth}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
