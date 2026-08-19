'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Building2, Paperclip, Mic, Send, Search,
  Users, UserPlus, X, Circle, Image as ImageIcon, FileText, Square,
  Hash, MessageSquare, ChevronDown,
  Pin, Settings, Reply, Archive, Megaphone, UsersRound, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import { cn, formatDate, uploadErrorMessage } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { usePortalStore } from '@/store/portal';
import { useBranding } from '@/hooks/useBranding';
import { getMessagesSocket } from '@/lib/messagesSocket';
import { BRAND } from '@/lib/brand';
import PublicProfileModal from '@/components/messages/PublicProfileModal';
import {
  DateDivider, dayLabel, ReactionBar, MessageActions, ThreadPanel, SearchPanel,
  PinnedPanel, FilesPanel, RoomSettingsPanel, TaskFromMessageModal, CommandPalette,
  RoomBanners, SeenBy, BulkAddModal, QUICK_EMOJI,
} from '@/components/messages/ChatPanels';
import { DesktopNotifyPrompt } from '@/components/NotificationBridge';

const MENTION_TOKEN = /@\[([^\]]+)\]\((user|contact|all):([0-9a-f-]{36}|all)\)/gi;

type MentionRef = { id: string; type: string; name: string };

const EVERYONE_MENTION: MentionRef = { id: 'all', type: 'all', name: 'everyone' };

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Composer shows @Name; wire format keeps @[Name](user|contact|all:id) for the API. */
function encodeMentionsForSend(text: string, mentions: MentionRef[]) {
  let out = text;
  // Normalize @all → @everyone before encoding.
  out = out.replace(/@all(?![^\s])/gi, '@everyone');
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length);
  for (const m of ordered) {
    const re = new RegExp(`@${escapeRegExp(m.name)}(?![\\w])`, 'g');
    out = out.replace(re, `@[${m.name}](${m.type}:${m.id})`);
  }
  // Catch typed @everyone even if not selected from the picker.
  out = out.replace(/@everyone(?![\\w])/g, '@[everyone](all:all)');
  return out;
}

function renderBody(body: string) {
  if (!body) return null;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_TOKEN.source, 'gi');
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    const isAll = m[2] === 'all';
    parts.push(
      <span
        key={`${m.index}-${m[3]}`}
        className={cn(
          'font-semibold px-1.5 py-0.5 rounded-md',
          isAll ? 'bg-accent-200 text-brand-900' : 'bg-accent-100 text-brand-800',
        )}
      >
        @{m[1]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}

/** Detect an in-progress @query just before the caret. */
function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s([{])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] || '';
  const start = before.length - query.length - 1;
  return { start, query };
}

/** Highlight confirmed @mentions in the composer (overlay; keeps caret alignment). */
function renderComposerHighlights(text: string, mentions: MentionRef[]) {
  if (!text) return null;
  type Range = { start: number; end: number; mention: MentionRef };
  const ranges: Range[] = [];
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length);
  for (const m of ordered) {
    const token = `@${m.name}`;
    let from = 0;
    while (from < text.length) {
      const i = text.indexOf(token, from);
      if (i === -1) break;
      const end = i + token.length;
      const after = text[end];
      if (after && /\w/.test(after)) {
        from = i + 1;
        continue;
      }
      const overlaps = ranges.some((r) => i < r.end && end > r.start);
      if (!overlaps) ranges.push({ start: i, end, mention: m });
      from = end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let last = 0;
  ranges.forEach((r, idx) => {
    if (r.start > last) parts.push(text.slice(last, r.start));
    // No padding / font-weight change — keeps overlay aligned with the textarea.
    parts.push(
      <span
        key={`${r.start}-${idx}`}
        className={cn(
          'rounded-sm',
          r.mention.type === 'all'
            ? 'bg-accent-200 text-brand-900'
            : 'bg-accent-100 text-brand-800',
        )}
      >
        {text.slice(r.start, r.end)}
      </span>
    );
    last = r.end;
  });
  if (last < text.length) parts.push(text.slice(last));
  // Trailing newline needs a space so the mirror keeps the same height as the textarea.
  if (text.endsWith('\n')) parts.push('\u200b');
  return parts;
}

/**
 * Reactions arrive two ways: grouped from a toggle/broadcast (`reactionSummary`),
 * or as raw rows on the message when the transcript is loaded. Normalise both to
 * the grouped shape the bar renders, marking which ones are the viewer's.
 */
function groupReactions(msg: any, viewerKey: string) {
  if (Array.isArray(msg?.reactionSummary)) {
    return msg.reactionSummary.map((r: any) => ({
      ...r,
      reactedByMe: r.reactedByMe ?? false,
    }));
  }
  const rows: any[] = Array.isArray(msg?.reactions) ? msg.reactions : [];
  if (!rows.length) return [];
  const byEmoji = new Map<string, { emoji: string; count: number; reactedByMe: boolean }>();
  for (const r of rows) {
    const entry = byEmoji.get(r.emoji) || { emoji: r.emoji, count: 0, reactedByMe: false };
    entry.count += 1;
    if (viewerKey && r.memberKey === viewerKey) entry.reactedByMe = true;
    byEmoji.set(r.emoji, entry);
  }
  return [...byEmoji.values()];
}

function HeaderIcon({
  label, active, onClick, children,
}: { label: string; active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-xl border transition-colors',
        active
          ? 'bg-brand-50 border-brand-200 text-brand-800'
          : 'text-gray-500 border-gray-200 bg-white hover:bg-gray-50',
      )}
    >
      {children}
    </button>
  );
}

function attachmentKind(mime?: string, kind?: string) {
  if (kind === 'audio' || (mime || '').startsWith('audio/')) return 'audio';
  if (kind === 'image' || (mime || '').startsWith('image/')) return 'image';
  return 'file';
}

type MessagesAppProps = {
  roomId?: string;
  /** When true, hide Back-to-CRM (portal embeds its own nav). */
  portalMode?: boolean;
  apiBase?: string; // default /messages for CRM; portal uses /portal/messages
  token?: string | null;
};

