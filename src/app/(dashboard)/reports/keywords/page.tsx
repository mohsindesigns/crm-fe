'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Filter, Search, ArrowUp, ArrowDown, ArrowUpDown, Download } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import { cn } from '@/lib/utils';

const LIMIT = 25;

type SortColumn = 'volume' | 'difficulty' | 'rank';
const DEFAULT_SORT_DIR: Record<SortColumn, 'asc' | 'desc'> = {
  volume: 'desc',
  difficulty: 'desc',
  rank: 'asc',
};

interface KeywordReportRow {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  packageName: string;
  strategist: { id: string; name: string } | null;
  primaryKeyword: string;
  secondaryKeywords: string | null;
  volume: number | null;
  kd: number | null;
  targetLocation: string | null;
  pageName: string | null;
  status: 'active' | 'inactive';
  currentRank: number | null;
}

interface SummaryRow {
  projectId: string;
  clientName: string;
  packageName: string;
  strategist: { id: string; name: string } | null;
  totalKeywords: number;
  avgVolume: number | null;
  avgKd: number | null;
}

interface OrgUser {
  id: string;
  name: string;
  role?: { key?: string; name?: string } | null;
}

const STRATEGIST_ROLE_PRIORITY = ['project_strategist', 'social_manager', 'ads_manager', 'account_manager', 'project_manager'];

function parseKeywordList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function SupportingKeywordsCell({ raw }: { raw?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const keywords = useMemo(() => parseKeywordList(raw), [raw]);
  if (!keywords.length) return <span className="text-gray-400">—</span>;
  const previewCount = 3;
  const visible = expanded ? keywords : keywords.slice(0, previewCount);
  const hiddenCount = keywords.length - previewCount;
  return (
    <div className="max-w-[240px]">
      <div className="flex flex-wrap gap-1" title={keywords.join(', ')}>
        {visible.map((kw, i) => (
          <span key={`${i}-${kw}`} className="inline-block max-w-full truncate text-[11px] leading-snug px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200/80">
            {kw}
          </span>
        ))}
        {!expanded && hiddenCount > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded(true); }} className="text-[11px] leading-snug px-1.5 py-0.5 rounded-md text-brand-700 hover:bg-brand-50 font-medium">
            +{hiddenCount} more
          </button>
        )}
      </div>
    </div>
  );
}

function SkeletonRows({ cols = 10 }: { cols?: number }) {
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

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const STATUS_OPTS = [
  { label: 'All statuses', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
];

function SortHeader({
  label, col, align = 'right', activeSort, sortDir, onToggle,
}: {
  label: string;
  col: SortColumn;
  align?: 'left' | 'right';
  activeSort: SortColumn | '';
  sortDir: 'asc' | 'desc';
  onToggle: (col: SortColumn) => void;
}) {
  const active = activeSort === col;
  return (
    <th className={cn('text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5', align === 'right' ? 'text-right' : 'text-left')}>
      <button type="button" onClick={() => onToggle(col)} className={cn('inline-flex items-center gap-1 hover:text-gray-700', align === 'right' && 'flex-row-reverse', active && 'text-gray-900')}>
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
      </button>
    </th>
  );
}

function SummaryTab({
  projectId, strategistId, page, limit, onPageChange,
  selectedIds, onToggleRow, onToggleAll,
}: {
  projectId: string; strategistId: string; page: number; limit: number;
  onPageChange: (p: number) => void;
  selectedIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: (ids: string[], checked: boolean) => void;
}) {
  const router = useRouter();
  const { data, isLoading } = useQuery({
    queryKey: ['reports-keyword-summary', { projectId, strategistId, page, limit }],
    queryFn: () => api.get('/reports/keyword-summary', {
      params: { projectId: projectId || undefined, strategistId: strategistId || undefined, page, limit }
    }).then(r => r.data),
  });

  const rows: SummaryRow[] = data?.data || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;
  const allIds = rows.map(r => r.projectId);
  const allChecked = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
  const someChecked = allIds.some(id => selectedIds.has(id)) && !allChecked;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-5 py-3.5 w-10">
                <input
                  type="checkbox"
                  checked={allChecked}
                  ref={el => { if (el) el.indeterminate = someChecked; }}
                  onChange={e => onToggleAll(allIds, e.target.checked)}
                  className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
              </th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Package</th>
              <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Strategist</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Total Keywords</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Avg Volume</th>
              <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Avg KD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <SkeletonRows cols={7} />
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-gray-400">No summary found.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.projectId} className={cn('hover:bg-gray-50 transition-colors', selectedIds.has(r.projectId) && 'bg-brand-50/40')}>
                  <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.projectId)}
                      onChange={() => onToggleRow(r.projectId)}
                      className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                  </td>
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-900 cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.clientName}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.packageName}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.strategist?.name || '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.totalKeywords}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.avgVolume ?? '—'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums cursor-pointer" onClick={() => router.push(`/projects/${r.projectId}?tab=keywords`)}>{r.avgKd ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={onPageChange} />
    </div>
  );
}

