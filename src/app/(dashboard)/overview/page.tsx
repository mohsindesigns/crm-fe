'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Gauge, FolderKanban, DollarSign, UserCog, TrendingUp, Server,
  AlertTriangle, AlertOctagon, Info, Clock, CheckCircle2, Users, Briefcase,
  ClipboardList, ClipboardCheck, Receipt, RefreshCw, Target, FileSignature,
  CalendarDays, Database, HardDrive, Timer, Plug, Activity, Layers,
  UserCheck, Wallet, Loader2, ArrowRight, KeyRound,
  CheckCircle, Rocket, Trophy, Hourglass, Banknote, MapPin, Link2,
  CalendarCheck, Award, PartyPopper, Inbox, GitBranch, Repeat, CreditCard,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { useAuthStore } from '@/store/auth';
import LineChartCard, { type LineChartDatum } from '@/components/charts/LineChartCard';
import BarChartCard from '@/components/charts/BarChartCard';
import { KpiPill } from '@/components/dashboard/StatCard';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  SectionCard, Empty, Money, StatusBar, BarRow, MiniStat, DetailRow, HealthDot, Pill, RowLink,
} from '@/components/overview/primitives';
import { cn, formatCurrency, formatDate, titleCase } from '@/lib/utils';
import type {
  Overview, SystemHealth, Headline, AttentionItem, Delivery, Finance, People, Growth, Seo, Done,
  MoneyMap, CountMap, ProjectRow, Aging, SlaItem, WorkloadRow, OverdueInvoice, RetainerDue,
  UpcomingLeave, BusiestProject, ReviewerLoad, Debtor, LateLeader, HolidayRow, AppraisalRow,
  Milestone, AttendanceDay, CompletedProject, PaidInvoice, StageEvent,
} from '@/types/overview';
import { CHART_CATEGORICAL, CHART_STATUS, CHART_INK } from '@/lib/chartTheme';

/**
 * The Overview page — the whole business on one screen, for whoever runs it.
 *
 * Every other screen in this app is a working surface for one job (a project, an
 * invoice, an employee). This one is the opposite: it answers "what is the state
 * of the company, and what needs me?" without opening anything. It is gated on
 * `admin.access` in lib/routePermissions.ts because that is the honest audience —
 * it deliberately shows org-wide money, every employee's attendance, and the
 * health of the servers, none of which is scoped to the viewer's own work.
 *
 * Six tabs, one payload. `/api/analytics/overview` returns all of the business
 * data in a single response (see crm-be OverviewService.js) so the tabs never
 * disagree with each other about what moment they are describing. Only the
 * System tab fetches separately, and only when opened — it pings the media
 * service and reads information_schema, which has no business delaying the
 * numbers the other five tabs show.
 */

// ─── Tabs ─────────────────────────────────────────────────────────────────────

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'command', label: 'Command Center', icon: Gauge },
  { key: 'delivery', label: 'Delivery', icon: FolderKanban },
  { key: 'finance', label: 'Finance', icon: DollarSign },
  { key: 'people', label: 'People', icon: UserCog },
  { key: 'growth', label: 'Growth', icon: TrendingUp },
  { key: 'done', label: 'Done', icon: CheckCircle },
  { key: 'system', label: 'System', icon: Server },
];

const VALID_TABS = TABS.map((t) => t.key);

// ─── Labels ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  active: 'Active', completed: 'Completed', on_hold: 'On Hold', blocked: 'Blocked',
  cancelled: 'Cancelled', paid: 'Paid', sent: 'Sent', overdue: 'Overdue',
  draft: 'Draft', void: 'Void', payment_review: 'Payment Review',
  churned: 'Churned', paused: 'Paused', requested: 'Requested', approved: 'Approved',
  rejected: 'Rejected', submitted: 'Submitted', invited: 'Invited',
  profile_pending: 'Profile Pending', under_review: 'Under Review',
  profile_amended: 'Amended', inactive: 'Inactive', todo: 'To Do',
  accepted: 'Accepted', in_progress: 'In Progress', in_review: 'In Review',
  done: 'Done', new: 'New', contacted: 'Contacted', qualified: 'Qualified',
  not_qualified: 'Not Qualified', converted: 'Converted', lost: 'Lost',
  pending_approval: 'Pending Approval', responded: 'Responded',
  open_for_review: 'Open for Review', locked: 'Locked', expired: 'Expired',
  viewed: 'Viewed', superseded: 'Superseded', pending: 'Pending',
  not_started: 'Not Started', half_day: 'Half Day', dofollow: 'Dofollow',
  nofollow: 'Nofollow', other: 'Other', manual: 'Manual', bank: 'Bank Transfer',
  stripe: 'Stripe', paddle: 'Paddle', payfast: 'PayFast', wise: 'Wise',
  payoneer: 'Payoneer', d0_1: 'Under a day', d1_3: '1–3 days',
  d3_7: '3–7 days', d7_14: '1–2 weeks', d14_plus: 'Over 2 weeks',
  top3: 'Top 3', top10: 'Top 10', top30: 'Top 30', beyond30: 'Beyond 30',
  unranked: 'Unranked', annual: 'Annual', sick: 'Sick', casual: 'Casual',
  unpaid: 'Unpaid',
};

// Task-age buckets are a severity ramp, not eight unrelated categories: the
// longer something has sat, the worse it is, so the colour has to say so.
const AGING_COLORS: Record<string, string> = {
  d0_1: CHART_STATUS.good,
  d1_3: '#7fb069',
  d3_7: CHART_STATUS.warning,
  d7_14: CHART_STATUS.serious,
  d14_plus: CHART_STATUS.critical,
};

// Same idea for search positions, best-to-worst.
const RANK_COLORS: Record<string, string> = {
  top3: CHART_STATUS.good,
  top10: '#7fb069',
  top30: CHART_STATUS.warning,
  beyond30: CHART_STATUS.serious,
  unranked: CHART_INK.muted,
};

// Fixed hues for the statuses that carry a judgement — "overdue" must never be
// whatever colour its position in the categorical order happens to hand it.
const STATUS_COLORS: Record<string, string> = {
  paid: CHART_STATUS.good,
  approved: CHART_STATUS.good,
  active: CHART_STATUS.good,
  done: CHART_STATUS.good,
  converted: CHART_STATUS.good,
  overdue: CHART_STATUS.critical,
  rejected: CHART_STATUS.critical,
  blocked: CHART_STATUS.critical,
  churned: CHART_STATUS.critical,
  lost: CHART_STATUS.critical,
  cancelled: CHART_INK.muted,
  void: CHART_INK.muted,
  inactive: CHART_INK.muted,
  on_hold: CHART_STATUS.warning,
  paused: CHART_STATUS.warning,
  requested: CHART_STATUS.warning,
  pending: CHART_STATUS.warning,
  under_review: CHART_STATUS.warning,
  payment_review: CHART_STATUS.warning,
};

const SEVERITY: Record<string, { icon: LucideIcon; dot: string; text: string; bg: string; label: string }> = {
  critical: { icon: AlertOctagon, dot: 'bg-red-500', text: 'text-red-700', bg: 'bg-red-50', label: 'Critical' },
  warning: { icon: AlertTriangle, dot: 'bg-amber-500', text: 'text-amber-700', bg: 'bg-amber-50', label: 'Needs action' },
  info: { icon: Info, dot: 'bg-blue-500', text: 'text-blue-700', bg: 'bg-blue-50', label: 'Coming up' },
};

const WAITING_LABELS: Record<string, string> = {
  project: 'Project', worker_review: 'New hire', leave: 'Leave',
  contractor_invoice: 'Contractor invoice', document: 'Quote/Agreement',
  document_request: 'HR document', payroll_concern: 'Payroll',
};

