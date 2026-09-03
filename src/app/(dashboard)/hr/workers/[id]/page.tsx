'use client';

import { useState, useEffect, Fragment, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle, XCircle, Upload, FileText, Download,
  Wand2, KeyRound, Eye, EyeOff, RefreshCw, MapPin, MapPinOff, Info,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import ConfirmDialog from '@/components/ConfirmDialog';
import ActiveToggle from '@/components/ActiveToggle';
import ProfilePhotoCropper from '@/components/ProfilePhotoCropper';
import ProfilePhotoActions from '@/components/ProfilePhotoActions';
import ImageLightbox from '@/components/ImageLightbox';
import ShowInactiveToggle, { useShowInactive } from '@/components/ShowInactiveToggle';
import { cn, formatDate, formatPeriod, generatePassword, downloadFile, downloadAuthedFile, uploadErrorMessage, titleCase, inactiveRow } from '@/lib/utils';
import AttendanceStatusBadges from '@/components/AttendanceStatusBadges';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const GENERATABLE_DOCS = [
  { type: 'appointment_letter', label: 'Appointment Letter' },
  { type: 'confirmation_letter', label: 'Confirmation Letter' },
  { type: 'bank_opening_letter', label: 'Bank Account Opening Letter' },
  { type: 'experience_letter', label: 'Experience Letter' },
  { type: 'salary_certificate', label: 'Salary Certificate' },
];

// Generates + persists (POST) so the document shows up in the Documents list
// below and can be re-downloaded later exactly as issued, instead of the GET
// route above which is a one-off download with no record kept.
async function generateAndSaveDoc(workerId: string, type: string) {
  try {
    const res = await api.post(`/hr/workers/${workerId}/generate-document`, { type });
    return res.data;
  } catch {
    toast.error('Document generation failed.');
  }
}

type Tab = 'profile' | 'salary' | 'onboarding' | 'attendance' | 'payroll' | 'taxCertificate' | 'documents' | 'appraisals';

function workerToEditForm(worker: any) {
  return {
    name: worker.user?.name || '',
    designation: worker.designation || '',
    department: worker.department || '',
    salaryBase: worker.salaryBase ?? '',
    medicalAllowance: worker.medicalAllowance ?? '',
    salaryComponents: Array.isArray(worker.salaryComponents) ? worker.salaryComponents : [],
    taxExempt: !!worker.taxExempt,
    noAttendanceDeduction: !!worker.noAttendanceDeduction,
    joiningDate: worker.joiningDate ? String(worker.joiningDate).slice(0, 10) : '',
    leavingDate: worker.leavingDate ? String(worker.leavingDate).slice(0, 10) : '',
    dateOfBirth: worker.dateOfBirth ? String(worker.dateOfBirth).slice(0, 10) : '',
    probationEndDate: worker.probationEndDate ? String(worker.probationEndDate).slice(0, 10) : '',
    payModel: worker.payModel || 'salary',
    workerType: worker.workerType || 'employee',
    cnic: worker.cnic || '',
    address: worker.address || '',
    emergencyContact: worker.emergencyContact || '',
    emergencyPhone: worker.emergencyPhone || '',
    bankName: worker.bankName || '',
    bankBranchName: worker.bankBranchName || '',
    bankBranchCity: worker.bankBranchCity || '',
    bankAccountTitle: worker.bankAccountTitle || '',
    bankAccountNumber: worker.bankAccountNumber || '',
    iban: worker.iban || '',
    currency: worker.currency || 'PKR',
    status: worker.status || 'invited',
    profilePictureUrl: worker.profilePictureUrl || '',
    // '' means "Default" (org-wide resolution) — see Policies → Attendance.
    shiftScheduleId: worker.shiftScheduleId || '',
  };
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-brand-100 text-brand-800',
  inactive: 'bg-gray-100 text-gray-500',
  invited: 'bg-blue-100 text-blue-700',
  profile_pending: 'bg-amber-100 text-amber-700',
  under_review: 'bg-violet-100 text-violet-700',
  profile_amended: 'bg-blue-100 text-blue-700',
};

const STATUS_LABELS: Record<string, string> = {
  under_review: 'Under Review',
  profile_amended: 'Profile Amended',
};

const WORKER_FIELD_LABELS: Record<string, string> = {
  name: 'Full Name',
  email: 'Email',
  joiningDate: 'Joining Date',
  leavingDate: 'Leaving Date',
  dateOfBirth: 'Date of Birth',
  profilePictureUrl: 'Profile Photo',
  cnic: 'CNIC / National ID',
  address: 'Address',
  emergencyContact: 'Emergency Contact Name',
  emergencyPhone: 'Emergency Contact Phone',
  bankName: 'Bank Name',
  bankBranchName: 'Branch Name',
  bankBranchCity: 'Branch City',
  bankAccountTitle: 'Account Title',
  bankAccountNumber: 'Account Number',
  iban: 'IBAN',
  designation: 'Designation',
  department: 'Department',
  probationEndDate: 'Probation End',
  salaryBase: 'Base Salary',
  medicalAllowance: 'Medical Allowance',
  currency: 'Currency',
  payModel: 'Pay Model',
  workerType: 'Worker Type',
  status: 'Status',
};

function formatAmendmentFieldLabel(field: string) {
  if (WORKER_FIELD_LABELS[field]) return WORKER_FIELD_LABELS[field];
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatAmendmentValue(field: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'profilePictureUrl') return 'Photo updated';
  if (field.endsWith('Date') || field === 'dateOfBirth') return formatDate(String(value));
  if (field === 'payModel') {
    const labels: Record<string, string> = {
      salary: 'Salary',
      per_deliverable: 'Per Deliverable',
      hourly: 'Hourly',
      fixed_invoice: 'Fixed Invoice',
    };
    return labels[String(value)] || titleCase(String(value));
  }
  return String(value);
}

const ITEM_STATUS_COLORS: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-brand-100 text-brand-800',
  concern_raised: 'bg-red-100 text-red-700',
  rectifying: 'bg-blue-100 text-blue-700',
};

const BLANK_ONBOARD = {
  designation: '', department: '', salaryBase: '', probationEndDate: '',
  payModel: 'salary', workerType: 'employee', joiningDate: '',
};

const BLANK_DOC = { type: 'appointment_letter', label: '', fileUrl: '' };

