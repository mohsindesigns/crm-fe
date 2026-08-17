'use client';

/**
 * Admin → Payments.
 *
 * The list of options a client sees in the "Pay with" dropdown on a portal
 * invoice, and the instructions shown once they pick one.
 *
 * Two kinds, and the difference is who confirms the money arrived:
 *   • Card (Stripe) — creates a real Stripe Invoice, redirects the client to its
 *     hosted payment page, and marks our invoice paid automatically from the
 *     webhook. One row only.
 *   • Manual — bank transfer, Wise, Payoneer, cash. The client pays out-of-band
 *     using the instructions here, uploads a receipt, and the invoice sits in
 *     "Under Review" until someone confirms it.
 *
 * Card settings are managed here, not in environment variables: whether cards
 * are accepted, how long an invoice stays payable, and the processing fee per
 * currency. Those are business decisions and shouldn't need a redeploy.
 *
 * The Stripe credentials are the exception — they stay on the server. A secret
 * key is a bearer credential (anyone holding it can move money), so it is never
 * sent to this page in any form. All the panel learns is whether one exists.
 *
 * The processing fee is always charged to the client, added as a line on the
 * Stripe invoice, so the agency receives its invoice total intact. Rates differ
 * by country, hence one rule per currency rather than a single global number.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard, Landmark, Plus, Save, Pencil, X, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import AdminModal from '@/components/admin/AdminModal';
import { cn } from '@/lib/utils';

type Method = {
  id: string;
  kind: 'stripe' | 'manual';
  provider: string;
  label: string;
  instructions: string | null;
  requiresProof: boolean;
  isActive: boolean;
  sortOrder: number;
};

type FeeRule = {
  id: string;
  currency: string;
  percent: string | number;
  fixedFee: string | number;
  label: string | null;
  isActive: boolean;
};

type StripeStatus = {
  enabled: boolean;
  enabledByAdmin: boolean;
  hasCredentials: boolean;
  hasWebhookSecret: boolean;
  invoiceDueDays: number;
  mode: 'sandbox' | 'live';
  feePayer: string;
  fees: FeeRule[];
};

// Must stay within the Payment.provider ENUM on the backend.
const PROVIDERS = [
  { value: 'bank', label: 'Bank Transfer' },
  { value: 'wise', label: 'Wise' },
  { value: 'payoneer', label: 'Payoneer' },
  { value: 'payfast', label: 'PayFast' },
  { value: 'paddle', label: 'Paddle' },
  { value: 'manual', label: 'Other / Cash' },
];

const inp = 'w-full px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';
const btn = 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-700 hover:bg-brand-800 text-white`;
const btnGhost = `${btn} border border-gray-300 hover:bg-gray-50 text-gray-700`;

const EMPTY = { label: '', provider: 'bank', instructions: '', requiresProof: true, isActive: true };

export default function PaymentMethodsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Method | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [confirmOff, setConfirmOff] = useState<Method | null>(null);
  const [feeDraft, setFeeDraft] = useState<any | null>(null);

  const { data: methods = [], isLoading } = useQuery<Method[]>({
    queryKey: ['admin-payment-methods'],
    queryFn: () => api.get('/admin/payment-methods').then((r) => r.data),
  });

  const { data: stripe } = useQuery<StripeStatus>({
    queryKey: ['admin-stripe-status'],
    queryFn: () => api.get('/admin/payment-methods/stripe-status').then((r) => r.data),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-payment-methods'] });

  const save = useMutation({
    mutationFn: () => (editing
      ? api.patch(`/admin/payment-methods/${editing.id}`, form).then((r) => r.data)
      : api.post('/admin/payment-methods', { ...form, kind: 'manual' }).then((r) => r.data)),
    onSuccess: () => {
      toast.success(editing ? 'Payment method updated.' : 'Payment method added.');
      setEditing(null); setCreating(false); setForm({ ...EMPTY }); refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save.'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => (active
      ? api.patch(`/admin/payment-methods/${id}`, { isActive: true }).then((r) => r.data)
      : api.delete(`/admin/payment-methods/${id}`).then((r) => r.data)),
    onSuccess: () => { setConfirmOff(null); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update.'),
  });

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.put('/admin/payment-methods/reorder', { ids }).then((r) => r.data),
    onSuccess: refresh,
  });

  function move(index: number, delta: number) {
    const next = [...methods];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorder.mutate(next.map((m) => m.id));
  }

  function startEdit(m: Method) {
    setCreating(false);
    setEditing(m);
    setForm({
      label: m.label,
      provider: m.provider,
      instructions: m.instructions || '',
      requiresProof: m.requiresProof,
      isActive: m.isActive,
    });
  }

  function cancel() { setEditing(null); setCreating(false); setForm({ ...EMPTY }); }

  const showForm = creating || !!editing;
  const saveSettings = useMutation({
    mutationFn: (patch: any) => api.put('/admin/payment-settings', patch).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-stripe-status'] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save the setting.'),
  });

  const saveFee = useMutation({
    mutationFn: (rule: any) => (rule.id
      ? api.patch(`/admin/payment-fees/${rule.id}`, rule).then((r) => r.data)
      : api.post('/admin/payment-fees', rule).then((r) => r.data)),
    onSuccess: () => {
      toast.success('Processing fee saved.');
      setFeeDraft(null);
      qc.invalidateQueries({ queryKey: ['admin-stripe-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save the fee.'),
  });

  const deleteFee = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/payment-fees/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Fee removed — no surcharge will be added in that currency.');
      qc.invalidateQueries({ queryKey: ['admin-stripe-status'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not remove the fee.'),
  });

  return (
    <div className="space-y-6">
      {/* ── Card payments: business-level status only ─────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-gray-400" />
              Card payments
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Clients pay by card and their invoice is marked paid automatically.
            </p>
          </div>
          {/* The switch itself. Turning it off hides the card option from every
              client immediately; the credentials are untouched, so turning it
              back on needs no redeploy. */}
          <label className="inline-flex items-center gap-2.5 cursor-pointer select-none shrink-0">
            <span className={cn(
              'text-xs font-semibold',
              stripe?.enabledByAdmin ? 'text-emerald-700' : 'text-gray-400',
            )}>
              {stripe?.enabledByAdmin ? 'On' : 'Off'}
            </span>
            <input
              type="checkbox"
              checked={!!stripe?.enabledByAdmin}
              disabled={saveSettings.isPending}
              onChange={(e) => saveSettings.mutate({ stripeEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <span className="relative w-10 h-5.5 bg-gray-200 rounded-full peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4.5 after:w-4.5 after:transition-transform peer-checked:after:translate-x-[18px]" />
          </label>
        </div>

        {/* Cards need BOTH halves: switched on here, and credentials present on
            the server. Saying which half is missing beats a bare "unavailable". */}
        {!stripe?.hasCredentials && (
          <div className="flex items-start gap-2 mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Card payments can&apos;t run yet — the Stripe account still needs connecting on the
              server. Your developer does this once; everything on this page keeps working
              meanwhile.
            </p>
          </div>
        )}

        {stripe?.hasCredentials && stripe.mode === 'sandbox' && (
          <div className="flex items-start gap-2 mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              <span className="font-semibold">Test mode.</span>{' '}
              Card payments are being simulated — no real money will be taken or received.
            </p>
          </div>
        )}

        {stripe?.hasCredentials && !stripe.hasWebhookSecret && (
          <div className="flex items-start gap-2 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800">
              {/* Explicit {' '} rather than a literal space: JSX trims
                  whitespace at the start of a text node, so the gap after the
                  bold lead-in disappeared and rendered as "finished.Clients". */}
              <span className="font-semibold">Set-up is not finished.</span>{' '}
              Clients can pay by card, but invoices won&apos;t be marked paid on their own —
              someone will have to confirm each one by hand until this is completed.
            </p>
          </div>
        )}

        {!stripe?.enabledByAdmin && (
          <p className="text-xs text-gray-500 mt-4">
            Cards are switched off, so clients won&apos;t see a card option on their invoices.
            Every other payment method below keeps working as normal.
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-gray-100 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Invoice stays payable for</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={365}
                defaultValue={stripe?.invoiceDueDays ?? 7}
                key={stripe?.invoiceDueDays}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (days !== stripe?.invoiceDueDays) saveSettings.mutate({ invoiceDueDays: days });
                }}
                className="w-24 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <span className="text-xs text-gray-500">days after it&apos;s sent</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Per-currency processing fees ──────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Card processing fees</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Added to the client&apos;s card payment, so you receive the invoice total in full.
              Card rates differ by country, so set one per currency.
            </p>
          </div>
          <button
            onClick={() => setFeeDraft({ currency: '', label: '', percent: '2.9', fixedFee: '0.30' })}
            className={btnPrimary}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Currency
          </button>
        </div>

        {!stripe?.fees?.length ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">
            No fees set. Clients are charged the invoice total with no surcharge.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {stripe.fees.map((f) => {
              const pct = Number(f.percent) || 0;
              const fixed = Number(f.fixedFee) || 0;
              return (
                <div key={f.id} className="flex items-center gap-3 px-4 sm:px-6 py-3.5 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-gray-900 w-14 shrink-0">{f.currency}</span>
                  {f.label && <span className="text-xs text-gray-400 shrink-0">{f.label}</span>}
                  <span className="text-sm text-gray-700 tabular-nums">
                    {pct}% + {fixed.toFixed(2)}
                  </span>
                  {/* A worked example, because "2.9% + 0.30" is harder to sanity
                      check than the number a client actually gets charged. */}
                  <span className="text-xs text-gray-400">
                    · a {f.currency} 1,000 invoice adds {((1000 * pct) / 100 + fixed).toFixed(2)}
                  </span>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setFeeDraft({ ...f, percent: String(f.percent), fixedFee: String(f.fixedFee) })}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteFee.mutate(f.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Remove"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AdminModal
        open={!!feeDraft}
        title={feeDraft?.id ? `Edit ${feeDraft.currency} fee` : 'Add a currency fee'}
        onClose={() => setFeeDraft(null)}
        footer={(
          <>
            <button
              onClick={() => saveFee.mutate(feeDraft)}
              disabled={saveFee.isPending || !String(feeDraft?.currency || '').trim()}
              className={btnPrimary}
            >
              <Save className="w-3.5 h-3.5" />
              {saveFee.isPending ? 'Saving…' : 'Save Fee'}
            </button>
            <button onClick={() => setFeeDraft(null)} className={btnGhost}>Cancel</button>
          </>
        )}
      >
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label>
            <input
              className={`${inp} font-mono uppercase`}
              value={feeDraft?.currency || ''}
              onChange={(e) => setFeeDraft((d: any) => ({ ...d, currency: e.target.value.toUpperCase() }))}
              placeholder="USD"
              maxLength={3}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Country <span className="text-gray-400 font-normal">(label only)</span></label>
            <input
              className={inp}
              value={feeDraft?.label || ''}
              onChange={(e) => setFeeDraft((d: any) => ({ ...d, label: e.target.value }))}
              placeholder="United States"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Percentage</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.001"
                min={0}
                max={100}
                className={inp}
                value={feeDraft?.percent ?? ''}
                onChange={(e) => setFeeDraft((d: any) => ({ ...d, percent: e.target.value }))}
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Fixed amount</label>
            <input
              type="number"
              step="0.01"
              min={0}
              className={inp}
              value={feeDraft?.fixedFee ?? ''}
              onChange={(e) => setFeeDraft((d: any) => ({ ...d, fixedFee: e.target.value }))}
            />
          </div>
        </div>

        <p className="text-xs text-gray-500">
          On a {feeDraft?.currency || 'CUR'} 1,000 invoice the client would pay{' '}
          <span className="font-semibold text-gray-800">
            {((1000 * (Number(feeDraft?.percent) || 0)) / 100 + (Number(feeDraft?.fixedFee) || 0)).toFixed(2)}
          </span>{' '}
          on top. Match this to what Stripe charges you for that currency.
        </p>
      </AdminModal>

      {/* ── Method list ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 gap-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Payment methods</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Shown to clients on their invoices, in this order.
            </p>
          </div>
          <button onClick={() => { setEditing(null); setCreating(true); setForm({ ...EMPTY }); }} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" />
            Add Method
          </button>
        </div>

        {isLoading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading…</p>
        ) : methods.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">No payment methods yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {methods.map((m, i) => (
              <div key={m.id} className={cn('px-4 sm:px-6 py-4', !m.isActive && 'bg-gray-50/60 opacity-70')}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="flex flex-col mt-0.5">
                      <button
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
                        aria-label="Move up"
                      >▲</button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === methods.length - 1}
                        className="text-gray-300 hover:text-gray-600 disabled:opacity-30 leading-none"
                        aria-label="Move down"
                      >▼</button>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {m.kind === 'stripe'
                          ? <CreditCard className="w-4 h-4 text-gray-400 shrink-0" />
                          : <Landmark className="w-4 h-4 text-gray-400 shrink-0" />}
                        <span className="text-sm font-semibold text-gray-900">{m.label}</span>
                        {m.kind === 'stripe' && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-brand-50 text-brand-700 border border-brand-100 rounded">
                            Automatic
                          </span>
                        )}
                        {m.kind === 'manual' && m.requiresProof && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500 rounded">
                            Receipt required
                          </span>
                        )}
                        {!m.isActive && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500 rounded">
                            Hidden
                          </span>
                        )}
                        {m.kind === 'stripe' && !stripe?.enabled && (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 rounded">
                            Hidden — Stripe not configured
                          </span>
                        )}
                      </div>
                      {m.instructions && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2 whitespace-pre-line">
                          {m.instructions}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => startEdit(m)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {m.isActive ? (
                      <button
                        onClick={() => setConfirmOff(m)}
                        className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                      >
                        Hide
                      </button>
                    ) : (
                      <button
                        onClick={() => setActive.mutate({ id: m.id, active: true })}
                        className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50"
                      >
                        Show
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create / edit ────────────────────────────────────────────────── */}
      <AdminModal
        open={showForm}
        title={editing ? `Edit ${editing.label}` : 'Add Payment Method'}
        onClose={cancel}
        footer={(
          <>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.label.trim()}
              className={btnPrimary}
            >
              <Save className="w-3.5 h-3.5" />
              {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Method'}
            </button>
            <button onClick={cancel} className={btnGhost}>Cancel</button>
          </>
        )}
      >
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Label shown to clients</label>
              <input
                className={inp}
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Bank Transfer (Pakistan)"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Recorded as</label>
              <select
                className={inp}
                value={form.provider}
                disabled={editing?.kind === 'stripe'}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
              >
                {editing?.kind === 'stripe'
                  ? <option value="stripe">Stripe</option>
                  : PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                How payments made this way are categorised in reporting.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Instructions</label>
            <textarea
              className={inp}
              rows={5}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              placeholder={'Account Title: \nBank: \nIBAN: \nSWIFT: \n\nPlease quote the invoice number as the reference.'}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Shown to the client as soon as they select this method. Line breaks are preserved.
            </p>
          </div>

          {editing?.kind !== 'stripe' && (
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.requiresProof}
                onChange={(e) => setForm({ ...form, requiresProof: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
              />
              <span className="text-gray-700">Require a payment receipt before the client can notify us</span>
            </label>
          )}
      </AdminModal>

      <ConfirmDialog
        open={!!confirmOff}
        title="Hide this payment method?"
        message={`Clients will no longer see "${confirmOff?.label}" on their invoices. Past payments recorded against it are unaffected.`}
        confirmLabel="Hide"
        onConfirm={() => confirmOff && setActive.mutate({ id: confirmOff.id, active: false })}
        onCancel={() => setConfirmOff(null)}
      />
    </div>
  );
}
