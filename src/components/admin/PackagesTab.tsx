'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, Trash2, ChevronDown, ChevronUp, X, Search, Filter } from 'lucide-react';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import { inp, btnPrimary, btnGhost } from '@/components/admin/adminShared';

// ─── Packages Tab ─────────────────────────────────────────────────────────────

type SvcRow = { serviceTypeKey: string; workflowTemplateId: string };

export default function PackagesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const blankPackageForm = {
    name: '', serviceTypeKey: '', tier: '', price: '', currency: 'USD', description: '',
    isRecurring: false, billingCycle: 'monthly', skipProjectCreation: false,
    isSubscription: false, vendor: '',
    features: [] as string[],
  };
  const [form, setForm] = useState(blankPackageForm);
  const [svcRows, setSvcRows] = useState<SvcRow[]>([]);
  // Single open-editor id: details, features and services are one form now.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; tier: string; price: string; currency: string; description: string; isRecurring: boolean; billingCycle: string;
    skipProjectCreation: boolean; isSubscription: boolean; vendor: string;
    features: string[];
  }>({ name: '', tier: '', price: '', currency: 'USD', description: '', isRecurring: false, billingCycle: 'monthly', skipProjectCreation: false, isSubscription: false, vendor: '', features: [] });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [billingFilter, setBillingFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [cycleFilter, setCycleFilter] = useState('');
  const inactive = useShowInactive();

  const { data: packages = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['admin-packages', inactive.key],
    queryFn: () => api.get('/admin/packages', { params: inactive.params }).then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['admin-templates'],
    queryFn: () => api.get('/admin/templates').then((r) => r.data),
  });

  function setSvcRow(i: number, patch: Partial<SvcRow>) {
    setSvcRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/packages', {
      ...form,
      price: form.price ? Number(form.price) : null,
      features: form.features.map((f) => f.trim()).filter(Boolean),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-packages'] });
      setShowForm(false);
      setForm(blankPackageForm);
      toast.success('Package saved.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to save package.');
    },
  });

  // One save for the whole package. Details/features and the bundled services live
  // behind two different endpoints, but they're one form to the person editing —
  // having a separate "Save Services" button just invited half-saved packages.
  const editMutation = useMutation({
    mutationFn: async ({ id, data, services }: { id: string; data: typeof editForm; services: SvcRow[] }) => {
      await api.patch(`/admin/packages/${id}`, {
        ...data,
        price: data.price ? Number(data.price) : null,
        features: data.features.map((f) => f.trim()).filter(Boolean),
      });
      await api.put(`/admin/packages/${id}/services`, {
        services: services
          .filter((s) => s.serviceTypeKey)
          .map((s) => ({ serviceTypeKey: s.serviceTypeKey, workflowTemplateId: s.workflowTemplateId || null })),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-packages'] });
      setEditingId(null);
      toast.success('Package updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update package.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/admin/packages/${id}/activate`) : api.delete(`/admin/packages/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['admin-packages'] });
      setDeleteId(null);
      toast.success(next ? 'Package set to Active.' : 'Package set to Inactive.');
    },
    onError: (e: any) => { toast.error(e?.response?.data?.message || 'Could not change status.'); setDeleteId(null); },
  });

  // Opens (or closes) the single package editor — details, features AND services.
  function openEdit(pkg: any) {
    if (editingId === pkg.id) { setEditingId(null); return; }
    setEditingId(pkg.id);
    setEditForm({
      name: pkg.name || '', tier: pkg.tier || '', price: pkg.price ?? '',
      currency: pkg.currency || 'USD', description: pkg.description || '', isRecurring: !!pkg.isRecurring, billingCycle: pkg.billingCycle || 'monthly',
      skipProjectCreation: !!pkg.skipProjectCreation,
      isSubscription: !!pkg.isSubscription, vendor: pkg.vendor || '',
      features: Array.isArray(pkg.features) ? pkg.features : [],
    });

    const existing = (pkg.services || []) as any[];
    setSvcRows(existing.length
      ? existing.map((s) => ({ serviceTypeKey: s.serviceTypeKey, workflowTemplateId: s.workflowTemplateId || '' }))
      // Seed with the package's own single service for convenience
      : [{ serviceTypeKey: pkg.serviceTypeKey || '', workflowTemplateId: '' }]);
  }

  // Distinct tiers actually in use, so the filter only ever offers real options.
  const tierOptions = [...new Set((packages as any[]).map((p: any) => p.tier).filter(Boolean))] as string[];

  function packageServiceKeys(pkg: any): string[] {
    const bundled = (pkg.services || []).map((s: any) => s.serviceTypeKey);
    return bundled.length ? bundled : [pkg.serviceTypeKey].filter(Boolean);
  }

  const filteredPackages = (packages as any[]).filter((pkg: any) => {
    if (search && !pkg.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (serviceFilter && !packageServiceKeys(pkg).includes(serviceFilter)) return false;
    if (statusFilter && (statusFilter === 'active') !== !!pkg.isActive) return false;
    if (billingFilter && (billingFilter === 'recurring') !== !!pkg.isRecurring) return false;
    if (cycleFilter && pkg.billingCycle !== cycleFilter) return false;
    if (tierFilter && pkg.tier !== tierFilter) return false;
    return true;
  });

  const packageFiltersActive = !!(search || serviceFilter || statusFilter || billingFilter || cycleFilter || tierFilter);

  return (
    <div className="bg-white rounded-xl border border-gray-200">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-auto">
          <h3 className="text-sm font-semibold text-gray-900">Service Packages</h3>
          <p className="text-xs text-gray-500 mt-0.5">Packages can be attached to projects and retainers. Click a package to manage its bundled services.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className={btnPrimary}>
          <Plus className="w-4 h-4" /> Add Package
        </button>
      </div>

      {/* Filters */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 bg-gray-50/50">
        <div className="relative flex-1 min-w-40">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packages…"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
          />
        </div>
        <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700">
          <option value="">All services</option>
          {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700">
          <option value="">All tiers</option>
          {tierOptions.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={billingFilter} onChange={(e) => setBillingFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700">
          <option value="">Recurring & one-time</option>
          <option value="recurring">Recurring only</option>
          <option value="one_time">One-time only</option>
        </select>
        {billingFilter === 'recurring' && (
          <select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700">
            <option value="">Any cycle</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white text-gray-700">
          <option value="">Active & inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        {packageFiltersActive && (
          <button
            onClick={() => { setSearch(''); setServiceFilter(''); setStatusFilter(''); setBillingFilter(''); setTierFilter(''); setCycleFilter(''); }}
            className="text-xs text-gray-500 hover:text-gray-800 font-medium px-2 py-1.5"
          >
            Clear filters
          </button>
        )}
        <ShowInactiveToggle {...inactive.toggleProps} className="ml-auto shrink-0" />
        <span className="text-xs text-gray-400 shrink-0">{filteredPackages.length} of {(packages as any[]).length}</span>
      </div>

      {showForm && (
        <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
          <p className="text-xs font-semibold text-gray-700">New Package</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Package Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="SEO Growth Pack" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Service Type</label>
              <select value={form.serviceTypeKey} onChange={(e) => setForm({ ...form, serviceTypeKey: e.target.value })}
                className={inp}>
                <option value="">Select…</option>
                {(serviceTypes as any[]).map((s: any) => (
                  <option key={s.key} value={s.key}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tier / Label</label>
              <input value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })}
                placeholder="starter / growth / enterprise" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
              <div className="flex gap-2">
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
                  type="number" placeholder="500" className={`${inp} flex-1`} />
                <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="px-2 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                  {['USD', 'PKR', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Billing Cycle</label>
              <select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })} className={inp}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Annual</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2} placeholder="Scope notes, what's included/excluded, anything worth flagging when this package is sold"
                className={inp} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.isRecurring}
              onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })}
              className="w-4 h-4 rounded accent-brand-700" />
            Recurring — selling this auto-creates a retainer and bills the first cycle immediately
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.skipProjectCreation}
              onChange={(e) => setForm({ ...form, skipProjectCreation: e.target.checked })}
              className="w-4 h-4 rounded accent-brand-700" />
            Retainer only — don&apos;t create a project/workflow (e.g. hosting)
          </label>
          {/* Subscriptions are the recurring lines the agency BUYS IN and resells —
              hosting, domains, mailbox seats — rather than work the team performs.
              Ticking this groups every sale of the package under Retainers →
              Subscriptions, and gates the client's access on payment: while the
              invoice is unpaid or overdue their portal shows it as suspended. */}
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.isSubscription}
              onChange={(e) => setForm({ ...form, isSubscription: e.target.checked, isRecurring: e.target.checked || form.isRecurring })}
              className="w-4 h-4 rounded accent-brand-700" />
            Subscription — bought in and resold (hosting, domain, mailbox), and only usable once paid
          </label>
          {form.isSubscription && (
            <div className="pl-6 space-y-1.5">
              <label className="block text-xs font-medium text-gray-600">Vendor <span className="text-gray-400 font-normal">(who it&apos;s bought from)</span></label>
              <input value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="Hostinger" className={`${inp} max-w-xs`} />
              <p className="text-xs text-gray-400">
                Named on the invoice line and in the client&apos;s portal, so a renewal can be matched against the supplier&apos;s own bill.
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-gray-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-600">What&apos;s included <span className="text-gray-400 font-normal">(shown to clients so they can compare packages)</span></p>
              <button
                type="button"
                onClick={() => setForm({ ...form, features: [...form.features, ''] })}
                className="text-xs font-medium text-brand-800 hover:text-brand-900"
              >
                + Add feature
              </button>
            </div>
            {form.features.map((feature, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={feature} placeholder="e.g. Up to 30 keywords tracked monthly"
                  onChange={(e) => setForm({ ...form, features: form.features.map((f, j) => j === i ? e.target.value : f) })}
                  className={`${inp} flex-1`} />
                <button type="button" onClick={() => setForm({ ...form, features: form.features.filter((_, j) => j !== i) })}
                  className="p-1.5 text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name || !form.serviceTypeKey} className={btnPrimary}>
              {createMutation.isPending ? 'Saving…' : 'Save Package'}
            </button>
            <button onClick={() => { setShowForm(false); setForm(blankPackageForm); }} className={btnGhost}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {filteredPackages.length === 0 && (
          <p className="px-5 py-8 text-sm text-gray-400 text-center">
            {(packages as any[]).length === 0 ? 'No packages yet.' : 'No packages match these filters.'}
          </p>
        )}
        {filteredPackages.map((pkg: any) => {
          const svcCount = (pkg.services || []).length;
          const svcNames = (pkg.services || []).map((s: any) => {
            const st = (serviceTypes as any[]).find((x: any) => x.key === s.serviceTypeKey);
            return st?.name || s.serviceTypeKey;
          });
          return (
          <div key={pkg.id} className={inactiveRow(pkg.isActive)}>
            <div
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 sm:px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors"
              onClick={() => openEdit(pkg)}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{pkg.name}</p>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {svcCount > 0 ? (
                    svcNames.map((n: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700">{n}</span>
                    ))
                  ) : (
                    <span className="text-xs text-gray-400 font-mono">{pkg.serviceTypeKey}{pkg.tier ? ` · ${pkg.tier}` : ''}</span>
                  )}
                  {pkg.isSubscription && (
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-violet-50 text-violet-700">
                      Subscription{pkg.vendor ? ` · ${pkg.vendor}` : ''}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 shrink-0 ml-auto">
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">
                  {pkg.currency} {Number(pkg.price || 0).toLocaleString()}
                </span>
                {/* Status is read-only here — activation goes through the admin-gated
                    toggle below so it can't be flipped by a non-admin via PATCH. */}
                <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${pkg.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
                  {pkg.isActive ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(pkg); }}
                  className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit package"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ActiveToggle
                  isActive={!!pkg.isActive}
                  label="package"
                  disabled={toggleActive.isPending}
                  onToggle={(next) => {
                    if (next) { toggleActive.mutate({ id: pkg.id, next }); return; }
                    setDeleteId(pkg.id);
                  }}
                />
                {editingId === pkg.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </div>
            </div>

            {/* ── The package editor: details, billing, features and bundled services,
                   all saved together by the single button at the bottom. ── */}
            {editingId === pkg.id && (
              <div className="px-5 pb-5 pt-1 bg-gray-50 border-t border-gray-100 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Package Name</label>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tier / Label</label>
                    <input value={editForm.tier} onChange={(e) => setEditForm({ ...editForm, tier: e.target.value })} className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
                    <div className="flex gap-2">
                      <input value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: e.target.value })}
                        type="number" className={`${inp} flex-1`} />
                      <select value={editForm.currency} onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                        className="px-2 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                        {['USD', 'PKR', 'GBP', 'EUR'].map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Billing Cycle</label>
                    <select value={editForm.billingCycle} onChange={(e) => setEditForm({ ...editForm, billingCycle: e.target.value })} className={inp}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></label>
                    <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                      rows={2} placeholder="Scope notes, what's included/excluded, anything worth flagging when this package is sold"
                      className={inp} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editForm.isRecurring}
                    onChange={(e) => setEditForm({ ...editForm, isRecurring: e.target.checked })}
                    className="w-4 h-4 rounded accent-brand-700" />
                  Recurring — selling this auto-creates a retainer and bills the first cycle immediately
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editForm.skipProjectCreation}
                    onChange={(e) => setEditForm({ ...editForm, skipProjectCreation: e.target.checked })}
                    className="w-4 h-4 rounded accent-brand-700" />
                  Retainer only — don't create a project/workflow (e.g. hosting)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={editForm.isSubscription}
                    onChange={(e) => setEditForm({ ...editForm, isSubscription: e.target.checked, isRecurring: e.target.checked || editForm.isRecurring })}
                    className="w-4 h-4 rounded accent-brand-700" />
                  Subscription — bought in and resold (hosting, domain, mailbox), and only usable once paid
                </label>
                {editForm.isSubscription && (
                  <div className="pl-6 space-y-1.5">
                    <label className="block text-xs font-medium text-gray-600">Vendor <span className="text-gray-400 font-normal">(who it&apos;s bought from)</span></label>
                    <input value={editForm.vendor} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                      placeholder="Hostinger" className={`${inp} max-w-xs`} />
                    <p className="text-xs text-gray-400">
                      Changing this only affects future invoice lines — packages already sold keep the label they were billed under.
                    </p>
                  </div>
                )}

                <div className="pt-2 border-t border-gray-200 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-gray-600">What&apos;s included <span className="text-gray-400 font-normal">(shown to clients so they can compare packages)</span></p>
                    <button
                      onClick={() => setEditForm({ ...editForm, features: [...editForm.features, ''] })}
                      className="text-xs font-medium text-brand-800 hover:text-brand-900"
                    >
                      + Add feature
                    </button>
                  </div>
                  {editForm.features.map((feature, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={feature} placeholder="e.g. Up to 30 keywords tracked monthly"
                        onChange={(e) => setEditForm({ ...editForm, features: editForm.features.map((f, j) => j === i ? e.target.value : f) })}
                        className={`${inp} flex-1`} />
                      <button onClick={() => setEditForm({ ...editForm, features: editForm.features.filter((_, j) => j !== i) })}
                        className="p-1.5 text-gray-400 hover:text-red-500">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* ── Services: bundle 1..N services, each with its own workflow ── */}
                <div className="pt-3 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-700">Services</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Add every service this package includes. Selling it spawns one workflow per service — so separate teams can run
                    separate workflows while the client sees one package.
                  </p>
                </div>
                <div className="space-y-2">
                  {svcRows.map((row, i) => {
                    const tmplsForSvc = (templates as any[]).filter((tm: any) => tm.serviceTypeKey === row.serviceTypeKey);
                    return (
                      <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <select
                          value={row.serviceTypeKey}
                          onChange={(e) => setSvcRow(i, { serviceTypeKey: e.target.value, workflowTemplateId: '' })}
                          className={`${inp} sm:flex-1`}
                        >
                          <option value="">Select service…</option>
                          {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
                        </select>
                        <select
                          value={row.workflowTemplateId}
                          onChange={(e) => setSvcRow(i, { workflowTemplateId: e.target.value })}
                          className={`${inp} sm:flex-1`}
                        >
                          <option value="">Auto — newest active workflow</option>
                          {tmplsForSvc.map((tm: any) => <option key={tm.id} value={tm.id}>{tm.name} (v{tm.version})</option>)}
                        </select>
                        <button
                          onClick={() => setSvcRows((rows) => rows.filter((_, j) => j !== i))}
                          className="p-2 text-gray-400 hover:text-red-500 rounded-lg shrink-0 self-start sm:self-auto"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={() => setSvcRows((rows) => [...rows, { serviceTypeKey: '', workflowTemplateId: '' }])}
                  className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add service
                </button>
                <div className="flex gap-2 pt-3 border-t border-gray-200">
                  <button
                    onClick={() => editMutation.mutate({ id: pkg.id, data: editForm, services: svcRows })}
                    disabled={editMutation.isPending}
                    className={btnPrimary}
                  >
                    <Save className="w-4 h-4" />
                    {editMutation.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button onClick={() => setEditingId(null)} className={btnGhost}>Cancel</button>
                </div>
              </div>
            )}
          </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={!!deleteId}
        title="Set package to Inactive"
        message="It stops being sellable. Packages already sold to clients keep their price and features on existing projects, retainers and invoices, and you can set it back to Active here at any time — nothing is deleted."
        confirmLabel="Set Inactive"
        onConfirm={() => deleteId && toggleActive.mutate({ id: deleteId, next: false })}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
