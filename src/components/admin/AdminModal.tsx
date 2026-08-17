'use client';

/**
 * Centred modal for the admin create/edit forms.
 *
 * These forms used to render as a panel appended below the list. On a long list
 * that panel landed below the fold, so clicking "Edit" or "Add" looked like it
 * did nothing at all — the form was open, just off-screen. A modal makes the
 * result of the click impossible to miss regardless of list length.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function AdminModal({
  open, title, onClose, children, footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Escape closes, and the page behind must not scroll while the modal owns the
  // viewport — otherwise the list drifts under the overlay as you scroll a long
  // form.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl my-auto flex flex-col max-h-[calc(100vh-2rem)]"
      >
        <div className="flex flex-wrap items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 shrink-0 gap-2">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* overflow-x-hidden + min-w-0: a modal body should never scroll
            sideways. One mis-sized field used to widen the whole dialog and
            produce a horizontal scrollbar rather than being constrained. */}
        <div className="px-5 sm:px-6 py-5 space-y-4 overflow-y-auto overflow-x-hidden min-w-0">
          {children}
        </div>

        {footer && (
          <div className="flex items-center gap-2 px-5 sm:px-6 py-4 border-t border-gray-100 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
