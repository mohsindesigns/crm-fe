'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Calculator, Download, AlertCircle, CheckCircle, ChevronRight, RotateCcw, FileText,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, downloadAuthedFile, formatPeriod, titleCase, viewAuthedFile } from '@/lib/utils';
import { toast } from 'sonner';

const RUN_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  open_for_review: 'bg-amber-100 text-amber-700',
  locked: 'bg-blue-100 text-blue-700',
  paid: 'bg-brand-100 text-brand-800',
};

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-brand-100 text-brand-800',
  concern_raised: 'bg-red-100 text-red-700',
  rectifying: 'bg-blue-100 text-blue-700',
};

const NEXT_STATUS: Record<string, string> = {
  draft: 'open_for_review',
  open_for_review: 'locked',
  locked: 'paid',
};

const NEXT_STATUS_LABEL: Record<string, string> = {
  draft: 'Open for Review (auto-calculates)',
  open_for_review: 'Lock Run',
  locked: 'Mark as Paid (generates slips)',
};

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [rectifyItemId, setRectifyItemId] = useState<string | null>(null);
  const [rectifyForm, setRectifyForm] = useState<Record<string, any>>({});
  const [workingDays, setWorkingDays] = useState<number | ''>('');
  const [showRevertConfirm, setShowRevertConfirm] = useState(false);

  const { data: run, isLoading: runLoading } = useQuery({
    queryKey: ['hr-payroll-run', id],
    queryFn: () => api.get('/hr/payroll').then((r) => r.data.find((x: any) => x.id === id)),
  });

  useEffect(() => {
    if (run?.workingDaysPerMonth != null) setWorkingDays(run.workingDaysPerMonth);
  }, [run?.workingDaysPerMonth]);

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['hr-payroll-items', id],
    queryFn: () => api.get(`/hr/payroll/${id}/items`).then((r) => r.data),
  });

  const advanceMutation = useMutation({
    mutationFn: (status: string) => api.patch(`/hr/payroll/${id}/status`, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll-items', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
    },
  });

  const calculateMutation = useMutation({
    mutationFn: (workingDaysPerMonth: number) =>
      api.post(`/hr/payroll/${id}/calculate`, { workingDaysPerMonth }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll-items', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Payroll recalculated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Recalculate failed.'),
  });

  const revertMutation = useMutation({
    mutationFn: () => api.post(`/hr/payroll/${id}/revert`).then((r) => r.data),
    onSuccess: () => {
      setShowRevertConfirm(false);
      qc.invalidateQueries({ queryKey: ['hr-payroll-run', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll-items', id] });
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success('Payroll reopened for correction. Recalculate if needed, then lock and mark paid again.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to revert payroll run.'),
  });

  const rectifyMutation = useMutation({
    mutationFn: ({ itemId, ...data }: any) => api.patch(`/hr/payroll-items/${itemId}/rectify`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll-items', id] });
      setRectifyItemId(null);
      toast.success('Payroll item updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to rectify item.'),
  });

  const [editTaxItemId, setEditTaxItemId] = useState<string | null>(null);
  const [editTaxValue, setEditTaxValue] = useState('');

  const overrideTaxMutation = useMutation({
    mutationFn: ({ workerId, tax }: { workerId: string; tax: number }) =>
      api.put(`/hr/payroll/${id}/items/${workerId}`, { tax }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-payroll-items', id] });
      setEditTaxItemId(null);
      toast.success('Tax override saved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update tax.'),
  });

  async function downloadDisbursement() {
    try {
      await downloadAuthedFile(`/hr/payroll/${id}/disbursement`, `disbursement-${formatPeriod(run?.period) || id}.csv`, { format: 'csv' });
    } catch (e: any) {
      toast.error(e?.message || 'Download failed. Please try again.');
    }
  }

  if (runLoading) return <div className="flex flex-col h-full"><Header title="Payroll Run" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div></div>;
  if (!run) return <div className="flex flex-col h-full"><Header title="Payroll Run" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Run not found.</div></div>;

  const concernItems = items.filter((i: any) => i.employeeStatus === 'concern_raised');
  const confirmedItems = items.filter((i: any) => i.employeeStatus === 'confirmed');
  const lockedItems = items.filter((i: any) => i.isLocked);
  const totalNet = lockedItems.reduce((s: number, i: any) => s + parseFloat(i.computedNet || 0), 0);

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={showRevertConfirm}
        title={`Revert ${formatPeriod(run.period)} back to Open for Review?`}
        message="This unlocks salary lines, clears generated slips, and lets you recalculate. Employees will need to confirm again before you can lock and mark paid."
        confirmLabel="Revert"
        danger
        onConfirm={() => revertMutation.mutate()}
        onCancel={() => setShowRevertConfirm(false)}
      />
      <Header title={`Payroll — ${formatPeriod(run.period)}`} />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" />
          Back to HR
        </button>

        {/* Run header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Payroll Run — {formatPeriod(run.period)}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {run.workingDaysPerMonth ?? '—'} working days ·
              {items.length} employee{items.length !== 1 ? 's' : ''} ·
              {confirmedItems.length} confirmed ·
              {concernItems.length > 0 && ` ${concernItems.length} concern${concernItems.length !== 1 ? 's' : ''} ·`}
              {lockedItems.length > 0 && ` ${lockedItems.length} locked`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('px-3 py-1 text-xs font-medium rounded-full', RUN_STATUS_COLORS[run.status] || 'bg-gray-100 text-gray-600')}>
              {titleCase(run.status)}
            </span>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-3 flex-wrap">
          {(run.status === 'draft' || run.status === 'open_for_review') && (
            <>
              <div className="flex items-center gap-1.5">
                <label className="text-xs text-gray-500 whitespace-nowrap" htmlFor="run-working-days">
                  Working days
                </label>
                <input
                  id="run-working-days"
                  type="number"
                  min={1}
                  max={31}
                  value={workingDays}
                  onChange={(e) => setWorkingDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                  className="w-20 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <button
                onClick={() => {
                  const days = typeof workingDays === 'number' ? workingDays : parseInt(String(workingDays), 10);
                  if (!Number.isFinite(days) || days < 1 || days > 31) {
                    toast.error('Working days must be between 1 and 31.');
                    return;
                  }
                  calculateMutation.mutate(days);
                }}
                disabled={calculateMutation.isPending}
                className="flex items-center gap-1.5 border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Calculator className="w-4 h-4" />
                {calculateMutation.isPending ? 'Calculating…' : 'Recalculate from Attendance'}
              </button>
            </>
          )}

          {NEXT_STATUS[run.status] && (
            <button
              onClick={() => advanceMutation.mutate(NEXT_STATUS[run.status])}
              disabled={advanceMutation.isPending || revertMutation.isPending}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
              {advanceMutation.isPending ? 'Processing…' : NEXT_STATUS_LABEL[run.status]}
            </button>
          )}

          {(run.status === 'locked' || run.status === 'paid') && (
            <button
              onClick={() => setShowRevertConfirm(true)}
              disabled={revertMutation.isPending}
              className="flex items-center gap-1.5 border border-amber-300 bg-amber-50 hover:bg-amber-100 disabled:opacity-60 text-amber-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {revertMutation.isPending ? 'Reverting…' : 'Revert / Re-run'}
            </button>
          )}

          {(run.status === 'locked' || run.status === 'paid') && lockedItems.length > 0 && (
            <button
              onClick={downloadDisbursement}
              className="flex items-center gap-1.5 border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              Disbursement Sheet (CSV)
            </button>
          )}
        </div>

        {/* Disbursement summary (locked/paid) */}
        {(run.status === 'locked' || run.status === 'paid') && lockedItems.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-blue-800">{lockedItems.length} employees ready for disbursement</p>
              <p className="text-xs text-blue-600 mt-0.5">Total net to transfer</p>
            </div>
            <p className="text-xl font-bold text-blue-800">{totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
          </div>
        )}

        {/* Concerns alert */}
        {concernItems.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <p className="text-sm font-semibold text-red-800">{concernItems.length} payroll item{concernItems.length !== 1 ? 's' : ''} with concerns raised</p>
            </div>
            <p className="text-xs text-red-600">Review the concerns below and use "Rectify" to adjust amounts before re-sending for employee confirmation.</p>
          </div>
        )}

        {/* Items table */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">Payroll Items</h3>
          </div>
          {itemsLoading ? (
            <div className="px-5 py-8 text-sm text-gray-400 text-center">Loading items…</div>
          ) : items.length === 0 ? (
            <div className="px-5 py-8 text-sm text-gray-400 text-center">
              No items yet. {run.status === 'draft' ? 'Click "Recalculate from Attendance" or advance to Open for Review to auto-generate items.' : ''}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Employee</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Present</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Absent</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Late</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Base</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Tax</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Net</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any) => (
                  <>
                    <tr key={item.id} className={cn('hover:bg-gray-50', item.isLocked ? 'bg-blue-50/30' : '')}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar src={item.worker?.user?.avatarUrl} name={item.worker?.user?.name} size="xs" />
                          <div>
                            <p className="text-sm font-medium text-gray-900">{item.worker?.user?.name}</p>
                            {item.worker?.designation && <p className="text-xs text-gray-400">{item.worker.designation}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 text-right">{item.presentDays}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 text-right">{item.absentDays + item.halfDays * 0.5}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 text-right">
                        {item.lateCount || 0}
                        {Number(item.latePenaltyDays || 0) > 0 && (
                          <span
                            className="block text-[10px] text-amber-600"
                            title={
                              Number(item.latePenaltyUnpaidDays || 0) > 0
                                ? `${item.latePenaltyDays}d deducted — ${item.latePenaltyUnpaidDays}d unpaid (no leave balance left)`
                                : `${item.latePenaltyDays}d deducted from leave balance`
                            }
                          >
                            −{item.latePenaltyDays}d{Number(item.latePenaltyUnpaidDays || 0) > 0 ? ' unpaid' : ' leave'}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 text-right">{Number(item.base || 0).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">
                        {Number(item.deductions?.tax || 0).toLocaleString()}
                      </td>
                      <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 text-right">
                        {Number(item.computedNet || 0).toLocaleString()}
                        {item.isLocked && <span className="ml-1 text-blue-500 text-xs">🔒</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-0.5 text-xs font-medium rounded-full', ITEM_STATUS_COLORS[item.employeeStatus] || 'bg-gray-100 text-gray-500')}>
                          {titleCase(item.employeeStatus)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              viewAuthedFile(`/hr/payroll-items/${item.id}/slip`)
                                .catch((e: any) => toast.error(e?.message || 'Failed to open slip.'));
                            }}
                            className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-brand-800 font-medium"
                            title="View salary slip with calculation breakdown"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            View slip
                          </button>
                          {item.employeeStatus === 'concern_raised' && !item.isLocked && (
                            <button
                              onClick={() => {
                                setRectifyItemId(item.id);
                                setRectifyForm({
                                  base: item.base,
                                  additions: item.additions || {},
                                  deductions: item.deductions || {},
                                  tax: item.deductions?.tax ?? 0,
                                  adminNote: '',
                                });
                              }}
                              className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                            >
                              Rectify
                            </button>
                          )}
                          {(run.status === 'draft' || run.status === 'open_for_review') && !item.isLocked && (
                            <button
                              onClick={() => {
                                setEditTaxItemId(item.id);
                                setEditTaxValue(String(item.deductions?.tax ?? 0));
                              }}
                              className="text-xs text-brand-700 hover:text-brand-800 font-medium"
                            >
                              Edit tax
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Inline concern note */}
                    {item.employeeStatus === 'concern_raised' && item.concernNote && (
                      <tr key={`${item.id}-concern`} className="bg-red-50">
                        <td colSpan={9} className="px-5 py-2">
                          <p className="text-xs text-red-700">
                            <strong>Concern:</strong> {item.concernNote}
                          </p>
                        </td>
                      </tr>
                    )}
                    {editTaxItemId === item.id && (
                      <tr key={`${item.id}-tax`} className="bg-brand-50/40">
                        <td colSpan={9} className="px-5 py-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Tax override (monthly)</label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                value={editTaxValue}
                                onChange={(e) => setEditTaxValue(e.target.value)}
                                className="w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={overrideTaxMutation.isPending}
                              onClick={() => overrideTaxMutation.mutate({
                                workerId: item.workerId,
                                tax: parseFloat(editTaxValue) || 0,
                              })}
                              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-xs font-medium px-3 py-2 rounded-lg"
                            >
                              Save tax
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditTaxItemId(null)}
                              className="text-xs text-gray-500 px-2 py-2"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {/* Rectify form */}
                    {rectifyItemId === item.id && (
                      <tr key={`${item.id}-rectify`}>
                        <td colSpan={9} className="px-5 py-4 bg-amber-50 border-t border-amber-200">
                          <div className="space-y-3">
                            <p className="text-xs font-semibold text-amber-800">Rectify Payroll Item — {item.worker?.user?.name}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Base Salary</label>
                                <input
                                  type="number"
                                  value={rectifyForm.base || ''}
                                  onChange={(e) => setRectifyForm({ ...rectifyForm, base: e.target.value })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Attendance pay</label>
                                <input
                                  type="number"
                                  value={rectifyForm.additions?.attendancePay ?? ''}
                                  onChange={(e) => setRectifyForm({
                                    ...rectifyForm,
                                    additions: { ...rectifyForm.additions, attendancePay: parseFloat(e.target.value) || 0 }
                                  })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Overtime (addition)</label>
                                <input
                                  type="number"
                                  value={rectifyForm.additions?.overtime || ''}
                                  onChange={(e) => setRectifyForm({
                                    ...rectifyForm,
                                    additions: { ...rectifyForm.additions, overtime: parseFloat(e.target.value) || 0 }
                                  })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Extra deduction</label>
                                <input
                                  type="number"
                                  value={rectifyForm.deductions?.absenceCut || ''}
                                  onChange={(e) => setRectifyForm({
                                    ...rectifyForm,
                                    deductions: { ...rectifyForm.deductions, absenceCut: parseFloat(e.target.value) || 0 }
                                  })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Tax (deduction)</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={rectifyForm.tax ?? rectifyForm.deductions?.tax ?? ''}
                                  onChange={(e) => setRectifyForm({
                                    ...rectifyForm,
                                    tax: e.target.value,
                                    deductions: {
                                      ...rectifyForm.deductions,
                                      tax: parseFloat(e.target.value) || 0,
                                    },
                                  })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">Admin Note</label>
                                <input
                                  value={rectifyForm.adminNote || ''}
                                  onChange={(e) => setRectifyForm({ ...rectifyForm, adminNote: e.target.value })}
                                  placeholder="Explanation to employee…"
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                                />
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => rectifyMutation.mutate({
                                  itemId: item.id,
                                  ...rectifyForm,
                                  tax: rectifyForm.tax !== undefined && rectifyForm.tax !== ''
                                    ? parseFloat(rectifyForm.tax)
                                    : undefined,
                                })}
                                disabled={rectifyMutation.isPending}
                                className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                {rectifyMutation.isPending ? 'Saving…' : 'Save & Send for Re-confirmation'}
                              </button>
                              <button
                                onClick={() => setRectifyItemId(null)}
                                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Disbursement detail table (locked/paid) */}
        {(run.status === 'locked' || run.status === 'paid') && lockedItems.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Disbursement Details</h3>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Employee</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Bank</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Account</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lockedItems.map((item: any) => (
                  <tr key={`disb-${item.id}`} className="hover:bg-gray-50">
                    <td className="px-5 py-3 text-sm font-medium text-gray-900">
                      {item.worker?.user?.name}
                      {item.worker?.designation && <span className="text-gray-400 text-xs ml-1">· {item.worker.designation}</span>}
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-600">{item.worker?.bankName || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-600 font-mono text-xs">
                      {item.worker?.bankAccountTitle && <span className="block text-gray-900">{item.worker.bankAccountTitle}</span>}
                      {item.worker?.bankAccountNumber || item.worker?.iban || '—'}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-gray-900 text-right">
                      {item.worker?.currency || 'PKR'} {Number(item.computedNet || 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
                <tr className="bg-gray-50 border-t-2 border-gray-200">
                  <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-gray-700 text-right">Total</td>
                  <td className="px-5 py-3 text-sm font-bold text-gray-900 text-right">
                    {totalNet.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
