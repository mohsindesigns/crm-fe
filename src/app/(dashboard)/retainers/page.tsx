'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, RefreshCw, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle, { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, formatDate, formatCurrency, inactiveRow } from '@/lib/utils';
import { invalidateMany, afterRetainerChange } from '@/lib/queryInvalidation';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

export default function RetainersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ clientId: '', packageId: '', currency: 'USD', amount: '', cycle: 'monthly', nextInvoiceDate: '', status: 'active' });
  const [editForm, setEditForm] = useState({ status: '', amount: '', nextInvoiceDate: '' });
  const [deleteRetainerId, setDeleteRetainerId] = useState<string | null>(null);
  const inactive = useShowInactive();

  const { data: retainers, isLoading } = useQuery({
    queryKey: ['retainers', inactive.key],
    queryFn: () => api.get('/retainers', { params: inactive.params }).then((r) => r.data),
  });

  const { data: summary } = useQuery({
    queryKey: ['retainers-summary'],
    queryFn: () => api.get('/retainers/summary').then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });
  const serviceName = (key: string) => {
    if (key === 'other') return 'Other';
    if (key.includes('+')) {
      return key.split('+')
        .map((k) => (serviceTypes as any[]).find((s: any) => s.key === k)?.name || k)
        .join(' + ');
    }
    return (serviceTypes as any[]).find((s: any) => s.key === key)?.name || key;
  };

  const { data: clients } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
    enabled: showForm,
  });

  const { data: packages } = useQuery({
    queryKey: ['admin-packages'],
    queryFn: () => api.get('/admin/packages').then((r) => r.data),
    enabled: showForm,
  });

  const createRetainer = useMutation({
    mutationFn: (data: any) => api.post('/retainers', data).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterRetainerChange());
      setShowForm(false);
      setForm({ clientId: '', packageId: '', currency: 'USD', amount: '', cycle: 'monthly', nextInvoiceDate: '', status: 'active' });
      toast.success('Retainer created.');
    },
  });

  const updateRetainer = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.patch(`/retainers/${id}`, data).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterRetainerChange());
      setEditId(null);
      toast.success('Retainer updated.');
    },
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle). A
  // retainer set to Inactive stops billing but keeps its invoice history.
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      (next ? api.post(`/retainers/${id}/activate`) : api.delete(`/retainers/${id}`)).then((r) => r.data),
    onSuccess: async (_d, { next }) => {
      await invalidateMany(qc, afterRetainerChange());
      setDeleteRetainerId(null);
      toast.success(next ? 'Retainer set to Active.' : 'Retainer set to Inactive.');
    },
    onError: (e: any) => {
      setDeleteRetainerId(null);
      toast.error(e?.response?.data?.message || 'Could not change status.');
    },
  });

  const retainerArr: any[] = retainers || [];

  return (
    <div className="flex flex-col h-full">
      <Header title="Retainers" />
      {/* p-6 on a phone left ~330px of usable width for a count and two controls,
          so the button wrapped to two lines and ran under the toggle. */}
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-gray-500 whitespace-nowrap">{retainerArr.length} retainer{retainerArr.length !== 1 ? 's' : ''}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <ShowInactiveToggle {...inactive.toggleProps} />
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" />
              New Retainer
            </button>
          </div>
        </div>

        {summary && (summary.byService || []).length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {summary.byService.map((s: any) => (
              <div key={`${s.serviceTypeKey}-${s.currency}`} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-xl font-semibold text-gray-900">{formatCurrency(s.total, s.currency)}</p>
                <p className="text-xs text-gray-500 mt-0.5 capitalize">{serviceName(s.serviceTypeKey)}</p>
              </div>
            ))}
            {summary.grandTotal.map((g: any) => (
              <div key={`total-${g.currency}`} className="bg-brand-50 rounded-xl border border-brand-200 p-4">
                <p className="text-xl font-semibold text-brand-900">{formatCurrency(g.total, g.currency)}</p>
                <p className="text-xs text-brand-700 mt-0.5">Total ({g.currency})</p>
              </div>
            ))}
          </div>
        )}

        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">New Retainer</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Client</label>
                <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Select client…</option>
                  {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Package (optional)</label>
                <select value={form.packageId} onChange={(e) => setForm({ ...form, packageId: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">None</option>
                  {(packages || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Amount</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" placeholder="0.00" value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="flex-1 px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                    {['USD', 'EUR', 'GBP', 'PKR', 'AED'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Billing Cycle</label>
                <select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">First Invoice Date</label>
                <input type="date" value={form.nextInvoiceDate} onChange={(e) => setForm({ ...form, nextInvoiceDate: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createRetainer.mutate({ ...form, amount: parseFloat(form.amount), packageId: form.packageId || undefined })}
                disabled={!form.clientId || !form.amount || createRetainer.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {createRetainer.isPending ? 'Creating…' : 'Create Retainer'}
              </button>
              <button onClick={() => setShowForm(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Package</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Cycle</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Next Invoice</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
              ) : retainerArr.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">No retainers yet.</td></tr>
              ) : (
                retainerArr.map((ret: any) => (
                  <tr key={ret.id} className={cn('hover:bg-gray-50', inactiveRow(ret.isActive))}>
                    {editId === ret.id ? (
                      <td colSpan={7} className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <span className="text-sm font-medium text-gray-900">{ret.client?.name}</span>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Amount</label>
                            <input type="number" step="0.01" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                              className="w-28 px-3 py-1.5 text-sm border border-gray-300 rounded-lg" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Next Invoice</label>
                            <input type="date" value={editForm.nextInvoiceDate} onChange={(e) => setEditForm({ ...editForm, nextInvoiceDate: e.target.value })}
                              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Status</label>
                            <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg">
                              <option value="active">Active</option>
                              <option value="paused">Paused</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>
                          <button onClick={() => updateRetainer.mutate({ id: ret.id, data: { ...editForm, amount: parseFloat(editForm.amount) } })}
                            disabled={updateRetainer.isPending}
                            className="flex items-center gap-1 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
                            <Save className="w-3.5 h-3.5" />{updateRetainer.isPending ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditId(null)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    ) : (
                      <>
                        <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                          {ret.client?.name || '—'}
                          {ret.isActive === false && <InactiveBadge className="ml-2" />}
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-500">
                          {ret.package?.name || ret.clientPackage?.package?.name || '—'}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-semibold text-gray-900 text-right font-mono">
                          {formatCurrency(ret.amount, ret.currency)}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="flex items-center gap-1.5 text-sm text-gray-600">
                            <RefreshCw className="w-3.5 h-3.5 text-gray-400" />
                            {CYCLE_LABELS[ret.cycle] || ret.cycle}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-600">
                          {ret.nextInvoiceDate ? formatDate(ret.nextInvoiceDate) : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[ret.status] || 'bg-gray-100 text-gray-600')}>
                            {ret.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => { setEditId(ret.id); setEditForm({ status: ret.status, amount: String(ret.amount), nextInvoiceDate: ret.nextInvoiceDate || '' }); }}
                              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <ActiveToggle
                              isActive={ret.isActive !== false}
                              label="retainer"
                              disabled={toggleActive.isPending}
                              onToggle={(next) => {
                                if (next) { toggleActive.mutate({ id: ret.id, next }); return; }
                                setDeleteRetainerId(ret.id);
                              }}
                            />
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteRetainerId}
        title="Set retainer to Inactive"
        message="It stops generating invoices and drops off this list. Every invoice it already raised stays on record, and an admin can set it back to Active at any time — nothing is deleted."
        confirmLabel="Set Inactive"
        onConfirm={() => toggleActive.mutate({ id: deleteRetainerId!, next: false })}
        onCancel={() => setDeleteRetainerId(null)}
      />
    </div>
  );
}
