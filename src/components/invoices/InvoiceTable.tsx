'use client';

import { FileText } from 'lucide-react';
import Pagination from '@/components/Pagination';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn, formatDate, formatCurrency } from '@/lib/utils';
import { InvoiceSkeletonRows, STATUS_COLORS, STATUS_LABELS, VOIDABLE } from './invoiceShared';

/**
 * The flat "By invoice" list — identical between Official and Personal
 * invoices except for what the second column is called and how a row's
 * counterparty name is read off it (client vs. contact).
 */
export default function InvoiceTable({
  invoices,
  isLoading,
  entityLabel,
  getEntityName,
  onRowClick,
  selectedIds,
  toggleSelect,
  toggleSelectAll,
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}: {
  invoices: any[];
  isLoading: boolean;
  entityLabel: string;
  getEntityName: (inv: any) => string;
  onRowClick: (inv: any) => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string, voidable: boolean) => void;
  toggleSelectAll: () => void;
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}) {
  const voidableIds = invoices.filter((inv) => VOIDABLE.has(inv.status)).map((inv) => inv.id as string);
  const allVoidableSelected = voidableIds.length > 0 && voidableIds.every((id) => selectedIds.has(id));

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <Table className="w-full min-w-160">
        <TableHeader>
          <TableRow className="border-b border-gray-200 bg-gray-100">
            <TableHead className="w-10 px-5 py-3.5">
              <input
                type="checkbox"
                checked={allVoidableSelected}
                disabled={!voidableIds.length}
                onChange={toggleSelectAll}
                aria-label="Select all voidable invoices on this page"
                className="w-3.5 h-3.5 rounded accent-brand-700 disabled:opacity-40"
              />
            </TableHead>
            <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Invoice</TableHead>
            <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">{entityLabel}</TableHead>
            <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Issued</TableHead>
            <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Due</TableHead>
            <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</TableHead>
            <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-gray-50">
          {isLoading ? (
            <InvoiceSkeletonRows />
          ) : invoices.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">No invoices found.</TableCell></TableRow>
          ) : (
            invoices.map((inv: any) => {
              const voidable = VOIDABLE.has(inv.status);
              const selected = selectedIds.has(inv.id);
              return (
                <TableRow
                  key={inv.id}
                  className={cn(
                    'hover:bg-gray-50 cursor-pointer transition-colors',
                    selected && 'bg-brand-50/60 hover:bg-brand-50',
                  )}
                  onClick={() => onRowClick(inv)}
                >
                  <TableCell className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!voidable}
                      onChange={() => toggleSelect(inv.id, voidable)}
                      aria-label={`Select ${inv.number}`}
                      title={voidable ? undefined : 'Paid or void invoices cannot be selected'}
                      className="w-3.5 h-3.5 rounded accent-brand-700 disabled:opacity-30"
                    />
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="text-sm font-medium text-gray-900 font-mono">{inv.number}</span>
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-sm text-gray-600">{getEntityName(inv)}</TableCell>
                  <TableCell className="px-5 py-3.5 text-sm text-gray-600">{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</TableCell>
                  <TableCell className="px-5 py-3.5 text-sm text-gray-600">{inv.dueAt ? formatDate(inv.dueAt) : '—'}</TableCell>
                  <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                    {formatCurrency(inv.total, inv.currency)}
                  </TableCell>
                  <TableCell className="px-5 py-3.5">
                    <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600')}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={onPageChange} />
    </div>
  );
}
