/**
 * The abandoned-cart email: its settings, its tokens, and the block tree the
 * admin's live preview renders.
 *
 * This is a deliberate duplicate of the same grammar in backend/email.js, for
 * the reason the newsletter's is (see src/lib/newsletterMarkup.ts): the backend
 * deploys on its own and cannot import the app's TypeScript, and the email HTML
 * must be built on the server — a browser-supplied body is not something to
 * trust into a customer's inbox. `abandonedCartParity.test.ts` pins the two
 * together, case for case.
 *
 * The body uses the newsletter's markup (**bold**, *italic*, __underline__,
 * blank line = paragraph, ![alt](https://…) = image) plus TOKENS, which are what
 * make one stored template describe every shopper's email:
 *
 *   {cart_items}     on a line of its own — the shopper's actual basket, as rows
 *   {cart_button}    on a line of its own — the button back to that basket
 *   {first_name}     their first name, or "there" when the account has no name
 *   {cart_url}       the tagged link, for putting in your own sentence
 *   {cart_total}     basket subtotal, e.g. €48.50
 *   {item_count}     how many things are in it
 *   {discount_code}  the code configured in Ops, if any
 *   {discount_value} what that code is worth, e.g. "10%" or "€5"
 *   {free_shipping}  the live free-shipping clause, e.g. "on orders over €65"
 *   {shop_name}      the shop's name
 *
 * Two rules that are not obvious and are both tested:
 *
 *   1. Tokens are substituted AFTER the markup is parsed, never before. A
 *      product called "Café **Noir**" therefore arrives as those literal
 *      characters instead of turning half the email bold.
 *   2. The basket and the button are GUARANTEED. If the admin's body does not
 *      contain {cart_items} / {cart_button}, they are appended anyway — an
 *      abandoned-cart email whose whole job is to show someone their basket must
 *      not be able to go out without it because a token was deleted by accident.
 */

import { parseNewsletterBody, type NewsletterBlock, type NewsletterSpan } from "@/lib/newsletterMarkup";

// ── Settings ──────────────────────────────────────────────────────────────────
// Stored server-side under the NON-`content_` key `abandoned_cart_settings`, and
// read/written through admin-only endpoints. Every other Ops setting lives under
// `content_*`, which the public /api/content route serves to anyone; a promo code
// sitting in this template must not be one URL away from the whole internet.

