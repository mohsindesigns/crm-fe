'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Upload, X, Check } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { uploadErrorMessage } from '@/lib/utils';
import { toast } from 'sonner';
import { inp, btnPrimary, SEO_REPORT_FIELD_OPTS } from '@/components/admin/adminShared';

// ─── Branding Tab ─────────────────────────────────────────────────────────────

export default function BrandingTab() {
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
