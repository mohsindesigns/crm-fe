'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText, Download, Eye, AlertCircle, CheckCircle, PlusCircle, ClipboardList, Receipt, Upload, X, MapPin, MapPinOff, LogIn, LogOut, Info,
} from 'lucide-react';
import api from '@/lib/api';
import Header from '@/components/layout/Header';
import Pagination from '@/components/Pagination';
import ProfilePhotoCropper from '@/components/ProfilePhotoCropper';
import ProfilePhotoActions from '@/components/ProfilePhotoActions';
import ImageLightbox from '@/components/ImageLightbox';
import AttendanceBoard from '@/components/AttendanceBoard';
import AttendanceStatusBadges, { AttendanceLabelLegend, getAttendanceStatusBadges } from '@/components/AttendanceStatusBadges';
import { isWeekendDate } from '@/lib/attendanceDate';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useAuthStore } from '@/store/auth';
import { cn, formatDate, formatPeriod, downloadFile, downloadAuthedFile, uploadErrorMessage, titleCase } from '@/lib/utils';
import { marksAttendance } from '@/lib/routePermissions';
import { toast } from 'sonner';

const BLANK_PROFILE = {
  name: '', email: '', joiningDate: '', dateOfBirth: '', profilePictureUrl: '', cnic: '', address: '',
  emergencyContact: '', emergencyPhone: '',
  bankName: '', bankBranchName: '', bankBranchCity: '', bankAccountTitle: '', bankAccountNumber: '', iban: '',
};

const LEAVE_TYPES = ['annual', 'sick', 'casual', 'unpaid', 'other'];

