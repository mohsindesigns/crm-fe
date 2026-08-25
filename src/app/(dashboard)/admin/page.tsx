'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Palette, Settings, Workflow, Package, Shield, ScrollText, Building2, CreditCard,
  Plus, Save, Pencil, Trash2, X, ChevronDown, ChevronUp, Check, Upload, Search, Filter,
  ClipboardCheck, Download,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import ConfirmDialog from '@/components/ConfirmDialog';
import CompaniesTab from '@/components/admin/CompaniesTab';
import PaymentMethodsTab from '@/components/admin/PaymentMethodsTab';
import ExportDataTab from '@/components/admin/ExportDataTab';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import ColorInput from '@/components/ColorInput';
import { BORDER_RADIUS_OPTIONS, type BorderRadius } from '@/lib/leadFormTheme';
import { useAuthStore } from '@/store/auth';
import { cn, titleCase, uploadErrorMessage, inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import RichTextEditor, { type RichTextEditorHandle } from '@/components/RichTextEditor';

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_PERMISSIONS = [
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
  { key: 'hr.read',          label: 'View HR & payroll' },
  { key: 'hr.manage',        label: 'Manage HR & payroll' },
  { key: 'admin.access',     label: 'Access admin panel' },
  { key: 'reports.read',     label: 'View member reports' },
  { key: 'seo.read',         label: 'View SEO data' },
  { key: 'seo.manage',       label: 'Manage SEO data' },
];

const STAGE_TYPES = ['work', 'approval'] as const;
const ADVANCE_RULES = ['single_action', 'all_tasks_done', 'all_tasks_approved', 'manual'] as const;
const ACTIONS = ['complete', 'approve', 'reject', 'rewind'] as const;

type Tab = 'branding' | 'companies' | 'payments' | 'services' | 'workflows' | 'roles' | 'packages' | 'templates' | 'client-req-forms' | 'export';

const CLIENT_REQ_FIELD_TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Dropdown (multi-select)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File attachment' },
] as const;

const MERGE_TOKENS = [
  'customer_name', 'business_name', 'customer_email', 'customer_phone',
  'email', 'phone', 'agency_email', 'agency_phone',
  'service', 'package',
  'price', 'currency', 'scope', 'terms', 'date', 'valid_until', 'agency_name',
  'discount', 'services_block', 'subtotal', 'total',
];

const inp = 'w-full px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';
const btn = 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-700 hover:bg-brand-800 text-white`;
const btnGhost = `${btn} border border-gray-300 hover:bg-gray-50 text-gray-700`;
const btnDanger = `${btn} border border-red-200 hover:bg-red-50 text-red-600`;

function slugify(s: string) {
  return s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

// Which company details print by default on the Keywords/Backlinks SEO report
// letterhead (project page → Keywords/Backlinks tabs). Only Logo is checked by
// default — the full address/tax/contact block used to print unconditionally.
const SEO_REPORT_FIELD_OPTS = [
  { key: 'logo',    label: 'Logo' },
  { key: 'address', label: 'Address' },
  { key: 'tax',     label: 'Tax/EIN' },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone' },
  { key: 'website', label: 'Website' },
  { key: 'note',    label: 'Note' },
];

// ─── Branding Tab ─────────────────────────────────────────────────────────────

function BrandingTab() {
  const updateBranding = useAuthStore((s) => s.updateBranding);
  const qc = useQueryClient();
  const [logoUploading, setLogoUploading] = useState(false);

  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get('/admin/branding').then((r) => r.data),
  });

  const [form, setForm] = useState({
    brandName: '', primaryColor: '#0B1D5E', logoUrl: '', emailFrom: '',
    businessAddress: '', businessPhone: '', website: '', taxNumber: '',
    invoiceNotes: '', invoiceTerms: '',
    legalName: '', usOfficeAddress: '', pkOfficeAddress: '',
    einNumber: '', contactEmail: '', letterheadNote: '',
    seoReportLetterheadFields: ['logo'] as string[],
    paymentThankYouSubject: '', paymentThankYouBody: '',
  });

  // What the PDF renderers fall back to when a letterhead field is left blank —
  // shown as the placeholder so the form never implies a document will print
  // with a gap where the address should be.
  const lhDefaults = branding?.letterheadDefaults || {};

  useEffect(() => {
    if (branding) setForm({
      brandName: branding.brandName || '',
      primaryColor: branding.primaryColor || '#0B1D5E',
      logoUrl: branding.logoUrl || '',
      emailFrom: branding.emailFrom || '',
      businessAddress: branding.businessAddress || '',
      businessPhone: branding.businessPhone || '',
      website: branding.website || '',
      taxNumber: branding.taxNumber || '',
      invoiceNotes: branding.invoiceNotes || '',
      invoiceTerms: branding.invoiceTerms || '',
      legalName: branding.legalName || '',
      usOfficeAddress: branding.usOfficeAddress || '',
      pkOfficeAddress: branding.pkOfficeAddress || '',
      einNumber: branding.einNumber || '',
      contactEmail: branding.contactEmail || '',
      letterheadNote: branding.letterheadNote || '',
      seoReportLetterheadFields: typeof branding.seoReportLetterheadFields === 'string' && branding.seoReportLetterheadFields
        ? branding.seoReportLetterheadFields.split(',').map((s: string) => s.trim()).filter(Boolean)
        : ['logo'],
      paymentThankYouSubject: branding.paymentThankYouSubject || '',
      paymentThankYouBody: branding.paymentThankYouBody || '',
    });
  }, [branding]);

  const thankYouDefaults = branding?.paymentThankYouDefaults || { subject: '', body: '' };

  function toggleSeoReportField(key: string) {
    setForm((prev) => ({
      ...prev,
      seoReportLetterheadFields: prev.seoReportLetterheadFields.includes(key)
        ? prev.seoReportLetterheadFields.filter((k) => k !== key)
        : [...prev.seoReportLetterheadFields, key],
    }));
  }

  const mutation = useMutation({
    mutationFn: () => api.put('/admin/branding', { ...form, seoReportLetterheadFields: form.seoReportLetterheadFields.join(',') }).then((r) => r.data),
    onSuccess: (data) => { updateBranding(data); qc.invalidateQueries({ queryKey: ['branding'] }); },
  });

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

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">White-Label Branding</h3>
        <p className="text-xs text-gray-500 mt-0.5">Changes reflect across the platform and login page instantly.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Brand Name</label>
          <input value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })}
            placeholder="Mohsin Designs Project Management" className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Primary Color</label>
          <div className="flex gap-2">
            <input type="color" value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="h-[38px] w-12 border border-gray-300 rounded-lg cursor-pointer p-0.5 bg-white" />
            <input value={form.primaryColor}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              placeholder="#0B1D5E" className={`${inp} font-mono`} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Logo</label>
          {!form.logoUrl ? (
            <label className={`${inp} flex items-center gap-2 cursor-pointer ${logoUploading ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="text-gray-400">{logoUploading ? 'Uploading…' : 'Click to upload logo…'}</span>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={logoUploading} />
            </label>
          ) : (
            <div className={`${inp} flex items-center gap-2`}>
              <img src={form.logoUrl} alt="Logo" className="h-5 w-auto rounded shrink-0" onError={(e) => (e.currentTarget.style.display = 'none')} />
              <span className="flex-1 truncate text-gray-600">{form.logoUrl.split('/').pop()}</span>
              <label className="cursor-pointer text-xs text-gray-400 hover:text-brand-700 transition-colors shrink-0">
                Replace
                <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" disabled={logoUploading} />
              </label>
              <button type="button" onClick={() => setForm({ ...form, logoUrl: '' })}
                className="p-0.5 text-gray-400 hover:text-red-500 rounded transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Reply-To Email</label>
          <input value={form.emailFrom} onChange={(e) => setForm({ ...form, emailFrom: e.target.value })}
            placeholder="noreply@yourcompany.com" className={inp} />
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Business Details</h3>
        <p className="text-xs text-gray-500 mt-0.5">Shown to prospects on quotation/agreement review pages. All optional.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Business Address</label>
          <textarea value={form.businessAddress} onChange={(e) => setForm({ ...form, businessAddress: e.target.value })}
            rows={2} placeholder="Office address…" className={`${inp} resize-none`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Phone</label>
          <input value={form.businessPhone} onChange={(e) => setForm({ ...form, businessPhone: e.target.value })}
            placeholder="+92 300 1234567" className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Website</label>
          <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })}
            placeholder="https://yourcompany.com" className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">EIN</label>
          <input value={form.taxNumber} onChange={(e) => setForm({ ...form, taxNumber: e.target.value })}
            placeholder="37-2241622" className={inp} />
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Letterhead</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          The header block printed at the top of every generated document — invoices, quotations,
          agreements, HR letters and SEO reports. It&apos;s drawn as text (not an image), so anything
          you change here updates every document immediately. Leave a field blank to keep the
          default shown in grey.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Registered Legal Name</label>
          <input value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })}
            placeholder={lhDefaults.legalName || 'MOHSIN DESIGNS LLC'} className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">US Office Address</label>
          <textarea value={form.usOfficeAddress} onChange={(e) => setForm({ ...form, usOfficeAddress: e.target.value })}
            rows={3} placeholder={lhDefaults.usOfficeAddress || ''} className={`${inp} resize-none`} />
          <p className="text-[11px] text-gray-400 mt-1">One line per row — each prints on its own line.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Pakistan Office Address</label>
          <textarea value={form.pkOfficeAddress} onChange={(e) => setForm({ ...form, pkOfficeAddress: e.target.value })}
            rows={3} placeholder={lhDefaults.pkOfficeAddress || ''} className={`${inp} resize-none`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">EIN</label>
          <input value={form.einNumber} onChange={(e) => setForm({ ...form, einNumber: e.target.value })}
            placeholder={lhDefaults.einNumber || '37-2241622'} className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Letterhead Email</label>
          <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            placeholder={lhDefaults.contactEmail || 'info@mohsindesigns.com'} className={inp} />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Letterhead Note</label>
          <textarea value={form.letterheadNote} onChange={(e) => setForm({ ...form, letterheadNote: e.target.value })}
            rows={3} placeholder={lhDefaults.letterheadNote || ''} className={`${inp} resize-none`} />
          <p className="text-[11px] text-gray-400 mt-1">Printed in quotes under the address block.</p>
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">SEO Report Letterhead</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Which of the details above print on the Keywords/Backlinks report PDFs (project page → Keywords/Backlinks
          tabs). Only Logo is checked by default.
        </p>
      </div>
      <div className="flex items-center gap-3 flex-wrap text-sm text-gray-600">
        {SEO_REPORT_FIELD_OPTS.map((opt) => (
          <label key={opt.key} className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={form.seoReportLetterheadFields.includes(opt.key)}
              onChange={() => toggleSeoReportField(opt.key)}
              className="w-3.5 h-3.5 rounded accent-brand-700" />
            {opt.label}
          </label>
        ))}
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Invoice Notes &amp; Terms</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Notes appear on invoice PDFs. Terms &amp; Conditions appear on every invoice and quotation / agreement / proposal PDF.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Invoice Note</label>
          <textarea value={form.invoiceNotes} onChange={(e) => setForm({ ...form, invoiceNotes: e.target.value })}
            rows={3} placeholder="e.g. accepted payment methods, bank details, who to contact about billing…" className={`${inp} resize-none`} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Terms &amp; Conditions</label>
          <textarea value={form.invoiceTerms} onChange={(e) => setForm({ ...form, invoiceTerms: e.target.value })}
            rows={4} placeholder="Your invoice terms and conditions…" className={`${inp} resize-none`} />
        </div>
      </div>

      <div className="pt-2 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Payment Thank-You Email</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          Sent automatically to the client whenever an invoice is fully paid — by card via Stripe, or
          marked paid manually. Your logo above is included automatically. Leave blank to use the
          default shown as placeholder text. Available placeholders:{' '}
          <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{{clientName}}'}</code>{' '}
          <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{{brandName}}'}</code>{' '}
          <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{{invoiceNumber}}'}</code>{' '}
          <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{{amount}}'}</code>{' '}
          <code className="text-[11px] bg-gray-100 px-1 py-0.5 rounded">{'{{methodLabel}}'}</code>
        </p>
      </div>
      <div className="grid grid-cols-1 gap-5">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Subject</label>
          <input value={form.paymentThankYouSubject} onChange={(e) => setForm({ ...form, paymentThankYouSubject: e.target.value })}
            placeholder={thankYouDefaults.subject} className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1.5">Body</label>
          <textarea value={form.paymentThankYouBody} onChange={(e) => setForm({ ...form, paymentThankYouBody: e.target.value })}
            rows={6} placeholder={thankYouDefaults.body} className={`${inp} resize-none`} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => mutation.mutate()} disabled={mutation.isPending || logoUploading} className={btnPrimary}>
          <Save className="w-4 h-4" />
          {mutation.isPending ? 'Saving…' : 'Save Branding'}
        </button>
        {mutation.isSuccess && <span className="text-xs text-brand-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Saved</span>}
      </div>
    </div>
  );
}

