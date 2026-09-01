'use client';

/**
 * Side panels and message-level affordances for Messages.
 *
 * Kept out of MessagesApp.tsx, which is already large — these are self-contained
 * surfaces that only need the room, a request function, and a way to close.
 * Every one of them takes `request` rather than importing `api` directly, so the
 * same components serve both the CRM (axios + CRM token) and the client portal
 * (fetch + portal token).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Search, Pin, Paperclip, Settings, History, Download, Trash2, Pencil,
  Reply, Smile, ListPlus, MoreHorizontal, Bell, BellOff,
  AtSign, Star, Users, Megaphone, EyeOff, Archive, ArchiveRestore, FileText,
  Image as ImageIcon, CheckCheck, Loader2, AlertTriangle, Hash,
} from 'lucide-react';
import { toast } from 'sonner';
import Avatar from '@/components/Avatar';
import { cn, formatDate, todayDateInput } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

export type Requester = (method: 'get' | 'post' | 'delete' | 'patch' | 'put', url: string, body?: any) => Promise<any>;

/** The six that cover almost every reaction people actually use. */
export const QUICK_EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🙏'];

/**
 * Pull a usable message out of either error shape (axios in the CRM, a thrown
 * Error in the portal). Falls back to a plain sentence rather than nothing —
 * a control that fails silently is indistinguishable from a broken one.
 */
export function mutationError(e: any, fallback: string) {
  return e?.response?.data?.message || e?.message || fallback;
}

const panelBtn = 'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-xl border transition-colors';

// ─── Date dividers ────────────────────────────────────────────────────────────

/** "Today" / "Yesterday" / "12 March 2026" — the day a run of messages belongs to. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function DateDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-1 select-none">
      <div className="flex-1 h-px bg-brand-900/8" />
      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-700/40 bg-white/70 px-2.5 py-1 rounded-full border border-brand-900/5">
        {label}
      </span>
      <div className="flex-1 h-px bg-brand-900/8" />
    </div>
  );
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export function ReactionBar({
  reactions, mine, onToggle,
}: {
  reactions: { emoji: string; count: number; reactedByMe?: boolean }[];
  mine: boolean;
  onToggle: (emoji: string) => void;
}) {
  if (!reactions?.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1 mt-1 px-1', mine && 'justify-end')}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji)}
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] leading-none transition-colors',
            r.reactedByMe
              ? 'bg-brand-50 border-brand-300 text-brand-800'
              : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300',
          )}
          title={r.reactedByMe ? 'Remove your reaction' : 'React'}
        >
          <span className="text-[13px] leading-none">{r.emoji}</span>
          <span className="font-semibold tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/** The hover toolbar that appears on a message row. */