/** Inclusive working days; configured weekly offs are excluded (matches backend). */
function countLeaveDays(fromDate: string, toDate: string, weekendDays: number[] = [0, 6]) {
  if (!fromDate || !toDate) return 0;
  const off = new Set(weekendDays);
  const a = new Date(`${fromDate.slice(0, 10)}T00:00:00Z`);
  const b = new Date(`${toDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return 0;
  let days = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += 86400000) {
    if (!off.has(new Date(t).getUTCDay())) days += 1;
  }
  return days;
}

function leavesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string) {
  return aFrom <= bTo && aTo >= bFrom;
}

// Auto-format CNIC input while typing/pasting to: 12345-1234567-1
function formatCnic(raw: string) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 13);
  const a = digits.slice(0, 5);
  const b = digits.slice(5, 12);
  const c = digits.slice(12, 13);
  if (digits.length <= 5) return a;
  if (digits.length <= 12) return `${a}-${b}`;
  return `${a}-${b}-${c}`;
}

const CNIC_PATTERN = /^\d{5}-\d{7}-\d{1}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const REQUIRED_PROFILE_DOCS = ['cv', 'cnic_front', 'cnic_back'] as const;

const REQUIRED_DOC_LABELS: Record<(typeof REQUIRED_PROFILE_DOCS)[number], string> = {
  cv: 'CV / Resume',
  cnic_front: 'CNIC — Front',
  cnic_back: 'CNIC — Back',
};

const REQUESTABLE_DOCS = [
  { type: 'appointment_letter', label: 'Appointment Letter' },
  { type: 'confirmation_letter', label: 'Confirmation Letter' },
  { type: 'bank_opening_letter', label: 'Bank Account Opening Letter' },
  { type: 'experience_letter', label: 'Experience Letter' },
  { type: 'salary_certificate', label: 'Salary Certificate' },
];

type ProfileDocState = Record<string, { fileUrl?: string; fileName?: string }>;

function isProfileRequiredComplete(
  form: {
    email?: string;
    cnic?: string;
    bankName?: string;
    bankAccountTitle?: string;
    bankAccountNumber?: string;
  },
  docs?: ProfileDocState,
) {
  const hasValidEmail = Boolean(form.email?.trim()) && EMAIL_PATTERN.test(form.email.trim());

  const hasRequiredBank =
    Boolean(form.bankName?.trim())
    && Boolean(form.bankAccountTitle?.trim())
    && Boolean(form.bankAccountNumber?.trim());

  const hasValidCnic = Boolean(form.cnic) && CNIC_PATTERN.test(form.cnic);

  const hasRequiredDocs = REQUIRED_PROFILE_DOCS.every((k) => Boolean(docs?.[k]?.fileUrl));

  return hasValidEmail && hasValidCnic && hasRequiredBank && hasRequiredDocs;
}

function getMissingProfileFields(
  form: {
    email?: string;
    cnic?: string;
    bankName?: string;
    bankAccountTitle?: string;
    bankAccountNumber?: string;
  },
  docs?: ProfileDocState,
) {
  const missing: string[] = [];
  if (!form.email?.trim() || !EMAIL_PATTERN.test(form.email.trim())) missing.push('Email');
  if (!form.cnic || !CNIC_PATTERN.test(form.cnic)) missing.push('CNIC');
  if (!form.bankName?.trim()) missing.push('Bank Name');
  if (!form.bankAccountTitle?.trim()) missing.push('Account Title');
  if (!form.bankAccountNumber?.trim()) missing.push('Account Number');

  REQUIRED_PROFILE_DOCS.forEach((k) => {
    if (!docs?.[k]?.fileUrl) missing.push(REQUIRED_DOC_LABELS[k]);
  });

  return missing;
}

const PAY_MODEL_LABEL: Record<string, string> = {
  salary: 'Salary',
  per_deliverable: 'Per Deliverable',
  hourly: 'Hourly',
  fixed_invoice: 'Fixed Invoice',
};

/** Email field that requires OTP verification before a new address becomes the login email. */
function VerifiableEmailField({
  value,
  verifiedEmail,
  disabled,
  onChange,
  onVerified,
  inputClassName,
  labelClassName,
}: {
  value: string;
  verifiedEmail: string;
  disabled?: boolean;
  onChange: (email: string) => void;
  onVerified: (email: string) => void;
  inputClassName?: string;
  labelClassName?: string;
}) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const normalizedValue = value.trim().toLowerCase();
  const normalizedVerified = (verifiedEmail || '').trim().toLowerCase();
  const isDirty = Boolean(normalizedValue) && normalizedValue !== normalizedVerified;
  const canSend = isDirty && EMAIL_PATTERN.test(normalizedValue) && !disabled;

  useEffect(() => {
    if (!isDirty) {
      setCodeSent(false);
      setCode('');
    }
  }, [isDirty, normalizedValue]);

  async function sendCode() {
    if (!canSend) return;
    setSending(true);
    try {
      await api.post('/hr/me/email/request-code', { email: normalizedValue });
      setCodeSent(true);
      setCode('');
      toast.success(`Verification code sent to ${normalizedValue}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Failed to send verification code.');
    } finally {
      setSending(false);
    }
  }

  async function confirmCode() {
    if (!code.trim() || code.trim().length < 6) {
      toast.error('Enter the 6-digit code from your email.');
      return;
    }
    setConfirming(true);
    try {
      const res = await api.post('/hr/me/email/confirm', { email: normalizedValue, code: code.trim() });
      const nextEmail = res.data?.email || normalizedValue;
      onVerified(nextEmail);
      setCodeSent(false);
      setCode('');
      toast.success('Email verified and updated.');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Invalid verification code.');
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div>
      <label className={labelClassName || 'block text-xs font-medium text-gray-700 mb-1.5'}>
        Email <span className="text-red-500">*</span>
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="email"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="you@example.com"
          className={inputClassName || 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600'}
        />
        {canSend && !codeSent && (
          <button
            type="button"
            onClick={sendCode}
            disabled={sending}
            className="shrink-0 px-3 py-2 text-xs font-medium text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
          >
            {sending ? 'Sending…' : 'Send code'}
          </button>
        )}
      </div>
      {!isDirty && normalizedVerified && (
        <p className="mt-1.5 text-[11px] text-brand-700">Verified — this is your login email.</p>
      )}
      {isDirty && !codeSent && (
        <p className="mt-1.5 text-[11px] text-amber-700">
          Verify this new email with a one-time code before it can be saved.
        </p>
      )}
      {codeSent && (
        <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50/50 p-3">
          <p className="text-[11px] text-gray-600">
            Enter the 6-digit code we sent to <strong>{normalizedValue}</strong>
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              className="w-full sm:w-40 px-3 py-2 text-sm tracking-[0.3em] font-semibold text-center border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              type="button"
              onClick={confirmCode}
              disabled={confirming || code.length < 6}
              className="px-3 py-2 text-xs font-medium text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 rounded-lg"
            >
              {confirming ? 'Verifying…' : 'Verify email'}
            </button>
            <button
              type="button"
              onClick={sendCode}
              disabled={sending}
              className="px-3 py-2 text-xs font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 rounded-lg"
            >
              {sending ? 'Sending…' : 'Resend'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const WORKER_STATUS_LABEL: Record<string, string> = {
  invited: 'Invited',
  profile_pending: 'Profile Pending',
  under_review: 'Under Review',
  profile_amended: 'Amendment Under Review',
  active: 'Active',
  inactive: 'Inactive',
};

const readOnlyInputClass = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-600 cursor-not-allowed';
const profileInputClass = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:bg-gray-50 disabled:text-gray-500';

const STATUS_COLOR: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-700',
  approved: 'bg-brand-100 text-brand-800',
  rejected: 'bg-red-100 text-red-700',
  pending_review: 'bg-amber-100 text-amber-700',
  confirmed: 'bg-brand-100 text-brand-800',
  concern_raised: 'bg-red-100 text-red-700',
  rectifying: 'bg-blue-100 text-blue-700',
};

function money(amount: number | string | null | undefined, currency = 'PKR') {
  return `${currency} ${Number(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function payrollLineLabel(key: string) {
  const labels: Record<string, string> = {
    overtime: 'Overtime',
    attendancePay: 'Attendance pay',
    medical: 'Medical Allowance',
    absenceCut: 'Absence deduction',
    bonus: 'Bonus',
    allowance: 'Allowance',
    tax: 'Tax',
    late: 'Late deduction',
  };
  return labels[key] || titleCase(key);
}

const PAYROLL_META_KEYS = new Set([
  'payableDays', 'workingDays', 'perDayRate', 'monthlySalary',
  'halfDayCredit', 'holidayDays', 'formula', 'daysInMonth', 'nonTaxableComponents',
]);

function PayrollBreakdown({
  item,
  currency = 'PKR',
  tone = 'amber',
}: {
  item: any;
  currency?: string;
  tone?: 'amber' | 'neutral';
}) {
  const additions = (item?.additions && typeof item.additions === 'object') ? item.additions : {};
  const deductions = (item?.deductions && typeof item.deductions === 'object') ? item.deductions : {};
  const additionEntries = Object.entries(additions)
    .filter(([k, v]) => !PAYROLL_META_KEYS.has(k) && Number(v) !== 0);
  const deductionEntries = Object.entries(deductions).filter(([, v]) => Number(v) !== 0);
  const nonTaxableNames = new Set(
    Array.isArray(additions.nonTaxableComponents) ? additions.nonTaxableComponents : [],
  );
  const muted = tone === 'amber' ? 'text-amber-700' : 'text-gray-500';
  const border = tone === 'amber' ? 'border-amber-200/80 bg-white/70' : 'border-gray-100 bg-gray-50';
  const monthlySalary = Number(additions.monthlySalary != null ? additions.monthlySalary : item.base || 0);
  const daysInMonth = Number(additions.daysInMonth || 0);
  const payableDays = Number(additions.payableDays != null ? additions.payableDays : NaN);
  const formula = additions.formula as string | undefined;

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', border)}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Present', value: item.presentDays ?? 0 },
          { label: 'Absent', value: item.absentDays ?? 0 },
          { label: 'Leave', value: item.leaveDays ?? 0 },
          { label: 'Half-day', value: item.halfDays ?? 0 },
        ].map((s) => (
          <div key={s.label}>
            <p className={cn('text-[11px] font-medium', muted)}>{s.label}</p>
            <p className="text-sm font-semibold text-gray-900 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>
      {(daysInMonth > 0 || Number.isFinite(payableDays)) && (
        <div className={cn('rounded-lg border px-3 py-2 text-xs space-y-1', tone === 'amber' ? 'border-amber-200 bg-amber-50/80' : 'border-gray-200 bg-white')}>
          <p className="font-semibold text-gray-800">How net is calculated</p>
          <p className={muted}>
            (Monthly salary ÷ calendar days in month) × payable days
            {formula ? <> — <span className="font-medium text-gray-800">{formula}</span></> : null}
          </p>
          <p className={muted}>
            Payable days = calendar days employed this month − unpaid absence
            {Number.isFinite(payableDays) ? <> (= <span className="font-semibold text-gray-800">{payableDays}</span>)</> : null}
            {daysInMonth > 0 ? <> · Days in month: <span className="font-semibold text-gray-800">{daysInMonth}</span></> : null}
            {monthlySalary > 0 ? <> · Salary: <span className="font-semibold text-gray-800">{money(monthlySalary, currency)}</span></> : null}
          </p>
        </div>
      )}
      {Number(item.overtimeHours) > 0 && (
        <p className={cn('text-xs', muted)}>
          Overtime hours: <span className="font-semibold text-gray-800">{Number(item.overtimeHours).toLocaleString()}</span>
        </p>
      )}
      {Number(item.lateCount) > 0 && (
        <p className={cn('text-xs', muted)}>
          Late arrivals this period: <span className="font-semibold text-gray-800">{item.lateCount}</span>
          {Number(item.latePenaltyDays) > 0 && (
            <>
              {' — '}
              {Number(item.latePenaltyUnpaidDays) > 0
                ? `${item.latePenaltyDays} day(s) deducted (${item.latePenaltyUnpaidDays} unpaid, no leave balance left)`
                : `${item.latePenaltyDays} day(s) deducted from leave balance`}
            </>
          )}
        </p>
      )}

      <div className="border-t border-gray-200/70 pt-3 space-y-1.5">
        <div className="flex flex-wrap items-center justify-between text-sm gap-2">
          <span className="text-gray-600">Monthly salary (contract)</span>
          <span className="font-medium text-gray-900 tabular-nums">{money(monthlySalary, currency)}</span>
        </div>
        {additionEntries.map(([key, value]) => (
          <div key={`add-${key}`} className="flex flex-wrap items-center justify-between text-sm gap-2">
            <span className="text-gray-600">
              {payrollLineLabel(key)}
              {nonTaxableNames.has(key) && <span className="ml-1 text-[10px] text-gray-400">(non-taxable)</span>}
            </span>
            <span className="font-medium text-brand-800 tabular-nums">+ {money(value as number, currency)}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between text-sm pt-1 border-t border-dashed border-gray-200 gap-2">
          <span className="font-medium text-gray-700">Gross pay</span>
          <span className="font-semibold text-gray-900 tabular-nums">{money(item.computedGross, currency)}</span>
        </div>
        {deductionEntries.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between text-sm gap-2">
            <span className="text-gray-600">Deductions</span>
            <span className="font-medium text-gray-500 tabular-nums">{money(0, currency)}</span>
          </div>
        ) : (
          deductionEntries.map(([key, value]) => (
            <div key={`ded-${key}`} className="flex flex-wrap items-center justify-between text-sm gap-2">
              <span className="text-gray-600">{payrollLineLabel(key)}</span>
              <span className="font-medium text-red-700 tabular-nums">− {money(value as number, currency)}</span>
            </div>
          ))
        )}
        <div className="flex flex-wrap items-center justify-between text-sm pt-2 border-t border-gray-200 gap-2">
          <span className="font-semibold text-gray-900">Net pay</span>
          <span className="text-base font-bold text-gray-900 tabular-nums">{money(item.computedNet, currency)}</span>
        </div>
      </div>

      {item.adminNote && (
        <p className="text-xs text-gray-600 bg-white/80 border border-gray-200 rounded-lg px-3 py-2">
          <strong>Note from HR:</strong> {item.adminNote}
        </p>
      )}
    </div>
  );
}

function useWorker() {
  return useQuery({
    queryKey: ['hr-me'],
    queryFn: () => api.get('/hr/me').then((r) => r.data).catch(() => null),
  });
}

async function downloadSlipPdf(itemId: string, period: string) {
  try {
    await downloadAuthedFile(`/hr/payroll-items/${itemId}/slip`, `salary-slip-${formatPeriod(period)}.pdf`);
  } catch (e: any) {
    toast.error(e?.message || 'Download failed. Please try again.');
  }
}

export default function SelfServicePage() {
  const user = useAuthStore((s) => s.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canViewOrgAttendance = hasPermission('hr.read');
  // Owners/admins/partners don't mark personal attendance — see marksAttendance.
  const canMarkAttendance = marksAttendance(user?.role?.key);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<'profile' | 'payroll' | 'documents' | 'attendance' | 'leaves' | 'appraisals' | 'invoices'>('payroll');

  // Allow direct navigation to a tab via ?tab=profile, ?tab=attendance, etc.
  // ?tab=attendance is ignored for roles that don't mark attendance, so a stale
  // bookmark can't land them on a tab that no longer exists for them.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t === 'profile') setTab('profile');
    else if (t === 'attendance') setTab(canMarkAttendance || canViewOrgAttendance ? 'attendance' : 'payroll');
    else if (t === 'documents') setTab('documents');
    else if (t === 'leaves') setTab('leaves');
    else if (t === 'appraisals') setTab('appraisals');
    else if (t === 'payroll') setTab('payroll');
    else if (t === 'invoices') setTab('invoices');
  }, [searchParams, canMarkAttendance]);
  const [profileForm, setProfileForm] = useState(BLANK_PROFILE);
  const [leaveForm, setLeaveForm] = useState({ type: 'annual', fromDate: '', toDate: '', reason: '', isHalfDay: false });
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data: worker, isLoading: workerLoading } = useWorker();

  // Hydrate the profile form (and any already-uploaded documents) once when the worker
  // record first loads — keyed on id so it never clobbers edits the employee is mid-typing.
  useEffect(() => {
    if (!worker) return;
    setProfileForm({
      name: worker.user?.name || '',
      email: worker.user?.email || '',
      joiningDate: worker.joiningDate || '',
      dateOfBirth: worker.dateOfBirth || '',
      profilePictureUrl: worker.profilePictureUrl || '',
      cnic: worker.cnic ? formatCnic(worker.cnic) : '',
      address: worker.address || '',
      emergencyContact: worker.emergencyContact || '',
      emergencyPhone: worker.emergencyPhone || '',
      bankName: worker.bankName || '',
      bankBranchName: worker.bankBranchName || '',
      bankBranchCity: worker.bankBranchCity || '',
      bankAccountTitle: worker.bankAccountTitle || '',
      bankAccountNumber: worker.bankAccountNumber || '',
      iban: worker.iban || '',
    });
    const docs: Record<string, { fileUrl: string; fileName: string }> = {};
    (worker.documents || []).forEach((d: any) => {
      if (['cv', 'cnic_front', 'cnic_back'].includes(d.type)) {
        docs[d.type] = { fileUrl: d.fileUrl, fileName: d.fileName || d.type };
      }
    });
    setProfileDocs(docs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker?.id]);

  const { data: payrollItems = [] } = useQuery({
    queryKey: ['hr-me-payroll'],
    queryFn: () => api.get('/hr/me/payroll').then((r) => r.data),
    enabled: !!worker,
  });

  const { data: slips = [] } = useQuery({
    queryKey: ['hr-me-slips'],
    queryFn: () => api.get('/hr/me/slips').then((r) => r.data),
    enabled: !!worker,
  });

  // Read-only — HR configures this, see the worker's own Salary tab in HR → Workers.
  const { data: salarySplit = [] } = useQuery({
    queryKey: ['hr-me-salary-split'],
    queryFn: () => api.get('/hr/me/salary-split').then((r) => r.data),
    enabled: !!worker,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['hr-me-documents'],
    queryFn: () => api.get('/hr/me/documents').then((r) => r.data),
    enabled: !!worker,
  });

  const [requestDocType, setRequestDocType] = useState('appointment_letter');
  const [showRequestDoc, setShowRequestDoc] = useState(false);
  const requestDocument = useMutation({
    mutationFn: (type: string) => api.post('/hr/me/request-document', { type }).then((r) => r.data),
    onSuccess: (doc) => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-documents'] });
      setShowRequestDoc(false);
      toast.success(`Request sent for ${doc.label || titleCase(doc.type)}. HR will issue it shortly.`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Could not submit document request.'),
  });

  const [attPage, setAttPage] = useState(1);
  useEffect(() => { setAttPage(1); }, [currentMonth]);

  const { data: attendanceResp } = useQuery({
    queryKey: ['hr-me-attendance', currentMonth, attPage],
    queryFn: () => api.get(`/hr/me/attendance`, { params: { month: currentMonth, page: attPage, limit: 50 } }).then((r) => r.data),
    enabled: !!worker && !canViewOrgAttendance,
  });
  const attendance: any[] = attendanceResp?.data || [];

  // Attendance day is noon→noon (12:00 PM to next 12:00 PM), so a 3pm–12:30am
  // shift stays on one attendance day even after midnight. The server derives the
  // date/time from Asia/Karachi wall-clock time itself — not the employee's browser
  // clock — so VPN use or a wrong system clock can't shift attendance timing.
  const { data: attendanceStatus, refetch: refetchAttendanceStatus } = useQuery({
    queryKey: ['hr-me-attendance-status'],
    queryFn: () => api.get('/hr/me/attendance/status').then((r) => r.data),
    enabled: !!worker && !canViewOrgAttendance,
    refetchInterval: 60_000,
  });
  const todayRecord = attendanceStatus?.record || null;
  const [locating, setLocating] = useState<'in' | 'out' | null>(null);

  function getLocation(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Your browser does not support location access.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error('Location access was denied. Enable it in your browser settings to mark attendance.')),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  const checkInMutation = useMutation({
    mutationFn: (payload: { lat: number; lng: number }) =>
      api.post('/hr/me/attendance/check-in', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['hr-me-attendance-status'] });
      toast.success('Checked in.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Check-in failed.'),
  });

  const checkOutMutation = useMutation({
    mutationFn: (payload: { lat: number; lng: number }) =>
      api.post('/hr/me/attendance/check-out', payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['hr-me-attendance-status'] });
      toast.success('Checked out.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Check-out failed.'),
  });

  async function handleCheckIn() {
    setLocating('in');
    try {
      const coords = await getLocation();
      await checkInMutation.mutateAsync(coords);
      refetchAttendanceStatus();
    } catch (e: any) {
      toast.error(e.message || 'Could not get your location.');
    } finally {
      setLocating(null);
    }
  }

  async function handleCheckOut() {
    setLocating('out');
    try {
      const coords = await getLocation();
      await checkOutMutation.mutateAsync(coords);
      refetchAttendanceStatus();
    } catch (e: any) {
      toast.error(e.message || 'Could not get your location.');
    } finally {
      setLocating(null);
    }
  }

  const { data: leaves = [] } = useQuery({
    queryKey: ['hr-me-leaves'],
    queryFn: () => api.get('/hr/me/leaves').then((r) => r.data),
    enabled: !!worker,
  });

  const { data: leaveBalance } = useQuery({
    queryKey: ['hr-me-leave-balance'],
    queryFn: () => api.get('/hr/me/leave-balance').then((r) => r.data),
    enabled: !!worker && tab === 'leaves',
  });

  const { data: myAppraisals = [] } = useQuery({
    queryKey: ['hr-me-appraisals'],
    queryFn: () => api.get('/hr/me/appraisals').then((r) => r.data),
    enabled: !!worker && tab === 'appraisals',
  });

  const [profileDocs, setProfileDocs] = useState<Record<string, { fileUrl: string; fileName: string }>>({});
  const [docUploading, setDocUploading] = useState<string | null>(null);
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
      // Persist right away — media upload alone only puts the file on the CDN;
      // without this PATCH, refresh reloads the old Worker.profilePictureUrl.
      const updated = await api.patch('/hr/me/avatar', { profilePictureUrl: url }).then((r) => r.data);
      const savedUrl = updated?.profilePictureUrl || url;
      setProfileForm((f) => ({ ...f, profilePictureUrl: savedUrl }));
      useAuthStore.getState().updateUser({ avatarUrl: savedUrl });
      queryClient.invalidateQueries({ queryKey: ['hr-me'] });
      toast.success('Photo saved.');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || uploadErrorMessage(e));
    } finally {
      setAvatarUploading(false);
    }
  }

  async function uploadProfileDoc(type: 'cv' | 'cnic_front' | 'cnic_back', file: File) {
    setDocUploading(type);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setProfileDocs((d) => ({ ...d, [type]: { fileUrl: res.data.url, fileName: file.name } }));
      toast.success('File uploaded.');
    } catch (e: any) {
      toast.error(uploadErrorMessage(e));
    } finally {
      setDocUploading(null);
    }
  }

  const submitProfileMutation = useMutation({
    mutationFn: (data: typeof profileForm) => {
      const verifiedEmail = (worker?.user?.email || user?.email || '').trim().toLowerCase();
      const typedEmail = (data.email || '').trim().toLowerCase();
      if (typedEmail && typedEmail !== verifiedEmail) {
        return Promise.reject({
          response: { data: { message: 'Verify your new email with the code sent to that address before saving.' } },
        });
      }
      // Email is changed only via OTP confirm — keep current verified email on profile save.
      const { email: _email, ...rest } = data;
      return api.patch('/hr/me/profile', {
        ...rest,
        email: verifiedEmail,
        documents: Object.entries(profileDocs).map(([type, doc]) => ({ type, ...doc })),
      }).then((r) => r.data);
    },
    onSuccess: (updatedWorker: any) => {
      queryClient.invalidateQueries({ queryKey: ['hr-me'] });
      const authUpdates: { avatarUrl?: string; email?: string; name?: string } = {};
      if (updatedWorker?.profilePictureUrl) authUpdates.avatarUrl = updatedWorker.profilePictureUrl;
      if (updatedWorker?.user?.email) authUpdates.email = updatedWorker.user.email;
      if (updatedWorker?.user?.name) authUpdates.name = updatedWorker.user.name;
      if (Object.keys(authUpdates).length) useAuthStore.getState().updateUser(authUpdates);
      const msg = updatedWorker?.status === 'profile_amended'
        ? 'Profile changes submitted — HR will review them shortly.'
        : updatedWorker?.status === 'under_review'
          ? 'Profile submitted — HR will review it shortly.'
          : 'Profile saved.';
      toast.success(msg);
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      const fieldErrors = data?.errors ? Object.values(data.errors) : [];
      if (fieldErrors.length) {
        toast.error(fieldErrors.join(' '));
        return;
      }
      toast.error(data?.message || 'Failed to submit profile.');
    },
  });

  const payrollReviewMutation = useMutation({
    mutationFn: ({ itemId, employeeStatus, concernNote }: any) =>
      api.patch(`/hr/payroll-items/${itemId}/review`, { employeeStatus, concernNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-payroll'] });
      setShowConcernModal(false);
      setConcernNote('');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to submit.'),
  });

  const [showConcernModal, setShowConcernModal] = useState(false);
  const [concernNote, setConcernNote] = useState('');

  const leaveMutation = useMutation({
    mutationFn: (data: typeof leaveForm) => api.post('/hr/me/leaves', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-leaves'] });
      queryClient.invalidateQueries({ queryKey: ['hr-me-leave-balance'] });
      setShowLeaveForm(false);
      setLeaveForm({ type: 'annual', fromDate: '', toDate: '', reason: '', isHalfDay: false });
      toast.success('Leave request submitted.');
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Failed to submit leave request.'),
  });

  const pendingPayroll = payrollItems.find((i: any) => i.employeeStatus === 'pending_review');
  const isContractor = (worker as any)?.workerType === 'contractor';

  const [contractorInvoiceForm, setContractorInvoiceForm] = useState({ period: '', amount: '', currency: 'PKR', description: '', fileUrl: '' });
  const [showContractorForm, setShowContractorForm] = useState(false);

  const { data: contractorInvoices = [] } = useQuery({
    queryKey: ['hr-me-contractor-invoices'],
    queryFn: () => api.get('/hr/me/contractor-invoices').then((r) => r.data),
    enabled: !!worker && isContractor,
  });

  const submitContractorInvoice = useMutation({
    mutationFn: (data: typeof contractorInvoiceForm) => api.post('/hr/me/contractor-invoices', { ...data, amount: parseFloat(data.amount) }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr-me-contractor-invoices'] });
      setShowContractorForm(false);
      setContractorInvoiceForm({ period: '', amount: '', currency: 'PKR', description: '', fileUrl: '' });
    },
  });

  const TABS: { key: 'profile' | 'payroll' | 'documents' | 'attendance' | 'leaves' | 'appraisals' | 'invoices'; label: string }[] = [
    { key: 'profile', label: 'My Profile' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'documents', label: 'Documents' },
    // Admins, super admins and partners don't clock in against a shift, so the
    // personal marking widget and personal history are hidden for them rather
    // than shown permanently empty. They keep the tab only when they can review
    // everyone's attendance (hr.read), which renders the org-wide board instead.
    ...(canMarkAttendance || canViewOrgAttendance ? [{ key: 'attendance' as const, label: 'Attendance' }] : []),
    { key: 'leaves', label: 'Leave Requests' },
    { key: 'appraisals', label: 'Appraisals' },
    ...(isContractor ? [{ key: 'invoices' as const, label: 'My Invoices' }] : []),
  ];
  const pageTitle =
    tab === 'profile' ? 'My Profile'
    : tab === 'payroll' ? 'My Payroll'
    : tab === 'documents' ? 'My Documents'
    : tab === 'attendance' ? 'Attendance'
    : tab === 'leaves' ? 'Leave Requests'
    : tab === 'appraisals' ? 'Appraisals'
    : tab === 'invoices' ? 'My Invoices'
    : 'My Payroll';
  const profileLocked = worker?.status === 'profile_amended';

  if (workerLoading) {
    return (
      <div className="flex flex-col h-full">
        <Header title="My Payroll" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      </div>
    );
  }

  if (!worker) {
    const isAdminUser = user?.role?.key === 'super_admin' || user?.role?.key === 'admin';
    if (canViewOrgAttendance) {
      return (
        <div className="flex flex-col h-full">
          <Header title="Attendance" />
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-6xl mx-auto space-y-5">
              <AttendanceBoard />
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full">
        <Header title="My Payroll" />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-sm">
            <AlertCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-gray-700">No worker profile linked</p>
            {isAdminUser ? (
              <p className="text-xs text-gray-400 mt-1">
                To access your own payroll, create a worker profile for yourself in{' '}
                <a href="/hr" className="text-brand-700 hover:underline font-medium">HR &amp; Payroll → Workers</a>.
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-1">Contact your HR administrator to set up your employee profile.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Profile completion form — shown until HR approves. Stays editable even while
  // under_review so an employee can fix a mistake or add a missed document.
  if (['invited', 'profile_pending', 'under_review'].includes(worker.status)) {
    const underReview = worker.status === 'under_review';
    return (
      <div className="flex flex-col h-full">
        <Header title={underReview ? 'My Profile' : 'Complete Your Profile'} />
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
        <ImageLightbox src={lightboxSrc} alt={user?.name || 'Profile'} onClose={() => setLightboxSrc(null)} />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className={cn(
              'rounded-xl p-4 flex items-start gap-3 border',
              underReview
                ? 'bg-violet-50 border-violet-200'
                : worker.status === 'profile_pending' && worker.rejectionReason
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200'
            )}>
              <ClipboardList className={cn(
                'w-5 h-5 shrink-0 mt-0.5',
                underReview
                  ? 'text-violet-600'
                  : worker.status === 'profile_pending' && worker.rejectionReason
                    ? 'text-red-600'
                    : 'text-amber-600'
              )} />
              <div>
                <p className={cn(
                  'text-sm font-semibold',
                  underReview
                    ? 'text-violet-800'
                    : worker.status === 'profile_pending' && worker.rejectionReason
                      ? 'text-red-800'
                      : 'text-amber-800'
                )}>
                  {underReview
                    ? 'Profile under review'
                    : worker.status === 'profile_pending' && worker.rejectionReason
                      ? 'Profile rejected — please revise and resubmit'
                      : 'Profile setup required'}
                </p>
                <p className={cn(
                  'text-xs mt-1',
                  underReview
                    ? 'text-violet-600'
                    : worker.status === 'profile_pending' && worker.rejectionReason
                      ? 'text-red-700'
                      : 'text-amber-600'
                )}>
                  {underReview
                    ? "Your profile is being reviewed by HR. Noticed something missing or wrong? You can still update it below and resubmit — your changes will be included in the review."
                    : worker.status === 'profile_pending' && worker.rejectionReason
                      ? 'HR reviewed your submission and sent it back. Update the details below and submit again for review.'
                      : 'Please fill in your personal and bank details. Once submitted, HR will review and activate your account.'}
                </p>
                {worker.status === 'profile_pending' && worker.rejectionReason && (
                  <p className="text-xs text-red-800 bg-red-100 border border-red-200 rounded-lg px-3 py-2 mt-2">
                    <strong>Reason from HR:</strong> {worker.rejectionReason}
                  </p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Personal Information</h3>
              <div className="flex items-center gap-4">
                {profileForm.profilePictureUrl ? (
                  <button
                    type="button"
                    onClick={() => setLightboxSrc(profileForm.profilePictureUrl)}
                    className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-600"
                    title="View photo"
                  >
                    <img src={profileForm.profilePictureUrl} alt="Profile" className="w-16 h-16 rounded-full object-cover border border-gray-200 cursor-zoom-in" />
                  </button>
                ) : (
                  <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center text-xl font-semibold text-gray-600 shrink-0">
                    {user?.name?.charAt(0) || '?'}
                  </div>
                )}
                <ProfilePhotoActions
                  uploading={avatarUploading}
                  onFile={openAvatarCrop}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Full Name <span className="text-red-500">*</span></label>
                  <input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    placeholder="Your full name"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div className="sm:col-span-2">
                  <VerifiableEmailField
                    value={profileForm.email}
                    verifiedEmail={worker.user?.email || user?.email || ''}
                    onChange={(email) => setProfileForm({ ...profileForm, email })}
                    onVerified={(email) => {
                      setProfileForm((f) => ({ ...f, email }));
                      useAuthStore.getState().updateUser({ email });
                      queryClient.invalidateQueries({ queryKey: ['hr-me'] });
                    }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Date of Birth</label>
                  <input
                    type="date"
                    value={profileForm.dateOfBirth}
                    onChange={(e) => setProfileForm({ ...profileForm, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Joining Date</label>
                  <input
                    type="date"
                    value={profileForm.joiningDate}
                    onChange={(e) => setProfileForm({ ...profileForm, joiningDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">CNIC / National ID <span className="text-red-500">*</span></label>
                  <input
                    value={profileForm.cnic}
                    onChange={(e) => setProfileForm({ ...profileForm, cnic: formatCnic(e.target.value) })}
                    placeholder="12345-1234567-1"
                    maxLength={15}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    inputMode="numeric"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Address</label>
                  <input
                    value={profileForm.address}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                    placeholder="Full residential address"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Emergency Contact Name</label>
                  <input
                    value={profileForm.emergencyContact}
                    onChange={(e) => setProfileForm({ ...profileForm, emergencyContact: e.target.value })}
                    placeholder="Full name"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Emergency Contact Phone</label>
                  <input
                    value={profileForm.emergencyPhone}
                    onChange={(e) => setProfileForm({ ...profileForm, emergencyPhone: e.target.value })}
                    placeholder="+92 300 0000000"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Bank Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Bank Name <span className="text-red-500">*</span></label>
                  <input
                    value={profileForm.bankName}
                    onChange={(e) => setProfileForm({ ...profileForm, bankName: e.target.value })}
                    placeholder="e.g. Meezan Bank"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Branch Name</label>
                  <input
                    value={profileForm.bankBranchName}
                    onChange={(e) => setProfileForm({ ...profileForm, bankBranchName: e.target.value })}
                    placeholder="e.g. Gulshan Branch"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Branch City</label>
                  <input
                    value={profileForm.bankBranchCity}
                    onChange={(e) => setProfileForm({ ...profileForm, bankBranchCity: e.target.value })}
                    placeholder="e.g. Karachi"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Account Title <span className="text-red-500">*</span></label>
                  <input
                    value={profileForm.bankAccountTitle}
                    onChange={(e) => setProfileForm({ ...profileForm, bankAccountTitle: e.target.value })}
                    placeholder="As it appears on your account"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">Account Number <span className="text-red-500">*</span></label>
                  <input
                    value={profileForm.bankAccountNumber}
                    onChange={(e) => setProfileForm({ ...profileForm, bankAccountNumber: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">IBAN</label>
                  <input
                    value={profileForm.iban}
                    onChange={(e) => setProfileForm({ ...profileForm, iban: e.target.value })}
                    placeholder="PK00XXXX0000000000000000"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Documents</h3>
                <p className="text-xs text-gray-400 mt-0.5">Upload your CV and CNIC (front &amp; back) for HR verification. Required to submit.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  { key: 'cv' as const, label: 'CV / Resume', required: true, accept: '.pdf,.doc,.docx' },
                  { key: 'cnic_front' as const, label: 'CNIC — Front', required: true, accept: 'image/*,.pdf' },
                  { key: 'cnic_back' as const, label: 'CNIC — Back', required: true, accept: 'image/*,.pdf' },
                ]).map(({ key, label, accept }) => {
                  const doc = profileDocs[key];
                  const uploading = docUploading === key;
                  return (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        {label} <span className="text-red-500">*</span>
                      </label>
                      {doc ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50">
                          <FileText className="w-4 h-4 text-brand-700 shrink-0" />
                          <span className="flex-1 truncate text-gray-700">{doc.fileName}</span>
                          <button
                            type="button"
                            onClick={() => setProfileDocs((d) => { const next = { ...d }; delete next[key]; return next; })}
                            className="text-gray-400 hover:text-red-500 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <label className={cn(
                          'flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-lg cursor-pointer text-gray-500 hover:border-brand-500 hover:text-brand-700 transition-colors',
                          uploading && 'opacity-60 pointer-events-none'
                        )}>
                          <Upload className="w-4 h-4" />
                          {uploading ? 'Uploading…' : 'Upload file'}
                          <input
                            type="file"
                            accept={accept}
                            className="hidden"
                            onChange={(e) => { if (e.target.files?.[0]) uploadProfileDoc(key, e.target.files[0]); }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {submitProfileMutation.isError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {(submitProfileMutation.error as any)?.response?.data?.message || 'Failed to submit profile.'}
              </p>
            )}

            {!isProfileRequiredComplete(profileForm, profileDocs) && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                Complete required fields to submit: {getMissingProfileFields(profileForm, profileDocs).join(', ')}
              </p>
            )}

            <button
              onClick={() => submitProfileMutation.mutate(profileForm)}
              disabled={submitProfileMutation.isPending || !isProfileRequiredComplete(profileForm, profileDocs)}
              className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
            >
              {submitProfileMutation.isPending ? 'Saving…' : underReview ? 'Update Submission' : 'Submit for Review'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title={pageTitle} />
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
      <ImageLightbox src={lightboxSrc} alt={user?.name || 'Profile'} onClose={() => setLightboxSrc(null)} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        {/* Worker header */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            {(tab === 'profile' ? profileForm.profilePictureUrl || worker.profilePictureUrl : worker.profilePictureUrl) ? (
              <button
                type="button"
                onClick={() => setLightboxSrc(
                  (tab === 'profile' ? profileForm.profilePictureUrl || worker.profilePictureUrl : worker.profilePictureUrl) as string
                )}
                className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-600"
                title="View photo"
              >
                <img
                  src={(tab === 'profile' ? profileForm.profilePictureUrl || worker.profilePictureUrl : worker.profilePictureUrl) as string}
                  alt={user?.name}
                  className="w-12 h-12 rounded-full object-cover border border-gray-200 cursor-zoom-in"
                />
              </button>
            ) : (
              <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center text-brand-800 font-semibold text-lg">
                {user?.name?.charAt(0) || '?'}
              </div>
            )}
            <div>
              <p className="font-semibold text-gray-900">{user?.name}</p>
              <p className="text-sm text-gray-500">{worker.designation || 'Employee'} · {worker.department || '—'}</p>
              <p className="text-xs text-gray-400 mt-0.5">Joined {worker.joiningDate ? formatDate(worker.joiningDate) : '—'}</p>
              {tab === 'profile' && !profileLocked && (
                <ProfilePhotoActions
                  className="mt-2"
                  uploading={avatarUploading}
                  onFile={openAvatarCrop}
                />
              )}
            </div>
          </div>
          <span className={cn('px-3 py-1 text-xs font-medium rounded-full', STATUS_COLOR[worker.status] || 'bg-gray-100 text-gray-600')}>
            {titleCase(worker.status)}
          </span>
        </div>

        {/* Pending payroll action */}
        {pendingPayroll && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
            <div>
              <p className="text-sm font-semibold text-amber-800">
                {formatPeriod(pendingPayroll.run?.period)} salary — please review
              </p>
              <span className="mt-1 inline-block px-2.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">
                Awaiting your confirmation
              </span>
              <p className="text-xs text-amber-700 mt-2">
                Review the full calculation below, then confirm or raise a concern if something looks wrong.
              </p>
            </div>

            <PayrollBreakdown
              item={pendingPayroll}
              currency={worker.currency || 'PKR'}
              tone="amber"
            />

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => payrollReviewMutation.mutate({ itemId: pendingPayroll.id, employeeStatus: 'confirmed' })}
                disabled={payrollReviewMutation.isPending}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Confirm
              </button>
              <button
                onClick={() => setShowConcernModal(true)}
                disabled={payrollReviewMutation.isPending}
                className="flex items-center gap-1.5 border border-gray-300 hover:bg-gray-50 disabled:opacity-60 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <AlertCircle className="w-4 h-4" />
                Raise a concern
              </button>
            </div>
          </div>
        )}

        {/* Raise a concern modal */}
        {showConcernModal && (
          <Dialog open onOpenChange={(open) => { if (!open) setShowConcernModal(false); }}>
            <DialogContent className="max-w-md sm:max-w-md rounded-2xl shadow-xl">
              <DialogTitle className="sr-only">Raise a concern</DialogTitle>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Raise a concern</h3>
                <p className="text-xs text-gray-500 mt-1">Describe what looks wrong about this payroll — HR will review and follow up.</p>
              </div>
              <textarea
                autoFocus
                value={concernNote}
                onChange={(e) => setConcernNote(e.target.value)}
                rows={4}
                placeholder="e.g. My overtime hours look incorrect for this period…"
                className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowConcernModal(false); setConcernNote(''); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (!concernNote.trim()) { toast.error('Please describe your concern.'); return; }
                    payrollReviewMutation.mutate({ itemId: pendingPayroll.id, employeeStatus: 'concern_raised', concernNote: concernNote.trim() });
                  }}
                  disabled={payrollReviewMutation.isPending || !concernNote.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-brand-700 hover:bg-brand-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {payrollReviewMutation.isPending ? 'Submitting…' : 'Submit'}
                </button>
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-full sm:w-fit overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors shrink-0 whitespace-nowrap',
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Profile */}
        {tab === 'profile' && (
          <div className="space-y-5">
            {profileLocked && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">Profile amendment under review</p>
                  <p className="text-xs text-blue-600 mt-1">Your recent changes are being reviewed by HR. You can view your profile below but cannot edit it until the review is complete.</p>
                </div>
              </div>
            )}

            {!profileLocked && worker.rejectionReason && worker.status === 'active' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Profile changes rejected</p>
                  <p className="text-xs text-red-700 mt-1">
                    HR rejected your recent profile submission. Update the details below and save to resubmit for review.
                  </p>
                  <p className="text-xs text-red-800 bg-red-100 border border-red-200 rounded-lg px-3 py-2 mt-2">
                    <strong>Reason from HR:</strong> {worker.rejectionReason}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Employment Details</h3>
              <p className="text-xs text-gray-400 mb-4">Managed by HR — contact your administrator to request changes.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Designation</label>
                  <input value={worker.designation || ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
                  <input value={worker.department || ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Joining Date</label>
                  <input value={worker.joiningDate || ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Probation End</label>
                  <input value={worker.probationEndDate || ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Base Salary</label>
                  <input value={worker.salaryBase ?? ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Currency</label>
                  <input value={worker.currency || ''} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Pay Model</label>
                  <input value={PAY_MODEL_LABEL[worker.payModel] || titleCase(worker.payModel || '')} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Worker Type</label>
                  <input value={titleCase(worker.workerType || 'employee')} readOnly disabled className={readOnlyInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                  <input value={WORKER_STATUS_LABEL[worker.status] || titleCase(worker.status || '')} readOnly disabled className={readOnlyInputClass} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Personal &amp; Bank Details</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                  <input
                    value={profileForm.name}
                    disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                    placeholder="Your full name"
                    className={profileInputClass}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <VerifiableEmailField
                    value={profileForm.email}
                    verifiedEmail={worker.user?.email || user?.email || ''}
                    disabled={profileLocked}
                    onChange={(email) => setProfileForm({ ...profileForm, email })}
                    onVerified={(email) => {
                      setProfileForm((f) => ({ ...f, email }));
                      useAuthStore.getState().updateUser({ email });
                      queryClient.invalidateQueries({ queryKey: ['hr-me'] });
                    }}
                    inputClassName={profileInputClass}
                    labelClassName="block text-xs font-medium text-gray-500 mb-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Date of Birth</label>
                  <input type="date" value={profileForm.dateOfBirth} disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, dateOfBirth: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    CNIC / National ID <span className="text-red-500">*</span>
                  </label>
                  <input value={profileForm.cnic} disabled={profileLocked} placeholder="12345-1234567-1" maxLength={15}
                    onChange={(e) => setProfileForm({ ...profileForm, cnic: formatCnic(e.target.value) })}
                    className={profileInputClass}
                    inputMode="numeric"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
                  <input value={profileForm.address} disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, address: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Emergency Contact Name</label>
                  <input value={profileForm.emergencyContact} disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, emergencyContact: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Emergency Contact Phone</label>
                  <input value={profileForm.emergencyPhone} disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, emergencyPhone: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Bank Name <span className="text-red-500">*</span>
                  </label>
                  <input value={profileForm.bankName} disabled={profileLocked} placeholder="e.g. Meezan Bank"
                    onChange={(e) => setProfileForm({ ...profileForm, bankName: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Branch Name</label>
                  <input value={profileForm.bankBranchName} disabled={profileLocked} placeholder="e.g. Gulshan Branch"
                    onChange={(e) => setProfileForm({ ...profileForm, bankBranchName: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Branch City</label>
                  <input value={profileForm.bankBranchCity} disabled={profileLocked} placeholder="e.g. Karachi"
                    onChange={(e) => setProfileForm({ ...profileForm, bankBranchCity: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Account Title <span className="text-red-500">*</span>
                  </label>
                  <input value={profileForm.bankAccountTitle} disabled={profileLocked} placeholder="As it appears on your account"
                    onChange={(e) => setProfileForm({ ...profileForm, bankAccountTitle: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    Account Number <span className="text-red-500">*</span>
                  </label>
                  <input value={profileForm.bankAccountNumber} disabled={profileLocked}
                    onChange={(e) => setProfileForm({ ...profileForm, bankAccountNumber: e.target.value })}
                    className={profileInputClass} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
                  <input value={profileForm.iban} disabled={profileLocked} placeholder="PK00XXXX0000000000000000"
                    onChange={(e) => setProfileForm({ ...profileForm, iban: e.target.value })}
                    className={profileInputClass} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Documents</h3>
                <p className="text-xs text-gray-400 mt-0.5">Upload your CV and CNIC (front &amp; back) for HR records. You can replace files anytime before saving.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {([
                  { key: 'cv' as const, label: 'CV / Resume', required: true, accept: '.pdf,.doc,.docx' },
                  { key: 'cnic_front' as const, label: 'CNIC — Front', required: true, accept: 'image/*,.pdf' },
                  { key: 'cnic_back' as const, label: 'CNIC — Back', required: true, accept: 'image/*,.pdf' },
                ]).map(({ key, label, accept }) => {
                  const doc = profileDocs[key];
                  const uploading = docUploading === key;
                  return (
                    <div key={key}>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">
                        {label} <span className="text-red-500">*</span>
                      </label>
                      {doc ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50">
                          <FileText className="w-4 h-4 text-brand-700 shrink-0" />
                          <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-800 hover:underline">
                            {doc.fileName}
                          </a>
                          {!profileLocked && (
                            <button
                              type="button"
                              onClick={() => setProfileDocs((d) => { const next = { ...d }; delete next[key]; return next; })}
                              className="text-gray-400 hover:text-red-500 shrink-0"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : profileLocked ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-50 text-gray-400 italic">
                          <FileText className="w-4 h-4 shrink-0" />
                          Not uploaded
                        </div>
                      ) : (
                        <label className={cn(
                          'flex items-center justify-center gap-1.5 px-3 py-2 text-sm border border-dashed border-gray-300 rounded-lg cursor-pointer text-gray-500 hover:border-brand-500 hover:text-brand-700 transition-colors',
                          uploading && 'opacity-60 pointer-events-none',
                        )}>
                          <Upload className="w-4 h-4" />
                          {uploading ? 'Uploading…' : 'Upload file'}
                          <input
                            type="file"
                            accept={accept}
                            className="hidden"
                            onChange={(e) => { if (e.target.files?.[0]) uploadProfileDoc(key, e.target.files[0]); }}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {!profileLocked && (
              <div className="space-y-2">
                {submitProfileMutation.isError && (
                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    {(submitProfileMutation.error as any)?.response?.data?.message || 'Failed to save profile.'}
                  </p>
                )}
                {!isProfileRequiredComplete(profileForm, profileDocs) && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    Complete required fields to save: {getMissingProfileFields(profileForm, profileDocs).join(', ')}
                  </p>
                )}
                <button
                  onClick={() => submitProfileMutation.mutate(profileForm)}
                  disabled={submitProfileMutation.isPending || !isProfileRequiredComplete(profileForm, profileDocs)}
                  className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-6 py-2.5 rounded-lg transition-colors"
                >
                  {submitProfileMutation.isPending ? 'Saving…' : 'Save Profile Changes'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Payroll history */}
        {tab === 'payroll' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Payroll items */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Payroll history</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {payrollItems.length === 0 && (
                  <p className="px-5 py-8 text-sm text-gray-400 text-center">No payroll records yet.</p>
                )}
                {payrollItems.map((item: any) => (
                  <div key={item.id} className="px-5 py-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{formatPeriod(item.run?.period)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Net {money(item.computedNet, worker.currency || 'PKR')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn('px-2.5 py-0.5 text-xs font-medium rounded-full', STATUS_COLOR[item.employeeStatus] || 'bg-gray-100 text-gray-500')}>
                          {titleCase(item.employeeStatus)}
                        </span>
                        <button
                          onClick={() => downloadSlipPdf(item.id, item.run?.period || '')}
                          className="p-1 text-gray-400 hover:text-brand-700 transition-colors"
                          title="Download slip"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <PayrollBreakdown
                      item={item}
                      currency={worker.currency || 'PKR'}
                      tone="neutral"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Salary slips */}
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Salary slips</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {slips.length === 0 && (
                  <p className="px-5 py-8 text-sm text-gray-400 text-center">No salary slips generated yet.</p>
                )}
                {slips.map((slip: any) => (
                  <div key={slip.id} className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{formatPeriod(slip.payrollItem?.run?.period)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {worker.currency || 'PKR'} {Number(slip.payrollItem?.computedNet || 0).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => downloadSlipPdf(slip.payrollItemId, slip.payrollItem?.run?.period || '')}
                      className="p-1 text-brand-700 hover:text-brand-800 transition-colors"
                      title="Download PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Salary split — read-only; HR configures this from HR → Workers → Salary tab */}
            {salarySplit.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-sm font-semibold text-gray-900">Salary split</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Part of your net pay is sent to these recipients each payroll cycle; the rest goes to your
                    own account above. Set up by HR — contact them to change it.
                  </p>
                </div>
                <div className="divide-y divide-gray-100">
                  {salarySplit.map((b: any) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between px-5 py-3 gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{b.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {[b.relation, b.bankName, b.bankAccountNumber || b.iban].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <p className="text-sm font-semibold text-gray-900">
                        {b.splitType === 'fixed'
                          ? `${worker.currency || 'PKR'} ${Number(b.splitValue || 0).toLocaleString()}`
                          : `${Number(b.splitValue || 0)}%`}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Documents */}
        {tab === 'documents' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => setShowRequestDoc(!showRequestDoc)}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Request Document
              </button>
            </div>

            {showRequestDoc && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Request a Document</h3>
                <p className="text-xs text-gray-500">
                  Choose a letter type. Your request is sent to HR — once they issue it, you will be notified and can view or download it here.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Document Type</label>
                    <select
                      value={requestDocType}
                      onChange={(e) => setRequestDocType(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      {REQUESTABLE_DOCS.map(({ type, label }) => (
                        <option key={type} value={type}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => requestDocument.mutate(requestDocType)}
                    disabled={requestDocument.isPending}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {requestDocument.isPending ? 'Sending…' : 'Send Request'}
                  </button>
                  <button
                    onClick={() => setShowRequestDoc(false)}
                    className="border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">My Documents</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {documents.length === 0 && (
                  <p className="px-5 py-10 text-sm text-gray-400 text-center">No documents yet. Request one above or wait for HR to issue a letter.</p>
                )}
                {documents.map((doc: any) => {
                  const isPending = doc.status === 'requested';
                  const isRejected = doc.status === 'rejected';
                  return (
                  <div key={doc.id} className="flex items-center gap-3 px-5 py-3.5">
                    <FileText className={cn('w-4 h-4 shrink-0', isPending ? 'text-amber-500' : isRejected ? 'text-gray-300' : 'text-blue-500')} />
                    <div className="flex-1 min-w-0">
                      {doc.fileUrl && !isPending ? (
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline truncate block">
                          {doc.label || titleCase(doc.type)}
                        </a>
                      ) : (
                        <p className="text-sm font-medium text-gray-900 truncate">{doc.label || titleCase(doc.type)}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {titleCase(doc.type)} · {formatDate(doc.createdAt)}
                        {isPending && ' · Pending HR approval'}
                        {isRejected && ' · Declined'}
                      </p>
                      {isRejected && doc.rejectionReason && (
                        <p className="text-xs text-red-600 mt-1">Reason: {doc.rejectionReason}</p>
                      )}
                    </div>
                    {isPending ? (
                      <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">Pending</span>
                    ) : doc.fileUrl ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="p-1 text-gray-400 hover:text-brand-700 transition-colors" title="View">
                          <Eye className="w-4 h-4" />
                        </a>
                        <button
                          onClick={() => downloadFile(doc.fileUrl, doc.fileName || doc.label || doc.type || 'document').catch(() => toast.error('Download failed.'))}
                          className="p-1 text-gray-400 hover:text-brand-700 transition-colors" title="Download"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 italic px-2">{isRejected ? 'Declined' : 'No file attached'}</span>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Attendance */}
        {tab === 'attendance' && (
          canViewOrgAttendance ? (
            <AttendanceBoard />
          ) : (
          <div className="space-y-4">
            {/* Mark today's attendance — requires location; disabled without it */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-brand-700" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Today's Attendance</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Attendance day runs 12:00 PM → 12:00 PM (overnight shifts stay on one day). Location is required to check in or out.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!todayRecord?.checkIn ? (
                    <button
                      onClick={handleCheckIn}
                      disabled={locating === 'in' || checkInMutation.isPending}
                      className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      <LogIn className="w-4 h-4" />
                      {locating === 'in' ? 'Getting location…' : 'Check In'}
                    </button>
                  ) : !todayRecord?.checkOut ? (
                    <button
                      onClick={handleCheckOut}
                      disabled={locating === 'out' || checkOutMutation.isPending}
                      className="flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {locating === 'out' ? 'Getting location…' : `Check Out (in at ${todayRecord.checkIn?.slice(0, 5)})`}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm text-brand-800 bg-brand-50 px-3 py-2 rounded-lg">
                      <CheckCircle className="w-4 h-4" />
                      Done — {todayRecord.checkIn?.slice(0, 5)} → {todayRecord.checkOut?.slice(0, 5)}
                    </span>
                  )}
                </div>
              </div>
            </div>

          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Attendance — {currentMonth}</h3>
              <input
                type="month"
                value={currentMonth}
                onChange={(e) => { setCurrentMonth(e.target.value); setAttPage(1); }}
                className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
            </div>
            {attendance.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No attendance records for this month.</p>
            ) : (
              <>
                <AttendanceLabelLegend
                  className="px-5 pt-4"
                  items={(() => {
                    const weekendDays: number[] = leaveBalance?.weekendDays ?? [0, 6];
                    const otCount = (attendance as any[]).filter(
                      (a) => getAttendanceStatusBadges(a, weekendDays).some((b) => b.label === 'Overtime'),
                    ).length;
                    return [
                      { label: 'Present', count: attendance.filter((a: any) => a.status === 'present' && !isWeekendDate(String(a.date).slice(0, 10), weekendDays)).length },
                      { label: 'Absent', count: attendance.filter((a: any) => a.status === 'absent').length },
                      { label: 'Leave', count: attendance.filter((a: any) => a.status === 'leave').length },
                      { label: 'Half Day', count: attendance.filter((a: any) => a.status === 'half_day' && !isWeekendDate(String(a.date).slice(0, 10), weekendDays)).length },
                      { label: 'Holiday', count: attendance.filter((a: any) => a.status === 'holiday').length },
                      { label: 'Weekend', count: attendance.filter((a: any) => a.status === 'weekend').length },
                      { label: 'Overtime', count: otCount },
                    ];
                  })()}
                />
                <div className="flex gap-4 text-sm px-5 pt-2 pb-1 text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-full bg-orange-400 inline-block" />
                    Late: {attendance.filter((a: any) => a.isLate).length}
                  </span>
                </div>
                <div className="overflow-x-auto mt-3">
                  <Table className="w-full min-w-[640px]">
                    <TableHeader>
                      <TableRow className="border-b border-gray-200 bg-gray-100">
                        <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Date</TableHead>
                        <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Status</TableHead>
                        <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check In</TableHead>
                        <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Check Out</TableHead>
                        <TableHead className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-5 py-3">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-gray-100">
                      {attendance.map((a: any) => {
                        const mapLink = (lat: any, lng: any) => (lat != null && lng != null ? `https://www.google.com/maps?q=${lat},${lng}` : null);
                        const checkInMap = mapLink(a.checkInLat, a.checkInLng);
                        const checkOutMap = mapLink(a.checkOutLat, a.checkOutLng);
                        return (
                          <TableRow key={a.id} className="hover:bg-gray-50">
                            <TableCell className="px-5 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">{formatDate(a.date)}</TableCell>
                            <TableCell className="px-5 py-3">
                              <span className="flex items-center gap-1.5">
                                <AttendanceStatusBadges
                                  record={a}
                                  weekendDays={leaveBalance?.weekendDays ?? [0, 6]}
                                />
                                {a.note && (
                                  <span title={a.note}><Info className="w-3.5 h-3.5 text-gray-300" /></span>
                                )}
                              </span>
                            </TableCell>
                            <TableCell className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {a.checkIn ? (
                                <span className="flex items-center gap-1.5">
                                  {a.checkIn.slice(0, 5)}
                                  {a.isLate && (
                                    <span
                                      title={`${a.lateMinutes ?? 0} min late`}
                                      className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-orange-100 text-orange-700"
                                    >
                                      Late
                                    </span>
                                  )}
                                  {checkInMap ? (
                                    <a href={checkInMap} target="_blank" rel="noreferrer" title="View location" className="text-brand-700 hover:text-brand-900">
                                      <MapPin className="w-3.5 h-3.5" />
                                    </a>
                                  ) : (
                                    <span title="No location recorded"><MapPinOff className="w-3.5 h-3.5 text-gray-300" /></span>
                                  )}
                                </span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="px-5 py-3 text-sm text-gray-600 whitespace-nowrap">
                              {a.checkOut ? (
                                <span className="flex items-center gap-1.5">
                                  {a.checkOut.slice(0, 5)}
                                  {checkOutMap ? (
                                    <a href={checkOutMap} target="_blank" rel="noreferrer" title="View location" className="text-brand-700 hover:text-brand-900">
                                      <MapPin className="w-3.5 h-3.5" />
                                    </a>
                                  ) : (
                                    <span title="No location recorded"><MapPinOff className="w-3.5 h-3.5 text-gray-300" /></span>
                                  )}
                                </span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="px-5 py-3 text-sm text-gray-600">{a.hours ?? '—'}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <Pagination
                  page={attendanceResp?.page || 1}
                  totalPages={attendanceResp?.totalPages || 1}
                  total={attendanceResp?.total || 0}
                  limit={attendanceResp?.limit || 50}
                  onPageChange={setAttPage}
                />
              </>
            )}
          </div>
          </div>
          )
        )}

        {/* Leaves */}
        {tab === 'leaves' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">Leave Balance — {leaveBalance?.year || new Date().getFullYear()}</h3>
                <p className="text-xs text-gray-400 mt-0.5">Based on company leave policy · used = approved days this year</p>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-gray-100">
                {(leaveBalance?.rows || [
                  { type: 'annual', label: 'Annual', total: '—', used: '—', remaining: '—', pending: 0, unlimited: false },
                  { type: 'sick', label: 'Sick', total: '—', used: '—', remaining: '—', pending: 0, unlimited: false },
                  { type: 'casual', label: 'Casual', total: '—', used: '—', remaining: '—', pending: 0, unlimited: false },
                  { type: 'unpaid', label: 'Unpaid', total: '—', used: '—', remaining: '—', pending: 0, unlimited: true },
                ]).map((row: any) => (
                  <div key={row.type} className="px-5 py-4">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{row.label}</p>
                    <div className="mt-3 space-y-1.5 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-400">Total</span>
                        <span className="font-medium text-gray-900">{row.unlimited ? 'Unlimited' : row.total}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-400">Used</span>
                        <span className="font-medium text-gray-900">{row.used}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-400">Remaining</span>
                        <span className={cn('font-semibold', row.unlimited ? 'text-gray-500' : 'text-brand-800')}>
                          {row.unlimited ? '—' : row.remaining}
                        </span>
                      </div>
                      {Number(row.pending) > 0 && (
                        <div className="flex justify-between gap-2 pt-1 border-t border-gray-50">
                          <span className="text-amber-600">Pending</span>
                          <span className="font-medium text-amber-700">{row.pending}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowLeaveForm(!showLeaveForm)}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Request Leave
              </button>
            </div>

            {showLeaveForm && (
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">New Leave Request</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Leave Type</label>
                    <select
                      value={leaveForm.type}
                      onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      {LEAVE_TYPES.map((t) => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                      <input
                        type="checkbox"
                        checked={leaveForm.isHalfDay}
                        onChange={(e) => {
                          const isHalfDay = e.target.checked;
                          setLeaveForm({
                            ...leaveForm,
                            isHalfDay,
                            toDate: isHalfDay ? leaveForm.fromDate : leaveForm.toDate,
                          });
                        }}
                        className="rounded border-gray-300 text-brand-700 focus:ring-brand-600"
                      />
                      Half-day (single date)
                    </label>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">{leaveForm.isHalfDay ? 'Date' : 'From Date'}</label>
                    <input
                      type="date"
                      value={leaveForm.fromDate}
                      onChange={(e) => setLeaveForm({
                        ...leaveForm,
                        fromDate: e.target.value,
                        toDate: leaveForm.isHalfDay ? e.target.value : leaveForm.toDate,
                      })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  {!leaveForm.isHalfDay && (
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1.5">To Date</label>
                      <input
                        type="date"
                        value={leaveForm.toDate}
                        onChange={(e) => setLeaveForm({ ...leaveForm, toDate: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                      />
                    </div>
                  )}
                  {leaveForm.isHalfDay && leaveForm.fromDate && (
                    <p className="col-span-2 text-xs text-gray-500 -mt-1">
                      Half-day (0.5 day). On Monday/Friday this needs admin approval before checkout — on other days you can simply check out early and it's marked as a half-day.
                    </p>
                  )}
                  {!leaveForm.isHalfDay && leaveForm.fromDate && leaveForm.toDate && (
                    <p className="col-span-2 text-xs text-gray-500 -mt-1">
                      {(() => {
                        const offs: number[] = leaveBalance?.weekendDays ?? [0, 6];
                        const n = countLeaveDays(leaveForm.fromDate, leaveForm.toDate, offs);
                        return n > 0
                          ? `${n} leave day${n === 1 ? '' : 's'} (weekly offs not counted)`
                          : 'No leave days in this range — weekly offs are not counted.';
                      })()}
                    </p>
                  )}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Reason</label>
                    <textarea
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      rows={2}
                      placeholder="Brief reason for leave…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const from = leaveForm.fromDate;
                      const to = leaveForm.isHalfDay ? leaveForm.fromDate : leaveForm.toDate;
                      if (!leaveForm.isHalfDay && countLeaveDays(from, to, leaveBalance?.weekendDays ?? [0, 6]) <= 0) {
                        toast.error('Invalid date range. Weekly off days are not counted as leave days.');
                        return;
                      }
                      const conflict = (leaves as any[]).find(
                        (l) =>
                          ['approved', 'requested'].includes(l.status) &&
                          leavesOverlap(from, to, String(l.fromDate).slice(0, 10), String(l.toDate).slice(0, 10))
                      );
                      if (conflict) {
                        toast.error(
                          `These dates overlap an existing ${conflict.status} leave (${formatDate(conflict.fromDate)} → ${formatDate(conflict.toDate)}).`
                        );
                        return;
                      }
                      leaveMutation.mutate({ ...leaveForm, toDate: to });
                    }}
                    disabled={leaveMutation.isPending || !leaveForm.fromDate || (!leaveForm.isHalfDay && !leaveForm.toDate)}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {leaveMutation.isPending ? 'Submitting…' : 'Submit Request'}
                  </button>
                  <button
                    onClick={() => setShowLeaveForm(false)}
                    className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-5 py-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-900">My Leave Requests</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {leaves.length === 0 && (
                  <p className="px-5 py-10 text-sm text-gray-400 text-center">No leave requests yet.</p>
                )}
                {leaves.map((leave: any) => (
                  <div key={leave.id} className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 capitalize">
                        {titleCase(leave.type)} leave{leave.isHalfDay && ' · Half-day'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {leave.isHalfDay ? formatDate(leave.fromDate) : `${formatDate(leave.fromDate)} → ${formatDate(leave.toDate)}`}
                        {leave.days != null ? ` · ${leave.days} day${Number(leave.days) === 1 ? '' : 's'}` : ''}
                        {leave.reason && ` · ${leave.reason}`}
                      </p>
                      {leave.status === 'rejected' && leave.approverNote && (
                        <p className="text-xs text-red-600 mt-1">Reason: {leave.approverNote}</p>
                      )}
                      {leave.status === 'approved' && leave.approverNote && (
                        <p className="text-xs text-gray-500 mt-1">Note: {leave.approverNote}</p>
                      )}
                    </div>
                    <span className={cn('px-2.5 py-0.5 text-xs font-medium rounded-full shrink-0', STATUS_COLOR[leave.status] || 'bg-gray-100 text-gray-500')}>
                      {leave.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Appraisals */}
        {tab === 'appraisals' && (
          <div className="bg-white rounded-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">My Appraisals</h3>
              <p className="text-xs text-gray-400 mt-0.5">Performance reviews and compensation updates from HR</p>
            </div>
            <div className="divide-y divide-gray-100">
              {(myAppraisals as any[]).length === 0 ? (
                <p className="px-5 py-10 text-sm text-gray-400 text-center">No appraisals recorded yet.</p>
              ) : (
                (myAppraisals as any[]).map((a: any) => (
                  <div key={a.id} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm font-medium text-gray-900">
                        {formatDate(a.reviewDate)}{a.rating ? ` · ${a.rating}` : ''}
                      </p>
                      {a.salaryBefore != null && a.salaryAfter != null && String(a.salaryBefore) !== String(a.salaryAfter) && (
                        <span className="text-xs font-medium text-brand-800 bg-brand-50 px-2 py-0.5 rounded-full">
                          {a.salaryBefore} → {a.salaryAfter}
                        </span>
                      )}
                    </div>
                    {a.notes && <p className="text-sm text-gray-600 mt-1">{a.notes}</p>}
                    <p className="text-xs text-gray-400 mt-1">
                      {a.approver?.name ? `Reviewed by ${a.approver.name}` : ''}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Contractor Invoices tab ── */}
        {tab === 'invoices' && isContractor && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">My Invoices</h2>
              <button
                onClick={() => setShowContractorForm(!showContractorForm)}
                className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Submit Invoice
              </button>
            </div>

            {showContractorForm && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">New Invoice</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Period <span className="text-red-500">*</span></label>
                    <input
                      type="month"
                      value={contractorInvoiceForm.period}
                      onChange={(e) => setContractorInvoiceForm({ ...contractorInvoiceForm, period: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Amount <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={contractorInvoiceForm.amount}
                      onChange={(e) => setContractorInvoiceForm({ ...contractorInvoiceForm, amount: e.target.value })}
                      placeholder="0.00"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Currency</label>
                    <select
                      value={contractorInvoiceForm.currency}
                      onChange={(e) => setContractorInvoiceForm({ ...contractorInvoiceForm, currency: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    >
                      {['PKR', 'USD', 'GBP', 'AED', 'EUR'].map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Invoice File URL</label>
                    <input
                      type="url"
                      value={contractorInvoiceForm.fileUrl}
                      onChange={(e) => setContractorInvoiceForm({ ...contractorInvoiceForm, fileUrl: e.target.value })}
                      placeholder="https://…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1.5">Description</label>
                    <textarea
                      value={contractorInvoiceForm.description}
                      onChange={(e) => setContractorInvoiceForm({ ...contractorInvoiceForm, description: e.target.value })}
                      rows={2}
                      placeholder="Services rendered…"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 resize-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => submitContractorInvoice.mutate(contractorInvoiceForm)}
                    disabled={submitContractorInvoice.isPending || !contractorInvoiceForm.period || !contractorInvoiceForm.amount}
                    className="bg-brand-700 hover:bg-brand-800 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {submitContractorInvoice.isPending ? 'Submitting…' : 'Submit Invoice'}
                  </button>
                  <button
                    onClick={() => setShowContractorForm(false)}
                    className="border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200">
              <div className="divide-y divide-gray-100">
                {(contractorInvoices as any[]).length === 0 && (
                  <p className="px-5 py-10 text-sm text-gray-400 text-center">No invoices submitted yet.</p>
                )}
                {(contractorInvoices as any[]).map((inv: any) => (
                  <div key={inv.id} className="flex flex-wrap items-center justify-between px-5 py-3.5 gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{formatPeriod(inv.period)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {inv.currency} {Number(inv.amount).toLocaleString()}
                        {inv.description && ` · ${inv.description}`}
                      </p>
                      {inv.note && <p className="text-xs text-orange-600 mt-0.5">{inv.note}</p>}
                    </div>
                    <div className="flex items-center gap-3">
                      {inv.fileUrl && (
                        <a href={inv.fileUrl} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                          <Download className="w-3.5 h-3.5" />
                          File
                        </a>
                      )}
                      <span className={cn('px-2.5 py-0.5 text-xs font-medium rounded-full',
                        inv.status === 'paid' ? 'bg-brand-100 text-brand-800' :
                        inv.status === 'approved' ? 'bg-blue-100 text-blue-700' :
                        inv.status === 'rejected' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700')}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
