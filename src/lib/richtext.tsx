import { Fragment, type ReactNode } from "react";

// ── Lightweight rich text ──────────────────────────────────────────────────────
// Admin-configurable copy supports a tiny, safe markup instead of raw HTML:
//
//   **bold**   →  <strong>
//   *italic*   →  <em>
//   __under__  →  <u>
//   newline    →  <br>
//
// Parsing produces React elements (never dangerouslySetInnerHTML), so content
// saved by an admin can't inject markup/scripts into the storefront. Single
// underscores are deliberately NOT italic — snake_case words, emails and URLs
// appear in real content and must render literally.

// Alternation order matters: ** and __ must win over their single-char forms.
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+?)\*/s;

const renderPlain = (text: string, keyPrefix: string): ReactNode[] => {
  const lines = text.split("\n");
  return lines.flatMap((line, i) =>
    i === 0
      ? [<Fragment key={`${keyPrefix}t${i}`}>{line}</Fragment>]
      : [<br key={`${keyPrefix}b${i}`} />, <Fragment key={`${keyPrefix}t${i}`}>{line}</Fragment>]
  );
};

const parseRich = (text: string, keyPrefix = "r"): ReactNode[] => {
  const nodes: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      nodes.push(...renderPlain(rest, `${keyPrefix}${k}`));
      break;
    }
    if (m.index > 0) nodes.push(...renderPlain(rest.slice(0, m.index), `${keyPrefix}${k}p`));
    const key = `${keyPrefix}${k}m`;
    if (m[1] !== undefined) nodes.push(<strong key={key}>{parseRich(m[1], `${key}.`)}</strong>);
    else if (m[2] !== undefined) nodes.push(<u key={key}>{parseRich(m[2], `${key}.`)}</u>);
    else nodes.push(<em key={key}>{parseRich(m[3], `${key}.`)}</em>);
    rest = rest.slice(m.index + m[0].length);
    k += 1;
  }
  return nodes;
};

/** Renders admin-entered copy with **bold** / *italic* / __underline__ / newlines. */
const RichText = ({ text }: { text: string | null | undefined }) => {
  if (!text) return null;
  return <>{parseRich(text)}</>;
};

/** Markup + newlines stripped — for single-line/truncated spots, titles and SEO. */
export const stripRichText = (text: string | null | undefined): string =>
  (text ?? "")
    .replace(/\*\*(.+?)\*\*/gs, "$1")
    .replace(/__(.+?)__/gs, "$1")
    .replace(/\*([^*\n]+?)\*/g, "$1")
    .replace(/\n+/g, " ")
    .trim();

export default RichText;
