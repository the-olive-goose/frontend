// ── Page metadata derived from admin content ───────────────────────────────────
// A page's search title and snippet should say what the page says, and an admin
// shouldn't have to type that copy twice. So instead of a second set of strings
// to maintain, each page's meta is built from the section that already owns its
// heading and intro — the home page from Hero Banner, the policy pages from
// their own editors, and so on. ROUTE_META in seo.ts stays as the fallback for
// pages whose copy lives in code (FAQ, Track Order) and for any field an admin
// has left blank.
//
// Copy written for the page may contain rich-text markup and the {free_shipping}
// / {discount} offer tokens, so both are resolved here — a meta description must
// never ship a literal "{free_shipping}" to Google.

import { getContent } from "@/lib/api";
import { resetContentCache } from "@/lib/contentStore";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type SiteContent } from "@/lib/defaults";
import { fillOfferTokens, resolveOfferValues, type OfferValues } from "@/lib/offerTokens";
import { joinPageTitle } from "@/lib/pageTitle";
import { stripRichText } from "@/lib/richtext";
import {
  getSeoSettings,
  metaForPath,
  routeKeyForPath,
  SITE_NAME,
  type RouteMeta,
} from "@/lib/seo";

/** Google truncates around these lengths; matching them keeps snippets whole. */
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 155;

interface RawMeta {
  title: string;
  description: string;
}

interface MetaSource {
  /** How this page is named in the admin sidebar. */
  page: string;
  /** The admin section its copy is written in. */
  from: string;
  /** Content section key (`/api/content/:section`). */
  section: string;
  fallback: unknown;
  pick: (content: unknown) => RawMeta;
}

function defineSource<T>(
  page: string,
  from: string,
  section: string,
  fallback: T,
  pick: (content: T) => RawMeta,
): MetaSource {
  return { page, from, section, fallback, pick: pick as MetaSource["pick"] };
}

/**
 * Which admin section supplies each route's title and description, keyed by
 * ROUTE_META key. Routes absent from here keep the copy in ROUTE_META: /shop and
 * /faq have editable banner headlines but keyword-written meta titles worth more
 * to search than "All Candles" would be, /track-order has no editable copy, and
 * /products/* is written per product by ProductDetailPage.
 *
 * A banner headline is stored as a plain half plus a gold half, so titles are
 * rejoined here — a search result should read "Delivery & Returns", not
 * "Delivery &".
 */
export const META_SOURCES: Record<string, MetaSource> = {
  "/": defineSource("Home page", "Home Page → Hero Banner", "hero", DEFAULT_CONTENT.hero, (c) => ({
    title: c.headline,
    description: c.subtext,
  })),
  "/deals": defineSource("Today's Deals", "Shop Page → Today's Deals", "deals", DEFAULT_DEALS, (c) => ({
    title: joinPageTitle(c.page_title, c.page_title_gold),
    description: c.page_subtitle,
  })),
  // The banner is what the page announces itself as, so the search title should
  // match it. It used to come from Brand Story's own pair of title fields, which
  // meant the tab said one thing and the page said another.
  "/about": defineSource("Our Story", "About Page → Banner & Values", "aboutPage", DEFAULT_CONTENT.aboutPage, (c) => ({
    title: joinPageTitle(c.page_title, c.page_title_gold),
    description: c.page_subtitle,
  })),
  "/our-story": defineSource("Founder Diary", "About Page → Founder Diary", "ourStoryPage", DEFAULT_CONTENT.ourStoryPage, (c) => ({
    title: joinPageTitle(c.page_title, c.page_title_gold),
    description: c.page_subtitle,
  })),
  "/candle-care": defineSource("Candle Care", "Home Page → Candle Care", "candleCare", DEFAULT_CONTENT.candleCare, (c) => ({
    title: joinPageTitle(c.headline_part1, c.headline_part2),
    description: c.hero_subtitle ?? "",
  })),
  "/gift-cards": defineSource("Gift Cards", "Policy & Info Pages → Gift Cards", "giftCards", DEFAULT_CONTENT.giftCards, (c) => ({
    title: c.heading,
    description: c.intro,
  })),
  "/customer-service": defineSource("Customer Service", "Policy & Info Pages → Customer Service", "customerService", DEFAULT_CONTENT.customerService, (c) => ({
    title: joinPageTitle(c.heading, c.heading_gold),
    description: c.intro,
  })),
  "/returns": defineSource("Returns & Refunds", "Policy & Info Pages → Return Policy", "returnPolicy", DEFAULT_CONTENT.returnPolicy, (c) => ({
    title: joinPageTitle(c.heading, c.heading_gold),
    description: c.intro,
  })),
  "/shipping-policy": defineSource("Shipping Policy", "Policy & Info Pages → Shipping Policy", "shippingPolicy", DEFAULT_CONTENT.shippingPolicy, (c) => ({
    title: joinPageTitle(c.heading, c.heading_gold),
    description: c.intro,
  })),
  "/privacy-policy": defineSource("Privacy Policy", "Policy & Info Pages → Privacy Policy", "privacyPolicy", DEFAULT_CONTENT.privacyPolicy, (c) => ({
    title: joinPageTitle(c.heading, c.heading_gold),
    description: c.intro,
  })),
  "/terms-of-service": defineSource("Terms of Service", "Policy & Info Pages → Terms of Service", "termsOfService", DEFAULT_CONTENT.termsOfService, (c) => ({
    title: joinPageTitle(c.heading, c.heading_gold),
    description: c.intro,
  })),
};