export default function MessagesApp({
  roomId: initialRoomId,
  portalMode = false,
  apiBase = '/messages',
  token = null,
}: MessagesAppProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const portalContactId = usePortalStore((s) => s.contact?.id);
  const { brandName, primaryColor, logoUrl } = useBranding();
  const isAdmin = user?.role?.key === 'super_admin' || user?.role?.key === 'admin'
    || !!user?.role?.permissions?.['admin.access'];

  const [activeRoomId, setActiveRoomId] = useState<string | undefined>(initialRoomId);
  const [unreadsOnly, setUnreadsOnly] = useState(false);
  const [roomSearch, setRoomSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [mentionRefs, setMentionRefs] = useState<MentionRef[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState('');
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [pendingFiles, setPendingFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showAddPeople, setShowAddPeople] = useState(false);
  const [addPeopleTab, setAddPeopleTab] = useState<'team' | 'client'>('team');
  const [peopleSearch, setPeopleSearch] = useState('');
  const [composeMode, setComposeMode] = useState<null | 'dm' | 'group'>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [pickedUserIds, setPickedUserIds] = useState<string[]>([]);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [typingName, setTypingName] = useState<string | null>(null);
  // ─── A–D feature state ──────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [panel, setPanel] = useState<null | 'search' | 'pinned' | 'files' | 'settings'>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [taskForMessage, setTaskForMessage] = useState<any | null>(null);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  // Overrides the lastSeenAt that came with the room payload, for people who go
  // offline while this session is open.
  const [lastSeenById, setLastSeenById] = useState<Record<string, string>>({});
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedDraftFor = useRef<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState<Record<'dms' | 'groups' | 'clients', boolean>>(() => {
    if (typeof window === 'undefined') return { dms: true, groups: true, clients: true };
    try {
      const raw = localStorage.getItem('messages.sidebarSections');
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          dms: parsed.dms !== false,
          groups: parsed.groups !== false,
          clients: parsed.clients !== false,
        };
      }
    } catch { /* ignore */ }
    return { dms: true, groups: true, clients: true };
  });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerHighlightRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setActiveRoomId(initialRoomId);
  }, [initialRoomId]);

  const authToken = token || (typeof window !== 'undefined' ? localStorage.getItem('access_token') : null);

  // Portal sessions use a different JWT than the CRM axios interceptor.
  const request = useCallback(async (
    method: 'get' | 'post' | 'delete' | 'patch' | 'put',
    url: string,
    body?: any,
  ) => {
    if (portalMode && authToken) {
      const res = await fetch(`/api${url}`, {
        method: method.toUpperCase(),
        headers: {
          Authorization: `Bearer ${authToken}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(data.message || 'Request failed');
        err.response = { data };
        throw err;
      }
      return data;
    }
    if (method === 'get') return api.get(url).then((r) => r.data);
    if (method === 'delete') return api.delete(url).then((r) => r.data);
    if (method === 'patch') return api.patch(url, body).then((r) => r.data);
    if (method === 'put') return api.put(url, body).then((r) => r.data);
    return api.post(url, body).then((r) => r.data);
  }, [portalMode, authToken]);

  const { data: rooms = [], isLoading: roomsLoading } = useQuery({
    queryKey: ['message-rooms', apiBase, statusFilter],
    queryFn: () => request('get', `${apiBase}/rooms?status=${statusFilter}`),
    refetchInterval: 60_000,
  });

  const unreadTotal = (rooms as any[]).reduce((sum, r) => sum + (r.unread || 0), 0);

  // Keep the browser tab title meaningful with unread chat count.
  // (Providers.tsx sets a base title; we override it only on the Messages screen.)
  useEffect(() => {
    if (!brandName) return;
    const suffix = portalMode ? 'Client Portal' : 'Agency Operations Platform';
    document.title = unreadTotal > 0
      ? `${brandName} — ${suffix} (${unreadTotal} unread) — Messages`
      : `${brandName} — ${suffix} — Messages`;
  }, [brandName, portalMode, unreadTotal]);

  const filteredRooms = useMemo(() => {
    let list = rooms as any[];
    if (unreadsOnly) list = list.filter((r) => (r.unread || 0) > 0);
    if (roomSearch.trim()) {
      const q = roomSearch.trim().toLowerCase();
      list = list.filter((r) =>
        (r.name || '').toLowerCase().includes(q)
        || (r.client?.name || '').toLowerCase().includes(q)
        || (r.peer?.name || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [rooms, unreadsOnly, roomSearch]);

  const roomsBySection = useMemo(() => {
    const dms: any[] = [];
    const groups: any[] = [];
    const clients: any[] = [];
    for (const r of filteredRooms) {
      const t = r.roomType || 'client';
      if (t === 'dm') dms.push(r);
      else if (t === 'group') groups.push(r);
      else clients.push(r);
    }
    return { dms, groups, clients };
  }, [filteredRooms]);

  const activeRoom = (rooms as any[]).find((r) => r.id === activeRoomId);
  const canManageMembers = !portalMode && (
    isAdmin
    || activeRoom?.role === 'admin'
  ) && activeRoom?.roomType !== 'dm';

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['message-thread', apiBase, activeRoomId],
    queryFn: () => request('get', `${apiBase}/rooms/${activeRoomId}/messages`),
    enabled: !!activeRoomId,
    // Safety net if the socket misses an event (reconnect lag, missed room:join).
    refetchInterval: activeRoomId ? 8_000 : false,
  });

  const { data: members = [] } = useQuery({
    queryKey: ['message-members', apiBase, activeRoomId],
    queryFn: () => request('get', `${apiBase}/rooms/${activeRoomId}/members`),
    enabled: !!activeRoomId && (showMembers || showAddPeople || mentionOpen),
  });

  const { data: mentionCandidates = [] } = useQuery({
    queryKey: ['message-mentions', apiBase, activeRoomId],
    queryFn: () => request('get', `${apiBase}/rooms/${activeRoomId}/mentions`),
    enabled: !!activeRoomId,
  });

  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users-assignable-messages'],
    queryFn: () => api.get('/users/assignable').then((r) => r.data || []),
    enabled: !portalMode && (!!composeMode || showAddPeople),
  });

  const { data: clientDetail } = useQuery({
    queryKey: ['client-detail-messages', activeRoom?.clientId],
    queryFn: () => api.get(`/clients/${activeRoom.clientId}`).then((r) => r.data),
    enabled: !portalMode && isAdmin && showAddPeople && !!activeRoom?.clientId
      && activeRoom?.roomType === 'client',
  });
  const clientContacts = clientDetail?.contacts || [];
  const peopleForPicker = useMemo(
    () => (assignableUsers as any[]).filter((u) => u.id !== user?.id),
    [assignableUsers, user?.id],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeRoomId]);

  const patchRoomUnread = useCallback((roomId: string, unread: number, lastMessage?: any) => {
    // setQueryData needs the exact key, and the key now carries the sidebar's
    // Active/Inactive filter — so patch every cached variant rather than only
    // the one currently on screen.
    qc.setQueriesData({ queryKey: ['message-rooms', apiBase] }, (prev: any) => {
      if (!Array.isArray(prev)) return prev;
      return prev.map((r: any) => (
        r.id === roomId
          ? { ...r, unread, ...(lastMessage ? { lastMessage } : {}) }
          : r
      ));
    });
  }, [qc, apiBase]);

  const markRoomRead = useCallback(async (roomId: string, lastMessage?: any) => {
    // Optimistic: never show a badge for the open conversation.
    patchRoomUnread(roomId, 0, lastMessage);
    try {
      await request('post', `${apiBase}/rooms/${roomId}/read`, {});
      patchRoomUnread(roomId, 0, lastMessage);
    } catch {
      // Keep optimistic clear; next rooms refetch will reconcile.
    }
  }, [request, apiBase, patchRoomUnread]);

  useEffect(() => {
    if (!activeRoomId || !authToken) return;
    const sock = getMessagesSocket(authToken);
    const roomId = activeRoomId;

    const joinRoom = () => {
      sock.emit('room:join', { roomId }, (ack: any) => {
        if (ack && ack.ok === false) {
          // Access failed — still keep REST polling below as a fallback.
          console.warn('[messages] room:join failed', ack.message);
        } else {
          // Socket join also marks read server-side; keep sidebar in sync.
          patchRoomUnread(roomId, 0);
        }
      });
    };

    const onNew = (msg: any) => {
      const msgRoomId = msg?.roomId || msg?.dataValues?.roomId;
      if (msgRoomId && msgRoomId !== roomId) {
        qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
        return;
      }
      qc.setQueryData(['message-thread', apiBase, roomId], (prev: any) => {
        const list = Array.isArray(prev) ? prev : [];
        if (list.some((m: any) => m.id === msg.id)) return list;
        return [...list, msg];
      });
      // User is already viewing this room — mark read so the badge never sticks.
      void markRoomRead(roomId, msg);
    };
    const onTyping = (p: any) => {
      if (p.roomId !== roomId) return;
      if (p.userId && p.userId === user?.id) return;
      if (p.contactId && p.contactId === portalContactId) return;
      setTypingName(p.isTyping ? p.name : null);
    };

    // An edit, a delete or a pin replaces the message in place rather than
    // refetching the page — the transcript must not jump under the reader.
    const onUpdated = (msg: any) => {
      if (msg?.roomId && msg.roomId !== roomId) return;
      qc.setQueryData(['message-thread', apiBase, roomId], (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((m: any) => (m.id === msg.id ? { ...m, ...msg } : m));
      });
      qc.invalidateQueries({ queryKey: ['message-pinned', apiBase, roomId] });
    };

    const onReactions = ({ messageId, reactions }: any) => {
      qc.setQueryData(['message-thread', apiBase, roomId], (prev: any) => {
        if (!Array.isArray(prev)) return prev;
        return prev.map((m: any) => (m.id === messageId ? { ...m, reactionSummary: reactions } : m));
      });
    };

    const onRoomUpdated = () => {
      qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
    };

    const onPresenceList = ({ online }: any) => setOnlineIds(Array.isArray(online) ? online : []);
    const onOnline = ({ userId }: any) => setOnlineIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    const onOffline = ({ userId, lastSeenAt }: any) => {
      setOnlineIds((prev) => prev.filter((id) => id !== userId));
      // The server sends the moment they dropped, so the header can switch
      // straight to "last seen just now" instead of showing whatever stale
      // timestamp came down with the room payload.
      if (lastSeenAt) setLastSeenById((prev) => ({ ...prev, [userId]: lastSeenAt }));
    };

    /**
     * Ask who is online, rather than only waiting to be told.
     *
     * The server pushes `presence:list` exactly once, the instant a socket
     * connects. This effect re-runs whenever the open room changes, so by the
     * time these listeners attach that push has usually already happened and is
     * gone — leaving onlineIds empty and every DM reading "Direct message" even
     * with the other person actively typing. Pulling it on attach (and again on
     * every reconnect) makes the state correct regardless of ordering.
     */
    const pullPresence = () => {
      sock.emit('presence:get', {}, (res: any) => {
        if (Array.isArray(res?.online)) setOnlineIds(res.online);
      });
    };
    pullPresence();

    const onConnect = () => { joinRoom(); pullPresence(); };
    sock.on('connect', onConnect);
    sock.on('message:new', onNew);
    sock.on('message:updated', onUpdated);
    sock.on('message:reactions', onReactions);
    sock.on('room:updated', onRoomUpdated);
    sock.on('typing', onTyping);
    sock.on('presence:list', onPresenceList);
    sock.on('presence:online', onOnline);
    sock.on('presence:offline', onOffline);
    if (sock.connected) joinRoom();
    else sock.connect();

    void markRoomRead(roomId);

    return () => {
      sock.emit('room:leave', { roomId });
      sock.off('connect', onConnect);
      sock.off('message:new', onNew);
      sock.off('message:updated', onUpdated);
      sock.off('message:reactions', onReactions);
      sock.off('room:updated', onRoomUpdated);
      sock.off('typing', onTyping);
      sock.off('presence:list', onPresenceList);
      sock.off('presence:online', onOnline);
      sock.off('presence:offline', onOffline);
    };
  }, [activeRoomId, authToken, apiBase, qc, user?.id, portalContactId, markRoomRead, patchRoomUnread]);

  // ─── Ctrl/Cmd+K quick switcher ──────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const permalinkHandled = useRef(false);

  const emitTyping = useCallback((isTyping: boolean) => {
    if (!activeRoomId || !authToken) return;
    getMessagesSocket(authToken).emit('typing', { roomId: activeRoomId, isTyping });
  }, [activeRoomId, authToken]);

  function selectRoom(id: string) {
    setActiveRoomId(id);
    setShowMembers(false);
    setShowAddPeople(false);
    setPanel(null);
    setThreadParentId(null);
    setEditingId(null);
    if (!portalMode) router.replace(`/messages/${id}`);
    else router.replace(`/portal/messages?room=${id}`);
  }

  // ─── Message-level actions ──────────────────────────────────────────────────

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    // Optimistic through the socket when it's up; the server broadcasts the
    // authoritative grouped counts straight back to everyone including us.
    if (authToken && activeRoomId) {
      const sock = getMessagesSocket(authToken);
      if (sock.connected) {
        sock.emit('reaction:toggle', { roomId: activeRoomId, messageId, emoji });
        return;
      }
    }
    request('post', `${apiBase}/rooms/${activeRoomId}/messages/${messageId}/reactions`, { emoji })
      .then((reactions) => {
        qc.setQueryData(['message-thread', apiBase, activeRoomId], (prev: any) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((m: any) => (m.id === messageId ? { ...m, reactionSummary: reactions } : m));
        });
      })
      .catch((e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not react.'));
  }, [authToken, activeRoomId, apiBase, request, qc]);

  const saveEdit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      request('patch', `${apiBase}/rooms/${activeRoomId}/messages/${id}`, { body }),
    onSuccess: () => {
      setEditingId(null);
      setEditDraft('');
      qc.invalidateQueries({ queryKey: ['message-thread', apiBase, activeRoomId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not save the edit.'),
  });

  const deleteMessage = useMutation({
    mutationFn: (id: string) => request('delete', `${apiBase}/rooms/${activeRoomId}/messages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-thread', apiBase, activeRoomId] }),
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not delete the message.'),
  });

  const togglePin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      request('post', `${apiBase}/rooms/${activeRoomId}/messages/${id}/pin`, { pinned }),
    onSuccess: (_d, v) => {
      toast.success(v.pinned ? 'Pinned to this channel.' : 'Unpinned.');
      qc.invalidateQueries({ queryKey: ['message-thread', apiBase, activeRoomId] });
      qc.invalidateQueries({ queryKey: ['message-pinned', apiBase, activeRoomId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not pin the message.'),
  });

  /** Scroll a message into view and flash it — used by search, pins and threads. */
  const jumpToMessage = useCallback((messageId: string) => {
    const el = messageRefs.current[messageId];
    if (!el) {
      toast.message('That message is further back in the conversation — scroll up to load it.');
      return;
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((cur) => (cur === messageId ? null : cur)), 2000);
  }, []);

  /**
   * The first message the viewer hasn't seen, for the "Jump to unread" pill.
   *
   * Captured from the room's unread count as the transcript loads: the count is
   * cleared the moment the room is opened (that is the point of marking read),
   * so reading it live would make the pill vanish immediately.
   */
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const unreadAnchorFor = useRef<string | null>(null);
  useEffect(() => {
    if (!activeRoomId) return;
    if (unreadAnchorFor.current === activeRoomId) return;
    const list = messages as any[];
    if (!list.length) return;
    unreadAnchorFor.current = activeRoomId;
    const unread = activeRoom?.unread || 0;
    // Below a handful the reader can just look up; a pill would be clutter.
    if (unread < 5 || unread >= list.length) {
      setFirstUnreadId(null);
      return;
    }
    setFirstUnreadId(list[list.length - unread]?.id || null);
  }, [messages, activeRoomId, activeRoom?.unread]);

  // Identifies the viewer inside a reaction row, matching the server's memberKey.
  const viewerKey = portalMode
    ? (portalContactId ? `contact:${portalContactId}` : '')
    : (user?.id ? `user:${user.id}` : '');
  const reactionsFor = useCallback(
    (msg: any) => groupReactions(msg, viewerKey),
    [viewerKey],
  );

  // ─── Permalinks ─────────────────────────────────────────────────────────────
  // Landing on ?m=<id> scrolls to and flashes that message once the transcript
  // has rendered. The param is then stripped so a refresh doesn't re-jump.
  useEffect(() => {
    if (permalinkHandled.current || !activeRoomId) return;
    if (!(messages as any[]).length) return;
    const target = new URLSearchParams(window.location.search).get('m');
    if (!target) return;
    permalinkHandled.current = true;
    setTimeout(() => {
      jumpToMessage(target);
      const url = new URL(window.location.href);
      url.searchParams.delete('m');
      window.history.replaceState({}, '', url.toString());
    }, 250);
  }, [messages, activeRoomId, jumpToMessage]);

  async function uploadAttachment(file: File, kindHint?: string) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', 'chat');
    // Portal contacts cannot use CRM /media — employees upload; portal voice/files
    // go through the same media route only when CRM token is present.
    if (portalMode) {
      const res = await fetch(`/api${apiBase}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.message || data.error || 'Upload failed'), { response: { data } });
      const url = data?.url || data?.fileUrl;
      const mime = file.type || data?.mimeType || '';
      return { url, name: file.name, mime, size: file.size, kind: attachmentKind(mime, kindHint) };
    }
    const res = await api.post('/media/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    const url = res.data?.url || res.data?.fileUrl;
    const mime = file.type || res.data?.mimeType || '';
    return {
      url,
      name: file.name,
      mime,
      size: file.size,
      kind: attachmentKind(mime, kindHint),
    };
  }

  const sendMutation = useMutation({
    mutationFn: async () => {
      const attachments = [...pendingFiles];
      if (!draft.trim() && !attachments.length) throw new Error('Message cannot be empty.');
      // Resolve @Name → wire tokens; IDs never appear in the composer.
      const fromPicker = mentionRefs;
      const fromCandidates = (mentionCandidates as MentionRef[]).filter((c) =>
        draft.includes(`@${c.name}`)
      );
      const merged = [...fromPicker];
      for (const c of fromCandidates) {
        if (!merged.some((m) => m.id === c.id && m.type === c.type)) merged.push(c);
      }
      if (/\b@everyone\b|\b@all\b/i.test(draft) || draft.includes('@everyone') || draft.includes('@all')) {
        if (!merged.some((m) => m.type === 'all')) merged.push(EVERYONE_MENTION);
      }
      const body = encodeMentionsForSend(draft.trim(), merged);

      // Prefer socket, but never hang Send if the ack never returns — fall back to REST.
      if (authToken && activeRoomId) {
        const sock = getMessagesSocket(authToken);
        if (sock.connected) {
          try {
            const result: any = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('socket-timeout')), 4000);
              sock.emit('message:send', { roomId: activeRoomId, body, attachments }, (ack: any) => {
                clearTimeout(timer);
                resolve(ack);
              });
            });
            if (result?.ok) return result.message;
            if (result?.ok === false) throw new Error(result.message || 'Failed to send.');
          } catch (err: any) {
            if (err?.message && err.message !== 'socket-timeout') throw err;
            // timeout → REST below
          }
        }
      }

      return request('post', `${apiBase}/rooms/${activeRoomId}/messages`, {
        body,
        attachments,
      });
    },
    onSuccess: () => {
      setDraft('');
      setMentionRefs([]);
      setPendingFiles([]);
      emitTyping(false);
      if (composerRef.current) composerRef.current.style.height = '44px';
      qc.invalidateQueries({ queryKey: ['message-thread', apiBase, activeRoomId] });
      qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
    },
    onError: (e: any) => toast.error(e?.message || e?.response?.data?.message || 'Send failed.'),
  });

  // A deactivated channel, or an announcement channel you don't admin, is
  // read-only. The server enforces this too — this only keeps the UI honest.
  const canPost = activeRoom ? activeRoom.canPost !== false : true;

  const canSend = canPost
    && (!!draft.trim() || pendingFiles.length > 0)
    && !uploading && !sendMutation.isPending;

  // ─── Drafts ─────────────────────────────────────────────────────────────────
  // Load the stored draft once per room, then push changes back on a debounce so
  // switching rooms mid-sentence doesn't lose what was typed.
  useEffect(() => {
    if (!activeRoom || loadedDraftFor.current === activeRoom.id) return;
    loadedDraftFor.current = activeRoom.id;
    setDraft(activeRoom.draft || '');
    setMentionRefs([]);
  }, [activeRoom]);

  useEffect(() => {
    if (!activeRoomId || loadedDraftFor.current !== activeRoomId) return undefined;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    const value = draft;
    draftSaveTimer.current = setTimeout(() => {
      request('put', `${apiBase}/rooms/${activeRoomId}/draft`, { draft: value }).catch(() => {
        // A lost draft is a minor annoyance, never worth an error toast.
      });
    }, 900);
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [draft, activeRoomId, apiBase, request]);

  async function onPickFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(Array.from(files).map((f) => uploadAttachment(f)));
      setPendingFiles((prev) => [...prev, ...uploaded]);
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        setUploading(true);
        try {
          const att = await uploadAttachment(file, 'audio');
          setPendingFiles((prev) => [...prev, att]);
        } catch (err: any) {
          toast.error(uploadErrorMessage(err));
        } finally {
          setUploading(false);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      toast.error('Microphone access is required for voice messages.');
    }
  }

  function syncMentionPicker(text: string, caret: number) {
    const active = activeMentionQuery(text, caret);
    if (!active) {
      setMentionOpen(false);
      setMentionFilter('');
      setMentionAt(null);
      setMentionHighlight(0);
      return;
    }
    setMentionOpen(true);
    setMentionFilter(active.query);
    setMentionAt(active.start);
    setMentionHighlight(0);
  }

  function pruneMentionRefs(text: string) {
    setMentionRefs((prev) => prev.filter((m) => {
      const re = new RegExp(`@${escapeRegExp(m.name)}(?![\\w])`);
      return re.test(text);
    }));
  }

  function insertMention(c: { id: string; type: string; name: string }) {
    setMentionRefs((prev) => (
      prev.some((m) => m.id === c.id && m.type === c.type) ? prev : [...prev, c]
    ));
    const el = composerRef.current;
    const caret = el?.selectionStart ?? draft.length;
    const active = mentionAt != null
      ? { start: mentionAt, query: mentionFilter }
      : activeMentionQuery(draft, caret);
    const start = active?.start ?? draft.length;
    const queryLen = active ? 1 + active.query.length : 0;
    const end = start + queryLen;
    const next = `${draft.slice(0, start)}@${c.name} ${draft.slice(Math.max(end, start))}`;
    setDraft(next);
    setMentionOpen(false);
    setMentionFilter('');
    setMentionAt(null);
    setMentionHighlight(0);
    requestAnimationFrame(() => {
      const pos = start + c.name.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  }

  function syncComposerScroll() {
    const ta = composerRef.current;
    const hi = composerHighlightRef.current;
    if (ta && hi) hi.scrollTop = ta.scrollTop;
  }

  const mentionOptions = useMemo(() => {
    const q = mentionFilter.trim().toLowerCase();
    const people = (mentionCandidates as any[]).filter((c) =>
      !q || c.name.toLowerCase().includes(q)
    );
    const everyoneMatches = !q
      || 'everyone'.includes(q)
      || 'all'.includes(q)
      || q === 'everyone'
      || q === 'all';
    const options: any[] = [];
    if (everyoneMatches) {
      options.push({
        ...EVERYONE_MENTION,
        avatarUrl: null,
        label: 'Notify everyone in this room',
      });
    }
    return [...options, ...people];
  }, [mentionCandidates, mentionFilter]);

  const memberUserIds = useMemo(
    () => new Set((members as any[]).filter((m) => m.userId).map((m) => m.userId)),
    [members],
  );
  const memberContactIds = useMemo(
    () => new Set((members as any[]).filter((m) => m.contactId).map((m) => m.contactId)),
    [members],
  );
  const usersToAdd = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    return (assignableUsers as any[])
      .filter((u) => !memberUserIds.has(u.id))
      .filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [assignableUsers, memberUserIds, peopleSearch]);

  const contactsToAdd = useMemo(() => {
    const q = peopleSearch.trim().toLowerCase();
    return (Array.isArray(clientContacts) ? clientContacts : [])
      .filter((c: any) => c.portalAccess && !memberContactIds.has(c.id))
      .filter((c: any) => !q || (c.name || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q));
  }, [clientContacts, memberContactIds, peopleSearch]);

  // How many of the client's contacts have portal access at all — the "Add
  // people" empty state has to tell these two cases apart, because "enable
  // portal access first" is actively wrong when the reason the list is empty is
  // that everyone eligible is already in the room.
  const portalEnabledContacts = useMemo(
    () => (Array.isArray(clientContacts) ? clientContacts : []).filter((c: any) => c.portalAccess),
    [clientContacts],
  );

  const clientMembers = useMemo(
    () => (members as any[]).filter((m) => m.memberType === 'contact'),
    [members],
  );

  /** Client contacts first, so a client in the room is never below the fold. */
  const sortedMembers = useMemo(() => {
    const list = [...(members as any[])];
    list.sort((a, b) => {
      const aClient = a.memberType === 'contact' ? 0 : 1;
      const bClient = b.memberType === 'contact' ? 0 : 1;
      return aClient - bClient;
    });
    return list;
  }, [members]);

  const addMember = useMutation({
    mutationFn: (payload: { userId?: string; contactId?: string }) =>
      request('post', `${apiBase}/rooms/${activeRoomId}/members`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-members', apiBase, activeRoomId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not add member.'),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      request('delete', `${apiBase}/rooms/${activeRoomId}/members/${memberId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-members', apiBase, activeRoomId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not remove member.'),
  });

  const openDm = useMutation({
    mutationFn: (userId: string) => request('post', `${apiBase}/dms`, { userId }),
    onSuccess: (room: any) => {
      qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
      setComposeMode(null);
      selectRoom(room.id);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not open DM.'),
  });

  const createGroup = useMutation({
    mutationFn: () => request('post', `${apiBase}/rooms`, {
      name: newGroupName.trim(),
      userIds: pickedUserIds,
    }),
    onSuccess: (room: any) => {
      qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
      setComposeMode(null);
      setNewGroupName('');
      setPickedUserIds([]);
      selectRoom(room.id);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not create room.'),
  });

  function togglePickedUser(id: string) {
    setPickedUserIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function roomTitle(room: any) {
    if (room.roomType === 'dm') return room.isSelf ? 'You' : (room.peer?.name || room.name);
    return room.client?.name || room.name;
  }

  /**
   * "Active now" while they hold a socket, else "last seen …" from the stored
   * timestamp — the WhatsApp convention.
   *
   * Returns null when the person has never been seen, so the caller falls back
   * to a neutral label rather than printing "last seen never".
   */
  function presenceLabel(isOnline: boolean, lastSeenAt?: string | null): string | null {
    if (isOnline) return 'Active now';
    if (!lastSeenAt) return null;
    const seen = new Date(lastSeenAt);
    if (Number.isNaN(seen.getTime())) return null;

    const mins = Math.floor((Date.now() - seen.getTime()) / 60000);
    // Under a minute reads as still-here, which is what a brief drop actually is.
    if (mins < 1) return 'Active now';
    if (mins < 60) return `last seen ${mins} min ago`;

    const time = seen.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    if (seen >= startOfToday) return `last seen today at ${time}`;

    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    if (seen >= startOfYesterday) return `last seen yesterday at ${time}`;

    return `last seen ${seen.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${time}`;
  }

  function RoomIcon({ room, active }: { room: any; active: boolean }) {
    const cls = cn('w-4 h-4 shrink-0', active ? 'text-white/90' : 'text-gray-400');
    if (room.roomType === 'dm') {
      // Presence dot on the icon itself — no extra row, no layout shift.
      // Skipped for "Message yourself" — you're always online with yourself.
      const online = !room.isSelf && !!room.peer?.id && onlineIds.includes(room.peer.id);
      return (
        <span className="relative shrink-0">
          <MessageSquare className={cls} />
          {online && (
            <span
              className="absolute -right-0.5 -bottom-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white"
              aria-label="Online"
            />
          )}
        </span>
      );
    }
    if (room.roomType === 'group') return <Hash className={cls} />;
    return <Building2 className={cls} />;
  }

  function renderRoomButton(room: any) {
    const active = room.id === activeRoomId;
    const title = roomTitle(room);
    const preview = room.lastMessage?.body
      ? String(room.lastMessage.body).replace(MENTION_TOKEN, '@$1')
      : room.roomType === 'dm'
        ? 'Start the conversation'
        : 'No messages yet';
    return (
      <button
        key={room.id}
        type="button"
        onClick={() => selectRoom(room.id)}
        className={cn(
          'w-full flex items-center gap-3 mx-auto px-2.5 py-2.5 text-left rounded-xl transition-all duration-200',
          active
            ? 'text-white shadow-md scale-[1.01]'
            : 'text-gray-800 hover:bg-white/80 hover:shadow-sm',
        )}
        style={active ? { background: `linear-gradient(135deg, ${primaryColor}, ${BRAND.primaryLight})` } : undefined}
      >
        {room.roomType === 'dm' ? (
          <Avatar name={title} src={room.peer?.avatarUrl} size="sm" className={cn(active && 'ring-2 ring-accent-400 ring-offset-1')} />
        ) : (
          <div
            className={cn(
              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
              active ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-700',
            )}
          >
            <RoomIcon room={room} active={active} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm truncate', (room.unread || 0) > 0 && !active ? 'font-semibold text-gray-900' : 'font-medium')}>
            {title}
          </p>
          <p className={cn('text-[11px] truncate mt-0.5', active ? 'text-white/75' : 'text-gray-400')}>
            {preview}
          </p>
        </div>
        {(room.unread || 0) > 0 && !active && (
          <span
            className="text-[10px] font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center shrink-0 text-white"
            style={{ backgroundColor: primaryColor }}
          >
            {room.unread > 99 ? '99+' : room.unread}
          </span>
        )}
      </button>
    );
  }

  function toggleSection(key: 'dms' | 'groups' | 'clients') {
    setSectionOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('messages.sidebarSections', JSON.stringify(next));
      } catch { /* ignore */ }
      return next;
    });
  }

  function sectionHeader(
    key: 'dms' | 'groups' | 'clients',
    label: string,
    rooms: any[],
  ) {
    const open = sectionOpen[key];
    const unreadTotal = rooms.reduce((sum, r) => sum + (r.unread || 0), 0);
    return (
      <button
        type="button"
        onClick={() => toggleSection(key)}
        aria-expanded={open}
        className="w-full flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-left group"
      >
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-brand-700/45 shrink-0 transition-transform duration-200',
            !open && '-rotate-90',
          )}
        />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-700/50 group-hover:text-brand-700/70">
          {label}
        </span>
        <span className="text-[10px] font-semibold text-brand-700/35 tabular-nums">
          {rooms.length}
        </span>
        {!open && unreadTotal > 0 && (
          <span
            className="ml-auto text-[10px] font-bold min-w-[1.15rem] h-[1.15rem] px-1 rounded-full flex items-center justify-center text-white"
            style={{ backgroundColor: primaryColor }}
          >
            {unreadTotal > 99 ? '99+' : unreadTotal}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="h-full flex bg-slate-100">
      {/* Sub-nav */}
      <aside className={cn(
        'w-full sm:w-[300px] lg:w-[320px] shrink-0 flex flex-col border-r border-brand-900/10',
        'bg-gradient-to-b from-slate-50 via-white to-brand-50/40',
        activeRoomId && 'hidden sm:flex',
      )}>
        <div
          className="relative px-3.5 pt-3.5 pb-3.5 overflow-hidden"
          style={{ backgroundColor: BRAND.primaryDark }}
        >
          {/* Soft depth — not a loud multi-stop gradient */}
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background: `radial-gradient(120% 90% at 0% 0%, ${BRAND.primaryLight}55 0%, transparent 55%), linear-gradient(180deg, ${primaryColor}33 0%, transparent 70%)`,
            }}
          />
          <div className="relative flex items-center gap-3 min-h-[44px]">
            {!portalMode && (
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/85 hover:text-white hover:bg-white/10 hover:border-white/20 transition-colors"
                title="Back to CRM"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-white tracking-[-0.01em] leading-none">
                Messages
              </p>
              <p className="mt-1 text-[11px] text-white/50 font-medium tracking-wide truncate">
                {portalMode ? 'Client conversations' : 'Direct, rooms & clients'}
              </p>
            </div>
            {(logoUrl || brandName) && (
              <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-white/10">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={brandName || 'Brand'}
                    className="h-7 w-auto max-w-[108px] object-contain brightness-0 invert opacity-95"
                  />
                ) : (
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/70 max-w-[96px] leading-snug text-right">
                    {brandName}
                  </span>
                )}
              </div>
            )}
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{ background: `linear-gradient(90deg, ${BRAND.accent}99, ${BRAND.accent}33 40%, transparent)` }}
          />
        </div>

        <div className="px-3 py-3 space-y-2 border-b border-gray-100/80">
          {!portalMode && (
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => { setComposeMode('dm'); setPickedUserIds([]); }}
                className={cn(
                  'text-xs font-semibold px-2 py-2 rounded-xl border inline-flex items-center justify-center gap-1.5 transition-all',
                  composeMode === 'dm'
                    ? 'bg-brand-700 border-brand-700 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-brand-200 hover:text-brand-800',
                )}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                New DM
              </button>
              <button
                type="button"
                onClick={() => { setComposeMode('group'); setNewGroupName(''); setPickedUserIds([]); }}
                className={cn(
                  'text-xs font-semibold px-2 py-2 rounded-xl border inline-flex items-center justify-center gap-1.5 transition-all',
                  composeMode === 'group'
                    ? 'bg-brand-700 border-brand-700 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-brand-200 hover:text-brand-800',
                )}
              >
                <Hash className="w-3.5 h-3.5" />
                New room
              </button>
            </div>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={roomSearch}
              onChange={(e) => setRoomSearch(e.target.value)}
              placeholder="Search conversations…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl bg-white/90 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setUnreadsOnly((v) => !v)}
            className={cn(
              'text-xs font-medium px-3 py-1.5 rounded-xl border w-full text-left transition-colors',
              unreadsOnly
                ? 'bg-accent-100 border-accent-200 text-brand-900'
                : 'bg-white/80 border-gray-200 text-gray-600 hover:bg-white',
            )}
          >
            {unreadsOnly ? '● Unreads only' : 'All conversations'}
          </button>

          {/* Retired channels are hidden by default but never gone — this is
              how you get back to one. */}
          {!portalMode && (
            <div className="flex gap-1 bg-white/70 border border-gray-200 p-0.5 rounded-xl">
              {([
                ['active', 'Active'],
                ['inactive', 'Inactive'],
                ['all', 'All'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    'flex-1 text-[11px] font-semibold py-1 rounded-lg transition-colors',
                    statusFilter === value
                      ? 'bg-brand-700 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {composeMode && !portalMode && (
          <div className="mx-3 mt-3 px-3 py-3 rounded-2xl border border-brand-100 bg-white shadow-sm space-y-2 max-h-64 overflow-y-auto animate-msg-in">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-brand-700/70">
                {composeMode === 'dm' ? 'Message a teammate' : 'Create a room'}
              </p>
              <button type="button" onClick={() => setComposeMode(null)} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {composeMode === 'group' && (
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Room name"
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-600/30"
              />
            )}
            <div className="space-y-1">
              {composeMode === 'dm' && user && (
                <button
                  type="button"
                  onClick={() => openDm.mutate(user.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm text-left transition-colors hover:bg-slate-50 text-gray-800 mb-1 border-b border-gray-100 pb-2.5"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="xs" />
                  <span className="truncate flex-1 font-medium">You</span>
                  <span className="text-[10px] font-semibold text-brand-700/60 bg-brand-50 px-1.5 py-0.5 rounded-md shrink-0">
                    Message yourself
                  </span>
                </button>
              )}
              {peopleForPicker.length === 0 && (
                <p className="text-xs text-gray-400 py-2">No teammates available.</p>
              )}
              {peopleForPicker.map((u: any) => {
                const selected = composeMode === 'dm' ? false : pickedUserIds.includes(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      if (composeMode === 'dm') openDm.mutate(u.id);
                      else togglePickedUser(u.id);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2 py-2 rounded-xl text-sm text-left transition-colors',
                      selected ? 'bg-brand-50 text-brand-900 ring-1 ring-brand-200' : 'hover:bg-slate-50 text-gray-800',
                    )}
                  >
                    <Avatar name={u.name} src={u.avatarUrl} size="xs" />
                    <span className="truncate flex-1 font-medium">{u.name}</span>
                    {composeMode === 'group' && selected && (
                      <span className="text-[10px] font-semibold text-accent-700 bg-accent-100 px-1.5 py-0.5 rounded-md">Added</span>
                    )}
                  </button>
                );
              })}
            </div>
            {composeMode === 'group' && (
              <button
                type="button"
                disabled={!newGroupName.trim() || createGroup.isPending}
                onClick={() => createGroup.mutate()}
                className="w-full text-xs font-bold text-brand-900 py-2.5 rounded-xl disabled:opacity-50 shadow-sm"
                style={{ backgroundColor: BRAND.accent }}
              >
                Create room
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2 py-1 scrollbar-hide">
          {roomsLoading && <p className="px-3 py-6 text-xs text-gray-400 text-center">Loading conversations…</p>}
          {!roomsLoading && filteredRooms.length === 0 && (
            <div className="mx-2 my-4 px-3 py-6 rounded-2xl border border-dashed border-brand-200 bg-white/60 text-center">
              <MessageSquare className="w-7 h-7 text-brand-300 mx-auto mb-2" />
              <p className="text-xs text-gray-500">
                {portalMode
                  ? 'No conversations yet.'
                  : 'Start a DM or create a room to get going.'}
              </p>
            </div>
          )}
          {roomsBySection.dms.length > 0 && (
            <div>
              {sectionHeader('dms', 'Direct messages', roomsBySection.dms)}
              {sectionOpen.dms && (
                <div className="space-y-0.5 px-1">{roomsBySection.dms.map(renderRoomButton)}</div>
              )}
            </div>
          )}
          {roomsBySection.groups.length > 0 && (
            <div>
              {sectionHeader('groups', 'Rooms', roomsBySection.groups)}
              {sectionOpen.groups && (
                <div className="space-y-0.5 px-1">{roomsBySection.groups.map(renderRoomButton)}</div>
              )}
            </div>
          )}
          {roomsBySection.clients.length > 0 && (
            <div>
              {sectionHeader('clients', 'Clients', roomsBySection.clients)}
              {sectionOpen.clients && (
                <div className="space-y-0.5 px-1">{roomsBySection.clients.map(renderRoomButton)}</div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main pane */}
      <main className={cn('flex-1 min-w-0 flex flex-col messages-canvas', !activeRoomId && 'hidden sm:flex')}>
        {!activeRoomId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 animate-msg-in">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg"
              style={{ background: `linear-gradient(145deg, ${primaryColor}, ${BRAND.primaryLight})` }}
            >
              <MessageSquare className="w-8 h-8 text-accent-400" />
            </div>
            <p className="text-lg font-semibold text-brand-900 tracking-tight">Your conversations</p>
            <p className="text-sm text-gray-500 mt-2 max-w-md leading-relaxed">
              Message teammates, spin up a room, or jump into a client channel. Pick a thread on the left — or start something new.
            </p>
            {!portalMode && (
              <div className="flex flex-wrap justify-center gap-2.5 mt-6">
                <button
                  type="button"
                  onClick={() => setComposeMode('dm')}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl text-brand-900 shadow-md hover:scale-[1.02] transition-transform"
                  style={{ backgroundColor: BRAND.accent }}
                >
                  New DM
                </button>
                <button
                  type="button"
                  onClick={() => setComposeMode('group')}
                  className="text-sm font-semibold px-4 py-2.5 rounded-xl text-white shadow-md hover:scale-[1.02] transition-transform"
                  style={{ backgroundColor: primaryColor }}
                >
                  New room
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Wraps on phones: the room title plus six actions cannot share one
                line, and unwrapped the title was crushed to "c… room" — the one
                thing that tells you which conversation you are in. The actions
                drop to a second row and the title keeps the first to itself. */}
            <header className="shrink-0 px-3 sm:px-4 py-2.5 sm:py-3.5 border-b border-brand-900/8 bg-white/80 backdrop-blur-md flex flex-wrap items-center gap-x-2 gap-y-2 sm:gap-3 shadow-sm">
              <button
                type="button"
                className="sm:hidden p-1.5 rounded-xl text-gray-500 hover:bg-brand-50"
                onClick={() => {
                  setActiveRoomId(undefined);
                  if (!portalMode) router.replace('/messages');
                  else router.replace('/portal/messages');
                }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              {activeRoom?.roomType === 'dm' && activeRoom.peer?.id && !portalMode ? (
                <button
                  type="button"
                  onClick={() => setProfileUserId(activeRoom.peer.id)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left rounded-xl -ml-1 pl-1 pr-2 py-1 hover:bg-brand-50/80 transition-colors group"
                  title="View profile"
                >
                  <Avatar
                    name={roomTitle(activeRoom)}
                    src={activeRoom.peer?.avatarUrl}
                    size="sm"
                    className="ring-2 ring-transparent group-hover:ring-accent-400 transition-all"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-900 truncate group-hover:text-brand-700">
                      {roomTitle(activeRoom)}
                    </p>
                    {/* This is the branch a real DM renders (peer known, staff
                        side), so the presence line has to live HERE — the other
                        variant below only covers rooms and the portal. */}
                    {(() => {
                      if (activeRoom.isSelf) {
                        return (
                          <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: BRAND.accent }} />
                            Message yourself
                          </p>
                        );
                      }
                      const peerId = activeRoom.peer?.id;
                      const isOnline = !!peerId && onlineIds.includes(peerId);
                      const seenAt = (peerId && lastSeenById[peerId]) || activeRoom.peer?.lastSeenAt;
                      const presence = presenceLabel(isOnline, seenAt);
                      return (
                        <p className="text-[11px] flex items-center gap-1.5">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: isOnline ? '#22c55e' : '#cbd5e1' }}
                          />
                          <span className={cn('truncate', isOnline ? 'text-emerald-600 font-medium' : 'text-gray-500')}>
                            {presence || 'Direct message'}
                          </span>
                        </p>
                      );
                    })()}
                  </div>
                </button>
              ) : (
                <>
                  {activeRoom?.roomType === 'dm' ? (
                    <Avatar name={roomTitle(activeRoom)} src={activeRoom.peer?.avatarUrl} size="sm" />
                  ) : (
                    <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 flex items-center justify-center">
                      {activeRoom?.roomType === 'group' ? <Hash className="w-4 h-4" /> : <Building2 className="w-4 h-4" />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-brand-900 truncate">
                      {activeRoom ? roomTitle(activeRoom) : 'Conversation'}
                    </p>
                    {(() => {
                      // WhatsApp-style presence on a DM: a green dot and
                      // "Active now" while they hold a socket, otherwise the
                      // persisted last-seen. Rooms keep their description.
                      const isDm = activeRoom?.roomType === 'dm';
                      const peerOnline = isDm && !activeRoom.isSelf && !!activeRoom.peer?.id && onlineIds.includes(activeRoom.peer.id);
                      const peerId = activeRoom?.peer?.id;
                      const seenAt = (peerId && lastSeenById[peerId]) || activeRoom?.peer?.lastSeenAt;
                      const presence = isDm ? presenceLabel(peerOnline, seenAt) : null;
                      return (
                        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                          <span
                            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: peerOnline ? '#22c55e' : (isDm ? '#cbd5e1' : BRAND.accent) }}
                          />
                          {activeRoom?.isSelf
                            ? 'Message yourself'
                            : isDm
                              ? (presence || 'Direct message')
                              : activeRoom?.description
                                || (activeRoom?.roomType === 'group' ? 'Custom room' : 'Client room')}
                        </p>
                      );
                    })()}
                  </div>
                </>
              )}
              <HeaderIcon
                label="Search messages"
                active={panel === 'search'}
                onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))}
              >
                <Search className="w-3.5 h-3.5" />
              </HeaderIcon>
              <HeaderIcon
                label="Pinned messages"
                active={panel === 'pinned'}
                onClick={() => setPanel((p) => (p === 'pinned' ? null : 'pinned'))}
              >
                <Pin className="w-3.5 h-3.5" />
              </HeaderIcon>
              <HeaderIcon
                label="Files"
                active={panel === 'files'}
                onClick={() => setPanel((p) => (p === 'files' ? null : 'files'))}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </HeaderIcon>
              <HeaderIcon
                label="Channel settings"
                active={panel === 'settings'}
                onClick={() => setPanel((p) => (p === 'settings' ? null : 'settings'))}
              >
                <Settings className="w-3.5 h-3.5" />
              </HeaderIcon>
              <button
                type="button"
                onClick={() => { setShowMembers((v) => !v); setShowAddPeople(false); }}
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors',
                  showMembers
                    ? 'bg-brand-50 border-brand-200 text-brand-800'
                    : 'text-gray-600 border-gray-200 bg-white hover:bg-gray-50',
                )}
              >
                <Users className="w-3.5 h-3.5" />
                People
              </button>
              {canManageMembers && (
                <button
                  type="button"
                  onClick={() => {
                    setShowAddPeople(true);
                    setShowMembers(false);
                    setPeopleSearch('');
                    setAddPeopleTab('team');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-900 px-3 py-2 rounded-xl shadow-sm hover:scale-[1.02] transition-transform"
                  style={{ backgroundColor: BRAND.accent }}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Add
                </button>
              )}
              {canManageMembers && !portalMode && (
                <HeaderIcon
                  label="Add a whole role or department"
                  active={showBulkAdd}
                  onClick={() => setShowBulkAdd(true)}
                >
                  <UsersRound className="w-3.5 h-3.5" />
                </HeaderIcon>
              )}
            </header>

            <div className="shrink-0 px-4 pt-2">
              <DesktopNotifyPrompt />
            </div>

            <RoomBanners room={activeRoom} />

            {showMembers && (
              <div className="shrink-0 border-b border-brand-100 bg-white/95 px-4 py-3 max-h-72 overflow-y-auto animate-msg-in">
                <div className="flex flex-wrap items-center justify-between mb-2 gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700/50">
                    In this room · {(members as any[]).length}
                    {clientMembers.length > 0 && (
                      <span className="ml-2 text-amber-700 normal-case tracking-normal font-semibold">
                        including {clientMembers.length} client {clientMembers.length === 1 ? 'contact' : 'contacts'}
                      </span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowMembers(false)}
                    className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1">
                  {/* Client contacts first. They are the reason the warning
                      banner exists, and burying them under the staff list (out
                      of view in a height-capped box) is how the room looked
                      internal when it wasn't. */}
                  {sortedMembers.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        'flex items-center gap-2.5 text-sm px-2.5 py-2 rounded-xl border transition-colors',
                        m.memberType === 'contact'
                          ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
                          : 'border-transparent hover:border-gray-100 hover:bg-slate-50',
                      )}
                    >
                      <Avatar name={m.user?.name || m.contact?.name} src={m.user?.avatarUrl} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-gray-900 font-medium flex items-center gap-1.5">
                          {m.user?.name || m.contact?.name}
                          {m.memberType === 'contact' && (
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                              Client
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-gray-400 truncate">
                          {m.memberType === 'contact' ? 'Client portal' : 'Team'}
                          {m.role === 'admin' ? ' · Room admin' : ''}
                          {m.user?.email ? ` · ${m.user.email}` : m.contact?.email ? ` · ${m.contact.email}` : ''}
                        </p>
                      </div>
                      {canManageMembers && (
                        <button
                          type="button"
                          onClick={() => removeMember.mutate(m.id)}
                          className="text-[11px] font-semibold text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showAddPeople && canManageMembers && (
              <div
                className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-brand-900/40 backdrop-blur-[2px]"
                onClick={() => setShowAddPeople(false)}
                role="presentation"
              >
                <div
                  className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-brand-900/10 overflow-hidden animate-msg-in max-h-[min(85vh,640px)] flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-people-title"
                >
                  <div
                    className="px-5 py-4 flex items-start gap-3"
                    style={{ background: `linear-gradient(145deg, ${BRAND.primaryDark}, ${primaryColor})` }}
                  >
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                      <UserPlus className="w-5 h-5 text-accent-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 id="add-people-title" className="text-base font-semibold text-white">
                        Add people
                      </h2>
                      <p className="text-xs text-white/60 mt-0.5 truncate">
                        {activeRoom ? roomTitle(activeRoom) : 'Room'}
                        {activeRoom?.roomType === 'client' ? ' · Client room' : activeRoom?.roomType === 'group' ? ' · Custom room' : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowAddPeople(false)}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="px-4 pt-3 pb-2 border-b border-gray-100 space-y-3">
                    {activeRoom?.roomType === 'client' && isAdmin ? (
                      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100">
                        <button
                          type="button"
                          onClick={() => setAddPeopleTab('team')}
                          className={cn(
                            'text-xs font-semibold py-2 rounded-lg transition-all',
                            addPeopleTab === 'team'
                              ? 'bg-white text-brand-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-800',
                          )}
                        >
                          Team
                          <span className="ml-1 text-[10px] opacity-60">{usersToAdd.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddPeopleTab('client')}
                          className={cn(
                            'text-xs font-semibold py-2 rounded-lg transition-all',
                            addPeopleTab === 'client'
                              ? 'bg-white text-brand-900 shadow-sm'
                              : 'text-gray-500 hover:text-gray-800',
                          )}
                        >
                          Client portal
                          <span className="ml-1 text-[10px] opacity-60">{contactsToAdd.length}</span>
                        </button>
                      </div>
                    ) : null}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        autoFocus
                        value={peopleSearch}
                        onChange={(e) => setPeopleSearch(e.target.value)}
                        placeholder={addPeopleTab === 'client' ? 'Search portal contacts…' : 'Search teammates…'}
                        className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-600/25 focus:border-brand-200"
                      />
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto px-3 py-2 min-h-[200px]">
                    {(addPeopleTab === 'team' || activeRoom?.roomType !== 'client' || !isAdmin) && (
                      <>
                        {usersToAdd.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                            <div className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mb-3">
                              <Users className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-medium text-gray-700">
                              {peopleSearch ? 'No matches' : 'Everyone is already here'}
                            </p>
                            <p className="text-xs text-gray-400 mt-1 max-w-xs">
                              {peopleSearch
                                ? 'Try a different name or email.'
                                : 'All eligible teammates are already members of this room.'}
                            </p>
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {usersToAdd.map((u: any) => (
                              <li
                                key={u.id}
                                className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-slate-50 border border-transparent hover:border-gray-100 transition-colors"
                              >
                                <button
                                  type="button"
                                  onClick={() => setProfileUserId(u.id)}
                                  className="shrink-0 rounded-full hover:ring-2 hover:ring-accent-400 transition-all"
                                  title="View profile"
                                >
                                  <Avatar name={u.name} src={u.avatarUrl} size="sm" />
                                </button>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{u.name}</p>
                                  <p className="text-[11px] text-gray-400 truncate">{u.email || 'Teammate'}</p>
                                </div>
                                <button
                                  type="button"
                                  disabled={addMember.isPending}
                                  onClick={() => addMember.mutate({ userId: u.id })}
                                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl text-brand-900 shadow-sm hover:scale-[1.03] transition-transform disabled:opacity-50"
                                  style={{ backgroundColor: BRAND.accent }}
                                >
                                  Add
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {addPeopleTab === 'client' && activeRoom?.roomType === 'client' && isAdmin && (
                      <>
                        {contactsToAdd.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                            <div className="w-12 h-12 rounded-2xl bg-accent-50 text-brand-800 flex items-center justify-center mb-3">
                              <Building2 className="w-5 h-5" />
                            </div>
                            <p className="text-sm font-medium text-gray-700">
                              {peopleSearch
                                ? 'No matching contacts'
                                : portalEnabledContacts.length > 0
                                  ? 'Everyone is already here'
                                  : 'No portal contacts yet'}
                            </p>
                            <p className="text-xs text-gray-400 mt-1 max-w-xs leading-relaxed">
                              {/* Telling an admin to "enable portal access first"
                                  when the real reason is that every eligible
                                  contact is already in the room sends them off
                                  to fix something that isn't broken. */}
                              {peopleSearch
                                ? 'Try a different name or email.'
                                : portalEnabledContacts.length > 0
                                  ? `All ${portalEnabledContacts.length} of this client's portal contacts have already been added to this room.`
                                  : 'Enable portal access on a client contact first, then you can invite them into this room.'}
                            </p>
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {contactsToAdd.map((c: any) => (
                              <li
                                key={c.id}
                                className="flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-accent-50/50 border border-transparent hover:border-accent-100 transition-colors"
                              >
                                <Avatar name={c.name} size="sm" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-900 truncate">{c.name}</p>
                                  <p className="text-[11px] text-gray-400 truncate">
                                    {c.email || 'Portal contact'}
                                    <span className="ml-1.5 text-accent-700 font-medium">· Client</span>
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  disabled={addMember.isPending}
                                  onClick={() => addMember.mutate({ contactId: c.id })}
                                  className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-xl text-white shadow-sm hover:scale-[1.03] transition-transform disabled:opacity-50"
                                  style={{ backgroundColor: primaryColor }}
                                >
                                  Invite
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>

                  <div className="px-4 py-3 border-t border-gray-100 bg-slate-50/80 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] text-gray-400">
                      They can read and send in this room once added.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowAddPeople(false)}
                      className="text-xs font-semibold text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
              {messagesLoading && <p className="text-xs text-gray-400 text-center py-8">Loading messages…</p>}
              {!messagesLoading && (messages as any[]).length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center animate-msg-in">
                  <div className="w-12 h-12 rounded-2xl bg-white border border-brand-100 shadow-sm flex items-center justify-center mb-3">
                    <Send className="w-5 h-5 text-brand-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-700">No messages yet</p>
                  <p className="text-xs text-gray-400 mt-1">Say hello — this is the start of the thread.</p>
                </div>
              )}
              {(messages as any[]).map((msg: any, idx: number) => {
                const mine = portalMode
                  ? msg.senderType === 'contact'
                  : msg.senderUserId === user?.id;
                const name = msg.senderUser?.name || msg.senderContact?.name || 'Unknown';
                const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
                const deleted = !!msg.deletedAt;
                const prev = (messages as any[])[idx - 1];
                const showDay = !prev || dayLabel(prev.createdAt) !== dayLabel(msg.createdAt);
                const reactions = reactionsFor(msg);
                const isEditing = editingId === msg.id;
                const isLast = idx === (messages as any[]).length - 1;

                return (
                  <div key={msg.id}>
                  {showDay && <DateDivider label={dayLabel(msg.createdAt)} />}
                  <div
                    ref={(el) => { messageRefs.current[msg.id] = el; }}
                    className={cn(
                      'group relative flex gap-2.5 animate-msg-in rounded-2xl -mx-2 px-2 py-1 transition-colors',
                      // `animate-msg-in` gives every row its own stacking
                      // context, so a dropdown opened inside one row was being
                      // painted under the rows beneath it. Lifting the whole row
                      // while it is hovered or holds focus is what lets its menu
                      // escape upward.
                      'z-0 hover:z-40 focus-within:z-40',
                      mine && 'flex-row-reverse',
                      highlightId === msg.id && 'bg-accent-100/60 ring-2 ring-accent-300',
                    )}
                    style={{ animationDelay: `${Math.min(idx, 8) * 20}ms` }}
                  >
                    {msg.senderType === 'user' && msg.senderUserId && !portalMode ? (
                      <button
                        type="button"
                        onClick={() => setProfileUserId(msg.senderUserId)}
                        className="mt-5 rounded-full hover:ring-2 hover:ring-accent-400 transition-all"
                        title={`View ${name}'s profile`}
                      >
                        <Avatar name={name} src={msg.senderUser?.avatarUrl} size="xs" />
                      </button>
                    ) : (
                      <Avatar name={name} src={msg.senderUser?.avatarUrl} size="xs" className="mt-5" />
                    )}
                    {/* `relative` so the hover toolbar anchors to the bubble
                        rather than to the full-width row. */}
                    <div className={cn('relative max-w-[78%] min-w-0 flex flex-col', mine && 'items-end')}>
                      {!deleted && (
                        <MessageActions
                          mine={mine}
                          canModerate={!!activeRoom?.canManage}
                          canPost={canPost}
                          canMakeTask={!portalMode && !!activeRoom?.clientId}
                          isPinned={!!msg.isPinned}
                          onReact={(emoji) => toggleReaction(msg.id, emoji)}
                          onReply={() => setThreadParentId(msg.parentMessageId || msg.id)}
                          onPin={() => togglePin.mutate({ id: msg.id, pinned: !msg.isPinned })}
                          onEdit={() => { setEditingId(msg.id); setEditDraft(msg.body || ''); }}
                          onDelete={() => deleteMessage.mutate(msg.id)}
                          onTask={() => setTaskForMessage(msg)}
                        />
                      )}
                      <div className={cn('flex items-baseline gap-2 mb-1 px-1', mine && 'flex-row-reverse')}>
                        {msg.senderType === 'user' && msg.senderUserId && !portalMode ? (
                          <button
                            type="button"
                            onClick={() => setProfileUserId(msg.senderUserId)}
                            className="text-xs font-semibold text-brand-900 hover:text-brand-700 hover:underline"
                          >
                            {name}
                          </button>
                        ) : (
                          <span className="text-xs font-semibold text-brand-900">{name}</span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {formatDate(msg.createdAt, 'MMM d, h:mm a')}
                        </span>
                        {msg.isPinned && !deleted && (
                          <Pin className="w-3 h-3 text-amber-500" aria-label="Pinned" />
                        )}
                        {msg.editedAt && !deleted && (
                          <span className="text-[10px] text-gray-400 italic">edited</span>
                        )}
                      </div>

                      {deleted ? (
                        <div className="rounded-2xl px-3.5 py-2.5 text-sm italic text-gray-400 bg-gray-50 border border-dashed border-gray-200">
                          This message was deleted
                        </div>
                      ) : isEditing ? (
                        <div className="w-full min-w-[16rem]">
                          <textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { setEditingId(null); setEditDraft(''); }
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (editDraft.trim()) saveEdit.mutate({ id: msg.id, body: editDraft });
                              }
                            }}
                            rows={2}
                            autoFocus
                            className="w-full px-3 py-2 text-sm border border-brand-300 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                          <div className="flex items-center gap-2 mt-1.5">
                            <button
                              type="button"
                              onClick={() => saveEdit.mutate({ id: msg.id, body: editDraft })}
                              disabled={!editDraft.trim() || saveEdit.isPending}
                              className="px-3 py-1 text-[11px] font-bold text-white bg-brand-700 hover:bg-brand-800 rounded-lg disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setEditDraft(''); }}
                              className="px-3 py-1 text-[11px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                            <span className="text-[10px] text-gray-400">Enter saves · Esc cancels</span>
                          </div>
                        </div>
                      ) : (
                      <div
                        className={cn(
                          'rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words shadow-sm',
                          mine
                            ? 'text-white rounded-tr-md'
                            : 'bg-white text-gray-800 rounded-tl-md border border-gray-100',
                        )}
                        style={mine ? { background: `linear-gradient(145deg, ${primaryColor}, ${BRAND.primaryLight})` } : undefined}
                      >
                        {msg.body ? (
                          <span className={mine ? '[&_span]:bg-white/20 [&_span]:text-accent-100' : undefined}>
                            {renderBody(msg.body)}
                          </span>
                        ) : null}
                        {attachments.map((a: any, i: number) => {
                          const k = attachmentKind(a.mime, a.kind);
                          if (k === 'image') {
                            return (
                              <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block mt-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={a.url} alt={a.name || 'image'} className="max-h-52 rounded-xl border border-white/20" />
                              </a>
                            );
                          }
                          if (k === 'audio') {
                            return (
                              <audio key={i} controls src={a.url} className="mt-2 w-full max-w-xs" />
                            );
                          }
                          return (
                            <a
                              key={i}
                              href={a.url}
                              target="_blank"
                              rel="noreferrer"
                              className={cn(
                                'mt-2 flex items-center gap-1.5 text-xs font-medium underline underline-offset-2',
                                mine ? 'text-accent-100' : 'text-brand-700',
                              )}
                            >
                              <FileText className="w-3.5 h-3.5" />
                              {a.name || 'Attachment'}
                            </a>
                          );
                        })}
                      </div>
                      )}

                      {!deleted && (
                        <ReactionBar
                          reactions={reactions}
                          mine={mine}
                          onToggle={(emoji) => toggleReaction(msg.id, emoji)}
                        />
                      )}

                      {/* Threads stay collapsed under the parent — that is what
                          keeps a busy channel readable. */}
                      {!deleted && (msg.replyCount || 0) > 0 && (
                        <button
                          type="button"
                          onClick={() => setThreadParentId(msg.id)}
                          className={cn(
                            'inline-flex items-center gap-1.5 mt-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-brand-700 hover:bg-brand-50 transition-colors',
                            mine && 'self-end',
                          )}
                        >
                          <Reply className="w-3 h-3" />
                          {msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}
                          {msg.lastReplyAt && (
                            <span className="text-gray-400 font-normal">
                              · {formatDate(msg.lastReplyAt, 'MMM d')}
                            </span>
                          )}
                        </button>
                      )}

                      {/* Only on the newest of your own messages — a receipt on
                          every row would be noise. */}
                      {mine && isLast && !deleted && activeRoomId && (
                        <SeenBy apiBase={apiBase} roomId={activeRoomId} messageId={msg.id} request={request} />
                      )}
                    </div>
                  </div>
                  </div>
                );
              })}
              {/* Jump to the first message you haven't read — only shown when
                  the backlog is big enough that scrolling is a chore. */}
              {firstUnreadId && (
                <button
                  type="button"
                  onClick={() => jumpToMessage(firstUnreadId)}
                  className="sticky top-1 z-20 mx-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-700 text-white text-[11px] font-bold shadow-lg hover:bg-brand-800 transition-colors"
                >
                  <ChevronDown className="w-3 h-3 rotate-180" />
                  Jump to unread
                </button>
              )}
              {typingName && (
                <div className="flex items-center gap-2 px-1 text-[11px] text-gray-500 animate-msg-in">
                  <span className="inline-flex gap-1 px-2.5 py-2 rounded-2xl bg-white border border-gray-100 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 typing-dot" />
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 typing-dot" />
                  </span>
                  {typingName} is typing…
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <footer className="shrink-0 px-3 sm:px-4 pb-3 pt-1">
              <div className="rounded-2xl border border-brand-900/8 bg-white/95 backdrop-blur shadow-lg shadow-brand-900/5 px-3 py-2.5">
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingFiles.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 text-xs bg-brand-50 text-brand-800 border border-brand-100 px-2.5 py-1 rounded-xl">
                        {attachmentKind(f.mime, f.kind) === 'image' ? <ImageIcon className="w-3 h-3" /> : <Paperclip className="w-3 h-3" />}
                        <span className="max-w-[120px] truncate font-medium">{f.name}</span>
                        <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="hover:text-red-600">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {mentionOpen && (
                  <div className="mb-2 border border-brand-100 rounded-xl bg-white shadow-md max-h-52 overflow-y-auto animate-msg-in">
                    <p className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-brand-700/50 border-b border-gray-50">
                      Mention · type to filter
                    </p>
                    {mentionOptions.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-400">No matches</p>
                    ) : mentionOptions.map((c: any, idx: number) => (
                      <button
                        key={`${c.type}-${c.id}`}
                        type="button"
                        onMouseEnter={() => setMentionHighlight(idx)}
                        onClick={() => insertMention(c)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm transition-colors',
                          idx === mentionHighlight ? 'bg-brand-50' : 'hover:bg-slate-50',
                        )}
                      >
                        {c.type === 'all' ? (
                          <span className="w-7 h-7 rounded-full bg-accent-100 text-brand-900 flex items-center justify-center shrink-0">
                            <Users className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <Avatar name={c.name} src={c.avatarUrl} size="xs" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-gray-900 block truncate">
                            {c.type === 'all' ? 'everyone' : c.name}
                          </span>
                          {c.label && (
                            <span className="text-[11px] text-gray-400 block truncate">{c.label}</span>
                          )}
                        </span>
                        <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide shrink-0">
                          {c.type === 'all' ? 'All' : c.type === 'contact' ? 'Client' : 'Team'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!canPost ? (
                  /* Read-only channel: the composer is replaced rather than
                     merely disabled, so the reason is on screen instead of
                     leaving someone typing into a dead box. */
                  <div className="flex items-center gap-2 px-1 py-2 text-xs text-gray-500">
                    {activeRoom?.isActive === false ? (
                      <>
                        <Archive className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                        This channel is inactive — you can read and search it, but not post.
                      </>
                    ) : (
                      <>
                        <Megaphone className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                        Only channel admins can post here.
                      </>
                    )}
                  </div>
                ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.html,.htm,.zip"
                    onChange={(e) => { void onPickFiles(e.target.files); e.target.value = ''; }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl text-gray-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                    title="Attach file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggleRecording()}
                    className={cn(
                      'h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl transition-colors',
                      recording ? 'bg-red-50 text-red-600' : 'text-gray-500 hover:text-brand-700 hover:bg-brand-50',
                    )}
                    title={recording ? 'Stop recording' : 'Voice message'}
                  >
                    {recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                  <div
                    className={cn(
                      'relative flex-1 min-w-0 rounded-xl border border-transparent bg-slate-50',
                      'focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-600/25 focus-within:border-brand-200',
                    )}
                  >
                    <div
                      ref={composerHighlightRef}
                      aria-hidden
                      className="absolute inset-0 overflow-y-auto overflow-x-hidden px-3 py-2.5 text-sm leading-5 text-gray-900 whitespace-pre-wrap break-words pointer-events-none scrollbar-hide"
                    >
                      {draft
                        ? renderComposerHighlights(draft, mentionRefs)
                        : (
                          // The @ hint is the first thing to go on a narrow
                          // composer — with it the placeholder wrapped to two
                          // lines and doubled the field's height before typing.
                          <span className="text-gray-400">
                            Write a message…<span className="hidden sm:inline"> Use @ to mention</span>
                          </span>
                        )}
                    </div>
                    <textarea
                      ref={composerRef}
                      value={draft}
                      rows={1}
                      onChange={(e) => {
                        const value = e.target.value;
                        const caret = e.target.selectionStart ?? value.length;
                        setDraft(value);
                        pruneMentionRefs(value);
                        syncMentionPicker(value, caret);
                        emitTyping(true);
                        if (typingTimer.current) clearTimeout(typingTimer.current);
                        typingTimer.current = setTimeout(() => emitTyping(false), 1500);
                        // Keep field height in sync with content for multi-line drafts.
                        const el = e.target;
                        el.style.height = '44px';
                        el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                      }}
                      onScroll={syncComposerScroll}
                      onClick={(e) => {
                        const t = e.currentTarget;
                        syncMentionPicker(t.value, t.selectionStart ?? t.value.length);
                      }}
                      onKeyUp={(e) => {
                        const t = e.currentTarget;
                        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                          syncMentionPicker(t.value, t.selectionStart ?? t.value.length);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (mentionOpen && mentionOptions.length > 0) {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setMentionHighlight((i) => (i + 1) % mentionOptions.length);
                            return;
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setMentionHighlight((i) => (i - 1 + mentionOptions.length) % mentionOptions.length);
                            return;
                          }
                          if (e.key === 'Enter' || e.key === 'Tab') {
                            e.preventDefault();
                            insertMention(mentionOptions[mentionHighlight] || mentionOptions[0]);
                            return;
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setMentionOpen(false);
                            return;
                          }
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (canSend) sendMutation.mutate();
                        }
                      }}
                      className="relative z-10 block w-full h-11 max-h-32 resize-none px-3 py-2.5 text-sm leading-5 bg-transparent text-transparent caret-gray-900 rounded-xl focus:outline-none selection:bg-brand-200/50 overflow-y-auto"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => sendMutation.mutate()}
                    disabled={!canSend}
                    className={cn(
                      'h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl transition-all',
                      canSend
                        ? 'text-brand-900 shadow-md hover:scale-105'
                        : 'text-white/80 cursor-not-allowed bg-slate-300',
                    )}
                    style={canSend ? { backgroundColor: BRAND.accent } : undefined}
                    title={canSend ? 'Send' : 'Type a message to send'}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                )}
                {recording && (
                  <p className="text-[11px] text-red-600 mt-2 flex items-center gap-1.5 font-medium">
                    <Circle className="w-2 h-2 fill-red-600 animate-pulse" /> Recording — tap stop when finished
                  </p>
                )}
              </div>
            </footer>
          </>
        )}
      </main>

      {/* ── Right-hand drawers. Only one at a time; a thread takes precedence
             because it is the most transient of them. ───────────────────── */}
      {activeRoomId && threadParentId && (
        <ThreadPanel
          apiBase={apiBase}
          roomId={activeRoomId}
          parentId={threadParentId}
          request={request}
          portalMode={portalMode}
          canPost={canPost}
          currentUserId={user?.id}
          renderBody={renderBody}
          onJump={(id) => { setThreadParentId(null); jumpToMessage(id); }}
          onClose={() => setThreadParentId(null)}
        />
      )}

      {activeRoomId && !threadParentId && panel === 'search' && (
        <SearchPanel
          apiBase={apiBase}
          request={request}
          roomId={activeRoomId}
          scopeName={activeRoom ? roomTitle(activeRoom) : undefined}
          onClose={() => setPanel(null)}
          onOpenResult={(rid, mid) => {
            if (rid !== activeRoomId) selectRoom(rid);
            setPanel(null);
            // Give the transcript a beat to render before scrolling to the hit.
            setTimeout(() => jumpToMessage(mid), 350);
          }}
        />
      )}

      {activeRoomId && !threadParentId && panel === 'pinned' && (
        <PinnedPanel
          apiBase={apiBase}
          roomId={activeRoomId}
          request={request}
          renderBody={renderBody}
          canModerate={!!activeRoom?.canManage}
          onJump={(id) => { setPanel(null); jumpToMessage(id); }}
          onClose={() => setPanel(null)}
        />
      )}

      {activeRoomId && !threadParentId && panel === 'files' && (
        <FilesPanel
          apiBase={apiBase}
          roomId={activeRoomId}
          request={request}
          onClose={() => setPanel(null)}
        />
      )}

      {activeRoomId && !threadParentId && panel === 'settings' && activeRoom && (
        <RoomSettingsPanel
          apiBase={apiBase}
          room={activeRoom}
          request={request}
          portalMode={portalMode}
          canManage={!!activeRoom.canManage}
          onClose={() => setPanel(null)}
        />
      )}

      {taskForMessage && activeRoomId && (
        <TaskFromMessageModal
          apiBase={apiBase}
          roomId={activeRoomId}
          message={taskForMessage}
          clientId={activeRoom?.clientId}
          request={request}
          onClose={() => setTaskForMessage(null)}
        />
      )}

      {showBulkAdd && activeRoomId && (
        <BulkAddModal
          apiBase={apiBase}
          roomId={activeRoomId}
          request={request}
          onClose={() => setShowBulkAdd(false)}
        />
      )}

      {paletteOpen && (
        <CommandPalette
          rooms={rooms as any[]}
          onPick={(id) => { setPaletteOpen(false); selectRoom(id); }}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {!portalMode && (
        <PublicProfileModal
          userId={profileUserId}
          isOnline={!!profileUserId && onlineIds.includes(profileUserId)}
          presenceText={profileUserId
            ? presenceLabel(
              onlineIds.includes(profileUserId),
              lastSeenById[profileUserId]
                || rooms.find((r: any) => r.peer?.id === profileUserId)?.peer?.lastSeenAt,
            )
            : null}
          onClose={() => setProfileUserId(null)}
          onMessage={(uid) => {
            setProfileUserId(null);
            openDm.mutate(uid);
          }}
        />
      )}
    </div>
  );
}
