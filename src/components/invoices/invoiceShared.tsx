'use client';

// Shared between the Official Invoices page and the Personal Invoices page —
// same status lifecycle, same line-item shape, same table skeleton. Kept
// deliberately narrow: only what is byte-identical between the two pages
// today lives here. Anything that differs even slightly (the payment-rail
// filter, the org partial-payment default, contact-vs-client entity
// selection) stays in each page — see the comment at the top of
// personal-invoices/page.tsx for why the two are separate systems, not two
// views of one.

import { TableCell, TableRow } from '@/components/ui/table';

export const STATUS_OPTS = [
  { label: 'All statuses',    value: ''                },
  { label: 'Draft',           value: 'draft'           },
  { label: 'Sent',            value: 'sent'            },
  { label: 'Paid',            value: 'paid'            },
  { label: 'Overdue',         value: 'overdue'         },
  { label: 'Payment Review',  value: 'payment_review'  },
  { label: 'Void',            value: 'void'            },
];

export const STATUS_COLORS: Record<string, string> = {
  draft:          'bg-gray-100  text-gray-600',
  sent:           'bg-blue-100  text-blue-700',
  paid:           'bg-brand-100 text-brand-800',
  overdue:        'bg-red-100   text-red-700',
  payment_review: 'bg-amber-100 text-amber-700',
  void:           'bg-gray-100  text-gray-400',
};

export const STATUS_LABELS: Record<string, string> = {
  payment_review: 'Payment Review',
};

export const VOIDABLE = new Set(['draft', 'sent', 'overdue', 'payment_review']);

export type LineItem = { description: string; qty: string; unitPrice: string };
export const emptyLine = (): LineItem => ({ description: '', qty: '1', unitPrice: '' });

export function InvoiceSkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <TableRow key={i} className="animate-pulse border-b border-gray-50">
          <TableCell className="px-5 py-3.5">
            <div className="w-4 h-4 bg-gray-100 rounded" />
          </TableCell>
          <TableCell className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-100 rounded shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-24 font-mono" />
            </div>
          </TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-32" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-14" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}
