'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Plus, Trash2, GripVertical, Mail, Save, Palette, Eye, EyeOff,
  ArrowLeft, ArrowRight, ShieldCheck, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import LeadFormRenderer, { type FieldType, type FormField } from '@/components/leads/LeadFormRenderer';
import { DEFAULT_THEME, BORDER_RADIUS_OPTIONS, type BorderRadius, type LeadFormTheme } from '@/lib/leadFormTheme';
import ColorInput from '@/components/ColorInput';

// Compose a requirements form and submit it for approval — a three-step wizard,
// in the order staff actually think about it:
//
//   1. Questions — pick them from a saved template or write them, and style the
//      page the client will land on.
//   2. Email     — who gets it, and the words they'll actually read. Both the
//      subject and the message are required here: a request goes to an admin
//      for approval, and an approver reviewing a blank message has nothing to
//      approve. crm-be ClientRequestService#send rejects an empty one too.
//   3. Review    — one last look at what's about to go out, then submit.
//
// The right pane follows the step: on the Email step it previews the email, on
// the others it's the real LeadFormRenderer in preview mode, so what the sender
// sees is exactly the page the client will open — no approximation.
//
// Submitting does NOT email the client unless the sender is an admin (crm-be
// auto-approves those). For everyone else the row lands at `pending_approval`
// and an admin releases it from ClientRequestsTab.

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
  options: string;
}

const BLANK_FIELD: FieldDraft = { label: '', type: 'text', required: false, options: '' };

// Sensible opening questions for an agency asking a client what they want —
// only used when composing without a template, and fully editable.
const STARTER_FIELDS: FieldDraft[] = [
  { label: 'What are the main goals for this project?', type: 'textarea', required: true, options: '' },
  { label: 'Who is your target audience?', type: 'textarea', required: false, options: '' },
  { label: 'Any reference websites or examples you like?', type: 'textarea', required: false, options: '' },
  { label: 'Best contact number', type: 'phone', required: false, options: '' },
];

// Default wording for the email body and the post-submit thank-you — both
// boxes start filled in rather than empty, since Message is required and a
// blank required field is a worse default than "here's a draft, edit it".
// A template's own defaultMessage/successMessage still wins when one is picked.
const STARTER_MESSAGE = 'Hi — we need a few details from you. The form below covers everything and should only take a couple of minutes to fill in.';
const STARTER_SUCCESS_MESSAGE = 'Thanks — we\'ve received your details. Our team will review them and be in touch shortly.';

const STEPS = [
  { n: 1, label: 'Questions' },
  { n: 2, label: 'Email' },
  { n: 3, label: 'Review' },
] as const;

interface Contact { id: string; name: string; email: string; role?: string }
interface Template {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  defaultSubject: string | null;
  defaultMessage: string | null;
  successMessage: string | null;
  serviceTypeKey: string | null;
  theme: Partial<LeadFormTheme> | null;
}

/** A rough render of the email body, so the sender can see their message the
 *  way the client will rather than as a bare textarea. Intentionally a sketch —
 *  the real HTML is EmailService#sendClientRequestForm's, which this only has
 *  to be recognisable as. */
