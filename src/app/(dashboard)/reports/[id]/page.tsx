'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, ListTodo, Link2, FileText, KeyRound, Type,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { KpiPill } from '@/components/dashboard/StatCard';
import { cn, formatDate, titleCase } from '@/lib/utils';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TASK_STATUS_COLOR: Record<string, string> = {
  done: 'bg-brand-100 text-brand-800',
  approved: 'bg-brand-100 text-brand-800',
};

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <TableRow><TableCell colSpan={colSpan} className="px-4 py-8 text-center text-sm text-gray-400">{text}</TableCell></TableRow>;
}

function SectionTable({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function MemberReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(searchParams.get('from') || todayStr());
  const [to, setTo] = useState(searchParams.get('to') || todayStr());

  const { data, isLoading } = useQuery({
    queryKey: ['reports-member', id, { from, to }],
    queryFn: () => api.get(`/reports/members/${id}`, { params: { from, to } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  if (isLoading && !data) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Member Report" />
        <div className="flex-1 p-6 space-y-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Member Report" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Member not found.</div>
      </div>
    );
  }

  const { user, summary, tasks, backlinks, content, keywords } = data;

  return (
    <div className="flex flex-col h-full">
      <Header title={`${user.name}'s Report`} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

        <button onClick={() => router.push('/reports')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" />
          Back to Reports
        </button>

        {/* ── Profile + date range ── */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatarUrl} name={user.name} size="lg" />
            <div>
              <p className="font-semibold text-gray-900">{user.name}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: user.role?.color || '#94a3b8' }} />
                <span className="text-xs text-gray-500">{user.role?.name || '—'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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

        {/* ── KPIs ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiPill icon={CheckCircle2} label="Tasks Completed" value={summary.tasksCompleted} color="brand" />
          <KpiPill icon={ListTodo} label="Open Tasks" value={summary.tasksOpen} color="amber" />
          <KpiPill icon={FileText} label="Content Submitted" value={summary.contentSubmitted} color="blue" />
          <KpiPill icon={Type} label="Words Written" value={summary.wordCount} color="indigo" />
          <KpiPill icon={Link2} label="Backlinks Added" value={summary.backlinksAdded} color="teal" />
          <KpiPill icon={KeyRound} label="Keywords Assigned" value={summary.keywordsAssigned} color="violet" />
        </div>

        {/* ── Tasks completed ── */}
        <SectionTable title={`Tasks Completed (${tasks.length})`}>
          <Table className="w-full min-w-140">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Task</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Project</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Status</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {tasks.length === 0 ? <EmptyRow colSpan={4} text="No tasks completed in this range." /> : tasks.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-900">{t.title}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{t.project?.name || '—'}</TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', TASK_STATUS_COLOR[t.status] || 'bg-gray-100 text-gray-600')}>
                      {titleCase(t.status)}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{t.completedAt ? formatDate(t.completedAt, 'MMM d, yyyy p') : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionTable>

        {/* ── Content submitted ── */}
        <SectionTable title={`Content Submitted (${content.length})`}>
          <Table className="w-full min-w-140">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Page</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Project</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Words</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Status</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {content.length === 0 ? <EmptyRow colSpan={5} text="No content submitted in this range." /> : content.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-900">{c.pageName}{c.revisionNumber > 1 ? ` (rev ${c.revisionNumber})` : ''}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{c.project?.name || '—'}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500 tabular-nums">{c.wordCount ?? '—'}</TableCell>
                  <TableCell className="px-4 py-2.5">
                    <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full',
                      c.status === 'approved' ? 'bg-brand-100 text-brand-800'
                      : c.status === 'rejected' ? 'bg-red-100 text-red-700'
                      : 'bg-amber-100 text-amber-700')}>
                      {titleCase(c.status)}
                    </span>
                  </TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{formatDate(c.createdAt, 'MMM d, yyyy p')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionTable>

        {/* ── Backlinks added ── */}
        <SectionTable title={`Backlinks Added (${backlinks.length})`}>
          <Table className="w-full min-w-140">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Domain</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Project</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Type</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Status</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {backlinks.length === 0 ? <EmptyRow colSpan={5} text="No backlinks added in this range." /> : backlinks.map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-900 truncate max-w-60" title={b.sourceUrl}>{b.domain || b.sourceUrl}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{b.project?.name || '—'}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500 capitalize">{b.linkType}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500 capitalize">{b.status}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{formatDate(b.createdAt, 'MMM d, yyyy p')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionTable>

        {/* ── Keywords assigned (current, not date-scoped) ── */}
        <SectionTable title={`Keywords Assigned (${keywords.length})`}>
          <Table className="w-full min-w-140">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Keyword</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Page</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-2.5">Project</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {keywords.length === 0 ? <EmptyRow colSpan={3} text="No active keywords assigned." /> : keywords.map((k: any) => (
                <TableRow key={k.id}>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-900">{k.primaryKeyword}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{k.pageName || '—'}</TableCell>
                  <TableCell className="px-4 py-2.5 text-sm text-gray-500">{k.project?.name || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </SectionTable>

      </div>
    </div>
  );
}