// ─── Services Tab ─────────────────────────────────────────────────────────────

function ServicesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', key: '', icon: 'briefcase' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', isActive: true });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const inactive = useShowInactive();

  const { data: serviceTypes = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['service-types', inactive.key],
    queryFn: () => api.get('/admin/service-types', { params: inactive.params }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/service-types', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-types'] });
      setShowForm(false);
      setForm({ name: '', key: '', icon: 'briefcase' });
      toast.success('Service type created.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create service type.'),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/service-types/${id}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-types'] });
      setEditId(null);
      toast.success('Service type updated.');
    },
    onError: () => toast.error('Failed to update service type.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next
        ? api.post(`/admin/service-types/${id}/activate`)
        : api.delete(`/admin/service-types/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['service-types'] });
      setDeleteId(null);
      setDeleteError('');
      toast.success(next ? 'Service type set to Active.' : 'Service type set to Inactive.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Could not change status.';
      setDeleteError(msg);
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Service Types</h3>
            <p className="text-xs text-gray-500 mt-0.5">Services your agency offers — used when creating projects.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShowInactiveToggle {...inactive.toggleProps} />
            <button onClick={() => setShowForm(!showForm)} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              Add Service
            </button>
          </div>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-700 mb-3">New Service Type</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, key: slugify(e.target.value) })}
                  placeholder="SEO" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Key (auto)</label>
                <input value={form.key} onChange={(e) => setForm({ ...form, key: slugify(e.target.value) })}
                  placeholder="seo" className={`${inp} font-mono`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Icon name</label>
                <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="search" className={inp} />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !form.name || !form.key} className={btnPrimary}>
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className={btnGhost}><X className="w-4 h-4" /></button>
            </div>
            {createMutation.isError && <p className="text-xs text-red-600 mt-2">Save failed. Key may already exist.</p>}
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {(serviceTypes as any[]).length === 0 && (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No service types yet.</p>
          )}
          {(serviceTypes as any[]).map((svc) => (
            <div key={svc.id} className={cn('px-5 py-3.5', inactiveRow(svc.isActive))}>
              {editId === svc.id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className={`${inp} flex-1 min-w-[160px]`} />
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={editForm.isActive}
                      onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                      className="w-3.5 h-3.5 rounded accent-brand-700" />
                    Active
                  </label>
                  <button onClick={() => updateMutation.mutate(svc.id)} disabled={updateMutation.isPending} className={btnPrimary}>
                    <Save className="w-3.5 h-3.5" />{updateMutation.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditId(null)} className={btnGhost}><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{svc.name}</p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{svc.key}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${svc.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
                      {svc.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <button onClick={() => { setEditId(svc.id); setEditForm({ name: svc.name, isActive: svc.isActive }); }}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <ActiveToggle
                      isActive={!!svc.isActive}
                      label="service type"
                      disabled={toggleActive.isPending}
                      onToggle={(next) => {
                        if (next) { toggleActive.mutate({ id: svc.id, next }); return; }
                        setDeleteId(svc.id); setDeleteError('');
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Set-Inactive confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Set service type to Inactive?</h3>
            <p className="text-sm text-gray-500 mb-4">
              It stops being offered for new projects. Existing projects keep working, and you can set it back to Active here at any time — nothing is deleted.
            </p>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteId(null); setDeleteError(''); }} className={btnGhost}>Cancel</button>
              <button
                onClick={() => toggleActive.mutate({ id: deleteId, next: false })}
                disabled={toggleActive.isPending}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {toggleActive.isPending ? 'Saving…' : 'Set Inactive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Workflows Tab ────────────────────────────────────────────────────────────

type StageRow = {
  key: string; name: string; ownerRoleSlot: string;
  stageType: string; advanceRule: string; isTerminal: boolean; requiresArtifact: boolean;
};

type TransitionRow = { fromStageKey: string; action: string; toStageKey: string; reasonCategory: string };

function WorkflowsTab() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', serviceTypeKey: '', isRecurring: false });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stageEditor, setStageEditor] = useState<StageRow[]>([]);
  const [transEditor, setTransEditor] = useState<TransitionRow[]>([]);
  const [activeSection, setActiveSection] = useState<'stages' | 'transitions'>('stages');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const inactive = useShowInactive();

  const { data: templates = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['templates', inactive.key],
    queryFn: () => api.get('/admin/templates', { params: inactive.params }).then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const { data: roles = [] } = useQuery<{ id: string; key: string; name: string }[]>({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/templates', createForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      setShowCreate(false);
      setCreateForm({ name: '', serviceTypeKey: '', isRecurring: false });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.patch(`/admin/templates/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/admin/templates/${id}/activate`) : api.delete(`/admin/templates/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      setDeleteId(null);
      if (!next) setExpandedId(null);
      toast.success(next ? 'Workflow template set to Active.' : 'Workflow template set to Inactive.');
    },
    onError: (e: any) => { toast.error(e?.response?.data?.message || 'Could not change status.'); setDeleteId(null); },
  });

  const stagesMutation = useMutation({
    mutationFn: ({ id, stages }: any) => api.put(`/admin/templates/${id}/stages`, { stages }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  const transMutation = useMutation({
    mutationFn: ({ id, transitions }: any) => api.put(`/admin/templates/${id}/transitions`, { transitions }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });

  function openEditor(tmpl: any) {
    if (expandedId === tmpl.id) { setExpandedId(null); return; }
    setExpandedId(tmpl.id);
    setStageEditor((tmpl.stages || []).map((s: any) => ({
      key: s.key, name: s.name, ownerRoleSlot: s.ownerRoleSlot || '',
      stageType: s.stageType || 'work', advanceRule: s.advanceRule || 'single_action',
      isTerminal: s.isTerminal || false, requiresArtifact: s.requiresArtifact || false,
    })));
    setTransEditor((tmpl.transitions || []).map((tr: any) => ({
      fromStageKey: tr.fromStageKey, action: tr.action,
      toStageKey: tr.toStageKey, reasonCategory: tr.reasonCategory || '',
    })));
    setActiveSection('stages');
  }

  function addStage() {
    setStageEditor([...stageEditor, { key: '', name: '', ownerRoleSlot: '', stageType: 'work', advanceRule: 'single_action', isTerminal: false, requiresArtifact: false }]);
  }

  function removeStage(i: number) {
    setStageEditor(stageEditor.filter((_, idx) => idx !== i));
  }

  function moveStage(i: number, dir: -1 | 1) {
    const next = [...stageEditor];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    setStageEditor(next);
  }

  function updateStage(i: number, field: keyof StageRow, value: any) {
    const next = [...stageEditor];
    if (field === 'name') {
      const prev = next[i];
      // Keep the key in sync with the name while it's still auto-derived (empty, or still
      // matching the slug of the previous name). Once the user manually edits the key, stop
      // overwriting it so their custom key is preserved.
      const keyIsAuto = !prev.key || prev.key === slugify(prev.name);
      next[i] = { ...prev, name: value, ...(keyIsAuto ? { key: slugify(value) } : {}) };
    } else {
      next[i] = { ...next[i], [field]: value };
    }
    setStageEditor(next);
  }

  function addTransition() {
    setTransEditor([...transEditor, { fromStageKey: '', action: 'complete', toStageKey: '', reasonCategory: '' }]);
  }

  function removeTransition(i: number) {
    setTransEditor(transEditor.filter((_, idx) => idx !== i));
  }

  function updateTrans(i: number, field: keyof TransitionRow, value: string) {
    const next = [...transEditor];
    next[i] = { ...next[i], [field]: value };
    setTransEditor(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <p className="text-xs text-gray-500 min-w-0">Workflow templates define the stages and approvals for each project type.</p>
        <div className="flex items-center gap-2 shrink-0">
          <ShowInactiveToggle {...inactive.toggleProps} />
          <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>
            <Plus className="w-4 h-4" />
            New Workflow
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <p className="text-sm font-semibold text-gray-900">New Workflow Template</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Template Name</label>
              <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="SEO Monthly Retainer" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Service Type</label>
              <select value={createForm.serviceTypeKey} onChange={(e) => setCreateForm({ ...createForm, serviceTypeKey: e.target.value })}
                className={inp}>
                <option value="">Select service type…</option>
                {(serviceTypes as any[]).map((s: any) => (
                  <option key={s.key} value={s.key}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={createForm.isRecurring}
              onChange={(e) => setCreateForm({ ...createForm, isRecurring: e.target.checked })}
              className="w-4 h-4 rounded accent-brand-700" />
            Recurring project (resets monthly)
          </label>
          <div className="flex gap-2">
            <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !createForm.name || !createForm.serviceTypeKey} className={btnPrimary}>
              {createMutation.isPending ? 'Creating…' : 'Create Template'}
            </button>
            <button onClick={() => setShowCreate(false)} className={btnGhost}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {(templates as any[]).length === 0 && !showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-12 text-center text-sm text-gray-400">
          No workflow templates yet. Click "New Workflow" to create one.
        </div>
      )}

      {(templates as any[]).map((tmpl: any) => (
        <div key={tmpl.id} className={cn('bg-white rounded-xl border border-gray-200', inactiveRow(tmpl.isActive))}>
          {/* Template header */}
          <div className="px-4 sm:px-5 py-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <button onClick={() => openEditor(tmpl)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors">
                {expandedId === tmpl.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              <div>
                <p className="text-sm font-semibold text-gray-900">{tmpl.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 font-mono">{tmpl.serviceTypeKey} · v{tmpl.version}{tmpl.isRecurring ? ' · recurring' : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Status is read-only here — activation goes through the admin-gated
                  toggle below so it can't be flipped by a non-admin via PATCH. */}
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${tmpl.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
                {tmpl.isActive ? 'Active' : 'Inactive'}
              </span>
              <button onClick={() => openEditor(tmpl)} className={btnGhost}>
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              <ActiveToggle
                isActive={!!tmpl.isActive}
                label="workflow"
                disabled={toggleActive.isPending}
                onToggle={(next) => {
                  if (next) { toggleActive.mutate({ id: tmpl.id, next }); return; }
                  setDeleteId(tmpl.id);
                }}
              />
            </div>
          </div>

          {/* Stage chips */}
          {expandedId !== tmpl.id && (tmpl.stages || []).length > 0 && (
            <div className="px-5 pb-4 flex items-center gap-1.5 flex-wrap">
              {(tmpl.stages || []).map((s: any, idx: number) => {
                const brokenSlot = s.ownerRoleSlot && !roles.find((r) => r.key === s.ownerRoleSlot);
                return (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span
                      title={brokenSlot ? `Role slot "${s.ownerRoleSlot}" no longer exists` : undefined}
                      className={`px-2.5 py-1 text-xs rounded-full font-medium flex items-center gap-1 ${brokenSlot ? 'bg-red-100 text-red-700 ring-1 ring-red-300' : s.stageType === 'approval' ? 'bg-violet-100 text-violet-700' : 'bg-gray-100 text-gray-700'}`}>
                      {brokenSlot && <span>⚠</span>}
                      {s.name}
                    </span>
                    {idx < tmpl.stages.length - 1 && <span className="text-gray-300 text-xs">→</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Stage / Transition editor */}
          {expandedId === tmpl.id && (
            <div className="border-t border-gray-100 p-5 space-y-4">
              <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
                {(['stages', 'transitions'] as const).map((s) => (
                  <button key={s} onClick={() => setActiveSection(s)}
                    className={`px-4 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${activeSection === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}>
                    {s}
                  </button>
                ))}
              </div>

              {activeSection === 'stages' && (
                <div className="space-y-2">
                  <div className="overflow-x-auto -mx-1 px-1">
                  <div className="min-w-[860px] space-y-2">
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {['Name', 'Key', 'Role Slot', 'Type', 'Advance Rule', 'Flags', ''].map((h) => (
                      <p key={h} className={`text-xs font-semibold text-gray-500 ${h === 'Name' || h === 'Role Slot' || h === 'Advance Rule' ? 'col-span-2' : 'col-span-1'}`}>{h}</p>
                    ))}
                  </div>
                  {stageEditor.map((s, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-lg p-2">
                      <input value={s.name}
                        onChange={(e) => updateStage(i, 'name', e.target.value)}
                        placeholder="Stage name" className={`${inp} col-span-2`} />
                      <input value={s.key}
                        onChange={(e) => updateStage(i, 'key', slugify(e.target.value))}
                        placeholder="key" className={`${inp} col-span-1 font-mono text-xs`} />
                      <select value={s.ownerRoleSlot} onChange={(e) => updateStage(i, 'ownerRoleSlot', e.target.value)}
                        className={`${inp} col-span-2`}>
                        <option value="">No owner</option>
                        {roles.map((r) => (
                          <option key={r.key} value={r.key}>{r.name} ({r.key})</option>
                        ))}
                        {s.ownerRoleSlot && !roles.find((r) => r.key === s.ownerRoleSlot) && (
                          <option value={s.ownerRoleSlot} className="text-red-500">⚠ {s.ownerRoleSlot} (missing role)</option>
                        )}
                      </select>
                      <select value={s.stageType} onChange={(e) => updateStage(i, 'stageType', e.target.value)}
                        className={`${inp} col-span-1`}>
                        {STAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select value={s.advanceRule} onChange={(e) => updateStage(i, 'advanceRule', e.target.value)}
                        className={`${inp} col-span-2`}>
                        {ADVANCE_RULES.map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                      </select>
                      <div className="col-span-2 flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={s.isTerminal}
                            onChange={(e) => updateStage(i, 'isTerminal', e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-brand-700" />
                          Terminal
                        </label>
                        <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={s.requiresArtifact}
                            onChange={(e) => updateStage(i, 'requiresArtifact', e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-brand-700" />
                          Artifact
                        </label>
                      </div>
                      <div className="col-span-1 flex items-center gap-1">
                        <button onClick={() => moveStage(i, -1)} disabled={i === 0}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => moveStage(i, 1)} disabled={i === stageEditor.length - 1}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 rounded">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => removeStage(i)}
                          className="p-1 text-red-400 hover:text-red-600 rounded">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  </div>
                  </div>
                  <button onClick={addStage} className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 font-medium py-1">
                    <Plus className="w-3.5 h-3.5" /> Add Stage
                  </button>
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => stagesMutation.mutate({ id: tmpl.id, stages: stageEditor })}
                      disabled={stagesMutation.isPending} className={btnPrimary}>
                      <Save className="w-4 h-4" />
                      {stagesMutation.isPending ? 'Saving…' : 'Save Stages'}
                    </button>
                    {stagesMutation.isSuccess && <span className="flex items-center gap-1 text-xs text-brand-700"><Check className="w-3.5 h-3.5" /> Saved</span>}
                  </div>
                </div>
              )}

              {activeSection === 'transitions' && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Define what happens when an action is taken on a stage.</p>
                  <div className="overflow-x-auto -mx-1 px-1">
                  <div className="min-w-[720px] space-y-2">
                  <div className="grid grid-cols-12 gap-2 px-1 mb-1">
                    {['From Stage', 'Action', 'To Stage', 'Reason (optional)', ''].map((h) => (
                      <p key={h} className={`text-xs font-semibold text-gray-500 ${h === '' ? 'col-span-1' : 'col-span-3' }`}>{h}</p>
                    ))}
                  </div>
                  {transEditor.map((tr, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center bg-gray-50 rounded-lg p-2">
                      <select value={tr.fromStageKey} onChange={(e) => updateTrans(i, 'fromStageKey', e.target.value)}
                        className={`${inp} col-span-3`}>
                        <option value="">From stage…</option>
                        {stageEditor.map((s) => <option key={s.key} value={s.key}>{s.name || s.key}</option>)}
                      </select>
                      <select value={tr.action} onChange={(e) => updateTrans(i, 'action', e.target.value)}
                        className={`${inp} col-span-3`}>
                        {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                      <select value={tr.toStageKey} onChange={(e) => updateTrans(i, 'toStageKey', e.target.value)}
                        className={`${inp} col-span-3`}>
                        <option value="">To stage…</option>
                        {stageEditor.map((s) => <option key={s.key} value={s.key}>{s.name || s.key}</option>)}
                      </select>
                      <input value={tr.reasonCategory} onChange={(e) => updateTrans(i, 'reasonCategory', e.target.value)}
                        placeholder="optional" className={`${inp} col-span-2 text-xs`} />
                      <button onClick={() => removeTransition(i)} className="col-span-1 p-1 text-red-400 hover:text-red-600 rounded">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  </div>
                  </div>
                  <button onClick={addTransition} className="flex items-center gap-1.5 text-xs text-brand-700 hover:text-brand-800 font-medium py-1">
                    <Plus className="w-3.5 h-3.5" /> Add Transition
                  </button>
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button onClick={() => transMutation.mutate({ id: tmpl.id, transitions: transEditor })}
                      disabled={transMutation.isPending} className={btnPrimary}>
                      <Save className="w-4 h-4" />
                      {transMutation.isPending ? 'Saving…' : 'Save Transitions'}
                    </button>
                    {transMutation.isSuccess && <span className="flex items-center gap-1 text-xs text-brand-700"><Check className="w-3.5 h-3.5" /> Saved</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <ConfirmDialog
        open={!!deleteId}
        title="Set workflow template to Inactive"
        message="It stops being offered for new projects. Projects already running on it keep working, its stages and transitions are kept, and you can set it back to Active here at any time — nothing is deleted."
        confirmLabel="Set Inactive"
        onConfirm={() => deleteId && toggleActive.mutate({ id: deleteId, next: false })}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', key: '', color: '#6366f1' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [permState, setPermState] = useState<Record<string, boolean>>({});
  const [colorForm, setColorForm] = useState<Record<string, string>>({});
  const [nameForm, setNameForm] = useState<Record<string, string>>({});
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);
  const inactive = useShowInactive();

  const { data: roles = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['roles', inactive.key],
    queryFn: () => api.get('/roles', { params: inactive.params }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/roles', { ...createForm, permissions: {} }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setShowCreate(false);
      setCreateForm({ name: '', key: '', color: '#6366f1' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.patch(`/roles/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/roles/${id}/activate`) : api.delete(`/roles/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setDeleteRoleId(null);
      if (!next) setExpandedId(null);
      toast.success(next ? 'Role set to Active.' : 'Role set to Inactive.');
    },
    onError: (e: any) => {
      toast.error(e?.response?.data?.message || 'Could not change status.');
      setDeleteRoleId(null);
    },
  });

  function openRole(role: any) {
    if (expandedId === role.id) { setExpandedId(null); return; }
    setExpandedId(role.id);
    setPermState(role.permissions || {});
    setColorForm((prev) => ({ ...prev, [role.id]: role.color || '#6366f1' }));
    setNameForm((prev) => ({ ...prev, [role.id]: role.name || '' }));
  }

  function togglePerm(key: string) {
    setPermState((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function saveRole(role: any) {
    updateMutation.mutate({
      id: role.id,
      data: { name: nameForm[role.id], color: colorForm[role.id], permissions: permState },
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Roles & Permissions</h3>
            <p className="text-xs text-gray-500 mt-0.5">Admin and Super Admin bypass all permission checks automatically.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShowInactiveToggle {...inactive.toggleProps} />
            <button onClick={() => setShowCreate(!showCreate)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Add Role
            </button>
          </div>
        </div>

        {showCreate && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-semibold text-gray-700 mb-3">New Role</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value, key: slugify(e.target.value) })}
                  placeholder="Content Manager" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Key (auto)</label>
                <input value={createForm.key}
                  onChange={(e) => setCreateForm({ ...createForm, key: slugify(e.target.value) })}
                  placeholder="content_manager" className={`${inp} font-mono`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Color</label>
                <div className="flex gap-2">
                  <input type="color" value={createForm.color}
                    onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })}
                    className="h-[38px] w-12 border border-gray-300 rounded-lg cursor-pointer p-0.5 bg-white" />
                  <input value={createForm.color}
                    onChange={(e) => setCreateForm({ ...createForm, color: e.target.value })}
                    className={`${inp} font-mono`} />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !createForm.name} className={btnPrimary}>
                {createMutation.isPending ? 'Creating…' : 'Create Role'}
              </button>
              <button onClick={() => setShowCreate(false)} className={btnGhost}><X className="w-4 h-4" /></button>
            </div>
            {createMutation.isError && <p className="text-xs text-red-600 mt-2">Create failed. Key may already exist.</p>}
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {(roles as any[]).map((role) => (
            <div key={role.id} className={inactiveRow(role.isActive)}>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5 hover:bg-gray-50 cursor-pointer"
                onClick={() => openRole(role)}>
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: role.color || '#94a3b8' }} />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{role.name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{role.key}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {role.isSystemRole && (
                    <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full">System</span>
                  )}
                  <span className="text-xs text-gray-400">
                    {Object.values(role.permissions || {}).filter(Boolean).length} permissions
                  </span>
                  {expandedId === role.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {expandedId === role.id && (
                <div className="px-5 pb-5 pt-2 border-t border-gray-100 bg-gray-50 space-y-4">
                  {/* Name + color row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Role Name</label>
                      <input value={nameForm[role.id] ?? role.name}
                        onChange={(e) => setNameForm({ ...nameForm, [role.id]: e.target.value })}
                        className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Color</label>
                      <div className="flex gap-2">
                        <input type="color" value={colorForm[role.id] ?? role.color ?? '#6366f1'}
                          onChange={(e) => setColorForm({ ...colorForm, [role.id]: e.target.value })}
                          className="h-[38px] w-12 border border-gray-300 rounded-lg cursor-pointer p-0.5 bg-white" />
                        <input value={colorForm[role.id] ?? role.color ?? '#6366f1'}
                          onChange={(e) => setColorForm({ ...colorForm, [role.id]: e.target.value })}
                          className={`${inp} font-mono`} />
                      </div>
                    </div>
                  </div>

                  {/* Permissions grid */}
                  {!role.isSystemRole || role.key === 'employee' || role.key === 'client' ? (
                    <div>
                      <p className="text-xs font-semibold text-gray-700 mb-2">Permissions</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {ALL_PERMISSIONS.map((p) => (
                          <label key={p.key} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white cursor-pointer transition-colors">
                            <input type="checkbox" checked={!!permState[p.key]}
                              onChange={() => togglePerm(p.key)}
                              className="w-4 h-4 rounded accent-brand-700 shrink-0" />
                            <span className="text-xs text-gray-700">{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 italic">System roles super_admin and admin bypass all permission checks.</p>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
                    <button onClick={() => saveRole(role)} disabled={updateMutation.isPending} className={btnPrimary}>
                      <Save className="w-4 h-4" />
                      {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
                    </button>
                    {updateMutation.isSuccess && <span className="flex items-center gap-1 text-xs text-brand-700"><Check className="w-3.5 h-3.5" /> Saved</span>}
                    {!role.isSystemRole && (
                      <ActiveToggle
                        isActive={role.isActive !== false}
                        label="role"
                        size="text"
                        className="ml-auto"
                        disabled={toggleActive.isPending}
                        onToggle={(next) => {
                          if (next) { toggleActive.mutate({ id: role.id, next }); return; }
                          setDeleteRoleId(role.id);
                        }}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteRoleId}
        title="Set role to Inactive"
        message={`Set the role "${(roles as any[]).find((r: any) => r.id === deleteRoleId)?.name || ''}"? It stops being assignable to new members and you can set it back to Active here at any time — nothing is deleted. Members still on this role must be moved first.`}
        confirmLabel="Set Inactive"
        onConfirm={() => toggleActive.mutate({ id: deleteRoleId!, next: false })}
        onCancel={() => setDeleteRoleId(null)}
      />
    </div>
  );
}

// ─── Packages Tab ─────────────────────────────────────────────────────────────

type SvcRow = { serviceTypeKey: string; workflowTemplateId: string };
type InstallmentRow = { type: 'percent' | 'amount'; value: string; offsetDays: string; label: string };

// Older packages were saved before `type`/`value` existed and only carry
// { percent, offsetDays, label } — read those as percent-type rows.
function normalizeInstallmentRow(p: any): InstallmentRow {
  const type: 'percent' | 'amount' = p.type === 'amount' ? 'amount' : 'percent';
  const rawValue = p.value !== undefined && p.value !== null && p.value !== ''
    ? p.value
    : (type === 'amount' ? p.amount : p.percent);
  return { type, value: rawValue != null ? String(rawValue) : '', offsetDays: String(p.offsetDays ?? '0'), label: p.label || '' };
}

function PackagesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const blankPackageForm = {
    name: '', serviceTypeKey: '', tier: '', price: '', currency: 'USD', description: '',
    isRecurring: false, billingCycle: 'monthly', skipProjectCreation: false,
    isSubscription: false, vendor: '',
    installmentPlan: [] as InstallmentRow[],
    features: [] as string[],
  };
  const [form, setForm] = useState(blankPackageForm);
  const [svcRows, setSvcRows] = useState<SvcRow[]>([]);
  // Single open-editor id: details, features and services are one form now.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    name: string; tier: string; price: string; currency: string; description: string; isRecurring: boolean; billingCycle: string;
    skipProjectCreation: boolean; isSubscription: boolean; vendor: string;
    installmentPlan: InstallmentRow[];
    features: string[];
  }>({ name: '', tier: '', price: '', currency: 'USD', description: '', isRecurring: false, billingCycle: 'monthly', skipProjectCreation: false, isSubscription: false, vendor: '', installmentPlan: [], features: [] });
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
      installmentPlan: form.isRecurring ? null : form.installmentPlan
        .filter((p) => p.value)
        .map((p) => ({ type: p.type, value: Number(p.value), offsetDays: Number(p.offsetDays) || 0, label: p.label || undefined })),
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
        installmentPlan: data.isRecurring ? null : data.installmentPlan
          .filter((p) => p.value)
          .map((p) => ({ type: p.type, value: Number(p.value), offsetDays: Number(p.offsetDays) || 0, label: p.label || undefined })),
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
      installmentPlan: Array.isArray(pkg.installmentPlan) && pkg.installmentPlan.length
        ? pkg.installmentPlan.map(normalizeInstallmentRow)
        : [],
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

          {!form.isRecurring && (
            <div className="pt-2 border-t border-gray-200 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-gray-600">Installment plan <span className="text-gray-400 font-normal">(optional — splits a one-time sale into staggered invoices)</span></p>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, installmentPlan: [...form.installmentPlan, { type: 'percent', value: '', offsetDays: '0', label: '' }] })}
                  className="text-xs font-medium text-brand-800 hover:text-brand-900"
                >
                  + Add installment
                </button>
              </div>
              {form.installmentPlan.length > 0 && (
                <div className="grid gap-2 text-[11px] font-medium text-gray-500 px-0.5" style={{ gridTemplateColumns: '1fr 100px 100px 190px 28px' }}>
                  <span>Label</span>
                  <span>Type</span>
                  <span>Value</span>
                  <span>Due (days after sale)</span>
                  <span />
                </div>
              )}
              {form.installmentPlan.map((row, i) => (
                <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 100px 100px 190px 28px' }}>
                  <input value={row.label} placeholder="e.g. Deposit, Milestone 2…"
                    onChange={(e) => setForm({ ...form, installmentPlan: form.installmentPlan.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })}
                    className={inp} />
                  <select value={row.type}
                    onChange={(e) => setForm({ ...form, installmentPlan: form.installmentPlan.map((r, j) => j === i ? { ...r, type: e.target.value as 'percent' | 'amount' } : r) })}
                    className={inp}>
                    <option value="percent">Percentage</option>
                    <option value="amount">Amount</option>
                  </select>
                  <input value={row.value} placeholder={row.type === 'amount' ? 'e.g. 200' : 'e.g. 50'} type="number" min="0"
                    onChange={(e) => setForm({ ...form, installmentPlan: form.installmentPlan.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })}
                    className={inp} />
                  <input value={row.offsetDays} placeholder="e.g. 30" type="number" min="0"
                    onChange={(e) => setForm({ ...form, installmentPlan: form.installmentPlan.map((r, j) => j === i ? { ...r, offsetDays: e.target.value } : r) })}
                    className={inp} />
                  <button type="button" onClick={() => setForm({ ...form, installmentPlan: form.installmentPlan.filter((_, j) => j !== i) })}
                    className="p-1.5 text-gray-400 hover:text-red-500 justify-self-center">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {form.installmentPlan.some((r) => r.type === 'percent') && (
                <p className={cn('text-xs', form.installmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0) === 100 ? 'text-gray-400' : 'text-amber-600')}>
                  Percentage installments total: {form.installmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0)}% (should sum to 100% of the price not already covered by fixed amounts)
                </p>
              )}
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

                {!editForm.isRecurring && (
                  <div className="pt-2 border-t border-gray-200 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-medium text-gray-600">Installment plan <span className="text-gray-400 font-normal">(optional — splits a one-time sale into staggered invoices)</span></p>
                      <button
                        onClick={() => setEditForm({ ...editForm, installmentPlan: [...editForm.installmentPlan, { type: 'percent', value: '', offsetDays: '0', label: '' }] })}
                        className="text-xs font-medium text-brand-800 hover:text-brand-900"
                      >
                        + Add installment
                      </button>
                    </div>
                    {editForm.installmentPlan.length > 0 && (
                      <div className="grid gap-2 text-[11px] font-medium text-gray-500 px-0.5" style={{ gridTemplateColumns: '1fr 100px 100px 190px 28px' }}>
                        <span>Label</span>
                        <span>Type</span>
                        <span>Value</span>
                        <span>Due (days after sale)</span>
                        <span />
                      </div>
                    )}
                    {editForm.installmentPlan.map((row, i) => (
                      <div key={i} className="grid gap-2 items-center" style={{ gridTemplateColumns: '1fr 100px 100px 190px 28px' }}>
                        <input value={row.label} placeholder="e.g. Deposit, Milestone 2…"
                          onChange={(e) => setEditForm({ ...editForm, installmentPlan: editForm.installmentPlan.map((r, j) => j === i ? { ...r, label: e.target.value } : r) })}
                          className={inp} />
                        <select value={row.type}
                          onChange={(e) => setEditForm({ ...editForm, installmentPlan: editForm.installmentPlan.map((r, j) => j === i ? { ...r, type: e.target.value as 'percent' | 'amount' } : r) })}
                          className={inp}>
                          <option value="percent">Percentage</option>
                          <option value="amount">Amount</option>
                        </select>
                        <input value={row.value} placeholder={row.type === 'amount' ? 'e.g. 200' : 'e.g. 50'} type="number" min="0"
                          onChange={(e) => setEditForm({ ...editForm, installmentPlan: editForm.installmentPlan.map((r, j) => j === i ? { ...r, value: e.target.value } : r) })}
                          className={inp} />
                        <input value={row.offsetDays} placeholder="e.g. 30" type="number" min="0"
                          onChange={(e) => setEditForm({ ...editForm, installmentPlan: editForm.installmentPlan.map((r, j) => j === i ? { ...r, offsetDays: e.target.value } : r) })}
                          className={inp} />
                        <button onClick={() => setEditForm({ ...editForm, installmentPlan: editForm.installmentPlan.filter((_, j) => j !== i) })}
                          className="p-1.5 text-gray-400 hover:text-red-500 justify-self-center">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {editForm.installmentPlan.some((r) => r.type === 'percent') && (
                      <p className={cn('text-xs', editForm.installmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0) === 100 ? 'text-gray-400' : 'text-amber-600')}>
                        Percentage installments total: {editForm.installmentPlan.filter((r) => r.type === 'percent').reduce((s, r) => s + (Number(r.value) || 0), 0)}% (should sum to 100% of the price not already covered by fixed amounts)
                      </p>
                    )}
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

// ─── Document Templates Tab (Quotes & Agreements) ────────────────────────────

const DOC_TEMPLATE_TYPES = ['quotation', 'agreement', 'proposal', 'service_fragment'] as const;
const DOC_TEMPLATE_TYPE_LABELS: Record<string, string> = {
  quotation: 'Quotation', agreement: 'Agreement', proposal: 'Proposal', service_fragment: 'Service Fragment',
};

function insertTokenAtCursor(
  textareaId: string,
  value: string,
  token: string,
  onChange: (next: string) => void,
) {
  const el = document.getElementById(textareaId) as HTMLTextAreaElement | null;
  const insertion = `{{${token}}}`;
  if (!el) { onChange(value + insertion); return; }
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  onChange(value.slice(0, start) + insertion + value.slice(end));
  requestAnimationFrame(() => {
    el.focus();
    el.selectionStart = el.selectionEnd = start + insertion.length;
  });
}

// ─── Client Req Boilerplate Tab ───────────────────────────────────────────────

interface ClientReqFieldDraft { label: string; type: string; required: boolean; options: string }
const CLIENT_REQ_BLANK_FIELD: ClientReqFieldDraft = { label: '', type: 'text', required: false, options: '' };

function fieldsToDraft(fields: any[]): ClientReqFieldDraft[] {
  return (fields || []).map((f: any) => ({
    label: f.label, type: f.type, required: !!f.required, options: (f.options || []).join(', '),
  }));
}

function draftToFieldPayload(fields: ClientReqFieldDraft[]) {
  return fields
    .filter((f) => f.label.trim())
    .map((f, i) => ({
      key: f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${i + 1}`,
      label: f.label.trim(),
      type: f.type,
      required: f.required,
      ...(f.type === 'select' || f.type === 'multiselect' ? { options: f.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
    }));
}

/** The question-list editor shared by the "new template" and "edit template"
 *  forms below — same field-row shape as ClientRequestModal's builder on the
 *  project page, so a template edited here looks identical to one built
 *  inline when composing a send. */
function ClientReqFieldsEditor({ fields, onChange }: { fields: ClientReqFieldDraft[]; onChange: (next: ClientReqFieldDraft[]) => void }) {
  function update(i: number, patch: Partial<ClientReqFieldDraft>) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function remove(i: number) {
    onChange(fields.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-gray-600">Questions</label>
        <button type="button" onClick={() => onChange([...fields, { ...CLIENT_REQ_BLANK_FIELD }])}
          className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
          <Plus className="w-3.5 h-3.5" /> Add question
        </button>
      </div>
      {fields.map((f, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2 bg-white">
          <div className="flex items-center gap-2">
            <input value={f.label} onChange={(e) => update(i, { label: e.target.value })}
              placeholder="What should we ask?" className={`${inp} text-sm py-1.5`} />
            <button type="button" onClick={() => remove(i)}
              className="p-1 rounded shrink-0 text-gray-300 hover:text-red-600 hover:bg-red-50">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <select value={f.type} onChange={(e) => update(i, { type: e.target.value })} className={`${inp} text-sm py-1.5 w-auto`}>
              {CLIENT_REQ_FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0 whitespace-nowrap">
              <input type="checkbox" checked={f.required} onChange={(e) => update(i, { required: e.target.checked })} />
              Required
            </label>
          </div>
          {(f.type === 'select' || f.type === 'multiselect') && (
            <input value={f.options} onChange={(e) => update(i, { options: e.target.value })}
              placeholder="Options, comma separated" className={`${inp} text-sm py-1.5`} />
          )}
        </div>
      ))}
      {fields.length === 0 && (
        <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">Add at least one question.</p>
      )}
    </div>
  );
}

interface ClientReqThemeDraft {
  headline: string; description: string; buttonText: string;
  primaryColor: string; backgroundColor: string;
  showLogo: boolean; showName: boolean; showHeadline: boolean;
  borderRadius: BorderRadius;
}
const CLIENT_REQ_BLANK_THEME: ClientReqThemeDraft = {
  headline: '', description: '', buttonText: '', primaryColor: '', backgroundColor: '',
  showLogo: true, showName: true, showHeadline: true, borderRadius: 'rounded',
};

/** Same Appearance builder as ClientRequestModal's (the compose screen) and
 *  LeadFormModal's — a boilerplate's theme is just the starting point a send
 *  pre-fills, so it needs the identical set of controls. */
function ClientReqAppearanceEditor({ theme, onChange }: { theme: ClientReqThemeDraft; onChange: (next: ClientReqThemeDraft) => void }) {
  const [expanded, setExpanded] = useState(Object.entries(theme).some(([k, v]) => (
    k === 'primaryColor' || k === 'backgroundColor' || k === 'headline' || k === 'description' || k === 'buttonText'
  ) && !!v));

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100"
      >
        Appearance
        <span className="ml-auto text-gray-400 font-normal">{expanded ? 'Hide' : 'Customize'}</span>
      </button>
      {expanded && (
        <div className="p-3.5 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Public headline</label>
              <input value={theme.headline} onChange={(e) => onChange({ ...theme, headline: e.target.value })}
                placeholder="Falls back to the send's subject" className={inp} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Button text</label>
              <input value={theme.buttonText} onChange={(e) => onChange({ ...theme, buttonText: e.target.value })}
                placeholder="Submit requirements" className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optional)</label>
            <textarea value={theme.description} onChange={(e) => onChange({ ...theme, description: e.target.value })}
              placeholder="Falls back to the send's message" rows={2} className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorInput label="Accent color" value={theme.primaryColor} onChange={(v) => onChange({ ...theme, primaryColor: v })} fallback="#0B1D5E" />
            <ColorInput label="Background" value={theme.backgroundColor} onChange={(v) => onChange({ ...theme, backgroundColor: v })} fallback="#FFFFFF" />
          </div>
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Corner style</label>
              <select value={theme.borderRadius} onChange={(e) => onChange({ ...theme, borderRadius: e.target.value as BorderRadius })} className={inp}>
                {BORDER_RADIUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 pb-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={theme.showLogo} onChange={(e) => onChange({ ...theme, showLogo: e.target.checked })} />
                Show your logo
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={theme.showName} onChange={(e) => onChange({ ...theme, showName: e.target.checked })} />
                Show your name
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={theme.showHeadline} onChange={(e) => onChange({ ...theme, showHeadline: e.target.checked })} />
                Show headline
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientReqBoilerplateTab() {
  const qc = useQueryClient();
  const inactive = useShowInactive();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const blankForm = {
    name: '', description: '', serviceTypeKey: '', defaultSubject: '', defaultMessage: '', successMessage: '',
    fields: [{ ...CLIENT_REQ_BLANK_FIELD }] as ClientReqFieldDraft[],
    theme: { ...CLIENT_REQ_BLANK_THEME },
  };
  const [form, setForm] = useState(blankForm);
  const [editForm, setEditForm] = useState(blankForm);

  const { data: templates = [] } = useQuery({
    queryKey: ['requirement-form-templates-admin', inactive.key],
    queryFn: () => api.get('/requirement-forms', { params: inactive.params }).then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  function serviceLabel(key: string | null) {
    if (!key) return null;
    return (serviceTypes as any[]).find((s: any) => s.key === key)?.name || key;
  }

  const createMutation = useMutation({
    mutationFn: () => api.post('/requirement-forms', {
      name: form.name,
      description: form.description || null,
      serviceTypeKey: form.serviceTypeKey || null,
      defaultSubject: form.defaultSubject || null,
      defaultMessage: form.defaultMessage || null,
      successMessage: form.successMessage || null,
      fields: draftToFieldPayload(form.fields),
      theme: form.theme,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirement-form-templates-admin'] });
      qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
      setShowForm(false);
      setForm(blankForm);
      toast.success('Client requirement form created.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Failed to create form.'),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => api.put(`/requirement-forms/${id}`, {
      name: editForm.name,
      description: editForm.description || null,
      serviceTypeKey: editForm.serviceTypeKey || null,
      defaultSubject: editForm.defaultSubject || null,
      defaultMessage: editForm.defaultMessage || null,
      successMessage: editForm.successMessage || null,
      fields: draftToFieldPayload(editForm.fields),
      theme: editForm.theme,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requirement-form-templates-admin'] });
      qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
      setEditId(null);
      toast.success('Client requirement form updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Failed to update form.'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next ? api.post(`/requirement-forms/${id}/activate`) : api.delete(`/requirement-forms/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['requirement-form-templates-admin'] });
      qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
      setDeleteId(null);
      setDeleteError('');
      toast.success(next ? 'Set to Active.' : 'Set to Inactive.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Could not change status.';
      setDeleteError(msg);
      toast.error(msg);
    },
  });

  function openEdit(tmpl: any) {
    setEditId(tmpl.id);
    setEditForm({
      name: tmpl.name,
      description: tmpl.description || '',
      serviceTypeKey: tmpl.serviceTypeKey || '',
      defaultSubject: tmpl.defaultSubject || '',
      defaultMessage: tmpl.defaultMessage || '',
      successMessage: tmpl.successMessage || '',
      fields: fieldsToDraft(tmpl.fields),
      theme: { ...CLIENT_REQ_BLANK_THEME, ...(tmpl.theme || {}) },
    });
  }

  const canCreate = form.name.trim() && draftToFieldPayload(form.fields).length > 0;
  const canSave = editForm.name.trim() && draftToFieldPayload(editForm.fields).length > 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Client Req Boilerplate</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Premade requirement forms staff pick from when emailing a client. Mark one as the default for a service and it&apos;s auto-selected when composing a request on a project for that service — staff can still pick a different one for that send.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShowInactiveToggle {...inactive.toggleProps} />
            <button onClick={() => setShowForm(!showForm)} className={btnPrimary}>
              <Plus className="w-4 h-4" /> Add Form
            </button>
          </div>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-700">New Client Requirement Form</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Website Design Intake" className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Default for service (optional)</label>
                <select value={form.serviceTypeKey} onChange={(e) => setForm({ ...form, serviceTypeKey: e.target.value })} className={inp}>
                  <option value="">Not a default — pick manually only</option>
                  {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Description (internal only)</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="When to use this one…" className={inp} />
            </div>
            <ClientReqFieldsEditor fields={form.fields} onChange={(fields) => setForm({ ...form, fields })} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Default email subject</label>
                <input value={form.defaultSubject} onChange={(e) => setForm({ ...form, defaultSubject: e.target.value })} className={inp} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Thank-you message</label>
                <input value={form.successMessage} onChange={(e) => setForm({ ...form, successMessage: e.target.value })}
                  placeholder="Thanks — we'll be in touch." className={inp} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Default email message</label>
              <textarea value={form.defaultMessage} onChange={(e) => setForm({ ...form, defaultMessage: e.target.value })}
                rows={3} className={inp} />
            </div>
            <ClientReqAppearanceEditor theme={form.theme} onChange={(theme) => setForm({ ...form, theme })} />
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !canCreate} className={btnPrimary}>
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => { setShowForm(false); setForm(blankForm); }} className={btnGhost}><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {(templates as any[]).length === 0 && (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No client requirement forms yet.</p>
          )}
          {(templates as any[]).map((tmpl) => (
            <div key={tmpl.id} className={cn('px-5 py-3.5', inactiveRow(tmpl.isActive))}>
              {editId === tmpl.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inp} />
                    <select value={editForm.serviceTypeKey} onChange={(e) => setEditForm({ ...editForm, serviceTypeKey: e.target.value })} className={inp}>
                      <option value="">Not a default — pick manually only</option>
                      {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
                    </select>
                  </div>
                  <input value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    placeholder="Internal note…" className={inp} />
                  <ClientReqFieldsEditor fields={editForm.fields} onChange={(fields) => setEditForm({ ...editForm, fields })} />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <input value={editForm.defaultSubject} onChange={(e) => setEditForm({ ...editForm, defaultSubject: e.target.value })}
                      placeholder="Default subject" className={inp} />
                    <input value={editForm.successMessage} onChange={(e) => setEditForm({ ...editForm, successMessage: e.target.value })}
                      placeholder="Thank-you message" className={inp} />
                  </div>
                  <textarea value={editForm.defaultMessage} onChange={(e) => setEditForm({ ...editForm, defaultMessage: e.target.value })}
                    rows={3} placeholder="Default email message" className={inp} />
                  <ClientReqAppearanceEditor theme={editForm.theme} onChange={(theme) => setEditForm({ ...editForm, theme })} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateMutation.mutate(tmpl.id)} disabled={updateMutation.isPending || !canSave} className={btnPrimary}>
                      <Save className="w-3.5 h-3.5" />{updateMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditId(null)} className={btnGhost}><X className="w-4 h-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">{tmpl.name}</p>
                      {tmpl.serviceTypeKey && (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-brand-50 text-brand-700">
                          Default · {serviceLabel(tmpl.serviceTypeKey)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {(tmpl.fields || []).length} question{(tmpl.fields || []).length === 1 ? '' : 's'} · sent {tmpl.timesSent || 0} time{tmpl.timesSent === 1 ? '' : 's'}
                      {tmpl.description ? ` · ${tmpl.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${tmpl.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
                      {tmpl.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <button onClick={() => openEdit(tmpl)} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <ActiveToggle
                      isActive={!!tmpl.isActive}
                      label="requirement form"
                      disabled={toggleActive.isPending}
                      onToggle={(next) => {
                        if (next) { toggleActive.mutate({ id: tmpl.id, next }); return; }
                        setDeleteId(tmpl.id); setDeleteError('');
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Set this form to Inactive?</h3>
            <p className="text-sm text-gray-500 mb-4">
              It stops being offered when composing a new request. Requests already sent from it keep working — their questions were snapshotted at send time. You can set it back to Active here at any time.
            </p>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteId(null); setDeleteError(''); }} className={btnGhost}>Cancel</button>
              <button
                onClick={() => toggleActive.mutate({ id: deleteId, next: false })}
                disabled={toggleActive.isPending}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {toggleActive.isPending ? 'Saving…' : 'Set Inactive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentTemplatesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'quotation', serviceTypeKey: '', name: '', body: '', defaultTerms: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ type: 'quotation', serviceTypeKey: '', name: '', body: '', defaultTerms: '', isActive: true });
  // Only one of the "new" / "edit" template forms is ever open at once, so a
  // single ref per form is enough for the {{token}} chips to reach whichever
  // RichTextEditor instance is currently mounted.
  const newBodyEditorRef = useRef<RichTextEditorHandle>(null);
  const editBodyEditorRef = useRef<RichTextEditorHandle>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const inactive = useShowInactive();

  const { data: templates = [] } = useQuery({
    // Inactive rows are hidden until "Show inactive" asks for them.
    queryKey: ['document-templates', inactive.key],
    queryFn: () => api.get('/admin/document-templates', { params: inactive.params }).then((r) => r.data),
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ['service-types'],
    queryFn: () => api.get('/admin/service-types').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/document-templates', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] });
      setShowForm(false);
      setForm({ type: 'quotation', serviceTypeKey: '', name: '', body: '', defaultTerms: '' });
      toast.success('Document template created.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to create template.'),
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/document-templates/${id}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['document-templates'] });
      setEditId(null);
      toast.success('Document template updated.');
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to update template.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleActive = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      next
        ? api.post(`/admin/document-templates/${id}/activate`)
        : api.delete(`/admin/document-templates/${id}`),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['document-templates'] });
      setDeleteId(null);
      setDeleteError('');
      toast.success(next ? 'Document template set to Active.' : 'Document template set to Inactive.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'Could not change status.';
      setDeleteError(msg);
      toast.error(msg);
    },
  });

  function openEdit(tmpl: any) {
    setEditId(tmpl.id);
    setEditForm({
      type: tmpl.type, serviceTypeKey: tmpl.serviceTypeKey, name: tmpl.name,
      body: tmpl.body, defaultTerms: tmpl.defaultTerms || '', isActive: tmpl.isActive,
    });
  }

  // Deep link from the New/Edit Document page's "Edit template" link
  // (?tab=templates&edit=<id>) — jumps straight into that template's edit
  // form once the list has loaded, instead of leaving the admin to hunt for
  // it in the list themselves. Only applied once so closing the form (Cancel)
  // doesn't keep reopening it.
  const deepLinkEditId = useSearchParams().get('edit');
  const appliedDeepLinkEdit = useRef(false);
  useEffect(() => {
    if (appliedDeepLinkEdit.current || !deepLinkEditId || !(templates as any[]).length) return;
    const tmpl = (templates as any[]).find((t: any) => t.id === deepLinkEditId);
    if (tmpl) {
      appliedDeepLinkEdit.current = true;
      openEdit(tmpl);
      requestAnimationFrame(() => {
        document.querySelector(`[data-template-row="${tmpl.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  }, [deepLinkEditId, templates]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 sm:px-5 py-4 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <h3 className="text-sm font-semibold text-gray-900">Document Templates</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Reusable formats for quotations, agreements &amp; proposals. Starter examples named &ldquo;Example … (starter)&rdquo; are added automatically — open one to see the correct {'{{token}}'} layout, then edit or duplicate for your real wording. Pick &ldquo;Standard — All services&rdquo; for any service; put {'{{services_block}}'} in the body so each selected service fills in via its Service Fragment.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ShowInactiveToggle {...inactive.toggleProps} />
            <button onClick={() => setShowForm(!showForm)} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              Add Template
            </button>
          </div>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-gray-100 bg-gray-50 space-y-3">
            <p className="text-xs font-semibold text-gray-700">New Document Template</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inp}>
                  {DOC_TEMPLATE_TYPES.map((t) => <option key={t} value={t}>{DOC_TEMPLATE_TYPE_LABELS[t]}</option>)}
                </select>
                {form.type === 'service_fragment' && (
                  <p className="text-[11px] text-gray-400 mt-1">Rendered inside {'{{services_block}}'} — one block per selected service.</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Service</label>
                <select value={form.serviceTypeKey} onChange={(e) => setForm({ ...form, serviceTypeKey: e.target.value })} className={inp}>
                  <option value="">Select service…</option>
                  <option value="standard">Standard — All services</option>
                  {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="SEO Quotation — Standard" className={inp} />
              </div>
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-600">Body</label>
                <span className="text-[11px] text-gray-400">Click a token to insert it</span>
              </div>
              <div className="flex flex-wrap gap-1 mb-1.5">
                {MERGE_TOKENS.map((t) => (
                  <button key={t} type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => (form.type === 'service_fragment'
                      ? insertTokenAtCursor('new-template-body', form.body, t, (v) => setForm({ ...form, body: v }))
                      : newBodyEditorRef.current?.insertText(`{{${t}}}`))}
                    className="px-1.5 py-0.5 text-[11px] font-mono bg-white border border-gray-200 rounded text-gray-600 hover:border-brand-500 hover:text-brand-800 transition-colors">
                    {`{{${t}}}`}
                  </button>
                ))}
              </div>
              {form.type === 'service_fragment' ? (
                <textarea id="new-template-body" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={8} placeholder="▸ {{service}}{{package}}&#10;  Investment: {{currency}} {{price}}"
                  className={`${inp} font-mono text-xs`} />
              ) : (
                <RichTextEditor ref={newBodyEditorRef} value={form.body} onChange={(html) => setForm({ ...form, body: html })}
                  placeholder="Dear {{customer_name}}, thank you for considering {{agency_name}} for {{service}}…" minHeight="min-h-48" />
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Default Terms (optional)</label>
              {form.type === 'service_fragment' ? (
                <textarea value={form.defaultTerms} onChange={(e) => setForm({ ...form, defaultTerms: e.target.value })}
                  rows={3} placeholder="50% upfront, 50% on delivery…" className={inp} />
              ) : (
                <RichTextEditor value={form.defaultTerms} onChange={(html) => setForm({ ...form, defaultTerms: html })}
                  placeholder="50% upfront, 50% on delivery…" minHeight="min-h-16" />
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !form.name || !form.serviceTypeKey || !form.body}
                className={btnPrimary}>
                {createMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className={btnGhost}><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        <div className="divide-y divide-gray-100">
          {(templates as any[]).length === 0 && (
            <p className="px-5 py-8 text-sm text-gray-400 text-center">No document templates yet.</p>
          )}
          {(templates as any[]).map((tmpl) => (
            <div key={tmpl.id} data-template-row={tmpl.id} className={cn('px-5 py-3.5', inactiveRow(tmpl.isActive))}>
              {editId === tmpl.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <select value={editForm.type} onChange={(e) => setEditForm({ ...editForm, type: e.target.value })} className={inp}>
                      {DOC_TEMPLATE_TYPES.map((t) => <option key={t} value={t}>{DOC_TEMPLATE_TYPE_LABELS[t]}</option>)}
                    </select>
                    <select value={editForm.serviceTypeKey} onChange={(e) => setEditForm({ ...editForm, serviceTypeKey: e.target.value })} className={inp}>
                      <option value="standard">Standard — All services</option>
                      {(serviceTypes as any[]).map((s: any) => <option key={s.key} value={s.key}>{s.name}</option>)}
                    </select>
                    <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className={inp} />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {MERGE_TOKENS.map((t) => (
                      <button key={t} type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => (editForm.type === 'service_fragment'
                          ? insertTokenAtCursor(`edit-template-body-${tmpl.id}`, editForm.body, t, (v) => setEditForm({ ...editForm, body: v }))
                          : editBodyEditorRef.current?.insertText(`{{${t}}}`))}
                        className="px-1.5 py-0.5 text-[11px] font-mono bg-gray-50 border border-gray-200 rounded text-gray-600 hover:border-brand-500 hover:text-brand-800 transition-colors">
                        {`{{${t}}}`}
                      </button>
                    ))}
                  </div>
                  {editForm.type === 'service_fragment' ? (
                    <textarea id={`edit-template-body-${tmpl.id}`} value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                      rows={8} className={`${inp} font-mono text-xs`} />
                  ) : (
                    <RichTextEditor ref={editBodyEditorRef} value={editForm.body} onChange={(html) => setEditForm({ ...editForm, body: html })}
                      minHeight="min-h-48" />
                  )}
                  {editForm.type === 'service_fragment' ? (
                    <textarea value={editForm.defaultTerms} onChange={(e) => setEditForm({ ...editForm, defaultTerms: e.target.value })}
                      rows={3} placeholder="Default terms…" className={inp} />
                  ) : (
                    <RichTextEditor value={editForm.defaultTerms} onChange={(html) => setEditForm({ ...editForm, defaultTerms: html })}
                      placeholder="Default terms…" minHeight="min-h-16" />
                  )}
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input type="checkbox" checked={editForm.isActive}
                        onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                        className="w-3.5 h-3.5 rounded accent-brand-700" />
                      Active
                    </label>
                    <button onClick={() => updateMutation.mutate(tmpl.id)} disabled={updateMutation.isPending} className={btnPrimary}>
                      <Save className="w-3.5 h-3.5" />{updateMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditId(null)} className={btnGhost}><X className="w-4 h-4" /></button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{tmpl.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {DOC_TEMPLATE_TYPE_LABELS[tmpl.type] || titleCase(tmpl.type)} · {tmpl.serviceTypeKey === 'standard' ? 'All services' : ((serviceTypes as any[]).find((s: any) => s.key === tmpl.serviceTypeKey)?.name || tmpl.serviceTypeKey)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`px-2.5 py-0.5 text-xs font-medium rounded-full ${tmpl.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
                      {tmpl.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <button onClick={() => openEdit(tmpl)}
                      className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <ActiveToggle
                      isActive={!!tmpl.isActive}
                      label="template"
                      disabled={toggleActive.isPending}
                      onToggle={(next) => {
                        if (next) { toggleActive.mutate({ id: tmpl.id, next }); return; }
                        setDeleteId(tmpl.id); setDeleteError('');
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Set document template to Inactive?</h3>
            <p className="text-sm text-gray-500 mb-4">
              It stops being offered for new quotations and agreements. Documents already built from it are unaffected, and you can set it back to Active here at any time — nothing is deleted.
            </p>
            {deleteError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">{deleteError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setDeleteId(null); setDeleteError(''); }} className={btnGhost}>Cancel</button>
              <button
                onClick={() => toggleActive.mutate({ id: deleteId, next: false })}
                disabled={toggleActive.isPending}
                className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {toggleActive.isPending ? 'Saving…' : 'Set Inactive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'branding',   label: 'Branding',   icon: Palette  },
  { key: 'companies',  label: 'Companies',  icon: Building2 },
  { key: 'payments',   label: 'Payments',   icon: CreditCard },
  { key: 'services',   label: 'Services',   icon: Settings },
  { key: 'workflows',  label: 'Workflows',  icon: Workflow },
  { key: 'roles',      label: 'Roles',      icon: Shield   },
  { key: 'packages',   label: 'Packages',   icon: Package  },
  { key: 'templates',  label: 'Document Templates', icon: ScrollText },
  { key: 'client-req-forms', label: 'Client Req Boilerplate', icon: ClipboardCheck },
  { key: 'export',     label: 'Export Data', icon: Download },
] as const;

const VALID_TABS = ['branding', 'companies', 'payments', 'services', 'workflows', 'roles', 'packages', 'templates', 'client-req-forms', 'export'] as const;

export default function AdminPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = rawTab && (VALID_TABS as readonly string[]).includes(rawTab) ? rawTab : 'branding';

  function setTab(key: Tab) {
    router.replace(`/admin?tab=${key}`, { scroll: false });
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Admin Panel" />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="space-y-6">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors shrink-0 whitespace-nowrap',
                  tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                )}
              >
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'branding'  && <BrandingTab />}
          {tab === 'companies' && <CompaniesTab />}
          {tab === 'payments'  && <PaymentMethodsTab />}
          {tab === 'services'  && <ServicesTab />}
          {tab === 'workflows' && <WorkflowsTab />}
          {tab === 'roles'     && <RolesTab />}
          {tab === 'packages'  && <PackagesTab />}
          {tab === 'templates' && <DocumentTemplatesTab />}
          {tab === 'client-req-forms' && <ClientReqBoilerplateTab />}
          {tab === 'export'    && <ExportDataTab />}
        </div>
      </div>
    </div>
  );
}
