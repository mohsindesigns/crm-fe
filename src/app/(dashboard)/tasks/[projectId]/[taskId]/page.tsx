'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle, Upload, Paperclip, XCircle, Send, X,
  User, Users, Calendar, FileText, History, ThumbsUp, AlertTriangle, Building2,
  Clock, Hourglass, ShieldCheck,
} from 'lucide-react';
import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Linkify from '@/components/Linkify';
import ActiveToggle from '@/components/ActiveToggle';
import Avatar from '@/components/Avatar';
import { cn, formatDate, uploadErrorMessage, titleCase, formatFileSize } from '@/lib/utils';
import { invalidateMany, afterTaskChange } from '@/lib/queryInvalidation';
import { useAuthStore } from '@/store/auth';

const STATUS_COLORS: Record<string, string> = {
  todo: 'bg-gray-100 text-gray-600',
  accepted: 'bg-cyan-100 text-cyan-700',
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
  blog_image: 'Blog Image',
  custom: 'Custom',
  issue: 'Issue',
};

/**
 * Tones for the one-line "what is expected of whom, right now" banner. That
 * banner is the main readability win over the old dialog, where the current
 * state had to be reverse-engineered from a status pill, a reviewer row and the
 * activity trail.
 */
const HINT_TONES: Record<string, { wrap: string; icon: string }> = {
  neutral: { wrap: 'bg-gray-50 border-gray-200 text-gray-700', icon: 'text-gray-400' },
  action: { wrap: 'bg-blue-50 border-blue-200 text-blue-900', icon: 'text-blue-600' },
  waiting: { wrap: 'bg-amber-50 border-amber-200 text-amber-900', icon: 'text-amber-600' },
  danger: { wrap: 'bg-red-50 border-red-200 text-red-900', icon: 'text-red-600' },
  done: { wrap: 'bg-brand-50 border-brand-200 text-brand-900', icon: 'text-brand-700' },
};

/** A labelled value in the people/dates strip — label above, value below. */
function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </p>
      <div className="mt-1.5 text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  );
}

/** A titled white panel — the page body is built from these, not bare sections. */
function Panel({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3 border-b border-gray-100">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
          <Icon className="w-3.5 h-3.5 text-gray-400" />
          {title}
        </p>
        {action}
      </div>
      <div className="px-4 sm:px-5 py-4">{children}</div>
    </section>
  );
}

