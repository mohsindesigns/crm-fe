'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Filter, Ban } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import InvoiceTable from '@/components/invoices/InvoiceTable';
import InvoiceGroupedView from '@/components/invoices/InvoiceGroupedView';
import LineItemsEditor from '@/components/invoices/LineItemsEditor';
import { STATUS_OPTS, VOIDABLE, emptyLine, type LineItem } from '@/components/invoices/invoiceShared';
import { cn } from '@/lib/utils';
import { invalidateMany, afterPersonalInvoiceChange } from '@/lib/queryInvalidation';

// Personal invoices are a fully separate section from the official Invoices
// page (crm-be PersonalInvoice model + routes/personalInvoices.js) — own
// contacts, own number series, and deliberately no effect on company revenue
// or the Clients page. The UX otherwise mirrors invoices/page.tsx: same
// create-form shape, same status lifecycle, same "pay via CRM" flow.

const LIMIT = 25;

export default function PersonalInvoicesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [rawSearch, setRawSearch] = useState('');
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  const [contactFilter, setContactFilter] = useState('');
  const [month,     setMonth]     = useState('');
  const [hideVoid,  setHideVoid]  = useState(true);
  const [page,      setPage]      = useState(1);
  const [showForm,  setShowForm]  = useState(false);
  const [showNewContact, setShowNewContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', contactEmail: '', contactPhone: '', billingAddress: '' });
  const [form, setForm] = useState({
    contactId: '', companyId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '', allowPartialPayment: false,
  });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [viewMode, setViewMode] = useState<'invoice' | 'contact'>('invoice');
  const [expandedContacts, setExpandedContacts] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);

  useEffect(() => {
    const statusParam = searchParams.get('status');
    if (!statusParam) return;
    if (!STATUS_OPTS.map((s) => s.value).includes(statusParam)) return;
    setStatus(statusParam);
    setPage(1);
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, status, contactFilter, month, hideVoid]);

  const { data, isLoading } = useQuery({
    queryKey: ['personal-invoices', { page, search, status, contactFilter, month, hideVoid }],
    queryFn: () =>
      api.get('/personal-invoices', {
        params: {
          page, limit: LIMIT, search: search || undefined, status: status || undefined,
          contactId: contactFilter || undefined, month: month || undefined,
          excludeVoid: hideVoid || undefined,
        },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: groupedData, isLoading: groupedLoading } = useQuery({
    queryKey: ['personal-invoices-by-contact', { search, status, contactFilter, month, hideVoid }],
    queryFn: () =>
      api.get('/personal-invoices', {
        params: {
          page: 1, limit: 100, search: search || undefined, status: status || undefined,
          contactId: contactFilter || undefined, month: month || undefined,
          excludeVoid: hideVoid || undefined,
        },
      }).then((r) => r.data),
    enabled: viewMode === 'contact',
    placeholderData: (prev) => prev,
  });

  const { data: contacts, refetch: refetchContacts } = useQuery({
    queryKey: ['personal-contacts'],
    queryFn: () => api.get('/personal-contacts').then((r) => r.data || []),
  });

  const { data: companies } = useQuery({
    queryKey: ['personal-invoice-companies'],
    queryFn: () => api.get('/personal-invoices/companies').then((r) => r.data || []),
    staleTime: 5 * 60 * 1000,
  });

  const invoices: any[]    = data?.data       || [];
  const total: number      = data?.total      || 0;
  const totalPages: number = data?.totalPages || 1;

  const contactGroups = useMemo(() => {
    const rows: any[] = groupedData?.data || [];
    const byContact = new Map<string, any>();

    for (const inv of rows) {
      const id = inv.contact?.id || inv.contactId || 'unknown';
      const group = byContact.get(id) || {
        id,
        name: inv.contact?.name || 'Unknown contact',
        currency: inv.currency || 'USD',
        invoices: [] as any[],
        total: 0,
        outstanding: 0,
        overdue: 0,
        paid: 0,
      };
      const amount = parseFloat(inv.total) || 0;
      group.invoices.push(inv);
      if (inv.status !== 'void') {
        group.total += amount;
        if (inv.status === 'paid') group.paid += amount;
        else group.outstanding += amount;
        if (inv.status === 'overdue') group.overdue += amount;
      }
      byContact.set(id, group);
    }

    return [...byContact.values()]
      .map((g) => ({
        ...g,
        invoices: g.invoices.sort((a: any, b: any) =>
          String(b.issuedAt || '').localeCompare(String(a.issuedAt || ''))),
      }))
      .sort((a, b) => b.outstanding - a.outstanding || b.total - a.total);
  }, [groupedData]);

  const voidableIds = useMemo(
    () => invoices.filter((inv) => VOIDABLE.has(inv.status)).map((inv) => inv.id as string),
    [invoices],
  );
  const allVoidableSelected = voidableIds.length > 0 && voidableIds.every((id) => selectedIds.has(id));
  const selectedCount = selectedIds.size;

  const createContact = useMutation({
    mutationFn: (d: any) => api.post('/personal-contacts', d).then((r) => r.data),
    onSuccess: async (contact) => {
      await refetchContacts();
      setForm((f) => ({ ...f, contactId: contact.id }));
      setShowNewContact(false);
      setNewContact({ name: '', contactEmail: '', contactPhone: '', billingAddress: '' });
      toast.success('Contact added.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add contact.'),
  });

  const createInvoice = useMutation({
    mutationFn: (d: any) => api.post('/personal-invoices', d).then((r) => r.data),
    onSuccess: async (inv) => {
      await invalidateMany(qc, afterPersonalInvoiceChange(inv?.id, inv?.contactId));
      setShowForm(false);
      setForm({ contactId: '', companyId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '', allowPartialPayment: false });
      setLines([emptyLine()]);
      toast.success('Personal invoice created.');
      router.push(`/personal-invoices/${inv.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create invoice.'),
  });

  const bulkVoid = useMutation({
    mutationFn: (ids: string[]) => api.post('/personal-invoices/bulk-void', { ids }).then((r) => r.data),
    onSuccess: async (result) => {
      await invalidateMany(qc, afterPersonalInvoiceChange());
      setSelectedIds(new Set());
      setConfirmVoid(false);
      const voided = result?.voided ?? 0;
      const skipped = result?.skipped?.length ?? 0;
      if (voided && skipped) {
        toast.success(`${voided} invoice${voided === 1 ? '' : 's'} voided. ${skipped} skipped.`);
      } else if (voided) {
        toast.success(`${voided} invoice${voided === 1 ? '' : 's'} voided.`);
      } else {
        toast.error('No invoices were voided. Paid or already-void invoices were skipped.');
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to void invoices.'),
  });

  function handleSubmit() {
    createInvoice.mutate({
      ...form,
      lines: lines
        .filter((l) => l.description && l.unitPrice)
        .map((l) => ({ description: l.description, qty: parseFloat(l.qty) || 1, unitPrice: parseFloat(l.unitPrice) })),
    });
  }

  function toggleSelect(id: string, voidable: boolean) {
    if (!voidable) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allVoidableSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(voidableIds));
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Personal Invoices" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-xs text-amber-800">
          Personal invoices are a separate section — their own contacts and number series, with no effect on company revenue or the Clients page.
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search by invoice # or contact…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={contactFilter}
              onChange={(e) => { setContactFilter(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All contacts</option>
              {(contacts || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="month"
              value={month}
              onChange={(e) => { setMonth(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
              title="Filter by due date's month"
            />
            <label className={cn(
              'flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-3 py-2 rounded-lg border cursor-pointer transition-colors',
              hideVoid ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-300 text-gray-500 hover:bg-gray-50'
            )}>
              <input
                type="checkbox"
                checked={hideVoid}
                onChange={(e) => { setHideVoid(e.target.checked); setPage(1); }}
                className="w-3.5 h-3.5 rounded accent-gray-600"
              />
              Hide void invoices
            </label>

            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Personal Invoice
            </button>
          </div>
        </div>

        {/* ── Bulk action bar ── */}
        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-brand-900">
              {selectedCount} invoice{selectedCount === 1 ? '' : 's'} selected
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-1.5 rounded-lg hover:bg-white/70 transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => setConfirmVoid(true)}
                disabled={bulkVoid.isPending}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <Ban className="w-3.5 h-3.5" />
                Void selected
              </button>
            </div>
          </div>
        )}

        {/* ── Create form ── */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h3 className="text-sm font-semibold text-gray-900">New Personal Invoice</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Contact</label>
                <div className="flex gap-2">
                  <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                    className="flex-1 px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                    <option value="">Select contact…</option>
                    {(contacts || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewContact((v) => !v)}
                    className="shrink-0 text-xs font-medium text-brand-700 hover:text-brand-800 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50">
                    + New
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Letterhead / company</label>
                <select value={form.companyId} onChange={(e) => setForm({ ...form, companyId: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">No company branding</option>
                  {(companies || []).map((c: any) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
                </select>
              </div>
            </div>

            {showNewContact && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-700">New contact</p>
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Name" value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input placeholder="Email" value={newContact.contactEmail}
                    onChange={(e) => setNewContact({ ...newContact, contactEmail: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input placeholder="Phone" value={newContact.contactPhone}
                    onChange={(e) => setNewContact({ ...newContact, contactPhone: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input placeholder="Billing address" value={newContact.billingAddress}
                    onChange={(e) => setNewContact({ ...newContact, billingAddress: e.target.value })}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                </div>
                <button type="button" onClick={() => createContact.mutate(newContact)}
                  disabled={!newContact.name || createContact.isPending}
                  className="text-xs font-medium text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 px-3 py-1.5 rounded-lg">
                  {createContact.isPending ? 'Adding…' : 'Add contact'}
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                </select>
              </div>
              <div />
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Issue Date</label>
                <input type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Due Date</label>
                <input type="date" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
            </div>

            <LineItemsEditor lines={lines} setLines={setLines} currency={form.currency} />

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none" />
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.allowPartialPayment}
                  onChange={(e) => setForm({ ...form, allowPartialPayment: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
                <span>Allow partial payments on this invoice</span>
              </label>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSubmit}
                disabled={!form.contactId || lines.every((l) => !l.description) || createInvoice.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {createInvoice.isPending ? 'Creating…' : 'Create Invoice'}
              </button>
              <button onClick={() => setShowForm(false)}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Master view switch ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
          {([
            ['invoice', 'By invoice'],
            ['contact', 'By contact'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setViewMode(value)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-lg transition-colors',
                viewMode === value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {viewMode === 'contact' ? (
          <InvoiceGroupedView
            groups={contactGroups}
            loading={groupedLoading}
            expandedIds={expandedContacts}
            onToggleExpand={(id) => setExpandedContacts((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onInvoiceClick={(inv) => router.push(`/personal-invoices/${inv.id}`)}
          />
        ) : (
          <InvoiceTable
            invoices={invoices}
            isLoading={isLoading}
            entityLabel="Contact"
            getEntityName={(inv) => inv.contact?.name || '—'}
            onRowClick={(inv) => router.push(`/personal-invoices/${inv.id}`)}
            selectedIds={selectedIds}
            toggleSelect={toggleSelect}
            toggleSelectAll={toggleSelectAll}
            page={page}
            totalPages={totalPages}
            total={total}
            limit={LIMIT}
            onPageChange={setPage}
          />
        )}

      </div>

      <ConfirmDialog
        open={confirmVoid}
        title="Void selected invoices"
        message={`Void ${selectedCount} invoice${selectedCount === 1 ? '' : 's'}? They will be marked as void and hidden when “Hide void invoices” is on. This cannot be undone.`}
        confirmLabel={bulkVoid.isPending ? 'Voiding…' : 'Void invoices'}
        onConfirm={() => {
          if (bulkVoid.isPending || !selectedCount) return;
          bulkVoid.mutate([...selectedIds]);
        }}
        onCancel={() => !bulkVoid.isPending && setConfirmVoid(false)}
      />
    </div>
  );
}
