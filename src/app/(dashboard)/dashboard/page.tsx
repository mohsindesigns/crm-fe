'use client';

import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Users, DollarSign, AlertCircle, Clock, UserCircle, ArrowRight, CheckSquare, FileSignature, UserPlus, Calendar, Receipt, Percent } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import Header from '@/components/layout/Header';
import AttendanceCheckWidget from '@/components/AttendanceCheckWidget';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import BarChartCard from '@/components/charts/BarChartCard';
import DonutChartCard from '@/components/charts/DonutChartCard';
import StatCard, { type StatCardColor } from '@/components/dashboard/StatCard';
import { cn, formatCurrency, formatDate, titleCase } from '@/lib/utils';

const WAITING_TYPE_LABELS: Record<string, string> = {
  project: 'Project',
  worker_review: 'New Hire',
  leave: 'Leave',
  contractor_invoice: 'Invoice',
  document: 'Quote/Agreement',
  document_request: 'HR Document',
  payroll_concern: 'Payroll',
};

const WAITING_TYPE_COLORS: Record<string, string> = {
  project: 'bg-brand-50 text-brand-800',
  worker_review: 'bg-violet-50 text-violet-700',
  leave: 'bg-amber-50 text-amber-700',
  contractor_invoice: 'bg-blue-50 text-blue-700',
  document: 'bg-rose-50 text-rose-700',
  document_request: 'bg-indigo-50 text-indigo-700',
  payroll_concern: 'bg-red-50 text-red-700',
};

// Icon per waiting-type, both for the section header and so each row carries
// a visual cue of *what kind* of thing it is at a glance — previously every
// section header used the same generic clock icon, which made "Waiting on
// you" read as one undifferentiated pile instead of distinct queues.
const WAITING_TYPE_ICONS: Record<string, any> = {
  project: Clock,
  worker_review: UserPlus,
  leave: Calendar,
  contractor_invoice: Receipt,
  document: FileSignature,
  document_request: FileSignature,
  payroll_concern: DollarSign,
};