/** Empty states are a quiet line of text — the old dashed boxes were louder
 *  than the content they stood in for. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-gray-400">{children}</p>;
}

/**
 * One node on the activity timeline: the marker sitting on the rail, the event
 * description, and when it happened. The marker gets an opaque ring so the rail
 * appears to pass behind it rather than through it — without that the connecting
 * line cuts across every avatar and the column reads as noise.
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
      <div className="relative z-10 shrink-0 rounded-full ring-4 ring-white bg-white">{node}</div>
      <div className="min-w-0 flex-1 -mt-0.5">
        {children}
        {when && (
          <p className="text-[11px] text-gray-400 mt-1">{formatDate(when, 'MMM d, yyyy · h:mm a')}</p>
        )}
      </div>
    </li>
  );
}

function FileRow({
  file,
  tone = 'plain',
  children,
}: {
  file: any;
  tone?: 'plain' | 'brief';
  children?: ReactNode;
}) {
  const meta = [
    file.uploader?.name,
    file.fileSize ? formatFileSize(file.fileSize) : null,
    file.createdAt ? formatDate(file.createdAt, 'MMM d') : null,
  ].filter(Boolean).join(' · ');

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border px-3 py-2',
        tone === 'brief' ? 'border-brand-100 bg-brand-50/40' : 'border-gray-100 bg-gray-50',
      )}
    >
      <Paperclip className={cn('w-3.5 h-3.5 shrink-0', tone === 'brief' ? 'text-brand-600' : 'text-gray-400')} />
      <a
        href={file.fileUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'text-sm truncate flex-1 min-w-0 hover:underline',
          tone === 'brief' ? 'text-brand-800' : 'text-gray-800 hover:text-brand-700',
        )}
      >
        {file.fileName && file.fileName !== file.fileUrl ? file.fileName : file.fileUrl}
      </a>
      {meta && <span className="text-[11px] text-gray-400 shrink-0 hidden sm:inline">{meta}</span>}
      {children}
    </div>
  );
}

export default function TaskDetailPage() {
  const params = useParams();
  const projectId = String(params.projectId);
  const taskId = String(params.taskId);

  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [uploading, setUploading] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [auditNote, setAuditNote] = useState('');
  const [showAuditReject, setShowAuditReject] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // File attachments for the "Send back for changes" note — uploaded eagerly to
  // /media/upload as they're picked, then linked to the TaskEvent by id once the
  // rejection is actually sent.
  const [rejectFiles, setRejectFiles] = useState<any[]>([]);
  const [rejectUploading, setRejectUploading] = useState(false);
  const rejectFileRef = useRef<HTMLInputElement>(null);

  const { data: task, isLoading, isError } = useQuery({
    queryKey: ['task-detail', projectId, taskId],
    queryFn: () => api.get(`/projects/${projectId}/tasks/${taskId}`).then((r) => r.data),
    retry: false,
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
    mutationFn: ({ status, note, attachmentIds }: { status: string; note?: string; attachmentIds?: string[] }) =>
      api.patch(`/projects/${projectId}/tasks/${taskId}/status`, { status, note, attachmentIds }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['task-detail', projectId, taskId],
        ...afterTaskChange(projectId),
      ]);
      setShowReject(false);
      setRejectNote('');
      setRejectFiles([]);
      const labels: Record<string, string> = {
        accepted: 'Task accepted — you can now begin work.',
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
  // holding its link (see crm-be/src/services/SoftDeleteService.js).
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
      // A deliverable on a blog task is mirrored onto the project's Blogs tab as
      // soon as it lands (services/BlogSheetSync.js) — refetch so the File column
      // there isn't stale if the user switches straight over.
      qc.invalidateQueries({ queryKey: ['blog-sheet', projectId] });
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally { setUploading(false); }
  }

  // Uploads a single file against this task tagged kind: 'review_note' (kept out
  // of the Deliverable list — see the taskEventId note on Artifact) and returns
  // the created artifact so it can be linked to the note once actually sent.
  async function uploadReviewAttachment(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('taskId', taskId);
    fd.append('projectId', projectId);
    fd.append('stageKey', task?.stageKey || 'general');
    fd.append('kind', 'review_note');
    const res = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    return res.data?.artifact;
  }

  async function onPickRejectFiles(files: FileList | null) {
    if (!files?.length) return;
    setRejectUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(files).map((f) => uploadReviewAttachment(f)));
      setRejectFiles((prev) => [...prev, ...uploaded.filter(Boolean)]);
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setRejectUploading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Task" />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-400">Loading task…</p>
        </div>
      </div>
    );
  }

  if (isError || !task) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Task" />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-gray-500">
            This task could not be found, or you don&apos;t have access to it.
          </p>
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-900"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to tasks
          </Link>
        </div>
      </div>
    );
  }

  // Files uploaded by whoever assigned the task (kind: 'brief') are reference
  // material; everything else is work handed back. Keeping them apart stops a
  // brief from reading as "the deliverable is already done".
  const briefFiles = (artifacts as any[]).filter((a: any) => a.kind === 'brief');
  // review_note attachments (voice/files dropped on a "Send back for changes"
  // note) render inline under that timeline event instead, via task.events.
  const deliverableFiles = (artifacts as any[]).filter((a: any) => a.kind !== 'brief' && a.kind !== 'review_note');

  const isDone = task.status === 'done' || task.status === 'approved';
  const isAssignee = !!user?.id && task.assigneeId === user.id;
  const isAdmin = user?.role?.key === 'super_admin' || user?.role?.key === 'admin'
    || !!user?.role?.permissions?.['projects.manage'];
  // Assigner (creator) is the default reviewer when User A hands work to User B.
  const effectiveReviewerId = task.reviewerId || task.createdBy || null;
  const usesReviewPipeline = !!(
    task.assigneeId
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
  // A task handed to someone other than its creator must be accepted before the
  // assignee can start work — see TaskService#transition's acceptance gate.
  const needsAcceptance = !!(task.assigneeId && task.assigneeId !== task.createdBy);
  const awaitingAcceptance = needsAcceptance && task.status === 'todo';
  const canAccept = awaitingAcceptance && (isAssignee || isAdmin);
  const canSubmit = usesReviewPipeline
    && (isAssignee || isAdmin)
    && ['accepted', 'in_progress', 'rejected'].includes(task.status || '');
  const awaitingReview = usesReviewPipeline && ['submitted', 'in_review'].includes(task.status || '');
  // Self-assigned / no reviewer — single-owner complete (no submit/review).
  const canMarkComplete = !usesReviewPipeline
    && !isDone
    && !awaitingAcceptance
    && (isAssignee || isAdmin || isEffectiveReviewer);
  const awaitingAudit = !!task.requiresTechnicalAudit && task.auditStatus === 'pending';
  const auditRejected = !!task.requiresTechnicalAudit && task.auditStatus === 'rejected';

  // Backend returns events oldest→newest. Keep that for the timeline; only the
  // latest event is needed for the duplicate "Approved/Completed" node guard.
  const events = Array.isArray(task.events)
    ? [...task.events].sort((a: any, b: any) => {
        const ta = new Date(a.createdAt || 0).getTime();
        const tb = new Date(b.createdAt || 0).getTime();
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      })
    : [];
  const lastEvent = events[events.length - 1];
  const lastEventShowsFinished = lastEvent && ['approved', 'done'].includes(lastEvent.toStatus);
  const completionLabel = task.status === 'approved' ? 'Approved' : 'Completed';
  const typeLabel = TYPE_LABELS[task.type] || (task.type ? titleCase(task.type) : 'Task');

  // Pulled up next to the banner while the task sits in "rejected" — the reason
  // for the rebound is the one thing the assignee actually needs, and it used to
  // be buried somewhere in the activity trail.
  const lastRejection = [...events].reverse().find((ev: any) => ev.toStatus === 'rejected');

  const reviewerDisplay = task.reviewer?.name
    || (task.createdBy && task.createdBy === effectiveReviewerId ? task.creator?.name : null)
    || null;

  const overdue = !!task.dueAt && !isDone && new Date(task.dueAt) < new Date(new Date().toDateString());

  const hint: { tone: keyof typeof HINT_TONES; icon: ComponentType<{ className?: string }>; text: string } = (() => {
    if (isDone) {
      return {
        tone: 'done',
        icon: CheckCircle,
        text: task.completedAt
          ? `${completionLabel} on ${formatDate(task.completedAt, 'MMM d, yyyy')}. Nothing further is needed.`
          : `${completionLabel}. Nothing further is needed.`,
      };
    }
    if (auditRejected) {
      return {
        tone: 'danger',
        icon: ShieldCheck,
        text: 'The technical audit was rejected — this task stays unassigned until it is raised again.',
      };
    }
    if (awaitingAudit) {
      return {
        tone: 'waiting',
        icon: ShieldCheck,
        text: isAdmin
          ? `Needs your technical-audit decision before it is assigned${task.pendingAssignee?.name ? ` to ${task.pendingAssignee.name}` : ''}.`
          : 'Waiting for an administrator to approve the technical audit before this is assigned.',
      };
    }
    if (task.status === 'rejected') {
      return {
        tone: 'danger',
        icon: XCircle,
        text: isAssignee
          ? `${reviewerDisplay || 'The reviewer'} asked for changes — revise the work and resubmit.`
          : `Changes were requested — waiting for ${task.assignee?.name || 'the assignee'} to resubmit.`,
      };
    }
    if (awaitingAcceptance) {
      return {
        tone: isAssignee ? 'action' : 'waiting',
        icon: ThumbsUp,
        text: isAssignee
          ? 'Accept this task to confirm you have picked it up and can start work.'
          : `Waiting for ${task.assignee?.name || 'the assignee'} to accept this task.`,
      };
    }
    if (awaitingReview) {
      return {
        tone: canReview ? 'action' : 'waiting',
        icon: Hourglass,
        text: canReview
          ? 'Submitted for review — approve it, or send it back with changes.'
          : `Submitted — waiting for ${reviewerDisplay || 'the reviewer'} to review.`,
      };
    }
    if (isAssignee) {
      return {
        tone: 'action',
        icon: Clock,
        text: usesReviewPipeline
          ? `In progress — submit for ${reviewerDisplay ? `${reviewerDisplay}'s review` : 'review'} when the work is ready.`
          : 'In progress — mark it complete when the work is done.',
      };
    }
    return {
      tone: 'neutral',
      icon: Clock,
      text: task.assignee?.name
        ? `${task.assignee.name} is working on this.`
        : 'This task is not assigned to anyone yet.',
    };
  })();
  const HintIcon = hint.icon;
  const hintTone = HINT_TONES[hint.tone];

  const showActions = !isDone && (
    canAccept || canSubmit || (awaitingReview && canReview) || canMarkComplete
    || (awaitingAudit && isAdmin) || showReject || showAuditReject
  );

  return (
    <div className="flex flex-col h-full">
      <Header title="Task" />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-6xl space-y-5">

          {/* Back + breadcrumb. The client and project are real links, so this
              doubles as the way back into context. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex items-center gap-1 text-gray-500 hover:text-gray-800 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <span className="text-gray-300">|</span>
            {task.project?.client?.name && (
              <>
                <Link
                  href={`/clients/${task.project.client.id}`}
                  className="text-gray-500 hover:text-brand-700 truncate max-w-[12rem]"
                >
                  {task.project.client.name}
                </Link>
                <span className="text-gray-300">/</span>
              </>
            )}
            {task.project?.name && (
              <Link
                href={`/projects/${projectId}`}
                className="text-gray-500 hover:text-brand-700 truncate max-w-[16rem]"
              >
                {task.project.name}
              </Link>
            )}
            {task.stageKey && (
              <>
                <span className="text-gray-300">/</span>
                <span className="text-gray-400">{titleCase(task.stageKey)}</span>
              </>
            )}
          </div>

          {/* ── Hero: what this is, where it stands, what to do about it ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full', STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-500')}>
                {titleCase(task.status || 'todo')}
              </span>
              <span className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                {typeLabel}
              </span>
              {awaitingAudit && (
                <span className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
                  Awaiting technical audit
                </span>
              )}
              {auditRejected && (
                <span className="inline-flex px-2.5 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                  Technical audit rejected
                </span>
              )}
              {overdue && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
                  <AlertTriangle className="w-3 h-3" />
                  Overdue
                </span>
              )}
            </div>

            <h1 className="mt-3 text-xl sm:text-2xl font-semibold text-gray-900 tracking-tight break-words">
              {task.title}
            </h1>
            {task.pageName && (
              <p className="mt-1 text-sm text-gray-500 break-words">Page: {task.pageName}</p>
            )}

            <div className={cn('mt-4 flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5', hintTone.wrap)}>
              <HintIcon className={cn('w-4 h-4 mt-0.5 shrink-0', hintTone.icon)} />
              <div className="min-w-0 text-sm">
                <p>{hint.text}</p>
                {task.status === 'rejected' && lastRejection?.note && (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-white/70 border border-red-100 px-2.5 py-1.5 text-[13px] text-red-900">
                    {lastRejection.note}
                  </p>
                )}
              </div>
            </div>

            {showActions && (
              <div className="mt-4 pt-4 border-t border-gray-100">
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
                    {rejectFiles.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {rejectFiles.map((f: any, i: number) => (
                          <span key={f.id || i} className="inline-flex items-center gap-1.5 text-xs bg-red-50 text-red-800 border border-red-100 px-2.5 py-1 rounded-lg">
                            <Paperclip className="w-3 h-3" />
                            <span className="max-w-[140px] truncate font-medium">{f.fileName || 'File'}</span>
                            <button
                              type="button"
                              onClick={() => setRejectFiles((prev) => prev.filter((_, j) => j !== i))}
                              className="hover:text-red-900"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={rejectFileRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => { onPickRejectFiles(e.target.files); e.target.value = ''; }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => rejectFileRef.current?.click()}
                        disabled={rejectUploading}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-60"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        Attach file
                      </button>
                      {rejectUploading && <span className="text-xs text-gray-400">Uploading…</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={transition.isPending || rejectUploading}
                        onClick={() => transition.mutate({
                          status: 'rejected',
                          note: rejectNote.trim() || undefined,
                          attachmentIds: rejectFiles.map((f: any) => f.id).filter(Boolean),
                        })}
                        className="inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <XCircle className="w-4 h-4" />
                        Send back for changes
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowReject(false); setRejectFiles([]); }}
                        className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {canAccept && (
                      <button
                        type="button"
                        onClick={() => transition.mutate({ status: 'accepted' })}
                        disabled={transition.isPending}
                        className="inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                      >
                        <ThumbsUp className="w-4 h-4" />
                        Accept task
                      </button>
                    )}
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
                        Mark complete
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Who and when — four plain columns instead of six icon rows ── */}
          <div className="bg-white rounded-xl border border-gray-200 px-4 sm:px-6 py-4 grid grid-cols-2 lg:grid-cols-5 gap-4 sm:gap-6">
            {/* The client also heads the breadcrumb, but whose work this is
                belongs in the scannable field strip too — it's the first thing
                asked about a task, and a breadcrumb reads as navigation. */}
            <Field icon={Building2} label="Client">
              {task.project?.client?.name ? (
                <Link
                  href={`/clients/${task.project.client.id}`}
                  className="font-medium text-gray-900 hover:text-brand-700 break-words"
                >
                  {task.project.client.name}
                </Link>
              ) : (
                <span className="text-gray-400">Internal</span>
              )}
              {task.project?.name && (
                <span className="block text-[11px] text-gray-400 mt-0.5 truncate" title={task.project.name}>
                  {task.project.name}
                </span>
              )}
            </Field>

            <Field icon={User} label="Assignee">
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
            </Field>

            <Field icon={Users} label="Reviewer">
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
                <span className="text-gray-400">No review needed</span>
              )}
            </Field>

            {/* The reminder is always "24h before due" and never set independently,
                so it rides under the due date as a note rather than owning a row. */}
            <Field icon={Calendar} label="Due date">
              {task.dueAt ? (
                <>
                  <span className={cn('font-medium', overdue && 'text-red-700')}>{formatDate(task.dueAt)}</span>
                  {task.reminderAt && !isDone && (
                    <span className="block text-[11px] text-gray-400 mt-0.5">
                      Reminder {formatDate(task.reminderAt, 'MMM d')} · 24h before
                    </span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">No due date</span>
              )}
            </Field>

            <Field icon={Clock} label="Created">
              <span className="font-medium">{formatDate(task.createdAt)}</span>
              {task.creator?.name && (
                <span className="block text-[11px] text-gray-400 mt-0.5 truncate">by {task.creator.name}</span>
              )}
            </Field>
          </div>

          {/* ── Detail + activity ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-5">
              <Panel title="Description" icon={FileText}>
                {task.remarks ? (
                  <Linkify text={task.remarks} className="block text-sm text-gray-700 whitespace-pre-wrap leading-relaxed" />
                ) : (
                  <Empty>No description was added for this task.</Empty>
                )}
              </Panel>

              {briefFiles.length > 0 && (
                <Panel title={`Brief from ${task.creator?.name || 'assigner'}`} icon={Paperclip}>
                  <div className="space-y-2">
                    {briefFiles.map((a: any) => <FileRow key={a.id} file={a} tone="brief" />)}
                  </div>
                </Panel>
              )}

              <Panel
                title="Deliverable"
                icon={Upload}
                action={(
                  <>
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
                  </>
                )}
              >
                {deliverableFiles.length > 0 ? (
                  <div className="space-y-2">
                    {deliverableFiles.map((a: any) => (
                      <FileRow key={a.id} file={a}>
                        {!isDone && (
                          <ActiveToggle
                            isActive
                            label="file"
                            disabled={deleteArtifact.isPending}
                            onToggle={() => deleteArtifact.mutate(a.fileUrl)}
                            className="p-0.5 shrink-0"
                          />
                        )}
                      </FileRow>
                    ))}
                  </div>
                ) : (
                  <Empty>Nothing uploaded yet — the finished work goes here.</Empty>
                )}
              </Panel>
            </div>

            {/*
              A true timeline rather than a stack of cards: one continuous rail
              with a node per event, so the task's path through review reads at a
              glance. On a full page it scrolls with everything else, instead of
              being trapped in its own 320px scroll box the way it was in the dialog.
            */}
            <Panel title="Activity" icon={History}>
              <ol className="relative">
                {/* The rail. Inset to sit under the centre of each node, and
                    stopped short of the last row so it doesn't dangle. */}
                <span aria-hidden className="absolute left-[13px] top-2 bottom-4 w-px bg-gray-200" />

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
                      <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1.5">
                        {ev.note}
                      </p>
                    )}
                    {Array.isArray(ev.attachments) && ev.attachments.length > 0 && (
                      <div className="mt-1.5 space-y-1.5">
                        {ev.attachments.map((a: any) => (
                          <a
                            key={a.id}
                            href={a.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-brand-800 hover:underline bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5"
                          >
                            <Paperclip className="w-3 h-3 shrink-0" />
                            <span className="truncate">{a.fileName || 'Attachment'}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </TimelineRow>
                ))}

                {task.completedAt && !lastEventShowsFinished && (
                  <TimelineRow
                    when={task.completedAt}
                    node={(
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center">
                        <CheckCircle className="w-3.5 h-3.5 text-brand-700" />
                      </div>
                    )}
                  >
                    <p className="text-xs font-semibold text-gray-900">{completionLabel}</p>
                  </TimelineRow>
                )}
              </ol>

              {!task.completedAt && task.updatedAt && task.updatedAt !== task.createdAt && events.length === 0 && (
                <p className="text-[11px] text-gray-400 pl-10 mt-1">
                  Last updated {formatDate(task.updatedAt, 'MMM d, yyyy · h:mm a')}
                </p>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
