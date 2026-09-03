'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X, Star, Trash2, Save, Download, Upload, History as HistoryIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import { cn, downloadAuthedFile, uploadErrorMessage } from '@/lib/utils';

interface GmbPhone { id: string; phoneNumber: string; isPrimary: boolean }
interface GmbAddress { id: string; address: string; isPrimary: boolean }
interface GmbKeywordRank { id: string; keyword: string; rank: number | null; checkedOn: string }
interface GmbProfileData {
  id: string;
  gmbProfileUrl: string | null;
  websiteUrl: string | null;
  primaryCategories: string[];
  secondaryCategories: string[];
  serviceAreasTotal: string[];
  serviceAreasActive: string[];
  keywordsPrimary: string[];
  keywordsSecondary: string[];
  keywordsRanking: string[];
  phones: GmbPhone[];
  addresses: GmbAddress[];
  keywordRanks: GmbKeywordRank[];
}

interface FormState {
  gmbProfileUrl: string;
  websiteUrl: string;
  primaryCategories: string[];
  secondaryCategories: string[];
  serviceAreasTotal: string[];
  serviceAreasActive: string[];
  keywordsPrimary: string[];
  keywordsSecondary: string[];
  keywordsRanking: string[];
}

const EMPTY_FORM: FormState = {
  gmbProfileUrl: '',
  websiteUrl: '',
  primaryCategories: [],
  secondaryCategories: [],
  serviceAreasTotal: [],
  serviceAreasActive: [],
  keywordsPrimary: [],
  keywordsSecondary: [],
  keywordsRanking: [],
};

/** Type-and-Enter (or comma) chip list — no reusable multi-value input exists elsewhere in this app. */
function TagInput({ label, values, onChange }: { label: string; values: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('');

  function commit() {
    const v = draft.trim();
    if (!v) return;
    if (!values.some((existing) => existing.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v]);
    }
    setDraft('');
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !draft && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={commit}
          placeholder="Type and press Enter…"
          className="flex-1 min-w-[140px] text-sm outline-none py-0.5"
        />
      </div>
    </div>
  );
}

function ContactRow({
  value, isPrimary, placeholder, onSave, onSetPrimary, onDelete, pending,
}: {
  value: string; isPrimary: boolean; placeholder: string;
  onSave: (next: string) => void; onSetPrimary: () => void; onDelete: () => void; pending: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() && draft !== value) onSave(draft.trim()); }}
        placeholder={placeholder}
        disabled={pending}
        className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600 disabled:bg-gray-50"
      />
      {isPrimary ? (
        <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100 rounded-lg whitespace-nowrap">
          <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> Active
        </span>
      ) : (
        <button
          type="button"
          onClick={onSetPrimary}
          disabled={pending}
          title="Mark as currently active"
          className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
        >
          <Star className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

function AddRow({ placeholder, onAdd, pending }: { placeholder: string; onAdd: (value: string) => void; pending: boolean }) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) { e.preventDefault(); onAdd(value.trim()); setValue(''); }
        }}
        placeholder={placeholder}
        disabled={pending}
        className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600 disabled:bg-gray-50"
      />
      <button
        type="button"
        onClick={() => { if (value.trim()) { onAdd(value.trim()); setValue(''); } }}
        disabled={pending || !value.trim()}
        className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800 bg-brand-50 hover:bg-brand-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
      >
        <Plus className="w-3.5 h-3.5" /> Add
      </button>
    </div>
  );
}

