'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn, formatCurrency, titleCase } from '@/lib/utils';
import { CHART_CATEGORICAL } from '@/lib/chartTheme';

/**
 * The building blocks the Overview page repeats across its six tabs.
 *
 * They live here rather than in the page file because the page is already the
 * largest screen in the app and every one of these is used on three or more of
 * its tabs. They are deliberately dumb: no data fetching, no routing decisions,
 * no permission checks — the page owns all of that.
 */

// ─── Panel ────────────────────────────────────────────────────────────────────

/** The white bordered panel every section on this page sits in. */
export function SectionCard({
  title, subtitle, icon: Icon, href, hrefLabel = 'View all', action, className, bodyClassName, children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ElementType;
  href?: string;
  hrefLabel?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('bg-white rounded-xl border border-gray-200 flex flex-col', className)}>
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-brand-700 shrink-0" />}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{title}</h3>
            {subtitle && <p className="text-xs text-gray-400 truncate">{subtitle}</p>}
          </div>
        </div>
        {action}
        {!action && href && (
          <Link href={href} className="text-xs font-medium text-brand-700 hover:text-brand-800 whitespace-nowrap shrink-0">
            {hrefLabel} →
          </Link>
        )}
      </div>
      <div className={cn('p-5 flex-1', bodyClassName)}>{children}</div>
    </div>
  );
}

/** Centered placeholder for a panel with nothing in it yet. */
export function Empty({ message, icon: Icon }: { message: string; icon?: React.ElementType }) {
  return (
    <div className="py-8 text-center">
      {Icon && <Icon className="w-7 h-7 text-gray-300 mx-auto mb-2" />}
      <p className="text-sm text-gray-400">{message}</p>
    </div>
  );
}

// ─── Money ────────────────────────────────────────────────────────────────────

/**
 * A `{ currency: amount }` map, rendered one line per currency.
 *
 * The app bills in several currencies and never converts between them — there
 * is no FX rate anywhere in this codebase — so a combined total would be a
 * fabricated number. Every money figure on this page is therefore shown
 * per-currency, and an empty map renders as an em dash rather than "0".
 */
export function Money({
  map, size = 'md', className,
}: {
  map?: Record<string, number> | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const entries = Object.entries(map || {}).filter(([, amount]) => amount > 0);
  const text = { sm: 'text-sm', md: 'text-lg', lg: 'text-2xl' }[size];

  if (!entries.length) {
    return <p className={cn(text, 'font-bold text-gray-300 tabular-nums', className)}>—</p>;
  }

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {entries.map(([currency, amount]) => (
        <p key={currency} className={cn(text, 'font-bold text-gray-900 tabular-nums leading-tight')}>
          {formatCurrency(amount, currency)}
          {entries.length > 1 && (
            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">{currency}</span>
          )}
        </p>
      ))}
    </div>
  );
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

/**
 * A `{ status: count }` map as a single proportional bar plus a legend.
 *
 * Preferred over a chart component for status breakdowns because it stays
 * readable at a third of a card's height, which is what makes fitting eight
 * of them onto one screen possible.
 */
export function StatusBar({
  map, labels, colors, emptyMessage = 'Nothing yet.', ordered = false,
}: {
  map?: Record<string, number> | null;
  labels?: Record<string, string>;
  colors?: Record<string, string>;
  emptyMessage?: string;
  /**
   * Keep the map's own key order instead of sorting by count. Required for any
   * breakdown that is a ramp rather than a set of peers — task age and search
   * position both mean nothing shuffled into "1–2 weeks, 3–7 days, over 2
   * weeks", however big each bucket happens to be.
   */
  ordered?: boolean;
}) {
  const entries = Object.entries(map || {}).filter(([, count]) => count > 0);
  if (!ordered) entries.sort(([, a], [, b]) => b - a);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (!total) return <Empty message={emptyMessage} />;

  const hueFor = (key: string, i: number) => colors?.[key] || CHART_CATEGORICAL[i % CHART_CATEGORICAL.length];

  return (
    <div className="space-y-3">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {entries.map(([key, count], i) => (
          <div
            key={key}
            className="h-full"
            style={{ width: `${(count / total) * 100}%`, backgroundColor: hueFor(key, i) }}
            title={`${labels?.[key] || titleCase(key)}: ${count}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {entries.map(([key, count], i) => (
          <div key={key} className="flex items-center gap-1.5 min-w-0">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: hueFor(key, i) }} />
            <span className="text-xs text-gray-500 truncate">{labels?.[key] || titleCase(key)}</span>
            <span className="text-xs font-semibold text-gray-900 tabular-nums">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A label/value/bar row — used for department headcount, lead sources, stages. */
export function BarRow({
  label, value, max, suffix, color, href,
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  color?: string;
  href?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const body = (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-gray-700 truncate">{label}</span>
        <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">
          {value}
          {suffix && <span className="ml-1 text-xs font-normal text-gray-400">{suffix}</span>}
        </span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color || CHART_CATEGORICAL[0] }} />
      </div>
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-80 transition-opacity">{body}</Link> : body;
}

// ─── Compact metrics ──────────────────────────────────────────────────────────

/** A label + number, for the dense grids inside a SectionCard. */
export function MiniStat({
  label, value, tone = 'neutral', href, sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
  href?: string;
  sub?: string;
}) {
  const toneClass = {
    neutral: 'text-gray-900',
    good: 'text-green-700',
    warn: 'text-amber-600',
    bad: 'text-red-600',
  }[tone];

  const body = (
    <div className="rounded-lg border border-gray-200 px-3 py-2.5 h-full">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 leading-tight">{label}</p>
      <p className={cn('text-xl font-bold tabular-nums mt-1', toneClass)}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5 truncate">{sub}</p>}
    </div>
  );

  return href ? <Link href={href} className="block h-full hover:border-gray-300 transition-colors">{body}</Link> : body;
}

/** Key/value line for the System tab's spec tables. */
export function DetailRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={cn('text-xs text-gray-900 text-right truncate', mono && 'font-mono')}>
        {value === null || value === undefined || value === '' ? <span className="text-gray-300">—</span> : value}
      </span>
    </div>
  );
}

// ─── Status indicators ────────────────────────────────────────────────────────

/** Up/down dot + label for a dependency on the System tab. */
export function HealthDot({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('w-2 h-2 rounded-full shrink-0', ok ? 'bg-green-500' : 'bg-red-500')} />
      <span className={cn('text-xs font-semibold', ok ? 'text-green-700' : 'text-red-600')}>
        {label || (ok ? 'Operational' : 'Unreachable')}
      </span>
    </span>
  );
}

/** Small status/count pill. */
export function Pill({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet' }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-600',
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <span className={cn('px-2 py-0.5 text-[11px] font-semibold rounded-full whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

/** "Open the thing this row is about" link, right-aligned in a list row. */
export function RowLink({ href, label = 'Open' }: { href: string; label?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 whitespace-nowrap">
      {label}
      <ArrowRight className="w-3 h-3" />
    </Link>
  );
}
