'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Globe, Mail, Phone, User, Users, FileText, FileSignature, Briefcase, Pencil, X, Save, Package, Layers, RefreshCw, AlertCircle, FolderKanban } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle, { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import Avatar from '@/components/Avatar';
import { useAuthStore } from '@/store/auth';
import { cn, formatDate, formatCurrency, titleCase, inactiveRow } from '@/lib/utils';
import { invalidateMany, afterClientChange } from '@/lib/queryInvalidation';
import { usersForRoleSlot } from '@/lib/projectTeam';
import { TimelineSteps } from '@/components/TimelineSteps';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { STAT_TINTS } from '@/components/dashboard/StatCard';
import BarChartCard from '@/components/charts/BarChartCard';

/** Mirrors ClientService._validateContact — a contact we can't email is a
 *  contact we can't send a quotation, an invoice, or a portal login code to. */
function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  paused: 'bg-amber-100 text-amber-700',
  churned: 'bg-red-100 text-red-700',
};

const INV_STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  paid: 'bg-brand-100 text-brand-800',
  overdue: 'bg-red-100 text-red-700',
  payment_review: 'bg-amber-100 text-amber-700',
  void: 'bg-gray-100 text-gray-400',
};

const PROJ_STATUS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  completed: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

const DOC_STATUS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-violet-100 text-violet-700',
  approved: 'bg-brand-100 text-brand-800',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
};

type Tab = 'overview' | 'timeline' | 'contacts' | 'packages' | 'subscriptions' | 'projects' | 'invoices' | 'quotations' | 'proposals' | 'agreements';

const CP_STATUS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  pending: 'bg-amber-100 text-amber-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

// Whether the client may actually USE a subscription right now — a separate
// question from CP_STATUS above, which is where the SALE stands. Mirrors
// ClientPackage.entitlement; see crm-be/src/services/SubscriptionService.js,
// which derives it from the subscription's own invoices and is the only thing
// that writes it.
const CYCLE_LABELS: Record<string, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

const ENTITLEMENT_LABELS: Record<string, string> = {
  active: 'Usable',
  pending_payment: 'Awaiting payment',
  suspended: 'Suspended — unpaid',
  cancelled: 'Cancelled',
};

const ENTITLEMENT_COLORS: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  pending_payment: 'bg-amber-100 text-amber-800',
  suspended: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-500',
};

/**
 * The Packages tab lists work the agency DELIVERS. Subscriptions are sold
 * through the same ClientPackage table but have their own tab, so they're
 * filtered out here — listing them in both places would show one sale twice and
 * leave it ambiguous which view was authoritative.
 */
