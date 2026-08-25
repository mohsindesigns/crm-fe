'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Filter, Download } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import { cn, formatDate } from '@/lib/utils';

const LIMIT = 25;

interface BacklinkSummaryRow {
  linkBuilderId: string;
  linkBuilderName: string;
  clientId: string | null;
  clientName: string;
  projectId: string;
  projectName: string;
  projectStartDate: string | null;
  linksMadeInDay: number;
  projectTotalBacklinks: number;
  totalIndexed: number;
  totalNonIndexed: number;
  totalDuplicate: number;
}

interface OrgUser {
  id: string;
  name: string;
  role?: { key?: string; name?: string } | null;
}

interface OrgClient {
  id: string;
  name: string;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function rowKey(r: BacklinkSummaryRow) {
  return `${r.projectId}:${r.linkBuilderId}`;
}

function SkeletonRows({ cols = 9 }: { cols?: number }) {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          {[...Array(cols)].map((__, j) => (
            <td key={j} className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function BacklinkReportsPage() {
  const router = useRouter();
  const [linkBuilderId, setLinkBuilderId] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [page, setPage] = useState(1);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['reports-backlink-summary', { linkBuilderId, clientId, projectId, date, page }],
    queryFn: () => api.get('/reports/backlink-summary', {
      params: {
        page, limit: LIMIT,
        linkBuilderId: linkBuilderId || undefined,
        clientId: clientId || undefined,
        projectId: projectId || undefined,
        date,
      },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: clients = [] } = useQuery<OrgClient[]>({
    queryKey: ['clients-all-for-backlink-report'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all-for-backlink-report'],
    queryFn: () => api.get('/projects', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ['users-all-for-backlink-report'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  // Same fallback shape as the Keyword Reports page's strategist filter — prefer
  // the dedicated Link Builder role, but don't leave the filter empty on an org
  // that hasn't set that role up.
  const linkBuilders = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const u of users) {
      if (u.role?.key === 'link_builder' || /link\s*build/i.test(String(u.role?.name || ''))) {
        map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
      }
    }
    if (map.size === 0) {
      for (const u of users) if (u.id) map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  // Client filter narrows the project list to just that client's projects.
  const projectOptions = useMemo(() => {
    const all = projects as Array<{ id: string; name: string; clientId?: string }>;
    return clientId ? all.filter((p) => p.clientId === clientId) : all;
  }, [projects, clientId]);

  function toggleRow(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll(keys: string[], checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) keys.forEach((k) => next.add(k));
      else keys.forEach((k) => next.delete(k));
      return next;
    });
  }

  async function handleExport(format: 'pdf' | 'csv') {
    setExporting(format);
    const filters = {
      linkBuilderId: linkBuilderId || undefined,
      clientId: clientId || undefined,
      projectId: projectId || undefined,
      date,
    };
    try {
      const res = await api.post('/reports/backlink-summary/export', {
        format,
        ids: Array.from(selectedKeys),
        filters,
      }, {
        params: { format },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `backlink-summary.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setExporting(null);
    }
  }

  const rows: BacklinkSummaryRow[] = data?.data || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const pageKeys = rows.map(rowKey);
  const allChecked = pageKeys.length > 0 && pageKeys.every((k) => selectedKeys.has(k));
  const someChecked = pageKeys.some((k) => selectedKeys.has(k)) && !allChecked;

  const hasFilters = linkBuilderId || clientId || projectId || date !== todayStr();

  function clearFilters() {
    setLinkBuilderId(''); setClientId(''); setProjectId(''); setDate(todayStr());
    setPage(1);
  }

  const selectionCount = selectedKeys.size;

  return (
    <div className="flex flex-col h-full">
      <Header title="Backlink Reports" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Export buttons ── */}
        <div className="flex items-center justify-end gap-2">
          {selectionCount > 0 && (
            <span className="text-xs text-gray-500 mr-1">{selectionCount} selected</span>
          )}
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting === 'csv' ? 'Exporting…' : selectionCount > 0 ? `Export CSV (${selectionCount})` : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" />
            {exporting === 'pdf' ? 'Exporting…' : selectionCount > 0 ? `Export PDF (${selectionCount})` : 'Export PDF'}
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={linkBuilderId}
              onChange={(e) => { setLinkBuilderId(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All link builders</option>
              {linkBuilders.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>

            <select
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); setProjectId(''); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All clients</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            <select
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All projects</option>
              {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => { setDate(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          {hasFilters && (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-gray-500 hover:text-gray-700 underline underline-offset-2">
              Clear filters
            </button>
          )}
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-260">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3.5 w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      ref={(el) => { if (el) el.indeterminate = someChecked; }}
                      onChange={(e) => toggleAll(pageKeys, e.target.checked)}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Link Builder</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Project</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Project Start Date</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Links Made Today</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Project Total Backlinks</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Total Indexed</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Total Non-Indexed</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Total Duplicate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoading ? (
                  <SkeletonRows cols={10} />
                ) : rows.length === 0 ? (
                  <tr><td colSpan={10} className="px-5 py-12 text-center text-sm text-gray-400">No link-building activity for this day.</td></tr>
                ) : (
                  rows.map((r) => {
                    const key = rowKey(r);
                    return (
                      <tr key={key} className={cn('hover:bg-gray-50 transition-colors', selectedKeys.has(key) && 'bg-brand-50/40')}>
                        <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedKeys.has(key)}
                            onChange={() => toggleRow(key)}
                            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-gray-900 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=backlinks`)}>{r.linkBuilderName}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=backlinks`)}>{r.clientName}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=backlinks`)}>{r.projectName}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=backlinks`)}>{r.projectStartDate ? formatDate(r.projectStartDate) : '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-900 font-semibold text-right tabular-nums">{r.linksMadeInDay}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{r.projectTotalBacklinks}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{r.totalIndexed}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{r.totalNonIndexed}</td>
                        <td className={cn('px-5 py-3.5 text-sm text-right tabular-nums', r.totalDuplicate > 0 ? 'text-amber-700 font-medium' : 'text-gray-600')}>{r.totalDuplicate}</td>
                      </tr>
                    );
                  })
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
