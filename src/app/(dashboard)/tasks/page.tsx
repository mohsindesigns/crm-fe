'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, Search, AlertTriangle, Plus, X, Bell, MessageSquareText, Upload, Paperclip, Trash2, Calendar, Flag, CircleDot } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Avatar from '@/components/Avatar';
import Linkify from '@/components/Linkify';
import TaskDetailModal from '@/components/TaskDetailModal';
import { cn, formatDate, titleCase, uploadErrorMessage, formatFileSize } from '@/lib/utils';
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

const STATUS_FILTERS = [
  { label: 'All open', value: '' },
  { label: 'To do', value: 'todo' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'In review', value: 'in_review' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Approved', value: 'approved' },
  { label: 'Done', value: 'done' },
  { label: 'All statuses', value: 'all' },
];

const DUE_FILTERS = [
  { label: 'Any due date', value: '' },
  { label: 'Overdue', value: 'overdue' },
  { label: 'Due today', value: 'today' },
  { label: 'Due this week', value: 'week' },
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'No due date', value: 'none' },
];

const SORT_OPTIONS = [
  { label: 'Due soonest', value: 'due_asc' },
  { label: 'Due latest', value: 'due_desc' },
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Title A–Z', value: 'title' },
];

const META_PILL_BASE =
  'inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium text-gray-600';

const selectClass =
  'min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700 w-full sm:w-auto sm:min-w-40';

function taskTimestamps(task: any) {
  const lines: { label: string; value: string }[] = [];
  if (task.createdAt) {
    lines.push({
      label: 'Created',
      value: `${formatDate(task.createdAt, 'MMM d, yyyy · h:mm a')}${task.creator?.name ? ` · ${task.creator.name}` : ''}`,
    });
  }
  if (task.completedAt) {
    lines.push({
      label: task.status === 'approved' ? 'Approved' : task.status === 'done' ? 'Completed' : 'Completed at',
      value: formatDate(task.completedAt, 'MMM d, yyyy · h:mm a'),
    });
  } else if (task.updatedAt && task.updatedAt !== task.createdAt) {
    lines.push({
      label: 'Updated',
      value: formatDate(task.updatedAt, 'MMM d, yyyy · h:mm a'),
    });
  }
  return lines;
}