const ACTIVITY_TONE: Record<string, 'green' | 'blue' | 'red' | 'gray'> = {
  create: 'green', update: 'blue', delete: 'red', other: 'gray',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(value?: string | null): string {
  if (!value) return '—';
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatUptime(seconds?: number | null): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}

function formatEvery(ms?: number | null): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 60_000) return `every ${Math.round(n / 1000)}s`;
  if (n < 3_600_000) return `every ${Math.round(n / 60_000)}m`;
  return `every ${Math.round(n / 3_600_000)}h`;
}

const maxOf = (rows: { value: number }[]) => Math.max(1, ...rows.map((r) => r.value));

// titleCase() only splits on underscores, so a camelCase key ("activityLogs")
// comes back as "ActivityLogs". The record-inventory keys are camelCase, so
// split the humps first.
const humanKey = (key: string) => titleCase(key.replace(/([a-z0-9])([A-Z])/g, '$1 $2'));

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);

  const tabParam = searchParams.get('tab') || 'command';
  const tab = VALID_TABS.includes(tabParam) ? tabParam : 'command';

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/overview?${params.toString()}`, { scroll: false });
  };

  const { data, isLoading, isFetching, refetch } = useQuery<Overview>({
    queryKey: ['overview'],
    queryFn: () => api.get('/analytics/overview').then((r) => r.data),
    // A command centre that silently goes stale is worse than no command
    // centre; two minutes is well under how long anyone leaves this open.
    refetchInterval: 120_000,
  });

  const { data: system, isLoading: systemLoading, isFetching: systemFetching, refetch: refetchSystem } = useQuery<SystemHealth>({
    queryKey: ['overview-system'],
    queryFn: () => api.get('/analytics/overview/system').then((r) => r.data),
    enabled: tab === 'system',
    refetchInterval: tab === 'system' ? 30_000 : false,
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Overview" />
        <div className="flex-1 p-4 sm:p-6 space-y-4">
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
          {[...Array(2)].map((_, i) => <div key={i} className="h-56 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  // A failed fetch gets its own state rather than an empty payload: six tabs of
  // zeroes look exactly like a company with no work in it, which is the one
  // wrong answer this page must never give.
  if (!data) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Overview" />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-900">Couldn&apos;t load the overview.</p>
            <p className="text-xs text-gray-400 mt-1">
              The API didn&apos;t return a snapshot. Check that the backend is running, then try again.
            </p>
            <button
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-brand-700 rounded-lg hover:bg-brand-800 transition-colors"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const d: Overview = data;
  const critical = d.headline?.criticalCount || 0;

  return (
    <div className="flex flex-col h-full">
      <Header title="Overview" />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">

        {/* ── Greeting + freshness ── */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {/* Full name, not a first-name split: role-shaped account names
                  ("Super Admin", "Accounts Team") read as nonsense truncated. */}
              {user?.name ? `${user.name} — here's the whole company.` : "Here's the whole company."}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {critical > 0
                ? `${critical} item${critical === 1 ? '' : 's'} need attention right now.`
                : 'Nothing critical is outstanding.'}
            </p>
          </div>
          <button
            onClick={() => { refetch(); if (tab === 'system') refetchSystem(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', (isFetching || systemFetching) && 'animate-spin')} />
            {d.generatedAt ? `Updated ${timeAgo(d.generatedAt)}` : 'Refresh'}
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-full overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const badge = t.key === 'command' ? critical : 0;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1',
                  tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.label.split(' ')[0]}</span>
                {badge > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-red-500 text-white">{badge}</span>
                )}
              </button>
            );
          })}
        </div>

        {tab === 'command' && <CommandTab d={d} />}
        {tab === 'delivery' && <DeliveryTab delivery={d.delivery} seo={d.seo} />}
        {tab === 'finance' && <FinanceTab finance={d.finance} />}
        {tab === 'people' && <PeopleTab people={d.people} />}
        {tab === 'growth' && <GrowthTab growth={d.growth} />}
        {tab === 'done' && <DoneTab done={d.done} />}
        {tab === 'system' && <SystemTab system={system} loading={systemLoading} />}
      </div>
    </div>
  );
}

// ─── Command Center ───────────────────────────────────────────────────────────

