const ATTENDANCE_TIMEZONE = 'Asia/Karachi';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function nowInKarachi() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTENDANCE_TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}`,
  };
}

export function shiftCalendarDate(yyyyMmDd: string, deltaDays: number) {
  const [y, m, d] = String(yyyyMmDd).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/**
 * After the 3 AM absent sweep, an unmarked attendance date should read as absent
 * in the daily roll call (even before the cron row exists in edge cases).
 */
export function shouldTreatUnmarkedAsAbsent(attendanceDate: string) {
  const day = String(attendanceDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;

  const { date, time } = nowInKarachi();
  const hour = parseInt(time.split(':')[0], 10);
  const dayAfter = shiftCalendarDate(day, 1);

  if (date > dayAfter) return true;
  if (date === dayAfter && hour >= 3) return true;
  return false;
}

export function attendanceSourceLabel(source?: string | null) {
  if (source === 'self') return 'Self (GPS)';
  if (source === 'system') return 'System';
  return 'Manual';
}

/** True when date falls on a configured weekly off day (0=Sun … 6=Sat). */
export function isWeekendDate(dateStr: string, weekendDays: number[] = [0, 6]) {
  const day = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  const off = weekendDays.length ? weekendDays : [0, 6];
  return off.includes(dow);
}
