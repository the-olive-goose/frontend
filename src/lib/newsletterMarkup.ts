/**
 * The newsletter's markup, for the admin's live preview.
 *
 * This is a deliberate duplicate of `parseNewsletterBody` in backend/email.js.
 * The backend deploys on its own and cannot import the app's TypeScript, and the
 * email HTML must be built on the server — a browser-supplied body is not
 * something to trust into someone's inbox. So the grammar exists twice, and
 * `newsletterMarkupParity.test.ts` pins the two together.
 *
 * That test is not optional politeness. The whole value of a preview is that it
 * shows what will actually be sent; a preview that quietly disagrees with the
 * email is worse than no preview at all, because it converts "check it before
 * you send" into false confidence about something that cannot be recalled.
 *
 * The grammar is the storefront's own (src/lib/richtext.tsx) plus images:
 *
 *   **bold**   *italic*   __underline__   newline   blank line = paragraph
 *   ![alt](https://…) alone on a line = an image
 *
 * @see backend/email.js — the authoritative renderer
 * @see src/lib/newsletterMarkupParity.test.ts — what keeps them equal
 */

export interface NewsletterSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export type NewsletterBlock =
  | { type: "paragraph"; spans: NewsletterSpan[] }
  | { type: "image"; url: string; alt: string };

/** Only an https image URL is an image — see the note in parseNewsletterBody. */
const IMAGE_RE = /^!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)$/;

/** Alternation order matters: ** and __ must win over their single-char forms. */
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+?)\*/s;

type Marks = Omit<NewsletterSpan, "text">;

const parseSpans = (text: string, marks: Marks): NewsletterSpan[] => {
  const out: NewsletterSpan[] = [];
  const push = (value: string) => {
    if (value !== "") out.push({ text: value, ...marks });
  };
  let rest = text;
  while (rest) {
    const m = INLINE_RE.exec(rest);
    if (!m) { push(rest); break; }
    if (m.index > 0) push(rest.slice(0, m.index));
    if (m[1] !== undefined) out.push(...parseSpans(m[1], { ...marks, bold: true }));
    else if (m[2] !== undefined) out.push(...parseSpans(m[2], { ...marks, underline: true }));
    else out.push(...parseSpans(m[3], { ...marks, italic: true }));
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
};

/**
 * Admin-typed body → a block tree, identical to the backend's.
 *
 * An image line whose URL is not https stays literal text rather than becoming a
 * broken image: an email lives in an inbox forever and a relative or http URL
 * cannot load there, so the admin sees their own mistake in the preview instead
 * of shipping a hole to every subscriber.
 */
export const parseNewsletterBody = (body: string | null | undefined): NewsletterBlock[] => {
  const blocks: NewsletterBlock[] = [];
  for (const raw of String(body ?? "").split(/\n{2,}/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const image = IMAGE_RE.exec(trimmed);
    if (image) {
      blocks.push({ type: "image", url: image[2], alt: image[1].trim() });
      continue;
    }
    const spans = parseSpans(trimmed, { bold: false, italic: false, underline: false });
    if (spans.length) blocks.push({ type: "paragraph", spans });
  }
  return blocks;
};

/** The markup for an image block, as the compose box's toolbar inserts it. */
export const imageMarkup = (url: string, alt = ""): string => `![${alt}](${url})`;

/**
 * Whether a URL is one an email can actually load.
 *
 * https only, and absolute. A `/uploads/…` path is the trap worth naming: it
 * resolves fine in the dashboard, resolves to nothing in a mail client, and on
 * this deployment the file behind it is deleted on the next redeploy anyway.
 */
export const isEmailableImageUrl = (url: string): boolean =>
  /^https:\/\/[^\s]+$/i.test((url ?? "").trim());
