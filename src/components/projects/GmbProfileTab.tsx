'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Save, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, formatDate } from '@/lib/utils';

interface GmbServiceAreaData { id: string; areaName: string; isTarget: boolean; targetStartDate: string | null }
interface GmbProfileData {
  id: string;
  name: string | null;
  address: string | null;
  contactNumber: string | null;
  gmbProfileUrl: string | null;
  websiteUrl: string | null;
  primaryCategory: string | null;
  secondaryCategories: string[];
  services: string[];
  status: 'draft' | 'completed';
  updatedAt: string;
  serviceAreas: GmbServiceAreaData[];
}

interface ServiceAreaRow { areaName: string; isTarget: boolean; targetStartDate: string }
interface FormState {
  name: string;
  address: string;
  contactNumber: string;
  gmbProfileUrl: string;
  websiteUrl: string;
  primaryCategory: string;
  secondaryCategories: string[];
  services: string[];
  serviceAreas: ServiceAreaRow[];
}

const EMPTY_FORM: FormState = {
  name: '',
  address: '',
  contactNumber: '',
  gmbProfileUrl: '',
  websiteUrl: '',
  primaryCategory: '',
  secondaryCategories: [],
  services: [],
  serviceAreas: [],
};

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function withScheme(url: string) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
}

/** True when a filled-in URL doesn't look like a Google Maps/Business link — a warning, not a block. */
function looksNonGoogle(url: string) {
  const v = url.trim();
  if (!v) return false;
  try {
    return !/google/i.test(new URL(withScheme(v)).hostname);
  } catch {
    return false;
  }
}

/** Type-and-Enter (or comma-paste) chip list with optional autocomplete suggestions. */
function TagInput({
  label, values, onChange, suggestions, required, warnAboveCount,
}: {
  label: string; values: string[]; onChange: (next: string[]) => void;
  suggestions?: string[]; required?: boolean; warnAboveCount?: number;
}) {
  const [draft, setDraft] = useState('');
  const listId = `taglist-${label.replace(/\W+/g, '-').toLowerCase()}`;

  function commit(raw: string) {
    const pieces = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!pieces.length) return;
    const next = [...values];
    for (const p of pieces) {
      if (!next.some((v) => v.toLowerCase() === p.toLowerCase())) next.push(p);
    }
    onChange(next);
    setDraft('');
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-lg min-h-[42px] focus-within:ring-2 focus-within:ring-brand-600 focus-within:border-brand-600">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-full">
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} className="p-0.5 hover:bg-gray-200 rounded-full">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          list={suggestions ? listId : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(draft); }
            else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={() => commit(draft)}
          placeholder="Type and press Enter, or paste comma-separated…"
          className="flex-1 min-w-[160px] text-sm outline-none py-0.5"
        />
        {suggestions && (
          <datalist id={listId}>
            {suggestions.filter((s) => !values.some((v) => v.toLowerCase() === s.toLowerCase())).map((s) => <option key={s} value={s} />)}
          </datalist>
        )}
      </div>
      {warnAboveCount && values.length > warnAboveCount && (
        <p className="text-xs text-amber-600 mt-1">{values.length} selected — Google caps secondary categories at {warnAboveCount}.</p>
      )}
    </div>
  );
}

