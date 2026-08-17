'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Briefcase, FolderKanban, FileText, TrendingUp,
  Users, DollarSign, AlertTriangle, CheckCircle,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, formatCurrency, titleCase } from '@/lib/utils';

// ── Palette for service types & statuses ──────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  active:    'bg-brand-600',
  completed: 'bg-blue-500',
  on_hold:   'bg-amber-500',
  cancelled: 'bg-gray-300',
  paid:      'bg-brand-600',
  sent:      'bg-blue-500',
  overdue:   'bg-red-500',
  draft:     'bg-gray-300',
  void:      'bg-gray-200',
  churned:   'bg-red-400',
  paused:    'bg-amber-400',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Active', completed: 'Completed', on_hold: 'On Hold', cancelled: 'Cancelled',
  paid: 'Paid', sent: 'Sent', overdue: 'Overdue', draft: 'Draft', void: 'Void',
  churned: 'Churned', paused: 'Paused',
};

const SERVICE_COLOR: Record<string, string> = {
  seo: 'bg-violet-500', web: 'bg-blue-500', app: 'bg-indigo-500',
  social: 'bg-pink-500', branding: 'bg-amber-500', logo: 'bg-orange-500',
  gmb: 'bg-teal-500', gads: 'bg-red-500',
};

// ── Reusable components ───────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon: Icon, iconBg }: {
  label: string; value: string | number; sub?: string; icon: any; iconBg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', iconBg)}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function BarRow({ label, value, max, colorClass, sub }: {
  label: string; value: number; max: number; colorClass: string; sub?: string;
}) {
  const pct = max > 0 ? Math.max(4, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
        <span className="text-sm text-gray-700 capitalize">{titleCase(label)}</span>
        <div className="flex items-center gap-2">
          {sub && <span className="text-xs text-gray-400">{sub}</span>}
          <span className="text-sm font-semibold text-gray-900 tabular-nums w-8 text-right">{value}</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', colorClass)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['business-overview'],
    queryFn: () => api.get('/analytics/business-overview').then((r) => r.data),
  });

  const d = data || {};
  const clients = d.clients || { total: 0, byStatus: {} };
  const projects = d.projects || { total: 0, byStatus: {}, byService: {} };
  const invoices = d.invoices || { total: 0, byStatus: {} };
  const revenueTrend: any[] = d.revenueTrend || [];
  const topClients: any[] = d.topClients || [];
  const revByCur: Record<string, number> = d.revenueByCurrency || {};
  const outByCur: Record<string, number> = d.outstandingByCurrency || {};

  const totalRevenue = Object.values(revByCur).reduce((a, b) => a + b, 0);
  const totalOutstanding = Object.values(outByCur).reduce((a, b) => a + b, 0);

  const maxTrend = Math.max(...revenueTrend.map((m) => m.totalApprox), 1);
  const maxClientRev = Math.max(...topClients.map((c) => c.totalApprox), 1);
  const maxProjectService = Math.max(...Object.values(projects.byService as Record<string, number>), 1);
  const maxProjectStatus = Math.max(...Object.values(projects.byStatus as Record<string, number>), 1);

  const overdueCount = invoices.byStatus?.overdue || 0;
  const paidCount = invoices.byStatus?.paid || 0;
  const collectionRate = invoices.total > 0 ? Math.round((paidCount / invoices.total) * 100) : 0;

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
          <KpiCard
            label="Total Clients"
            value={clients.total}
            sub={`${clients.byStatus?.active || 0} active · ${clients.byStatus?.churned || 0} churned`}
            icon={Briefcase}
            iconBg="bg-blue-500"
          />
          <KpiCard
            label="Total Projects"
            value={projects.total}
            sub={`${projects.byStatus?.active || 0} active · ${projects.byStatus?.completed || 0} completed`}
            icon={FolderKanban}
            iconBg="bg-violet-500"
          />
          <KpiCard
            label="Collection Rate"
            value={`${collectionRate}%`}
            sub={`${paidCount} of ${invoices.total} invoices paid`}
            icon={CheckCircle}
            iconBg="bg-brand-600"
          />
          <KpiCard
            label="Overdue Invoices"
            value={overdueCount}
            sub={overdueCount > 0 ? `${formatCurrency(totalOutstanding, 'USD')} approx outstanding` : 'All clear'}
            icon={AlertTriangle}
            iconBg={overdueCount > 0 ? 'bg-red-500' : 'bg-gray-400'}
          />
        </div>

        {/* ── Revenue trend + top clients ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
          {/* Revenue trend — 6 months */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between shrink-0 gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Revenue Trend</h3>
              <span className="text-xs text-gray-400">Last 6 months · paid invoices</span>
            </div>

            {/* Chart — stretches to fill remaining card height */}
            <div className="flex-1 flex flex-col px-5 pt-5 pb-4 min-h-0">
              <div className="flex-1 relative flex items-end gap-3 min-h-0">
                {/* Grid lines */}
                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-6">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="w-full border-t border-gray-100" />
                  ))}
                </div>

                {/* Bars */}
                {revenueTrend.map((m, i) => {
                  const pct = maxTrend > 0 ? (m.totalApprox / maxTrend) : 0;
                  const currencies = Object.keys(m.byCurrency);
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1.5 group relative h-full justify-end">
                      {/* Invoice count label above bar */}
                      {m.count > 0 && (
                        <span className="text-[10px] font-semibold text-gray-400 mb-1">
                          {m.count}
                        </span>
                      )}
                      {/* Tooltip */}
                      {m.count > 0 && (
                        <div className="absolute bottom-7 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] rounded-lg px-2.5 py-1.5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                          <p className="font-semibold mb-0.5">{m.count} invoice{m.count !== 1 ? 's' : ''}</p>
                          {currencies.map((cur) => (
                            <p key={cur} className="text-white/80">{formatCurrency(m.byCurrency[cur], cur)}</p>
                          ))}
                        </div>
                      )}
                      <div
                        className={cn(
                          'w-full rounded-t-lg transition-all duration-700',
                          m.totalApprox > 0 ? 'bg-brand-600 hover:bg-brand-500' : 'bg-gray-100',
                        )}
                        style={{ height: m.totalApprox > 0 ? `${Math.max(pct * 100, 4)}%` : '4px' }}
                      />
                      <span className="text-[10px] text-gray-400 whitespace-nowrap h-6 flex items-center">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Currency totals — pinned to bottom */}
            {Object.keys(revByCur).length > 0 && (
              <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap gap-x-4 gap-y-1.5 shrink-0">
                {Object.entries(revByCur).map(([cur, amt]) => (
                  <div key={cur} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{cur}</span>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(amt, cur)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top 5 clients by revenue */}
          <SectionCard title="Top Clients by Revenue">
            {topClients.length === 0 ? (
              <p className="text-sm text-gray-400">No paid invoices yet.</p>
            ) : (
              <div className="space-y-4">
                {topClients.map((c, i) => (
                  <div key={i}>
                    <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold text-gray-400 w-4">{i + 1}</span>
                        <span className="text-sm text-gray-700 truncate">{c.name}</span>
                      </div>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-1">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(4, (c.totalApprox / maxClientRev) * 100)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {Object.entries(c.byCurrency as Record<string, number>).map(([cur, amt]) => (
                        <span key={cur} className="text-xs text-gray-500 tabular-nums">
                          <span className="font-semibold text-gray-400 text-[10px] uppercase mr-0.5">{cur}</span>
                          {formatCurrency(amt, cur)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── Projects + Clients breakdown ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

          {/* Projects by service type */}
          <SectionCard title="Projects by Service">
            <div className="space-y-3">
              {Object.entries(projects.byService as Record<string, number>)
                .sort(([, a], [, b]) => b - a)
                .map(([key, count]) => (
                  <BarRow
                    key={key}
                    label={key}
                    value={count}
                    max={maxProjectService}
                    colorClass={SERVICE_COLOR[key] || 'bg-gray-400'}
                  />
                ))}
            </div>
          </SectionCard>

          {/* Projects by status */}
          <SectionCard title="Projects by Status">
            <div className="space-y-3">
              {Object.entries(projects.byStatus as Record<string, number>)
                .sort(([, a], [, b]) => b - a)
                .map(([key, count]) => (
                  <BarRow
                    key={key}
                    label={STATUS_LABEL[key] || key}
                    value={count}
                    max={maxProjectStatus}
                    colorClass={STATUS_COLOR[key] || 'bg-gray-400'}
                  />
                ))}
            </div>
          </SectionCard>

          {/* Clients & Invoice breakdown */}
          <div className="space-y-5">
            <SectionCard title="Clients by Status">
              <div className="space-y-3">
                {Object.entries(clients.byStatus as Record<string, number>)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, count]) => (
                    <BarRow
                      key={key}
                      label={STATUS_LABEL[key] || key}
                      value={count}
                      max={clients.total}
                      colorClass={STATUS_COLOR[key] || 'bg-gray-400'}
                    />
                  ))}
              </div>
            </SectionCard>

            <SectionCard title="Invoices by Status">
              <div className="space-y-3">
                {Object.entries(invoices.byStatus as Record<string, number>)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, count]) => (
                    <BarRow
                      key={key}
                      label={STATUS_LABEL[key] || key}
                      value={count}
                      max={invoices.total}
                      colorClass={STATUS_COLOR[key] || 'bg-gray-400'}
                    />
                  ))}
              </div>
            </SectionCard>
          </div>
        </div>

      </div>
    </div>
  );
}
