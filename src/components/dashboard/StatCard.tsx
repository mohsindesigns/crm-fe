'use client';

import Link from 'next/link';
import { ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';

// A gradient-tinted wash bleeding from the icon color into white, plus a solid
// circular icon badge — matches the source theme's actual stat-card recipe
// (src/pages/dashboards/dashboard/components/StatCard.tsx) rather than the
// flat white-card-with-a-small-square-icon look every page had before, which
// is why the app read as visually "unchanged" despite the component-level
// migration. Brand takes the place of the theme's default blue for the
// primary metric; the rest are semantic (green = money in, red = risk/owed,
// amber = attention, violet/blue/cyan = neutral categorical).
export const STAT_TINTS = {
  brand:  { icon: 'bg-brand-600',  wash: 'from-brand-600/10' },
  blue:   { icon: 'bg-blue-600',   wash: 'from-blue-600/10' },
  violet: { icon: 'bg-violet-600', wash: 'from-violet-600/10' },
  indigo: { icon: 'bg-indigo-600', wash: 'from-indigo-600/10' },
  amber:  { icon: 'bg-amber-600',  wash: 'from-amber-600/10' },
  green:  { icon: 'bg-green-600',  wash: 'from-green-600/10' },
  red:    { icon: 'bg-red-600',    wash: 'from-red-600/10' },
  cyan:   { icon: 'bg-cyan-600',   wash: 'from-cyan-600/10' },
  teal:   { icon: 'bg-teal-600',   wash: 'from-teal-600/10' },
  gray:   { icon: 'bg-gray-400',   wash: 'from-gray-400/10' },
} as const;

export type StatCardColor = keyof typeof STAT_TINTS;

export default function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color = 'brand',
  href,
  progress,
  trend,
  children,
}: {
  label: string;
  value?: React.ReactNode;
  sub?: string;
  icon: React.ElementType;
  color?: StatCardColor;
  href?: string;
  progress?: { pct: number };
  trend?: { positive: boolean; label: string };
  children?: React.ReactNode;
}) {
  const tint = STAT_TINTS[color] || STAT_TINTS.brand;

  const body = (
    <div
      className={cn(
        'h-full rounded-xl border border-gray-200 p-4 sm:p-5 flex flex-col',
        'bg-gradient-to-br to-white', tint.wash,
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <p className="min-w-0 break-words pr-2 text-[10px] sm:text-xs font-semibold uppercase tracking-wide sm:tracking-wider leading-tight text-gray-500">
          {label}
        </p>
        <div className={cn('w-11 h-11 shrink-0 rounded-full flex items-center justify-center', tint.icon)}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>

      <div className="flex-1 flex flex-col justify-between">
        {children ?? (
          <div>
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{value}</p>
            {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
          </div>
        )}

        {trend && (
          <p className={cn('flex items-center gap-1 text-xs font-medium mt-3', trend.positive ? 'text-green-600' : 'text-red-600')}>
            {trend.positive ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {trend.label}
          </p>
        )}

        {progress && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between mb-1.5 gap-2">
              <span className="text-[10px] text-gray-400">of total</span>
              <span className="text-[10px] font-semibold text-gray-500">{progress.pct}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', tint.icon)} style={{ width: `${progress.pct}%` }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full hover:shadow-md transition-shadow cursor-pointer">
      {body}
    </Link>
  ) : body;
}

// Compact horizontal variant for dense multi-metric strips (5-6+ across) where
// the full vertical StatCard would be too tall — same circular-badge +
// gradient-wash language, smaller footprint.
export function KpiPill({
  label,
  value,
  icon: Icon,
  color = 'brand',
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  color?: StatCardColor;
}) {
  const tint = STAT_TINTS[color] || STAT_TINTS.brand;
  return (
    <div className={cn(
      'rounded-xl border border-gray-200 p-4 flex items-center gap-3',
      'bg-gradient-to-br to-white', tint.wash,
    )}>
      <div className={cn('w-9 h-9 rounded-full flex items-center justify-center shrink-0', tint.icon)}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-gray-900 tabular-nums">{value}</p>
        <p className="text-xs text-gray-500 truncate">{label}</p>
      </div>
    </div>
  );
}
