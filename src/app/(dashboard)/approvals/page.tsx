'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardCheck, Check, X, Search, ExternalLink, Paperclip,
  Clock, ThumbsUp, ThumbsDown, Info, Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import { cn, formatDate, toAbsoluteHttpUrl } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

// One inbox for every kind of approval in the app — task technical audits, task
// reviews, the client requirement *emails* that don't leave the building until
// an admin releases them, leave, contractor invoices, SEO content and blog
// deliverables, bulk keyword-sheet uploads, quotes/agreements out with a
// client, and employee profiles.
//
// The page owns no approval rules of its own: `/api/approvals` fans out across
// those sources and tells us, per row, whether this user may decide it
// (`canAct`) and whether the decision can even be made from here at all
// (`decidable` — a client's quotation approval can't be, so it links out).

type Person = { id: string | null; name: string; email?: string | null; avatarUrl?: string | null };

type ApprovalStatus = 'pending' | 'approved' | 'rejected';

interface Approval {
  id: string;
  type: string;
  typeLabel: string;
  group: string;
  status: ApprovalStatus;
  decidable: boolean;
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  requester?: Person | null;
  counterparty?: Person | null;
  counterpartyLabel?: string;
  submittedAt?: string | null;
  decidedAt?: string | null;
  href?: string | null;
  fileUrl?: string | null;
  canAct: boolean;
  actionHint?: string | null;
}

interface Summary {
  totals: Record<ApprovalStatus, number>;
  byType: Record<string, Record<ApprovalStatus, number>>;
  types: { key: string; label: string; group: string; decidable: boolean }[];
}

const TABS: { key: ApprovalStatus; label: string; icon: LucideIcon }[] = [
  { key: 'pending', label: 'Pending Approvals', icon: Clock },
  { key: 'approved', label: 'Approved', icon: ThumbsUp },
  { key: 'rejected', label: 'Rejected', icon: ThumbsDown },
];

const VALID_TABS = TABS.map((t) => t.key);

// Per-type accent, so a queue is recognizable before you read the label.
const TYPE_STYLE: Record<string, string> = {
  task_audit: 'bg-amber-50 text-amber-700 border-amber-200',
  task_review: 'bg-blue-50 text-blue-700 border-blue-200',
  client_request: 'bg-violet-50 text-violet-700 border-violet-200',
  leave: 'bg-teal-50 text-teal-700 border-teal-200',
  contractor_invoice: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  content_submission: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  blog_task: 'bg-sky-50 text-sky-700 border-sky-200',
  keyword_batch: 'bg-lime-50 text-lime-700 border-lime-200',
  customer_document: 'bg-rose-50 text-rose-700 border-rose-200',
  worker_profile: 'bg-orange-50 text-orange-700 border-orange-200',
};

function when(value?: string | null) {
  if (!value) return '—';
  return formatDate(value, 'MMM d, yyyy · h:mm a');
}

