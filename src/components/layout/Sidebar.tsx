'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Users,
  FileText, Settings, ChevronDown, Bell,
  Briefcase, ClipboardList, BarChart2, UserCog, Receipt, DollarSign, RefreshCw,
  Palette, Workflow, Shield, Package, X, FileSignature, ScrollText, Clock, MessagesSquare,
  Building2, CreditCard,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/hooks/useBranding';
import { useSidebarStore } from '@/store/sidebar';
import { requiredPermissionFor, marksAttendance } from '@/lib/routePermissions';
import { BRAND } from '@/lib/brand';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

// `permission` for each item is derived from routePermissions.ts (single
// source of truth also enforced by DashboardLayout) rather than hardcoded
// here — hiding a link and actually protecting the route must never drift
// out of sync with each other.
const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/dashboard' as const,     icon: LayoutDashboard },
  { label: 'Projects',     href: '/projects' as const,      icon: FolderKanban },
  { label: 'Clients',      href: '/clients' as const,       icon: Briefcase },
  { label: 'Tasks',        href: '/tasks' as const,         icon: ClipboardList },
  { label: 'Messages',     href: '/messages' as const,      icon: MessagesSquare },
  { label: 'Notifications', href: '/notifications' as const, icon: Bell },
  { label: 'Invoices',     href: '/invoices' as const,      icon: FileText },
  { label: 'Quotes & Agreements', href: '/documents' as const, icon: FileSignature },
  { label: 'Billing',      href: '/billing' as const,       icon: DollarSign },
  { label: 'Retainers',    href: '/retainers' as const,     icon: RefreshCw },
  { label: 'Team',         href: '/team' as const,          icon: Users },
  { label: 'HR & Payroll', href: '/hr' as const,            icon: UserCog },
  { label: 'My Payroll',   href: '/self-service' as const,  icon: Receipt },
  // Personal attendance marking — hidden for roles that don't clock in (see
  // marksAttendance), unless they can review everyone's attendance, in which
  // case this same page shows the org-wide board instead.
  { label: 'Attendance',   href: '/self-service?tab=attendance' as const, icon: Clock, attendanceOnly: true },
  { label: 'Analytics',    href: '/analytics' as const,     icon: BarChart2 },
].map((item) => ({ ...item, permission: requiredPermissionFor(item.href.split('?')[0]) }));

