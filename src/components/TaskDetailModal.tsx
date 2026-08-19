'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  X, CheckCircle, Upload, Paperclip, XCircle, Send,
  CircleDot, User, Users, Flag, Calendar, Bell, FileText, History,
  ExternalLink,
} from 'lucide-react';
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Linkify from '@/components/Linkify';
import ActiveToggle from '@/components/ActiveToggle';
import Avatar from '@/components/Avatar';
import { cn, formatDate, uploadErrorMessage, titleCase, formatFileSize } from '@/lib/utils';
import { invalidateMany, afterTaskChange } from '@/lib/queryInvalidation';
import { useAuthStore } from '@/store/auth';

const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  submitted: 'bg-amber-100 text-amber-700',
  in_review: 'bg-violet-100 text-violet-700',
  approved: 'bg-brand-100 text-brand-800',
  rejected: 'bg-red-100 text-red-700',
  done: 'bg-brand-100 text-brand-800',
};

const TYPE_LABELS: Record<string, string> = {
  content: 'Content',
  blog_post: 'Blog',
  custom: 'Custom',
  issue: 'Issue',
};

function MetaRow({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  children: ReactNode;
}) {
  // Stacked on phones, side-by-side from sm up. A fixed 7.5rem label column ate
  // a third of a phone-width dialog, leaving values like "Aug 28, 2026" and its
  // "24h before due" note to wrap into a ragged two-line column.
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:gap-3 min-w-0">
      <div className="flex items-center gap-2 sm:w-[7.5rem] shrink-0 sm:pt-0.5">
        <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className="min-w-0 flex-1 pl-5 sm:pl-0 text-sm text-gray-900">{children}</div>
    </div>
  );
}

/**
 * One node on the activity timeline: the marker sitting on the rail, the event
 * description, and when it happened.
 *
 * The marker is given an opaque ring so the rail appears to pass behind it
 * rather than through it — without that the connecting line cuts across every
 * avatar and the whole column reads as noise.
 */
function TimelineRow({
  node,
  when,
  children,
}: {
  node: ReactNode;
  when?: string | null;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <div className="relative z-10 shrink-0 rounded-full ring-4 ring-gray-50/40 bg-gray-50/40">
        {node}
      </div>
      <div className="min-w-0 flex-1 -mt-0.5">
        {children}
        {when && (
          <p className="text-[11px] text-gray-400 mt-1">
            {formatDate(when, 'MMM d, yyyy · h:mm a')}
          </p>
        )}
      </div>
    </li>
  );
}

