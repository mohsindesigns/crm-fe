'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, XCircle, ChevronRight, Clock, Plus, Upload, Users, Link, Paperclip, ToggleLeft, Download, Repeat, AlertTriangle, Eye, Pencil, Save, X, Calendar, Bell, Flag, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import TaskDetailModal from '@/components/TaskDetailModal';
import Linkify from '@/components/Linkify';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import ConfirmDialog from '@/components/ConfirmDialog';
import Pagination from '@/components/Pagination';
import { cn, formatDate, downloadAuthedFile, viewAuthedFile, openFileInNewTab, uploadErrorMessage, titleCase, inactiveRow } from '@/lib/utils';
import { invalidateMany, afterProjectChange, afterTaskChange } from '@/lib/queryInvalidation';
import { usersForRoleSlot } from '@/lib/projectTeam';
import { useState, useRef, useMemo, useEffect, Fragment } from 'react';
import { useAuthStore } from '@/store/auth';

const KEYWORD_PAGE_SIZE = 10;

/** Never render a literal "null"/"undefined" for an empty optional sheet cell. */
function cellOrDash(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function parseKeywordList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatSecondaryKeywords(raw: string | null | undefined) {
  return parseKeywordList(raw).join(', ');
}

/** Latest live submission per page+writer — superseded history rows never lock keywords. */
function latestContentByPageWriter(rows: any[]): any[] {
  const latest = new Map<string, any>();
  const sorted = [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    if (ta !== tb) return tb - ta;
    return Number(b.revisionNumber || 0) - Number(a.revisionNumber || 0);
  });
  for (const cs of sorted) {
    if (cs.status === 'superseded') continue;
    const key = `${cs.pageName || ''}::${cs.submittedBy || ''}`;
    if (!latest.has(key)) latest.set(key, cs);
  }
  return Array.from(latest.values());
}

/** All content rows newest-first so revision history stays visible in the sheet. */
function contentHistoryRows(rows: any[]): any[] {
  return [...rows].sort((a, b) => {
    const pageCmp = String(a.pageName || '').localeCompare(String(b.pageName || ''));
    if (pageCmp !== 0) return pageCmp;
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    if (ta !== tb) return tb - ta;
    return Number(b.revisionNumber || 0) - Number(a.revisionNumber || 0);
  });
}

