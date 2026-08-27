// Client-side mirror of crm-be/src/utils/htmlSanitizer.js — same allowlist,
// same "strip every attribute" strategy. The server is the real security
// boundary (this content gets stored and later re-served to other sessions),
// but sanitizing again here means the rich-text editor's own output — and
// anything dangerouslySetInnerHTML renders before a save/reload round-trips
// through the backend — never carries pasted/execCommand-injected markup
// either. Keep this allowlist in sync with the backend one.
const ALLOWED_TAGS = new Set([
  'h2', 'h3', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'blockquote', 'div', 'span',
]);

// Documents/templates saved before this editor existed have their content as
// plain text (real newlines, no tags) — mirrors ensureHtml() in
// crm-be/src/utils/documentRenderer.js. Detected once up front so plain text
// gets escaped + newline-to-<br>'d instead of being run through the tag
// stripper (which would treat any stray "<"/">" in old free-typed text as a
// malformed tag and silently drop it).
const HTML_TAG_PROBE = /<(h2|h3|p|ul|ol|li|blockquote|b|strong|i|em|u|br)[\s>]/i;

export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return '';
  const raw = String(input);
  if (!HTML_TAG_PROBE.test(raw)) {
    return raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\r\n|\n/g, '<br>')
      .trim();
  }
  let html = raw;
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  html = html.replace(/<\/?([a-zA-Z0-9]+)\b[^>]*>/g, (match, rawTag) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return '';
    const isClosing = match.startsWith('</');
    if (isClosing) return `</${tag}>`;
    if (tag === 'br') return '<br>';
    return `<${tag}>`;
  });
  return html.trim();
}

// True when stripped of tags there's no visible text — used to show the same
// "(optional)" empty state a plain textarea would for `!value`.
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) return true;
  return !String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

// Shared Tailwind arbitrary-variant styling for rendering sanitized rich text
// (h2/h3 headings, lists, quotes) consistently across the live document
// preview, the public review page, and the rich-text editor's own canvas.
export const richTextProseClass = [
  '[&_h2]:text-base [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mt-3 [&_h2]:mb-1 [&_h2:first-child]:mt-0',
  '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:mt-2 [&_h3]:mb-1',
  '[&_p]:mb-2 [&_p:last-child]:mb-0',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-2',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-2',
  '[&_li]:mb-0.5',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-gray-300 [&_blockquote]:pl-3 [&_blockquote]:text-gray-500 [&_blockquote]:italic',
  '[&_strong]:font-semibold [&_b]:font-semibold',
].join(' ');
