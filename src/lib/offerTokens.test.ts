import { describe, it, expect } from "vitest";
import {
  fillOfferTokens,
  fillDiscountToken,
  freeShippingClause,
  resolveOfferValues,
  type OfferValues,
} from "@/lib/offerTokens";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { DEFAULT_FREE_SHIPPING_THRESHOLD } from "@/lib/cart";
import { ROUTE_META } from "@/lib/seo";

const offer = (o: Partial<OfferValues> = {}): OfferValues => ({
  freeShippingThreshold: 65,
  welcomeDiscountPercent: 10,
  ...o,
});

describe("resolveOfferValues", () => {
  it("reads the live figures out of the settings sections", () => {
    const v = resolveOfferValues({ free_shipping_threshold: 50 }, { discount_percent: 5 });
    expect(v).toEqual({ freeShippingThreshold: 50, welcomeDiscountPercent: 5 });
  });

  // The bug this module exists to prevent: `|| 65` would turn a deliberate
  // "everything ships free" into copy promising a €65 bar that checkout ignores.
  it("keeps a threshold of 0 rather than falling back to the default", () => {
    const v = resolveOfferValues({ free_shipping_threshold: 0 }, { discount_percent: 0 });
    expect(v.freeShippingThreshold).toBe(0);
    expect(v.welcomeDiscountPercent).toBe(0);
  });

  it("falls back only when the value is genuinely absent or unparseable", () => {
    expect(resolveOfferValues({}, {}).freeShippingThreshold).toBe(DEFAULT_FREE_SHIPPING_THRESHOLD);
    expect(resolveOfferValues(undefined, undefined).freeShippingThreshold).toBe(DEFAULT_FREE_SHIPPING_THRESHOLD);
    expect(
      resolveOfferValues({ free_shipping_threshold: NaN }, {}).freeShippingThreshold
    ).toBe(DEFAULT_FREE_SHIPPING_THRESHOLD);
  });
});

describe("freeShippingClause", () => {
  it("names the bar when there is one", () => {
    expect(freeShippingClause(65)).toBe("on orders over €65");
  });

  it("shows cents only when the threshold has them", () => {
    expect(freeShippingClause(49.99)).toBe("on orders over €49.99");
    expect(freeShippingClause(50)).toBe("on orders over €50");
  });

  // "on orders over €0" is technically true and reads as broken.
  it("changes the words, not just the number, when everything ships free", () => {
    expect(freeShippingClause(0)).toBe("on all orders");
    expect(freeShippingClause(-1)).toBe("on all orders");
  });
});

describe("fillOfferTokens", () => {
  it("substitutes every offer token", () => {
    expect(fillOfferTokens("Free shipping {free_shipping}", offer()))
      .toBe("Free shipping on orders over €65");
    expect(fillOfferTokens("Save {free_shipping_threshold} today", offer({ freeShippingThreshold: 50 })))
      .toBe("Save €50 today");
    expect(fillOfferTokens("{discount}% off your first order", offer({ welcomeDiscountPercent: 5 })))
      .toBe("5% off your first order");
  });

  it("substitutes a token appearing more than once", () => {
    expect(fillOfferTokens("{discount}% — yes, {discount}%", offer({ welcomeDiscountPercent: 5 })))
      .toBe("5% — yes, 5%");
  });

  it("renders the zero-threshold phrasing through the token", () => {
    expect(fillOfferTokens("✨ Free shipping {free_shipping}", offer({ freeShippingThreshold: 0 })))
      .toBe("✨ Free shipping on all orders");
  });

  it("leaves unknown tokens visible rather than silently dropping them", () => {
    expect(fillOfferTokens("{not_a_token} stays", offer())).toBe("{not_a_token} stays");
  });

  it("tolerates empty and missing copy", () => {
    expect(fillOfferTokens("", offer())).toBe("");
    expect(fillOfferTokens(undefined, offer())).toBe("");
  });
});

describe("fillDiscountToken", () => {
  // The popup knows its own percent but not the shipping threshold, so it must
  // leave the shipping tokens alone rather than resolve them to a guess.
  it("resolves {discount} and leaves the shipping tokens untouched", () => {
    expect(fillDiscountToken("{discount}% off, free shipping {free_shipping}", 5))
      .toBe("5% off, free shipping {free_shipping}");
  });
});

// ─── The regression that motivated all of the above ──────────────────────────
//
// Production shipped an announcement bar reading "Free shipping on orders over
// €50" while the configured threshold was 0, and "10% off your first order"
// while the popup issued 5%. Nothing failed, because no test compared copy to
// config. These do.
describe("shipped default copy quotes no offer figure of its own", () => {
  const OFFER_FIGURE = /€\s?\d|\d+\s?%/;

  const copyStrings: { where: string; text: string }[] = [
    ...DEFAULT_CONTENT.announcementBar.messages.map((text, i) => ({
      where: `announcementBar.messages[${i}]`,
      text,
    })),
    ...DEFAULT_CONTENT.shippingPolicy.sections.flatMap((s, i) => [
      { where: `shippingPolicy.sections[${i}].title`, text: s.title },
      { where: `shippingPolicy.sections[${i}].body`, text: s.body },
    ]),
    { where: "shippingPolicy.intro", text: DEFAULT_CONTENT.shippingPolicy.intro },
    { where: "subscribePopup.subtext", text: DEFAULT_CONTENT.subscribePopup.subtext },
    { where: "subscribePopup.cta_text", text: DEFAULT_CONTENT.subscribePopup.cta_text },
  ];

  it.each(copyStrings)("$where uses a token, not a hardcoded figure", ({ text }) => {
    expect(text).not.toMatch(OFFER_FIGURE);
  });

  // ROUTE_META is a compile-time map read while navigating, so it cannot resolve
  // tokens — the settings load asynchronously, after the meta tag is set and after
  // a crawler has read it. The only safe copy there quotes no figure at all.
  it("no route's meta description advertises an offer figure", () => {
    for (const [route, meta] of Object.entries(ROUTE_META)) {
      expect(meta.description, `${route} meta description`).not.toMatch(OFFER_FIGURE);
    }
  });

  it("renders the live figures once tokens are resolved", () => {
    const live = resolveOfferValues({ free_shipping_threshold: 0 }, { discount_percent: 5 });
    const rendered = DEFAULT_CONTENT.announcementBar.messages.map(m => fillOfferTokens(m, live));

    expect(rendered.some(m => /free shipping on all orders/i.test(m))).toBe(true);
    expect(rendered.some(m => /5% off/.test(m))).toBe(true);
    // No stale figure survives anywhere in the rendered bar.
    expect(rendered.join(" ")).not.toMatch(/€50|€65|10%/);
  });
});
