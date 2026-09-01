'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Search, Filter, CheckCircle2, ListTodo, Link2, FileText, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import { cn } from '@/lib/utils';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import BarChartCard from '@/components/charts/BarChartCard';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Same "today" default for both ends — a single-day snapshot is the most
// useful default view; widening to a range is one click on either input.
function daysAgoStr(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PRESETS = [
  { label: 'Today',      from: () => todayStr(),      to: () => todayStr() },
  { label: 'Yesterday',  from: () => daysAgoStr(1),    to: () => daysAgoStr(1) },
  { label: 'Last 7 days', from: () => daysAgoStr(6),   to: () => todayStr() },
  { label: 'Last 30 days', from: () => daysAgoStr(29), to: () => todayStr() },
];

function StatPill({ icon: Icon, value, label }: { icon: any; value: number; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-600" title={label}>
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span className="font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {[...Array(6)].map((_, i) => (
        <TableRow key={i} className="animate-pulse border-b border-gray-50">
          <TableCell className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
              <div className="space-y-1.5">
                <div className="h-4 bg-gray-100 rounded w-32" />
                <div className="h-3 bg-gray-100 rounded w-24" />
              </div>
            </div>
          </TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-16" /></TableCell>
          <TableCell className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-40" /></TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function ReportsMembersPage() {
  const router = useRouter();
  const [rawSearch, setRawSearch] = useState('');
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());

  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch), 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const { data, isLoading } = useQuery({
    queryKey: ['reports-members', { search, roleId, from, to }],
    queryFn: () => api.get('/reports/members', {
      params: { search: search || undefined, roleId: roleId || undefined, from, to },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: rolesRaw } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
  });
  const roles = (rolesRaw || []).filter((r: any) => r.key !== 'client');

  const members: any[] = data?.members || [];

  const tasksCompletedChartData = members
    .map((m) => ({ label: m.name, value: m.tasksCompleted }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return (
    <div className="flex flex-col h-full">
      <Header title="Reports" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All roles</option>
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 sm:ml-auto flex-wrap">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <span className="text-xs text-gray-400">to</span>
            <input
              type="date"
              value={to}
              min={from}
              max={todayStr()}
              onChange={(e) => setTo(e.target.value)}
              className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        </div>

        {/* ── Presets ── */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {PRESETS.map((p) => {
            const active = from === p.from() && to === p.to();
            return (
              <button
                key={p.label}
                onClick={() => { setFrom(p.from()); setTo(p.to()); }}
                className={cn(
                  'text-xs font-medium px-2.5 py-1 rounded-full border transition-colors',
                  active
                    ? 'bg-brand-700 border-brand-700 text-white'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        {/* ── Tasks completed chart ── */}
        {!isLoading && (
          <BarChartCard title="Tasks Completed — Top Members" data={tasksCompletedChartData} />
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <Table className="w-full min-w-180">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Member</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Role</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Activity in range</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Open tasks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : members.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">No members found.</TableCell></TableRow>
              ) : (
                members.map((m: any) => (
                  <TableRow
                    key={m.id}
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/reports/${m.id}?from=${from}&to=${to}`)}
                  >
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar src={m.avatarUrl} name={m.name} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">{m.name}</p>
                          <p className="text-xs text-gray-400">{m.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.role?.color || '#94a3b8' }} />
                        <span className="text-sm text-gray-600">{m.role?.name || '—'}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-4 flex-wrap">
                        <StatPill icon={CheckCircle2} value={m.tasksCompleted} label="Tasks completed" />
                        <StatPill icon={FileText} value={m.contentSubmitted} label="Content submitted" />
                        <StatPill icon={Link2} value={m.backlinksAdded} label="Backlinks added" />
                        <StatPill icon={KeyRound} value={m.keywordsAssigned} label="Keywords assigned" />
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600">
                        <ListTodo className="w-3.5 h-3.5 text-gray-400" />
                        {m.tasksOpen}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

      </div>
    </div>
  );
}