export default function TaskDetailModal({
  projectId,
  taskId,
  onClose,
  /** When true (e.g. opened from /tasks), offer a jump into the project with this dialog. */
  allowOpenInProject = false,
}: {
  projectId: string;
  taskId: string;
  onClose: () => void;
  allowOpenInProject?: boolean;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [uploading, setUploading] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [auditNote, setAuditNote] = useState('');
  const [showAuditReject, setShowAuditReject] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: task, isLoading } = useQuery({
    queryKey: ['task-detail', projectId, taskId],
    queryFn: () => api.get(`/projects/${projectId}/tasks/${taskId}`).then((r) => r.data),
  });

  const { data: projectBrief } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get(`/projects/${projectId}`).then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: artifacts = [] } = useQuery({
    queryKey: ['task-artifacts', taskId],
    queryFn: () => api.get('/media/artifacts', { params: { taskId } }).then((r) => r.data),
  });

  const transition = useMutation({
    mutationFn: ({ status, note }: { status: string; note?: string }) =>
      api.patch(`/projects/${projectId}/tasks/${taskId}/status`, { status, note }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['task-detail', projectId, taskId],
        ...afterTaskChange(projectId),
      ]);
      setShowReject(false);
      setRejectNote('');
      const labels: Record<string, string> = {
        submitted: 'Submitted for review.',
        approved: 'Task approved — done.',
        rejected: 'Changes requested — assignee can revise and resubmit.',
        done: 'Task marked complete.',
        in_progress: 'Task moved to in progress.',
      };
      toast.success(labels[vars.status] || 'Task updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update task.'),
  });

  const auditDecision = useMutation({
    mutationFn: ({ approve, note }: { approve: boolean; note?: string }) =>
      api.post(`/projects/${projectId}/tasks/${taskId}/audit-${approve ? 'approve' : 'reject'}`, approve ? undefined : { note })
        .then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['task-detail', projectId, taskId],
        ...afterTaskChange(projectId),
      ]);
      setShowAuditReject(false);
      setAuditNote('');
      toast.success(vars.approve ? 'Technical audit approved — assignee notified.' : 'Technical audit rejected.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update technical audit status.'),
  });

  // Deactivates rather than destroys — the stored file stays reachable for anyone
  // holding its link (see cadence-be/src/services/SoftDeleteService.js).
  const deleteArtifact = useMutation({
    mutationFn: (fileUrl: string) => {
      const filename = fileUrl.split('/').pop() as string;
      return api.delete(`/media/${encodeURIComponent(filename)}`).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-artifacts', taskId] });
      toast.success('File set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || e?.response?.data?.message || 'Failed to change file status.'),
  });

  async function uploadFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      list.forEach((file) => fd.append('file', file));
      fd.append('taskId', taskId);
      fd.append('projectId', projectId);
      fd.append('stageKey', task?.stageKey || 'general');
      await api.post('/media/upload-multi', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(list.length > 1 ? `${list.length} files uploaded.` : 'File uploaded.');
      qc.invalidateQueries({ queryKey: ['task-artifacts', taskId] });
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally { setUploading(false); }
  }

  // Files uploaded by whoever assigned the task (kind: 'brief') are reference
  // material; everything else is work handed back. Keeping them apart stops a
  // brief from reading as "the deliverable is already done".
  const briefFiles = (artifacts as any[]).filter((a: any) => a.kind === 'brief');
  const deliverableFiles = (artifacts as any[]).filter((a: any) => a.kind !== 'brief');

  const isDone = task?.status === 'done' || task?.status === 'approved';
  const isAssignee = !!user?.id && task?.assigneeId === user.id;
  const isAdmin = user?.role?.key === 'super_admin' || user?.role?.key === 'admin'
    || !!user?.role?.permissions?.['projects.manage'];
  // Assigner (creator) is the default reviewer when User A hands work to User B.
  const effectiveReviewerId = task?.reviewerId || task?.createdBy || null;
  const usesReviewPipeline = !!(
    task?.assigneeId
    && effectiveReviewerId
    && effectiveReviewerId !== task.assigneeId
  );
  const isEffectiveReviewer = !!user?.id && effectiveReviewerId === user.id;
  const myProjectSlots: string[] = (projectBrief?.assignments || [])
    .filter((a: any) => a.user?.id === user?.id)
    .map((a: any) => a.roleSlot);
  const canReview = usesReviewPipeline && (
    isAdmin
    || isEffectiveReviewer
    || myProjectSlots.includes('project_strategist')
    || myProjectSlots.includes('project_manager')
  ) && !isAssignee;
  const canSubmit = usesReviewPipeline
    && (isAssignee || isAdmin)
    && ['todo', 'in_progress', 'rejected'].includes(task?.status || '');
  const awaitingReview = usesReviewPipeline && ['submitted', 'in_review'].includes(task?.status || '');
  // Self-assigned / no reviewer — single-owner complete (no submit/review).
  const canMarkComplete = !usesReviewPipeline
    && !isDone
    && (isAssignee || isAdmin || isEffectiveReviewer);
  const awaitingAudit = !!task?.requiresTechnicalAudit && task?.auditStatus === 'pending';

  // Backend returns events oldest→newest. Keep that for the timeline; only the
  // latest event is needed for the duplicate "Approved/Completed" footer guard.
  const events = Array.isArray(task?.events)
    ? [...task.events].sort((a: any, b: any) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      })
    : [];
  const lastEvent = events[events.length - 1];
  const lastEventShowsFinished = lastEvent && ['approved', 'done'].includes(lastEvent.toStatus);
  const completionLabel = task?.status === 'approved' ? 'Approved' : 'Completed';
  const typeLabel = TYPE_LABELS[task?.type] || (task?.type ? titleCase(task.type) : 'Task');
  const breadcrumb = [
    task?.project?.client?.name,
    task?.project?.name,
    task?.stageKey ? titleCase(task.stageKey) : null,
  ].filter(Boolean).join(' / ');

  const showActions = !!task && !isDone && (
    canSubmit || (awaitingReview && canReview) || canMarkComplete || showReject
    || (awaitingAudit && isAdmin) || showAuditReject
  );

  const reviewerDisplay = task?.reviewer?.name
    || (task?.createdBy && task.createdBy === effectiveReviewerId ? task.creator?.name : null)
    || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-5 sm:px-6 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {breadcrumb && (
              <p className="text-[11px] font-medium text-gray-400 tracking-wide truncate mb-1.5">
                {breadcrumb}
              </p>
            )}
            {/* Title gets its own line and wraps. Sharing a row with the type
                pill left it barely half the dialog wide, so a normal task name
                truncated to "Install Websit…" — the one thing you most need to
                read. The pill is the same value shown in the Type row below, so
                it drops out entirely on phones. */}
            <div className="min-w-0">
              <span className="hidden sm:inline-flex items-center gap-1 shrink-0 px-2 py-0.5 mr-2 align-middle rounded-md bg-gray-50 border border-gray-200 text-[11px] font-medium text-gray-600">
                <Flag className="w-3 h-3 text-brand-700" />
                {isLoading ? '…' : typeLabel}
              </span>
              <h2 className="inline text-base sm:text-xl font-semibold text-gray-900 tracking-tight break-words">
                {isLoading ? 'Loading…' : task?.title}
              </h2>
            </div>
            {allowOpenInProject && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push(`/projects/${projectId}?tab=overview&task=${taskId}`);
                }}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 hover:text-brand-900 hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                Open inside project
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-50 rounded-lg shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {isLoading && (
          <div className="flex-1 flex items-center justify-center py-16">
            <p className="text-sm text-gray-400">Loading task…</p>
          </div>
        )}

        {!isLoading && task && (
          <>
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
              {/* Main column */}
              <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-6">
                {/* Metadata grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5">
                  <MetaRow icon={CircleDot} label="Status">
                    <span className={cn('inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full', STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-500')}>
                      {titleCase(task.status || 'todo')}
                    </span>
                    {awaitingAudit && (
                      <span className="ml-2 inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                        Awaiting technical audit
                      </span>
                    )}
                    {task.requiresTechnicalAudit && task.auditStatus === 'rejected' && (
                      <span className="ml-2 inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                        Technical audit rejected
                      </span>
                    )}
                  </MetaRow>
                  <MetaRow icon={User} label="Assignee">
                    {task.assignee?.name ? (
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="xs" />
                        <span className="truncate font-medium">{task.assignee.name}</span>
                      </span>
                    ) : awaitingAudit && task.pendingAssignee?.name ? (
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Avatar name={task.pendingAssignee.name} src={task.pendingAssignee.avatarUrl} size="xs" />
                        <span className="truncate text-gray-500">Pending: {task.pendingAssignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">Unassigned</span>
                    )}
                  </MetaRow>
                  <MetaRow icon={Users} label="Reviewer">
                    {usesReviewPipeline && reviewerDisplay ? (
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <Avatar
                          name={reviewerDisplay}
                          src={task.reviewer?.avatarUrl || (task.createdBy === effectiveReviewerId ? task.creator?.avatarUrl : undefined)}
                          size="xs"
                        />
                        <span className="truncate font-medium">{reviewerDisplay}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </MetaRow>
                  <MetaRow icon={Calendar} label="Due date">
                    {task.dueAt ? (
                      <span className="font-medium">{formatDate(task.dueAt)}</span>
                    ) : (
                      <span className="text-gray-400">No due date</span>
                    )}
                  </MetaRow>
                  <MetaRow icon={Bell} label="Reminder">
                    {task.reminderAt ? (
                      <span
                        className="inline-flex flex-wrap items-baseline gap-x-1.5 text-amber-800"
                        title="Automatic reminder — sent 24 hours before due date"
                      >
                        <span className="font-medium whitespace-nowrap">{formatDate(task.reminderAt)}</span>
                        <span className="text-[11px] text-amber-600/80 whitespace-nowrap">24h before due</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </MetaRow>
                  <MetaRow icon={Flag} label="Type">
                    <span className="font-medium">{typeLabel}</span>
                    {task.pageName && (
                      <span className="block text-xs text-gray-500 mt-0.5 truncate" title={task.pageName}>
                        Page: {task.pageName}
                      </span>
                    )}
                  </MetaRow>
                </div>

                {/* Description */}
                <section>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                    Description
                  </p>
                  {task.remarks ? (
                    <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3 min-w-0">
                      <Linkify text={task.remarks} className="block text-sm text-gray-700 whitespace-pre-wrap" />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center">
                      No description added for this task.
                    </p>
                  )}
                </section>

                {/* Brief attachments */}
                {briefFiles.length > 0 && (
                  <section>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5 mb-2">
                      <Paperclip className="w-3.5 h-3.5 text-brand-700" />
                      Brief from {task.creator?.name || 'assigner'}
                    </p>
                    <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 space-y-1.5">
                      {briefFiles.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-2 py-1.5 px-2.5 bg-white rounded-lg border border-brand-100/80">
                          <Paperclip className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                          <a
                            href={a.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-brand-800 hover:underline truncate flex-1 min-w-0"
                          >
                            {a.fileName && a.fileName !== a.fileUrl ? a.fileName : a.fileUrl}
                          </a>
                          <span className="text-[11px] text-gray-400 shrink-0">
                            {formatFileSize(a.fileSize)}
                            {a.createdAt ? ` · ${formatDate(a.createdAt, 'MMM d')}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Deliverable */}
                <section>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider flex items-center gap-1.5">
                      <Upload className="w-3.5 h-3.5 text-gray-400" />
                      Deliverable
                    </p>
                    <input
                      ref={fileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) uploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploading || isDone}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {uploading ? 'Uploading…' : 'Attach file'}
                    </button>
                  </div>
                  {deliverableFiles.length > 0 ? (
                    <div className="rounded-xl border border-gray-200 p-3 space-y-1.5">
                      {deliverableFiles.map((a: any) => (
                        <div key={a.id} className="flex items-center gap-2 py-1.5 px-2.5 bg-gray-50 rounded-lg border border-gray-100">
                          <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <a
                            href={a.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm text-gray-800 hover:text-brand-700 hover:underline truncate flex-1 min-w-0"
                          >
                            {a.fileName && a.fileName !== a.fileUrl ? a.fileName : a.fileUrl}
                          </a>
                          <span className="text-[11px] text-gray-400 shrink-0 hidden sm:inline">
                            {a.uploader?.name}
                            {a.fileSize ? ` · ${formatFileSize(a.fileSize)}` : ''}
                            {a.createdAt ? ` · ${formatDate(a.createdAt, 'MMM d')}` : ''}
                          </span>
                          {!isDone && (
                            <ActiveToggle
                              isActive
                              label="file"
                              disabled={deleteArtifact.isPending}
                              onToggle={() => deleteArtifact.mutate(a.fileUrl)}
                              className="p-0.5 shrink-0"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 rounded-xl border border-dashed border-gray-200 px-4 py-5 text-center">
                      No deliverable uploaded yet.
                    </p>
                  )}
                </section>
              </div>

              {/* Activity rail */}
              <aside className="lg:w-[320px] xl:w-[340px] shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100 flex flex-col min-h-0 bg-gray-50/40">
                <div className="shrink-0 px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                  <History className="w-3.5 h-3.5 text-gray-400" />
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Activity</p>
                </div>
                {/*
                  A true timeline rather than a stack of cards: one continuous
                  rail with a node per event. The previous flat list made it hard
                  to tell how far apart two moves were, or read the task's path
                  through review at a glance — which is the whole point of an
                  activity trail.
                */}
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  <ol className="relative">
                    {/* The rail. Inset to sit under the centre of each node, and
                        stopped short of the last row so it doesn't dangle. */}
                    <span
                      aria-hidden
                      className="absolute left-[13px] top-2 bottom-4 w-px bg-gray-200"
                    />

                    <TimelineRow
                      node={<Avatar name={task.creator?.name} src={task.creator?.avatarUrl} size="xs" />}
                      when={task.createdAt}
                    >
                      <p className="text-xs text-gray-700">
                        <strong className="font-semibold text-gray-900">{task.creator?.name || 'Someone'}</strong>
                        {' '}created this task
                      </p>
                    </TimelineRow>

                    {events.map((ev: any) => (
                      <TimelineRow
                        key={ev.id}
                        node={<Avatar name={ev.actor?.name} src={ev.actor?.avatarUrl} size="xs" />}
                        when={ev.createdAt}
                      >
                        <p className="text-xs text-gray-700">
                          <strong className="font-semibold text-gray-900">{ev.actor?.name || 'System'}</strong>
                          {' '}moved to{' '}
                          <span className={cn('inline-flex px-1.5 py-0.5 text-[10px] font-medium rounded-full align-middle', STATUS_COLORS[ev.toStatus] || 'bg-gray-100 text-gray-500')}>
                            {titleCase(ev.toStatus)}
                          </span>
                        </p>
                        {ev.note && (
                          <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap rounded-lg bg-white border border-gray-100 px-2.5 py-1.5">
                            {ev.note}
                          </p>
                        )}
                      </TimelineRow>
                    ))}

                    {task.completedAt && !lastEventShowsFinished && (
                      <TimelineRow
                        when={task.completedAt}
                        node={(
                          <div className="w-7 h-7 rounded-full bg-brand-100 ring-2 ring-gray-50 flex items-center justify-center">
                            <CheckCircle className="w-3.5 h-3.5 text-brand-700" />
                          </div>
                        )}
                      >
                        <p className="text-xs font-semibold text-gray-900">{completionLabel}</p>
                      </TimelineRow>
                    )}
                  </ol>

                  {!task.completedAt && task.updatedAt && task.updatedAt !== task.createdAt && events.length === 0 && (
                    <p className="text-[11px] text-gray-400 pl-9 mt-1">
                      Last updated {formatDate(task.updatedAt, 'MMM d, yyyy · h:mm a')}
                    </p>
                  )}
                </div>
              </aside>
            </div>

            {/* Sticky actions */}
            {showActions && (
              <div className="shrink-0 border-t border-gray-100 px-5 sm:px-6 py-3.5 bg-white">
                {showAuditReject ? (
                  <div className="space-y-2.5">
                    <textarea
                      value={auditNote}
                      onChange={(e) => setAuditNote(e.target.value)}
                      rows={2}
                      placeholder="Why is this technical audit being rejected? (optional but recommended)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={auditDecision.isPending}
                        onClick={() => auditDecision.mutate({ approve: false, note: auditNote.trim() || undefined })}
                        className="inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <XCircle className="w-4 h-4" />
                        Reject technical audit
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowAuditReject(false)}
                        className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : awaitingAudit && isAdmin ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => auditDecision.mutate({ approve: true })}
                      disabled={auditDecision.isPending}
                      className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                    >
                      <CheckCircle className="w-4 h-4" />
                      Approve technical audit
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAuditReject(true)}
                      disabled={auditDecision.isPending}
                      className="inline-flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-700 text-sm font-medium px-4 py-2 rounded-lg border border-red-200"
                    >
                      <XCircle className="w-4 h-4" />
                      Reject
                    </button>
                  </div>
                ) : showReject ? (
                  <div className="space-y-2.5">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      rows={2}
                      placeholder="What should they change? (optional but recommended)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={transition.isPending}
                        onClick={() => transition.mutate({ status: 'rejected', note: rejectNote.trim() || undefined })}
                        className="inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <XCircle className="w-4 h-4" />
                        Send back for changes
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowReject(false)}
                        className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {canSubmit && (
                      <button
                        type="button"
                        onClick={() => transition.mutate({ status: 'submitted' })}
                        disabled={transition.isPending}
                        className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <Send className="w-4 h-4" />
                        {task.status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
                      </button>
                    )}
                    {awaitingReview && canReview && (
                      <>
                        <button
                          type="button"
                          onClick={() => transition.mutate({ status: 'approved' })}
                          disabled={transition.isPending}
                          className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                        >
                          <CheckCircle className="w-4 h-4" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowReject(true)}
                          disabled={transition.isPending}
                          className="inline-flex items-center gap-1.5 bg-white hover:bg-red-50 text-red-700 text-sm font-medium px-4 py-2 rounded-lg border border-red-200"
                        >
                          <XCircle className="w-4 h-4" />
                          Request changes
                        </button>
                      </>
                    )}
                    {canMarkComplete && (
                      <button
                        type="button"
                        onClick={() => transition.mutate({ status: 'done' })}
                        disabled={transition.isPending}
                        className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <CheckCircle className="w-4 h-4" />
                        Mark Complete
                      </button>
                    )}
                    {awaitingReview && isAssignee && !canReview && (
                      <p className="text-xs text-gray-500">Submitted — waiting for {reviewerDisplay || 'reviewer'} to approve.</p>
                    )}
                    {awaitingReview && !canReview && !isAssignee && (
                      <p className="text-xs text-gray-500">Waiting for reviewer approval.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
