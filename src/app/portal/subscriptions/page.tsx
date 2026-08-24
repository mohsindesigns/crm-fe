'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, AlertCircle, CheckCircle2, Clock, Ban } from 'lucide-react';
import { usePortalStore } from '@/store/portal';
import { cn, formatDate, formatCurrency } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

function portalFetch(path: string, token: string) {
  return fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: r.status });
    return data;
  });
}

const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

/**
 * How each entitlement reads to the CLIENT. Deliberately plainer than the
 * staff-side wording: this page has to answer "can I use this right now, and if
 * not what do I do about it?" — so every non-active state names the fix.
 *
 * Mirrors ClientPackage.entitlement, derived server-side from the
 * subscription's own invoices (crm-be/src/services/SubscriptionService.js).
 */
const ENTITLEMENT: Record<string, { label: string; cls: string; icon: typeof CheckCircle2; note: string }> = {
  active: {
    label: 'Active',
    cls: 'bg-brand-50 text-brand-800 border border-brand-100',
    icon: CheckCircle2,
    note: 'Paid up and running.',
  },
  pending_payment: {
    label: 'Awaiting payment',
    cls: 'bg-amber-50 text-amber-700 border border-amber-100',
    icon: Clock,
    note: 'This starts once the invoice below is paid.',
  },
  suspended: {
    label: 'Suspended',
    cls: 'bg-red-50 text-red-600 border border-red-100',
    icon: AlertCircle,
    note: 'Not currently available — settle the invoice below to restore it.',
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-gray-100 text-gray-500',
    icon: Ban,
    note: 'This subscription has been cancelled.',
  },
};

export default function PortalSubscriptionsPage() {
  const { token, client } = usePortalStore();

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ['portal-subscriptions'],
    queryFn: () => portalFetch('/portal/subscriptions', token!),
    enabled: !!token,
  });

  const subs: any[] = subscriptions || [];
  const blocked = subs.filter((s) => s.usable === false && s.entitlement !== 'cancelled');

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">Subscriptions</p>
        <h1 className="text-2xl font-bold text-gray-900" style={{ letterSpacing: '-0.02em' }}>
          {client?.name}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Recurring services on your account — hosting, domains and anything else that renews.
        </p>
      </div>

      {/* ── The one thing worth interrupting for: something they're paying for
             isn't currently available to them. ── */}
      {blocked.length > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {blocked.length === 1
                ? '1 subscription is not currently active'
                : `${blocked.length} subscriptions are not currently active`}
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              Settling the outstanding invoice restores {blocked.length === 1 ? 'it' : 'them'} automatically.
            </p>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 bg-white px-6 py-5 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-40" />
              <div className="h-3 bg-gray-100 rounded w-64 mt-3" />
            </div>
          ))}
        </div>
      ) : subs.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-12 text-center">
          <RefreshCw className="w-8 h-8 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">You don&apos;t have any subscriptions yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {subs.map((sub: any) => {
            const state = ENTITLEMENT[sub.entitlement] || ENTITLEMENT.active;
            const StateIcon = state.icon;
            return (
              <div
                key={sub.id}
                className={cn(
                  'rounded-2xl border bg-white overflow-hidden',
                  sub.usable === false && sub.entitlement !== 'cancelled' ? 'border-red-200' : 'border-gray-100',
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{sub.name}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {sub.vendor ? `${sub.vendor} · ` : ''}
                      {CYCLE_LABELS[sub.billingCycle] || sub.billingCycle}
                      {' · '}
                      {formatCurrency(sub.soldPrice, sub.currency)}
                      {sub.renewsAt ? ` · renews ${formatDate(sub.renewsAt)}` : ''}
                    </p>
                    <p className={cn('text-xs mt-2', sub.usable === false ? 'text-red-600' : 'text-gray-500')}>
                      {sub.entitlementReason || state.note}
                    </p>
                  </div>

                  <span className={cn('flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-full shrink-0', state.cls)}>
                    <StateIcon className="w-3.5 h-3.5" />
                    {state.label}
                  </span>
                </div>

                {/* The way back. A suspended subscription is only useful to the
                    client if the invoice that unblocks it is one click away. */}
                {(sub.outstandingInvoices || []).length > 0 && (
                  <div className="border-t border-gray-50 bg-gray-50/60 px-6 py-3 space-y-2">
                    {(sub.outstandingInvoices as any[]).map((inv: any) => (
                      <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                          Invoice <span className="font-medium text-gray-700">{inv.number}</span>
                          {inv.dueAt ? ` · due ${formatDate(inv.dueAt)}` : ''}
                          {' · '}
                          <span className="font-medium text-gray-700">{formatCurrency(inv.total, sub.currency)}</span>
                        </p>
                        <Link
                          href={`/portal/invoices/${inv.id}`}
                          className="text-xs font-semibold text-brand-800 hover:text-brand-900 whitespace-nowrap"
                        >
                          Pay now →
                        </Link>
                      </div>
                    ))}
                  </div>
                )}

                {/* What they're actually paying for, when the package spells it out. */}
                {Array.isArray(sub.features) && sub.features.length > 0 && (
                  <div className="border-t border-gray-50 px-6 py-3">
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {sub.features.map((f: string, i: number) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-gray-500">
                          <CheckCircle2 className="w-3 h-3 text-gray-300 shrink-0 mt-0.5" />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
