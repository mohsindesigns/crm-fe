'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Plus, Trash2, RotateCcw, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { invalidateMany, afterDocumentChange } from '@/lib/queryInvalidation';
import RichTextEditor from '@/components/RichTextEditor';
import { sanitizeRichHtml, richTextProseClass } from '@/lib/richText';

const DOC_TYPES = [
  { value: 'quotation', label: 'Quotation' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'proposal',  label: 'Proposal'  },
];

// Quick-insert wording for the "Terms & Scope of Work" field on agreements/proposals —
// admin picks one as a starting point and can freely edit the inserted text.
const PAYMENT_SCHEDULE_SNIPPETS = [
  { label: '100% Upfront', html: '<p><strong>Payment Schedule:</strong> 100% payment due upfront before work begins.</p>' },
  { label: '50% Upfront / 50% on Completion', html: '<p><strong>Payment Schedule:</strong> 50% payment due upfront, remaining 50% due on completion and before the project goes live on the domain.</p>' },
  { label: 'Date-wise Split', html: '<p><strong>Payment Schedule:</strong> [amount/%] due on [date], [amount/%] due on [date].</p>' },
];

type LineItem = { description: string; qty: string; unitPrice: string };
type ServiceRow = { serviceTypeKey: string; packageId: string; price: string; scope: string };
type PricingMode = 'fixed' | 'compare';
/** Per-service, per-package price override for THIS document: key → packageId → price. */
type MenuPrices = Record<string, Record<string, string>>;
const emptyLine = (): LineItem => ({ description: '', qty: '1', unitPrice: '' });
/** Local calendar YYYY-MM-DD — never use toISOString() (UTC can clear date inputs). */
function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Local calendar date N days from today (YYYY-MM-DD). */
function daysFromToday(days: number) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const DEFAULT_QUOTATION_VALID_DAYS = 7;

