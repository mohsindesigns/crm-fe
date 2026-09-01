'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { inactiveRow } from '@/lib/utils';
import { toast } from 'sonner';
import { inp, btnPrimary, btnGhost, slugify, ALL_PERMISSIONS } from '@/components/admin/adminShared';

// ─── Roles Tab ────────────────────────────────────────────────────────────────

export default function RolesTab() {
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