const ADMIN_SUB_ITEMS = [
  { label: 'Branding',   tab: 'branding',   icon: Palette  },
  { label: 'Companies',  tab: 'companies',  icon: Building2 },
  { label: 'Payments',   tab: 'payments',   icon: CreditCard },
  { label: 'Services',   tab: 'services',   icon: Settings },
  { label: 'Workflows',  tab: 'workflows',  icon: Workflow },
  { label: 'Roles',      tab: 'roles',      icon: Shield   },
  { label: 'Packages',   tab: 'packages',   icon: Package  },
  { label: 'Document Templates', tab: 'templates', icon: ScrollText },
];

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuthStore();
  const roleKey = useAuthStore((s) => s.user?.role?.key);
  const { brandName, primaryColor, logoUrl } = useBranding();
  const { isOpen, close } = useSidebarStore();
  // Gold accent contrasts on the dark navy sidebar; primary navy blends into #0F172A.
  const activeIconColor = BRAND.accent;
  const activeBg = `${primaryColor}55`;

  const isAdminPath = pathname.startsWith('/admin');
  const [adminOpen, setAdminOpen] = useState(isAdminPath);

  // Auto-expand when navigating to admin
  useEffect(() => {
    if (isAdminPath) setAdminOpen(true);
  }, [isAdminPath]);

  // Close drawer on navigation
  useEffect(() => {
    close();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentTab = searchParams.get('tab') || 'branding';
  const canSeeAttendance = marksAttendance(roleKey) || hasPermission('hr.read');
  const visibleNav = NAV_ITEMS.filter((i) => (!i.permission || hasPermission(i.permission))
    && (!('attendanceOnly' in i && i.attendanceOnly) || canSeeAttendance));
  const showAdmin  = hasPermission('admin.access');

  const canSeeMessages = hasPermission('projects.read');

  const { data: messageRooms = [] } = useQuery({
    queryKey: ['message-rooms-sidebar', 'active'],
    queryFn: () => api.get('/messages/rooms?status=active').then((r) => r.data || []),
    refetchInterval: 60_000,
    enabled: canSeeMessages,
  });
  const unreadMessages = (messageRooms as any[]).reduce((sum, r) => sum + (r.unread || 0), 0);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications-sidebar'],
    queryFn: () => api.get('/notifications').then((r) => r.data || []),
    refetchInterval: 30_000,
  });
  const unreadNotifications = (notifications as any[]).filter((n) => !n.isRead).length;

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-300',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        onClick={close}
      />

      <aside
        className={cn(
          // The ASIDE is the scroll container, not an inner flex child. Relying on
          // `flex-1 + overflow-y-auto` on the <nav> meant scrolling only worked if
          // the flex chain resolved to a definite height — one wrong link in that
          // chain and the list just clipped with no way to reach the rest.
          // A fixed height plus overflow here cannot fail that way.
          //
          'w-55 overflow-y-auto overscroll-contain sidebar-scroll',
          // Mobile: pinned top AND bottom rather than given a height. iOS Safari
          // does not reliably recompute a `100dvh` height on a fixed element as
          // the URL bar collapses, so the drawer could stay taller than the
          // visible viewport — the content then fits its own box, nothing
          // overflows, and the list simply refuses to scroll (Android recomputes
          // it, which is why it only broke on iPhone). Deriving the height from
          // top-0 + bottom-0 makes the browser use the visual viewport, which it
          // always keeps correct.
          'fixed top-0 bottom-0 left-0 z-50 transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: sticky in document flow, always visible — needs an explicit
          // height since it is no longer stretched between two edges.
          'md:sticky md:top-0 md:bottom-auto md:h-dvh md:shrink-0 md:translate-x-0 md:z-auto',
        )}
        style={{ background: '#0F172A' }}
      >
      {/* ── Brand ── */}
      {/* Sticky, with its own background: the aside scrolls now, so without this
          the logo would scroll away and the links would run underneath it. */}
      <div
        className="sticky top-0 z-10 px-5 pt-6 pb-5 border-b border-white/[0.07] flex items-start justify-between gap-2"
        style={{ background: '#0F172A' }}
      >
        {/* The wordmark is a wide horizontal logo, so it stacks above the brand
            name rather than sitting beside it — side by side, the two together
            overflowed the sidebar's fixed width. */}
        <div className="flex flex-col gap-2 min-w-0">
          {logoUrl ? (
            // The logo is a dark navy wordmark on transparency, which would all
            // but vanish against this sidebar's near-black background. Rather
            // than sit it on a white plate, `brightness-0 invert` flattens it to
            // solid white — the mark reads cleanly with no visible box behind it.
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
          <p className="text-white text-xs font-semibold leading-snug">{brandName}</p>
        </div>
        {/* Close button — mobile only */}
        <button
          onClick={close}
          className="md:hidden p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Navigation ── */}
      {/* Plain flow — the aside above is what scrolls. The bottom pad clears the
          iPhone home indicator; without it the final link sits under the gesture
          bar, reachable by scroll but not by tap. */}
      <nav className="px-3 py-3 space-y-0.5 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {visibleNav.map((item) => {
          const [hrefPath, hrefQuery] = item.href.split('?');
          const hrefTab = new URLSearchParams(hrefQuery).get('tab');
          // Items that carry a `?tab=` (e.g. Attendance -> /self-service?tab=attendance)
          // must also match the current tab, otherwise "My Payroll" (no tab) and
          // "Attendance" would both light up simultaneously on that page.
          const active = (pathname === hrefPath || pathname.startsWith(hrefPath + '/'))
            && (!hrefTab || searchParams.get('tab') === hrefTab)
            && (hrefTab || !searchParams.get('tab'));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all',
                active
                  ? 'text-white shadow-sm'
                  : 'text-white/75 hover:text-white hover:bg-white/6',
              )}
              style={active ? { backgroundColor: activeBg, color: '#fff' } : {}}
            >
              <item.icon
                className="w-4 h-4 shrink-0"
                style={active ? { color: activeIconColor } : {}}
              />
              <span className="flex items-center gap-2 min-w-0">
                <span className="truncate">{item.label}</span>
                {item.href === '/messages' && unreadMessages > 0 && (
                  <span
                    className="ml-auto text-[10px] font-bold min-w-[1.15rem] h-[1.15rem] px-1 rounded-full flex items-center justify-center text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {unreadMessages > 99 ? '99+' : unreadMessages}
                  </span>
                )}
                {item.href === '/notifications' && unreadNotifications > 0 && (
                  <span
                    className="ml-auto text-[10px] font-bold min-w-[1.15rem] h-[1.15rem] px-1 rounded-full flex items-center justify-center text-white"
                    style={{ backgroundColor: primaryColor }}
                  >
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </span>
            </Link>
          );
        })}

        {showAdmin && (
          <>
            <div className="pt-4 pb-1 px-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Admin</span>
            </div>

            {/* Admin Panel — expandable */}
            <button
              onClick={() => setAdminOpen((v) => !v)}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all w-full',
                isAdminPath
                  ? 'text-white shadow-sm'
                  : 'text-white/75 hover:text-white hover:bg-white/6',
              )}
              style={isAdminPath ? { backgroundColor: activeBg } : {}}
            >
              <Settings
                className="w-4 h-4 shrink-0"
                style={isAdminPath ? { color: activeIconColor } : {}}
              />
              <span className="flex-1 text-left">Admin Panel</span>
              <ChevronDown
                className={cn('w-3.5 h-3.5 transition-transform duration-200', adminOpen && 'rotate-180')}
                style={isAdminPath ? { color: activeIconColor } : { color: 'rgba(255,255,255,0.4)' }}
              />
            </button>

            {/* Submenu */}
            {adminOpen && (
              <div className="ml-3 pl-3 border-l border-white/[0.07] space-y-0.5 mt-0.5">
                {ADMIN_SUB_ITEMS.map((sub) => {
                  const subActive = isAdminPath && currentTab === sub.tab;
                  return (
                    <Link
                      key={sub.tab}
                      href={`/admin?tab=${sub.tab}`}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                        subActive
                          ? 'text-white'
                          : 'text-white/60 hover:text-white hover:bg-white/6',
                      )}
                      style={subActive ? { backgroundColor: `${primaryColor}40`, color: '#fff' } : {}}
                    >
                      <sub.icon
                        className="w-3.5 h-3.5 shrink-0"
                        style={subActive ? { color: activeIconColor } : {}}
                      />
                      {sub.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </>
        )}
      </nav>
    </aside>
    </>
  );
}
