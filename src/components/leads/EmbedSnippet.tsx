'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-500 mb-1">{label}</p>
      <div className="flex items-stretch gap-1.5">
        <code className="flex-1 min-w-0 truncate px-2.5 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
          {value}
        </code>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className={cn(
            'shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors',
            copied ? 'border-brand-300 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
          )}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

/** The two things you actually paste elsewhere — a standalone link (ad
 *  destination URL, landing page) and an iframe snippet (embed on a page). */
export default function EmbedSnippet({ publicToken }: { publicToken: string }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/embed/form/${publicToken}`;
  const iframe = `<iframe src="${link}" style="width:100%;min-height:520px;border:0;" title="Lead form"></iframe>`;

  return (
    <div className="space-y-2.5">
      <CopyField label="Direct link" value={link} />
      <CopyField label="Embed snippet" value={iframe} />
    </div>
  );
}
