'use client';

// Shared color-picker-plus-hex-input row used by every form builder's
// Appearance panel (LeadFormModal, ClientRequestModal, the Client Req
// Boilerplate admin tab) — one control so all three stay visually identical.
export default function ColorInput({
  label, value, onChange, fallback,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  fallback: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallback}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border border-gray-300 cursor-pointer shrink-0 p-0.5"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Reset to default"
            className="text-[11px] text-gray-400 hover:text-gray-700 shrink-0"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
