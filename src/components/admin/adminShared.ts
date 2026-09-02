/**
 * Shared constants/helpers used by multiple Admin tab components.
 *
 * Extracted from admin/page.tsx so each tab (BrandingTab, ServicesTab,
 * WorkflowsTab, RolesTab, PackagesTab, ClientReqBoilerplateTab,
 * DocumentTemplatesTab) can live in its own file without duplicating these.
 */

export const inp = 'w-full px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';
export const btn = 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
export const btnPrimary = `${btn} bg-brand-700 hover:bg-brand-800 text-white`;
export const btnGhost = `${btn} border border-gray-300 hover:bg-gray-50 text-gray-700`;
export const btnDanger = `${btn} border border-red-200 hover:bg-red-50 text-red-600`;

export function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

export const ALL_PERMISSIONS = [
  { key: 'projects.read',    label: 'View projects' },
  { key: 'projects.act',     label: 'Act on projects (submit / approve)' },
  { key: 'projects.create',  label: 'Create projects' },
  { key: 'projects.manage',  label: 'Manage projects (delete, reassign)' },
  { key: 'clients.read',     label: 'View clients' },
  { key: 'clients.manage',   label: 'Manage clients' },
  { key: 'users.read',       label: 'View team members' },
  { key: 'users.manage',     label: 'Manage team members' },
  { key: 'roles.read',       label: 'View roles' },
  { key: 'roles.create',     label: 'Create roles' },
  { key: 'roles.update',     label: 'Edit roles' },
  { key: 'roles.delete',     label: 'Delete roles' },
  { key: 'billing.read',     label: 'View invoices & billing' },
  { key: 'billing.manage',   label: 'Manage billing' },
  { key: 'personalInvoices.read', label: 'View & manage personal invoices' },
  { key: 'hr.read',          label: 'View HR & payroll' },
  { key: 'hr.manage',        label: 'Manage HR & payroll' },
  { key: 'admin.access',     label: 'Access admin panel' },
  { key: 'reports.read',     label: 'View member reports' },
  { key: 'seo.read',         label: 'View SEO data' },
  { key: 'seo.manage',       label: 'Manage SEO data' },
];

export const STAGE_TYPES = ['work', 'approval'] as const;
export const ADVANCE_RULES = ['single_action', 'all_tasks_done', 'all_tasks_approved', 'manual'] as const;
export const ACTIONS = ['complete', 'approve', 'reject', 'rewind'] as const;

export const CLIENT_REQ_FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Dropdown (multi-select)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File attachment' },
] as const;

export const MERGE_TOKENS = [
  'customer_name', 'business_name', 'customer_email', 'customer_phone',
  'email', 'phone', 'agency_email', 'agency_phone',
  'service', 'package',
  'price', 'currency', 'scope', 'terms', 'date', 'valid_until', 'agency_name',
  'discount', 'services_block', 'subtotal', 'total',
];

// Which company details print by default on the Keywords/Backlinks SEO report
// letterhead (project page → Keywords/Backlinks tabs). Only Logo is checked by
// default — the full address/tax/contact block used to print unconditionally.
export const SEO_REPORT_FIELD_OPTS = [
  { key: 'logo',    label: 'Logo' },
  { key: 'name',    label: 'Company Name' },
  { key: 'address', label: 'Address' },
  { key: 'tax',     label: 'Tax/EIN' },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'note',    label: 'Note' },
];
