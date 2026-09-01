'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, DollarSign, Plus, UserPlus, AlertCircle, Eye, EyeOff, RefreshCw, Receipt, CheckCircle, XCircle, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, generatePassword, formatPeriod, titleCase } from '@/lib/utils';
import { toast } from 'sonner';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// Attendance used to have its own tab here, duplicating (with less capability
// than) the org-wide Attendance page reachable from the sidebar — removed in
// favor of that single canonical page. See AttendanceBoard.
// Settings lives only at /hr/settings (depts, designations, tax, payroll config).
type Tab = 'workers' | 'leaves' | 'contractor-invoices' | 'payroll' | 'settings';
const VALID_TABS: Tab[] = ['workers', 'leaves', 'contractor-invoices', 'payroll', 'settings'];
const TAB_LABELS: Record<Tab, string> = {
  workers: 'Workers', leaves: 'Leaves',
  'contractor-invoices': 'Invoices', payroll: 'Payroll', settings: 'Settings',
};

const WORKER_STATUS_COLORS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  inactive: 'bg-gray-100 text-gray-500',
  invited: 'bg-blue-100 text-blue-700',
  profile_pending: 'bg-amber-100 text-amber-700',
  under_review: 'bg-violet-100 text-violet-700',
  profile_amended: 'bg-blue-100 text-blue-700',
};

const PAYROLL_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  open_for_review: 'bg-amber-100 text-amber-700',
  locked: 'bg-blue-100 text-blue-700',
  paid: 'bg-brand-100 text-brand-800',
};

const BLANK_INVITE = { name: '', email: '', workerType: 'employee' as 'employee' | 'contractor', roleId: '', password: '' };

