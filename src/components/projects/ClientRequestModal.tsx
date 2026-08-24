'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Plus, Trash2, Mail, Save, Palette, Eye, EyeOff, AlertCircle,
  ArrowLeft, ArrowRight, ShieldCheck, Check, ChevronUp, ChevronDown,
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
  { value: 'multiselect', label: 'Dropdown (multi-select)' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File attachment' },
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

// One definition per control, used by every field in the wizard. Three steps
// worth of inputs styled ad hoc is what made this screen look assembled rather
// than designed — add a variant here rather than a one-off className below.
const INPUT = 'w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg placeholder:text-gray-400 focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20 transition-colors';
const LABEL = 'block text-[13px] font-medium text-gray-800 mb-1.5';
const HINT = 'mt-1.5 text-xs text-gray-500';

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
  // Authoring a reusable template is org-level project configuration, gated on
  // projects.manage server-side (routes/requirementForms.js POST /). Sending a
  // form only needs projects.act, which every specialist role holds — so most
  // senders can compose and submit but cannot save a template. Offering them
  // the checkbox anyway 403'd the template POST and, because it runs first,
  // took the whole send down with it.
  const canSaveTemplate = useAuthStore((s) => s.hasPermission('projects.manage'));

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
  // Name and headline start hidden: the logo already identifies the agency, and
  // the email subject is repeated as the headline, so showing all three stacks
  // the same information three times on the client's page. Both are one click
  // away under Appearance for the sends that want them.
  const [themeShowName, setThemeShowName] = useState(false);
  const [themeShowHeadline, setThemeShowHeadline] = useState(false);
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
    // A template that never stated these falls back to the compose defaults
    // above, not to on — templates saved from here always state both.
    setThemeShowName(theme.showName !== undefined ? theme.showName : false);
    setThemeShowHeadline(theme.showHeadline !== undefined ? theme.showHeadline : false);
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
        ...(f.type === 'select' || f.type === 'multiselect' ? { options: f.options.split(',').map((o) => o.trim()).filter(Boolean) } : {}),
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
      // the questions the sender just wrote. Its own failure, though, must not
      // take the send down with it — the template is a convenience, the form
      // going out is the point — so it warns and carries on.
      if (canSaveTemplate && saveAsTemplate && newTemplateName.trim()) {
        try {
          await api.post('/requirement-forms', {
            name: newTemplateName.trim(),
            fields: payloadFields,
            theme: themePayload,
            defaultSubject: subject,
            defaultMessage: message || null,
            successMessage: successMessage || null,
          });
          qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
        } catch (err: any) {
          toast.warning(err?.response?.data?.message || 'Could not save these questions as a reusable form — carrying on with the send.');
        }
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
  /** Reorder without a drag library. The old grip handle implied drag-to-sort
   *  and did nothing — an affordance that lies is worse than none. */
  function moveField(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= fields.length) return;
    setFields((fs) => {
      const next = [...fs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const submitLabel = isAdmin ? 'Send to client' : 'Submit for approval';
  // Shown beside a disabled primary button so it is never a dead end.
  const blockedReason = step === 1 && !step1Done
    ? 'Add at least one question to continue.'
    : step === 2 && !step2Done
      ? 'A recipient, a subject and a message are all required.'
      : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-gray-900/5 w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* ── Header: title, then the stepper on its own full-width row ── */}
        <div className="shrink-0 border-b border-gray-200">
          <div className="px-5 sm:px-6 pt-4 pb-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-900 leading-tight">Request requirements</h3>
              <p className="text-xs text-gray-500 mt-0.5 truncate">{projectName}</p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 -m-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* A completed step stays clickable, so going back to fix something
              never costs you your place. */}
          <nav className="px-5 sm:px-6 pb-3 flex items-center gap-2">
            {STEPS.map((s, i) => {
              const done = s.n < step;
              const current = s.n === step;
              const reachable = s.n < step || (s.n === 2 && step1Done) || (s.n === 3 && step1Done && step2Done);
              return (
                <div key={s.n} className="flex items-center gap-2 min-w-0 flex-1 last:flex-none">
                  <button
                    type="button"
                    disabled={!reachable || current}
                    onClick={() => setStep(s.n)}
                    aria-current={current ? 'step' : undefined}
                    className={`flex items-center gap-2 rounded-lg px-1.5 py-1 -ml-1.5 shrink-0 transition-colors ${
                      reachable && !current ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold transition-colors ${
                      done ? 'bg-brand-700 text-white'
                        : current ? 'bg-brand-700 text-white ring-4 ring-brand-100'
                          : 'bg-gray-100 text-gray-400 ring-1 ring-inset ring-gray-200'
                    }`}>
                      {done ? <Check className="w-3 h-3" /> : s.n}
                    </span>
                    <span className={`text-[13px] font-medium ${
                      current ? 'text-gray-900' : done ? 'text-gray-600' : 'text-gray-400'
                    }`}>
                      {s.label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <span className={`h-px flex-1 min-w-[16px] ${done ? 'bg-brand-200' : 'bg-gray-200'}`} />
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* ── Compose ── */}
          <div className="flex-1 min-w-0 overflow-y-auto px-5 sm:px-6 py-5 space-y-6 lg:max-w-[26rem] xl:max-w-lg">

            {/* ════ Step 1 — the questions ════ */}
            {step === 1 && (
              <>
                <section>
                  <label className={LABEL} htmlFor="cr-template">Start from a saved form</label>
                  <select
                    id="cr-template"
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Compose from scratch</option>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <p className={HINT}>Edits here apply to this send only — the saved form is left untouched.</p>
                </section>

                <section>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <div>
                      <h4 className="text-[13px] font-semibold text-gray-900">Questions for the client</h4>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {payloadFields.length === 0
                          ? 'None yet'
                          : `${payloadFields.length} question${payloadFields.length === 1 ? '' : 's'} · ${payloadFields.filter((f) => f.required).length} required`}
                      </p>
                    </div>
                    <button
                      onClick={addField}
                      className="flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:text-brand-800 shrink-0"
                    >
                      <Plus className="w-4 h-4" /> Add
                    </button>
                  </div>

                  <div className="space-y-2">
                    {fields.map((f, i) => (
                      <div key={i} className="rounded-xl border border-gray-200 bg-white p-2.5 hover:border-gray-300 transition-colors">
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1.5 w-6 h-6 shrink-0 rounded-md bg-gray-100 text-[11px] font-semibold text-gray-500 flex items-center justify-center">
                            {i + 1}
                          </span>

                          <div className="flex-1 min-w-0 space-y-2">
                            <input
                              value={f.label}
                              onChange={(e) => updateField(i, { label: e.target.value })}
                              placeholder="What should we ask?"
                              className={INPUT}
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                value={f.type}
                                onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
                                className="px-2.5 py-1.5 text-xs text-gray-700 bg-white border border-gray-200 rounded-md focus:outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20"
                              >
                                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                              </select>
                              <button
                                type="button"
                                aria-pressed={f.required}
                                onClick={() => updateField(i, { required: !f.required })}
                                className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                                  f.required
                                    ? 'border-brand-200 bg-brand-50 text-brand-800'
                                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                                }`}
                              >
                                Required
                              </button>
                            </div>
                            {(f.type === 'select' || f.type === 'multiselect') && (
                              <input
                                value={f.options}
                                onChange={(e) => updateField(i, { options: e.target.value })}
                                placeholder="Options, comma separated"
                                className={INPUT}
                              />
                            )}
                          </div>

                          <div className="flex flex-col shrink-0">
                            <button
                              type="button"
                              onClick={() => moveField(i, -1)}
                              disabled={i === 0}
                              aria-label="Move question up"
                              className="p-1 rounded text-gray-300 enabled:hover:text-gray-700 enabled:hover:bg-gray-100 disabled:opacity-40"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveField(i, 1)}
                              disabled={i === fields.length - 1}
                              aria-label="Move question down"
                              className="p-1 rounded text-gray-300 enabled:hover:text-gray-700 enabled:hover:bg-gray-100 disabled:opacity-40"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeField(i)}
                              aria-label="Remove question"
                              className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {fields.length === 0 && (
                      <button
                        onClick={addField}
                        className="w-full py-6 rounded-xl border border-dashed border-gray-300 text-[13px] text-gray-500 hover:border-brand-300 hover:text-brand-700 hover:bg-brand-50/40 transition-colors"
                      >
                        Add your first question
                      </button>
                    )}
                  </div>
                </section>

                {/* Appearance — the same controls as the lead-form builder, so a
                    requirements page can be branded the same way. */}
                <section className="rounded-xl border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAppearance((v) => !v)}
                    className="w-full flex items-center gap-2 px-3.5 py-3 text-[13px] font-medium text-gray-800 hover:bg-gray-50 transition-colors"
                  >
                    <Palette className="w-4 h-4 text-gray-400" />
                    Appearance
                    <span className="ml-auto flex items-center gap-1 text-xs font-normal text-gray-500">
                      {showAppearance ? 'Hide' : 'Customize'}
                      {showAppearance ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </button>
                  {showAppearance && (
                    <div className="px-3.5 pb-4 pt-4 space-y-4 border-t border-gray-100">
                      <div className={themeShowHeadline ? undefined : 'opacity-60'}>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <label className="text-[13px] font-medium text-gray-800">Public headline</label>
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
                          className={INPUT}
                        />
                        {!themeShowHeadline
                          ? <p className="mt-1.5 text-xs text-amber-600">Hidden — it will not appear on the public form.</p>
                          : !themeHeadline.trim() && <p className={HINT}>Blank uses the email subject.</p>}
                      </div>

                      <div>
                        <label className={LABEL}>Description</label>
                        <textarea
                          value={themeDescription}
                          onChange={(e) => setThemeDescription(e.target.value)}
                          placeholder="A short line under the headline."
                          rows={2}
                          className={`${INPUT} resize-none`}
                        />
                        {!themeDescription.trim() && <p className={HINT}>Blank uses the email message.</p>}
                      </div>

                      <div>
                        <label className={LABEL}>Button text</label>
                        <input
                          value={themeButtonText}
                          onChange={(e) => setThemeButtonText(e.target.value)}
                          placeholder="Submit requirements"
                          className={INPUT}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <ColorInput label="Accent color" value={themePrimaryColor} onChange={setThemePrimaryColor} fallback={brandColor || DEFAULT_THEME.primaryColor} />
                        <ColorInput label="Background" value={themeBackgroundColor} onChange={setThemeBackgroundColor} fallback={DEFAULT_THEME.backgroundColor} />
                      </div>

                      <div className="grid grid-cols-2 gap-3 items-start">
                        <div>
                          <label className={LABEL}>Corner style</label>
                          <select
                            value={themeBorderRadius}
                            onChange={(e) => setThemeBorderRadius(e.target.value as BorderRadius)}
                            className={INPUT}
                          >
                            {BORDER_RADIUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="pt-7 space-y-2">
                          <label className="flex items-center gap-2 text-[13px] text-gray-700">
                            <input type="checkbox" checked={themeShowLogo} onChange={(e) => setThemeShowLogo(e.target.checked)} />
                            Show your logo
                          </label>
                          <label className="flex items-center gap-2 text-[13px] text-gray-700">
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
              <>
                <section className="space-y-4">
                  <h4 className="text-[13px] font-semibold text-gray-900">Recipient</h4>
                  <div>
                    <label className={LABEL} htmlFor="cr-to">Send to</label>
                    <select
                      id="cr-to"
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                      className={INPUT}
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
                        className={`${INPUT} mt-2`}
                      />
                    )}
                  </div>

                  <div>
                    <label className={LABEL} htmlFor="cr-cc">CC <span className="font-normal text-gray-400">optional</span></label>
                    <input
                      id="cr-cc"
                      value={ccEmails}
                      onChange={(e) => setCcEmails(e.target.value)}
                      placeholder="someone@example.com, another@example.com"
                      className={INPUT}
                    />
                    <p className={HINT}>Your own contact address is CC&apos;d automatically.</p>
                  </div>
                </section>

                <section className="space-y-4 border-t border-gray-100 pt-5">
                  <h4 className="text-[13px] font-semibold text-gray-900">The email</h4>
                  <div>
                    <label className={LABEL} htmlFor="cr-subject">Subject</label>
                    <input
                      id="cr-subject"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className={`${INPUT} ${subject.trim() ? '' : 'border-red-300'}`}
                    />
                    {!subject.trim() && <p className="mt-1.5 text-xs text-red-600">The email needs a subject.</p>}
                  </div>

                  <div>
                    <label className={LABEL} htmlFor="cr-message">
                      Message <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      id="cr-message"
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={7}
                      placeholder="Hi — we need a few details from you. The form below covers everything; it should only take a couple of minutes…"
                      className={`${INPUT} resize-none ${message.trim() ? '' : 'border-red-300'}`}
                    />
                    {message.trim()
                      ? <p className={HINT}>Appears in the email and above the questions on the client&apos;s page.</p>
                      : <p className="mt-1.5 text-xs text-red-600">Write what the client will read — this is what the admin approves.</p>}
                  </div>
                </section>

                <section className="space-y-4 border-t border-gray-100 pt-5">
                  <h4 className="text-[13px] font-semibold text-gray-900">
                    Follow-up <span className="font-normal text-gray-400">optional</span>
                  </h4>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL} htmlFor="cr-due">Reply needed by</label>
                      <input
                        id="cr-due"
                        type="date"
                        value={dueAt}
                        onChange={(e) => setDueAt(e.target.value)}
                        className={INPUT}
                      />
                      <p className={HINT}>Drives the automatic reminders.</p>
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="cr-thanks">Thank-you message</label>
                      <input
                        id="cr-thanks"
                        value={successMessage}
                        onChange={(e) => setSuccessMessage(e.target.value)}
                        placeholder="Thanks — we will be in touch."
                        className={INPUT}
                      />
                      <p className={HINT}>Shown once they submit.</p>
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ════ Step 3 — review & submit ════ */}
            {step === 3 && (
              <section className="space-y-5">
                <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${
                  isAdmin ? 'border-gray-200 bg-gray-50' : 'border-amber-200 bg-amber-50'
                }`}>
                  <ShieldCheck className={`w-4 h-4 mt-0.5 shrink-0 ${isAdmin ? 'text-gray-400' : 'text-amber-600'}`} />
                  <p className={`text-xs leading-relaxed ${isAdmin ? 'text-gray-600' : 'text-amber-900'}`}>
                    {isAdmin
                      ? <><span className="font-semibold text-gray-800">Sends immediately.</span> As an admin, your request needs no separate approval.</>
                      : <><span className="font-semibold">Goes to an admin first.</span> Nothing is emailed until they approve it — you will be notified either way.</>}
                  </p>
                </div>

                <dl className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                  {[
                    ['To', selectedContact ? `${selectedContact.name} · ${selectedContact.email}` : recipientEmail],
                    ['CC', ccEmails.trim() || '—'],
                    ['Subject', subject.trim()],
                    ['Questions', `${payloadFields.length} · ${payloadFields.filter((f) => f.required).length} required`],
                    ['Reply by', dueAt ? new Date(`${dueAt}T00:00:00`).toLocaleDateString() : 'No deadline'],
                  ].map(([k, v]) => (
                    <div key={k} className="px-4 py-3 flex items-start gap-4">
                      <dt className="text-xs font-medium text-gray-500 w-20 shrink-0 pt-px">{k}</dt>
                      <dd className="text-[13px] text-gray-900 min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                  <div className="px-4 py-3 flex items-start gap-4">
                    <dt className="text-xs font-medium text-gray-500 w-20 shrink-0 pt-px">Message</dt>
                    <dd className="text-[13px] text-gray-700 min-w-0 leading-relaxed whitespace-pre-wrap break-words">{message.trim()}</dd>
                  </div>
                </dl>

                {/* Optionally keep these questions for next time — only for
                    roles that may author templates (projects.manage). Hiding it
                    mirrors the server gate; it is not the access control. */}
                {canSaveTemplate && (
                  <div className="rounded-xl border border-gray-200 px-4 py-3">
                    <label className="flex items-center gap-2.5 text-[13px] font-medium text-gray-800 cursor-pointer">
                      <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
                      <Save className="w-4 h-4 text-gray-400" />
                      Save these questions as a reusable form
                    </label>
                    {saveAsTemplate && (
                      <input
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder="e.g. Website Design Intake"
                        className={`${INPUT} mt-2.5`}
                      />
                    )}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ── Preview: the email on step 2, the client's page otherwise ── */}
          <div className="flex-1 min-w-0 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-200 overflow-y-auto px-5 sm:px-6 py-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
              <p className="text-xs font-medium text-gray-500">
                {step === 2 ? 'Preview — the email they receive' : 'Preview — the page they land on'}
              </p>
            </div>
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
              <div className="rounded-xl overflow-hidden border border-gray-200 bg-white shadow-sm">
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

        {/* ── Footer: navigation, plus why the primary button is disabled ── */}
        <div className="shrink-0 border-t border-gray-200 bg-gray-50/60 px-5 sm:px-6 py-3 flex items-center justify-between gap-3">
          <p className="text-xs min-w-0 flex items-center gap-1.5">
            {blockedReason
              ? <><AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" /><span className="text-gray-600 truncate">{blockedReason}</span></>
              : <span className="text-gray-400 truncate">Step {step} of 3</span>}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {step === 1 ? (
              <button onClick={onClose} className="px-3.5 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100">
                Cancel
              </button>
            ) : (
              <button
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-100"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>
            )}

            {step < 3 ? (
              <button
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
                disabled={!canAdvance}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                Continue <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => sendMutation.mutate()}
                disabled={!canSubmit || sendMutation.isPending}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
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
