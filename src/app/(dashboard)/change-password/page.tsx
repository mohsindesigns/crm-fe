'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import Header from '@/components/layout/Header';

export default function ChangePasswordPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  const isForced = !!user?.mustChangePassword;

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: '' }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.currentPassword) errs.currentPassword = 'Current password is required.';
    if (form.newPassword.length < 8) errs.newPassword = 'New password must be at least 8 characters.';
    if (form.newPassword && form.newPassword === form.currentPassword)
      errs.newPassword = 'New password must be different from the current one.';
    if (form.confirm !== form.newPassword) errs.confirm = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }

    setLoading(true);
    try {
      await api.post(`/users/${user!.id}/change-password`, {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      updateUser({ mustChangePassword: false });
      toast.success('Password updated successfully.');
      router.replace('/dashboard');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to update password.';
      toast.error(msg);
      if (msg.toLowerCase().includes('current')) {
        setErrors({ currentPassword: msg });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Change Password" />
      <div className="flex-1 overflow-y-auto p-6 flex items-start justify-center">
        <div className="w-full max-w-md mt-8">

          {isForced && (
            <div className="mb-5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3.5">
              <p className="text-sm font-medium text-amber-800">Password change required</p>
              <p className="text-xs text-amber-600 mt-0.5">
                Your account was created with a temporary password. Please set a permanent password to continue.
              </p>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-brand-700" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Set new password</h2>
                <p className="text-xs text-gray-400 mt-0.5">Minimum 8 characters</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Current password */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Current password</label>
                <div className="relative">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={form.currentPassword}
                    onChange={(e) => set('currentPassword', e.target.value)}
                    placeholder="Enter your current password"
                    className={`w-full px-3.5 py-2.5 pr-10 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                      errors.currentPassword
                        ? 'border-red-400 focus:ring-red-200 bg-red-50'
                        : 'border-gray-300 focus:ring-brand-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.currentPassword && <p className="text-xs text-red-600 mt-1">{errors.currentPassword}</p>}
              </div>

              {/* New password */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">New password</label>
                <div className="relative">
                  <input
                    type={showNew ? 'text' : 'password'}
                    value={form.newPassword}
                    onChange={(e) => set('newPassword', e.target.value)}
                    placeholder="At least 8 characters"
                    className={`w-full px-3.5 py-2.5 pr-10 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                      errors.newPassword
                        ? 'border-red-400 focus:ring-red-200 bg-red-50'
                        : 'border-gray-300 focus:ring-brand-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.newPassword && <p className="text-xs text-red-600 mt-1">{errors.newPassword}</p>}
              </div>

              {/* Confirm */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1.5">Confirm new password</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(e) => set('confirm', e.target.value)}
                    placeholder="Repeat new password"
                    className={`w-full px-3.5 py-2.5 pr-10 text-sm border rounded-lg focus:outline-none focus:ring-2 transition-colors ${
                      errors.confirm
                        ? 'border-red-400 focus:ring-red-200 bg-red-50'
                        : 'border-gray-300 focus:ring-brand-600'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.confirm && <p className="text-xs text-red-600 mt-1">{errors.confirm}</p>}
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2.5 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {loading ? 'Updating…' : 'Update Password'}
                </button>
                {!isForced && (
                  <button
                    type="button"
                    onClick={() => router.back()}
                    className="px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
