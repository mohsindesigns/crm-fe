'use client';

import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { emptyLine, type LineItem } from './invoiceShared';

/**
 * The line-items add/remove/total block inside the "New Invoice" form —
 * identical between Official and Personal invoices.
 */
export default function LineItemsEditor({
  lines,
  setLines,
  currency,
}: {
  lines: LineItem[];
  setLines: (lines: LineItem[]) => void;
  currency: string;
}) {
  const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-2">Line Items</label>
      <div className="space-y-2">
        <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
          <span className="col-span-6">Description</span>
          <span className="col-span-2">Qty</span>
          <span className="col-span-3">Unit Price</span>
          <span className="col-span-1" />
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input className="col-span-6 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              placeholder="Service description" value={line.description}
              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], description: e.target.value }; setLines(n); }} />
            <input className="col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              type="number" min="1" placeholder="1" value={line.qty}
              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], qty: e.target.value }; setLines(n); }} />
            <input className="col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              type="number" min="0" step="0.01" placeholder="0.00" value={line.unitPrice}
              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], unitPrice: e.target.value }; setLines(n); }} />
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}
              className="col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-30">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <button onClick={() => setLines([...lines, emptyLine()])}
          className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium mt-1">
          <Plus className="w-3.5 h-3.5" /> Add line
        </button>
      </div>
      <div className="flex justify-end mt-3 text-sm font-semibold text-gray-900">
        Total: {formatCurrency(lineTotal, currency)}
      </div>
    </div>
  );
}