/** Page copy → one clean line: offer tokens resolved, markup and whitespace gone. */
const clean = (text: string | undefined, offer: OfferValues): string =>
  stripRichText(fillOfferTokens(text ?? "", offer)).replace(/\s+/g, " ").trim();

/** Trim to `max` on a word boundary, with an ellipsis so the cut is visible. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.replace(/[\s,;:.—–-]+$/, "")}…`;
}

/**
 * Build the final tags from a page's own copy, falling back to the ROUTE_META
 * baseline field by field — an admin who clears a heading gets the shipped
 * default back rather than an empty <title>.
 */
export function buildMeta(base: RouteMeta, raw: RawMeta, offer: OfferValues, siteName: string): RouteMeta {
  const headline = clean(raw.title, offer);
  const intro = clean(raw.description, offer);

  // Page headings are written for the page ("Love it long. Burn it right.") and
  // rarely name the brand, but a search result should — so the brand is appended
  // unless the heading already carries it, and the headline is trimmed first so
  // appending can't push the whole title past the truncation point.
  const suffix = ` | ${siteName}`;
  const title = !headline
    ? base.title
    : headline.toLowerCase().includes(siteName.toLowerCase())
      ? clamp(headline, MAX_TITLE)
      : clamp(headline, MAX_TITLE - suffix.length) + suffix;

  return {
    ...base,
    title,
    description: intro ? clamp(intro, MAX_DESCRIPTION) : base.description,
  };
}

// Content sections are fetched once per session — that caching now lives in
// lib/contentStore, shared with every component on the page, so a section the
// meta tags need is the same fetch the page body already made.
function loadSection(section: string, fallback: unknown): Promise<unknown> {
  return getContent(section, fallback);
}

function loadOffer(): Promise<OfferValues> {
  return Promise.all([
    getContent("pickupSettings", DEFAULT_CONTENT.pickupSettings),
    getContent("subscribePopup", DEFAULT_CONTENT.subscribePopup),
  ]).then(([pickup, popup]) => resolveOfferValues(pickup, popup));
}

/** Test seam — clears the per-session content cache. */
export function resetSeoContentCache() {
  resetContentCache();
}

/**
 * The metadata for a pathname, using the admin's page copy where a section owns
 * it. Resolves to the plain ROUTE_META entry for routes with no source, so the
 * caller can await this unconditionally.
 */
export async function resolveRouteMeta(pathname: string): Promise<RouteMeta> {
  const base = metaForPath(pathname);
  const key = routeKeyForPath(pathname);
  const source = key ? META_SOURCES[key] : undefined;
  if (!source) return base;

  const [content, offer] = await Promise.all([
    loadSection(source.section, source.fallback),
    loadOffer(),
  ]);
  return buildMeta(base, source.pick(content), offer, getSeoSettings().site_name || SITE_NAME);
}

/**
 * The same derivation, run against content the admin dashboard already has in
 * state — so the SEO panel's preview shows exactly what the storefront will
 * write, without a second round of fetches.
 */
export function previewMeta(routeKey: string, content: SiteContent, siteName: string): RouteMeta {
  const source = META_SOURCES[routeKey];
  const base = metaForPath(routeKey);
  if (!source) return base;
  const offer = resolveOfferValues(content.pickupSettings, content.subscribePopup);
  const sectionContent = (content as unknown as Record<string, unknown>)[source.section] ?? source.fallback;
  return buildMeta(base, source.pick(sectionContent), offer, siteName);
}
