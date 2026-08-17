'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import Avatar from '@/components/Avatar';

export default function TeamMemberPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [editForm, setEditForm] = useState<{ name: string; roleId: string; isActive: boolean } | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [showResetForm, setShowResetForm] = useState(false);

  const { data: user, isLoading } = useQuery<any>({
    queryKey: ['team-member', id],
    queryFn: () => api.get(`/users/${id}`).then((r) => r.data),
  });

  // Hydrate the edit form once when the member loads (TanStack Query v5 dropped useQuery's
  // onSuccess option, so this can't be done inline in the query itself).
  useEffect(() => {
    if (user && !editForm) {
      setEditForm({ name: user.name, roleId: user.role?.id || '', isActive: user.isActive });
    }
  }, [user, editForm]);

  const { data: rolesRaw = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
  });
  const roles = (rolesRaw as any[]).filter((r: any) => r.key !== 'client' && r.key !== 'super_admin');

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.patch(`/users/${id}`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-member', id] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Member updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Update failed.'),
  });

  const resetMutation = useMutation({
    mutationFn: (newPassword: string) =>
      api.post(`/users/${id}/reset-password`, { newPassword }).then((r) => r.data),
    onSuccess: () => {
      toast.success('Password reset successfully.');
      setResetPassword('');
      setShowResetForm(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Password reset failed.'),
  });

  if (isLoading || !editForm) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Team Member" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Team Member" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Member not found.</div>
      </div>
    );
  }

  const isSuperAdmin = user.role?.key === 'super_admin';

  return (
    <div className="flex flex-col h-full">
      <Header title={user.name || 'Team Member'} />
      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" />
          Back to Team
        </button>

        {/* Profile card */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <Avatar src={user.avatarUrl} name={user.name} size="lg" />
            <div>
              <p className="font-semibold text-gray-900">{user.name}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: user.role?.color || '#94a3b8' }} />
                <span className="text-xs text-gray-500">{user.role?.name || '—'}</span>
              </div>
            </div>
          </div>
          <span className={cn('px-3 py-1 text-xs font-medium rounded-full', user.isActive ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500')}>
            {user.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>

        {/* Edit details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Account Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
              <select
                value={editForm.roleId}
                onChange={(e) => setEditForm({ ...editForm, roleId: e.target.value })}
                disabled={isSuperAdmin}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">Select a role…</option>
                {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                {isSuperAdmin && <option value={user.role?.id}>{user.role?.name}</option>}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select
                value={editForm.isActive ? 'active' : 'inactive'}
                onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === 'active' })}
                disabled={isSuperAdmin}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <button
              onClick={() => updateMutation.mutate({ name: editForm.name, roleId: editForm.roleId || undefined, isActive: editForm.isActive })}
              disabled={updateMutation.isPending || isSuperAdmin}
              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>

        {/* Password reset */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-center justify-between mb-4 gap-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-900">Reset Password</h3>
            </div>
            {!showResetForm && (
              <button
                onClick={() => setShowResetForm(true)}
                className="text-xs text-brand-800 font-medium hover:text-brand-900"
              >
                Set new password
              </button>
            )}
          </div>
          {showResetForm && (
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">New Password</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <button
                onClick={() => { if (resetPassword.length >= 8) resetMutation.mutate(resetPassword); }}
                disabled={resetPassword.length < 8 || resetMutation.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {resetMutation.isPending ? 'Resetting…' : 'Reset'}
              </button>
              <button
                onClick={() => { setShowResetForm(false); setResetPassword(''); }}
                className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          )}
          {!showResetForm && (
            <p className="text-xs text-gray-400">Set a new password for this team member's account.</p>
          )}
        </div>

        {/* No separate Active/Inactive control here — the Status field in Account
            Details above already owns it. Setting it to Inactive revokes login
            access; the member's history is kept either way, nothing is deleted. */}

      </div>
    </div>
  );
}
