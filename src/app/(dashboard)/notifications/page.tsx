'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { Bell, CheckCheck, Info } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatMentionPreview } from '@/lib/utils';
import { notificationHref } from '@/lib/notifications';

type AnyNotification = {
  id: string;
  type: string;
  title: string;
  body?: string;
  createdAt: string;
  isRead: boolean;
  readAt?: string | null;
  refTable?: string | null;
  refId?: string | null;
};

export default function NotificationsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const notifRef = useRef<HTMLDivElement | null>(null);

  const { data: notifications = [], refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((r) => r.data || []),
    refetchInterval: 30_000,
  });

  const unread = useMemo(
    () => (notifications as AnyNotification[]).filter((n) => !n.isRead).length,
    [notifications],
  );

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not mark as read.'),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/mark-all-read').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not mark all read.'),
  });

  // Keep the scroll position stable on remount.
  useEffect(() => {
    notifRef.current?.scrollTo?.({ top: 0 });
  }, []);

  function handleNotificationClick(n: AnyNotification) {
    if (!n.isRead) markRead.mutate(n.id);
    const href = notificationHref(n);
    if (href) router.push(href);
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={`Notifications${unread > 0 ? ` (${unread} new)` : ''}`} />

      {/* The dashboard layout adds no padding — every page supplies its own, and
          this one didn't, so the card sat flush against the sidebar and screen
          edge on every viewport. */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-brand-700 shrink-0" />
            <p className="text-sm font-semibold text-gray-900">
              {unread > 0 ? `${unread} unread` : 'All caught up'}
            </p>
          </div>
          {/* Full-width, evenly split on phones; natural width from sm up. */}
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-brand-200 text-brand-700 hover:bg-brand-50 disabled:opacity-60 whitespace-nowrap"
              >
                <CheckCheck className="w-3.5 h-3.5 shrink-0" /> Mark all read
              </button>
            )}
            <button
              type="button"
              onClick={() => { refetch(); }}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 whitespace-nowrap"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* No inner height cap. Capping this made a second scroll region inside a
            page that already scrolls: the list stopped short with the remaining
            notifications hidden inside it, and dead space left underneath the
            card. The page scroll is the only one needed. */}
        <div ref={notifRef}>
          {(notifications as AnyNotification[]).length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              No notifications yet.
            </div>
          ) : (
            <div>
              {(notifications as AnyNotification[]).map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleNotificationClick(n)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(n); }}
                  className={cn(
                    'px-5 py-3.5 border-b border-gray-50 last:border-b-0 cursor-pointer hover:bg-gray-50',
                    !n.isRead && 'bg-blue-50/30 hover:bg-blue-50/50',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                        n.isRead ? 'bg-gray-100' : 'bg-brand-100',
                      )}
                    >
                      <Bell className={cn('w-3.5 h-3.5', n.isRead ? 'text-gray-400' : 'text-brand-700')} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-xs leading-snug', n.isRead ? 'text-gray-600' : 'text-gray-900 font-semibold')}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                          {formatMentionPreview(n.body)}
                        </p>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                        disabled={markRead.isPending}
                        className="shrink-0 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-50 rounded-lg border border-brand-200 whitespace-nowrap"
                      >
                        Mark read
                      </button>
                    )}
                    {n.isRead && n.body && (
                      <span title={n.readAt ? `Read ${n.readAt}` : ''} className="shrink-0 mt-1 text-[10px] text-gray-300 flex items-center gap-1">
                        <Info className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

