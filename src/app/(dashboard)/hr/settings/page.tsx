'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Building2, Briefcase, Plus, ArrowLeft, Percent, CalendarDays, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle, { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, inactiveRow } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export default function HrSettingsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [form, setForm] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState(false);
  const [newDept, setNewDept] = useState('');
  const [newDesig, setNewDesig] = useState('');
  const [taxYearForm, setTaxYearForm] = useState({
    label: '',
    startDate: '',
    endDate: '',
    activate: true,
  });
  const [selectedTaxYearId, setSelectedTaxYearId] = useState<string>('');
  const [confirmDeleteTaxYear, setConfirmDeleteTaxYear] = useState(false);
  // One flag for the whole page — its three lists (tax years/slabs, departments,
  // designations) show and hide their Inactive rows together.
  const inactive = useShowInactive();
  const [slabForm, setSlabForm] = useState({
    minAmount: '',
    maxAmount: '',
    ratePercent: '0',
    fixedAmount: '0',
  });
  const [holidayForm, setHolidayForm] = useState({
    name: '', date: '', endDate: '', isRecurring: false,
  });

  const { data: settings, isLoading } = useQuery({
    queryKey: ['hr-payroll-settings'],
    queryFn: () => api.get('/hr/payroll-settings').then((r) => r.data),
  });

  const { data: departments = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['hr-departments', inactive.key],
    queryFn: () => api.get('/hr/departments', { params: inactive.params }).then((r) => r.data),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations', inactive.key],
    queryFn: () => api.get('/hr/designations', { params: inactive.params }).then((r) => r.data),
  });

  const { data: taxYears = [] } = useQuery({
    queryKey: ['hr-tax-years', inactive.key],
    queryFn: () => api.get('/hr/tax-years', { params: inactive.params }).then((r) => r.data),
  });

  const { data: holidays = [] } = useQuery({
    queryKey: ['hr-holidays', inactive.key],
    queryFn: () => api.get('/hr/holidays', { params: inactive.params }).then((r) => r.data),
  });

  const createHoliday = useMutation({
    mutationFn: (payload: typeof holidayForm) => api.post('/hr/holidays', {
      ...payload, endDate: payload.endDate || null,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-holidays'] });
      setHolidayForm({ name: '', date: '', endDate: '', isRecurring: false });
      toast.success('Holiday added.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not add that holiday.'),
  });

  const toggleHoliday = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) => (next
      ? api.post(`/hr/holidays/${id}/activate`)
      : api.delete(`/hr/holidays/${id}`)).then((r) => r.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['hr-holidays'] });
      toast.success(vars.next ? 'Holiday set to Active.' : 'Holiday set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update that holiday.'),
  });

  const selectedTaxYear = useMemo(
    () => (taxYears as any[]).find((y) => y.id === selectedTaxYearId)
      || (taxYears as any[]).find((y) => y.isActive)
      || (taxYears as any[])[0]
      || null,
    [taxYears, selectedTaxYearId],
  );

  useEffect(() => {
    if (!selectedTaxYearId && selectedTaxYear?.id) setSelectedTaxYearId(selectedTaxYear.id);
  }, [selectedTaxYear, selectedTaxYearId]);

  const createTaxYear = useMutation({
    mutationFn: (payload: typeof taxYearForm) => api.post('/hr/tax-years', payload).then((r) => r.data),
    onSuccess: (year) => {
      qc.invalidateQueries({ queryKey: ['hr-tax-years'] });
      setTaxYearForm({ label: '', startDate: '', endDate: '', activate: true });
      if (year?.id) setSelectedTaxYearId(year.id);
      toast.success('Tax year created.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create tax year.'),
  });

  const activateTaxYear = useMutation({
    mutationFn: (id: string) => api.post(`/hr/tax-years/${id}/activate`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-tax-years'] });
      toast.success('Tax year activated for payroll.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to activate tax year.'),
  });

  // Archive / restore — nothing is ever destroyed (see ActiveToggle). Past payroll
  // runs were computed from these brackets, so the year and its slabs have to stay.
  const toggleTaxYearArchived = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      (archived
        ? api.delete(`/hr/tax-years/${id}`)
        : api.post(`/hr/tax-years/${id}/restore`)
      ).then((r) => r.data),
    onSuccess: (_d, { archived }) => {
      setConfirmDeleteTaxYear(false);
      qc.invalidateQueries({ queryKey: ['hr-tax-years'] });
      if (archived) setSelectedTaxYearId('');
      toast.success(archived ? 'Tax year archived.' : 'Tax year restored.');
    },
    onError: (e: any) => {
      setConfirmDeleteTaxYear(false);
      toast.error(e?.response?.data?.message || 'Could not change status.');
    },
  });

  const createSlab = useMutation({
    mutationFn: (payload: typeof slabForm & { taxYearId: string }) =>
      api.post(`/hr/tax-years/${payload.taxYearId}/slabs`, {
        minAmount: payload.minAmount,
        maxAmount: payload.maxAmount === '' ? null : payload.maxAmount,
        ratePercent: payload.ratePercent,
        fixedAmount: payload.fixedAmount,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-tax-years'] });
      setSlabForm({ minAmount: '', maxAmount: '', ratePercent: '0', fixedAmount: '0' });
      toast.success('Slab added.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add slab.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleSlabActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? api.post(`/hr/tax-slabs/${id}/activate`) : api.delete(`/hr/tax-slabs/${id}`)).then((r) => r.data),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['hr-tax-years'] });
      toast.success(next ? 'Slab set to Active.' : 'Slab set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not change status.'),
  });

  const addDept = useMutation({
    mutationFn: (name: string) => api.post('/hr/departments', { name }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr-departments'] }); setNewDept(''); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add department.'),
  });

  const toggleDeptActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? api.post(`/hr/departments/${id}/activate`) : api.delete(`/hr/departments/${id}`)).then((r) => r.data),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['hr-departments'] });
      toast.success(next ? 'Department set to Active.' : 'Department set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not change status.'),
  });

  const addDesig = useMutation({
    mutationFn: (name: string) => api.post('/hr/designations', { name }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hr-designations'] }); setNewDesig(''); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add designation.'),
  });

  const toggleDesigActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? api.post(`/hr/designations/${id}/activate`) : api.delete(`/hr/designations/${id}`)).then((r) => r.data),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['hr-designations'] });
      toast.success(next ? 'Designation set to Active.' : 'Designation set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not change status.'),
  });

  useEffect(() => {
    if (settings) {
      setForm({
        workingDaysPerMonth: settings.workingDaysPerMonth ?? 26,
        workingHoursPerDay: settings.workingHoursPerDay ?? 8,
        payDayOfMonth: settings.payDayOfMonth ?? 30,
        otMultiplier: settings.otMultiplier ?? 1.5,
        halfDayDeductionFactor: settings.halfDayDeductionFactor ?? 0.5,
        currency: settings.currency ?? 'PKR',
        emailSlipToEmployee: settings.emailSlipToEmployee ?? true,
        requireEmployeeConfirmation: settings.requireEmployeeConfirmation ?? true,
        employeeReviewWindowDays: settings.employeeReviewWindowDays ?? 3,
        leavePolicyJson: settings.leavePolicyJson ?? { annual: 14, sick: 7, casual: 7, unpaid: 0 },
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
  });

  function setLeave(key: string, value: number) {
    setForm({ ...form, leavePolicyJson: { ...form.leavePolicyJson, [key]: value } });
  }

  if (isLoading) return <div className="flex flex-col h-full"><Header title="HR Settings" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div></div>;

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={confirmDeleteTaxYear && !!selectedTaxYear}
        title={`Archive tax year ${selectedTaxYear?.label || ''}?`}
        message="It drops off this list, but the year and its slabs are kept so past payroll runs still reconcile. An admin can restore it at any time — nothing is deleted. The year currently active for payroll can't be archived; activate another one first."
        confirmLabel="Archive year"
        onConfirm={() => {
          if (selectedTaxYear) toggleTaxYearArchived.mutate({ id: selectedTaxYear.id, archived: true });
        }}
        onCancel={() => setConfirmDeleteTaxYear(false)}
      />
      <Header title="HR & Payroll Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl space-y-6">

        {/* Back — respects wherever the user actually came from (Dashboard shortcut,
            HR & Payroll, etc.) instead of always landing on one hardcoded page. */}
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Public holidays */}
        <div id="holidays" className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 scroll-mt-6">
          <div className="flex items-start gap-2">
            <CalendarDays className="w-4 h-4 text-brand-700 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Public holidays</h3>
              <p className="text-xs text-gray-500 mt-1">
                Days the office is closed. Nobody is expected to check in, payroll doesn&apos;t dock them,
                and the check-in card tells employees why. Tick <span className="font-medium">Repeats every year</span> for
                fixed-date national holidays (14 August); leave it off for moving ones like Eid.
                Use HR &rarr; Attendance &rarr; &quot;Whole day&quot; to stamp a holiday onto the attendance log.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <input
              value={holidayForm.name}
              onChange={(e) => setHolidayForm({ ...holidayForm, name: e.target.value })}
              placeholder="Holiday name"
              className="sm:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">From</label>
              <input
                type="date"
                value={holidayForm.date}
                onChange={(e) => setHolidayForm({ ...holidayForm, date: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">To (optional)</label>
              <input
                type="date"
                value={holidayForm.endDate}
                onChange={(e) => setHolidayForm({ ...holidayForm, endDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <label className="sm:col-span-3 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={holidayForm.isRecurring}
                onChange={(e) => setHolidayForm({ ...holidayForm, isRecurring: e.target.checked })}
                className="w-4 h-4 rounded accent-brand-700"
              />
              Repeats every year (same date)
            </label>
            <button
              disabled={createHoliday.isPending || !holidayForm.name.trim() || !holidayForm.date}
              onClick={() => createHoliday.mutate(holidayForm)}
              className="flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-lg"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          {(holidays as any[]).length === 0 ? (
            <p className="text-xs text-gray-400">No holidays on the calendar yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
              {(holidays as any[]).map((h: any) => (
                <li key={h.id} className={cn('flex items-center gap-3 px-3 py-2.5', inactiveRow(h.isActive))}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">{h.name}</span>
                      {h.isRecurring && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">
                          Every year
                        </span>
                      )}
                      {h.isActive === false && <InactiveBadge />}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {String(h.date).slice(0, 10)}
                      {h.endDate && ` → ${String(h.endDate).slice(0, 10)}`}
                    </p>
                  </div>
                  <ActiveToggle
                    isActive={h.isActive !== false}
                    label="holiday"
                    disabled={toggleHoliday.isPending}
                    onToggle={(next) => toggleHoliday.mutate({ id: h.id, next })}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Income tax slabs */}
        <div id="tax-slabs" className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 scroll-mt-6">
          <div className="flex items-start gap-2">
            <Percent className="w-4 h-4 text-brand-700 mt-0.5" />
            <ShowInactiveToggle {...inactive.toggleProps} className="order-last ml-auto shrink-0" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Income tax (Pakistan slabs)</h3>
              <p className="text-xs text-gray-500 mt-1">
                Enter FBR yearly brackets as-is. Payroll annualizes monthly taxable pay (×12), applies the matching
                slab (<span className="font-medium">fixed + % of amount exceeding min</span>), then deducts tax ÷ 12.
                If no active year is set, tax is 0.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-gray-50 border border-gray-100">
            <input
              value={taxYearForm.label}
              onChange={(e) => setTaxYearForm((x) => ({ ...x, label: e.target.value }))}
              placeholder="Label (e.g. 2025-26)"
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 sm:col-span-2"
            />
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
              <input
                type="date"
                value={taxYearForm.startDate}
                onChange={(e) => setTaxYearForm((x) => ({ ...x, startDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">End date</label>
              <input
                type="date"
                value={taxYearForm.endDate}
                onChange={(e) => setTaxYearForm((x) => ({ ...x, endDate: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={taxYearForm.activate}
                onChange={(e) => setTaxYearForm((x) => ({ ...x, activate: e.target.checked }))}
                className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
              />
              Activate immediately for payroll
            </label>
            <button
              type="button"
              disabled={createTaxYear.isPending || !taxYearForm.label.trim() || !taxYearForm.startDate || !taxYearForm.endDate}
              onClick={() => createTaxYear.mutate(taxYearForm)}
              className="flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg sm:col-span-2"
            >
              <Plus className="w-4 h-4" /> Create tax year
            </button>
          </div>

          {(taxYears as any[]).length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-gray-600">Edit year</label>
                <select
                  value={selectedTaxYear?.id || ''}
                  onChange={(e) => setSelectedTaxYearId(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  {(taxYears as any[]).map((y: any) => (
                    <option key={y.id} value={y.id}>
                      {y.label}{y.isActive ? ' (active)' : ''}
                    </option>
                  ))}
                </select>
                {selectedTaxYear && !selectedTaxYear.isActive && (
                  <button
                    type="button"
                    onClick={() => activateTaxYear.mutate(selectedTaxYear.id)}
                    className="text-xs font-medium text-brand-800 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg"
                  >
                    Set active
                  </button>
                )}
                {selectedTaxYear && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteTaxYear(true)}
                    className="text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1.5"
                  >
                    Delete year
                  </button>
                )}
                {selectedTaxYear?.isActive && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700">Active</span>
                )}
              </div>

              {selectedTaxYear && (
                <>
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/80">
                          <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Min (yearly)</th>
                          <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Max</th>
                          <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Fixed</th>
                          <th className="text-left text-xs font-semibold text-gray-500 px-3 py-2">Rate %</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {[...(selectedTaxYear.slabs || [])]
                          .sort((a: any, b: any) => (a.sortOrder - b.sortOrder) || (Number(a.minAmount) - Number(b.minAmount)))
                          .map((slab: any) => (
                            <tr key={slab.id} className={inactiveRow(slab.isActive)}>
                              <td className="px-3 py-2 tabular-nums text-gray-800">
                                {Number(slab.minAmount).toLocaleString()}
                                {slab.isActive === false && <InactiveBadge className="ml-2" />}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-gray-800">
                                {slab.maxAmount == null ? '∞' : Number(slab.maxAmount).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 tabular-nums text-gray-800">{Number(slab.fixedAmount || 0).toLocaleString()}</td>
                              <td className="px-3 py-2 tabular-nums text-gray-800">{Number(slab.ratePercent || 0)}</td>
                              <td className="px-2 py-2">
                                <ActiveToggle
                                  isActive={slab.isActive !== false}
                                  label="slab"
                                  disabled={toggleSlabActive.isPending}
                                  onToggle={(next) => toggleSlabActive.mutate({ id: slab.id, next })}
                                />
                              </td>
                            </tr>
                          ))}
                        {(selectedTaxYear.slabs || []).length === 0 && (
                          <tr>
                            <td colSpan={5} className="px-3 py-6 text-center text-xs text-gray-400">
                              No slabs yet — add FBR brackets below.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1 whitespace-nowrap">Min (yearly)</label>
                      <input
                        type="number"
                        min={0}
                        value={slabForm.minAmount}
                        onChange={(e) => setSlabForm((x) => ({ ...x, minAmount: e.target.value }))}
                        placeholder="e.g. 7000000"
                        className="w-full px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1 whitespace-nowrap">Max (blank = ∞)</label>
                      <input
                        type="number"
                        min={0}
                        value={slabForm.maxAmount}
                        onChange={(e) => setSlabForm((x) => ({ ...x, maxAmount: e.target.value }))}
                        placeholder="No upper limit"
                        className="w-full px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1 whitespace-nowrap">Fixed amount</label>
                      <input
                        type="number"
                        min={0}
                        value={slabForm.fixedAmount}
                        onChange={(e) => setSlabForm((x) => ({ ...x, fixedAmount: e.target.value }))}
                        placeholder="e.g. 1424000"
                        className="w-full px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-gray-500 mb-1 whitespace-nowrap">Rate %</label>
                      <input
                        type="number"
                        min={0}
                        step="0.001"
                        value={slabForm.ratePercent}
                        onChange={(e) => setSlabForm((x) => ({ ...x, ratePercent: e.target.value }))}
                        placeholder="e.g. 35"
                        className="w-full px-2.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={createSlab.isPending || slabForm.minAmount === ''}
                      onClick={() => createSlab.mutate({ ...slabForm, taxYearId: selectedTaxYear.id })}
                      className="flex items-center justify-center gap-1 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap col-span-2 sm:col-span-1"
                    >
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400">Rate % applies only to income above Min — see the example below once you start typing.</p>

                  {/* Live formula readout — the Rate % only ever multiplies the slice of
                      income ABOVE Min, never the whole salary; Fixed is what every FBR
                      bracket already accumulated from the brackets below it. */}
                  {(() => {
                    const min = Number(slabForm.minAmount) || 0;
                    const fixed = Number(slabForm.fixedAmount) || 0;
                    const rate = Number(slabForm.ratePercent) || 0;
                    if (!slabForm.minAmount && !slabForm.fixedAmount && !slabForm.ratePercent) return null;
                    const exampleIncome = min + 1000000;
                    const exampleTax = fixed + (rate / 100) * (exampleIncome - min);
                    return (
                      <div className="text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 space-y-1">
                        <p>
                          <span className="font-medium text-gray-700">This bracket&apos;s formula:</span>{' '}
                          <span className="font-mono">{fixed.toLocaleString()} + {rate}% × (yearly income − {min.toLocaleString()})</span>
                        </p>
                        <p className="text-gray-400">
                          The {rate}% only applies to whatever income is <span className="font-medium text-gray-500">above</span> Min ({min.toLocaleString()}) — never to the full salary.
                          E.g. someone earning {exampleIncome.toLocaleString()}/yr in this bracket would owe {exampleTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}.
                        </p>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}
        </div>

        {/* Pay calculation */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Pay Calculation</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Working Days per Month</label>
              <input
                type="number"
                value={form.workingDaysPerMonth ?? ''}
                onChange={(e) => setForm({ ...form, workingDaysPerMonth: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-xs text-gray-400 mt-1">Default for new payroll runs. With Sat+Sun off, ~22 is typical. Each run can override this.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Working Hours per Day</label>
              <input
                type="number"
                step="0.5"
                value={form.workingHoursPerDay ?? ''}
                onChange={(e) => setForm({ ...form, workingHoursPerDay: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Overtime Multiplier</label>
              <input
                type="number"
                step="0.1"
                value={form.otMultiplier ?? ''}
                onChange={(e) => setForm({ ...form, otMultiplier: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-xs text-gray-400 mt-1">e.g. 1.5 = 1.5× per-hour rate for overtime</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Half-day Deduction Factor</label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="1"
                value={form.halfDayDeductionFactor ?? ''}
                onChange={(e) => setForm({ ...form, halfDayDeductionFactor: parseFloat(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-xs text-gray-400 mt-1">0.5 = 50% of daily rate deducted per half-day</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Default Currency</label>
              <input
                value={form.currency ?? ''}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
                placeholder="PKR"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Pay Day of Month</label>
              <input
                type="number"
                min="1"
                max="31"
                value={form.payDayOfMonth ?? ''}
                onChange={(e) => setForm({ ...form, payDayOfMonth: parseInt(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          </div>
        </div>

        {/* Attendance & late policy, weekly off days, and shift schedules now
            live under Policies → Attendance (sidebar) instead of here — keeps
            "what timing is active for everyone" in one place instead of
            duplicated across two settings screens. */}
        <Link
          href="/policies/attendance"
          className="flex items-center justify-between gap-3 bg-white rounded-xl border border-gray-200 p-5 hover:border-brand-300 hover:bg-brand-50/30 transition-colors group"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Attendance &amp; Shift Timing</h3>
            <p className="text-xs text-gray-500 mt-1">
              Shift start/end, late grace period, half-day thresholds, weekly off days, and seasonal shift
              schedules (e.g. Ramadan) moved to <span className="font-medium">Policies → Attendance</span>.
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-gray-400 group-hover:text-brand-700 transition-colors shrink-0" />
        </Link>

        {/* Leave policy */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Leave Policy (days per year)</h3>
          <div className="grid grid-cols-4 gap-4">
            {(['annual', 'sick', 'casual', 'unpaid'] as const).map((type) => (
              <div key={type}>
                <label className="block text-xs font-medium text-gray-700 mb-1.5 capitalize">{type} Leave</label>
                <input
                  type="number"
                  min="0"
                  value={form.leavePolicyJson?.[type] ?? 0}
                  onChange={(e) => setLeave(type, parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Departments & Designations */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Departments */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-semibold text-gray-900">Departments</h3>
              <ShowInactiveToggle {...inactive.toggleProps} className="ml-auto" />
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newDept.trim()) addDept.mutate(newDept.trim()); }}
                  placeholder="New department name…"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <button
                  onClick={() => { if (newDept.trim()) addDept.mutate(newDept.trim()); }}
                  disabled={!newDept.trim() || addDept.isPending}
                  className="flex items-center gap-1 px-3 py-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {(departments as any[]).length === 0 && (
                  <p className="py-4 text-sm text-gray-400 text-center">No departments yet.</p>
                )}
                {(departments as any[]).map((d: any) => (
                  <div key={d.id} className={cn('flex items-center justify-between py-2.5 px-2 -mx-2 rounded', inactiveRow(d.isActive))}>
                    <span className="text-sm text-gray-800">
                      {d.name}
                      {d.isActive === false && <InactiveBadge className="ml-2" />}
                    </span>
                    <ActiveToggle
                      isActive={d.isActive !== false}
                      label="department"
                      disabled={toggleDeptActive.isPending}
                      onToggle={(next) => toggleDeptActive.mutate({ id: d.id, next })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Designations */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-brand-700" />
              <h3 className="text-sm font-semibold text-gray-900">Designations</h3>
              <ShowInactiveToggle {...inactive.toggleProps} className="ml-auto" />
            </div>
            <div className="p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newDesig}
                  onChange={(e) => setNewDesig(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newDesig.trim()) addDesig.mutate(newDesig.trim()); }}
                  placeholder="New designation name…"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <button
                  onClick={() => { if (newDesig.trim()) addDesig.mutate(newDesig.trim()); }}
                  disabled={!newDesig.trim() || addDesig.isPending}
                  className="flex items-center gap-1 px-3 py-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add
                </button>
              </div>
              <div className="divide-y divide-gray-100">
                {(designations as any[]).length === 0 && (
                  <p className="py-4 text-sm text-gray-400 text-center">No designations yet.</p>
                )}
                {(designations as any[]).map((d: any) => (
                  <div key={d.id} className={cn('flex items-center justify-between py-2.5 px-2 -mx-2 rounded', inactiveRow(d.isActive))}>
                    <span className="text-sm text-gray-800">
                      {d.name}
                      {d.isActive === false && <InactiveBadge className="ml-2" />}
                    </span>
                    <ActiveToggle
                      isActive={d.isActive !== false}
                      label="designation"
                      disabled={toggleDesigActive.isPending}
                      onToggle={(next) => toggleDesigActive.mutate({ id: d.id, next })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Workflow options */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900">Payroll Workflow</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.requireEmployeeConfirmation}
                onChange={(e) => setForm({ ...form, requireEmployeeConfirmation: e.target.checked })}
                className="w-4 h-4 text-brand-700 border-gray-300 rounded focus:ring-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Require employee confirmation</p>
                <p className="text-xs text-gray-500">Employees must confirm their payslip before the run can be locked</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.emailSlipToEmployee}
                onChange={(e) => setForm({ ...form, emailSlipToEmployee: e.target.checked })}
                className="w-4 h-4 text-brand-700 border-gray-300 rounded focus:ring-brand-600"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">Email salary slip to employee when paid</p>
                <p className="text-xs text-gray-500">Employees receive their payslip by email automatically once a payroll run is marked as paid</p>
              </div>
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Employee review window (days)</label>
              <input
                type="number"
                min="1"
                max="14"
                value={form.employeeReviewWindowDays ?? 3}
                onChange={(e) => setForm({ ...form, employeeReviewWindowDays: parseInt(e.target.value) })}
                className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-xs text-gray-400 mt-1">Days employees have to review payslips before auto-locking (informational)</p>
            </div>
          </div>
        </div>

        {/* Save */}
        {updateMutation.isError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {(updateMutation.error as any)?.response?.data?.message || 'Failed to save settings.'}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => updateMutation.mutate(form)}
            disabled={updateMutation.isPending}
            className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save Settings'}
          </button>
          {saved && (
            <div className="flex items-center gap-1.5 text-sm text-brand-700">
              <CheckCircle className="w-4 h-4" />
              Saved
            </div>
          )}
          <button
            onClick={() => router.back()}
            className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}
