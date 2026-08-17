'use client';

/**
 * Admin → Companies.
 *
 * Manages the legal entities whose details print on generated documents, and the
 * two checkboxes that decide which entity appears on which kind of document:
 *
 *   Use for invoices & quotations → invoices, quotations, agreements, proposals
 *   Use for HR documents          → appointment / experience / bank-opening
 *                                   letters, salary slips
 *
 * The rules the summary panel exists to make visible, because they are easy to
 * get wrong and only show up on a document a client has already been sent:
 *   • tick one company for a category  → only that company's block prints
 *   • tick both                        → both blocks print on that document
 *   • tick none                        → falls back to Admin → Branding
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Save, Pencil, X, Upload, Star, AlertTriangle,
  FileText, Users, Check, Hash,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import AdminModal from '@/components/admin/AdminModal';
import { cn, uploadErrorMessage } from '@/lib/utils';

type Company = {
  id: string;
  legalName: string;
  code: string;
  officeLabel: string;
  address: string | null;
  taxLabel: string;
  taxNumber: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  stampUrl: string | null;
  letterheadNote: string | null;
  invoiceNotes: string | null;
  invoiceTerms: string | null;
  defaultCurrency: string;
  useForHrDocuments: boolean;
  useForBilling: boolean;
  isPrimary: boolean;
  isActive: boolean;
  sortOrder: number;
};

type Resolution = {
  billing: { id: string; legalName: string; code: string; officeLabel: string; isPrimary: boolean }[];
  hr: { id: string; legalName: string; code: string; officeLabel: string; isPrimary: boolean }[];
  billingFallsBackToBranding: boolean;
  hrFallsBackToBranding: boolean;
  numberingCompany: { code: string; legalName: string } | null;
};

const inp = 'w-full px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';
const btn = 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-700 hover:bg-brand-800 text-white`;
const btnGhost = `${btn} border border-gray-300 hover:bg-gray-50 text-gray-700`;

const EMPTY = {
  legalName: '', code: '', officeLabel: 'Office', address: '',
  taxLabel: 'EIN', taxNumber: '', email: '', phone: '', website: '',
  logoUrl: '', signatureUrl: '', stampUrl: '', letterheadNote: '', invoiceNotes: '', invoiceTerms: '',
  defaultCurrency: 'USD',
};

function Field({ label, hint, children, className }: {
  label: string; hint?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-semibold text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/**
 * One brand asset (logo / signature / stamp) as a self-contained card.
 *
 * The three used to be inline label+preview+button rows sharing a column grid
 * with the text inputs. Each needed a different amount of room, so they never
 * lined up: the previews collided with the buttons, and widening them left
 * ragged gaps. As equal cards with a fixed-height preview well they read as one
 * set, and the row stays even whether an image is present or not.
 */
