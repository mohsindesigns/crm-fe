'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import Avatar from '@/components/Avatar';
import { InactiveBadge } from '@/components/ActiveToggle';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, generatePassword, titleCase, inactiveRow } from '@/lib/utils';

const LIMIT = 25;

function SkeletonRows() {
  return (
    <>
      {[...Array(8)].map((_, i) => (
        <tr key={i} className="animate-pulse border-b border-gray-50">
          <td className="px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 shrink-0" />
              <div className="space-y-1.5">
                <div className="h-4 bg-gray-100 rounded w-32" />
                <div className="h-3 bg-gray-100 rounded w-44" />
              </div>
            </div>
          </td>
          <td className="px-5 py-3.5"><div className="h-4 bg-gray-100 rounded w-20" /></td>
          <td className="px-5 py-3.5"><div className="h-5 bg-gray-100 rounded-full w-14" /></td>
        </tr>
      ))}
    </>
  );
}

export default function TeamPage() {
  const router = useRouter();
  const [rawSearch, setRawSearch] = useState('');
  const [search,    setSearch]    = useState('');
  const [roleId,    setRoleId]    = useState('');
  const [page,      setPage]      = useState(1);
  const [showForm,  setShowForm]  = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  // Open the invite form with a freshly generated temporary password
  function openInviteForm() {
    setForm({ name: '', email: '', password: generatePassword(), roleId: '' });
    setShowPassword(false);
    setFieldErrors({});
    setShowForm(true);
  }

  useEffect(() => {
    const t = setTimeout(() => { setSearch(rawSearch); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [rawSearch]);

  const inactive = useShowInactive();

  const { data, isLoading } = useQuery({
    queryKey: ['users', { page, search, roleId, inactive: inactive.key }],
    queryFn: () =>
      api.get('/users', { params: {
        page, limit: LIMIT, search: search || undefined, roleId: roleId || undefined, ...inactive.params,
      } }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: rolesRaw } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
  });
  // client role is for portal access — not a team member; super_admin can't be bulk-assigned
  const roles = (rolesRaw || []).filter((r: any) => r.key !== 'client' && r.key !== 'super_admin');

  const users: any[]       = data?.data       || [];
  const total: number      = data?.total      || 0;
  const totalPages: number = data?.totalPages || 1;

  const createMutation = useMutation({
    mutationFn: (d: typeof form) => api.post('/users', d).then((r) => r.data),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowForm(false);
      setForm({ name: '', email: '', password: '', roleId: '' });
      setFieldErrors({});
      toast.success(`${user.name} invited — a welcome email has been sent.`);
    },
    onError: (err: any) => {
      const d = err?.response?.data;
      if (d?.errors) setFieldErrors(d.errors);
      toast.error(d?.message || 'Failed to invite member.');
    },
  });

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (fieldErrors[field]) setFieldErrors((e) => ({ ...e, [field]: '' }));
  }

  function handleSubmit() {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Full name is required.';
    if (!form.email.trim()) errs.email = 'Email is required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Must be a valid email address.';
    if (form.password.length < 8) errs.password = 'Password must be at least 8 characters.';
    if (!form.roleId) errs.roleId = 'A role must be selected.';
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    createMutation.mutate(form);
  }

  function inputCn(field: string) {
    return cn(
      'w-full px-3.5 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-colors',
      fieldErrors[field] ? 'border-red-400 focus:ring-red-300 bg-red-50' : 'border-gray-300 focus:ring-brand-600'
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Team" />
      <div className="flex-1 p-4 sm:p-6 space-y-4 overflow-y-auto">

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative w-full sm:flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto min-w-0 flex-wrap">
            <Filter className="w-4 h-4 text-gray-400 shrink-0" />
            <select
              value={roleId}
              onChange={(e) => { setRoleId(e.target.value); setPage(1); }}
              className="flex-1 min-w-36 sm:min-w-0 sm:flex-none text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600"
            >
              <option value="">All roles</option>
              {(roles || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>

            <ShowInactiveToggle {...inactive.toggleProps} onChange={(v) => { inactive.setShow(v); setPage(1); }} />

            <button
              onClick={openInviteForm}
              className="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Invite Member
            </button>
          </div>
        </div>

        {/* ── Invite form ── */}
        {showForm && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Invite Team Member</h3>
            <p className="text-xs text-gray-500">An email with login credentials will be sent to the member.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Full Name *</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Jane Doe" className={inputCn('name')} />
                {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Email *</label>
                <input value={form.email} onChange={(e) => set('email', e.target.value)} type="email" placeholder="jane@company.com" className={inputCn('email')} />
                {fieldErrors.email && <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Temporary Password *</label>
                <div className="relative">
                  <input
                    value={form.password}
                    onChange={(e) => set('password', e.target.value)}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Auto-generated"
                    className={cn(inputCn('password'), 'pr-16 font-mono')}
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="p-1 text-gray-400 hover:text-gray-600"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => set('password', generatePassword())}
                      className="p-1 text-gray-400 hover:text-brand-700"
                      title="Generate a new password"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {fieldErrors.password && <p className="text-xs text-red-600 mt-1">{fieldErrors.password}</p>}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Role *</label>
                <select value={form.roleId} onChange={(e) => set('roleId', e.target.value)} className={inputCn('roleId')}>
                  <option value="">Select a role…</option>
                  {(roles || []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {fieldErrors.roleId && <p className="text-xs text-red-600 mt-1">{fieldErrors.roleId}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={createMutation.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                {createMutation.isPending ? 'Sending invite…' : 'Send Invite'}
              </button>
              <button onClick={() => { setShowForm(false); setFieldErrors({}); }}
                className="text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Table ── */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-140">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Member</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Role</th>
                <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <SkeletonRows />
              ) : users.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-12 text-center text-sm text-gray-400">No team members found.</td></tr>
              ) : (
                users.map((u: any) => (
                  <tr
                    key={u.id}
                    className={cn('hover:bg-gray-50 transition-colors cursor-pointer', inactiveRow(u.isActive))}
                    onClick={() => u.worker?.id ? router.push(`/hr/workers/${u.worker.id}`) : undefined}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar src={u.avatarUrl} name={u.name} size="sm" />
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {u.name}
                            {u.isActive === false && <InactiveBadge className="ml-2" />}
                          </p>
                          <p className="text-xs text-gray-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: u.role?.color || '#94a3b8' }} />
                        <span className="text-sm text-gray-600">{u.role?.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {(() => {
                        const s = u.worker?.status;
                        const map: Record<string, string> = {
                          active: 'bg-brand-100 text-brand-800',
                          inactive: 'bg-gray-100 text-gray-500',
                          invited: 'bg-blue-100 text-blue-700',
                          profile_pending: 'bg-amber-100 text-amber-700',
                          under_review: 'bg-violet-100 text-violet-700',
                        };
                        return (
                          <span className={cn('px-2.5 py-1 text-xs font-medium rounded-full capitalize', map[s] || 'bg-gray-100 text-gray-500')}>
                            {s ? titleCase(s) : 'Unknown'}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>

          <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPageChange={setPage} />
        </div>

      </div>
    </div>
  );
}
