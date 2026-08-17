'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase, Building2, Mail, MessageSquare, Phone, X } from 'lucide-react';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import { BRAND } from '@/lib/brand';
import { cn, titleCase } from '@/lib/utils';

type PublicProfileModalProps = {
  userId: string | null;
  onClose: () => void;
  /** Optional — e.g. open a DM with this person from Messages. */
  onMessage?: (userId: string) => void;
  /** "Active now" / "last seen …". Supplied by the caller, which holds the socket. */
  presenceText?: string | null;
  isOnline?: boolean;
};

export default function PublicProfileModal({
  userId, onClose, onMessage, presenceText, isOnline,
}: PublicProfileModalProps) {
  const { data: profile, isLoading, isError } = useQuery({
    queryKey: ['user-public-profile', userId],
    queryFn: () => api.get(`/users/${userId}/public`).then((r) => r.data),
    enabled: !!userId,
  });

  if (!userId) return null;

  const title = profile?.designation || profile?.role?.name || null;
  const roleLabel = profile?.role?.name;
  const showRoleChip = roleLabel && roleLabel !== title;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl shadow-brand-900/20 animate-msg-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        {/* Cover */}
        <div
          className="relative h-28"
          style={{
            background: `
              radial-gradient(ellipse 80% 120% at 20% 0%, rgba(244,196,48,0.35), transparent 55%),
              linear-gradient(145deg, ${BRAND.primaryDark} 0%, ${BRAND.primary} 45%, ${BRAND.primaryLight} 100%)
            `,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-full bg-black/20 text-white/90 hover:bg-black/30 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
          <div
            className="absolute inset-x-0 bottom-0 h-16"
            style={{ background: 'linear-gradient(to top, white, transparent)' }}
          />
        </div>

        <div className="relative px-6 pb-6 -mt-12">
          {isLoading && (
            <div className="pt-16 pb-8 text-center text-sm text-gray-400">Loading…</div>
          )}
          {isError && (
            <div className="pt-16 pb-8 text-center text-sm text-red-600">Couldn’t load profile.</div>
          )}

          {profile && !isLoading && (
            <>
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <div
                    className="absolute -inset-1 rounded-full opacity-90"
                    style={{ background: `linear-gradient(135deg, ${BRAND.accent}, ${BRAND.primaryLight})` }}
                  />
                  <Avatar
                    src={profile.avatarUrl}
                    name={profile.name}
                    size="xl"
                    className="relative ring-4 ring-white shadow-lg"
                  />
                </div>

                <h2 id="profile-title" className="mt-4 text-xl font-semibold text-brand-900 tracking-tight">
                  {profile.name}
                </h2>
                {title && (
                  <p className="mt-1 text-sm text-gray-500 font-medium">{title}</p>
                )}

                {/* Presence, WhatsApp-style. Passed in rather than fetched: the
                    live online set lives on the chat's socket connection, and
                    this modal has no socket of its own. */}
                {presenceText && (
                  <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: isOnline ? '#22c55e' : '#cbd5e1' }}
                    />
                    <span className={isOnline ? 'text-emerald-600 font-medium' : 'text-gray-400'}>
                      {presenceText}
                    </span>
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
                  {showRoleChip && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        backgroundColor: `${profile.role.color || BRAND.primary}14`,
                        color: profile.role.color || BRAND.primary,
                      }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: profile.role.color || BRAND.primary }}
                      />
                      {roleLabel}
                    </span>
                  )}
                  {profile.department && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                      <Building2 className="w-3 h-3" />
                      {profile.department}
                    </span>
                  )}
                  {profile.workerType && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                      <Briefcase className="w-3 h-3" />
                      {titleCase(profile.workerType)}
                    </span>
                  )}
                </div>
              </div>

              {/* Quick actions */}
              <div
                className={cn(
                  'mt-6 grid gap-2',
                  [onMessage, profile.email, profile.phone].filter(Boolean).length >= 3
                    ? 'grid-cols-3'
                    : [onMessage, profile.email, profile.phone].filter(Boolean).length === 2
                      ? 'grid-cols-2'
                      : 'grid-cols-1',
                )}
              >
                {onMessage && (
                  <button
                    type="button"
                    onClick={() => onMessage(profile.id)}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-2xl text-brand-900 shadow-sm hover:scale-[1.02] transition-transform"
                    style={{ backgroundColor: BRAND.accent }}
                  >
                    <MessageSquare className="w-5 h-5" />
                    <span className="text-[11px] font-semibold">Message</span>
                  </button>
                )}
                {profile.email && (
                  <a
                    href={`mailto:${profile.email}`}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-brand-50 text-brand-800 hover:bg-brand-100 transition-colors"
                  >
                    <Mail className="w-5 h-5" />
                    <span className="text-[11px] font-semibold">Email</span>
                  </a>
                )}
                {profile.phone && (
                  <a
                    href={`tel:${profile.phone}`}
                    className="flex flex-col items-center gap-1.5 py-3 rounded-2xl bg-slate-50 text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <Phone className="w-5 h-5" />
                    <span className="text-[11px] font-semibold">Call</span>
                  </a>
                )}
              </div>

              {(profile.email || profile.phone) && (
                <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/80 divide-y divide-slate-100 overflow-hidden">
                  {profile.email && (
                    <a
                      href={`mailto:${profile.email}`}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-white transition-colors group"
                    >
                      <span className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-brand-700 group-hover:border-brand-200">
                        <Mail className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 text-left">
                        <p className="text-[11px] text-slate-400 font-medium">Email</p>
                        <p className="text-sm font-semibold text-brand-900 truncate">{profile.email}</p>
                      </div>
                    </a>
                  )}
                  {profile.phone && (
                    <a
                      href={`tel:${profile.phone}`}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-white transition-colors group"
                    >
                      <span className="w-9 h-9 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-brand-700 group-hover:border-brand-200">
                        <Phone className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 text-left">
                        <p className="text-[11px] text-slate-400 font-medium">Phone</p>
                        <p className="text-sm font-semibold text-brand-900 truncate">{profile.phone}</p>
                      </div>
                    </a>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
