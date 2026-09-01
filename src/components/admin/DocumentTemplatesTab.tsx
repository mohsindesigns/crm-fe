'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, X } from 'lucide-react';
import api from '@/lib/api';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, titleCase, inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import RichTextEditor, { type RichTextEditorHandle } from '@/components/RichTextEditor';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { inp, btnPrimary, btnGhost, MERGE_TOKENS } from '@/components/admin/adminShared';

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

export default function DocumentTemplatesTab() {
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
        <Dialog open onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteError(''); } }}>
          <DialogContent className="max-w-sm sm:max-w-sm rounded-2xl shadow-xl gap-0">
            <DialogTitle className="sr-only">Set document template to Inactive?</DialogTitle>
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
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
