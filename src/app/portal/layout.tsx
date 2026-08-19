'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { LayoutDashboard, FileText, LogOut, Bell, CheckCheck, CreditCard, FileCheck, MessagesSquare, Target } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePortalStore } from '@/store/portal';
import NotificationBridge from '@/components/NotificationBridge';
import { useBranding } from '@/hooks/useBranding';
import { cn, formatMentionPreview } from '@/lib/utils';

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
    if (!r.ok) throw new Error(data.message || 'Request failed');
    return data;
  });
}

const NOTIF_ICON: Record<string, any> = {
  invoice_sent: FileText,
  invoice_paid: FileCheck,
  payment_notified: CreditCard,
  chat_mention: MessagesSquare,
};

// Only a list page exists for portal invoices (no /portal/invoices/[id]), so
// invoice-related notifications land there rather than a specific record.
function portalNotificationHref(n: any): string | null {
  if (n.type === 'chat_mention' || n.refTable === 'chat_rooms') {
    return n.refId ? `/portal/messages?room=${n.refId}` : '/portal/messages';
  }
  if (n.type === 'invoice_sent' || n.type === 'invoice_paid' || n.type === 'payment_notified' || n.refTable === 'invoices') {
    return '/portal/invoices';
  }
  return null;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PortalNotificationBell({ token }: { token: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { primaryColor } = useBranding();

  const { data: notifications = [] } = useQuery({
    queryKey: ['portal-notifications'],
    queryFn: () => portalFetch('/portal/notifications', token),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => portalFetch(`/portal/notifications/${id}/read`, token, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-notifications'] }),
  });

  const markAll = useMutation({
    mutationFn: () => portalFetch('/portal/notifications/mark-all-read', token, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-notifications'] }),
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const notifs = notifications as any[];
  const unread = notifs.filter((n) => !n.isRead).length;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 w-3.5 h-3.5 text-white text-[9px] font-bold rounded-full flex items-center justify-center"
            style={{ backgroundColor: primaryColor }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-white rounded-xl border border-gray-200 shadow-xl z-50 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between px-4 py-3 border-b border-gray-100 gap-2">
            <span className="text-sm font-semibold text-gray-900">
              Notifications {unread > 0 && <span className="text-xs text-gray-400 ml-1">({unread} new)</span>}
            </span>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs font-medium" style={{ color: primaryColor }}>
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto">
            {notifs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-400">No notifications yet.</div>
            ) : notifs.map((n: any) => {
              const Icon = NOTIF_ICON[n.type] || Bell;
              return (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markOne.mutate(n.id);
                    setOpen(false);
                    const href = portalNotificationHref(n);
                    if (href) router.push(href);
                  }}
                  className={cn(
                    'w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0',
                    !n.isRead && 'bg-blue-50/40',
                  )}
                >
                  <div className={cn('mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0', n.isRead ? 'bg-gray-100' : 'bg-brand-100')}>
                    <Icon className={cn('w-3.5 h-3.5', n.isRead ? 'text-gray-400' : 'text-brand-700')} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-xs leading-snug', n.isRead ? 'text-gray-600' : 'text-gray-900 font-medium')}>{n.title}</p>
                    {n.body && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                        {formatMentionPreview(n.body)}
                      </p>
                    )}
                    <p className="text-[10px] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.isRead && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { contact, client, token, hasHydrated, logout, setBranding } = usePortalStore();
  const { brandName, primaryColor, logoUrl } = useBranding();
  const isMessages = pathname.startsWith('/portal/messages');

  useEffect(() => {
    if (hasHydrated && !contact && pathname !== '/portal/login') {
      router.replace('/portal/login');
    }
  }, [contact, hasHydrated, pathname, router]);

  // Refresh branding on every load — this session's cached logo/colors may be stale if
  // the agency updated their branding since this client last logged in.
  useEffect(() => {
    if (!hasHydrated || !contact) return;
    fetch(`${API_URL}/portal/branding`)
      .then((r) => r.json())
      .then((data) => setBranding(data))
      .catch(() => {});
  }, [hasHydrated, contact]); // eslint-disable-line react-hooks/exhaustive-deps

  // Messages nav only when this contact was invited into their client room.
  const { data: messageRooms = [] } = useQuery({
    queryKey: ['portal-message-rooms-nav'],
    queryFn: () => portalFetch('/portal/messages/rooms', token!),
    enabled: !!token && !!contact && pathname !== '/portal/login',
    refetchInterval: 60_000,
  });
  const hasMessages = (messageRooms as any[]).length > 0;

  if (!hasHydrated) return null;
  if (!contact && pathname !== '/portal/login') return null;

  if (pathname === '/portal/login') {
    return <div className="min-h-screen" style={{ background: '#F1F5F9' }}>{children}</div>;
  }

  const NAV = [
    { href: '/portal', label: 'Overview', icon: LayoutDashboard, exact: true },
    ...(hasMessages
      ? [{ href: '/portal/messages', label: 'Messages', icon: MessagesSquare, exact: false }]
      : []),
    { href: '/portal/invoices', label: 'Invoices', icon: FileText, exact: false },
    { href: '/portal/leads', label: 'Leads', icon: Target, exact: false },
  ];

  return (
    <div className="min-h-screen flex" style={{ background: '#F1F5F9' }}>

      {/* Session-wide message alerts. Uses the portal token, not the CRM one. */}
      <NotificationBridge token={token} portalMode />

      {/* ── Sidebar ── */}
      <aside className="w-[220px] shrink-0 flex flex-col min-h-screen sticky top-0 h-screen" style={{ background: '#0F172A' }}>

        {/* Brand — matches the CRM sidebar exactly (components/layout/Sidebar.tsx).
            Stacked, not side by side: at this sidebar width the logo and the
            brand name alongside each other left the name about 60px, which wrapped
            "Mohsin Designs Project Management" onto four lines. */}
        <div className="px-5 pt-6 pb-5 border-b border-white/[0.07]">
          <div className="flex flex-col gap-2 min-w-0">
            {logoUrl ? (
              // The logo is a dark navy wordmark on transparency, which would all
              // but vanish against this near-black background. `brightness-0
              // invert` flattens it to solid white so it reads cleanly, with no
              // white plate behind it.
              <img
                src={logoUrl}
                alt={brandName}
                className="h-7 w-auto max-w-[150px] object-contain object-left brightness-0 invert"
              />
            ) : (
              <span
                className="flex items-center justify-center w-8 h-8 rounded-lg text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: primaryColor }}
              >
                {brandName.charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold leading-snug">{brandName}</p>
              <p className="text-white/40 text-[10px] mt-0.5 tracking-wide uppercase">Client Portal</p>
            </div>
          </div>
        </div>

        {/* Client context */}
        <div className="px-5 py-3.5 border-b border-white/[0.07]">
          <p className="text-[10px] uppercase tracking-widest font-semibold text-white/30 mb-1">Workspace</p>
          <p className="text-sm text-white/80 font-medium truncate">{client?.name}</p>
          <p className="text-xs text-white/35 mt-0.5">{client?.currency} account</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                  active
                    ? 'text-white shadow-sm'
                    : 'text-white/50 hover:text-white/80 hover:bg-white/[0.06]',
                )}
                style={active ? { backgroundColor: primaryColor + '30', color: '#fff' } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" style={active ? { color: primaryColor } : {}} />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-white/[0.07] p-3">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl mb-0.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ backgroundColor: primaryColor + 'cc' }}>
              {contact ? getInitials(contact.name) : '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-white/90 truncate">{contact?.name}</p>
              <p className="text-[10px] text-white/35 truncate">{contact?.email}</p>
            </div>
          </div>
          <button
            onClick={() => { logout(); router.push('/portal/login'); }}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.06] rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Page content ── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-screen overflow-hidden">
        {/* Top header — consistent with admin panel */}
        <header className="h-14 bg-white border-b border-gray-200 px-6 flex items-center justify-end shrink-0">
          {token && <PortalNotificationBell token={token} />}
        </header>
        <main className={cn(
          'flex-1 min-h-0',
          isMessages ? 'overflow-hidden p-0 flex flex-col' : 'overflow-y-auto px-8 py-8',
        )}>
          {children}
        </main>
      </div>
    </div>
  );
}
