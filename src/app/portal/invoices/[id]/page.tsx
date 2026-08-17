'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Download, CheckCircle2 } from 'lucide-react';
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

export default function PortalInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = usePortalStore();
  // True from the moment we hand the client off to Stripe until their invoice
  // comes back paid. Stripe's hosted invoice page has no return-URL hook, so the
  // portal polls instead of waiting for a redirect that will never arrive.
  const [awaitingCard, setAwaitingCard] = useState(false);

  const { data: inv, isLoading } = useQuery({
    queryKey: ['portal-invoice', id],
    queryFn: () => portalFetch(`/portal/invoices/${id}`, token!),
    enabled: !!token,
    // While a card payment is open in the other tab, poll so the page flips to
    // "Paid" on its own the moment Stripe's webhook lands. Reads the status off
    // the query itself rather than a derived variable, which would otherwise
    // have to be declared before the query that produces it.
    refetchInterval: (query) =>
      (awaitingCard && (query.state.data as any)?.status !== 'paid' ? 4000 : false),
    refetchIntervalInBackground: true,
  });


  if (isLoading) {
    return <div className="text-sm text-gray-400 py-10 text-center">Loading…</div>;
  }

  if (!inv) {
    return (
      <div className="text-center py-14">
        <FileText className="w-8 h-8 text-gray-200 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-400">Invoice not found.</p>
        <button onClick={() => router.push('/portal/invoices')} className="mt-4 text-sm text-brand-700 hover:underline">
          Back to invoices
        </button>
      </div>
    );
  }

  const s = INV_STATUS[inv.status] || { label: inv.status, cls: 'bg-gray-100 text-gray-500' };
  const lines: any[] = inv.lines || [];

  return (
    <div className="space-y-5 max-w-3xl">
      <button onClick={() => router.push('/portal/invoices')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to invoices
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Invoice</p>
          <h1 className="text-2xl font-bold text-gray-900 font-mono">{inv.number}</h1>
        </div>
        <span className={cn('px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap', s.cls)}>{s.label}</span>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Issued</p>
          <p className="text-sm text-gray-900">{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Due</p>
          <p className="text-sm text-gray-900">{inv.dueAt ? formatDate(inv.dueAt) : '—'}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Amount</p>
          <p className="text-sm font-bold text-gray-900">{formatCurrency(inv.total, inv.currency)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
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
          <span className="text-sm font-bold text-gray-900 tabular-nums">Total: {formatCurrency(inv.total, inv.currency)}</span>
        </div>
      </div>

      {inv.notes && (
        <div className="p-4 bg-white rounded-xl border border-gray-200">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
          <p className="text-sm text-gray-700 leading-relaxed">{inv.notes}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => downloadInvoicePdf(inv.id, inv.number, token!).catch((e: any) => toast.error(e?.message || 'Download failed.'))}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download PDF
        </button>

        {inv.status === 'payment_review' && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-100 rounded-xl">
            <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800">Team notified — we'll confirm shortly.</span>
          </div>
        )}

      </div>

      {/* Same panel the invoice list uses — one implementation, so a payment
          method can never show up in one view and not the other. */}
      {(inv.status === 'sent' || inv.status === 'overdue') && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Pay this invoice</p>
          </div>
          <div className="p-5">
            <InvoicePaymentPanel
              invoice={inv}
              token={token!}
              awaitingCard={awaitingCard}
              onCardPaymentStarted={() => setAwaitingCard(true)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
