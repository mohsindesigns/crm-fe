'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, RefreshCw, Copy, Download, Eye, CheckCircle2, ArrowRightCircle, Trash2, Plus, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, formatDate, formatCurrency, titleCase, downloadAuthedFile, viewAuthedFile } from '@/lib/utils';
import { invalidateMany, afterDocumentChange } from '@/lib/queryInvalidation';
import { DOC_STATUS_COLORS } from '../page';
import RichTextEditor from '@/components/RichTextEditor';
import { TimelineSteps, documentTimelineSteps } from '@/components/TimelineSteps';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const EDITABLE_STATUSES = ['draft', 'rejected', 'expired'];
// Quick-insert wording for the "Terms & Scope of Work" field on agreements/proposals —
// admin picks one as a starting point and can freely edit the inserted text.
const PAYMENT_SCHEDULE_SNIPPETS = [
  { label: '100% Upfront', html: '<p><strong>Payment Schedule:</strong> 100% payment due upfront before work begins.</p>' },
  { label: '50% Upfront / 50% on Completion', html: '<p><strong>Payment Schedule:</strong> 50% payment due upfront, remaining 50% due on completion and before the project goes live on the domain.</p>' },
  { label: 'Date-wise Split', html: '<p><strong>Payment Schedule:</strong> [amount/%] due on [date], [amount/%] due on [date].</p>' },
];
/** Local calendar YYYY-MM-DD — avoid toISOString() UTC drift. */
function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type LineItem = { description: string; qty: string; unitPrice: string };
type ServiceRow = { serviceTypeKey: string; packageId: string; price: string; scope: string };
type PricingMode = 'fixed' | 'compare';
/** Per-service, per-package price override for THIS document: key → packageId → price. */
type MenuPrices = Record<string, Record<string, string>>;

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  // Packages offered PER service in "Client chooses" mode — same shape the create
  // form sends, so editing a document can express everything creating one can.
  const [packageMenu, setPackageMenu] = useState<Record<string, string[]>>({});
  const [menuPrices, setMenuPrices] = useState<MenuPrices>({});
  // Packages a pre-menu document offered as one whole-deal choice. Held only
  // until `packages` loads and they can be filed under the service each belongs
  // to (see the migration effect below), then cleared.
  const [legacyPackageOptions, setLegacyPackageOptions] = useState<string[]>([]);
  const [pricingMode, setPricingMode] = useState<PricingMode>('fixed');
  const [convertClientId, setConvertClientId] = useState('');
  const [previewOpening, setPreviewOpening] = useState(false);

  const { data: doc, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.get(`/documents/${id}`).then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  // Needed while EDITING too, not only for the convert dropdown — the edit form
  // lets you move a draft to a different client.
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => api.get('/clients', { params: { limit: 200 } }).then((r) => r.data?.data || []),
    enabled: editing || (doc?.status === 'approved' && !doc?.convertedProjectId),
  });

  /**
   * The FULL client record for the one selected in the edit form.
   *
   * The list above returns contacts as bare ids (`attributes: ['id']` — it only
   * needs a count), so reading `client.contacts[0].email` off a list row always
   * yields undefined. That is what made the form report "this client has no
   * contact email" for clients that plainly have one.
   */
  const { data: editClient = null } = useQuery({
    queryKey: ['client', form?.clientId],
    queryFn: () => api.get(`/clients/${form.clientId}`).then((r) => r.data),
    enabled: !!editing && !!form?.clientId,
  });

  // The client the document was already on. Autofill must only run when the
  // admin actively switches away from it — never on mount, or opening a draft
  // would silently overwrite prospect details someone had hand-edited.
  const loadedClientId = useRef<string | null>(null);

  useEffect(() => {
    if (!editing || !editClient?.id || !form) return;
    if (editClient.id === loadedClientId.current) return;
    loadedClientId.current = editClient.id;
    const contacts = (editClient.contacts || []).filter((c: any) => c.isActive !== false);
    const contact = contacts.find((c: any) => c.useForInvoice) || contacts[0] || null;
    // Replaced, never merged — see the note on the Client selector.
    setForm((f: any) => ({
      ...f,
      prospectName: contact?.name || '',
      businessName: contact?.businessName || editClient.name || '',
      email: contact?.email || '',
      phone: contact?.phone || '',
      currency: editClient.defaultCurrency || f.currency,
    }));
  }, [editClient, editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: packages = [] } = useQuery({
    queryKey: ['packages'],
    queryFn: () => api.get('/admin/packages').then((r) => r.data).catch(() => []),
    enabled: editing,
  });

  const { data: templates = [] } = useQuery({
    queryKey: ['document-templates'],
    queryFn: () => api.get('/admin/document-templates').then((r) => r.data),
    enabled: editing,
  });

  function startEdit() {
    if (!doc) return;
    // Treat the document's current client as "already applied", so the autofill
    // effect stays quiet until the admin picks a different one.
    loadedClientId.current = doc.clientId || null;
    setForm({
      templateId: doc.templateId || '',
      clientId: doc.clientId || '',
      prospectName: doc.prospectName, businessName: doc.businessName || '',
      email: doc.email, phone: doc.phone || '',
      currency: doc.currency, amount: doc.amount,
      discountType: doc.discountType || '', discountValue: doc.discountValue || '',
      discountCycles: doc.discountCycles || '',
      validUntil: doc.validUntil || '', scopeTerms: doc.scopeTerms || '',
      allowPartialPayment: !!doc.allowPartialPayment,
    });
    // Legacy single-service documents (no services array) become a one-row list.
    setServices(Array.isArray(doc.services) && doc.services.length
      ? doc.services.map((s: any) => ({
          serviceTypeKey: s.serviceTypeKey, packageId: s.packageId || '',
          price: s.price != null ? String(s.price) : '', scope: s.scope || '',
        }))
      : [{
          serviceTypeKey: doc.serviceTypeKey, packageId: doc.packageId || '',
          price: doc.basePrice != null ? String(doc.basePrice) : String(doc.amount ?? ''), scope: '',
        }]);
    setLines((doc.lineItems || []).map((l: any) => ({ description: l.description, qty: String(l.qty), unitPrice: String(l.unitPrice) })));

    // Rehydrate the offered packages and their per-document prices. Documents
    // saved under the older "one choice for the whole deal" shape (packageOptions)
    // are read in as a menu too, so editing one no longer silently drops it.
    const menu: Record<string, string[]> = {};
    const prices: MenuPrices = {};
    const savedMenu: any[] = Array.isArray(doc.packageMenu) ? doc.packageMenu : [];
    for (const entry of savedMenu) {
      if (!entry?.serviceTypeKey) continue;
      menu[entry.serviceTypeKey] = Array.isArray(entry.packageIds) ? [...entry.packageIds] : [];
      if (entry.prices && typeof entry.prices === 'object') {
        prices[entry.serviceTypeKey] = Object.fromEntries(
          Object.entries(entry.prices).map(([pid, v]) => [pid, String(v)])
        );
      }
    }
    const legacyOptions: string[] = Array.isArray(doc.packageOptions) ? doc.packageOptions : [];
    setPackageMenu(menu);
    setMenuPrices(prices);
    setLegacyPackageOptions(savedMenu.length ? [] : legacyOptions);
    setPricingMode(savedMenu.length || legacyOptions.length >= 2 ? 'compare' : 'fixed');
    setEditing(true);
  }

  function setPricingModeSafe(mode: PricingMode) {
    setPricingMode(mode);
    if (mode === 'fixed') {
      setPackageMenu({});
      setMenuPrices({});
      setLegacyPackageOptions([]);
    } else {
      // Packages drive the price — clear service prices / package locks / line items.
      setServices((prev) => prev.map((s) => ({ ...s, packageId: '', price: '' })));
      setLines([{ description: '', qty: '1', unitPrice: '' }]);
    }
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

  async function openPreview() {
    if (!doc || previewOpening) return;
    setPreviewOpening(true);
    try {
      // Opens the letterheaded PDF (same as View PDF) — works for drafts too.
      await viewAuthedFile(`/documents/${id}/pdf`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to open preview PDF.');
    } finally {
      setPreviewOpening(false);
    }
  }

  const selectedKeys = services.map((s) => s.serviceTypeKey);
  const primaryServiceKey = selectedKeys[0] || doc?.serviceTypeKey || '';

  // Same filtering as the create form — a 'standard' template works for any
  // selection; a service-specific one only when its service is selected.
  const filteredTemplates = (templates as any[]).filter(
    (t: any) => t.type === doc?.type && t.isActive &&
      (selectedKeys.length === 0 || t.serviceTypeKey === 'standard' || selectedKeys.includes(t.serviceTypeKey))
  );

  function packagesFor(key: string) {
    return (packages as any[]).filter(
      (p: any) => p.serviceTypeKey === key || (p.services || []).some((s: any) => s.serviceTypeKey === key)
    );
  }

  function toggleService(key: string) {
    setServices((prev) => prev.some((s) => s.serviceTypeKey === key)
      ? prev.filter((s) => s.serviceTypeKey !== key)
      : [...prev, { serviceTypeKey: key, packageId: '', price: '', scope: '' }]);
  }

  function updateServiceRow(key: string, patch: Partial<ServiceRow>) {
    setServices((prev) => prev.map((s) => (s.serviceTypeKey === key ? { ...s, ...patch } : s)));
  }

  function selectServicePackage(key: string, packageId: string) {
    const pkg = (packages as any[]).find((p: any) => p.id === packageId);
    setServices((prev) => prev.map((s) => (s.serviceTypeKey === key
      ? { ...s, packageId, price: pkg?.price != null ? String(pkg.price) : s.price }
      : s)));
    if (pkg?.currency) setForm((f: any) => ({ ...f, currency: pkg.currency }));
  }

  // Candidate packages the admin can offer as alternative tiers — same union
  // logic as the create form.
  const candidatePackages = (() => {
    const map = new Map<string, any>();
    for (const key of selectedKeys) for (const p of packagesFor(key)) map.set(p.id, p);
    return Array.from(map.values());
  })();

  // Switching to "Client chooses" offers every package of every selected service
  // by default — identical to the create form, so the two never disagree about
  // what the mode means. A service already present in the menu (even as an empty
  // list) has been curated by hand and is left alone.
  useEffect(() => {
    if (!editing || pricingMode !== 'compare' || !(packages as any[]).length) return;
    setPackageMenu((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of selectedKeys) {
        if (next[key] !== undefined) continue;
        // A pre-menu document's whole-deal options are filed under whichever of
        // its services each package belongs to; everything else starts full.
        const forService = packagesFor(key);
        next[key] = legacyPackageOptions.length
          ? forService.filter((p: any) => legacyPackageOptions.includes(p.id)).map((p: any) => p.id)
          : forService.map((p: any) => p.id);
        changed = true;
      }
      for (const key of Object.keys(next)) {
        if (!selectedKeys.includes(key)) { delete next[key]; changed = true; }
      }
      return changed ? next : prev;
    });
    if (legacyPackageOptions.length) setLegacyPackageOptions([]);
  }, [editing, pricingMode, selectedKeys.join(','), packages]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function applyDiscountPreview(base: number) {
    const value = Number(form?.discountValue || 0);
    if (!form?.discountType || value <= 0) return base;
    if (form.discountType === 'percent') return Math.max(0, base - (base * Math.min(value, 100)) / 100);
    return Math.max(0, base - value);
  }
  const isCompareMode = pricingMode === 'compare'
    && packageMenuPayload.length > 0
    && packageMenuPayload.length === selectedKeys.length;

  // Per-service range (cheapest offered → priciest offered, summed), using this
  // document's own prices so an override moves the range with it.
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
  const servicesMissingPackages = pricingMode === 'compare'
    ? selectedKeys.filter((key) => !(packageMenu[key] || []).length)
    : [];

  // Only re-pick a template automatically when the admin actively changes the
  // services away from the document's original ones — must NOT fire on initial
  // mount, or it could silently swap out a deliberately-chosen template.
  useEffect(() => {
    if (!editing || !form || !doc) return;
    const originalKeys = Array.isArray(doc.services) && doc.services.length
      ? doc.services.map((s: any) => s.serviceTypeKey)
      : [doc.serviceTypeKey];
    if (selectedKeys.join(',') === originalKeys.join(',')) return;
    const actives = (templates as any[]).filter((t: any) => t.type === doc.type && t.isActive);
    const match = selectedKeys.length === 1
      ? (actives.find((t: any) => t.serviceTypeKey === selectedKeys[0]) || actives.find((t: any) => t.serviceTypeKey === 'standard'))
      : actives.find((t: any) => t.serviceTypeKey === 'standard');
    if (match && form.templateId !== match.id) {
      setForm((f: any) => ({ ...f, templateId: match.id }));
    }
  }, [selectedKeys.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const servicesTotal = services.reduce((s, x) => s + (parseFloat(x.price) || 0), 0);
  const lineTotal = lines.reduce((s, l) => s + (parseFloat(l.qty) || 0) * (parseFloat(l.unitPrice) || 0), 0);
  // Same fallback as the create form: only trust lineTotal once a line item is
  // actually filled in, then per-service prices, then the stored amount.
  const hasLineItems = !isCompareMode && lines.some((l) => l.description && l.unitPrice);
  const baseAmount = isCompareMode
    ? 0
    : doc?.type === 'quotation'
      ? (hasLineItems ? lineTotal : (servicesTotal || Number(form?.amount) || 0))
      : (servicesTotal || Number(form?.amount) || 0);

  const updateMutation = useMutation({
    mutationFn: () => {
      if (pricingMode === 'compare' && packageMenuPayload.length < selectedKeys.length) {
        return Promise.reject({ response: { data: { message: 'Offer at least one package for every selected service.' } } });
      }
      return api.patch(`/documents/${id}`, {
        ...form,
        serviceTypeKey: primaryServiceKey,
        services: services.map((s) => ({
          serviceTypeKey: s.serviceTypeKey,
          packageId: isCompareMode ? undefined : (s.packageId || undefined),
          price: isCompareMode ? undefined : (s.price !== '' ? Number(s.price) : undefined),
          scope: s.scope || undefined,
        })),
        packageMenu: isCompareMode ? packageMenuPayload : [],
        // Always sent, so switching a legacy compare document back to a fixed
        // quote (or over to a per-service menu) actually clears the old options
        // instead of leaving the backend in menu/compare mode forever.
        packageOptions: [],
        templateId: form.templateId || undefined,
        packageId: isCompareMode ? null : (services[0]?.packageId || undefined),
        amount: isCompareMode ? 0 : (baseAmount || undefined),
        discountType: form.discountType || undefined,
        discountValue: form.discountType ? form.discountValue : undefined,
        discountCycles: form.discountType ? (form.discountCycles || undefined) : undefined,
        lineItems: doc.type === 'quotation' && hasLineItems
          ? lines.filter((l) => l.description && l.unitPrice).map((l) => ({ description: l.description, qty: Number(l.qty) || 1, unitPrice: Number(l.unitPrice) }))
          : (isCompareMode ? [] : undefined),
      }).then((r) => r.data);
    },
    onSuccess: async () => {
      await invalidateMany(qc, afterDocumentChange(id));
      setEditing(false);
      toast.success('Document updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update document.'),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/documents/${id}/send`).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterDocumentChange(id));
      toast.success('Document sent.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to send document.'),
  });

  const remindMutation = useMutation({
    mutationFn: () => api.post(`/documents/${id}/remind`).then((r) => r.data),
    onSuccess: async () => {
      await invalidateMany(qc, afterDocumentChange(id));
      toast.success('Reminder sent.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to send reminder.'),
  });

  const convertMutation = useMutation({
    mutationFn: () => api.post(`/documents/${id}/convert`, convertClientId ? { clientId: convertClientId } : {}).then((r) => r.data),
    onSuccess: async (result) => {
      await invalidateMany(qc, afterDocumentChange(id));
      const projectCount = result.projects?.length || 1;
      toast.success(projectCount > 1
        ? `Converted — client "${result.client.name}" and ${projectCount} projects created.`
        : `Converted — client "${result.client.name}" and project "${result.project.name}" created.`);
      // Say which way billing went — sent vs draft is the difference between
      // "the client has it" and "it's waiting for you", and guessing is costly.
      const inv = result.invoices?.[0];
      if (inv) {
        toast.info(
          result.payViaCrm
            ? `Invoice ${inv.number} issued and emailed — Pay via CRM is on for this client.`
            : `Invoice ${inv.number} created as a draft — review it and send when you're ready.`,
          { action: { label: 'Open', onClick: () => router.push(`/invoices/${inv.id}`) } },
        );
      }
      if (result.billingError) toast.error(result.billingError);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to convert document.'),
  });

  const reviewUrl = doc?.publicToken ? `${window.location.origin}/review/${doc.publicToken}` : '';

  function copyLink() {
    if (!reviewUrl) return;
    navigator.clipboard.writeText(reviewUrl).then(() => toast.success('Review link copied.'));
  }

  if (isLoading) return (
    <div className="flex flex-col h-full">
      <Header title="Document" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
    </div>
  );

  if (!doc) return (
    <div className="flex flex-col h-full">
      <Header title="Document" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Document not found.</div>
    </div>
  );

  const canEdit = EDITABLE_STATUSES.includes(doc.status);
  const canSend = EDITABLE_STATUSES.includes(doc.status);
  const canRemind = ['sent', 'viewed'].includes(doc.status);
  const canConvert = doc.status === 'approved' && !doc.convertedProjectId;
  const docServiceKeys: string[] = Array.isArray(doc.services) && doc.services.length
    ? doc.services.map((s: any) => s.serviceTypeKey)
    : [doc.serviceTypeKey];
  const serviceLabel = docServiceKeys
    .map((key) => (serviceTypes as any[]).find((s: any) => s.key === key)?.name || key)
    .join(', ');

  const docIsCompare = Array.isArray(doc.packageOptions) && doc.packageOptions.length > 1;
  const docAwaitingChoice = docIsCompare && !doc.selectedPackageId && doc.status !== 'approved';
  const docIsMenu = Array.isArray(doc.packageMenu) && doc.packageMenu.length > 0;
  const docMenuPending = docIsMenu && doc.status !== 'approved';
  function applyDocDiscount(base: number) {
    const value = Number(doc.discountValue || 0);
    if (!doc.discountType || value <= 0) return base;
    if (doc.discountType === 'percent') return Math.max(0, base - (base * Math.min(value, 100)) / 100);
    return Math.max(0, base - value);
  }
  const docRangeMin = doc.optionMinPrice != null ? applyDocDiscount(Number(doc.optionMinPrice)) : null;
  const docRangeMax = doc.optionMaxPrice != null ? applyDocDiscount(Number(doc.optionMaxPrice)) : null;

  return (
    <div className="flex flex-col h-full">
      <Header title={doc.number} />
      <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full', DOC_STATUS_COLORS[doc.status] || 'bg-gray-100 text-gray-600')}>
            {doc.status}
          </span>
          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-600">{titleCase(doc.type)}</span>
        </div>

        {/* Same stage-progress pill row shown on the client's Timeline tab
            (Created → Sent → Viewed → Approved/Rejected/Expired), scoped to
            just this document. */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5">
          <TimelineSteps steps={documentTimelineSteps(doc)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left */}
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {!editing ? (
                <>
                  <div className="flex flex-wrap items-start justify-between mb-4 gap-2">
                    <div>
                      <div className="text-xl font-bold text-gray-900">{doc.prospectName}</div>
                      {doc.businessName && <div className="text-sm text-gray-500">{doc.businessName}</div>}
                    </div>
                    <div className="text-right">
                      {docAwaitingChoice && docRangeMin != null && docRangeMax != null ? (
                        <>
                          <div className="text-2xl font-bold text-gray-900">
                            {docRangeMin === docRangeMax
                              ? formatCurrency(docRangeMin, doc.currency)
                              : `${formatCurrency(docRangeMin, doc.currency)} – ${formatCurrency(docRangeMax, doc.currency)}`}
                          </div>
                          <div className="text-xs text-amber-700 mt-1">Awaiting client package choice</div>
                        </>
                      ) : docMenuPending ? (
                        <>
                          <div className="text-lg font-bold text-gray-900">Depends on client&apos;s picks</div>
                          <div className="text-xs text-amber-700 mt-1">Awaiting client selections</div>
                        </>
                      ) : (
                        <>
                          <div className="text-2xl font-bold text-gray-900">{formatCurrency(doc.amount, doc.currency)}</div>
                          {doc.discountType && Number(doc.discountValue) > 0 ? (
                            <div className="text-xs text-brand-700 mt-1">
                              {doc.discountType === 'percent' ? `${doc.discountValue}% off` : `${formatCurrency(doc.discountValue, doc.currency)} off`}
                              {doc.basePrice != null && <span className="text-gray-400"> · was {formatCurrency(doc.basePrice, doc.currency)}</span>}
                              {Number(doc.discountCycles) > 0 && (
                                <span className="text-gray-400"> · first {doc.discountCycles} billing cycle{Number(doc.discountCycles) !== 1 ? 's' : ''} only</span>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 mt-1">{serviceLabel}</div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Two columns only from sm up: an email address is wider than
                      half a phone screen, so it ran straight over the phone
                      number in the next cell. break-all keeps it inside its own
                      cell even when it does share the row. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-sm">
                    <div className="min-w-0"><span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</span><div className="text-gray-900 mt-1 break-all">{doc.email}</div></div>
                    <div className="min-w-0"><span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</span><div className="text-gray-900 mt-1 break-words">{doc.phone || '—'}</div></div>
                    <div className="min-w-0"><span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Valid Until</span><div className="text-gray-900 mt-1">{doc.validUntil ? formatDate(doc.validUntil) : '—'}</div></div>
                    <div className="min-w-0"><span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Sent</span><div className="text-gray-900 mt-1">{doc.sentAt ? formatDate(doc.sentAt) : '—'}</div></div>
                  </div>
                  {Array.isArray(doc.services) && doc.services.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {docAwaitingChoice ? 'Services included' : 'Services'}
                      </span>
                      <div className="mt-2 space-y-1.5">
                        {doc.services.map((svc: any, i: number) => (
                          <div key={i} className="flex flex-wrap items-center justify-between text-sm gap-2">
                            <span className="text-gray-800">
                              {(serviceTypes as any[]).find((s: any) => s.key === svc.serviceTypeKey)?.name || svc.serviceTypeKey}
                            </span>
                            <span className="text-gray-600 font-mono">
                              {docAwaitingChoice
                                ? 'In package'
                                : (svc.price != null ? formatCurrency(svc.price, doc.currency) : '—')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {docIsCompare && Array.isArray(doc.packageOptionDetails) && doc.packageOptionDetails.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Package options</span>
                      <div className="mt-1.5 space-y-1">
                        {doc.packageOptionDetails.map((pkg: any) => {
                          const isSelected = doc.selectedPackageId === pkg.id;
                          return (
                            <div
                              key={pkg.id}
                              className={cn(
                                'flex items-center justify-between gap-3 text-sm rounded-lg px-2.5 py-1.5',
                                isSelected ? 'bg-brand-50 border border-brand-200' : 'border border-transparent',
                              )}
                            >
                              <span className={cn('flex items-center gap-1.5', isSelected ? 'font-semibold text-brand-800' : 'text-gray-700')}>
                                {isSelected && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-brand-600" />}
                                {pkg.tier || pkg.name}
                              </span>
                              <span className={cn('font-mono text-xs', isSelected ? 'text-brand-700' : 'text-gray-500')}>
                                {formatCurrency(pkg.price, pkg.currency || doc.currency)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      {docAwaitingChoice && (
                        <p className="text-xs text-amber-700 mt-2">Client must pick one package before the total is final.</p>
                      )}
                    </div>
                  )}
                  {docIsMenu && Array.isArray(doc.packageMenuDetails) && doc.packageMenuDetails.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Package menu offered</span>
                      {doc.packageMenuDetails.map((entry: any) => (
                        <div key={entry.serviceTypeKey}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="w-1 h-4 rounded-full bg-gray-300 shrink-0" />
                            <p className="text-sm font-bold text-gray-900">{entry.serviceName}</p>
                          </div>
                          <div className="space-y-1 pl-3">
                            {entry.packages.map((pkg: any) => {
                              const isPicked = doc.menuSelections && doc.menuSelections[entry.serviceTypeKey] === pkg.id;
                              return (
                                <div
                                  key={pkg.id}
                                  className={cn(
                                    'flex items-center justify-between gap-3 text-sm rounded-lg px-2.5 py-1.5',
                                    isPicked ? 'bg-brand-50 border border-brand-200' : 'border border-transparent',
                                  )}
                                >
                                  <span className={cn('flex items-center gap-1.5 font-normal', isPicked ? 'font-semibold text-brand-800' : 'text-gray-500')}>
                                    {isPicked && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-brand-600" />}
                                    {pkg.tier || pkg.name}
                                  </span>
                                  {/* `price` is this document's agreed price; when it was
                                      overridden, the package's own list price is struck
                                      through beside it so the change is never invisible. */}
                                  <span className={cn('font-mono text-xs whitespace-nowrap', isPicked ? 'text-brand-700' : 'text-gray-400')}>
                                    {pkg.priceOverridden && (
                                      <span className="text-gray-300 line-through mr-1.5">
                                        {formatCurrency(pkg.listPrice, pkg.currency || doc.currency)}
                                      </span>
                                    )}
                                    {formatCurrency(pkg.price, pkg.currency || doc.currency)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {docMenuPending && (
                        <p className="text-xs text-amber-700">Client freely picks any, all, or none of these — total is final once they approve.</p>
                      )}
                    </div>
                  )}
                  {doc.status === 'approved' && doc.selectedPackage && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <span className="text-xs font-medium text-brand-700 uppercase tracking-wider">Package Selected</span>
                      <p className="text-sm text-gray-700 mt-1">
                        {doc.selectedPackage.tier || doc.selectedPackage.name}
                        {doc.selectedPackage.price != null && (
                          <span className="text-gray-500"> · {formatCurrency(doc.selectedPackage.price, doc.selectedPackage.currency || doc.currency)}</span>
                        )}
                      </p>
                      <p className="text-sm font-semibold text-gray-900 mt-1">Final total: {formatCurrency(doc.amount, doc.currency)}</p>
                      {doc.selectionReason && <p className="text-xs text-gray-500 mt-1">&ldquo;{doc.selectionReason}&rdquo;</p>}
                    </div>
                  )}
                  {doc.responseNote && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <span className="text-xs font-medium text-red-500 uppercase tracking-wider">Requested Changes</span>
                      <p className="text-sm text-gray-700 mt-1">{doc.responseNote}</p>
                    </div>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="mt-5 inline-flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit document
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {/* Pricing mode first — it decides what each service row below
                      asks for, so choosing it afterwards meant redoing them. */}
                  {candidatePackages.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5 sm:p-4 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-900">How should packages work?</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">Choose this first — it decides what each service below asks you for.</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setPricingModeSafe('fixed')}
                          className={cn(
                            'text-left rounded-lg border px-3.5 py-3 transition-colors',
                            pricingMode === 'fixed' ? 'border-brand-400 bg-white ring-1 ring-brand-200' : 'border-gray-200 bg-white hover:border-gray-300',
                          )}
                        >
                          <p className="text-sm font-medium text-gray-900">Fixed quote</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">You set the price. Optionally quick-fill from a package.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPricingModeSafe('compare')}
                          className={cn(
                            'text-left rounded-lg border px-3.5 py-3 transition-colors',
                            pricingMode === 'compare' ? 'border-brand-400 bg-white ring-1 ring-brand-200' : 'border-gray-200 bg-white hover:border-gray-300',
                          )}
                        >
                          <p className="text-sm font-medium text-gray-900">Client chooses</p>
                          <p className="text-[11px] text-gray-500 mt-0.5">Every package of each selected service is offered by default — untick any you don&apos;t want.</p>
                        </button>
                      </div>

                      {pricingMode === 'compare' && servicesMissingPackages.length > 0 && (
                        <p className="text-xs text-amber-600">
                          No package offered yet for {servicesMissingPackages.map((k) => (serviceTypes as any[]).find((s: any) => s.key === k)?.name || k).join(', ')} — tick at least one in that service&apos;s row below.
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
                          <p className="text-[11px] text-gray-500 mt-1">Final total is set when the client picks a package and approves on the quotation link (Send → email / Copy review link).</p>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Services</label>
                    <div className="space-y-2">
                      {(serviceTypes as any[]).map((s: any) => {
                        const row = services.find((x) => x.serviceTypeKey === s.key);
                        return (
                          <div key={s.key} className={`border rounded-lg ${row ? 'border-brand-300 bg-brand-50/30' : 'border-gray-200'}`}>
                            <label className="flex items-center gap-2.5 px-3 sm:px-3.5 py-2.5 cursor-pointer select-none">
                              <input type="checkbox" checked={!!row} onChange={() => toggleService(s.key)}
                                className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                              <span className="text-sm font-medium text-gray-800 truncate">{s.name}</span>
                            </label>
                            {row && (
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
                                        onChange={(e) => updateServiceRow(s.key, { price: e.target.value })}
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
                                        <div key={p.id} className={`rounded-lg border ${offered ? 'border-brand-300 bg-white' : 'border-gray-200 bg-white/70'}`}>
                                          <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none">
                                            <input type="checkbox" checked={offered} onChange={() => togglePackageMenuOption(s.key, p.id)}
                                              className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                                            <span className="text-sm text-gray-800 flex-1 min-w-0 break-words">{p.tier || p.name}</span>
                                            {p.price != null && (
                                              <span className={cn('text-xs font-mono shrink-0', hasOverride ? 'text-gray-400 line-through' : 'text-gray-500')}>
                                                {p.currency} {Number(p.price).toLocaleString()}
                                              </span>
                                            )}
                                          </label>
                                          {/* Re-price a package for this document only — the
                                              package keeps its catalogue price everywhere else. */}
                                          {offered && (
                                            <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-9">
                                              <label className="text-[11px] text-gray-500 shrink-0">Price on this document</label>
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
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                                <div>
                                  <label className="block text-[11px] font-medium text-gray-500 mb-1">What&apos;s included</label>
                                  <textarea value={row.scope} onChange={(e) => updateServiceRow(s.key, { scope: e.target.value })} rows={2}
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

                  {/* Client is editable on a draft. Without this a document
                      raised against the wrong client had to be deleted and
                      rebuilt from scratch — and the client is what decides how
                      the approved quote gets invoiced. */}
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Client</label>
                    <select
                      value={form.clientId || ''}
                      onChange={(e) => {
                        const clientId = e.target.value;
                        // Only the id is set here. The contact details are filled
                        // by the effect above, once the FULL client record has
                        // loaded — the dropdown's own rows carry contact ids only.
                        if (!clientId) {
                          loadedClientId.current = null;
                          setForm({ ...form, clientId: '', prospectName: '', businessName: '', email: '', phone: '' });
                          return;
                        }
                        setForm({ ...form, clientId });
                      }}
                      className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white"
                    >
                      <option value="">No client linked</option>
                      {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    {form.clientId ? (
                      <>
                        <p className="text-[11px] text-gray-400 mt-1.5">
                          {(clients as any[]).find((c: any) => c.id === form.clientId)?.billingMode === 'stripe'
                            ? 'Pay via CRM is on — once approved, the invoice is issued automatically with a Stripe link.'
                            : 'Pay via CRM is off — once approved, the invoice is raised as a draft for you to send.'}
                        </p>
                        {/* Only once the full client has loaded — otherwise this
                            fires during the fetch and accuses a client of having
                            no email before we've actually looked. */}
                        {editClient?.id === form.clientId && !form.email && (
                          <p className="text-[11px] text-amber-600 mt-1">
                            This client has no contact email — enter one below, or add a contact on the client first.
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-[11px] text-amber-600 mt-1.5">
                        Not linked to a client — converting this will create a new one.
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Template</label>
                      <select value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                        <option value="">Auto-select active template</option>
                        {filteredTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      {services.length > 0 && filteredTemplates.length === 0 && (
                        <p className="text-xs text-amber-600 mt-1.5">No active template for this type/service yet.</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Contact Person <span className="text-red-500">*</span></label>
                      <input value={form.prospectName} onChange={(e) => setForm({ ...form, prospectName: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Business Name</label>
                      <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Email <span className="text-red-500">*</span></label>
                      <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Phone</label>
                      <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1.5">Valid Until</label>
                      <input type="date" min={todayStr()} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
                        className={`w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
                          form.validUntil && form.validUntil < todayStr()
                            ? 'border-red-300 focus:ring-red-400'
                            : 'border-gray-300 focus:ring-brand-600'
                        }`} />
                      {form.validUntil && form.validUntil < todayStr() && (
                        <p className="text-xs text-red-600 mt-1.5">This date has already passed.</p>
                      )}
                    </div>
                  </div>

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
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                          className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                          <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                        </select>
                      </div>
                    </div>
                  ) : doc.type === 'quotation' ? (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-2">Line Items</label>
                      <div className="space-y-2">
                        {lines.map((line, i) => (
                          <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-gray-100 p-2 sm:border-0 sm:p-0">
                            <input className="col-span-12 sm:col-span-6 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                              placeholder="Description" value={line.description}
                              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], description: e.target.value }; setLines(n); }} />
                            <input className="col-span-4 sm:col-span-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                              type="number" min="1" value={line.qty} placeholder="Qty"
                              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], qty: e.target.value }; setLines(n); }} />
                            <input className="col-span-6 sm:col-span-3 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                              type="number" min="0" step="0.01" value={line.unitPrice} placeholder="0.00"
                              onChange={(e) => { const n = [...lines]; n[i] = { ...n[i], unitPrice: e.target.value }; setLines(n); }} />
                            <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}
                              className="col-span-2 sm:col-span-1 flex items-center justify-center text-gray-400 hover:text-red-500">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        <button type="button" onClick={() => setLines([...lines, { description: '', qty: '1', unitPrice: '' }])}
                          className="flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium">
                          <Plus className="w-3.5 h-3.5" /> Add line
                        </button>
                      </div>
                      <div className="flex justify-end items-center gap-2 mt-3 text-sm font-semibold text-gray-900">
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
                          <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Currency</label>
                        <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
                          className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                          <option>USD</option><option>EUR</option><option>GBP</option><option>PKR</option><option>AED</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">Discount <span className="text-gray-400 font-normal">(optional)</span></label>
                        <select value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value })}
                          className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 bg-white">
                          <option value="">No discount</option>
                          <option value="percent">Percentage off</option>
                          <option value="fixed">Fixed amount off</option>
                        </select>
                      </div>
                      {form.discountType && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">
                            {form.discountType === 'percent' ? 'Discount %' : 'Discount amount'}
                          </label>
                          <input type="number" min="0" value={form.discountValue} onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
                            placeholder={form.discountType === 'percent' ? 'e.g. 10' : 'e.g. 50'}
                            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        </div>
                      )}
                      {form.discountType && (
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1.5">
                            Discount valid for <span className="text-gray-400 font-normal">(billing cycles, recurring packages only)</span>
                          </label>
                          <input type="number" min="1" step="1" value={form.discountCycles} onChange={(e) => setForm({ ...form, discountCycles: e.target.value })}
                            placeholder="e.g. 3 — blank means it never expires"
                            className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600" />
                        </div>
                      )}
                    </div>
                    {form.discountType && Number(form.discountValue) > 0 && !isCompareMode && (() => {
                      const finalAmount = applyDiscountPreview(baseAmount);
                      return (
                        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                          Total after discount: <strong>{form.currency} {finalAmount.toLocaleString()}</strong>
                          <span className="text-gray-400"> (was {form.currency} {baseAmount.toLocaleString()})</span>
                        </p>
                      );
                    })()}
                    {form.discountType && Number(form.discountValue) > 0 && isCompareMode && rangeMin != null && rangeMax != null && (
                      <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3.5 py-2.5">
                        Range after discount:{' '}
                        <strong>
                          {rangeMin === rangeMax
                            ? `${form.currency} ${rangeMin.toLocaleString()}`
                            : `${form.currency} ${rangeMin.toLocaleString()} – ${rangeMax.toLocaleString()}`}
                        </strong>
                      </p>
                    )}
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!form.allowPartialPayment}
                        onChange={(e) => setForm({ ...form, allowPartialPayment: e.target.checked })}
                        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                      />
                      Allow partial payment <span className="text-gray-400 font-normal">(client can pay the resulting invoice down in as many chunks as they want)</span>
                    </label>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label className="block text-xs font-medium text-gray-600">
                        Terms &amp; Scope of Work <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      {form.templateId && (
                        <a href={`/admin?tab=templates&edit=${form.templateId}`} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:text-brand-800 shrink-0">
                          <Pencil className="w-3 h-3" /> Edit document template
                        </a>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 -mt-1 mb-1.5">
                      This field is specific to this document. The rest of the document&rsquo;s wording comes from its template — use the link above to change that for every document that uses it.
                    </p>
                    {(doc.type === 'agreement' || doc.type === 'proposal') && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {PAYMENT_SCHEDULE_SNIPPETS.map((s) => (
                          <button key={s.label} type="button"
                            onClick={() => setForm({ ...form, scopeTerms: form.scopeTerms ? `${form.scopeTerms}${s.html}` : s.html })}
                            className="text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-full px-3 py-1 transition-colors">
                            {s.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <RichTextEditor value={form.scopeTerms} onChange={(html) => setForm({ ...form, scopeTerms: html })}
                      minHeight="min-h-20" />
                  </div>

                  <div className="flex gap-2">
                    {/* Contact person and email are required: the email is where
                        the review link goes, and switching client now clears
                        these rather than keeping the old client's values. */}
                    <button
                      onClick={() => updateMutation.mutate()}
                      disabled={updateMutation.isPending
                        || services.length === 0
                        || !String(form.prospectName || '').trim()
                        || !String(form.email || '').trim()
                        || !!(form.validUntil && form.validUntil < todayStr())}
                      className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
                    >
                      {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </button>
                    <button onClick={() => setEditing(false)} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {Array.isArray(doc.lineItems) && doc.lineItems.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Line Items</h3>
                </div>
                <Table className="w-full min-w-140">
                  <TableHeader>
                    <TableRow className="border-b border-gray-100">
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Description</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Qty</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Unit Price</TableHead>
                      <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-100">
                    {doc.lineItems.map((l: any, i: number) => (
                      <TableRow key={i} className="hover:bg-gray-50">
                        <TableCell className="px-5 py-3 text-sm text-gray-900">{l.description}</TableCell>
                        <TableCell className="px-5 py-3 text-sm text-gray-600 text-right">{l.qty}</TableCell>
                        <TableCell className="px-5 py-3 text-sm text-gray-600 text-right font-mono">{formatCurrency(l.unitPrice, doc.currency)}</TableCell>
                        <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right font-mono">{formatCurrency(l.qty * l.unitPrice, doc.currency)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {doc.bodySnapshot && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Sent Content</h3>
                </div>
                <div className="p-5 text-sm text-gray-700 whitespace-pre-wrap">{doc.bodySnapshot}</div>
              </div>
            )}

            {Array.isArray(doc.events) && doc.events.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Activity</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {doc.events.map((ev: any) => (
                    <div key={ev.id} className="flex flex-wrap items-center justify-between px-5 py-3 gap-2">
                      <div className="text-sm text-gray-700">
                        <span className="font-medium capitalize">{ev.event}</span>
                        <span className="text-gray-400"> · by {ev.actor}</span>
                        {ev.note && <span className="text-gray-500"> — "{ev.note}"</span>}
                      </div>
                      <div className="text-xs text-gray-400">{formatDate(ev.createdAt, 'MMM d, yyyy h:mm a')}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: actions */}
          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900">Actions</h3>

              {canEdit && !editing && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2.5 rounded-lg transition-colors border border-gray-200"
                >
                  <Pencil className="w-4 h-4" /> Edit document
                </button>
              )}

              <button
                type="button"
                onClick={openPreview}
                disabled={previewOpening}
                className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 py-2.5 rounded-lg transition-colors border border-gray-200"
              >
                <Eye className="w-4 h-4" /> {previewOpening ? 'Opening…' : 'Preview'}
              </button>

              {canSend && (
                <button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
                  <Send className="w-4 h-4" />
                  {sendMutation.isPending ? 'Sending…' : doc.status === 'draft' ? 'Send' : 'Resend'}
                </button>
              )}

              {doc.publicToken && (
                <>
                  <button onClick={copyLink}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200">
                    <Copy className="w-4 h-4" /> Copy Review Link
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(`${reviewUrl}?preview=1`, '_blank', 'noopener,noreferrer')}
                    className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200"
                  >
                    <Eye className="w-4 h-4" /> Open review page (staff)
                  </button>
                </>
              )}

              {canRemind && (
                <button onClick={() => remindMutation.mutate()} disabled={remindMutation.isPending}
                  className="w-full flex items-center justify-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200">
                  <RefreshCw className="w-4 h-4" /> {remindMutation.isPending ? 'Sending…' : 'Send Reminder'}
                </button>
              )}

              <div className="flex gap-2">
                <button onClick={() => viewAuthedFile(`/documents/${id}/pdf`).catch((e: any) => toast.error(e?.message || 'Failed to open PDF.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200">
                  <Eye className="w-3.5 h-3.5" /> View PDF
                </button>
                <button onClick={() => downloadAuthedFile(`/documents/${id}/pdf`, `${doc.number}.pdf`).catch((e: any) => toast.error(e?.message || 'Download failed.'))}
                  className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 py-2 rounded-lg transition-colors border border-gray-200">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              </div>

              {canConvert && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-brand-600" /> Approved — ready to convert
                  </p>
                  <select value={convertClientId} onChange={(e) => setConvertClientId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600">
                    <option value="">Create new client</option>
                    {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>Link to existing: {c.name}</option>)}
                  </select>
                  <button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors">
                    <ArrowRightCircle className="w-4 h-4" />
                    {convertMutation.isPending ? 'Converting…' : 'Convert to Project'}
                  </button>
                </div>
              )}

              {doc.convertedProjectId && (
                <div className="pt-3 border-t border-gray-100 space-y-2">
                  <p className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Converted
                  </p>
                  <Link href={`/clients/${doc.convertedClientId}`} className="block text-sm text-brand-700 hover:underline">
                    View Client: {doc.convertedClient?.name}
                  </Link>
                  <Link href={`/projects/${doc.convertedProjectId}`} className="block text-sm text-brand-700 hover:underline">
                    View Project: {doc.convertedProject?.name}
                  </Link>
                </div>
              )}

              {doc.status === 'expired' && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  This document expired without a response. Edit and resend to give it a new review link.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
