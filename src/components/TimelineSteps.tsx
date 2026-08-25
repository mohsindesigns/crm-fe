'use client';

/**
 * The stage-progress pill row (Created → Sent → Paid, Created → Sent →
 * Viewed → Approved, etc.) originally built for the client Timeline tab
 * (clients/[id]/page.tsx) and now shared with individual document/invoice
 * detail pages, which show the same row for just their own record.
 */

import { CheckCircle, XCircle, Clock, ChevronRight } from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';

export type TimelineStep = {
  key: string;
  name: string;
  done: boolean;
  current: boolean;
  at: string | null;
  tone?: 'positive' | 'negative' | 'neutral' | null;
};

export function TimelineSteps({ steps }: { steps: TimelineStep[] }) {
  return (
    <div className="flex items-start gap-1 overflow-x-auto pb-1">
      {steps.map((step, idx) => (
        <div key={step.key} className="flex items-start gap-1 shrink-0">
          <div className="flex flex-col items-center gap-1">
            <div
              title={step.at ? formatDate(step.at, 'MMM d, yyyy · h:mm a') : undefined}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
                step.done && step.tone === 'negative' ? 'bg-red-100 text-red-700' :
                step.done && step.tone === 'neutral' ? 'bg-amber-100 text-amber-700' :
                step.done ? 'bg-brand-100 text-brand-800' :
                // A pending-but-alarming step (e.g. an overdue invoice) reads as
                // red even though it's not "done" — done just means reached, and
                // overdue is a current state worth flagging, not a next-up default.
                step.current && step.tone === 'negative' ? 'bg-red-600 text-white' :
                step.current ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-500'
              )}
            >
              {step.done && step.tone === 'negative' && <XCircle className="w-3 h-3" />}
              {step.done && step.tone !== 'negative' && <CheckCircle className="w-3 h-3" />}
              {step.current && <Clock className="w-3 h-3" />}
              {step.name}
            </div>
            {step.at && (step.done || step.current) && (
              <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(step.at, 'MMM d, h:mm a')}</span>
            )}
          </div>
          {idx < steps.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-1.5" />}
        </div>
      ))}
    </div>
  );
}

function stepsFromRaw(rawSteps: { key: string; name: string; at: string | null; tone?: TimelineStep['tone'] }[]): TimelineStep[] {
  let firstPending = -1;
  return rawSteps
    .map((s, idx) => {
      const done = !!s.at;
      if (!done && firstPending === -1) firstPending = idx;
      return { key: s.key, name: s.name, done, at: s.at, tone: s.tone || null };
    })
    .map((s, idx) => ({ ...s, current: idx === firstPending }));
}

/** Mirrors ClientService.getTimeline's documentItems step-building (crm-be/src/services/ClientService.js). */
export function documentTimelineSteps(doc: any): TimelineStep[] {
  const events = Array.isArray(doc?.events) ? doc.events : [];
  const byEvent: Record<string, any> = {};
  for (const ev of events) if (!byEvent[ev.event]) byEvent[ev.event] = ev;
  const decisionDone = ['approved', 'rejected', 'expired'].includes(doc.status);
  const decisionName = doc.status === 'rejected' ? 'Rejected' : doc.status === 'expired' ? 'Expired' : 'Approved';
  return stepsFromRaw([
    { key: 'created', name: 'Created', at: byEvent.created?.createdAt || doc.createdAt },
    { key: 'sent', name: 'Sent', at: byEvent.sent?.createdAt || doc.sentAt || null },
    { key: 'viewed', name: 'Viewed', at: byEvent.viewed?.createdAt || doc.viewedAt || null },
    {
      key: 'decision',
      name: decisionName,
      at: decisionDone ? (byEvent[doc.status]?.createdAt || doc.respondedAt || doc.updatedAt) : null,
      tone: doc.status === 'rejected' ? 'negative' : doc.status === 'expired' ? 'neutral' : 'positive',
    },
  ]);
}

/** Mirrors ClientService.getTimeline's invoiceItems step-building (crm-be/src/services/ClientService.js). */
export function invoiceTimelineSteps(inv: any): TimelineStep[] {
  const paidTimestamps = (inv?.payments || []).map((p: any) => p.paidAt).filter(Boolean).sort();
  const lastPaymentAt = paidTimestamps[paidTimestamps.length - 1] || null;
  const finalName = inv.status === 'void' ? 'Void'
    : inv.status === 'overdue' ? 'Overdue'
    : inv.status === 'payment_review' ? 'Payment Review'
    : 'Paid';
  const finalAt = inv.status === 'paid' ? (lastPaymentAt || inv.updatedAt)
    : inv.status === 'void' ? inv.updatedAt
    : null;
  const finalTone: TimelineStep['tone'] = inv.status === 'paid' ? 'positive'
    : inv.status === 'void' ? 'neutral'
    : inv.status === 'overdue' ? 'negative'
    : null;
  return stepsFromRaw([
    { key: 'created', name: 'Created', at: inv.createdAt },
    { key: 'sent', name: 'Sent', at: inv.status !== 'draft' ? (inv.issuedAt || inv.createdAt) : null },
    { key: 'paid', name: finalName, at: finalAt, tone: finalTone },
  ]);
}
