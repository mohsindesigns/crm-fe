'use client';

/**
 * How a client pays one invoice, in a single place.
 *
 * This lived twice — once inline in the invoice list's expanded row and once on
 * the invoice detail page — which is how the list ended up still showing the old
 * receipt-upload flow with no card option long after cards were added. One
 * component, mounted in both, so a payment method can never appear in one view
 * and not the other again.
 *
 * Two branches, decided by the method the client picks:
 *   • Card  — hands off to Stripe's hosted page in a new tab, then waits. Stripe
 *             has no return hook for hosted invoices, so the parent polls and the
 *             invoice flips to Paid on its own when the webhook lands.
 *   • Other — the client pays out-of-band using the shown instructions, uploads a
 *             receipt, and the invoice moves to "Under review".
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  BellRing, CheckCircle2, Upload, X, CreditCard, Loader2, ExternalLink, Info,
} from 'lucide-react';
import { cn, formatCurrency, toAbsoluteHttpUrl } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export type PaymentMethod = {
  id: string;
  kind: 'stripe' | 'manual';
  label: string;
  instructions: string;
  requiresProof: boolean;
};

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

/** Shared so both views fetch the method list under the same cache key. */
export function usePaymentMethods(token: string | null) {
  return useQuery<PaymentMethod[]>({
    queryKey: ['portal-payment-methods'],
    queryFn: () => portalFetch('/portal/payment-methods', token!),
    enabled: !!token,
  });
}

