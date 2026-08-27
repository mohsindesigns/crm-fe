'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, Target, FileEdit, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import LeadDetailModal from '@/components/leads/LeadDetailModal';
import LeadFormModal from '@/components/leads/LeadFormModal';
import EmbedSnippet from '@/components/leads/EmbedSnippet';
import { cn, formatDate, titleCase } from '@/lib/utils';
import { invalidateMany, afterLeadFormChange } from '@/lib/queryInvalidation';
import { useAuthStore } from '@/store/auth';

type Tab = 'leads' | 'forms';

const STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'not_qualified', 'converted', 'lost'];
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  contacted: 'bg-blue-100 text-blue-700',
  qualified: 'bg-brand-100 text-brand-800',
  not_qualified: 'bg-red-100 text-red-700',
  converted: 'bg-violet-100 text-violet-700',
  lost: 'bg-gray-100 text-gray-400',
};

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canManageForms = hasPermission('leads.manage');

  const tab: Tab = (searchParams.get('tab') as Tab) || 'leads';
  function setTab(t: Tab) {
    router.replace(`/leads?tab=${t}`, { scroll: false });
  }

  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [campaign, setCampaign] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingForm, setEditingForm] = useState<any>(null);
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ['leads', { status, search, projectId, campaign, dateFrom, dateTo }],
    queryFn: () => api.get('/leads', {
      params: {
        status: status || undefined,
        q: search || undefined,
        projectId: projectId || undefined,
        campaign: campaign || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      },
    }).then((r) => r.data),
    enabled: tab === 'leads',
  });

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['lead-forms'],
    queryFn: () => api.get('/lead-forms').then((r) => r.data),
    enabled: tab === 'forms',
  });

  // Unfiltered baseline (only needs leads.read, same as the page itself — unlike
  // /lead-forms, which needs leads.manage) purely to build the Project/Campaign
  // filter dropdown option lists. Kept separate from the `leads` query above so
  // narrowing one filter never shrinks another filter's own option list.
  const { data: allLeads = [] } = useQuery({
    queryKey: ['leads', 'all-for-filters'],
    queryFn: () => api.get('/leads').then((r) => r.data),
    enabled: tab === 'leads',
    staleTime: 60_000,
  });

  const projectOptions = Array.from(
    new Map(
      (allLeads as any[]).filter((l) => l.project).map((l) => [l.project.id, l.project.name]),
    ).entries(),
  );
  const campaignOptions = Array.from(new Set((allLeads as any[]).map((l) => l.campaign).filter(Boolean))) as string[];

  const toggleFormStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'active' | 'paused' }) =>
      api.patch(`/lead-forms/${id}`, { status: next }).then((r) => r.data),
    onSuccess: async (_d, { id }) => {
      await invalidateMany(qc, afterLeadFormChange(id));
      toast.success('Form status updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update form.'),
  });

  return (
    <div className="flex flex-col h-full">
      <Header title="Leads" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* Tabs */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1 border-b border-gray-200">
            {(['leads', 'forms'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
                  tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-700',
                )}
              >
                {t === 'leads' ? 'Leads' : 'Lead Forms'}
              </button>
            ))}
          </div>
          {tab === 'forms' && canManageForms && (
            <button
              onClick={() => setShowFormModal(true)}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> New Form
            </button>
          )}
        </div>

        {/* ── Leads tab ── */}
        {tab === 'leads' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="relative w-full sm:flex-1 sm:max-w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email, phone…"
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400 shrink-0" />
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </select>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  title="Filter by project"
                >
                  <option value="">All projects</option>
                  {projectOptions.map(([pid, name]) => <option key={pid} value={pid}>{name}</option>)}
                </select>
                <select
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
                  title="Filter by campaign"
                >
                  <option value="">All campaigns</option>
                  {campaignOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="flex items-center gap-1.5 text-sm text-gray-500">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                    className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    title="From date"
                  />
                  <span>–</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                    className="border border-gray-300 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
                    title="To date"
                  />
                </div>
                {(status || projectId || campaign || dateFrom || dateTo) && (
                  <button
                    type="button"
                    onClick={() => { setStatus(''); setProjectId(''); setCampaign(''); setDateFrom(''); setDateTo(''); }}
                    className="text-xs font-medium text-gray-500 hover:text-gray-800 px-2 py-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-160">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Lead</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Project</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Campaign</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Assigned</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {leadsLoading ? (
                      <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">Loading…</td></tr>
                    ) : (leads as any[]).length === 0 ? (
                      <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-gray-400">No leads yet.</td></tr>
                    ) : (
                      (leads as any[]).map((lead) => (
                        <tr
                          key={lead.id}
                          onClick={() => setOpenLeadId(lead.id)}
                          className="hover:bg-gray-50/60 transition-colors cursor-pointer"
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                                <Target className="w-4 h-4 text-brand-700" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{lead.fullName || 'Unnamed'}</p>
                                <p className="text-xs text-gray-400 truncate">{lead.email || lead.phone || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm text-gray-600">{lead.project?.name || '—'}</td>
                          <td className="px-5 py-3.5 text-sm text-gray-600">{lead.campaign || '—'}</td>
                          <td className="px-5 py-3.5">
                            <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[lead.status])}>
                              {titleCase(lead.status)}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            {lead.assignee ? (
                              <div className="flex items-center gap-1.5">
                                <Avatar src={lead.assignee.avatarUrl} name={lead.assignee.name} size="xs" className="w-5 h-5" />
                                <span className="text-sm text-gray-600 truncate">{lead.assignee.name}</span>
                              </div>
                            ) : <span className="text-sm text-gray-400">Unassigned</span>}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-gray-500 whitespace-nowrap">{formatDate(lead.createdAt)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Lead Forms tab ── */}
        {tab === 'forms' && (
          <div className="space-y-3">
            {formsLoading ? (
              <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
            ) : (forms as any[]).length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-12 text-center text-sm text-gray-400">
                No lead forms yet — create one to get an embeddable link.
              </div>
            ) : (
              (forms as any[]).map((form) => {
                const expanded = expandedFormId === form.id;
                return (
                  <div key={form.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                        <Target className="w-4 h-4 text-brand-700" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 truncate">{form.name}</p>
                          <span className={cn(
                            'px-2 py-0.5 text-[10px] font-semibold rounded-full',
                            form.status === 'active' ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-700',
                          )}>
                            {form.status === 'active' ? 'Active' : 'Paused'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 truncate">
                          {form.project?.name || 'Unscoped'}{form.campaign ? ` · ${form.campaign}` : ''} · {form.leadCount} lead{form.leadCount === 1 ? '' : 's'}
                          {form.notifyClient && ` · linked to ${form.notifyClient.name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canManageForms && (
                          <>
                            <button
                              onClick={() => toggleFormStatus.mutate({ id: form.id, next: form.status === 'active' ? 'paused' : 'active' })}
                              title={form.status === 'active' ? 'Pause form' : 'Activate form'}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                            >
                              {form.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => setEditingForm(form)}
                              title="Edit form"
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                            >
                              <FileEdit className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setExpandedFormId(expanded ? null : form.id)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        >
                          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="border-t border-gray-100 bg-gray-50/60 p-4">
                        <EmbedSnippet publicToken={form.publicToken} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {openLeadId && <LeadDetailModal leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
      {showFormModal && <LeadFormModal onClose={() => setShowFormModal(false)} />}
      {editingForm && <LeadFormModal form={editingForm} onClose={() => setEditingForm(null)} />}
    </div>
  );
}
