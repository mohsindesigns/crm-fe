'use client';

/**
 * Admin → Export Data.
 *
 * Two independent choices, side by side, that together make one CSV:
 *
 *   WHAT (left)  — which columns. Opens on the "Bank Details" preset with every
 *                  bank column already ticked, because that is the sheet this
 *                  screen was built for; anything else in the catalog can be
 *                  ticked on top without leaving the preset behind.
 *   WHO (right)  — which employees. Multi-select with search + filters, so one
 *                  export covers a department, a shortlist, or everyone.
 *
 * A saved template stores only the column selection, never the people — the
 * point is to build the payroll sheet once and then re-run it every month
 * against whoever is being paid that month.
 *
 * Backend contract: crm-be/src/routes/exports.js (+ ExportService's field
 * catalog, which is what `schema` here renders — this file hardcodes no column
 * names of its own, so a field added on the server appears here for free).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Download, Save, Trash2, Search, Users, Columns3, FileSpreadsheet,
  ShieldAlert, Check, X, RotateCcw, Bookmark, Loader2, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import Avatar from '@/components/Avatar';
import AdminModal from '@/components/admin/AdminModal';
import ConfirmDialog from '@/components/ConfirmDialog';
import { cn, titleCase, postAuthedFile } from '@/lib/utils';

// ─── Types (mirror ExportService's response shapes) ───────────────────────────

type SchemaField = { key: string; label: string; locked: boolean; sensitive: boolean };
type SchemaGroup = { key: string; label: string; fields: SchemaField[] };
type Preset = { key: string; label: string; description: string; isDefault: boolean; fields: string[] };
type ExportSchema = { dataset: string; groups: SchemaGroup[]; presets: Preset[]; lockedFields: string[] };

type Employee = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  designation: string;
  department: string;
  status: string;
  workerType: string;
  hasBankDetails: boolean;
};

type Filters = { departments: string[]; statuses: string[]; workerTypes: string[] };

type Template = {
  id: string;
  name: string;
  dataset: string;
  fields: string[];
  creator: { id: string; name: string } | null;
};

const inp = 'w-full px-3 py-2 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600';
const btn = 'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50';
const btnPrimary = `${btn} bg-brand-700 hover:bg-brand-800 text-white`;
const btnGhost = `${btn} border border-gray-300 hover:bg-gray-50 text-gray-700`;

function errMessage(e: any, fallback: string) {
  return e?.response?.data?.message || e?.message || fallback;
}

/** Square checkbox that reads as checked / unchecked / partially-checked. */
function CheckBox({ state, className }: { state: 'on' | 'off' | 'some'; className?: string }) {
  return (
    <span
      className={cn(
        'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
        state === 'off' ? 'border-gray-300 bg-white' : 'border-brand-700 bg-brand-700',
        className,
      )}
    >
      {state === 'on' && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      {state === 'some' && <span className="w-2 h-0.5 bg-white rounded-full" />}
    </span>
  );
}

// ─── Column picker ────────────────────────────────────────────────────────────

function ColumnPicker({
  schema, selected, onToggle, onToggleGroup,
}: {
  schema: ExportSchema;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleGroup: (group: SchemaGroup, next: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      {schema.groups.map((group) => {
        // Locked fields are always on, so they don't count toward "is this group
        // fully selected?" — otherwise the Identity group could never be cleared.
        const toggleable = group.fields.filter((f) => !f.locked);
        const onCount = toggleable.filter((f) => selected.has(f.key)).length;
        const groupState = onCount === 0 ? 'off' : onCount === toggleable.length ? 'on' : 'some';

        return (
          <div key={group.key} className="border border-gray-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => onToggleGroup(group, groupState !== 'on')}
              disabled={!toggleable.length}
              className="w-full flex items-center gap-2 px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left disabled:hover:bg-gray-50"
            >
              <CheckBox state={groupState} />
              <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{group.label}</span>
              <span className="text-[11px] text-gray-400 ml-auto">
                {onCount}/{toggleable.length || group.fields.length}
              </span>
            </button>

            <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
              {group.fields.map((f) => {
                const on = f.locked || selected.has(f.key);
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => !f.locked && onToggle(f.key)}
                    disabled={f.locked}
                    title={f.locked ? 'Always included — every row needs a name against it.' : undefined}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                      f.locked ? 'cursor-default opacity-70' : 'hover:bg-gray-50',
                    )}
                  >
                    <CheckBox state={on ? 'on' : 'off'} />
                    <span className="text-sm text-gray-700 truncate">{f.label}</span>
                    {f.sensitive && (
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-500 shrink-0 ml-auto" aria-label="Sensitive data" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Employee picker ──────────────────────────────────────────────────────────

function EmployeePicker({
  employees, loading, selected, onToggle, onSetMany,
  search, setSearch, department, setDepartment, status, setStatus, workerType, setWorkerType, filters,
}: {
  employees: Employee[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSetMany: (ids: string[], next: boolean) => void;
  search: string; setSearch: (v: string) => void;
  department: string; setDepartment: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  workerType: string; setWorkerType: (v: string) => void;
  filters?: Filters;
}) {
  const visibleIds = employees.map((e) => e.id);
  const visibleOn = visibleIds.filter((id) => selected.has(id)).length;
  const allState = visibleOn === 0 ? 'off' : visibleOn === visibleIds.length ? 'on' : 'some';

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, designation…"
            className={cn(inp, 'pl-9')}
          />
        </div>
        <select value={department} onChange={(e) => setDepartment(e.target.value)} className={cn(inp, 'sm:w-44')}>
          <option value="">All departments</option>
          {(filters?.departments || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={cn(inp, 'sm:w-40')}>
          <option value="">All statuses</option>
          {(filters?.statuses || []).map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>
        {/* Employees and contractors are paid through different routes, so a
            disbursement sheet usually wants one or the other, not both. */}
        <select value={workerType} onChange={(e) => setWorkerType(e.target.value)} className={cn(inp, 'sm:w-36')}>
          <option value="">All types</option>
          {(filters?.workerTypes || []).map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
        </select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onSetMany(visibleIds, allState !== 'on')}
          disabled={!visibleIds.length}
          className="inline-flex items-center gap-2 text-xs font-medium text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          <CheckBox state={allState} />
          {allState === 'on' ? 'Clear all shown' : 'Select all shown'}
          <span className="text-gray-400">({visibleIds.length})</span>
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => onSetMany([...selected], false)}
            className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
          >
            <X className="w-3.5 h-3.5" /> Deselect {selected.size}
          </button>
        )}
      </div>

      <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
        {loading && (
          <p className="px-3 py-6 text-sm text-gray-400 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading employees…
          </p>
        )}
        {!loading && !employees.length && (
          <p className="px-3 py-6 text-sm text-gray-400">No employees match these filters.</p>
        )}
        {employees.map((e) => {
          const on = selected.has(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onToggle(e.id)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors',
                on ? 'bg-brand-50/60' : 'hover:bg-gray-50',
              )}
            >
              <CheckBox state={on ? 'on' : 'off'} />
              <Avatar src={e.avatarUrl} name={e.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{e.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {[e.designation, e.department].filter(Boolean).join(' · ') || e.email}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!e.hasBankDetails && (
                  <span
                    title="No bank details on file — bank columns will be blank for this employee."
                    className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-amber-50 text-amber-700"
                  >
                    No bank
                  </span>
                )}
                {e.status !== 'active' && (
                  <span className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-gray-100 text-gray-500">
                    {titleCase(e.status)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export default function ExportDataTab() {
  const qc = useQueryClient();

  // `null` means "the user hasn't touched the columns yet", which is what makes
  // the screen open on the default preset without an effect that writes state on
  // first render. Any interaction replaces it with a real Set.
  const [customFields, setCustomFields] = useState<Set<string> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [presetOverride, setPresetOverride] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string>('');

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [workerType, setWorkerType] = useState('');

  const [saveOpen, setSaveOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: schema } = useQuery<ExportSchema>({
    queryKey: ['export-schema', 'employees'],
    queryFn: () => api.get('/exports/employees/schema').then((r) => r.data),
  });

  const { data: filters } = useQuery<Filters>({
    queryKey: ['export-employee-filters'],
    queryFn: () => api.get('/exports/employees/filters').then((r) => r.data),
  });

  // Search is filtered server-side along with the dropdowns so the "select all
  // shown" button always means exactly the rows the backend would export.
  const { data: employees = [], isFetching: employeesLoading } = useQuery<Employee[]>({
    queryKey: ['export-employees', search, department, status, workerType],
    queryFn: () => api.get('/exports/employees', {
      params: {
        search: search || undefined,
        department: department || undefined,
        status: status || undefined,
        workerType: workerType || undefined,
      },
    }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  const { data: templates = [] } = useQuery<Template[]>({
    queryKey: ['export-templates', 'employees'],
    queryFn: () => api.get('/exports/templates', { params: { dataset: 'employees' } }).then((r) => r.data),
  });

  // The sheet this screen exists to produce: Bank Details, every bank column
  // already ticked, before the user does anything at all.
  const defaultPreset = useMemo(
    () => schema?.presets.find((p) => p.isDefault) || schema?.presets[0] || null,
    [schema],
  );
  const selectedFields = useMemo(
    () => customFields ?? new Set(defaultPreset?.fields || []),
    [customFields, defaultPreset],
  );
  const activePreset = presetOverride ?? (defaultPreset?.key || '');

  const lockedFields = useMemo(() => schema?.lockedFields || [], [schema]);
  const fieldByKey = useMemo(() => {
    const map = new Map<string, SchemaField>();
    schema?.groups.forEach((g) => g.fields.forEach((f) => map.set(f.key, f)));
    return map;
  }, [schema]);

  // Every column that will actually be written, locked ones included — this is
  // the same set the backend rebuilds from the posted keys.
  const effectiveFields = useMemo(() => {
    const all = new Set(selectedFields);
    lockedFields.forEach((k) => all.add(k));
    return all;
  }, [selectedFields, lockedFields]);

  const sensitiveCount = useMemo(
    () => [...effectiveFields].filter((k) => fieldByKey.get(k)?.sensitive).length,
    [effectiveFields, fieldByKey],
  );

  // Any manual tick means the selection is no longer "the preset" — dropping the
  // highlight keeps the chips honest rather than implying a preset that is no
  // longer what will be exported.
  function toggleField(key: string) {
    setPresetOverride(''); setActiveTemplateId('');
    setCustomFields((prev) => {
      const next = new Set(prev ?? selectedFields);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: SchemaGroup, on: boolean) {
    setPresetOverride(''); setActiveTemplateId('');
    setCustomFields((prev) => {
      const next = new Set(prev ?? selectedFields);
      group.fields.filter((f) => !f.locked).forEach((f) => (on ? next.add(f.key) : next.delete(f.key)));
      return next;
    });
  }

  function applyPreset(preset: Preset) {
    setCustomFields(new Set(preset.fields));
    setPresetOverride(preset.key);
    setActiveTemplateId('');
  }

  function applyTemplate(tmpl: Template) {
    setCustomFields(new Set(tmpl.fields));
    setActiveTemplateId(tmpl.id);
    setPresetOverride('');
    toast.success(`Applied “${tmpl.name}” — now pick the employees.`);
  }

  function toggleEmployee(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setManyEmployees(ids: string[], on: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }

  const saveTemplate = useMutation({
    mutationFn: async () => {
      const body = { name: templateName, dataset: 'employees', fields: [...effectiveFields] };
      // Applying a template and then editing its columns saves back onto that
      // template when the name is unchanged, instead of quietly creating a
      // near-duplicate the user then has to tell apart in the list.
      const existing = templates.find((t) => t.id === activeTemplateId);
      if (existing && existing.name.trim() === templateName.trim()) {
        return api.patch(`/exports/templates/${existing.id}`, body).then((r) => r.data);
      }
      return api.post('/exports/templates', body).then((r) => r.data);
    },
    onSuccess: (tmpl: Template) => {
      qc.invalidateQueries({ queryKey: ['export-templates', 'employees'] });
      setActiveTemplateId(tmpl.id);
      setPresetOverride('');
      setSaveOpen(false);
      toast.success('Template saved.');
    },
    onError: (e: any) => toast.error(errMessage(e, 'Could not save the template.')),
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api.delete(`/exports/templates/${id}`).then((r) => r.data),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['export-templates', 'employees'] });
      if (activeTemplateId === id) setActiveTemplateId('');
      setDeleteId(null);
      toast.success('Template removed.');
    },
    onError: (e: any) => {
      setDeleteId(null);
      toast.error(errMessage(e, 'Could not remove the template.'));
    },
  });

  const runExport = useMutation({
    mutationFn: (format: 'csv' | 'xlsx') => postAuthedFile(
      `/exports/employees/${format}`,
      { workerIds: [...selectedIds], fields: [...effectiveFields] },
      `employees-export.${format}`,
    ),
    onSuccess: () => toast.success(`Exported ${selectedIds.size} employee${selectedIds.size === 1 ? '' : 's'}.`),
    onError: (e: any) => toast.error(errMessage(e, 'Could not build the export.')),
  });

  const columnCount = effectiveFields.size;
  const canExport = selectedIds.size > 0 && columnCount > lockedFields.length && !runExport.isPending;
  const missingBank = useMemo(() => {
    const wantsBank = [...effectiveFields].some((k) => k.startsWith('bank') || k === 'iban');
    if (!wantsBank) return 0;
    return employees.filter((e) => selectedIds.has(e.id) && !e.hasBankDetails).length;
  }, [effectiveFields, employees, selectedIds]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-gray-400" /> Employees
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Pick the columns and the people, and download as CSV or XLSX. Save a column set as a
            template to re-run the same sheet next month against a different selection.
          </p>
        </div>
      </div>

      {/* Presets + saved templates */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">Quick sets</span>
          {(schema?.presets || []).map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => applyPreset(p)}
              title={p.description}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-full border transition-colors',
                activePreset === p.key
                  ? 'bg-brand-700 border-brand-700 text-white'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {!!templates.length && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-1">My templates</span>
            {templates.map((t) => (
              <span
                key={t.id}
                className={cn(
                  'inline-flex items-center gap-1 pl-3 pr-1.5 py-1 text-xs font-medium rounded-full border transition-colors',
                  activeTemplateId === t.id
                    ? 'bg-brand-700 border-brand-700 text-white'
                    : 'bg-white border-gray-300 text-gray-600',
                )}
              >
                <button type="button" onClick={() => applyTemplate(t)} className="inline-flex items-center gap-1.5">
                  <Bookmark className="w-3 h-3" />
                  {t.name}
                  <span className={cn('text-[11px]', activeTemplateId === t.id ? 'text-white/70' : 'text-gray-400')}>
                    {t.fields.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteId(t.id)}
                  aria-label={`Remove ${t.name}`}
                  className={cn(
                    'p-1 rounded-full transition-colors',
                    activeTemplateId === t.id ? 'hover:bg-white/20 text-white/80' : 'hover:bg-gray-100 text-gray-400',
                  )}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columns */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Columns3 className="w-4 h-4 text-gray-400" /> 1. Columns
              <span className="text-xs font-normal text-gray-400">{columnCount} selected</span>
            </h3>
            <button
              type="button"
              onClick={() => { setCustomFields(new Set()); setPresetOverride(''); setActiveTemplateId(''); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Clear
            </button>
          </div>

          {schema
            ? <ColumnPicker schema={schema} selected={selectedFields} onToggle={toggleField} onToggleGroup={toggleGroup} />
            : <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading columns…</p>}
        </div>

        {/* Employees */}
        <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-gray-400" /> 2. Employees
            <span className="text-xs font-normal text-gray-400">{selectedIds.size} selected</span>
          </h3>
          <EmployeePicker
            employees={employees}
            loading={employeesLoading && !employees.length}
            selected={selectedIds}
            onToggle={toggleEmployee}
            onSetMany={setManyEmployees}
            search={search} setSearch={setSearch}
            department={department} setDepartment={setDepartment}
            status={status} setStatus={setStatus}
            workerType={workerType} setWorkerType={setWorkerType}
            filters={filters}
          />
        </div>
      </div>

      {/* Warnings + actions */}
      <div className="space-y-3">
        {sensitiveCount > 0 && (
          <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-px" />
            <span>
              {sensitiveCount} of the selected columns hold sensitive data (bank accounts, CNIC,
              salary, address). The CSV is unencrypted — handle and share it accordingly. Every
              export is recorded in Activity Logs.
            </span>
          </p>
        )}
        {missingBank > 0 && (
          <p className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-px text-amber-500" />
            <span>
              {missingBank} of the selected employees have no bank details on file — their bank
              columns will come out blank.
            </span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3">
          <p className="text-sm text-gray-600">
            <span className="font-semibold text-gray-900">{selectedIds.size}</span> employee{selectedIds.size === 1 ? '' : 's'}
            {' × '}
            <span className="font-semibold text-gray-900">{columnCount}</span> column{columnCount === 1 ? '' : 's'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTemplateName(templates.find((t) => t.id === activeTemplateId)?.name || '');
                setSaveOpen(true);
              }}
              disabled={columnCount <= lockedFields.length}
              className={btnGhost}
            >
              <Save className="w-4 h-4" /> Save as template
            </button>
            <button
              type="button"
              onClick={() => runExport.mutate('csv')}
              disabled={!canExport}
              className={btnGhost}
            >
              {runExport.isPending && runExport.variables === 'csv'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Building CSV…</>
                : <><Download className="w-4 h-4" /> Export CSV</>}
            </button>
            <button
              type="button"
              onClick={() => runExport.mutate('xlsx')}
              disabled={!canExport}
              className={btnPrimary}
            >
              {runExport.isPending && runExport.variables === 'xlsx'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Building XLSX…</>
                : <><Download className="w-4 h-4" /> Export XLSX</>}
            </button>
          </div>
        </div>
      </div>

      <AdminModal
        open={saveOpen}
        title="Save column template"
        onClose={() => setSaveOpen(false)}
        footer={
          <div className="flex gap-2 justify-end">
            <button className={btnGhost} onClick={() => setSaveOpen(false)}>Cancel</button>
            <button
              className={btnPrimary}
              disabled={!templateName.trim() || saveTemplate.isPending}
              onClick={() => saveTemplate.mutate()}
            >
              {saveTemplate.isPending ? 'Saving…' : 'Save template'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Template name</label>
            <input
              autoFocus
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Monthly bank disbursement sheet"
              className={inp}
            />
            <p className="text-[11px] text-gray-400 mt-1">
              Saves the {columnCount} selected columns only — not the employees. Pick whoever you
              need each time you use it.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[...effectiveFields].map((k) => (
              <span key={k} className="px-2 py-0.5 text-[11px] rounded-full bg-gray-100 text-gray-600">
                {fieldByKey.get(k)?.label || k}
              </span>
            ))}
          </div>
        </div>
      </AdminModal>

      <ConfirmDialog
        open={!!deleteId}
        title="Remove this template?"
        message="The saved column set stops appearing here. Nothing that was already exported is affected, and no employee data is touched."
        confirmLabel="Remove"
        onConfirm={() => deleteId && deleteTemplate.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
