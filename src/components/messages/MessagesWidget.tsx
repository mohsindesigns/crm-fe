'use client';

/**
 * Bottom-right messaging bubble (LinkedIn-style): a floating launcher with an
 * unread badge that opens a short flyout of recent conversations. Clicking a
 * conversation — or "See all in Messages" — navigates to the full /messages
 * screen; this widget only ever shows a preview, it never sends/receives.
 *
 * Session-wide like NotificationBridge, so it's mounted once in the dashboard
 * layout and stays out of the way on the full Messages screen itself.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, X, ExternalLink, Search, Building2, Hash } from 'lucide-react';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/hooks/useBranding';
import { getMessagesSocket } from '@/lib/messagesSocket';
import { BRAND } from '@/lib/brand';

const MENTION_TOKEN = /@\[([^\]]+)\]\((user|contact|all):([0-9a-f-]{36}|all)\)/gi;

function roomTitle(room: any) {
  if (room.roomType === 'dm') return room.isSelf ? 'You' : (room.peer?.name || room.name);
  return room.client?.name || room.name;
}

function timeAgo(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export default function MessagesWidget() {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { primaryColor } = useBranding();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  // Same permission the Messages screen itself gates on.
  const canAccess = hasPermission('projects.read');
  const authToken = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;

  // Same query key MessagesApp uses for the default (active, CRM) room list,
  // so this cache is shared with the full screen and with NotificationBridge's
  // `['message-rooms']` invalidation on every incoming message.
  const { data: rooms = [] } = useQuery({
    queryKey: ['message-rooms', '/messages', 'active'],
    queryFn: () => api.get('/messages/rooms?status=active').then((r) => r.data),
    enabled: !!user && canAccess,
    refetchInterval: 60_000,
  });

  const unreadTotal = (rooms as any[]).reduce((sum, r) => sum + (r.unread || 0), 0);

  // Push-refresh the badge/list the instant a message lands, not just every 60s.
  useEffect(() => {
    if (!authToken || !user || !canAccess) return undefined;
    const sock = getMessagesSocket(authToken);
    const onNotify = () => qc.invalidateQueries({ queryKey: ['message-rooms'] });
    sock.on('notify:message', onNotify);
    if (!sock.connected) sock.connect();
    return () => { sock.off('notify:message', onNotify); };
  }, [authToken, user, canAccess, qc]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Flyout is a preview only — most-recent-first, capped short.
  const filtered = useMemo(() => {
    let list = [...(rooms as any[])];
    list.sort((a, b) => {
      const at = new Date(a.lastMessage?.createdAt || a.updatedAt || 0).getTime();
      const bt = new Date(b.lastMessage?.createdAt || b.updatedAt || 0).getTime();
      return bt - at;
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => roomTitle(r).toLowerCase().includes(q));
    }
    return list.slice(0, 8);
  }, [rooms, search]);

  function openRoom(id: string) {
    setOpen(false);
    router.push(`/messages/${id}`);
  }

  function goToMessages() {
    setOpen(false);
    router.push('/messages');
  }

  // "Message yourself" (WhatsApp-style notes-to-self) — surfaced as a one-click
  // shortcut only until it exists, after which it's just another room in the list.
  const hasSelfRoom = (rooms as any[]).some((r) => r.isSelf);
  async function openSelfDm() {
    if (!user) return;
    try {
      const res = await api.post('/messages/dms', { userId: user.id });
      openRoom(res.data.id);
    } catch {
      // Full Messages screen surfaces a proper error toast if this is retried there.
    }
  }

  if (!user || !canAccess) return null;
  // Don't float a shortcut to the screen you're already on.
  if (pathname?.startsWith('/messages')) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Messages"
          className="w-[340px] max-h-[70vh] sm:max-h-[440px] flex flex-col rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden"
        >
          <div
            className="flex items-center gap-1 px-4 py-3 shrink-0"
            style={{ backgroundColor: BRAND.primaryDark }}
          >
            <p className="text-sm font-semibold text-white flex-1">Messaging</p>
            <button
              type="button"
              title="Open Messages"
              onClick={goToMessages}
              className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              type="button"
              title="Close"
              onClick={() => setOpen(false)}
              className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search messages"
                className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-lg border border-gray-200 bg-gray-50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-brand-300"
              />
            </div>
          </div>

          {!hasSelfRoom && !search.trim() && (
            <button
              type="button"
              onClick={openSelfDm}
              className="shrink-0 w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-100"
            >
              <Avatar name={user.name} src={user.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-gray-900">You</p>
                <p className="text-[11px] text-gray-400">Message yourself</p>
              </div>
            </button>
          )}

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8 px-4">
                {search ? 'No conversations match.' : 'No conversations yet.'}
              </p>
            ) : (
              filtered.map((room) => {
                const title = roomTitle(room);
                const preview = room.lastMessage?.body
                  ? String(room.lastMessage.body).replace(MENTION_TOKEN, '@$1')
                  : room.isSelf ? 'Message yourself'
                    : room.roomType === 'dm' ? 'Start the conversation' : 'No messages yet';
                const unread = room.unread || 0;
                return (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => openRoom(room.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    {room.roomType === 'dm' ? (
                      <Avatar name={title} src={room.peer?.avatarUrl} size="sm" />
                    ) : (
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-brand-50 text-brand-700">
                        {room.roomType === 'group'
                          ? <Hash className="w-4 h-4" />
                          : <Building2 className="w-4 h-4" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-xs truncate', unread > 0 ? 'font-semibold text-gray-900' : 'font-medium text-gray-700')}>
                        {title}
                      </p>
                      <p className={cn('text-[11px] truncate mt-0.5', unread > 0 ? 'text-gray-600' : 'text-gray-400')}>
                        {preview}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-[10px] text-gray-400">{timeAgo(room.lastMessage?.createdAt)}</span>
                      {unread > 0 && (
                        <span
                          className="text-[10px] font-bold min-w-[1.1rem] h-[1.1rem] px-1 rounded-full flex items-center justify-center text-white"
                          style={{ backgroundColor: primaryColor }}
                        >
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <button
            type="button"
            onClick={goToMessages}
            className="shrink-0 text-xs font-semibold text-center py-2.5 border-t border-gray-100 text-brand-700 hover:bg-brand-50/60 transition-colors"
          >
            See all in Messages
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Close messages' : 'Open messages'}
        className="relative w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white hover:scale-105 active:scale-95 transition-transform"
        style={{ backgroundColor: primaryColor }}
      >
        {open ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!open && unreadTotal > 0 && (
          <span className="absolute -top-1 -right-1 text-[10px] font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center text-white bg-red-500 ring-2 ring-white">
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>
    </div>
  );
}
