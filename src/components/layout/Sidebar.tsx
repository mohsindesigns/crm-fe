'use client';

import Link from 'next/link';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FolderKanban, Users,
  FileText, Settings, ChevronDown, Bell,
  Briefcase, ClipboardList, BarChart2, UserCog, Receipt, DollarSign, RefreshCw,
  Palette, Workflow, Shield, Package, FileSignature, ScrollText, Clock, MessagesSquare,
  Building2, CreditCard, Target, PieChart, History,
  ClipboardCheck, ShieldCheck, Download, KeyRound, Link2,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { useBranding } from '@/hooks/useBranding';
import { requiredPermissionFor, marksAttendance } from '@/lib/routePermissions';
import { BRAND } from '@/lib/brand';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sidebar, SidebarContent, SidebarHeader, SidebarGroup, SidebarMenu, SidebarMenuItem,
  SidebarMenuButton, SidebarMenuBadge, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  useSidebar,
} from '@/components/ui/sidebar';

// `permission` for each item is derived from routePermissions.ts (single
// source of truth also enforced by DashboardLayout) rather than hardcoded
// here — hiding a link and actually protecting the route must never drift
// out of sync with each other.
const NAV_ITEMS = [
  { label: 'Dashboard',    href: '/dashboard' as const,     icon: LayoutDashboard },
  { label: 'Projects',     href: '/projects' as const,      icon: FolderKanban },
  { label: 'Clients',      href: '/clients' as const,       icon: Briefcase },
  { label: 'Tasks',        href: '/tasks' as const,         icon: ClipboardList },
  { label: 'Approvals',    href: '/approvals' as const,     icon: ClipboardCheck },
  { label: 'Messages',     href: '/messages' as const,      icon: MessagesSquare },
  { label: 'Leads',        href: '/leads' as const,         icon: Target },
  { label: 'Notifications', href: '/notifications' as const, icon: Bell },
  { label: 'Invoices',     href: '/invoices' as const,      icon: FileText },
  { label: 'Quotes & Agreements', href: '/documents' as const, icon: FileSignature },
  { label: 'Billing',      href: '/billing' as const,       icon: DollarSign },
  { label: 'Retainers',    href: '/retainers' as const,     icon: RefreshCw },
  { label: 'Team',         href: '/team' as const,          icon: Users },
  { label: 'HR & Payroll', href: '/hr' as const,            icon: UserCog },
  // Org-wide policy config, gathered in one place instead of scattered across
  // settings screens — the timing here is the default every current
  // employee's attendance is judged against (no per-employee override).
  { label: 'Policies',     href: '/policies/attendance' as const, icon: ShieldCheck },
  { label: 'My Payroll',   href: '/self-service' as const,  icon: Receipt },
  // Personal attendance marking — hidden for roles that don't clock in (see
  // marksAttendance), unless they can review everyone's attendance, in which
  // case this same page shows the org-wide board instead.
  { label: 'Attendance',   href: '/self-service?tab=attendance' as const, icon: Clock, attendanceOnly: true },
  { label: 'Analytics',    href: '/analytics' as const,     icon: BarChart2 },
  { label: 'Reports',      href: '/reports' as const,       icon: PieChart },
  { label: 'Activity Logs', href: '/activity-logs' as const, icon: History },
].map((item) => ({ ...item, permission: requiredPermissionFor(item.href.split('?')[0]) }));

// Mirrors the view switcher on the Tasks page itself (src/app/(dashboard)/tasks/page.tsx)
// — 'all' is filtered out below for anyone without projects.manage, same gate
// that page uses for its own "All Tasks" pill. 'overdue' has no permission gate:
// everyone gets the tab, but the page itself scopes it to org-wide vs. just-mine
// the same way it already does for Approvals/Completed.
const TASK_SUB_ITEMS = [
  { label: 'My Tasks',       view: 'mine' },
  { label: 'Assigned by me', view: 'assigned_by_me' },
  { label: 'All Tasks',      view: 'all', permission: 'projects.manage' },
  { label: 'Overdue',        view: 'overdue' },
  { label: 'Approvals',      view: 'approvals' },
  { label: 'Completed',      view: 'completed' },
];

