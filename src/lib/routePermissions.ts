// Single source of truth for which top-level route prefixes require which
// permission. Consumed by both the Sidebar (to hide nav items) and
// DashboardLayout (to actually enforce access) — hiding a nav link does NOT
// protect a route from a user typing the URL directly, which is exactly the
// gap this file closes. Keep this in sync with Sidebar.tsx's NAV_ITEMS.
export interface RoutePermission {
  href: string;
  permission: string | null;
}

export const ROUTE_PERMISSIONS: RoutePermission[] = [
  { href: '/dashboard', permission: null },
  { href: '/projects', permission: 'projects.read' },
  { href: '/clients', permission: 'clients.read' },
  { href: '/tasks', permission: null },
  // Unrestricted on purpose: the approvals inbox is a cross-cutting queue whose
  // *contents* are gated per source by the backend (projects.read for task/SEO
  // queues, hr.read — or simply having a Worker row — for HR ones). Any single
  // permission here would lock out the employee whose own leave request is the
  // one thing they can see on it. See crm-be/src/routes/approvals.js.
  { href: '/approvals', permission: null },
  { href: '/messages', permission: 'projects.read' },
  { href: '/leads', permission: 'leads.read' },
  { href: '/notifications', permission: null },
  { href: '/invoices', permission: 'billing.read' },
  // Deliberately its own permission, not billing.read — Personal invoices are
  // a fully separate section (own contacts/numbering/data) that must be
  // grantable independently of who can see official billing.
  { href: '/personal-invoices', permission: 'personalInvoices.read' },
  { href: '/documents', permission: 'admin.access' },
  { href: '/billing', permission: 'billing.read' },
  { href: '/retainers', permission: 'billing.read' },
  { href: '/team', permission: 'users.read' },
  { href: '/hr', permission: 'hr.read' },
  { href: '/policies', permission: 'hr.read' },
  { href: '/self-service', permission: null },
  { href: '/analytics', permission: 'admin.access' },
  { href: '/reports', permission: 'reports.read' },
  { href: '/activity-logs', permission: 'admin.access' },
  { href: '/admin', permission: 'admin.access' },
];

// Roles that don't mark attendance — owners, admins and partners run the
// company rather than clock in against a shift. Mirrors the server-side list in
// cadence-be/src/services/HrService.js#NON_ATTENDANCE_ROLE_KEYS; keep the two in
// sync. Any role key containing "partner" counts, since partner roles are
// org-defined (`partner`, `managing_partner`, …).
const NON_ATTENDANCE_ROLE_KEYS = ['super_admin', 'admin', 'partner'];

export function marksAttendance(roleKey: string | null | undefined): boolean {
  const key = String(roleKey || '').trim().toLowerCase();
  if (!key) return true;
  return !NON_ATTENDANCE_ROLE_KEYS.includes(key) && !key.includes('partner');
}

// Matches the longest (most specific) href prefix so sub-routes like
// "/documents/new" or "/hr/workers/abc-123" inherit their parent's permission.
// Returns null if the route is unrestricted OR unrecognized (unlisted routes
// are treated as open rather than silently locking out a page nobody gated).
export function requiredPermissionFor(pathname: string): string | null {
  const match = [...ROUTE_PERMISSIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((r) => pathname === r.href || pathname.startsWith(`${r.href}/`));
  return match ? match.permission : null;
}
