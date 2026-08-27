import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import api from './api';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Row tint marking a record as Inactive.
 *
 * Nothing in this CRM is deleted — records switch between Active and Inactive
 * (see components/ActiveToggle + cadence-be/src/services/SoftDeleteService.js).
 * Inactive rows are hidden by default; when a "Show inactive" filter brings them
 * back, this makes them unmistakable at a glance without hurting readability.
 *
 * `isActive` is checked as `=== false` throughout so rows from endpoints that
 * don't select the column (or older records) are treated as active, not greyed out.
 *
 *   <tr className={cn('hover:bg-gray-50', inactiveRow(client.isActive))}>
 */
export function inactiveRow(isActive: unknown): string {
  return isActive === false
    ? 'bg-gray-100/70 text-gray-400 [&_a]:text-gray-400 [&_.font-medium]:text-gray-500'
    : '';
}

/** Human-readable byte size for attachment lists — "412 KB", "1.4 MB". */
export function formatFileSize(bytes?: number | null): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatDate(date: string | Date, format = 'MMM d, yyyy') {
  const { format: dateFnsFormat } = require('date-fns');
  return dateFnsFormat(new Date(date), format);
}

/** Today as a local "YYYY-MM-DD" string — pass to a `<input type="date">`'s
 *  `min` to grey out/disable every date before today in the native picker. */
export function todayDateInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Payroll runs/periods are stored as "YYYY-MM" — render as "July-2026" instead
// of the raw key everywhere it's shown to a user.
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function formatPeriod(period?: string | null): string {
  if (!period) return '—';
  const match = String(period).trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!match) return period;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return period;
  return `${MONTH_NAMES[month - 1]}-${year}`;
}

// Generate a readable temporary password (avoids ambiguous chars like 0/O, 1/l/I)
export function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Turns a snake_case/underscore enum value into a readable, properly capitalized
// label — e.g. "appointment_letter" -> "Appointment Letter". Do this at the data
// level rather than relying on CSS `text-transform: capitalize`: that CSS is
// silently ignored inside native <option>/<select> dropdown popups in most
// browsers, which is exactly where these enum values show up (document types,
// stage keys, statuses).
export function titleCase(value?: string | null): string {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

// Deterministic bg/text pair per person, so the same name always gets the same
// color across the app instead of a flat gray blob for every initials avatar.
const AVATAR_PALETTE = [
  'bg-orange-100 text-orange-700',
  'bg-brand-100 text-brand-800',
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-cyan-100 text-cyan-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
];

export function avatarColorClasses(name?: string | null): string {
  if (!name) return 'bg-gray-200 text-gray-600';
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function formatCurrency(amount: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/** Ensure external links open as absolute URLs (bare domains become relative otherwise). */
export function toAbsoluteHttpUrl(value?: string | null): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Upload failures have a specific extra failure mode worth calling out: when a
// reverse proxy in front of the API (nginx, etc.) rejects a request for being
// too large, it does so before the app (and its CORS headers) ever see it — the
// browser can't read the rejection body at all and reports it as a generic CORS
// error, which is useless to a user trying to figure out why their file didn't
// upload. `e.request` present with no `e.response` is axios's signature for "no
// response could be read" (network failure or exactly this CORS-masked case).
export function uploadErrorMessage(e: any): string {
  const backendMessage = e?.response?.data?.message || e?.response?.data?.error;
  if (backendMessage) return backendMessage;
  if (e?.request) return 'Upload failed — the file may be too large, or there is a network/server configuration issue. Try a smaller file, or contact your administrator.';
  return 'Upload failed.';
}

// Forces a real file download (not just a new-tab open) for files hosted on the media
// server — those URLs are cross-origin from the frontend, and browsers only honor an
// <a download> attribute for same-origin links, so we fetch the bytes ourselves and
// trigger the save via an object URL instead.
export async function downloadFile(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed.');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// axios still applies `responseType: 'blob'` to error responses, so a 500 with a
// JSON `{ message }` body comes back as an opaque Blob on `error.response.data`
// instead of parsed JSON — the caller's catch block sees no usable message. Read
// the blob back out as text/JSON so real backend error messages (e.g. "PDF
// generation is unavailable on this server...") reach the user instead of a
// generic "failed" toast.
async function extractBlobErrorMessage(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      const parsed = JSON.parse(text);
      if (parsed?.message) return parsed.message;
    } catch { /* not JSON — fall through to fallback */ }
  }
  return err?.response?.data?.message || fallback;
}

// Downloads a file from an authenticated backend endpoint (PDF/CSV generation, etc.).
// Goes through the shared `api` axios client instead of a raw `fetch()` with a
// manually grabbed token — access tokens expire (15 min), and only the axios client
// has the interceptor that refreshes an expired token and retries automatically.
// A bare `fetch()` with a stale token just fails with 401 and no way to recover
// short of a full page reload.
export async function downloadAuthedFile(url: string, filename: string, params?: Record<string, unknown>) {
  let res;
  try {
    res = await api.get(url, { params, responseType: 'blob' });
  } catch (err) {
    throw new Error(await extractBlobErrorMessage(err, 'Download failed.'));
  }
  const objectUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// POST variant of downloadAuthedFile, for downloads whose input is a selection
// rather than a URL — the Admin → Export Data screen posts a list of employee
// ids and column keys, which is both too long for a query string and (being an
// export of bank details) something the Activity Log should record, and
// middleware/activityLogger on the backend only logs mutating verbs.
export async function postAuthedFile(url: string, body: unknown, fallbackFilename: string) {
  let res;
  try {
    res = await api.post(url, body, { responseType: 'blob' });
  } catch (err) {
    throw new Error(await extractBlobErrorMessage(err, 'Download failed.'));
  }
  // Prefer the server's own filename (it carries the date stamp) and fall back
  // to the caller's if the header is missing or unreadable.
  const disposition = String(res.headers?.['content-disposition'] || '');
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match ? match[1] : fallbackFilename;

  const objectUrl = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

// Same as downloadAuthedFile, but opens the file in a new tab for viewing instead
// of forcing a save-to-disk — used for "View PDF" buttons alongside "Download".
export async function viewAuthedFile(url: string, params?: Record<string, unknown>) {
  let res;
  try {
    res = await api.get(url, { params, responseType: 'blob' });
  } catch (err) {
    throw new Error(await extractBlobErrorMessage(err, 'Failed to open file.'));
  }
  const objectUrl = URL.createObjectURL(res.data);
  window.open(objectUrl, '_blank');
  // Revoke well after the new tab has had time to load the object URL — revoking
  // immediately can race the new tab's fetch of it and show a blank page.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

// Swap the browser tab icon to the org's branding logo (falls back to the
// static /public/logo-file.png once an org has no custom logo of their own set).
export function setFavicon(url?: string | null) {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = url || '/logo-file.png';
}

/** Display chat / notification text without mention wire tokens or user IDs. */
export function formatMentionPreview(text?: string | null): string {
  if (!text) return '';
  return String(text)
    .replace(/@\[([^\]]+)\]\((user|contact|all):([0-9a-f-]{36}|all)\)/gi, '@$1')
    .replace(/\s+/g, ' ')
    .trim();
}