// Only one policy area exists today (Attendance), but this is structured as
// a submenu — not a plain link — so future policy pages (leave, holidays,
// etc.) have an obvious place to land without another sidebar redesign.
const POLICY_SUB_ITEMS = [
  { label: 'Attendance', href: '/policies/attendance' as const, icon: Clock },
];

// Official is the existing invoicing system (billing.read), unchanged.
// Personal is a fully separate section — its own contacts/numbering/data,
// gated by its own permission so it can be granted independently of who has
// billing.* access. See crm-be PersonalInvoice model for why it's a separate
// table rather than a flag on Invoice.
const INVOICE_SUB_ITEMS = [
  { label: 'Official', href: '/invoices' as const, icon: FileText },
  { label: 'Personal', href: '/personal-invoices' as const, icon: CreditCard, permission: 'personalInvoices.read' },
];

const REPORTS_SUB_ITEMS = [
  { label: 'Team Reports',     href: '/reports' as const,          icon: PieChart },
  { label: 'Keyword Reports',  href: '/reports/keywords' as const, icon: KeyRound },
  { label: 'Backlink Reports', href: '/reports/backlinks' as const, icon: Link2 },
];

const ADMIN_SUB_ITEMS = [
  { label: 'Branding',   tab: 'branding',   icon: Palette  },
  { label: 'Companies',  tab: 'companies',  icon: Building2 },
  { label: 'Payments',   tab: 'payments',   icon: CreditCard },
  { label: 'Services',   tab: 'services',   icon: Settings },
  { label: 'Workflows',  tab: 'workflows',  icon: Workflow },
  { label: 'Roles',      tab: 'roles',      icon: Shield   },
  { label: 'Packages',   tab: 'packages',   icon: Package  },
  { label: 'Document Templates', tab: 'templates', icon: ScrollText },
  { label: 'Client Req Boilerplate', tab: 'client-req-forms', icon: ClipboardCheck },
  { label: 'Export Data', tab: 'export', icon: Download },
];

type IconType = React.ElementType;

