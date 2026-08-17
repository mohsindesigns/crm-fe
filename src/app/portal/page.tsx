'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, Clock, CheckCircle2, AlertCircle,
  TrendingUp, FileText, FolderOpen, ChevronRight,
} from 'lucide-react';
import { usePortalStore } from '@/store/portal';
import { cn, formatDate, formatCurrency } from '@/lib/utils';

const INV_STATUS: Record<string, { label: string; cls: string }> = {
  draft:   { label: 'Draft',   cls: 'bg-gray-100 text-gray-500' },
  sent:    { label: 'Sent',    cls: 'bg-blue-50 text-blue-700 border border-blue-100' },
  paid:    { label: 'Paid',    cls: 'bg-brand-50 text-brand-800 border border-brand-100' },
  overdue: { label: 'Overdue', cls: 'bg-red-50 text-red-600 border border-red-100' },
  void:    { label: 'Void',    cls: 'bg-gray-100 text-gray-400' },
};

function portalFetch(path: string, token: string) {
  return fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => { if (!r.ok) throw new Error('Portal fetch failed'); return r.json(); });
}

export default function PortalHomePage() {
  const router = useRouter();
  const { contact, client, token } = usePortalStore();

  const { data: projects } = useQuery({
    queryKey: ['portal-projects'],
    queryFn: () => portalFetch('/portal/projects', token!),
    enabled: !!token,
  });

  const { data: invoices } = useQuery({
    queryKey: ['portal-invoices'],
    queryFn: () => portalFetch('/portal/invoices', token!),
    enabled: !!token,
  });

  const projArr: any[] = projects || [];
  const invArr: any[] = invoices || [];

  const pendingApproval = projArr.filter((p: any) => {
    const stages: any[] = p.template?.stages || [];
    const idx = stages.findIndex((s: any) => s.key === p.currentStageKey);
    const stage = stages[idx];
    return stage?.stageType === 'approval' && stage?.ownerRoleSlot?.toLowerCase().includes('client');
  });
  const unpaidInvoices = invArr.filter((inv: any) => inv.status === 'sent' || inv.status === 'overdue');
  const outstanding = unpaidInvoices.reduce((s: number, i: any) => s + parseFloat(i.total || 0), 0);

  const firstName = contact?.name?.split(' ')[0] || 'there';

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">Welcome back</p>
          <h1 className="text-2xl font-semibold text-gray-900">{firstName}</h1>
          <p className="text-sm text-gray-400 mt-1">{client?.name}</p>
        </div>
        {/* Quick stats strip */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900" style={{ fontVariantNumeric: 'tabular-nums' }}>{projArr.length}</p>
            <p className="text-xs text-gray-400 uppercase tracking-wide">Project{projArr.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="w-px h-10 bg-gray-200" />
          {pendingApproval.length > 0 ? (
            <div className="text-right">
              <p className="text-2xl font-bold text-amber-500" style={{ fontVariantNumeric: 'tabular-nums' }}>{pendingApproval.length}</p>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Pending</p>
            </div>
          ) : (
            <div className="text-right">
              <p className="text-2xl font-bold text-brand-700" style={{ fontVariantNumeric: 'tabular-nums' }}>—</p>
              <p className="text-xs text-gray-400 uppercase tracking-wide">Pending</p>
            </div>
          )}
          {outstanding > 0 && (
            <>
              <div className="w-px h-10 bg-gray-200" />
              <div className="text-right">
                <p className="text-2xl font-bold text-red-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(outstanding, client?.currency || 'USD')}
                </p>
                <p className="text-xs text-gray-400 uppercase tracking-wide">Outstanding</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Pending approval banner ── */}
      {pendingApproval.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-900 text-sm">Your approval is needed</p>
              <p className="text-amber-700 text-xs mt-0.5">
                {pendingApproval.length === 1
                  ? `"${pendingApproval[0].name}" is ready for your review`
                  : `${pendingApproval.length} projects are waiting for your review`}
              </p>
            </div>
            <button
              onClick={() => router.push(`/portal/projects/${pendingApproval[0].id}`)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98]"
              style={{ background: '#F59E0B' }}
            >
              Review now
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Projects ── */}
      <section>
        <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Your Projects</h2>
          {projArr.length > 0 && (
            <span className="text-xs text-gray-400">{projArr.filter((p: any) => p.status === 'active').length} active</span>
          )}
        </div>

        {projArr.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-8 py-12 text-center">
            <FolderOpen className="w-8 h-8 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-400">No projects yet</p>
            <p className="text-xs text-gray-300 mt-1">Your active projects will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {projArr.map((p: any) => {
              const stages: any[] = p.template?.stages || [];
              const currentIdx = stages.findIndex((s: any) => s.key === p.currentStageKey);
              const progress = stages.length > 0 ? Math.round(((currentIdx + 1) / stages.length) * 100) : 0;
              const currentStage = stages[currentIdx];
              const isApproval = currentStage?.stageType === 'approval' && currentStage?.ownerRoleSlot?.toLowerCase().includes('client');
              const isComplete = p.status === 'completed';

              return (
                <div
                  key={p.id}
                  onClick={() => router.push(`/portal/projects/${p.id}`)}
                  className="bg-white rounded-xl border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer group"
                >
                  <div className="px-6 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: '#F1F5F9' }}>
                          <TrendingUp className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base font-semibold text-gray-900 leading-tight truncate">{p.name}</h3>
                          <p className="text-sm text-gray-400 mt-0.5">{p.template?.name || p.serviceTypeKey}</p>
                          {p.package?.name && (
                            <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-brand-50 text-brand-800">
                              {p.package.name}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {isApproval && (
                          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">
                            <Clock className="w-3 h-3" />
                            Needs approval
                          </span>
                        )}
                        {isComplete && (
                          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-brand-50 text-brand-800 border border-brand-100">
                            <CheckCircle2 className="w-3 h-3" />
                            Complete
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
                      </div>
                    </div>

                    {/* Stage progress */}
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            {currentStage?.name || p.currentStageKey || 'Starting'}
                          </span>
                          {stages.length > 0 && (
                            <span className="text-xs text-gray-400">
                              Step {currentIdx + 1} of {stages.length}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold tabular-nums" style={{
                          color: isApproval ? '#D97706' : isComplete ? '#0B1D5E' : '#0B1D5E'
                        }}>
                          {progress}%
                        </span>
                      </div>

                      <div className="h-2 rounded-full overflow-hidden bg-gray-100">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${progress}%`,
                            background: isApproval ? '#F59E0B' : isComplete ? '#0B1D5E' : '#0B1D5E',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Invoices ── */}
      <section>
        <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">Invoices</h2>
          {unpaidInvoices.length > 0 && (
            <span className="text-xs font-semibold text-red-600">
              {formatCurrency(outstanding, client?.currency || 'USD')} outstanding
            </span>
          )}
        </div>

        {invArr.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 px-8 py-10 text-center">
            <FileText className="w-7 h-7 text-gray-200 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-400">No invoices yet</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Overdue banner */}
            {unpaidInvoices.some((i: any) => i.status === 'overdue') && (
              <div className="px-6 py-3.5 flex items-center gap-2.5 border-b border-red-100 bg-red-50">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-sm font-medium text-red-700">
                  You have {unpaidInvoices.filter((i: any) => i.status === 'overdue').length} overdue invoice{unpaidInvoices.filter((i: any) => i.status === 'overdue').length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="divide-y divide-gray-50">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-2.5 bg-gray-50/50">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoice</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Due date</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-right">Amount</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 text-center">Status</span>
              </div>

              {invArr.slice(0, 10).map((inv: any) => {
                const s = INV_STATUS[inv.status] || { label: inv.status, cls: 'bg-gray-100 text-gray-500' };
                return (
                  <div key={inv.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-6 py-3.5 hover:bg-gray-50/50 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                      <span className="text-sm font-semibold text-gray-900 font-mono truncate">{inv.number}</span>
                    </div>
                    <span className="text-sm text-gray-500 text-right whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {inv.dueAt ? formatDate(inv.dueAt) : '—'}
                    </span>
                    <span className="text-sm font-bold text-gray-900 text-right whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(inv.total, inv.currency)}
                    </span>
                    <div className="flex justify-center">
                      <span className={cn('px-2.5 py-0.5 text-xs font-semibold rounded-full whitespace-nowrap', s.cls)}>
                        {s.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
