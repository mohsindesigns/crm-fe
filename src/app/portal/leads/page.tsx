'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Target, FileEdit, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import { usePortalStore } from '@/store/portal';
import PortalLeadDetailModal from '@/components/leads/PortalLeadDetailModal';
import PortalLeadFormModal from '@/components/leads/PortalLeadFormModal';
import EmbedSnippet from '@/components/leads/EmbedSnippet';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn, formatDate, titleCase } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

function portalFetch(path: string, token: string, options?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options?.headers || {}) },
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Request failed');
    return data;
  });
}

type Tab = 'leads' | 'forms';

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  contacted: 'bg-blue-100 text-blue-700',
  qualified: 'bg-brand-100 text-brand-800',
  not_qualified: 'bg-red-100 text-red-700',
  converted: 'bg-violet-100 text-violet-700',
  lost: 'bg-gray-100 text-gray-400',
};

export default function PortalLeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { token } = usePortalStore();

  const tab: Tab = (searchParams.get('tab') as Tab) || 'leads';
  function setTab(t: Tab) {
    router.replace(`/portal/leads?tab=${t}`, { scroll: false });
  }

  const [openLeadId, setOpenLeadId] = useState<string | null>(null);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingForm, setEditingForm] = useState<any>(null);
  const [expandedFormId, setExpandedFormId] = useState<string | null>(null);

  const { data: leads = [], isLoading: leadsLoading } = useQuery({
    queryKey: ['portal-leads'],
    queryFn: () => portalFetch('/portal/leads', token!),
    enabled: !!token && tab === 'leads',
  });

  const { data: forms = [], isLoading: formsLoading } = useQuery({
    queryKey: ['portal-lead-forms'],
    queryFn: () => portalFetch('/portal/lead-forms', token!),
    enabled: !!token && tab === 'forms',
  });

  const toggleFormStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: 'active' | 'paused' }) =>
      portalFetch(`/portal/lead-forms/${id}`, token!, { method: 'PATCH', body: JSON.stringify({ status: next }) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['portal-lead-forms'] });
      toast.success('Form status updated.');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to update form.'),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-gray-200">
          {(['leads', 'forms'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-700',
              )}
            >
              {t === 'leads' ? 'Leads' : 'Lead Forms'}
            </button>
          ))}
        </div>
        {tab === 'forms' && (
          <button
            onClick={() => setShowFormModal(true)}
            className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" /> New Form
          </button>
        )}
      </div>

      {tab === 'leads' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <Table className="w-full min-w-140">
            <TableHeader>
              <TableRow className="border-b border-gray-200 bg-gray-100">
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Lead</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Campaign</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
                <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Received</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-50">
              {leadsLoading ? (
                <TableRow><TableCell colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">Loading…</TableCell></TableRow>
              ) : (leads as any[]).length === 0 ? (
                <TableRow><TableCell colSpan={4} className="px-5 py-12 text-center text-sm text-gray-400">No leads yet — create a form to start collecting them.</TableCell></TableRow>
              ) : (
                (leads as any[]).map((lead) => (
                  <TableRow key={lead.id} onClick={() => setOpenLeadId(lead.id)} className="hover:bg-gray-50/60 transition-colors cursor-pointer">
                    <TableCell className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                          <Target className="w-4 h-4 text-brand-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{lead.fullName || 'Unnamed'}</p>
                          <p className="text-xs text-gray-400 truncate">{lead.email || lead.phone || '—'}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-sm text-gray-600">{lead.campaign || '—'}</TableCell>
                    <TableCell className="px-5 py-3.5">
                      <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[lead.status])}>
                        {titleCase(lead.status)}
                      </span>
                    </TableCell>
                    <TableCell className="px-5 py-3.5 text-sm text-gray-500 whitespace-nowrap">{formatDate(lead.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {tab === 'forms' && (
        <div className="space-y-3">
          {formsLoading ? (
            <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
          ) : (forms as any[]).length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-12 text-center text-sm text-gray-400">
              No lead forms yet — create one to get an embeddable link for your site.
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
                        <span className={cn('px-2 py-0.5 text-[10px] font-semibold rounded-full', form.status === 'active' ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-700')}>
                          {form.status === 'active' ? 'Active' : 'Paused'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 truncate">
                        {form.campaign || 'No campaign tag'} · {form.leadCount} lead{form.leadCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleFormStatus.mutate({ id: form.id, next: form.status === 'active' ? 'paused' : 'active' })}
                        title={form.status === 'active' ? 'Pause form' : 'Activate form'}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                      >
                        {form.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button onClick={() => setEditingForm(form)} title="Edit form" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                        <FileEdit className="w-4 h-4" />
                      </button>
                      <button onClick={() => setExpandedFormId(expanded ? null : form.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
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

      {openLeadId && <PortalLeadDetailModal leadId={openLeadId} onClose={() => setOpenLeadId(null)} />}
      {showFormModal && <PortalLeadFormModal onClose={() => setShowFormModal(false)} />}
      {editingForm && <PortalLeadFormModal form={editingForm} onClose={() => setEditingForm(null)} />}
    </div>
  );
}
