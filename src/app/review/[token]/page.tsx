'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, XCircle, FileText, Download, ExternalLink, CreditCard } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sanitizeRichHtml, richTextProseClass } from '@/lib/richText';

type Branding = {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  businessAddress?: string | null;
  businessPhone?: string | null;
  website?: string | null;
  taxNumber?: string | null;
  email?: string | null;
};

const RESPONDABLE_STATUSES = ['sent', 'viewed'];

const STATUS_LABEL: Record<string, string> = {
  approved: 'You approved this document.',
  rejected: 'You requested changes on this document.',
  expired: 'This document has expired.',
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-amber-100 text-amber-800',
  viewed: 'bg-amber-100 text-amber-800',
  approved: 'bg-brand-100 text-brand-800',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

function billingCycleLabel(cycle?: string | null) {
  if (cycle === 'quarterly') return 'quarterly';
  if (cycle === 'annual') return 'yearly';
  return 'monthly';
}

function packageBillingBadge(pkg: { isRecurring?: boolean; billingCycle?: string | null }) {
  if (pkg?.isRecurring) {
    return { short: 'Recurring', detail: `Recurring · ${billingCycleLabel(pkg.billingCycle)}` };
  }
  return { short: 'One-time', detail: 'One-time' };
}

function priceSuffix(pkg: { isRecurring?: boolean; billingCycle?: string | null }) {
  if (!pkg?.isRecurring) return '';
  if (pkg.billingCycle === 'quarterly') return ' / quarter';
  if (pkg.billingCycle === 'annual') return ' / year';
  return ' / mo';
}

/** Mirrors PublicDocumentService.REQUIRED_DETAIL_FIELDS — all mandatory. */
const DETAIL_FIELDS: { key: string; label: string; type?: string; full?: boolean }[] = [
  { key: 'businessName', label: 'Business name', full: true },
  { key: 'contactPerson', label: 'Contact person' },
  { key: 'designation', label: 'Designation' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Phone', type: 'tel' },
  { key: 'address', label: 'Address', full: true },
  { key: 'state', label: 'State' },
];

export default function PublicDocumentReviewPage() {
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<any>(null);
  const [branding, setBranding] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [mode, setMode] = useState<'view' | 'approve' | 'reject'>('view');
  const [signerName, setSignerName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectionReason, setSelectionReason] = useState('');
  // "Build your own" mode — one optional package pick per service, independent
  // of every other service. Keyed by serviceTypeKey; a missing key means skipped.
  const [menuSelections, setMenuSelections] = useState<Record<string, string>>({});
  // Step two of approval: the billing details we can't raise an invoice without.
  // Prefilled from whatever the agency already has on file, all editable.
  const [details, setDetails] = useState<Record<string, string>>({});
  const [detailsSubmitting, setDetailsSubmitting] = useState(false);
  const [detailsError, setDetailsError] = useState('');
  const [payingNow, setPayingNow] = useState(false);
  const [payError, setPayError] = useState('');

  // Always same-origin /api (proxied by next.config rewrites). Absolute
  // http://localhost:5000 URLs break Chrome's PDF iframe ("refused to connect").
  const apiBase = '/api';
  const pdfUrl = `${apiBase}/public/documents/${token}/pdf`;

  function load() {
    const headers: Record<string, string> = {};
    // If an internal teammate is logged in (same browser), send the token so the
    // API does not flip sent → viewed while they QA the review link.
    try {
      const access = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
      if (access) headers.Authorization = `Bearer ${access}`;
    } catch { /* ignore */ }

    const preview = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('preview') === '1';
    const qs = preview ? '?preview=1' : '';

    fetch(`${apiBase}/public/documents/${token}${qs}`, { headers })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.message || 'Not found');
        return data;
      })
      .then((data) => {
        setDoc(data.document);
        setBranding(data.branding);
        document.title = `${data.branding?.brandName || 'Mohsin Designs Project Management'} — Review Document`;
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Seed the detail form from the server's prefill once, then leave it alone —
  // re-seeding on every refetch would wipe out what the client is typing.
  useEffect(() => {
    if (!doc?.detailPrefill) return;
    setDetails((prev) => (Object.keys(prev).length ? prev : { ...doc.detailPrefill }));
  }, [doc?.detailPrefill]);

  async function submitApprove() {
    if (multiplePackageOptions && !selectedPackageId) {
      setError('Please select one of the package options above.');
      return;
    }
    if (!signatureMatches) {
      setError(`Please type "${signatureRequired}" exactly to sign.`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/public/documents/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerName: signerName.trim(),
          selectedPackageId: selectedPackageId || undefined,
          selectionReason: selectionReason.trim() || undefined,
          menuSelections: isMenuMode ? menuSelections : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to approve.');
      // Approve returns the same { document, branding } shape as GET — using the
      // raw document alone dropped resolvedServices and blanked the items table.
      if (data.document) {
        setDoc(data.document);
        if (data.branding) setBranding(data.branding);
      } else {
        setDoc(data);
      }
      setMode('view');
    } catch (e: any) {
      setError(e.message || 'Failed to approve.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDetails() {
    const missing = DETAIL_FIELDS.filter((f) => !String(details[f.key] || '').trim());
    if (missing.length) {
      setDetailsError(`Please fill in: ${missing.map((f) => f.label).join(', ')}.`);
      return;
    }
    setDetailsSubmitting(true);
    setDetailsError('');
    try {
      const res = await fetch(`${apiBase}/public/documents/${token}/details`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(details),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to submit your details.');
      if (data.document) {
        setDoc(data.document);
        if (data.branding) setBranding(data.branding);
      }
    } catch (e: any) {
      setDetailsError(e.message || 'Failed to submit your details.');
    } finally {
      setDetailsSubmitting(false);
    }
  }

  // Sends the client straight to Stripe for the document's own total — no
  // client/project/invoice exists yet at this point (see PublicDocumentService
  // .startPayment). If they abandon the Stripe page, nothing was ever created;
  // they land back here and this button is simply still there to click again.
  async function payNow() {
    setPayingNow(true);
    setPayError('');
    try {
      const res = await fetch(`${apiBase}/public/documents/${token}/pay`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not start the payment.');
      if (data.url) window.location.href = data.url;
      else throw new Error('Stripe did not return a payment link.');
    } catch (e: any) {
      setPayError(e.message || 'Could not start the payment.');
      setPayingNow(false);
    }
  }

  async function submitReject() {
    if (!note.trim()) { setError('Please describe the changes you would like.'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`${apiBase}/public/documents/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Failed to submit.');
      if (data.document) {
        setDoc(data.document);
        if (data.branding) setBranding(data.branding);
      } else {
        setDoc(data);
      }
      setMode('view');
    } catch (e: any) {
      setError(e.message || 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  }

  const brandName = branding?.brandName || 'Mohsin Designs Project Management';
  const accentColor = branding?.primaryColor || '#0B1D5E';
  const logoUrl = branding?.logoUrl || '/logo-file.png';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F1F5F9' }}>
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (notFound || !doc) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: '#F1F5F9' }}>
        <div className="bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 px-8 py-10 max-w-sm text-center">
          <XCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-gray-900">Link invalid or expired</h1>
          <p className="text-sm text-gray-400 mt-2">This review link is no longer valid. Please contact the sender for a new one.</p>
        </div>
      </div>
    );
  }

  const canRespond = RESPONDABLE_STATUSES.includes(doc.status);
  // Packages are always listed cheapest first. Clients read these as a ladder —
  // Starter, Growth, Premium — so the order has to follow price, not whatever
  // order they happened to be attached to the package/service in the admin panel.
  const byPriceAsc = (a: any, b: any) => (Number(a?.price) || 0) - (Number(b?.price) || 0);
  const packageOptions: any[] = (Array.isArray(doc.packageOptionDetails) ? doc.packageOptionDetails : []).slice().sort(byPriceAsc);
  const multiplePackageOptions = packageOptions.length > 1;
  const packageMenuDetails: any[] = (Array.isArray(doc.packageMenuDetails) ? doc.packageMenuDetails : [])
    .map((entry: any) => ({
      ...entry,
      packages: (Array.isArray(entry.packages) ? entry.packages : []).slice().sort(byPriceAsc),
    }));
  const isMenuMode = packageMenuDetails.length > 0;
  // Shown up front — on every package card, before anything is picked — so a
  // discount is never something the client only discovers after choosing.
  const hasDiscount = !!doc.discountType && Number(doc.discountValue) > 0;
  const discountLabel = hasDiscount
    ? (doc.discountType === 'percent' ? `${doc.discountValue}% OFF` : `${doc.currency || 'USD'} ${doc.discountValue} OFF`)
    : '';
  const lineItems: any[] = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const resolvedServices: any[] = Array.isArray(doc.resolvedServices) ? doc.resolvedServices : [];
  const hasLineItems = lineItems.length > 0;
  const hasResolvedServices = !hasLineItems && resolvedServices.length > 0;
  // Once approved, the real answer lives in resolvedServices/doc.amount — the
  // interactive "choose one"/"build your own" pickers reflect only in-browser
  // state (blank on a fresh page load) and would show a stale/empty pick next
  // to an already-decided document, so they only render pre-approval.
  const isApproved = doc.status === 'approved';

  // Treated as a real digital signature, not a formality — approving requires
  // typing the prospect's own name exactly (case/whitespace-insensitive), so a
  // stray click or someone else's name can't accidentally bind the client.
  function normalizeSignature(v: string) {
    return v.trim().replace(/\s+/g, ' ').toLowerCase();
  }
  const signatureRequired = doc.prospectName || '';
  const signatureMatches = normalizeSignature(signerName) === normalizeSignature(signatureRequired) && normalizeSignature(signerName).length > 0;

  function applyDiscount(base: number) {
    const value = Number(doc.discountValue || 0);
    if (!doc.discountType || value <= 0) return base;
    if (doc.discountType === 'percent') return Math.max(0, base - (base * Math.min(value, 100)) / 100);
    return Math.max(0, base - value);
  }

  const optionPrices = packageOptions.map((p) => Number(p.price) || 0);
  const rangeMin = optionPrices.length ? applyDiscount(Math.min(...optionPrices)) : null;
  const rangeMax = optionPrices.length ? applyDiscount(Math.max(...optionPrices)) : null;
  const selectedPkg = packageOptions.find((p) => p.id === selectedPackageId);
  const previewTotal = selectedPkg ? applyDiscount(Number(selectedPkg.price) || 0) : null;
  const currency = doc.currency || 'USD';

  // "Build your own" — running summary of whatever the client has picked so far,
  // recomputed on every click so the sidebar total always reflects the current
  // selection (nothing persists server-side until Approve is submitted).
  const menuPicks = packageMenuDetails
    .map((entry) => {
      const pkgId = menuSelections[entry.serviceTypeKey];
      if (!pkgId) return null;
      const pkg = entry.packages.find((p: any) => p.id === pkgId);
      if (!pkg) return null;
      return { serviceTypeKey: entry.serviceTypeKey, serviceName: entry.serviceName, pkg };
    })
    .filter(Boolean) as { serviceTypeKey: string; serviceName: string; pkg: any }[];
  const menuSubtotal = menuPicks.reduce((sum, p) => sum + (Number(p.pkg.price) || 0), 0);
  const menuTotal = applyDiscount(menuSubtotal);
  const menuOneTimeSubtotal = menuPicks
    .filter((p) => !p.pkg.isRecurring)
    .reduce((sum, p) => sum + (Number(p.pkg.price) || 0), 0);
  const menuRecurringSubtotal = menuPicks
    .filter((p) => !!p.pkg.isRecurring)
    .reduce((sum, p) => sum + (Number(p.pkg.price) || 0), 0);
  // The Items table at the top is server-rendered with no price per service until
  // the document is approved, so it showed a dead "—" while the sidebar total moved.
  // Keyed by service so each row can mirror the client's current pick live.
  const menuPickByService = new Map(menuPicks.map((p) => [p.serviceTypeKey, p.pkg]));

  function toggleMenuSelection(serviceTypeKey: string, packageId: string) {
    setMenuSelections((prev) => (prev[serviceTypeKey] === packageId
      ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== serviceTypeKey))
      : { ...prev, [serviceTypeKey]: packageId }));
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#F1F5F9', backgroundImage: 'radial-gradient(circle, #CBD5E1 1px, transparent 1px)', backgroundSize: '24px 24px' }}>
      <div className="mx-auto px-4 sm:px-6 py-8 sm:py-12 max-w-6xl">
        {/* Mobile: company (sidebar order-1) → packages → selected items → rest.
            Desktop: same 2-col layout as before. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-start">
        <div className="order-2 lg:order-1 bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 overflow-hidden lg:col-span-2 flex flex-col">
          {/* Header — last-ish on mobile, first on desktop */}
          <div className="order-4 lg:order-1 px-5 sm:px-8 pt-6 sm:pt-8 pb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold tracking-widest uppercase" style={{ color: accentColor }}>
                {{ agreement: 'Agreement', proposal: 'Proposal' }[doc.type as string] || 'Quotation'}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">{doc.number}</h1>
                <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide', STATUS_BADGE_COLORS[doc.status] || 'bg-gray-100 text-gray-600')}>
                  {doc.status}
                </span>
              </div>
              <p className="text-sm text-gray-400 mt-1">
                Prepared for {doc.prospectName}{doc.businessName ? ` · ${doc.businessName}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open PDF
              </a>
              <a
                href={pdfUrl}
                download={`${doc.number}.pdf`}
                className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg px-3 py-1.5"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
            </div>
          </div>

          {/* Itemized list — after packages on mobile */}
          {(hasLineItems || hasResolvedServices) && (
            <div className="order-2 lg:order-2 px-5 sm:px-8 pb-2">
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      <th className="w-10 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">#</th>
                      <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Item</th>
                      <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {hasLineItems ? lineItems.map((li: any, i: number) => (
                      <tr key={i}>
                        <td className="px-3 py-3 text-gray-400 align-top">{i + 1}</td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium text-gray-900">{li.description}{Number(li.qty) > 1 ? ` × ${li.qty}` : ''}</p>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-700 align-top whitespace-nowrap">
                          {currency} {((Number(li.qty) || 1) * (Number(li.unitPrice) || 0)).toLocaleString()}
                        </td>
                      </tr>
                    )) : resolvedServices.map((s: any, i: number) => {
                      // Pre-approval in "build your package" mode this row mirrors whatever
                      // the client has picked below, so the Items table and the sidebar
                      // summary never disagree.
                      const picked = (isMenuMode && !isApproved) ? menuPickByService.get(s.serviceTypeKey) : null;
                      const label = picked ? (picked.tier || picked.name) : s.packageLabel;
                      const price = picked ? Number(picked.price) || 0 : (s.price != null ? Number(s.price) : null);
                      const features: string[] = picked && Array.isArray(picked.features) && picked.features.length
                        ? picked.features
                        : (Array.isArray(s.features) ? s.features : []);
                      const billingTag = picked ? packageBillingBadge(picked).short : null;
                      return (
                      <tr key={s.serviceTypeKey}>
                        <td className="px-3 py-3 text-gray-400 align-top">{i + 1}</td>
                        <td className="px-3 py-3 align-top">
                          <p className="font-medium text-gray-900">
                            {s.serviceName}{label ? ` — ${label}` : ''}
                            {billingTag ? <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{billingTag}</span> : null}
                          </p>
                          {s.scope && <p className="text-xs text-gray-500 mt-1 whitespace-pre-line">{s.scope}</p>}
                          {features.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5">
                              {features.map((f: string, fi: number) => (
                                <li key={fi} className="text-xs text-gray-500 flex items-start gap-1.5">
                                  <span className="mt-1 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                                  {f}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-gray-700 align-top whitespace-nowrap">
                          {price != null ? `${currency} ${price.toLocaleString()}${picked ? priceSuffix(picked) : ''}` : '—'}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {(isApproved || (!isMenuMode && !multiplePackageOptions)) && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5 max-w-xs ml-auto">
                  <div className="flex flex-wrap items-center justify-between text-sm text-gray-600 gap-2">
                    <span>Subtotal</span>
                    <span className="font-mono">{currency} {Number(doc.basePrice ?? doc.amount ?? 0).toLocaleString()}</span>
                  </div>
                  {doc.discountType && Number(doc.discountValue) > 0 && (
                    <div className="flex flex-wrap items-center justify-between text-sm text-gray-600 gap-2">
                      <span>Discount</span>
                      <span className="font-mono">{doc.discountType === 'percent' ? `${doc.discountValue}%` : `${currency} ${doc.discountValue}`}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between pt-1 gap-2">
                    <span className="text-sm font-semibold" style={{ color: accentColor }}>Total</span>
                    <span className="text-lg font-semibold text-gray-900">{currency} {Number(doc.amount ?? 0).toLocaleString()}</span>
                  </div>
                  {doc.discountType && Number(doc.discountValue) > 0 && Number(doc.discountCycles) > 0 && (
                    <p className="text-xs text-gray-500 pt-1">
                      This discounted rate applies for the first {doc.discountCycles} billing cycle{Number(doc.discountCycles) !== 1 ? 's' : ''}; billing reverts to the full rate afterward.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {doc.scopeTerms && (
            <div className="order-5 lg:order-4 px-5 sm:px-8 pb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Terms &amp; Scope of Work</p>
              <div className={`text-sm text-gray-700 ${richTextProseClass}`}
                dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(doc.scopeTerms) }} />
            </div>
          )}

          {/* Packages first on mobile (after company sidebar), after items on desktop */}
          <div className="order-1 lg:order-3 px-5 sm:px-8 pb-4 lg:pb-0">
            {isMenuMode && !isApproved && (
              <div className="pt-2 lg:border-t lg:border-gray-100 space-y-6">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">Build your package</p>
                    {hasDiscount && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: accentColor }}>
                        {discountLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Pick any package for any service below — or none at all. Nothing is required, and your choices are entirely independent of each other.
                    {hasDiscount && (doc.discountType === 'percent'
                      ? ' The price shown on each package already has the discount applied.'
                      : ` Your final total will have ${discountLabel.replace(' OFF', '')} taken off once you approve.`)}
                    {' '}
                    <span className="hidden lg:inline">Your summary updates on the right as you go.</span>
                    <span className="lg:hidden">Your summary updates below as you go.</span>
                  </p>
                </div>
                {packageMenuDetails.map((entry) => (
                  <div key={entry.serviceTypeKey}>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                      {entry.serviceName}{' '}
                      <span className="normal-case tracking-normal font-medium text-gray-400">(select any one)</span>
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {entry.packages.map((pkg: any) => {
                        const isSelected = menuSelections[entry.serviceTypeKey] === pkg.id;
                        return (
                          <button
                            key={pkg.id}
                            type="button"
                            disabled={!canRespond}
                            onClick={() => toggleMenuSelection(entry.serviceTypeKey, pkg.id)}
                            className="text-left rounded-xl border-2 p-4 transition-all disabled:cursor-default"
                            style={isSelected
                              ? { borderColor: accentColor, backgroundColor: `${accentColor}0D` }
                              : { borderColor: '#E5E7EB' }}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{pkg.tier || pkg.name}</p>
                                <span className={cn(
                                  'mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                                  pkg.isRecurring ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600',
                                )}>
                                  {packageBillingBadge(pkg).detail}
                                </span>
                              </div>
                              {isSelected && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accentColor }} />}
                            </div>
                            {hasDiscount && doc.discountType === 'percent' ? (
                              <p className="text-sm font-mono mt-1.5">
                                <span className="text-gray-400 line-through mr-1.5">{pkg.currency || currency} {Number(pkg.price || 0).toLocaleString()}</span>
                                <span className="font-semibold" style={{ color: accentColor }}>
                                  {pkg.currency || currency} {applyDiscount(Number(pkg.price || 0)).toLocaleString()}{priceSuffix(pkg)}
                                </span>
                              </p>
                            ) : (
                              <p className="text-sm font-mono text-gray-700 mt-1.5">
                                {/* Priced specially for this quotation and cheaper
                                    than the catalogue rate — show what it saves.
                                    A price set HIGHER is just the price. */}
                                {pkg.priceOverridden && Number(pkg.listPrice) > Number(pkg.price) && (
                                  <span className="text-gray-400 line-through mr-1.5">
                                    {pkg.currency || currency} {Number(pkg.listPrice || 0).toLocaleString()}
                                  </span>
                                )}
                                {pkg.currency || currency} {Number(pkg.price || 0).toLocaleString()}{priceSuffix(pkg)}
                              </p>
                            )}
                            {Array.isArray(pkg.features) && pkg.features.length > 0 && (
                              <ul className="mt-3 space-y-1">
                                {pkg.features.map((f: string, i: number) => (
                                  <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                                    <span className="mt-1 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                                    {f}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {isSelected && (
                              <p className="mt-2 text-[11px] font-medium" style={{ color: accentColor }}>Tap again to remove this service</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {multiplePackageOptions && !isApproved && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm font-semibold text-gray-900 mb-1">Choose one package</p>
                <p className="text-xs text-gray-400 mb-3">
                  These are alternatives — pick one. Your total is based on the package you select.
                </p>
                {rangeMin != null && rangeMax != null && (
                  <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Estimated range</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">
                      {rangeMin === rangeMax
                        ? `${currency} ${rangeMin.toLocaleString()}`
                        : `${currency} ${rangeMin.toLocaleString()} – ${rangeMax.toLocaleString()}`}
                    </p>
                    {doc.discountType && Number(doc.discountValue) > 0 && (
                      <p className="text-[11px] text-gray-500 mt-1">
                        Discount applied: {doc.discountType === 'percent' ? `${doc.discountValue}%` : `${currency} ${doc.discountValue}`}
                        {Number(doc.discountCycles) > 0 && ` — first ${doc.discountCycles} billing cycle${Number(doc.discountCycles) !== 1 ? 's' : ''} only`}
                      </p>
                    )}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {packageOptions.map((pkg: any) => {
                    const isSelected = selectedPackageId === pkg.id;
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        disabled={!canRespond}
                        onClick={() => setSelectedPackageId(pkg.id)}
                        className="text-left rounded-xl border-2 p-4 transition-all disabled:cursor-default"
                        style={isSelected
                          ? { borderColor: accentColor, backgroundColor: `${accentColor}0D` }
                          : { borderColor: '#E5E7EB' }}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{pkg.tier || pkg.name}</p>
                            <span className={cn(
                              'mt-1 inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded',
                              pkg.isRecurring ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600',
                            )}>
                              {packageBillingBadge(pkg).detail}
                            </span>
                          </div>
                          {isSelected && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: accentColor }} />}
                        </div>
                        {hasDiscount && doc.discountType === 'percent' ? (
                          <p className="text-sm font-mono mt-1.5">
                            <span className="text-gray-400 line-through mr-1.5">{pkg.currency || currency} {Number(pkg.price || 0).toLocaleString()}</span>
                            <span className="font-semibold" style={{ color: accentColor }}>
                              {pkg.currency || currency} {applyDiscount(Number(pkg.price || 0)).toLocaleString()}{priceSuffix(pkg)}
                            </span>
                          </p>
                        ) : (
                          <p className="text-sm font-mono text-gray-700 mt-1.5">
                            {pkg.currency || currency} {Number(pkg.price || 0).toLocaleString()}{priceSuffix(pkg)}
                          </p>
                        )}
                        {Array.isArray(pkg.features) && pkg.features.length > 0 && (
                          <ul className="mt-3 space-y-1">
                            {pkg.features.map((f: string, i: number) => (
                              <li key={i} className="text-xs text-gray-500 flex items-start gap-1.5">
                                <span className="mt-1 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
                                {f}
                              </li>
                            ))}
                          </ul>
                        )}
                      </button>
                    );
                  })}
                </div>
                {previewTotal != null && (
                  <div className="mt-4 rounded-xl px-4 py-3 border-2" style={{ borderColor: accentColor, backgroundColor: `${accentColor}0D` }}>
                    <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: accentColor }}>Your total</p>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">
                      {currency} {previewTotal.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">
                      Based on {selectedPkg?.tier || selectedPkg?.name}
                      {doc.discountType && Number(doc.discountValue) > 0 ? ' (discount included)' : ''}
                    </p>
                  </div>
                )}
                {canRespond && (
                  <div className="mt-4">
                    <label className="block text-xs font-medium text-gray-600 mb-1.5">Why this one? (optional)</label>
                    <input
                      value={selectionReason}
                      onChange={(e) => setSelectionReason(e.target.value)}
                      placeholder="Optional note about your choice"
                      className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Mobile selection summary — with selected items, before doc header/rest */}
          {isMenuMode && !isApproved && (
            <div className="order-3 lg:hidden px-5 pb-2">
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
                <p className="text-sm font-semibold text-gray-900 mb-3">Your selection</p>
                {menuPicks.length === 0 ? (
                  <p className="text-xs text-gray-400">Nothing selected yet — pick packages above. You can skip any service.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {menuPicks.map((p) => (
                      <li key={p.serviceTypeKey} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-900 font-medium truncate">{p.serviceName}</p>
                          <p className="text-xs text-gray-400">
                            {p.pkg.tier || p.pkg.name}
                            <span className={cn('ml-1.5', p.pkg.isRecurring ? 'text-blue-600' : 'text-gray-500')}>
                              · {packageBillingBadge(p.pkg).short}
                            </span>
                          </p>
                        </div>
                        <span className="text-xs font-mono text-gray-600 shrink-0">
                          {p.pkg.currency || currency} {Number(p.pkg.price || 0).toLocaleString()}{priceSuffix(p.pkg)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-1.5">
                  {menuPicks.length > 0 && menuOneTimeSubtotal > 0 && (
                    <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                      <span>One-time</span>
                      <span className="font-mono">{currency} {menuOneTimeSubtotal.toLocaleString()}</span>
                    </div>
                  )}
                  {menuPicks.length > 0 && menuRecurringSubtotal > 0 && (
                    <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                      <span>Recurring</span>
                      <span className="font-mono">{currency} {menuRecurringSubtotal.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                    <span>Subtotal</span>
                    <span className="font-mono">{currency} {menuSubtotal.toLocaleString()}</span>
                  </div>
                  {hasDiscount && (
                    <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                      <span>Discount</span>
                      <span className="font-mono">{discountLabel}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between pt-1 gap-2">
                    <span className="text-sm font-semibold" style={{ color: accentColor }}>Total</span>
                    <span className="text-lg font-semibold text-gray-900">{currency} {menuTotal.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

            {/* Actions */}
            <div className={cn('order-6 lg:order-5 px-5 sm:px-8 pb-8', (multiplePackageOptions || isMenuMode) ? 'mt-2 lg:mt-8 lg:pt-6 lg:border-t lg:border-gray-100' : 'mt-4')}>
              {doc.requiresDetails ? (
                /* Step two: approved, now we need who to bill. Replaces the plain
                   "you approved this" note — leaving that as the only thing on
                   screen would strand the client with nothing to do. */
                <div className="space-y-4">
                  <div className="flex items-start gap-2 text-sm bg-gray-50 rounded-xl px-4 py-3">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: accentColor }} />
                    <div>
                      <p className="font-medium text-gray-800">Approved — one last step.</p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Confirm your billing details so we can raise your invoice. All fields are required.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {DETAIL_FIELDS.map((f) => (
                      <div key={f.key} className={f.full ? 'sm:col-span-2' : undefined}>
                        <label className="block text-xs font-medium text-gray-600 mb-1.5">{f.label} *</label>
                        <input
                          type={f.type || 'text'}
                          value={details[f.key] || ''}
                          onChange={(e) => setDetails((d) => ({ ...d, [f.key]: e.target.value }))}
                          className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2"
                          style={{ boxShadow: 'none' }}
                        />
                      </div>
                    ))}
                  </div>

                  {detailsError && <p className="text-sm text-red-600">{detailsError}</p>}

                  <p className="text-xs text-gray-500">
                    Once submitted, {branding?.brandName || 'the team'} will confirm your details and send your invoice.
                  </p>

                  <button
                    onClick={submitDetails}
                    disabled={detailsSubmitting}
                    className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all hover:opacity-90 disabled:opacity-60"
                    style={{ backgroundColor: accentColor }}
                  >
                    {detailsSubmitting ? 'Submitting…' : 'Submit billing details'}
                  </button>
                </div>
              ) : !canRespond ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-xl px-4 py-3">
                    {doc.status === 'approved' ? <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0" /> : <XCircle className="w-4 h-4 text-gray-400 shrink-0" />}
                    {STATUS_LABEL[doc.status] || `Status: ${doc.status}`}
                  </div>

                  {doc.convertedClientId || doc.convertedProjectId ? (
                    <div className="flex items-center gap-2 text-sm text-emerald-800 bg-emerald-50 rounded-xl px-4 py-3">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      Payment received — thank you! Your invoice has been generated and marked paid.
                    </div>
                  ) : doc.canPayByCard ? (
                    <div className="space-y-2">
                      <button
                        onClick={payNow}
                        disabled={payingNow}
                        className="w-full flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all hover:opacity-90 disabled:opacity-60"
                        style={{ backgroundColor: accentColor }}
                      >
                        <CreditCard className="w-4 h-4" />
                        {payingNow ? 'Opening secure checkout…' : `Pay ${currency} ${Number(doc.amount).toLocaleString()} now`}
                      </button>
                      {payError && <p className="text-sm text-red-600">{payError}</p>}
                      <p className="text-[11px] text-gray-400 text-center">
                        Payments are processed securely by Stripe. Nothing is billed until you complete checkout.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : mode === 'view' ? (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => setMode('approve')}
                    className="flex-1 flex items-center justify-center gap-2 text-white font-semibold text-sm py-3 rounded-xl transition-all hover:opacity-90"
                    style={{ backgroundColor: accentColor }}
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    onClick={() => setMode('reject')}
                    className="flex-1 flex items-center justify-center gap-2 text-gray-700 font-semibold text-sm py-3 rounded-xl border border-gray-200 hover:bg-gray-50 transition-all"
                  >
                    <FileText className="w-4 h-4" /> Request Changes
                  </button>
                </div>
              ) : mode === 'approve' ? (
                <div className="space-y-3">
                  {multiplePackageOptions && (
                    <p className={cn('text-xs', selectedPackageId ? 'text-gray-600' : 'font-medium')} style={!selectedPackageId ? { color: accentColor } : undefined}>
                      {selectedPackageId && previewTotal != null
                        ? `Approving ${selectedPkg?.tier || selectedPkg?.name} — total ${currency} ${previewTotal.toLocaleString()}`
                        : 'Select a package above before approving.'}
                    </p>
                  )}
                  {isMenuMode && (
                    <p className="text-xs text-gray-600">
                      {menuPicks.length > 0
                        ? `Approving ${menuPicks.length} service${menuPicks.length === 1 ? '' : 's'} — total ${currency} ${menuTotal.toLocaleString()}`
                        : 'Approving with nothing selected — you can always request changes instead if that\'s not intended.'}
                    </p>
                  )}
                  <label className="block text-xs font-medium text-gray-600">
                    Digital signature — type <span className="font-semibold text-gray-800">&quot;{signatureRequired}&quot;</span> exactly to sign
                  </label>
                  <input
                    value={signerName}
                    onChange={(e) => setSignerName(e.target.value)}
                    placeholder={signatureRequired}
                    autoComplete="off"
                    className={cn(
                      'w-full px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2',
                      signerName && !signatureMatches ? 'border-red-300' : 'border-gray-300',
                    )}
                    style={{ boxShadow: 'none' }}
                  />
                  {signerName && !signatureMatches && (
                    <p className="text-xs text-red-600">Doesn&apos;t match &quot;{signatureRequired}&quot; yet.</p>
                  )}
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={submitApprove} disabled={submitting || !signatureMatches || (multiplePackageOptions && !selectedPackageId)}
                      className="flex-1 text-white font-semibold text-sm py-2.5 rounded-xl disabled:opacity-60"
                      style={{ backgroundColor: accentColor }}>
                      {submitting ? 'Submitting…' : 'Confirm Approval'}
                    </button>
                    <button onClick={() => { setMode('view'); setError(''); }} className="px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-xl">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-gray-600">What changes would you like?</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Describe what you'd like changed…"
                    className="w-full px-4 py-2.5 text-sm border border-gray-300 rounded-xl focus:outline-none focus:ring-2 resize-none"
                  />
                  {error && <p className="text-sm text-red-600">{error}</p>}
                  <div className="flex gap-2">
                    <button onClick={submitReject} disabled={submitting}
                      className="flex-1 bg-gray-900 hover:bg-gray-800 text-white font-semibold text-sm py-2.5 rounded-xl disabled:opacity-60">
                      {submitting ? 'Submitting…' : 'Send Feedback'}
                    </button>
                    <button onClick={() => { setMode('view'); setError(''); }} className="px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 rounded-xl">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
        </div>

        <div className="order-1 lg:order-2 lg:sticky lg:top-8 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">From</p>
              <div className="flex flex-col items-start gap-1.5 mt-1.5">
                {logoUrl ? (
                  <img src={logoUrl} alt={brandName} className="h-8 w-auto" />
                ) : (
                  <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: accentColor }}>
                    <span className="text-white font-bold text-sm">{brandName.charAt(0)}</span>
                  </div>
                )}
                <span className="text-sm font-semibold text-gray-900">{brandName}</span>
              </div>
              {(branding?.businessAddress || branding?.businessPhone || branding?.website || branding?.taxNumber || branding?.email) && (
                <div className="mt-2 space-y-0.5 text-xs text-gray-500">
                  {branding?.businessAddress && <p className="whitespace-pre-line">{branding.businessAddress}</p>}
                  {branding?.businessPhone && <p>{branding.businessPhone}</p>}
                  {branding?.email && <p>{branding.email}</p>}
                  {branding?.website && <p>{branding.website}</p>}
                  {branding?.taxNumber && <p>EIN: {branding.taxNumber}</p>}
                </div>
              )}
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-1 text-xs text-gray-500">
                <p><span className="text-gray-400">Document</span> · {doc.number}</p>
                <p><span className="text-gray-400">Prepared for</span> · {doc.prospectName}{doc.businessName ? ` (${doc.businessName})` : ''}</p>
                {doc.email && <p><span className="text-gray-400">Email</span> · {doc.email}</p>}
                {doc.phone && <p><span className="text-gray-400">Phone</span> · {doc.phone}</p>}
                {doc.validUntil && <p><span className="text-gray-400">Valid until</span> · {new Date(doc.validUntil).toLocaleDateString()}</p>}
              </div>
            </div>

            {isMenuMode && !isApproved && (
              <div className="hidden lg:block bg-white rounded-2xl border border-gray-200/80 shadow-lg shadow-gray-200/60 p-5">
                <p className="text-sm font-semibold text-gray-900 mb-3">Your selection</p>
                {menuPicks.length === 0 ? (
                  <p className="text-xs text-gray-400">Nothing selected yet — pick any packages you&apos;d like from the services on the left. You&apos;re free to skip any (or all) of them.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {menuPicks.map((p) => (
                      <li key={p.serviceTypeKey} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                        <div className="min-w-0">
                          <p className="text-gray-900 font-medium truncate">{p.serviceName}</p>
                          <p className="text-xs text-gray-400">
                            {p.pkg.tier || p.pkg.name}
                            <span className={cn('ml-1.5', p.pkg.isRecurring ? 'text-blue-600' : 'text-gray-500')}>
                              · {packageBillingBadge(p.pkg).short}
                            </span>
                          </p>
                        </div>
                        <span className="text-xs font-mono text-gray-600 shrink-0">
                          {p.pkg.currency || currency} {Number(p.pkg.price || 0).toLocaleString()}{priceSuffix(p.pkg)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-1.5">
                  {menuPicks.length > 0 && (menuOneTimeSubtotal > 0 || menuRecurringSubtotal > 0) && (
                    <>
                      {menuOneTimeSubtotal > 0 && (
                        <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                          <span>One-time</span>
                          <span className="font-mono">{currency} {menuOneTimeSubtotal.toLocaleString()}</span>
                        </div>
                      )}
                      {menuRecurringSubtotal > 0 && (
                        <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                          <span>Recurring</span>
                          <span className="font-mono">{currency} {menuRecurringSubtotal.toLocaleString()}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                    <span>Subtotal</span>
                    <span className="font-mono">{currency} {menuSubtotal.toLocaleString()}</span>
                  </div>
                  {hasDiscount && (
                    <div className="flex flex-wrap items-center justify-between text-xs text-gray-500 gap-2">
                      <span>Discount</span>
                      <span className="font-mono">{discountLabel}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between pt-1 gap-2">
                    <span className="text-sm font-semibold" style={{ color: accentColor }}>Total</span>
                    <span className="text-lg font-semibold text-gray-900">{currency} {menuTotal.toLocaleString()}</span>
                  </div>
                  {menuPicks.some((p) => p.pkg.isRecurring) && (
                    <p className="text-[11px] text-gray-400 pt-1">
                      Recurring amounts bill on each package&apos;s cycle (monthly / quarterly / yearly).
                    </p>
                  )}
                </div>
              </div>
            )}
        </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          This review link was sent to you by {brandName}.
        </p>
      </div>
    </div>
  );
}