// Editable list of who this worker's net pay is disbursed to besides
// themselves (e.g. wife/parents) — see HrService#setSalaryBeneficiaries and
// utils/payrollCalc.js#computeDisbursementSplit on the backend. No beneficiaries
// configured means 100% still goes to the worker's own bank account above, so
// this card is opt-in and doesn't affect anyone who never touches it.
function SalarySplitCard({
  beneficiaries, setBeneficiaries, onSave, saving,
}: {
  beneficiaries: any[];
  setBeneficiaries: (next: any[]) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const addBeneficiary = () => setBeneficiaries([
    ...beneficiaries,
    {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: '', relation: '', splitType: 'percentage', splitValue: '',
      bankName: '', bankAccountTitle: '', bankAccountNumber: '', iban: '',
    },
  ]);
  const updateBeneficiary = (id: string, patch: Record<string, any>) => setBeneficiaries(
    beneficiaries.map((b) => (b.id === id ? { ...b, ...patch } : b)),
  );
  const removeBeneficiary = (id: string) => setBeneficiaries(beneficiaries.filter((b) => b.id !== id));

  const percentTotal = beneficiaries
    .filter((b) => b.splitType === 'percentage')
    .reduce((s, b) => s + (Number(b.splitValue) || 0), 0);
  const fixedTotal = beneficiaries
    .filter((b) => b.splitType === 'fixed')
    .reduce((s, b) => s + (Number(b.splitValue) || 0), 0);
  const overAllocated = percentTotal > 100;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Salary Split</h3>
        <button
          type="button"
          onClick={addBeneficiary}
          className="text-xs font-medium text-brand-700 hover:text-brand-800"
        >
          + Add recipient
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">
        Pay part of this worker&apos;s net salary to other people or accounts (e.g. spouse, parents) every time
        payroll is disbursed. Fixed amounts are set aside first, then percentages apply to what&apos;s left.
        Anything not allocated here still goes to the worker&apos;s own bank account above.
      </p>

      {beneficiaries.length === 0 ? (
        <p className="text-xs text-gray-400 italic mb-3">No split configured — full salary goes to the worker.</p>
      ) : (
        <div className="space-y-3 mb-3">
          {beneficiaries.map((b) => (
            <div key={b.id} className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={b.name || ''}
                  onChange={(e) => updateBeneficiary(b.id, { name: e.target.value })}
                  placeholder="Recipient name"
                  className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <input
                  value={b.relation || ''}
                  onChange={(e) => updateBeneficiary(b.id, { relation: e.target.value })}
                  placeholder="Relation (e.g. Wife)"
                  className="w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <select
                  value={b.splitType || 'percentage'}
                  onChange={(e) => updateBeneficiary(b.id, { splitType: e.target.value })}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
                <input
                  type="number"
                  value={b.splitValue ?? ''}
                  onChange={(e) => updateBeneficiary(b.id, { splitValue: e.target.value })}
                  placeholder={b.splitType === 'fixed' ? 'Amount' : '%'}
                  className="w-28 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <button
                  type="button"
                  onClick={() => removeBeneficiary(b.id)}
                  className="text-xs text-red-500 hover:text-red-700 px-1"
                  title="Remove"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input
                  value={b.bankName || ''}
                  onChange={(e) => updateBeneficiary(b.id, { bankName: e.target.value })}
                  placeholder="Bank"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <input
                  value={b.bankAccountTitle || ''}
                  onChange={(e) => updateBeneficiary(b.id, { bankAccountTitle: e.target.value })}
                  placeholder="Account Title"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <input
                  value={b.bankAccountNumber || ''}
                  onChange={(e) => updateBeneficiary(b.id, { bankAccountNumber: e.target.value })}
                  placeholder="Account Number"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
                <input
                  value={b.iban || ''}
                  onChange={(e) => updateBeneficiary(b.id, { iban: e.target.value })}
                  placeholder="IBAN"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {beneficiaries.length > 0 && (
        <p className={cn('text-xs mb-3', overAllocated ? 'text-red-600 font-medium' : 'text-gray-500')}>
          {fixedTotal > 0 && `${fixedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} fixed`}
          {fixedTotal > 0 && percentTotal > 0 && ' + '}
          {percentTotal > 0 && `${percentTotal}% of the remainder`}
          {' '}allocated to other recipients; the rest goes to the worker&apos;s own account.
          {overAllocated && ' Percentages exceed 100% — this will be rejected on save.'}
        </p>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={saving || overAllocated}
        className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Save Salary Split'}
      </button>
    </div>
  );
}

export default function WorkerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('profile');
  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t && ['profile', 'onboarding', 'attendance', 'payroll', 'taxCertificate', 'documents', 'appraisals'].includes(t)) {
      setTab(t);
    }
  }, [searchParams]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const [taxCertFrom, setTaxCertFrom] = useState(`${thisMonth.slice(0, 4)}-01`);
  const [taxCertTo, setTaxCertTo] = useState(thisMonth);
  const [taxCertDownloading, setTaxCertDownloading] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, any>>({});
  const [roleId, setRoleId] = useState('');
  const [initialEditForm, setInitialEditForm] = useState<Record<string, any>>({});
  const [onboardForm, setOnboardForm] = useState(BLANK_ONBOARD);
  const [rejectReason, setRejectReason] = useState('');
  const [declineDocTarget, setDeclineDocTarget] = useState<{ id: string; label: string } | null>(null);
  const [declineDocReason, setDeclineDocReason] = useState('');
  const [showResignDialog, setShowResignDialog] = useState(false);
  const [resignLeavingDate, setResignLeavingDate] = useState('');
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const inactive = useShowInactive();
  const [docForm, setDocForm] = useState(BLANK_DOC);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [attMonth, setAttMonth] = useState(() => {
    const m = searchParams.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) return m;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  useEffect(() => {
    const m = searchParams.get('month');
    if (m && /^\d{4}-\d{2}$/.test(m)) setAttMonth(m);
  }, [searchParams]);
  const docFileRef = useRef<HTMLInputElement>(null);
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Auto-format CNIC input while typing/pasting to: 12345-1234567-1
  function formatCnic(raw: string) {
    const digits = String(raw || '').replace(/\D/g, '').slice(0, 13);
    const a = digits.slice(0, 5);
    const b = digits.slice(5, 12); // 7 digits
    const c = digits.slice(12, 13); // last digit
    if (digits.length <= 5) return a;
    if (digits.length <= 12) return `${a}-${b}`;
    return `${a}-${b}-${c}`;
  }

  const { data: worker, isLoading } = useQuery({
    queryKey: ['hr-worker', id],
    queryFn: () => api.get(`/hr/workers/${id}`).then((r) => r.data),
  });

  useEffect(() => {
    if (worker) {
      const nextForm = workerToEditForm(worker);
      setEditForm(nextForm);
      setInitialEditForm(nextForm);
      setRoleId(worker.user?.role?.id || '');
      setOnboardForm({
        designation: worker.designation || '',
        department: worker.department || '',
        salaryBase: worker.salaryBase ?? '',
        probationEndDate: worker.probationEndDate ? String(worker.probationEndDate).slice(0, 10) : '',
        payModel: worker.payModel || 'salary',
        workerType: worker.workerType || 'employee',
        joiningDate: worker.joiningDate ? String(worker.joiningDate).slice(0, 10) : '',
      });
    }
    // Keyed on id, not the whole worker object — otherwise a background
    // refetch (React Query's refetchOnWindowFocus) silently resets any
    // in-progress edits (e.g. a status change) back to server state before
    // the admin clicks Save. Same fix already applied on self-service/page.tsx.
  }, [worker?.id]);

  const [attPage, setAttPage] = useState(1);
  const { data: attendanceResp } = useQuery({
    queryKey: ['hr-worker-attendance', id, attMonth, attPage],
    queryFn: () => api.get('/hr/attendance', { params: { workerId: id, month: attMonth, page: attPage, limit: 50 } }).then((r) => r.data),
    enabled: tab === 'attendance',
  });
  const attendance: any[] = attendanceResp?.data || [];

  const { data: payrollItems = [] } = useQuery({
    queryKey: ['hr-worker-payroll', id],
    queryFn: () => api.get(`/hr/payroll`).then(async (runsRes) => {
      const runs = runsRes.data;
      if (!runs.length) return [];
      const all: any[] = [];
      for (const run of runs.slice(0, 6)) {
        const items = await api.get(`/hr/payroll/${run.id}/items`).then((r) => r.data);
        const workerItem = items.find((i: any) => i.workerId === id);
        if (workerItem) all.push({ ...workerItem, run });
      }
      return all;
    }),
    enabled: tab === 'payroll',
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['hr-worker-documents', id, inactive.key],
    queryFn: () => api.get('/hr/documents', { params: { workerId: id, ...inactive.params } }).then((r) => r.data),
    enabled: tab === 'documents' || tab === 'onboarding',
  });

  const { data: appraisals = [] } = useQuery({
    queryKey: ['hr-worker-appraisals', id],
    queryFn: () => api.get(`/hr/workers/${id}/appraisals`).then((r) => r.data),
    enabled: tab === 'appraisals',
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['hr-departments'],
    queryFn: () => api.get('/hr/departments').then((r) => r.data),
  });

  const { data: designations = [] } = useQuery({
    queryKey: ['hr-designations'],
    queryFn: () => api.get('/hr/designations').then((r) => r.data),
  });

  // For the Timing Policy picker — same list Policies → Attendance manages.
  const { data: shiftSchedules = [] } = useQuery({
    queryKey: ['hr-shift-schedules', 'default'],
    queryFn: () => api.get('/hr/shift-schedules').then((r) => r.data),
  });

  // Medical exemption cap — same query key as HR → Settings, so the two
  // screens share a cache instead of fetching it twice.
  const { data: payrollSettings } = useQuery({
    queryKey: ['hr-payroll-settings'],
    queryFn: () => api.get('/hr/payroll-settings').then((r) => r.data),
  });

  const updateWorker = useMutation({
    mutationFn: (data: any) => api.patch(`/hr/workers/${id}`, data).then((r) => r.data),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['hr-worker', id] });
      qc.invalidateQueries({ queryKey: ['hr-workers'] });
      // worker?.id doesn't change after save, so the mount effect won't refresh
      // the form — sync from the PATCH response so Status / Onboarding Review
      // tab reflect the new `active` state immediately.
      if (updated) {
        const nextForm = workerToEditForm(updated);
        setEditForm(nextForm);
        setInitialEditForm(nextForm);
      }
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save changes.'),
  });

  // Salary split — who this worker's net pay is disbursed to besides themselves
  // (e.g. wife/parents). Its own resource, not part of the Worker PATCH payload,
  // since it's a list of beneficiary rows with its own validation.
  const { data: beneficiariesData } = useQuery({
    queryKey: ['hr-worker-salary-beneficiaries', id],
    queryFn: () => api.get(`/hr/workers/${id}/salary-beneficiaries`).then((r) => r.data),
    enabled: tab === 'salary',
  });
  const [beneficiaries, setBeneficiaries] = useState<any[]>([]);
  useEffect(() => {
    if (beneficiariesData) setBeneficiaries(beneficiariesData);
  }, [beneficiariesData]);

  const saveBeneficiaries = useMutation({
    mutationFn: (list: any[]) => api.put(`/hr/workers/${id}/salary-beneficiaries`, { beneficiaries: list }).then((r) => r.data),
    onSuccess: (saved) => {
      setBeneficiaries(saved);
      qc.invalidateQueries({ queryKey: ['hr-worker-salary-beneficiaries', id] });
      toast.success('Salary split saved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save salary split.'),
  });

  // Role lives on the User record (assigned at invite time via the Team module),
  // not on the Worker record — designation/department above are separate fields.
  // This lets it be reassigned here too, since this is where admins actually manage
  // an employee day-to-day, without needing to jump back to Team → member.
  const { data: rolesRaw = [] } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get('/roles').then((r) => r.data),
  });
  const isSuperAdminWorker = worker?.user?.role?.key === 'super_admin';
  const roles = (rolesRaw as any[]).filter((r: any) => r.key !== 'client' && r.key !== 'super_admin');

  const updateRole = useMutation({
    mutationFn: (newRoleId: string) => api.patch(`/users/${worker.user.id}`, { roleId: newRoleId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-worker', id] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Role updated.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to update role.'),
  });

  function buildWorkerPatchPayload() {
    const payload: Record<string, any> = {};
    const dateFields = new Set(['joiningDate', 'leavingDate', 'dateOfBirth', 'probationEndDate']);
    const numericFields = new Set(['salaryBase', 'medicalAllowance']);
    for (const key of Object.keys(editForm || {})) {
      if (key === 'salaryComponents') {
        const current = Array.isArray(editForm[key]) ? editForm[key] : [];
        const initial = Array.isArray(initialEditForm[key]) ? initialEditForm[key] : [];
        if (JSON.stringify(current) !== JSON.stringify(initial)) payload[key] = current;
        continue;
      }
      const current = editForm[key] ?? '';
      const initial = initialEditForm[key] ?? '';
      if (String(current) === String(initial)) continue;
      if (dateFields.has(key)) {
        payload[key] = current || null;
      } else if (numericFields.has(key)) {
        payload[key] = current === '' ? null : current;
      } else {
        payload[key] = typeof current === 'string' ? current.trim() : current;
      }
    }
    return payload;
  }

  // Shared by the Profile and Salary tabs' Save buttons — both edit the same
  // `editForm` state and PATCH through the same endpoint, so any change made
  // on either tab is included no matter which Save button is clicked.
  function handleSaveWorker() {
    const payload = buildWorkerPatchPayload();
    // Backend treats any Profile-tab save while under_review /
    // profile_amended as approval (HrService#updateWorker). Don't
    // block with "No changes" when HR is trying to clear review.
    const wasReview = worker.status === 'profile_amended' || worker.status === 'under_review';
    if (Object.keys(payload).length === 0 && !wasReview) {
      toast.info('No changes to save.');
      return;
    }
    // Explicit status so an empty body still activates on review.
    if (wasReview && payload.status !== 'inactive') {
      payload.status = 'active';
    }
    updateWorker.mutate(payload, {
      onSuccess: () => {
        if (wasReview) {
          setTab('profile');
          toast.success('Changes saved — profile approved and activated.');
        } else {
          toast.success('Changes saved.');
        }
      },
    });
  }

  const onboardMutation = useMutation({
    mutationFn: (body: any) => api.patch(`/hr/workers/${id}/onboard`, body).then((r) => r.data),
    onSuccess: (_, vars: any) => {
      qc.invalidateQueries({ queryKey: ['hr-worker', id] });
      qc.invalidateQueries({ queryKey: ['hr-workers'] });
      setTab('profile');
      toast.success(vars.action === 'approve' ? 'Worker approved and activated.' : 'Profile sent back for revision.');
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Action failed.';
      toast.error(msg);
    },
  });

  const resetPassword = useMutation({
    mutationFn: (password: string) => api.post(`/users/${worker?.userId}/reset-password`, { newPassword: password }).then((r) => r.data),
    onSuccess: () => {
      setShowResetPassword(false);
      setNewPassword('');
      toast.success('Password reset. Share the new password with the employee securely.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to reset password.'),
  });

  const [showAppraisalForm, setShowAppraisalForm] = useState(false);
  const [appraisalForm, setAppraisalForm] = useState({ reviewDate: new Date().toISOString().slice(0, 10), rating: '', notes: '', salaryAfter: '' });

  const createAppraisal = useMutation({
    mutationFn: (data: typeof appraisalForm) => api.post(`/hr/workers/${id}/appraisals`, data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-worker-appraisals', id] });
      qc.invalidateQueries({ queryKey: ['hr-worker', id] });
      setShowAppraisalForm(false);
      setAppraisalForm({ reviewDate: new Date().toISOString().slice(0, 10), rating: '', notes: '', salaryAfter: '' });
      toast.success('Appraisal recorded.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save appraisal.'),
  });

  const createDoc = useMutation({
    mutationFn: (data: any) => api.post('/hr/documents', { ...data, workerId: id }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
      setShowDocForm(false);
      setDocForm(BLANK_DOC);
      toast.success('Document saved.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to save document.'),
  });

  // Active ↔ Inactive switch — nothing is ever destroyed (see ActiveToggle).
  const toggleDocActive = useMutation({
    mutationFn: ({ docId, next }: { docId: string; next: boolean }) =>
      (next
        ? api.post(`/hr/documents/${docId}/activate`)
        : api.delete(`/hr/documents/${docId}`)
      ).then((r) => r.data),
    onSuccess: (_d, { next }) => {
      qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
      setDeleteDocId(null);
      toast.success(next ? 'Document set to Active.' : 'Document set to Inactive.');
    },
    onError: (e: any) => {
      setDeleteDocId(null);
      toast.error(e?.response?.data?.message || 'Could not change status.');
    },
  });

  const fulfillDocRequest = useMutation({
    mutationFn: (docId: string) => api.post(`/hr/document-requests/${docId}/fulfill`).then((r) => r.data),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] });
      toast.success(`${doc.label || titleCase(doc.type)} issued — employee has been notified.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to issue document.'),
  });

  const rejectDocRequest = useMutation({
    mutationFn: ({ docId, reason }: { docId: string; reason: string }) =>
      api.post(`/hr/document-requests/${docId}/reject`, { reason }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
      qc.invalidateQueries({ queryKey: ['analytics-dashboard'] });
      setDeclineDocTarget(null);
      setDeclineDocReason('');
      toast.success('Document request declined.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to decline request.'),
  });

  async function uploadDocFile(file: File) {
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setDocForm((f) => ({ ...f, fileUrl: res.data.url }));
      toast.success('File uploaded — click Save Document to attach it.');
    } catch (e: any) {
      toast.error(uploadErrorMessage(e));
    } finally {
      setDocUploading(false);
    }
  }

  async function handleDownloadDoc(doc: any) {
    try {
      await downloadFile(doc.fileUrl, doc.fileName || `${doc.label || doc.type || 'document'}`);
    } catch {
      toast.error('Download failed.');
    }
  }

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  function openAvatarCrop(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file.');
      return;
    }
    const url = URL.createObjectURL(file);
    setCropSrc(url);
  }

  function closeAvatarCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  }

  async function uploadAvatar(file: File) {
    setAvatarUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const url = res.data.url as string;
      // Persist immediately so refresh doesn't revert to the previous photo.
      await api.patch(`/hr/workers/${id}`, { profilePictureUrl: url });
      setEditForm((f: any) => ({ ...f, profilePictureUrl: url }));
      setInitialEditForm((f: any) => (f ? { ...f, profilePictureUrl: url } : f));
      qc.invalidateQueries({ queryKey: ['hr-worker', id] });
      toast.success('Photo saved.');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || uploadErrorMessage(e));
    } finally {
      setAvatarUploading(false);
    }
  }

  if (isLoading) return <div className="flex flex-col h-full"><Header title="Worker" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div></div>;
  if (!worker) return <div className="flex flex-col h-full"><Header title="Worker" /><div className="flex-1 flex items-center justify-center text-sm text-gray-400">Worker not found.</div></div>;

  const TABS: { key: Tab; label: string }[] = [
    { key: 'profile', label: 'Profile' },
    { key: 'salary', label: 'Salary' },
    ...(worker.status === 'under_review' ? [{ key: 'onboarding' as Tab, label: 'Onboarding Review' }] : []),
    ...(worker.status === 'profile_amended' ? [{ key: 'onboarding' as Tab, label: 'Amendment Review' }] : []),
    { key: 'attendance', label: 'Attendance' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'taxCertificate', label: 'Tax Certificate' },
    { key: 'documents', label: 'Documents' },
    { key: 'appraisals', label: 'Appraisals' },
  ];

  return (
    <div className="flex flex-col h-full">
      <ConfirmDialog
        open={!!deleteDocId}
        title="Set document to Inactive"
        message="It drops off this list, but the file and its record are kept and an admin can set it back to Active at any time — nothing is deleted."
        confirmLabel="Set Inactive"
        onConfirm={() => toggleDocActive.mutate({ docId: deleteDocId!, next: false })}
        onCancel={() => setDeleteDocId(null)}
      />
      {declineDocTarget && (
        <Dialog open onOpenChange={(open) => { if (!open) { setDeclineDocTarget(null); setDeclineDocReason(''); } }}>
          <DialogContent className="max-w-md sm:max-w-md rounded-2xl">
            <DialogTitle className="sr-only">Decline document request</DialogTitle>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Decline document request</h3>
              <p className="text-xs text-gray-500 mt-1">
                Declining <strong>{declineDocTarget.label}</strong>. The reason will be shared with the employee.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">
                Decline reason <span className="text-red-500">*</span>
              </label>
              <textarea
                autoFocus
                value={declineDocReason}
                onChange={(e) => setDeclineDocReason(e.target.value)}
                rows={3}
                placeholder="e.g. Incomplete employment records — please update your profile first."
                className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setDeclineDocTarget(null); setDeclineDocReason(''); }}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => rejectDocRequest.mutate({
                  docId: declineDocTarget.id,
                  reason: declineDocReason.trim(),
                })}
                disabled={rejectDocRequest.isPending || !declineDocReason.trim()}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {rejectDocRequest.isPending ? 'Declining…' : 'Decline request'}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {showResignDialog && (
        <Dialog open onOpenChange={(open) => { if (!open) setShowResignDialog(false); }}>
          <DialogContent className="max-w-md sm:max-w-md rounded-2xl">
            <DialogTitle className="sr-only">Mark as Resigned</DialogTitle>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Mark {worker.user?.name} as Resigned</h3>
              <p className="text-xs text-gray-500 mt-1">
                Sets Status to Inactive and Leaving Date together, so this month&apos;s payroll still prorates their pay correctly instead of the run silently skipping them. Their login is also deactivated. This can be undone by setting Status back to Active.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Leaving Date</label>
              <input
                type="date"
                autoFocus
                value={resignLeavingDate}
                onChange={(e) => setResignLeavingDate(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResignDialog(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateWorker.mutate({ status: 'inactive', leavingDate: resignLeavingDate }, {
                  onSuccess: () => {
                    setShowResignDialog(false);
                    toast.success('Marked as resigned.');
                  },
                })}
                disabled={updateWorker.isPending || !resignLeavingDate}
                className="bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {updateWorker.isPending ? 'Saving…' : 'Mark as Resigned'}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {cropSrc && (
        <ProfilePhotoCropper
          imageSrc={cropSrc}
          onCancel={closeAvatarCrop}
          onComplete={(file) => {
            closeAvatarCrop();
            uploadAvatar(file);
          }}
        />
      )}
      <ImageLightbox
        src={lightboxSrc}
        alt={worker?.user?.name || 'Profile'}
        onClose={() => setLightboxSrc(null)}
      />
      <Header title={worker.user?.name || 'Worker'} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {/* Back + header */}
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
          <ArrowLeft className="w-4 h-4" />
          Back to HR
        </button>

        {/* Status sits below the identity on phones. On one row it was absolutely
            fighting the email for the same space and landing on top of it. */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            {worker.profilePictureUrl ? (
              <button
                type="button"
                onClick={() => setLightboxSrc(worker.profilePictureUrl)}
                className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-600"
                title="View photo"
              >
                <img src={worker.profilePictureUrl} alt={worker.user?.name} className="w-12 h-12 rounded-full object-cover border border-gray-200 cursor-zoom-in" />
              </button>
            ) : (
              <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center text-lg font-semibold text-gray-600 shrink-0">
                {worker.user?.name?.[0] || '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-gray-900 break-words">{worker.user?.name}</p>
              <p className="text-sm text-gray-500 break-words">{worker.designation || 'No designation'} · {worker.department || 'No department'}</p>
              <p className="text-xs text-gray-400 mt-0.5 break-all">{worker.user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start shrink-0">
            {worker.status !== 'inactive' && (
              <button
                type="button"
                onClick={() => {
                  setResignLeavingDate(worker.leavingDate ? String(worker.leavingDate).slice(0, 10) : new Date().toISOString().slice(0, 10));
                  setShowResignDialog(true);
                }}
                className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 rounded-full transition-colors"
              >
                Mark as Resigned
              </button>
            )}
            <span className={cn('px-3 py-1 text-xs font-medium rounded-full capitalize', STATUS_COLORS[worker.status] || 'bg-gray-100 text-gray-600')}>
              {STATUS_LABELS[worker.status] || titleCase(worker.status)}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-1.5 text-sm font-medium rounded-md transition-colors shrink-0 whitespace-nowrap',
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700',
                t.key === 'onboarding' ? 'text-violet-700' : ''
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Profile tab */}
        {tab === 'profile' && (
          <div className="space-y-5">
            <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
              {editForm.profilePictureUrl ? (
                <button
                  type="button"
                  onClick={() => setLightboxSrc(editForm.profilePictureUrl)}
                  className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-600"
                  title="View photo"
                >
                  <img src={editForm.profilePictureUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover border border-gray-200 cursor-zoom-in" />
                </button>
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-xl font-semibold text-gray-600 shrink-0">
                  {worker.user?.name?.[0] || '?'}
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-gray-900 mb-1">Profile Photo</p>
                <ProfilePhotoActions
                  uploading={avatarUploading}
                  onFile={openAvatarCrop}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Employment Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                  <input
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    placeholder="Employee full name"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Designation</label>
                  <select
                    value={editForm.designation || ''}
                    onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">Select…</option>
                    {(designations as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    {editForm.designation && !(designations as any[]).find((d: any) => d.name === editForm.designation) && (
                      <option value={editForm.designation}>{editForm.designation}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                  <select
                    value={editForm.department || ''}
                    onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">Select…</option>
                    {(departments as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                    {editForm.department && !(departments as any[]).find((d: any) => d.name === editForm.department) && (
                      <option value={editForm.department}>{editForm.department}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Timing Policy</label>
                  <select
                    value={editForm.shiftScheduleId || ''}
                    onChange={(e) => setEditForm({ ...editForm, shiftScheduleId: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">Default (org-wide)</option>
                    {(shiftSchedules as any[])
                      .filter((s: any) => !s.isArchived || s.id === editForm.shiftScheduleId)
                      .map((s: any) => <option key={s.id} value={s.id}>{s.label}{s.isArchived ? ' (archived)' : ''}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Pins this employee to a specific shift schedule regardless of its dates — until changed. See Policies → Attendance.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                  <select
                    value={roleId}
                    onChange={(e) => { setRoleId(e.target.value); updateRole.mutate(e.target.value); }}
                    disabled={isSuperAdminWorker || updateRole.isPending}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-50 disabled:text-gray-400"
                  >
                    <option value="">Select a role…</option>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    {isSuperAdminWorker && <option value={worker.user?.role?.id}>{worker.user?.role?.name}</option>}
                  </select>
                </div>
                {[
                  { key: 'joiningDate', label: 'Joining Date', type: 'date' },
                  { key: 'leavingDate', label: 'Leaving Date', type: 'date' },
                  { key: 'probationEndDate', label: 'Probation End', type: 'date' },
                  { key: 'currency', label: 'Currency' },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                    <input
                      type={f.type || 'text'}
                      value={editForm[f.key] || ''}
                      onChange={(e) => setEditForm({ ...editForm, [f.key]: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Pay Model</label>
                  <select
                    value={editForm.payModel || 'salary'}
                    onChange={(e) => setEditForm({ ...editForm, payModel: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="salary">Salary</option>
                    <option value="per_deliverable">Per Deliverable</option>
                    <option value="hourly">Hourly</option>
                    <option value="fixed_invoice">Fixed Invoice</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Worker Type</label>
                  <select
                    value={editForm.workerType || 'employee'}
                    onChange={(e) => setEditForm({ ...editForm, workerType: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="employee">Employee</option>
                    <option value="contractor">Contractor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <select
                    value={editForm.status || 'invited'}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="invited">Invited</option>
                    <option value="profile_pending">Profile Pending</option>
                    <option value="under_review">Under Review</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Personal & Bank Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={editForm.dateOfBirth || ''}
                    onChange={(e) => setEditForm({ ...editForm, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                {[
                  { key: 'cnic', label: 'CNIC / National ID', placeholder: '12345-1234567-1', maxLength: 15 },
                  { key: 'address', label: 'Address' },
                  { key: 'emergencyContact', label: 'Emergency Contact Name' },
                  { key: 'emergencyPhone', label: 'Emergency Contact Phone' },
                  { key: 'bankName', label: 'Bank Name' },
                  { key: 'bankBranchName', label: 'Branch Name', placeholder: 'e.g. Gulshan Branch' },
                  { key: 'bankBranchCity', label: 'Branch City', placeholder: 'e.g. Karachi' },
                  { key: 'bankAccountTitle', label: 'Account Title' },
                  { key: 'bankAccountNumber', label: 'Account Number' },
                  { key: 'iban', label: 'IBAN' },
                ].map((f) => {
                  const isCnic = f.key === 'cnic';
                  return (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{f.label}</label>
                    <input
                      type="text"
                      placeholder={f.placeholder}
                      maxLength={f.maxLength}
                      value={editForm[f.key] || ''}
                      onChange={(e) => {
                        const next = e.target.value;
                        setEditForm({ ...editForm, [f.key]: isCnic ? formatCnic(next) : next });
                      }}
                      className={cn(
                        'w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2',
                        'border-gray-300 focus:ring-brand-600'
                      )}
                    />
                  </div>
                  );
                })}
              </div>
            </div>

            {/* Reset password */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Password</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Reset this employee's login password. They'll need it to sign in next time.</p>
                </div>
                {!showResetPassword && (
                  <button
                    onClick={() => { setNewPassword(generatePassword()); setShowNewPassword(false); setShowResetPassword(true); }}
                    className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
                  >
                    <KeyRound className="w-4 h-4" />
                    Reset Password
                  </button>
                )}
              </div>
              {showResetPassword && (
                <div className="space-y-3">
                  <div className="relative max-w-sm">
                    <input
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      type={showNewPassword ? 'text' : 'password'}
                      className="w-full pl-3 pr-16 py-2 text-sm font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="p-1 text-gray-400 hover:text-gray-600" title="Show/hide">
                        {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button type="button" onClick={() => setNewPassword(generatePassword())} className="p-1 text-gray-400 hover:text-brand-700" title="Generate new">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => resetPassword.mutate(newPassword)}
                      disabled={resetPassword.isPending || newPassword.length < 8}
                      className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      {resetPassword.isPending ? 'Resetting…' : 'Confirm Reset'}
                    </button>
                    <button onClick={() => setShowResetPassword(false)} className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSaveWorker}
                disabled={updateWorker.isPending}
                className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {updateWorker.isPending
                  ? 'Saving…'
                  : (worker.status === 'under_review' || worker.status === 'profile_amended')
                    ? 'Save & Approve'
                    : 'Save Changes'}
              </button>
              {/* No separate Active/Inactive control here — the Status field above
                  already owns it, and setting it to Inactive revokes login access
                  (HrService#updateWorker syncs User.isActive). */}
            </div>
          </div>
        )}

        {/* Salary tab — Basic + Medical Allowance, with a live computed breakdown
            (Basic / Medical / Gross) so HR can see the effect of an edit before
            saving. Tax withholding itself is computed per payroll run, not here —
            see the Payroll tab for a worker's actual monthly figures. */}
        {tab === 'salary' && (() => {
          const basic = Number(editForm.salaryBase) || 0;
          const capPercent = Number(payrollSettings?.medicalExemptionCapPercent ?? 10);
          const medicalCap = Math.round(basic * (capPercent / 100) * 100) / 100;
          const medicalRaw = editForm.medicalAllowance !== '' && editForm.medicalAllowance != null
            ? Number(editForm.medicalAllowance)
            : medicalCap;
          const medical = Number.isFinite(medicalRaw) ? medicalRaw : 0;
          const exemptMedical = Math.min(medical, medicalCap);
          const taxableExcess = Math.max(0, medical - medicalCap);
          const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

          const components: any[] = Array.isArray(editForm.salaryComponents) ? editForm.salaryComponents : [];
          const setComponents = (next: any[]) => setEditForm({ ...editForm, salaryComponents: next });
          const addComponent = () => setComponents([
            ...components,
            { id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: '', amount: '', taxable: true },
          ]);
          const updateComponent = (id: string, patch: Record<string, any>) => setComponents(
            components.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          );
          const removeComponent = (id: string) => setComponents(components.filter((c) => c.id !== id));

          const validComponents = components.filter((c) => String(c.name || '').trim() && Number(c.amount) > 0);
          const taxableComponentsTotal = validComponents
            .filter((c) => c.taxable)
            .reduce((s, c) => s + Number(c.amount), 0);
          const nonTaxableComponentsTotal = validComponents
            .filter((c) => !c.taxable)
            .reduce((s, c) => s + Number(c.amount), 0);
          const gross = basic + medical + taxableComponentsTotal + nonTaxableComponentsTotal;
          const taxableSalary = basic + taxableExcess + taxableComponentsTotal;

          return (
            <div className="space-y-5">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-4 mb-1">
                  <h3 className="text-sm font-semibold text-gray-900">Salary Structure</h3>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={!!editForm.taxExempt}
                        onChange={(e) => setEditForm({ ...editForm, taxExempt: e.target.checked })}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-600"
                      />
                      Tax exempt
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={!!editForm.noAttendanceDeduction}
                        onChange={(e) => setEditForm({ ...editForm, noAttendanceDeduction: e.target.checked })}
                        className="rounded border-gray-300 text-brand-600 focus:ring-brand-600"
                      />
                      No attendance deduction
                    </label>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Basic is taxable; Medical is tax-exempt up to {capPercent}% of Basic (org default, set in HR → Settings).
                  {editForm.taxExempt && (
                    <span className="block text-amber-600 mt-1">
                      Tax exempt: payroll will skip income-tax withholding for this employee every month, regardless of taxable salary.
                    </span>
                  )}
                  {editForm.noAttendanceDeduction && (
                    <span className="block text-amber-600 mt-1">
                      No attendance deduction: payroll will never dock pay for this employee&apos;s unpaid absences or half-days, every month, regardless of the run&apos;s Deduct Absences setting.
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Base Salary (Basic)</label>
                    <input
                      type="number"
                      value={editForm.salaryBase ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, salaryBase: e.target.value })}
                      placeholder="e.g. 90000"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Medical Allowance</label>
                    <input
                      type="number"
                      value={editForm.medicalAllowance ?? ''}
                      onChange={(e) => setEditForm({ ...editForm, medicalAllowance: e.target.value })}
                      placeholder={`Default: ${capPercent}% of Basic (${fmt(medicalCap)})`}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                    <p className="text-[11px] text-gray-400 mt-1">
                      Leave blank to use the default. Anything entered above the cap has the excess treated as taxable.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-900">Additional Components</h3>
                  <button
                    type="button"
                    onClick={addComponent}
                    className="text-xs font-medium text-brand-700 hover:text-brand-800"
                  >
                    + Add component
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-3">
                  House Rent Allowance, Conveyance, Special Allowance, Bonus — anything else. Each is paid every
                  month; check Taxable only for allowances that should count toward income tax.
                </p>
                {components.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No additional components.</p>
                ) : (
                  <div className="space-y-2">
                    {components.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-2">
                        <input
                          value={c.name || ''}
                          onChange={(e) => updateComponent(c.id, { name: e.target.value })}
                          placeholder="e.g. House Rent Allowance"
                          className="flex-1 min-w-40 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        <input
                          type="number"
                          value={c.amount ?? ''}
                          onChange={(e) => updateComponent(c.id, { amount: e.target.value })}
                          placeholder="Amount"
                          className="w-32 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                        />
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                          <input
                            type="checkbox"
                            checked={c.taxable !== false}
                            onChange={(e) => updateComponent(c.id, { taxable: e.target.checked })}
                            className="rounded border-gray-300 text-brand-600 focus:ring-brand-600"
                          />
                          Taxable
                        </label>
                        <button
                          type="button"
                          onClick={() => removeComponent(c.id)}
                          className="text-xs text-red-500 hover:text-red-700 px-1"
                          title="Remove"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Breakdown</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Full-month figures — an actual payroll run prorates these by attendance and calendar days.</p>
                </div>
                <Table className="w-full">
                  <TableBody className="divide-y divide-gray-100">
                    <TableRow>
                      <TableCell className="px-5 py-3 text-sm text-gray-600">Basic Salary</TableCell>
                      <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right tabular-nums">{fmt(basic)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="px-5 py-3 text-sm text-gray-600">
                        Medical Allowance
                        {taxableExcess > 0 && (
                          <span className="block text-[11px] text-amber-600">
                            {fmt(exemptMedical)} exempt + {fmt(taxableExcess)} taxable (exceeds {capPercent}% cap)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right tabular-nums">{fmt(medical)}</TableCell>
                    </TableRow>
                    {validComponents.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="px-5 py-3 text-sm text-gray-600">
                          {c.name}
                          <span className={cn('block text-[11px]', c.taxable ? 'text-gray-400' : 'text-brand-600')}>
                            {c.taxable ? 'taxable' : 'non-taxable'}
                          </span>
                        </TableCell>
                        <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right tabular-nums">{fmt(Number(c.amount))}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-50">
                      <TableCell className="px-5 py-3 text-sm font-semibold text-gray-900">Gross Salary</TableCell>
                      <TableCell className="px-5 py-3 text-sm font-semibold text-gray-900 text-right tabular-nums">{fmt(gross)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="px-5 py-3 text-sm text-gray-600">Taxable Salary (full month, before attendance proration)</TableCell>
                      <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 text-right tabular-nums">{fmt(taxableSalary)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSaveWorker}
                  disabled={updateWorker.isPending}
                  className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {updateWorker.isPending ? 'Saving…' : 'Save Salary'}
                </button>
              </div>

              <SalarySplitCard
                beneficiaries={beneficiaries}
                setBeneficiaries={setBeneficiaries}
                onSave={() => saveBeneficiaries.mutate(beneficiaries)}
                saving={saveBeneficiaries.isPending}
              />
            </div>
          );
        })()}

        {/* Amendment review tab — active employee edited their profile post-onboarding */}
        {tab === 'onboarding' && worker.status === 'profile_amended' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Review Profile Amendment</h3>
              <p className="text-xs text-gray-500 mt-1">This employee is already active and edited their profile. Review the changes below, then approve or reject.</p>
            </div>

            {(() => {
              let diff: Record<string, { old: any; new: any }> = {};
              try { diff = worker.pendingAmendmentDiff ? JSON.parse(worker.pendingAmendmentDiff) : {}; } catch { diff = {}; }
              const entries = Object.entries(diff);
              if (entries.length === 0) {
                return <p className="text-sm text-gray-400 italic">No field-level changes were recorded for this amendment.</p>;
              }
              return (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <Table className="w-full text-sm">
                    <TableHeader>
                      <TableRow className="text-left text-xs text-gray-400 bg-gray-100 border-b border-gray-200">
                        <TableHead className="px-4 py-2 font-medium">Field</TableHead>
                        <TableHead className="px-4 py-2 font-medium">Previous</TableHead>
                        <TableHead className="px-4 py-2 font-medium">New</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-gray-100">
                      {entries.map(([field, change]) => (
                        <TableRow key={field}>
                          <TableCell className="px-4 py-2 font-medium text-gray-700">{formatAmendmentFieldLabel(field)}</TableCell>
                          <TableCell className="px-4 py-2 text-gray-400">{formatAmendmentValue(field, change.old)}</TableCell>
                          <TableCell className="px-4 py-2 text-gray-900">{formatAmendmentValue(field, change.new)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              );
            })()}

            {onboardMutation.isError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {(onboardMutation.error as any)?.response?.data?.message || 'Action failed.'}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => onboardMutation.mutate({ action: 'approve' })}
                disabled={onboardMutation.isPending}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Approve Changes
              </button>
            </div>

            <div className="pt-2 border-t border-gray-100 space-y-2">
              <label className="block text-xs font-medium text-gray-700">Rejection reason <span className="text-gray-400 font-normal">(shown to the employee)</span></label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                placeholder="e.g. Please re-upload a clearer photo."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
              <button
                onClick={() => { onboardMutation.mutate({ action: 'reject', reason: rejectReason }); setRejectReason(''); }}
                disabled={onboardMutation.isPending || !rejectReason.trim()}
                className="flex items-center gap-1.5 border border-red-200 hover:bg-red-50 disabled:opacity-50 text-red-600 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Reject Changes
              </button>
            </div>
          </div>
        )}

        {/* Onboarding review tab */}
        {tab === 'onboarding' && worker.status === 'under_review' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Review Submitted Profile</h3>
              <p className="text-xs text-gray-500 mt-1">Review the worker's profile, set their employment terms, then approve or reject.</p>
            </div>

            <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 grid grid-cols-2 gap-3 text-sm">
              {[
                ['Email', worker.user?.email],
                ['CNIC', worker.cnic],
                ['Address', worker.address],
                ['Joining Date', worker.joiningDate],
                ['Emergency Contact', worker.emergencyContact],
                ['Emergency Phone', worker.emergencyPhone],
                ['Bank Name', worker.bankName],
                ['Branch Name', worker.bankBranchName],
                ['Branch City', worker.bankBranchCity],
                ['Account Title', worker.bankAccountTitle],
                ['Account #', worker.bankAccountNumber],
                ['IBAN', worker.iban],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <span className="text-xs font-medium text-gray-500">{label}: </span>
                  <span className="text-gray-900">{value || '—'}</span>
                </div>
              ))}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Submitted Documents</h4>
              {(() => {
                const docTypes: { key: string; label: string }[] = [
                  { key: 'cv', label: 'CV / Resume' },
                  { key: 'cnic_front', label: 'CNIC — Front' },
                  { key: 'cnic_back', label: 'CNIC — Back' },
                ];
                const byType = (t: string) => (documents as any[]).find((d: any) => d.type === t);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {docTypes.map(({ key, label }) => {
                      const doc = byType(key);
                      return (
                        <div key={key} className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50">
                          <FileText className={cn('w-4 h-4 shrink-0', doc ? 'text-brand-700' : 'text-gray-300')} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs font-medium text-gray-500">{label}</span>
                            {doc ? (
                              <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-brand-800 hover:underline truncate block">
                                View file
                              </a>
                            ) : (
                              <span className="text-gray-400 italic">Not uploaded</span>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-3">Set Employment Terms</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Designation</label>
                  <select
                    value={onboardForm.designation}
                    onChange={(e) => setOnboardForm({ ...onboardForm, designation: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">Select designation…</option>
                    {(designations as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Department</label>
                  <select
                    value={onboardForm.department}
                    onChange={(e) => setOnboardForm({ ...onboardForm, department: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="">Select department…</option>
                    {(departments as any[]).map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Base Salary</label>
                  <input
                    type="number"
                    value={onboardForm.salaryBase}
                    onChange={(e) => setOnboardForm({ ...onboardForm, salaryBase: e.target.value })}
                    placeholder="50000"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Joining Date</label>
                  <input
                    type="date"
                    value={onboardForm.joiningDate}
                    onChange={(e) => {
                      const joining = e.target.value;
                      let probation = onboardForm.probationEndDate;
                      if (joining) {
                        const d = new Date(joining);
                        d.setMonth(d.getMonth() + 3);
                        probation = d.toISOString().slice(0, 10);
                      }
                      setOnboardForm({ ...onboardForm, joiningDate: joining, probationEndDate: probation });
                    }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Probation End Date <span className="text-gray-400 font-normal">(auto: joining + 3 months)</span></label>
                  <input
                    type="date"
                    value={onboardForm.probationEndDate}
                    onChange={(e) => setOnboardForm({ ...onboardForm, probationEndDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Pay Model</label>
                  <select
                    value={onboardForm.payModel}
                    onChange={(e) => setOnboardForm({ ...onboardForm, payModel: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="salary">Salary</option>
                    <option value="per_deliverable">Per Deliverable</option>
                    <option value="hourly">Hourly</option>
                    <option value="fixed_invoice">Fixed Invoice</option>
                  </select>
                </div>
              </div>
            </div>

            {onboardMutation.isError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {(onboardMutation.error as any)?.response?.data?.message || 'Action failed.'}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => onboardMutation.mutate({ action: 'approve', ...onboardForm })}
                disabled={onboardMutation.isPending || !onboardForm.designation || !onboardForm.salaryBase}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Approve & Activate
              </button>
            </div>

            <div className="pt-2 border-t border-gray-100 space-y-2">
              <label className="block text-xs font-medium text-gray-700">Rejection reason <span className="text-gray-400 font-normal">(shown to the employee)</span></label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                placeholder="e.g. Bank account title doesn't match your CNIC name — please correct and resubmit."
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
              />
              <button
                onClick={() => { onboardMutation.mutate({ action: 'reject', reason: rejectReason }); setRejectReason(''); }}
                disabled={onboardMutation.isPending || !rejectReason.trim()}
                className="flex items-center gap-1.5 border border-red-200 hover:bg-red-50 disabled:opacity-50 text-red-600 text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Reject (Send Back)
              </button>
            </div>
          </div>
        )}

        {/* Attendance tab */}
        {tab === 'attendance' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <input
                type="month"
                value={attMonth}
                onChange={(e) => { setAttMonth(e.target.value); setAttPage(1); }}
                className="w-full sm:w-auto px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                <span>Present: <strong>{attendance.filter((a: any) => a.status === 'present').length}</strong></span>
                <span>Absent: <strong>{attendance.filter((a: any) => a.status === 'absent').length}</strong></span>
                <span>Leave: <strong>{attendance.filter((a: any) => a.status === 'leave').length}</strong></span>
                <span>Half-day: <strong>{attendance.filter((a: any) => a.status === 'half_day').length}</strong></span>
                <span>Late: <strong>{attendance.filter((a: any) => a.isLate).length}</strong></span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {attendance.length === 0 ? (
                <p className="px-5 py-8 text-sm text-gray-400 text-center">No attendance records for this month.</p>
              ) : (
                <Table className="w-full min-w-[720px]">
                  <TableHeader>
                    <TableRow className="border-b border-gray-200 bg-gray-100">
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Date</TableHead>
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check In</TableHead>
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check Out</TableHead>
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Hours</TableHead>
                      <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="divide-y divide-gray-100">
                    {[...attendance].sort((a: any, b: any) => (a.date < b.date ? 1 : -1)).map((a: any) => {
                      const mapLink = (lat: any, lng: any) =>
                        lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null;
                      const checkInMap = mapLink(a.checkInLat, a.checkInLng);
                      const checkOutMap = mapLink(a.checkOutLat, a.checkOutLng);
                      return (
                        <TableRow key={a.id} className="hover:bg-gray-50">
                          <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900 whitespace-nowrap">{formatDate(a.date)}</TableCell>
                          <TableCell className="px-5 py-3.5">
                            <span className="flex items-center gap-1.5">
                              <AttendanceStatusBadges record={a} />
                              {a.note && (
                                <span title={a.note}><Info className="w-3.5 h-3.5 text-gray-300" /></span>
                              )}
                            </span>
                          </TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                            {a.checkIn ? (
                              <div className="flex items-center gap-1.5">
                                <span>{a.checkIn.slice(0, 5)}</span>
                                {a.isLate && (
                                  <span
                                    title={`${a.lateMinutes ?? 0} min late`}
                                    className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-orange-100 text-orange-700"
                                  >
                                    Late
                                  </span>
                                )}
                                {checkInMap ? (
                                  <a href={checkInMap} target="_blank" rel="noreferrer" title="View check-in location on map"
                                    className="text-brand-700 hover:text-brand-900">
                                    <MapPin className="w-3.5 h-3.5" />
                                  </a>
                                ) : (
                                  <span title="No location recorded"><MapPinOff className="w-3.5 h-3.5 text-gray-300" /></span>
                                )}
                              </div>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600 whitespace-nowrap">
                            {a.checkOut ? (
                              <div className="flex items-center gap-1.5">
                                <span>{a.checkOut.slice(0, 5)}</span>
                                {checkOutMap ? (
                                  <a href={checkOutMap} target="_blank" rel="noreferrer" title="View check-out location on map"
                                    className="text-brand-700 hover:text-brand-900">
                                    <MapPin className="w-3.5 h-3.5" />
                                  </a>
                                ) : (
                                  <span title="No location recorded"><MapPinOff className="w-3.5 h-3.5 text-gray-300" /></span>
                                )}
                              </div>
                            ) : '—'}
                          </TableCell>
                          <TableCell className="px-5 py-3.5 text-sm text-gray-600">{a.hours ?? '—'}</TableCell>
                          <TableCell className="px-5 py-3.5">
                            <span className={cn('px-2 py-0.5 text-[10px] font-medium rounded-full uppercase tracking-wide',
                              a.source === 'self' ? 'bg-violet-50 text-violet-600' : 'bg-gray-100 text-gray-500')}>
                              {a.source === 'self' ? 'Self (GPS)' : 'Manual'}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
              <Pagination
                page={attendanceResp?.page || 1}
                totalPages={attendanceResp?.totalPages || 1}
                total={attendanceResp?.total || 0}
                limit={attendanceResp?.limit || 50}
                onPageChange={setAttPage}
              />
            </div>
          </div>
        )}

        {/* Payroll tab */}
        {tab === 'payroll' && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Payroll History</h3>
            </div>
            <Table className="w-full min-w-140">
              <TableHeader>
                <TableRow className="border-b border-gray-200 bg-gray-100">
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Period</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Base</TableHead>
                  <TableHead className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Net</TableHead>
                  <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-gray-100">
                {payrollItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="px-5 py-10 text-center">
                      <p className="text-sm font-medium text-gray-700">No payroll records yet</p>
                      <p className="text-xs text-gray-500 mt-1.5 max-w-md mx-auto leading-relaxed">
                        Attendance and salary alone do not create payroll. An admin must create a monthly
                        payroll run under <span className="font-medium text-gray-700">HR &amp; Payroll → Payroll</span>,
                        then click <span className="font-medium text-gray-700">Recalculate</span> or{' '}
                        <span className="font-medium text-gray-700">Open for Review</span>.
                      </p>
                      <a
                        href="/hr?tab=payroll"
                        className="inline-flex mt-3 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
                      >
                        Go to Payroll runs →
                      </a>
                    </TableCell>
                  </TableRow>
                ) : (
                  payrollItems.map((item: any) => (
                    <Fragment key={item.id}>
                      <TableRow className="hover:bg-gray-50">
                        <TableCell className="px-5 py-3.5 text-sm font-medium text-gray-900">{formatPeriod(item.run?.period)}</TableCell>
                        <TableCell className="px-5 py-3.5 text-sm text-gray-600 text-right">{Number(item.base || 0).toLocaleString()}</TableCell>
                        <TableCell className="px-5 py-3.5 text-sm font-semibold text-gray-900 text-right">{Number(item.computedNet || 0).toLocaleString()}</TableCell>
                        <TableCell className="px-5 py-3.5">
                          <div className="flex flex-col gap-1.5">
                            <span className={cn('w-fit px-2.5 py-0.5 text-xs font-medium rounded-full', ITEM_STATUS_COLORS[item.employeeStatus] || 'bg-gray-100 text-gray-500')}>
                              {titleCase(item.employeeStatus)}
                            </span>
                            {item.employeeStatus === 'concern_raised' && item.run?.id && (
                              <a
                                href={`/hr/payroll/${item.run.id}`}
                                className="text-[11px] font-medium text-brand-700 hover:underline"
                              >
                                Open payroll run →
                              </a>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {item.employeeStatus === 'concern_raised' && item.concernNote && (
                        <TableRow className="bg-red-50">
                          <TableCell colSpan={4} className="px-5 py-2.5">
                            <p className="text-xs text-red-800">
                              <strong>Employee concern:</strong> {item.concernNote}
                            </p>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Tax Certificate tab */}
        {tab === 'taxCertificate' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Tax Certificate</h3>
              <p className="text-xs text-gray-500 mt-1">
                One row per payroll month in the range below: Sr No, CPR No, Month, Salary, Tax, Payment Date.
                CPR No is each month&apos;s tax deposit receipt number — set per payroll run on the{' '}
                <a href="/hr?tab=payroll" className="font-medium text-brand-700 hover:underline">HR → Payroll</a> list, blank until entered there.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input
                  type="month"
                  value={taxCertFrom}
                  onChange={(e) => setTaxCertFrom(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input
                  type="month"
                  value={taxCertTo}
                  onChange={(e) => setTaxCertTo(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                />
              </div>
              <button
                onClick={async () => {
                  if (!taxCertFrom || !taxCertTo) return;
                  if (taxCertFrom > taxCertTo) { toast.error('"From" must be on or before "To".'); return; }
                  setTaxCertDownloading(true);
                  try {
                    await downloadAuthedFile(
                      `/hr/workers/${id}/tax-certificate`,
                      `tax-certificate-${worker.user?.name || 'employee'}-${taxCertFrom}-to-${taxCertTo}.pdf`,
                      { from: taxCertFrom, to: taxCertTo, format: 'pdf' },
                    );
                  } catch (e: any) {
                    toast.error(e?.message || 'Download failed.');
                  } finally {
                    setTaxCertDownloading(false);
                  }
                }}
                disabled={taxCertDownloading || !taxCertFrom || !taxCertTo}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                {taxCertDownloading ? 'Downloading…' : 'Download PDF'}
              </button>
              <button
                onClick={async () => {
                  if (!taxCertFrom || !taxCertTo) return;
                  if (taxCertFrom > taxCertTo) { toast.error('"From" must be on or before "To".'); return; }
                  setTaxCertDownloading(true);
                  try {
                    await downloadAuthedFile(
                      `/hr/workers/${id}/tax-certificate`,
                      `tax-certificate-${worker.user?.name || 'employee'}-${taxCertFrom}-to-${taxCertTo}.csv`,
                      { from: taxCertFrom, to: taxCertTo, format: 'csv' },
                    );
                  } catch (e: any) {
                    toast.error(e?.message || 'Download failed.');
                  } finally {
                    setTaxCertDownloading(false);
                  }
                }}
                disabled={taxCertDownloading || !taxCertFrom || !taxCertTo}
                className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                CSV
              </button>
            </div>
          </div>
        )}

        {/* Documents tab */}
        {tab === 'documents' && (
          <div className="space-y-4">
            {/* Generate standard documents */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-brand-700" />
                <h3 className="text-sm font-semibold text-gray-900">Generate Standard Documents</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {GENERATABLE_DOCS.map(({ type, label }) => (
                  <div key={type} className="flex flex-wrap items-center justify-between px-5 py-3 gap-2">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                      <span className="text-sm text-gray-800">{label}</span>
                    </div>
                    <button
                      onClick={async () => {
                        setGeneratingType(type);
                        const doc = await generateAndSaveDoc(id, type);
                        setGeneratingType(null);
                        if (doc) {
                          qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
                          toast.success(`${label} generated and saved to Documents.`);
                          if (doc.fileUrl) window.open(doc.fileUrl, '_blank');
                        }
                      }}
                      disabled={generatingType === type}
                      className="flex items-center gap-1.5 text-xs font-medium text-brand-800 hover:text-brand-900 bg-brand-50 hover:bg-brand-100 disabled:opacity-60 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {generatingType === type ? 'Generating…' : 'Generate PDF'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowDocForm(!showDocForm)}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Wand2 className="w-4 h-4" />
                Add Document
              </button>
            </div>

            {showDocForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Add Document</h3>
                <p className="text-xs text-gray-500">
                  Standard letters are generated from templates — no file upload needed. Upload only for custom files (offer, NDA, scans, etc.).
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Document Type</label>
                    <select
                      value={docForm.type}
                      onChange={(e) => setDocForm({ ...docForm, type: e.target.value, fileUrl: '' })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      <optgroup label="Preformatted (auto-generate)">
                        {GENERATABLE_DOCS.map(({ type, label }) => (
                          <option key={type} value={type}>{label}</option>
                        ))}
                      </optgroup>
                      <optgroup label="Upload required">
                        {['offer_letter', 'nda', 'contract', 'cnic_copy', 'cnic_front', 'cnic_back', 'cv', 'warning_letter', 'other'].map((t) => (
                          <option key={t} value={t}>{titleCase(t)}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Label (optional)</label>
                    <input
                      value={docForm.label}
                      onChange={(e) => setDocForm({ ...docForm, label: e.target.value })}
                      placeholder="e.g. Appointment Letter 2026"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  {!GENERATABLE_DOCS.some((d) => d.type === docForm.type) && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">Attach File <span className="text-red-500">*</span></label>
                      <div className="flex items-center gap-3">
                        <input ref={docFileRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadDocFile(e.target.files[0]); }} />
                        <button type="button" onClick={() => docFileRef.current?.click()} disabled={docUploading}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-60 text-gray-700">
                          <Upload className="w-4 h-4" />
                          {docUploading ? 'Uploading…' : 'Upload File'}
                        </button>
                        {docForm.fileUrl && (
                          <span className="text-xs text-brand-700 truncate max-w-xs">File ready to attach</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={async () => {
                      const isTemplate = GENERATABLE_DOCS.some((d) => d.type === docForm.type);
                      if (isTemplate) {
                        setGeneratingType(docForm.type);
                        const doc = await generateAndSaveDoc(id, docForm.type);
                        setGeneratingType(null);
                        if (doc) {
                          qc.invalidateQueries({ queryKey: ['hr-worker-documents', id] });
                          setShowDocForm(false);
                          setDocForm(BLANK_DOC);
                          toast.success(`${doc.label || titleCase(doc.type)} generated — employee can view it under My Documents.`);
                          if (doc.fileUrl) window.open(doc.fileUrl, '_blank');
                        }
                        return;
                      }
                      if (!docForm.fileUrl) {
                        toast.error('Please upload a file for this document type.');
                        return;
                      }
                      createDoc.mutate(docForm);
                    }}
                    disabled={createDoc.isPending || generatingType === docForm.type || docUploading}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {generatingType === docForm.type || createDoc.isPending
                      ? 'Saving…'
                      : GENERATABLE_DOCS.some((d) => d.type === docForm.type)
                        ? 'Generate & Add'
                        : 'Save Document'}
                  </button>
                  <button onClick={() => setShowDocForm(false)} className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            )}

            {(() => {
              const pendingRequests = (documents as any[]).filter((d) => d.status === 'requested');
              if (pendingRequests.length === 0) return null;
              return (
                <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-amber-200">
                    <h3 className="text-sm font-semibold text-amber-900">Pending employee requests ({pendingRequests.length})</h3>
                    <p className="text-xs text-amber-700 mt-0.5">Issue the letter to notify the employee — they can then view and download it.</p>
                  </div>
                  <div className="divide-y divide-amber-100">
                    {pendingRequests.map((doc: any) => (
                      <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5 bg-white/60">
                        <FileText className="w-4 h-4 text-amber-600 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{doc.label || titleCase(doc.type)}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Requested {formatDate(doc.createdAt)}</p>
                        </div>
                        <button
                          onClick={() => fulfillDocRequest.mutate(doc.id)}
                          disabled={fulfillDocRequest.isPending}
                          className="text-xs font-medium bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg"
                        >
                          {fulfillDocRequest.isPending ? 'Issuing…' : 'Issue letter'}
                        </button>
                        <button
                          onClick={() => setDeclineDocTarget({
                            id: doc.id,
                            label: doc.label || titleCase(doc.type),
                          })}
                          disabled={rejectDocRequest.isPending}
                          className="text-xs font-medium border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-60 px-3 py-1.5 rounded-lg"
                        >
                          Decline
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">Documents</h3>
                <ShowInactiveToggle {...inactive.toggleProps} className="ml-auto" />
              </div>
              <div className="divide-y divide-gray-100">
                {(documents as any[]).filter((d) => d.status !== 'requested').length === 0 ? (
                  <p className="px-5 py-8 text-sm text-gray-400 text-center">No documents yet.</p>
                ) : (
                  (documents as any[]).filter((d) => d.status !== 'requested').map((doc: any) => (
                    <div key={doc.id} className={cn('flex items-center gap-3 px-5 py-3.5', inactiveRow(doc.isActive))}>
                      <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.label || titleCase(doc.type)}</p>
                        <p className="text-xs text-gray-400 mt-0.5 capitalize">
                          {titleCase(doc.type)} · {formatDate(doc.createdAt)}
                          {doc.status === 'rejected' ? ' · Declined' : ''}
                        </p>
                        {doc.status === 'rejected' && doc.rejectionReason && (
                          <p className="text-xs text-red-600 mt-1 normal-case">Reason: {doc.rejectionReason}</p>
                        )}
                      </div>
                      {doc.fileUrl ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="p-1 text-gray-400 hover:text-brand-700 transition-colors" title="View">
                            <Eye className="w-4 h-4" />
                          </a>
                          <button onClick={() => handleDownloadDoc(doc)} className="p-1 text-gray-400 hover:text-brand-700 transition-colors" title="Download">
                            <Download className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">No file</span>
                      )}
                      <ActiveToggle
                        isActive={doc.isActive !== false}
                        label="document"
                        disabled={toggleDocActive.isPending}
                        onToggle={(next) => {
                          if (next) { toggleDocActive.mutate({ docId: doc.id, next }); return; }
                          setDeleteDocId(doc.id);
                        }}
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Appraisals tab */}
        {tab === 'appraisals' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowAppraisalForm(!showAppraisalForm)}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Wand2 className="w-4 h-4" />
                New Appraisal
              </button>
            </div>

            {showAppraisalForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">New Appraisal</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Review Date</label>
                    <input
                      type="date"
                      value={appraisalForm.reviewDate}
                      onChange={(e) => setAppraisalForm({ ...appraisalForm, reviewDate: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Rating</label>
                    <input
                      value={appraisalForm.rating}
                      onChange={(e) => setAppraisalForm({ ...appraisalForm, rating: e.target.value })}
                      placeholder="e.g. Exceeds Expectations"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">New Salary <span className="text-gray-400 font-normal">(leave unchanged if no raise)</span></label>
                    <input
                      type="number"
                      value={appraisalForm.salaryAfter}
                      onChange={(e) => setAppraisalForm({ ...appraisalForm, salaryAfter: e.target.value })}
                      placeholder={worker.salaryBase ? String(worker.salaryBase) : 'e.g. 60000'}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Notes</label>
                    <textarea
                      value={appraisalForm.notes}
                      onChange={(e) => setAppraisalForm({ ...appraisalForm, notes: e.target.value })}
                      rows={3}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => createAppraisal.mutate(appraisalForm)}
                    disabled={createAppraisal.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {createAppraisal.isPending ? 'Saving…' : 'Save Appraisal'}
                  </button>
                  <button onClick={() => setShowAppraisalForm(false)} className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">History</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {(appraisals as any[]).length === 0 ? (
                  <p className="px-5 py-8 text-sm text-gray-400 text-center">No appraisals recorded yet.</p>
                ) : (
                  (appraisals as any[]).map((a: any) => (
                    <div key={a.id} className="px-5 py-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">{formatDate(a.reviewDate)}{a.rating ? ` · ${a.rating}` : ''}</p>
                        {a.salaryBefore !== null && a.salaryAfter !== null && String(a.salaryBefore) !== String(a.salaryAfter) && (
                          <span className="text-xs font-medium text-brand-800 bg-brand-50 px-2 py-0.5 rounded-full">
                            {a.salaryBefore} → {a.salaryAfter}
                          </span>
                        )}
                      </div>
                      {a.notes && <p className="text-sm text-gray-600 mt-1">{a.notes}</p>}
                      <p className="text-xs text-gray-400 mt-1">{a.approver?.name ? `Reviewed by ${a.approver.name}` : ''}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
