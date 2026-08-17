'use client';

import { ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';

/**
 * Active / Inactive status switch — the CRM's replacement for delete.
 *
 * Nothing in this app is destroyed: every former delete endpoint flips a record
 * between Active and Inactive (cadence-be/src/services/SoftDeleteService.js), and
 * only admins may change it (cadence-be/src/middleware/adminOnly.js). This renders
 * nothing at all for non-admins so they aren't shown a control that will 403.
 *
 * The control shows the record's CURRENT state and flips it on click — it is a
 * status switch, not a "delete" action dressed up.
 */
export default function ActiveToggle({
  isActive,
  onToggle,
  disabled,
  label,
  size = 'icon',
  className,
}: {
  /** Current state of the record. */
  isActive: boolean;
  /** Called with the state to move to. */
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  /** What's being switched, e.g. "package" — used in the tooltip. */
  label?: string;
  size?: 'icon' | 'text';
  className?: string;
}) {
  const isAdmin = useAuthStore((s) => s.isAdmin());
  if (!isAdmin) return null;

  const title = label
    ? `Set this ${label} to ${isActive ? 'Inactive' : 'Active'}`
    : `Set to ${isActive ? 'Inactive' : 'Active'}`;
  const Icon = isActive ? ToggleRight : ToggleLeft;

  if (size === 'text') {
    return (
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); onToggle(!isActive); }}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50',
          isActive
            ? 'border-brand-200 text-brand-800 bg-brand-50 hover:bg-brand-100'
            : 'border-gray-200 text-gray-500 bg-gray-50 hover:bg-gray-100',
          className,
        )}
      >
        <Icon className="w-4 h-4" /> {isActive ? 'Active' : 'Inactive'}
      </button>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onToggle(!isActive); }}
      className={cn(
        'p-1.5 rounded-lg transition-colors disabled:opacity-50',
        isActive
          ? 'text-brand-600 hover:text-brand-800 hover:bg-brand-50'
          : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
        className,
      )}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

/** Pill marking a listed record as Inactive. */
export function InactiveBadge({ className }: { className?: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500',
      className,
    )}>
      Inactive
    </span>
  );
}
