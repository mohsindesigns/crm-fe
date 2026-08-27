'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Clock, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ActiveToggle, { InactiveBadge } from '@/components/ActiveToggle';
import { cn, inactiveRow } from '@/lib/utils';
import { nowInKarachi } from '@/lib/attendanceDate';
import { marksAttendance } from '@/lib/routePermissions';

// Attendance policy — the org-wide shift timing every current employee's
// check-in/check-out is judged against by default, with an optional
// permanent per-employee override (Worker.shiftScheduleId — see
// crm-be/src/services/HrService.js#resolveShiftTimings) assignable either
// from here or from the employee's own profile page. Previously the default
// lived buried inside HR & Payroll → Settings alongside unrelated payroll
// config; gathered here under its own Policies section so "what timing is
// currently active for everyone, and who's on something else" has one
// obvious home. Reads/writes the same PayrollSettings + ShiftSchedule
// records HR Settings always has — moving house here, not a second copy.
export default function AttendancePolicyPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    label: '', startDate: '', endDate: '',
    shiftStartTime: '15:00', shiftEndTime: '00:30', lateGraceMinutes: '15',
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['hr-payroll-settings'],
    queryFn: () => api.get('/hr/payroll-settings').then((r) => r.data),
  });

  const { data: shiftSchedules = [], isLoading: loadingSchedules } = useQuery({
    queryKey: ['hr-shift-schedules', 'default'],
    queryFn: () => api.get('/hr/shift-schedules').then((r) => r.data),
  });

  // Same query key AttendanceBoard/HR use — shares cache, no extra fetch if
  // either was already visited this session.
  const { data: workers = [], isLoading: loadingWorkers } = useQuery({
    queryKey: ['hr-workers'],
    queryFn: () => api.get('/hr/workers').then((r) => r.data),
  });
  const assignableWorkers = (workers as any[])
    .filter((w: any) => w.status === 'active' && marksAttendance(w.user?.role?.key))
    .sort((a: any, b: any) => (a.user?.name || '').localeCompare(b.user?.name || ''));

  const assignSchedule = useMutation({
    mutationFn: ({ workerId, shiftScheduleId }: { workerId: string; shiftScheduleId: string | null }) =>
      api.patch(`/hr/workers/${workerId}`, { shiftScheduleId: shiftScheduleId || '' }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-workers'] });
      qc.invalidateQueries({ queryKey: ['hr-worker'] });
      toast.success('Timing policy updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update that assignment.'),
  });

  useEffect(() => {
    if (settings) {
      setForm({
        shiftStartTime: settings.shiftStartTime ?? '15:00',
        shiftEndTime: settings.shiftEndTime ?? '00:30',
        lateGraceMinutes: settings.lateGraceMinutes ?? 15,
        lateOccurrencesPerDeduction: settings.lateOccurrencesPerDeduction ?? 3,
        latePenaltyLeaveType: settings.latePenaltyLeaveType ?? 'casual',
        halfDayMinPercent: settings.halfDayMinPercent ?? 40,
        halfDayFullPercent: settings.halfDayFullPercent ?? 75,
        halfDayRestrictedDays: settings.halfDayRestrictedDays ?? [1, 5],
        weekendDays: settings.weekendDays ?? [0, 6],
      });
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.patch('/hr/payroll-settings', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll-settings'] });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save policy.'),
  });

  const createSchedule = useMutation({
    mutationFn: (payload: Omit<typeof scheduleForm, 'endDate'> & { endDate: string | null }) => api.post('/hr/shift-schedules', {
      ...payload, lateGraceMinutes: parseInt(payload.lateGraceMinutes, 10) || 0,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-shift-schedules'] });
      setScheduleForm({ label: '', startDate: '', endDate: '', shiftStartTime: '15:00', shiftEndTime: '00:30', lateGraceMinutes: '15' });
      toast.success('Shift schedule added.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not add that schedule.'),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: any }) =>
      api.patch(`/hr/shift-schedules/${id}`, updates).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-shift-schedules'] });
      toast.success('Shift schedule updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update that schedule.'),
  });

  const archiveSchedule = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => (next
      ? api.post(`/hr/shift-schedules/${id}/restore`)
      : api.delete(`/hr/shift-schedules/${id}`)).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-shift-schedules'] });
      toast.success(vars.next ? 'Schedule restored.' : 'Schedule archived.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update that schedule.'),
  });

  function toggleRestrictedDay(day: number) {
    const current: number[] = form.halfDayRestrictedDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    setForm({ ...form, halfDayRestrictedDays: next });
  }

  function toggleWeekendDay(day: number) {
    const current: number[] = form.weekendDays ?? [];
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort();
    setForm({ ...form, weekendDays: next });
  }

  const DAYS = [
    { d: 1, label: 'Mon' }, { d: 2, label: 'Tue' }, { d: 3, label: 'Wed' },
    { d: 4, label: 'Thu' }, { d: 5, label: 'Fri' }, { d: 6, label: 'Sat' }, { d: 0, label: 'Sun' },
  ];

  // Which timing is actually in force right now — mirrors the same
  // active + in-range match HrService#resolveShiftTimings uses server-side
  // when judging a check-in, so this always agrees with what employees are
  // really held to today, not just which schedules are individually marked
  // "Active".
  const today = nowInKarachi().date;
  const activeSchedule = (shiftSchedules as any[]).find((s: any) =>
    s.isActive && !s.isArchived
    && String(s.startDate).slice(0, 10) <= today
    && (!s.endDate || String(s.endDate).slice(0, 10) >= today));
  const currentTiming = activeSchedule
    ? { label: activeSchedule.label, start: activeSchedule.shiftStartTime, end: activeSchedule.shiftEndTime }
    : { label: 'Default shift', start: form.shiftStartTime ?? '15:00', end: form.shiftEndTime ?? '00:30' };
  const overriddenCount = (workers as any[]).filter((w: any) => w.shiftScheduleId).length;

  if (isLoading) return <div className="flex flex-col h-full"><Header title="Attendance Policy" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div></div>;

  return (
    <div className="flex flex-col h-full">
      <Header title="Attendance Policy" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-6">

          <div className="flex items-center justify-between gap-3 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
            <div className="text-xs text-brand-800">
              <span className="font-semibold">Currently active for everyone: </span>
              {currentTiming.label} · {currentTiming.start}–{currentTiming.end}
              <p className="text-brand-700/80 mt-0.5">
                Everyone without an individual assignment is judged against this.
                {activeSchedule ? ' A shift schedule is in effect for today; the default shift resumes once it ends.' : ''}
                {overriddenCount > 0
                  ? ` ${overriddenCount} employee${overriddenCount === 1 ? '' : 's'} ${overriddenCount === 1 ? 'is' : 'are'} pinned to a different policy below.`
                  : ''}
              </p>
            </div>
            <span className="shrink-0 text-[10px] font-medium px-2 py-1 rounded-full bg-brand-700 text-white uppercase tracking-wide">
              Active
            </span>
          </div>

          {/* Attendance & late policy */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Attendance &amp; Late Policy</h3>
              <p className="text-xs text-gray-500 mt-1">Controls shift timing, when a check-in counts as late, and when a checkout counts as a half-day.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Shift Start</label>
                <input
                  type="time"
                  value={form.shiftStartTime ?? '15:00'}
                  onChange={(e) => setForm({ ...form, shiftStartTime: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Shift End</label>
                <input
                  type="time"
                  value={form.shiftEndTime ?? '00:30'}
                  onChange={(e) => setForm({ ...form, shiftEndTime: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Grace Period (min)</label>
                <input
                  type="number"
                  min="0"
                  value={form.lateGraceMinutes ?? ''}
                  onChange={(e) => setForm({ ...form, lateGraceMinutes: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-xs text-gray-400 mt-1">Minutes after shift start before a check-in is marked late</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Late Arrivals per Deduction</label>
                <input
                  type="number"
                  min="1"
                  value={form.lateOccurrencesPerDeduction ?? ''}
                  onChange={(e) => setForm({ ...form, lateOccurrencesPerDeduction: parseInt(e.target.value) || 1 })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-xs text-gray-400 mt-1">e.g. 3 = every 3 late arrivals in a month costs 1 leave day</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Leave Type Deducted for Lateness</label>
                <select
                  value={form.latePenaltyLeaveType ?? 'casual'}
                  onChange={(e) => setForm({ ...form, latePenaltyLeaveType: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  {(['annual', 'sick', 'casual', 'unpaid', 'other'] as const).map((t) => (
                    <option key={t} value={t} className="capitalize">{t}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 mt-1">If no balance remains, the day becomes unpaid instead</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Half-day Min %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.halfDayMinPercent ?? ''}
                  onChange={(e) => setForm({ ...form, halfDayMinPercent: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-xs text-gray-400 mt-1">Below this % of the shift = absent</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Full-day Min %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={form.halfDayFullPercent ?? ''}
                  onChange={(e) => setForm({ ...form, halfDayFullPercent: parseFloat(e.target.value) || 0 })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-xs text-gray-400 mt-1">At or above this % of the shift = full day. Between the two = half-day.</p>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Restricted Half-day Checkout Days</label>
              <div className="flex flex-wrap gap-2">
                {DAYS.map(({ d, label }) => {
                  const active = (form.halfDayRestrictedDays ?? []).includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleRestrictedDay(d)}
                      className={cn(
                        'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                        active ? 'bg-brand-700 border-brand-700 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                On these days, a half-day checkout needs a pre-approved half-day leave request — otherwise it&apos;s recorded as an unauthorized absence.
                On other days, employees can check out early and it&apos;s simply marked as a half-day.
              </p>
            </div>
          </div>

          {/* Weekly off days */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Weekly Off Days</h3>
              <p className="text-xs text-gray-500 mt-1">
                These days are treated as paid weekends — auto-marked on attendance, excluded from leave day counts, and check-in is not required.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(({ d, label }) => {
                const active = (form.weekendDays ?? []).includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleWeekendDay(d)}
                    className={cn(
                      'px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
                      active ? 'bg-brand-700 border-brand-700 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400">Default is Saturday and Sunday. Save below to apply.</p>
          </div>

          {/* Save — Attendance & Late Policy + Weekly Off Days */}
          {updateMutation.isError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {(updateMutation.error as any)?.response?.data?.message || 'Failed to save policy.'}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => updateMutation.mutate(form)}
              disabled={updateMutation.isPending}
              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Policy'}
            </button>
            {saved && (
              <div className="flex items-center gap-1.5 text-sm text-brand-700">
                <CheckCircle className="w-4 h-4" />
                Saved
              </div>
            )}
          </div>

          {/* Shift schedules — seasonal timings, e.g. Ramadan */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-2">
              <Clock className="w-4 h-4 text-brand-700 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Shift schedules</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Named timings that apply from a start date onward — set up exactly like a tax year. During
                  Ramadan (or any other period with different hours) the matching schedule takes over
                  automatically, and lateness is judged against <em>those</em> hours. Leave the end date blank
                  for an ongoing policy that applies to everyone indefinitely, or set one for a schedule that
                  should auto-revert to the default shift below afterward. Because each schedule is pinned to
                  its own dates, changing this year&apos;s timings never re-scores last year&apos;s attendance.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
              <input
                value={scheduleForm.label}
                onChange={(e) => setScheduleForm({ ...scheduleForm, label: e.target.value })}
                placeholder="Schedule name (e.g. Ramadan 2027)"
                className="sm:col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Starts</label>
                <input
                  type="date"
                  value={scheduleForm.startDate}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Ends (optional)</label>
                <input
                  type="date"
                  value={scheduleForm.endDate}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-[10px] text-gray-400 mt-1">Leave blank for an ongoing policy with no end date.</p>
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Late grace (min)</label>
                <input
                  type="number"
                  min={0}
                  value={scheduleForm.lateGraceMinutes}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, lateGraceMinutes: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Shift starts</label>
                <input
                  type="time"
                  value={scheduleForm.shiftStartTime}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, shiftStartTime: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-[11px] text-gray-500 mb-1">Shift ends</label>
                <input
                  type="time"
                  value={scheduleForm.shiftEndTime}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, shiftEndTime: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <button
                disabled={createSchedule.isPending || !scheduleForm.label.trim() || !scheduleForm.startDate}
                onClick={() => createSchedule.mutate({ ...scheduleForm, endDate: scheduleForm.endDate || null })}
                className="flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-lg self-end"
              >
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>

            {loadingSchedules ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : (shiftSchedules as any[]).length === 0 ? (
              <p className="text-xs text-gray-400">
                No seasonal schedules — the default shift above applies all year.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {(shiftSchedules as any[]).map((s: any) => (
                  <li key={s.id} className={cn('flex items-center gap-3 px-3 py-2.5', inactiveRow(!s.isArchived))}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-900">{s.label}</span>
                        {s.isArchived && <InactiveBadge />}
                        {activeSchedule?.id === s.id && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-700 text-white uppercase tracking-wide">
                            In effect today
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {String(s.startDate).slice(0, 10)} → {s.endDate ? String(s.endDate).slice(0, 10) : 'ongoing'} ·{' '}
                        {s.shiftStartTime}–{s.shiftEndTime} · {s.lateGraceMinutes} min grace
                      </p>
                    </div>
                    {/* Check to mark this schedule active — it only actually
                        takes over on the dates it covers, so more than one
                        can be checked (e.g. next year's Ramadan prepared in
                        advance) without conflicting; "In effect today" above
                        is the one that's really governing check-ins right now. */}
                    <label className={cn(
                      'flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md select-none',
                      s.isArchived ? 'text-gray-400 cursor-not-allowed' : 'text-gray-700 cursor-pointer hover:bg-gray-50',
                    )}>
                      <input
                        type="checkbox"
                        checked={!!s.isActive}
                        onChange={(e) => updateSchedule.mutate({ id: s.id, updates: { isActive: e.target.checked } })}
                        disabled={updateSchedule.isPending || s.isArchived}
                        className="w-4 h-4 rounded accent-brand-700"
                      />
                      Active
                    </label>
                    <ActiveToggle
                      isActive={!s.isArchived}
                      label="schedule"
                      disabled={archiveSchedule.isPending}
                      onToggle={(next) => archiveSchedule.mutate({ id: s.id, next })}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Per-employee override — permanent until changed, ignores date
              range/Active toggle entirely (see resolveShiftTimings). Same
              picker also lives on each employee's own Profile tab; either
              one edits the same Worker.shiftScheduleId field. */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-2">
              <Users className="w-4 h-4 text-brand-700 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Assign to Employees</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Pin a specific employee to a policy permanently — useful for someone on a standing night
                  shift, for example. This overrides the default/seasonal resolution above for that person
                  only, every day, until changed back to Default. Can also be set from the employee&apos;s
                  own profile page.
                </p>
              </div>
            </div>

            {loadingWorkers ? (
              <p className="text-xs text-gray-400">Loading…</p>
            ) : assignableWorkers.length === 0 ? (
              <p className="text-xs text-gray-400">No active employees to assign.</p>
            ) : (
              <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                {assignableWorkers.map((w: any) => (
                  <li key={w.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <Link
                        href={`/hr/workers/${w.id}`}
                        className="text-sm font-medium text-brand-700 hover:text-brand-900 underline underline-offset-2 decoration-brand-300"
                      >
                        {w.user?.name}
                      </Link>
                      {w.designation && <span className="text-xs text-gray-400 ml-2">{w.designation}</span>}
                    </div>
                    <select
                      value={w.shiftScheduleId || ''}
                      onChange={(e) => assignSchedule.mutate({ workerId: w.id, shiftScheduleId: e.target.value || null })}
                      disabled={assignSchedule.isPending}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-60"
                    >
                      <option value="">Default (org-wide)</option>
                      {(shiftSchedules as any[])
                        .filter((s: any) => !s.isArchived || s.id === w.shiftScheduleId)
                        .map((s: any) => (
                          <option key={s.id} value={s.id}>{s.label}{s.isArchived ? ' (archived)' : ''}</option>
                        ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
