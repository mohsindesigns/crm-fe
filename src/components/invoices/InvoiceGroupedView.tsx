'use client';

import { ChevronRight } from 'lucide-react';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { STATUS_COLORS, STATUS_LABELS } from './invoiceShared';

export type InvoiceGroup = {
  id: string;
  name: string;
  currency: string;
  invoices: any[];
  total: number;
  outstanding: number;
  overdue: number;
  paid: number;
};

/**
 * The "By client" / "By contact" rolled-up accordion view — identical
 * between Official and Personal invoices; the grouping key (client vs.
 * contact) is decided by the caller when it builds `groups`, not by this
 * component.
 */
export default function InvoiceGroupedView({
  groups,
  loading,
  expandedIds,
  onToggleExpand,
  onInvoiceClick,
}: {
  groups: InvoiceGroup[];
  loading: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onInvoiceClick: (inv: any) => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {loading ? (
        <p className="px-5 py-12 text-center text-sm text-gray-400">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-gray-400">No invoices found.</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {groups.map((g) => {
            const open = expandedIds.has(g.id);
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => onToggleExpand(g.id)}
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
                        onClick={() => onInvoiceClick(inv)}
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
  );
}
