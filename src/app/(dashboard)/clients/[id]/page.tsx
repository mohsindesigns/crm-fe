'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Globe, Mail, Phone, User, FileText, Briefcase, Pencil, X, Save, Package, Layers } from 'lucide-react';
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
  void: 'bg-gray-100 text-gray-400',
};

const PROJ_STATUS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  completed: 'bg-blue-100 text-blue-700',
  on_hold: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-700',
};

type Tab = 'overview' | 'contacts' | 'packages' | 'projects' | 'invoices';

const CP_STATUS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  pending: 'bg-amber-100 text-amber-700',
  paused: 'bg-amber-100 text-amber-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
};

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
  const [sellForm, setSellForm] = useState({ packageId: '', startDate: '', discountType: '', discountValue: '', customPrice: '' });
  // Extra packages bought in the same sale. They go out at list price — the
  // discount / custom-price / installment controls above stay tied to the main
  // package, because those only make sense one package at a time.
  const [extraPackageIds, setExtraPackageIds] = useState<string[]>([]);
  // Per-package pricing for the extras, keyed by package id. The sell-packages
  // endpoint already accepts these overrides per entry; the UI just never
  // offered them, so extras could only be sold at list price.
  const [extraTerms, setExtraTerms] = useState<Record<string, {
    discountType: string; discountValue: string; customPrice: string;
  }>>({});
  const [sellInstallmentPlan, setSellInstallmentPlan] = useState<{ percent: string; dueAt: string; label: string }[]>([]);

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
  const [cancelPackageId, setCancelPackageId] = useState<string | null>(null);
  const [editPriceId, setEditPriceId] = useState<string | null>(null);
  const [editPriceValue, setEditPriceValue] = useState('');
  const inactive = useShowInactive();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canSell = hasPermission('projects.create');
  const canManagePackages = hasPermission('projects.manage');
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

  const { data: soldPackages = [] } = useQuery({
    queryKey: ['client-packages', id],
    queryFn: () => api.get(`/clients/${id}/packages`).then((r) => r.data),
    enabled: tab === 'packages',
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
        customPrice: data.customPrice ? Number(data.customPrice) : undefined,
        installmentPlan: sellInstallmentPlan.filter((p) => p.percent && p.dueAt).length
          ? sellInstallmentPlan.filter((p) => p.percent && p.dueAt).map((p) => ({
            percent: Number(p.percent),
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
          packages: [
            primary,
            ...extraPackageIds.map((packageId) => {
              const t = extraTerms[packageId] || { discountType: '', discountValue: '', customPrice: '' };
              return {
                packageId,
                // Only send what was actually set — an empty string would read as
                // "sell for 0" rather than "no override".
                discountType: t.discountType || undefined,
                discountValue: t.discountType && t.discountValue !== '' ? Number(t.discountValue) : undefined,
                customPrice: t.customPrice !== '' ? Number(t.customPrice) : undefined,
              };
            }),
          ],
        }).then((r) => r.data);
      }

      return api.post(`/clients/${id}/sell-package`, {
        ...primary,
        startDate: data.startDate || undefined,
      }).then((r) => r.data);
    },
    onSuccess: async (res) => {
      await invalidateMany(qc, afterClientChange(id));
      setShowSellForm(false);
      setSellForm({ packageId: '', startDate: '', discountType: '', discountValue: '', customPrice: '' });
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
          {(['overview', 'contacts', 'packages', 'projects', 'invoices'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px whitespace-nowrap shrink-0',
                tab === t ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-500 hover:text-gray-800'
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === 'overview' && (
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
                      <div className="min-w-0 text-center p-3 sm:p-4 bg-gray-50 rounded-lg">
                        <div className="text-lg sm:text-2xl font-semibold text-gray-900">{activeProjects}</div>
                        <div className="text-[11px] sm:text-xs text-gray-500 mt-1">Active Projects</div>
                      </div>
                      <div className="min-w-0 text-center p-3 sm:p-4 bg-gray-50 rounded-lg">
                        <div className="text-lg sm:text-2xl font-semibold text-gray-900 break-words">{formatCurrency(outstanding, client.defaultCurrency)}</div>
                        <div className="text-[11px] sm:text-xs text-gray-500 mt-1">Outstanding</div>
                      </div>
                      <div className="min-w-0 text-center p-3 sm:p-4 bg-gray-50 rounded-lg">
                        <div className="text-lg sm:text-2xl font-semibold text-gray-900">{contacts.length}</div>
                        <div className="text-[11px] sm:text-xs text-gray-500 mt-1">Contacts</div>
                      </div>
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
                onClick={() => setShowContactForm(true)}
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
                  onClick={() => { setShowSellForm((v) => !v); setSellForm({ packageId: '', startDate: '', discountType: '', discountValue: '', customPrice: '' }); setSellInstallmentPlan([]); }}
                  className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3 py-1.5 rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  Sell Package
                </button>
              )}
            </div>

            {showSellForm && canSell && (
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
                            percent: row.percent != null ? String(row.percent) : '',
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
                            {p.name} · {p.currency} {Number(p.price || 0).toLocaleString()}{n > 0 ? ` · ${n} service${n !== 1 ? 's' : ''}` : ''}
                          </option>
                        );
                      })}
                    </select>
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
                          setSellInstallmentPlan(p.installmentPlan.map((row: any, i: number) => ({
                            label: sellInstallmentPlan[i]?.label || row.label || '',
                            percent: sellInstallmentPlan[i]?.percent || (row.percent != null ? String(row.percent) : ''),
                            dueAt: addDaysToDate(startDate, Number(row.offsetDays) || 0),
                          })));
                        }
                      }}
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
                      {p?.isRecurring && <> This package bills on a <strong>{p.billingCycle}</strong> cycle — a retainer and the first invoice will be created automatically; later invoices on each renewal date.</>}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.percent).length > 0 && (
                        <> Custom installment plan ({sellInstallmentPlan.filter((r) => r.percent).length} payments) for this sale — invoices are created now; future ones stay scheduled until their due date.</>
                      )}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.percent).length === 0 && Array.isArray(p?.installmentPlan) && p.installmentPlan.length > 0 && (
                        <> Installment plan ({p.installmentPlan.length} payments) — invoices are created now; future ones stay scheduled until their due date.</>
                      )}
                      {!p?.isRecurring && sellInstallmentPlan.filter((r) => r.percent).length === 0 && !(Array.isArray(p?.installmentPlan) && p.installmentPlan.length > 0) && (
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
                          { percent: '', dueAt: sellForm.startDate || todayDateStr(), label: '' },
                        ])}
                        className="text-xs font-medium text-brand-800 hover:text-brand-900"
                      >
                        + Add installment
                      </button>
                    </div>
                    {sellInstallmentPlan.length > 0 && (
                      <div className="grid gap-2 text-[11px] font-medium text-gray-500 px-0.5" style={{ gridTemplateColumns: '1fr 110px 160px 28px' }}>
                        <span>Label</span>
                        <span>Percent (%)</span>
                        <span>Due date</span>
                        <span />
                      </div>
                    )}
                    {sellInstallmentPlan.map((row, i) => (
                      <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 110px 160px 28px' }}>
                        <input value={row.label} placeholder="e.g. Deposit, Milestone 2…"
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, label: e.target.value } : r))}
                          className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        <input value={row.percent} placeholder="e.g. 50" type="number" min="0"
                          onChange={(e) => setSellInstallmentPlan(sellInstallmentPlan.map((r, j) => j === i ? { ...r, percent: e.target.value } : r))}
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
                    {sellInstallmentPlan.filter((r) => r.percent).length > 0 && (
                      <p className={cn('text-xs', sellInstallmentPlan.reduce((s, r) => s + (Number(r.percent) || 0), 0) === 100 ? 'text-gray-400' : 'text-amber-600')}>
                        Total: {sellInstallmentPlan.reduce((s, r) => s + (Number(r.percent) || 0), 0)}% (should sum to 100%)
                      </p>
                    )}
                    {sellInstallmentPlan.some((r) => r.percent && !r.dueAt) && (
                      <p className="text-xs text-amber-600">Each installment with a percent needs a due date.</p>
                    )}
                  </div>
                )}

                {/* Additional packages in the same sale. Kept below the main
                    package because the discount / custom price / installment
                    controls above apply to that one only — these go out at list
                    price, and everything is billed on one invoice. */}
                {sellForm.packageId && (sellablePackages as any[]).length > 1 && (
                  <div className="border-t border-gray-100 pt-4">
                    <p className="text-xs font-medium text-gray-700 mb-1">
                      Also sell in this order <span className="text-gray-400 font-normal">(optional)</span>
                    </p>
                    <p className="text-[11px] text-gray-400 mb-2.5">
                      Each package gets its own workflows. The client receives a single invoice for all of them.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-72 overflow-y-auto">
                      {(sellablePackages as any[])
                        .filter((p: any) => p.id !== sellForm.packageId)
                        .map((p: any) => {
                          const checked = extraPackageIds.includes(p.id);
                          const terms = extraTerms[p.id] || { discountType: '', discountValue: '', customPrice: '' };
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
                          return (
                            <div
                              key={p.id}
                              className={cn(
                                'rounded-lg border transition-colors',
                                checked ? 'border-brand-300 bg-brand-50/60' : 'border-gray-200 hover:bg-gray-50',
                              )}
                            >
                              <label className="flex items-start gap-2 px-3 py-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => setExtraPackageIds((prev) => (
                                    e.target.checked
                                      ? [...prev, p.id]
                                      : prev.filter((x) => x !== p.id)
                                  ))}
                                  className="w-3.5 h-3.5 mt-0.5 rounded accent-brand-700 shrink-0"
                                />
                                <span className="min-w-0">
                                  <span className="block text-xs font-medium text-gray-800 truncate">{p.name}</span>
                                  <span className="block text-[11px] text-gray-400">
                                    {p.currency} {listPrice.toLocaleString()}
                                    {(p.services || []).length > 0 && ` · ${(p.services || []).length} service${(p.services || []).length !== 1 ? 's' : ''}`}
                                  </span>
                                </span>
                              </label>

                              {/* Same pricing controls the primary package gets.
                                  Without these an added package could only ever be
                                  sold at list price, so a discounted bundle had to
                                  be sold one package at a time — which then billed
                                  on separate invoices. */}
                              {checked && (
                                <div className="px-3 pb-2.5 pt-0.5 space-y-1.5 border-t border-brand-200/60 mt-1">
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <select
                                      value={terms.discountType}
                                      onChange={(e) => setExtraTerms((prev) => ({
                                        ...prev,
                                        [p.id]: { ...terms, discountType: e.target.value, discountValue: e.target.value ? terms.discountValue : '' },
                                      }))}
                                      className="w-full px-2 py-1.5 text-[11px] border border-gray-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-600"
                                    >
                                      <option value="">No discount</option>
                                      <option value="percent">% off</option>
                                      <option value="fixed">Amount off</option>
                                    </select>
                                    <input
                                      type="number"
                                      min="0"
                                      disabled={!terms.discountType}
                                      value={terms.discountValue}
                                      onChange={(e) => setExtraTerms((prev) => ({
                                        ...prev, [p.id]: { ...terms, discountValue: e.target.value },
                                      }))}
                                      placeholder={terms.discountType === 'percent' ? 'e.g. 10' : 'e.g. 150'}
                                      className="w-full px-2 py-1.5 text-[11px] border border-gray-300 rounded-md disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-600"
                                    />
                                  </div>
                                  <input
                                    type="number"
                                    min="0"
                                    value={terms.customPrice}
                                    onChange={(e) => setExtraTerms((prev) => ({
                                      ...prev, [p.id]: { ...terms, customPrice: e.target.value },
                                    }))}
                                    placeholder="Sell price (overrides discount)"
                                    className="w-full px-2 py-1.5 text-[11px] border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
                                  />
                                  {sold !== listPrice && (
                                    <p className="text-[11px] text-brand-800 font-medium">
                                      Sells for {p.currency} {sold.toLocaleString()}
                                      <span className="text-gray-400 font-normal"> (was {p.currency} {listPrice.toLocaleString()})</span>
                                    </p>
                                  )}
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
            )}

            {(soldPackages as any[]).length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-400">No packages sold to this client yet.</div>
            ) : (
              <div className="space-y-3">
                {(soldPackages as any[]).map((cp: any) => (
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
            <div className="overflow-x-auto">
            <table className="w-full min-w-140">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Invoice</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Issued</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Due</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Amount</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {!invoices ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">Loading…</td></tr>
                ) : (invoices as any[]).length === 0 ? (
                  <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-gray-400">No invoices for this client.</td></tr>
                ) : (
                  (invoices as any[]).map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      <td className="px-5 py-3.5">
                        <span className="text-sm font-medium text-gray-900 font-mono flex items-center gap-2">
                          <FileText className="w-4 h-4 text-gray-400" />{inv.number}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{inv.issuedAt ? formatDate(inv.issuedAt) : '—'}</td>
                      <td className="px-5 py-3.5 text-sm text-gray-600">{inv.dueAt ? formatDate(inv.dueAt) : '—'}</td>
                      <td className="px-5 py-3.5 text-sm font-medium text-gray-900 text-right font-mono">
                        {formatCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', INV_STATUS[inv.status] || 'bg-gray-100 text-gray-600')}>
                          {inv.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
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
