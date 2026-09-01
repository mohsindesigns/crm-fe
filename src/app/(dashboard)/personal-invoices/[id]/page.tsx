'use client';

import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CreditCard, CheckCircle, Send, Ban, Eye, Download, ExternalLink, Pencil, Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, formatDate, formatCurrency, downloadAuthedFile, viewAuthedFile, toAbsoluteHttpUrl } from '@/lib/utils';
import { invalidateMany, afterPersonalInvoiceChange } from '@/lib/queryInvalidation';
import { TimelineSteps, invoiceTimelineSteps } from '@/components/TimelineSteps';
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/table';

// Personal-invoice counterpart to invoices/[id]/page.tsx — same lifecycle and
// "pay via CRM" flow, against crm-be's separate PersonalInvoice tables/routes.
// No retainer/package billing-period badge (doesn't apply here), no payment
// proof block (portal-only, and personal contacts have no portal), no "Send
// reminder" (not implemented on PersonalInvoiceService — deferred).

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

const PAYMENT_METHODS = [
  { value: 'manual', label: 'Manual / Cash' },
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'wise', label: 'Wise' },
  { value: 'payoneer', label: 'Payoneer' },
  { value: 'payfast', label: 'PayFast' },
];

type LineItem = { description: string; qty: string; unitPrice: string };
const emptyLine = (): LineItem => ({ description: '', qty: '1', unitPrice: '' });

const PAYMENT_METHOD_LABELS: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
);