export default function ApprovalsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawStatus = searchParams.get('status') as ApprovalStatus | null;
  const status: ApprovalStatus = rawStatus && VALID_TABS.includes(rawStatus) ? rawStatus : 'pending';
  const type = searchParams.get('type') || '';

  const [search, setSearch] = useState('');
  // Rejection always needs a reason — every underlying service rejects a blank
  // one — so the button opens this rather than firing straight away.
  const [rejecting, setRejecting] = useState<Approval | null>(null);
  const [reason, setReason] = useState('');

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/approvals?${next.toString()}`, { scroll: false });
  }

  const { data: summary } = useQuery<Summary>({
    queryKey: ['approvals-summary'],
    queryFn: () => api.get('/approvals/summary').then((r) => r.data),
    refetchInterval: 60_000,
  });

  const { data: items = [], isLoading } = useQuery<Approval[]>({
    queryKey: ['approvals', status, type],
    queryFn: () => api
      .get('/approvals', { params: { status, ...(type ? { type } : {}) } })
      .then((r) => r.data || []),
    refetchInterval: 60_000,
  });

  const decide = useMutation({
    mutationFn: (vars: { item: Approval; decision: 'approve' | 'reject'; reason?: string }) =>
      api.post(`/approvals/${vars.item.type}/${vars.item.id}/decide`, {
        decision: vars.decision,
        reason: vars.reason,
      }).then((r) => r.data),
    onSuccess: (data) => {
      toast.success(data?.message || 'Decision recorded.');
      setRejecting(null);
      setReason('');
      // The decided row leaves Pending and appears in another tab, and several
      // of these decisions also move a task/project — refetch broadly rather
      // than surgically patching one list.
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['approvals-summary'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-sidebar'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not record that decision.'),
  });

  // Client-side text filter. The endpoint supports ?q= too, but filtering the
  // already-fetched page keeps typing instant and avoids a request per keystroke.
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((i) => [i.title, i.subtitle, i.detail, i.typeLabel, i.requester?.name]
      .some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [items, search]);

  const typeChips = summary?.types || [];
  const counts = summary?.totals || { pending: 0, approved: 0, rejected: 0 };

  return (
    <div className="flex flex-col h-full">
      <Header title="Approvals" />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {/* ── Tabs ── */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-full flex-wrap">
          {TABS.map((t) => {
            const Icon = t.icon;
            const n = counts[t.key] || 0;
            return (
              <button
                key={t.key}
                onClick={() => setParam('status', t.key)}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-3 sm:px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap flex-1 sm:flex-none',
                  status === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {t.label}
                {n > 0 && (
                  <span className={cn(
                    'ml-0.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full',
                    t.key === 'pending' ? 'bg-amber-500 text-white' : 'bg-gray-300 text-gray-700',
                  )}>
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Type filter + search ── */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setParam('type', '')}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                !type ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
              )}
            >
              All types
            </button>
            {typeChips.map((t) => {
              const n = summary?.byType?.[t.key]?.[status] || 0;
              return (
                <button
                  key={t.key}
                  onClick={() => setParam('type', type === t.key ? '' : t.key)}
                  className={cn(
                    'px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                    type === t.key
                      ? 'bg-brand-700 text-white border-brand-700'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50',
                  )}
                >
                  {t.label}
                  {n > 0 && <span className={cn('ml-1', type === t.key ? 'text-white/80' : 'text-gray-400')}>{n}</span>}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search approvals…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>
        </div>

        {/* ── List ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-brand-700 shrink-0" />
            <p className="text-sm font-semibold text-gray-900">
              {isLoading
                ? 'Loading…'
                : `${visible.length} ${status === 'pending' ? 'awaiting a decision' : status}`}
            </p>
          </div>

          {isLoading ? (
            <div className="px-5 py-12 flex items-center justify-center text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <ClipboardCheck className="w-8 h-8 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-700">
                {status === 'pending' ? 'Nothing waiting on you' : `No ${status} approvals`}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {status === 'pending'
                  ? 'Tasks, client emails, leave and deliverables appear here the moment they need a decision.'
                  : 'Decisions you and your team make will be listed here.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {visible.map((item) => (
                <li key={`${item.type}:${item.id}`} className="px-4 sm:px-5 py-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <Avatar
                      src={item.requester?.avatarUrl}
                      name={item.requester?.name || item.title}
                      size="md"
                      className="shrink-0"
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className={cn(
                          'px-2 py-0.5 text-[10px] font-semibold rounded-full border',
                          TYPE_STYLE[item.type] || 'bg-gray-50 text-gray-600 border-gray-200',
                        )}>
                          {item.typeLabel}
                        </span>
                      </div>

                      <p className="text-sm font-semibold text-gray-900 break-words">{item.title}</p>
                      {item.subtitle && (
                        <p className="text-xs text-gray-500 mt-0.5 break-words">{item.subtitle}</p>
                      )}
                      {item.detail && (
                        <p className="text-xs text-gray-600 mt-1.5 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 break-words">
                          {item.detail}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-400">
                        {item.requester && (
                          <span>Raised by <span className="text-gray-600 font-medium">{item.requester.name}</span></span>
                        )}
                        <span>Submitted {when(item.submittedAt)}</span>
                        {item.decidedAt && <span>Decided {when(item.decidedAt)}</span>}
                        {item.counterparty && (
                          <span>
                            {item.counterpartyLabel || 'With'}{' '}
                            <span className="text-gray-600 font-medium">{item.counterparty.name}</span>
                          </span>
                        )}
                      </div>

                      {/* Why the buttons aren't there, when they aren't. */}
                      {status === 'pending' && !item.canAct && item.actionHint && (
                        <p className="flex items-start gap-1.5 mt-2 text-[11px] text-gray-500">
                          <Info className="w-3 h-3 mt-0.5 shrink-0" /> {item.actionHint}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap sm:flex-col items-stretch gap-2 sm:w-36 shrink-0">
                      {status === 'pending' && item.decidable && item.canAct && (
                        <>
                          <button
                            onClick={() => decide.mutate({ item, decision: 'approve' })}
                            disabled={decide.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white transition-colors"
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button
                            onClick={() => { setRejecting(item); setReason(''); }}
                            disabled={decide.isPending}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" /> Reject
                          </button>
                        </>
                      )}
                      {item.fileUrl && (
                        <a
                          href={toAbsoluteHttpUrl(item.fileUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                          <Paperclip className="w-3.5 h-3.5" /> File
                        </a>
                      )}
                      {item.href && (
                        <Link
                          href={item.href}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Open
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Rejection reason ── */}
      {rejecting && (
        <Dialog open onOpenChange={(open) => { if (!open) setRejecting(null); }}>
          <DialogContent className="max-w-md sm:max-w-md rounded-2xl">
            <DialogTitle className="sr-only">Rejection reason</DialogTitle>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Reject this {rejecting.typeLabel.toLowerCase()}?</h3>
              <p className="text-xs text-gray-500 mt-1 break-words">{rejecting.title}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                autoFocus
                placeholder="Tell them what needs to change…"
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
              />
              <p className="text-[11px] text-gray-400 mt-1.5">
                The requester is notified with this reason.
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRejecting(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => decide.mutate({ item: rejecting, decision: 'reject', reason: reason.trim() })}
                disabled={!reason.trim() || decide.isPending}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white"
              >
                {decide.isPending ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
