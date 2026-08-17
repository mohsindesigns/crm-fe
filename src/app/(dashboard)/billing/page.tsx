'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FileText, TrendingUp, Clock, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, formatDate, formatCurrency } from '@/lib/utils';

const INV_STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-brand-100 text-brand-800',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-gray-100 text-gray-400',
};

const RET_STATUS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  paused: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function BillingPage() {
  const router = useRouter();

  const { data: invoices, isLoading: invLoading } = useQuery({
    queryKey: ['invoices-summary'],
    queryFn: () => api.get('/invoices', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: retainers, isLoading: retLoading } = useQuery({
    queryKey: ['retainers'],
    queryFn: () => api.get('/retainers').then((r) => r.data),
  });

  const invArr: any[] = invoices || [];
  const retArr: any[] = retainers || [];

  const now = new Date();
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Group by currency so we don't mix e.g. USD and PKR amounts
  function groupByCurrency(items: any[], filter: (i: any) => boolean, getValue: (i: any) => number, getCurrency: (i: any) => string): Record<string, number> {
    const map: Record<string, number> = {};
    for (const item of items.filter(filter)) {
      const cur = getCurrency(item) || 'USD';
      map[cur] = (map[cur] || 0) + getValue(item);
    }
    return map;
  }

  const mrrByCurrency = groupByCurrency(
    retArr,
    (r) => r.status === 'active' && r.cycle === 'monthly',
    (r) => parseFloat(r.amount || 0),
    (r) => r.currency,
  );
  // `amountDue` (total minus payments received), never `total` — a part-paid
  // invoice is not still owed in full. The API computes it; see InvoiceService.list.
  const outstandingByCurrency = groupByCurrency(
    invArr,
    (inv) => inv.status === 'sent' || inv.status === 'overdue',
    (inv) => (inv.amountDue != null ? parseFloat(inv.amountDue) : parseFloat(inv.total || 0)),
    (inv) => inv.currency,
  );
  // Money actually received this month, from the payment records themselves.
  // Keying off fully-paid invoices missed every part payment — $3,550 could land
  // and this tile would still read as empty.
  const paidThisMonthByCurrency: Record<string, number> = {};
  for (const inv of invArr) {
    const cur = inv.currency || 'USD';
    for (const p of inv.payments || []) {
      if (!p.paidAt || new Date(p.paidAt) < thisMonthStart) continue;
      paidThisMonthByCurrency[cur] = (paidThisMonthByCurrency[cur] || 0) + (parseFloat(p.amount) || 0);
    }
  }
  const overdueCount = invArr.filter((inv) => inv.status === 'overdue').length;
  const activeRetainers = retArr.filter((r) => r.status === 'active');
  const outstandingInvoices = invArr
    .filter((inv) => inv.status === 'sent' || inv.status === 'overdue')
    // Backend already orders by issuedAt DESC, but be safe if the payload shape changes.
    .sort((a, b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));

  function CurrencyBreakdown({ map }: { map: Record<string, number> }) {
    const entries = Object.entries(map).filter(([, v]) => v > 0);
    if (!entries.length) return <p className="text-xl font-bold text-gray-900">—</p>;
    return (
      <div className="space-y-1 mt-1">
        {entries.map(([cur, amt]) => (
          <div key={cur} className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">{cur}</span>
            <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(amt, cur)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Billing" />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">

        {/* Metrics row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-brand-50">
              <TrendingUp className="w-4 h-4 text-brand-700" />
            </div>
            <p className="text-xs text-gray-500 mb-1">Monthly Recurring Revenue</p>
            <CurrencyBreakdown map={mrrByCurrency} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-blue-50">
              <Clock className="w-4 h-4 text-blue-600" />
            </div>
            <p className="text-xs text-gray-500 mb-1">Outstanding</p>
            <CurrencyBreakdown map={outstandingByCurrency} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-indigo-50">
              <CheckCircle className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-xs text-gray-500 mb-1">Paid This Month</p>
            <CurrencyBreakdown map={paidThisMonthByCurrency} />
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
            </div>
            <p className="text-xs text-gray-500 mb-1">Overdue Invoices</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{overdueCount}</p>
            <p className="text-xs text-gray-400">{overdueCount === 1 ? 'invoice' : 'invoices'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Invoices table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between px-5 py-4 border-b border-gray-100 gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Outstanding Invoices</h3>
              <Link href="/billing" className="text-xs text-brand-700 hover:text-brand-800 font-medium">View all</Link>
            </div>
            {invLoading ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">Loading…</div>
            ) : outstandingInvoices.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No outstanding invoices yet.</div>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full min-w-120">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Invoice</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Client</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Amount</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {outstandingInvoices.slice(0, 10).map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <td className="px-5 py-3 text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />{inv.number}
                      </td>
                      <td className="px-5 py-3 text-sm text-gray-600">{inv.client?.name || '—'}</td>
                      {/* The column is "outstanding invoices", so the figure is
                          what's left to collect — with the face value alongside
                          it when part of the invoice has already been paid. */}
                      <td className="px-5 py-3 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(inv.amountDue != null ? inv.amountDue : inv.total, inv.currency)}
                        {inv.amountPaid > 0 && (
                          <span className="block text-[11px] font-normal text-gray-400">
                            of {formatCurrency(inv.total, inv.currency)}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', INV_STATUS[inv.status] || 'bg-gray-100 text-gray-600')}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </div>

          {/* Active retainers */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between px-5 py-4 border-b border-gray-100 gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Active Retainers</h3>
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <RefreshCw className="w-3 h-3" />
                {activeRetainers.length} active
              </div>
            </div>
            {retLoading ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">Loading…</div>
            ) : activeRetainers.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-400">No active retainers.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {activeRetainers.map((ret: any) => (
                  <div key={ret.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">{ret.client?.name || '—'}</div>
                        {(ret.package?.name || ret.clientPackage?.package?.name) && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {ret.package?.name || ret.clientPackage?.package?.name}
                          </div>
                        )}
                      </div>
                      <span className={cn('ml-2 px-2 py-0.5 text-xs font-medium rounded-full flex-shrink-0', RET_STATUS[ret.status] || 'bg-gray-100 text-gray-600')}>
                        {ret.status}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between mt-2 gap-2">
                      <span className="text-sm font-semibold text-gray-900">{formatCurrency(ret.amount, ret.currency)}</span>
                      <span className="text-xs text-gray-400 capitalize">{ret.cycle}</span>
                    </div>
                    {ret.nextInvoiceDate && (
                      <div className="text-xs text-gray-400 mt-1">Next: {formatDate(ret.nextInvoiceDate)}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
