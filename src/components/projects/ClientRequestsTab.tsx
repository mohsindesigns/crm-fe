'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail, Link2, Bell, XCircle, CheckCircle2, Clock, Eye, ShieldCheck, ShieldAlert, Ban } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatDate } from '@/lib/utils';
import ClientRequestModal from '@/components/projects/ClientRequestModal';
import ConfirmDialog from '@/components/ConfirmDialog';

// "Has the client sent their requirements back yet?" — the whole point of this
// tab. Each row is one emailed form; a responded row expands to the answers.
//
// It's also the approval queue. A form composed by non-admin staff arrives here
// as `pending_approval` — nothing emailed, link dead — and an admin releases it
// with Approve (which is what sends the email) or turns it down with Reject and
// a reason. Both buttons are admin-only on the server too
// (routes/clientRequests.js chains adminOnly); hiding them here is presentation,
// not the access control.

interface FormFieldDef { key: string; label: string; type: string; required: boolean; options?: string[] }
interface ClientRequest {
  id: string;
  subject: string;
  message: string | null;
  recipientName: string | null;
  recipientEmail: string;
  ccEmails: string[] | null;
  status: 'pending_approval' | 'rejected' | 'sent' | 'responded' | 'cancelled';
  dueAt: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  remindersSent: number;
  fields: FormFieldDef[];
  responseData: Record<string, string> | null;
  formUrl: string;
  sender?: { id: string; name: string } | null;
  approver?: { id: string; name: string } | null;
  template?: { id: string; name: string } | null;
}