export default function KeywordReportsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'keywords' | 'summary'>('keywords');
  const [projectId, setProjectId] = useState('');
  const [strategistId, setStrategistId] = useState('');
  const [status, setStatus] = useState('');
  const [rawSearch, setRawSearch] = useState('');
  const [rawVolumeMin, setRawVolumeMin] = useState('');
  const [rawVolumeMax, setRawVolumeMax] = useState('');
  const [rawDifficultyMin, setRawDifficultyMin] = useState('');
  const [rawDifficultyMax, setRawDifficultyMax] = useState('');
  const [sortBy, setSortBy] = useState<SortColumn | ''>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

  const search = useDebounced(rawSearch, 350);
  const volumeMin = useDebounced(rawVolumeMin, 350);
  const volumeMax = useDebounced(rawVolumeMax, 350);
  const difficultyMin = useDebounced(rawDifficultyMin, 350);
  const difficultyMax = useDebounced(rawDifficultyMax, 350);

  function toggleSort(col: SortColumn) {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir(DEFAULT_SORT_DIR[col]);
    }
    setPage(1);
  }

  function handleTabChange(tab: 'keywords' | 'summary') {
    setActiveTab(tab);
    setPage(1);
    setSelectedIds(new Set());
  }

  function toggleRow(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll(ids: string[], checked: boolean) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) ids.forEach(id => next.add(id));
      else ids.forEach(id => next.delete(id));
      return next;
    });
  }

  async function handleExport(format: 'pdf' | 'csv') {
    setExporting(format);
    const filters = {
      projectId: projectId || undefined,
      strategistId: strategistId || undefined,
      status: status || undefined,
      search: search || undefined,
      volumeMin: volumeMin || undefined,
      volumeMax: volumeMax || undefined,
      difficultyMin: difficultyMin || undefined,
      difficultyMax: difficultyMax || undefined,
      sortBy: sortBy || undefined,
      sortDir: sortBy ? sortDir : undefined,
    };
    try {
      const endpoint = activeTab === 'keywords' ? '/reports/keywords/export' : '/reports/keyword-summary/export';
      const res = await api.post(endpoint, {
        format,
        ids: Array.from(selectedIds),
        filters,
      }, {
        params: { format },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${activeTab === 'keywords' ? 'keyword-report' : 'keyword-summary'}.${format}`);
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

  const { data, isLoading } = useQuery({
    queryKey: ['reports-keywords', {
      page, projectId, strategistId, status, search, volumeMin, volumeMax, difficultyMin, difficultyMax, sortBy, sortDir,
    }],
    queryFn: () => api.get('/reports/keywords', {
      params: {
        page, limit: LIMIT,
        projectId: projectId || undefined,
        strategistId: strategistId || undefined,
        status: status || undefined,
        search: search || undefined,
        volumeMin: volumeMin || undefined,
        volumeMax: volumeMax || undefined,
        difficultyMin: difficultyMin || undefined,
        difficultyMax: difficultyMax || undefined,
        sortBy: sortBy || undefined,
        sortDir: sortBy ? sortDir : undefined,
      },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all-for-keyword-report'],
    queryFn: () => api.get('/projects', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: users = [] } = useQuery<OrgUser[]>({
    queryKey: ['users-all-for-keyword-report'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const strategists = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const u of users) {
      const key = u.role?.key || '';
      const roleName = String(u.role?.name || '');
      if (STRATEGIST_ROLE_PRIORITY.includes(key) || /seo|social|ads|account|project manager|strategist/i.test(roleName)) {
        map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
      }
    }
    if (map.size === 0) {
      for (const u of users) {
        if (u.id) map.set(u.id, { id: u.id, name: u.name || 'Unknown' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [users]);

  const rows: KeywordReportRow[] = data?.data || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 1;

  const pageIds = rows.map(r => r.id);
  const allChecked = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
  const someChecked = pageIds.some(id => selectedIds.has(id)) && !allChecked;

  const hasFilters = projectId || strategistId || status || rawSearch
    || rawVolumeMin || rawVolumeMax || rawDifficultyMin || rawDifficultyMax;

  function clearFilters() {
    setProjectId(''); setStrategistId(''); setStatus(''); setRawSearch('');
    setRawVolumeMin(''); setRawVolumeMax('');
    setRawDifficultyMin(''); setRawDifficultyMax('');
    setPage(1);
  }

  const selectionCount = selectedIds.size;

  return (
    <div className="flex flex-col h-full">
      <Header title="Keyword Reports" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Tabs + Export Buttons ── */}
        <div className="flex items-center justify-between border-b border-gray-200">
          <div className="flex">
            <button
              type="button"
              className={cn('px-4 py-2 text-sm font-medium border-b-2', activeTab === 'keywords' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}
              onClick={() => handleTabChange('keywords')}
            >
              Keywords
            </button>
            <button
              type="button"
              className={cn('px-4 py-2 text-sm font-medium border-b-2', activeTab === 'summary' ? 'border-brand-600 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300')}
              onClick={() => handleTabChange('summary')}
            >
              Summary
            </button>
          </div>

          <div className="flex items-center gap-2 pb-1">
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
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          {activeTab === 'keywords' && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={rawSearch}
                onChange={(e) => { setRawSearch(e.target.value); setPage(1); }}
                placeholder="Search keywords…"
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={projectId}
              onChange={(e) => { setProjectId(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All projects</option>
              {(projects as Array<{ id: string; name: string }>).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <select
              value={strategistId}
              onChange={(e) => { setStrategistId(e.target.value); setPage(1); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All strategists</option>
              {strategists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>

            {activeTab === 'keywords' && (
              <select
                value={status}
                onChange={(e) => { setStatus(e.target.value); setPage(1); }}
                className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
              >
                {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>

          {activeTab === 'keywords' && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Volume</span>
                <input type="number" min={0} placeholder="Min" value={rawVolumeMin} onChange={(e) => { setRawVolumeMin(e.target.value); setPage(1); }} className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600" />
                <span className="text-xs text-gray-400">–</span>
                <input type="number" min={0} placeholder="Max" value={rawVolumeMax} onChange={(e) => { setRawVolumeMax(e.target.value); setPage(1); }} className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Difficulty</span>
                <input type="number" min={0} max={100} placeholder="Min" value={rawDifficultyMin} onChange={(e) => { setRawDifficultyMin(e.target.value); setPage(1); }} className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600" />
                <span className="text-xs text-gray-400">–</span>
                <input type="number" min={0} max={100} placeholder="Max" value={rawDifficultyMax} onChange={(e) => { setRawDifficultyMax(e.target.value); setPage(1); }} className="w-20 text-sm border border-gray-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600" />
              </div>
            </>
          )}

          {hasFilters && (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-gray-500 hover:text-gray-700 underline underline-offset-2">
              Clear filters
            </button>
          )}
        </div>

        {/* ── Table / Summary ── */}
        {activeTab === 'keywords' ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-260">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-5 py-3.5 w-10">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        ref={el => { if (el) el.indeterminate = someChecked; }}
                        onChange={e => toggleAll(pageIds, e.target.checked)}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                    </th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Client</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Package</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Strategist</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Main Keyword</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Supporting Keywords</th>
                    <SortHeader label="Volume" col="volume" activeSort={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader label="Difficulty" col="difficulty" activeSort={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader label="Rank" col="rank" activeSort={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Location</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {isLoading ? (
                    <SkeletonRows cols={11} />
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={11} className="px-5 py-12 text-center text-sm text-gray-400">No keywords found.</td></tr>
                  ) : (
                    rows.map((kw) => (
                      <tr key={kw.id} className={cn('hover:bg-gray-50 transition-colors', selectedIds.has(kw.id) && 'bg-brand-50/40')}>
                        <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(kw.id)}
                            onChange={() => toggleRow(kw.id)}
                            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-gray-900 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${kw.projectId}?tab=keywords`)}>{kw.clientName}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${kw.projectId}?tab=keywords`)}>{kw.packageName}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap cursor-pointer" onClick={() => router.push(`/projects/${kw.projectId}?tab=keywords`)}>{kw.strategist?.name || '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-900 cursor-pointer" onClick={() => router.push(`/projects/${kw.projectId}?tab=keywords`)}>
                          <div className="flex items-center gap-2">
                            <span>{kw.primaryKeyword}</span>
                            {kw.status === 'inactive' && (
                              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactive</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5"><SupportingKeywordsCell raw={kw.secondaryKeywords} /></td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{kw.volume ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{kw.kd ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 text-right tabular-nums">{kw.currentRank ?? '—'}</td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">{kw.targetLocation || '—'}</td>
                        <td className={cn('px-5 py-3.5 text-sm text-gray-600 max-w-[200px] truncate', !kw.pageName && 'text-gray-400')} title={kw.pageName || undefined}>
                          {kw.pageName || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
          </div>
        ) : (
          <SummaryTab
            projectId={projectId}
            strategistId={strategistId}
            page={page}
            limit={LIMIT}
            onPageChange={setPage}
            selectedIds={selectedIds}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
          />
        )}

      </div>
    </div>
  );
}
