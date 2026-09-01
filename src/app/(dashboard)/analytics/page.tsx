'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, FolderKanban, AlertTriangle, CheckCircle, Clock,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { formatCurrency, titleCase } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import BarChartCard from '@/components/charts/BarChartCard';
import LineChartCard from '@/components/charts/LineChartCard';
import StatCard from '@/components/dashboard/StatCard';

// ── Status labels ──────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', completed: 'Completed', on_hold: 'On Hold', cancelled: 'Cancelled',
  paid: 'Paid', sent: 'Sent', overdue: 'Overdue', draft: 'Draft', void: 'Void',
  churned: 'Churned', paused: 'Paused',
};

// ── Reusable components ───────────────────────────────────────────────────────

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewAdminAnalytics = hasPermission('admin.access');

  const { data, isLoading } = useQuery({
    queryKey: ['business-overview'],
    queryFn: () => api.get('/analytics/business-overview').then((r) => r.data),
  });

  const { data: cycleTimeData } = useQuery({
    queryKey: ['analytics-cycle-time'],
    queryFn: () => api.get('/analytics/cycle-time').then((r) => r.data),
    enabled: canViewAdminAnalytics,
  });

  const { data: onTimeData } = useQuery({
    queryKey: ['analytics-on-time-delivery'],
    queryFn: () => api.get('/analytics/on-time-delivery').then((r) => r.data),
    enabled: canViewAdminAnalytics,
  });

  const { data: teamUtilizationData } = useQuery({
    queryKey: ['analytics-team-utilization'],
    queryFn: () => api.get('/analytics/team-utilization').then((r) => r.data),
    enabled: canViewAdminAnalytics,
  });

  const d = data || {};
  const clients = d.clients || { total: 0, byStatus: {} };
  const projects = d.projects || { total: 0, byStatus: {}, byService: {} };
  const invoices = d.invoices || { total: 0, byStatus: {} };
  const revenueTrend: any[] = d.revenueTrend || [];
  const topClients: any[] = d.topClients || [];
  const revByCur: Record<string, number> = d.revenueByCurrency || {};
  const outByCur: Record<string, number> = d.outstandingByCurrency || {};

  const totalOutstanding = Object.values(outByCur).reduce((a, b) => a + b, 0);

  const overdueCount = invoices.byStatus?.overdue || 0;
  const paidCount = invoices.byStatus?.paid || 0;
  const collectionRate = invoices.total > 0 ? Math.round((paidCount / invoices.total) * 100) : 0;

  // ── Chart data mappings ──
  const revenueTrendChartData = revenueTrend.map((m) => ({
    label: m.label,
    value: m.totalApprox,
    count: m.count,
    byCurrency: m.byCurrency,
  }));

  const topClientsChartData = topClients.map((c) => ({ label: c.name, value: c.totalApprox }));

  const projectsByServiceData = Object.entries(projects.byService as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({ label: titleCase(key), value }));

  const projectsByStatusData = Object.entries(projects.byStatus as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({ label: STATUS_LABEL[key] || titleCase(key), value }));

  const clientsByStatusData = Object.entries(clients.byStatus as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({ label: STATUS_LABEL[key] || titleCase(key), value }));

  const invoicesByStatusData = Object.entries(invoices.byStatus as Record<string, number>)
    .sort(([, a], [, b]) => b - a)
    .map(([key, value]) => ({ label: STATUS_LABEL[key] || titleCase(key), value }));

  // ── Admin-only analytics chart data mappings ──
  const cycleTimeChartData = (cycleTimeData || [])
    .slice()
    .sort((a: any, b: any) => b.avgHours - a.avgHours)
    .map((s: any) => ({ label: titleCase(s.stageKey), value: Math.round((s.avgHours / 24) * 10) / 10 }));

  const teamUtilizationChartData = (teamUtilizationData || [])
    .map((t: any) => ({ label: t.user.name, value: t.activeCount }));

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Analytics" />
        <div className="flex-1 p-4 sm:p-6 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Analytics" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Clients"
            value={clients.total}
            sub={`${clients.byStatus?.active || 0} active · ${clients.byStatus?.churned || 0} churned`}
            icon={Briefcase}
            color="blue"
          />
          <StatCard
            label="Total Projects"
            value={projects.total}
            sub={`${projects.byStatus?.active || 0} active · ${projects.byStatus?.completed || 0} completed`}
            icon={FolderKanban}
            color="violet"
          />
          <StatCard
            label="Collection Rate"
            value={`${collectionRate}%`}
            sub={`${paidCount} of ${invoices.total} invoices paid`}
            icon={CheckCircle}
            color="brand"
          />
          <StatCard
            label="Overdue Invoices"
            value={overdueCount}
            sub={overdueCount > 0 ? `${formatCurrency(totalOutstanding, 'USD')} approx outstanding` : 'All clear'}
            icon={AlertTriangle}
            color={overdueCount > 0 ? 'red' : 'gray'}
          />
        </div>

        {/* ── Revenue trend + top clients ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
          {/* Revenue trend — 6 months */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <LineChartCard
              title="Revenue Trend"
              subtitle="Last 6 months · paid invoices"
              data={revenueTrendChartData}
              valueFormatter={(v) => formatCurrency(v, 'USD')}
              tooltipExtra={(datum) => {
                const count = (datum.count as number) || 0;
                const byCurrency = (datum.byCurrency as Record<string, number>) || {};
                if (!count) return [];
                const lines = [`${count} invoice${count !== 1 ? 's' : ''}`];
                Object.entries(byCurrency).forEach(([cur, amt]) => {
                  lines.push(`${cur} ${formatCurrency(amt, cur)}`);
                });
                return lines;
              }}
            />

            {/* Currency totals — pinned below the chart */}
            {Object.keys(revByCur).length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex flex-wrap gap-x-4 gap-y-1.5">
                {Object.entries(revByCur).map(([cur, amt]) => (
                  <div key={cur} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{cur}</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(amt, cur)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top clients by revenue */}
          <BarChartCard
            title="Top Clients by Revenue"
            data={topClientsChartData}
            categorical={false}
            emptyMessage="No paid invoices yet."
            valueFormatter={(v) => formatCurrency(v, 'USD')}
          />
        </div>

        {/* ── Projects + Clients breakdown ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

          {/* Projects by service type */}
          <BarChartCard title="Projects by Service" data={projectsByServiceData} categorical />

          {/* Projects by status */}
          <BarChartCard title="Projects by Status" data={projectsByStatusData} categorical />

          {/* Clients & Invoice breakdown */}
          <div className="space-y-5">
            <BarChartCard title="Clients by Status" data={clientsByStatusData} categorical />
            <BarChartCard title="Invoices by Status" data={invoicesByStatusData} categorical />
          </div>
        </div>

        {/* ── Advanced analytics (admin only) ── */}
        {canViewAdminAnalytics && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {onTimeData && (
              <StatCard
                label="On-Time Delivery"
                value={`${onTimeData.pct}%`}
                sub={`${onTimeData.onTime} on time · ${onTimeData.late} late${onTimeData.noDeadline ? ` · ${onTimeData.noDeadline} no deadline` : ''}`}
                icon={Clock}
                color={onTimeData.pct >= 80 ? 'brand' : 'amber'}
              />
            )}
            <BarChartCard
              title="Avg Cycle Time by Stage"
              data={cycleTimeChartData}
              categorical={false}
              emptyMessage="Not enough stage transitions yet."
              valueFormatter={(v) => `${v}d`}
            />
            <BarChartCard
              title="Team Utilization"
              data={teamUtilizationChartData}
              categorical={false}
              emptyMessage="No active assignments yet."
              valueFormatter={(v) => `${v} active`}
            />
          </div>
        )}

      </div>
    </div>
  );
}
