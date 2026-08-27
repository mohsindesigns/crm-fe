'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Briefcase, Search, Filter, Pencil } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle, { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, inactiveRow, formatCurrency } from '@/lib/utils';
import { invalidateMany, afterClientChange } from '@/lib/queryInvalidation';

// Who owes money, and who is actually late. Kept apart because they answer
// different questions — only the overdue set needs chasing.
const BALANCE_OPTS = [
  { label: 'Any balance', value: '' },
  { label: 'Has outstanding', value: 'outstanding' },
  { label: 'Overdue only', value: 'overdue' },
];

const STATUS_OPTS = [
  { label: 'All statuses', value: '' },
  { label: 'Active',  value: 'active'  },
  { label: 'Paused',  value: 'paused'  },
  { label: 'Churned', value: 'churned' },
];

const STATUS_COLORS: Record<string, string> = {
  active:  'bg-brand-100 text-brand-800',
  paused:  'bg-amber-100  text-amber-700',
  churned: 'bg-red-100    text-red-700',
};

const LIMIT = 25;

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-36" />
            </div>
          </td>
          <td className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-16" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-10" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-8" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-12" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-14" /></td>
        </tr>
      ))}
    </>
  );
}

export default function ClientsPage() {
  const [rawSearch, setRawSearch] = useState('');
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  const [balance,   setBalance]   = useState('');
  const [payViaCrm, setPayViaCrm] = useState(false);
  const [page,      setPage]      = useState(1);
  const [showForm,  setShowForm]  = useState(false);
  const [form, setForm] = useState({ name: '', defaultCurrency: 'USD', notes: '' });
  const [editingClient, setEditingClient] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: '', status: 'active', defaultCurrency: 'USD', notes: '' });
  const [deletingClient, setDeletingClient] = useState<any>(null);
  const queryClient = useQueryClient();
  const router = useRouter();

  // Debounce search — reset to page 1 when query changes
  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const resetPage = useCallback(() => setPage(1), []);
  const inactive = useShowInactive();

  const { data, isLoading } = useQuery({
    queryKey: ['clients', { page, search, status, balance, payViaCrm, inactive: inactive.key }],
    queryFn: () =>
      api.get('/clients', { params: {
        page, limit: LIMIT, search: search || undefined, status: status || undefined,
        balance: balance || undefined, payViaCrm: payViaCrm || undefined, ...inactive.params,
      } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const clients: any[]  = data?.data     || [];
  const total: number   = data?.total    || 0;
  const totalPages: number = data?.totalPages || 1;

  const createMutation = useMutation({
    mutationFn: (d: typeof form) => api.post('/clients', d).then((r) => r.data),
    onSuccess: async (created: any) => {
      await invalidateMany(queryClient, afterClientChange());
      setShowForm(false);
      setForm({ name: '', defaultCurrency: 'USD', notes: '' });
      toast.success('Client created.');
      if (created?.id) router.push(`/clients/${created.id}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (d: typeof editForm) => api.patch(`/clients/${editingClient.id}`, d).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(queryClient, afterClientChange(editingClient?.id));
      setEditingClient(null);
      toast.success('Client updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update client.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/clients/${id}/activate`) : api.delete(`/clients/${id}`),
    onSuccess: async (_d, { id, next }) => {
      await invalidateMany(queryClient, afterClientChange(id));
      setDeletingClient(null);
      toast.success(next ? 'Client set to Active.' : 'Client set to Inactive.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not change status.');
      setDeletingClient(null);
    },
  });

  return (
    <div className="flex flex-col h-full">
      <Header title="Clients" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); resetPage(); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={balance}
              onChange={(e) => { setBalance(e.target.value); resetPage(); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {BALANCE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <label className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-3 py-2 rounded-lg border cursor-pointer transition-colors',
              payViaCrm ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            )}>
              <input
                type="checkbox"
                checked={payViaCrm}
                onChange={(e) => { setPayViaCrm(e.target.checked); resetPage(); }}
                className="w-3.5 h-3.5 rounded accent-brand-600"
              />
              Pay via CRM
            </label>

            <ShowInactiveToggle {...inactive.toggleProps} onChange={(v) => { inactive.setShow(v); resetPage(); }} />

            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Client
            </button>
          </div>
        </div>

        {/* ── Add form ── */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">New Client</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Company Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Acme Inc."
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                <select
                  value={form.defaultCurrency}
                  onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name || createMutation.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {createMutation.isPending ? 'Creating…' : 'Create Client'}
              </button>
              <button
                onClick={() => setShowForm(false)}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-140">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Outstanding</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Currency</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Contacts</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Notes</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">
                    No clients found.
                  </td>
                </tr>
              ) : (
                clients.map((client: any) => (
                  <tr key={client.id} className={cn('hover:bg-gray-50/60 transition-colors', inactiveRow(client.isActive))}>
                    <td className="px-5 py-3.5">
                      <Link href={`/clients/${client.id}`} className="flex items-center gap-3 group">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                          <Briefcase className="w-4 h-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-900 group-hover:text-brand-800 transition-colors">
                          {client.name}
                        </span>
                        {client.isActive === false && <InactiveBadge />}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[client.status] || 'bg-gray-100 text-gray-600')}>
                        {client.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm">
                      {Array.isArray(client.outstanding) && client.outstanding.length > 0 ? (
                        // Amount and its overdue flag read as one statement, so
                        // they sit on one line — the badge wraps under only when
                        // the column is too narrow to hold both.
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {client.outstanding.map((o: any) => (
                            <span
                              key={`${client.id}-${o.currency}`}
                              className={cn(
                                'font-medium',
                                o.amount > 0 ? 'text-red-700' : 'text-gray-500',
                              )}
                            >
                              {formatCurrency(o.amount || 0, o.currency || client.defaultCurrency)}
                            </span>
                          ))}
                          {/* Whether the money is merely owed or actually late —
                              the distinction the chasing list depends on.
                              When the whole balance is overdue (the common case)
                              the amount is NOT repeated: the figure above already
                              says it, so the badge only has to say it's late. */}
                          {client.overdueCount > 0 && (() => {
                            const allOverdue = Math.abs(
                              (Number(client.overdueTotal) || 0) - (Number(client.outstandingTotal) || 0),
                            ) < 0.01;
                            return (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-100 rounded px-1.5 py-0.5 whitespace-nowrap">
                                {allOverdue
                                  ? 'Overdue'
                                  : `${formatCurrency(client.overdueTotal || 0, client.defaultCurrency)} overdue`}
                                <span className="font-normal text-red-500">
                                  · {client.overdueCount} {client.overdueCount === 1 ? 'invoice' : 'invoices'}
                                </span>
                              </span>
                            );
                          })()}
                        </div>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{client.defaultCurrency}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{client.contacts?.length ?? 0}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-400 max-w-xs truncate">{client.notes || '—'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            setEditingClient(client);
                            setEditForm({ name: client.name, status: client.status, defaultCurrency: client.defaultCurrency, notes: client.notes || '' });
                          }}
                          className="p-1.5 text-gray-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors"
                          title="Edit client"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <ActiveToggle
                          isActive={client.isActive !== false}
                          label="client"
                          disabled={toggleActive.isPending}
                          onToggle={(next) => {
                            if (next) { toggleActive.mutate({ id: client.id, next }); return; }
                            setDeletingClient(client);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>

      </div>

      {/* ── Edit modal ── */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setEditingClient(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Edit Client</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Company Name</label>
                <input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  {STATUS_OPTS.filter((o) => o.value).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                <select
                  value={editForm.defaultCurrency}
                  onChange={(e) => setEditForm({ ...editForm, defaultCurrency: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setEditingClient(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateMutation.mutate(editForm)}
                disabled={!editForm.name || updateMutation.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deletingClient}
        title="Set client to Inactive"
        message={`Set "${deletingClient?.name}" to Inactive? They drop off this list along with their contacts (who lose portal access), but every project, invoice, retainer and sold package is kept exactly as it is. An admin can set them back to Active at any time — nothing is deleted.`}
        confirmLabel="Set Inactive"
        onConfirm={() => toggleActive.mutate({ id: deletingClient.id, next: false })}
        onCancel={() => setDeletingClient(null)}
      />
    </div>
  );
}
