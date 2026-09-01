'use client';

import {
  Bell, CheckCheck, FolderKanban, ClipboardList, DollarSign,
  KeyRound, LogOut, CreditCard, UserCircle, CalendarDays, FileText,
  MessagesSquare,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { cn, formatMentionPreview, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/hooks/useBranding';
import { Badge } from '@/components/ui/badge';
import { SidebarTrigger } from '@/components/ui/sidebar';
import GlobalSearch from '@/components/layout/GlobalSearch';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

const TYPE_ICON: Record<string, any> = {
  stage_advance:    FolderKanban,
  assignment:       FolderKanban,
  task_submitted:   ClipboardList,
  task_update:      ClipboardList,
  payroll_review:   DollarSign,
  payroll_concern:  DollarSign,
  payment_notified: CreditCard,
  leave_requested:  CalendarDays,
  leave_approved:   CalendarDays,
  leave_rejected:   CalendarDays,
  profile_rejected: UserCircle,
  appraisal_recorded: ClipboardList,
  document_requested: FileText,
  document_issued: FileText,
  document_rejected: FileText,
  blog_submitted: FileText,
  blog_approved: FileText,
  blog_rejected: FileText,
  content_rejected: FileText,
  document_response: FileText,
  chat_mention: MessagesSquare,
  task_assigned: ClipboardList,
};

function notificationHref(n: any): string | null {
  // Messages mentions → open that room in the full-screen Messages app.
  if (n.type === 'chat_mention' || n.refTable === 'chat_rooms') {
    return n.refId ? `/messages/${n.refId}` : '/messages';
  }
  // Task notifications: "projectId:taskId" → the task's own page.
  if (n.refTable === 'project_tasks' && n.refId && String(n.refId).includes(':')) {
    const [projectId, taskId] = String(n.refId).split(':');
    if (projectId && taskId) {
      return `/tasks/${projectId}/${taskId}`;
    }
  }
  if (
    (n.type === 'task_assigned' || n.type === 'task_submitted' || n.type === 'task_update')
    && n.refTable === 'projects'
    && n.refId
  ) {
    return `/projects/${n.refId}?tab=overview`;
  }
  // Project-scoped notifications that belong on a specific tab, not the
  // project's default Overview — must be checked before the generic
  // refTable === 'projects' fallback further down swallows them.
  if (n.refTable === 'projects' && n.refId) {
    if (n.type === 'blog_submitted' || n.type === 'blog_approved' || n.type === 'blog_rejected') {
      return `/projects/${n.refId}?tab=blogs`;
    }
    if (n.type === 'content_rejected') return `/projects/${n.refId}?tab=content`;
    // The client-requirements approval queue — the approve/reject buttons and
    // the composed email both live on this tab.
    if (n.type?.startsWith('client_request_')) return `/projects/${n.refId}?tab=client-requests`;
  }
  if (n.type === 'appraisal_recorded' || n.refTable === 'appraisals') return '/self-service?tab=appraisals';
  if (n.type === 'leave_approved' || n.type === 'leave_rejected') return '/self-service?tab=leaves';
  if (n.type === 'document_issued' || n.type === 'document_rejected') return '/self-service?tab=documents';
  if (n.type === 'profile_rejected') return '/self-service?tab=profile';
  if (n.type === 'payroll_review') return '/self-service?tab=payroll';
  if (n.type === 'document_requested' && n.refTable === 'workers' && n.refId) {
    return `/hr/workers/${n.refId}?tab=documents`;
  }
  if (n.type === 'document_requested') return '/hr';
  if (!n.refTable || !n.refId) return null;
  if (n.refTable === 'projects')        return `/projects/${n.refId}`;
  if (n.refTable === 'invoices')        return `/invoices/${n.refId}`;
  if (n.refTable === 'payroll_runs')    return `/hr/payroll/${n.refId}`;
  if (n.refTable === 'leave_requests')  return '/hr?tab=leaves';
  if (n.refTable === 'self_service')    return '/self-service?tab=documents';
  if (n.refTable === 'workers')         return `/hr/workers/${n.refId}`;
  if (n.refTable === 'customer_documents') return `/documents/${n.refId}`;
  return null;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Header({ title }: { title?: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, logout } = useAuthStore();
  const { primaryColor } = useBranding();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  function handleLogout() {
    logout();
    router.push('/login');
  }

  const unread = (notifications as any[]).filter((n) => !n.isRead).length;

  function handleNotificationClick(n: any) {
    if (!n.isRead) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  return (
    <header className="h-14 border-b border-border bg-background px-4 sm:px-6 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <SidebarTrigger className="-ml-1 p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors shrink-0" />
        <h1 className="text-base font-semibold text-gray-900 truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-end min-w-0">

      <div className="flex-1 max-w-xs min-w-0">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-1">

      {/* ── Notifications bell ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
            <Bell className="w-4.5 h-4.5" />
            {unread > 0 && (
              <Badge
                variant="destructive"
                className="absolute top-0.5 right-0.5 w-4 h-4 min-w-4 px-0 py-0 text-[10px] rounded-full"
              >
                {unread > 9 ? '9+' : unread}
              </Badge>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[calc(100vw-2rem)] sm:w-80 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-900">
              Notifications {unread > 0 && <span className="text-xs font-medium text-gray-400 ml-1">({unread} new)</span>}
            </span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {(notifications as any[]).length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">No notifications yet.</div>
            ) : (
              (notifications as any[]).slice(0, 20).map((n: any) => {
                const Icon = TYPE_ICON[n.type] || Bell;
                return (
                  <DropdownMenuItem
                    key={n.id}
                    onSelect={() => handleNotificationClick(n)}
                    className={cn(
                      'w-full text-left flex items-start gap-3 px-4 py-3 rounded-none border-b border-gray-50 last:border-0 cursor-pointer',
                      !n.isRead && 'bg-blue-50/40',
                    )}
                  >
                    <div className={cn(
                      'mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
                      n.isRead ? 'bg-gray-100' : 'bg-brand-100',
                    )}>
                      <Icon className={cn('w-3.5 h-3.5', n.isRead ? 'text-gray-400' : 'text-brand-700')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-xs leading-snug whitespace-normal', n.isRead ? 'text-gray-600' : 'text-gray-900 font-medium')}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 leading-snug whitespace-normal">
                          {formatMentionPreview(n.body)}
                        </p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                    </div>
                    {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* ── User avatar ── */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white hover:opacity-90 transition-opacity ml-1 overflow-hidden shrink-0"
            style={{ backgroundColor: primaryColor }}
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              user ? getInitials(user.name) : '?'
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-semibold text-gray-900 truncate">{user?.name}</p>
            <p className="text-xs text-gray-400 mt-0.5 truncate font-normal">{user?.role?.name}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => router.push('/self-service?tab=profile')} className="cursor-pointer">
            <UserCircle className="w-4 h-4 text-gray-400" />
            My Profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => router.push('/change-password')} className="cursor-pointer">
            <KeyRound className="w-4 h-4 text-gray-400" />
            Change Password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleLogout} variant="destructive" className="cursor-pointer">
            <LogOut className="w-4 h-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      </div>
      </div>
    </header>
  );
}