function ServiceAreasCard({ areas, onChange }: { areas: ServiceAreaRow[]; onChange: (next: ServiceAreaRow[]) => void }) {
  const [draft, setDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [targetPick, setTargetPick] = useState('');
  const [targetDate, setTargetDate] = useState(todayInput());

  function addAreas(raw: string) {
    const pieces = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (!pieces.length) return;
    const next = [...areas];
    for (const p of pieces) {
      if (!next.some((a) => a.areaName.toLowerCase() === p.toLowerCase())) {
        next.push({ areaName: p, isTarget: false, targetStartDate: '' });
      }
    }
    onChange(next);
    setDraft('');
  }

  function removeArea(areaName: string) {
    onChange(areas.filter((a) => a.areaName !== areaName));
    setConfirmRemove(null);
  }

  function requestRemove(area: ServiceAreaRow) {
    if (area.isTarget) setConfirmRemove(area.areaName);
    else removeArea(area.areaName);
  }

  function addTarget() {
    if (!targetPick || !targetDate) return;
    onChange(areas.map((a) => (a.areaName === targetPick ? { ...a, isTarget: true, targetStartDate: targetDate } : a)));
    setTargetPick('');
  }

  function untarget(areaName: string) {
    onChange(areas.map((a) => (a.areaName === areaName ? { ...a, isTarget: false, targetStartDate: '' } : a)));
  }

  const targeted = areas.filter((a) => a.isTarget);
  const untargeted = areas.filter((a) => !a.isTarget);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <h2 className="text-sm font-semibold text-gray-900">Service Areas</h2>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Profile Service Areas <span className="text-red-500">*</span></label>
        <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-lg min-h-[42px] focus-within:ring-2 focus-within:ring-brand-600 focus-within:border-brand-600">
          {areas.map((a) => (
            <span
              key={a.areaName}
              className={cn(
                'inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-xs font-medium rounded-full',
                a.isTarget ? 'bg-brand-50 text-brand-800 ring-1 ring-brand-300' : 'bg-gray-100 text-gray-700',
              )}
            >
              {a.areaName}
              {a.isTarget && <span className="text-[10px] font-semibold uppercase tracking-wide">· Target</span>}
              <button type="button" onClick={() => requestRemove(a)} className="p-0.5 hover:bg-black/10 rounded-full">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAreas(draft); }
            }}
            onBlur={() => addAreas(draft)}
            placeholder="Type and press Enter, or paste comma-separated…"
            className="flex-1 min-w-[160px] text-sm outline-none py-0.5"
          />
        </div>
        <p className="text-xs text-gray-400 mt-1">Master list for this profile. Removing an area that&apos;s a target removes its targeting too.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Target Service Areas</label>
        {targeted.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden mb-2">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Service Area</th>
                  <th className="text-left font-medium px-3 py-2">Targeting Start Date</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {targeted.map((a) => (
                  <tr key={a.areaName} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-800">{a.areaName}</td>
                    <td className="px-3 py-2 text-gray-600">{a.targetStartDate ? formatDate(a.targetStartDate) : '—'}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => untarget(a.areaName)} className="text-xs font-medium text-red-600 hover:text-red-700">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={targetPick}
            onChange={(e) => setTargetPick(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          >
            <option value="">-- Select area --</option>
            {untargeted.map((a) => <option key={a.areaName} value={a.areaName}>{a.areaName}</option>)}
          </select>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
          <button
            type="button"
            onClick={addTarget}
            disabled={!targetPick || !targetDate}
            className="flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Dropdown only lists areas already added to Profile Service Areas above. Each target area stores its own start date.</p>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove target area"
        message={`"${confirmRemove}" is currently a target area. Removing it from Profile Service Areas will also remove its targeting.`}
        confirmLabel="Remove"
        onConfirm={() => confirmRemove && removeArea(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

interface Props {
  projectId: string;
  projectName: string;
  /** Whether the project is currently sitting on the GMB Profile workflow stage. */
  isProfileStage: boolean;
  /** Whether the current user may act on that stage (stage-owner assignment or admin). */
  canCompleteStage: boolean;
  /** Advances the project's workflow stage — called after a successful "complete" save while on the profile stage. */
  onStageComplete: () => Promise<unknown>;
}

export default function GmbProfileTab({ projectId, projectName, isProfileStage, canCompleteStage, onStageComplete }: Props) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: profile, isLoading } = useQuery<GmbProfileData | null>({
    queryKey: ['gmb-profile', projectId],
    queryFn: () => api.get(`/gmb/projects/${projectId}/profile`).then((r) => r.data),
  });

  const { data: suggestions } = useQuery<{ services: string[]; categories: string[] }>({
    queryKey: ['gmb-suggestions'],
    queryFn: () => api.get('/gmb/suggestions').then((r) => r.data),
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      name: profile.name || '',
      address: profile.address || '',
      contactNumber: profile.contactNumber || '',
      gmbProfileUrl: profile.gmbProfileUrl || '',
      websiteUrl: profile.websiteUrl || '',
      primaryCategory: profile.primaryCategory || '',
      secondaryCategories: profile.secondaryCategories || [],
      services: profile.services || [],
      serviceAreas: (profile.serviceAreas || []).map((a) => ({
        areaName: a.areaName, isTarget: a.isTarget, targetStartDate: a.targetStartDate || '',
      })),
    });
  }, [profile]);

  const saveProfile = useMutation({
    mutationFn: (mode: 'draft' | 'complete') => api.put(`/gmb/projects/${projectId}/profile`, { ...form, mode }).then((r) => r.data),
    onSuccess: async (data, mode) => {
      qc.setQueryData(['gmb-profile', projectId], data);
      qc.invalidateQueries({ queryKey: ['gmb-suggestions'] });
      if (mode === 'complete' && isProfileStage) {
        if (canCompleteStage) {
          try {
            await onStageComplete();
            toast.success('GMB Profile completed — stage advanced.');
            return;
          } catch {
            toast.success('GMB Profile completed.');
            toast.error('Could not advance the stage — you may not be assigned as the Project Strategist on this project.');
            return;
          }
        }
        toast.success('GMB Profile completed.');
        toast('An assigned Project Strategist (or admin) needs to advance the stage.', { icon: 'ℹ️' });
        return;
      }
      toast.success(mode === 'complete' ? 'GMB Profile completed.' : 'Draft saved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to save GMB Profile.'),
  });

  if (isLoading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-64 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    );
  }

  const nonGoogleWarning = looksNonGoogle(form.gmbProfileUrl);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2 text-xs text-gray-400">
        {profile && (
          <span className={cn(
            'px-2 py-0.5 rounded-full font-semibold',
            profile.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700',
          )}>
            {profile.status === 'completed' ? 'Completed' : 'Draft'}
          </span>
        )}
        {profile?.updatedAt && <span>Last saved {formatDate(profile.updatedAt, 'MMM d, yyyy · h:mm a')}</span>}
      </div>

      {/* Business details */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Business Details</h2>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Profile Name <span className="text-red-500">*</span></label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.slice(0, 150) }))}
            maxLength={150}
            placeholder={projectName}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Profile Address <span className="text-red-500">*</span></label>
          <textarea
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value.slice(0, 300) }))}
            maxLength={300}
            rows={2}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Contact Number <span className="text-red-500">*</span></label>
          <input
            value={form.contactNumber}
            onChange={(e) => setForm((f) => ({ ...f, contactNumber: e.target.value }))}
            placeholder="+1 (303) 555-0148"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Profile Link</label>
            <input
              value={form.gmbProfileUrl}
              onChange={(e) => setForm((f) => ({ ...f, gmbProfileUrl: e.target.value }))}
              placeholder="Google Business Profile listing or share URL"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
            />
            {nonGoogleWarning && <p className="text-xs text-amber-600 mt-1">This doesn&apos;t look like a Google Maps/Business link — you can still save it.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Website Address</label>
            <input
              value={form.websiteUrl}
              onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
              onBlur={() => setForm((f) => (f.websiteUrl.trim() ? { ...f, websiteUrl: withScheme(f.websiteUrl.trim()) } : f))}
              placeholder="https://…"
              className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
            />
          </div>
        </div>
      </div>

      {/* Services and categories */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Services and Categories</h2>
        <TagInput
          label="Services"
          required
          values={form.services}
          suggestions={suggestions?.services}
          onChange={(v) => setForm((f) => ({ ...f, services: v }))}
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Primary Category <span className="text-red-500">*</span></label>
          <input
            list="gmb-primary-category"
            value={form.primaryCategory}
            onChange={(e) => setForm((f) => ({
              ...f,
              primaryCategory: e.target.value,
              secondaryCategories: f.secondaryCategories.filter((c) => c.toLowerCase() !== e.target.value.trim().toLowerCase()),
            }))}
            placeholder="e.g. Roofing contractor"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
          <datalist id="gmb-primary-category">
            {(suggestions?.categories || []).map((c) => <option key={c} value={c} />)}
          </datalist>
          <p className="text-xs text-gray-400 mt-1">One value only.</p>
        </div>
        <TagInput
          label="Secondary Categories"
          values={form.secondaryCategories}
          suggestions={(suggestions?.categories || []).filter((c) => c.toLowerCase() !== form.primaryCategory.trim().toLowerCase())}
          warnAboveCount={9}
          onChange={(v) => setForm((f) => ({ ...f, secondaryCategories: v.filter((c) => c.toLowerCase() !== f.primaryCategory.trim().toLowerCase()) }))}
        />
        <p className="text-xs text-gray-400 -mt-2">Cannot contain the primary category.</p>
      </div>

      {/* Service areas */}
      <ServiceAreasCard areas={form.serviceAreas} onChange={(v) => setForm((f) => ({ ...f, serviceAreas: v }))} />

      <div className="flex justify-end gap-2">
        <button
          onClick={() => saveProfile.mutate('draft')}
          disabled={saveProfile.isPending}
          className="flex items-center gap-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          Save Draft
        </button>
        <button
          onClick={() => saveProfile.mutate('complete')}
          disabled={saveProfile.isPending}
          className="flex items-center gap-2 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          Save and Complete
        </button>
      </div>
    </div>
  );
}
