'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Bold, Italic, Underline, List, ListOrdered, Heading2, Heading3 } from 'lucide-react';
import { sanitizeRichHtml, richTextProseClass } from '@/lib/richText';

export type RichTextEditorHandle = {
  /** Inserts plain text at the current cursor position (used by external
   *  "insert {{token}}" buttons — pair with onMouseDown={e=>e.preventDefault()}
   *  on the calling button so the selection survives the click). */
  insertText: (text: string) => void;
  focus: () => void;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  className?: string;
};

function ToolbarButton({ label, active, onMouseDown, onClick, children }: {
  label: string; active?: boolean; onMouseDown: (e: React.MouseEvent) => void; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button type="button" title={label} aria-label={label} onMouseDown={onMouseDown} onClick={onClick}
      className={`p-1.5 rounded transition-colors ${active ? 'bg-brand-100 text-brand-800' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`}>
      {children}
    </button>
  );
}

/**
 * Hand-rolled WYSIWYG editor (contentEditable + execCommand) for the small
 * set of formatting this app's document narratives need — bold/italic/
 * underline, two heading levels, bullet/numbered lists. No external editor
 * library: this app has no component library anywhere else either, and the
 * formatting surface is intentionally tiny (see utils/htmlSanitizer.js on the
 * backend, which only allows exactly these tags through on save).
 *
 * execCommand is deprecated but still functional in every browser this app
 * targets for this narrow use — a handful of inline/block commands, not rich
 * embeds/tables — and remains the only real option without pulling in a
 * ProseMirror-based dependency for what is otherwise a Bold/Italic toolbar.
 */
const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, placeholder, minHeight = 'min-h-24', className = '' },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  // Only sync external `value` into the DOM while unfocused — otherwise every
  // keystroke's onInput -> onChange -> value round-trip would fight the
  // browser's own cursor position and reset it to the start of the content.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || focused.current) return;
    // sanitizeRichHtml also upgrades pre-editor plain text (real newlines, no
    // tags — old documents/templates) into <br>-separated HTML, so opening an
    // existing document still shows its original line breaks here.
    const next = sanitizeRichHtml(value);
    if (el.innerHTML !== next) el.innerHTML = next;
  }, [value]);

  function emitChange() {
    if (!editorRef.current) return;
    onChange(sanitizeRichHtml(editorRef.current.innerHTML));
  }

  // Prevents the toolbar button's mousedown from stealing focus (and with it
  // the browser's text selection) away from the editor before the click's
  // execCommand can act on it — the standard pattern for contentEditable
  // toolbars.
  function preserveSelection(e: React.MouseEvent) {
    e.preventDefault();
  }

  function exec(command: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emitChange();
  }

  function toggleHeading(tag: 'H2' | 'H3') {
    editorRef.current?.focus();
    // formatBlock toggles: applying the same heading again reverts to a
    // plain paragraph rather than stacking/being stuck.
    const current = document.queryCommandValue('formatBlock');
    document.execCommand('formatBlock', false, current?.toLowerCase() === tag.toLowerCase() ? 'P' : tag);
    emitChange();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    // Always paste as plain text — pasted rich HTML (Word/Google Docs/web
    // pages) brings inline styles and tags well outside this editor's small
    // allowlist; sanitizeRichHtml would strip most of it anyway, often
    // leaving mangled spacing behind. Plain text keeps paste predictable.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    emitChange();
  }

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      editorRef.current?.focus();
      document.execCommand('insertText', false, text);
      emitChange();
    },
    focus() {
      editorRef.current?.focus();
    },
  }));

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-0.5 mb-1.5 p-1 bg-gray-50 border border-gray-200 rounded-lg">
        <ToolbarButton label="Bold" onMouseDown={preserveSelection} onClick={() => exec('bold')}>
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Italic" onMouseDown={preserveSelection} onClick={() => exec('italic')}>
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Underline" onMouseDown={preserveSelection} onClick={() => exec('underline')}>
          <Underline className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarButton label="Heading" onMouseDown={preserveSelection} onClick={() => toggleHeading('H2')}>
          <Heading2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Subheading" onMouseDown={preserveSelection} onClick={() => toggleHeading('H3')}>
          <Heading3 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <ToolbarButton label="Bullet list" onMouseDown={preserveSelection} onClick={() => exec('insertUnorderedList')}>
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" onMouseDown={preserveSelection} onClick={() => exec('insertOrderedList')}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; emitChange(); }}
        onInput={emitChange}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className={`${minHeight} w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-600 empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 ${richTextProseClass}`}
      />
    </div>
  );
});

export default RichTextEditor;
