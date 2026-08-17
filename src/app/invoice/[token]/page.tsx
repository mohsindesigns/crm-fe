'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Download, CreditCard, Info } from 'lucide-react';

type Branding = {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  businessPhone?: string | null;
  website?: string | null;
  email?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Awaiting payment',
  overdue: 'Overdue',
  payment_review: 'Payment under review',
  paid: 'Paid in full',
  void: 'Cancelled',
};

function money(currency: string, n: number) {
  return `${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PublicInvoicePage() {
  const { token } = useParams<{ token: string }>();
  const [inv, setInv] = useState<any>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 'full' | 'part' — a part payment is the whole point of this page existing.
  const [payMode, setPayMode] = useState<'full' | 'part'>('full');
  const [partAmount, setPartAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const apiBase = '/api';
  const pdfUrl = `${apiBase}/public/invoices/${token}/pdf`;

  function load() {
    fetch(`${apiBase}/public/invoices/${token}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || 'Not found');
        return data;
      })
      .then((data) => {
        setInv(data.invoice);
        setBranding(data.branding);
        document.title = `${data.branding?.brandName || 'Invoice'} — ${data.invoice?.number || 'Invoice'}`;
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function pay() {
    setError('');
    let amount: number | null = null;
    if (payMode === 'part') {
      const n = Number(partAmount);
      if (!Number.isFinite(n) || n <= 0) {
        setError('Enter an amount greater than zero.');
        return;
      }
      if (n > Number(inv.amountDue) + 0.005) {
        setError(`You can pay at most ${money(inv.currency, inv.amountDue)} on this invoice.`);
        return;
      }
      amount = Math.round(n * 100) / 100;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${apiBase}/public/invoices/${token}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not start the payment.');
      if (!data.url) throw new Error('No payment page was returned. Please contact us.');
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message || 'Could not start the payment.');
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Loading…</div>;
  }
  if (notFound || !inv) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-base font-semibold text-gray-900">This link is invalid or has expired.</p>
          <p className="text-sm text-gray-500 mt-1">Please contact us for an up-to-date invoice link.</p>
        </div>
      </div>
    );
  }

  const accent = branding?.primaryColor || '#1e293b';
  const isPaid = inv.status === 'paid';
  const hasPartPaid = Number(inv.amountPaid) > 0 && !isPaid;

  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4 sm:py-10">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="h-1.5" style={{ backgroundColor: accent }} />
          <div className="p-5 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                {branding?.logoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={branding.logoUrl} alt={branding.brandName} className="h-9 object-contain mb-3" />
                  : <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">{branding?.brandName}</p>}
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Invoice {inv.number}</h1>
                <p className="text-sm text-gray-500 mt-0.5">For {inv.clientName}</p>
              </div>
              <div className="sm:text-right shrink-0">
                <span className="inline-block px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                  {STATUS_LABEL[inv.status] || inv.status}
                </span>
                {inv.dueAt && (
                  <p className="text-xs text-gray-500 mt-2">Due {new Date(inv.dueAt).toLocaleDateString()}</p>
                )}
              </div>
            </div>

            {/* Balance. Paid-to-date is shown whenever anything has been paid, so
                a returning client sees what's left rather than the original total. */}
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-gray-400">Invoice total</p>
                <p className="text-base font-semibold text-gray-900 mt-0.5">{money(inv.currency, inv.total)}</p>
              </div>
              <div className="rounded-xl border border-gray-200 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-gray-400">Paid to date</p>
                <p className="text-base font-semibold text-emerald-700 mt-0.5">{money(inv.currency, inv.amountPaid)}</p>
              </div>
              <div className="rounded-xl px-4 py-3 border-2" style={{ borderColor: accent }}>
                <p className="text-[11px] uppercase tracking-wider text-gray-400">Still outstanding</p>
                <p className="text-base font-bold mt-0.5" style={{ color: accent }}>{money(inv.currency, inv.amountDue)}</p>
              </div>
            </div>

            {hasPartPaid && (
              <p className="mt-3 text-xs text-gray-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                Part payment received — see the breakdown below.
              </p>
            )}
          </div>
        </div>

        {/* Line items */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 sm:px-8 py-4 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900">What this covers</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-125">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 sm:px-8 py-2.5">Item</th>
                  <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Qty</th>
                  <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Rate</th>
                  <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 sm:px-8 py-2.5">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {inv.lines.map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="px-5 sm:px-8 py-3 text-sm text-gray-900">{l.description}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 text-right">{Number(l.qty)}</td>
                    <td className="px-3 py-3 text-sm text-gray-600 text-right font-mono">{money(inv.currency, l.unitPrice)}</td>
                    <td className="px-5 sm:px-8 py-3 text-sm font-medium text-gray-900 text-right font-mono">{money(inv.currency, l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals, mirroring the PDF: subtotal, then every payment as its own
              row, then what's left. A single "paid to date" figure left the
              client guessing which of their transfers had landed. */}
          <div className="px-5 sm:px-8 py-4 border-t border-gray-100 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Total</span>
              <span className="font-mono font-medium text-gray-900">{money(inv.currency, inv.total)}</span>
            </div>
          </div>
        </div>

        {/* Payments received — the same three columns the PDF prints. */}
        {inv.payments.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 sm:px-8 py-4 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Payments received</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-100">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 sm:px-8 py-2.5">Payment</th>
                    <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Date</th>
                    <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-5 sm:px-8 py-2.5">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {inv.payments.map((p: any, i: number) => (
                    <tr key={i}>
                      <td className="px-5 sm:px-8 py-3 text-sm text-gray-900">
                        <span className="text-gray-400 mr-2">{i + 1}</span>
                        {p.methodLabel || 'Payment'}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-600 text-right whitespace-nowrap">
                        {p.paidAt ? new Date(p.paidAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-5 sm:px-8 py-3 text-sm font-medium text-emerald-700 text-right font-mono whitespace-nowrap">
                        −{money(inv.currency, p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 sm:px-8 py-4 border-t border-gray-100 space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Total paid</span>
                <span className="font-mono font-medium text-emerald-700">−{money(inv.currency, inv.amountPaid)}</span>
              </div>
              <div className="flex items-center justify-between text-sm pt-1.5 border-t border-gray-100">
                <span className="font-semibold text-gray-900">Amount due</span>
                <span className="font-mono font-bold" style={{ color: Number(inv.amountDue) > 0 ? '#dc2626' : '#059669' }}>
                  {money(inv.currency, inv.amountDue)}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Pay */}
        <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-8">
          {isPaid ? (
            <div className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              This invoice is paid in full. Thank you!
            </div>
          ) : inv.canPayByCard ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Pay by card</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Pay the full balance, or part of it now and the rest later.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPayMode('full')}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    payMode === 'full' ? 'border-2' : 'border border-gray-200 hover:border-gray-300'
                  }`}
                  style={payMode === 'full' ? { borderColor: accent } : undefined}
                >
                  <p className="text-sm font-medium text-gray-900">Pay in full</p>
                  <p className="text-xs text-gray-500 mt-0.5">{money(inv.currency, inv.amountDue)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('part')}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    payMode === 'part' ? 'border-2' : 'border border-gray-200 hover:border-gray-300'
                  }`}
                  style={payMode === 'part' ? { borderColor: accent } : undefined}
                >
                  <p className="text-sm font-medium text-gray-900">Pay part now</p>
                  <p className="text-xs text-gray-500 mt-0.5">Choose your own amount</p>
                </button>
              </div>

              {payMode === 'part' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Amount to pay now <span className="text-gray-400 font-normal">(max {money(inv.currency, inv.amountDue)})</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 shrink-0">{inv.currency}</span>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      max={inv.amountDue}
                      value={partAmount}
                      onChange={(e) => setPartAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                      style={{ boxShadow: 'none' }}
                    />
                  </div>
                  {Number(partAmount) > 0 && Number(partAmount) < Number(inv.amountDue) && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      {money(inv.currency, Number(inv.amountDue) - Number(partAmount))} will remain outstanding after this payment.
                    </p>
                  )}
                </div>
              )}

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                onClick={pay}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all hover:opacity-90 disabled:opacity-60"
                style={{ backgroundColor: accent }}
              >
                <CreditCard className="w-4 h-4" />
                {submitting ? 'Opening secure checkout…' : `Pay ${money(inv.currency, payMode === 'part' && Number(partAmount) > 0 ? Number(partAmount) : inv.amountDue)}`}
              </button>
              <p className="text-[11px] text-gray-400 text-center">Payments are processed securely by Stripe.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-900">How to pay</h2>
              {inv.paymentInstructions ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3">
                  {inv.paymentInstructions}
                </p>
              ) : (
                <p className="text-sm text-gray-600">
                  Please use the payment details on the invoice PDF below, or contact us if you need them again.
                </p>
              )}
              {inv.paymentLinkUrl && (
                <a
                  href={inv.paymentLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 text-white font-semibold text-sm px-5 py-3 rounded-xl hover:opacity-90"
                  style={{ backgroundColor: accent }}
                >
                  Open payment link
                </a>
              )}
            </div>
          )}

          <div className="mt-5 pt-5 border-t border-gray-100">
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              <Download className="w-4 h-4" /> View / download invoice PDF
            </a>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          {branding?.brandName}
          {branding?.email && <> · {branding.email}</>}
          {branding?.businessPhone && <> · {branding.businessPhone}</>}
        </p>
      </div>
    </div>
  );
}