function deliveredPackages(soldPackages: any[]) {
  return soldPackages.filter((cp) => !cp.package?.isSubscription);
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', status: '', defaultCurrency: '', notes: '' });
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', role: '', businessName: '', state: '', billingAddress: '', useForInvoice: false, portalAccess: false });
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [editContactId, setEditContactId] = useState<string | null>(null);
  const [editContactForm, setEditContactForm] = useState({ name: '', email: '', phone: '', role: '', businessName: '', state: '', billingAddress: '', useForInvoice: false, portalAccess: false });
  const [showSellForm, setShowSellForm] = useState(false);
  const [sellForm, setSellForm] = useState({ packageId: '', startDate: '', deliveryDate: '', description: '', discountType: '', discountValue: '', discountCycles: '', customPrice: '' });
  // Only meaningful when the sale spawns exactly one project — same rule
  // /projects/new uses (see its `roleSlots` comment): with more than one
  // project each is assigned individually afterward.
  const [sellAssignments, setSellAssignments] = useState<Record<string, string>>({});
  // Extra packages bought in the same sale. They go out at list price — the
  // discount / custom-price / installment controls above stay tied to the main
  // package, because those only make sense one package at a time.
  const [extraPackageIds, setExtraPackageIds] = useState<string[]>([]);
  // Per-package pricing for the extras, keyed by package id. The sell-packages
  // endpoint already accepts these overrides per entry; the UI just never
  // offered them, so extras could only be sold at list price.
  const [extraTerms, setExtraTerms] = useState<Record<string, {
    discountType: string; discountValue: string; discountCycles: string; customPrice: string; description: string;
  }>>({});
  const [sellInstallmentPlan, setSellInstallmentPlan] = useState<{ type: 'percent' | 'amount'; value: string; dueAt: string; label: string }[]>([]);

  function addDaysToDate(dateStr: string, days: number) {
    const base = dateStr && /^\d{4}-\d{2}-\d{2}/.test(dateStr)
      ? dateStr.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + (Number(days) || 0));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayDateStr() {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // A package template's installment row may be the current { type, value, ... }
  // shape or an older { percent, ... } one saved before "amount" rows existed —
  // read both the same way.
  function normalizeTemplateInstallment(row: any): { type: 'percent' | 'amount'; value: string } {
    const type: 'percent' | 'amount' = row.type === 'amount' ? 'amount' : 'percent';
    const raw = row.value !== undefined && row.value !== null && row.value !== ''
      ? row.value
      : (type === 'amount' ? row.amount : row.percent);
    return { type, value: raw != null ? String(raw) : '' };
  }
  const [cancelPackageId, setCancelPackageId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');
  const inactive = useShowInactive();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canSell = hasPermission('projects.create');
  const canManagePackages = hasPermission('projects.manage');
  // Quotes & Agreements is an admin-only module server-side (routes/documents.js
  // gates the whole router on admin.access) — hide the tabs for anyone who'd
  // just get a 403 from them.
  const canViewDocuments = hasPermission('admin.access');
  const canCreateInvoices = hasPermission('billing.create');
  // Mirrors the adminOnly gate the endpoint enforces — changing how a real
  // client is billed is an administrator decision, not a project-level one.
  const roleKey = useAuthStore((s) => s.user?.role?.key);
  const canSetBillingMode = roleKey === 'super_admin' || roleKey === 'admin';

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id, inactive.key],
    queryFn: () => api.get(`/clients/${id}`, { params: inactive.params }).then((r) => r.data),
  });

  useEffect(() => {
    if (client) {
      setEditForm({ name: client.name, status: client.status, defaultCurrency: client.defaultCurrency, notes: client.notes || '' });
    }
  }, [client]);

  const { data: projects } = useQuery({
    queryKey: ['projects', { clientId: id }],
    queryFn: () => api.get(`/projects?clientId=${id}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: tab === 'projects' || tab === 'overview',
  });

  const { data: invoices } = useQuery({
    queryKey: ['invoices', { clientId: id }],
    queryFn: () => api.get(`/invoices?clientId=${id}`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: tab === 'invoices' || tab === 'overview',
  });

  // Invoice-status breakdown for the Overview tab's "Invoices by Status"
  // chart — aggregated client-side from the same `invoices` fetch the
  // Invoices tab table already uses, no separate API call.
  const invoiceStatusChartData = Object.entries(
    (invoices || []).reduce((acc: Record<string, number>, inv: any) => {
      acc[inv.status] = (acc[inv.status] || 0) + 1;
      return acc;
    }, {}),
  )
    .map(([status, count]) => ({ label: titleCase(status), value: count as number }))
    .sort((a, b) => b.value - a.value);

  const { data: timeline } = useQuery({
    queryKey: ['client-timeline', id],
    queryFn: () => api.get(`/clients/${id}/timeline`).then((r) => r.data),
    enabled: tab === 'timeline',
  });
  // Project stage-progress is hidden here — it's redundant with the Projects
  // tab (and the project's own page); this timeline stays focused on the
  // sales/billing side (quotations, proposals, agreements, invoices).
  const timelineItems: any[] = (timeline?.items ?? []).filter((it: any) => it.kind !== 'project');

  const { data: quotations } = useQuery({
    queryKey: ['documents', { clientId: id, type: 'quotation' }],
    queryFn: () => api.get(`/documents?clientId=${id}&type=quotation&limit=100`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: canViewDocuments && tab === 'quotations',
  });

  const { data: agreements } = useQuery({
    queryKey: ['documents', { clientId: id, type: 'agreement' }],
    queryFn: () => api.get(`/documents?clientId=${id}&type=agreement&limit=100`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: canViewDocuments && tab === 'agreements',
  });

  const { data: proposals } = useQuery({
    queryKey: ['documents', { clientId: id, type: 'proposal' }],
    queryFn: () => api.get(`/documents?clientId=${id}&type=proposal&limit=100`).then((r) => r.data?.data ?? r.data ?? []),
    enabled: canViewDocuments && tab === 'proposals',
  });

  const { data: soldPackages = [] } = useQuery({
    queryKey: ['client-packages', id],
    queryFn: () => api.get(`/clients/${id}/packages`).then((r) => r.data),
    enabled: tab === 'packages',
  });

  // Fetched on every visit, not just while the tab is open, because the tab
  // itself carries the "needs attention" count — a badge nobody can see until
  // they've already clicked through to it isn't telling them anything.
  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery({
    queryKey: ['client-subscriptions', id],
    queryFn: () => api.get(`/clients/${id}/subscriptions`).then((r) => r.data),
  });
  const subscriptionList = subscriptions as any[];
  const blockedSubscriptions = subscriptionList.filter(
    (sub: any) => sub.usable === false && sub.entitlement !== 'cancelled'
  ).length;

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get('/admin/templates').then((r) => r.data),
    enabled: tab === 'packages' && canSell,
  });

  const { data: teamUsers = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
    enabled: tab === 'packages' && canSell,
  });

  const { data: sellablePackages = [] } = useQuery({
    queryKey: ['sellable-packages', id],
    queryFn: () => api.get(`/clients/${id}/sellable-packages`).then((r) => r.data),
    enabled: tab === 'packages' && showSellForm && canSell,
  });

  const sellPackage = useMutation({
    mutationFn: (data: typeof sellForm) => {
      const primary = {
        packageId: data.packageId,
        discountType: data.customPrice ? undefined : (data.discountType || undefined),
        discountValue: !data.customPrice && data.discountType && data.discountValue ? Number(data.discountValue) : undefined,
        discountCycles: !data.customPrice && data.discountType && data.discountCycles ? Number(data.discountCycles) : undefined,
        customPrice: data.customPrice ? Number(data.customPrice) : undefined,
        installmentPlan: sellInstallmentPlan.filter((p) => p.value && p.dueAt).length
          ? sellInstallmentPlan.filter((p) => p.value && p.dueAt).map((p) => ({
            type: p.type,
            value: Number(p.value),
            dueAt: p.dueAt,
            label: p.label || undefined,
          }))
          : undefined,
      };

      // Multiple packages go through the plural endpoint, which sells them in
      // sequence so their charges land on a single invoice rather than one each.
      if (extraPackageIds.length) {
        return api.post(`/clients/${id}/sell-packages`, {
          startDate: data.startDate || undefined,
          deliveryDate: data.deliveryDate || undefined,
          description: data.description || undefined,
          packages: [
            primary,
            ...extraPackageIds.map((packageId) => {
              const t = extraTerms[packageId] || { discountType: '', discountValue: '', discountCycles: '', customPrice: '', description: '' };
              return {
                packageId,
                // Only send what was actually set — an empty string would read as
                // "sell for 0" rather than "no override".
                discountType: t.discountType || undefined,
                discountValue: t.discountType && t.discountValue !== '' ? Number(t.discountValue) : undefined,
                discountCycles: t.discountType && t.discountCycles !== '' ? Number(t.discountCycles) : undefined,
                customPrice: t.customPrice !== '' ? Number(t.customPrice) : undefined,
                description: t.description || undefined,
              };
            }),
          ],
        }).then((r) => r.data);
      }

      return api.post(`/clients/${id}/sell-package`, {
        ...primary,
        startDate: data.startDate || undefined,
        deliveryDate: data.deliveryDate || undefined,
        description: data.description || undefined,
      }).then((r) => r.data);
    },
    onSuccess: async (res) => {
      // Same rule /projects/new uses: team assignment only makes sense when
      // the sale spawned exactly one project — with more than one, each is
      // assigned individually from its own page afterward.
      const created = res?.projects || [];
      if (created.length === 1 && Object.values(sellAssignments).some(Boolean)) {
        await Promise.all(
          Object.entries(sellAssignments)
            .filter(([, userId]) => !!userId)
            .map(([roleSlot, userId]) => api.post(`/projects/${created[0].id}/assign`, { roleSlot, userId }))
        ).catch(() => toast.error('Package sold, but team assignment failed — assign from the project page.'));
      }
      await invalidateMany(qc, afterClientChange(id));
      setShowSellForm(false);
      setSellForm({ packageId: '', startDate: '', deliveryDate: '', description: '', discountType: '', discountValue: '', discountCycles: '', customPrice: '' });
      setSellAssignments({});
      setSellInstallmentPlan([]);
      setExtraPackageIds([]);
      setExtraTerms({});
      const n = res?.projects?.length || 0;
      const soldCount = res?.soldCount || 1;
      const parts = [
        `${soldCount > 1 ? `${soldCount} packages sold` : 'Package sold'}${n ? ` — ${n} workflow${n !== 1 ? 's' : ''} created` : ''}`,
      ];
      if (soldCount > 1) parts.push('billed on a single invoice');
      if (res?.isRecurring && res?.retainerCreated) {
        parts.push('retainer created and first cycle invoiced');
      }
      if (res?.retainersCreated) {
        parts.push(`${res.retainersCreated} retainer${res.retainersCreated !== 1 ? 's' : ''} created`);
      }
      if (!res?.isRecurring && (res?.invoicesCreated || res?.installmentInvoices?.length)) {
        const c = res.invoicesCreated || res.installmentInvoices.length;
        parts.push(`${c} invoice${c !== 1 ? 's' : ''} scheduled/issued`);
      }
      toast.success(parts.filter(Boolean).join(' — ') + '.');
      // Packages already sold are kept; only the ones that failed are reported,
      // by name, so it's clear exactly what still needs doing.
      if (Array.isArray(res?.failed) && res.failed.length) {
        toast.error(`Could not sell: ${res.failed.map((f: any) => `${f.name} (${f.message})`).join(' · ')}`);
      }
      if (res?.billingError) {
        toast.error(res.billingError);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to sell package.'),
  });

  const cancelPackage = useMutation({
    mutationFn: (packageId: string) => api.post(`/clients/${id}/packages/${packageId}/cancel`).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterClientChange(id));
      setCancelPackageId(null);
      toast.success('Package cancelled — its workflows have been stopped.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to cancel package.'),
  });

  const updatePackagePrice = useMutation({
    mutationFn: ({ packageId, price }: { packageId: string; price: number }) =>
      api.patch(`/clients/${id}/packages/${packageId}/price`, { price }).then((r) => r.data),
    onSuccess: async (res: any) => {
      await invalidateMany(qc, afterClientChange(id));
      setEditPriceId(null);
      toast.success(res?.retainerUpdated ? 'Price updated — retainer amount updated too.' : 'Price updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update price.'),
  });

  const billingModeMutation = useMutation({
    mutationFn: (billingMode: 'manual' | 'stripe') =>
      api.patch(`/clients/${id}/billing-mode`, { billingMode }).then((r) => r.data),
    onSuccess: async (res: any, billingMode) => {
      await invalidateMany(qc, afterClientChange(id));
      const n = res?.updatedInvoices || 0;
      const affected = n ? ` — ${n} open invoice${n === 1 ? '' : 's'} updated` : '';
      toast.success(
        billingMode === 'stripe'
          ? `Pay via CRM on — this client is billed through Stripe${affected}.`
          : `Pay via CRM off — this client is billed manually${affected}.`,
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change how this client pays.'),
  });

  const chargeCardFeeMutation = useMutation({
    mutationFn: (chargeCardFee: boolean) =>
      api.patch(`/clients/${id}/card-fee`, { chargeCardFee }).then((r) => r.data),
    onSuccess: async (_res: any, chargeCardFee) => {
      await invalidateMany(qc, afterClientChange(id));
      toast.success(
        chargeCardFee
          ? 'Card processing fee will be added to this client’s card payments.'
          : 'Card processing fee will be absorbed by the agency for this client — nothing added to their card payments.',
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to change the card fee setting.'),
  });

  const updateClient = useMutation({
    mutationFn: (data: typeof editForm) => api.patch(`/clients/${id}`, data).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterClientChange(id));
      setEditing(false);
      toast.success('Client updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update client.'),
  });

  const addContact = useMutation({
    mutationFn: (data: typeof contactForm) => api.post(`/clients/${id}/contacts`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      setShowContactForm(false);
      setContactForm({ name: '', email: '', phone: '', role: '', businessName: '', state: '', billingAddress: '', useForInvoice: false, portalAccess: false });
      toast.success('Contact added.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to add contact.'),
  });

  const togglePortal = useMutation({
    mutationFn: ({ ctId, portalAccess }: { ctId: string; portalAccess: boolean }) =>
      api.patch(`/clients/${id}/contacts/${ctId}`, { portalAccess }).then((r) => r.data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      toast.success(vars.portalAccess ? 'Portal access granted.' : 'Portal access revoked.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update portal access.'),
  });

  const updateContact = useMutation({
    mutationFn: ({ ctId, data }: { ctId: string; data: typeof editContactForm }) =>
      api.patch(`/clients/${id}/contacts/${ctId}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      setEditContactId(null);
      toast.success('Contact updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update contact.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleContactActive = useMutation({
    mutationFn: ({ ctId, next }: { ctId: string; next: boolean }) =>
      (next
        ? api.post(`/clients/${id}/contacts/${ctId}/activate`)
        : api.delete(`/clients/${id}/contacts/${ctId}`)
      ).then((r) => r.data),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['client', id] });
      setDeleteContactId(null);
      toast.success(next ? 'Contact set to Active.' : 'Contact set to Inactive.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Could not change status.');
      setDeleteContactId(null);
    },
  });

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <Header title="Client" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
    </div>
  );

  if (!client) return (
    <div className="flex flex-col h-full">
      <Header title="Client" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Client not found.</div>
    </div>
  );

  const contacts: any[] = client.contacts || [];
  // "Pay via CRM" = billed through Stripe. Unticked means every other rail
  // (bank transfer, Payoneer, Wise), which is the default.
  const payViaCrm = client.billingMode === 'stripe';

  return (
    <div className="flex flex-col h-full">
      <Header title={client.name} />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        {/* Back */}
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Header banner */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <Avatar name={client.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-gray-900 truncate">{client.name}</h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', STATUS_COLORS[client.status] || 'bg-gray-100 text-gray-600')}>
                {client.status}
              </span>
              {/* Client-wide, so it belongs beside status and currency rather than
                  on a contact row — hung off the billing contact it vanished
                  entirely for clients that haven't nominated one. */}
              {payViaCrm && (
                <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">
                  Pay via CRM
                </span>
              )}
              <span className="text-xs text-gray-400">{client.defaultCurrency}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto overflow-y-hidden">
          {([
            'overview', 'timeline', 'contacts', 'packages', 'subscriptions', 'projects', 'invoices',
            ...(canViewDocuments ? (['quotations', 'proposals', 'agreements'] as Tab[]) : []),
          ] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
                tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-800'
              )}
            >
              {t}
              {/* The only tab whose contents can need acting on right now: a
                  subscription the client is paying for but can't currently use. */}
              {t === 'subscriptions' && blockedSubscriptions > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-red-100 text-red-700 align-middle">
                  {blockedSubscriptions}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
          <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Company Name</label>
                    <input
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Status</label>
                    <select
                      value={editForm.status}
                      onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="churned">Churned</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                    <select
                      value={editForm.defaultCurrency}
                      onChange={(e) => setEditForm({ ...editForm, defaultCurrency: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
                  <textarea
                    value={editForm.notes}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    rows={3}
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateClient.mutate(editForm)}
                    disabled={updateClient.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    {updateClient.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditing(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{client.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">Default currency: {client.defaultCurrency}</p>
                  </div>
                  <button
                    onClick={() => setEditing(true)}
                    className="text-sm text-brand-700 hover:text-brand-800 font-medium"
                  >
                    Edit
                  </button>
                </div>
                {client.notes && (
                  <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{client.notes}</p>
                )}
                {(() => {
                  const activeProjects = (projects || []).filter((p: any) => p.status === 'active').length;
                  const outstanding = (invoices || [])
                    .filter((i: any) => ['sent', 'overdue', 'payment_review'].includes(i.status))
                    .reduce((sum: number, i: any) => sum + parseFloat(i.total || 0), 0);
                  return (
                    // A currency figure needs far more room than a count, so the
                    // three tiles can't share one fixed width on a phone — the
                    // amount was being clipped mid-digits ("$5,55…"). min-w-0 plus
                    // a smaller mobile size lets it shrink instead of overflow.
                    <div className="grid grid-cols-3 gap-2 sm:gap-4 pt-2">
                      {[
                        { label: 'Active Projects', value: activeProjects, icon: FolderKanban, color: 'brand' as const },
                        { label: 'Outstanding', value: formatCurrency(outstanding, client.defaultCurrency), icon: AlertCircle, color: outstanding > 0 ? 'red' as const : 'gray' as const },
                        { label: 'Contacts', value: contacts.length, icon: Users, color: 'blue' as const },
                      ].map((tile) => {
                        const tint = STAT_TINTS[tile.color];
                        return (
                          <div
                            key={tile.label}
                            className={cn('min-w-0 text-center p-3 sm:p-4 rounded-lg bg-gradient-to-br to-white border border-gray-100', tint.wash)}
                          >
                            <div className={cn('mx-auto mb-1.5 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center', tint.icon)}>
                              <tile.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                            </div>
                            <div className="text-lg sm:text-2xl font-semibold text-gray-900 break-words">{tile.value}</div>
                            <div className="text-[11px] sm:text-xs text-gray-500 mt-1">{tile.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Same client-wide billingMode flag as the badge in the header
                    banner and the checkboxes in the Contacts tab — surfaced here
                    too so it doesn't require opening a contact's edit form to see
                    or change how this client pays. */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                  <div>
                    <p className="text-sm font-medium text-gray-900">Pay via CRM</p>
                    <p className="text-xs text-gray-400">
                      {payViaCrm ? 'This client is billed through Stripe.' : 'This client is billed manually (bank transfer, Payoneer, Wise, etc.).'}
                    </p>
                  </div>
                  <label
                    title={canSetBillingMode ? undefined : 'Only an administrator can change how a client pays.'}
                    className={cn(
                      'flex items-center gap-2 text-sm text-gray-700',
                      canSetBillingMode && !billingModeMutation.isPending ? 'cursor-pointer' : 'cursor-not-allowed',
                    )}
                  >
                    <input type="checkbox" checked={payViaCrm}
                      disabled={!canSetBillingMode || billingModeMutation.isPending}
                      onChange={(e) => billingModeMutation.mutate(e.target.checked ? 'stripe' : 'manual')}
                      className="w-4 h-4 rounded accent-brand-700" />
                    {billingModeMutation.isPending && <span className="text-xs text-gray-400">saving…</span>}
                  </label>
                </div>

                {/* Only meaningful once Pay via CRM is on — whether the org's
                    card rate (Admin → Payments → Card processing fees) gets
                    added to this client's card payments, or the agency
                    absorbs it. Applies to invoices AND quotations/agreements/
                    proposals alike (see StripeService.processingFeeFor). */}
                {payViaCrm && (
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Card processing fee</p>
                      <p className="text-xs text-gray-400">
                        {client.chargeCardFee !== false
                          ? 'Added to this client’s card payments, using the org’s rate from Admin → Payments.'
                          : 'Absorbed by the agency — not added to this client’s card payments.'}
                      </p>
                    </div>
                    <label
                      title={canSetBillingMode ? undefined : 'Only an administrator can change this.'}
                      className={cn(
                        'flex items-center gap-2 text-sm text-gray-700',
                        canSetBillingMode && !chargeCardFeeMutation.isPending ? 'cursor-pointer' : 'cursor-not-allowed',
                      )}
                    >
                      <input type="checkbox" checked={client.chargeCardFee !== false}
                        disabled={!canSetBillingMode || chargeCardFeeMutation.isPending}
                        onChange={(e) => chargeCardFeeMutation.mutate(e.target.checked)}
                        className="w-4 h-4 rounded accent-brand-700" />
                      {chargeCardFeeMutation.isPending && <span className="text-xs text-gray-400">saving…</span>}
                    </label>
                  </div>
                )}

                {/* Read-only: which legal entity actually prints on this
                    client's invoices/quotations, derived from the Pay via CRM
                    flag above (Stripe → the LLC, everyone else → the LLP —
                    see letterhead.billingCompanyFor). Not editable here. */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-gray-100">
                  <p className="text-xs text-gray-400">Invoices &amp; quotations issued by</p>
                  {client.billingCompany ? (
                    <span className="text-sm font-medium text-gray-900">
                      {client.billingCompany.legalName}
                      <span className="text-gray-400 font-normal"> ({client.billingCompany.code})</span>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">No company configured — using default letterhead</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {invoiceStatusChartData.length > 0 && (
            <BarChartCard title="Invoices by Status" data={invoiceStatusChartData} categorical />
          )}
          </div>
        )}

        {/* Timeline tab — one stage-progress card per project (same pill row
            the project detail page itself renders) plus an analogous card per
            quotation/proposal/agreement, newest activity first. */}
        {tab === 'timeline' && (
          <div className="space-y-4">
            {!timeline ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">Loading…</div>
            ) : timelineItems.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">No activity yet.</div>
            ) : (
              timelineItems.map((it) => (
                <div key={it.id} className="bg-white rounded-xl border border-gray-200 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={it.href} className="text-sm font-semibold text-gray-900 hover:text-brand-700">
                        {it.title}
                      </Link>
                      {it.subtitle && <p className="text-xs text-gray-500 mt-0.5 capitalize">{it.subtitle}</p>}
                    </div>
                    <span className={cn(
                      'px-2.5 py-1 text-xs font-semibold rounded-full capitalize shrink-0',
                      (it.kind === 'project' ? PROJ_STATUS : it.kind === 'invoice' ? INV_STATUS : DOC_STATUS)[it.status] || 'bg-gray-100 text-gray-600',
                    )}>
                      {it.status}
                    </span>
                  </div>
                  <div className="mt-4">
                    <TimelineSteps steps={it.steps} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Contacts tab */}
        {tab === 'contacts' && (
          <div className="space-y-4">
            {/* Wraps rather than overlapping: the heading plus two controls do
                not fit one phone-width line. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-700">Contacts ({contacts.length})</h3>
              <div className="flex items-center gap-2 flex-wrap">
              <ShowInactiveToggle {...inactive.toggleProps} />
              <button
                onClick={() => {
                  setContactForm((f) => (f.businessName.trim() ? f : { ...f, businessName: client.name || '' }));
                  setShowContactForm(true);
                }}
                className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
              >
                <Plus className="w-4 h-4" />
                Add Contact
              </button>
              </div>
            </div>

            {showContactForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h4 className="text-sm font-semibold text-gray-900">New Contact</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Registered Business Name</label>
                    <input value={contactForm.businessName} onChange={(e) => setContactForm({ ...contactForm, businessName: e.target.value })}
                      placeholder="Name to bill, if different from the client name"
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Contact Person Name <span className="text-red-500">*</span></label>
                    <input value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Email <span className="text-red-500">*</span></label>
                    <input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Phone</label>
                    <input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">State</label>
                    <input value={contactForm.state} onChange={(e) => setContactForm({ ...contactForm, state: e.target.value })}
                      placeholder="WY, Sindh…"
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Billing Address</label>
                    <textarea value={contactForm.billingAddress} onChange={(e) => setContactForm({ ...contactForm, billingAddress: e.target.value })}
                      rows={2} placeholder="Street, unit, city, ZIP…"
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Role</label>
                    <input value={contactForm.role} onChange={(e) => setContactForm({ ...contactForm, role: e.target.value })}
                      placeholder="CEO, Manager…"
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={contactForm.useForInvoice} onChange={(e) => setContactForm({ ...contactForm, useForInvoice: e.target.checked })}
                    className="w-4 h-4 mt-0.5 rounded accent-brand-700" />
                  <span>
                    Use this contact for invoices
                    <span className="block text-xs text-gray-400">
                      Its business name and billing address print in the invoice&apos;s Bill To block. Only one contact per client can be the billing contact.
                    </span>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={contactForm.portalAccess} onChange={(e) => setContactForm({ ...contactForm, portalAccess: e.target.checked })}
                    className="w-4 h-4 rounded accent-brand-700" />
                  Grant portal access
                </label>

                {/* Also on the add form, not just edit: this is a brand-new
                    client's first contact, which is exactly when their payment
                    rail gets decided — and it has to be set before a quotation
                    is raised, since that's what picks the invoice series. */}
                <label
                  title={canSetBillingMode ? undefined : 'Only an administrator can change how a client pays.'}
                  className={cn(
                    'flex items-center gap-2 text-sm text-gray-700',
                    canSetBillingMode && !billingModeMutation.isPending ? 'cursor-pointer' : 'cursor-not-allowed',
                  )}
                >
                  <input type="checkbox" checked={payViaCrm}
                    disabled={!canSetBillingMode || billingModeMutation.isPending}
                    onChange={(e) => billingModeMutation.mutate(e.target.checked ? 'stripe' : 'manual')}
                    className="w-4 h-4 rounded accent-brand-700" />
                  Pay via CRM
                  {billingModeMutation.isPending && <span className="text-xs text-gray-400">saving…</span>}
                </label>

                <div className="flex gap-2">
                  <button onClick={() => addContact.mutate(contactForm)} disabled={!contactForm.name.trim() || !isEmail(contactForm.email) || addContact.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg">
                    {addContact.isPending ? 'Adding…' : 'Add Contact'}
                  </button>
                  <button onClick={() => setShowContactForm(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {contacts.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">No contacts yet.</div>
            ) : (
              <div className="space-y-2">
                {contacts.map((ct: any) => (
                  <div key={ct.id} className={cn('bg-white rounded-xl border border-gray-200', inactiveRow(ct.isActive))}>
                    {editContactId === ct.id ? (
                      /* ── Inline edit form ── */
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Registered Business Name</label>
                            <input value={editContactForm.businessName} onChange={(e) => setEditContactForm({ ...editContactForm, businessName: e.target.value })}
                              placeholder="Name to bill, if different from the client name"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Contact Person Name <span className="text-red-500">*</span></label>
                            <input value={editContactForm.name} onChange={(e) => setEditContactForm({ ...editContactForm, name: e.target.value })}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Email <span className="text-red-500">*</span></label>
                            <input type="email" value={editContactForm.email} onChange={(e) => setEditContactForm({ ...editContactForm, email: e.target.value })}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Phone</label>
                            <input value={editContactForm.phone} onChange={(e) => setEditContactForm({ ...editContactForm, phone: e.target.value })}
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">State</label>
                            <input value={editContactForm.state} onChange={(e) => setEditContactForm({ ...editContactForm, state: e.target.value })}
                              placeholder="WY, Sindh…"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Billing Address</label>
                            <textarea value={editContactForm.billingAddress} onChange={(e) => setEditContactForm({ ...editContactForm, billingAddress: e.target.value })}
                              rows={2} placeholder="Street, unit, city, ZIP…"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Role / Title</label>
                            <input value={editContactForm.role} onChange={(e) => setEditContactForm({ ...editContactForm, role: e.target.value })}
                              placeholder="CEO, Manager…"
                              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                        </div>
                        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={editContactForm.useForInvoice}
                            onChange={(e) => setEditContactForm({ ...editContactForm, useForInvoice: e.target.checked })}
                            className="w-4 h-4 mt-0.5 rounded accent-brand-700" />
                          <span>
                            Use this contact for invoices
                            <span className="block text-xs text-gray-400">Only one contact per client can be the billing contact.</span>
                          </span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={editContactForm.portalAccess}
                            onChange={(e) => setEditContactForm({ ...editContactForm, portalAccess: e.target.checked })}
                            className="w-4 h-4 rounded accent-brand-700" />
                          Portal access
                        </label>

                        {/* Client-wide, not per-contact — a client pays on one rail
                            however many contacts they have. Kept here because this
                            is where billing for the client is set up, and saved
                            immediately rather than with the contact form so the two
                            can't half-apply. */}
                        <label
                          title={canSetBillingMode ? undefined : 'Only an administrator can change how a client pays.'}
                          className={cn(
                            'flex items-center gap-2 text-sm text-gray-700',
                            canSetBillingMode && !billingModeMutation.isPending ? 'cursor-pointer' : 'cursor-not-allowed',
                          )}
                        >
                          <input type="checkbox" checked={payViaCrm}
                            disabled={!canSetBillingMode || billingModeMutation.isPending}
                            onChange={(e) => billingModeMutation.mutate(e.target.checked ? 'stripe' : 'manual')}
                            className="w-4 h-4 rounded accent-brand-700" />
                          Pay via CRM
                          {billingModeMutation.isPending && <span className="text-xs text-gray-400">saving…</span>}
                        </label>

                        <div className="flex gap-2">
                          <button onClick={() => updateContact.mutate({ ctId: ct.id, data: editContactForm })}
                            disabled={!editContactForm.name.trim() || !isEmail(editContactForm.email) || updateContact.isPending}
                            className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-3 py-1.5 rounded-lg">
                            <Save className="w-3.5 h-3.5" />
                            {updateContact.isPending ? 'Saving…' : 'Save'}
                          </button>
                          <button onClick={() => setEditContactId(null)}
                            className="flex items-center gap-1.5 text-gray-600 hover:text-gray-900 text-sm font-medium px-3 py-1.5 rounded-lg hover:bg-gray-100">
                            <X className="w-3.5 h-3.5" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Read-only row ── */
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className="w-9 h-9 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                            <User className="w-4 h-4 text-indigo-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-gray-900">{ct.name}</span>
                              {ct.role && <span className="text-xs text-gray-400">{ct.role}</span>}
                              {ct.useForInvoice && (
                                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-100 text-brand-800">
                                  Billing contact
                                </span>
                              )}
                            </div>
                            {ct.businessName && <div className="text-xs text-gray-600 mt-0.5">{ct.businessName}</div>}
                            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 mt-1 text-xs text-gray-500">
                              {ct.email && <span className="flex items-center gap-1 min-w-0"><Mail className="w-3 h-3 shrink-0" /><span className="truncate">{ct.email}</span></span>}
                              {ct.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3 shrink-0" />{ct.phone}</span>}
                            </div>
                            {(ct.billingAddress || ct.state) && (
                              <div className="text-xs text-gray-400 mt-1 whitespace-pre-line">
                                {[ct.billingAddress, ct.state].filter(Boolean).join('\n')}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 pl-13 sm:pl-0">
                          <button
                            onClick={() => togglePortal.mutate({ ctId: ct.id, portalAccess: !ct.portalAccess })}
                            title={ct.portalAccess ? 'Revoke portal access' : 'Grant portal access'}
                            className={cn(
                              'flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors',
                              ct.portalAccess ? 'bg-brand-100 text-brand-800 hover:bg-brand-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            )}
                          >
                            <Globe className="w-3 h-3" />
                            {ct.portalAccess ? 'Portal On' : 'Portal Off'}
                          </button>
                          <button
                            onClick={() => { setEditContactId(ct.id); setEditContactForm({ name: ct.name, email: ct.email || '', phone: ct.phone || '', role: ct.role || '', businessName: ct.businessName || '', state: ct.state || '', billingAddress: ct.billingAddress || '', useForInvoice: !!ct.useForInvoice, portalAccess: !!ct.portalAccess }); }}
                            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <ActiveToggle
                            isActive={ct.isActive !== false}
                            label="contact"
                            disabled={toggleContactActive.isPending}
                            onToggle={(next) => {
                              if (next) { toggleContactActive.mutate({ ctId: ct.id, next }); return; }
                              setDeleteContactId(ct.id);
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Packages tab */}
        {tab === 'packages' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-700">Sold Packages</h3>
                {/* Explanatory only — hidden on phones, where it pushed the Sell
                    Package button into a three-line column. */}
                <p className="hidden sm:block text-xs text-gray-400 mt-0.5">Selling a package spawns one workflow per included service.</p>
              </div>
              {canSell && (
                <button
                  onClick={() => { setShowSellForm((v) => !v); setSellForm({ packageId: '', startDate: '', deliveryDate: '', description: '', discountType: '', discountValue: '', discountCycles: '', customPrice: '' }); setSellAssignments({}); setSellInstallmentPlan([]); }}
                  className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  Sell Package
                </button>
              )}
            </div>

            {showSellForm && canSell && (() => {
              const selectedPkg = (sellablePackages as any[]).find((x: any) => x.id === sellForm.packageId);
              // Team assignment only makes sense when this sale spawns exactly
              // one project — same rule /projects/new uses. A package with no
              // extras selected and exactly one service (or none, falling back
              // to its own serviceTypeKey) resolves to one project; anything
              // else is assigned per-project afterward.
              const singlePkgServices = selectedPkg
                ? (selectedPkg.skipProjectCreation
                  ? []
                  : (Array.isArray(selectedPkg.services) && selectedPkg.services.length
                    ? selectedPkg.services
                    : [{ serviceTypeKey: selectedPkg.serviceTypeKey }]))
                : [];
              const singleService = !extraPackageIds.length && singlePkgServices.length === 1 ? singlePkgServices[0] : null;
              const singleTemplate = singleService
                ? (templates as any[]).find((t: any) => t.id === singleService.workflowTemplateId)
                  || (templates as any[]).find((t: any) => t.serviceTypeKey === singleService.serviceTypeKey && t.isActive)
                : null;
              const sellRoleSlots = singleTemplate
                ? [...new Set((singleTemplate.stages || []).map((s: any) => s.ownerRoleSlot).filter(Boolean))]
                : [];
              return (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h4 className="text-sm font-semibold text-gray-900">Sell a Package</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Package <span className="text-red-500">*</span></label>
                    <select
                      value={sellForm.packageId}
                      onChange={(e) => {
                        const packageId = e.target.value;
                        setSellForm({ ...sellForm, packageId });
                        const p = (sellablePackages as any[]).find((x: any) => x.id === packageId);
                        const start = sellForm.startDate || todayDateStr();
                        if (!p?.isRecurring && Array.isArray(p?.installmentPlan) && p.installmentPlan.length) {
                          setSellInstallmentPlan(p.installmentPlan.map((row: any) => ({
                            label: row.label || '',
                            ...normalizeTemplateInstallment(row),
                            dueAt: row.dueAt
                              ? String(row.dueAt).slice(0, 10)
                              : addDaysToDate(start, Number(row.offsetDays) || 0),
                          })));
                        } else {
                          setSellInstallmentPlan([]);
                        }
                      }}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Select a package…</option>
                      {(sellablePackages as any[]).map((p: any) => {
                        const n = (p.services || []).length;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} · {p.currency} {Number(p.price || 0).toLocaleString()}{n > 0 ? ` · ${n} service${n !== 1 ? 's' : ''}` : ''}{p.isSubscription ? ` · Subscription${p.vendor ? ` (${p.vendor})` : ''}` : ''}
                          </option>
                        );
                      })}
                    </select>
                    {(sellablePackages as any[]).find((x: any) => x.id === sellForm.packageId)?.isSubscription && (
                      <p className="text-xs text-violet-700 mt-1.5">
                        Subscription — it appears under Retainers → Subscriptions, and the client can&apos;t use it until the first invoice is paid.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Start Date</label>
                    <input
                      type="date"
                      value={sellForm.startDate}
                      onChange={(e) => {
                        const startDate = e.target.value;
                        setSellForm({ ...sellForm, startDate });
                        // If installments were prefilled from a package template (relative days),
                        // keep due dates aligned when the admin changes the sale start date —
                        // only when the plan still matches the package template row count.
                        const p = (sellablePackages as any[]).find((x: any) => x.id === sellForm.packageId);
                        if (
                          startDate
                          && Array.isArray(p?.installmentPlan)
                          && p.installmentPlan.length
                          && sellInstallmentPlan.length === p.installmentPlan.length
                        ) {
                          setSellInstallmentPlan(p.installmentPlan.map((row: any, i: number) => {
                            const normalized = normalizeTemplateInstallment(row);
                            return {
                              label: sellInstallmentPlan[i]?.label || row.label || '',
                              type: sellInstallmentPlan[i]?.value ? sellInstallmentPlan[i].type : normalized.type,
                              value: sellInstallmentPlan[i]?.value || normalized.value,
                              dueAt: addDaysToDate(startDate, Number(row.offsetDays) || 0),
                            };
                          }));
                        }
                      }}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Delivery date <span className="text-gray-400 font-normal">(optional)</span></label>
                    <input
                      type="date"
                      value={sellForm.deliveryDate}
                      onChange={(e) => setSellForm({ ...sellForm, deliveryDate: e.target.value })}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Description <span className="text-gray-400 font-normal">(optional — carried onto the resulting project(s))</span></label>
                    <textarea
                      value={sellForm.description}
                      onChange={(e) => setSellForm({ ...sellForm, description: e.target.value })}
                      rows={2}
                      placeholder="What's this sale for — scope notes, special requests, etc."
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Sell price <span className="text-gray-400 font-normal">(optional override)</span></label>
                    <input
                      type="number"
                      min="0"
                      value={sellForm.customPrice}
                      onChange={(e) => setSellForm({ ...sellForm, customPrice: e.target.value, discountType: '', discountValue: '' })}
                      placeholder="Sell for a custom amount instead of list price"
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  {!sellForm.customPrice && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Discount <span className="text-gray-400 font-normal">(optional)</span></label>
                      <select
                        value={sellForm.discountType}
                        onChange={(e) => setSellForm({ ...sellForm, discountType: e.target.value })}
                        className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      >
                        <option value="">No discount</option>
                        <option value="percent">Percentage off</option>
                        <option value="fixed">Fixed amount off</option>
                      </select>
                    </div>
                  )}
                  {!sellForm.customPrice && sellForm.discountType && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        {sellForm.discountType === 'percent' ? 'Discount %' : 'Discount amount'}
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={sellForm.discountValue}
                        onChange={(e) => setSellForm({ ...sellForm, discountValue: e.target.value })}
                        placeholder={sellForm.discountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                        className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                  )}
                  {!sellForm.customPrice && sellForm.discountType && selectedPkg?.isRecurring && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        Discount valid for <span className="text-gray-400 font-normal">(billing cycles)</span>
                      </label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={sellForm.discountCycles}
                        onChange={(e) => setSellForm({ ...sellForm, discountCycles: e.target.value })}
                        placeholder={`e.g. 3 (${selectedPkg.billingCycle} cycles, then full price)`}
                        className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <p className="mt-1 text-[11px] text-gray-500">Leave blank for a discount that never expires.</p>
                    </div>
                  )}
                </div>
                {sellForm.packageId && (() => {
                  const p = (sellablePackages as any[]).find((x: any) => x.id === sellForm.packageId);
                  const svcCount = (p?.services || []).length || 1;
                  const base = Number(p?.price || 0);
                  const discountValue = Number(sellForm.discountValue || 0);
                  const finalPrice = sellForm.customPrice
                    ? Math.max(0, Number(sellForm.customPrice))
                    : sellForm.discountType === 'percent'
                    ? Math.max(0, base - (base * Math.min(discountValue, 100)) / 100)
                    : sellForm.discountType === 'fixed'
                    ? Math.max(0, base - discountValue)
                    : base;
                  return (
                    <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                      {p?.skipProjectCreation
                        ? <>No project/workflow will be created (retainer-only package).</>
                        : <>This will create <strong>{svcCount}</strong> separate workflow{svcCount !== 1 ? 's' : ''}, one per service, each with its own team and tasks.</>}
                      {sellForm.customPrice && (
                        <> Sell price: <strong>{p?.currency} {finalPrice.toLocaleString()}</strong> (list is {p?.currency} {base.toLocaleString()}).</>
                      )}
                      {!sellForm.customPrice && sellForm.discountType && discountValue > 0 && (
                        <> Price after discount: <strong>{p?.currency} {finalPrice.toLocaleString()}</strong> (was {p?.currency} {base.toLocaleString()}).</>
                      )}
                      {!sellForm.customPrice && sellForm.discountType && discountValue > 0 && p?.isRecurring && Number(sellForm.discountCycles) > 0 && (
                        <> Discount applies for the first <strong>{sellForm.discountCycles}</strong> {p.billingCycle} cycle{Number(sellForm.discountCycles) !== 1 ? 's' : ''} — billing then reverts to <strong>{p?.currency} {base.toLocaleString()}</strong> automatically.</>
                      )}
                      {p?.isRecurring && <> This package bills on a <strong>{p.billingCycle}</strong> cycle — a retainer and the first invoice will be created automatically; later invoices on each renewal date.</>}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.value).length > 0 && (
                        <> Custom installment plan ({sellInstallmentPlan.filter((r) => r.value).length} payments) for this sale — invoices are created now; future ones stay scheduled until their due date.</>
                      )}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.value).length === 0 && Array.isArray(p?.installmentPlan) && p.installmentPlan.length > 0 && (
                        <> Installment plan ({p.installmentPlan.length} payments) — invoices are created now; future ones stay scheduled until their due date.</>
                      )}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.value).length === 0 && !(Array.isArray(p?.installmentPlan) && p.installmentPlan.length > 0) && (
                        <> A single invoice for the full amount will be created automatically.</>
                      )}
                    </p>
                  );
                })()}

                {sellForm.packageId && !(sellablePackages as any[]).find((x: any) => x.id === sellForm.packageId)?.isRecurring && (
                  <div className="space-y-2 border-t border-gray-200 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-700">
                        Installment plan for this sale <span className="text-gray-400 font-normal">(optional — overrides the package&apos;s own plan)</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setSellInstallmentPlan([
                          ...sellInstallmentPlan,
                          { type: 'percent', value: '', dueAt: sellForm.startDate || todayDateStr(), label: '' },
                        ])}
                        className="text-xs font-medium text-brand-800 hover:text-brand-900"
                      >
                        + Add installment
                      </button>
                    </div>
                    {sellInstallmentPlan.length > 0 && (
                      <div className="grid gap-2 text-[11px] font-medium text-gray-500 px-0.5" style={{ gridTemplateColumns: '1fr 100px 90px 160px 28px' }}>
                        <span>Label</span>
                        <span>Type</span>
                        <span>Value</span>
                        <span>Due date</span>
                        <span />
                      </div>
                    )}
                    {sellInstallmentPlan.map((row, i) => (
                      <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 100px 90px 160px 28px' }}>
                        <input value={row.label} placeholder="e.g. Deposit, Milestone 2…"
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        <select value={row.type}
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, type: e.target.value as 'percent' | 'amount' } : r))}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                          <option value="percent">Percentage</option>
                          <option value="amount">Amount</option>
                        </select>
                        <input value={row.value} placeholder={row.type === 'amount' ? 'e.g. 200' : 'e.g. 50'} type="number" min="0"
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, value: e.target.value } : r))}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        <input
                          type="date"
                          value={row.dueAt}
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, dueAt: e.target.value } : r))}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        <button type="button" onClick={() => setSellInstallmentPlan(sellInstallmentPlan.filter((_, j) => j !== i))}
                          className="p-1.5 text-gray-400 hover:text-red-500 justify-self-center">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {sellInstallmentPlan.some((r) => r.type === 'percent') && (
                      <p className={cn('text-xs', sellInstallmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0) === 100 ? 'text-gray-400' : 'text-amber-600')}>
                        Percentage installments total: {sellInstallmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0)}% (should sum to 100% of the price not already covered by fixed amounts)
                      </p>
                    )}
                    {sellInstallmentPlan.some((r) => r.value && !r.dueAt) && (
                      <p className="text-xs text-amber-600">Each installment with a value needs a due date.</p>
                    )}
                  </div>
                )}

                {/* Additional packages in the same sale. Kept below the main
                    package because the start date and the installment plan
                    above apply to that one only; each package added here
                    carries its own price / discount, and everything is billed
                    on one invoice. */}
                {sellForm.packageId && (sellablePackages as any[]).length > 1 && (
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-medium text-gray-700 mb-1">
                      Also sell in this order <span className="text-gray-400 font-normal">(optional)</span>
                    </p>
                    <p className="text-[11px] text-gray-400 mb-2.5">
                      Each package gets its own workflows. The client receives a single invoice for all of them.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[32rem] overflow-y-auto pr-0.5">
                      {(sellablePackages as any[])
                        .filter((p: any) => p.id !== sellForm.packageId)
                        .map((p: any) => {
                          const checked = extraPackageIds.includes(p.id);
                          const terms = extraTerms[p.id] || { discountType: '', discountValue: '', discountCycles: '', customPrice: '', description: '' };
                          const listPrice = Number(p.price || 0);
                          // Mirrors ClientService._computeSoldPrice so the figure
                          // shown here is the one that will actually be charged.
                          const sold = terms.customPrice !== ''
                            ? Math.max(0, Number(terms.customPrice) || 0)
                            : terms.discountType === 'percent'
                              ? Math.max(0, listPrice - (listPrice * Math.min(Number(terms.discountValue) || 0, 100)) / 100)
                              : terms.discountType === 'fixed'
                                ? Math.max(0, listPrice - (Number(terms.discountValue) || 0))
                                : listPrice;
                          const svcCount = (p.services || []).length || 1;
                          const extraDiscountValue = Number(terms.discountValue || 0);
                          return (
                            <div
                              key={p.id}
                              className={cn(
                                'rounded-lg border transition-colors',
                                checked
                                  ? 'sm:col-span-2 border-brand-300 bg-white shadow-sm'
                                  : 'border-gray-200 hover:bg-gray-50',
                              )}
                            >
                              <label className={cn('flex items-start gap-2 cursor-pointer', checked ? 'px-4 pt-3.5 pb-2.5' : 'px-3 py-2')}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => setExtraPackageIds((prev) => (
                                    e.target.checked
                                      ? [...prev, p.id]
                                      : prev.filter((x) => x !== p.id)
                                  ))}
                                  className={cn('mt-0.5 rounded accent-brand-700 shrink-0', checked ? 'w-4 h-4' : 'w-3.5 h-3.5')}
                                />
                                <span className="min-w-0">
                                  <span className={cn('block font-medium truncate', checked ? 'text-sm text-gray-900' : 'text-xs text-gray-800')}>{p.name}</span>
                                  <span className={cn('block', checked ? 'text-xs text-gray-500' : 'text-[11px] text-gray-400')}>
                                    {p.currency} {listPrice.toLocaleString()}
                                    {(p.services || []).length > 0 && ` · ${(p.services || []).length} service${(p.services || []).length !== 1 ? 's' : ''}`}
                                  </span>
                                </span>
                              </label>

                              {/* Same pricing controls the primary package gets, and
                                  laid out the same way — labelled two-column grid plus
                                  the summary note — so an added package doesn't read as
                                  a different, lesser form. Without these an added
                                  package could only ever be sold at list price, so a
                                  discounted bundle had to be sold one package at a
                                  time — which then billed on separate invoices. */}
                              {checked && (
                                <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3.5">
                                    <div>
                                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Sell price <span className="text-gray-400 font-normal">(optional override)</span></label>
                                      <input
                                        type="number"
                                        min="0"
                                        value={terms.customPrice}
                                        onChange={(e) => setExtraTerms((prev) => ({
                                          ...prev,
                                          [p.id]: { ...terms, customPrice: e.target.value, discountType: '', discountValue: '', discountCycles: '' },
                                        }))}
                                        placeholder="Sell for a custom amount instead of list price"
                                        className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                      />
                                    </div>
                                    {!terms.customPrice && (
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1.5">Discount <span className="text-gray-400 font-normal">(optional)</span></label>
                                        <select
                                          value={terms.discountType}
                                          onChange={(e) => setExtraTerms((prev) => ({
                                            ...prev,
                                            [p.id]: { ...terms, discountType: e.target.value, discountValue: e.target.value ? terms.discountValue : '' },
                                          }))}
                                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                        >
                                          <option value="">No discount</option>
                                          <option value="percent">Percentage off</option>
                                          <option value="fixed">Fixed amount off</option>
                                        </select>
                                      </div>
                                    )}
                                    {!terms.customPrice && terms.discountType && (
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                          {terms.discountType === 'percent' ? 'Discount %' : 'Discount amount'}
                                        </label>
                                        <input
                                          type="number"
                                          min="0"
                                          value={terms.discountValue}
                                          onChange={(e) => setExtraTerms((prev) => ({
                                            ...prev, [p.id]: { ...terms, discountValue: e.target.value },
                                          }))}
                                          placeholder={terms.discountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                        />
                                      </div>
                                    )}
                                    {!terms.customPrice && terms.discountType && p.isRecurring && (
                                      <div>
                                        <label className="block text-xs font-medium text-gray-700 mb-1.5">
                                          Discount valid for <span className="text-gray-400 font-normal">(billing cycles)</span>
                                        </label>
                                        <input
                                          type="number"
                                          min="1"
                                          step="1"
                                          value={terms.discountCycles}
                                          onChange={(e) => setExtraTerms((prev) => ({
                                            ...prev, [p.id]: { ...terms, discountCycles: e.target.value },
                                          }))}
                                          placeholder={`e.g. 3 (${p.billingCycle} cycles, then full price)`}
                                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                        />
                                        <p className="mt-1 text-[11px] text-gray-500">Leave blank for a discount that never expires.</p>
                                      </div>
                                    )}
                                    <div className="sm:col-span-2">
                                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Description <span className="text-gray-400 font-normal">(optional — carried onto this package&apos;s resulting project(s))</span></label>
                                      <textarea
                                        value={terms.description}
                                        onChange={(e) => setExtraTerms((prev) => ({
                                          ...prev, [p.id]: { ...terms, description: e.target.value },
                                        }))}
                                        rows={2}
                                        placeholder="What's this package for — scope notes, special requests, etc."
                                        className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                      />
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                                    {p.skipProjectCreation
                                      ? <>No project/workflow will be created (retainer-only package).</>
                                      : <>This will create <strong>{svcCount}</strong> separate workflow{svcCount !== 1 ? 's' : ''}, one per service, each with its own team and tasks.</>}
                                    {terms.customPrice && (
                                      <> Sell price: <strong>{p.currency} {sold.toLocaleString()}</strong> (list is {p.currency} {listPrice.toLocaleString()}).</>
                                    )}
                                    {!terms.customPrice && terms.discountType && extraDiscountValue > 0 && (
                                      <> Price after discount: <strong>{p.currency} {sold.toLocaleString()}</strong> (was {p.currency} {listPrice.toLocaleString()}).</>
                                    )}
                                    {!terms.customPrice && terms.discountType && extraDiscountValue > 0 && p.isRecurring && Number(terms.discountCycles) > 0 && (
                                      <> Discount applies for the first <strong>{terms.discountCycles}</strong> {p.billingCycle} cycle{Number(terms.discountCycles) !== 1 ? 's' : ''} — billing then reverts to <strong>{p.currency} {listPrice.toLocaleString()}</strong> automatically.</>
                                    )}
                                    {p.isRecurring
                                      ? <> This package bills on a <strong>{p.billingCycle}</strong> cycle — a retainer is created, and renewal invoices follow on each renewal date.</>
                                      : <> It is billed on the same single invoice as the rest of this sale.</>}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                    </div>
                    {extraPackageIds.length > 0 && (
                      <p className="text-[11px] font-medium text-brand-800 mt-2">
                        {extraPackageIds.length + 1} packages will be sold together on one invoice.
                      </p>
                    )}
                  </div>
                )}

                {sellRoleSlots.length > 0 && (
                  <div className="space-y-3 border-t border-gray-100 pt-4">
                    <div>
                      <p className="text-xs font-medium text-gray-700">Team Assignment <span className="text-gray-400 font-normal">(optional)</span></p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Assign team members to stage roles. You can update these later.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {sellRoleSlots.map((slot) => (
                        <div key={slot as string}>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5 capitalize">{titleCase(String(slot))}</label>
                          <select
                            value={sellAssignments[slot as string] || ''}
                            onChange={(e) => setSellAssignments((a) => ({ ...a, [slot as string]: e.target.value }))}
                            className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                          >
                            <option value="">Unassigned</option>
                            {usersForRoleSlot(teamUsers, slot as string, sellAssignments[slot as string] || null).map((u: any) => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedPkg && !sellRoleSlots.length && (extraPackageIds.length > 0 || singlePkgServices.length > 1) && (
                  <p className="text-xs text-gray-400 -mt-1">Multiple projects will be created — assign each one's team from its own page after the sale.</p>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => sellForm.packageId && sellPackage.mutate(sellForm)}
                    disabled={!sellForm.packageId || sellPackage.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                  >
                    {sellPackage.isPending
                      ? 'Selling…'
                      : extraPackageIds.length
                        ? `Sell ${extraPackageIds.length + 1} Packages & Create Workflows`
                        : 'Sell & Create Workflows'}
                  </button>
                  <button onClick={() => setShowSellForm(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                    Cancel
                  </button>
                </div>
              </div>
              );
            })()}

            {deliveredPackages(soldPackages as any[]).length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                No packages sold to this client yet.
                {subscriptionList.length > 0 && (
                  <>
                    {' '}They do have {subscriptionList.length} subscription{subscriptionList.length !== 1 ? 's' : ''} —{' '}
                    <button onClick={() => setTab('subscriptions')} className="text-brand-800 hover:text-brand-900 font-medium underline">
                      see the Subscriptions tab
                    </button>.
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {deliveredPackages(soldPackages as any[]).map((cp: any) => (
                  <div key={cp.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                          <Package className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{cp.package?.name || 'Package'}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {cp.discountType && Number(cp.discountValue) > 0 ? (
                              <>
                                <span className="line-through">{cp.currency} {Number(cp.basePrice || 0).toLocaleString()}</span>
                                {' → '}
                                <span className="text-gray-600 font-medium">{cp.currency} {Number(cp.soldPrice || 0).toLocaleString()}</span>
                              </>
                            ) : (
                              <>{cp.currency} {Number(cp.soldPrice || 0).toLocaleString()}</>
                            )}
                            {cp.startDate ? ` · started ${formatDate(cp.startDate)}` : ''}
                          </p>
                          {cp.discountEndsAt && (
                            <p className="text-xs text-amber-600 mt-0.5">
                              Discount ends {formatDate(cp.discountEndsAt)} — reverts to {cp.currency} {Number(cp.basePrice || 0).toLocaleString()} automatically.
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {cp.discountType && Number(cp.discountValue) > 0 && (
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">
                            {cp.discountType === 'percent' ? `${Number(cp.discountValue)}% off` : `${cp.currency} ${Number(cp.discountValue).toLocaleString()} off`}
                          </span>
                        )}
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize', CP_STATUS[cp.status] || 'bg-gray-100 text-gray-600')}>
                          {cp.status}
                        </span>
                        {canManagePackages && cp.status !== 'cancelled' && (
                          <button
                            onClick={() => { setEditPriceId(cp.id); setEditPriceValue(String(cp.soldPrice ?? '')); }}
                            title="Update price"
                            className="p-1.5 text-gray-300 hover:text-brand-700 hover:bg-brand-50 rounded-lg transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canManagePackages && cp.status !== 'cancelled' && (
                          <button
                            onClick={() => setCancelPackageId(cp.id)}
                            title="Cancel this package"
                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {editPriceId === cp.id && (
                      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-gray-100 bg-gray-50/60">
                        <label className="text-xs font-medium text-gray-600">New price ({cp.currency})</label>
                        <input
                          type="number"
                          min="0"
                          autoFocus
                          value={editPriceValue}
                          onChange={(e) => setEditPriceValue(e.target.value)}
                          className="w-32 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        <button
                          onClick={() => editPriceValue !== '' && updatePackagePrice.mutate({ packageId: cp.id, price: Number(editPriceValue) })}
                          disabled={editPriceValue === '' || updatePackagePrice.isPending}
                          className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
                        >
                          {updatePackagePrice.isPending ? 'Saving…' : 'Save'}
                        </button>
                        <button onClick={() => setEditPriceId(null)} className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1.5">
                          Cancel
                        </button>
                        {cp.package && <span className="text-xs text-gray-400">Updates the retainer amount too — future invoices bill the new price.</span>}
                      </div>
                    )}
                    <div className="divide-y divide-gray-50">
                      {(cp.workflowProjects || []).length === 0 ? (
                        // Say WHY there are none. A billing-only package is
                        // configured to spawn no workflow, which is very
                        // different from one that should have and didn't.
                        cp.package?.skipProjectCreation ? (
                          <p className="px-5 py-4 text-xs text-gray-500">
                            Billing-only package — no workflow by design.
                            <span className="text-gray-400">
                              {' '}Turn off &ldquo;Skip project creation&rdquo; on this package in Admin → Packages if it should spawn one.
                            </span>
                          </p>
                        ) : (
                          <p className="px-5 py-4 text-xs text-amber-600">
                            No workflows — this package should have created one. Check that its service has a published workflow template.
                          </p>
                        )
                      ) : (
                        (cp.workflowProjects || []).map((p: any) => (
                          <Link
                            key={p.id}
                            href={`/projects/${p.id}`}
                            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Layers className="w-4 h-4 text-gray-400 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm text-gray-900 truncate">{p.name}</p>
                                <p className="text-xs text-gray-400 mt-0.5 capitalize">{titleCase(p.currentStageKey)}</p>
                              </div>
                            </div>
                            <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize shrink-0', PROJ_STATUS[p.status] || 'bg-gray-100 text-gray-600')}>
                              {p.status}
                            </span>
                          </Link>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subscriptions tab — the recurring things the agency resells to this
            client (hosting, domains, mailboxes). Same payload the client sees in
            their own portal, so staff and client never disagree about whether
            something is live. */}
        {tab === 'subscriptions' && (
          <div className="space-y-3">
            {subscriptionsLoading ? (
              <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
            ) : subscriptionList.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">
                No subscriptions for this client.
                <span className="block text-xs mt-1">
                  Tick “Subscription” on a package in Admin → Packages, then sell it from the Packages tab.
                </span>
              </div>
            ) : (
              <>
                {blockedSubscriptions > 0 && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-red-800">
                        {blockedSubscriptions === 1
                          ? '1 subscription is not usable by the client'
                          : `${blockedSubscriptions} subscriptions are not usable by the client`}
                      </p>
                      <p className="text-xs text-red-600 mt-0.5">
                        Access is restored automatically as soon as the outstanding invoice is settled.
                      </p>
                    </div>
                  </div>
                )}

                {subscriptionList.map((sub: any) => (
                  <div
                    key={sub.id}
                    className={cn(
                      'bg-white rounded-xl border overflow-hidden',
                      sub.usable === false && sub.entitlement !== 'cancelled' ? 'border-red-200' : 'border-gray-200',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                          <RefreshCw className="w-4 h-4 text-violet-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{sub.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {sub.vendor ? `${sub.vendor} · ` : ''}
                            {CYCLE_LABELS[sub.billingCycle] || sub.billingCycle}
                            {' · '}
                            {sub.currency} {Number(sub.soldPrice || 0).toLocaleString()}
                            {sub.renewsAt ? ` · renews ${formatDate(sub.renewsAt)}` : ''}
                          </p>
                          {sub.entitlementReason && (
                            <p className={cn('text-xs mt-0.5', sub.usable === false ? 'text-red-600' : 'text-gray-500')}>
                              {sub.entitlementReason}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Can the client use it right now — a different question
                            from where the sale stands, so both badges are shown. */}
                        <span
                          className={cn('px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap', ENTITLEMENT_COLORS[sub.entitlement] || 'bg-gray-100 text-gray-600')}
                        >
                          {ENTITLEMENT_LABELS[sub.entitlement] || sub.entitlement}
                        </span>
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize', CP_STATUS[sub.status] || 'bg-gray-100 text-gray-600')}>
                          {sub.status}
                        </span>
                      </div>
                    </div>

                    {/* What's actually owed, and where to go and chase it. */}
                    {(sub.outstandingInvoices || []).length > 0 && (
                      <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-3 space-y-1.5">
                        {(sub.outstandingInvoices as any[]).map((inv: any) => (
                          <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs text-gray-500">
                              Invoice <span className="font-medium text-gray-700">{inv.number}</span>
                              {inv.dueAt ? ` · due ${formatDate(inv.dueAt)}` : ''}
                              {' · '}
                              <span className="font-medium text-gray-700">{sub.currency} {Number(inv.total || 0).toLocaleString()}</span>
                              {' · '}
                              <span className="capitalize">{String(inv.status).replace('_', ' ')}</span>
                            </p>
                            <Link href={`/invoices/${inv.id}`} className="text-xs font-medium text-brand-800 hover:text-brand-900 whitespace-nowrap">
                              Open invoice →
                            </Link>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Projects tab */}
        {tab === 'projects' && (
          <div className="space-y-3">
            {!projects ? (
              <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
            ) : (projects as any[]).length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No projects for this client.</p>
            ) : (
              (projects as any[]).map((p: any) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="flex items-center gap-4 bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Briefcase className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900">{p.name}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{p.template?.name || p.serviceTypeKey}</div>
                  </div>
                  <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', PROJ_STATUS[p.status] || 'bg-gray-100 text-gray-600')}>
                    {p.status}
                  </span>
                </Link>
              ))
            )}
          </div>
        )}

        {/* Invoices tab */}
        {tab === 'invoices' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {canCreateInvoices && (
              <div className="flex items-center justify-end px-5 py-3 border-b border-gray-100">
                <button
                  onClick={() => router.push(`/invoices?new=1&clientId=${id}`)}
                  className="flex items-center gap-1.5 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 px-3.5 py-1.5 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> New Invoice
                </button>
              </div>
            )}
            <Table className="w-full min-w-140">
              <TableHeader>
                <TableRow className="border-b border-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Invoice</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Issued</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Due</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {!invoices ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</TableCell></TableRow>
                ) : (invoices as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No invoices for this client.</TableCell></TableRow>
                ) : (
                  (invoices as any[]).map((inv: any) => (
                    <TableRow key={inv.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <TableCell className="px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />{inv.number}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{inv.dueAt ? formatDate(inv.dueAt) : '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(inv.total, inv.currency)}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', INV_STATUS[inv.status] || 'bg-gray-100 text-gray-600')}>
                          {inv.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Quotations tab */}
        {tab === 'quotations' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-end px-5 py-3 border-b border-gray-100">
              <button
                onClick={() => router.push(`/documents/new?clientId=${id}&type=quotation`)}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Quotation
              </button>
            </div>
            <Table className="w-full min-w-140">
              <TableHeader>
                <TableRow className="border-b border-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Quotation</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Prospect</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Sent</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {!quotations ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</TableCell></TableRow>
                ) : (quotations as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No quotations for this client.</TableCell></TableRow>
                ) : (
                  (quotations as any[]).map((doc: any) => (
                    <TableRow key={doc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/documents/${doc.id}`)}>
                      <TableCell className="px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                          <FileSignature className="w-4 h-4 text-gray-400" />{doc.number}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">
                        <p className="text-gray-900">{doc.prospectName}</p>
                        {doc.businessName && <p className="text-xs text-gray-400">{doc.businessName}</p>}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{doc.sentAt ? formatDate(doc.sentAt) : '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(doc.amount, doc.currency)}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', DOC_STATUS[doc.status] || 'bg-gray-100 text-gray-600')}>
                          {doc.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Proposals tab */}
        {tab === 'proposals' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-end px-5 py-3 border-b border-gray-100">
              <button
                onClick={() => router.push(`/documents/new?clientId=${id}&type=proposal`)}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Proposal
              </button>
            </div>
            <Table className="w-full min-w-140">
              <TableHeader>
                <TableRow className="border-b border-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Proposal</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Prospect</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Sent</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {!proposals ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</TableCell></TableRow>
                ) : (proposals as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No proposals for this client.</TableCell></TableRow>
                ) : (
                  (proposals as any[]).map((doc: any) => (
                    <TableRow key={doc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/documents/${doc.id}`)}>
                      <TableCell className="px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />{doc.number}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">
                        <p className="text-gray-900">{doc.prospectName}</p>
                        {doc.businessName && <p className="text-xs text-gray-400">{doc.businessName}</p>}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{doc.sentAt ? formatDate(doc.sentAt) : '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(doc.amount, doc.currency)}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', DOC_STATUS[doc.status] || 'bg-gray-100 text-gray-600')}>
                          {doc.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Agreements tab */}
        {tab === 'agreements' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-end px-5 py-3 border-b border-gray-100">
              <button
                onClick={() => router.push(`/documents/new?clientId=${id}&type=agreement`)}
                className="flex items-center gap-1.5 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 px-3.5 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New Agreement
              </button>
            </div>
            <Table className="w-full min-w-140">
              <TableHeader>
                <TableRow className="border-b border-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Agreement</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Prospect</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Sent</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {!agreements ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</TableCell></TableRow>
                ) : (agreements as any[]).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No agreements for this client.</TableCell></TableRow>
                ) : (
                  (agreements as any[]).map((doc: any) => (
                    <TableRow key={doc.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/documents/${doc.id}`)}>
                      <TableCell className="px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                          <FileSignature className="w-4 h-4 text-gray-400" />{doc.number}
                        </span>
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">
                        <p className="text-gray-900">{doc.prospectName}</p>
                        {doc.businessName && <p className="text-xs text-gray-400">{doc.businessName}</p>}
                      </TableCell>
                      <TableCell className="px-5 py-3.5 text-sm text-gray-600">{doc.sentAt ? formatDate(doc.sentAt) : '—'}</TableCell>
                      <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(doc.amount, doc.currency)}
                      </TableCell>
                      <TableCell className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', DOC_STATUS[doc.status] || 'bg-gray-100 text-gray-600')}>
                          {doc.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteContactId}
        title="Set contact to Inactive"
        message="They stop appearing on this client and lose portal access. Their history stays on record and an admin can set them back to Active at any time — nothing is deleted."
        confirmLabel="Set Inactive"
        onConfirm={() => toggleContactActive.mutate({ ctId: deleteContactId!, next: false })}
        onCancel={() => setDeleteContactId(null)}
      />

      <ConfirmDialog
        open={!!cancelPackageId}
        title="Cancel this package"
        message="This stops every workflow this package spawned. The package and its workflows stay on record as cancelled — nothing is deleted."
        confirmLabel="Cancel Package"
        onConfirm={() => cancelPackage.mutate(cancelPackageId!)}
        onCancel={() => setCancelPackageId(null)}
      />
    </div>
  );
}