// Display order + section title for each "waiting on you" item type — each type
// gets its own table instead of one mixed list, so leave requests (etc.) don't
// get lost in a pile of unrelated project approvals.
const WAITING_TYPE_ORDER = ['payroll_concern', 'document_request', 'document', 'project', 'worker_review', 'leave', 'contractor_invoice'];
const WAITING_TYPE_SECTION_TITLES: Record<string, string> = {
  project: 'Projects waiting on you',
  worker_review: 'New hire reviews',
  leave: 'Leave requests',
  contractor_invoice: 'Contractor invoices',
  document: 'Quotes & agreements needing changes',
  document_request: 'Employee document requests',
  payroll_concern: 'Payroll concerns',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  completed: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700',
  blocked: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

function CurrencyCard({ label, map, icon, color, href }: {
  label: string; map: Record<string, number> | undefined; icon: React.ElementType; color: StatCardColor;
  href?: string;
}) {
  const entries = Object.entries(map || {}).filter(([, amt]) => amt > 0);
  return (
    <StatCard label={label} icon={icon} color={color} href={href}>
      {entries.length === 0 ? (
        <p className="text-3xl font-bold text-gray-900">—</p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {entries.map(([cur, amt]) => (
            <div key={cur}>
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">{cur}</p>
              <p className="text-sm font-semibold text-gray-900 tabular-nums leading-tight">{formatCurrency(amt, cur)}</p>
            </div>
          ))}
        </div>
      )}
    </StatCard>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role?.key === 'super_admin';
  const isAdminUser = isSuperAdmin || user?.role?.key === 'admin';
  const canSeeBilling = isAdminUser || !!user?.role?.permissions?.['billing.read'];

  const { data: metrics } = useQuery({
    queryKey: ['analytics-dashboard'],
    queryFn: () => api.get('/analytics/dashboard').then((r) => r.data),
  });

  const { data: waitingOnMe = [] } = useQuery({
    queryKey: ['waiting-on-me'],
    queryFn: () => api.get('/analytics/waiting-on-me').then((r) => r.data),
  });

  const { data: byStage } = useQuery({
    queryKey: ['projects-by-stage'],
    queryFn: () => api.get('/analytics/projects-by-stage').then((r) => r.data),
  });

  const { data: workerProfile } = useQuery({
    queryKey: ['hr-me'],
    queryFn: () => api.get('/hr/me').then((r) => r.data).catch(() => null),
  });

  const { data: myProjectsResp } = useQuery({
    queryKey: ['dashboard-my-projects'],
    queryFn: () => api.get('/projects', { params: { limit: 100 } }).then((r) => r.data),
  });
  const myProjects: any[] = myProjectsResp?.data || [];
  const pendingProjects = myProjects.filter((p) => ['active', 'on_hold', 'blocked'].includes(p.status));
  const completedProjects = myProjects.filter((p) => p.status === 'completed');

  const { data: openTasks = [] } = useQuery({
    queryKey: ['dashboard-my-tasks-open'],
    queryFn: () => api.get('/tasks/mine').then((r) => r.data),
  });
  const { data: doneTasks = [] } = useQuery({
    queryKey: ['dashboard-my-tasks-done'],
    queryFn: () => api.get('/tasks/mine', { params: { status: 'done' } }).then((r) => r.data),
  });

  const needsProfileCompletion = workerProfile && ['invited', 'profile_pending'].includes(workerProfile.status);

  const stageBuckets = Object.entries(byStage || {}) as [string, any[]][];
  const stageChartData = stageBuckets
    .map(([stageKey, projects]) => ({ label: titleCase(stageKey), value: projects.length }))
    .sort((a, b) => b.value - a.value);

  // Combined open + done tasks, grouped by their actual status — a fuller
  // breakdown than the open/done split the list above shows.
  const taskStatusCounts = [...openTasks, ...doneTasks].reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const taskStatusChartData = Object.entries(taskStatusCounts)
    .map(([status, value]) => ({ label: titleCase(status), value: value as number }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col h-full">
      <Header title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-gray-900">
              Good to see you, {user?.name?.split(' ')[0]}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">Here's what's happening across your workspace.</p>
          </div>
          {isSuperAdmin && (
            <Link
              href="/hr/settings#tax-slabs"
              className="flex items-center gap-1.5 shrink-0 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 px-4 py-2.5 rounded-lg shadow-sm transition-colors"
            >
              <Percent className="w-4 h-4" />
              Tax Slabs
            </Link>
          )}
        </div>

        {/* Profile completion prompt — shown until employee completes their profile */}
        {needsProfileCompletion && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
              <UserCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">Complete your profile to get started</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Fill in your personal details, bank information, and emergency contacts so HR can onboard you properly.
              </p>
            </div>
            <Link
              href="/self-service?tab=profile"
              className="flex items-center gap-1.5 shrink-0 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-2 rounded-lg transition-colors"
            >
              Complete Profile
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {/* Quick attendance for employees — same check-in/out as the Attendance page */}
        {workerProfile && !needsProfileCompletion && (
          <AttendanceCheckWidget />
        )}

        {/* Metrics */}
        <div className={`grid gap-4 ${canSeeBilling ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
          <StatCard
            label="Active Projects"
            value={metrics?.activeProjects ?? '—'}
            sub={`${metrics?.totalProjects ?? 0} total projects`}
            icon={FolderKanban}
            color="brand"
            href="/projects?status=active"
            progress={metrics?.totalProjects ? {
              pct: Math.round(((metrics.activeProjects || 0) / metrics.totalProjects) * 100),
            } : undefined}
          />
          <StatCard
            label="Completed Projects"
            value={metrics?.completedProjects ?? '—'}
            sub={metrics?.totalProjects ? `${Math.round(((metrics.completedProjects || 0) / metrics.totalProjects) * 100)}% of all projects` : 'No projects yet'}
            icon={Users}
            color="blue"
            href="/projects?status=completed"
            progress={metrics?.totalProjects ? {
              pct: Math.round(((metrics.completedProjects || 0) / metrics.totalProjects) * 100),
            } : undefined}
          />
          {canSeeBilling && (
            <CurrencyCard
              label="Revenue (paid)"
              map={metrics?.revenueByCurrency}
              icon={DollarSign}
              color="violet"
              href="/invoices?status=paid"
            />
          )}
          {canSeeBilling && (
            <CurrencyCard
              label="Outstanding"
              map={metrics?.outstandingByCurrency}
              icon={AlertCircle}
              color="amber"
              href="/billing"
            />
          )}
        </div>

        {/* Needs Your Attention — grouped into one table per item type instead of one
            mixed list, so e.g. leave requests don't get lost in a pile of project
            approvals. Placed above the overview widgets below (My Projects/My Tasks)
            since this is the actionable content, not a status summary — and given
            its own umbrella heading + rose/amber "needs action" framing so it reads
            as a distinct zone rather than blending into the informational widgets. */}
        {waitingOnMe.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500" />
              <h2 className="text-sm font-semibold text-gray-900">Needs Your Attention</h2>
              <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">
                {waitingOnMe.length}
              </span>
            </div>
            <div className="space-y-4">
              {WAITING_TYPE_ORDER.map((type) => {
                const group = waitingOnMe.filter((item: any) => item.type === type);
                if (group.length === 0) return null;
                const TypeIcon = WAITING_TYPE_ICONS[type] || Clock;
                return (
                  <div key={type} className="bg-white rounded-xl border border-gray-200">
                    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
                      <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', WAITING_TYPE_COLORS[type] || 'bg-gray-100')}>
                        <TypeIcon className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900">{WAITING_TYPE_SECTION_TITLES[type] || 'Waiting on you'}</h3>
                      <span className="ml-auto text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        {group.length}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {group.map((item: any) => (
                        <Link
                          key={`${item.type}-${item.id}`}
                          href={item.href}
                          className="flex flex-wrap items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors gap-4"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{item.subtitle}</p>
                          </div>
                          <span className={cn('shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full', WAITING_TYPE_COLORS[item.type] || 'bg-gray-100 text-gray-500')}>
                            {WAITING_TYPE_LABELS[item.type] || titleCase(item.type)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Overview — informational widgets, visually distinct from the actionable
            "Needs Your Attention" zone above (neutral heading vs rose, no count
            badge — nothing here needs a decision, it's a status summary). */}
        <h2 className="text-sm font-semibold text-gray-900">Overview</h2>

        {/* My Projects — pending vs completed, side by side */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                <FolderKanban className="w-3.5 h-3.5 text-brand-700" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">My Projects</h3>
            </div>
            <Link href="/projects" className="text-xs font-medium text-brand-700 hover:text-brand-800">View all →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            <div>
              <div className="px-5 py-2.5 flex items-center gap-2 bg-amber-50/50">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Pending</span>
                <span className="text-xs text-amber-600">{pendingProjects.length}</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {pendingProjects.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-gray-400 text-center">No pending projects.</p>
                ) : pendingProjects.slice(0, 8).map((p: any) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex flex-wrap items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 truncate">{p.client?.name} · {titleCase(p.currentStageKey)}</p>
                    </div>
                    <span className={cn('shrink-0 px-2 py-0.5 text-[10px] font-medium rounded-full', STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-500')}>
                      {titleCase(p.status)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <div className="px-5 py-2.5 flex items-center gap-2 bg-blue-50/50">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Completed</span>
                <span className="text-xs text-blue-600">{completedProjects.length}</span>
              </div>
              <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
                {completedProjects.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-gray-400 text-center">No completed projects yet.</p>
                ) : completedProjects.slice(0, 8).map((p: any) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className="flex flex-wrap items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                      <p className="text-xs text-gray-400 truncate">{p.client?.name}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* My Tasks — pending vs completed, side by side */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900">My Tasks</h3>
            </div>
            <Link href="/tasks" className="text-xs font-medium text-brand-700 hover:text-brand-800">View all →</Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
            <div>
              <div className="px-5 py-2.5 flex items-center gap-2 bg-amber-50/50">
                <span className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Pending</span>
                <span className="text-xs text-amber-600">{openTasks.length}</span>
              </div>
              {openTasks.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-400 text-center">No pending tasks.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <Table className="w-full">
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow className="border-b border-gray-200 bg-gray-100">
                        <TableHead className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-5 py-2 w-full">Task</TableHead>
                        <TableHead className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 whitespace-nowrap">Due</TableHead>
                        <TableHead className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 whitespace-nowrap">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-gray-50">
                      {openTasks.slice(0, 8).map((t: any) => {
                        const isOverdue = !!t.dueAt
                          && new Date(t.dueAt) < new Date(new Date().toDateString())
                          && !['done', 'approved'].includes(t.status);
                        return (
                          <TableRow key={t.id} className="hover:bg-gray-50 transition-colors">
                            <TableCell className="px-5 py-2.5 w-full">
                              <Link href={`/tasks/${t.projectId}/${t.id}`} className="block min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                                <p className="text-xs text-gray-400 truncate">{t.project?.client?.name && `${t.project.client.name} · `}{t.project?.name}</p>
                              </Link>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 whitespace-nowrap">
                              <span className={cn('text-xs', isOverdue ? 'text-red-600 font-medium' : 'text-gray-400')}>
                                {t.dueAt ? formatDate(t.dueAt, 'MMM d') : '—'}
                              </span>
                            </TableCell>
                            <TableCell className="px-3 py-2.5 whitespace-nowrap">
                              <span className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-600">
                                {titleCase(t.status)}
                              </span>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
            <div>
              <div className="px-5 py-2.5 flex items-center gap-2 bg-blue-50/50">
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Completed</span>
                <span className="text-xs text-blue-600">{doneTasks.length}</span>
              </div>
              {doneTasks.length === 0 ? (
                <p className="px-5 py-6 text-sm text-gray-400 text-center">No completed tasks yet.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto">
                  <Table className="w-full">
                    <TableHeader className="sticky top-0 bg-white">
                      <TableRow className="border-b border-gray-200 bg-gray-100">
                        <TableHead className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-5 py-2 w-full">Task</TableHead>
                        <TableHead className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-2 whitespace-nowrap">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-gray-50">
                      {doneTasks.slice(0, 8).map((t: any) => (
                        <TableRow key={t.id} className="hover:bg-gray-50 transition-colors">
                          <TableCell className="px-5 py-2.5 w-full">
                            <Link href={`/tasks/${t.projectId}/${t.id}`} className="block min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                              <p className="text-xs text-gray-400 truncate">{t.project?.client?.name && `${t.project.client.name} · `}{t.project?.name}</p>
                            </Link>
                          </TableCell>
                          <TableCell className="px-3 py-2.5 whitespace-nowrap">
                            <span className="inline-block px-2 py-0.5 text-[10px] font-medium rounded-full bg-brand-100 text-brand-800">
                              {titleCase(t.status)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Projects by stage + my tasks by status */}
        {(stageChartData.length > 0 || taskStatusChartData.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {stageChartData.length > 0 && (
              <div className="lg:col-span-2">
                <BarChartCard title="Active Projects by Stage" data={stageChartData} />
              </div>
            )}
            {taskStatusChartData.length > 0 && (
              <DonutChartCard title="My Tasks by Status" data={taskStatusChartData} />
            )}
          </div>
        )}
        {stageBuckets.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">All Active Projects</h3>
            </div>
            <Table className="w-full min-w-180">
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Project</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Client</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Service</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Stage</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {stageBuckets.flatMap(([stageKey, projects]) =>
                  projects.map((project: any) => (
                    <TableRow key={project.id} className="hover:bg-gray-50 transition-colors">
                      <TableCell className="px-5 py-3.5">
                        <Link href={`/projects/${project.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-700 transition-colors">
                          {project.name}
                        </Link>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-500">{project.client?.name || '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-500 capitalize">{project.serviceTypeKey}</TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 capitalize">
                          {titleCase(stageKey)}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-600')}>
                          {project.status}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-400">{project.deliveryDate || '—'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