export default function TasksPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const currentUser = useAuthStore((s) => s.user);
  const canSeeAllTasks = hasPermission('projects.manage');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [createdByFilter, setCreatedByFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [dueFilter, setDueFilter] = useState('');
  const [sort, setSort] = useState('due_asc');
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTask, setNewTask] = useState({
    projectId: '', title: '', assigneeId: '', reviewerId: '', type: 'issue',
    pageName: '', dueAt: '', remarks: '', requiresTechnicalAudit: false,
  });
  // Files staged in the Add Task dialog. They can only be uploaded once the task
  // exists (the media endpoint keys artifacts on taskId), so they're held here and
  // pushed straight after the create call succeeds.
  const [newTaskFiles, setNewTaskFiles] = useState<File[]>([]);
  const newTaskFileRef = useRef<HTMLInputElement>(null);
  // Thumbnails for picked images. Object URLs have to be revoked or every pick
  // leaks a blob for the lifetime of the page — the cleanup below fires whenever
  // the selection changes and when the dialog unmounts.
  const newTaskPreviews = useMemo(
    () => newTaskFiles.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)),
    [newTaskFiles],
  );
  useEffect(
    () => () => newTaskPreviews.forEach((url) => url && URL.revokeObjectURL(url)),
    [newTaskPreviews],
  );
  const [view, setView] = useState<'mine' | 'assigned_by_me' | 'all'>('mine');
  // Clicking a row used to jump to the whole project page, which left custom tasks
  // with nowhere to attach a deliverable or mark themselves complete. Open the same
  // task modal the project board uses instead.
  const [openTask, setOpenTask] = useState<{ projectId: string; taskId: string } | null>(null);

  const filterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (projectFilter) params.projectId = projectFilter;
    if (typeFilter) params.type = typeFilter;
    if (dueFilter) params.due = dueFilter;
    if (sort) params.sort = sort;
    if (search.trim()) params.search = search.trim();
    // "Assignee" narrows who the task sits on — meaningless on My Tasks (that's
    // always me). "Assigned by" narrows who created it — meaningless on Assigned
    // by me (that's always me). Each view only sends the filter it can use.
    if (view !== 'mine' && assigneeFilter) params.assigneeId = assigneeFilter;
    if (view !== 'assigned_by_me' && createdByFilter) params.createdBy = createdByFilter;
    if (view === 'assigned_by_me') params.scope = 'assigned_by_me';
    return params;
  }, [statusFilter, projectFilter, typeFilter, dueFilter, sort, search, assigneeFilter, createdByFilter, view]);

  const { data: myTasks = [], isLoading: loadingMine } = useQuery({
    queryKey: ['my-tasks', view, filterParams],
    queryFn: () => api.get('/tasks/mine', { params: filterParams }).then((r) => r.data),
    enabled: view === 'mine' || view === 'assigned_by_me',
  });

  const { data: allTasks = [], isLoading: loadingAll } = useQuery({
    queryKey: ['all-tasks', filterParams],
    queryFn: () => api.get('/tasks', { params: filterParams }).then((r) => r.data),
    enabled: view === 'all' && canSeeAllTasks,
  });

  const tasks = view === 'all' ? allTasks : myTasks;
  const isLoading = view === 'all' ? loadingAll : loadingMine;
  const showAssigneeCol = view === 'all' || view === 'assigned_by_me';

  const { data: projectsResp } = useQuery({
    queryKey: ['tasks-page-projects'],
    queryFn: () => api.get('/tasks/assignable-projects').then((r) => ({ data: r.data || [] })),
  });
  const projects: any[] = projectsResp?.data || [];

  // Lightweight directory (id/name only, no permission gate) so anyone can pick any
  // teammate as an assignee, and so the assignee / "assigned by" filters work on
  // every view — not just for users.read holders on All Tasks.
  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users-assignable'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data || []),
  });

  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks as any[]) {
      if (t.type) set.add(t.type);
    }
    ['issue', 'keyword', 'content', 'design', 'review', 'custom'].forEach((t) => set.add(t));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const createTask = useMutation({
    mutationFn: async (payload: typeof newTask) => {
      const task = await api.post(`/projects/${payload.projectId}/tasks`, {
        title: payload.title,
        assigneeId: payload.assigneeId || undefined,
        // Left blank, the server nominates the creator as reviewer — the same
        // behaviour as before this field existed.
        reviewerId: payload.reviewerId || undefined,
        dueAt: payload.dueAt || undefined,
        remarks: payload.remarks.trim() || undefined,
        type: payload.type || 'issue',
        pageName: payload.pageName.trim() || undefined,
        requiresTechnicalAudit: payload.requiresTechnicalAudit || undefined,
      }).then((r) => r.data);

      // Attachment upload is reported separately: the task itself is already
      // saved at this point, so a failed upload must not read as "task failed".
      let uploadError: string | null = null;
      if (newTaskFiles.length && task?.id) {
        try {
          const fd = new FormData();
          newTaskFiles.forEach((file) => fd.append('file', file));
          fd.append('taskId', task.id);
          fd.append('projectId', payload.projectId);
          fd.append('stageKey', task.stageKey || 'general');
          // Tagged so the assignee's task view can show these as the brief they
          // were given, separate from the deliverable they upload back.
          fd.append('kind', 'brief');
          await api.post('/media/upload-multi', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (err: any) {
          uploadError = uploadErrorMessage(err);
        }
      }
      return { task, uploadError, fileCount: newTaskFiles.length };
    },
    onSuccess: ({ uploadError, fileCount }) => {
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['all-tasks'] });
      setShowAddTask(false);
      const hadAssignee = !!newTask.assigneeId;
      const neededAudit = newTask.requiresTechnicalAudit;
      setNewTask({
        projectId: '', title: '', assigneeId: '', reviewerId: '', type: 'issue',
        pageName: '', dueAt: '', remarks: '', requiresTechnicalAudit: false,
      });
      setNewTaskFiles([]);
      if (uploadError) {
        toast.error(`Task created, but the attachments failed to upload: ${uploadError}`);
        return;
      }
      const filePart = fileCount ? ` ${fileCount} file${fileCount === 1 ? '' : 's'} attached.` : '';
      toast.success((neededAudit
        ? 'Task created — sent for technical audit approval before it is assigned.'
        : hadAssignee ? 'Task created and assignee notified.' : 'Task created.') + filePart);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to create task. You may not have permission to add tasks on this project.'),
  });

  const hasActiveFilters = !!(
    statusFilter
    || projectFilter
    || assigneeFilter
    || createdByFilter
    || typeFilter
    || dueFilter
    || search.trim()
    || sort !== 'due_asc'
  );

  function closeAddTask() {
    setShowAddTask(false);
    setNewTaskFiles([]);
  }

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
    setProjectFilter('');
    setAssigneeFilter('');
    setCreatedByFilter('');
    setTypeFilter('');
    setDueFilter('');
    setSort('due_asc');
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="My Tasks" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">
        {/* One scrolling strip rather than a wrapping grid: three view tabs broke
            2-then-1 on a phone, which reads as two unrelated groups. A single row
            that scrolls sideways keeps them recognisable as one control. */}
        <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-1 overflow-x-auto scrollbar-hide sm:flex-wrap">
          {([
            { key: 'mine' as const, label: 'My Tasks' },
            { key: 'assigned_by_me' as const, label: 'Assigned by me' },
            ...(canSeeAllTasks ? [{ key: 'all' as const, label: 'All Tasks' }] : []),
          ]).map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              className={cn(
                'shrink-0 whitespace-nowrap px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors',
                view === v.key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Search and Add Task share one row on phones — the button was landing
              on a line of its own, floated right, looking unrelated to anything. */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-1 min-w-0 sm:flex-none sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tasks…"
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <button
              onClick={() => setShowAddTask(true)}
              title="Add task"
              className="flex items-center gap-1.5 sm:ml-auto shrink-0 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 sm:px-3.5 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">Add Task</span>
            </button>
          </div>

          <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-1 overflow-x-auto scrollbar-hide sm:flex-wrap">
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.value || 'open'}
                onClick={() => setStatusFilter(opt.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  statusFilter === opt.value
                    ? 'bg-brand-700 text-white'
                    : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All projects</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            {view !== 'mine' && (
              <select
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
                title="Filter by who the task is assigned to"
                className={selectClass}
              >
                <option value="">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {(assignableUsers as any[]).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.id === currentUser?.id ? `${u.name} (me)` : u.name}
                  </option>
                ))}
              </select>
            )}

            {view !== 'assigned_by_me' && (
              <select
                value={createdByFilter}
                onChange={(e) => setCreatedByFilter(e.target.value)}
                title="Filter by who created / assigned the task"
                className={selectClass}
              >
                <option value="">Assigned by anyone</option>
                {(assignableUsers as any[]).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {/* The placeholder already says what this filter narrows —
                        repeating "Assigned by" on all 25 rows just made the
                        names harder to scan. */}
                    {u.id === currentUser?.id ? `${u.name} (me)` : u.name}
                  </option>
                ))}
              </select>
            )}

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All types</option>
              {typeOptions.map((t) => (
                <option key={t} value={t}>{titleCase(t)}</option>
              ))}
            </select>

            <select
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value)}
              className={selectClass}
            >
              {DUE_FILTERS.map((opt) => (
                <option key={opt.value || 'any'} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className={selectClass}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                <X className="w-3.5 h-3.5" />
                Clear filters
              </button>
            )}
          </div>
        </div>

        {showAddTask && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={closeAddTask} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md sm:max-w-lg p-6 space-y-4 max-h-[90dvh] overflow-y-auto">
              <h3 className="text-sm font-semibold text-gray-900">Add Task</h3>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Project *</label>
                {/* Project names are long ("Verensoft - Web Development - Growth")
                    and the browser sizes the dropdown popup to its widest option,
                    so on a phone the popup spilled past the dialog. A smaller face
                    on small screens keeps it inside. */}
                <select
                  value={newTask.projectId}
                  onChange={(e) => setNewTask((x) => ({ ...x, projectId: e.target.value }))}
                  className="w-full px-3.5 py-2 text-xs sm:text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                >
                  <option value="">Select project…</option>
                  {projects.map((p: any) => (
                    <option key={p.id} value={p.id} className="text-xs sm:text-sm">{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Task title *</label>
                <input
                  value={newTask.title}
                  onChange={(e) => setNewTask((x) => ({ ...x, title: e.target.value }))}
                  placeholder="e.g. Fix broken contact form"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Assign to</label>
                  <select
                    value={newTask.assigneeId}
                    onChange={(e) => setNewTask((x) => ({ ...x, assigneeId: e.target.value }))}
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    <option value="">Unassigned</option>
                    {(assignableUsers as any[]).map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.id === currentUser?.id ? `${u.name} (me)` : u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Reviewer</label>
                  <select
                    value={newTask.reviewerId}
                    onChange={(e) => setNewTask((x) => ({ ...x, reviewerId: e.target.value }))}
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    <option value="">You (default)</option>
                    {(assignableUsers as any[]).map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.id === currentUser?.id ? `${u.name} (me)` : u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Type</label>
                  <select
                    value={newTask.type}
                    onChange={(e) => setNewTask((x) => ({ ...x, type: e.target.value }))}
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    {typeOptions.map((t) => (
                      <option key={t} value={t}>{titleCase(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Due date</label>
                  <input
                    type="date"
                    value={newTask.dueAt}
                    onChange={(e) => setNewTask((x) => ({ ...x, dueAt: e.target.value }))}
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTask.requiresTechnicalAudit}
                  onChange={(e) => setNewTask((x) => ({ ...x, requiresTechnicalAudit: e.target.checked }))}
                  className="w-3.5 h-3.5 mt-0.5 rounded accent-brand-600"
                />
                <span>
                  Technical Audit
                  <span className="block text-xs text-gray-400">
                    Task is created unassigned and held for an administrator to approve first — only then is the chosen assignee actually assigned and notified.
                  </span>
                </span>
              </label>
              {/* Only meaningful for page-scoped work — asking every task which
                  page it is about would be noise on the other types. */}
              {['content', 'design', 'review'].includes(newTask.type) && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Page <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    value={newTask.pageName}
                    onChange={(e) => setNewTask((x) => ({ ...x, pageName: e.target.value }))}
                    placeholder="e.g. Service page"
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              )}
              <div>
                {/* Labelled "Description" to match where it actually lands — it
                    was "Remarks" here and "Description" on the task itself, so
                    people filling it in didn't realise they were the same field. */}
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Description</label>
                <textarea
                  value={newTask.remarks}
                  onChange={(e) => setNewTask((x) => ({ ...x, remarks: e.target.value }))}
                  rows={3}
                  placeholder="Context or instructions for the assignee…"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">
                  Attachments{' '}
                  {newTaskFiles.length > 0
                    ? <span className="text-brand-700">({newTaskFiles.length} selected)</span>
                    : <span className="text-gray-400">(optional)</span>}
                </label>
                <input
                  ref={newTaskFileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    // Read the FileList into a real array BEFORE resetting the input.
                    // React calls the updater below after the handler returns, by which
                    // point `e.target.value = ''` has already emptied e.target.files —
                    // so reading it lazily in there always yielded an empty selection.
                    const picked = Array.from(e.target.files || []);
                    e.target.value = ''; // lets the same file be picked again
                    if (picked.length) setNewTaskFiles((prev) => [...prev, ...picked]);
                  }}
                />
                <button
                  type="button"
                  onClick={() => newTaskFileRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                >
                  <Upload className="w-3.5 h-3.5" /> Choose files
                </button>
                {newTaskFiles.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {newTaskFiles.map((file, i) => (
                      <div key={`${file.name}-${file.lastModified}-${i}`} className="flex items-center gap-2.5 py-1.5 px-2 bg-gray-50 rounded-lg border border-gray-200">
                        {newTaskPreviews[i] ? (
                          <img
                            src={newTaskPreviews[i] as string}
                            alt=""
                            className="w-8 h-8 rounded object-cover border border-gray-200 shrink-0"
                          />
                        ) : (
                          <span className="w-8 h-8 rounded bg-white border border-gray-200 flex items-center justify-center shrink-0">
                            <Paperclip className="w-3.5 h-3.5 text-gray-400" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-gray-700 truncate">{file.name}</span>
                          <span className="block text-[11px] text-gray-400">{formatFileSize(file.size)}</span>
                        </span>
                        <button
                          type="button"
                          title="Remove this attachment"
                          onClick={() => setNewTaskFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="p-0.5 text-gray-400 hover:text-red-500 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Briefs, references, or the deliverable itself. Uploaded to the task once it&apos;s created — the
                  assignee can add more from the task&apos;s Deliverable box.
                </p>
              </div>
              <p className="text-[11px] text-gray-400">
                Starts as <span className="font-medium text-gray-600">To do</span>.
                {newTask.requiresTechnicalAudit
                  ? ' Held unassigned until an administrator approves the technical audit.'
                  : ' Assignee gets a notification right away.'}
                {newTask.dueAt ? ' An automatic reminder is sent 24 hours before the due date.' : ' Add a due date to enable the automatic 24h reminder.'}
              </p>
              <div className="flex gap-2 justify-end pt-1">
                <button
                  onClick={closeAddTask}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => createTask.mutate(newTask)}
                  disabled={createTask.isPending || !newTask.projectId || !newTask.title.trim()}
                  className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {createTask.isPending ? 'Creating…' : 'Create Task'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {view === 'all' ? 'All tasks' : view === 'assigned_by_me' ? 'Assigned by me' : 'My tasks'}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {view === 'all'
                  ? 'Every task across projects.'
                  : view === 'assigned_by_me'
                    ? 'Tasks you created and assigned — track status, remarks, and who is working on them.'
                    : 'Tasks assigned to you or waiting for your review.'}
              </p>
            </div>
            <span className="text-xs text-gray-400">{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
          </div>
          {isLoading && (
            <p className="px-5 py-10 text-sm text-gray-400 text-center">Loading…</p>
          )}
          {!isLoading && tasks.length === 0 && (
            <p className="px-5 py-10 text-sm text-gray-400 text-center">No tasks found.</p>
          )}
          {!isLoading && tasks.length > 0 && (
            <>
              <div className="md:hidden divide-y divide-gray-100">
                {tasks.map((task: any) => {
                  const isOverdue = !!task.dueAt
                    && new Date(task.dueAt) < new Date(new Date().toDateString())
                    && !['done', 'approved'].includes(task.status);
                  const stamps = taskTimestamps(task);
                  const assignedByMe = !!currentUser?.id
                    && task.createdBy === currentUser.id
                    && task.assigneeId
                    && task.assigneeId !== currentUser.id;
                  return (
                    <div
                      key={task.id}
                      onClick={() => setOpenTask({ projectId: task.projectId, taskId: task.id })}
                      className={cn('px-4 py-3 space-y-2 cursor-pointer hover:bg-gray-50/80 transition-colors', isOverdue && 'bg-red-50/40')}
                    >
                      <div className="flex items-start gap-2">
                        <CheckSquare className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-900 break-words">{task.title}</p>

                          {/* Project line on its own row, tappable. The separate
                              client pill is dropped when the project name already
                              begins with it — "Verensoft" next to "Verensoft -
                              Hosting - Hosting Starter" is the same word twice. */}
                          {task.project?.name && (
                            <button
                              type="button"
                              title="Open project"
                              onClick={(e) => { e.stopPropagation(); router.push(`/projects/${task.projectId}`); }}
                              className="mt-1 block max-w-full truncate text-left text-xs text-gray-500 hover:text-gray-900"
                            >
                              {task.project.name}
                            </button>
                          )}

                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {assignedByMe && (
                              <span className="inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                                You assigned
                              </span>
                            )}
                            {task.requiresTechnicalAudit && task.auditStatus === 'pending' && (
                              <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                Awaiting technical audit
                              </span>
                            )}
                            {!task.project?.name && task.project?.client?.name && (
                              <span className={META_PILL_BASE}>{task.project.client.name}</span>
                            )}
                            {task.stageKey && <span className={cn(META_PILL_BASE, 'whitespace-nowrap')}>Stage: {titleCase(task.stageKey)}</span>}
                            {task.type && (
                              <span className={cn(META_PILL_BASE, 'inline-flex items-center gap-1 whitespace-nowrap')}>
                                <Flag className="w-2.5 h-2.5 text-brand-700" />
                                {titleCase(task.type === 'blog_post' ? 'Blog' : task.type)}
                              </span>
                            )}
                          </div>
                          {task.remarks && (
                            <p className="mt-2 text-xs text-gray-600 line-clamp-2 flex items-start gap-1 min-w-0">
                              <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
                              <Linkify text={task.remarks} className="min-w-0" />
                            </p>
                          )}
                          {/* One stamp, date only. The full "Created: Aug 15, 2026
                              · 10:56 PM · Super Admin" is audit detail that belongs
                              in the task itself, not on every row of a phone list. */}
                          {stamps.length > 0 && (
                            <p className="mt-2 text-[11px] text-gray-400">
                              <span className="font-medium text-gray-500">{stamps[0].label}:</span>{' '}
                              {stamps[0].value.split(' · ')[0]}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full', STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-500')}>
                          <CircleDot className="w-3 h-3 shrink-0 opacity-70" />
                          {titleCase(task.status || 'todo')}
                        </span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {(showAssigneeCol || assignedByMe) && (
                            <span className="flex items-center gap-1.5 min-w-0">
                              <Avatar name={task.assignee?.name || task.pendingAssignee?.name} size="xs" />
                              <span className="text-xs text-gray-600 truncate">
                                {task.assignee?.name
                                  || (task.pendingAssignee?.name ? `Pending: ${task.pendingAssignee.name}` : 'Unassigned')}
                              </span>
                            </span>
                          )}
                          {task.reminderAt && (
                            <span className="flex items-center gap-1 text-xs text-amber-700" title="Auto reminder (24h before due)">
                              <Bell className="w-3 h-3 shrink-0" />
                              {formatDate(task.reminderAt, 'MMM d')}
                            </span>
                          )}
                          {task.dueAt ? (
                            <span className={cn('flex items-center gap-1 text-xs', isOverdue ? 'text-red-600 font-medium' : 'text-gray-500')}>
                              {isOverdue ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <Calendar className="w-3 h-3 shrink-0" />}
                              {formatDate(task.dueAt, 'MMM d')}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">No due date</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <table className="hidden md:table w-full table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3 w-[34%]">Task</th>
                    {showAssigneeCol && (
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-3 w-[9rem] whitespace-nowrap">Assignee</th>
                    )}
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-3 w-[6rem] whitespace-nowrap">Due</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-3 w-[6.5rem] whitespace-nowrap">Reminder</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-3 w-[11rem] whitespace-nowrap">Timestamps</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-3 w-[6.5rem] whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tasks.map((task: any) => {
                    const isOverdue = !!task.dueAt
                      && new Date(task.dueAt) < new Date(new Date().toDateString())
                      && !['done', 'approved'].includes(task.status);
                    const stamps = taskTimestamps(task);
                    const assignedByMe = !!currentUser?.id
                      && task.createdBy === currentUser.id
                      && task.assigneeId
                      && task.assigneeId !== currentUser.id;
                    return (
                      <tr
                        key={task.id}
                        onClick={() => setOpenTask({ projectId: task.projectId, taskId: task.id })}
                        className={cn('cursor-pointer hover:bg-gray-50/80 transition-colors align-top', isOverdue && 'bg-red-50/40')}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-start gap-2.5 min-w-0">
                            <CheckSquare className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                            <div className="min-w-0 space-y-1.5">
                              <p className="text-sm font-medium text-gray-900 break-words">{task.title}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {assignedByMe && (
                                  <span className="inline-flex items-center rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                                    You assigned
                                  </span>
                                )}
                                {task.requiresTechnicalAudit && task.auditStatus === 'pending' && (
                                  <span className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                    Awaiting technical audit
                                  </span>
                                )}
                                {task.project?.client?.name && <span className={META_PILL_BASE}>{task.project.client.name}</span>}
                                {task.project?.name && (
                              <button
                                type="button"
                                title="Open project"
                                onClick={(e) => { e.stopPropagation(); router.push(`/projects/${task.projectId}`); }}
                                className={cn(META_PILL_BASE, 'hover:bg-gray-100 hover:text-gray-900')}
                              >
                                {task.project.name}
                              </button>
                            )}
                                {task.stageKey && <span className={META_PILL_BASE}>Stage: {titleCase(task.stageKey)}</span>}
                                {task.type && (
                                  <span className={cn(META_PILL_BASE, 'inline-flex items-center gap-1')}>
                                    <Flag className="w-2.5 h-2.5 text-brand-700" />
                                    {titleCase(task.type === 'blog_post' ? 'Blog' : task.type)}
                                  </span>
                                )}
                              </div>
                              {task.remarks && (
                                <p className="text-xs text-gray-600 line-clamp-2 flex items-start gap-1 min-w-0">
                                  <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0 text-gray-400" />
                                  <Linkify text={task.remarks} className="min-w-0" />
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        {showAssigneeCol && (
                          <td className="px-3 py-3.5 align-top">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <Avatar name={task.assignee?.name || task.pendingAssignee?.name} size="xs" />
                              <span className="text-xs text-gray-600 truncate">
                                {task.assignee?.name
                                  || (task.pendingAssignee?.name ? `Pending: ${task.pendingAssignee.name}` : 'Unassigned')}
                              </span>
                            </div>
                          </td>
                        )}
                        <td className="px-3 py-3.5 whitespace-nowrap align-top">
                          {task.dueAt ? (
                            <span className={cn('flex items-center gap-1 text-xs', isOverdue ? 'text-red-600 font-medium' : 'text-gray-500')}>
                              {isOverdue ? <AlertTriangle className="w-3 h-3 shrink-0" /> : <Calendar className="w-3 h-3 shrink-0" />}
                              {formatDate(task.dueAt, 'MMM d')}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 whitespace-nowrap align-top">
                          {task.reminderAt ? (
                            <span className="flex items-center gap-1 text-xs text-amber-700" title="Auto reminder (24h before due)">
                              <Bell className="w-3 h-3 shrink-0" />
                              {formatDate(task.reminderAt, 'MMM d')}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 align-top">
                          {stamps.length === 0 ? (
                            <span className="text-xs text-gray-300">—</span>
                          ) : (
                            <div className="space-y-1">
                              {stamps.map((s) => (
                                <p key={s.label} className="text-[11px] leading-snug text-gray-500">
                                  <span className="font-medium text-gray-600">{s.label}</span>
                                  <br />
                                  {s.value}
                                </p>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5 whitespace-nowrap align-top">
                          <span className={cn('inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium rounded-full', STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-500')}>
                            <CircleDot className="w-3 h-3 shrink-0 opacity-70" />
                            {titleCase(task.status || 'todo')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {openTask && (
          <TaskDetailModal
            projectId={openTask.projectId}
            taskId={openTask.taskId}
            allowOpenInProject
            onClose={() => setOpenTask(null)}
          />
        )}
      </div>
    </div>
  );
}
