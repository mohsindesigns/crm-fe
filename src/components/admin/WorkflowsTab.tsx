'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, Trash2, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, titleCase, inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import { inp, btnPrimary, btnGhost, slugify, STAGE_TYPES, ADVANCE_RULES, ACTIONS } from '@/components/admin/adminShared';

// ─── Workflows Tab ────────────────────────────────────────────────────────────

type StageRow = {
  key: string; name: string; ownerRoleSlot: string;
  stageType: string; advanceRule: string; isTerminal: boolean; requiresArtifact: boolean;
  showInTimeline: boolean;
};

type TransitionRow = { fromStageKey: string; action: string; toStageKey: string; reasonCategory: string };

export default function WorkflowsTab() {
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
      showInTimeline: s.showInTimeline !== false,
    })));
    setTransEditor((tmpl.transitions || []).map((tr: any) => ({
      fromStageKey: tr.fromStageKey, action: tr.action,
      toStageKey: tr.toStageKey, reasonCategory: tr.reasonCategory || '',
    })));
    setActiveSection('stages');
  }

  function addStage() {
    setStageEditor([...stageEditor, { key: '', name: '', ownerRoleSlot: '', stageType: 'work', advanceRule: 'single_action', isTerminal: false, requiresArtifact: false, showInTimeline: true }]);
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
                      <div className="col-span-2 flex items-center gap-3 flex-wrap">
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
                        <label
                          className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer"
                          title={
                            s.stageType === 'approval'
                              ? 'Hides this stage\'s pill from the project timeline. It still needs a manual Approve/Reject — that decision is never automated.'
                              : 'Hides this stage\'s pill from the project timeline and auto-advances the project past it as soon as its work is done, instead of waiting for a manual Mark Complete click. The work still happens through its own tab.'
                          }
                        >
                          <input type="checkbox" checked={s.showInTimeline}
                            onChange={(e) => updateStage(i, 'showInTimeline', e.target.checked)}
                            className="w-3.5 h-3.5 rounded accent-brand-700" />
                          In Timeline
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