function AssetCard({ label, hint, url, uploading, emptyLabel, accept, onPick, onClear }: {
  label: string;
  hint: string;
  url: string;
  uploading: boolean;
  emptyLabel: string;
  accept: string;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        {url && (
          <button
            type="button"
            onClick={onClear}
            className="p-1 -m-1 rounded text-gray-400 hover:text-red-500"
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Fixed-height well so all three cards are the same height with or
          without an image — that's what stops the row looking ragged. */}
      <div className="h-16 rounded-lg border border-dashed border-gray-300 bg-white flex items-center justify-center overflow-hidden mb-2">
        {url
          ? <img src={url} alt="" className="max-h-14 max-w-full object-contain" />
          : <span className="text-[11px] text-gray-400">{emptyLabel}</span>}
      </div>

      <label className="w-full inline-flex items-center justify-center gap-1.5 cursor-pointer text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 transition-colors">
        <Upload className="w-3.5 h-3.5 shrink-0" />
        {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
        <input type="file" accept={accept} className="hidden" onChange={onPick} />
      </label>

      <p className="text-[11px] text-gray-400 mt-2 leading-snug">{hint}</p>
    </div>
  );
}

export default function CompaniesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Company | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [logoUploading, setLogoUploading] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [stampUploading, setStampUploading] = useState(false);
  const [confirmOff, setConfirmOff] = useState<Company | null>(null);

  const { data: companies = [], isLoading } = useQuery<Company[]>({
    queryKey: ['admin-companies'],
    queryFn: () => api.get('/admin/companies?includeInactive=true').then((r) => r.data),
  });

  const { data: resolution } = useQuery<Resolution>({
    queryKey: ['admin-companies-resolution'],
    queryFn: () => api.get('/admin/companies/resolution').then((r) => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-companies'] });
    qc.invalidateQueries({ queryKey: ['admin-companies-resolution'] });
  };

  const save = useMutation({
    mutationFn: () => (editing
      ? api.patch(`/admin/companies/${editing.id}`, form).then((r) => r.data)
      : api.post('/admin/companies', form).then((r) => r.data)),
    onSuccess: () => {
      toast.success(editing ? 'Company updated.' : 'Company added.');
      setEditing(null);
      setCreating(false);
      setForm({ ...EMPTY });
      refresh();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not save the company.'),
  });

  const toggleCategory = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, boolean> }) =>
      api.patch(`/admin/companies/${id}/categories`, patch).then((r) => r.data),
    onSuccess: refresh,
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update.'),
  });

  const setPrimary = useMutation({
    mutationFn: (id: string) => api.post(`/admin/companies/${id}/primary`).then((r) => r.data),
    onSuccess: () => { toast.success('Primary company updated.'); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update.'),
  });

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => (active
      ? api.post(`/admin/companies/${id}/activate`).then((r) => r.data)
      : api.delete(`/admin/companies/${id}`).then((r) => r.data)),
    onSuccess: (d: any) => { toast.success(d?.message || 'Updated.'); setConfirmOff(null); refresh(); },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not update.'),
  });

  function startEdit(c: Company) {
    setCreating(false);
    setEditing(c);
    setForm({
      legalName: c.legalName || '', code: c.code || '', officeLabel: c.officeLabel || 'Office',
      address: c.address || '', taxLabel: c.taxLabel || 'EIN', taxNumber: c.taxNumber || '',
      email: c.email || '', phone: c.phone || '', website: c.website || '',
      logoUrl: c.logoUrl || '', signatureUrl: c.signatureUrl || '', stampUrl: c.stampUrl || '', letterheadNote: c.letterheadNote || '',
      invoiceNotes: c.invoiceNotes || '', invoiceTerms: c.invoiceTerms || '',
      defaultCurrency: c.defaultCurrency || 'USD',
    });
  }

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setForm({ ...EMPTY });
  }

  function cancel() {
    setEditing(null);
    setCreating(false);
    setForm({ ...EMPTY });
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/media/upload', fd);
      setForm((prev) => ({ ...prev, logoUrl: data.url }));
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setLogoUploading(false);
      e.target.value = '';
    }
  }

  async function uploadToField(
    e: React.ChangeEvent<HTMLInputElement>,
    field: 'signatureUrl' | 'stampUrl',
    setUploading: (v: boolean) => void,
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post('/media/upload', fd);
      setForm((prev: any) => ({ ...prev, [field]: data.url }));
    } catch (err: any) {
      toast.error(uploadErrorMessage(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  const showForm = creating || !!editing;

  return (
    <div className="space-y-6">
      {/* ── Company list ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-gray-100">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Companies</h3>
            {/* One compact line each, instead of a separate explainer card —
                this is the only thing an admin needs to confirm at a glance. */}
            <div className="mt-1 space-y-0.5">
              <ResolutionLine
                icon={FileText}
                label="Invoices & quotations"
                rows={resolution?.billing || []}
                fallback={!!resolution?.billingFallsBackToBranding}
              />
              <ResolutionLine
                icon={Users}
                label="HR documents"
                rows={resolution?.hr || []}
                fallback={!!resolution?.hrFallsBackToBranding}
              />
            </div>
          </div>
          <button onClick={startCreate} className={btnPrimary}>
            <Plus className="w-3.5 h-3.5" />
            Add Company
          </button>
        </div>

        {isLoading ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">Loading…</p>
        ) : companies.length === 0 ? (
          <p className="px-6 py-8 text-sm text-gray-400 text-center">No companies yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {companies.map((c) => (
              <div key={c.id} className={cn('px-4 sm:px-6 py-4', !c.isActive && 'bg-gray-50/60 opacity-70')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="text-sm font-semibold text-gray-900">{c.legalName}</span>
                      <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-gray-100 text-gray-600 rounded">
                        {c.code}
                      </span>
                      {c.isPrimary && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 rounded">
                          <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                          Primary
                        </span>
                      )}
                      {!c.isActive && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-500 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      <span className="font-medium">{c.officeLabel}:</span>{' '}
                      {(c.address || '—').replace(/\n/g, ', ')}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!c.isPrimary && c.isActive && (
                      <button
                        onClick={() => setPrimary.mutate(c.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                        title="Make primary (supplies the document-number prefix)"
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(c)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {c.isActive ? (
                      <button
                        onClick={() => setConfirmOff(c)}
                        className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        onClick={() => setActive.mutate({ id: c.id, active: true })}
                        className="px-2.5 py-1 text-xs font-medium border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>

                {/* The two checkboxes this whole feature exists for. */}
                <div className="flex flex-wrap gap-4 mt-3 pt-3 border-t border-gray-50">
                  <CategoryCheck
                    checked={c.useForBilling}
                    disabled={!c.isActive || toggleCategory.isPending}
                    onChange={(v) => toggleCategory.mutate({ id: c.id, patch: { useForBilling: v } })}
                    icon={FileText}
                    label="Use for invoices & quotations"
                  />
                  <CategoryCheck
                    checked={c.useForHrDocuments}
                    disabled={!c.isActive || toggleCategory.isPending}
                    onChange={(v) => toggleCategory.mutate({ id: c.id, patch: { useForHrDocuments: v } })}
                    icon={Users}
                    label="Use for HR documents"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Create / edit form ───────────────────────────────────────────── */}
      <AdminModal
        open={showForm}
        title={editing ? `Edit ${editing.legalName}` : 'Add Company'}
        onClose={cancel}
        footer={(
          <>
            <button
              onClick={() => save.mutate()}
              disabled={save.isPending || !form.legalName.trim()}
              className={btnPrimary}
            >
              <Save className="w-3.5 h-3.5" />
              {save.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Company'}
            </button>
            <button onClick={cancel} className={btnGhost}>Cancel</button>
          </>
        )}
      >
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Legal name" hint="Printed as the heading of the letterhead.">
              <input
                className={inp}
                value={form.legalName}
                onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                placeholder="MOHSIN DESIGNS LLC"
              />
            </Field>
            <Field label="Code" hint="Used in document numbers, e.g. MDL-INV-26-0001. Leave blank to auto-generate.">
              <input
                className={`${inp} font-mono uppercase`}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="MDL"
                maxLength={10}
              />
            </Field>
            <Field label="Office label" hint='Bolded prefix on the address, e.g. "US Office".'>
              <input
                className={inp}
                value={form.officeLabel}
                onChange={(e) => setForm({ ...form, officeLabel: e.target.value })}
                placeholder="US Office"
              />
            </Field>
            <Field label="Default currency">
              <input
                className={`${inp} uppercase`}
                value={form.defaultCurrency}
                onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value.toUpperCase() })}
                placeholder="USD"
                maxLength={10}
              />
            </Field>
          </div>

          <Field label="Address" hint="One line per line — printed exactly as entered.">
            <textarea
              className={inp}
              rows={3}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder={'312 W 2nd St\nUnit #A7077\nCasper, WY 82601'}
            />
          </Field>

          {/* Tax identifier reads as ONE thing — a label and its number — so the
              two inputs are joined rather than sitting in separate grid columns
              of equal width, where the short label got as much room as the long
              number and both ended up cramped. */}
          <Field label="Tax identifier" hint="The label prints beside the number, e.g. “NTN 1234567-8”.">
            {/* The WRAPPERS carry the widths, not the inputs. `inp` already
                includes w-full, and adding w-24 to it just collides — both are
                width utilities of equal specificity, so source order decided and
                the label input took the whole row, pushing the number field off
                the edge and creating a horizontal scrollbar. */}
            <div className="flex gap-2">
              <div className="w-24 shrink-0">
                <input
                  className={`${inp} text-center font-medium`}
                  value={form.taxLabel}
                  onChange={(e) => setForm({ ...form, taxLabel: e.target.value })}
                  placeholder="EIN"
                  aria-label="Tax label"
                />
              </div>
              <div className="flex-1 min-w-0">
                <input
                  className={inp}
                  value={form.taxNumber}
                  onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
                  placeholder="Number"
                  aria-label="Tax number"
                />
              </div>
            </div>
          </Field>

          {/* Two per row, not four: an email or a phone number cannot be read in
              a quarter-width box. Placeholders are generic on purpose — the old
              ones were real-looking values ("+1-(307)-449-2070"), so an empty
              field looked filled in. That matters here: these print on documents,
              and a blank one now correctly prints nothing. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Email" hint="Printed in the document footer. Leave blank to omit it.">
              <input
                className={inp}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
              />
            </Field>
            <Field label="Phone" hint="Printed in the document footer. Leave blank to omit it.">
              <input
                className={inp}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Include country code"
              />
            </Field>
          </div>

          <Field label="Website" hint="Leave blank to omit it from the footer.">
            <input
              className={inp}
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="company.com"
            />
          </Field>

          {/* Brand assets, as one labelled set. They belong together — all three
              are images that print on this company's documents — and grouping
              them keeps the text fields above on a clean grid of their own. */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-2">Brand assets</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <AssetCard
                label="Logo"
                emptyLabel="Default logo"
                hint="Optional — the default Mohsin Designs logo is used when empty."
                url={form.logoUrl}
                uploading={logoUploading}
                accept="image/png,image/jpeg"
                onPick={handleLogoUpload}
                onClear={() => setForm({ ...form, logoUrl: '' })}
              />
              <AssetCard
                label="Signature"
                emptyLabel="None"
                hint="Printed on HR generated documents."
                url={form.signatureUrl}
                uploading={signatureUploading}
                accept="image/png,image/jpeg"
                onPick={(e) => uploadToField(e, 'signatureUrl', setSignatureUploading)}
                onClear={() => setForm({ ...form, signatureUrl: '' })}
              />
              <AssetCard
                label="Stamp"
                emptyLabel="None"
                hint="Printed with signature on HR generated documents."
                url={form.stampUrl}
                uploading={stampUploading}
                accept="image/png,image/jpeg"
                onPick={(e) => uploadToField(e, 'stampUrl', setStampUploading)}
                onClear={() => setForm({ ...form, stampUrl: '' })}
              />
            </div>
          </div>

          <Field label="Letterhead note" hint="The quoted paragraph under the address block.">
            <textarea
              className={inp}
              rows={2}
              value={form.letterheadNote}
              onChange={(e) => setForm({ ...form, letterheadNote: e.target.value })}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Invoice notes" hint="Payment instructions printed on this company's invoices.">
              <textarea
                className={inp}
                rows={3}
                value={form.invoiceNotes}
                onChange={(e) => setForm({ ...form, invoiceNotes: e.target.value })}
              />
            </Field>
            <Field label="Invoice terms" hint="Terms & Conditions block on this company's invoices.">
              <textarea
                className={inp}
                rows={3}
                value={form.invoiceTerms}
                onChange={(e) => setForm({ ...form, invoiceTerms: e.target.value })}
              />
            </Field>
          </div>

      </AdminModal>

      <ConfirmDialog
        open={!!confirmOff}
        title="Deactivate company?"
        message={`"${confirmOff?.legalName}" will stop appearing on new documents. Documents already issued keep their letterhead and numbering.`}
        confirmLabel="Deactivate"
        onConfirm={() => confirmOff && setActive.mutate({ id: confirmOff.id, active: false })}
        onCancel={() => setConfirmOff(null)}
      />
    </div>
  );
}

/** "Invoices & quotations → US Office + Pakistan Office" on one line. */
function ResolutionLine({
  icon: Icon, label, rows, fallback,
}: {
  icon: any;
  label: string;
  rows: { id: string; legalName: string; officeLabel: string }[];
  fallback: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className="w-3 h-3 text-gray-300 shrink-0" />
      <span className="text-gray-400">{label}</span>
      {fallback ? (
        <span className="inline-flex items-center gap-1 text-amber-600">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          none selected
        </span>
      ) : (
        <span className="text-gray-700 font-medium truncate">
          {rows.map((r) => r.officeLabel).join(' + ')}
        </span>
      )}
    </div>
  );
}

function CategoryCheck({
  checked, disabled, onChange, icon: Icon, label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  icon: any;
  label: string;
}) {
  return (
    <label className={cn(
      'inline-flex items-center gap-2 text-xs cursor-pointer select-none',
      disabled && 'opacity-50 cursor-not-allowed',
    )}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-brand-700 focus:ring-brand-600"
      />
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className={cn('font-medium', checked ? 'text-gray-900' : 'text-gray-500')}>{label}</span>
    </label>
  );
}
