'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, GripVertical, Palette, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { invalidateMany, afterLeadFormChange } from '@/lib/queryInvalidation';
import { useAuthStore } from '@/store/auth';
import LeadFormRenderer, { type FieldType, type FormField } from '@/components/leads/LeadFormRenderer';
import { DEFAULT_THEME, BORDER_RADIUS_OPTIONS, type BorderRadius, type LeadFormTheme } from '@/lib/leadFormTheme';

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'select', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' },
];

interface FieldDraft {
  label: string;
  type: FieldType;
  required: boolean;
  options: string; // comma-separated, only used for `select`
  hidden: boolean; // kept in the form definition but not shown on the public form
}

const BLANK_FIELD: FieldDraft = { label: '', type: 'text', required: false, options: '', hidden: false };

function ColorInput({ label, value, onChange, fallback }: { label: string; value: string; onChange: (v: string) => void; fallback: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border border-gray-300 cursor-pointer shrink-0 p-0.5"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Reset to default"
            className="text-[11px] text-gray-400 hover:text-gray-700 shrink-0"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

export default function LeadFormModal({
  form, // existing LeadForm to edit, or null to create
  onClose,
}: {
  form?: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const orgBranding = useAuthStore((s) => s.branding);
  const isEdit = !!form;
  const [name, setName] = useState(form?.name || '');
  const [projectId, setProjectId] = useState(form?.projectId || '');
  const [campaign, setCampaign] = useState(form?.campaign || '');
  const [successMessage, setSuccessMessage] = useState(form?.successMessage || '');
  const [fields, setFields] = useState<FieldDraft[]>(
    form?.fields?.length
      ? form.fields.map((f: any) => ({ label: f.label, type: f.type, required: !!f.required, options: (f.options || []).join(', '), hidden: !!f.hidden }))
      : [{ ...BLANK_FIELD, label: 'Full Name' }, { ...BLANK_FIELD, label: 'Email', type: 'email' as FieldType, required: true }]
  );

  // Appearance — every field starts blank ("no override") unless the form was
  // already customized; blank means "fall back to org branding / a sensible
  // default", exactly like LeadFormService#effectiveTheme does server-side.
  const savedTheme: Partial<LeadFormTheme> = form?.theme || {};
  const [showAppearance, setShowAppearance] = useState(Object.keys(savedTheme).length > 0);
  const [headline, setHeadline] = useState(savedTheme.headline || '');
  const [description, setDescription] = useState(savedTheme.description || '');
  const [buttonText, setButtonText] = useState(savedTheme.buttonText || '');
  const [primaryColor, setPrimaryColor] = useState(savedTheme.primaryColor || '');
  const [backgroundColor, setBackgroundColor] = useState(savedTheme.backgroundColor || '');
  // Falls back to the old combined `showBranding` field for forms saved before
  // logo/name were split into independent toggles.
  const legacyShowBranding = (savedTheme as any).showBranding;
  const [showLogo, setShowLogo] = useState(savedTheme.showLogo !== undefined ? savedTheme.showLogo : legacyShowBranding !== undefined ? legacyShowBranding : true);
  const [showName, setShowName] = useState(savedTheme.showName !== undefined ? savedTheme.showName : legacyShowBranding !== undefined ? legacyShowBranding : true);
  // No legacy fallback needed — this toggle didn't exist before, so every
  // saved form defaults to "on" (matching how it always rendered until now).
  const [showHeadline, setShowHeadline] = useState(savedTheme.showHeadline !== undefined ? savedTheme.showHeadline : true);
  const [borderRadius, setBorderRadius] = useState<BorderRadius>(savedTheme.borderRadius || 'rounded');

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-all'],
    queryFn: () => api.get('/projects', { params: { limit: 200 } }).then((r) => r.data?.data || []),
  });

  function updateField(i: number, patch: Partial<FieldDraft>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields((fs) => fs.filter((_, idx) => idx !== i));
  }
  function addField() {
    setFields((fs) => [...fs, { ...BLANK_FIELD }]);
  }
  function toggleHidden(i: number) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, hidden: !f.hidden } : f)));
  }

  function toPayloadFields(): FormField[] {
    return fields
      .filter((f) => f.label.trim())
      .map((f, i) => ({
        key: f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${i + 1}`,
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        hidden: f.hidden,
        ...(f.type === 'select' ? { options: f.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
      }));
  }

  const themePayload = { headline, description, buttonText, primaryColor, backgroundColor, showLogo, showName, showHeadline, borderRadius };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        projectId: projectId || null,
        campaign: campaign.trim() || null,
        successMessage: successMessage.trim() || undefined,
        fields: toPayloadFields(),
        theme: themePayload,
      };
      return isEdit
        ? api.patch(`/lead-forms/${form.id}`, payload).then((r) => r.data)
        : api.post('/lead-forms', payload).then((r) => r.data);
    },
    onSuccess: async () => {
      await invalidateMany(qc, afterLeadFormChange(form?.id));
      toast.success(isEdit ? 'Form updated.' : 'Form created.');
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save form.'),
  });

  const canSave = name.trim().length > 0 && toPayloadFields().length > 0;

  // Same fallback chain as the backend's effectiveTheme — what the preview
  // renders is what a real visitor would get if saved right now.
  const previewTheme: LeadFormTheme = {
    headline: headline.trim() || name.trim() || 'Untitled form',
    description,
    buttonText: buttonText.trim() || DEFAULT_THEME.buttonText,
    primaryColor: primaryColor || orgBranding?.primaryColor || DEFAULT_THEME.primaryColor,
    backgroundColor: backgroundColor || DEFAULT_THEME.backgroundColor,
    showLogo,
    showName,
    showHeadline,
    borderRadius,
  };
  const previewBranding = { brandName: orgBranding?.brandName || 'Your Brand', logoUrl: orgBranding?.logoUrl || null };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-semibold text-gray-900">{isEdit ? 'Edit form' : 'New lead form'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* ── Builder ── */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4 lg:max-w-md">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Form name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Website Contact Form"
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <p className="text-[11px] text-gray-400 mt-1">Internal label — shown in your Leads list, not to visitors (set the public headline under Appearance).</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Project (optional)</label>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="">Unscoped</option>
                  {(projects as any[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Campaign (optional)</label>
                <input
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  placeholder="spring-launch"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
            </div>

            {/* Field builder */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-gray-700">Fields</label>
                <button onClick={addField} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                  <Plus className="w-3.5 h-3.5" /> Add field
                </button>
              </div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={i} className={`border border-gray-200 rounded-lg p-2.5 space-y-2 ${f.hidden ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <input
                        value={f.label}
                        onChange={(e) => updateField(i, { label: e.target.value })}
                        placeholder="Field label"
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                      <select
                        value={f.type}
                        onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                        className="text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
                      >
                        {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-gray-500 shrink-0 whitespace-nowrap">
                        <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                        Required
                      </label>
                      <button
                        onClick={() => toggleHidden(i)}
                        title={f.hidden ? 'Hidden from the public form — click to show' : 'Hide this field from the public form'}
                        className={`p-1 rounded shrink-0 ${f.hidden ? 'text-amber-500 hover:text-amber-600 hover:bg-amber-50' : 'text-gray-300 hover:text-gray-700 hover:bg-gray-100'}`}
                      >
                        {f.hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => removeField(i)} className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {f.hidden && <p className="text-[11px] text-amber-600 pl-5">Hidden — won&apos;t appear on the public form.</p>}
                    {f.type === 'select' && (
                      <input
                        value={f.options}
                        onChange={(e) => updateField(i, { options: e.target.value })}
                        placeholder="Options, comma-separated (e.g. <$5k, $5k-$20k, $20k+)"
                        className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    )}
                  </div>
                ))}
                {fields.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No fields yet — add at least one.</p>}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Success message</label>
              <textarea
                value={successMessage}
                onChange={(e) => setSuccessMessage(e.target.value)}
                placeholder="Thanks — we'll be in touch shortly."
                rows={2}
                className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>

            {/* Appearance */}
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAppearance((v) => !v)}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-gray-700 bg-gray-50 hover:bg-gray-100"
              >
                <Palette className="w-3.5 h-3.5 text-gray-400" /> Appearance
                <span className="ml-auto text-gray-400 font-normal">{showAppearance ? 'Hide' : 'Customize'}</span>
              </button>
              {showAppearance && (
                <div className="p-3.5 space-y-3.5">
                  <div className={showHeadline ? undefined : 'opacity-50'}>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-medium text-gray-700">Public headline</label>
                      <button
                        type="button"
                        onClick={() => setShowHeadline((v) => !v)}
                        title={showHeadline ? 'Hide the headline on the public form' : 'Hidden from the public form — click to show'}
                        className={`p-1 rounded shrink-0 ${showHeadline ? 'text-gray-300 hover:text-gray-700 hover:bg-gray-100' : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'}`}
                      >
                        {showHeadline ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <input
                      value={headline}
                      onChange={(e) => setHeadline(e.target.value)}
                      placeholder={name || 'What visitors see at the top of the form'}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    {/* Falls back to Form name when left blank (see effectiveTheme
                        server-side) — worth surfacing here, since that's exactly
                        the confusion this toggle exists to let people opt out of. */}
                    {!headline.trim() && (
                      <p className="text-[11px] text-gray-400 mt-1">Blank uses your Form name (&quot;{name.trim() || 'Untitled form'}&quot;) as the headline.</p>
                    )}
                    {!showHeadline && <p className="text-[11px] text-amber-600 mt-1">Hidden — won&apos;t appear on the public form.</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Description (optional)</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="A short line under the headline."
                      rows={2}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Button text</label>
                    <input
                      value={buttonText}
                      onChange={(e) => setButtonText(e.target.value)}
                      placeholder={DEFAULT_THEME.buttonText}
                      className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ColorInput label="Accent color" value={primaryColor} onChange={setPrimaryColor} fallback={orgBranding?.primaryColor || DEFAULT_THEME.primaryColor} />
                    <ColorInput label="Background" value={backgroundColor} onChange={setBackgroundColor} fallback={DEFAULT_THEME.backgroundColor} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 items-end">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Corner style</label>
                      <select
                        value={borderRadius}
                        onChange={(e) => setBorderRadius(e.target.value as BorderRadius)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      >
                        {BORDER_RADIUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5 pb-2">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={showLogo} onChange={(e) => setShowLogo(e.target.checked)} />
                        Show your logo
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
                        Show your name
                      </label>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => save.mutate()}
                disabled={!canSave || save.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create form'}
              </button>
              <button onClick={onClose} className="text-gray-600 hover:text-gray-900 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            </div>
          </div>

          {/* ── Live preview ── */}
          <div className="hidden lg:block flex-1 min-w-0 bg-gray-100 overflow-y-auto p-6">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Live preview</p>
            <div className="rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <LeadFormRenderer
                mode="preview"
                theme={previewTheme}
                branding={previewBranding}
                fields={toPayloadFields().filter((f) => !f.hidden)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
