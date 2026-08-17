'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, XCircle, Clock, TrendingUp,
  Download, Paperclip, AlertTriangle, ChevronRight, Package,
} from 'lucide-react';
import { usePortalStore } from '@/store/portal';
import { cn, formatDate } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

function portalFetch(path: string, token: string, options?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: r.status });
    return data;
  });
}

export default function PortalProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = usePortalStore();
  const qc = useQueryClient();
  const [rejectNote, setRejectNote] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['portal-project', id],
    queryFn: () => portalFetch(`/portal/projects/${id}`, token!),
    enabled: !!token,
  });

  const approve = useMutation({
    mutationFn: () => portalFetch(`/portal/projects/${id}/approve`, token!, {
      method: 'POST',
      body: JSON.stringify({ note: 'Approved via client portal' }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-project', id] });
      qc.invalidateQueries({ queryKey: ['portal-projects'] });
      setActionMsg({ type: 'success', text: 'Approved! The project will advance to the next stage.' });
    },
    onError: (e: any) => setActionMsg({ type: 'error', text: e.message }),
  });

  const reject = useMutation({
    mutationFn: () => portalFetch(`/portal/projects/${id}/reject`, token!, {
      method: 'POST',
      body: JSON.stringify({ note: rejectNote || 'Rejected via client portal' }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-project', id] });
      qc.invalidateQueries({ queryKey: ['portal-projects'] });
      setShowRejectForm(false);
      setActionMsg({ type: 'success', text: 'Feedback sent. The project will be sent back for revision.' });
    },
    onError: (e: any) => setActionMsg({ type: 'error', text: e.message }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-4 w-24 bg-gray-200 rounded" />
        <div className="h-32 bg-white rounded-2xl border border-gray-200" />
        <div className="h-48 bg-white rounded-2xl border border-gray-200" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-gray-400">Project not found.</p>
      </div>
    );
  }

  const { project, keywords = [], artifacts = [] } = data;
  const stages: any[] = project.template?.stages || [];
  const currentStageIdx = stages.findIndex((s: any) => s.key === project.currentStageKey);
  const currentStage = stages[currentStageIdx];
  const isApprovalStage = currentStage?.stageType === 'approval' && currentStage?.ownerRoleSlot?.toLowerCase().includes('client');
  const progress = stages.length > 0 ? Math.round(((currentStageIdx + 1) / stages.length) * 100) : 0;
  const isComplete = project.status === 'completed';

  // Only show deliverables from the work stage immediately preceding the current client approval stage.
  // Clients must never see wireframes, rejected designs, or internal-stage artifacts.
  const clientDeliverables = (() => {
    if (!isApprovalStage && !isComplete) return [];
    // Find the last work stage before the current (or last) stage
    const refIdx = isComplete ? stages.length - 1 : currentStageIdx;
    let precedingWorkKey: string | null = null;
    for (let i = refIdx - 1; i >= 0; i--) {
      if (stages[i]?.stageType === 'work') { precedingWorkKey = stages[i].key; break; }
    }
    if (!precedingWorkKey) return [];
    return (artifacts as any[]).filter((a: any) => a.stageKey === precedingWorkKey);
  })();

  function toAbsoluteUrl(url: string) {
    const t = (url || '').trim();
    return /^https?:\/\//i.test(t) ? t : `https://${t}`;
  }

  return (
    <div className="space-y-6">

      {/* ── Back ── */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to overview
      </button>

      {/* ── Project header card ── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                {project.name}
              </h1>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="text-sm text-gray-400">{project.template?.name || project.serviceTypeKey}</span>
                {project.package?.name && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-brand-50 text-brand-800 border border-brand-100">
                    <Package className="w-3 h-3" />
                    {project.package.name}
                  </span>
                )}
              </div>
            </div>
            <span className={cn(
              'shrink-0 px-3 py-1.5 text-xs font-semibold rounded-full',
              isComplete ? 'bg-brand-50 text-brand-800 border border-brand-100' :
              isApprovalStage ? 'bg-amber-50 text-amber-700 border border-amber-100' :
              project.status === 'on_hold' ? 'bg-amber-50 text-amber-600' :
              'bg-blue-50 text-blue-700 border border-blue-100',
            )}>
              {project.status.replace('_', ' ')}
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-3 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500">
                Current: <strong className="text-gray-700">{currentStage?.name || project.currentStageKey || '—'}</strong>
              </span>
              <span className="text-sm font-bold text-gray-500" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {progress}%
              </span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: isComplete ? '#0B1D5E' : isApprovalStage ? '#F59E0B' : '#0B1D5E',
                }}
              />
            </div>
          </div>

          {/* Stage stepper */}
          {stages.length > 0 && (
            <div className="flex items-center gap-0 overflow-x-auto pb-1">
              {stages.map((s: any, i: number) => {
                const isDone = i < currentStageIdx;
                const isCurrent = i === currentStageIdx;
                const isPending = i > currentStageIdx;
                return (
                  <div key={s.key} className="flex items-center shrink-0">
                    <div className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all',
                      isDone ? 'bg-brand-50 text-brand-800' :
                      isCurrent && s.stageType === 'approval' ? 'bg-amber-50 text-amber-700 border border-amber-200 shadow-sm' :
                      isCurrent ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm' :
                      'text-gray-300',
                    )}>
                      {isDone && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                      {isCurrent && s.stageType === 'approval' && <Clock className="w-3 h-3 shrink-0" />}
                      {isCurrent && s.stageType !== 'approval' && (
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      )}
                      {s.name}
                    </div>
                    {i < stages.length - 1 && (
                      <ChevronRight className="w-3.5 h-3.5 text-gray-200 mx-0.5 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Approval panel ── */}
      {isApprovalStage && !actionMsg && (
        <div className="bg-amber-50 rounded-xl border border-amber-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-amber-100 flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Your approval is needed</p>
              <p className="text-xs text-amber-600 mt-0.5">Review the deliverables below, then approve or request changes.</p>
            </div>
          </div>

          <div className="px-5 py-4">
            {showRejectForm ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wider">
                    What needs to change?
                  </label>
                  <textarea
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                    rows={4}
                    placeholder="Describe the revisions you'd like…"
                    className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none transition-colors"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => reject.mutate()}
                    disabled={reject.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-60 rounded-xl transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    {reject.isPending ? 'Sending…' : 'Request Changes'}
                  </button>
                  <button
                    onClick={() => setShowRejectForm(false)}
                    className="px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                  className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: '#0B1D5E' }}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {approve.isPending ? 'Approving…' : 'Approve this stage'}
                </button>
                <button
                  onClick={() => setShowRejectForm(true)}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <XCircle className="w-4 h-4" />
                  Request changes
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Action result ── */}
      {actionMsg && (
        <div className={cn(
          'rounded-2xl px-6 py-4 flex items-center gap-3',
          actionMsg.type === 'success' ? 'bg-brand-50 border border-brand-200' : 'bg-red-50 border border-red-200',
        )}>
          {actionMsg.type === 'success'
            ? <CheckCircle2 className="w-5 h-5 text-brand-700 shrink-0" />
            : <XCircle className="w-5 h-5 text-red-500 shrink-0" />}
          <p className={cn('text-sm font-medium', actionMsg.type === 'success' ? 'text-brand-900' : 'text-red-700')}>
            {actionMsg.text}
          </p>
        </div>
      )}

      {/* ── Deliverables — only shown during a client-facing approval stage ── */}
      {clientDeliverables.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-800">Deliverables for your review</h2>
            <span className="text-xs text-gray-400 ml-auto">{clientDeliverables.length} file{clientDeliverables.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-gray-50">
            {clientDeliverables.map((a: any) => {
              const isLink = a.kind === 'figma' || a.kind === 'link';
              const href = isLink ? toAbsoluteUrl(a.fileUrl) : a.fileUrl;
              const label = a.fileName && a.fileName !== a.fileUrl ? a.fileName : (isLink ? a.fileUrl : a.fileUrl?.split('/').pop() || 'File');
              return (
                <div key={a.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50/50 transition-colors">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Paperclip className="w-4 h-4 text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{a.createdAt ? formatDate(a.createdAt) : '—'}</p>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl transition-colors border shrink-0"
                    style={{ color: '#0B1D5E', borderColor: '#d5dcf0', background: '#eef1f9' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isLink ? 'Open' : 'Download'}
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SEO Keywords (active focus targets only) ── */}
      {(() => {
        const activeKeywords = (keywords as any[]).filter((kw: any) => (kw.status || 'active') === 'active');
        if (!activeKeywords.length) return null;
        return (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-800">Keyword Targets</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-6 py-3">Keyword</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-5 py-3">KD</th>
                  <th className="text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-5 py-3">Volume</th>
                  <th className="text-left text-[10px] font-semibold uppercase tracking-wider text-gray-400 px-5 py-3">Page</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {activeKeywords.map((kw: any) => (
                  <tr key={kw.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-6 py-3.5 text-sm font-medium text-gray-900">{kw.primaryKeyword}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>{kw.kd ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500 text-right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {kw.volume ? kw.volume.toLocaleString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">{kw.pageName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        );
      })()}

    </div>
  );
}
