'use client';

import { useQuery } from '@tanstack/react-query';
import { X, Mail, Phone, Calendar, Megaphone, History } from 'lucide-react';
import { usePortalStore } from '@/store/portal';
import { cn, formatDate, titleCase } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

function portalFetch(path: string, token: string) {
  return fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || 'Request failed');
    return data;
  });
}

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

/** Read-only for the portal — a client sees exactly what came in and its
 *  status history, but status/assignment/conversion stay staff-only actions
 *  (see routes/portalLeads.js, which never defines those endpoints at all). */
export default function PortalLeadDetailModal({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { token } = usePortalStore();

  const { data: lead, isLoading } = useQuery({
    queryKey: ['portal-lead', leadId],
    queryFn: () => portalFetch(`/portal/leads/${leadId}`, token!),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-w-lg sm:max-w-lg w-full max-h-[90vh] p-0 gap-0 overflow-y-auto rounded-2xl">
        <DialogTitle className="sr-only">Lead details</DialogTitle>
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
                  {lead.campaign && <MetaRow icon={Megaphone}>{lead.campaign}</MetaRow>}
                </div>
              </div>
              <span className={cn('px-2.5 py-1 text-xs font-semibold rounded-full shrink-0', STATUS_COLORS[lead.status])}>
                {titleCase(lead.status)}
              </span>
            </div>

            {lead.form?.fields?.length > 0 && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Form answers</p>
                {lead.form.fields.map((f: any) => (
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
            )}

            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Timeline
              </p>
              <div className="space-y-2.5">
                {(lead.events || []).map((ev: any) => (
                  <div key={ev.id} className="text-sm">
                    <p className="text-gray-700">
                      {ev.fromStatus ? (
                        <>Status moved from <span className="font-medium">{titleCase(ev.fromStatus)}</span> to <span className="font-medium">{titleCase(ev.toStatus)}</span></>
                      ) : (
                        <>Lead received</>
                      )}
                    </p>
                    {ev.note && <p className="text-gray-500 mt-0.5">{ev.note}</p>}
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(ev.createdAt, 'MMM d, h:mm a')}</p>
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