function EmailPreview({
  brandName, brandLogoUrl, recipientLabel, recipientName, subject, message, projectName, dueAt, fieldCount, accent,
}: {
  brandName: string;
  brandLogoUrl: string | null;
  recipientLabel: string;
  recipientName: string;
  subject: string;
  message: string;
  projectName: string;
  dueAt: string;
  fieldCount: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-1">
        <p className="text-[11px] text-gray-400">
          To <span className="text-gray-700 font-medium">{recipientLabel || 'nobody yet'}</span>
        </p>
        <p className="text-sm font-semibold text-gray-900 break-words">
          {subject || <span className="text-gray-300 font-normal">No subject yet</span>}
        </p>
      </div>
      <div className="p-5">
        {brandLogoUrl
          ? <img src={brandLogoUrl} alt={brandName} className="h-7 mb-4 object-contain" />
          : <p className="text-sm font-bold text-gray-900 mb-4">{brandName}</p>}
        <p className="text-sm text-gray-700 mb-3">Hi <strong>{recipientName || 'there'}</strong>,</p>
        <p className="text-sm text-gray-700 leading-relaxed">
          For <strong>{projectName}</strong>, we need a few details from you.
          {fieldCount > 0 && ` The form below has ${fieldCount} question${fieldCount === 1 ? '' : 's'} and takes just a couple of minutes.`}
        </p>
        {message.trim() ? (
          <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap break-words">{message}</p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-xs text-amber-700">Your message goes here — write it on the left. It&apos;s required.</p>
          </div>
        )}
        {dueAt && (
          <p className="text-sm text-gray-700 mt-4">
            Please complete it by <strong>{new Date(`${dueAt}T00:00:00`).toLocaleDateString()}</strong> so we can keep the project moving.
          </p>
        )}
        <span
          className="inline-block mt-5 px-5 py-2.5 rounded-lg text-sm font-bold text-white"
          style={{ background: accent }}
        >
          Fill in the form
        </span>
        <p className="text-[11px] text-gray-400 mt-5 leading-relaxed">
          No account or password needed — just click the button.
        </p>
      </div>
    </div>
  );
}

