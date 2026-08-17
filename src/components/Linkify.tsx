'use client';

import { Fragment } from 'react';
import { cn } from '@/lib/utils';

// Matches bare URLs (http/https or a leading www.) inside free text. The trailing
// [^\s]* is deliberately greedy so long Google Docs / Sheets links keep their full
// query string and #fragment; trailing sentence punctuation is trimmed off below.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<>()]+)/gi;

// Task remarks are free text people paste doc links into. Rendered as a plain
// string, a 120-char Google Docs URL is one unbreakable "word" — it blew out of
// the remarks box in the task modal instead of wrapping, and wasn't clickable.
// This splits the text on URLs, renders those as real anchors, and lets the
// browser break inside them (break-all on the anchor).
export default function Linkify({
  text,
  className,
  linkClassName,
}: {
  text?: string | null;
  className?: string;
  linkClassName?: string;
}) {
  if (!text) return null;

  const parts = String(text).split(URL_RE);

  return (
    <span className={cn('break-words', className)}>
      {parts.map((part, i) => {
        // split() with one capture group puts matches at every odd index.
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;

        // Don't swallow punctuation that ended the sentence rather than the URL.
        const trailing = part.match(/[.,;:!?)\]]+$/)?.[0] || '';
        const url = trailing ? part.slice(0, -trailing.length) : part;
        const href = url.startsWith('www.') ? `https://${url}` : url;

        return (
          <Fragment key={i}>
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn('text-brand-700 underline underline-offset-2 hover:text-brand-900 break-all', linkClassName)}
            >
              {url}
            </a>
            {trailing}
          </Fragment>
        );
      })}
    </span>
  );
}