export default function NewDocumentPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: 'quotation',
    templateId: '',
    clientId: '',
    prospectName: '',
    businessName: '',
    email: '',
    phone: '',
    currency: 'USD',
    amount: '',
    discountType: '',
    discountValue: '',
    discountCycles: '',
    // Quotations default to a 7-day validity window; admin can change freely.
    validUntil: daysFromToday(DEFAULT_QUOTATION_VALID_DAYS),
    scopeTerms: '',
  });
  const [services, setServices] = useState<ServiceRow[]>([]);
  // A newly-checked service starts expanded (not in this set) so its package
  // picker is immediately visible; once configured, the admin can collapse it
  // to cut down on scrolling when several services are selected at once.
  const [collapsedServices, setCollapsedServices] = useState<Set<string>>(new Set());
  function toggleServiceCollapsed(key: string) {
    setCollapsedServices((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  // "Client chooses" mode: candidate packages offered PER service — independent
  // of every other service, and any count works (even just one — the client
  // still has to actively pick it, it's just not a comparison). Keyed by
  // serviceTypeKey. Not tied to a global "pick 2+ for the whole deal" idea.
  const [packageMenu, setPackageMenu] = useState<Record<string, string[]>>({});
  // Per-package price overrides that apply to THIS document only — the package's
  // own catalogue price is never touched, so re-pricing one quotation can't
  // change what every other client is quoted.
  const [menuPrices, setMenuPrices] = useState<MenuPrices>({});
  const [pricingMode, setPricingMode] = useState<PricingMode>('fixed');
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Keep Valid Until filled for quotations (hydration / cleared date inputs).
  useEffect(() => {
    if (form.type !== 'quotation') return;
    if (form.validUntil) return;
    setForm((f) => ({ ...f, validUntil: daysFromToday(DEFAULT_QUOTATION_VALID_DAYS) }));
  }, [form.type, form.validUntil]);

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['document-templates'],
    queryFn: () => api.get('/admin/document-templates').then((r) => r.data),
  });

  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => api.get('/admin/packages').then((r) => r.data).catch(() => []),
  });

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  // The list endpoint returns contacts as bare ids (it only needs a count), so
  // the full record has to be fetched to autofill from — reading contacts off
  // the list row silently produced empty name/email and fell back to the client
  // name for the business.
  const { data: selectedClient = null } = useQuery({
    queryKey: ['client', form.clientId],
    queryFn: () => api.get(`/clients/${form.clientId}`).then((r) => r.data),
    enabled: !!form.clientId,
  });

  function selectClient(clientId: string) {
    if (!clientId) {
      // Don't leave the previous client's details behind under a blank picker.
      prefilledFor.current = '';
      setForm((f) => ({ ...f, clientId: '', prospectName: '', businessName: '', email: '', phone: '' }));
      return;
    }
    setForm((f) => ({ ...f, clientId }));
  }

  // Arriving from a client's "New Quotation"/"New Agreement" button (e.g.
  // /documents/new?clientId=…&type=agreement) pre-scopes the doc to that
  // client and type instead of landing on a blank picker they'd have to
  // re-fill with data they just came from.
  useEffect(() => {
    const clientIdParam = searchParams.get('clientId');
    const typeParam = searchParams.get('type');
    if (typeParam && DOC_TYPES.some((t) => t.value === typeParam)) {
      setForm((f) => ({ ...f, type: typeParam }));
    }
    if (clientIdParam) selectClient(clientIdParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Autofill once per client, not on every refetch — otherwise React Query
  // refocusing the window would wipe out edits the admin had already made.
  const prefilledFor = useRef('');
  useEffect(() => {
    if (!selectedClient?.id || prefilledFor.current === selectedClient.id) return;
    prefilledFor.current = selectedClient.id;
    const contacts = (selectedClient.contacts || []).filter((c: any) => c.isActive !== false);
    const contact = contacts.find((c: any) => c.useForInvoice) || contacts[0] || null;
    setForm((f) => ({
      ...f,
      prospectName: contact?.name || '',
      businessName: contact?.businessName || selectedClient.name || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      currency: selectedClient.defaultCurrency || f.currency,
    }));
  }, [selectedClient]);

  const selectedKeys = services.map((s) => s.serviceTypeKey);
  const primaryServiceKey = selectedKeys[0] || '';

  // Templates for the chosen doc type: a 'standard' template works for any
  // selection; a service-specific one only when its service is selected.
  const filteredTemplates = (templates as any[]).filter(
    (t: any) => t.type === form.type && t.isActive &&
      (selectedKeys.length === 0 || t.serviceTypeKey === 'standard' || selectedKeys.includes(t.serviceTypeKey))
  );
  const selectedTemplateName = (templates as any[]).find((t: any) => t.id === form.templateId)?.name || '';

  function packagesFor(key: string) {
    return (packages as any[]).filter(
      (p: any) => p.serviceTypeKey === key || (p.services || []).some((s: any) => s.serviceTypeKey === key)
    );
  }

  function togglePackageMenuOption(serviceTypeKey: string, packageId: string) {
    setPackageMenu((prev) => {
      const current = prev[serviceTypeKey] || [];
      const next = current.includes(packageId) ? current.filter((x) => x !== packageId) : [...current, packageId];
      return { ...prev, [serviceTypeKey]: next };
    });
  }

  /** The price this document quotes for a package — the override if set, else list. */
  function effectivePrice(serviceTypeKey: string, pkg: any) {
    const raw = menuPrices[serviceTypeKey]?.[pkg.id];
    if (raw === undefined || raw === '') return Number(pkg.price) || 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : (Number(pkg.price) || 0);
  }

  function setMenuPrice(serviceTypeKey: string, packageId: string, value: string) {
    setMenuPrices((prev) => ({
      ...prev,
      [serviceTypeKey]: { ...(prev[serviceTypeKey] || {}), [packageId]: value },
    }));
  }

  function clearMenuPrice(serviceTypeKey: string, packageId: string) {
    setMenuPrices((prev) => {
      const forService = { ...(prev[serviceTypeKey] || {}) };
      delete forService[packageId];
      return { ...prev, [serviceTypeKey]: forService };
    });
  }

  function setPricingModeSafe(mode: PricingMode) {
    setPricingMode(mode);
    if (mode === 'fixed') {
      setPackageMenu({});
      setMenuPrices({});
    } else {
      // Packages drive the price — clear service prices / package locks / line items.
      setServices((prev) => prev.map((s) => ({ ...s, packageId: '', price: '' })));
      setLines([emptyLine()]);
    }
  }

  // Switching to "Client chooses" offers EVERY package of every selected service
  // by default — that's what an admin means by the mode almost every time, and
  // unticking the few that don't apply is far less work than ticking them all.
  // Keyed by service: a service whose key is already present has been curated
  // (even down to an empty list), so it is never silently refilled.
  useEffect(() => {
    if (pricingMode !== 'compare') return;
    setPackageMenu((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of selectedKeys) {
        if (next[key] !== undefined) continue;
        next[key] = packagesFor(key).map((p: any) => p.id);
        changed = true;
      }
      // Deselecting a service drops its menu, so re-selecting it starts fresh.
      for (const key of Object.keys(next)) {
        if (!selectedKeys.includes(key)) { delete next[key]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [pricingMode, selectedKeys.join(','), packages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every selected service needs at least one package offered — that's what
  // makes this mode active (not a global "2+" threshold; a service can be
  // offered with just one package, the client still has to actively pick it).
  const packageMenuPayload = selectedKeys
    .map((key) => {
      const packageIds = (packageMenu[key] || []).filter((pid) => packagesFor(key).some((p: any) => p.id === pid));
      const prices: Record<string, number> = {};
      for (const pid of packageIds) {
        const raw = menuPrices[key]?.[pid];
        if (raw === undefined || raw === '') continue;
        const n = Number(raw);
        if (Number.isFinite(n) && n >= 0) prices[pid] = n;
      }
      return { serviceTypeKey: key, packageIds, ...(Object.keys(prices).length ? { prices } : {}) };
    })
    .filter((entry) => entry.packageIds.length > 0);
  const isCompareMode = pricingMode === 'compare' && packageMenuPayload.length > 0 && packageMenuPayload.length === selectedKeys.length;

  function applyDiscountPreview(base: number) {
    const value = Number(form.discountValue || 0);
    if (!form.discountType || value <= 0) return base;
    if (form.discountType === 'percent') return Math.max(0, base - (base * Math.min(value, 100)) / 100);
    return Math.max(0, base - value);
  }

  // Estimated aggregate range: sum of each service's cheapest offered package to
  // sum of each service's priciest offered package — a real per-service range,
  // not a single flat list treated as alternatives for the whole deal. Uses the
  // per-document price, so an override moves the range with it.
  const perServicePriceRanges = packageMenuPayload.map((entry) => {
    const prices = entry.packageIds
      .map((pid) => (packages as any[]).find((p: any) => p.id === pid))
      .filter(Boolean)
      .map((p: any) => effectivePrice(entry.serviceTypeKey, p))
      .filter((n: number) => Number.isFinite(n) && n >= 0);
    return { min: prices.length ? Math.min(...prices) : 0, max: prices.length ? Math.max(...prices) : 0 };
  });
  const optionMin = perServicePriceRanges.length ? perServicePriceRanges.reduce((s, r) => s + r.min, 0) : null;
  const optionMax = perServicePriceRanges.length ? perServicePriceRanges.reduce((s, r) => s + r.max, 0) : null;
  const rangeMin = optionMin != null ? applyDiscountPreview(optionMin) : null;
  const rangeMax = optionMax != null ? applyDiscountPreview(optionMax) : null;

  // Auto-select the best template whenever type/services change — the exact
  // service template for a single service, the Standard one for multi-service.
  // Admin can still override manually afterwards.
  useEffect(() => {
    if (!selectedKeys.length) return;
    const actives = (templates as any[]).filter((t: any) => t.type === form.type && t.isActive);
    const match = selectedKeys.length === 1
      ? (actives.find((t: any) => t.serviceTypeKey === selectedKeys[0]) || actives.find((t: any) => t.serviceTypeKey === 'standard'))
      : actives.find((t: any) => t.serviceTypeKey === 'standard');
    if (match && form.templateId !== match.id) {
      setForm((f) => ({ ...f, templateId: match.id }));
    }
  }, [form.type, selectedKeys.join(','), templates]); // eslint-disable-line react-hooks/exhaustive-deps

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function toggleService(key: string) {
    const alreadySelected = services.some((s) => s.serviceTypeKey === key);
    setServices((prev) => alreadySelected
      ? prev.filter((s) => s.serviceTypeKey !== key)
      : [...prev, { serviceTypeKey: key, packageId: '', price: '', scope: '' }]);
    // Freshly (re-)selecting a service should always start expanded.
    if (!alreadySelected) {
      setCollapsedServices((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function updateService(key: string, patch: Partial<ServiceRow>) {
    setServices((prev) => prev.map((s) => (s.serviceTypeKey === key ? { ...s, ...patch } : s)));
  }

  function selectServicePackage(key: string, packageId: string) {
    const pkg = (packages as any[]).find((p: any) => p.id === packageId);
    setServices((prev) => prev.map((s) => (s.serviceTypeKey === key
      ? { ...s, packageId, price: pkg?.price != null ? String(pkg.price) : s.price }
      : s)));
    if (pkg?.currency) setForm((f) => ({ ...f, currency: pkg.currency }));
  }

  const servicesTotal = services.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);
  const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);
  // A quotation only has real line items once the user actually fills one in —
  // until then fall back to the per-service prices, then to the manual amount.
  const hasLineItems = !isCompareMode && lines.some((l) => l.description && l.unitPrice);
  const baseAmount = isCompareMode
    ? 0
    : form.type === 'quotation'
      ? (hasLineItems ? lineTotal : (servicesTotal || Number(form.amount) || 0))
      : (servicesTotal || Number(form.amount) || 0);

  const servicesPayload = services.map((s) => ({
    serviceTypeKey: s.serviceTypeKey,
    packageId: isCompareMode ? undefined : (s.packageId || undefined),
    price: isCompareMode ? undefined : (s.price !== '' ? Number(s.price) : undefined),
    scope: s.scope || undefined,
  }));

  // Debounced live preview — mirrors the 350ms search-debounce convention used elsewhere.
  useEffect(() => {
    if (!primaryServiceKey || (!form.templateId && filteredTemplates.length === 0)) { setPreview(''); return; }
    const t = setTimeout(() => {
      setPreviewLoading(true);
      api.post('/documents/preview', {
        type: form.type,
        serviceTypeKey: primaryServiceKey,
        services: servicesPayload,
        packageMenu: packageMenuPayload.length ? packageMenuPayload : undefined,
        templateId: form.templateId || undefined,
        prospectName: form.prospectName,
        businessName: form.businessName,
        email: form.email,
        phone: form.phone,
        packageId: services[0]?.packageId || undefined,
        currency: form.currency,
        amount: baseAmount || undefined,
        discountType: form.discountType || undefined,
        discountValue: form.discountValue || undefined,
        discountCycles: form.discountCycles || undefined,
        scopeTerms: form.scopeTerms,
        validUntil: form.validUntil,
      }).then((r) => setPreview(r.data.rendered || ''))
        .catch((e: any) => setPreview(e?.response?.data?.message || 'Preview failed — check services and template.'))
        .finally(() => setPreviewLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [form, services, baseAmount, packageMenu, menuPrices, pricingMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: () => api.post('/documents', {
      ...form,
      serviceTypeKey: primaryServiceKey,
      services: servicesPayload,
      packageMenu: packageMenuPayload.length ? packageMenuPayload : undefined,
      packageId: services[0]?.packageId || undefined,
      templateId: form.templateId || undefined,
      amount: baseAmount || undefined,
      lineItems: form.type === 'quotation' && hasLineItems
        ? lines.filter((l) => l.description && l.unitPrice).map((l) => ({ description: l.description, qty: Number(l.qty) || 1, unitPrice: Number(l.unitPrice) }))
        : undefined,
      validUntil: form.validUntil || undefined,
    }).then((r) => r.data),
    onSuccess: async (doc) => {
      await invalidateMany(qc, afterDocumentChange(doc?.id));
      toast.success('Document saved as draft.');
      router.push(`/documents/${doc.id}`);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Failed to create document.';
      setError(msg);
      toast.error(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.clientId) {
      setError('Select the client this document is for. Create the client first if they are not in the list yet.');
      return;
    }
    if (!services.length || !form.prospectName || !form.email) {
      setError('At least one service, contact person, and email are required.');
      return;
    }
    if (pricingMode === 'compare' && packageMenuPayload.length < selectedKeys.length) {
      setError('Offer at least one package for every selected service.');
      return;
    }
    if (form.validUntil && form.validUntil < todayStr()) {
      setError('Valid Until cannot be in the past.');
      return;
    }
    mutation.mutate();
  }

  const servicesMissingPackages = pricingMode === 'compare'
    ? selectedKeys.filter((key) => !(packageMenu[key] || []).length)
    : [];
  const serviceNameFor = (key: string) => (serviceTypes as any[]).find((s: any) => s.key === key)?.name || key;

  return (
    <div className="flex flex-col h-full">
      <Header title="New Document" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-5xl">
          <Link href="/documents" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5 sm:mb-6">
            <ArrowLeft className="w-4 h-4" />
            Back to documents
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-start">
            <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6 min-w-0">
              {/* Type / Template */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-900">Type &amp; Template</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Type <span className="text-red-500">*</span></label>
                    <select
                      value={form.type}
                      onChange={(e) => {
                        const type = e.target.value;
                        setForm((f) => ({
                          ...f,
                          type,
                          validUntil: type === 'quotation' && !f.validUntil
                            ? daysFromToday(DEFAULT_QUOTATION_VALID_DAYS)
                            : f.validUntil,
                        }));
                      }}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                      {DOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Template</label>
                    <select value={form.templateId} onChange={(e) => set('templateId', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                      <option value="">Auto-select active template</option>
                      {filteredTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                </div>
                {services.length > 0 && filteredTemplates.length === 0 && (
                  <p className="text-xs text-amber-600">No active template for this type/service yet — create one (or a Standard one) in Admin → Document Templates.</p>
                )}
                {services.length > 1 && (
                  <p className="text-xs text-gray-400">Multiple services render inside the template&apos;s {'{{services_block}}'} token — use a Standard template that contains it.</p>
                )}
              </div>

              {/* Pricing mode — decided BEFORE services, because it changes what
                  each service row asks for. Choosing it afterwards meant
                  scrolling back up to redo every service you'd just filled in. */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">How should packages work?</h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Choose this first — it decides what each service below asks you for.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPricingModeSafe('fixed')}
                    className={`text-left rounded-lg border px-3.5 py-3 transition-colors ${
                      pricingMode === 'fixed' ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900">Fixed quote</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">You set prices. Optionally quick-fill from a package inside each service.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPricingModeSafe('compare')}
                    className={`text-left rounded-lg border px-3.5 py-3 transition-colors ${
                      pricingMode === 'compare' ? 'border-brand-400 bg-brand-50/40 ring-1 ring-brand-200' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900">Client chooses</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Every package of each selected service is offered by default — untick any you don&apos;t want. Client picks on the quotation link.</p>
                  </button>
                </div>

                {pricingMode === 'compare' && selectedKeys.length === 0 && (
                  <p className="text-xs text-gray-500">Select your services below — their packages are offered automatically.</p>
                )}
                {pricingMode === 'compare' && servicesMissingPackages.length > 0 && (
                  <p className="text-xs text-amber-600">
                    No package offered yet for {servicesMissingPackages.map(serviceNameFor).join(', ')} — tick at least one in that service&apos;s row below.
                  </p>
                )}
                {pricingMode === 'compare' && isCompareMode && rangeMin != null && rangeMax != null && (
                  <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3.5 py-3">
                    <p className="text-xs font-medium text-brand-900">Estimated total range</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {rangeMin === rangeMax
                        ? `${form.currency} ${rangeMin.toLocaleString()}`
                        : `${form.currency} ${rangeMin.toLocaleString()} – ${rangeMax.toLocaleString()}`}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Client picks a package per service on the quotation link you send them. Final total locks in when they approve there.
                    </p>
                  </div>
                )}
              </div>

              {/* Services */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-3">
                <h2 className="text-sm font-semibold text-gray-900">Services <span className="text-red-500">*</span></h2>
                <p className="text-xs text-gray-500">Select one or more services to include in this document.</p>
                <div className="space-y-2">
                  {(serviceTypes as any[]).map((s: any) => {
                    const row = services.find((x) => x.serviceTypeKey === s.key);
                    const isCollapsed = collapsedServices.has(s.key);
                    return (
                      <div key={s.key} className={`border rounded-lg ${row ? 'border-brand-300 bg-brand-50/30' : 'border-gray-200'}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-3.5 py-2.5">
                          <label className="flex items-center gap-2.5 cursor-pointer select-none flex-1 min-w-0">
                            <input type="checkbox" checked={!!row} onChange={() => toggleService(s.key)}
                              className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                            <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                          </label>
                          {row && (
                            <button
                              type="button"
                              onClick={() => toggleServiceCollapsed(s.key)}
                              className="text-gray-400 hover:text-gray-700 p-1 -m-1 shrink-0"
                              title={isCollapsed ? 'Expand' : 'Collapse'}
                            >
                              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                            </button>
                          )}
                        </div>
                        {row && !isCollapsed && (
                          <div className="px-3 sm:px-3.5 pb-3.5 space-y-2.5">
                            {pricingMode === 'fixed' ? (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Quick-fill from package</label>
                                  <select value={row.packageId} onChange={(e) => selectServicePackage(s.key, e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                                    <option value="">Manual price</option>
                                    {packagesFor(s.key).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` · ${p.currency} ${p.price}` : ''}</option>)}
                                  </select>
                                  <p className="text-[10px] text-gray-400 mt-1">Only fills price for this service — not a client choice.</p>
                                </div>
                                <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">Price</label>
                                  <input type="number" min="0" step="0.01" placeholder="0.00" value={row.price}
                                    onChange={(e) => updateService(s.key, { price: e.target.value })}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                <p className="text-[11px] font-medium text-gray-500">Packages offered for this service <span className="text-gray-400 font-normal">(all ticked by default — untick any you don&apos;t want)</span></p>
                                {packagesFor(s.key).length === 0 && (
                                  <p className="text-[11px] text-amber-600">No packages defined for this service yet — add some in Admin → Packages.</p>
                                )}
                                {packagesFor(s.key).map((p: any) => {
                                  const offered = (packageMenu[s.key] || []).includes(p.id);
                                  const override = menuPrices[s.key]?.[p.id];
                                  const hasOverride = override !== undefined && override !== ''
                                    && Number(override) !== Number(p.price);
                                  return (
                                    <div key={p.id} className={`rounded-lg border ${offered ? 'border-brand-300 bg-brand-50/40' : 'border-gray-200 bg-white/70'}`}>
                                      <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none">
                                        <input type="checkbox" checked={offered} onChange={() => togglePackageMenuOption(s.key, p.id)}
                                          className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                                        <span className="text-sm text-gray-800 flex-1 min-w-0 break-words">{p.tier || p.name}</span>
                                        {p.price != null && (
                                          <span className={`text-xs font-mono shrink-0 ${hasOverride ? 'text-gray-400 line-through' : 'text-gray-500'}`}>
                                            {p.currency} {Number(p.price).toLocaleString()}
                                          </span>
                                        )}
                                      </label>
                                      {/* Re-price a package for this quotation only. Leave blank
                                          to quote the catalogue price. */}
                                      {offered && (
                                        <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-9">
                                          <label className="text-[11px] text-gray-500 shrink-0">Price on this quotation</label>
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-gray-400">{p.currency || form.currency}</span>
                                            <input
                                              type="number" min="0" step="0.01"
                                              placeholder={p.price != null ? String(p.price) : '0.00'}
                                              value={override ?? ''}
                                              onChange={(e) => setMenuPrice(s.key, p.id, e.target.value)}
                                              className="w-28 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-600" />
                                            {hasOverride && (
                                              <button type="button" onClick={() => clearMenuPrice(s.key, p.id)}
                                                title="Use the package's own price"
                                                className="text-gray-400 hover:text-gray-700 p-1">
                                                <RotateCcw className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </div>
                                          {hasOverride && (
                                            <span className="text-[10px] text-brand-700">This document only — the package keeps its own price everywhere else.</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div>
                              <label className="block text-[11px] font-medium text-gray-500 mb-1">What&apos;s included <span className="text-gray-400 font-normal">(fills this service&apos;s {'{{scope}}'})</span></label>
                              <textarea value={row.scope} onChange={(e) => updateService(s.key, { scope: e.target.value })} rows={2}
                                placeholder="Deliverables for this service…"
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none" />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Client */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Client <span className="text-red-500">*</span></h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Quote an existing client. Their saved details fill in below and stay editable.
                  </p>
                </div>
                <div>
                  <select
                    value={form.clientId}
                    onChange={(e) => selectClient(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                  >
                    <option value="">Select a client…</option>
                    {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {!form.clientId && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      No client yet?{' '}
                      <Link href="/clients" className="text-brand-700 hover:underline font-medium">Create one first</Link>
                      {' '}— their &ldquo;Pay via CRM&rdquo; setting decides how this quote gets invoiced once approved.
                    </p>
                  )}
                  {selectedClient && (
                    <p className="text-xs text-gray-500 mt-1.5">
                      {selectedClient.billingMode === 'stripe'
                        ? 'Pay via CRM is on — once approved, the invoice is issued automatically with a Stripe payment link.'
                        : 'Pay via CRM is off — once approved, the invoice is raised as a draft for you to send.'}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Contact Person <span className="text-red-500">*</span></label>
                    <input value={form.prospectName} onChange={(e) => set('prospectName', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Business Name</label>
                    <input value={form.businessName} onChange={(e) => set('businessName', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Email <span className="text-red-500">*</span></label>
                    <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
                    <input value={form.phone} onChange={(e) => set('phone', e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                  </div>
                </div>
              </div>

              {/* Pricing */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-900">Pricing</h2>

                {isCompareMode ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-3">
                      <p className="text-xs font-medium text-gray-700">Total depends on package choice</p>
                      <p className="text-sm font-semibold text-gray-900 mt-1">
                        {rangeMin != null && rangeMax != null
                          ? (rangeMin === rangeMax
                            ? `${form.currency} ${rangeMin.toLocaleString()}`
                            : `${form.currency} ${rangeMin.toLocaleString()} – ${rangeMax.toLocaleString()}`)
                          : 'Offer at least one package per service above'}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-1">
                        Each service&apos;s package is picked independently by the client. Final total locks in when they approve on the quotation link (after you Send).
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                      <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                        <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                      </select>
                    </div>
                  </div>
                ) : form.type === 'quotation' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Line Items <span className="text-gray-400 font-normal">(optional — overrides service prices)</span></label>
                    <div className="space-y-2">
                      <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 px-1">
                        <span className="col-span-6">Description</span>
                        <span className="col-span-2">Qty</span>
                        <span className="col-span-3">Unit Price</span>
                        <span className="col-span-1" />
                      </div>
                      {lines.map((line, i) => (
                        <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-gray-100 p-2 sm:border-0 sm:p-0">
                          <input className="col-span-12 sm:col-span-6 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                            placeholder="Service description" value={line.description}
                            onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], description: e.target.value }; setLines(n); }} />
                          <input className="col-span-4 sm:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                            type="number" min="1" value={line.qty} placeholder="Qty"
                            onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], qty: e.target.value }; setLines(n); }} />
                          <input className="col-span-6 sm:col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                            type="number" min="0" step="0.01" placeholder="0.00" value={line.unitPrice}
                            onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], unitPrice: e.target.value }; setLines(n); }} />
                          <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}
                            className="col-span-2 sm:col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500 disabled:opacity-30">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setLines([...lines, emptyLine()])}
                        className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium mt-1">
                        <Plus className="w-3.5 h-3.5" /> Add line
                      </button>
                    </div>
                    <div className="flex flex-wrap justify-end items-center gap-2 mt-3 text-sm font-semibold text-gray-900">
                      {!hasLineItems && servicesTotal > 0 && (
                        <span className="text-xs font-normal text-gray-400">(from service prices — add line items above to override)</span>
                      )}
                      Total: {form.currency} {baseAmount.toFixed(2)}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount</label>
                      {servicesTotal > 0 ? (
                        <div className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-700">
                          {form.currency} {servicesTotal.toFixed(2)} <span className="text-xs text-gray-400">(sum of service prices)</span>
                        </div>
                      ) : (
                        <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)}
                          className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                      <select value={form.currency} onChange={(e) => set('currency', e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                        <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                      </select>
                    </div>
                  </div>
                )}

                {(() => {
                  const discountValue = Number(form.discountValue || 0);
                  const finalAmount = applyDiscountPreview(baseAmount);
                  return (
                    <div className="pt-3 border-t border-gray-100 space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">Discount <span className="text-gray-400 font-normal">(optional)</span></label>
                          <select value={form.discountType} onChange={(e) => set('discountType', e.target.value)}
                            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                            <option value="">No discount</option>
                            <option value="percent">Percentage off</option>
                            <option value="fixed">Fixed amount off</option>
                          </select>
                          {isCompareMode && (
                            <p className="text-[10px] text-gray-400 mt-1">Applies on top of the per-package prices above.</p>
                          )}
                        </div>
                        {form.discountType && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                              {form.discountType === 'percent' ? 'Discount %' : 'Discount amount'}
                            </label>
                            <input type="number" min="0" value={form.discountValue} onChange={(e) => set('discountValue', e.target.value)}
                              placeholder={form.discountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                        )}
                        {form.discountType && (
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1.5">
                              Discount valid for <span className="text-gray-400 font-normal">(billing cycles, recurring packages only)</span>
                            </label>
                            <input type="number" min="1" step="1" value={form.discountCycles} onChange={(e) => set('discountCycles', e.target.value)}
                              placeholder="e.g. 3 — blank means it never expires"
                              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                          </div>
                        )}
                      </div>
                      {form.discountType && discountValue > 0 && !isCompareMode && (
                        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                          Total after discount: <strong>{form.currency} {finalAmount.toLocaleString()}</strong>
                          <span className="text-gray-400"> (was {form.currency} {baseAmount.toLocaleString()})</span>
                        </p>
                      )}
                      {form.discountType && discountValue > 0 && isCompareMode && rangeMin != null && rangeMax != null && (
                        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                          Range after discount:{' '}
                          <strong>
                            {rangeMin === rangeMax
                              ? `${form.currency} ${rangeMin.toLocaleString()}`
                              : `${form.currency} ${rangeMin.toLocaleString()} – ${rangeMax.toLocaleString()}`}
                          </strong>
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Validity + terms */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 space-y-4">
                <h2 className="text-sm font-semibold text-gray-900">Validity &amp; Terms</h2>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Valid Until</label>
                  <input type="date" min={todayStr()} value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)}
                    className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                      form.validUntil && form.validUntil < todayStr()
                        ? 'border-red-300 focus:ring-red-400'
                        : 'border-gray-300 focus:ring-brand-600'
                    }`} />
                  {form.type === 'quotation' && (
                    <p className="text-[11px] text-gray-400 mt-1.5">
                      Auto-filled to {DEFAULT_QUOTATION_VALID_DAYS} days from today — change if you need a different window.
                    </p>
                  )}
                  {form.validUntil && form.validUntil < todayStr() && (
                    <p className="text-xs text-red-600 mt-1.5">This date has already passed — a document sent with an expired validity date will be marked Expired immediately. Pick today or a future date.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">
                    Terms &amp; Scope of Work <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  {(form.type === 'agreement' || form.type === 'proposal') && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {PAYMENT_SCHEDULE_SNIPPETS.map((s) => (
                        <button key={s.label} type="button"
                          onClick={() => set('scopeTerms', form.scopeTerms ? `${form.scopeTerms}${s.html}` : s.html)}
                          className="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-full px-3 py-1 transition-colors">
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <RichTextEditor value={form.scopeTerms} onChange={(html) => set('scopeTerms', html)}
                    placeholder="Overall scope of work / terms for this document…" minHeight="min-h-20" />
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-4 py-3 rounded-lg border border-red-200">{error}</p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Link href="/documents" className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                  Cancel
                </Link>
                <button type="submit" disabled={mutation.isPending || !!(form.validUntil && form.validUntil < todayStr())}
                  className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors">
                  {mutation.isPending ? 'Saving…' : 'Save Draft'}
                  {!mutation.isPending && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </form>

            {/* Live preview */}
            <div className="lg:sticky lg:top-6 bg-white rounded-xl border border-gray-200 p-4 sm:p-5 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
                {form.templateId && (
                  <a href={`/admin?tab=templates&edit=${form.templateId}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-800">
                    <Pencil className="w-3.5 h-3.5" /> Edit template
                  </a>
                )}
              </div>
              {selectedTemplateName && (
                <p className="text-[11px] text-gray-400 mb-2">
                  Most of this wording comes from the &ldquo;{selectedTemplateName}&rdquo; template — edit it above to change it for every document that uses it. Only the Terms &amp; Scope of Work field below is specific to this one document.
                </p>
              )}
              {previewLoading && <p className="text-xs text-gray-400 mb-2">Rendering…</p>}
              {preview ? (
                <div className={`text-sm text-gray-700 break-words min-h-40 border border-dashed border-gray-200 rounded-lg p-4 bg-gray-50/50 ${richTextProseClass}`}
                  dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(preview) }} />
              ) : (
                <div className="text-sm text-gray-400 min-h-40 border border-dashed border-gray-200 rounded-lg p-4 bg-gray-50/50">
                  Fill in the form to see a live preview.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
