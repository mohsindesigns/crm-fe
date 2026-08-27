'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, Plus, Trash2, Filter, Ban, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { invalidateMany, afterInvoiceChange } from '@/lib/queryInvalidation';

const STATUS_OPTS = [
  { label: 'All statuses',    value: ''                },
  { label: 'Draft',           value: 'draft'           },
  { label: 'Sent',            value: 'sent'            },
  { label: 'Paid',            value: 'paid'            },
  { label: 'Overdue',         value: 'overdue'         },
  { label: 'Payment Review',  value: 'payment_review'  },
  { label: 'Void',            value: 'void'            },
];

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

const STATUS_COLORS: Record<string, string> = {
  draft:          'bg-gray-100  text-gray-600',
  sent:           'bg-blue-100  text-blue-700',
  paid:           'bg-brand-100 text-brand-800',
  overdue:        'bg-red-100   text-red-700',
  payment_review: 'bg-amber-100 text-amber-700',
  void:           'bg-gray-100  text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  payment_review: 'Payment Review',
};

const VOIDABLE = new Set(['draft', 'sent', 'overdue', 'payment_review']);

type LineItem = { description: string; qty: string; unitPrice: string };
const emptyLine = (): LineItem => ({ description: '', qty: '1', unitPrice: '' });

const LIMIT = 25;

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          <td className="px-5 py-3.5">
            <div className="w-4 h-4 bg-gray-100 rounded" />
          </td>
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-100 rounded shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-24 font-mono" />
            </div>
          </td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-32" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></td>
          <td className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-14" /></td>
        </tr>
      ))}
    </>
  );
}

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
  const [form, setForm] = useState({ clientId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '' });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
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
      setForm({ clientId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '' });
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

  const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);

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

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-2">Line Items</label>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
                  <span className="col-span-6">Description</span>
                  <span className="col-span-2">Qty</span>
                  <span className="col-span-3">Unit Price</span>
                  <span className="col-span-1" />
                </div>
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input className="col-span-6 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      placeholder="Service description" value={line.description}
                      onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], description: e.target.value }; setLines(n); }} />
                    <input className="col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      type="number" min="1" placeholder="1" value={line.qty}
                      onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], qty: e.target.value }; setLines(n); }} />
                    <input className="col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      type="number" min="0" step="0.01" placeholder="0.00" value={line.unitPrice}
                      onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], unitPrice: e.target.value }; setLines(n); }} />
                    <button onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}
                      className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setLines([...lines, emptyLine()])}
                  className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium mt-1">
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
              </div>
              <div className="flex justify-end mt-3 text-sm font-semibold text-gray-900">
                Total: {formatCurrency(lineTotal, form.currency)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none" />
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
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {groupedLoading ? (
              <p className="px-5 py-12 text-center text-sm text-gray-400">Loading…</p>
            ) : clientGroups.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-gray-400">No invoices found.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {clientGroups.map((g) => {
                  const open = expandedClients.has(g.id);
                  return (
                    <div key={g.id}>
                      <button
                        type="button"
                        onClick={() => setExpandedClients((prev) => {
                          const next = new Set(prev);
                          if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                          return next;
                        })}
                        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-50/80 transition-colors"
                      >
                        <ChevronRight className={cn('w-4 h-4 text-gray-400 shrink-0 transition-transform', open && 'rotate-90')} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">{g.name}</p>
                          <p className="text-xs text-gray-400">
                            {g.invoices.length} {g.invoices.length === 1 ? 'invoice' : 'invoices'}
                          </p>
                        </div>
                        <div className="hidden sm:flex items-center gap-6 shrink-0 text-right">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Billed</p>
                            <p className="text-sm font-medium text-gray-900 tabular-nums">
                              {formatCurrency(g.total, g.currency)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Outstanding</p>
                            <p className={cn(
                              'text-sm font-semibold tabular-nums',
                              g.outstanding > 0 ? 'text-red-700' : 'text-gray-400',
                            )}>
                              {formatCurrency(g.outstanding, g.currency)}
                            </p>
                          </div>
                        </div>
                        {g.overdue > 0 && (
                          <span className="shrink-0 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-100 rounded px-2 py-0.5">
                            {formatCurrency(g.overdue, g.currency)} overdue
                          </span>
                        )}
                      </button>

                      {open && (
                        <div className="bg-gray-50/60 border-t border-gray-100 divide-y divide-gray-100">
                          {g.invoices.map((inv: any) => (
                            <button
                              key={inv.id}
                              type="button"
                              onClick={() => router.push(`/invoices/${inv.id}`)}
                              className="w-full flex items-center gap-4 pl-12 pr-5 py-2.5 text-left hover:bg-white transition-colors"
                            >
                              <span className="font-mono text-xs text-gray-700 w-28 shrink-0 truncate">{inv.number}</span>
                              <span className="text-xs text-gray-500 w-24 shrink-0">
                                {inv.issuedAt ? formatDate(inv.issuedAt) : '—'}
                              </span>
                              <span className="text-xs text-gray-500 w-24 shrink-0 hidden sm:block">
                                {inv.dueAt ? formatDate(inv.dueAt) : '—'}
                              </span>
                              <span className="flex-1 text-right text-sm font-medium text-gray-900 tabular-nums">
                                {formatCurrency(inv.total, inv.currency)}
                              </span>
                              <span className={cn(
                                'shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full w-24 text-center',
                                STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600',
                              )}>
                                {STATUS_LABELS[inv.status] || inv.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
        <>
        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-160">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="w-10 px-5 py-3.5">
                  <input
                    type="checkbox"
                    checked={allVoidableSelected}
                    disabled={!voidableIds.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all voidable invoices on this page"
                    className="w-3.5 h-3.5 rounded accent-brand-700 disabled:opacity-40"
                  />
                </th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Invoice</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Issued</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Due</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">No invoices found.</td></tr>
              ) : (
                invoices.map((inv: any) => {
                  const voidable = VOIDABLE.has(inv.status);
                  const selected = selectedIds.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className={cn(
                        'hover:bg-gray-50 cursor-pointer transition-colors',
                        selected && 'bg-brand-50/60 hover:bg-brand-50',
                      )}
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                    >
                      <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!voidable}
                          onChange={() => toggleSelect(inv.id, voidable)}
                          aria-label={`Select ${inv.number}`}
                          title={voidable ? undefined : 'Paid or void invoices cannot be selected'}
                          className="w-3.5 h-3.5 rounded accent-brand-700 disabled:opacity-30"
                        />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          <span className="text-sm font-medium text-gray-900 font-mono">{inv.number}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{inv.client?.name || '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{inv.dueAt ? formatDate(inv.dueAt) : '—'}</td>
                      <td className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600')}>
                          {STATUS_LABELS[inv.status] || inv.status}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>
        </>
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
