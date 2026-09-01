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
import { cn, formatCurrency } from '@/lib/utils';
import { invalidateMany, afterInvoiceChange } from '@/lib/queryInvalidation';

/**
 * Payment rail — which of the two number series the invoice was issued on.
 *
 *   Stripe → MDL-INVS-…  (card, "Pay via CRM" clients, LLC)
 *   Manual → everything else (bank, Payoneer, Wise, cash, LLP)
 *
 * "Manual" is deliberately NOT-Stripe rather than "is INVM", so any invoice
 * numbered before the two-series split still appears under one of the options
 * instead of being invisible to both.
 */
const RAIL_OPTS = [
  { label: 'All rails',        value: ''       },
  { label: 'Stripe (INVS)',    value: 'stripe' },
  { label: 'Manual (non-Stripe)', value: 'manual' },
];

const LIMIT = 25;

export default function InvoicesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [rawSearch, setRawSearch] = useState('');
  const [search,    setSearch]    = useState('');
  const [status,    setStatus]    = useState('');
  // Which payment rail the invoice was issued on — Stripe (INVS) vs everything
  // else. Matches the number series printed on the document.
  const [rail,      setRail]      = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [month,     setMonth]     = useState('');
  const [hideVoid,  setHideVoid]  = useState(true);
  const [page,      setPage]      = useState(1);
  const [showForm,  setShowForm]  = useState(false);
  const [form, setForm] = useState({ clientId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '', allowPartialPayment: false });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  // Whether the admin has touched the part-payment box on this form. Until they
  // do, it tracks the org default (which loads a tick after mount); once they
  // have, their choice stands even if the default arrives late.
  const [partialTouched, setPartialTouched] = useState(false);
  // The master view switch: a flat list of invoices, or the same invoices rolled
  // up per client so you can see who owes what in one pass.
  const [viewMode, setViewMode] = useState<'invoice' | 'client'>('invoice');
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmVoid, setConfirmVoid] = useState(false);

  useEffect(() => {
    const statusParam = searchParams.get('status');
    if (!statusParam) return;
    // Only allow values that the backend understands — keeps the UI predictable.
    if (!STATUS_OPTS.map((s) => s.value).includes(statusParam)) return;
    setStatus(statusParam);
    setPage(1);
  }, [searchParams]);

  // Arriving from a client's "New Invoice" button (e.g. /invoices?new=1&clientId=…)
  // opens the create form pre-scoped to that client instead of landing on the
  // flat list and making them re-pick a client they just came from.
  useEffect(() => {
    const clientIdParam = searchParams.get('clientId');
    if (!searchParams.get('new')) return;
    setShowForm(true);
    if (clientIdParam) setForm((f) => ({ ...f, clientId: clientIdParam }));
  }, [searchParams]);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // Clear selection when filters/page change so IDs don't linger off-page
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, status, clientFilter, month, hideVoid, rail]);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', { page, search, status, clientFilter, month, hideVoid, rail }],
    queryFn: () =>
      api.get('/invoices', {
        params: {
          page, limit: LIMIT, search: search || undefined, status: status || undefined,
          clientId: clientFilter || undefined, month: month || undefined,
          excludeVoid: hideVoid || undefined, rail: rail || undefined,
        },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  /**
   * Client view pulls a wide, unpaginated slice of the same filtered set.
   *
   * Grouping only the current page would be actively misleading — a client's
   * "total outstanding" would change every time you turned the page. This asks
   * for the whole filtered set instead, so each client's figures are real.
   */
  const { data: groupedData, isLoading: groupedLoading } = useQuery({
    queryKey: ['invoices-by-client', { search, status, clientFilter, month, hideVoid, rail }],
    queryFn: () =>
      api.get('/invoices', {
        params: {
          page: 1, limit: 100, search: search || undefined, status: status || undefined,
          clientId: clientFilter || undefined, month: month || undefined,
          excludeVoid: hideVoid || undefined, rail: rail || undefined,
        },
      }).then((r) => r.data),
    enabled: viewMode === 'client',
    placeholderData: (prev) => prev,
  });

  const { data: clients } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
    enabled: true,
  });

  // The org's part-payment default, so the box below starts where the admin set
  // it rather than always unticked. The backend applies the same default to
  // invoices raised without an explicit value (retainer renewals, installments),
  // so what this form shows matches what a generated invoice would get.
  const { data: billingDefaults } = useQuery({
    queryKey: ['invoice-billing-defaults'],
    queryFn: () => api.get('/invoices/billing-defaults').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const partialDefault = !!billingDefaults?.allowPartialPaymentDefault;

  // Derived, not synced into `form` by an effect: the org default arrives a tick
  // after mount (and the form may already be open via /invoices?new=1), so a
  // state-sync would need an effect and cascade a render. Until the admin
  // touches the box it simply reads the default; after that, their choice wins.
  const allowPartial = partialTouched ? form.allowPartialPayment : partialDefault;

  const invoices: any[]    = data?.data       || [];
  const total: number      = data?.total      || 0;
  const totalPages: number = data?.totalPages || 1;

  /**
   * Roll the filtered invoices up per client: how many, how much in total, and
   * how much of that is still owed or already late. Sorted by who owes the most,
   * because that ordering is the reason to look at this view at all.
   */
  const clientGroups = useMemo(() => {
    const rows: any[] = groupedData?.data || [];
    const byClient = new Map<string, any>();

    for (const inv of rows) {
      const id = inv.client?.id || inv.clientId || 'unknown';
      const group = byClient.get(id) || {
        id,
        name: inv.client?.name || 'Unknown client',
        currency: inv.currency || 'USD',
        invoices: [] as any[],
        total: 0,
        outstanding: 0,
        overdue: 0,
        paid: 0,
      };
      const amount = parseFloat(inv.total) || 0;
      group.invoices.push(inv);
      // Void invoices are shown but never counted — they represent nothing owed.
      if (inv.status !== 'void') {
        group.total += amount;
        if (inv.status === 'paid') group.paid += amount;
        else group.outstanding += amount;
        if (inv.status === 'overdue') group.overdue += amount;
      }
      byClient.set(id, group);
    }

    return [...byClient.values()]
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

  const createInvoice = useMutation({
    mutationFn: (d: any) => api.post('/invoices', d).then((r) => r.data),
    onSuccess: async (inv) => {
      await invalidateMany(qc, afterInvoiceChange(inv?.id, inv?.clientId));
      setShowForm(false);
      setForm({ clientId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '', allowPartialPayment: false });
      setPartialTouched(false);
      setLines([emptyLine()]);
      toast.success('Invoice created.');
      router.push(`/invoices/${inv.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create invoice.'),
  });

  const bulkVoid = useMutation({
    mutationFn: (ids: string[]) => api.post('/invoices/bulk-void', { ids }).then((r) => r.data),
    onSuccess: async (result) => {
      await invalidateMany(qc, afterInvoiceChange());
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
      allowPartialPayment: allowPartial,
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
      <Header title="Invoices" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search by invoice # or client…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={clientFilter}
              onChange={(e) => { setClientFilter(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All clients</option>
              {(clients || []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {/* Payment rail. "Manual" is everything that is NOT Stripe, so
                invoices numbered before the two-series split still show up
                rather than falling through both options. */}
            <select
              value={rail}
              onChange={(e) => { setRail(e.target.value); setPage(1); }}
              title="Filter by payment rail"
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {RAIL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
              New Invoice
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
            <h3 className="text-sm font-semibold text-gray-900">New Invoice</h3>
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
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                </select>
              </div>
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
                  checked={allowPartial}
                  onChange={(e) => {
                    setPartialTouched(true);
                    setForm({ ...form, allowPartialPayment: e.target.checked });
                  }}
                  className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                />
                <span>Allow partial payments on this invoice</span>
              </label>
              {partialDefault && !partialTouched && (
                <p className="text-[11px] text-gray-500 mt-1 ml-6">
                  On by default for this organisation — including retainer renewals and
                  installments. Untick to require this invoice be paid in full.
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={handleSubmit}
                disabled={!form.clientId || lines.every((l) => !l.description) || createInvoice.isPending}
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
            ['client', 'By client'],
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

        {viewMode === 'client' ? (
          <InvoiceGroupedView
            groups={clientGroups}
            loading={groupedLoading}
            expandedIds={expandedClients}
            onToggleExpand={(id) => setExpandedClients((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            })}
            onInvoiceClick={(inv) => router.push(`/invoices/${inv.id}`)}
          />
        ) : (
          <InvoiceTable
            invoices={invoices}
            isLoading={isLoading}
            entityLabel="Client"
            getEntityName={(inv) => inv.client?.name || '—'}
            onRowClick={(inv) => router.push(`/invoices/${inv.id}`)}
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
