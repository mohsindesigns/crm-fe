'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, GripVertical, Mail, Save } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import LeadFormRenderer, { type FieldType, type FormField } from '@/components/leads/LeadFormRenderer';
import { DEFAULT_THEME } from '@/lib/leadFormTheme';

// Compose + send a requirements form to the project's client. Three things in
// one modal, in the order staff actually do them: pick the questions (from a
// saved template or from scratch), write the email, choose who gets it.
//
// The right pane is the real LeadFormRenderer in preview mode, so what the
// sender sees here is exactly the page the client will open — no approximation.

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

interface Contact { id: string; name: string; email: string; role?: string }
interface Template {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  defaultSubject: string | null;
  defaultMessage: string | null;
  successMessage: string | null;
}

export default function ClientRequestModal({
  projectId,
  projectName,
  brandName,
  brandLogoUrl,
  brandColor,
  onClose,
}: {
  projectId: string;
  projectName: string;
  brandName: string;
  brandLogoUrl: string | null;
  brandColor: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [templateId, setTemplateId] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>(STARTER_FIELDS);
  const [contactId, setContactId] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [subject, setSubject] = useState(`Project requirements — ${projectName}`);
  const [message, setMessage] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['requirement-form-templates'],
    queryFn: () => api.get('/requirement-forms').then((r) => r.data),
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<Contact[]>({
    queryKey: ['client-request-recipients', projectId],
    queryFn: () => api.get(`/projects/${projectId}/client-requests/recipients`).then((r) => r.data),
  });

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
    setSuccessMessage(t.successMessage || '');
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

  const previewTheme = {
    ...DEFAULT_THEME,
    headline: subject || `Project requirements — ${projectName}`,
    description: message,
    buttonText: 'Submit requirements',
    primaryColor: brandColor || DEFAULT_THEME.primaryColor,
  };

  const recipientEmail = contactId
    ? contacts.find((c) => c.id === contactId)?.email || ''
    : manualEmail.trim();

  const sendMutation = useMutation({
    mutationFn: async () => {
      // Saving the template first means a send that fails on SMTP doesn't also
      // lose the questions the sender just wrote.
      if (saveAsTemplate && newTemplateName.trim()) {
        await api.post('/requirement-forms', {
          name: newTemplateName.trim(),
          fields: payloadFields,
          defaultSubject: subject,
          defaultMessage: message || null,
          successMessage: successMessage || null,
        });
        qc.invalidateQueries({ queryKey: ['requirement-form-templates'] });
      }
      const { data } = await api.post(`/projects/${projectId}/client-requests`, {
        templateId: templateId || null,
        fields: payloadFields,
        contactId: contactId || null,
        recipientEmail: contactId ? null : manualEmail.trim() || null,
        ccEmails: ccEmails.trim() || null,
        subject: subject.trim(),
        message: message.trim() || null,
        dueAt: dueAt || null,
        successMessage: successMessage.trim() || null,
      });
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['client-requests', projectId] });
      // The backend returns 201 even when SMTP couldn't deliver, so report what
      // actually happened rather than a blanket success.
      if (data.emailSent) toast.success(data.message);
      else toast.warning(data.message);
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.response?.data?.error || 'Could not send the form.');
    },
  });

  const canSend = payloadFields.length > 0 && !!subject.trim() && !!recipientEmail;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Email the client a requirements form</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">{projectName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row min-h-0">
          {/* ── Compose ── */}
          <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-5 lg:max-w-lg">
            {/* 1. The questions */}
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
                  Picking one fills in the questions and email below. Edits here only affect this send — the saved form stays as it is.
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

            {/* 2. The email */}
            <section className="space-y-3">
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
                    <option key={c.id} value={c.id}>{c.name} · {c.email}{c.role ? ` (${c.role})` : ''}</option>
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
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Subject</label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Message</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  placeholder="A short note explaining what you need and why…"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <p className="text-[11px] text-gray-400 mt-1">Appears in the email and above the questions on the client&apos;s page.</p>
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

            <div className="border-t border-gray-100" />

            {/* 3. Optionally keep these questions for next time */}
            <section>
              <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                <input type="checkbox" checked={saveAsTemplate} onChange={(e) => setSaveAsTemplate(e.target.checked)} />
                <Save className="w-3.5 h-3.5 text-gray-400" />
                Also save these questions as a reusable form
              </label>
              {saveAsTemplate && (
                <input
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g. Website Design Intake"
                  className="w-full mt-2 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              )}
            </section>
          </div>

          {/* ── Live preview of the client's page ── */}
          <div className="flex-1 min-w-0 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100 overflow-y-auto p-5">
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-3">What the client will see</p>
            <div className="rounded-xl overflow-hidden border border-gray-200 bg-white">
              <LeadFormRenderer
                mode="preview"
                theme={previewTheme}
                branding={{ brandName, logoUrl: brandLogoUrl }}
                fields={payloadFields}
              />
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 px-5 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-gray-400">
            They get a private link — no login needed. You&apos;ll see their answers here as soon as they submit.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              onClick={() => sendMutation.mutate()}
              disabled={!canSend || sendMutation.isPending}
              className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              <Mail className="w-3.5 h-3.5" />
              {sendMutation.isPending ? 'Sending…' : 'Send to client'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