export interface AbandonedCartSettings {
  /** Automatic sending. Off means the sweep never fires — Send now still works. */
  enabled: boolean;
  /** How long a basket must sit untouched before it counts as abandoned. */
  delay_hours: number;
  /** How many reminders one basket may receive, in total. */
  max_reminders: number;
  /** Gap between the first reminder and the next, for the same basket. */
  followup_hours: number;
  /** After a series ends, how long before the same shopper may start another. */
  cooldown_days: number;
  /** Local hours during which nothing is sent (inclusive start, exclusive end). */
  quiet_hours_start: number;
  quiet_hours_end: number;
  subject: string;
  /** The grey line after the subject in most inboxes. */
  preheader: string;
  body: string;
  cta_label: string;
  /** Optional existing code from Ops → Discount Codes, offered in the email. */
  discount_code: string;
  /** Campaign tagging on the link back — see recoveryUrl. */
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export const DEFAULT_ABANDONED_CART_SETTINGS: AbandonedCartSettings = {
  enabled: false,
  delay_hours: 4,
  max_reminders: 1,
  followup_hours: 24,
  cooldown_days: 14,
  quiet_hours_start: 22,
  quiet_hours_end: 8,
  subject: "You left something behind 🫒",
  preheader: "Your basket is still here — pick up where you left off.",
  body:
    "Hi {first_name},\n\n" +
    "You were *this* close. Your basket is still sitting here, exactly as you left it:\n\n" +
    "{cart_items}\n\n" +
    "{cart_button}\n\n" +
    "No rush — but our small batches do run out, and we'd hate for you to miss this one.",
  cta_label: "Back to my basket",
  discount_code: "",
  utm_source: "olive_goose",
  utm_medium: "email",
  utm_campaign: "abandoned_cart",
};

/** Hard caps, mirrored by the server. A typo here becomes someone's inbox. */
export const ABANDONED_CART_LIMITS = {
  minDelayHours: 1,
  maxDelayHours: 168,
  maxReminders: 3,
  minFollowupHours: 1,
  maxCooldownDays: 90,
} as const;

/**
 * Fold a settings object into something sendable.
 *
 * Every numeric field is clamped rather than rejected: these arrive from a text
 * input, and a blank box that silently becomes "every 0 hours, forever" is the
 * failure worth designing out.
 */
export const normalizeAbandonedCartSettings = (
  raw: Partial<AbandonedCartSettings> | null | undefined,
): AbandonedCartSettings => {
  const d = DEFAULT_ABANDONED_CART_SETTINGS;
  const s = { ...d, ...(raw || {}) };
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const text = (v: unknown, fallback: string, max: number) => {
    const t = typeof v === "string" ? v.trim() : "";
    return (t || fallback).slice(0, max);
  };
  return {
    enabled: !!s.enabled,
    delay_hours: num(s.delay_hours, d.delay_hours, ABANDONED_CART_LIMITS.minDelayHours, ABANDONED_CART_LIMITS.maxDelayHours),
    max_reminders: num(s.max_reminders, d.max_reminders, 1, ABANDONED_CART_LIMITS.maxReminders),
    followup_hours: num(s.followup_hours, d.followup_hours, ABANDONED_CART_LIMITS.minFollowupHours, ABANDONED_CART_LIMITS.maxDelayHours),
    cooldown_days: num(s.cooldown_days, d.cooldown_days, 0, ABANDONED_CART_LIMITS.maxCooldownDays),
    quiet_hours_start: num(s.quiet_hours_start, d.quiet_hours_start, 0, 23),
    quiet_hours_end: num(s.quiet_hours_end, d.quiet_hours_end, 0, 23),
    subject: text(s.subject, d.subject, 200),
    preheader: typeof s.preheader === "string" ? s.preheader.trim().slice(0, 200) : d.preheader,
    body: text(s.body, d.body, 20000),
    cta_label: text(s.cta_label, d.cta_label, 60),
    // Codes are matched case-insensitively everywhere else in this shop; store
    // the shape the admin will recognise in Ops → Discount Codes.
    discount_code: (typeof s.discount_code === "string" ? s.discount_code.trim().toUpperCase() : "").slice(0, 60),
    utm_source: text(s.utm_source, d.utm_source, 100),
    utm_medium: text(s.utm_medium, d.utm_medium, 100),
    utm_campaign: text(s.utm_campaign, d.utm_campaign, 100),
  };
};

// ── Quiet hours ───────────────────────────────────────────────────────────────

/**
 * Whether `hour` (0–23, shop-local) falls inside the do-not-send window.
 *
 * Wraps midnight, which is the only case worth writing a function for: 22 → 8
 * means "10pm to 8am", not "no hours at all". start === end means no window,
 * because a 24-hour quiet period would silently disable the whole feature.
 */
export const isQuietHour = (hour: number, start: number, end: number): boolean => {
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
};

// ── The recovery link ─────────────────────────────────────────────────────────

/**
 * Where the email sends people, tagged so the sale can be told apart from an ad.
 *
 * This is the part Google Ads and Meta care about. Both platforms decide who
 * gets credit for a purchase from how the visit was tagged, and an untagged
 * click out of an email arrives looking like direct traffic — which GA4 will
 * happily hand to whichever campaign touched that user last, inflating the ROAS
 * of ads that had nothing to do with the recovery.
 *
 * So: utm_source / utm_medium / utm_campaign on every link (the shop's analytics
 * already records all three — see src/lib/analytics.ts), defaulting to
 * medium=email, which is the value GA4's default channel grouping maps to the
 * "Email" channel. What deliberately is NOT here is a gclid or fbclid: fabricating
 * a click id to make a recovered sale look like an ad click is against both
 * platforms' terms and would corrupt the very numbers the shop buys ads on.
 */
export const recoveryUrl = (
  frontendUrl: string,
  settings: Pick<AbandonedCartSettings, "utm_source" | "utm_medium" | "utm_campaign">,
  extraParams: Record<string, string> = {},
): string => {
  const base = String(frontendUrl || "").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (settings.utm_source) params.set("utm_source", settings.utm_source);
  if (settings.utm_medium) params.set("utm_medium", settings.utm_medium);
  if (settings.utm_campaign) params.set("utm_campaign", settings.utm_campaign);
  for (const [k, v] of Object.entries(extraParams)) if (v) params.set(k, v);
  const query = params.toString();
  return `${base}/basket${query ? `?${query}` : ""}`;
};

// ── The template's context ────────────────────────────────────────────────────

export interface AbandonedCartLine {
  name: string;
  quantity: number;
  /** Already formatted, e.g. "€25.00" — the server formats, nothing recomputes. */
  line_total: string;
  /** https only; anything else is dropped rather than shipped as a broken image. */
  image_url: string;
}

export interface AbandonedCartContext {
  first_name: string;
  cart_url: string;
  cart_total: string;
  item_count: number;
  discount_code: string;
  discount_value: string;
  free_shipping: string;
  shop_name: string;
  cta_label: string;
  items: AbandonedCartLine[];
}

/** The tokens an admin may type, in the order the help text lists them. */
export const ABANDONED_CART_TOKENS = [
  "{cart_items}", "{cart_button}", "{first_name}", "{cart_url}", "{cart_total}",
  "{item_count}", "{discount_code}", "{discount_value}", "{free_shipping}", "{shop_name}",
] as const;

/** Block-level tokens: alone on a line, they become something other than text. */
const ITEMS_TOKEN = "{cart_items}";
const BUTTON_TOKEN = "{cart_button}";

/**
 * Replace the inline tokens in one run of text.
 *
 * Single pass over a combined pattern, so a value that happens to contain
 * another token's text (a product named "{cart_total}", say) is not re-scanned —
 * substitution is not a place to be clever. An unknown `{whatever}` is left
 * exactly as typed: the admin sees their own typo rather than a hole.
 */
export const applyAbandonedCartTokens = (text: string, ctx: AbandonedCartContext): string =>
  String(text ?? "").replace(
    /\{(first_name|cart_url|cart_total|item_count|discount_code|discount_value|free_shipping|shop_name)\}/g,
    (whole, key: string) => {
      switch (key) {
        case "first_name": return ctx.first_name;
        case "cart_url": return ctx.cart_url;
        case "cart_total": return ctx.cart_total;
        case "item_count": return String(ctx.item_count);
        case "discount_code": return ctx.discount_code;
        case "discount_value": return ctx.discount_value;
        case "free_shipping": return ctx.free_shipping;
        case "shop_name": return ctx.shop_name;
        default: return whole;
      }
    },
  );

export type AbandonedCartBlock =
  | NewsletterBlock
  | { type: "items" }
  | { type: "button" };

/** The plain text of a paragraph block, markers removed — used to spot tokens. */
const blockText = (block: NewsletterBlock): string =>
  block.type === "paragraph" ? block.spans.map(s => s.text).join("").trim() : "";

/**
 * Admin body + one shopper's context → the blocks their email is built from.
 *
 * Parsed first, substituted second (so a product name can never inject markup),
 * and the basket and button are appended when the body left them out.
 */
export const parseAbandonedCartBody = (
  body: string | null | undefined,
  ctx: AbandonedCartContext,
): AbandonedCartBlock[] => {
  const out: AbandonedCartBlock[] = [];
  let hasItems = false;
  let hasButton = false;

  for (const block of parseNewsletterBody(body)) {
    const text = blockText(block);
    if (text === ITEMS_TOKEN) { out.push({ type: "items" }); hasItems = true; continue; }
    if (text === BUTTON_TOKEN) { out.push({ type: "button" }); hasButton = true; continue; }
    if (block.type === "image") { out.push(block); continue; }
    const spans: NewsletterSpan[] = block.spans
      .map(s => ({ ...s, text: applyAbandonedCartTokens(s.text, ctx) }))
      .filter(s => s.text !== "");
    if (spans.length) out.push({ type: "paragraph", spans });
  }

  // The guarantee. An email that says "here's your basket" and then shows no
  // basket is worse than not sending, and the way that happens in practice is an
  // admin editing the copy and dropping the token without noticing.
  if (!hasItems) out.push({ type: "items" });
  if (!hasButton) out.push({ type: "button" });
  return out;
};

/** The plain-text alternative, for clients that refuse HTML. */
export const abandonedCartBodyText = (
  body: string | null | undefined,
  ctx: AbandonedCartContext,
): string =>
  parseAbandonedCartBody(body, ctx)
    .map(block => {
      if (block.type === "items")
        return ctx.items
          .map(i => `• ${i.name} × ${i.quantity} — ${i.line_total}`)
          .concat(`Subtotal: ${ctx.cart_total}`)
          .join("\n");
      if (block.type === "button") return `${ctx.cta_label}: ${ctx.cart_url}`;
      if (block.type === "image") return block.alt ? `[image: ${block.alt}]` : "[image]";
      return block.spans.map(s => s.text).join("");
    })
    .join("\n\n");
