'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Mail, Phone, Calendar, FolderKanban, Megaphone, UserCheck, History, ArrowRightCircle } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import { cn, formatDate, titleCase } from '@/lib/utils';
import { invalidateMany, afterLeadChange } from '@/lib/queryInvalidation';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const STATUS_OPTIONS = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'not_qualified', label: 'Not Qualified' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-gray-100 text-gray-600',
  contacted: 'bg-blue-100 text-blue-700',
  qualified: 'bg-brand-100 text-brand-800',
  not_qualified: 'bg-red-100 text-red-700',
  converted: 'bg-violet-100 text-violet-700',
  lost: 'bg-gray-100 text-gray-400',
};

function MetaRow({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-600">
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span className="truncate">{children}</span>
    </div>
  );
}

export default function LeadDetailModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [convertName, setConvertName] = useState('');
  const [showConvert, setShowConvert] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', leadId],
    queryFn: () => api.get(`/leads/${leadId}`).then((r) => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/leads/${leadId}/status`, { status, note: note || undefined }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterLeadChange(leadId));
      setNote('');
      setPendingStatus(null);
      toast.success('Status updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update status.'),
  });

  const assign = useMutation({
    mutationFn: (userId: string) => api.patch(`/leads/${leadId}/assign`, { userId: userId || null }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterLeadChange(leadId));
      toast.success('Assignment updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to assign.'),
  });

  const convert = useMutation({
    mutationFn: () => api.post(`/leads/${leadId}/convert`, { name: convertName || undefined }).then((r) => r.data),
    onSuccess: async (data: any) => {
      await invalidateMany(qc, afterLeadChange(leadId));
      toast.success(`Converted to client "${data.client.name}".`);
      setShowConvert(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to convert.'),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-w-2xl sm:max-w-2xl w-full max-h-[90vh] p-0 gap-0 overflow-y-auto rounded-2xl">
        <DialogTitle className="sr-only">{lead?.fullName ? `Lead: ${lead.fullName}` : 'Lead details'}</DialogTitle>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between z-10">
          <h3 className="text-sm font-semibold text-gray-900">Lead details</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading || !lead ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="p-5 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-base font-semibold text-gray-900 truncate">{lead.fullName || 'Unnamed lead'}</h4>
                <div className="mt-1.5 space-y-1">
                  {lead.email && <MetaRow icon={Mail}>{lead.email}</MetaRow>}
                  {lead.phone && <MetaRow icon={Phone}>{lead.phone}</MetaRow>}
                  <MetaRow icon={Calendar}>Submitted {formatDate(lead.createdAt, 'MMM d, yyyy · h:mm a')}</MetaRow>
                  {lead.project && <MetaRow icon={FolderKanban}>{lead.project.name}</MetaRow>}
                  {lead.campaign && <MetaRow icon={Megaphone}>{lead.campaign}</MetaRow>}
                </div>
              </div>
              <span className={cn('px-2.5 py-1 text-xs font-semibold rounded-full shrink-0', STATUS_COLORS[lead.status])}>
                {titleCase(lead.status)}
              </span>
            </div>

            {/* Submitted answers — excludes whichever fields the backend already
                pulled out into fullName/email/phone (shown above), matching
                LeadService.buildFieldData's own selection exactly so nothing
                gets shown twice. */}
            {(() => {
              const fields = lead.form?.fields || [];
              const nameField = fields.find((f: any) => f.type === 'text' && (f.key === 'name' || f.key.includes('name')))
                || fields.find((f: any) => f.type === 'text');
              const extraFields = fields.filter((f: any) =>
                f.type !== 'email' && f.type !== 'phone' && f.key !== nameField?.key);
              if (extraFields.length === 0) return null;
              return (
                <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Form answers</p>
                  {extraFields.map((f: any) => (
                    <div key={f.key} className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 text-sm">
                      <span className="text-gray-500 sm:w-32 shrink-0">{f.label}</span>
                      <span className="text-gray-800 break-words">
                        {f.type === 'file' && lead.fieldData?.[f.key] ? (
                          <a href={lead.fieldData[f.key]} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:text-brand-800 underline underline-offset-2">
                            View attachment
                          </a>
                        ) : Array.isArray(lead.fieldData?.[f.key])
                          ? lead.fieldData[f.key].join(', ') || '—'
                          : String(lead.fieldData?.[f.key] ?? '—')}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Status + assignment */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
                <select
                  value={pendingStatus ?? lead.status}
                  onChange={(e) => setPendingStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5 flex items-center gap-1"><UserCheck className="w-3 h-3" /> Assigned to</label>
                <select
                  value={lead.assignedToUserId || ''}
                  onChange={(e) => assign.mutate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="">Unassigned</option>
                  {(users as any[]).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>

            {pendingStatus && pendingStatus !== lead.status && (
              <div className="bg-brand-50 border border-brand-100 rounded-xl p-3.5 space-y-2.5">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note (optional)…"
                  rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => updateStatus.mutate(pendingStatus)}
                    disabled={updateStatus.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    {updateStatus.isPending ? 'Saving…' : `Mark ${titleCase(pendingStatus)}`}
                  </button>
                  <button onClick={() => { setPendingStatus(null); setNote(''); }} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Convert to client */}
            {lead.convertedClientId ? (
              <div className="flex items-center gap-2 text-sm text-violet-700 bg-violet-50 rounded-xl px-3.5 py-2.5">
                <ArrowRightCircle className="w-4 h-4 shrink-0" />
                Converted to client
                <a href={`/clients/${lead.convertedClientId}`} className="font-medium underline underline-offset-2">view client</a>
              </div>
            ) : showConvert ? (
              <div className="border border-gray-200 rounded-xl p-3.5 space-y-2.5">
                <label className="block text-xs font-medium text-gray-700">Client name</label>
                <input
                  value={convertName}
                  onChange={(e) => setConvertName(e.target.value)}
                  placeholder={lead.fullName || 'New Client'}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => convert.mutate()}
                    disabled={convert.isPending}
                    className="bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    {convert.isPending ? 'Converting…' : 'Create Client'}
                  </button>
                  <button onClick={() => setShowConvert(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowConvert(true)}
                className="flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800 bg-violet-50 hover:bg-violet-100 px-4 py-2 rounded-lg transition-colors"
              >
                <ArrowRightCircle className="w-4 h-4" /> Convert to Client
              </button>
            )}

            {/* Timeline */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Timeline
              </p>
              <div className="space-y-2.5">
                {(lead.events || []).map((ev: any) => (
                  <div key={ev.id} className="flex items-start gap-2.5 text-sm">
                    <Avatar src={ev.actor?.avatarUrl} name={ev.actor?.name || 'System'} size="xs" className="w-6 h-6 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-gray-700">
                        <span className="font-medium">{ev.actor?.name || 'System'}</span>
                        {ev.fromStatus ? (
                          <> moved this from <span className="font-medium">{titleCase(ev.fromStatus)}</span> to <span className="font-medium">{titleCase(ev.toStatus)}</span></>
                        ) : (
                          <> created this lead</>
                        )}
                      </p>
                      {ev.note && <p className="text-gray-500 mt-0.5">{ev.note}</p>}
                      <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(ev.createdAt, 'MMM d, h:mm a')}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
