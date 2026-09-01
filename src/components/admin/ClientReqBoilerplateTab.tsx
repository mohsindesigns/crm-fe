'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, Trash2, X } from 'lucide-react';
import api from '@/lib/api';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import ColorInput from '@/components/ColorInput';
import { BORDER_RADIUS_OPTIONS, type BorderRadius } from '@/lib/leadFormTheme';
import { cn, inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { inp, btnPrimary, btnGhost, CLIENT_REQ_FIELD_TYPES } from '@/components/admin/adminShared';

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

export default function ClientReqBoilerplateTab() {
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
        <Dialog open onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteError(''); } }}>
          <DialogContent className="max-w-sm sm:max-w-sm rounded-2xl shadow-xl gap-0">
            <DialogTitle className="sr-only">Set this form to Inactive?</DialogTitle>
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
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
