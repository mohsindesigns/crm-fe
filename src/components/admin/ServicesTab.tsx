'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Pencil, X } from 'lucide-react';
import api from '@/lib/api';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { inp, btnPrimary, btnGhost, slugify } from '@/components/admin/adminShared';

// ─── Services Tab ─────────────────────────────────────────────────────────────

export default function ServicesTab() {
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
        <Dialog open onOpenChange={(open) => { if (!open) { setDeleteId(null); setDeleteError(''); } }}>
          <DialogContent className="max-w-sm sm:max-w-sm rounded-2xl shadow-xl gap-0">
            <DialogTitle className="sr-only">Set service type to Inactive?</DialogTitle>
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
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