function todayInput() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function KeywordRankingCard({
  keywords, ranks, onAddRank, addPending, onDeleteRank, deletePending, onExport, onImport, importPending,
}: {
  keywords: string[];
  ranks: GmbKeywordRank[];
  onAddRank: (payload: { keyword: string; rank: string; checkedOn: string }) => void;
  addPending: boolean;
  onDeleteRank: (id: string) => void;
  deletePending: boolean;
  onExport: () => void;
  onImport: (file: File) => void;
  importPending: boolean;
}) {
  const [keyword, setKeyword] = useState('');
  const [rank, setRank] = useState('');
  const [checkedOn, setCheckedOn] = useState(todayInput());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const historyByKeyword = new Map<string, GmbKeywordRank[]>();
  for (const r of ranks) {
    if (!historyByKeyword.has(r.keyword)) historyByKeyword.set(r.keyword, []);
    historyByKeyword.get(r.keyword)!.push(r);
  }
  // Every tracked keyword gets a row, even ones with no ranking recorded yet.
  const allKeywords = [...new Set([...keywords, ...historyByKeyword.keys()])];

  function toggle(kw: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kw)) next.delete(kw); else next.add(kw);
      return next;
    });
  }

  function submit() {
    const kw = keyword.trim();
    if (!kw) return;
    onAddRank({ keyword: kw, rank, checkedOn });
    setKeyword('');
    setRank('');
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">Keyword Ranking</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExport}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={importPending}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-800 bg-gray-50 hover:bg-gray-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" /> {importPending ? 'Importing…' : 'Import CSV'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => { if (e.target.files?.[0]) onImport(e.target.files[0]); e.target.value = ''; }}
          />
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-2">
        CSV columns: Keyword (required), Rank, Date. Importing adds any new keywords to the list below automatically.
      </p>

      {/* Record a ranking */}
      <div className="flex flex-wrap items-end gap-2 p-3 bg-gray-50 rounded-lg">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Keyword</label>
          <input
            list="gmb-ranking-keywords"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Keyword"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
          <datalist id="gmb-ranking-keywords">
            {keywords.map((k) => <option key={k} value={k} />)}
          </datalist>
        </div>
        <div className="w-24">
          <label className="block text-xs font-medium text-gray-500 mb-1">Rank</label>
          <input
            type="number"
            min={1}
            value={rank}
            onChange={(e) => setRank(e.target.value)}
            placeholder="e.g. 5"
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
        <div className="w-40">
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input
            type="date"
            value={checkedOn}
            onChange={(e) => setCheckedOn(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={addPending || !keyword.trim()}
          className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <Plus className="w-3.5 h-3.5" /> Record
        </button>
      </div>

      {/* Keyword list + history */}
      {allKeywords.length === 0 ? (
        <p className="text-xs text-gray-400">No ranking keywords yet — add one above, or in the Keywords section below.</p>
      ) : (
        <div className="space-y-2">
          {allKeywords.map((kw) => {
            const history = (historyByKeyword.get(kw) || []).slice().sort((a, b) => b.checkedOn.localeCompare(a.checkedOn));
            const latest = history[0];
            const isOpen = expanded.has(kw);
            return (
              <div key={kw} className="border border-gray-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => toggle(kw)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors rounded-lg"
                >
                  <span className="text-sm font-medium text-gray-800 truncate">{kw}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {latest ? (
                      <span className="text-xs font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-full">
                        Rank {latest.rank ?? '—'} <span className="text-gray-400 font-normal">· {latest.checkedOn}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">No rankings yet</span>
                    )}
                    <span className="flex items-center gap-1 text-xs text-gray-400">
                      <HistoryIcon className="w-3 h-3" /> {history.length}
                      {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </span>
                  </span>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 px-3 py-2 space-y-1">
                    {history.length === 0 ? (
                      <p className="text-xs text-gray-400 py-1">No rankings recorded yet.</p>
                    ) : history.map((h) => (
                      <div key={h.id} className="flex items-center justify-between gap-2 text-xs text-gray-600 py-1">
                        <span>{h.checkedOn}</span>
                        <span className="font-semibold text-gray-800">Rank {h.rank ?? '—'}</span>
                        <button
                          type="button"
                          onClick={() => onDeleteRank(h.id)}
                          disabled={deletePending}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function GmbProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const { data: project, isLoading: projectLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then((r) => r.data),
  });

  const { data: profile, isLoading: profileLoading } = useQuery<GmbProfileData | null>({
    queryKey: ['gmb-profile', id],
    queryFn: () => api.get(`/gmb/projects/${id}/profile`).then((r) => r.data),
    enabled: !!project && project.serviceTypeKey === 'gmb',
  });

  useEffect(() => {
    if (!profile) return;
    setForm({
      gmbProfileUrl: profile.gmbProfileUrl || '',
      websiteUrl: profile.websiteUrl || '',
      primaryCategories: profile.primaryCategories || [],
      secondaryCategories: profile.secondaryCategories || [],
      serviceAreasTotal: profile.serviceAreasTotal || [],
      serviceAreasActive: profile.serviceAreasActive || [],
      keywordsPrimary: profile.keywordsPrimary || [],
      keywordsSecondary: profile.keywordsSecondary || [],
      keywordsRanking: profile.keywordsRanking || [],
    });
  }, [profile]);

  function setProfileCache(data: GmbProfileData) {
    qc.setQueryData(['gmb-profile', id], data);
  }

  const saveProfile = useMutation({
    mutationFn: (payload: FormState) => api.put(`/gmb/projects/${id}/profile`, payload).then((r) => r.data),
    onSuccess: (data) => { setProfileCache(data); toast.success('GMB Profile saved.'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to save GMB Profile.'),
  });

  const addPhone = useMutation({
    mutationFn: (phoneNumber: string) => api.post(`/gmb/profile/${profile!.id}/phones`, { phoneNumber }).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to add phone number.'),
  });
  const updatePhone = useMutation({
    mutationFn: ({ phoneId, phoneNumber }: { phoneId: string; phoneNumber: string }) =>
      api.patch(`/gmb/phones/${phoneId}`, { phoneNumber }).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update phone number.'),
  });
  const deletePhone = useMutation({
    mutationFn: (phoneId: string) => api.delete(`/gmb/phones/${phoneId}`).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to remove phone number.'),
  });
  const setPrimaryPhone = useMutation({
    mutationFn: (phoneId: string) => api.post(`/gmb/phones/${phoneId}/primary`).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update active phone number.'),
  });

  const addAddress = useMutation({
    mutationFn: (address: string) => api.post(`/gmb/profile/${profile!.id}/addresses`, { address }).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to add address.'),
  });
  const updateAddress = useMutation({
    mutationFn: ({ addressId, address }: { addressId: string; address: string }) =>
      api.patch(`/gmb/addresses/${addressId}`, { address }).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update address.'),
  });
  const deleteAddress = useMutation({
    mutationFn: (addressId: string) => api.delete(`/gmb/addresses/${addressId}`).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to remove address.'),
  });
  const setPrimaryAddress = useMutation({
    mutationFn: (addressId: string) => api.post(`/gmb/addresses/${addressId}/primary`).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to update active address.'),
  });

  const addKeywordRank = useMutation({
    mutationFn: (payload: { keyword: string; rank: string; checkedOn: string }) =>
      api.post(`/gmb/profile/${profile!.id}/keyword-ranks`, {
        keyword: payload.keyword,
        rank: payload.rank === '' ? null : Number(payload.rank),
        checkedOn: payload.checkedOn,
      }).then((r) => r.data),
    onSuccess: (data) => { setProfileCache(data); toast.success('Ranking recorded.'); },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to record ranking.'),
  });
  const deleteKeywordRank = useMutation({
    mutationFn: (rankId: string) => api.delete(`/gmb/keyword-ranks/${rankId}`).then((r) => r.data),
    onSuccess: setProfileCache,
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Failed to remove ranking entry.'),
  });
  const importKeywords = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/gmb/projects/${id}/keywords/import`, fd).then((r) => r.data);
    },
    onSuccess: (data) => {
      setProfileCache(data.profile);
      toast.success(`Imported ${data.imported} row(s) — ${data.keywordsAdded} new keyword(s), ${data.ranksRecorded} ranking(s) recorded.`);
      if (data.errors?.length) toast.error(`${data.errors.length} row(s) skipped: ${data.errors.slice(0, 3).join(' · ')}`);
    },
    onError: (e: any) => toast.error(uploadErrorMessage(e)),
  });

  async function exportKeywordsCsv() {
    try {
      await downloadAuthedFile(`/gmb/projects/${id}/keywords/csv`, `gmb-keywords-${id}.csv`);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export CSV.');
    }
  }

  const isLoading = projectLoading || (project?.serviceTypeKey === 'gmb' && profileLoading);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="GMB Profile" />
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 animate-pulse">
            <div className="h-24 bg-gray-100 rounded-xl" />
            <div className="h-64 bg-gray-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!project || project.serviceTypeKey !== 'gmb') {
    return (
      <div className="flex flex-col h-full">
        <Header title="GMB Profile" />
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-4xl mx-auto text-sm text-gray-500">
            GMB Profile is only available for GMB projects.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="GMB Profile" />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
          <button onClick={() => router.push(`/projects/${id}`)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back to project
          </button>

          {/* Profile basics */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Profile Details</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Project Name</label>
              <input value={project.name} disabled className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-500" />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">GMB Profile URL</label>
                <input
                  value={form.gmbProfileUrl}
                  onChange={(e) => setForm((f) => ({ ...f, gmbProfileUrl: e.target.value }))}
                  placeholder="https://g.page/…"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Website URL</label>
                <input
                  value={form.websiteUrl}
                  onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
                  placeholder="https://…"
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600"
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <TagInput label="Primary Category" values={form.primaryCategories} onChange={(v) => setForm((f) => ({ ...f, primaryCategories: v }))} />
              <TagInput label="Secondary Category" values={form.secondaryCategories} onChange={(v) => setForm((f) => ({ ...f, secondaryCategories: v }))} />
            </div>
          </div>

          {/* Phone numbers */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Phone Numbers</h2>
            {profile?.phones.map((p) => (
              <ContactRow
                key={p.id}
                value={p.phoneNumber}
                isPrimary={p.isPrimary}
                placeholder="Phone number"
                pending={updatePhone.isPending || deletePhone.isPending || setPrimaryPhone.isPending}
                onSave={(next) => updatePhone.mutate({ phoneId: p.id, phoneNumber: next })}
                onSetPrimary={() => setPrimaryPhone.mutate(p.id)}
                onDelete={() => deletePhone.mutate(p.id)}
              />
            ))}
            {profile?.id ? (
              <AddRow placeholder="Add a phone number…" pending={addPhone.isPending} onAdd={(v) => addPhone.mutate(v)} />
            ) : (
              <p className="text-xs text-gray-400">Save the profile details below before adding phone numbers.</p>
            )}
          </div>

          {/* Addresses */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Addresses</h2>
            {profile?.addresses.map((a) => (
              <ContactRow
                key={a.id}
                value={a.address}
                isPrimary={a.isPrimary}
                placeholder="Address"
                pending={updateAddress.isPending || deleteAddress.isPending || setPrimaryAddress.isPending}
                onSave={(next) => updateAddress.mutate({ addressId: a.id, address: next })}
                onSetPrimary={() => setPrimaryAddress.mutate(a.id)}
                onDelete={() => deleteAddress.mutate(a.id)}
              />
            ))}
            {profile?.id ? (
              <AddRow placeholder="Add an address…" pending={addAddress.isPending} onAdd={(v) => addAddress.mutate(v)} />
            ) : (
              <p className="text-xs text-gray-400">Save the profile details below before adding addresses.</p>
            )}
          </div>

          {/* Service areas */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Service Areas</h2>
            <TagInput
              label="Service Areas — Total"
              values={form.serviceAreasTotal}
              onChange={(v) => setForm((f) => ({
                ...f,
                serviceAreasTotal: v,
                // Dropping an area from the total list drops it from "we work" too.
                serviceAreasActive: f.serviceAreasActive.filter((a) => v.some((x) => x.toLowerCase() === a.toLowerCase())),
              }))}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Service Areas — We Work Right Now</label>
              {form.serviceAreasTotal.length === 0 ? (
                <p className="text-xs text-gray-400">Add areas to the total list above first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {form.serviceAreasTotal.map((area) => {
                    const active = form.serviceAreasActive.some((a) => a.toLowerCase() === area.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={area}
                        onClick={() => setForm((f) => ({
                          ...f,
                          serviceAreasActive: active
                            ? f.serviceAreasActive.filter((a) => a.toLowerCase() !== area.toLowerCase())
                            : [...f.serviceAreasActive, area],
                        }))}
                        className={cn(
                          'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                          active ? 'bg-brand-700 text-white border-brand-700' : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400',
                        )}
                      >
                        {area}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Keywords */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900">Keywords</h2>
            <TagInput label="Keywords — Primary" values={form.keywordsPrimary} onChange={(v) => setForm((f) => ({ ...f, keywordsPrimary: v }))} />
            <TagInput label="Keywords — Secondary" values={form.keywordsSecondary} onChange={(v) => setForm((f) => ({ ...f, keywordsSecondary: v }))} />
            <TagInput label="Keywords — Ranking" values={form.keywordsRanking} onChange={(v) => setForm((f) => ({ ...f, keywordsRanking: v }))} />
          </div>

          {/* Keyword ranking history + CSV import/export */}
          {profile?.id ? (
            <KeywordRankingCard
              keywords={profile.keywordsRanking || []}
              ranks={profile.keywordRanks || []}
              onAddRank={(payload) => addKeywordRank.mutate(payload)}
              addPending={addKeywordRank.isPending}
              onDeleteRank={(rankId) => deleteKeywordRank.mutate(rankId)}
              deletePending={deleteKeywordRank.isPending}
              onExport={exportKeywordsCsv}
              onImport={(file) => importKeywords.mutate(file)}
              importPending={importKeywords.isPending}
            />
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h2 className="text-sm font-semibold text-gray-900 mb-1">Keyword Ranking</h2>
              <p className="text-xs text-gray-400">Save the profile details below before tracking keyword rankings.</p>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={() => saveProfile.mutate(form)}
              disabled={saveProfile.isPending}
              className="flex items-center gap-2 text-sm font-semibold text-white bg-brand-700 hover:bg-brand-800 px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saveProfile.isPending ? 'Saving…' : 'Save GMB Profile'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
