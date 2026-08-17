'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText, AlertCircle, ChevronDown, ChevronUp, Download, CheckCircle2 } from 'lucide-react';
import { usePortalStore } from '@/store/portal';
import InvoicePaymentPanel from '@/components/portal/InvoicePaymentPanel';
import { cn, formatDate, formatCurrency } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

function portalFetch(path: string, token: string, options?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: r.status });
    return data;
  });
}

async function downloadInvoicePdf(invoiceId: string, number: string, token: string) {
  const res = await fetch(`${API_URL}/portal/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to download invoice PDF.');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${number}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  draft:          { label: 'Draft',          cls: 'bg-gray-100 text-gray-500' },
  sent:           { label: 'Sent',           cls: 'bg-blue-50 text-blue-700 border border-blue-100' },
  paid:           { label: 'Paid',           cls: 'bg-brand-50 text-brand-800 border border-brand-100' },
  overdue:        { label: 'Overdue',        cls: 'bg-red-50 text-red-600 border border-red-100' },
  payment_review: { label: 'Under Review',  cls: 'bg-amber-50 text-amber-700 border border-amber-100' },
  void:           { label: 'Void',           cls: 'bg-gray-100 text-gray-400' },
};

const STATUS_FILTER = [
  { label: 'All', value: '' },
  { label: 'Sent', value: 'sent' },
  { label: 'Paid', value: 'paid' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Under Review', value: 'payment_review' },
  { label: 'Draft', value: 'draft' },
];

function SkeletonRows() {
  return (
    <>
      {[...Array(5)].map((_, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-6 py-4 animate-pulse border-b border-gray-50 last:border-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0" />
            <div className="h-4 bg-gray-100 rounded w-28" />
          </div>
          <div className="h-4 bg-gray-100 rounded w-20" />
          <div className="h-4 bg-gray-100 rounded w-16" />
          <div className="h-5 bg-gray-100 rounded-full w-14" />
        </div>
      ))}
    </>
  );
}

export default function PortalInvoicesPage() {
  const { token, client } = usePortalStore();
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Which invoice the client is currently paying by card, so the list can poll
  // for the webhook to land and flip it to Paid without a refresh.
  const [awaitingCardId, setAwaitingCardId] = useState<string | null>(null);

  const { data: invoices, isLoading } = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: () => portalFetch('/portal/invoices', token!),
    enabled: !!token,
    // While a card payment is open in another tab, poll so the row flips to
    // Paid the moment Stripe's webhook lands — no refresh needed.
    refetchInterval: awaitingCardId ? 4000 : false,
    refetchIntervalInBackground: true,
  });

  const invArr: any[] = invoices || [];
  const filtered = statusFilter ? invArr.filter((i) => i.status === statusFilter) : invArr;

  const unpaid = invArr.filter((i) => ['sent', 'overdue', 'payment_review'].includes(i.status));
  const outstanding = unpaid.reduce((s: number, i: any) => s + parseFloat(i.total || 0), 0);
  const overdue = invArr.filter((i) => i.status === 'overdue');

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Invoices</p>
        <h1 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.02em' }}>
          {client?.name}
        </h1>
      </div>

      {/* ── Overdue alert ── */}
      {overdue.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800">
              {overdue.length === 1 ? '1 overdue invoice' : `${overdue.length} overdue invoices`}
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Please settle {overdue.length === 1 ? 'it' : 'them'} to avoid service interruption.
            </p>
          </div>
          {outstanding > 0 && (
            <p className="text-lg font-bold text-red-600" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatCurrency(outstanding, client?.currency || 'USD')}
            </p>
          )}
        </div>
      )}

      {/* ── Summary cards ── */}
      {!isLoading && invArr.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total invoices', value: invArr.length, fmt: String },
            { label: 'Paid', value: invArr.filter((i) => i.status === 'paid').reduce((s: number, i: any) => s + parseFloat(i.total || 0), 0), fmt: (v: number) => formatCurrency(v, client?.currency || 'USD') },
            { label: 'Outstanding', value: outstanding, fmt: (v: number) => formatCurrency(v, client?.currency || 'USD'), red: outstanding > 0 },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-gray-200 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">{card.label}</p>
              <p className={cn('text-xl font-bold', (card as any).red ? 'text-red-500' : 'text-gray-900')}
                style={{ fontVariantNumeric: 'tabular-nums' }}>
                {(card.fmt as any)(card.value)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Filter tabs ── */}
      <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 w-fit">
        {STATUS_FILTER.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatusFilter(f.value)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
              statusFilter === f.value
                ? 'bg-gray-900 text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50',
            )}
          >
            {f.label}
            {f.value && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {invArr.filter((i) => i.status === f.value).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Invoice list ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-3 bg-gray-50/60 border-b border-gray-100">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoice</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Due date</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Amount</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-center">Status</span>
        </div>

        <div className="divide-y divide-gray-50">
          {isLoading ? (
            <SkeletonRows />
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <FileText className="w-8 h-8 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-400">
                {statusFilter ? `No ${statusFilter} invoices` : 'No invoices yet'}
              </p>
            </div>
          ) : (
            filtered.map((inv: any) => {
              const s = INV_STATUS[inv.status] || { label: inv.status, cls: 'bg-gray-100 text-gray-500' };
              const isOpen = expandedId === inv.id;
              const lines: any[] = inv.lines || [];
              return (
                <div key={inv.id} className="border-b border-gray-50 last:border-0">
                  {/* ── Row (clickable) ── */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : inv.id)}
                    className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-4 items-center px-6 py-4 hover:bg-gray-50/60 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 font-mono">{inv.number}</p>
                        {inv.issuedAt && (
                          <p className="text-xs text-gray-400 mt-0.5">Issued {formatDate(inv.issuedAt)}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-gray-500 text-right whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {inv.dueAt ? formatDate(inv.dueAt) : '—'}
                    </span>
                    <span className="text-sm font-bold text-gray-900 text-right whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(inv.total, inv.currency)}
                    </span>
                    <div className="flex justify-center">
                      <span className={cn('px-2.5 py-1 text-xs font-semibold rounded-full whitespace-nowrap', s.cls)}>
                        {s.label}
                      </span>
                    </div>
                    {isOpen
                      ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                      : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </button>

                  {/* ── Expanded detail panel ── */}
                  {isOpen && (
                    <div className="px-6 pb-6 pt-2 bg-gray-50/40 border-t border-gray-100">
                      {/* Line items */}
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-4">
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Qty</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Unit price</span>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Total</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {lines.length === 0 ? (
                            <p className="px-5 py-4 text-sm text-gray-400">No line items.</p>
                          ) : lines.map((line: any, i: number) => (
                            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-5 py-3 items-center">
                              <span className="text-sm text-gray-800">{line.description}</span>
                              <span className="text-sm text-gray-500 text-right tabular-nums">{line.qty}</span>
                              <span className="text-sm text-gray-500 text-right tabular-nums">{formatCurrency(line.unitPrice, inv.currency)}</span>
                              <span className="text-sm font-medium text-gray-900 text-right tabular-nums">
                                {formatCurrency((line.qty || 1) * (line.unitPrice || 0), inv.currency)}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="flex justify-end px-5 py-3 border-t border-gray-100 bg-gray-50">
                          <span className="text-sm font-bold text-gray-900 tabular-nums">
                            Total: {formatCurrency(inv.total, inv.currency)}
                          </span>
                        </div>
                      </div>

                      {/* Notes */}
                      {inv.notes && (
                        <div className="mb-4 p-4 bg-white rounded-xl border border-gray-200">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{inv.notes}</p>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => downloadInvoicePdf(inv.id, inv.number, token!).catch((e: any) => toast.error(e?.message || 'Download failed.'))}
                          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                        >
                          <Download className="w-4 h-4" />
                          Download PDF
                        </button>

                        {/* Payment notification banner — persists across reloads once the invoice
                            moves to payment_review, not just for this browser session */}
                        {inv.status === 'payment_review' && (
                          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-100 rounded-xl">
                            <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-sm font-medium text-amber-800">Team notified — we'll confirm shortly.</span>
                          </div>
                        )}

                      </div>

                      {/* Its own block, not squeezed into the Actions row above:
                          this is a form with a dropdown, instructions and a
                          primary button, and inline next to "Download PDF" it
                          rendered as a jumble. One shared panel across both
                          views — see components/portal/InvoicePaymentPanel.tsx. */}
                      {(inv.status === 'sent' || inv.status === 'overdue') && (
                        <div className="mt-4 rounded-xl border border-gray-200 bg-white overflow-hidden">
                          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/70">
                            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                              Pay this invoice
                            </p>
                          </div>
                          <div className="p-4">
                            <InvoicePaymentPanel
                              invoice={inv}
                              token={token!}
                              compact
                              awaitingCard={awaitingCardId === inv.id}
                              onCardPaymentStarted={setAwaitingCardId}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