export function MessageActions({
  mine, canModerate, canPost, isPinned, canMakeTask,
  onReact, onReply, onPin, onEdit, onDelete, onTask,
}: {
  mine: boolean;
  canModerate: boolean;
  canPost: boolean;
  isPinned: boolean;
  canMakeTask: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTask: () => void;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const open = emojiOpen || moreOpen;
  // Without Copy link, the ⋯ menu is empty for readers who can't moderate /
  // own the message — hide the button rather than open an empty panel.
  const hasMoreItems = canModerate || canMakeTask || mine;

  // Clicking anywhere else closes the menus — without this the only way to
  // dismiss one was to pick something from it.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setEmojiOpen(false);
        setMoreOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') { setEmojiOpen(false); setMoreOpen(false); }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div
      className={cn(
        'absolute -top-2 z-40 flex items-center gap-0.5 rounded-xl border border-gray-200 bg-white shadow-md px-0.5 py-0.5',
        'transition-opacity',
        // While a menu is open the toolbar must stay put: it used to fade out
        // the moment the pointer drifted off the row, taking the open menu with
        // it mid-click.
        open
          ? 'opacity-100 pointer-events-auto'
          : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto',
        // Anchored to the bubble, not the full-width row: your own messages sit
        // right-aligned, so a toolbar pinned to the row's left edge ended up
        // half a screen away from the message it acts on.
        mine ? 'left-0' : 'right-0',
      )}
      ref={rootRef}
    >
      {emojiOpen && (
        <div className={cn(
          'absolute -top-11 z-50 flex items-center gap-0.5 rounded-xl border border-gray-200 bg-white shadow-xl px-1 py-1',
          mine ? 'left-0' : 'right-0',
        )}>
          {QUICK_EMOJI.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onReact(e); setEmojiOpen(false); }}
              className="w-7 h-7 rounded-lg hover:bg-gray-100 text-base leading-none"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {canPost && (
        <>
          <IconBtn label="React" onClick={() => { setEmojiOpen((v) => !v); setMoreOpen(false); }}>
            <Smile className="w-3.5 h-3.5" />
          </IconBtn>
          <IconBtn label="Reply in thread" onClick={onReply}>
            <Reply className="w-3.5 h-3.5" />
          </IconBtn>
        </>
      )}

      <div className="relative">
        {hasMoreItems && (
          <>
            <IconBtn label="More" onClick={() => { setMoreOpen((v) => !v); setEmojiOpen(false); }}>
              <MoreHorizontal className="w-3.5 h-3.5" />
            </IconBtn>
            {moreOpen && (
              <div className="absolute right-0 top-8 w-48 rounded-xl border border-gray-200 bg-white shadow-xl py-1 z-50">
                {canModerate && (
                  <MenuItem
                    icon={Pin}
                    label={isPinned ? 'Unpin from room' : 'Pin to room'}
                    onClick={() => { onPin(); setMoreOpen(false); }}
                  />
                )}
                {canMakeTask && (
                  <MenuItem icon={ListPlus} label="Create task…" onClick={() => { onTask(); setMoreOpen(false); }} />
                )}
                {mine && canPost && (
                  <MenuItem icon={Pencil} label="Edit" onClick={() => { onEdit(); setMoreOpen(false); }} />
                )}
                {(mine || canModerate) && (
                  <MenuItem icon={Trash2} label="Delete" danger onClick={() => { onDelete(); setMoreOpen(false); }} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-lg text-gray-500 hover:text-brand-800 hover:bg-brand-50 inline-flex items-center justify-center transition-colors"
    >
      {children}
    </button>
  );
}

function MenuItem({
  icon: Icon, label, onClick, danger,
}: { icon: any; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
        danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50',
      )}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {label}
    </button>
  );
}

// ─── Generic right-hand drawer ────────────────────────────────────────────────

export function SidePanel({
  open, title, icon: Icon, onClose, children, footer,
}: {
  open: boolean;
  title: string;
  icon?: any;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <aside className="w-full sm:w-[22rem] shrink-0 border-l border-brand-900/8 bg-white/95 backdrop-blur flex flex-col animate-msg-in">
      <div className="shrink-0 flex flex-wrap items-center justify-between px-4 py-3.5 border-b border-brand-900/8 gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-brand-700/60 flex items-center gap-1.5">
          {Icon && <Icon className="w-3.5 h-3.5" />}
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50"
          aria-label="Close panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">{children}</div>
      {footer && <div className="shrink-0 border-t border-brand-900/8 p-3">{footer}</div>}
    </aside>
  );
}

// ─── Thread ───────────────────────────────────────────────────────────────────

export function ThreadPanel({
  apiBase, roomId, parentId, request, onClose, onJump, renderBody, currentUserId, portalMode, canPost,
}: {
  apiBase: string;
  roomId: string;
  parentId: string;
  request: Requester;
  onClose: () => void;
  onJump: (messageId: string) => void;
  renderBody: (body: string) => React.ReactNode;
  currentUserId?: string;
  portalMode: boolean;
  canPost: boolean;
}) {
  const qc = useQueryClient();
  const [reply, setReply] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['message-thread-detail', apiBase, roomId, parentId],
    queryFn: () => request('get', `${apiBase}/rooms/${roomId}/messages/${parentId}/thread`),
    enabled: !!parentId,
    refetchInterval: 8000,
  });

  const send = useMutation({
    mutationFn: () => request('post', `${apiBase}/rooms/${roomId}/messages`, {
      body: reply.trim(),
      parentMessageId: parentId,
    }),
    onSuccess: () => {
      setReply('');
      qc.invalidateQueries({ queryKey: ['message-thread-detail', apiBase, roomId, parentId] });
      qc.invalidateQueries({ queryKey: ['message-thread', apiBase, roomId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not send the reply.'),
  });

  const parent = data?.parent;
  const replies: any[] = data?.replies || [];

  return (
    <SidePanel open title={`Thread · ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`} icon={Reply} onClose={onClose}>
      {isLoading && <p className="text-xs text-gray-400">Loading…</p>}

      {parent && (
        <button
          type="button"
          onClick={() => onJump(parent.id)}
          className="w-full text-left rounded-xl border border-brand-100 bg-brand-50/40 p-3 hover:bg-brand-50 transition-colors"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar name={parent.senderUser?.name || parent.senderContact?.name} src={parent.senderUser?.avatarUrl} size="xs" />
            <span className="text-xs font-semibold text-brand-900">
              {parent.senderUser?.name || parent.senderContact?.name || 'Unknown'}
            </span>
            <span className="text-[10px] text-gray-400">{formatDate(parent.createdAt, 'MMM d, h:mm a')}</span>
          </div>
          <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{renderBody(parent.body)}</p>
        </button>
      )}

      <div className="space-y-3 pt-1">
        {replies.map((r) => (
          <div key={r.id} className="flex gap-2.5">
            <Avatar name={r.senderUser?.name || r.senderContact?.name} src={r.senderUser?.avatarUrl} size="xs" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold text-brand-900 truncate">
                  {r.senderUser?.name || r.senderContact?.name || 'Unknown'}
                </span>
                <span className="text-[10px] text-gray-400 shrink-0">{formatDate(r.createdAt, 'h:mm a')}</span>
              </div>
              <p className={cn(
                'text-sm whitespace-pre-wrap break-words',
                r.deletedAt ? 'italic text-gray-400' : 'text-gray-800',
              )}>
                {r.deletedAt ? 'This message was deleted' : renderBody(r.body)}
              </p>
            </div>
          </div>
        ))}
        {!isLoading && replies.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-4">No replies yet.</p>
        )}
      </div>

      {canPost && (
        <div className="pt-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (reply.trim()) send.mutate();
              }
            }}
            rows={2}
            placeholder="Reply in thread…"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!reply.trim() || send.isPending}
            className="mt-2 w-full py-2 text-xs font-bold text-white rounded-xl bg-brand-700 hover:bg-brand-800 disabled:opacity-50 transition-colors"
          >
            {send.isPending ? 'Sending…' : 'Reply'}
          </button>
        </div>
      )}
    </SidePanel>
  );
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function SearchPanel({
  apiBase, request, roomId, scopeName, onClose, onOpenResult,
}: {
  apiBase: string;
  request: Requester;
  roomId?: string;
  scopeName?: string;
  onClose: () => void;
  onOpenResult: (roomId: string, messageId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [thisRoomOnly, setThisRoomOnly] = useState(true);
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['message-search', apiBase, debounced, thisRoomOnly ? roomId : null],
    queryFn: () => request(
      'get',
      `${apiBase}/search?q=${encodeURIComponent(debounced)}${thisRoomOnly && roomId ? `&roomId=${roomId}` : ''}`,
    ),
    enabled: debounced.trim().length >= 2,
  });

  return (
    <SidePanel open title="Search messages" icon={Search} onClose={onClose}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a message…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {roomId && (
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={thisRoomOnly}
            onChange={(e) => setThisRoomOnly(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
          />
          Only in {scopeName || 'this conversation'}
        </label>
      )}

      {debounced.trim().length >= 2 && (
        <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700/40">
          {isFetching ? 'Searching…' : `${(results as any[]).length} result${(results as any[]).length === 1 ? '' : 's'}`}
        </p>
      )}

      <div className="space-y-2">
        {(results as any[]).map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpenResult(r.roomId, r.id)}
            className="w-full text-left rounded-xl border border-gray-100 hover:border-brand-200 hover:bg-brand-50/40 p-3 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-semibold text-brand-800 truncate">
                {r.senderUser?.name || r.senderContact?.name || 'Unknown'}
              </span>
              <span className="text-[10px] text-gray-400 shrink-0">
                {formatDate(r.createdAt, 'MMM d')}
              </span>
              {!thisRoomOnly && r.room?.name && (
                <span className="text-[10px] text-gray-400 truncate ml-auto">#{r.room.name}</span>
              )}
            </div>
            <p className="text-xs text-gray-700 line-clamp-2">{r.snippet || r.body}</p>
          </button>
        ))}
      </div>
    </SidePanel>
  );
}

// ─── Pinned ───────────────────────────────────────────────────────────────────

export function PinnedPanel({
  apiBase, roomId, request, onClose, onJump, renderBody, canModerate,
}: {
  apiBase: string;
  roomId: string;
  request: Requester;
  onClose: () => void;
  onJump: (messageId: string) => void;
  renderBody: (body: string) => React.ReactNode;
  canModerate: boolean;
}) {
  const qc = useQueryClient();
  const { data: pinned = [], isLoading } = useQuery({
    queryKey: ['message-pinned', apiBase, roomId],
    queryFn: () => request('get', `${apiBase}/rooms/${roomId}/pinned`),
  });

  const unpin = useMutation({
    mutationFn: (messageId: string) =>
      request('post', `${apiBase}/rooms/${roomId}/messages/${messageId}/pin`, { pinned: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-pinned', apiBase, roomId] }),
  });

  return (
    <SidePanel open title="Pinned" icon={Pin} onClose={onClose}>
      {isLoading && <p className="text-xs text-gray-400">Loading…</p>}
      {!isLoading && (pinned as any[]).length === 0 && (
        <p className="text-xs text-gray-400 text-center py-6">
          Nothing pinned yet. Pin the brief or key details so nobody has to scroll for them.
        </p>
      )}
      {(pinned as any[]).map((m) => (
        <div key={m.id} className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Avatar name={m.senderUser?.name || m.senderContact?.name} src={m.senderUser?.avatarUrl} size="xs" />
            <span className="text-xs font-semibold text-brand-900 truncate">
              {m.senderUser?.name || m.senderContact?.name || 'Unknown'}
            </span>
            {canModerate && (
              <button
                type="button"
                onClick={() => unpin.mutate(m.id)}
                className="ml-auto p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                title="Unpin"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button type="button" onClick={() => onJump(m.id)} className="text-left w-full">
            <p className="text-sm text-gray-800 whitespace-pre-wrap break-words line-clamp-4">
              {renderBody(m.body)}
            </p>
          </button>
        </div>
      ))}
    </SidePanel>
  );
}

// ─── Files ────────────────────────────────────────────────────────────────────

export function FilesPanel({
  apiBase, roomId, request, onClose,
}: {
  apiBase: string; roomId: string; request: Requester; onClose: () => void;
}) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['message-files', apiBase, roomId],
    queryFn: () => request('get', `${apiBase}/rooms/${roomId}/files`),
  });

  const images = (files as any[]).filter((f) => (f.kind || '').includes('image') || (f.mime || '').startsWith('image/'));
  const others = (files as any[]).filter((f) => !images.includes(f));

  return (
    <SidePanel open title={`Files · ${(files as any[]).length}`} icon={Paperclip} onClose={onClose}>
      {isLoading && <p className="text-xs text-gray-400">Loading…</p>}
      {!isLoading && (files as any[]).length === 0 && (
        <p className="text-xs text-gray-400 text-center py-6">No files shared in this conversation yet.</p>
      )}

      {images.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700/40">Images</p>
          <div className="grid grid-cols-3 gap-2">
            {images.map((f, i) => (
              <a key={i} href={f.url} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-gray-200 hover:border-brand-300">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt={f.name || 'Shared image'} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </>
      )}

      {others.length > 0 && (
        <>
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700/40 pt-2">Documents</p>
          <div className="space-y-1.5">
            {others.map((f, i) => (
              <a
                key={i}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-100 hover:border-brand-200 hover:bg-brand-50/40 transition-colors"
              >
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 truncate">{f.name || 'Attachment'}</p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {f.postedBy} · {formatDate(f.postedAt, 'MMM d')}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </>
      )}
    </SidePanel>
  );
}

// ─── Room settings + activity ─────────────────────────────────────────────────

export function RoomSettingsPanel({
  apiBase, room, request, onClose, canManage, portalMode,
}: {
  apiBase: string;
  room: any;
  request: Requester;
  onClose: () => void;
  canManage: boolean;
  portalMode: boolean;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'settings' | 'activity'>('settings');
  const [name, setName] = useState(room?.name || '');
  const [description, setDescription] = useState(room?.description || '');
  const [retention, setRetention] = useState<string>(room?.retentionDays ? String(room.retentionDays) : '');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['message-rooms', apiBase] });
    qc.invalidateQueries({ queryKey: ['room-events', apiBase, room?.id] });
  };

  const patch = useMutation({
    mutationFn: (body: any) => request('patch', `${apiBase}/rooms/${room.id}`, body),
    onSuccess: () => { toast.success('Channel updated.'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not update the channel.'),
  });

  const setActive = useMutation({
    mutationFn: (active: boolean) => request('post', `${apiBase}/rooms/${room.id}/active`, { active }),
    onSuccess: (_d, active) => {
      toast.success(active ? 'Channel reactivated.' : 'Channel deactivated — history is kept.');
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not update the channel.'),
  });

  // Optimistic so the highlight moves the instant you click. Without this a slow
  // (or failing) request made the buttons look completely dead.
  const [notifyLevel, setNotifyLevel] = useState<string>(room?.notifyLevel || 'mentions');
  useEffect(() => { setNotifyLevel(room?.notifyLevel || 'mentions'); }, [room?.notifyLevel]);

  const setNotify = useMutation({
    mutationFn: (level: string) => request('put', `${apiBase}/rooms/${room.id}/notify`, { level }),
    onMutate: (level: string) => {
      const previous = notifyLevel;
      setNotifyLevel(level);
      return previous;
    },
    onSuccess: () => refresh(),
    onError: (e: any, _level, previous) => {
      // Roll back, and say so — a silent failure here is indistinguishable from
      // a broken button, which is exactly how this first went wrong.
      if (previous) setNotifyLevel(previous as string);
      toast.error(mutationError(e, 'Could not change your notification setting.'));
    },
  });

  /**
   * Fetch the CSV with credentials and save it client-side.
   *
   * This was a bare `<a href="/api/...">`, which sends no Authorization header —
   * the CRM uses a bearer token, so the browser navigation just 401'd.
   */
  const exportTranscript = useMutation({
    mutationFn: async () => {
      const csv = await request('get', `${apiBase}/rooms/${room.id}/export`);
      const blob = new Blob([typeof csv === 'string' ? csv : JSON.stringify(csv)], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${String(room.name || 'channel').replace(/[^\w.-]+/g, '-')}-transcript.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success('Transcript downloaded.'),
    onError: (e: any) => toast.error(mutationError(e, 'Could not export the transcript.')),
  });

  const { data: events = [] } = useQuery({
    queryKey: ['room-events', apiBase, room?.id],
    queryFn: () => request('get', `${apiBase}/rooms/${room.id}/events`),
    enabled: tab === 'activity' && !!room?.id,
  });

  const isDm = room?.roomType === 'dm';

  return (
    <SidePanel open title="Channel" icon={Settings} onClose={onClose}>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {(['settings', 'activity'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors',
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'settings' ? (
        <div className="space-y-4">
          {/* Personal — always available, even in a channel you can't administer. */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-brand-700/40 mb-1.5">Notify me</p>
            <div className="grid grid-cols-3 gap-1">
              {([
                ['all', 'All', Bell],
                ['mentions', 'Mentions', AtSign],
                ['muted', 'Muted', BellOff],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNotify.mutate(value)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-2 rounded-xl border text-[11px] font-semibold transition-colors',
                    notifyLevel === value
                      ? 'bg-brand-50 border-brand-300 text-brand-800'
                      : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300',
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {canManage && !isDm && (
            <>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-700/40 mb-1.5">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => name.trim() && name !== room.name && patch.mutate({ name })}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-700/40 mb-1.5">Purpose</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => description !== (room.description || '') && patch.mutate({ description })}
                  rows={2}
                  placeholder="What this channel is for…"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>

              {!portalMode && (
                <>
                  <ToggleRow
                    icon={Users}
                    label="Shared with the client"
                    hint="Client contacts can be added, and everyone sees a reminder that the client can read this."
                    checked={room?.visibility === 'client_shared'}
                    disabled={room?.roomType === 'client'}
                    onChange={(v) => patch.mutate({ visibility: v ? 'client_shared' : 'internal' })}
                  />

                  <ToggleRow
                    icon={Megaphone}
                    label="Announcement only"
                    hint="Only channel admins can post. Everyone else can read and react."
                    checked={!!room?.isAnnouncement}
                    onChange={(v) => patch.mutate({ isAnnouncement: v })}
                  />

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-700/40 mb-1.5">
                      Delete messages after
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        value={retention}
                        onChange={(e) => setRetention(e.target.value)}
                        onBlur={() => patch.mutate({ retentionDays: retention === '' ? null : Number(retention) })}
                        placeholder="Never"
                        className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <span className="text-xs text-gray-500">days · blank keeps everything</span>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {!portalMode && (
            <button
              type="button"
              onClick={() => exportTranscript.mutate()}
              disabled={exportTranscript.isPending}
              className={cn(panelBtn, 'w-full justify-center text-gray-700 border-gray-200 bg-white hover:bg-gray-50')}
            >
              {exportTranscript.isPending
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Download className="w-3.5 h-3.5" />}
              {exportTranscript.isPending ? 'Preparing…' : 'Export transcript'}
            </button>
          )}

          {/* Super admin only — `canDeactivate` is computed server-side and is
              deliberately narrower than canManage. Client rooms are included:
              a finished engagement is exactly when one should be retired. */}
          {room?.canDeactivate && (
            <div className="pt-2 border-t border-gray-100">
              {room?.isActive === false ? (
                <button
                  type="button"
                  onClick={() => setActive.mutate(true)}
                  disabled={setActive.isPending}
                  className={cn(panelBtn, 'w-full justify-center border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100')}
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  Reactivate channel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setActive.mutate(false)}
                    disabled={setActive.isPending}
                    className={cn(panelBtn, 'w-full justify-center border-gray-200 text-gray-700 bg-white hover:bg-gray-50')}
                  >
                    <Archive className="w-3.5 h-3.5" />
                    Deactivate channel
                  </button>
                  <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                    Closes the channel to new messages. Every message, file and member stays exactly
                    where it is — channels are never deleted.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {(events as any[]).length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">No activity recorded yet.</p>
          )}
          {(events as any[]).map((e) => (
            <div key={e.id} className="flex gap-2.5 text-xs">
              <History className="w-3.5 h-3.5 text-gray-300 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-gray-700">{e.summary}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  {e.actor?.name || 'System'} · {formatDate(e.createdAt, 'MMM d, h:mm a')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SidePanel>
  );
}

function ToggleRow({
  icon: Icon, label, hint, checked, onChange, disabled,
}: {
  icon: any; label: string; hint: string; checked: boolean;
  onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className={cn(
      'flex items-start gap-2.5 p-2.5 rounded-xl border border-gray-100 cursor-pointer hover:bg-gray-50/60 transition-colors',
      disabled && 'opacity-60 cursor-not-allowed hover:bg-transparent',
    )}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 mt-0.5 rounded border-gray-300 text-brand-700 focus:ring-brand-600 shrink-0"
      />
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-gray-400" />
          {label}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">{hint}</p>
      </div>
    </label>
  );
}

// ─── Create task from a message ───────────────────────────────────────────────

export function TaskFromMessageModal({
  apiBase, roomId, message, clientId, request, onClose,
}: {
  apiBase: string;
  roomId: string;
  message: any;
  clientId?: string | null;
  request: Requester;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(
    (message?.body || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').trim().slice(0, 120),
  );
  const [projectId, setProjectId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [remarks, setRemarks] = useState('');

  // Same source and shape the Tasks page uses. The previous version passed
  // `clientId` as a query param the projects endpoint does not support, so the
  // filter was ignored server-side or matched nothing and the dropdown came back
  // empty; the client scoping is applied here instead.
  const { data: projectsResp } = useQuery({
    queryKey: ['chat-task-projects'],
    queryFn: () => request('get', '/projects?limit=200'),
  });

  const { data: assignableUsers = [] } = useQuery({
    queryKey: ['users-assignable'],
    queryFn: () => request('get', '/users/assignable'),
  });

  const projects: any[] = useMemo(() => {
    const all: any[] = projectsResp?.data || (Array.isArray(projectsResp) ? projectsResp : []);
    // A client room's task must land on that client's project — the server
    // rejects anything else, so don't offer it in the first place.
    return clientId ? all.filter((p) => p.clientId === clientId) : all;
  }, [projectsResp, clientId]);

  const create = useMutation({
    mutationFn: () => request('post', `${apiBase}/rooms/${roomId}/messages/${message.id}/task`, {
      projectId, title: title.trim(), assigneeId: assigneeId || null, dueAt: dueAt || null, remarks,
    }),
    onSuccess: () => {
      toast.success('Task created from this message.');
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['all-tasks'] });
      onClose();
    },
    onError: (e: any) => toast.error(mutationError(e, 'Could not create the task.')),
  });

  const field = 'w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-w-lg sm:max-w-lg rounded-2xl shadow-2xl">
        <DialogTitle className="sr-only">Create task from message</DialogTitle>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-gray-900">Create task from message</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* The message this came out of, so the assigner can see what they're
            turning into work without switching back to the thread. */}
        <div className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">From the conversation</p>
          <p className="text-xs text-gray-600 line-clamp-3">
            {(message?.body || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1')}
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Project *</label>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {projects.length === 0 && (
            <p className="text-[11px] text-amber-700 mt-1">
              This client has no projects yet — create one before raising a task against it.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Task title *</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fix broken contact form"
            className={field}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Assign to</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={field}>
              <option value="">Unassigned</option>
              {(assignableUsers as any[]).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Due date</label>
            <input type="date" min={todayDateInput()} value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Remarks</label>
          <textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            rows={3}
            placeholder="Context or instructions for the assignee…"
            className={`${field} resize-none`}
          />
          <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
            The original message is attached to the task automatically, along with a link back to this conversation.
          </p>
        </div>

        <p className="text-[11px] text-gray-400 leading-relaxed">
          Starts as <span className="font-semibold text-gray-500">To do</span>. The assignee is notified right away.
          Add a due date to enable the automatic 24h reminder.
        </p>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={!projectId || !title.trim() || create.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-lg disabled:opacity-50 transition-colors"
          >
            {create.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Create Task
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Ctrl+K quick switcher ────────────────────────────────────────────────────

export function CommandPalette({
  rooms, onPick, onClose,
}: {
  rooms: any[];
  onPick: (roomId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? rooms.filter((r) => (r.name || '').toLowerCase().includes(term)
        || (r.client?.name || '').toLowerCase().includes(term)
        || (r.peer?.name || '').toLowerCase().includes(term))
      : rooms;
    return list.slice(0, 8);
  }, [rooms, q]);

  // Keep the highlight inside the result set as it shrinks while typing.
  const safeHighlight = Math.min(highlight, Math.max(0, matches.length - 1));

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg sm:max-w-lg rounded-2xl shadow-2xl overflow-hidden p-0 gap-0">
        <DialogTitle className="sr-only">Jump to a conversation</DialogTitle>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setHighlight(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, matches.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && matches[safeHighlight]) { e.preventDefault(); onPick(matches[safeHighlight].id); }
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Jump to a conversation…"
            className="flex-1 text-sm outline-none placeholder-gray-400"
          />
          <kbd className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 && (
            <p className="px-4 py-6 text-xs text-gray-400 text-center">No conversations match.</p>
          )}
          {matches.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onPick(r.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors',
                i === safeHighlight ? 'bg-brand-50' : 'hover:bg-gray-50',
              )}
            >
              {r.roomType === 'dm'
                ? <Avatar name={r.peer?.name || r.name} src={r.peer?.avatarUrl} size="xs" />
                : (
                  <div className="w-6 h-6 rounded-lg bg-brand-50 text-brand-700 flex items-center justify-center shrink-0">
                    {r.roomType === 'group' ? <Hash className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                  </div>
                )}
              <span className="text-sm text-gray-800 truncate flex-1">{r.name}</span>
              {r.isActive === false && (
                <span className="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Inactive</span>
              )}
              {(r.unread || 0) > 0 && (
                <span className="text-[10px] font-bold text-white bg-brand-700 px-1.5 py-0.5 rounded-full">{r.unread}</span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Banners ──────────────────────────────────────────────────────────────────

export function RoomBanners({ room }: { room: any }) {
  if (!room) return null;

  // Driven by who is actually in the room, not by whether the room is merely
  // allowed to include the client. A client-type room with only staff in it is
  // internal in practice, and warning otherwise is the kind of false alarm that
  // teaches people to ignore the banner when it does matter.
  const clientsPresent = (room.clientMemberCount || 0) > 0;

  return (
    <>
      {room.isActive === false && (
        <Banner tone="gray" icon={Archive}>
          This channel is inactive. Everything said here is still here — it just can&apos;t take new messages.
        </Banner>
      )}
      {clientsPresent && room.roomType !== 'dm' && (
        <Banner tone="amber" icon={EyeOff}>
          {room.clientMemberCount === 1 ? 'A client contact is' : `${room.clientMemberCount} client contacts are`}
          {' '}in this conversation and can read everything posted here.
        </Banner>
      )}
      {room.isAnnouncement && !room.canPost && (
        <Banner tone="blue" icon={Megaphone}>
          Announcement channel — only admins can post here.
        </Banner>
      )}
    </>
  );
}

function Banner({ tone, icon: Icon, children }: { tone: 'gray' | 'amber' | 'blue'; icon: any; children: React.ReactNode }) {
  const tones = {
    gray: 'bg-gray-50 border-gray-200 text-gray-600',
    amber: 'bg-amber-50 border-amber-100 text-amber-800',
    blue: 'bg-blue-50 border-blue-100 text-blue-800',
  };
  return (
    <div className={cn('shrink-0 flex items-center gap-2 px-4 py-2 border-b text-[11px] font-medium', tones[tone])}>
      <Icon className="w-3.5 h-3.5 shrink-0" />
      {children}
    </div>
  );
}

// ─── Read receipts ────────────────────────────────────────────────────────────

export function SeenBy({ apiBase, roomId, messageId, request }: {
  apiBase: string; roomId: string; messageId: string; request: Requester;
}) {
  const { data } = useQuery({
    queryKey: ['message-receipts', apiBase, roomId, messageId],
    queryFn: () => request('get', `${apiBase}/rooms/${roomId}/receipts?messageId=${messageId}`),
    staleTime: 15_000,
  });
  const seen: any[] = data?.seen || [];
  if (!seen.length) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-gray-400 mt-0.5 px-1"
      title={`Seen by ${seen.map((s) => s.name).join(', ')}`}
    >
      <CheckCheck className="w-3 h-3" />
      Seen by {seen.length}
    </span>
  );
}

// ─── Bulk add ─────────────────────────────────────────────────────────────────

export function BulkAddModal({
  apiBase, roomId, request, onClose,
}: { apiBase: string; roomId: string; request: Requester; onClose: () => void }) {
  const qc = useQueryClient();
  const [roleKey, setRoleKey] = useState('');
  const [department, setDepartment] = useState('');

  const { data: roles = [] } = useQuery({
    queryKey: ['chat-bulk-roles'],
    queryFn: () => request('get', '/roles'),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['chat-bulk-departments'],
    queryFn: () => request('get', '/hr/departments'),
  });

  const add = useMutation({
    mutationFn: () => request('post', `${apiBase}/rooms/${roomId}/members/bulk`, {
      roleKey: roleKey || null,
      department: department || null,
    }),
    onSuccess: (r: any) => {
      toast.success(r?.added ? `Added ${r.added} to the channel.` : 'Everyone matching is already here.');
      qc.invalidateQueries({ queryKey: ['message-members', apiBase, roomId] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || e?.message || 'Could not add people.'),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="max-w-md sm:max-w-md rounded-2xl shadow-xl p-5">
        <DialogTitle className="sr-only">Add a whole team</DialogTitle>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">Add a whole team</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Everyone with this role</label>
          <select
            value={roleKey}
            onChange={(e) => setRoleKey(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">—</option>
            {(Array.isArray(roles) ? roles : []).map((r: any) => (
              <option key={r.id || r.key} value={r.key}>{r.name || r.key}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">Everyone in this department</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">—</option>
            {(Array.isArray(departments) ? departments : []).map((d: any) => (
              <option key={d.id || d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => add.mutate()}
            disabled={(!roleKey && !department) || add.isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-lg disabled:opacity-50 transition-colors"
          >
            {add.isPending ? 'Adding…' : 'Add to channel'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