/** Compact keyword chips — keeps blog sheet rows short when lists are long. */
function SupportingKeywordsCell({
  raw,
  previewCount = 3,
  className,
}: {
  raw?: string | null;
  previewCount?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const keywords = useMemo(() => parseKeywordList(raw), [raw]);

  if (!keywords.length) {
    return <span className="text-gray-400">—</span>;
  }

  const visible = expanded ? keywords : keywords.slice(0, previewCount);
  const hiddenCount = keywords.length - previewCount;

  return (
    <div className={cn('max-w-[240px]', className)}>
      <div className="flex flex-wrap gap-1" title={keywords.join(', ')}>
        {visible.map((kw, i) => (
          <span
            key={`${i}-${kw}`}
            className="inline-block max-w-full truncate text-[11px] leading-snug px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200/80"
            title={kw}
          >
            {kw}
          </span>
        ))}
      </div>
      {keywords.length > previewCount && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11px] font-medium text-brand-700 hover:text-brand-800 hover:underline"
        >
          {expanded ? 'Show less' : `+${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

/** Derive a readable page title from an uploaded content filename. */
function pageTitleFromFileName(fileName: string) {
  const base = String(fileName || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  return base
    .split(' ')
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function countWords(text: string) {
  const parts = String(text || '').trim().match(/\S+/g);
  return parts ? parts.length : 0;
}

/** Prefer an H1 / first heading from plain text / HTML; else null. */
function titleFromFileText(text: string) {
  const htmlH1 = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (htmlH1?.[1]) {
    return htmlH1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 255);
  }
  const mdH1 = text.match(/^#\s+(.+)$/m);
  if (mdH1?.[1]) return mdH1[1].trim().slice(0, 255);
  const firstLine = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (firstLine && firstLine.length <= 120 && !/[.!?]$/.test(firstLine)) {
    return firstLine.slice(0, 255);
  }
  return null;
}

type Tab = 'overview' | 'keywords' | 'backlinks' | 'content' | 'blogs' | 'reporting' | 'comments';
const VALID_TABS: Tab[] = ['overview', 'keywords', 'backlinks', 'content', 'blogs', 'reporting', 'comments'];
const SEO_WORKFLOW_TABS: Tab[] = ['keywords', 'backlinks', 'content', 'blogs', 'reporting'];
const GMB_WORKFLOW_TABS: Tab[] = ['keywords', 'reporting'];
const WORKFLOW_TAB_LABELS: Record<string, string> = {
  keywords: 'Keywords',
  backlinks: 'Backlinks',
  content: 'Content',
  blogs: 'Blogs',
  reporting: 'Monthly Report',
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [actionNote, setActionNote] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  // Deep-linkable so notifications (e.g. "blog submitted for review") can land
  // straight on the right tab instead of always opening on Overview.
  const rawTab = searchParams.get('tab');
  const tab: Tab = (rawTab && (VALID_TABS as string[]).includes(rawTab)) ? (rawTab as Tab) : 'overview';
  function setTab(t: Tab) {
    router.replace(`/projects/${id}?tab=${t}`, { scroll: false });
  }
  const [figmaLink, setFigmaLink] = useState('');
  const [artifactUploading, setArtifactUploading] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [newKwExtra, setNewKwExtra] = useState({ secondaryKeywords: '', kd: '', volume: '', targetUrl: '', targetLocation: '', pageName: '', assignedWriterId: '' });
  const [newBacklink, setNewBacklink] = useState({
    sourceUrl: '', targetUrl: '', anchorText: '', da: '', linkType: 'other', date: '', domain: '', spamScore: '',
  });
  const [newComment, setNewComment] = useState('');
  const [contentKeywordIds, setContentKeywordIds] = useState<string[]>([]);
  const [contentFileName, setContentFileName] = useState('');
  const [contentAutoTitle, setContentAutoTitle] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const contentFileRef = useRef<HTMLInputElement>(null);
  const backlinkImportRef = useRef<HTMLInputElement>(null);
  const backlinkStatusFileRef = useRef<HTMLInputElement>(null);
  const blogSheetFileRef = useRef<HTMLInputElement>(null);
  const blogDeliverableRef = useRef<HTMLInputElement>(null);
  const [newBlogRow, setNewBlogRow] = useState({
    contentType: '', title: '', mainKeyword: '', volume: '', kd: '',
    supportingKeywords: '', urlSlug: '', targetServicePage: '', proof: '',
    assignedWriterId: '',
  });
  const [blogSubmitId, setBlogSubmitId] = useState('');
  const [blogSubmitFileName, setBlogSubmitFileName] = useState('');
  const [blogSubmitLink, setBlogSubmitLink] = useState('');
  const [contentSubmitLink, setContentSubmitLink] = useState('');
  // Monthly Report: the date being recorded, and the in-progress position for
  // each keyword keyed by keyword id (kept as strings so a field can be blanked
  // to mean "checked, not ranking").
  const [rankDate, setRankDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rankEntryDraft, setRankEntryDraft] = useState<Record<string, string>>({});
  const rankImportRef = useRef<HTMLInputElement>(null);
  const [contentWordCount, setContentWordCount] = useState('');
  const [rejectingContentId, setRejectingContentId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectingBlogId, setRejectingBlogId] = useState<string | null>(null);
  // Rows ticked for bulk approval on the Blogs sheet.
  const [selectedBlogIds, setSelectedBlogIds] = useState<string[]>([]);
  const [confirmClearBlogs, setConfirmClearBlogs] = useState(false);
  const [blogRejectReason, setBlogRejectReason] = useState('');

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then((r) => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
    enabled: !!project,
  });

  // Lightweight directory (id/name only, no users.read gate) for the Writer
  // picker on the Keywords tab — only Content Writer role users. A keyword
  // researcher/link builder shouldn't need users.read just to hand a page off.
  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users-assignable', 'content_writer'],
    queryFn: () => api.get('/users/assignable', { params: { role: 'content_writer' } }).then((r) => r.data || []),
    enabled: !!project && tab === 'keywords' && project.serviceTypeKey === 'seo',
  });

  const { data: assignableBlogWriters = [] } = useQuery({
    queryKey: ['users-assignable', 'blog_writer,content_writer'],
    queryFn: () => api.get('/users/assignable', { params: { role: 'blog_writer,content_writer' } }).then((r) => r.data || []),
    enabled: !!project && tab === 'blogs',
  });

  const { data: timeline } = useQuery({
    queryKey: ['project-timeline', id],
    queryFn: () => api.get(`/projects/${id}/timeline`).then((r) => r.data),
  });

  // One flag for the whole project page — keywords, backlinks, the blog sheet and
  // deliverables all show/hide their Inactive rows together.
  const inactive = useShowInactive();

  const { data: tasks } = useQuery({
    queryKey: ['project-tasks', id, project?.currentStageKey],
    queryFn: () => api.get(`/projects/${id}/tasks`, {
      params: { stageKey: project?.currentStageKey },
    }).then((r) => r.data),
    enabled: !!project,
  });


  const { data: keywords = [] } = useQuery({
    queryKey: ['seo-keywords', id, inactive.key],
    queryFn: () => api.get(`/seo/projects/${id}/keywords`, { params: inactive.params }).then((r) => r.data),
    enabled: tab === 'keywords' || tab === 'content',
  });

  // The page title is derived from whichever selected keyword already has a
  // page name (set when the keyword was added) — content writers pick keywords,
  // they don't retype a name that's already on record.
  const contentPageName = useMemo(() => {
    const selected = (keywords as any[]).filter((kw: any) => contentKeywordIds.includes(kw.id));
    const withName = selected.find((kw: any) => kw.pageName);
    return withName?.pageName || contentAutoTitle || '';
  }, [keywords, contentKeywordIds, contentAutoTitle]);

  const { data: backlinks = [] } = useQuery({
    queryKey: ['seo-backlinks', id, inactive.key],
    queryFn: () => api.get(`/seo/projects/${id}/backlinks`, { params: inactive.params }).then((r) => r.data),
    enabled: tab === 'backlinks',
  });

  // Monthly Report: the keyword × report-date rank grid.
  const { data: rankings, isLoading: rankingsLoading } = useQuery({
    queryKey: ['seo-rankings', id],
    queryFn: () => api.get(`/seo/projects/${id}/rankings`).then((r) => r.data),
    enabled: tab === 'reporting',
  });

  const { data: content = [] } = useQuery({
    queryKey: ['seo-content', id],
    queryFn: () => api.get(`/seo/projects/${id}/content`).then((r) => r.data),
    enabled: tab === 'content' || (tab === 'keywords' && project?.serviceTypeKey === 'seo'),
  });

  // Keywords covered by an approved content submission — used for the
  // "Used in Content" stat specifically, not the delete lock (see below).
  // Only the latest row per page+writer counts (stale Approved left after an
  // older reopen-clone flow must not keep locking the pool).
  const liveContent = useMemo(
    () => latestContentByPageWriter(content as any[]),
    [content],
  );
  const historyContent = useMemo(
    () => contentHistoryRows(content as any[]),
    [content],
  );

  const approvedKeywordIds = useMemo(() => {
    const ids = new Set<string>();
    liveContent.filter((cs: any) => cs.status === 'approved')
      .forEach((cs: any) => (cs.keywordIds || []).forEach((kid: string) => ids.add(kid)));
    return ids;
  }, [liveContent]);

  // Keywords whose content is already delivered — approved, or submitted and
  // waiting on review. These drop out of the "Submit content" picker so a writer
  // isn't offered pages that are already written. A *rejected* submission is
  // deliberately excluded from this set: that page needs rewriting, so its
  // keywords must come back onto the list.
  const coveredKeywordIds = useMemo(() => {
    const ids = new Set<string>();
    liveContent
      .filter((cs: any) => cs.status === 'approved' || cs.status === 'pending')
      .forEach((cs: any) => (cs.keywordIds || []).forEach((kid: string) => ids.add(kid)));
    return ids;
  }, [liveContent]);

  // Locked from deletion: handed to a writer (work may already be underway,
  // or a task already exists for it) OR its content is already approved.
  // Only still-unassigned keywords stay freely deletable.
  const lockedKeywordIds = useMemo(() => {
    const ids = new Set<string>(approvedKeywordIds);
    (keywords as any[]).forEach((kw: any) => { if (kw.assignedWriterId) ids.add(kw.id); });
    return ids;
  }, [keywords, approvedKeywordIds]);

  const deletableKeywordIds = useMemo(
    () => (keywords as any[]).filter((kw: any) => !lockedKeywordIds.has(kw.id)).map((kw: any) => kw.id as string),
    [keywords, lockedKeywordIds],
  );
  const deletableBacklinkIds = useMemo(
    () => (backlinks as any[]).filter((bl: any) => !bl.isIndexed).map((bl: any) => bl.id as string),
    [backlinks],
  );

  const [selectedKeywordIds, setSelectedKeywordIds] = useState<Set<string>>(new Set());
  const [selectedBacklinkIds, setSelectedBacklinkIds] = useState<Set<string>>(new Set());
  const [keywordPage, setKeywordPage] = useState(1);

  useEffect(() => {
    setSelectedKeywordIds(new Set());
    setSelectedBacklinkIds(new Set());
    setKeywordPage(1);
  }, [id, tab]);

  const keywordTotalPages = Math.max(1, Math.ceil(keywords.length / KEYWORD_PAGE_SIZE));
  const pagedKeywords = useMemo(() => {
    const start = (keywordPage - 1) * KEYWORD_PAGE_SIZE;
    return (keywords as any[]).slice(start, start + KEYWORD_PAGE_SIZE);
  }, [keywords, keywordPage]);

  useEffect(() => {
    if (keywordPage > keywordTotalPages) setKeywordPage(keywordTotalPages);
  }, [keywordPage, keywordTotalPages]);

  const { data: blogSheet = [] } = useQuery({
    queryKey: ['blog-sheet', id, inactive.key],
    queryFn: () => api.get(`/seo/projects/${id}/blog-sheet`, { params: inactive.params }).then((r) => r.data),
    enabled: tab === 'blogs',
  });

  // Rows the Clear action will touch: still active, not yet approved. Approved
  // rows are a record of accepted work and are never included. Lifted to
  // component scope because the confirm dialog renders outside the Blogs tab.
  const blogIdsToClear = useMemo(
    () => (blogSheet as any[])
      .filter((r: any) => r.status !== 'approved' && r.isActive !== false)
      .map((r: any) => r.id),
    [blogSheet],
  );
  const pendingClearCount = blogIdsToClear.length;

  const { data: comments = [] } = useQuery({
    queryKey: ['project-comments', id],
    queryFn: () => api.get(`/projects/${id}/comments`).then((r) => r.data),
    enabled: tab === 'comments',
  });

  const { data: allArtifacts = [] } = useQuery({
    queryKey: ['all-artifacts', id, inactive.key],
    queryFn: () => api.get('/media/artifacts', { params: { projectId: id, ...inactive.params } }).then((r) => r.data),
    enabled: !!project,
  });

  // Find the work stage immediately preceding the current approval stage.
  // This is what the approver should be reviewing — not artifacts from older stages.
  const deliverableStageKey: string | undefined = (() => {
    if (!project || !timeline) return undefined;
    const stgs: any[] = timeline?.stages || [];
    const idx = stgs.findIndex((s: any) => s.key === project.currentStageKey);
    if (idx < 0 || stgs[idx]?.stageType !== 'approval') return undefined;
    for (let i = idx - 1; i >= 0; i--) {
      if (stgs[i]?.stageType === 'work') return stgs[i].key;
    }
    return undefined;
  })();

  const { data: deliverables = [] } = useQuery({
    queryKey: ['stage-artifacts', id, deliverableStageKey, inactive.key],
    queryFn: () => api.get('/media/artifacts', { params: { projectId: id, stageKey: deliverableStageKey, ...inactive.params } }).then((r) => r.data),
    enabled: !!project && !!deliverableStageKey,
  });

  const actionMutation = useMutation({
    mutationFn: (payload: { action: string; note?: string }) =>
      api.post(`/projects/${id}/action`, payload).then((r) => r.data),
    onSuccess: async (_, vars) => {
      await invalidateMany(qc, afterProjectChange(id));
      setActionNote('');
      const label = vars.action === 'approve' ? 'Approved' : vars.action === 'reject' ? 'Rejected' : 'Stage completed';
      toast.success(label);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Action failed.'),
  });

  const cancelProject = useMutation({
    mutationFn: () => api.post(`/projects/${id}/cancel`).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterProjectChange(id));
      setShowCancelConfirm(false);
      toast.success('Project cancelled.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to cancel project.'),
  });

  const addKeyword = useMutation({
    mutationFn: (payload: { primaryKeyword: string; secondaryKeywords?: string; kd?: number | null; volume?: number | null; targetUrl?: string; targetLocation?: string; pageName?: string; assignedWriterId?: string }) =>
      api.post(`/seo/projects/${id}/keywords`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      setNewKeyword('');
      setNewKwExtra({ secondaryKeywords: '', kd: '', volume: '', targetUrl: '', targetLocation: '', pageName: '', assignedWriterId: '' });
      toast.success('Keyword added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add keyword.'),
  });

  const assignKeywordWriter = useMutation({
    mutationFn: ({ keywordId, writerId }: { keywordId: string; writerId: string }) =>
      api.patch(`/seo/keywords/${keywordId}`, { assignedWriterId: writerId || null }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      qc.invalidateQueries({ queryKey: ['project-tasks', id] });
      toast.success(vars.writerId ? 'Writer assigned — task created.' : 'Writer unassigned.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to assign writer.'),
  });

  const updateKeywordStatus = useMutation({
    mutationFn: ({ keywordId, status }: { keywordId: string; status: 'active' | 'inactive' }) =>
      api.patch(`/seo/keywords/${keywordId}`, { status }).then((r) => r.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      if (vars.status === 'inactive') {
        setContentKeywordIds((ids) => ids.filter((kid) => kid !== vars.keywordId));
      }
      toast.success(vars.status === 'active' ? 'Keyword set to active.' : 'Keyword set to inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update keyword status.'),
  });

  const importKeywords = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/seo/projects/${id}/keywords/import`, fd).then((r) => r.data);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      qc.invalidateQueries({ queryKey: ['project-tasks', id] });
      toast.success(`Imported ${data?.imported ?? 0} keywords successfully`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Import failed.'),
  });

  // ── Monthly Report mutations ──────────────────────────────────────────────
  const saveRankings = useMutation({
    mutationFn: (payload: { date: string; entries: { keywordId: string; position: string }[] }) =>
      api.post(`/seo/projects/${id}/rankings`, payload).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-rankings', id] });
      setRankEntryDraft({});
      toast.success(`Saved ${data?.saved ?? 0} ranking(s) for ${data?.date}.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save rankings.'),
  });

  const importRankings = useMutation({
    mutationFn: ({ file, date }: { file: File; date: string }) => {
      const fd = new FormData();
      fd.append('file', file);
      if (date) fd.append('date', date);
      return api.post(`/seo/projects/${id}/rankings/import`, fd).then((r) => r.data);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-rankings', id] });
      toast.success(
        `Imported ${data?.imported ?? 0} ranking(s)`
        + (data?.unmatchedCount ? ` · ${data.unmatchedCount} keyword(s) didn't match and were skipped.` : '.')
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Import failed.'),
  });

  const deleteRankingDate = useMutation({
    mutationFn: (date: string) => api.delete(`/seo/projects/${id}/rankings/${date}`).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-rankings', id] });
      toast.success(`Removed the ${data?.date} report column.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to remove that date.'),
  });

  const addBacklink = useMutation({
    mutationFn: (bl: typeof newBacklink) =>
      api.post(`/seo/projects/${id}/backlinks`, {
        ...bl,
        da: bl.da ? Number(bl.da) : null,
        spamScore: bl.spamScore ? Number(bl.spamScore) : null,
        date: bl.date || null,
        domain: bl.domain || null,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      setNewBacklink({ sourceUrl: '', targetUrl: '', anchorText: '', da: '', linkType: 'other', date: '', domain: '', spamScore: '' });
      toast.success('Backlink added');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add backlink.'),
  });

  const importBacklinks = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/seo/projects/${id}/backlinks/import`, fd).then((r) => r.data);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      toast.success(`Imported ${data?.imported ?? 0} backlink(s).`);
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      const importErrors = data?.errors?.import;
      if (Array.isArray(importErrors) && importErrors.length) {
        toast.error(importErrors.slice(0, 4).join(' · '), { duration: 8000 });
        return;
      }
      const fieldErrors = data?.errors ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`) : [];
      toast.error(fieldErrors.length ? fieldErrors.join(' · ') : (data?.message || 'Import failed.'), { duration: 8000 });
    },
  });

  const updateBacklinkStatusFile = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/seo/projects/${id}/backlinks/update-status`, fd).then((r) => r.data);
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      toast.success(`Updated ${data?.updated ?? 0} backlink(s)${data?.skippedCount ? `, ${data.skippedCount} not matched` : ''}.`);
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      const importErrors = data?.errors?.import;
      if (Array.isArray(importErrors) && importErrors.length) {
        toast.error(importErrors.slice(0, 4).join(' · '), { duration: 8000 });
        return;
      }
      toast.error(data?.message || 'Update failed.', { duration: 8000 });
    },
  });

  const editBacklink = useMutation({
    mutationFn: ({ blId, updates }: { blId: string; updates: Record<string, any> }) =>
      api.patch(`/seo/backlinks/${blId}`, updates).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo-backlinks', id] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update backlink.'),
  });

  const [confirmSeoDelete, setConfirmSeoDelete] = useState<
    null | {
      kind: 'keyword' | 'backlink' | 'keywords-sheet' | 'backlinks-sheet' | 'keywords-selected' | 'backlinks-selected';
      id?: string;
      label?: string;
      count?: number;
    }
  >(null);

  const deleteKeyword = useMutation({
    mutationFn: (kwId: string) => api.delete(`/seo/keywords/${kwId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      setConfirmSeoDelete(null);
      toast.success('Keyword set to Inactive');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change keyword status.'),
  });

  const clearKeywords = useMutation({
    mutationFn: () => api.delete(`/seo/projects/${id}/keywords`).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      setConfirmSeoDelete(null);
      const deleted = data?.deleted ?? 0;
      const kept = data?.kept ?? 0;
      toast.success(
        kept
          ? `Set ${deleted} keyword(s) to Inactive; kept ${kept} assigned or approved.`
          : `Set ${deleted} keyword(s) to Inactive`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change keywords status.'),
  });

  const bulkDeleteKeywords = useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`/seo/projects/${id}/keywords/bulk-delete`, { ids }).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-keywords', id] });
      setSelectedKeywordIds(new Set());
      setConfirmSeoDelete(null);
      const deleted = data?.deleted ?? 0;
      const skipped = data?.skipped?.length ?? 0;
      if (deleted && skipped) toast.success(`Set ${deleted} keyword(s) to Inactive. ${skipped} skipped.`);
      else if (deleted) toast.success(`Set ${deleted} keyword(s) to Inactive`);
      else toast.error('No keywords were set to Inactive. Assigned or approved keywords were skipped.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change keywords status.'),
  });

  const deleteBacklink = useMutation({
    mutationFn: (blId: string) => api.delete(`/seo/backlinks/${blId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      setConfirmSeoDelete(null);
      toast.success('Backlink set to Inactive');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change backlink status.'),
  });

  const clearBacklinks = useMutation({
    mutationFn: () => api.delete(`/seo/projects/${id}/backlinks`).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      setConfirmSeoDelete(null);
      const deleted = data?.deleted ?? 0;
      const kept = data?.kept ?? 0;
      toast.success(
        kept
          ? `Set ${deleted} backlink(s) to Inactive; kept ${kept} indexed.`
          : `Set ${deleted} backlink(s) to Inactive`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change backlinks status.'),
  });

  const bulkDeleteBacklinks = useMutation({
    mutationFn: (ids: string[]) =>
      api.post(`/seo/projects/${id}/backlinks/bulk-delete`, { ids }).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['seo-backlinks', id] });
      setSelectedBacklinkIds(new Set());
      setConfirmSeoDelete(null);
      const deleted = data?.deleted ?? 0;
      const skipped = data?.skipped?.length ?? 0;
      if (deleted && skipped) toast.success(`Set ${deleted} backlink(s) to Inactive. ${skipped} skipped.`);
      else if (deleted) toast.success(`Set ${deleted} backlink(s) to Inactive`);
      else toast.error('No backlinks were set to Inactive. Indexed backlinks were skipped.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change backlinks status.'),
  });

  const seoDeletePending =
    deleteKeyword.isPending
    || clearKeywords.isPending
    || bulkDeleteKeywords.isPending
    || deleteBacklink.isPending
    || clearBacklinks.isPending
    || bulkDeleteBacklinks.isPending;

  const allDeletableKeywordsSelected =
    deletableKeywordIds.length > 0 && deletableKeywordIds.every((kid) => selectedKeywordIds.has(kid));
  const allDeletableBacklinksSelected =
    deletableBacklinkIds.length > 0 && deletableBacklinkIds.every((bid) => selectedBacklinkIds.has(bid));

  function toggleKeywordSelect(kwId: string, deletable: boolean) {
    if (!deletable) return;
    setSelectedKeywordIds((prev) => {
      const next = new Set(prev);
      if (next.has(kwId)) next.delete(kwId);
      else next.add(kwId);
      return next;
    });
  }

  function toggleAllKeywords() {
    setSelectedKeywordIds(allDeletableKeywordsSelected ? new Set() : new Set(deletableKeywordIds));
  }

  function toggleBacklinkSelect(blId: string, deletable: boolean) {
    if (!deletable) return;
    setSelectedBacklinkIds((prev) => {
      const next = new Set(prev);
      if (next.has(blId)) next.delete(blId);
      else next.add(blId);
      return next;
    });
  }

  function toggleAllBacklinks() {
    setSelectedBacklinkIds(allDeletableBacklinksSelected ? new Set() : new Set(deletableBacklinkIds));
  }

  const addComment = useMutation({
    mutationFn: (body: string) =>
      api.post(`/projects/${id}/comments`, { body }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-comments', id] });
      setNewComment('');
      toast.success('Comment posted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to post comment.'),
  });

  const submitContent = useMutation({
    mutationFn: (fd: FormData) =>
      api.post(`/seo/projects/${id}/content`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, [
        ['seo-content', id],
        ['seo-keywords', id],
        ...afterTaskChange(id),
      ]);
      setContentKeywordIds([]);
      setContentWordCount('');
      setContentFileName('');
      setContentAutoTitle('');
      setContentSubmitLink('');
      if (contentFileRef.current) contentFileRef.current.value = '';
      toast.success('Content submitted');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Submission failed.'),
  });

  const reviewContent = useMutation({
    mutationFn: ({ csId, status, rejectionReason }: { csId: string; status: 'approved' | 'rejected'; rejectionReason?: string }) =>
      api.patch(`/seo/content/${csId}/review`, { status, rejectionReason }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['seo-content', id],
        ['seo-keywords', id],
        ...afterProjectChange(id),
      ]);
      setRejectingContentId(null);
      setRejectReason('');
      toast.success(vars.status === 'approved' ? 'Content approved.' : 'Content sent back to the writer for revision.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Review failed.'),
  });

  const deleteContentSubmission = useMutation({
    mutationFn: (csId: string) => api.delete(`/seo/content/${csId}`).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, [
        ['seo-content', id],
        ['seo-keywords', id],
        ...afterTaskChange(id),
      ]);
      toast.success('Submission deleted.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not delete submission.'),
  });

  async function handleContentFileChange(file: File | undefined) {
    if (!file) {
      setContentFileName('');
      return;
    }
    setContentFileName(file.name);

    let detected = pageTitleFromFileName(file.name);
    const lower = file.name.toLowerCase();
    const readable =
      lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.csv');

    if (readable) {
      try {
        const text = await file.text();
        const fromBody = titleFromFileText(text);
        if (fromBody) detected = fromBody;
        if (!contentWordCount) {
          const words = countWords(text.replace(/<[^>]+>/g, ' '));
          if (words > 0) setContentWordCount(String(words));
        }
      } catch {
        // keep filename-based title
      }
    }

    if (detected) setContentAutoTitle(detected);

    // Auto-tick keywords whose pageName matches the detected title.
    if (detected) {
      const norm = detected.trim().toLowerCase();
      const matched = (keywords as any[])
        .filter((kw) => String(kw.pageName || '').trim().toLowerCase() === norm)
        .map((kw) => kw.id);
      if (matched.length) {
        setContentKeywordIds((ids) => Array.from(new Set([...ids, ...matched])));
      }
    }
  }

  const completeTask = useMutation({
    mutationFn: (taskId: string) =>
      api.patch(`/projects/${id}/tasks/${taskId}/status`, { status: 'done' }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterTaskChange(id));
      toast.success('Task marked done.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update task.'),
  });

  const [showTaskForm, setShowTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', assigneeId: '', dueAt: '', remarks: '' });
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Deep-link: /projects/:id?task=… opens the same TaskDetailModal as row click.
  useEffect(() => {
    const fromUrl = searchParams.get('task');
    if (fromUrl) setOpenTaskId(fromUrl);
  }, [searchParams]);

  function openProjectTask(taskId: string) {
    setOpenTaskId(taskId);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab || 'overview');
    params.set('task', taskId);
    router.replace(`/projects/${id}?${params.toString()}`, { scroll: false });
  }

  function closeProjectTask() {
    setOpenTaskId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('task');
    const qs = params.toString();
    router.replace(qs ? `/projects/${id}?${qs}` : `/projects/${id}`, { scroll: false });
    qc.invalidateQueries({ queryKey: ['project-tasks', id] });
  }

  const createTask = useMutation({
    mutationFn: (payload: typeof newTask) =>
      api.post(`/projects/${id}/tasks`, {
        title: payload.title,
        assigneeId: payload.assigneeId || undefined,
        dueAt: payload.dueAt || undefined,
        remarks: payload.remarks.trim() || undefined,
        type: 'issue',
      }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterTaskChange(id));
      setNewTask({ title: '', assigneeId: '', dueAt: '', remarks: '' });
      setShowTaskForm(false);
      toast.success(newTask.assigneeId ? 'Task created and assignee notified.' : 'Task created.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create task.'),
  });

  const assignMember = useMutation({
    mutationFn: ({ roleSlot, userId }: { roleSlot: string; userId: string }) =>
      api.post(`/projects/${id}/assign`, { roleSlot, userId: userId || null }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterProjectChange(id));
      toast.success('Assignment updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update assignment.'),
  });

  const { data: recurringRules = [] } = useQuery({
    queryKey: ['recurring-task-rules', id],
    queryFn: () => api.get(`/projects/${id}/recurring-task-rules`).then((r) => r.data),
    enabled: !!project?.isRecurring,
  });

  const blankRule = {
    title: '', roleSlot: '', taskType: 'custom', frequency: 'weekly',
    generateDayOfMonth: '1', dueDayOfMonth: '1', weekday: '1',
    startDate: new Date().toISOString().split('T')[0],
  };
  const [newRule, setNewRule] = useState(blankRule);
  const [showRuleForm, setShowRuleForm] = useState(false);

  const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function formatRuleCadence(rule: any) {
    if (rule.frequency === 'monthly') {
      return `Monthly · day ${rule.generateDayOfMonth || 1} · due next cycle`;
    }
    const day = WEEKDAY_SHORT[rule.weekday] || '—';
    if (rule.frequency === 'biweekly') return `Biweekly · every other ${day} · due next cycle`;
    return `Weekly · every ${day} · due next cycle`;
  }

  const createRule = useMutation({
    mutationFn: (payload: typeof newRule) => {
      const taskType = payload.roleSlot === 'blog_writer' || payload.taskType === 'blog_post'
        ? 'blog_post'
        : (payload.taskType || 'custom');
      return api.post(`/projects/${id}/recurring-task-rules`, { ...payload, taskType }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-task-rules', id] });
      qc.invalidateQueries({ queryKey: ['blog-tasks', id] });
      setNewRule({ ...blankRule, startDate: new Date().toISOString().split('T')[0] });
      setShowRuleForm(false);
      toast.success('Recurring task scheduled');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to schedule recurring task.'),
  });

  const addBlogRow = useMutation({
    mutationFn: (payload: typeof newBlogRow) =>
      api.post(`/seo/projects/${id}/blog-sheet`, {
        ...payload,
        assignedWriterId: payload.assignedWriterId || null,
      }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, [
        ['blog-sheet', id],
        ...afterTaskChange(id),
      ]);
      setNewBlogRow({
        contentType: '', title: '', mainKeyword: '', volume: '', kd: '',
        supportingKeywords: '', urlSlug: '', targetServicePage: '', proof: '',
        assignedWriterId: '',
      });
      toast.success('Blog planned — assigned writer can submit the deliverable.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to add blog.'),
  });

  const assignBlogWriter = useMutation({
    mutationFn: ({ blogId, writerId }: { blogId: string; writerId: string }) =>
      api.patch(`/seo/blogs/${blogId}`, { assignedWriterId: writerId || null }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['blog-sheet', id],
        ...afterTaskChange(id),
      ]);
      toast.success(vars.writerId ? 'Writer assigned — task created.' : 'Writer unassigned.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to assign writer.'),
  });

  const importBlogSheet = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.post(`/seo/projects/${id}/blog-sheet/import`, form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: async (data: any) => {
      await invalidateMany(qc, [
        ['blog-sheet', id],
        ...afterTaskChange(id),
      ]);
      const unmatched: string[] = data?.unmatchedWriters || [];
      const base = `Imported ${data?.imported ?? 0} blog${(data?.imported ?? 0) === 1 ? '' : 's'}.`;
      if (unmatched.length) {
        toast.success(`${base} ${unmatched.length} writer name(s) didn't match — assign manually.`, { duration: 8000 });
      } else {
        toast.success(`${base} Writers auto-assigned where names matched.`);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to import blogs.'),
  });

  const submitBlog = useMutation({
    mutationFn: (fd: FormData) =>
      api.post(`/seo/projects/${id}/blog-sheet/submit`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, [
        ['blog-sheet', id],
        ...afterTaskChange(id),
      ]);
      setBlogSubmitId('');
      setBlogSubmitFileName('');
      setBlogSubmitLink('');
      if (blogDeliverableRef.current) blogDeliverableRef.current.value = '';
      toast.success('Blog submitted for review');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Blog submission failed.'),
  });

  const reviewBlogRow = useMutation({
    mutationFn: ({ blogId, status, rejectionReason }: { blogId: string; status: 'approved' | 'rejected'; rejectionReason?: string }) =>
      api.patch(`/seo/blog-sheet/${blogId}/review`, { status, rejectionReason }).then((r) => r.data),
    onSuccess: async (_data, vars) => {
      await invalidateMany(qc, [
        ['blog-sheet', id],
        ...afterProjectChange(id),
      ]);
      setRejectingBlogId(null);
      setBlogRejectReason('');
      toast.success(vars.status === 'approved' ? 'Blog approved.' : 'Blog rejected — sent back to the writer.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to review blog.'),
  });

  /**
   * Approve several rows in one action.
   *
   * A content sheet routinely carries 20+ pending rows and the only control was
   * a per-row tick, so signing off a month's work meant 20 individual clicks and
   * 20 refetches. Sequential rather than parallel: the endpoint is per-row, and
   * firing 20 at once risks rate limits and makes a partial failure impossible
   * to report accurately.
   */
  const bulkApproveBlogs = useMutation({
    mutationFn: async (blogIds: string[]) => {
      const failed: string[] = [];
      for (const blogId of blogIds) {
        try {
          await api.patch(`/seo/blog-sheet/${blogId}/review`, { status: 'approved' });
        } catch {
          failed.push(blogId);
        }
      }
      return { total: blogIds.length, failed };
    },
    onSuccess: async ({ total, failed }) => {
      await invalidateMany(qc, [['blog-sheet', id], ...afterProjectChange(id)]);
      setSelectedBlogIds([]);
      const ok = total - failed.length;
      if (failed.length) toast.warning(`${ok} of ${total} approved — ${failed.length} could not be approved.`);
      else toast.success(`${ok} blog${ok === 1 ? '' : 's'} approved.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Bulk approve failed.'),
  });

  /**
   * Active ↔ Inactive, both directions.
   *
   * Only the deactivate half was ever wired up, so a row set to Inactive could
   * never be brought back from the UI — the /activate endpoint existed and had
   * nothing calling it.
   */
  const toggleBlogRowActive = useMutation({
    mutationFn: ({ blogId, next }: { blogId: string; next: boolean }) => (next
      ? api.post(`/seo/blog-sheet/${blogId}/activate`).then((r) => r.data)
      : api.delete(`/seo/blog-sheet/${blogId}`).then((r) => r.data)),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['blog-sheet', id] });
      toast.success(vars.next ? 'Blog set to Active.' : 'Blog set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change blog status.'),
  });

  /**
   * Clear the planned rows that haven't been signed off.
   *
   * Approved rows are deliberately untouchable: they're a record of work that
   * was reviewed and accepted, and an import mistake shouldn't be able to wipe
   * them. Deactivates rather than destroys, matching every other "delete" here.
   */
  const clearBlogRows = useMutation({
    mutationFn: async (blogIds: string[]) => {
      const failed: string[] = [];
      for (const blogId of blogIds) {
        try {
          await api.delete(`/seo/blog-sheet/${blogId}`);
        } catch {
          failed.push(blogId);
        }
      }
      return { total: blogIds.length, failed };
    },
    onSuccess: ({ total, failed }) => {
      qc.invalidateQueries({ queryKey: ['blog-sheet', id] });
      setSelectedBlogIds([]);
      const ok = total - failed.length;
      if (failed.length) toast.warning(`${ok} of ${total} cleared — ${failed.length} could not be cleared.`);
      else toast.success(`${ok} row${ok === 1 ? '' : 's'} cleared. Approved rows were kept.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to clear rows.'),
  });

  const toggleRule = useMutation({
    mutationFn: ({ ruleId, isActive }: { ruleId: string; isActive: boolean }) =>
      api.patch(`/projects/${id}/recurring-task-rules/${ruleId}`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-task-rules', id] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update rule.'),
  });

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRule, setEditRule] = useState({
    title: '', roleSlot: '', frequency: 'weekly',
    generateDayOfMonth: '1', dueDayOfMonth: '1', weekday: '1',
  });

  function startEditRule(rule: any) {
    setEditingRuleId(rule.id);
    setEditRule({
      title: rule.title,
      roleSlot: rule.roleSlot,
      frequency: rule.frequency,
      generateDayOfMonth: String(rule.generateDayOfMonth || 1),
      dueDayOfMonth: String(rule.dueDayOfMonth || rule.generateDayOfMonth || 1),
      weekday: String(rule.weekday ?? 1),
    });
  }

  const updateRule = useMutation({
    mutationFn: ({ ruleId, payload }: { ruleId: string; payload: typeof editRule }) =>
      api.patch(`/projects/${id}/recurring-task-rules/${ruleId}`, payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-task-rules', id] });
      setEditingRuleId(null);
      toast.success('Schedule updated');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update schedule.'),
  });

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => api.delete(`/projects/${id}/recurring-task-rules/${ruleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-task-rules', id] });
      toast.success('Schedule set to Inactive');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change schedule status.'),
  });

  const deleteArtifact = useMutation({
    mutationFn: (fileUrl: string) => {
      const filename = fileUrl.split('/').pop() as string;
      return api.delete(`/media/${encodeURIComponent(filename)}`).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stage-artifacts', id] });
      qc.invalidateQueries({ queryKey: ['all-artifacts', id] });
      toast.success('File set to Inactive.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to change file status.'),
  });

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Project" />
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 space-y-5 max-w-6xl animate-pulse">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-2 flex-1">
                  <div className="h-5 bg-gray-200 rounded w-56" />
                  <div className="h-4 bg-gray-100 rounded w-36" />
                </div>
                <div className="h-6 bg-gray-100 rounded-full w-16" />
              </div>
              <div className="mt-5 flex gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-7 bg-gray-100 rounded-full w-24" />
                ))}
              </div>
            </div>
            <div className="flex gap-6 border-b border-gray-200 pb-0">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-4 bg-gray-100 rounded w-16 mb-2.5" />
              ))}
            </div>
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="h-4 bg-gray-100 rounded w-12" />
              </div>
              <div className="p-5 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between py-1 gap-2">
                    <div className="space-y-1.5">
                      <div className="h-4 bg-gray-100 rounded w-48" />
                      <div className="h-3 bg-gray-100 rounded w-28" />
                    </div>
                    <div className="h-5 bg-gray-100 rounded-full w-20" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!project) return (
    <div className="flex flex-col h-full">
      <Header title="Project" />
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium text-gray-700">Project not found or access denied.</p>
          <p className="text-xs text-gray-400">You may not be assigned to this project, or it does not exist.</p>
        </div>
      </div>
    </div>
  );

  const isAdminUser = user?.role?.key === 'super_admin' || user?.role?.key === 'admin';
  const canManageTeam = isAdminUser || !!user?.role?.permissions?.['projects.manage'];
  // SEO sheet import / row edits — any role with projects.act (SEO, link builder, employee, etc.)
  const canActOnProject = canManageTeam || !!user?.role?.permissions?.['projects.act'];
  const stages = timeline?.stages || [];
  const events = timeline?.events || [];
  const currentStageIdx = stages.findIndex((s: any) => s.key === project.currentStageKey);
  const currentStage = stages[currentStageIdx] as any;
  const isApprovalStage = currentStage?.stageType === 'approval';

  // Unique role slots from the template stages, plus automation-only role slots
  // (Blog Writer) for recurring SEO projects — they don't own a workflow stage,
  // they're only used by the recurring auto-task engine below (ongoing blog
  // content is part of the SEO retainer). Other recurring services — GMB,
  // social, ads — don't produce blog content, so they don't get this slot.
  const templateStages: any[] = project.template?.stages || [];
  const stageRoleSlots = [...new Set(templateStages.map((s: any) => s.ownerRoleSlot).filter(Boolean))] as string[];
  const automationRoleSlots = project.isRecurring && project.serviceTypeKey === 'seo'
    ? ['blog_writer'].filter((s) => !stageRoleSlots.includes(s))
    : [];
  // Every project gets a Project Strategist slot, regardless of service type —
  // not just the ones (SEO/GMB) whose template already owns a stage with it.
  const strategistSlot = stageRoleSlots.includes('project_strategist') ? [] : ['project_strategist'];
  const roleSlots = [...stageRoleSlots, ...automationRoleSlots, ...strategistSlot];
  const assignmentMap: Record<string, any> = {};
  for (const a of project.assignments || []) assignmentMap[a.roleSlot] = a;
  const assignedUser = project.assignments?.find((a: any) => a.roleSlot === currentStage?.ownerRoleSlot);
  const isAssigned = user?.role?.key === 'super_admin' || user?.role?.key === 'admin' || assignedUser?.user?.id === user?.id;

  const isSeoProject = project.serviceTypeKey === 'seo';
  const isGmbProject = project.serviceTypeKey === 'gmb';
  // Tab access follows the PROJECT'S OWN team assignment (the "Link Builder" /
  // "Content Writer" / etc. role slot shown in the Team section below) — not the
  // user's overarching CRM role, which is usually just something generic like
  // "Employee". A user assigned to this project's link_builder slot only sees
  // Backlinks here, even if their global role has no bearing on that at all.
  // Holding project_manager (or being admin) always keeps full access.
  const SPECIALIST_TAB_ACCESS: Record<string, Tab[]> = {
    project_strategist: ['keywords', 'backlinks', 'content', 'blogs', 'reporting'],
    link_builder: ['backlinks'],
    content_writer: ['content'],
    blog_writer: ['blogs'],
  };
  const myRoleSlots: string[] = (project.assignments || [])
    .filter((a: any) => a.user?.id === user?.id)
    .map((a: any) => a.roleSlot);
  const iAmProjectManager = myRoleSlots.includes('project_manager');
  const iAmProjectStrategist = myRoleSlots.includes('project_strategist');
  // Weekly blog / retainer automation is scheduled deliberately — not auto-started.
  const canScheduleAutomation = isAdminUser || canManageTeam || iAmProjectManager || iAmProjectStrategist;
  const heldSpecialistSlots = myRoleSlots.filter((slot) => SPECIALIST_TAB_ACCESS[slot]);
  const specialistTabs = (!isAdminUser && !iAmProjectManager && heldSpecialistSlots.length > 0)
    ? Array.from(new Set(heldSpecialistSlots.flatMap((slot) => SPECIALIST_TAB_ACCESS[slot])))
    : null;
  const projectWorkflowTabs: Tab[] = isSeoProject
    ? SEO_WORKFLOW_TABS
    : isGmbProject
      ? GMB_WORKFLOW_TABS
      : [];
  const visibleWorkflowTabs = specialistTabs
    ? projectWorkflowTabs.filter((t) => specialistTabs.includes(t))
    : projectWorkflowTabs;
  const allowedTabs: Tab[] = ['overview', 'comments', ...visibleWorkflowTabs];
  const TABS: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    ...visibleWorkflowTabs.map((key) => ({ key, label: WORKFLOW_TAB_LABELS[key] })),
    { key: 'comments', label: 'Comments' },
  ];

  if (!allowedTabs.includes(tab)) {
    router.replace(`/projects/${id}?tab=overview`, { scroll: false });
  }

  async function uploadArtifactFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setArtifactUploading(true);
    try {
      await Promise.all(list.map((file) => {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('projectId', id);
        fd.append('stageKey', project.currentStageKey);
        return api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      }));
      toast.success(list.length > 1 ? `${list.length} files uploaded.` : 'File uploaded.');
      qc.invalidateQueries({ queryKey: ['stage-artifacts', id] });
      qc.invalidateQueries({ queryKey: ['all-artifacts', id] });
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally { setArtifactUploading(false); }
  }

  async function handleMarkComplete() {
    if (figmaLink.trim()) {
      try { await saveFigmaLink(); } catch { return; }
    }
    actionMutation.mutate({ action: 'complete', note: actionNote });
  }

  function toAbsoluteUrl(url: string) {
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  /** Pasted Google Doc / Drive / Notion links vs uploaded media files. */
  function isLinkDeliverable(url: string, fileName?: string | null) {
    if (fileName === 'Link') return true;
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u) && !u.startsWith('//')) return false;
    if (/\/upload\//i.test(u)) return false;
    if (/\.(pdf|docx?|txt|md|html?|htm|csv|rtf)(\?|#|$)/i.test(u)) return false;
    return true;
  }

  async function openDeliverable(url: string, fileName?: string | null) {
    if (isLinkDeliverable(url, fileName)) {
      window.open(toAbsoluteUrl(url), '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await openFileInNewTab(url);
    } catch {
      window.open(toAbsoluteUrl(url), '_blank', 'noopener,noreferrer');
    }
  }

  async function downloadKeywordReport() {
    try {
      await downloadAuthedFile(`/seo/projects/${id}/keywords/pdf`, `keyword-report-${id}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate PDF.');
    }
  }

  async function viewKeywordReport() {
    try {
      await viewAuthedFile(`/seo/projects/${id}/keywords/pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open PDF.');
    }
  }

  async function downloadBacklinkReport() {
    try {
      await downloadAuthedFile(`/seo/projects/${id}/backlinks/pdf`, `backlink-report-${id}.pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to generate PDF.');
    }
  }

  async function viewBacklinkReport() {
    try {
      await viewAuthedFile(`/seo/projects/${id}/backlinks/pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open PDF.');
    }
  }

  async function saveFigmaLink() {
    if (!figmaLink.trim()) return;
    setArtifactUploading(true);
    try {
      await api.post('/media/link', {
        projectId: id,
        stageKey: project.currentStageKey,
        url: toAbsoluteUrl(figmaLink),
        kind: 'figma',
      });
      toast.success('Link saved.');
      setFigmaLink('');
      qc.invalidateQueries({ queryKey: ['stage-artifacts', id] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Failed to save link.');
      throw err; // re-throw so handleMarkComplete knows it failed
    } finally { setArtifactUploading(false); }
  }

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={!!confirmSeoDelete}
        title={
          confirmSeoDelete?.kind === 'keywords-sheet' ? 'Set keyword sheet to Inactive'
            : confirmSeoDelete?.kind === 'backlinks-sheet' ? 'Set backlink sheet to Inactive'
              : confirmSeoDelete?.kind === 'keywords-selected' ? 'Set selected keywords to Inactive'
                : confirmSeoDelete?.kind === 'backlinks-selected' ? 'Set selected backlinks to Inactive'
                  : confirmSeoDelete?.kind === 'backlink' ? 'Set backlink to Inactive'
                    : 'Set keyword to Inactive'
        }
        // Nothing here is destroyed — rows are flipped inactive, keeping their rank
        // history, and an admin can bring them back (see SoftDeleteService).
        message={
          confirmSeoDelete?.kind === 'keywords-sheet'
            ? `This sets ${deletableKeywordIds.length} keyword(s) to Inactive — their rank history is kept and they can be set back to Active. Assigned or approved keywords (${lockedKeywordIds.size}) are left alone.`
            : confirmSeoDelete?.kind === 'backlinks-sheet'
              ? `This sets ${deletableBacklinkIds.length} backlink(s) to Inactive — they can be set back to Active later. Indexed backlinks (${(backlinks as any[]).length - deletableBacklinkIds.length}) are left alone.`
              : confirmSeoDelete?.kind === 'keywords-selected'
                ? `Set ${confirmSeoDelete.count ?? selectedKeywordIds.size} selected keyword(s) to Inactive? They keep their rank history and can be set back to Active. Keywords assigned to a writer or with approved content are skipped.`
                : confirmSeoDelete?.kind === 'backlinks-selected'
                  ? `Set ${confirmSeoDelete.count ?? selectedBacklinkIds.size} selected backlink(s) to Inactive? They can be set back to Active later. Indexed backlinks are skipped.`
                  : confirmSeoDelete?.kind === 'backlink'
                    ? `Set this backlink${confirmSeoDelete.label ? ` (${confirmSeoDelete.label})` : ''} to Inactive? It can be set back to Active later — nothing is deleted.`
                    : `Set keyword${confirmSeoDelete?.label ? ` "${confirmSeoDelete.label}"` : ''} to Inactive? Its rank history is kept and it can be set back to Active — nothing is deleted.`
        }
        confirmLabel={
          confirmSeoDelete?.kind?.endsWith('-selected') ? 'Set selected Inactive' : 'Set Inactive'
        }
        onConfirm={() => {
          if (!confirmSeoDelete) return;
          if (confirmSeoDelete.kind === 'keyword' && confirmSeoDelete.id) deleteKeyword.mutate(confirmSeoDelete.id);
          else if (confirmSeoDelete.kind === 'backlink' && confirmSeoDelete.id) deleteBacklink.mutate(confirmSeoDelete.id);
          else if (confirmSeoDelete.kind === 'keywords-sheet') clearKeywords.mutate();
          else if (confirmSeoDelete.kind === 'backlinks-sheet') clearBacklinks.mutate();
          else if (confirmSeoDelete.kind === 'keywords-selected') {
            bulkDeleteKeywords.mutate([...selectedKeywordIds]);
          } else if (confirmSeoDelete.kind === 'backlinks-selected') {
            bulkDeleteBacklinks.mutate([...selectedBacklinkIds]);
          }
        }}
        onCancel={() => !seoDeletePending && setConfirmSeoDelete(null)}
      />
      <ConfirmDialog
        open={showCancelConfirm}
        title="Cancel Project"
        message="This will mark the project as cancelled and stop all further stage progress. This cannot be undone."
        confirmLabel="Cancel Project"
        cancelLabel="Keep Project"
        onConfirm={() => cancelProject.mutate()}
        onCancel={() => !cancelProject.isPending && setShowCancelConfirm(false)}
      />
      <ConfirmDialog
        open={confirmClearBlogs}
        title="Clear unapproved blog rows"
        message={`This sets ${pendingClearCount} unapproved row${pendingClearCount === 1 ? '' : 's'} to Inactive. Approved rows are kept. You can switch any row back to Active afterwards.`}
        confirmLabel="Clear rows"
        cancelLabel="Keep them"
        onConfirm={() => { clearBlogRows.mutate(blogIdsToClear); setConfirmClearBlogs(false); }}
        onCancel={() => !clearBlogRows.isPending && setConfirmClearBlogs(false)}
      />
      <Header title={project.name} />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 space-y-5 max-w-6xl">

          {/* Project meta + stage progress */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            {/* Project names are long ("Verensoft - Web Development - Growth").
                Beside a status chip and a Cancel button on one unwrapped row they
                collided — the title broke to one word per line while the button
                overlapped it. Wrap, and give the title the full width first. */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 break-words">{project.name}</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {project.client?.name} · <span className="capitalize">{project.serviceTypeKey}</span>
                </p>
                {project.description && <p className="text-sm text-gray-600 mt-2">{project.description}</p>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn(
                  'px-2.5 py-1 text-xs font-semibold rounded-full',
                  project.status === 'active' ? 'bg-brand-100 text-brand-800' :
                  project.status === 'completed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                )}>
                  {project.status}
                </span>
                {canManageTeam && !['cancelled', 'completed'].includes(project.status) && (
                  <button onClick={() => setShowCancelConfirm(true)}
                    className="text-xs font-semibold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-lg transition-colors">
                    Cancel Project
                  </button>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-start gap-1 overflow-x-auto pb-1">
              {stages.map((stage: any, idx: number) => {
                // Once the project is completed, its final stage is done, not "in
                // progress" — without this, the last pill kept the dark active/clock
                // styling forever even though there's nothing left to work on.
                const done = idx < currentStageIdx || (idx === currentStageIdx && project.status === 'completed');
                const current = idx === currentStageIdx && project.status !== 'completed';
                // Timestamp this project entered this stage — the most recent event
                // whose toStageKey matches (handles rewinds re-entering a stage).
                const enteredAt = [...events].reverse().find((ev: any) => ev.toStageKey === stage.key)?.createdAt;
                return (
                  <div key={stage.key} className="flex items-start gap-1 shrink-0">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        title={enteredAt ? `Entered ${formatDate(enteredAt, 'MMM d, yyyy · h:mm a')}` : undefined}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium',
                          done ? 'bg-brand-100 text-brand-800' :
                          current ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-500'
                        )}
                      >
                        {done && <CheckCircle className="w-3 h-3" />}
                        {current && <Clock className="w-3 h-3" />}
                        {stage.name}
                      </div>
                      {enteredAt && (done || current) && (
                        <span className="text-[10px] text-gray-400 whitespace-nowrap">{formatDate(enteredAt, 'MMM d, h:mm a')}</span>
                      )}
                    </div>
                    {idx < stages.length - 1 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-1.5" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action panel — only shown to the stage owner */}
          {project.status === 'active' && isAssigned && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Stage Actions</h3>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full capitalize">
                  {isApprovalStage ? 'Approval stage' : 'Work stage'} · {titleCase(currentStage?.ownerRoleSlot)}
                </span>
              </div>

              {/* Note from the last stage transition only — context for whoever is acting now */}
              {(() => {
                const lastNote = [...events].reverse().find((ev: any) => ev.note);
                if (!lastNote) return null;
                return (
                  <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <Avatar src={lastNote.actor?.avatarUrl} name={lastNote.actor?.name} size="xs" className="w-5 h-5 text-[10px]" />
                      <span className="text-xs font-semibold text-gray-700">{lastNote.actor?.name}</span>
                      <span className="text-xs text-gray-400 capitalize">{titleCase(lastNote.fromStageKey)}</span>
                      <span className="text-xs text-gray-300 ml-auto shrink-0">{formatDate(lastNote.createdAt, 'MMM d, yyyy · h:mm a')}</span>
                    </div>
                    <Linkify text={lastNote.note} className="block text-sm text-gray-700 ml-7 leading-relaxed whitespace-pre-wrap break-words" />
                  </div>
                );
              })()}

              {/* Deliverables — all files/links ever uploaded for this project, shown to the approver */}
              {isApprovalStage && deliverables.length > 0 && (
                <div className="mb-4 p-3.5 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                  <p className="text-xs font-semibold text-blue-800">Deliverables to review</p>
                  {(deliverables as any[]).map((a: any) => (
                    <div key={a.id} className="flex items-center gap-2">
                      {a.kind === 'figma' || a.kind === 'link'
                        ? <Link className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        : <Paperclip className="w-3.5 h-3.5 text-blue-500 shrink-0" />}
                      <a
                        href={a.kind === 'figma' || a.kind === 'link' ? toAbsoluteUrl(a.fileUrl) : a.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-700 hover:underline truncate"
                      >
                        {a.fileName && a.fileName !== a.fileUrl ? a.fileName : a.fileUrl}
                      </a>
                      <span className="text-xs text-blue-300 shrink-0 ml-auto">
                        {titleCase(a.stageKey)}
                        {a.uploader?.name ? ` · ${a.uploader.name}` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {isApprovalStage && deliverables.length === 0 && (
                <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                  <p className="text-xs text-gray-500">No deliverable was attached for this project yet.</p>
                </div>
              )}

              {/* Deliverable — file or Figma link, always available on any work stage */}
              {!isApprovalStage && (() => {
                const stageUploads = (allArtifacts as any[]).filter((a: any) => a.stageKey === project.currentStageKey);
                return (
                  <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                    <p className="text-xs font-semibold text-amber-800">Attach deliverable <span className="font-normal text-amber-600">(optional)</span></p>
                    {/* Wraps on phones: a button, a free-text link field and a
                        second button do not fit one line, and the field was
                        running off the card. */}
                    <div className="flex flex-wrap gap-2">
                      <input ref={fileRef} type="file" multiple className="hidden"
                        onChange={(e) => { if (e.target.files?.length) uploadArtifactFiles(e.target.files); e.target.value = ''; }} />
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={artifactUploading}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-100 disabled:opacity-60 shrink-0">
                        <Upload className="w-3.5 h-3.5" /> {artifactUploading ? 'Uploading…' : 'Upload files'}
                      </button>
                      <input
                        value={figmaLink}
                        onChange={(e) => setFigmaLink(e.target.value)}
                        placeholder="Or paste Figma / Drive link…"
                        className="flex-1 min-w-48 px-3 py-1.5 text-xs border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                      />
                      <button type="button" onClick={saveFigmaLink} disabled={!figmaLink.trim() || artifactUploading}
                        className="px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-lg shrink-0">
                        Save link
                      </button>
                    </div>

                    {/* Uploaded files preview for this stage */}
                    {stageUploads.length > 0 && (
                      <div className="border-t border-amber-200 pt-2.5 space-y-1.5">
                        <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider">Uploaded ({stageUploads.length})</p>
                        {stageUploads.map((a: any) => {
                          const isLink = a.kind === 'figma' || a.kind === 'link';
                          const href = isLink ? toAbsoluteUrl(a.fileUrl) : a.fileUrl;
                          const label = a.fileName && a.fileName !== a.fileUrl
                            ? a.fileName
                            : (isLink ? a.fileUrl : a.fileUrl?.split('/').pop() || 'File');
                          return (
                            <div key={a.id} className="flex items-center gap-2 py-1 px-2 bg-white rounded-lg border border-amber-100">
                              {isLink
                                ? <Link className="w-3 h-3 text-amber-500 shrink-0" />
                                : <Paperclip className="w-3 h-3 text-amber-500 shrink-0" />}
                              <a href={href} target="_blank" rel="noreferrer"
                                className="text-xs text-amber-800 hover:underline truncate flex-1 min-w-0">
                                {label}
                              </a>
                              <span className="text-[10px] text-amber-400 shrink-0 capitalize">
                                {a.kind || 'file'}
                              </span>
                              {!isLink && (
                                <ActiveToggle
                                  isActive
                                  label="file"
                                  disabled={deleteArtifact.isPending}
                                  onToggle={() => deleteArtifact.mutate(a.fileUrl)}
                                  className="p-0.5 shrink-0"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
              <textarea
                value={actionNote}
                onChange={(e) => setActionNote(e.target.value)}
                placeholder="Add a note (optional)…"
                rows={2}
                className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600 mb-3"
              />
              <div className="flex gap-2">
                {!isApprovalStage && (
                  <button onClick={handleMarkComplete} disabled={actionMutation.isPending || artifactUploading}
                    className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                    <CheckCircle className="w-4 h-4" /> Mark Complete
                  </button>
                )}
                {isApprovalStage && (
                  <>
                    <button onClick={() => actionMutation.mutate({ action: 'approve', note: actionNote })} disabled={actionMutation.isPending}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                      <CheckCircle className="w-4 h-4" /> Approve
                    </button>
                    <button onClick={() => actionMutation.mutate({ action: 'reject', note: actionNote })} disabled={actionMutation.isPending}
                      className="flex items-center gap-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-medium px-4 py-2 rounded-lg border border-red-200">
                      <XCircle className="w-4 h-4" /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {project.status === 'active' && !isAssigned && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 text-sm text-gray-500">
              You are not assigned to act on this stage ({titleCase(currentStage?.ownerRoleSlot)}).
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap shrink-0',
                  tab === t.key
                    ? 'border-brand-700 text-brand-800'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Overview tab */}
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Tasks</h3>
                  <span className="text-[11px] text-gray-400 hidden sm:inline">
                    This stage + open issues
                  </span>
                  {canManageTeam && (
                    <button onClick={() => setShowTaskForm((v) => !v)}
                      className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-brand-800 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
                      <Plus className="w-3.5 h-3.5" /> Add Task
                    </button>
                  )}
                </div>
                {showTaskForm && (
                  <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60 space-y-3">
                    <input value={newTask.title} onChange={(e) => setNewTask((x) => ({ ...x, title: e.target.value }))}
                      placeholder="Task title (e.g. Fix duplicate business listing)"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Assign to</label>
                        <select value={newTask.assigneeId} onChange={(e) => setNewTask((x) => ({ ...x, assigneeId: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                          <option value="">Unassigned</option>
                          {(users as any[]).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-gray-500 mb-1">Due date</label>
                        <input type="date" value={newTask.dueAt} onChange={(e) => setNewTask((x) => ({ ...x, dueAt: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      </div>
                    </div>
                    <textarea
                      value={newTask.remarks}
                      onChange={(e) => setNewTask((x) => ({ ...x, remarks: e.target.value }))}
                      rows={2}
                      placeholder="Remarks / instructions for the assignee…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                    />
                    <p className="text-[11px] text-gray-400">
                      Starts as To do. Assignee is notified immediately
                      {newTask.dueAt ? '; automatic reminder 24 hours before due date.' : '.'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => createTask.mutate(newTask)}
                        disabled={createTask.isPending || !newTask.title.trim()}
                        className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                      >
                        {createTask.isPending ? 'Creating…' : 'Create Task'}
                      </button>
                      <button onClick={() => setShowTaskForm(false)} className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3.5 py-2">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="divide-y divide-gray-100">
                  {(tasks || []).length === 0 ? (
                    <p className="px-5 py-8 text-sm text-gray-400 text-center">No tasks for this stage.</p>
                  ) : (
                    (tasks || []).map((task: any) => {
                      const isDone = task.status === 'done' || task.status === 'approved';
                      const isOverdue = !!task.dueAt
                        && new Date(task.dueAt) < new Date(new Date().toDateString())
                        && !isDone;
                      const typeLabel = task.type === 'blog_post' ? 'Blog'
                        : task.type === 'content' ? 'Content'
                          : task.type ? titleCase(task.type) : null;
                      // Assigned-by-someone-else tasks go through submit → review — no one-click Done.
                      const reviewId = task.reviewerId || task.createdBy;
                      const needsReview = !!(task.assigneeId && reviewId && reviewId !== task.assigneeId);
                      return (
                        <div
                          key={task.id}
                          onClick={() => openProjectTask(task.id)}
                          className={cn(
                            'flex items-center justify-between gap-3 px-5 py-3.5 cursor-pointer hover:bg-gray-50/80 transition-colors',
                            isOverdue && 'bg-red-50/30',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              {typeLabel && (
                                <span className="inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-[10px] font-medium text-gray-500">
                                  <Flag className="w-2.5 h-2.5 text-brand-700" />
                                  {typeLabel}
                                </span>
                              )}
                              <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-gray-500">
                              <span className="inline-flex items-center gap-1.5 min-w-0">
                                <Avatar name={task.assignee?.name} size="xs" />
                                <span className="truncate">{task.assignee?.name || 'Unassigned'}</span>
                              </span>
                              {task.dueAt && (
                                <span className={cn('inline-flex items-center gap-1', isOverdue ? 'text-red-600 font-medium' : '')}>
                                  {isOverdue ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <Calendar className="w-3 h-3 shrink-0 text-gray-400" />}
                                  {formatDate(task.dueAt)}
                                </span>
                              )}
                              {task.reminderAt && (
                                <span className="inline-flex items-center gap-1 text-amber-700">
                                  <Bell className="w-3 h-3 shrink-0" />
                                  {formatDate(task.reminderAt)}
                                </span>
                              )}
                            </div>
                            {task.remarks && (
                              <p className="text-xs text-gray-600 mt-1 line-clamp-2 min-w-0">
                                <Linkify text={task.remarks} />
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={cn(
                              'px-2.5 py-1 text-xs font-medium rounded-full',
                              isDone ? 'bg-brand-100 text-brand-800' :
                              task.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                              task.status === 'submitted' ? 'bg-amber-100 text-amber-700' :
                              task.status === 'in_review' ? 'bg-violet-100 text-violet-700' :
                              task.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
                            )}>
                              {titleCase(task.status || 'todo')}
                            </span>
                            {!isDone && isAssigned && !needsReview && (
                              <button
                                onClick={(e) => { e.stopPropagation(); completeTask.mutate(task.id); }}
                                disabled={completeTask.isPending}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-brand-50 hover:bg-brand-100 text-brand-800 rounded-full border border-brand-200 disabled:opacity-50 transition-colors"
                              >
                                <CheckCircle className="w-3 h-3" /> Done
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Team assignments */}
              {roleSlots.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900">Team</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {/* Client slot — shows linked client, not an internal user dropdown */}
                    {roleSlots.includes('client') && (
                      <div className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-4">
                        <div>
                          <p className="text-xs font-medium text-gray-500">Client</p>
                          <p className="text-sm text-gray-900 mt-0.5">
                            {project.client?.name || <span className="text-gray-400 italic">No client linked</span>}
                          </p>
                        </div>
                        {project.client?.name && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">Portal access</span>
                        )}
                      </div>
                    )}

                    {/* Internal team slots — assignable by admin, PM, or anyone with projects.manage */}
                    {roleSlots.filter((s) => s !== 'client').map((slot) => {
                      const current = assignmentMap[slot];
                      return (
                        <div key={slot} className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-5 py-3.5 gap-2 sm:gap-4">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-500 capitalize flex items-center gap-1.5">
                              {titleCase(slot)}
                            </p>
                            <p className="text-sm text-gray-900 mt-0.5">
                              {current?.user?.name || <span className="text-gray-400 italic">Unassigned</span>}
                            </p>
                          </div>
                          {canManageTeam && (() => {
                            const slotUsers = usersForRoleSlot(users as any[], slot, current?.user?.id);
                            return (
                              <select
                                key={`${slot}-${current?.user?.id || 'none'}-${(users as any[]).length}`}
                                defaultValue={current?.user?.id || ''}
                                onChange={(e) => assignMember.mutate({ roleSlot: slot, userId: e.target.value })}
                                className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-40"
                                title={slotUsers.length ? undefined : `No users have the ${titleCase(slot)} role yet`}
                              >
                                <option value="">Unassigned</option>
                                {slotUsers.map((u: any) => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Recurring auto-task automation — SEO projects get their monthly review +
                  ranking-update rules provisioned automatically on reaching the final
                  stage; every other recurring service (GMB, blog, etc.) configures its
                  own cadence here. */}
              {project.isRecurring && (
                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900">Automation</h3>
                    <span className="text-xs text-gray-400 ml-auto">{(recurringRules as any[]).length} rule{(recurringRules as any[]).length !== 1 ? 's' : ''}</span>
                    {canScheduleAutomation && (
                      <button onClick={() => setShowRuleForm((v) => !v)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-brand-800 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
                        <Plus className="w-3.5 h-3.5" /> Schedule task
                      </button>
                    )}
                  </div>

                  {!canScheduleAutomation && (recurringRules as any[]).length === 0 && (
                    <p className="px-5 pt-4 text-xs text-gray-400">
                      Only an admin, the project manager, or the assigned strategist can schedule recurring tasks here.
                    </p>
                  )}

                  {currentStage?.isTerminal && project.serviceTypeKey !== 'seo' && (recurringRules as any[]).length === 0 && (
                    <div className="mx-5 mt-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3">
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-xs text-amber-800">
                          This project has reached its recurring stage. Do you want to schedule an auto task —
                          set a frequency and due date so tasks get created automatically each cycle?
                        </p>
                        {canScheduleAutomation && !showRuleForm && (
                          <button onClick={() => setShowRuleForm(true)}
                            className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 px-3 py-1.5 rounded-lg transition-colors">
                            <Plus className="w-3.5 h-3.5" /> Yes, schedule it
                          </button>
                        )}
                      </div>
                    </div>
                  )}


                  {showRuleForm && (
                    <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/60 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Task title</label>
                          <input value={newRule.title} onChange={(e) => setNewRule((x) => ({ ...x, title: e.target.value }))}
                            placeholder="e.g. Weekly GMB Post"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Assign to role</label>
                          <select
                            value={newRule.roleSlot}
                            onChange={(e) => {
                              const roleSlot = e.target.value;
                              setNewRule((x) => ({
                                ...x,
                                roleSlot,
                                taskType: roleSlot === 'blog_writer' ? 'blog_post' : x.taskType === 'blog_post' ? 'custom' : x.taskType,
                                title: roleSlot === 'blog_writer' && !x.title.trim() ? 'Weekly Blog Post' : x.title,
                              }));
                            }}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                          >
                            <option value="">Select role…</option>
                            {roleSlots.filter((s) => s !== 'client').map((slot) => (
                              <option key={slot} value={slot}>{slot.replace(/_/g, ' ')}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                          <select value={newRule.frequency} onChange={(e) => setNewRule((x) => ({ ...x, frequency: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                            <option value="weekly">Weekly</option>
                            <option value="biweekly">Biweekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </div>
                        {(newRule.frequency === 'weekly' || newRule.frequency === 'biweekly') ? (
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              {newRule.frequency === 'biweekly' ? 'Repeat on (every other week)' : 'Repeat on (weekday)'}
                            </label>
                            <select value={newRule.weekday} onChange={(e) => setNewRule((x) => ({ ...x, weekday: e.target.value }))}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                              {WEEKDAY_LABELS.map((d, i) => (
                                <option key={d} value={i}>
                                  {newRule.frequency === 'biweekly' ? `Every other ${d}` : `Every ${d}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-600 mb-1">Day of month</label>
                            <input type="number" min={1} max={28} value={newRule.generateDayOfMonth}
                              onChange={(e) => setNewRule((x) => ({
                                ...x,
                                generateDayOfMonth: e.target.value,
                                dueDayOfMonth: e.target.value,
                              }))}
                              placeholder="1–28"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                            <p className="text-[11px] text-gray-400 mt-1">Task is created on this day each month.</p>
                          </div>
                        )}
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Due date</label>
                          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                            Set automatically to when the <span className="font-medium text-gray-800">next cycle starts</span>
                            {newRule.frequency === 'weekly' && ' (7 days later)'}.
                            {newRule.frequency === 'biweekly' && ' (14 days later)'}.
                            {newRule.frequency === 'monthly' && ' (same day next month)'}.
                          </div>
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs font-medium text-gray-600 mb-1">Start date</label>
                          <input type="date" value={newRule.startDate}
                            onChange={(e) => setNewRule((x) => ({ ...x, startDate: e.target.value }))}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          <p className="text-[11px] text-gray-400 mt-1">Schedule begins generating tasks from this date.</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => createRule.mutate(newRule)}
                          disabled={createRule.isPending || !newRule.title.trim() || !newRule.roleSlot}
                          className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                        >
                          Save schedule
                        </button>
                        <button onClick={() => setShowRuleForm(false)}
                          className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3.5 py-2">Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="divide-y divide-gray-100">
                    {(recurringRules as any[]).length === 0 ? (
                      <p className="px-5 py-6 text-sm text-gray-400 text-center">No recurring tasks scheduled.</p>
                    ) : (
                      (recurringRules as any[]).map((rule: any) => (
                        <div key={rule.id}>
                          <div className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{rule.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {formatRuleCadence(rule)}
                                {' · '}{rule.roleSlot.replace(/_/g, ' ')}
                              </p>
                            </div>
                            {canScheduleAutomation && (
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => toggleRule.mutate({ ruleId: rule.id, isActive: !rule.isActive })}
                                  className={cn('px-2.5 py-1 text-xs font-medium rounded-full border transition-colors',
                                    rule.isActive ? 'bg-brand-50 text-brand-800 border-brand-200' : 'bg-gray-100 text-gray-500 border-gray-200')}
                                >
                                  {rule.isActive ? 'Active' : 'Paused'}
                                </button>
                                <button
                                  onClick={() => editingRuleId === rule.id ? setEditingRuleId(null) : startEditRule(rule)}
                                  title="Edit schedule"
                                  className="text-gray-400 hover:text-brand-700"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <ActiveToggle
                                  isActive={rule.isActive !== false}
                                  label="schedule"
                                  disabled={deleteRule.isPending || toggleRule.isPending}
                                  onToggle={(next) => (next
                                    ? toggleRule.mutate({ ruleId: rule.id, isActive: true })
                                    : deleteRule.mutate(rule.id))}
                                />
                              </div>
                            )}
                          </div>
                          {editingRuleId === rule.id && (
                            <div className="px-5 pb-4 bg-gray-50/60 space-y-3">
                              <div className="grid grid-cols-2 gap-3 pt-3">
                                <div className="col-span-2">
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Task title</label>
                                  <input value={editRule.title} onChange={(e) => setEditRule((x) => ({ ...x, title: e.target.value }))}
                                    placeholder="e.g. Weekly Blog Post"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Assign to role</label>
                                  <select value={editRule.roleSlot} onChange={(e) => setEditRule((x) => ({ ...x, roleSlot: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                                    {roleSlots.filter((s) => s !== 'client').map((slot) => (
                                      <option key={slot} value={slot}>{slot.replace(/_/g, ' ')}</option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Frequency</label>
                                  <select value={editRule.frequency} onChange={(e) => setEditRule((x) => ({ ...x, frequency: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                                    <option value="weekly">Weekly</option>
                                    <option value="biweekly">Biweekly</option>
                                    <option value="monthly">Monthly</option>
                                  </select>
                                </div>
                                {(editRule.frequency === 'weekly' || editRule.frequency === 'biweekly') ? (
                                  <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-600 mb-1">
                                      {editRule.frequency === 'biweekly' ? 'Repeat on (every other week)' : 'Repeat on (weekday)'}
                                    </label>
                                    <select value={editRule.weekday} onChange={(e) => setEditRule((x) => ({ ...x, weekday: e.target.value }))}
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                                      {WEEKDAY_LABELS.map((d, i) => (
                                        <option key={d} value={i}>
                                          {editRule.frequency === 'biweekly' ? `Every other ${d}` : `Every ${d}`}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                ) : (
                                  <div className="col-span-2">
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Day of month</label>
                                    <input type="number" min={1} max={28} value={editRule.generateDayOfMonth}
                                      onChange={(e) => setEditRule((x) => ({
                                        ...x,
                                        generateDayOfMonth: e.target.value,
                                        dueDayOfMonth: e.target.value,
                                      }))}
                                      placeholder="1–28"
                                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                                  </div>
                                )}
                                <div className="col-span-2">
                                  <label className="block text-xs font-medium text-gray-600 mb-1">Due date</label>
                                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                                    Set automatically to when the next cycle starts.
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => updateRule.mutate({ ruleId: rule.id, payload: editRule })}
                                  disabled={updateRule.isPending || !editRule.title.trim() || !editRule.roleSlot}
                                  className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                                >
                                  {updateRule.isPending ? 'Saving…' : 'Save changes'}
                                </button>
                                <button onClick={() => setEditingRuleId(null)}
                                  className="text-sm font-medium text-gray-500 hover:text-gray-700 px-3.5 py-2">Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* All deliverables — visible to PM, workers, and admins at any stage */}
              {(allArtifacts as any[]).length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200">
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-gray-400" />
                    <h3 className="text-sm font-semibold text-gray-900">Deliverables</h3>
                    <span className="text-xs text-gray-400 ml-auto">{(allArtifacts as any[]).length} file{(allArtifacts as any[]).length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {(allArtifacts as any[]).map((a: any) => {
                      const isLink = a.kind === 'figma' || a.kind === 'link';
                      const href = isLink ? toAbsoluteUrl(a.fileUrl) : a.fileUrl;
                      const label = a.fileName && a.fileName !== a.fileUrl ? a.fileName : a.fileUrl;
                      const canDelete = !isLink && (isAdminUser || isAssigned);
                      return (
                        <div key={a.id} className="flex items-center gap-3 px-5 py-3">
                          {isLink
                            ? <Link className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            : <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <a href={href} target="_blank" rel="noreferrer"
                              className="text-sm text-blue-600 hover:underline truncate block">{label}</a>
                            <p className="text-xs text-gray-400 mt-0.5 capitalize">
                              {titleCase(a.stageKey)}
                              {a.uploader?.name ? ` · ${a.uploader.name}` : ''}
                              {a.createdAt ? ` · ${formatDate(a.createdAt)}` : ''}
                            </p>
                          </div>
                          {canDelete && (
                            <ActiveToggle
                              isActive
                              label="file"
                              disabled={deleteArtifact.isPending}
                              onToggle={() => deleteArtifact.mutate(a.fileUrl)}
                              className="p-1 shrink-0"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-900">Activity</h3></div>
                <div className="px-5 py-4 space-y-4">
                  {events.length === 0 ? (
                    <p className="text-sm text-gray-400">No events yet.</p>
                  ) : (
                    events.map((ev: any) => (
                      <div key={ev.id} className="flex gap-3">
                        <Avatar src={ev.actor?.avatarUrl} name={ev.actor?.name} size="xs" className="w-6 h-6" />
                        <div>
                          <p className="text-sm text-gray-700">
                            <span className="font-medium">{ev.actor?.name}</span>{' '}
                            {ev.action === 'rewind' ? 'rewound to' : `performed ${ev.action} →`}{' '}
                            <span className="text-brand-700 font-medium">{titleCase(ev.toStageKey)}</span>
                          </p>
                          {ev.note && <Linkify text={ev.note} className="block text-xs text-gray-500 mt-0.5 whitespace-pre-wrap break-words" />}
                          <p className="text-xs text-gray-400 mt-0.5">{formatDate(ev.createdAt, 'MMM d, yyyy · h:mm a')}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Keywords tab */}
          {tab === 'keywords' && (
            <div className="space-y-4">
              <div className="flex justify-end gap-2">
                <button
                  onClick={viewKeywordReport}
                  className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                >
                  <Eye className="w-4 h-4" /> View PDF
                </button>
                <button
                  onClick={downloadKeywordReport}
                  className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                >
                  <Download className="w-4 h-4" /> Download PDF Report
                </button>
              </div>

              {/* Stats — remaining/used count only active (focus) keywords */}
              {(() => {
                const total = keywords.length;
                const active = (keywords as any[]).filter((kw: any) => (kw.status || 'active') === 'active');
                const used = active.filter((kw: any) => approvedKeywordIds.has(kw.id)).length;
                const remaining = active.length - used;
                const inactive = total - active.length;
                const wordsGenerated = liveContent
                  .filter((cs: any) => cs.status === 'approved')
                  .reduce((sum: number, cs: any) => sum + (cs.wordCount || 0), 0);
                const statCards = isSeoProject
                  ? [
                      { label: 'Total Keywords', value: total },
                      { label: 'Active', value: active.length },
                      { label: 'Inactive', value: inactive },
                      { label: 'Used in Content', value: used },
                      { label: 'Remaining', value: remaining },
                      { label: 'Words Generated', value: wordsGenerated.toLocaleString() },
                    ]
                  : [
                      { label: 'Total Keywords', value: total },
                      { label: 'Active', value: active.length },
                      { label: 'Inactive', value: inactive },
                    ];
                return (
                  <div className={cn(
                    'grid gap-3',
                    isSeoProject ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3',
                  )}>
                    {statCards.map((s) => (
                      <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
                        <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Add row */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Add keyword</p>
                <div className="grid grid-cols-2 gap-3">
                  <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="Primary keyword *"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newKwExtra.secondaryKeywords} onChange={(e) => setNewKwExtra((x) => ({ ...x, secondaryKeywords: e.target.value }))} placeholder="Secondary keywords (comma-separated)"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newKwExtra.kd} onChange={(e) => setNewKwExtra((x) => ({ ...x, kd: e.target.value }))} placeholder="KD (difficulty)" type="number"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newKwExtra.volume} onChange={(e) => setNewKwExtra((x) => ({ ...x, volume: e.target.value }))} placeholder="Search volume" type="number"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newKwExtra.targetUrl} onChange={(e) => setNewKwExtra((x) => ({ ...x, targetUrl: e.target.value }))} placeholder="Target URL"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newKwExtra.targetLocation} onChange={(e) => setNewKwExtra((x) => ({ ...x, targetLocation: e.target.value }))} placeholder="Target location (e.g. USA, New York)"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  {isSeoProject && (
                    <>
                      <input value={newKwExtra.pageName} onChange={(e) => setNewKwExtra((x) => ({ ...x, pageName: e.target.value }))} placeholder="Page name (used for content tasks)"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <select value={newKwExtra.assignedWriterId} onChange={(e) => setNewKwExtra((x) => ({ ...x, assignedWriterId: e.target.value }))}
                        title={(assignableUsers as any[]).length ? undefined : 'No users have the Content Writer role yet'}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                        <option value="">Assign content writer (optional)</option>
                        {(assignableUsers as any[]).map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div className="flex gap-2 flex-wrap">
                  {canActOnProject && (
                    <>
                      <button
                        onClick={() => {
                          if (!newKeyword.trim()) return;
                          addKeyword.mutate({
                            primaryKeyword: newKeyword.trim(),
                            secondaryKeywords: newKwExtra.secondaryKeywords || undefined,
                            kd: newKwExtra.kd ? Number(newKwExtra.kd) : null,
                            volume: newKwExtra.volume ? Number(newKwExtra.volume) : null,
                            targetUrl: newKwExtra.targetUrl || undefined,
                            targetLocation: newKwExtra.targetLocation || undefined,
                            pageName: isSeoProject ? (newKwExtra.pageName || undefined) : undefined,
                            assignedWriterId: isSeoProject ? (newKwExtra.assignedWriterId || undefined) : undefined,
                          });
                        }}
                        disabled={addKeyword.isPending || !newKeyword.trim()}
                        className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                      >
                        <Plus className="w-4 h-4" /> Add Row
                      </button>
                      <button onClick={() => fileRef.current?.click()}
                        className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg">
                        <Upload className="w-4 h-4" /> Import Excel
                      </button>
                      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) importKeywords.mutate(e.target.files[0]); e.target.value = ''; }} />
                      {deletableKeywordIds.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmSeoDelete({ kind: 'keywords-sheet' })}
                          className="flex items-center gap-1.5 border border-amber-200 hover:bg-amber-50 text-amber-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                        >
                          <ToggleLeft className="w-4 h-4" /> Set sheet Inactive
                        </button>
                      )}
                      {selectedKeywordIds.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmSeoDelete({
                            kind: 'keywords-selected',
                            count: selectedKeywordIds.size,
                          })}
                          className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                        >
                          <ToggleLeft className="w-4 h-4" /> Set Inactive ({selectedKeywordIds.size})
                        </button>
                      )}
                    </>
                  )}
                  <ShowInactiveToggle {...inactive.toggleProps} />
                </div>
              </div>
              {/* Compact keyword list — no horizontal scroll; secondary keywords truncated */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {canActOnProject && keywords.length > 0 && (
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80">
                    <input
                      type="checkbox"
                      checked={allDeletableKeywordsSelected}
                      disabled={deletableKeywordIds.length === 0}
                      onChange={toggleAllKeywords}
                      className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
                      title="Select all deletable keywords"
                      aria-label="Select all deletable keywords"
                    />
                    <span className="text-xs text-gray-500">Select all deletable</span>
                  </div>
                )}

                {keywords.length === 0 ? (
                  <p className="px-4 py-10 text-sm text-gray-400 text-center">No keywords yet. Add a row or import Excel.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {pagedKeywords.map((kw: any) => {
                      const locked = lockedKeywordIds.has(kw.id);
                      const isInactive = (kw.status || 'active') === 'inactive';
                      const secondary = formatSecondaryKeywords(kw.secondaryKeywords);
                      const writers = [...(assignableUsers as any[])];
                      if (kw.assignedWriterId && kw.assignedWriter && !writers.some((u) => u.id === kw.assignedWriterId)) {
                        writers.unshift({ id: kw.assignedWriterId, name: kw.assignedWriter.name });
                      }
                      return (
                        <li
                          key={kw.id}
                          className={cn(
                            'px-4 py-3 flex gap-3 items-start',
                            isInactive ? inactiveRow(false) : 'hover:bg-gray-50/60',
                          )}
                        >
                          {canActOnProject && (
                            <input
                              type="checkbox"
                              checked={selectedKeywordIds.has(kw.id)}
                              disabled={locked}
                              onChange={() => toggleKeywordSelect(kw.id, !locked)}
                              className="mt-1 rounded border-gray-300 text-brand-700 focus:ring-brand-600 disabled:opacity-40 shrink-0"
                              aria-label={`Select ${kw.primaryKeyword}`}
                            />
                          )}
                          <div className="min-w-0 flex-1 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <p className={cn('text-sm font-semibold truncate', isInactive ? 'text-gray-500' : 'text-gray-900')}>
                                {kw.primaryKeyword}
                              </p>
                              {isSeoProject && kw.pageName && (
                                <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded shrink-0">
                                  {kw.pageName}
                                </span>
                              )}
                              {isSeoProject && locked && (
                                <span
                                  className="text-[10px] font-medium text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                  title={approvedKeywordIds.has(kw.id) ? "Content approved — can't be removed" : "Assigned to a content writer — can't be removed"}
                                >
                                  {approvedKeywordIds.has(kw.id) ? 'Approved' : 'Assigned'}
                                </span>
                              )}
                            </div>
                            {secondary ? (
                              <SupportingKeywordsCell raw={kw.secondaryKeywords} previewCount={4} className="max-w-xl" />
                            ) : null}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                              <span>KD <span className="font-medium text-gray-700 tabular-nums">{kw.kd ?? '—'}</span></span>
                              <span>Vol <span className="font-medium text-gray-700 tabular-nums">{kw.volume?.toLocaleString() ?? '—'}</span></span>
                              {kw.targetLocation && <span className="truncate max-w-[200px]" title={kw.targetLocation}>{kw.targetLocation}</span>}
                              {kw.targetUrl && (
                                <a
                                  href={kw.targetUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 hover:underline truncate max-w-[220px]"
                                  title={kw.targetUrl}
                                >
                                  {kw.targetUrl.replace(/^https?:\/\//, '')}
                                </a>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                            {canActOnProject ? (
                              <select
                                value={isInactive ? 'inactive' : 'active'}
                                onChange={(e) => updateKeywordStatus.mutate({
                                  keywordId: kw.id,
                                  status: e.target.value as 'active' | 'inactive',
                                })}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                                title="Inactive keywords stay on the sheet but leave the focus pool"
                              >
                                <option value="active">Active</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            ) : (
                              <span className={cn(
                                'text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap self-center',
                                isInactive ? 'bg-gray-100 text-gray-600' : 'bg-brand-50 text-brand-700',
                              )}>
                                {isInactive ? 'Inactive' : 'Active'}
                              </span>
                            )}
                            {isSeoProject && (canActOnProject ? (
                              <select
                                value={kw.assignedWriterId || ''}
                                onChange={(e) => assignKeywordWriter.mutate({ keywordId: kw.id, writerId: e.target.value })}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white max-w-[140px]"
                                title={writers.length ? undefined : 'No users have the Content Writer role yet'}
                              >
                                <option value="">Unassigned</option>
                                {writers.map((u: any) => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-gray-600 self-center">{kw.assignedWriter?.name || '—'}</span>
                            ))}
                            {!locked && canActOnProject && (
                              <button
                                type="button"
                                title="Set keyword to Inactive"
                                onClick={() => setConfirmSeoDelete({ kind: 'keyword', id: kw.id, label: kw.primaryKeyword })}
                                className="p-1.5 text-gray-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors self-center"
                              >
                                <ToggleLeft className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {keywords.length > 0 && (
                  <Pagination
                    page={keywordPage}
                    totalPages={keywordTotalPages}
                    total={keywords.length}
                    limit={KEYWORD_PAGE_SIZE}
                    onPageChange={setKeywordPage}
                  />
                )}
              </div>
            </div>
          )}

          {/* Backlinks tab */}
          {tab === 'backlinks' && (() => {
            const urlCounts = new Map<string, number>();
            (backlinks as any[]).forEach((bl: any) => {
              const norm = (bl.sourceUrl || '').trim().toLowerCase();
              if (norm) urlCounts.set(norm, (urlCounts.get(norm) || 0) + 1);
            });
            const isDuplicate = (bl: any) => (urlCounts.get((bl.sourceUrl || '').trim().toLowerCase()) || 0) > 1;
            const duplicateCount = (backlinks as any[]).filter(isDuplicate).length;
            const total = backlinks.length;
            const indexed = (backlinks as any[]).filter((bl: any) => bl.isIndexed).length;

            return (
            <div className="space-y-4">
              <div className="flex justify-end gap-2 flex-wrap">
                <button
                  onClick={viewBacklinkReport}
                  className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                >
                  <Eye className="w-4 h-4" /> View PDF
                </button>
                <button
                  onClick={downloadBacklinkReport}
                  className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                >
                  <Download className="w-4 h-4" /> Download PDF Report
                </button>
                {canActOnProject && (
                  <>
                    <button onClick={() => backlinkImportRef.current?.click()}
                      className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg">
                      <Upload className="w-4 h-4" /> Import CSV
                    </button>
                    <input ref={backlinkImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) importBacklinks.mutate(e.target.files[0]); e.target.value = ''; }} />
                    <button onClick={() => backlinkStatusFileRef.current?.click()}
                      className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg">
                      <Upload className="w-4 h-4" /> Update Status (CSV)
                    </button>
                    <input ref={backlinkStatusFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                      onChange={(e) => { if (e.target.files?.[0]) updateBacklinkStatusFile.mutate(e.target.files[0]); e.target.value = ''; }} />
                  </>
                )}
                {canActOnProject && deletableBacklinkIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmSeoDelete({ kind: 'backlinks-sheet' })}
                    className="flex items-center gap-1.5 border border-amber-200 hover:bg-amber-50 text-amber-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                  >
                    <ToggleLeft className="w-4 h-4" /> Set sheet Inactive
                  </button>
                )}
                {canActOnProject && selectedBacklinkIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setConfirmSeoDelete({
                      kind: 'backlinks-selected',
                      count: selectedBacklinkIds.size,
                    })}
                    className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                  >
                    <ToggleLeft className="w-4 h-4" /> Set Inactive ({selectedBacklinkIds.size})
                  </button>
                )}
                <ShowInactiveToggle {...inactive.toggleProps} />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Total Backlinks', value: total },
                  { label: 'Indexed', value: indexed },
                  { label: 'Non-indexed', value: total - indexed },
                  { label: 'Duplicates', value: duplicateCount, warn: duplicateCount > 0 },
                ].map((s) => (
                  <div key={s.label} className={cn('rounded-xl border p-4', s.warn ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200')}>
                    <p className={cn('text-2xl font-semibold', s.warn ? 'text-amber-700' : 'text-gray-900')}>{s.value}</p>
                    <p className={cn('text-xs mt-0.5', s.warn ? 'text-amber-600' : 'text-gray-500')}>{s.label}</p>
                  </div>
                ))}
              </div>

              {canActOnProject && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Add backlink</p>
                <div className="grid grid-cols-2 gap-3">
                  <input value={newBacklink.sourceUrl} onChange={(e) => setNewBacklink((x) => ({ ...x, sourceUrl: e.target.value }))}
                    placeholder="Published URL *"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newBacklink.targetUrl} onChange={(e) => setNewBacklink((x) => ({ ...x, targetUrl: e.target.value }))}
                    placeholder="Target URL"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newBacklink.anchorText} onChange={(e) => setNewBacklink((x) => ({ ...x, anchorText: e.target.value }))}
                    placeholder="Anchor text"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newBacklink.domain} onChange={(e) => setNewBacklink((x) => ({ ...x, domain: e.target.value }))}
                    placeholder="Domain"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newBacklink.da} onChange={(e) => setNewBacklink((x) => ({ ...x, da: e.target.value }))}
                    placeholder="Domain Authority (DA)" type="number"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input value={newBacklink.spamScore} onChange={(e) => setNewBacklink((x) => ({ ...x, spamScore: e.target.value }))}
                    placeholder="Spam Score (S.S)" type="number" min="0" max="100"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  <input type="date" value={newBacklink.date} onChange={(e) => setNewBacklink((x) => ({ ...x, date: e.target.value }))}
                    title="Publish date"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  {/* Pairs with the publish date on the same row. It used to span both
                      columns, which forced it onto a row of its own and left the space
                      beside the date empty. */}
                  <select value={newBacklink.linkType} onChange={(e) => setNewBacklink((x) => ({ ...x, linkType: e.target.value }))}
                    title="Link type"
                    className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                    <option value="dofollow">Dofollow</option>
                    <option value="nofollow">Nofollow</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <button
                  onClick={() => { if (newBacklink.sourceUrl.trim()) addBacklink.mutate(newBacklink); }}
                  disabled={addBacklink.isPending || !newBacklink.sourceUrl.trim()}
                  className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                >
                  <Plus className="w-4 h-4" /> Add Backlink
                </button>
              </div>
              )}
              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <table className="w-full min-w-[1420px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {canActOnProject && (
                        <th className="px-3 py-3 w-10">
                          <input
                            type="checkbox"
                            checked={allDeletableBacklinksSelected}
                            disabled={deletableBacklinkIds.length === 0}
                            onChange={toggleAllBacklinks}
                            className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
                            title="Select all deletable backlinks"
                            aria-label="Select all deletable backlinks"
                          />
                        </th>
                      )}
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Published URL</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Domain</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Publish date</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">DA</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">S.S</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Type</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Indexed</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Added</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Last updated</th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 w-12" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {backlinks.length === 0 ? (
                      <tr><td colSpan={canActOnProject ? 13 : 12} className="px-4 py-8 text-sm text-gray-400 text-center">No backlinks yet.</td></tr>
                    ) : (
                      backlinks.map((bl: any) => {
                        const locked = !!bl.isIndexed;
                        return (
                        <tr key={bl.id} className={cn('hover:bg-gray-50', isDuplicate(bl) && 'bg-amber-50/70', inactiveRow(bl.isActive))}>
                          {canActOnProject && (
                            <td className="px-3 py-3">
                              <input
                                type="checkbox"
                                checked={selectedBacklinkIds.has(bl.id)}
                                disabled={locked}
                                onChange={() => toggleBacklinkSelect(bl.id, !locked)}
                                className="rounded border-gray-300 text-brand-700 focus:ring-brand-600 disabled:opacity-40"
                                aria-label={`Select ${bl.sourceUrl || bl.domain || 'backlink'}`}
                              />
                            </td>
                          )}
                          <td className="px-4 py-3 text-sm text-blue-600 max-w-[200px] truncate">
                            <a href={bl.sourceUrl} target="_blank" rel="noreferrer">{bl.sourceUrl}</a>
                            {isDuplicate(bl) && <span className="ml-1.5 text-[10px] font-medium text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full align-middle">Duplicate</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{bl.domain || '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                            {canActOnProject ? (
                              <input
                                type="date"
                                defaultValue={bl.date || ''}
                                onBlur={(e) => {
                                  const next = e.target.value || null;
                                  if (next !== (bl.date || null)) {
                                    editBacklink.mutate({ blId: bl.id, updates: { date: next } });
                                  }
                                }}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white max-w-[140px]"
                              />
                            ) : (
                              bl.date ? formatDate(bl.date, 'MMM d, yyyy') : '—'
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">{bl.da ?? '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{bl.spamScore ?? '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-600 capitalize">{titleCase(bl.linkType)}</td>
                          <td className="px-4 py-3">
                            {canActOnProject ? (
                              <select
                                defaultValue={bl.status || 'live'}
                                onChange={(e) => editBacklink.mutate({ blId: bl.id, updates: { status: e.target.value } })}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                              >
                                <option value="live">Live</option>
                                <option value="pending">Pending</option>
                                <option value="removed">Removed</option>
                              </select>
                            ) : (
                              <span className="text-sm text-gray-600 capitalize">{bl.status || 'live'}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {canActOnProject ? (
                              <select
                                defaultValue={bl.isIndexed ? 'yes' : 'no'}
                                onChange={(e) => editBacklink.mutate({ blId: bl.id, updates: { isIndexed: e.target.value === 'yes' } })}
                                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                              >
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                              </select>
                            ) : (
                              <span className={cn('px-2 py-0.5 text-xs rounded-full font-medium', bl.isIndexed ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500')}>
                                {bl.isIndexed ? 'Yes' : 'No'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {bl.createdAt ? formatDate(bl.createdAt, 'MMM d, yyyy') : '—'}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                            {bl.updatedAt ? formatDate(bl.updatedAt, 'MMM d, yyyy · h:mm a') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {locked ? (
                              <span className="text-[10px] font-medium text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded-full whitespace-nowrap" title="Indexed — can't be removed">
                                Indexed
                              </span>
                            ) : canActOnProject && (
                              <button
                                type="button"
                                title="Set backlink to Inactive"
                                onClick={() => setConfirmSeoDelete({
                                  kind: 'backlink',
                                  id: bl.id,
                                  label: bl.sourceUrl || bl.domain || undefined,
                                })}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <ToggleLeft className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {/* Content tab */}
          {tab === 'content' && (
            <div className="space-y-4">
              <div id="submit-content-form" className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
                <div>
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Submit content</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Pick the keywords this page covers below — the page title is filled in automatically from them.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Page title *</label>
                    <input
                      value={contentPageName}
                      readOnly
                      placeholder="Select a keyword below…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      {contentKeywordIds.length ? 'Auto-filled from selected keywords' : contentAutoTitle ? 'Detected from file' : 'Auto-filled once a keyword is selected'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Word count</label>
                    <input
                      value={contentWordCount}
                      onChange={(e) => setContentWordCount(e.target.value)}
                      placeholder="Optional"
                      type="number"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                </div>
                {keywords.length > 0 && (() => {
                  // A writer only ever submits content for pages actually assigned to
                  // them — selecting someone else's (or a still-unassigned) keyword
                  // would misattribute the work and pull it out of that person's queue.
                  // Admins/PMs keep full visibility since they may submit on anyone's
                  // behalf or need to see everything.
                  const activeKeywords = (keywords as any[]).filter((kw: any) => (kw.status || 'active') === 'active');
                  const assignedKeywords = canManageTeam
                    ? activeKeywords
                    : activeKeywords.filter((kw: any) => kw.assignedWriterId === user?.id);
                  // Only keywords still waiting on content appear here. Once a page
                  // has been written and approved (or is sitting in review) its
                  // keywords are done — leaving them on the list invited duplicate
                  // submissions for work already delivered. Rejected submissions
                  // deliberately release their keywords again, since those do need
                  // rewriting.
                  const selectableKeywords = assignedKeywords.filter((kw: any) => !coveredKeywordIds.has(kw.id));
                  const doneCount = assignedKeywords.length - selectableKeywords.length;
                  return (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1.5">
                        Keywords this page covers
                        {doneCount > 0 && (
                          <span className="ml-1.5 font-normal text-gray-400">
                            · {doneCount} already written {doneCount === 1 ? 'is' : 'are'} hidden
                          </span>
                        )}
                      </p>
                      {selectableKeywords.length === 0 ? (
                        <p className="text-xs text-gray-400 p-3 border border-gray-200 rounded-lg bg-gray-50">
                          {activeKeywords.length === 0
                            ? 'No active keywords on this project yet.'
                            : assignedKeywords.length === 0
                              ? 'No keywords are assigned to you yet — ask your project strategist to assign one.'
                              : 'Every keyword assigned to you already has content submitted or approved.'}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5 p-3 border border-gray-200 rounded-lg bg-gray-50 max-h-56 overflow-y-auto">
                          {selectableKeywords.map((kw: any) => (
                            <label key={kw.id} className="flex items-center gap-1.5 cursor-pointer py-0.5">
                              <input
                                type="checkbox"
                                checked={contentKeywordIds.includes(kw.id)}
                                onChange={(e) => {
                                  setContentKeywordIds((ids) =>
                                    e.target.checked ? [...ids, kw.id] : ids.filter((x) => x !== kw.id)
                                  );
                                }}
                                className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
                              />
                              <span className="text-sm text-gray-700">{kw.primaryKeyword}</span>
                              {kw.pageName && <span className="text-xs text-gray-400">({kw.pageName})</span>}
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => contentFileRef.current?.click()}
                    className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                  >
                    <Upload className="w-4 h-4" />
                    {contentFileName || 'Attach file'}
                  </button>
                  <input
                    ref={contentFileRef}
                    type="file"
                    accept=".doc,.docx,.pdf,.txt,.md,.html,.htm,.csv,.rtf"
                    className="hidden"
                    onChange={(e) => {
                      setContentSubmitLink('');
                      void handleContentFileChange(e.target.files?.[0]);
                    }}
                  />
                  {contentFileName && (
                    <button
                      type="button"
                      onClick={() => {
                        setContentFileName('');
                        if (contentFileRef.current) contentFileRef.current.value = '';
                        setContentAutoTitle('');
                      }}
                      className="text-xs text-gray-500 hover:text-red-600"
                    >
                      Remove file
                    </button>
                  )}
                  <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                    <Link className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <input
                      value={contentSubmitLink}
                      onChange={(e) => {
                        setContentSubmitLink(e.target.value);
                        if (e.target.value.trim()) {
                          setContentFileName('');
                          if (contentFileRef.current) contentFileRef.current.value = '';
                          setContentAutoTitle('');
                        }
                      }}
                      placeholder="Or paste a deliverable link…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (!contentPageName.trim()) {
                        toast.error('Page title is required.');
                        return;
                      }
                      const link = contentSubmitLink.trim();
                      const hasFile = !!contentFileRef.current?.files?.[0];
                      if (!hasFile && !link) {
                        toast.error('Attach a file or paste a deliverable link.');
                        return;
                      }
                      const fd = new FormData();
                      fd.append('pageName', contentPageName.trim());
                      if (contentKeywordIds.length) fd.append('keywordIds', JSON.stringify(contentKeywordIds));
                      if (contentWordCount) fd.append('wordCount', contentWordCount);
                      if (hasFile) fd.append('file', contentFileRef.current!.files![0]);
                      else if (link) {
                        fd.append('fileUrl', toAbsoluteUrl(link));
                        fd.append('fileName', 'Link');
                      }
                      submitContent.mutate(fd);
                    }}
                    disabled={submitContent.isPending || !contentPageName.trim()}
                    className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg ml-auto"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {submitContent.isPending ? 'Submitting…' : 'Submit Content'}
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Content Submissions</h3>
                </div>
                <table className="w-full min-w-[880px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Page title</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Keywords</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Words</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">File</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Submitted by</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Date</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">Status</th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {historyContent.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-sm text-gray-400 text-center">
                          No content submissions yet.
                        </td>
                      </tr>
                    ) : (
                      historyContent.map((cs: any) => {
                        const kwMap = new Map((keywords as any[]).map((k) => [k.id, k.primaryKeyword]));
                        const kwLabels = (cs.keywordIds || [])
                          .map((kid: string) => kwMap.get(kid))
                          .filter(Boolean);
                        const versionNo = Number(cs.revisionNumber || 1);
                        const isSuperseded = cs.status === 'superseded';
                        const isLive = !isSuperseded;
                        const canReopenApproved = (isAdminUser || iAmProjectManager) && cs.submittedBy !== user?.id;
                        return (
                          <Fragment key={cs.id}>
                          <tr className={cn('hover:bg-gray-50', isSuperseded && 'bg-slate-50/70 text-gray-500')}>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 max-w-[200px] whitespace-normal break-words">
                              <div className="space-y-1">
                                <div className={isSuperseded ? 'text-gray-500' : undefined}>{cs.pageName}</div>
                                <div className="inline-flex items-center gap-1.5">
                                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-slate-100 text-slate-700 rounded">
                                    v{versionNo}
                                  </span>
                                  {isSuperseded ? (
                                    <span className="text-[10px] text-slate-500">prior version</span>
                                  ) : versionNo > 1 ? (
                                    <span className="text-[10px] text-slate-500">revision</span>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 max-w-[260px]">
                              {kwLabels.length ? (
                                <div className="flex flex-wrap gap-1">
                                  {kwLabels.map((label: string) => (
                                    <span key={label} className="text-[11px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded">
                                      {label}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {cs.wordCount != null ? Number(cs.wordCount).toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 max-w-[180px] truncate" title={cs.fileName || cs.fileUrl || ''}>
                              {cs.fileName === 'Link'
                                ? (cs.fileUrl || 'Link')
                                : (cs.fileName || (cs.fileUrl ? 'Attached' : '—'))}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {cs.submitter?.name || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                              {cs.createdAt ? formatDate(cs.createdAt) : '—'}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span
                                title={cs.status === 'rejected' || isSuperseded ? cs.rejectionReason || '' : ''}
                                className={cn(
                                  'inline-block px-2 py-0.5 text-xs font-medium rounded-full capitalize',
                                  cs.status === 'approved' ? 'bg-brand-100 text-brand-800'
                                    : cs.status === 'rejected' ? 'bg-red-100 text-red-700'
                                    : isSuperseded ? 'bg-slate-100 text-slate-600'
                                    : 'bg-amber-100 text-amber-700'
                                )}
                              >
                                {isSuperseded ? 'Superseded' : (cs.status || 'pending')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="inline-flex items-center gap-0.5">
                                {cs.fileUrl && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openDeliverable(cs.fileUrl, cs.fileName).catch(() => toast.error('Failed to open deliverable.'))}
                                      className="p-1.5 text-gray-400 hover:text-brand-700 rounded-lg hover:bg-gray-100"
                                      title="View"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    {!isLinkDeliverable(cs.fileUrl, cs.fileName) && (
                                      <a
                                        href={cs.fileUrl}
                                        download={cs.fileName || undefined}
                                        className="p-1.5 text-gray-400 hover:text-brand-700 rounded-lg hover:bg-gray-100"
                                        title="Download"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </a>
                                    )}
                                  </>
                                )}
                                {isLive && canActOnProject && ['pending', 'approved'].includes(cs.status || 'pending') && cs.submittedBy !== user?.id && (
                                  <>
                                    {(!cs.status || cs.status === 'pending') && (
                                      <button
                                        type="button"
                                        onClick={() => reviewContent.mutate({ csId: cs.id, status: 'approved' })}
                                        disabled={reviewContent.isPending}
                                        title="Approve"
                                        className="p-1.5 text-gray-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg disabled:opacity-50"
                                      >
                                        <CheckCircle className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => { setRejectingContentId(cs.id); setRejectReason(''); }}
                                      title={cs.status === 'approved' ? 'Reopen for revision' : 'Reject'}
                                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                      disabled={cs.status === 'approved' && !canReopenApproved}
                                    >
                                      {cs.status === 'approved' ? <RotateCcw className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                                    </button>
                                  </>
                                )}
                                {isLive && cs.submittedBy === user?.id && cs.status === 'rejected' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const kids = Array.isArray(cs.keywordIds) ? cs.keywordIds.filter(Boolean) : [];
                                      setContentKeywordIds(kids);
                                      if (cs.wordCount != null) setContentWordCount(String(cs.wordCount));
                                      document.getElementById('submit-content-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                      toast.message('Keywords loaded — upload the revised file and submit again.');
                                    }}
                                    title="Revise & resubmit"
                                    className="p-1.5 text-gray-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {isLive && cs.submittedBy === user?.id && cs.status !== 'approved' && (
                                  <button
                                    type="button"
                                    onClick={() => deleteContentSubmission.mutate(cs.id)}
                                    disabled={deleteContentSubmission.isPending}
                                    title="Delete"
                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isLive && rejectingContentId === cs.id && (
                            <tr>
                              <td colSpan={8} className="px-4 py-3 bg-red-50/50 border-t border-red-100">
                                <div className="flex flex-wrap items-center gap-2">
                                  <input
                                    autoFocus
                                    value={rejectReason}
                                    onChange={(e) => setRejectReason(e.target.value)}
                                    placeholder={cs.status === 'approved'
                                      ? 'Reason for reopen — tells the writer what to revise *'
                                      : 'Reason for rejection — tells the writer what to fix *'}
                                    className="flex-1 min-w-[240px] px-3 py-1.5 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => rejectReason.trim() && reviewContent.mutate({ csId: cs.id, status: 'rejected', rejectionReason: rejectReason.trim() })}
                                    disabled={!rejectReason.trim() || reviewContent.isPending}
                                    className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                                  >
                                    {reviewContent.isPending
                                      ? (cs.status === 'approved' ? 'Reopening…' : 'Rejecting…')
                                      : (cs.status === 'approved' ? 'Confirm Reopen' : 'Confirm Reject')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setRejectingContentId(null); setRejectReason(''); }}
                                    className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1.5"
                                  >
                                    Cancel
                                  </button>
                                </div>
                                {cs.status === 'approved' && (
                                  <p className="text-[11px] text-red-700 mt-2">
                                    Reopen keeps this approved file as a superseded history version and opens a revise entry so the writer can upload a new deliverable.
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Blogs tab — plan sheet + deliverable submit/review (content parity) */}
          {tab === 'blogs' && (() => {
            const sheetRows = blogSheet as any[];
            // Exactly the rows this user is allowed to approve — the same test the
            // per-row button uses, so selection can never offer more than the
            // action will accept.
            const reviewableBlogIds = sheetRows
              .filter((r: any) => (isAdminUser || iAmProjectManager || iAmProjectStrategist)
                && r.status === 'pending'
                && r.submittedBy !== user?.id)
              .map((r: any) => r.id);
            const allReviewableBlogsSelected = reviewableBlogIds.length > 0
              && reviewableBlogIds.every((rid: string) => selectedBlogIds.includes(rid));
            // Submit Blog is the writer's queue: only draft/rejected rows assigned
            // to the current user. Strategists/PMs assign on the sheet below — they
            // don't need every unassigned row in this picker (that made it look
            // like "no blogs waiting" even after import, or flooded managers with
            // everyone else's work).
            const submittableBlogs = sheetRows.filter((row: any) => {
              if (!row.isActive && row.isActive !== undefined) return false;
              if (!['draft', 'rejected'].includes(row.status || 'draft')) return false;
              return row.assignedWriterId === user?.id;
            });
            return (
            <div className="space-y-4">
              {canActOnProject && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Submit blog</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Pick a planned blog assigned to you, attach a file or paste a link, and send it for strategist/PM review — same process as Content.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Blog title *</label>
                      {submittableBlogs.length === 0 ? (
                        <p className="text-xs text-gray-400 p-3 border border-gray-200 rounded-lg bg-gray-50">
                          No blogs assigned to you yet. After the sheet is imported, a strategist/PM must assign a writer — then those rows appear here.
                        </p>
                      ) : (
                        <select
                          value={blogSubmitId}
                          onChange={(e) => setBlogSubmitId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                        >
                          <option value="">Select a blog…</option>
                          {submittableBlogs.map((row: any) => (
                            <option key={row.id} value={row.id}>
                              {row.title}{row.status === 'rejected' ? ' (revise)' : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => blogDeliverableRef.current?.click()}
                          className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                        >
                          <Upload className="w-4 h-4" />
                          {blogSubmitFileName || 'Attach file'}
                        </button>
                        <input
                          ref={blogDeliverableRef}
                          type="file"
                          accept=".doc,.docx,.pdf,.txt,.md,.html,.htm,.csv,.rtf"
                          className="hidden"
                          onChange={(e) => {
                            setBlogSubmitLink('');
                            setBlogSubmitFileName(e.target.files?.[0]?.name || '');
                          }}
                        />
                        {blogSubmitFileName && (
                          <button
                            type="button"
                            onClick={() => {
                              setBlogSubmitFileName('');
                              if (blogDeliverableRef.current) blogDeliverableRef.current.value = '';
                            }}
                            className="text-xs text-gray-500 hover:text-red-600"
                          >
                            Remove file
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-1 min-w-0 sm:min-w-[220px]">
                        <Link className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <input
                          value={blogSubmitLink}
                          onChange={(e) => {
                            setBlogSubmitLink(e.target.value);
                            if (e.target.value.trim()) {
                              setBlogSubmitFileName('');
                              if (blogDeliverableRef.current) blogDeliverableRef.current.value = '';
                            }
                          }}
                          placeholder="Or paste a deliverable link (Google Doc, Drive, …)"
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!blogSubmitId) {
                            toast.error('Select a blog to submit.');
                            return;
                          }
                          const link = blogSubmitLink.trim();
                          const hasFile = !!blogDeliverableRef.current?.files?.[0];
                          const row = sheetRows.find((r: any) => r.id === blogSubmitId);
                          if (!hasFile && !link && !row?.fileUrl) {
                            toast.error('Attach a file or paste a deliverable link.');
                            return;
                          }
                          const fd = new FormData();
                          fd.append('blogId', blogSubmitId);
                          if (row?.title) fd.append('title', row.title);
                          if (hasFile) fd.append('file', blogDeliverableRef.current!.files![0]);
                          else if (link) fd.append('fileUrl', toAbsoluteUrl(link));
                          submitBlog.mutate(fd);
                        }}
                        disabled={submitBlog.isPending || !blogSubmitId}
                        className="flex items-center justify-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg w-full sm:w-auto shrink-0"
                      >
                        <CheckCircle className="w-4 h-4" />
                        {submitBlog.isPending ? 'Submitting…' : 'Submit Blog'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Blog Sheet</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {sheetRows.length} row{sheetRows.length === 1 ? '' : 's'} · unassigned → assigned → in review → approved
                    </p>
                  </div>
                  {canActOnProject && (
                    <>
                      <button
                        type="button"
                        onClick={() => blogSheetFileRef.current?.click()}
                        disabled={importBlogSheet.isPending}
                        className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                      >
                        <Upload className="w-4 h-4" /> {importBlogSheet.isPending ? 'Importing…' : 'Import CSV/Excel'}
                      </button>
                      {/* Clears only what hasn't been signed off. Approved rows
                          are a record of accepted work — a bad import must not
                          be able to take them with it. */}
                      {pendingClearCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setConfirmClearBlogs(true)}
                          disabled={clearBlogRows.isPending}
                          title="Set all unapproved rows to Inactive"
                          className="flex items-center gap-1.5 border border-gray-300 hover:bg-red-50 hover:border-red-200 hover:text-red-700 disabled:opacity-60 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                          {clearBlogRows.isPending ? 'Clearing…' : `Clear ${pendingClearCount}`}
                        </button>
                      )}
                      <input ref={blogSheetFileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                        onChange={(e) => { if (e.target.files?.[0]) importBlogSheet.mutate(e.target.files[0]); e.target.value = ''; }} />
                    </>
                  )}
                  <ShowInactiveToggle {...inactive.toggleProps} />
                </div>
                {canActOnProject && (
                  <div className="px-5 py-4 border-b border-gray-100 space-y-2.5 bg-gray-50/40">
                    <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Plan a blog row</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <input value={newBlogRow.contentType} onChange={(e) => setNewBlogRow((x) => ({ ...x, contentType: e.target.value }))} placeholder="Type (e.g. PILLAR, Cluster)"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.title} onChange={(e) => setNewBlogRow((x) => ({ ...x, title: e.target.value }))} placeholder="Blog Title *"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.mainKeyword} onChange={(e) => setNewBlogRow((x) => ({ ...x, mainKeyword: e.target.value }))} placeholder="Main Keyword"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.volume} onChange={(e) => setNewBlogRow((x) => ({ ...x, volume: e.target.value }))} placeholder="Volume" type="number"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.kd} onChange={(e) => setNewBlogRow((x) => ({ ...x, kd: e.target.value }))} placeholder="KD" type="number"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.supportingKeywords} onChange={(e) => setNewBlogRow((x) => ({ ...x, supportingKeywords: e.target.value }))} placeholder="Supporting Keywords (comma-separated)"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.urlSlug} onChange={(e) => setNewBlogRow((x) => ({ ...x, urlSlug: e.target.value }))} placeholder="URL Slug"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <input value={newBlogRow.targetServicePage} onChange={(e) => setNewBlogRow((x) => ({ ...x, targetServicePage: e.target.value }))} placeholder="Target Service Page"
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      <select
                        value={newBlogRow.assignedWriterId}
                        onChange={(e) => setNewBlogRow((x) => ({ ...x, assignedWriterId: e.target.value }))}
                        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                      >
                        <option value="">Writer — select…</option>
                        {(assignableBlogWriters as any[]).map((u: any) => (
                          <option key={u.id} value={u.id}>{u.name}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => newBlogRow.title.trim() && addBlogRow.mutate(newBlogRow)}
                      disabled={addBlogRow.isPending || !newBlogRow.title.trim()}
                      className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                    >
                      <Plus className="w-4 h-4" /> {addBlogRow.isPending ? 'Adding…' : 'Add Row'}
                    </button>
                  </div>
                )}
                {sheetRows.length === 0 ? (
                  <p className="px-5 py-8 text-sm text-gray-400 text-center">
                    No blog rows yet — import a CSV or Excel sheet, or add one manually above.
                  </p>
                ) : (
                  <div>
                    {/* Bulk bar, only once something is ticked — it replaces
                        clicking the per-row tick 20+ times on a full sheet. */}
                    {selectedBlogIds.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 mb-2 rounded-lg border border-brand-200 bg-brand-50">
                        <p className="text-xs font-medium text-brand-900">
                          {selectedBlogIds.length} selected
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedBlogIds([])}
                            className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2.5 py-1.5"
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            onClick={() => bulkApproveBlogs.mutate(selectedBlogIds)}
                            disabled={bulkApproveBlogs.isPending}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            {bulkApproveBlogs.isPending
                              ? `Approving ${selectedBlogIds.length}…`
                              : `Approve ${selectedBlogIds.length}`}
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50/60">
                          {/* Select-all covers only the rows this user may
                              actually review, so ticking it can never queue an
                              action that will be rejected server-side. */}
                          {reviewableBlogIds.length > 0 && (
                            <th className="px-3 py-2.5 w-10">
                              <input
                                type="checkbox"
                                checked={allReviewableBlogsSelected}
                                onChange={(e) => setSelectedBlogIds(e.target.checked ? reviewableBlogIds : [])}
                                className="w-3.5 h-3.5 rounded accent-brand-700"
                                title="Select all pending"
                              />
                            </th>
                          )}
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Type</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Blog Title</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Main Keyword</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Volume</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">KD</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Supporting Keywords</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">URL Slug</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Status</th>
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Writer</th>
                          <th className="w-28" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {sheetRows.map((row: any) => {
                          const canReviewRow = (isAdminUser || iAmProjectManager || iAmProjectStrategist)
                            && row.status === 'pending'
                            && row.submittedBy !== user?.id;
                          const isRejecting = rejectingBlogId === row.id;
                          const isSelected = selectedBlogIds.includes(row.id);
                          return (
                            <Fragment key={row.id}>
                              <tr className={cn('align-top', inactiveRow(row.isActive), isSelected && 'bg-brand-50/40')}>
                                {reviewableBlogIds.length > 0 && (
                                  <td className="px-3 py-2.5">
                                    {canReviewRow && (
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => setSelectedBlogIds((prev) => (
                                          e.target.checked ? [...prev, row.id] : prev.filter((x) => x !== row.id)
                                        ))}
                                        className="w-3.5 h-3.5 rounded accent-brand-700"
                                      />
                                    )}
                                  </td>
                                )}
                                <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">{cellOrDash(row.contentType)}</td>
                                <td className="px-3 py-2.5 text-gray-900 font-medium max-w-xs break-words">
                                  {row.title}
                                  {row.status === 'rejected' && row.rejectionReason && (
                                    <p className="text-[11px] text-red-600 font-normal mt-0.5">{row.rejectionReason}</p>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-gray-700">{cellOrDash(row.mainKeyword)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 tabular-nums">{cellOrDash(row.volume)}</td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-gray-700 tabular-nums">{cellOrDash(row.kd)}</td>
                                <td className="px-3 py-2.5 align-top">
                                  <SupportingKeywordsCell raw={row.supportingKeywords} />
                                </td>
                                <td className="px-3 py-2.5 text-gray-700 max-w-[160px]">
                                  <span className="block truncate" title={row.urlSlug || undefined}>
                                    {cellOrDash(row.urlSlug)}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {/* "Draft" covers two genuinely different
                                      states — nobody is on it yet, versus a
                                      writer has it and hasn't submitted. The
                                      stored status is the same either way, so
                                      the label distinguishes them: a row with a
                                      writer reads "Assigned", one without reads
                                      "Unassigned". "Pending" is spelled out as
                                      "In review" — that's what it means. */}
                                  {(() => {
                                    const s = row.status || 'draft';
                                    const label = s === 'draft'
                                      ? (row.assignedWriterId ? 'Assigned' : 'Unassigned')
                                      : s === 'pending' ? 'In review'
                                        : titleCase(s);
                                    const tone = s === 'approved' ? 'bg-brand-100 text-brand-800'
                                      : s === 'rejected' ? 'bg-red-100 text-red-700'
                                        : s === 'pending' ? 'bg-amber-100 text-amber-800'
                                          : row.assignedWriterId ? 'bg-blue-100 text-blue-700'
                                            : 'bg-gray-100 text-gray-600';
                                    const why = s === 'rejected' ? row.rejectionReason
                                      : s === 'draft' && row.assignedWriterId ? 'Waiting for the writer to submit a deliverable'
                                        : s === 'draft' ? 'Assign a writer to start this one'
                                          : s === 'pending' ? 'Submitted — awaiting strategist/PM review'
                                            : undefined;
                                    return (
                                      <span className={cn('px-2 py-0.5 text-xs font-medium rounded-full', tone)} title={why}>
                                        {label}
                                      </span>
                                    );
                                  })()}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {canActOnProject && row.status !== 'approved' ? (() => {
                                    const options = [...(assignableBlogWriters as any[])];
                                    if (row.assignedWriterId && row.assignedWriter && !options.some((u) => u.id === row.assignedWriterId)) {
                                      options.unshift({ id: row.assignedWriterId, name: row.assignedWriter.name });
                                    }
                                    return (
                                      <select
                                        value={row.assignedWriterId || ''}
                                        onChange={(e) => assignBlogWriter.mutate({ blogId: row.id, writerId: e.target.value })}
                                        disabled={assignBlogWriter.isPending}
                                        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white max-w-[140px]"
                                        title={options.length ? undefined : 'No users have the Blog Writer or Content Writer role yet'}
                                      >
                                        <option value="">Unassigned</option>
                                        {options.map((u: any) => (
                                          <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                      </select>
                                    );
                                  })() : (
                                    <span className="text-gray-700">{row.assignedWriter?.name || '—'}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-1 justify-end">
                                    {row.fileUrl && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => openDeliverable(row.fileUrl).catch(() => toast.error('Failed to open deliverable.'))}
                                          className="p-1.5 text-gray-400 hover:text-brand-700 rounded-lg hover:bg-gray-100"
                                          title={isLinkDeliverable(row.fileUrl) ? 'Open link' : 'View'}
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                        </button>
                                        {!isLinkDeliverable(row.fileUrl) && (
                                          <a
                                            href={row.fileUrl}
                                            download
                                            className="p-1.5 text-gray-400 hover:text-brand-700 rounded-lg hover:bg-gray-100"
                                            title="Download"
                                          >
                                            <Download className="w-3.5 h-3.5" />
                                          </a>
                                        )}
                                      </>
                                    )}
                                    {canReviewRow && (
                                      <>
                                        <button
                                          type="button"
                                          title="Approve"
                                          onClick={() => reviewBlogRow.mutate({ blogId: row.id, status: 'approved' })}
                                          disabled={reviewBlogRow.isPending}
                                          className="p-1.5 text-gray-400 hover:text-brand-700 hover:bg-brand-50 rounded-lg disabled:opacity-50"
                                        >
                                          <CheckCircle className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          title="Reject"
                                          onClick={() => setRejectingBlogId(isRejecting ? null : row.id)}
                                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                                        >
                                          <XCircle className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                    {canActOnProject && row.status !== 'approved' && (
                                      <ActiveToggle
                                        isActive={row.isActive !== false}
                                        label="blog"
                                        disabled={toggleBlogRowActive.isPending}
                                        // `next` is the direction the toggle is
                                        // heading. It was ignored, so the control
                                        // always deactivated and an inactive row
                                        // could never be switched back on.
                                        onToggle={(next) => toggleBlogRowActive.mutate({ blogId: row.id, next })}
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {isRejecting && (
                                <tr>
                                  <td colSpan={10} className="px-3 pb-3">
                                    <div className="flex flex-wrap items-center gap-2 bg-red-50/60 border border-red-200 rounded-lg p-2.5">
                                      <input
                                        value={blogRejectReason}
                                        onChange={(e) => setBlogRejectReason(e.target.value)}
                                        placeholder="Reason for rejection — tells the writer what to fix *"
                                        className="flex-1 min-w-[240px] px-3 py-1.5 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => blogRejectReason.trim() && reviewBlogRow.mutate({ blogId: row.id, status: 'rejected', rejectionReason: blogRejectReason.trim() })}
                                        disabled={!blogRejectReason.trim() || reviewBlogRow.isPending}
                                        className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                                      >
                                        {reviewBlogRow.isPending ? 'Rejecting…' : 'Confirm Reject'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => { setRejectingBlogId(null); setBlogRejectReason(''); }}
                                        className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1.5"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {/* Monthly Report tab — the keyword × report-date rank grid */}
          {tab === 'reporting' && (() => {
            const dates: string[] = rankings?.dates || [];
            const rows: any[] = rankings?.rows || [];
            const latestDate: string | null = rankings?.latestDate || null;
            // Newest report date first — that's the column anyone opening this
            // tab is actually looking for.
            const columnDates = [...dates].reverse();
            return (
              <div className="space-y-4">
                {canActOnProject && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="max-w-xl">
                        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Record rankings</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {isGmbProject
                            ? 'Each month, record where this project\'s GMB/local keywords rank. Every save adds one dated column to the rank history below for client reporting.'
                            : 'Each month, check where this project\'s keywords sit in Google and record the position numbers here. Every save adds one dated column to the Rank history below, so you build up a month-by-month record of what moved — that\'s what goes to the client in the monthly report.'}
                        </p>
                      </div>
                      <div className="flex items-end gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">Date checked</label>
                          <input
                            type="date"
                            value={rankDate}
                            onChange={(e) => setRankDate(e.target.value)}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => rankImportRef.current?.click()}
                          disabled={importRankings.isPending}
                          className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium px-3 py-2 rounded-lg"
                        >
                          <Upload className="w-4 h-4" />
                          {importRankings.isPending ? 'Importing…' : 'Import CSV/Excel'}
                        </button>
                        <input
                          ref={rankImportRef}
                          type="file"
                          accept=".csv,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) importRankings.mutate({ file, date: rankDate });
                            e.target.value = '';
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Sheet columns: <span className="font-medium">Keyword</span> (required),{' '}
                      <span className="font-medium">Position</span>, and optionally{' '}
                      <span className="font-medium">Date</span> and <span className="font-medium">URL</span>.
                      Rows without a Date use the date picked above.
                    </p>
                    {rows.length === 0 ? (
                      <p className="text-xs text-gray-400 p-3 border border-gray-200 rounded-lg bg-gray-50">
                        This project has no active keywords yet. Add them on the Keywords tab first — rankings
                        are recorded against them.
                      </p>
                    ) : (
                      <>
                        {/* A labelled table, not a grid of loose boxes: with the
                            inputs floating between two keyword names it was
                            impossible to tell which box belonged to which row. */}
                        <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-lg">
                          <table className="w-full">
                            <thead className="sticky top-0 bg-gray-50 z-10">
                              <tr className="border-b border-gray-200">
                                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2">Keyword</th>
                                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-28 whitespace-nowrap">
                                  Last recorded
                                </th>
                                <th className="text-right text-[11px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-2 w-36 whitespace-nowrap">
                                  Position on {rankDate || 'this date'}
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {rows.map((r: any) => (
                                <tr key={r.keywordId} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-sm text-gray-800">
                                    {r.primaryKeyword}
                                    {r.pageName && <span className="block text-xs text-gray-400">{r.pageName}</span>}
                                  </td>
                                  <td className="px-3 py-2 text-sm text-right text-gray-500">
                                    {r.latestPosition != null
                                      ? <>#{r.latestPosition}{rankings?.latestDate && <span className="block text-[11px] text-gray-400">{rankings.latestDate}</span>}</>
                                      : <span className="text-gray-300">Never</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <input
                                        type="number"
                                        min={1}
                                        value={rankEntryDraft[r.keywordId] ?? ''}
                                        onChange={(e) => setRankEntryDraft((d) => ({ ...d, [r.keywordId]: e.target.value }))}
                                        placeholder="e.g. 7"
                                        aria-label={`Google position for "${r.primaryKeyword}"`}
                                        className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                                      />
                                      {/* "Checked but nowhere to be found" is a real,
                                          different result from "didn't check" — and an
                                          empty box can't tell them apart, so it gets its
                                          own explicit control. It toggles: pressing it
                                          again drops the row back to "not checked", so a
                                          misclick isn't stuck. */}
                                      <button
                                        type="button"
                                        aria-pressed={rankEntryDraft[r.keywordId] === ''}
                                        title={rankEntryDraft[r.keywordId] === ''
                                          ? "Marked as checked but not ranking — click to undo"
                                          : "You checked this keyword and it isn't ranking"}
                                        onClick={() => setRankEntryDraft((d) => {
                                          const next = { ...d };
                                          // Toggle off by removing the key entirely — an
                                          // absent key means "not checked", which is what
                                          // undoing has to restore.
                                          if (next[r.keywordId] === '') delete next[r.keywordId];
                                          else next[r.keywordId] = '';
                                          return next;
                                        })}
                                        className={cn(
                                          'text-[11px] px-1.5 py-1.5 rounded-lg border whitespace-nowrap transition-colors',
                                          rankEntryDraft[r.keywordId] === ''
                                            ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium'
                                            : 'border-gray-200 text-gray-400 hover:text-gray-700 hover:bg-gray-50',
                                        )}
                                      >
                                        Not ranking
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          Type the Google position — <span className="font-medium">1</span> is the top result.
                          Hit <span className="font-medium">Not ranking</span> if you checked and it wasn&apos;t
                          found; press it again to undo. Rows you leave alone aren&apos;t saved at all, so you
                          can record just the keywords you actually checked. Saving the same date again
                          corrects that column instead of adding a duplicate.
                        </p>
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            onClick={() => saveRankings.mutate({
                              date: rankDate,
                              // Only keywords actually touched are submitted — an
                              // untouched field means "not checked", which is
                              // different from a deliberately blanked one.
                              entries: Object.entries(rankEntryDraft)
                                .filter(([, v]) => v !== undefined)
                                .map(([keywordId, position]) => ({ keywordId, position })),
                            })}
                            disabled={saveRankings.isPending || Object.keys(rankEntryDraft).length === 0}
                            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3.5 py-2 rounded-lg"
                          >
                            <Save className="w-4 h-4" />
                            {saveRankings.isPending ? 'Saving…' : `Save rankings for ${rankDate}`}
                          </button>
                          <span className="text-xs text-gray-400">
                            {Object.keys(rankEntryDraft).length === 0
                              ? 'Fill in at least one position to save.'
                              : `${Object.keys(rankEntryDraft).length} keyword(s) ready to save.`}
                          </span>
                          {Object.keys(rankEntryDraft).length > 0 && (
                            <button
                              type="button"
                              onClick={() => setRankEntryDraft({})}
                              className="text-xs font-medium text-gray-500 hover:text-gray-800"
                            >
                              Clear entries
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">Rank history</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        One column per date checked, newest first. <span className="text-emerald-600 font-medium">▲</span> means
                        the keyword climbed since the previous check, <span className="text-red-600 font-medium">▼</span> that it slipped.
                      </p>
                    </div>
                    <p className="text-xs text-gray-400">
                      {dates.length
                        ? `${rows.length} keyword(s) · ${dates.length} report date(s)`
                        : 'No rankings recorded yet'}
                    </p>
                  </div>
                  {rankingsLoading ? (
                    <p className="px-4 py-10 text-sm text-gray-400 text-center">Loading…</p>
                  ) : rows.length === 0 ? (
                    <p className="px-4 py-10 text-sm text-gray-400 text-center">
                      No active keywords on this project yet — add keywords first, then record their rankings here.
                    </p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 sticky left-0 bg-white">Keyword</th>
                          <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Volume</th>
                          <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Change</th>
                          {columnDates.map((d) => (
                            <th key={d} className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                {formatDate(d, 'MMM d')}
                                {isAdminUser && (
                                  <button
                                    type="button"
                                    title={`Remove the ${d} column`}
                                    onClick={() => deleteRankingDate.mutate(d)}
                                    className="text-gray-300 hover:text-red-500"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {rows.map((r: any) => (
                          <tr key={r.keywordId} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900 sticky left-0 bg-white">
                              {r.primaryKeyword}
                              {r.pageName && <span className="block text-xs text-gray-400">{r.pageName}</span>}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 text-right">
                              {r.volume != null ? r.volume.toLocaleString() : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
                              {/* Positive change = climbed the results, since a
                                  lower rank number is a better position. */}
                              {r.change == null ? (
                                <span className="text-gray-300">—</span>
                              ) : r.change > 0 ? (
                                <span className="text-emerald-600 font-medium">▲ {r.change}</span>
                              ) : r.change < 0 ? (
                                <span className="text-red-600 font-medium">▼ {Math.abs(r.change)}</span>
                              ) : (
                                <span className="text-gray-400">0</span>
                              )}
                            </td>
                            {columnDates.map((d) => {
                              const pos = r.positions?.[d];
                              return (
                                <td
                                  key={d}
                                  className={cn(
                                    'px-4 py-3 text-sm text-right',
                                    d === latestDate ? 'font-semibold text-gray-900' : 'text-gray-600',
                                  )}
                                >
                                  {pos == null ? <span className="text-gray-300">—</span> : pos}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Comments tab */}
          {tab === 'comments' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100"><h3 className="text-sm font-semibold text-gray-900">Comments</h3></div>
                <div className="divide-y divide-gray-100">
                  {comments.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-gray-400 text-center">No comments yet.</p>
                  ) : (
                    comments.map((c: any) => (
                      <div key={c.id} className="px-5 py-4 flex gap-3">
                        <Avatar src={c.author?.avatarUrl} name={c.author?.name} size="xs" className="w-7 h-7" />
                        <div>
                          <p className="text-xs font-medium text-gray-700">{c.author?.name} <span className="text-gray-400 font-normal">· {formatDate(c.createdAt)}</span></p>
                          {/* Comments are where deliverable URLs get pasted, so a
                              raw string here is a link the reader has to copy by
                              hand. Same treatment task remarks already get. */}
                          <Linkify text={c.body} className="block text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment…"
                  rows={2}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600 mb-2"
                />
                <div className="flex justify-end">
                  <button
                    onClick={() => newComment.trim() && addComment.mutate(newComment.trim())}
                    disabled={addComment.isPending || !newComment.trim()}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    Post Comment
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {openTaskId && (
        <TaskDetailModal
          projectId={id}
          taskId={openTaskId}
          onClose={closeProjectTask}
        />
      )}
    </div>
  );
}