export default function InvoicePaymentPanel({
  invoice,
  token,
  onCardPaymentStarted,
  awaitingCard = false,
  compact = false,
}: {
  invoice: any;
  token: string;
  /** Told when the client has been handed off to Stripe, so the parent can poll. */
  onCardPaymentStarted?: (invoiceId: string) => void;
  awaitingCard?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { data: methods = [] } = usePaymentMethods(token);

  const [methodId, setMethodId] = useState('');
  const [payRef, setPayRef] = useState('');
  // Blank means "pay the whole outstanding balance". A client settling only part
  // of a large invoice types the amount here and the rest stays owing.
  const [partAmount, setPartAmount] = useState('');
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [notified, setNotified] = useState(false);

  // Derived rather than stored, so the first method is the default without an
  // effect writing state back on every render.
  const selectedId = methodId || invoice?.preferredPaymentMethodId || methods[0]?.id || '';
  const selectedMethod = useMemo(
    () => methods.find((m) => m.id === selectedId) || null,
    [methods, selectedId],
  );

  const selectMethod = useMutation({
    mutationFn: (paymentMethodId: string) => portalFetch(
      `/portal/invoices/${invoice.id}/select-payment-method`,
      token,
      {
        method: 'POST',
        body: JSON.stringify({ paymentMethodId }),
      },
    ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-invoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['portal-invoices'] });
    },
    onError: (e: any) => {
      toast.error(e?.message || 'Could not apply payment method.');
    },
  });

  // What is actually still owed — an invoice part-paid earlier must not offer to
  // charge its full total again.
  const amountPaid = Array.isArray(invoice?.payments)
    ? invoice.payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)
    : Number(invoice?.amountPaid) || 0;
  const outstanding = Math.max(0, Math.round(((Number(invoice?.total) || 0) - amountPaid) * 100) / 100);
  const parsedPart = partAmount === '' ? null : Number(partAmount);
  const partAmountInvalid = parsedPart !== null
    && (!Number.isFinite(parsedPart) || parsedPart <= 0 || parsedPart > outstanding);
  const chargeAmount = parsedPart !== null && !partAmountInvalid ? parsedPart : outstanding;

  const startCardPayment = useMutation({
    mutationFn: () => portalFetch(`/portal/invoices/${invoice.id}/pay/stripe`, token, {
      method: 'POST',
      body: JSON.stringify({
        paymentMethodId: selectedId,
        // Omitted entirely when paying in full, so the Stripe page mirrors the
        // real line items rather than a single lump "part payment" row.
        ...(parsedPart !== null && !partAmountInvalid && parsedPart < outstanding
          ? { amount: parsedPart }
          : {}),
      }),
    }),
    onSuccess: (data: { url: string }) => {
      if (!data?.url) {
        toast.error('Could not open the payment page. Please try again.');
        return;
      }
      onCardPaymentStarted?.(invoice.id);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    },
    onError: (e: any) => toast.error(e?.message || 'Could not start the card payment.'),
  });

  const notifyPayment = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('reference', payRef);
      if (selectedId) fd.append('paymentMethodId', selectedId);
      if (screenshotFile) fd.append('screenshot', screenshotFile);
      return fetch(`${API_URL}/portal/invoices/${invoice.id}/paid-notification`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: r.status });
        return data;
      });
    },
    onSuccess: () => {
      setNotified(true);
      setPayRef('');
      setScreenshotFile(null);
      setScreenshotPreview(null);
      qc.invalidateQueries({ queryKey: ['portal-invoice', invoice.id] });
      qc.invalidateQueries({ queryKey: ['portal-invoices'] });
      toast.success('Team notified! We\'ll confirm your payment shortly.');
    },
    onError: (e: any) => toast.error(e?.message || 'Failed to notify team. Please try again.'),
  });

  if (notified) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-brand-50 border border-brand-100 rounded-xl">
        <CheckCircle2 className="w-4 h-4 text-brand-700 shrink-0" />
        <span className="text-sm font-medium text-brand-800">Team notified — we&apos;ll confirm shortly.</span>
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No payment methods are set up yet. Please contact us for payment details.
      </p>
    );
  }

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <div>
        <label htmlFor={`pay-method-${invoice.id}`} className="block text-xs font-semibold text-gray-500 mb-1.5">
          Payment method
        </label>
        <select
          id={`pay-method-${invoice.id}`}
          value={selectedId}
          onChange={(e) => {
            const next = e.target.value;
            setMethodId(next);
            if (next) selectMethod.mutate(next);
          }}
          className="w-full sm:w-72 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {methods.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {selectedMethod?.instructions && (
        <div className="flex gap-2.5 p-3.5 bg-gray-50 border border-gray-100 rounded-xl">
          <Info className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {selectedMethod.instructions}
          </p>
        </div>
      )}

      {selectedMethod?.kind === 'stripe' ? (
        awaitingCard ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
              <Loader2 className="w-4 h-4 text-blue-600 shrink-0 animate-spin" />
              <div>
                <p className="text-sm font-medium text-blue-900">Waiting for your payment…</p>
                <p className="text-xs text-blue-700 mt-0.5">
                  Finish paying in the payment tab. This page updates automatically — no need to refresh.
                </p>
              </div>
            </div>
            <button
              onClick={() => startCardPayment.mutate()}
              disabled={startCardPayment.isPending}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <ExternalLink className="w-4 h-4" />
              Reopen the payment page
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {amountPaid > 0 && (
              <p className="text-xs text-gray-500">
                {formatCurrency(amountPaid, invoice.currency)} already received ·{' '}
                <span className="font-semibold text-gray-700">
                  {formatCurrency(outstanding, invoice.currency)} outstanding
                </span>
              </p>
            )}
            {invoice.allowPartialPayment && (
              <div>
                <label htmlFor={`pay-amount-${invoice.id}`} className="block text-xs font-semibold text-gray-500 mb-1.5">
                  Amount to pay now
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-400">{invoice.currency}</span>
                  <input
                    id={`pay-amount-${invoice.id}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={outstanding}
                    value={partAmount}
                    onChange={(e) => setPartAmount(e.target.value)}
                    placeholder={outstanding.toFixed(2)}
                    className="w-40 px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {partAmount !== '' && (
                    <button
                      type="button"
                      onClick={() => setPartAmount('')}
                      className="text-xs text-gray-500 hover:text-gray-800 underline"
                    >
                      Pay the full balance
                    </button>
                  )}
                </div>
                {partAmountInvalid ? (
                  <p className="text-xs text-red-600 mt-1.5">
                    Enter an amount between {invoice.currency} 0.01 and {formatCurrency(outstanding, invoice.currency)}.
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1.5">
                    {chargeAmount < outstanding
                      ? `Part payment — ${formatCurrency(outstanding - chargeAmount, invoice.currency)} will stay outstanding on this invoice, payable any time.`
                      : 'Leave blank to pay the full outstanding balance.'}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => startCardPayment.mutate()}
              disabled={startCardPayment.isPending || partAmountInvalid || outstanding <= 0}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed w-fit"
              style={{ background: '#0B1D5E' }}
            >
              {startCardPayment.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <CreditCard className="w-4 h-4" />}
              {startCardPayment.isPending
                ? 'Opening secure payment…'
                : `Pay ${formatCurrency(chargeAmount, invoice.currency)} by card`}
            </button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {invoice?.paymentLinkUrl && (
            <a
              href={toAbsoluteHttpUrl(invoice.paymentLinkUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-brand-700 bg-brand-50 border border-brand-200 rounded-xl w-fit hover:bg-brand-100"
            >
              <ExternalLink className="w-4 h-4" />
              Open secure payment link
            </a>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={payRef}
              onChange={(e) => setPayRef(e.target.value)}
              placeholder="Transaction ref. (optional)"
              className="px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500 w-52"
            />
            <label className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors">
              <Upload className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate max-w-[130px]">
                {screenshotFile ? screenshotFile.name : 'Upload receipt'}
              </span>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setScreenshotFile(f);
                  if (f && f.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (ev) => setScreenshotPreview(ev.target?.result as string);
                    reader.readAsDataURL(f);
                  } else {
                    setScreenshotPreview(null);
                  }
                  e.target.value = '';
                }}
              />
            </label>
            {screenshotFile && (
              <button
                onClick={() => { setScreenshotFile(null); setScreenshotPreview(null); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                aria-label="Remove receipt"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {screenshotPreview && (
            <img
              src={screenshotPreview}
              alt="Payment receipt preview"
              className="max-h-40 max-w-xs rounded-xl border border-gray-200 object-contain"
            />
          )}

          {selectedMethod?.requiresProof && !screenshotFile && (
            <p className="text-xs text-amber-700">
              A receipt is required for {selectedMethod.label}.
            </p>
          )}

          <button
            onClick={() => notifyPayment.mutate()}
            disabled={notifyPayment.isPending || (!!selectedMethod?.requiresProof && !screenshotFile)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed w-fit"
            style={{ background: '#0B1D5E' }}
          >
            <BellRing className="w-4 h-4" />
            {notifyPayment.isPending ? 'Sending…' : "I've paid — notify team"}
          </button>
        </div>
      )}
    </div>
  );
}
