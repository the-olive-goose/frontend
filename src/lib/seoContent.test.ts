import { describe, it, expect, beforeEach } from "vitest";
import {
  buildMeta,
  previewMeta,
  resetSeoContentCache,
  resolveRouteMeta,
  META_SOURCES,
} from "@/lib/seoContent";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { ROUTE_META, SITE_NAME, type RouteMeta } from "@/lib/seo";
import type { OfferValues } from "@/lib/offerTokens";

const base: RouteMeta = { title: "Baseline title", description: "Baseline description." };
const offer: OfferValues = { freeShippingThreshold: 50, flatShippingRate: 4.99, welcomeDiscountPercent: 10, returnsWindowDays: 30 };

beforeEach(() => {
  resetSeoContentCache();
});

describe("buildMeta", () => {
  it("uses the page's own heading and intro, with the brand appended", () => {
    const meta = buildMeta(base, { title: "Love it long", description: "How to burn a candle." }, offer, SITE_NAME);
    expect(meta).toMatchObject({
      title: `Love it long | ${SITE_NAME}`,
      description: "How to burn a candle.",
    });
  });

  it("doesn't repeat the brand when the heading already names it", () => {
    const meta = buildMeta(base, { title: "The Olive Goose Gift Cards", description: "x" }, offer, SITE_NAME);
    expect(meta.title).toBe("The Olive Goose Gift Cards");
  });

  // A meta description must never ship a literal "{free_shipping}" to Google —
  // policy intros routinely contain the token.
  it("resolves offer tokens and strips rich-text markup", () => {
    const meta = buildMeta(
      base,
      { title: "*Shipping*", description: "Shipping is free {free_shipping} and new customers get {discount}%." },
      offer,
      SITE_NAME,
    );
    expect(meta.description).toBe("Shipping is free on orders over €50 and new customers get 10%.");
    expect(meta.title).toBe(`Shipping | ${SITE_NAME}`);
  });

  it("falls back to the baseline for copy an admin has cleared", () => {
    const meta = buildMeta(base, { title: "   ", description: "" }, offer, SITE_NAME);
    expect(meta).toEqual(base);
  });

  it("keeps other baseline fields, like noindex and ogType", () => {
    const meta = buildMeta(
      { ...base, noindex: true, ogType: "product" },
      { title: "Heading", description: "Intro." },
      offer,
      SITE_NAME,
    );
    expect(meta).toMatchObject({ noindex: true, ogType: "product" });
  });

  // Google truncates around 60/155; a title cut mid-word reads as broken.
  it("trims long copy on a word boundary", () => {
    const long = "Hand-poured small batch candles for every single mood moment and era in Dublin Ireland";
    const meta = buildMeta(base, { title: long, description: `${long} ${long}` }, offer, SITE_NAME);

    expect(meta.title.length).toBeLessThanOrEqual(60);
    expect(meta.title.endsWith(` | ${SITE_NAME}`)).toBe(true);
    expect(meta.description.length).toBeLessThanOrEqual(155);
    expect(meta.description.endsWith("…")).toBe(true);

    // The kept text is a whole-word prefix of the original, not a mid-word cut.
    const kept = meta.title.replace(` | ${SITE_NAME}`, "").replace(/…$/, "");
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(" ");
  });
});

describe("META_SOURCES", () => {
  it("only maps routes that exist and are indexable", () => {
    for (const key of Object.keys(META_SOURCES)) {
      expect(ROUTE_META[key], `${key} is not a known route`).toBeDefined();
      expect(ROUTE_META[key].noindex ?? false, `${key} is noindex`).toBe(false);
    }
  });

  // These pages render headings hardcoded in the page (or per product), so their
  // metadata has to stay in ROUTE_META — mapping them would drift.
  it("leaves pages without admin-owned copy alone", () => {
    expect(META_SOURCES["/shop"]).toBeUndefined();
    expect(META_SOURCES["/faq"]).toBeUndefined();
    expect(META_SOURCES["/track-order"]).toBeUndefined();
    expect(META_SOURCES["/products/*"]).toBeUndefined();
  });
});

describe("previewMeta", () => {
  it("derives the home result from the hero section", () => {
    const content = {
      ...DEFAULT_CONTENT,
      hero: { ...DEFAULT_CONTENT.hero, headline: "Candles for cosy evenings", subtext: "Poured in Dublin." },
    };
    expect(previewMeta("/", content, SITE_NAME)).toMatchObject({
      title: `Candles for cosy evenings | ${SITE_NAME}`,
      description: "Poured in Dublin.",
    });
  });

  it("derives the founder diary page from the our story section", () => {
    const content = {
      ...DEFAULT_CONTENT,
      ourStoryPage: {
        ...DEFAULT_CONTENT.ourStoryPage,
        page_title: "A Day in the",
        page_title_gold: "Studio",
        page_subtitle: "A behind-the-scenes look at the candles.",
      },
    };
    expect(previewMeta("/our-story", content, SITE_NAME)).toMatchObject({
      title: `A Day in the Studio | ${SITE_NAME}`,
      description: "A behind-the-scenes look at the candles.",
    });
  });

  it("returns the built-in entry for a route with no source", () => {
    expect(previewMeta("/faq", DEFAULT_CONTENT, SITE_NAME)).toEqual(ROUTE_META["/faq"]);
  });
});

describe("resolveRouteMeta", () => {
  // No backend in the test environment, so getContent falls back to the shipped
  // defaults — which is also what a fresh install serves.
  it("derives from the default content when the API is unavailable", async () => {
    const meta = await resolveRouteMeta("/");
    expect(meta.title).toBe(`${DEFAULT_CONTENT.hero.headline} | ${SITE_NAME}`);
  });

  it("passes routes with no source straight through", async () => {
    await expect(resolveRouteMeta("/faq")).resolves.toEqual(ROUTE_META["/faq"]);
    await expect(resolveRouteMeta("/products/matcha-hour")).resolves.toEqual(ROUTE_META["/products/*"]);
  });
});