export default function HrPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && VALID_TABS.includes(rawTab) && rawTab !== 'settings'
    ? rawTab
    : 'workers';

  // Legacy ?tab=settings and the Settings tab both go to the single settings page.
  useEffect(() => {
    if (rawTab === 'settings') router.replace('/hr/settings');
  }, [rawTab, router]);

  function setTab(t: Tab) {
    if (t === 'settings') {
      router.push('/hr/settings');
      return;
    }
    router.replace(`/hr?tab=${t}`, { scroll: false });
  }
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState(BLANK_INVITE);
  const [showInvitePassword, setShowInvitePassword] = useState(false);
  const [newPeriod, setNewPeriod] = useState('');
  const [newWorkingDays, setNewWorkingDays] = useState<number | ''>('');
  const [newIncludeOvertime, setNewIncludeOvertime] = useState(true);
  const [workerStatusFilter, setWorkerStatusFilter] = useState('');
  const [workerDesigFilter, setWorkerDesigFilter] = useState('');
  const [workerDeptFilter, setWorkerDeptFilter] = useState('');
  const [workerTypeFilter, setWorkerTypeFilter] = useState('');
  const [payrollStatusFilter, setPayrollStatusFilter] = useState('');
  const [rejectLeaveTarget, setRejectLeaveTarget] = useState<{ id: string; name: string } | null>(null);
  const [rejectLeaveNote, setRejectLeaveNote] = useState('');
  const [revertRunTarget, setRevertRunTarget] = useState<{ id: string; period: string } | null>(null);
  // Temporary while QA-ing the payroll workflow — remove this delete option later.
  const [deleteRunTarget, setDeleteRunTarget] = useState<{ id: string; period: string } | null>(null);
  const qc = useQueryClient();

  const { data: workers = [], isLoading: loadingWorkers } = useQuery({
    queryKey: ['hr-workers'],
    queryFn: () => api.get('/hr/workers').then((r) => r.data),
    enabled: tab === 'workers',
  });

  const { data: leaves = [], isLoading: loadingLeaves } = useQuery({
    queryKey: ['hr-leaves'],
    queryFn: () => api.get('/hr/leaves').then((r) => r.data),
    enabled: tab === 'leaves',
  });

  const { data: contractorInvoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['hr-contractor-invoices'],
    queryFn: () => api.get('/hr/contractor-invoices').then((r) => r.data),
    enabled: tab === 'contractor-invoices',
  });

  const { data: payrollRuns = [], isLoading: loadingPayroll } = useQuery({
    queryKey: ['hr-payroll'],
    queryFn: () => api.get('/hr/payroll').then((r) => r.data),
    enabled: tab === 'payroll',
  });

  const { data: payrollSettings } = useQuery({
    queryKey: ['hr-payroll-settings'],
    queryFn: () => api.get('/hr/payroll-settings').then((r) => r.data),
    enabled: tab === 'payroll',
  });

  useEffect(() => {
    if (tab !== 'payroll') return;
    if (newWorkingDays !== '') return;
    const def = parseInt(payrollSettings?.workingDaysPerMonth, 10);
    if (Number.isFinite(def) && def > 0) setNewWorkingDays(def);
  }, [tab, payrollSettings, newWorkingDays]);

  const { data: rolesRaw = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
    enabled: showInvite,
  });
  const roles = (rolesRaw as any[]).filter((r: any) => r.key !== 'client' && r.key !== 'super_admin');

  const { data: departments = [] } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => api.get('/hr/departments').then((r) => r.data),
    enabled: tab === 'workers',
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => api.get('/hr/designations').then((r) => r.data),
    enabled: tab === 'workers',
  });

  const reviewLeave = useMutation({
    mutationFn: ({ id, status, approverNote }: { id: string; status: string; approverNote?: string }) =>
      api.patch(`/hr/leaves/${id}/review`, { status, approverNote }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['hr-leaves'] }),
        qc.invalidateQueries({ queryKey: ['waiting-on-me'] }),
      ]);
      toast.success(vars.status === 'approved' ? 'Leave request approved.' : 'Leave request rejected.');
      setRejectLeaveTarget(null);
      setRejectLeaveNote('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update leave request.'),
  });

  const reviewInvoice = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hr/contractor-invoices/${id}/review`, { status }).then((r) => r.data),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['hr-contractor-invoices'] }),
        qc.invalidateQueries({ queryKey: ['waiting-on-me'] }),
      ]);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update invoice.'),
  });

  const advancePayroll = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/hr/payroll/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hr-payroll'] }),
  });

  const revertPayroll = useMutation({
    mutationFn: (id: string) => api.post(`/hr/payroll/${id}/revert`).then((r) => r.data),
    onSuccess: (run) => {
      setRevertRunTarget(null);
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Payroll reopened for correction. You can recalculate, then lock and mark paid again.');
      router.push(`/hr/payroll/${run.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to revert payroll run.'),
  });

  const createPayrollRun = useMutation({
    mutationFn: ({ period, workingDaysPerMonth, includeOvertime }: { period: string; workingDaysPerMonth: number; includeOvertime: boolean }) =>
      api.post('/hr/payroll', { period, workingDaysPerMonth, includeOvertime }).then((r) => r.data),
    onSuccess: (run) => {
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      setNewPeriod('');
      router.push(`/hr/payroll/${run.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.response?.data?.error || 'Failed to create payroll run.'),
  });

  // Temporary while QA-ing the payroll workflow — remove this delete option later.
  const deletePayrollRun = useMutation({
    mutationFn: (id: string) => api.delete(`/hr/payroll/${id}`).then((r) => r.data),
    onSuccess: () => {
      setDeleteRunTarget(null);
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Payroll run deleted.');
    },
    onError: (e: any) => {
      setDeleteRunTarget(null);
      toast.error(e?.response?.data?.message || 'Failed to delete payroll run.');
    },
  });

  const inviteWorker = useMutation({
    mutationFn: (data: typeof inviteForm) => api.post('/hr/workers/invite', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-workers'] });
      setShowInvite(false);
      setInviteForm(BLANK_INVITE);
      toast.success('Employee invited — a welcome email has been sent.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to invite employee.'),
  });

  const pendingReview = workers.filter((w: any) => w.status === 'under_review');
  const pendingAmendments = workers.filter((w: any) => w.status === 'profile_amended');

  // Under-review applications and profile amendments need action first, so they
  // always float to the top regardless of other filters — everything else keeps
  // its existing relative order.
  const STATUS_PRIORITY: Record<string, number> = { under_review: 0, profile_amended: 0, profile_pending: 1, invited: 2, active: 3, inactive: 4 };
  const filteredWorkers = (workers as any[])
    .filter((w: any) => !workerStatusFilter || w.status === workerStatusFilter)
    .filter((w: any) => !workerDesigFilter || w.designation === workerDesigFilter)
    .filter((w: any) => !workerDeptFilter || w.department === workerDeptFilter)
    .filter((w: any) => !workerTypeFilter || w.workerType === workerTypeFilter)
    .slice()
    .sort((a: any, b: any) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99));
  const filteredPayrollRuns = payrollStatusFilter
    ? (payrollRuns as any[]).filter((r: any) => r.status === payrollStatusFilter)
    : (payrollRuns as any[]);

  const NEXT_STATUS: Record<string, string> = {
    draft: 'open_for_review',
    open_for_review: 'locked',
    locked: 'paid',
  };

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={!!revertRunTarget}
        title={`Revert ${formatPeriod(revertRunTarget?.period)} back to Open for Review?`}
        message="This unlocks salary lines, clears generated slips, and lets you recalculate. Employees will need to confirm again before you can lock and mark paid."
        confirmLabel="Revert"
        danger
        onConfirm={() => {
          if (revertRunTarget) revertPayroll.mutate(revertRunTarget.id);
        }}
        onCancel={() => setRevertRunTarget(null)}
      />
      {/* Temporary while QA-ing the payroll workflow — remove this delete option later. */}
      <ConfirmDialog
        open={!!deleteRunTarget}
        title={`Delete ${formatPeriod(deleteRunTarget?.period)}?`}
        message="This permanently removes the payroll run and all its salary lines — this is not the usual archive/restore, it's a hard delete for testing. There's no undo."
        confirmLabel="Delete run"
        danger
        onConfirm={() => {
          if (deleteRunTarget) deletePayrollRun.mutate(deleteRunTarget.id);
        }}
        onCancel={() => setDeleteRunTarget(null)}
      />
      <Header title="HR & Payroll" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">

        {/* Onboarding alert */}
        {pendingReview.length > 0 && tab === 'workers' && (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-violet-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-violet-800">
                {pendingReview.length} worker{pendingReview.length !== 1 ? 's' : ''} pending onboarding review
              </p>
              <p className="text-xs text-violet-600 mt-0.5">
                {pendingReview.map((w: any) => w.user?.name).join(', ')} submitted their profile for review.
              </p>
            </div>
          </div>
        )}

        {pendingAmendments.length > 0 && tab === 'workers' && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-800">
                {pendingAmendments.length} profile amendment{pendingAmendments.length !== 1 ? 's' : ''} pending review
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                {pendingAmendments.map((w: any) => w.user?.name).join(', ')} edited their profile and need{pendingAmendments.length === 1 ? 's' : ''} re-approval.
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-full flex-wrap">
            {VALID_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-3 sm:px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none',
                  tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                {TAB_LABELS[t]}
                {t === 'workers' && pendingReview.length > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-violet-500 text-white">
                    {pendingReview.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          {tab === 'workers' && (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <select
                value={workerDesigFilter}
                onChange={(e) => setWorkerDesigFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-42"
              >
                <option value="">All designations</option>
                {(designations as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select
                value={workerDeptFilter}
                onChange={(e) => setWorkerDeptFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-42"
              >
                <option value="">All departments</option>
                {(departments as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
              <select
                value={workerTypeFilter}
                onChange={(e) => setWorkerTypeFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-36"
              >
                <option value="">All types</option>
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
              </select>
              <select
                value={workerStatusFilter}
                onChange={(e) => setWorkerStatusFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-42"
              >
                <option value="">All statuses</option>
                <option value="invited">Invited</option>
                <option value="profile_pending">Profile Pending</option>
                <option value="under_review">Under Review</option>
                <option value="profile_amended">Profile Amended</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <button
                onClick={() => { setInviteForm({ ...BLANK_INVITE, password: generatePassword() }); setShowInvitePassword(false); setShowInvite(true); }}
                className="flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors w-full sm:w-auto sm:min-w-38"
              >
                <UserPlus className="w-4 h-4" />
                Invite Employee
              </button>
            </div>
          )}
          {tab === 'payroll' && (
            <div className="flex flex-wrap items-center gap-2 w-full">
              <select
                value={payrollStatusFilter}
                onChange={(e) => setPayrollStatusFilter(e.target.value)}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-40"
              >
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="open_for_review">Open for Review</option>
                <option value="locked">Locked</option>
                <option value="paid">Paid</option>
              </select>
              <input
                type="month"
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                className="min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 w-full sm:w-auto sm:min-w-38"
              />
              <div className="flex items-center gap-1.5 w-full sm:w-auto">
                <label className="text-xs text-gray-500 whitespace-nowrap" htmlFor="new-working-days">
                  Working days
                </label>
                <input
                  id="new-working-days"
                  type="number"
                  min={1}
                  max={31}
                  value={newWorkingDays}
                  onChange={(e) => setNewWorkingDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  title="Working days for this month (raise for extra workdays, lower for holidays)"
                  className="w-full sm:w-20 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <label
                className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap cursor-pointer"
                title="If unchecked, this month's payroll won't pay out overtime — attendance overtime hours are still recorded either way."
              >
                <input
                  type="checkbox"
                  checked={newIncludeOvertime}
                  onChange={(e) => setNewIncludeOvertime(e.target.checked)}
                  className="w-4 h-4 rounded accent-brand-700"
                />
                Include OT
              </label>
              <button
                onClick={() => {
                  const days = typeof newWorkingDays === 'number' ? newWorkingDays : parseInt(String(newWorkingDays), 10);
                  if (!newPeriod) return;
                  if (!Number.isFinite(days) || days < 1 || days > 31) {
                    toast.error('Working days must be between 1 and 31.');
                    return;
                  }
                  createPayrollRun.mutate({ period: newPeriod, workingDaysPerMonth: days, includeOvertime: newIncludeOvertime });
                }}
                disabled={!newPeriod || createPayrollRun.isPending}
                className="flex items-center justify-center gap-1.5 whitespace-nowrap bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors w-full sm:w-auto sm:min-w-32"
              >
                <Plus className="w-4 h-4" />
                New Run
              </button>
            </div>
          )}
        </div>

        {/* Invite modal */}
        {showInvite && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Invite Employee</h3>
              <button onClick={() => setShowInvite(false)} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
            </div>
            <p className="text-xs text-gray-500">An email with login credentials will be sent to the employee.</p>
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Full Name</label>
                    <input
                      value={inviteForm.name}
                      onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
                      placeholder="Jane Smith"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Email</label>
                    <input
                      type="email"
                      value={inviteForm.email}
                      onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                      placeholder="jane@company.com"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Worker Type</label>
                    <select
                      value={inviteForm.workerType}
                      onChange={(e) => setInviteForm({ ...inviteForm, workerType: e.target.value as 'employee' | 'contractor' })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="employee">Employee</option>
                      <option value="contractor">Contractor</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Role</label>
                    <select
                      value={inviteForm.roleId}
                      onChange={(e) => setInviteForm({ ...inviteForm, roleId: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Default (Employee)</option>
                      {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Temporary Password</label>
                    <div className="relative">
                      <input
                        value={inviteForm.password}
                        onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
                        type={showInvitePassword ? 'text' : 'password'}
                        placeholder="Auto-generated"
                        className="w-full pl-3 pr-16 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setShowInvitePassword((v) => !v)}
                          className="p-1 text-gray-400 hover:text-gray-600"
                          title={showInvitePassword ? 'Hide password' : 'Show password'}
                        >
                          {showInvitePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setInviteForm({ ...inviteForm, password: generatePassword() })}
                          className="p-1 text-gray-400 hover:text-brand-700"
                          title="Generate a new password"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">The employee will be asked to change this after their first login.</p>
                  </div>
                </div>
                {inviteWorker.isError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {(inviteWorker.error as any)?.response?.data?.message || 'Failed to invite worker.'}
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => inviteWorker.mutate(inviteForm)}
                    disabled={!inviteForm.name || !inviteForm.email || inviteWorker.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {inviteWorker.isPending ? 'Sending…' : 'Send Invite'}
                  </button>
                </div>
              </div>
          </div>
        )}

        {/* Workers */}
        {tab === 'workers' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Team Members</h3>
            </div>
            <Table className="w-full min-w-160">
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Name</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Designation</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Department</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Type</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {loadingWorkers ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
                ) : filteredWorkers.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-8 text-sm text-gray-400 text-center">
                    {workerStatusFilter || workerDesigFilter || workerDeptFilter || workerTypeFilter
                      ? 'No workers match these filters.'
                      : 'No workers yet. Use "Invite Employee" to add your first team member.'}
                  </TableCell></TableRow>
                ) : (
                  filteredWorkers.map((w: any) => (
                    <TableRow
                      key={w.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => router.push(`/hr/workers/${w.id}`)}
                    >
                      <TableCell className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {w.profilePictureUrl ? (
                            <img src={w.profilePictureUrl} alt={w.user?.name} className="w-8 h-8 rounded-full object-cover border border-gray-200 shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
                              {w.user?.name?.[0] || '?'}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900">{w.user?.name}</p>
                            <p className="text-xs text-gray-400">{w.user?.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{w.designation || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{w.department || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600 capitalize">{w.workerType}</TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize', WORKER_STATUS_COLORS[w.status] || 'bg-gray-100 text-gray-600')}>
                          {titleCase(w.status)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Leave Requests */}
        {tab === 'leaves' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Leave Requests</h3>
            </div>
            <Table className="w-full min-w-160">
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Worker</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Type</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Period</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Days</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {loadingLeaves ? (
                  <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
                ) : leaves.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">No leave requests.</TableCell></TableRow>
                ) : (
                  leaves.map((lr: any) => (
                    <TableRow key={lr.id} className="hover:bg-gray-50">
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900">{lr.worker?.user?.name}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600 capitalize">{lr.type}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{lr.fromDate} – {lr.toDate}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{lr.days}</TableCell>
                      <TableCell className="px-5 py-3.5">
                        <div className="space-y-1">
                          <span className={cn('inline-flex px-2.5 py-1 text-xs font-medium rounded-full capitalize',
                            lr.status === 'approved' ? 'bg-brand-100 text-brand-800' :
                            lr.status === 'rejected' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700')}>
                            {lr.status}
                          </span>
                          {lr.status === 'rejected' && lr.approverNote && (
                            <p className="text-xs text-gray-500 max-w-48 line-clamp-2" title={lr.approverNote}>
                              Reason: {lr.approverNote}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        {lr.status === 'requested' && (
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => reviewLeave.mutate({ id: lr.id, status: 'approved' })}
                              disabled={reviewLeave.isPending}
                              className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Approve
                            </button>
                            <button
                              onClick={() => setRejectLeaveTarget({ id: lr.id, name: lr.worker?.user?.name || 'Employee' })}
                              disabled={reviewLeave.isPending}
                              className="inline-flex items-center gap-1.5 border border-red-200 hover:bg-red-50 disabled:opacity-60 text-red-600 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Reject leave modal */}
        {rejectLeaveTarget && (
          <Dialog open onOpenChange={(open) => { if (!open) { setRejectLeaveTarget(null); setRejectLeaveNote(''); } }}>
            <DialogContent className="max-w-md sm:max-w-md rounded-2xl">
              <DialogTitle className="sr-only">Reject leave request</DialogTitle>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Reject leave request</h3>
                <p className="text-xs text-gray-500 mt-1">
                  Rejecting leave for <strong>{rejectLeaveTarget.name}</strong>. The reason will be shared with the employee.
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Rejection reason <span className="text-red-500">*</span>
                </label>
                <textarea
                  autoFocus
                  value={rejectLeaveNote}
                  onChange={(e) => setRejectLeaveNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Insufficient leave balance for this period."
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setRejectLeaveTarget(null); setRejectLeaveNote(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => reviewLeave.mutate({
                    id: rejectLeaveTarget.id,
                    status: 'rejected',
                    approverNote: rejectLeaveNote.trim(),
                  })}
                  disabled={reviewLeave.isPending || !rejectLeaveNote.trim()}
                  className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  {reviewLeave.isPending ? 'Rejecting…' : 'Reject Leave'}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Contractor Invoices */}
        {tab === 'contractor-invoices' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <Receipt className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Contractor Invoices</h3>
            </div>
            <Table className="w-full min-w-160">
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Contractor</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Period</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Amount</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">File</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {loadingInvoices ? (
                  <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
                ) : (contractorInvoices as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="px-5 py-8 text-sm text-gray-400 text-center">No contractor invoices.</TableCell></TableRow>
                ) : (
                  (contractorInvoices as any[]).map((inv: any) => (
                    <TableRow key={inv.id} className="hover:bg-gray-50">
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900">{inv.worker?.user?.name || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{formatPeriod(inv.period)}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{inv.currency} {parseFloat(inv.amount).toLocaleString()}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm">
                        {inv.fileUrl ? (
                          <a href={inv.fileUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:text-brand-800 font-medium text-xs">View file</a>
                        ) : <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize',
                          inv.status === 'approved' ? 'bg-brand-100 text-brand-800' :
                          inv.status === 'paid' ? 'bg-blue-100 text-blue-700' :
                          inv.status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700')}>
                          {inv.status}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        {inv.status === 'submitted' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => reviewInvoice.mutate({ id: inv.id, status: 'approved' })}
                              className="text-xs text-brand-700 hover:text-brand-800 font-medium"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => reviewInvoice.mutate({ id: inv.id, status: 'rejected' })}
                              className="text-xs text-red-600 hover:text-red-700 font-medium"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Payroll */}
        {tab === 'payroll' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <Table className="w-full min-w-140">
                <TableHeader>
                  <TableRow className="border-b border-gray-200 bg-gray-100">
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Period</TableHead>
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Working days</TableHead>
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Created</TableHead>
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100">
                  {loadingPayroll ? (
                    <TableRow><TableCell colSpan={5} className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</TableCell></TableRow>
                  ) : filteredPayrollRuns.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="px-5 py-8 text-sm text-gray-400 text-center">
                      {payrollStatusFilter ? 'No payroll runs with this status.' : 'No payroll runs yet. Pick a month above to create one.'}
                    </TableCell></TableRow>
                  ) : (
                    filteredPayrollRuns.map((run: any) => (
                      <TableRow
                        key={run.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => router.push(`/hr/payroll/${run.id}`)}
                      >
                        <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900">{formatPeriod(run.period)}</TableCell>
                        <TableCell className="px-5 py-3.5 text-sm text-gray-600">{run.workingDaysPerMonth ?? '—'}</TableCell>
                        <TableCell className="px-5 py-3.5">
                          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize', PAYROLL_STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-600')}>
                            {titleCase(run.status)}
                          </span>
                        </TableCell>
                        <TableCell className="px-5 py-3.5 text-sm text-gray-600">
                          {new Date(run.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-3">
                            {NEXT_STATUS[run.status] && (
                              <button
                                onClick={() => advancePayroll.mutate({ id: run.id, status: NEXT_STATUS[run.status] })}
                                disabled={advancePayroll.isPending || revertPayroll.isPending}
                                className="text-xs text-brand-700 hover:text-brand-800 font-medium disabled:opacity-60"
                              >
                                → {titleCase(NEXT_STATUS[run.status])}
                              </button>
                            )}
                            {(run.status === 'locked' || run.status === 'paid') && (
                              <button
                                onClick={() => setRevertRunTarget({ id: run.id, period: run.period })}
                                disabled={revertPayroll.isPending}
                                className="text-xs text-amber-700 hover:text-amber-800 font-medium disabled:opacity-60"
                              >
                                Revert
                              </button>
                            )}
                            {/* Temporary while QA-ing the payroll workflow — remove this delete option later. */}
                            <button
                              onClick={() => setDeleteRunTarget({ id: run.id, period: run.period })}
                              disabled={deletePayrollRun.isPending}
                              title="Delete run (temporary, for testing)"
                              className="text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-60 inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