// A group with an expandable submenu (Tasks / Policies / Invoices / Reports /
// Admin). On the icon-collapsed rail there's no room for a submenu, so it
// renders as a plain link straight to `railHref` instead of a toggle —
// SidebarMenuButton's own `tooltip` prop covers the rail hover label, so no
// bespoke tooltip component is needed here.
function NavGroup({
  icon: Icon, label, railHref, active, open, onOpenChange, activeBg, activeIconColor, children,
}: {
  icon: IconType; label: string; railHref: string; active: boolean;
  open: boolean; onOpenChange: (open: boolean) => void;
  activeBg: string; activeIconColor: string; children: React.ReactNode;
}) {
  const { state, isMobile } = useSidebar();
  const collapsedRail = !isMobile && state === 'collapsed';

  if (collapsedRail) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={label}>
          <Link href={railHref} style={active ? { backgroundColor: activeBg, color: '#fff' } : {}}>
            <Icon className="w-4 h-4 shrink-0" style={active ? { color: activeIconColor } : {}} />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton isActive={active} style={active ? { backgroundColor: activeBg, color: '#fff' } : {}}>
            <Icon className="w-4 h-4 shrink-0" style={active ? { color: activeIconColor } : {}} />
            <span>{label}</span>
            <ChevronDown className={cn('ml-auto w-3.5 h-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')} />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>{children}</SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function NavSubLink({
  href, label, icon: Icon, active, activeBg, activeIconColor,
}: {
  href: string; label: string; icon?: IconType; active: boolean; activeBg: string; activeIconColor: string;
}) {
  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton asChild isActive={active}>
        <Link href={href} style={active ? { backgroundColor: activeBg, color: '#fff' } : {}}>
          {Icon && <Icon className="w-3.5 h-3.5 shrink-0" style={active ? { color: activeIconColor } : {}} />}
          <span>{label}</span>
        </Link>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

function NavItem({
  href, label, icon: Icon, active, activeBg, activeIconColor, badgeCount,
}: {
  href: string; label: string; icon: IconType; active: boolean;
  activeBg: string; activeIconColor: string; badgeCount?: number;
}) {
  const { state, isMobile } = useSidebar();
  const collapsedRail = !isMobile && state === 'collapsed';

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={badgeCount ? `${label} (${badgeCount})` : label}>
        <Link href={href} style={active ? { backgroundColor: activeBg, color: '#fff' } : {}}>
          <span className="relative shrink-0 w-4 h-4">
            <Icon className="w-4 h-4" style={active ? { color: activeIconColor } : {}} />
            {collapsedRail && !!badgeCount && (
              <span
                className="absolute -top-1 -right-1 w-2 h-2 rounded-full ring-2 ring-[#0F172A]"
                style={{ backgroundColor: activeIconColor }}
              />
            )}
          </span>
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {!collapsedRail && !!badgeCount && (
        <SidebarMenuBadge className="text-white" style={{ backgroundColor: activeIconColor, color: '#0F172A' }}>
          {badgeCount > 99 ? '99+' : badgeCount}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );
}

export default function AppSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { hasPermission } = useAuthStore();
  const roleKey = useAuthStore((s) => s.user?.role?.key);
  const { brandName, primaryColor, logoUrl } = useBranding();
  const { state, isMobile } = useSidebar();
  const collapsedRail = !isMobile && state === 'collapsed';
  // Gold accent contrasts on the dark navy sidebar; primary navy blends into #0F172A.
  const activeIconColor = BRAND.accent;
  const activeBg = `${primaryColor}55`;

  const isAdminPath = pathname.startsWith('/admin');
  const [adminOpen, setAdminOpen] = useState(isAdminPath);

  const isTasksPath = pathname.startsWith('/tasks');
  const [tasksOpen, setTasksOpen] = useState(isTasksPath);

  const isPoliciesPath = pathname.startsWith('/policies');
  const [policiesOpen, setPoliciesOpen] = useState(isPoliciesPath);

  const isReportsPath = pathname.startsWith('/reports');
  const [reportsOpen, setReportsOpen] = useState(isReportsPath);

  const isInvoicesPath = pathname.startsWith('/invoices') || pathname.startsWith('/personal-invoices');
  const [invoicesOpen, setInvoicesOpen] = useState(isInvoicesPath);

  // Auto-expand when navigating to admin / tasks / policies / reports / invoices
  useEffect(() => { if (isAdminPath) setAdminOpen(true); }, [isAdminPath]);
  useEffect(() => { if (isTasksPath) setTasksOpen(true); }, [isTasksPath]);
  useEffect(() => { if (isPoliciesPath) setPoliciesOpen(true); }, [isPoliciesPath]);
  useEffect(() => { if (isReportsPath) setReportsOpen(true); }, [isReportsPath]);
  useEffect(() => { if (isInvoicesPath) setInvoicesOpen(true); }, [isInvoicesPath]);

  const currentTab = searchParams.get('tab') || 'branding';
  const canSeeAttendance = marksAttendance(roleKey) || hasPermission('hr.read');
  // The Invoices entry now covers two independently-permissioned sub-items
  // (Official = billing.read, Personal = personalInvoices.read), so the
  // parent link must show for either — routePermissions.ts only names one
  // permission per route and would otherwise hide Personal entirely from a
  // user who has personalInvoices.read but not billing.read.
  const visibleNav = NAV_ITEMS.filter((i) => {
    if (i.href === '/invoices') return hasPermission('billing.read') || hasPermission('personalInvoices.read');
    return (!i.permission || hasPermission(i.permission))
      && (!('attendanceOnly' in i && i.attendanceOnly) || canSeeAttendance);
  });
  const showAdmin = hasPermission('admin.access');

  // Same permission the Tasks page itself gates "All Tasks" on, and the same
  // rule it uses to pick which view a bare /tasks (no ?view=) lands on.
  const canSeeAllTasksNav = hasPermission('projects.manage');
  const visibleTaskSubItems = TASK_SUB_ITEMS.filter((i) => !i.permission || hasPermission(i.permission));
  const activeTaskView = searchParams.get('view') || (canSeeAllTasksNav ? 'all' : 'mine');

  const visibleInvoiceSubItems = INVOICE_SUB_ITEMS.filter((i) => !i.permission || hasPermission(i.permission));

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

  // Pending-approval badge. `/approvals/summary` is a counts-only endpoint and
  // is scoped per source by the backend, so this is the same number the user
  // will actually see on the page — no permission filtering needed here.
  const { data: approvalSummary } = useQuery<{ totals: { pending: number } }>({
    queryKey: ['approvals-summary'],
    queryFn: () => api.get('/approvals/summary').then((r) => r.data),
    refetchInterval: 60_000,
  });
  const pendingApprovals = approvalSummary?.totals?.pending || 0;

  const BADGE_COUNTS: Record<string, number> = {
    '/messages': unreadMessages,
    '/notifications': unreadNotifications,
    '/approvals': pendingApprovals,
  };

  return (
    <Sidebar collapsible="icon" className="border-white/[0.07]" style={{ '--sidebar': '#0F172A' } as React.CSSProperties}>
      <SidebarHeader className={cn('pt-6 pb-5 border-b border-white/[0.07]', collapsedRail ? 'px-2' : 'px-5')}>
        <div className={cn('flex flex-col gap-2 min-w-0', collapsedRail && 'items-center')}>
          {logoUrl ? (
            // The logo is a dark navy wordmark on transparency, which would all
            // but vanish against this sidebar's near-black background. Rather
            // than sit it on a white plate, `brightness-0 invert` flattens it to
            // solid white — the mark reads cleanly with no visible box behind it.
            <img
              src={logoUrl}
              alt={brandName}
              className={cn('h-7 w-auto max-w-[150px] object-contain object-left brightness-0 invert', collapsedRail && 'hidden')}
            />
          ) : (
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {brandName.charAt(0)}
            </span>
          )}
          {logoUrl && collapsedRail && (
            <span
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: primaryColor }}
            >
              {brandName.charAt(0)}
            </span>
          )}
          <p className={cn('text-white text-xs font-semibold leading-snug', collapsedRail && 'hidden')}>{brandName}</p>
        </div>
      </SidebarHeader>

      <SidebarContent className="sidebar-scroll">
        <SidebarGroup>
          <SidebarMenu>
            {visibleNav.map((item) => {
              const [hrefPath, hrefQuery] = item.href.split('?');
              const hrefTab = new URLSearchParams(hrefQuery).get('tab');
              // Items that carry a `?tab=` (e.g. Attendance -> /self-service?tab=attendance)
              // must also match the current tab, otherwise "My Payroll" (no tab) and
              // "Attendance" would both light up simultaneously on that page.
              const active = !!(
                (pathname === hrefPath || pathname.startsWith(hrefPath + '/'))
                && (!hrefTab || searchParams.get('tab') === hrefTab)
                && (hrefTab || !searchParams.get('tab'))
              );

              if (item.href === '/tasks') {
                return (
                  <NavGroup
                    key={item.href} icon={item.icon} label={item.label} railHref={item.href}
                    active={isTasksPath} open={tasksOpen} onOpenChange={setTasksOpen}
                    activeBg={activeBg} activeIconColor={activeIconColor}
                  >
                    {visibleTaskSubItems.map((sub) => (
                      <NavSubLink
                        key={sub.view} href={`/tasks?view=${sub.view}`} label={sub.label}
                        active={isTasksPath && activeTaskView === sub.view}
                        activeBg={`${primaryColor}40`} activeIconColor={activeIconColor}
                      />
                    ))}
                  </NavGroup>
                );
              }

              if (item.href === '/policies/attendance') {
                return (
                  <NavGroup
                    key={item.href} icon={item.icon} label={item.label} railHref={item.href}
                    active={isPoliciesPath} open={policiesOpen} onOpenChange={setPoliciesOpen}
                    activeBg={activeBg} activeIconColor={activeIconColor}
                  >
                    {POLICY_SUB_ITEMS.map((sub) => (
                      <NavSubLink
                        key={sub.href} href={sub.href} label={sub.label} icon={sub.icon}
                        active={pathname === sub.href || pathname.startsWith(`${sub.href}/`)}
                        activeBg={`${primaryColor}40`} activeIconColor={activeIconColor}
                      />
                    ))}
                  </NavGroup>
                );
              }

              if (item.href === '/invoices') {
                return (
                  <NavGroup
                    key={item.href} icon={item.icon} label={item.label} railHref={item.href}
                    active={isInvoicesPath} open={invoicesOpen} onOpenChange={setInvoicesOpen}
                    activeBg={activeBg} activeIconColor={activeIconColor}
                  >
                    {visibleInvoiceSubItems.map((sub) => (
                      <NavSubLink
                        key={sub.href} href={sub.href} label={sub.label} icon={sub.icon}
                        active={pathname === sub.href || pathname.startsWith(`${sub.href}/`)}
                        activeBg={`${primaryColor}40`} activeIconColor={activeIconColor}
                      />
                    ))}
                  </NavGroup>
                );
              }

              if (item.href === '/reports') {
                // '/reports' is itself a prefix of every other sub-route, so a plain
                // startsWith would light up every row at once — Team Reports only
                // claims '/reports' and its own '/reports/[id]' detail route, not
                // any of the other sub-items' routes.
                const otherSubRoutes = REPORTS_SUB_ITEMS.filter((s) => s.href !== '/reports');
                return (
                  <NavGroup
                    key={item.href} icon={item.icon} label={item.label} railHref={item.href}
                    active={isReportsPath} open={reportsOpen} onOpenChange={setReportsOpen}
                    activeBg={activeBg} activeIconColor={activeIconColor}
                  >
                    {REPORTS_SUB_ITEMS.map((sub) => {
                      const subActive = sub.href === '/reports'
                        ? pathname === '/reports' || (pathname.startsWith('/reports/') && !otherSubRoutes.some((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)))
                        : pathname === sub.href || pathname.startsWith(`${sub.href}/`);
                      return (
                        <NavSubLink
                          key={sub.href} href={sub.href} label={sub.label} icon={sub.icon}
                          active={subActive}
                          activeBg={`${primaryColor}40`} activeIconColor={activeIconColor}
                        />
                      );
                    })}
                  </NavGroup>
                );
              }

              return (
                <NavItem
                  key={item.href} href={item.href} label={item.label} icon={item.icon}
                  active={active} activeBg={activeBg} activeIconColor={activeIconColor}
                  badgeCount={BADGE_COUNTS[item.href]}
                />
              );
            })}

            {showAdmin && (
              <>
                <div className={cn('pt-4 pb-1 px-2', collapsedRail && 'hidden')}>
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-white/25">Admin</span>
                </div>
                {collapsedRail && <div className="my-2 mx-2 border-t border-white/[0.07]" />}

                {/* Collapsed rail: no room for a submenu at icon width, so this
                    jumps straight to the panel — same as every other rail icon. */}
                {collapsedRail ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={isAdminPath}
                      tooltip="Admin Panel"
                      onClick={() => router.push('/admin?tab=branding')}
                      style={isAdminPath ? { backgroundColor: activeBg, color: '#fff' } : {}}
                    >
                      <Settings className="w-4 h-4 shrink-0" style={isAdminPath ? { color: activeIconColor } : {}} />
                      <span>Admin Panel</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  <Collapsible open={adminOpen} onOpenChange={setAdminOpen} asChild>
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton isActive={isAdminPath} style={isAdminPath ? { backgroundColor: activeBg, color: '#fff' } : {}}>
                          <Settings className="w-4 h-4 shrink-0" style={isAdminPath ? { color: activeIconColor } : {}} />
                          <span>Admin Panel</span>
                          <ChevronDown className={cn('ml-auto w-3.5 h-3.5 transition-transform duration-200', adminOpen && 'rotate-180')} />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {ADMIN_SUB_ITEMS.map((sub) => (
                            <NavSubLink
                              key={sub.tab} href={`/admin?tab=${sub.tab}`} label={sub.label} icon={sub.icon}
                              active={isAdminPath && currentTab === sub.tab}
                              activeBg={`${primaryColor}40`} activeIconColor={activeIconColor}
                            />
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                )}
              </>
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
