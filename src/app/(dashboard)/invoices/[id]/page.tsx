'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, CheckCircle, Send, Ban, ImageIcon, Eye, Download, BellRing, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, formatDate, formatCurrency, downloadAuthedFile, viewAuthedFile, toAbsoluteHttpUrl } from '@/lib/utils';
import { invalidateMany, afterInvoiceChange } from '@/lib/queryInvalidation';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-brand-100 text-brand-800',
  overdue: 'bg-red-100 text-red-700',
  payment_review: 'bg-amber-100 text-amber-700',
  void: 'bg-gray-100 text-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  payment_review: 'Payment Review',
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'void'],
  sent: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'void'],
  payment_review: ['paid', 'void'],
  paid: [],
  void: [],
};

// Payment methods offered by the "Record payment" form. `value` must stay in sync
// with the Payment.provider ENUM on the backend (cadence-be/src/models/Payment.js).
const PAYMENT_METHODS = [
  { value: 'manual', label: 'Manual / Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'wise', label: 'Wise' },
  { value: 'payoneer', label: 'Payoneer' },
  { value: 'stripe', label: 'Stripe' },
  { value: 'payfast', label: 'PayFast' },
];

const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
);

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

// What time period this invoice covers — a retainer's own cycle wins (it's the
// most specific), then the package sale's billing cycle, else it's a one-time
// charge. Was previously impossible to tell from the invoice alone.
function billingPeriodOf(invoice: any): string {
  const cycle = invoice.retainer?.cycle || invoice.clientPackage?.billingCycle || invoice.clientPackage?.package?.billingCycle;
  if (cycle) return CYCLE_LABELS[cycle] || cycle;
  return 'One-time';
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payForm, setPayForm] = useState({ provider: 'manual', amount: '', paidAt: '', providerRef: '' });
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((r) => r.data),
  });

  const { data: configuredMethods = [] } = useQuery<any[]>({
    queryKey: ['invoice-payment-methods'],
    queryFn: () => api.get('/invoices/payment-methods').then((r) => r.data),
  });

  /**
   * What the Method dropdown offers. Falls back to the built-in list only when
   * nothing is configured yet, so the form is never empty — but once an admin
   * has set methods up, this shows exactly those and nothing else.
   *
   * Deduplicated by provider: two configured methods can share one (e.g. two
   * bank accounts both recorded as `bank`), and the dropdown stores the
   * provider, so duplicate values would render as repeated identical options.
   */
  const methodOptions = useMemo(() => {
    if (!configuredMethods.length) return PAYMENT_METHODS;
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const m of configuredMethods) {
      if (seen.has(m.provider)) continue;
      seen.add(m.provider);
      out.push({ value: m.provider, label: m.label });
    }
    return out;
  }, [configuredMethods]);

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/invoices/${id}/status`, { status }).then((r) => r.data),
    onSuccess: async (_, status) => {
      await invalidateMany(qc, afterInvoiceChange(id, invoice?.clientId));
      toast.success(`Invoice marked as ${status}.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status.'),
  });

  // Re-sends the invoice PDF framed as a nudge, plus an in-portal notification.
  // Throws on failure rather than failing quietly — someone clicked a button and
  // is waiting to hear whether the client was actually contacted.
  const sendReminder = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/remind`).then((r) => r.data),
    onSuccess: (d: any) => toast.success(d?.message || 'Reminder sent.'),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not send the reminder.'),
  });

  const syncStripe = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/sync-stripe`).then((r) => r.data),
    onSuccess: async (d: any) => {
      await invalidateMany(qc, afterInvoiceChange(id, invoice?.clientId));
      if (d?.status === 'paid') toast.success(d.message);
      else toast.message(d?.message || 'No payment has cleared yet.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not check with Stripe.'),
  });

  const recordPayment = useMutation({
    mutationFn: (data: typeof payForm) => api.post(`/invoices/${id}/payments`, {
      ...data,
      amount: parseFloat(data.amount),
    }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterInvoiceChange(id, invoice?.clientId));
      setShowPaymentForm(false);
      setPayForm({ provider: 'manual', amount: '', paidAt: '', providerRef: '' });
      toast.success('Payment recorded.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to record payment.'),
  });

  const savePaymentConfig = useMutation({
    // Send what the form is actually SHOWING, not the raw local state. Both
    // fields render `local || saved`, so an untouched field is displaying the
    // saved value while its state is still ''. Submitting the raw state wiped
    // whichever field the admin hadn't retyped — change the method and the
    // Payoneer link silently vanished, which is why it stopped appearing on the
    // PDF while an email sent earlier still had it.
    mutationFn: () => api.patch(`/invoices/${id}/payment-config`, {
      paymentMethodId: paymentMethodId || invoice?.preferredPaymentMethodId || null,
      paymentLinkUrl: toAbsoluteHttpUrl(paymentLinkUrl || invoice?.paymentLinkUrl || '') || null,
    }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterInvoiceChange(id, invoice?.clientId));
      toast.success('Invoice payment profile updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update payment profile.'),
  });

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <Header title="Invoice" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
    </div>
  );

  if (!invoice) return (
    <div className="flex flex-col h-full">
      <Header title="Invoice" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Invoice not found.</div>
    </div>
  );

  const transitions = STATUS_TRANSITIONS[invoice.status] || [];
  const lines: any[] = invoice.lines || [];
  const payments: any[] = invoice.payments || [];
  // Part payments are real: an invoice can be genuinely part-settled and still
  // owed. Both figures are shown so nobody has to add up the history by hand.
  const amountPaid = Math.round(payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0) * 100) / 100;
  const amountDue = Math.max(0, Math.round(((Number(invoice.total) || 0) - amountPaid) * 100) / 100);
  const currentPaymentMethodId = paymentMethodId || invoice.preferredPaymentMethodId || '';
  const currentPaymentLinkUrl = paymentLinkUrl || invoice.paymentLinkUrl || '';

  return (
    <div className="flex flex-col h-full">
      <Header title={invoice.number} />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {/* Back + status */}
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[invoice.status] || 'bg-gray-100 text-gray-600')}>
            {STATUS_LABELS[invoice.status] || invoice.status}
          </span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-violet-50 text-violet-700">
            {billingPeriodOf(invoice)}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: invoice info + line items */}
          <div className="lg:col-span-2 space-y-5">
            {/* Invoice header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {/* Stacks on phones. Side by side, the mono number had to share the
                  row with the amount and broke into "MDL- / INVS-26- / 0001". */}
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                <div className="min-w-0">
                  <div className="text-xl sm:text-2xl font-bold text-gray-900 font-mono whitespace-nowrap">{invoice.number}</div>
                  {/* Drafts carry a placeholder until issued, so the number can't
                      be burned by toggling the client's Pay via CRM setting. */}
                  {String(invoice.number || '').startsWith('DRAFT-') && (
                    <p className="text-xs text-amber-700 mt-1">
                      Provisional — the final number is assigned when you send this invoice, from the client&apos;s Pay via CRM setting.
                    </p>
                  )}
                  <Link href={`/clients/${invoice.client?.id}`} className="text-sm text-brand-700 hover:underline mt-1 block">
                    {invoice.client?.name}
                  </Link>
                </div>
                <div className="sm:text-right shrink-0">
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(invoice.total, invoice.currency)}</div>
                  <div className="text-xs text-gray-400 mt-1">{invoice.currency}</div>
                </div>
              </div>
              {/* "Billing Period" needs more than a third of a phone screen. */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Issued</span>
                  <div className="text-gray-900 mt-1">{invoice.issuedAt ? formatDate(invoice.issuedAt) : '—'}</div>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Due</span>
                  <div className="text-gray-900 mt-1">{invoice.dueAt ? formatDate(invoice.dueAt) : '—'}</div>
                </div>
                <div>
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Billing Period</span>
                  <div className="text-gray-900 mt-1">{billingPeriodOf(invoice)}</div>
                </div>
              </div>
              {invoice.notes && (
                <p className="text-sm text-gray-500 mt-4 pt-4 border-t border-gray-100">{invoice.notes}</p>
              )}
            </div>

            {/* Line items */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Line Items</h3>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-140">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Description</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Qty</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Unit Price</th>
                    <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line: any) => (
                    <tr key={line.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 text-sm text-gray-900">{line.description}</td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right">{line.qty}</td>
                      <td className="px-5 py-3 text-sm text-gray-600 text-right font-mono">{formatCurrency(line.unitPrice, invoice.currency)}</td>
                      <td className="px-5 py-3 text-sm font-medium text-gray-900 text-right font-mono">{formatCurrency(line.amount, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200">
                    <td colSpan={3} className="px-5 py-3.5 text-sm font-semibold text-gray-700 text-right">Total</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-gray-900 text-right font-mono">{formatCurrency(invoice.total, invoice.currency)}</td>
                  </tr>
                  {amountPaid > 0 && (
                    <>
                      <tr>
                        <td colSpan={3} className="px-5 py-2 text-sm text-gray-500 text-right">Paid</td>
                        <td className="px-5 py-2 text-sm text-brand-700 text-right font-mono">− {formatCurrency(amountPaid, invoice.currency)}</td>
                      </tr>
                      <tr className="border-t border-gray-100">
                        <td colSpan={3} className="px-5 py-2.5 text-sm font-semibold text-gray-700 text-right">Balance due</td>
                        <td className={cn('px-5 py-2.5 text-sm font-bold text-right font-mono', amountDue > 0 ? 'text-amber-700' : 'text-brand-700')}>
                          {formatCurrency(amountDue, invoice.currency)}
                        </td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
              </div>
            </div>

            {/* Payment history */}
            {payments.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Payment History</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {payments.map((p: any) => (
                    <div key={p.id} className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-2">
                      <div className="flex items-center gap-3">
                        <CheckCircle className="w-4 h-4 text-brand-600" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{formatCurrency(p.amount, invoice.currency)}</div>
                          <div className="text-xs text-gray-400">{PAYMENT_METHOD_LABELS[p.provider] || p.provider}{p.providerRef ? ` · ${p.providerRef}` : ''}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">{p.paidAt ? formatDate(p.paidAt) : '—'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment proof submitted by client */}
            {invoice.paymentProofUrl && (
              <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-amber-100 flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Client Payment Proof</h3>
                  <span className="ml-auto text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full font-medium">Submitted by client</span>
                </div>
                <div className="p-5">
                  {/\.(jpe?g|png|gif|webp|bmp)$/i.test(invoice.paymentProofUrl) ? (
                    <a href={invoice.paymentProofUrl} target="_blank" rel="noopener noreferrer">
                      <img
                        src={invoice.paymentProofUrl}
                        alt="Payment proof"
                        className="max-h-64 rounded-lg border border-gray-200 object-contain w-full hover:opacity-90 transition-opacity cursor-zoom-in"
                      />
                      <p className="text-xs text-gray-400 mt-2 text-center">Click to open full size</p>
                    </a>
                  ) : (
                    <a
                      href={invoice.paymentProofUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-brand-700 hover:underline"
                    >
                      <ImageIcon className="w-4 h-4" />
                      View payment proof document
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: actions */}
          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Actions</h3>

              <div className="flex gap-2">
                <button
                  onClick={() => viewAuthedFile(`/invoices/${id}/pdf`).catch((e: any) => toast.error(e?.message || 'Failed to open PDF.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200"
                >
                  <Eye className="w-3.5 h-3.5" /> View PDF
                </button>
                <button
                  onClick={() => downloadAuthedFile(`/invoices/${id}/pdf`, `${invoice.number}.pdf`).catch((e: any) => toast.error(e?.message || 'Download failed.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              </div>

              <div className="pt-1 border-t border-gray-100 space-y-2.5">
                <p className="text-xs font-semibold text-gray-700">Client payment profile</p>
                <select
                  value={currentPaymentMethodId}
                  onChange={(e) => setPaymentMethodId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  <option value="">No specific method</option>
                  {(configuredMethods as any[]).map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <input
                  value={currentPaymentLinkUrl}
                  onChange={(e) => setPaymentLinkUrl(e.target.value)}
                  placeholder="Optional manual payment link (Payoneer, etc.)"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                {toAbsoluteHttpUrl(currentPaymentLinkUrl) && (
                  <a
                    href={toAbsoluteHttpUrl(currentPaymentLinkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open current link
                  </a>
                )}
                <button
                  onClick={() => savePaymentConfig.mutate()}
                  disabled={savePaymentConfig.isPending}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-60 py-2 rounded-lg transition-colors"
                >
                  {savePaymentConfig.isPending ? 'Saving…' : 'Save payment profile'}
                </button>
              </div>

              {/* DRAFT — primary: send, secondary: void */}
              {invoice.status === 'draft' && (
                <>
                  <button
                    onClick={() => updateStatus.mutate('sent')}
                    disabled={updateStatus.isPending}
                    className="w-full flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    Send to client
                  </button>
                  <button
                    onClick={() => updateStatus.mutate('void')}
                    disabled={updateStatus.isPending}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium text-red-600 hover:bg-red-50 py-2 rounded-lg transition-colors border border-red-100"
                  >
                    <Ban className="w-4 h-4" /> Void invoice
                  </button>
                </>
              )}

              {/* SENT / OVERDUE / PAYMENT_REVIEW — primary: record payment, secondary: void */}
              {['sent', 'overdue', 'payment_review'].includes(invoice.status) && (
                <>
                  {!showPaymentForm ? (
                    <button
                      onClick={() => {
                        setPayForm({
                          // First configured method, not a hardcoded 'manual' —
                          // which could otherwise be a value the dropdown no
                          // longer offers, leaving the select showing blank.
                          provider: methodOptions[0]?.value || 'manual',
                          amount: String(invoice.total),
                          paidAt: new Date().toISOString().slice(0, 10),
                          providerRef: '',
                        });
                        setShowPaymentForm(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
                    >
                      <CreditCard className="w-4 h-4" />
                      Record payment received
                    </button>
                  ) : null}

                  {/* Only meaningful once a card payment was actually started.
                      Covers the gap the webhook can't: an invoice paid while the
                      webhook was down, misconfigured, or not yet set up would
                      otherwise sit here overdue with the money already taken. */}
                  {!showPaymentForm && invoice.stripeInvoiceId && (
                    <button
                      onClick={() => syncStripe.mutate()}
                      disabled={syncStripe.isPending}
                      className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-60 py-2 rounded-lg transition-colors"
                    >
                      <CreditCard className="w-4 h-4" />
                      {syncStripe.isPending ? 'Checking with Stripe…' : 'Check card payment status'}
                    </button>
                  )}

                  {!showPaymentForm && (
                    <button
                      onClick={() => sendReminder.mutate()}
                      disabled={sendReminder.isPending}
                      className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-60 py-2 rounded-lg transition-colors"
                    >
                      <BellRing className="w-4 h-4" />
                      {sendReminder.isPending ? 'Sending…' : 'Send reminder'}
                    </button>
                  )}

                  {showPaymentForm && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                          <input type="number" step="0.01" min="0.01" value={payForm.amount}
                            placeholder={amountDue.toFixed(2)}
                            onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          {/* Recording less than the balance is a part payment —
                              the invoice stays open for the rest. */}
                          <p className="text-[10px] text-gray-400 mt-1">
                            Balance due {formatCurrency(amountDue, invoice.currency)}
                            {Number(payForm.amount) > 0 && Number(payForm.amount) < amountDue && (
                              <span className="text-amber-600">
                                {' '}· {formatCurrency(amountDue - Number(payForm.amount), invoice.currency)} will stay outstanding
                              </span>
                            )}
                          </p>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                          <input type="date" value={payForm.paidAt}
                            onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Method</label>
                          <select value={payForm.provider}
                            onChange={(e) => setPayForm({ ...payForm, provider: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                            {/* The org's own configured methods, so this matches
                                what clients are actually offered. It used to be a
                                hardcoded list, which showed six options against
                                four configured. */}
                            {methodOptions.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Reference <span className="text-gray-400">(opt.)</span></label>
                          <input placeholder="TXN-123" value={payForm.providerRef}
                            onChange={(e) => setPayForm({ ...payForm, providerRef: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => recordPayment.mutate(payForm)}
                          disabled={!payForm.amount || recordPayment.isPending}
                          className="flex-1 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold py-2 rounded-lg"
                        >
                          {recordPayment.isPending ? 'Saving…' : 'Confirm payment'}
                        </button>
                        <button onClick={() => setShowPaymentForm(false)}
                          className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {!showPaymentForm && (
                    <button
                      onClick={() => updateStatus.mutate('void')}
                      disabled={updateStatus.isPending}
                      className="w-full flex items-center justify-center gap-2 text-sm font-medium text-red-600 hover:bg-red-50 py-2 rounded-lg transition-colors border border-red-100"
                    >
                      <Ban className="w-4 h-4" /> Void invoice
                    </button>
                  )}
                </>
              )}

              {/* PAID / VOID — nothing to do */}
              {(invoice.status === 'paid' || invoice.status === 'void') && (
                <p className="text-sm text-gray-400 text-center py-2">
                  {invoice.status === 'paid' ? 'This invoice has been paid.' : 'This invoice has been voided.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
