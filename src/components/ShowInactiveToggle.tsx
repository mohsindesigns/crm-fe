'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * "Show inactive" visibility filter.
 *
 * Nothing in this CRM is deleted — records are switched between Active and
 * Inactive (see ActiveToggle + cadence-be/src/services/SoftDeleteService.js).
 * Inactive rows are hidden by default everywhere so the day-to-day lists stay
 * clean; this control brings them back into view.
 *
 * Deliberately NOT admin-gated: seeing where a record went is useful to anyone,
 * and it's read-only. Only *changing* the status is restricted to admins.
 */
export default function ShowInactiveToggle({
  checked,
  onChange,
  count,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Optional count of inactive rows, shown as a hint when they're hidden. */
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={checked ? 'Hide inactive records' : 'Show inactive records'}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap',
        checked
          ? 'border-gray-400 bg-gray-100 text-gray-700'
          : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50',
        className,
      )}
    >
      {checked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      Show inactive
      {!checked && !!count && (
        <span className="ml-0.5 rounded-full bg-gray-200 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * State for the toggle plus the query param to send with it. Keeps every list
 * page consistent: hidden by default, `includeInactive=1` only when asked for.
 *
 *   const inactive = useShowInactive();
 *   useQuery({ queryKey: ['clients', inactive.key], queryFn: () => api.get('/clients', { params: { ...inactive.params } }) })
 *   <ShowInactiveToggle {...inactive.toggleProps} />
 */
export function useShowInactive() {
  const [show, setShow] = useState(false);
  return {
    show,
    setShow,
    /** Spread into a react-query key so toggling refetches. */
    key: show ? 'with-inactive' : 'active-only',
    /** Spread into request params. */
    params: show ? { includeInactive: 1 } : {},
    toggleProps: { checked: show, onChange: setShow },
  };
}
