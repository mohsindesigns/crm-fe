'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { titleCase } from '@/lib/utils';
import { invalidateMany, afterClientChange, afterProjectChange } from '@/lib/queryInvalidation';
import { usersForRoleSlot } from '@/lib/projectTeam';

type ServiceRow = {
  serviceTypeKey: string; workflowTemplateId: string; packageId: string;
  discountType: string; discountValue: string; customPrice: string;
};

const BLANK_SERVICE: ServiceRow = { serviceTypeKey: '', workflowTemplateId: '', packageId: '', discountType: '', discountValue: '', customPrice: '' };

export default function NewProjectPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    clientId: '',
    startDate: '',
    deliveryDate: '',
    description: '',
  });
  const [services, setServices] = useState<ServiceRow[]>([{ ...BLANK_SERVICE }]);
  const [retainerAmount, setRetainerAmount] = useState('');
  const [retainerCycle, setRetainerCycle] = useState('monthly');
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get('/admin/templates').then((r) => r.data),
  });

  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => api.get('/admin/packages').then((r) => r.data).catch(() => []),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  function setService(i: number, patch: Partial<ServiceRow>) {
    setServices((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function addService() {
    setServices((rows) => [...rows, { ...BLANK_SERVICE }]);
  }

  function removeService(i: number) {
    setServices((rows) => rows.filter((_, j) => j !== i));
  }

  // Team assignment only applies when creating a single service — with multiple
  // services each spawns its own project and is assigned individually afterwards.
  const singleTemplate = services.length === 1
    ? (templates as any[]).find((t: any) => t.id === services[0].workflowTemplateId)
    : null;
  const roleSlots = singleTemplate
    ? [...new Set((singleTemplate.stages || []).map((s: any) => s.ownerRoleSlot).filter(Boolean))]
    : [];

  // Rows with a package selected are a real sale (discount, ClientPackage record,
  // auto-billed retainer) — routed through the same sell-package endpoint the
  // Client page uses. Rows with no package are ad-hoc (no pricing/discount, since
  // there's nothing to discount) and keep the old direct-create + manual-retainer path.
  const packagedServices = services.filter((s) => s.packageId);
  const adhocServices = services.filter((s) => !s.packageId);

  // Recurring billing panel only covers ad-hoc recurring services — a packaged
  // recurring service is already auto-billed (at its discounted price) by sellPackage.
  const hasRecurringAdhocService = adhocServices.some((s) => {
    const t = (templates as any[]).find((tm: any) => tm.id === s.workflowTemplateId);
    return !!t?.isRecurring;
  });
  const hasRecurringService = hasRecurringAdhocService;

  const mutation = useMutation({
    mutationFn: async () => {
      const createdProjects: any[] = [];
      const billingErrors: string[] = [];

      // One sell-package call per unique package selected (a package can bundle
      // several services and spawns a project for each on its own).
      const seenPackages = new Set<string>();
      for (const svc of packagedServices) {
        if (seenPackages.has(svc.packageId)) continue;
        seenPackages.add(svc.packageId);
        const result = await api.post(`/clients/${form.clientId}/sell-package`, {
          packageId: svc.packageId,
          startDate: form.startDate || undefined,
          discountType: svc.customPrice ? undefined : (svc.discountType || undefined),
          discountValue: !svc.customPrice && svc.discountType && svc.discountValue ? Number(svc.discountValue) : undefined,
          customPrice: svc.customPrice ? Number(svc.customPrice) : undefined,
        }).then((r) => r.data);
        createdProjects.push(...(result.projects || []));
        if (result.billingError) billingErrors.push(result.billingError);
      }

      // Ad-hoc services (no package) — created directly, no pricing involved.
      const adhocProjectIds: string[] = [];
      for (const svc of adhocServices) {
        const project = await api.post('/projects', {
          name: form.name || undefined,
          clientId: form.clientId,
          serviceTypeKey: svc.serviceTypeKey,
          workflowTemplateId: svc.workflowTemplateId,
          startDate: form.startDate || undefined,
          deliveryDate: form.deliveryDate || undefined,
          description: form.description || undefined,
        }).then((r) => r.data);
        createdProjects.push(project);
        if (project?.id) adhocProjectIds.push(project.id);
      }

      if (createdProjects.length === 1) {
        await Promise.all(
          Object.entries(assignments)
            .filter(([, userId]) => !!userId)
            .map(([roleSlot, userId]) => api.post(`/projects/${createdProjects[0].id}/assign`, { roleSlot, userId }))
        );
      }

      // Only bill ad-hoc recurring projects here — packaged sales already create
      // a retainer (with packageId) inside sell-package.
      if (hasRecurringAdhocService && retainerAmount && adhocProjectIds.length) {
        const recurringProject =
          createdProjects.find((p) => adhocProjectIds.includes(p.id) && p.isRecurring)
          || createdProjects.find((p) => adhocProjectIds.includes(p.id));
        if (recurringProject) {
          await api.post('/retainers/auto-create', {
            projectId: recurringProject.id,
            amount: Number(retainerAmount),
            cycle: retainerCycle,
            startDate: form.startDate || undefined,
          }).catch(() => {
            toast.error('Project created, but the retainer could not be auto-created. Add it manually from Retainers.');
          });
        }
      }

      return { createdProjects, billingErrors };
    },
    onSuccess: async ({ createdProjects: projects, billingErrors }) => {
      await invalidateMany(qc, [
        ...afterClientChange(form.clientId),
        ...afterProjectChange(projects[0]?.id),
        ['retainers'],
        ['retainers-summary'],
      ]);
      const n = projects.length;
      toast.success(n > 1 ? `${n} projects created` : 'Project created');
      billingErrors.forEach((msg: string) => toast.error(msg));
      router.push(`/projects/${projects[0].id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to create project';
      setError(msg);
      toast.error(msg);
    },
  });

  function set(field: keyof typeof form, value: any) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.clientId) {
      setError('Please select a client.');
      return;
    }
    if (services.some((s) => !s.serviceTypeKey || !s.workflowTemplateId)) {
      setError('Please select a service type and workflow template for every row.');
      return;
    }
    mutation.mutate();
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="New Project" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl">
          <Link href="/projects" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </Link>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic info */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-900">Project Details</h2>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                  Label <span className="text-gray-400 font-normal">(optional — the project name is generated automatically as "Client — Service")</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Q3 Campaign"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Client *</label>
                <select
                  value={form.clientId}
                  onChange={(e) => set('clientId', e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="">Select client…</option>
                  {clients.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Start date</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) => set('startDate', e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Delivery date</label>
                  <input
                    type="date"
                    value={form.deliveryDate}
                    onChange={(e) => set('deliveryDate', e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={3}
                  placeholder="Optional project brief…"
                  className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                />
              </div>
            </div>

            {/* Services — one or more; each spawns its own workflow */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Services</h2>
                <p className="text-xs text-gray-500 mt-0.5">Add every service this client is buying — each becomes its own project with its own workflow.</p>
              </div>

              {services.map((svc, i) => {
                const filteredTemplates = (templates as any[]).filter(
                  (t: any) => !svc.serviceTypeKey || t.serviceTypeKey === svc.serviceTypeKey
                );
                const filteredPackages = (packages as any[]).filter(
                  (p: any) => p.serviceTypeKey === svc.serviceTypeKey || (p.services || []).some((s: any) => s.serviceTypeKey === svc.serviceTypeKey)
                );
                return (
                  <div key={i} className="border border-gray-200 rounded-lg p-3.5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-500">Service {i + 1}</span>
                      {services.length > 1 && (
                        <button type="button" onClick={() => removeService(i)} className="p-1 text-gray-400 hover:text-red-500 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Service type *</label>
                        <select
                          value={svc.serviceTypeKey}
                          onChange={(e) => setService(i, { serviceTypeKey: e.target.value, workflowTemplateId: '', packageId: '' })}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        >
                          <option value="">Select service…</option>
                          {(serviceTypes as any[]).map((s: any) => (
                            <option key={s.key} value={s.key}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Workflow template *</label>
                        <select
                          value={svc.workflowTemplateId}
                          onChange={(e) => setService(i, { workflowTemplateId: e.target.value })}
                          disabled={!svc.serviceTypeKey}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-50"
                        >
                          <option value="">Select template…</option>
                          {filteredTemplates.map((t: any) => (
                            <option key={t.id} value={t.id}>{t.name}{t.isRecurring ? ' (recurring)' : ''}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {filteredPackages.length > 0 && (
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Package</label>
                        <select
                          value={svc.packageId}
                          onChange={(e) => setService(i, { packageId: e.target.value, discountType: '', discountValue: '', customPrice: '' })}
                          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        >
                          <option value="">No package</option>
                          {filteredPackages.map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name} {p.price ? `· ${p.currency} ${p.price}` : ''}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    {svc.packageId && (() => {
                      const pkg = filteredPackages.find((p: any) => p.id === svc.packageId);
                      const svcCount = (pkg?.services || []).length || 1;
                      const base = Number(pkg?.price || 0);
                      const discountValue = Number(svc.discountValue || 0);
                      const finalPrice = svc.customPrice
                        ? Math.max(0, Number(svc.customPrice))
                        : svc.discountType === 'percent'
                        ? Math.max(0, base - (base * Math.min(discountValue, 100)) / 100)
                        : svc.discountType === 'fixed'
                        ? Math.max(0, base - discountValue)
                        : base;
                      return (
                        <div className="space-y-3 pt-1 border-t border-gray-100">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1.5">Sell price <span className="text-gray-400 font-normal">(optional override)</span></label>
                              <input
                                type="number"
                                min="0"
                                value={svc.customPrice}
                                onChange={(e) => setService(i, { customPrice: e.target.value, discountType: '', discountValue: '' })}
                                placeholder="Custom amount instead of list price"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                              />
                            </div>
                            {!svc.customPrice && (
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">Discount <span className="text-gray-400 font-normal">(optional)</span></label>
                                <select
                                  value={svc.discountType}
                                  onChange={(e) => setService(i, { discountType: e.target.value })}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                                >
                                  <option value="">No discount</option>
                                  <option value="percent">Percentage off</option>
                                  <option value="fixed">Fixed amount off</option>
                                </select>
                              </div>
                            )}
                            {!svc.customPrice && svc.discountType && (
                              <div>
                                <label className="block text-xs font-medium text-gray-600 mb-1.5">
                                  {svc.discountType === 'percent' ? 'Discount %' : 'Discount amount'}
                                </label>
                                <input
                                  type="number"
                                  min="0"
                                  value={svc.discountValue}
                                  onChange={(e) => setService(i, { discountValue: e.target.value })}
                                  placeholder={svc.discountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                                />
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                            This will sell the package and create <strong>{svcCount}</strong> workflow{svcCount !== 1 ? 's' : ''}, one per included service.
                            {svc.customPrice && (
                              <> Sell price: <strong>{pkg?.currency} {finalPrice.toLocaleString()}</strong> (list is {pkg?.currency} {base.toLocaleString()}).</>
                            )}
                            {!svc.customPrice && svc.discountType && discountValue > 0 && (
                              <> Price after discount: <strong>{pkg?.currency} {finalPrice.toLocaleString()}</strong> (was {pkg?.currency} {base.toLocaleString()}).</>
                            )}
                            {pkg?.isRecurring && <> Bills on a <strong>{pkg.billingCycle}</strong> cycle — a retainer is created automatically at the price above.</>}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addService}
                className="flex items-center gap-1.5 text-sm text-brand-700 hover:text-brand-800 font-medium"
              >
                <Plus className="w-4 h-4" /> Add another service
              </button>
            </div>

            {/* Recurring billing — appears only when a selected workflow is recurring */}
            {hasRecurringService && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Recurring Billing</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    This service recurs — set an amount to auto-create a retainer and bill the first cycle now, instead of setting one up separately.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount per cycle</label>
                    <input
                      type="number"
                      min="0"
                      value={retainerAmount}
                      onChange={(e) => setRetainerAmount(e.target.value)}
                      placeholder="Leave blank to skip"
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Billing cycle</label>
                    <select
                      value={retainerCycle}
                      onChange={(e) => setRetainerCycle(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="annual">Annual</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Team assignment — only for single-service creation */}
            {roleSlots.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-900">Team Assignment</h2>
                <p className="text-xs text-gray-500">Assign team members to stage roles. You can update these later.</p>
                {roleSlots.map((slot) => (
                  <div key={slot as string}>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5 capitalize">
                      {titleCase(String(slot))}
                    </label>
                    <select
                      value={assignments[slot as string] || ''}
                      onChange={(e) => setAssignments((a) => ({ ...a, [slot as string]: e.target.value }))}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Unassigned</option>
                      {usersForRoleSlot(users, slot as string, assignments[slot as string] || null).map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            )}
            {services.length > 1 && (
              <p className="text-xs text-gray-400 -mt-2">Multiple services selected — assign each project's team from its own page after creation.</p>
            )}

            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg border border-red-200">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <Link
                href="/projects"
                className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                {mutation.isPending ? 'Creating…' : services.length > 1 ? 'Create Projects' : 'Create Project'}
                {!mutation.isPending && <ChevronRight className="w-4 h-4" />}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
