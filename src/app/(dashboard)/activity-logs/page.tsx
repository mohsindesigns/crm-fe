'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter, PlusCircle, PencilLine, Trash2, Activity, type LucideIcon } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import Pagination from '@/components/Pagination';
import { cn, formatDate } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const LIMIT = 25;

interface UserOption {
  id: string;
  name: string;
}

interface ActivityLogRow {
  id: string;
  createdAt: string;
  action: string;
  description: string;
  method: string;
  path: string;
  actorName?: string | null;
  actor?: { name?: string; avatarUrl?: string } | null;
}

const ACTION_STYLE: Record<string, { label: string; icon: LucideIcon; className: string }> = {
  create: { label: 'Created', icon: PlusCircle, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: 'Updated', icon: PencilLine, className: 'bg-blue-50 text-blue-700 border-blue-200' },
  delete: { label: 'Deleted', icon: Trash2,     className: 'bg-red-50 text-red-700 border-red-200' },
  other:  { label: 'Other',   icon: Activity,   className: 'bg-gray-50 text-gray-600 border-gray-200' },
};

function ActionBadge({ action }: { action: string }) {
  const style = ACTION_STYLE[action] || ACTION_STYLE.other;
  const Icon = style.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border', style.className)}>
      <Icon className="w-3 h-3" />
      {style.label}
    </span>
  );
}

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <TableRow key={i} className="animate-pulse border-b border-gray-50">
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-28" /></TableCell>
          <TableCell className="px-5 py-3.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gray-100 shrink-0" />
              <div className="h-4 bg-gray-100 rounded w-24" />
            </div>
          </TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-56" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function ActivityLogsPage() {
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [resource, setResource] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  // Debounce search — reset to page 1 when query changes
  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const resetPage = useCallback(() => setPage(1), []);

  const { data, isLoading } = useQuery({
    queryKey: ['activity-logs', { page, search, actorUserId, resource, action, from, to }],
    queryFn: () => api.get('/activity-logs', {
      params: {
        page, limit: LIMIT,
        search: search || undefined,
        actorUserId: actorUserId || undefined,
        resource: resource || undefined,
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
      },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: resources = [] } = useQuery({
    queryKey: ['activity-logs-resources'],
    queryFn: () => api.get('/activity-logs/resources').then((r) => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-assignable'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data),
  });

  const logs: ActivityLogRow[] = data?.data || [];
  const totalPages: number = data?.totalPages || 1;
  const total: number = data?.total || 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="Activity Logs" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
          <div className="relative w-full sm:flex-1 sm:max-w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search logs…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={actorUserId}
              onChange={(e) => { setActorUserId(e.target.value); resetPage(); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All users</option>
              {(users as UserOption[]).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select
              value={resource}
              onChange={(e) => { setResource(e.target.value); resetPage(); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All sections</option>
              {(resources as string[]).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={action}
              onChange={(e) => { setAction(e.target.value); resetPage(); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All actions</option>
              <option value="create">Created</option>
              <option value="update">Updated</option>
              <option value="delete">Deleted</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => { setFrom(e.target.value); resetPage(); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => { setTo(e.target.value); resetPage(); }}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        </div>

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <Table className="w-full min-w-180">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Time</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">User</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Action</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : logs.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">No activity found.</TableCell></TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="px-5 py-3.5 whitespace-nowrap">
                      <span className="text-sm text-gray-600">{formatDate(log.createdAt, 'MMM d, yyyy h:mm a')}</span>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <Avatar src={log.actor?.avatarUrl} name={log.actor?.name || log.actorName} size="sm" />
                        <span className="text-sm font-medium text-gray-900">{log.actor?.name || log.actorName || 'Unknown'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <ActionBadge action={log.action} />
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <p className="text-sm text-gray-700">{log.description}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{log.method} {log.path}</p>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>

      </div>
    </div>
  );
}