function StatusBadge({ request }: { request: ClientRequest }) {
  if (request.status === 'pending_approval') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700">
        <ShieldAlert className="w-3 h-3" /> Awaiting approval
      </span>
    );
  }
  if (request.status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700">
        <Ban className="w-3 h-3" /> Rejected
      </span>
    );
  }
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
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [composing, setComposing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ClientRequest | null>(null);
  const [approveTarget, setApproveTarget] = useState<ClientRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ClientRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/projects/${projectId}/client-requests/${id}/approve`).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      // Approving is what sends the email, so the server still reports a 200
      // when SMTP refused it — say which one actually happened.
      if (data.emailSent) toast.success(data.message);
      else toast.warning(data.message);
      setApproveTarget(null);
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not approve the request.'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post(`/projects/${projectId}/client-requests/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      toast.success(data.message);
      setRejectTarget(null);
      setRejectReason('');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Could not reject the request.'),
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
  const pending = requests.filter((r) => r.status === 'pending_approval').length;
  const summary = [
    `${replied} replied`,
    `${awaiting} awaiting reply`,
    ...(pending ? [`${pending} awaiting approval`] : []),
  ].join(' · ');

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Client requirements</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {requests.length === 0
                ? 'Send the client a requirements form and their answers land back here.'
                : summary}
            </p>
          </div>
          {canSend && (
            <button
              onClick={() => setComposing(true)}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3.5 py-2 rounded-lg shrink-0"
            >
              <Mail className="w-3.5 h-3.5" /> Request requirements
            </button>
          )}
        </div>

        {pending > 0 && (
          <div className={`px-5 py-2.5 flex items-center gap-2 border-b border-indigo-100 ${isAdmin ? 'bg-indigo-50' : 'bg-gray-50'}`}>
            <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${isAdmin ? 'text-indigo-600' : 'text-gray-400'}`} />
            <p className={`text-[11px] ${isAdmin ? 'text-indigo-900' : 'text-gray-500'}`}>
              {isAdmin
                ? `${pending} form${pending === 1 ? '' : 's'} waiting on you. Nothing has been emailed to the client yet.`
                : `${pending} form${pending === 1 ? '' : 's'} waiting on an admin to approve. Nothing has been emailed to the client yet.`}
            </p>
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">
              Nothing sent yet.{canSend ? ' Use “Request requirements” to ask for what you need to start.' : ''}
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
                        {r.status === 'pending_approval' ? 'For ' : 'To '}
                        {r.recipientName ? `${r.recipientName} · ` : ''}{r.recipientEmail}
                        {r.sender?.name ? ` · written by ${r.sender.name}` : ''}
                        {r.sentAt ? ` · emailed ${formatDate(r.sentAt)}` : ''}
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {r.status === 'pending_approval'
                          ? 'Not sent — waiting for an admin to approve'
                          : r.status === 'rejected'
                            ? `Rejected${r.approver?.name ? ` by ${r.approver.name}` : ''}${r.approvedAt ? ` ${formatDate(r.approvedAt)}` : ''} — never emailed`
                            : r.status === 'responded' && r.respondedAt
                              ? `Replied ${formatDate(r.respondedAt)}`
                              : r.viewedAt
                                ? `Opened ${formatDate(r.viewedAt)}, not submitted yet`
                                : r.status === 'sent' ? 'Not opened yet' : ''}
                        {r.dueAt ? ` · due ${formatDate(r.dueAt)}` : ''}
                        {r.remindersSent > 0 ? ` · ${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'} sent` : ''}
                      </p>
                      {r.status === 'rejected' && r.rejectionReason && (
                        <p className="mt-2 text-xs text-red-800 bg-red-50 border border-red-100 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
                          <span className="font-semibold">Reason: </span>{r.rejectionReason}
                        </p>
                      )}
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
                      {/* An approver can't sensibly approve what they can't
                          read, so a pending row opens to the actual email and
                          questions. Available on any unanswered row, not just
                          pending ones — same panel serves "what did we send?". */}
                      {r.status !== 'responded' && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : r.id)}
                          className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 px-2 py-1.5 rounded-lg hover:bg-brand-50"
                        >
                          <Eye className="w-3.5 h-3.5" /> {expanded ? 'Hide' : r.status === 'pending_approval' ? 'Review' : 'View'}
                        </button>
                      )}
                      {isAdmin && r.status === 'pending_approval' && (
                        <>
                          <button
                            onClick={() => setApproveTarget(r)}
                            disabled={approveMutation.isPending}
                            className="flex items-center gap-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 px-2.5 py-1.5 rounded-lg"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" /> Approve &amp; send
                          </button>
                          <button
                            onClick={() => { setRejectTarget(r); setRejectReason(''); }}
                            className="flex items-center gap-1 text-xs font-medium text-red-700 hover:bg-red-50 px-2.5 py-1.5 rounded-lg"
                          >
                            <Ban className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {(r.status === 'sent' || r.status === 'responded') && (
                        <button
                          onClick={() => copyLink(r.formUrl)}
                          title="Copy the client's link"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                        >
                          <Link2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canSend && r.status === 'sent' && (
                        <button
                          onClick={() => remindMutation.mutate(r.id)}
                          disabled={remindMutation.isPending}
                          title="Send a reminder"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                        >
                          <Bell className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canSend && (r.status === 'sent' || r.status === 'pending_approval') && (
                        <button
                          onClick={() => setCancelTarget(r)}
                          title={r.status === 'pending_approval' ? 'Withdraw this request' : 'Cancel this request'}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && r.status !== 'responded' && (
                    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                      <div className="px-4 py-3 bg-white border-b border-gray-200">
                        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Email subject</p>
                        <p className="text-sm text-gray-900 mt-1 break-words">{r.subject}</p>
                        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mt-3">
                          Message the client will read
                        </p>
                        <p className={`text-sm mt-1 whitespace-pre-wrap break-words ${r.message ? 'text-gray-900' : 'text-gray-400 italic'}`}>
                          {r.message || 'No message'}
                        </p>
                        {r.ccEmails && r.ccEmails.length > 0 && (
                          <>
                            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mt-3">CC</p>
                            <p className="text-sm text-gray-900 mt-1 break-words">{r.ccEmails.join(', ')}</p>
                          </>
                        )}
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                          {r.fields.length} question{r.fields.length === 1 ? '' : 's'}
                        </p>
                        <ol className="space-y-1.5 list-decimal list-inside">
                          {r.fields.map((f) => (
                            <li key={f.key} className="text-sm text-gray-800 break-words">
                              {f.label}
                              <span className="text-[11px] text-gray-400"> · {f.type}{f.required ? ' · required' : ''}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}

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
        open={!!approveTarget}
        title="Approve and email the client?"
        message={approveTarget
          ? `${approveTarget.recipientName || approveTarget.recipientEmail} will be emailed the requirements form straight away, at ${approveTarget.recipientEmail}. Read the message above first — it goes out exactly as written.`
          : ''}
        confirmLabel="Approve & send"
        cancelLabel="Not yet"
        onConfirm={() => approveTarget && approveMutation.mutate(approveTarget.id)}
        onCancel={() => setApproveTarget(null)}
      />

      {/* Reject needs a typed reason, so it's its own dialog rather than a
          ConfirmDialog — the backend rejects an empty one. */}
      {rejectTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setRejectTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
            <h3 className="text-sm font-semibold text-gray-900">Reject this request?</h3>
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              Nothing will be emailed to {rejectTarget.recipientEmail}.
              {rejectTarget.sender?.name ? ` ${rejectTarget.sender.name} gets` : ' The sender gets'} a notification
              with your reason and can compose a new one.
            </p>
            <label className="block text-xs font-medium text-gray-700 mt-4 mb-1.5">
              Why? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              autoFocus
              placeholder="e.g. Drop the budget question and soften the second paragraph."
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {rejectMutation.isPending ? 'Rejecting…' : 'Reject request'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title={cancelTarget?.status === 'pending_approval' ? 'Withdraw this request?' : 'Cancel this request?'}
        message={cancelTarget
          ? cancelTarget.status === 'pending_approval'
            ? `It will be taken out of the approval queue and never sent to ${cancelTarget.recipientEmail}. Nothing is deleted — it stays here as history.`
            : `The link sent to ${cancelTarget.recipientEmail} will stop working and they won't be able to submit their answers. Nothing is deleted — the request stays here as history.`
          : ''}
        confirmLabel={cancelTarget?.status === 'pending_approval' ? 'Withdraw it' : 'Cancel request'}
        cancelLabel="Keep it"
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
