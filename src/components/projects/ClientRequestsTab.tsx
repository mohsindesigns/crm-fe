'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Link2, Bell, XCircle, CheckCircle2, Clock, Eye } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { formatDate } from '@/lib/utils';
import ClientRequestModal from '@/components/projects/ClientRequestModal';
import ConfirmDialog from '@/components/ConfirmDialog';

// "Has the client sent their requirements back yet?" — the whole point of this
// tab. Each row is one emailed form; a responded row expands to the answers.

interface FormFieldDef { key: string; label: string; type: string; required: boolean; options?: string[] }
interface ClientRequest {
  id: string;
  subject: string;
  message: string | null;
  recipientName: string | null;
  recipientEmail: string;
  ccEmails: string[] | null;
  status: 'sent' | 'responded' | 'cancelled';
  dueAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  remindersSent: number;
  fields: FormFieldDef[];
  responseData: Record<string, string> | null;
  formUrl: string;
  sender?: { id: string; name: string } | null;
  template?: { id: string; name: string } | null;
}

function StatusBadge({ request }: { request: ClientRequest }) {
  if (request.status === 'responded') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-green-50 text-green-700">
        <CheckCircle2 className="w-3 h-3" /> Reply received
      </span>
    );
  }
  if (request.status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500">
        <XCircle className="w-3 h-3" /> Cancelled
      </span>
    );
  }
  const overdue = request.dueAt && new Date(`${request.dueAt.slice(0, 10)}T23:59:59`) < new Date();
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${overdue ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
      <Clock className="w-3 h-3" /> {overdue ? 'Overdue' : 'Awaiting reply'}
    </span>
  );
}

export default function ClientRequestsTab({
  projectId,
  projectName,
  brandName,
  brandLogoUrl,
  brandColor,
  serviceTypeKey,
  canSend,
}: {
  projectId: string;
  projectName: string;
  brandName: string;
  brandLogoUrl: string | null;
  brandColor: string;
  serviceTypeKey?: string | null;
  canSend: boolean;
}) {
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ClientRequest | null>(null);

  const { data: requests = [], isLoading } = useQuery<ClientRequest[]>({
    queryKey: ['client-requests', projectId],
    queryFn: () => api.get(`/projects/${projectId}/client-requests`).then((r) => r.data),
  });

  const remindMutation = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${projectId}/client-requests/${id}/remind`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      if (data.emailSent) toast.success(data.message);
      else toast.warning(data.message);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not send the reminder.'),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${projectId}/client-requests/${id}/cancel`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      toast.success(data.message);
      setCancelTarget(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not cancel the request.'),
  });

  function copyLink(url: string) {
    navigator.clipboard.writeText(url)
      .then(() => toast.success('Link copied — you can paste it into a chat or email.'))
      .catch(() => toast.error('Could not copy the link.'));
  }

  const awaiting = requests.filter((r) => r.status === 'sent').length;
  const replied = requests.filter((r) => r.status === 'responded').length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Client requirements</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {requests.length === 0
                ? 'Email the client a form and their answers land back here.'
                : `${replied} replied · ${awaiting} awaiting reply`}
            </p>
          </div>
          {canSend && (
            <button
              onClick={() => setComposing(true)}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3.5 py-2 rounded-lg shrink-0"
            >
              <Mail className="w-3.5 h-3.5" /> Email the client
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">
              Nothing sent yet.{canSend ? ' Use “Email the client” to ask for what you need to start.' : ''}
            </p>
          ) : (
            requests.map((r) => {
              const expanded = expandedId === r.id;
              return (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-gray-900 truncate">{r.subject}</p>
                        <StatusBadge request={r} />
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        To {r.recipientName ? `${r.recipientName} · ` : ''}{r.recipientEmail}
                        {r.sender?.name ? ` · sent by ${r.sender.name}` : ''}
                        {r.sentAt ? ` · ${formatDate(r.sentAt)}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {r.status === 'responded' && r.respondedAt
                          ? `Replied ${formatDate(r.respondedAt)}`
                          : r.viewedAt
                            ? `Opened ${formatDate(r.viewedAt)}, not submitted yet`
                            : r.status === 'sent' ? 'Not opened yet' : ''}
                        {r.dueAt ? ` · due ${formatDate(r.dueAt)}` : ''}
                        {r.remindersSent > 0 ? ` · ${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'} sent` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {r.status === 'responded' && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : r.id)}
                          className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 px-2 py-1.5 rounded-lg hover:bg-brand-50"
                        >
                          <Eye className="w-3.5 h-3.5" /> {expanded ? 'Hide' : 'View answers'}
                        </button>
                      )}
                      {r.status !== 'cancelled' && (
                        <button
                          onClick={() => copyLink(r.formUrl)}
                          title="Copy the client's link"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canSend && r.status === 'sent' && (
                        <>
                          <button
                            onClick={() => remindMutation.mutate(r.id)}
                            disabled={remindMutation.isPending}
                            title="Send a reminder"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                          >
                            <Bell className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setCancelTarget(r)}
                            title="Cancel this request"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {expanded && r.status === 'responded' && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 divide-y divide-gray-200">
                      {r.fields.map((f) => {
                        const answer = r.responseData?.[f.key];
                        return (
                          <div key={f.key} className="px-4 py-3">
                            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{f.label}</p>
                            <p className={`text-sm mt-1 whitespace-pre-wrap break-words ${answer ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                              {answer || 'No answer given'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {composing && (
        <ClientRequestModal
          projectId={projectId}
          projectName={projectName}
          brandName={brandName}
          brandLogoUrl={brandLogoUrl}
          brandColor={brandColor}
          serviceTypeKey={serviceTypeKey}
          onClose={() => setComposing(false)}
        />
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this request?"
        message={cancelTarget
          ? `The link sent to ${cancelTarget.recipientEmail} will stop working and they won't be able to submit their answers. Nothing is deleted — the request stays here as history.`
          : ''}
        confirmLabel="Cancel request"
        cancelLabel="Keep it"
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
