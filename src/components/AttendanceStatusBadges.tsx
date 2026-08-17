import { cn, titleCase } from '@/lib/utils';
import { isWeekendDate } from '@/lib/attendanceDate';

/** Distinct pill colors per attendance label — keep in sync across all attendance views. */
export const ATTENDANCE_LABEL_COLORS: Record<string, string> = {
  Present: 'bg-teal-100 text-teal-800 ring-1 ring-inset ring-teal-200',
  Absent: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-200',
  Leave: 'bg-sky-100 text-sky-800 ring-1 ring-inset ring-sky-200',
  'Half Day': 'bg-orange-100 text-orange-800 ring-1 ring-inset ring-orange-200',
  Holiday: 'bg-indigo-100 text-indigo-800 ring-1 ring-inset ring-indigo-200',
  Weekend: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-300',
  Overtime: 'bg-fuchsia-100 text-fuchsia-800 ring-1 ring-inset ring-fuchsia-200',
  'Not Marked': 'bg-yellow-100 text-yellow-800 ring-1 ring-inset ring-yellow-200',
};

export function attendanceLabelClass(label: string) {
  return ATTENDANCE_LABEL_COLORS[label] || 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-200';
}

type Badge = { label: string; className: string };

export function getAttendanceStatusBadges(
  record: { status?: string; date?: string; checkIn?: string | null },
  weekendDays: number[] = [0, 6],
): Badge[] {
  const status = record.status || 'present';
  const date = String(record.date || '').slice(0, 10);
  const worked = !!record.checkIn;
  const weekend = isWeekendDate(date, weekendDays);

  if (weekend && worked && (status === 'present' || status === 'half_day')) {
    const badges: Badge[] = [];
    if (status === 'half_day') {
      badges.push({ label: 'Half Day', className: attendanceLabelClass('Half Day') });
    }
    badges.push({ label: 'Overtime', className: attendanceLabelClass('Overtime') });
    return badges;
  }

  if (status === 'weekend' || (weekend && !worked)) {
    return [{ label: 'Weekend', className: attendanceLabelClass('Weekend') }];
  }

  const label = titleCase(status);
  return [{ label, className: attendanceLabelClass(label) }];
}

export default function AttendanceStatusBadges({
  record,
  weekendDays = [0, 6],
  className,
}: {
  record: { status?: string; date?: string; checkIn?: string | null };
  weekendDays?: number[];
  className?: string;
}) {
  const badges = getAttendanceStatusBadges(record, weekendDays);
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={cn('px-2.5 py-1 text-xs font-medium rounded-full whitespace-nowrap', badge.className)}
        >
          {badge.label}
        </span>
      ))}
    </span>
  );
}

export function AttendanceLabelLegend({
  items,
  className,
}: {
  items: { label: string; count?: number }[];
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-600', className)}>
      {items.map(({ label, count }) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className={cn('w-3 h-3 rounded-full ring-1 ring-inset', attendanceLabelClass(label))} aria-hidden />
          {label}{count != null ? `: ${count}` : ''}
        </span>
      ))}
    </div>
  );
}