export default function PersonalInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payForm, setPayForm] = useState({ provider: 'manual', amount: '', paidAt: '', providerRef: '' });
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [allowPartialPayment, setAllowPartialPayment] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    contactId: '', companyId: '', currency: 'USD', issuedAt: '', dueAt: '', notes: '',
  });
  const [editLines, setEditLines] = useState<LineItem[]>([emptyLine()]);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['personal-invoice', id],
    queryFn: () => api.get(`/personal-invoices/${id}`).then((r) => r.data),
  });

  const { data: configuredMethods = [] } = useQuery<any[]>({
    queryKey: ['personal-invoice-payment-methods'],
    queryFn: () => api.get('/personal-invoices/payment-methods').then((r) => r.data),
  });

  const { data: companies = [] } = useQuery<any[]>({
    queryKey: ['personal-invoice-companies'],
    queryFn: () => api.get('/personal-invoices/companies').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ['personal-contacts'],
    queryFn: () => api.get('/personal-contacts').then((r) => r.data || []),
  });

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
    mutationFn: (status: string) => api.patch(`/personal-invoices/${id}/status`, { status }).then((r) => r.data),
    onSuccess: async (_, status) => {
      await invalidateMany(qc, afterPersonalInvoiceChange(id, invoice?.contactId));
      toast.success(`Invoice marked as ${status}.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status.'),
  });

  const updateInvoice = useMutation({
    mutationFn: (data: any) => api.patch(`/personal-invoices/${id}`, data).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterPersonalInvoiceChange(id, invoice?.contactId));
      setEditing(false);
      toast.success('Invoice updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update invoice.'),
  });

  const recordPayment = useMutation({
    mutationFn: (data: typeof payForm) => api.post(`/personal-invoices/${id}/payments`, {
      ...data,
      amount: parseFloat(data.amount),
    }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterPersonalInvoiceChange(id, invoice?.contactId));
      setShowPaymentForm(false);
      setPayForm({ provider: 'manual', amount: '', paidAt: '', providerRef: '' });
      toast.success('Payment recorded.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to record payment.'),
  });

  const savePaymentConfig = useMutation({
    mutationFn: () => api.patch(`/personal-invoices/${id}/payment-config`, {
      paymentMethodId: paymentMethodId || invoice?.preferredPaymentMethodId || null,
      paymentLinkUrl: toAbsoluteHttpUrl(paymentLinkUrl || invoice?.paymentLinkUrl || '') || null,
      allowPartialPayment: allowPartialPayment !== null ? allowPartialPayment : !!invoice?.allowPartialPayment,
      companyId: companyId !== null ? (companyId || null) : (invoice?.companyId || null),
    }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterPersonalInvoiceChange(id, invoice?.contactId));
      toast.success('Invoice payment profile updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update payment profile.'),
  });

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <Header title="Personal Invoice" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
    </div>
  );

  if (!invoice) return (
    <div className="flex flex-col h-full">
      <Header title="Personal Invoice" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Invoice not found.</div>
    </div>
  );

  const transitions = STATUS_TRANSITIONS[invoice.status] || [];
  const lines: any[] = invoice.lines || [];
  const payments: any[] = invoice.payments || [];
  const amountPaid = Math.round(payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0) * 100) / 100;
  const amountDue = Math.max(0, Math.round(((Number(invoice.total) || 0) - amountPaid) * 100) / 100);
  const currentPaymentMethodId = paymentMethodId || invoice.preferredPaymentMethodId || '';
  const currentPaymentLinkUrl = paymentLinkUrl || invoice.paymentLinkUrl || '';
  const currentCompanyId = companyId !== null ? companyId : (invoice.companyId || '');
  const currentAllowPartialPayment = allowPartialPayment !== null ? allowPartialPayment : !!invoice.allowPartialPayment;
  const editLineTotal = editLines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);

  function startEdit() {
    setEditForm({
      contactId: invoice.contactId || '',
      companyId: invoice.companyId || '',
      currency: invoice.currency || 'USD',
      issuedAt: invoice.issuedAt ? invoice.issuedAt.slice(0, 10) : '',
      dueAt: invoice.dueAt ? invoice.dueAt.slice(0, 10) : '',
      notes: invoice.notes || '',
    });
    setEditLines(
      lines.length
        ? lines.map((l: any) => ({ description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) }))
        : [emptyLine()],
    );
    setEditing(true);
  }

  function submitEdit() {
    updateInvoice.mutate({
      ...editForm,
      lines: editLines
        .filter((l) => l.description && l.unitPrice)
        .map((l) => ({ description: l.description, qty: parseFloat(l.qty) || 1, unitPrice: parseFloat(l.unitPrice) })),
    });
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={invoice.number} />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {/* Back + status */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[invoice.status] || 'bg-gray-100 text-gray-600')}>
            {STATUS_LABELS[invoice.status] || invoice.status}
          </span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200/60">
            Personal — not part of company revenue
          </span>
          {invoice.allowPartialPayment && (
            <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              Partial payments allowed
            </span>
          )}
          {invoice.status === 'draft' && !editing && (
            <button
              onClick={startEdit}
              className="ml-auto flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-lg transition-colors border border-gray-200"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit invoice
            </button>
          )}
        </div>

        {editing && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <h3 className="text-sm font-semibold text-gray-900">Edit Invoice</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Contact</label>
                <select value={editForm.contactId} onChange={(e) => setEditForm({ ...editForm, contactId: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">Select contact…</option>
                  {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Letterhead / company</label>
                <select value={editForm.companyId} onChange={(e) => setEditForm({ ...editForm, companyId: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option value="">No company branding</option>
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                <select value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                </select>
              </div>
              <div />
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Issue Date</label>
                <input type="date" value={editForm.issuedAt} onChange={(e) => setEditForm({ ...editForm, issuedAt: e.target.value })}
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Due Date</label>
                <input type="date" value={editForm.dueAt} onChange={(e) => setEditForm({ ...editForm, dueAt: e.target.value })}
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
                {editLines.map((line, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <input className="col-span-6 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      placeholder="Service description" value={line.description}
                      onChange={(e) => { const n = [...editLines]; n[i] = { ...n[i], description: e.target.value }; setEditLines(n); }} />
                    <input className="col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      type="number" min="1" placeholder="1" value={line.qty}
                      onChange={(e) => { const n = [...editLines]; n[i] = { ...n[i], qty: e.target.value }; setEditLines(n); }} />
                    <input className="col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      type="number" min="0" step="0.01" placeholder="0.00" value={line.unitPrice}
                      onChange={(e) => { const n = [...editLines]; n[i] = { ...n[i], unitPrice: e.target.value }; setEditLines(n); }} />
                    <button onClick={() => setEditLines(editLines.filter((_, j) => j !== i))} disabled={editLines.length === 1}
                      className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setEditLines([...editLines, emptyLine()])}
                  className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium mt-1">
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
              </div>
              <div className="flex justify-end mt-3 text-sm font-semibold text-gray-900">
                Total: {formatCurrency(editLineTotal, editForm.currency)}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
              <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none" />
            </div>

            <div className="flex gap-2">
              <button onClick={submitEdit}
                disabled={!editForm.contactId || editLines.every((l) => !l.description) || updateInvoice.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                {updateInvoice.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button onClick={() => setEditing(false)}
                className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!editing && (
        <>
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <TimelineSteps steps={invoiceTimelineSteps(invoice)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: invoice info + line items */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
                <div className="min-w-0">
                  <div className="text-xl sm:text-2xl font-bold text-gray-900 font-mono whitespace-nowrap">{invoice.number}</div>
                  <p className="text-sm text-gray-700 mt-1">{invoice.contact?.name}</p>
                </div>
                <div className="sm:text-right shrink-0">
                  <div className="text-2xl font-bold text-gray-900">{formatCurrency(invoice.total, invoice.currency)}</div>
                  <div className="text-xs text-gray-400 mt-1">{invoice.currency}</div>
                </div>
              </div>
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
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Letterhead</span>
                  <div className="text-gray-900 mt-1">{invoice.company?.legalName || 'None'}</div>
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
              <Table className="w-full min-w-140">
                <TableHeader>
                  <TableRow className="border-b border-gray-100">
                    <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Description</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Qty</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Unit Price</TableHead>
                    <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-gray-100">
                  {lines.map((line: any) => (
                    <TableRow key={line.id} className="hover:bg-gray-50">
                      <TableCell className="px-5 py-3 text-sm text-gray-900">{line.description}</TableCell>
                      <TableCell className="px-5 py-3 text-sm text-gray-600 text-right">{line.qty}</TableCell>
                      <TableCell className="px-5 py-3 text-sm text-gray-600 text-right font-mono">{formatCurrency(line.unitPrice, invoice.currency)}</TableCell>
                      <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right font-mono">{formatCurrency(line.amount, invoice.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-t border-gray-200">
                    <TableCell colSpan={3} className="px-5 py-3.5 text-sm font-semibold text-gray-700 text-right">Total</TableCell>
                    <TableCell className="px-5 py-3.5 text-sm font-bold text-gray-900 text-right font-mono">{formatCurrency(invoice.total, invoice.currency)}</TableCell>
                  </TableRow>
                  {amountPaid > 0 && (
                    <>
                      <TableRow>
                        <TableCell colSpan={3} className="px-5 py-2 text-sm text-gray-500 text-right">Paid</TableCell>
                        <TableCell className="px-5 py-2 text-sm text-brand-700 text-right font-mono">− {formatCurrency(amountPaid, invoice.currency)}</TableCell>
                      </TableRow>
                      <TableRow className="border-t border-gray-100">
                        <TableCell colSpan={3} className="px-5 py-2.5 text-sm font-semibold text-gray-700 text-right">Balance due</TableCell>
                        <TableCell className={cn('px-5 py-2.5 text-sm font-bold text-right font-mono', amountDue > 0 ? 'text-amber-700' : 'text-brand-700')}>
                          {formatCurrency(amountDue, invoice.currency)}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                </TableFooter>
              </Table>
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
          </div>

          {/* Right: actions */}
          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Actions</h3>

              <div className="flex gap-2">
                <button
                  onClick={() => viewAuthedFile(`/personal-invoices/${id}/pdf`).catch((e: any) => toast.error(e?.message || 'Failed to open PDF.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200"
                >
                  <Eye className="w-3.5 h-3.5" /> View PDF
                </button>
                <button
                  onClick={() => downloadAuthedFile(`/personal-invoices/${id}/pdf`, `${invoice.number}.pdf`).catch((e: any) => toast.error(e?.message || 'Download failed.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              </div>

              <div className="pt-1 border-t border-gray-100 space-y-2.5">
                <p className="text-xs font-semibold text-gray-700">Payment profile</p>
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
                <select
                  value={currentCompanyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  <option value="">No company branding</option>
                  {companies.map((c: any) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
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
                <label className="flex items-start gap-2.5 pt-1.5 pb-1 px-1 cursor-pointer select-none rounded-lg hover:bg-gray-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={currentAllowPartialPayment}
                    onChange={(e) => setAllowPartialPayment(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-semibold text-gray-800">Allow partial payments</span>
                    <p className="text-[11px] text-gray-500 mt-0.5">Contact can pay custom partial amounts instead of full total</p>
                  </div>
                </label>
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
                    Send to contact
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

                  {showPaymentForm && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
                          <input type="number" step="0.01" min="0.01" value={payForm.amount}
                            placeholder={amountDue.toFixed(2)}
                            onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
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
        </>
        )}
      </div>
    </div>
  );
}