export default function ClientRequestModal({
  projectId,
  projectName,
  brandName,
  brandLogoUrl,
  brandColor,
  serviceTypeKey,
  onClose,
}: {
  projectId: string;
  projectName: string;
  brandName: string;
  brandLogoUrl: string | null;
  brandColor: string;
  serviceTypeKey?: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // Mirrors the backend's auto-approve shortcut (ClientRequestService#send):
  // only changes the wording here, never who is actually allowed to do what.
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [templateId, setTemplateId] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>(STARTER_FIELDS);
  const [contactId, setContactId] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [subject, setSubject] = useState(`Project requirements — ${projectName}`);
  const [message, setMessage] = useState(STARTER_MESSAGE);
  const [dueAt, setDueAt] = useState('');
  const [successMessage, setSuccessMessage] = useState(STARTER_SUCCESS_MESSAGE);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Appearance — same builder as LeadFormModal's, same "blank = no override,
  // fall back to org branding / a sensible default" rule as
  // RequirementFormService#effectiveTheme.
  const [showAppearance, setShowAppearance] = useState(false);
  const [themeHeadline, setThemeHeadline] = useState('');
  const [themeDescription, setThemeDescription] = useState('');
  const [themeButtonText, setThemeButtonText] = useState('');
  const [themePrimaryColor, setThemePrimaryColor] = useState('');
  const [themeBackgroundColor, setThemeBackgroundColor] = useState('');
  const [themeShowLogo, setThemeShowLogo] = useState(true);
  const [themeShowName, setThemeShowName] = useState(true);
  const [themeShowHeadline, setThemeShowHeadline] = useState(true);
  const [themeBorderRadius, setThemeBorderRadius] = useState<BorderRadius>('rounded');

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['requirement-form-templates'],
    queryFn: () => api.get('/requirement-forms').then((r) => r.data),
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ['client-request-recipients', projectId],
    queryFn: () => api.get(`/projects/${projectId}/client-requests/recipients`).then((r) => r.data),
  });

  // Auto-select the project's service's default boilerplate the first time
  // templates load, so the common case is "open modal, questions already
  // there". Only fires once (templateId is still unset) — never overrides a
  // choice the sender already made, e.g. by re-firing after a refetch.
  useEffect(() => {
    if (templateId || !serviceTypeKey || templates.length === 0) return;
    const defaultTemplate = templates.find((t) => t.serviceTypeKey === serviceTypeKey);
    if (defaultTemplate) applyTemplate(defaultTemplate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, serviceTypeKey]);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setFields((t.fields || []).map((f) => ({
      label: f.label,
      type: f.type,
      required: f.required,
      options: (f.options || []).join(', '),
    })));
    if (t.defaultSubject) setSubject(t.defaultSubject);
    if (t.defaultMessage) setMessage(t.defaultMessage);
    if (t.successMessage) setSuccessMessage(t.successMessage);

    const theme = t.theme || {};
    setThemeHeadline(theme.headline || '');
    setThemeDescription(theme.description || '');
    setThemeButtonText(theme.buttonText || '');
    setThemePrimaryColor(theme.primaryColor || '');
    setThemeBackgroundColor(theme.backgroundColor || '');
    setThemeShowLogo(theme.showLogo !== undefined ? theme.showLogo : true);
    setThemeShowName(theme.showName !== undefined ? theme.showName : true);
    setThemeShowHeadline(theme.showHeadline !== undefined ? theme.showHeadline : true);
    setThemeBorderRadius(theme.borderRadius || 'rounded');
    if (Object.keys(theme).length > 0) setShowAppearance(true);
  }

  function updateField(i: number, patch: Partial<FieldDraft>) {
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }
  function removeField(i: number) {
    setFields((fs) => fs.filter((_, idx) => idx !== i));
  }
  function addField() {
    setFields((fs) => [...fs, { ...BLANK_FIELD }]);
  }

  /** Mirrors crm-be utils/formFields#normalizeFields' key derivation so the
   *  preview keys match what the server will store answers under. */
  const payloadFields = useMemo<FormField[]>(() => (
    fields
      .filter((f) => f.label.trim())
      .map((f, i) => ({
        key: f.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `field_${i + 1}`,
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        ...(f.type === 'select' ? { options: f.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
      }))
  ), [fields]);

  // Same fallback chain as the backend's effectiveTheme (RequirementFormService)
  // — the preview renders exactly what the client would see if sent right now.
  const themePayload = {
    headline: themeHeadline,
    description: themeDescription,
    buttonText: themeButtonText,
    primaryColor: themePrimaryColor,
    backgroundColor: themeBackgroundColor,
    showLogo: themeShowLogo,
    showName: themeShowName,
    showHeadline: themeShowHeadline,
    borderRadius: themeBorderRadius,
  };
  const previewTheme: LeadFormTheme = {
    headline: themeHeadline.trim() || subject.trim() || `Project requirements — ${projectName}`,
    description: themeDescription || message,
    buttonText: themeButtonText.trim() || 'Submit requirements',
    primaryColor: themePrimaryColor || brandColor || DEFAULT_THEME.primaryColor,
    backgroundColor: themeBackgroundColor || DEFAULT_THEME.backgroundColor,
    showLogo: themeShowLogo,
    showName: themeShowName,
    showHeadline: themeShowHeadline,
    borderRadius: themeBorderRadius,
  };

  const selectedContact = contactId ? contacts.find((c) => c.id === contactId) : undefined;
  const recipientEmail = selectedContact ? selectedContact.email || '' : manualEmail.trim();

  // What each step needs before it will let you move on. Step 2's rules are the
  // frontend half of the backend's — subject and message are both mandatory.
  const step1Done = payloadFields.length > 0;
  const step2Done = !!recipientEmail && !!subject.trim() && !!message.trim();
  const canAdvance = step === 1 ? step1Done : step === 2 ? step2Done : true;
  const canSubmit = step1Done && step2Done;

  const sendMutation = useMutation({
    mutationFn: async () => {
      // Saving the template first means a submit that fails doesn't also lose
      // the questions the sender just wrote.
      if (saveAsTemplate && newTemplateName.trim()) {
        await api.post('/requirement-forms', {
          name: newTemplateName.trim(),
          fields: payloadFields,
          theme: themePayload,
          defaultSubject: subject,
          defaultMessage: message || null,
          successMessage: successMessage || null,
        });
        qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
      }
      const { data } = await api.post(`/projects/${projectId}/client-requests`, {
        templateId: templateId || null,
        fields: payloadFields,
        theme: themePayload,
        contactId: contactId || null,
        recipientEmail: contactId ? null : manualEmail.trim() || null,
        ccEmails: ccEmails.trim() || null,
        subject: subject.trim(),
        message: message.trim(),
        dueAt: dueAt || null,
        successMessage: successMessage.trim() || null,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      // Three outcomes, three different things to say: queued for approval,
      // approved-and-emailed, or approved-but-SMTP-refused (the backend still
      // returns 201 for that last one, so don't report a blanket success).
      if (data.status === 'pending_approval') toast.success(data.message);
      else if (data.emailSent) toast.success(data.message);
      else toast.warning(data.message);
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Could not submit the form.');
    },
  });

  const submitLabel = isAdmin ? 'Send to client' : 'Submit for approval';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">Email the client a requirements form</h3>
            <p className="text-[11px] text-gray-400 mt-0.5 truncate">{projectName}</p>
          </div>

          {/* Step indicator — a completed step is clickable so you can jump
              back to fix something without losing your place. */}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">
            {STEPS.map((s, i) => {
              const done = s.n < step;
              const current = s.n === step;
              const reachable = s.n < step || (s.n === 2 && step1Done) || (s.n === 3 && step1Done && step2Done);
              return (
                <div key={s.n} className="flex items-center gap-1.5">
                  {i > 0 && <span className="w-4 h-px bg-gray-200" />}
                  <button
                    type="button"
                    disabled={!reachable || current}
                    onClick={() => setStep(s.n)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                      current ? 'bg-brand-50 text-brand-800'
                        : reachable ? 'text-gray-500 hover:bg-gray-100'
                          : 'text-gray-300 cursor-default'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${
                      done ? 'bg-green-600 text-white'
                        : current ? 'bg-brand-700 text-white'
                          : 'bg-gray-200 text-gray-500'
                    }`}>
                      {done ? <Check className="w-2.5 h-2.5" /> : s.n}
                    </span>
                    {s.label}
                  </button>
                </div>
              );
            })}
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* ── Compose ── */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5 lg:max-w-lg">

            {/* ════ Step 1 — the questions ════ */}
            {step === 1 && (
              <>
                <section className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Start from a saved form</label>
                    <select
                      value={templateId}
                      onChange={(e) => applyTemplate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <option value="">Compose from scratch</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Picking one fills in the questions and email — edits here only affect this send — the saved form stays as it is.
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-medium text-gray-700">Questions for the client</label>
                      <button onClick={addField} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                        <Plus className="w-3.5 h-3.5" /> Add question
                      </button>
                    </div>
                    <div className="space-y-2">
                      {fields.map((f, i) => (
                        <div key={i} className="border border-gray-200 rounded-lg p-2.5 space-y-2">
                          <div className="flex items-center gap-2">
                            <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            <input
                              value={f.label}
                              onChange={(e) => updateField(i, { label: e.target.value })}
                              placeholder="What should we ask?"
                              className="flex-1 min-w-0 text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
                            />
                            <button
                              onClick={() => removeField(i)}
                              className="p-1 rounded shrink-0 text-gray-300 hover:text-red-600 hover:bg-red-50"
                              title="Remove question"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 pl-6">
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
                          </div>
                          {f.type === 'select' && (
                            <input
                              value={f.options}
                              onChange={(e) => updateField(i, { options: e.target.value })}
                              placeholder="Options, comma separated"
                              className="w-full text-sm border border-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
                            />
                          )}
                        </div>
                      ))}
                      {fields.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
                          Add at least one question.
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                <div className="border-t border-gray-100" />

                {/* Appearance — same builder as the lead-form one, so a
                    requirements page can be branded/customized the same way a
                    lead-capture form can. */}
                <section className="border border-gray-200 rounded-xl overflow-hidden">
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
                      <div className={themeShowHeadline ? undefined : 'opacity-50'}>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="block text-xs font-medium text-gray-700">Public headline</label>
                          <button
                            type="button"
                            onClick={() => setThemeShowHeadline((v) => !v)}
                            title={themeShowHeadline ? 'Hide the headline on the public form' : 'Hidden from the public form — click to show'}
                            className={`p-1 rounded shrink-0 ${themeShowHeadline ? 'text-gray-300 hover:text-gray-700 hover:bg-gray-100' : 'text-amber-500 hover:text-amber-600 hover:bg-amber-50'}`}
                          >
                            {themeShowHeadline ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <input
                          value={themeHeadline}
                          onChange={(e) => setThemeHeadline(e.target.value)}
                          placeholder={subject || 'What the client sees at the top of the form'}
                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        {!themeHeadline.trim() && (
                          <p className="text-[11px] text-gray-400 mt-1">Blank uses the email Subject as the headline.</p>
                        )}
                        {!themeShowHeadline && <p className="text-[11px] text-amber-600 mt-1">Hidden — won&apos;t appear on the public form.</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">Description (optional)</label>
                        <textarea
                          value={themeDescription}
                          onChange={(e) => setThemeDescription(e.target.value)}
                          placeholder="A short line under the headline."
                          rows={2}
                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        {!themeDescription.trim() && (
                          <p className="text-[11px] text-gray-400 mt-1">Blank uses the email Message.</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1.5">Button text</label>
                        <input
                          value={themeButtonText}
                          onChange={(e) => setThemeButtonText(e.target.value)}
                          placeholder="Submit requirements"
                          className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <ColorInput label="Accent color" value={themePrimaryColor} onChange={setThemePrimaryColor} fallback={brandColor || DEFAULT_THEME.primaryColor} />
                        <ColorInput label="Background" value={themeBackgroundColor} onChange={setThemeBackgroundColor} fallback={DEFAULT_THEME.backgroundColor} />
                      </div>
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1.5">Corner style</label>
                          <select
                            value={themeBorderRadius}
                            onChange={(e) => setThemeBorderRadius(e.target.value as BorderRadius)}
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                          >
                            {BORDER_RADIUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col gap-1.5 pb-2">
                          <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" checked={themeShowLogo} onChange={(e) => setThemeShowLogo(e.target.checked)} />
                            Show your logo
                          </label>
                          <label className="flex items-center gap-2 text-sm text-gray-700">
                            <input type="checkbox" checked={themeShowName} onChange={(e) => setThemeShowName(e.target.checked)} />
                            Show your name
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}

            {/* ════ Step 2 — the email ════ */}
            {step === 2 && (
              <section className="space-y-3">
                <div className="rounded-lg bg-brand-50 border border-brand-100 px-3.5 py-2.5">
                  <p className="text-[11px] text-brand-900 leading-relaxed">
                    This is the email the client actually reads. Write it in your own words — an admin reviews
                    this wording before anything is sent.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Send to</label>
                  <select
                    value={contactId}
                    onChange={(e) => setContactId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">
                      {contactsLoading ? 'Loading contacts…' : contacts.length ? 'Someone else…' : 'No client contacts with an email'}
                    </option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}{c.role ? ` (${c.role})` : ''}</option>
                    ))}
                  </select>
                  {!contactId && (
                    <input
                      value={manualEmail}
                      onChange={(e) => setManualEmail(e.target.value)}
                      placeholder="client@example.com"
                      className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">CC (optional)</label>
                  <input
                    value={ccEmails}
                    onChange={(e) => setCcEmails(e.target.value)}
                    placeholder="someone@example.com, another@example.com"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">Your team&apos;s own contact address is CC&apos;d on every send automatically — no need to add it here.</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Subject</label>
                  <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                  {!subject.trim() && <p className="text-[11px] text-red-600 mt-1">The email needs a subject.</p>}
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Message to the client <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={7}
                    placeholder="Hi — we need a few details from you. The form below covers everything; it should only take a couple of minutes…"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                  {message.trim()
                    ? <p className="text-[11px] text-gray-400 mt-1">Appears in the email and above the questions on the client&apos;s page. Preview on the right.</p>
                    : <p className="text-[11px] text-red-600 mt-1">Write what the client will read — this is what the admin approves.</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Reply needed by (optional)</label>
                    <input
                      type="date"
                      value={dueAt}
                      onChange={(e) => setDueAt(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Used in the email and in automatic reminders.</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Thank-you message (optional)</label>
                    <input
                      value={successMessage}
                      onChange={(e) => setSuccessMessage(e.target.value)}
                      placeholder="Thanks — we'll be in touch."
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Shown after they submit.</p>
                  </div>
                </div>
              </section>
            )}

            {/* ════ Step 3 — review & submit ════ */}
            {step === 3 && (
              <section className="space-y-4">
                <div className={`rounded-xl border px-4 py-3 ${isAdmin ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${isAdmin ? 'text-green-600' : 'text-amber-600'}`} />
                    <div>
                      <p className={`text-xs font-semibold ${isAdmin ? 'text-green-900' : 'text-amber-900'}`}>
                        {isAdmin ? 'This sends straight away' : 'This goes to an admin first'}
                      </p>
                      <p className={`text-[11px] mt-0.5 leading-relaxed ${isAdmin ? 'text-green-800' : 'text-amber-800'}`}>
                        {isAdmin
                          ? 'You\'re an admin, so no separate approval is needed — submitting emails the client now.'
                          : 'Nothing is emailed yet. An admin reviews the questions and your message, then approves it — the client is emailed at that point, and you\'ll get a notification either way.'}
                      </p>
                    </div>
                  </div>
                </div>

                <dl className="rounded-xl border border-gray-200 divide-y divide-gray-100 text-sm">
                  {[
                    ['To', selectedContact ? `${selectedContact.name} · ${selectedContact.email}` : recipientEmail],
                    ['CC', ccEmails.trim() || '—'],
                    ['Subject', subject.trim()],
                    ['Questions', `${payloadFields.length} · ${payloadFields.filter((f) => f.required).length} required`],
                    ['Reply by', dueAt ? new Date(`${dueAt}T00:00:00`).toLocaleDateString() : 'No deadline'],
                  ].map(([k, v]) => (
                    <div key={k} className="px-4 py-2.5 flex items-start gap-3">
                      <dt className="text-[11px] font-medium text-gray-400 uppercase tracking-wide w-20 shrink-0 pt-0.5">{k}</dt>
                      <dd className="text-sm text-gray-900 min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                  <div className="px-4 py-2.5 flex items-start gap-3">
                    <dt className="text-[11px] font-medium text-gray-400 uppercase tracking-wide w-20 shrink-0 pt-0.5">Message</dt>
                    <dd className="text-sm text-gray-900 min-w-0 whitespace-pre-wrap break-words">{message.trim()}</dd>
                  </div>
                </dl>

                <div className="border-t border-gray-100" />

                {/* Optionally keep these questions for next time */}
                <div>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
                    <Save className="w-3.5 h-3.5 text-gray-400" />
                    Also save these questions &amp; appearance as a reusable form
                  </label>
                  {saveAsTemplate && (
                    <input
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="e.g. Website Design Intake"
                      className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  )}
                </div>
              </section>
            )}
          </div>

          {/* ── Preview: the email on step 2, the client's page otherwise ── */}
          <div className="flex-1 min-w-0 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100 overflow-y-auto p-5">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">
              {step === 2 ? 'What the email will look like' : 'What the client will see'}
            </p>
            {step === 2 ? (
              <EmailPreview
                brandName={brandName}
                brandLogoUrl={brandLogoUrl}
                recipientLabel={selectedContact ? `${selectedContact.name} <${selectedContact.email}>` : recipientEmail}
                recipientName={selectedContact?.name || ''}
                subject={subject}
                message={message}
                projectName={projectName}
                dueAt={dueAt}
                fieldCount={payloadFields.length}
                accent={themePrimaryColor || brandColor || DEFAULT_THEME.primaryColor}
              />
            ) : (
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
                <LeadFormRenderer
                  mode="preview"
                  theme={previewTheme}
                  branding={{ brandName, logoUrl: brandLogoUrl }}
                  fields={payloadFields}
                  enablePhoneCountryCode
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-gray-400 min-w-0 truncate">
            {step === 1 && 'Step 1 of 3 — what you want to ask the client.'}
            {step === 2 && 'Step 2 of 3 — the email they receive. Subject and message are both required.'}
            {step === 3 && (isAdmin
              ? 'Step 3 of 3 — check it over, then send.'
              : 'Step 3 of 3 — check it over, then send it for approval.')}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {step === 1 ? (
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                disabled={!canAdvance}
                title={canAdvance ? undefined : step === 1
                  ? 'Add at least one question first.'
                  : 'A recipient, a subject and a message are all needed.'}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {step === 1 ? 'Next: write the email' : 'Next: review'} <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => sendMutation.mutate()}
                disabled={!canSubmit || sendMutation.isPending}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                {isAdmin ? <Mail className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                {sendMutation.isPending ? 'Submitting…' : submitLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