function CommandTab({ d }: { d: Overview }) {
  const headline: Partial<Headline> = d.headline || {};
  const attention: AttentionItem[] = d.attention || [];
  const waiting = d.waitingOnMe || [];
  const activity = d.activity || [];
  const byType = d.approvals?.byType || {};

  return (
    <div className="space-y-5">

      {/* ── The eight numbers that describe the company ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MoneyKpi label="Revenue this month" map={headline.revenueThisMonth} icon={Wallet} color="brand" />
        <MoneyKpi label="Outstanding" map={headline.outstanding} icon={Receipt} color="amber" />
        <MoneyKpi label="Overdue" map={headline.overdueAmount} icon={AlertOctagon} color="red" />
        <KpiPill label="Pending approvals" value={headline.pendingApprovals ?? 0} icon={ClipboardCheck} color="violet" />
        <KpiPill label="Active clients" value={headline.activeClients ?? 0} icon={Briefcase} color="blue" />
        <KpiPill label="Active projects" value={headline.activeProjects ?? 0} icon={FolderKanban} color="indigo" />
        <KpiPill
          label={`Open tasks${headline.overdueTasks ? ` · ${headline.overdueTasks} overdue` : ''}`}
          value={headline.openTasks ?? 0}
          icon={ClipboardList}
          color={headline.overdueTasks ? 'red' : 'teal'}
        />
        <KpiPill
          label={`Headcount · ${headline.presentToday ?? 0} present`}
          value={headline.headcount ?? 0}
          icon={Users}
          color="cyan"
        />
      </div>

      {/* The counterweight row. Everything above is a queue — things owed. These
          four are things shipped, so the page doesn't read as pure debt. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiPill label="Tasks finished this week" value={d.done.tasks.thisWeek} icon={CheckCircle} color="green" />
        <KpiPill
          label="Avg turnaround"
          value={d.done.tasks.avgTurnaroundDays === null ? '—' : `${d.done.tasks.avgTurnaroundDays}d`}
          icon={Hourglass}
          color="teal"
        />
        <MoneyKpi label="Collected this month" map={d.finance.collectedThisMonth} icon={Banknote} color="brand" />
        <MoneyKpi label="Recurring / month" map={d.finance.packages.recurringMonthly} icon={Repeat} color="amber" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

        {/* ── The to-do list, ranked ── */}
        <SectionCard
          title="Needs attention"
          subtitle="Ranked by urgency across every module"
          icon={AlertTriangle}
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          {attention.length === 0 ? (
            <Empty message="Nothing needs a decision right now." icon={CheckCircle2} />
          ) : (
            <ul className="divide-y divide-gray-100">
              {attention.map((item, i) => {
                const sev = SEVERITY[item.severity] || SEVERITY.info;
                const Icon = sev.icon;
                return (
                  <li key={`${item.label}-${i}`}>
                    <Link href={item.href} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', sev.bg)}>
                        <Icon className={cn('w-4 h-4', sev.text)} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
                        <p className="text-xs text-gray-400 truncate">{item.detail}</p>
                      </div>
                      <span className={cn('text-lg font-bold tabular-nums shrink-0', sev.text)}>{item.count}</span>
                      <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <div className="space-y-5">
          {/* ── Approval queue by source ── */}
          <SectionCard title="Approval queue" subtitle="Pending, by type" icon={ClipboardCheck} href="/approvals">
            {(() => {
              const rows = Object.entries(byType)
                .map(([key, counts]) => ({ key, value: counts?.pending || 0 }))
                .filter((r) => r.value > 0)
                .sort((a, b) => b.value - a.value);
              if (!rows.length) return <Empty message="No approvals waiting." icon={CheckCircle2} />;
              return (
                <div className="space-y-3">
                  {rows.map((r) => (
                    <BarRow key={r.key} label={titleCase(r.key)} value={r.value} max={maxOf(rows)} href={`/approvals?type=${r.key}`} />
                  ))}
                </div>
              );
            })()}
          </SectionCard>

          {/* ── Personally assigned to the viewer ── */}
          <SectionCard title="Waiting on you" subtitle="Assigned to you personally" icon={Clock} bodyClassName="p-0">
            {waiting.length === 0 ? (
              <Empty message="Your queue is clear." icon={CheckCircle2} />
            ) : (
              <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {waiting.map((w) => (
                  <li key={`${w.type}-${w.id}`}>
                    <Link href={w.href} className="block px-5 py-2.5 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-2">
                        <Pill tone="gray">{WAITING_LABELS[w.type] || titleCase(w.type)}</Pill>
                        <span className="text-[11px] text-gray-400 ml-auto shrink-0">{timeAgo(w.createdAt)}</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900 truncate mt-1">{w.title}</p>
                      <p className="text-xs text-gray-400 truncate">{w.subtitle}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ── Audit trail ── */}
      <SectionCard
        title="Recent activity"
        subtitle="Every write across the system, newest first"
        icon={Activity}
        href="/activity-logs"
        bodyClassName="p-0"
      >
        {activity.length === 0 ? (
          <Empty message="No activity recorded yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead className="hidden sm:table-cell">Area</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-sm text-gray-900 whitespace-nowrap">{a.actorName || 'System'}</TableCell>
                  <TableCell className="text-sm text-gray-600">
                    <span className="flex items-center gap-2">
                      <Pill tone={ACTIVITY_TONE[a.action] || 'gray'}>{titleCase(a.action)}</Pill>
                      <span className="truncate">{a.description}</span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-gray-400">{titleCase(a.resource)}</TableCell>
                  <TableCell className="text-right text-xs text-gray-400 whitespace-nowrap">{timeAgo(a.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </div>
  );
}

/** A KpiPill whose value is a per-currency money map rather than one number. */
function MoneyKpi({ label, map, icon: Icon, color }: { label: string; map?: MoneyMap; icon: LucideIcon; color: string }) {
  const tints: Record<string, string> = {
    brand: 'bg-brand-600 from-brand-600/10',
    amber: 'bg-amber-600 from-amber-600/10',
    red: 'bg-red-600 from-red-600/10',
  };
  const [badge, wash] = (tints[color] || tints.brand).split(' ');
  return (
    <div className={cn('rounded-xl border border-gray-200 p-4 flex items-center gap-3 bg-gradient-to-br to-white', wash)}>
      <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', badge)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <Money map={map} size="md" />
        <p className="text-xs text-gray-500 truncate">{label}</p>
      </div>
    </div>
  );
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

function DeliveryTab({ delivery, seo }: { delivery: Delivery; seo: Seo }) {
  const { tasks, projects, sla } = delivery;
  const stages = delivery.byStage || [];
  const workload = delivery.workload || [];
  const onTime = delivery.onTimeDelivery;
  const hasDeliveryHistory = !!onTime && (onTime.onTime + onTime.late) > 0;

  const stageRows = stages.map((s) => ({ label: s.name, value: s.count }));

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <MiniStat label="Active" value={projects.byStatus?.active || 0} href="/projects" />
        <MiniStat label="Overdue" value={delivery.overdueProjectCount || 0} tone={delivery.overdueProjectCount ? 'bad' : 'neutral'} href="/projects" />
        <MiniStat label="Blocked" value={delivery.blocked || 0} tone={delivery.blocked ? 'bad' : 'neutral'} />
        <MiniStat label="On hold" value={delivery.onHold || 0} tone={delivery.onHold ? 'warn' : 'neutral'} />
        {/* A 0% on-time rate and "no project has ever had a deadline" are very
            different facts; only the first deserves a number and a warning hue. */}
        <MiniStat
          label="On-time"
          value={hasDeliveryHistory ? `${onTime!.pct}%` : '—'}
          tone={hasDeliveryHistory ? (onTime!.pct >= 80 ? 'good' : 'warn') : 'neutral'}
          sub={hasDeliveryHistory
            ? `${onTime!.onTime} on time · ${onTime!.late} late`
            : 'No delivered projects with a deadline yet'}
        />
        <MiniStat label="Open tasks" value={tasks.open || 0} href="/tasks?view=all" />
        <MiniStat label="Overdue tasks" value={tasks.overdue || 0} tone={tasks.overdue ? 'bad' : 'neutral'} href="/tasks?view=overdue" />
        <MiniStat label="Unassigned" value={tasks.unassigned || 0} tone={tasks.unassigned ? 'warn' : 'neutral'} href="/tasks?view=all" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat label="Due this week" value={tasks.dueThisWeek} />
        <MiniStat label="Finished this week" value={tasks.completedThisWeek} tone={tasks.completedThisWeek ? 'good' : 'neutral'} />
        <MiniStat label="Audits pending" value={tasks.auditPending} tone={tasks.auditPending ? 'warn' : 'neutral'} href="/approvals?type=task_audit" />
        <MiniStat label="SLA breached" value={sla.breached} tone={sla.breached ? 'bad' : 'neutral'} />
        <MiniStat label="Recurring rules" value={delivery.recurringRules} sub="auto-generating tasks" />
        <MiniStat label="Deliverable files" value={delivery.artifacts} sub="uploaded artifacts" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <SectionCard title="Active projects by stage" subtitle="Where work is sitting right now" icon={Layers} href="/projects">
          {stageRows.length === 0 ? (
            <Empty message="No active projects." icon={FolderKanban} />
          ) : (
            <div className="space-y-3">
              {stageRows.map((r, i) => (
                <BarRow key={r.label} label={r.label} value={r.value} max={maxOf(stageRows)} color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
              ))}
            </div>
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Project status" icon={FolderKanban}>
            <StatusBar map={projects.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No projects yet." />
          </SectionCard>
          <SectionCard
            title="Task pipeline"
            subtitle={`${tasks.completedThisWeek || 0} finished this week · ${tasks.dueThisWeek || 0} due next 7 days`}
            icon={ClipboardList}
            href="/tasks?view=all"
          >
            <StatusBar map={tasks.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No tasks yet." />
          </SectionCard>
        </div>
      </div>

      {/* ── Age, shape and concentration of the open pile ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
        <SectionCard title="How long work has waited" subtitle="Open tasks by age, not due date" icon={Hourglass}>
          <StatusBar
            map={tasks.aging as unknown as CountMap}
            labels={STATUS_LABELS}
            colors={AGING_COLORS}
            emptyMessage="Nothing open."
            ordered
          />
        </SectionCard>

        <SectionCard title="Task mix" subtitle="Every task by type" icon={ClipboardList}>
          <StatusBar map={tasks.byType} emptyMessage="No tasks yet." />
        </SectionCard>

        <SectionCard title="Busiest projects" subtitle="Most open tasks" icon={Inbox} bodyClassName="p-5">
          {delivery.busiestProjects.length === 0 ? (
            <Empty message="No open tasks on any project." />
          ) : (
            <div className="space-y-3">
              {delivery.busiestProjects.map((b: BusiestProject) => (
                <BarRow
                  key={b.id}
                  label={b.name}
                  value={b.openTasks}
                  max={maxOf(delivery.busiestProjects.map((x) => ({ value: x.openTasks })))}
                  href={`/projects/${b.id}`}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Waiting on a reviewer" subtitle="Submitted work, by reviewer" icon={UserCheck}>
          {delivery.reviewerLoad.length === 0 ? (
            <Empty message="Nothing is sitting with a reviewer." icon={CheckCircle2} />
          ) : (
            <div className="space-y-3">
              {delivery.reviewerLoad.map((r: ReviewerLoad) => (
                <BarRow
                  key={r.id}
                  label={r.name}
                  value={r.awaiting}
                  max={maxOf(delivery.reviewerLoad.map((x) => ({ value: x.awaiting })))}
                  color={CHART_STATUS.warning}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── The two lists that actually cost money ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <SectionCard
          title="Overdue projects"
          subtitle={`${delivery.overdueProjectCount || 0} past their delivery date`}
          icon={AlertOctagon}
          bodyClassName="p-0"
        >
          <ProjectList rows={delivery.overdueProjects || []} emptyMessage="Nothing is overdue." lateColumn />
        </SectionCard>

        <SectionCard
          title="Due this week"
          subtitle={`${delivery.dueSoonProjectCount || 0} land within 7 days`}
          icon={CalendarDays}
          bodyClassName="p-0"
        >
          <ProjectList rows={delivery.dueSoonProjects || []} emptyMessage="Nothing due in the next 7 days." />
        </SectionCard>
      </div>

      {/* ── SLA ── */}
      <SectionCard
        title="SLA watch"
        subtitle={`${sla.breached || 0} breached · ${sla.atRisk || 0} at risk`}
        icon={Timer}
        bodyClassName="p-0"
      >
        {!(sla.items || []).length ? (
          <Empty message="Every active project is inside its stage SLA." icon={CheckCircle2} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="hidden sm:table-cell">Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(sla.items || []).map((s: SlaItem) => {
                const hours = s.hoursRemaining;
                return (
                  <TableRow key={s.projectId || s.id}>
                    <TableCell className="text-sm font-medium text-gray-900">
                      <Link href={`/projects/${s.projectId || s.id}`} className="hover:text-brand-700">
                        {s.projectName || s.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-gray-500">{s.clientName || s.client?.name || '—'}</TableCell>
                    <TableCell className="text-sm text-gray-500">{titleCase(s.stageKey || s.currentStageKey)}</TableCell>
                    <TableCell className="text-right">
                      <Pill tone={s.slaStatus === 'breached' ? 'red' : 'amber'}>
                        {s.slaStatus === 'breached' ? 'Breached' : 'At risk'}
                        {typeof hours === 'number' && Number.isFinite(hours) && (
                          <span className="ml-1 font-normal">
                            {hours < 0 ? `${Math.abs(Math.round(hours))}h over` : `${Math.round(hours)}h left`}
                          </span>
                        )}
                      </Pill>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* ── Who is carrying what ── */}
      <SectionCard
        title="Team workload"
        subtitle="Open and overdue tasks per person, plus active project ownership"
        icon={Users}
        href="/team"
        bodyClassName="p-0"
      >
        {workload.length === 0 ? (
          <Empty message="No active team members." icon={Users} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="hidden sm:table-cell">Role</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right hidden sm:table-cell">Projects</TableHead>
                <TableHead className="w-40 hidden md:table-cell">Load</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workload.map((w) => {
                const busiest = Math.max(1, ...workload.map((x: WorkloadRow) => x.openTasks));
                return (
                  <TableRow key={w.id}>
                    <TableCell className="text-sm font-medium text-gray-900 whitespace-nowrap">{w.name}</TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-gray-500">{w.role}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-gray-900">{w.openTasks}</TableCell>
                    <TableCell className={cn('text-right text-sm tabular-nums font-semibold', w.overdueTasks ? 'text-red-600' : 'text-gray-300')}>
                      {w.overdueTasks || '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-gray-500 hidden sm:table-cell">{w.activeProjects}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round((w.openTasks / busiest) * 100)}%`,
                            backgroundColor: w.overdueTasks ? CHART_STATUS.critical : CHART_CATEGORICAL[0],
                          }}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      {/* ── SEO deliverables ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <SectionCard title="Keywords" subtitle={`${seo.keywords?.total || 0} tracked`} icon={KeyRound} href="/reports/keywords">
          <StatusBar map={seo.keywords?.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No keywords tracked." />
        </SectionCard>
        <SectionCard title="Content submissions" icon={FileSignature}>
          <StatusBar map={seo.contentSubmissions} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No submissions." />
        </SectionCard>
        <SectionCard title="Blog tasks" icon={FileSignature}>
          <StatusBar map={seo.blogTasks} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No blog tasks." />
        </SectionCard>
        <SectionCard title="Backlinks" subtitle={`${seo.backlinks.indexedPct}% indexed`} icon={Link2} href="/reports/backlinks">
          <p className="text-3xl font-bold text-gray-900 tabular-nums">{seo.backlinks.total}</p>
          <p className="text-xs text-gray-400 mt-1 mb-3">
            {seo.backlinks.indexed} indexed
            {seo.backlinks.avgDa !== null && ` · avg DA ${seo.backlinks.avgDa}`}
          </p>
          <StatusBar map={seo.backlinks.byType} labels={STATUS_LABELS} emptyMessage="None built." />
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <SectionCard
          title="Search positions"
          subtitle={`Latest reading for ${seo.keywords.ranked} tracked keyword${seo.keywords.ranked === 1 ? '' : 's'}`}
          icon={TrendingUp}
          href="/reports/keywords"
          className="lg:col-span-2"
        >
          <StatusBar
            map={seo.keywords.rankBuckets as unknown as CountMap}
            labels={STATUS_LABELS}
            colors={RANK_COLORS}
            emptyMessage="No ranking data in the last 90 days."
            ordered
          />
        </SectionCard>
        <SectionCard title="Content implementation" subtitle="Approved copy actually put live" icon={FileSignature}>
          <StatusBar map={seo.contentImplementation} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="Nothing submitted." />
        </SectionCard>
        <SectionCard title="GMB profiles" icon={MapPin}>
          <StatusBar map={seo.gmb} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No profiles tracked." />
        </SectionCard>
      </div>
    </div>
  );
}

function ProjectList({ rows, emptyMessage, lateColumn }: { rows: ProjectRow[]; emptyMessage: string; lateColumn?: boolean }) {
  if (!rows.length) return <Empty message={emptyMessage} icon={CheckCircle2} />;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Project</TableHead>
          <TableHead className="hidden sm:table-cell">Stage</TableHead>
          <TableHead className="text-right">{lateColumn ? 'Late by' : 'Due'}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.id}>
            <TableCell>
              <Link href={`/projects/${p.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-700">{p.name}</Link>
              <p className="text-xs text-gray-400">{p.client}</p>
            </TableCell>
            <TableCell className="hidden sm:table-cell text-sm text-gray-500">{titleCase(p.stage)}</TableCell>
            <TableCell className="text-right whitespace-nowrap">
              {lateColumn ? (
                <Pill tone="red">{p.daysLate} day{p.daysLate === 1 ? '' : 's'}</Pill>
              ) : (
                <span className="text-sm text-gray-600">{formatDate(p.deliveryDate, 'MMM d')}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Finance ──────────────────────────────────────────────────────────────────

const AGING_LABELS: { key: keyof Aging; label: string; tone: 'gray' | 'amber' | 'red' }[] = [
  { key: 'current', label: 'Not yet due', tone: 'gray' },
  { key: 'd1_30', label: '1–30 days late', tone: 'amber' },
  { key: 'd31_60', label: '31–60 days late', tone: 'amber' },
  { key: 'd61_90', label: '61–90 days late', tone: 'red' },
  { key: 'd90_plus', label: '90+ days late', tone: 'red' },
];

function FinanceTab({ finance }: { finance: Finance }) {
  const { invoices, retainers } = finance;
  const trend = finance.revenueTrend || [];
  const topClients = finance.topClients || [];

  const trendData = trend.map((m) => ({ label: m.label, value: m.totalApprox, count: m.count, byCurrency: m.byCurrency }));
  const topClientData = topClients.map((c) => ({ label: c.name, value: c.totalApprox }));

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MoneyCard label="Revenue this month" map={finance.revenue?.thisMonth} tone="good" />
        <MoneyCard label="Collected this month" map={finance.collectedThisMonth} tone="good" sub="Payments received" />
        <MoneyCard label="Revenue all time" map={finance.revenue?.allTime} />
        <MoneyCard label="Outstanding" map={finance.outstanding} tone="warn" sub="Still owed to you" />
        <MoneyCard label="Overdue" map={finance.overdueAmount} tone="bad" sub={`${finance.overdueInvoiceCount || 0} invoices`} />
        <MoneyCard
          label="Recurring per month"
          map={finance.packages.recurringMonthly}
          sub={`${finance.packages.active} active package${finance.packages.active === 1 ? '' : 's'}`}
        />
        <MiniStat label="Payments received" value={finance.payments.total} sub="all time" />
        <MiniStat label="Personal invoices" value={finance.personalInvoices.total} href="/personal-invoices" />
        <MiniStat label="Invoices raised" value={finance.invoices.total} href="/invoices" />
        <MiniStat label="Quotes & agreements" value={finance.documents.total} href="/documents" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Revenue trend"
            subtitle="Last 6 months · paid invoices"
            data={trendData}
            valueFormatter={(v) => formatCurrency(v, 'USD')}
            tooltipExtra={(datum: LineChartDatum) => {
              const count = (datum.count as number) || 0;
              if (!count) return [];
              const lines = [`${count} invoice${count === 1 ? '' : 's'}`];
              Object.entries((datum.byCurrency as Record<string, number>) || {}).forEach(([cur, amt]) => {
                lines.push(`${cur} ${formatCurrency(amt, cur)}`);
              });
              return lines;
            }}
          />
        </div>
        <BarChartCard
          title="Top clients by revenue"
          data={topClientData}
          categorical={false}
          emptyMessage="No paid invoices yet."
          valueFormatter={(v) => formatCurrency(v, 'USD')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── Receivables aging ── */}
        <SectionCard
          title="Receivables aging"
          subtitle="How overdue the outstanding balance actually is"
          icon={Receipt}
          href="/invoices"
        >
          <div className="space-y-2.5">
            {AGING_LABELS.map(({ key, label, tone }) => {
              const map = finance.aging?.[key] || {};
              const has = Object.values(map).some((v) => v > 0);
              return (
                <div key={key} className="flex items-center justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-gray-300',
                    )} />
                    <span className="text-sm text-gray-600 truncate">{label}</span>
                  </div>
                  {has ? <Money map={map} size="sm" className="items-end text-right" /> : <span className="text-sm text-gray-300">—</span>}
                </div>
              );
            })}
          </div>
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Invoices by status" subtitle={`${invoices.total || 0} total`} icon={Receipt} href="/invoices">
            <StatusBar map={invoices.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No invoices raised yet." />
          </SectionCard>
          <SectionCard
            title="Quotes & agreements"
            subtitle={`${finance.documents?.total || 0} issued`}
            icon={FileSignature}
            href="/documents"
          >
            <StatusBar map={finance.documents?.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No documents issued." />
          </SectionCard>
        </div>
      </div>

      {/* ── Who owes it, and how it arrives ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <SectionCard
          title="Biggest debtors"
          subtitle="By total still owed, across all their invoices"
          icon={Briefcase}
          href="/clients"
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          {finance.debtors.length === 0 ? (
            <Empty message="Nobody owes you anything." icon={CheckCircle2} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Invoices</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {finance.debtors.map((c: Debtor) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-medium text-gray-900">
                      <Link href={`/clients/${c.id}`} className="hover:text-brand-700">{c.name}</Link>
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-500 tabular-nums">{c.count}</TableCell>
                    <TableCell className="text-right">
                      <Money map={c.byCurrency} size="sm" className="items-end text-right" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard title="How clients pay" subtitle="Every payment, by provider" icon={CreditCard}>
          {Object.keys(finance.payments.byProvider).length === 0 ? (
            <Empty message="No payments recorded yet." />
          ) : (
            <div className="space-y-4">
              {Object.entries(finance.payments.byProvider)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([key, split], i) => (
                  <div key={key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm text-gray-700">{STATUS_LABELS[key] || titleCase(key)}</span>
                      <span className="text-xs text-gray-400">{split.count} payment{split.count === 1 ? '' : 's'}</span>
                    </div>
                    <Money map={split.byCurrency} size="sm" />
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.round((split.count / Math.max(1, finance.payments.total)) * 100)}%`,
                          backgroundColor: CHART_CATEGORICAL[i % CHART_CATEGORICAL.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              {Object.keys(finance.payments.feesByCurrency).length > 0 && (
                <div className="pt-3 border-t border-gray-100">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Processing fees paid</p>
                  <Money map={finance.payments.feesByCurrency} size="sm" />
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── Overdue invoices ── */}
        <SectionCard title="Most overdue invoices" icon={AlertOctagon} href="/invoices?status=overdue" bodyClassName="p-0">
          {!(finance.overdueInvoices || []).length ? (
            <Empty message="Nothing is overdue." icon={CheckCircle2} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead className="text-right">Late</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(finance.overdueInvoices || []).map((inv: OverdueInvoice) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-700">
                        {inv.number}
                      </Link>
                      <p className="text-xs text-gray-400 truncate">{inv.client}</p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(inv.due, inv.currency)}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Pill tone="red">{inv.daysLate}d</Pill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        {/* ── Retainers ── */}
        <SectionCard
          title="Retainers billing soon"
          subtitle="Auto-invoice within the next 7 days"
          icon={RefreshCw}
          href="/retainers"
          bodyClassName="p-0"
        >
          <div className="px-5 pt-4">
            <StatusBar map={retainers.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No retainers set up." />
          </div>
          {!(retainers.dueSoon || []).length ? (
            <div className="px-5 pb-5 pt-3">
              <p className="text-sm text-gray-400">Nothing bills in the next 7 days.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Bills on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(retainers.dueSoon || []).map((r: RetainerDue) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm font-medium text-gray-900">
                      {r.client}
                      <span className="ml-1.5 text-xs font-normal text-gray-400">{titleCase(r.cycle)}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-gray-900 whitespace-nowrap">
                      {formatCurrency(r.amount, r.currency)}
                    </TableCell>
                    <TableCell className="text-right text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(r.nextInvoiceDate, 'MMM d')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function MoneyCard({ label, map, tone = 'neutral', sub }: { label: string; map?: MoneyMap; tone?: 'neutral' | 'good' | 'warn' | 'bad'; sub?: string }) {
  const accent = { neutral: 'border-gray-200', good: 'border-green-200', warn: 'border-amber-200', bad: 'border-red-200' }[tone];
  return (
    <div className={cn('bg-white rounded-xl border p-4', accent)}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 leading-tight">{label}</p>
      <div className="mt-2"><Money map={map} size="md" /></div>
      {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ─── People ───────────────────────────────────────────────────────────────────

function PeopleTab({ people }: { people: People }) {
  const { headcount, attendanceToday: attendance, leave } = people;
  const payroll = people.payroll || [];
  const departments = headcount.byDepartment || [];

  // Marked = everyone who has an attendance row today, whatever it says.
  const marked = Math.max(0, (attendance.headcount || 0) - (attendance.unmarked || 0));
  const markedPct = attendance.headcount ? Math.round((marked / attendance.headcount) * 100) : 0;

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <MiniStat label="Headcount" value={headcount.active || 0} href="/hr" sub={`${headcount.total || 0} on record`} />
        <MiniStat label="Employees" value={headcount.byType?.employee || 0} />
        <MiniStat label="Contractors" value={headcount.byType?.contractor || 0} />
        {/* Green only when somebody actually is present — a green zero reads as
            "all good" on exactly the morning it isn't. */}
        <MiniStat
          label="Present today"
          value={attendance.present || 0}
          tone={attendance.present ? 'good' : 'neutral'}
          href="/self-service?tab=attendance"
        />
        <MiniStat label="Absent today" value={attendance.absent || 0} tone={attendance.absent ? 'bad' : 'neutral'} />
        <MiniStat label="On leave" value={attendance.leave || 0} tone={attendance.leave ? 'warn' : 'neutral'} />
        <MiniStat
          label="Unmarked"
          value={attendance.unmarked || 0}
          tone={attendance.unmarked ? 'warn' : 'good'}
          sub={`${markedPct}% marked`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <SectionCard title="Attendance today" subtitle="Across every active employee" icon={UserCheck} href="/self-service?tab=attendance">
          <StatusBar
            map={{
              present: attendance.present || 0,
              absent: attendance.absent || 0,
              leave: attendance.leave || 0,
              half_day: attendance.half_day || 0,
              holiday: attendance.holiday || 0,
              weekend: attendance.weekend || 0,
              unmarked: attendance.unmarked || 0,
            }}
            labels={{ ...STATUS_LABELS, unmarked: 'Not marked', leave: 'On Leave', holiday: 'Holiday', weekend: 'Weekend' }}
            colors={{
              present: CHART_STATUS.good,
              absent: CHART_STATUS.critical,
              leave: CHART_STATUS.warning,
              half_day: CHART_STATUS.serious,
              // Grey on purpose: "nobody has marked attendance yet" is an
              // absence of data, and colouring it like a state would make an
              // unmarked morning look like a fully-present one.
              unmarked: CHART_INK.muted,
              holiday: CHART_CATEGORICAL[6],
              weekend: CHART_INK.axis,
            }}
            emptyMessage="No employees on record."
          />
          {(attendance.late || 0) > 0 && (
            <p className="mt-3 text-xs text-amber-600 font-medium">
              {attendance.late} arrived late today.
            </p>
          )}
        </SectionCard>

        <SectionCard title="Headcount by department" icon={Users} href="/hr">
          {departments.length === 0 ? (
            <Empty message="No employees on record." icon={Users} />
          ) : (
            <div className="space-y-3">
              {departments.map((dep, i) => (
                <BarRow
                  key={dep.label}
                  label={dep.label}
                  value={dep.value}
                  max={maxOf(departments)}
                  color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]}
                />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Employee lifecycle" subtitle="Every worker record by status" icon={UserCog} href="/hr">
          <StatusBar map={headcount.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No employees on record." />
          {(people.probationEndingSoon || 0) > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              <span className="font-semibold text-gray-900">{people.probationEndingSoon}</span> probation period{people.probationEndingSoon === 1 ? '' : 's'} end within 30 days.
            </p>
          )}
        </SectionCard>
      </div>

      {/* ── Two weeks of attendance, and who is repeatedly late ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Attendance trend"
            subtitle="Staff marked present, last 14 days"
            data={people.attendanceTrend.map((day: AttendanceDay) => ({
              label: formatDate(day.date, 'MMM d'),
              value: day.present,
              absent: day.absent,
              leave: day.leave,
              late: day.late,
            }))}
            valueFormatter={(v) => `${v}`}
            // LineChartCard treats an all-zero series as "no data". Here the
            // rows exist and are all absences, so the generic message would be
            // a lie — say which of the two it actually is.
            emptyMessage="Nobody has been marked present in the last 14 days."
            tooltipExtra={(datum) => {
              const lines: string[] = [];
              if (datum.absent) lines.push(`${datum.absent} absent`);
              if (datum.leave) lines.push(`${datum.leave} on leave`);
              if (datum.late) lines.push(`${datum.late} late`);
              return lines;
            }}
          />
        </div>
        <SectionCard title="Repeatedly late" subtitle="Late arrivals in the last 14 days" icon={Clock}>
          {people.lateLeaders.length === 0 ? (
            <Empty message="Nobody has been late." icon={CheckCircle2} />
          ) : (
            <div className="space-y-3">
              {people.lateLeaders.map((l: LateLeader) => (
                <BarRow
                  key={l.id}
                  label={l.name}
                  value={l.count}
                  max={maxOf(people.lateLeaders.map((x) => ({ value: x.count })))}
                  suffix={`· ${l.minutes}m`}
                  color={CHART_STATUS.warning}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Cost, leave shape, and what is coming up ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
        <SectionCard title="Salary cost by department" subtitle="Monthly base, active staff" icon={Wallet}>
          {people.salaryByDepartment.length === 0 ? (
            <Empty message="No salaries on record." />
          ) : (
            <div className="space-y-3">
              {people.salaryByDepartment.map((dep) => (
                <div key={dep.label} className="flex items-start justify-between gap-3 py-1.5 border-b border-gray-100 last:border-0">
                  <span className="text-sm text-gray-600 truncate">{dep.label}</span>
                  <Money map={dep.byCurrency} size="sm" className="items-end text-right" />
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Leave by type" subtitle="Every request ever raised" icon={CalendarDays} href="/hr?tab=leaves">
          <StatusBar map={people.leaveByType} labels={STATUS_LABELS} emptyMessage="No leave requested yet." />
        </SectionCard>

        <SectionCard title="Upcoming holidays" subtitle="Next 60 days" icon={CalendarCheck} href="/policies/attendance">
          {people.upcomingHolidays.length === 0 ? (
            <Empty message="No holidays scheduled." />
          ) : (
            <ul className="space-y-2">
              {people.upcomingHolidays.map((h: HolidayRow) => (
                <li key={h.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-700 truncate">{h.name}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formatDate(h.date, 'MMM d')}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Work anniversaries" subtitle="Next 30 days" icon={PartyPopper}>
          {people.milestones.length === 0 ? (
            <Empty message="None coming up." />
          ) : (
            <ul className="space-y-2">
              {people.milestones.map((m: Milestone) => (
                <li key={m.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-700 truncate">{m.name}</span>
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {m.years}y · {formatDate(m.date, 'MMM d')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <SectionCard
          title="Upcoming approved leave"
          subtitle={`${leave.pending || 0} request${leave.pending === 1 ? '' : 's'} still awaiting a decision`}
          icon={CalendarDays}
          href="/hr?tab=leaves"
          bodyClassName="p-0"
        >
          {!(leave.upcoming || []).length ? (
            <Empty message="Nobody is scheduled off in the next 30 days." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="text-right">Dates</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(leave.upcoming || []).map((l: UpcomingLeave) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-sm font-medium text-gray-900 whitespace-nowrap">{l.name}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Pill tone="blue">{titleCase(l.type)}</Pill></TableCell>
                    <TableCell className="text-right text-sm text-gray-500 whitespace-nowrap">
                      {formatDate(l.fromDate, 'MMM d')}
                      {l.toDate !== l.fromDate && ` – ${formatDate(l.toDate, 'MMM d')}`}
                      <span className="ml-1.5 text-xs text-gray-400">{l.days}d</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Payroll runs" subtitle="Latest three periods" icon={Wallet} href="/hr/payroll" bodyClassName="p-0">
            {payroll.length === 0 ? (
              <Empty message="No payroll run yet." icon={Wallet} />
            ) : (
              <ul className="divide-y divide-gray-100">
                {payroll.map((r) => (
                  <li key={r.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{r.periodLabel}</p>
                      {r.paidAt && <p className="text-xs text-gray-400">Paid {formatDate(r.paidAt, 'MMM d, yyyy')}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <Pill tone={r.status === 'paid' ? 'green' : r.status === 'locked' ? 'blue' : 'amber'}>
                        {STATUS_LABELS[r.status] || titleCase(r.status)}
                      </Pill>
                      <RowLink href={`/hr/payroll/${r.id}`} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Recent appraisals" subtitle="Latest reviews and salary changes" icon={Award} bodyClassName="p-0">
            {people.appraisals.length === 0 ? (
              <Empty message="No appraisal recorded yet." icon={Award} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="hidden sm:table-cell text-right">Rating</TableHead>
                    <TableHead className="text-right">Salary</TableHead>
                    <TableHead className="text-right">Reviewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {people.appraisals.map((a: AppraisalRow) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm font-medium text-gray-900 whitespace-nowrap">{a.name}</TableCell>
                      <TableCell className="hidden sm:table-cell text-right text-sm text-gray-500">
                        {a.rating ?? <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                        {a.salaryBefore !== null && a.salaryAfter !== null ? (
                          <span className={a.salaryAfter > a.salaryBefore ? 'text-green-700 font-semibold' : 'text-gray-600'}>
                            {a.salaryBefore.toLocaleString()} → {a.salaryAfter.toLocaleString()}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="text-right text-xs text-gray-400 whitespace-nowrap">{formatDate(a.reviewDate, 'MMM d')}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <SectionCard title="Contractor invoices" icon={Receipt} href="/hr?tab=contractor-invoices">
              <StatusBar map={people.contractorInvoices} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="None submitted." />
            </SectionCard>
            <SectionCard title="HR documents" icon={FileSignature} href="/hr">
              <StatusBar map={people.hrDocuments} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="None requested." />
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Growth ───────────────────────────────────────────────────────────────────

function GrowthTab({ growth }: { growth: Growth }) {
  const { clients, leads } = growth;
  const sources = leads.bySource || [];
  const trend = leads.trend || [];

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MiniStat label="Total clients" value={clients.total || 0} href="/clients" />
        <MiniStat label="Active clients" value={clients.byStatus?.active || 0} tone="good" href="/clients" />
        <MiniStat label="New this month" value={clients.newThisMonth || 0} tone={clients.newThisMonth ? 'good' : 'neutral'} />
        <MiniStat label="Total leads" value={leads.total || 0} href="/leads" />
        <MiniStat label="New leads" value={leads.byStatus?.new || 0} tone={leads.byStatus?.new ? 'warn' : 'neutral'} href="/leads" />
        <MiniStat label="Conversion" value={`${leads.conversionRate || 0}%`} sub={`${leads.converted || 0} converted`} tone={leads.conversionRate >= 20 ? 'good' : 'neutral'} />
        <MiniStat
          label="Portal adoption"
          value={`${growth.portal.pct}%`}
          sub={`${growth.portal.enabled} of ${growth.portal.contacts} contacts`}
          tone={growth.portal.pct >= 60 ? 'good' : 'warn'}
        />
        <MiniStat
          label="Unassigned leads"
          value={leads.unassigned}
          tone={leads.unassigned ? 'warn' : 'neutral'}
          href="/leads"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Lead volume"
            subtitle="Last 6 months · all sources"
            data={trend.map((m) => ({ label: m.label, value: m.value, converted: m.converted }))}
            valueFormatter={(v) => `${v}`}
            tooltipExtra={(datum: LineChartDatum) => (datum.converted ? [`${datum.converted} converted`] : [])}
          />
        </div>
        <SectionCard title="Lead sources" subtitle="Where leads come from" icon={Target} href="/leads">
          {sources.length === 0 ? (
            <Empty message="No leads captured yet." icon={Target} />
          ) : (
            <div className="space-y-3">
              {sources.map((s, i) => (
                <BarRow
                  key={s.label}
                  label={titleCase(s.label)}
                  value={s.value}
                  max={maxOf(sources)}
                  color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SectionCard title="Leads by owner" subtitle="Who is working the pipeline" icon={UserCheck} href="/leads">
          {leads.byAssignee.length === 0 ? (
            <Empty
              message={leads.unassigned ? `All ${leads.unassigned} leads are unassigned.` : 'No leads captured yet.'}
              icon={UserCheck}
            />
          ) : (
            <div className="space-y-3">
              {leads.byAssignee.map((a, i) => (
                <BarRow key={a.id} label={a.name} value={a.value} max={maxOf(leads.byAssignee)} color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
              ))}
            </div>
          )}
        </SectionCard>
        <SectionCard title="Lead pipeline" subtitle={`${leads.total || 0} leads by status`} icon={Target} href="/leads">
          <StatusBar map={leads.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No leads captured yet." />
        </SectionCard>
        <SectionCard title="Clients by status" icon={Briefcase} href="/clients">
          <StatusBar map={clients.byStatus} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="No clients yet." />
        </SectionCard>
        <SectionCard title="Client requirement requests" subtitle="Requirement forms sent to clients" icon={ClipboardList}>
          <StatusBar map={growth.clientRequests} labels={STATUS_LABELS} colors={STATUS_COLORS} emptyMessage="None raised yet." />
        </SectionCard>
      </div>
    </div>
  );
}

// --- Done -----------------------------------------------------------------

function DoneTab({ done }: { done: Done }) {
  const { tasks, totals } = done;
  const finishers = done.topFinishers || [];
  const throughput = done.throughput || [];
  const typeRows = Object.entries(tasks.byType || {})
    .map(([label, value]) => ({ label: titleCase(label), value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <MiniStat label="Done this week" value={tasks.thisWeek} tone={tasks.thisWeek ? 'good' : 'neutral'} />
        <MiniStat label="Done this month" value={tasks.thisMonth} tone={tasks.thisMonth ? 'good' : 'neutral'} />
        <MiniStat label="Last 8 weeks" value={tasks.window} sub="tasks finished" />
        <MiniStat
          label="Avg turnaround"
          value={tasks.avgTurnaroundDays === null ? '—' : `${tasks.avgTurnaroundDays}d`}
          sub="raised to finished"
        />
        <MiniStat label="Content approved" value={totals.contentApproved} />
        <MiniStat label="Blogs approved" value={totals.blogsApproved} />
        <MiniStat label="Docs signed" value={totals.documentsSigned} />
        <MiniStat label="Leave approved" value={totals.leavesApproved30d} sub="last 30 days" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
        <div className="lg:col-span-2">
          <LineChartCard
            title="Throughput"
            subtitle="Tasks finished per week · last 8 weeks"
            data={throughput}
            valueFormatter={(v) => `${v}`}
          />
        </div>
        <SectionCard
          title="Who finished it"
          subtitle="Tasks closed in the last 30 days"
          icon={Trophy}
        >
          {finishers.length === 0 ? (
            <Empty message="Nothing closed in the last 30 days." icon={Trophy} />
          ) : (
            <div className="space-y-3">
              {finishers.map((f, i) => (
                <BarRow
                  key={f.id}
                  label={f.name}
                  value={f.value}
                  max={maxOf(finishers)}
                  color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
        <SectionCard title="What kind of work" subtitle="Finished in the last 30 days" icon={ClipboardList}>
          {typeRows.length === 0 ? (
            <Empty message="Nothing finished recently." />
          ) : (
            <div className="space-y-3">
              {typeRows.map((r, i) => (
                <BarRow key={r.label} label={r.label} value={r.value} max={maxOf(typeRows)} color={CHART_CATEGORICAL[i % CHART_CATEGORICAL.length]} />
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Delivered projects"
          subtitle={`${done.completedProjects.length} most recent`}
          icon={Rocket}
          href="/projects"
          className="lg:col-span-2"
          bodyClassName="p-0"
        >
          {done.completedProjects.length === 0 ? (
            <Empty message="No project has been completed yet." icon={Rocket} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="hidden sm:table-cell">Service</TableHead>
                  <TableHead className="text-right">Took</TableHead>
                  <TableHead className="text-right">Finished</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {done.completedProjects.map((p: CompletedProject) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link href={`/projects/${p.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-700">{p.name}</Link>
                      <p className="text-xs text-gray-400">{p.client}</p>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-gray-500">{titleCase(p.service || '')}</TableCell>
                    <TableCell className="text-right text-sm text-gray-600 tabular-nums whitespace-nowrap">
                      {p.durationDays === null ? <span className="text-gray-300">—</span> : `${p.durationDays}d`}
                    </TableCell>
                    <TableCell className="text-right text-xs text-gray-400 whitespace-nowrap">{timeAgo(p.finishedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <SectionCard
          title="Money collected"
          subtitle="Most recently paid invoices"
          icon={Banknote}
          href="/invoices"
          bodyClassName="p-0"
        >
          <div className="px-5 pt-4 pb-1">
            <Money map={done.revenueCollected} size="md" />
            <p className="text-xs text-gray-400 mt-0.5">Across the invoices listed below</p>
          </div>
          {done.paidInvoices.length === 0 ? (
            <div className="px-5 pb-5"><p className="text-sm text-gray-400">No invoice has been paid yet.</p></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {done.paidInvoices.map((inv: PaidInvoice) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <Link href={`/invoices/${inv.id}`} className="text-sm font-medium text-gray-900 hover:text-brand-700">{inv.number}</Link>
                      <p className="text-xs text-gray-400 truncate">{inv.client}</p>
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatCurrency(inv.total, inv.currency)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-gray-400 whitespace-nowrap">{timeAgo(inv.paidAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Workflow movements"
          subtitle="Every stage transition the engine performed, newest first"
          icon={GitBranch}
          bodyClassName="p-0"
        >
          {done.stageEvents.length === 0 ? (
            <Empty message="No stage has moved yet." icon={GitBranch} />
          ) : (
            <ul className="divide-y divide-gray-100">
              {done.stageEvents.map((e: StageEvent) => (
                <li key={e.id} className="px-5 py-2.5">
                  <div className="flex items-center gap-2">
                    <Pill tone={e.action === 'approve' ? 'green' : e.action === 'reject' ? 'red' : 'blue'}>
                      {titleCase(e.action)}
                    </Pill>
                    <Link href={`/projects/${e.projectId}`} className="text-sm font-medium text-gray-900 hover:text-brand-700 truncate">
                      {e.project}
                    </Link>
                    <span className="text-[11px] text-gray-400 ml-auto shrink-0">{timeAgo(e.at)}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {e.from ? `${titleCase(e.from)} → ` : ''}{titleCase(e.to)} · {e.actor}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ─── System ───────────────────────────────────────────────────────────────────

function SystemTab({ system, loading }: { system?: SystemHealth; loading: boolean }) {
  if (loading || !system) {
    return (
      <div className="py-16 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Checking services…
      </div>
    );
  }

  const api = system.api;
  const database = system.database;
  const media = system.media;
  const schedulers = system.schedulers || [];
  const integrations = system.integrations || [];
  const tables = system.storage?.tables || [];
  const records = system.records || {};

  const maxBytes = Math.max(1, ...tables.map((t) => t.bytes));

  return (
    <div className="space-y-5">

      {/* ── The three moving parts ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <SectionCard title="API server" icon={Server} action={<HealthDot ok={!!api.ok} />}>
          <div className="space-y-0">
            <DetailRow label="Environment" value={api.env} />
            <DetailRow label="Uptime" value={formatUptime(api.uptimeSeconds)} />
            <DetailRow label="Node" value={api.nodeVersion} mono />
            <DetailRow label="Host" value={api.host} mono />
            <DetailRow label="Platform" value={api.platform} />
            <DetailRow label="CPU cores" value={api.cpus} />
            <DetailRow label="Heap used" value={`${api.memory?.heapUsed || '—'} of ${api.memory?.heapTotal || '—'}`} />
            <DetailRow label="Process memory" value={api.memory?.rss} />
            <DetailRow label="System memory" value={`${api.memory?.systemFree || '—'} free of ${api.memory?.systemTotal || '—'}`} />
          </div>
        </SectionCard>

        <SectionCard
          title="Database"
          icon={Database}
          action={<HealthDot ok={!!database.ok} label={database.ok ? `${database.latencyMs}ms` : 'Down'} />}
        >
          <div className="space-y-0">
            <DetailRow label="Engine" value={`${titleCase(database.dialect)} ${database.version || ''}`.trim()} />
            <DetailRow label="Schema" value={database.name} mono />
            <DetailRow label="Host" value={database.host} mono />
            <DetailRow label="Ping" value={database.ok ? `${database.latencyMs} ms` : null} />
            <DetailRow label="Pool size" value={database.pool?.size} />
            <DetailRow label="In use" value={database.pool?.using} />
            <DetailRow label="Available" value={database.pool?.available} />
            <DetailRow label="Waiting" value={database.pool?.waiting} />
            <DetailRow label="Total size" value={system.storage?.totalSize} />
          </div>
          {database.error && <p className="mt-3 text-xs text-red-600">{database.error}</p>}
        </SectionCard>

        <SectionCard
          title="Media service"
          icon={HardDrive}
          action={<HealthDot ok={!!media.ok} label={media.ok ? `${media.latencyMs}ms` : 'Unreachable'} />}
        >
          <div className="space-y-0">
            <DetailRow label="URL" value={media.url} mono />
            <DetailRow label="Status code" value={media.status} />
            <DetailRow label="Round trip" value={media.latencyMs !== null ? `${media.latencyMs} ms` : null} />
          </div>
          {media.error && (
            <p className="mt-3 text-xs text-red-600">
              {media.error}
              <span className="block text-gray-400 mt-1">
                Uploads and file serving will fail until this responds. Check the crm-media process and MEDIA_URL.
              </span>
            </p>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            Checked live on every load of this tab, not cached.
          </p>
        </SectionCard>
      </div>

      {/* ── Background jobs ── */}
      <SectionCard
        title="Background schedulers"
        subtitle="Recurring jobs started by this API process"
        icon={Timer}
        bodyClassName="p-0"
      >
        {schedulers.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Timer className="w-7 h-7 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400">No schedulers registered on this process.</p>
            <p className="text-xs text-gray-400 mt-1">
              Expected if the API was started without <code className="font-mono">server.js</code> — schedulers only run there.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead className="hidden sm:table-cell">Runs</TableHead>
                <TableHead className="hidden md:table-cell">Started</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedulers.map((s) => (
                <TableRow key={s.key}>
                  <TableCell className="text-sm font-medium text-gray-900">{s.label}</TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-gray-500">{formatEvery(s.everyMs)}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-gray-400">{timeAgo(s.startedAt)}</TableCell>
                  <TableCell className="text-right">
                    {s.ok ? <Pill tone="green">Running</Pill> : <Pill tone="red">{s.error || 'Failed'}</Pill>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* ── Integrations ── */}
        <SectionCard
          title="Integrations"
          subtitle="Whether each external service is configured on this deployment"
          icon={Plug}
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-gray-100">
            {integrations.map((i) => (
              <li key={i.key} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{i.label}</p>
                  <p className="text-xs text-gray-400 font-mono truncate">{i.detail || 'Not set'}</p>
                </div>
                <Pill tone={i.configured ? 'green' : 'gray'}>{i.configured ? 'Configured' : 'Not configured'}</Pill>
              </li>
            ))}
          </ul>
          <p className="px-5 py-3 text-[11px] text-gray-400 border-t border-gray-100">
            Only whether a value is present — no credential is ever sent to the browser.
          </p>
        </SectionCard>

        {/* ── Largest tables ── */}
        <SectionCard
          title="Largest tables"
          subtitle={`${system.storage?.totalSize || '—'} total on disk`}
          icon={Database}
          bodyClassName="p-0"
        >
          {tables.length === 0 ? (
            <Empty message="Table sizes unavailable." />
          ) : (
            // Scrolls rather than stretching: fifteen rows would leave the
            // Integrations panel beside it as a tall column of nothing.
            <ul className="divide-y divide-gray-100 max-h-[19rem] overflow-y-auto">
              {tables.map((t) => (
                <li key={t.name} className="px-5 py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-mono text-gray-700 truncate">{t.name}</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">{t.size}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="h-1 bg-gray-100 rounded-full overflow-hidden flex-1">
                      <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((t.bytes / maxBytes) * 100)}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 tabular-nums shrink-0">~{t.rowEstimate.toLocaleString()} rows</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="px-5 py-3 text-[11px] text-gray-400 border-t border-gray-100">
            Row counts are the storage engine&apos;s estimate; the inventory below is exact.
          </p>
        </SectionCard>
      </div>

      {/* ── Exact record inventory ── */}
      <SectionCard
        title="Record inventory"
        subtitle="Exact row counts for this organisation"
        icon={Layers}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {Object.entries(records).map(([key, value]) => (
            <MiniStat
              key={key}
              label={humanKey(key)}
              value={value === null ? <span className="text-gray-300">—</span> : value.toLocaleString()}
            />
          ))}
        </div>
      </SectionCard>

      <p className="text-xs text-gray-400 text-center">
        Health checked {timeAgo(system.checkedAt)} · refreshes every 30 seconds while this tab is open.
      </p>
    </div>
  );
}
