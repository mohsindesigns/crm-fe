'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { FileSignature, Search, Plus, Filter } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, formatDate, formatCurrency, titleCase, inactiveRow } from '@/lib/utils';

const STATUS_OPTS = [
  { label: 'All statuses', value: '' },
  { label: 'Draft',    value: 'draft'    },
  { label: 'Sent',     value: 'sent'     },
  { label: 'Viewed',   value: 'viewed'   },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Expired',  value: 'expired'  },
];

const TYPE_OPTS = [
  { label: 'All types', value: '' },
  { label: 'Quotation', value: 'quotation' },
  { label: 'Agreement', value: 'agreement' },
  { label: 'Proposal',  value: 'proposal'  },
];

export const DOC_STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100    text-gray-600',
  sent:     'bg-blue-100    text-blue-700',
  viewed:   'bg-violet-100  text-violet-700',
  approved: 'bg-brand-100 text-brand-800',
  rejected: 'bg-red-100     text-red-700',
  expired:  'bg-amber-100   text-amber-700',
};

const LIMIT = 25;

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-100 rounded shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-24 font-mono" />
            </div>
          </td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-32" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></td>
          <td className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-14" /></td>
        </tr>
      ))}
    </>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const inactive = useShowInactive();

  const { data, isLoading } = useQuery({
    queryKey: ['documents', { page, search, status, type, inactive: inactive.key }],
    queryFn: () =>
      api.get('/documents', { params: {
        page, limit: LIMIT, search: search || undefined, status: status || undefined, type: type || undefined,
        ...inactive.params,
      } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const documents: any[] = data?.data || [];
  const total: number = data?.total || 0;
  const totalPages: number = data?.totalPages || 1;

  function serviceLabel(key: string) {
    return (serviceTypes as any[]).find((s) => s.key === key)?.name || key;
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Quotes & Agreements" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search by number, prospect, or email…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={type}
              onChange={(e) => { setType(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {TYPE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            <ShowInactiveToggle {...inactive.toggleProps} onChange={(v) => { inactive.setShow(v); setPage(1); }} />

            <button
              onClick={() => router.push('/documents/new')}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Document
            </button>
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-180">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Number</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Prospect</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Type</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Service</th>
                <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Sent</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : documents.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">No documents found.</td></tr>
              ) : (
                documents.map((doc: any) => (
                  <tr key={doc.id} className={cn('hover:bg-gray-50 cursor-pointer transition-colors', inactiveRow(doc.isActive))} onClick={() => router.push(`/documents/${doc.id}`)}>
                    {/* nowrap: without it the column squeezed to ~60px and broke
                        "MDL-QT-26-0001" across four lines, one fragment each. */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <FileSignature className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="text-sm font-medium text-gray-900 font-mono">{doc.number}</span>
                        {doc.isActive === false && <InactiveBadge />}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">
                      <p className="text-gray-900">{doc.prospectName}</p>
                      {doc.businessName && <p className="text-xs text-gray-400">{doc.businessName}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{titleCase(doc.type)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{serviceLabel(doc.serviceTypeKey)}</td>
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                      {formatCurrency(doc.amount, doc.currency)}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{doc.sentAt ? formatDate(doc.sentAt) : '—'}</td>
                    <td className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', DOC_STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600')}>
                        {doc.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>

      </div>
    </div>
  );
}
