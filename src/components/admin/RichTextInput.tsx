import { useRef } from "react";

// ── Admin rich-text fields ─────────────────────────────────────────────────────
// Drop-in replacements for the dashboard's plain <Input>/<Textarea> on free-text
// copy fields. They add a B / I / U toolbar (plus ⌘/Ctrl+B/I/U shortcuts) that
// wraps the current selection in the storefront's markup — **bold**, *italic*,
// __underline__ — and both accept Enter for new lines. The storefront renders
// the markup via <RichText> (src/lib/richtext.tsx).
//
// onChange mimics a DOM event ({ target: { value } }) so existing call sites
// like `(e) => onChange({ ...data, headline: e.target.value })` work unchanged.

type RichChangeEvent = { target: { value: string } };

interface RichProps {
  value: string;
  onChange: (e: RichChangeEvent) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
  /**
   * Extra toolbar controls, rendered after B/I/U.
   *
   * Handed an `insert` that drops text at the cursor (replacing any selection),
   * because the caret lives inside this component and a caller has no other way
   * to reach it. Used by the newsletter composer to insert an image, which is
   * the one thing the storefront's copy fields never need.
   */
  extraTools?: (insert: (text: string) => void) => React.ReactNode;
}

const MARKERS = { bold: "**", italic: "*", underline: "__" } as const;
type Style = keyof typeof MARKERS;

const toggleStyle = (value: string, start: number, end: number, style: Style) => {
  const marker = MARKERS[style];
  const len = marker.length;
  const selected = value.slice(start, end);

  // Unwrap when the selection is already wrapped (markers just outside or inside).
  if (value.slice(start - len, start) === marker && value.slice(end, end + len) === marker) {
    return {
      value: value.slice(0, start - len) + selected + value.slice(end + len),
      selStart: start - len,
      selEnd: end - len,
    };
  }
  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, -len);
    return { value: value.slice(0, start) + inner + value.slice(end), selStart: start, selEnd: start + inner.length };
  }
  return {
    value: value.slice(0, start) + marker + selected + marker + value.slice(end),
    selStart: start + len,
    selEnd: end + len,
  };
};

const useRichEditing = (value: string, onChange: (e: RichChangeEvent) => void) => {
  const ref = useRef<HTMLTextAreaElement>(null);

  const apply = (style: Style) => {
    const ta = ref.current;
    if (!ta) return;
    const next = toggleStyle(value, ta.selectionStart, ta.selectionEnd, style);
    onChange({ target: { value: next.value } });
    // Restore focus + selection after React re-renders with the new value.
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(next.selStart, next.selEnd);
    });
  };

  /**
   * Drop `text` at the caret, replacing the selection.
   *
   * Falls back to appending when the textarea has never been focused — a caller
   * pressing "Insert image" before clicking into the box should still get their
   * image, at the end, rather than silently nothing.
   */
  const insert = (text: string) => {
    const ta = ref.current;
    const start = ta ? ta.selectionStart : value.length;
    const end = ta ? ta.selectionEnd : value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    onChange({ target: { value: next } });
    const caret = start + text.length;
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(caret, caret);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const style = ({ b: "bold", i: "italic", u: "underline" } as const)[e.key.toLowerCase() as "b" | "i" | "u"];
    if (!style) return;
    e.preventDefault();
    apply(style);
  };

  return { ref, apply, insert, onKeyDown };
};

const ToolbarButton = ({ label, hint, onClick, children }: {
  label: string; hint: string; onClick: () => void; children: React.ReactNode;
}) => (
  <button
    type="button"
    tabIndex={-1}
    aria-label={label}
    title={hint}
    // onMouseDown + preventDefault keeps the textarea's selection alive while clicking.
    onMouseDown={(e) => { e.preventDefault(); onClick(); }}
    className="w-6 h-6 flex items-center justify-center rounded border border-border bg-card text-foreground/70 hover:text-foreground hover:border-primary/50 transition-colors text-xs leading-none"
  >
    {children}
  </button>
);

const Toolbar = ({ apply, extra }: { apply: (s: Style) => void; extra?: React.ReactNode }) => (
  <div className="flex items-center gap-1 flex-wrap">
    <ToolbarButton label="Bold" hint="Bold (⌘B) — **text**" onClick={() => apply("bold")}>
      <span className="font-bold">B</span>
    </ToolbarButton>
    <ToolbarButton label="Italic" hint="Italic (⌘I) — *text*" onClick={() => apply("italic")}>
      <span className="italic font-serif">I</span>
    </ToolbarButton>
    <ToolbarButton label="Underline" hint="Underline (⌘U) — __text__" onClick={() => apply("underline")}>
      <span className="underline">U</span>
    </ToolbarButton>
    {extra}
  </div>
);

const baseClass =
  "w-full px-4 py-2.5 rounded-lg border border-border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none";

/** Multi-line rich text field (drop-in for the dashboard's <Textarea>). */
export const RichTextarea = ({ value, onChange, rows = 3, placeholder, className, extraTools }: RichProps) => {
  const { ref, apply, insert, onKeyDown } = useRichEditing(value, onChange);
  return (
    <div className="space-y-1">
      <Toolbar apply={apply} extra={extraTools?.(insert)} />
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange({ target: { value: e.target.value } })}
        onKeyDown={onKeyDown}
        className={`${baseClass} ${className ?? ""}`}
      />
    </div>
  );
};

/** Single-line-looking rich text field (drop-in for the dashboard's <Input> on
 *  copy fields). Still a textarea underneath so Enter inserts a line break. */
export const RichInput = ({ value, onChange, placeholder, className }: RichProps) => {
  const { ref, apply, onKeyDown } = useRichEditing(value, onChange);
  // Grow with content: one visual row per line, capped so a stray paste can't
  // blow up the form.
  const rows = Math.min(Math.max(value.split("\n").length, 1), 6);
  return (
    <div className="space-y-1">
      <Toolbar apply={apply} />
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange({ target: { value: e.target.value } })}
        onKeyDown={onKeyDown}
        className={`${baseClass} ${className ?? ""}`}
      />
    </div>
  );
};
