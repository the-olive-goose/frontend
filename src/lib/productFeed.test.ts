import { describe, it, expect } from "vitest";
import * as backend from "../../backend/productFeed.js";
import { partitionFeedProducts, feedExcludeReason, feedPriceValue, feedOutOfStock } from "./productFeed";
import { DEFAULT_PRODUCT_FEED } from "@/lib/defaults";
import type { Product } from "@/lib/defaults";

// The feed's inclusion rules exist twice — once in TypeScript so Admin → Ops →
// Product Feed can preview what will be sent, once in plain JS for the API,
// which deploys on its own and can't import the app's TS. Duplication like this
// drifts silently: the admin promises three candles, the feed sends two, and the
// only symptom is a Merchant Center diagnostic days later. These cases pin the
// two together, and then check the document the backend actually produces.

const product = (over: Partial<Product> = {}): Product => ({
  id: "1",
  name: "Iced Matcha Latte Candle",
  description: "Smooth matcha with a cozy creamy finish.",
  price: "25",
  image_url: "https://i.ibb.co/abc/matcha.jpg",
  tag: "BESTSELLER",
  ...over,
});

// Every shape that decides inclusion, including the ones seen in the real
// catalogue: a blank gallery entry, a price with a currency symbol, an image
// pasted as a bare path rather than a URL.
const CASES: Product[] = [
  product(),
  product({ id: "2", price: "€25.00" }),
  product({ id: "3", price: "0" }),
  product({ id: "4", price: "" }),
  product({ id: "5", name: "" }),
  product({ id: "6", name: "   " }),
  product({ id: "7", image_url: "" }),
  product({ id: "8", image_url: "/uploads/local.jpg" }),
  product({ id: "9", image_url: "http://example.com/a.png" }),
  product({ id: "10", stock: 0 }),
  product({ id: "11", stock: null }),
  product({ id: "12", stock: undefined }),
  product({ id: "13", stock: 5 }),
  product({ id: "14", stock: -1 }),
];

describe("feed rules agree across the two runtimes", () => {
  for (const settings of [
    { ...DEFAULT_PRODUCT_FEED, include_out_of_stock: true },
    { ...DEFAULT_PRODUCT_FEED, include_out_of_stock: false },
  ]) {
    describe(`include_out_of_stock: ${settings.include_out_of_stock}`, () => {
      for (const p of CASES) {
        it(`product ${p.id} — same verdict and same reason`, () => {
          expect(feedExcludeReason(p, settings)).toBe(backend.excludeReason(p, settings));
        });
      }

      it("partitions the whole catalogue identically", () => {
        const ts = partitionFeedProducts(CASES, settings);
        const js = backend.partitionFeedProducts(CASES, settings);
        expect(ts.included.map((p) => p.id)).toEqual(js.included.map((p: Product) => p.id));
        expect(ts.excluded.map((e) => [e.product.id, e.reason])).toEqual(
          js.excluded.map((e: { product: Product; reason: string }) => [e.product.id, e.reason]),
        );
      });
    });
  }

  it("parses prices the same way", () => {
    for (const price of ["25", "€25.00", "25.5", "", "abc", "0"]) {
      expect(feedPriceValue(price)).toBe(backend.priceValue(price));
    }
  });

  it("reads stock the same way", () => {
    for (const p of CASES) expect(feedOutOfStock(p)).toBe(backend.isOutOfStock(p));
  });

  it("ships the same defaults", () => {
    expect(backend.PRODUCT_FEED_DEFAULTS).toEqual(DEFAULT_PRODUCT_FEED);
  });
});

describe("the feed document", () => {
  const build = (over: Record<string, unknown> = {}) =>
    backend.buildProductFeed({
      products: [product(), product({ id: "2", name: "Iced Berry Latte Candle", price: "25" })],
      settings: { ...DEFAULT_PRODUCT_FEED, enabled: true },
      pickup: { flat_shipping_rate: 4.99, free_shipping_threshold: 45 },
      siteUrl: "https://theolivegoose.ie",
      siteName: "The Olive Goose",
      currency: "EUR",
      ...over,
    });

  it("is RSS 2.0 carrying Google's namespace, which is what both platforms read", () => {
    const { xml } = build();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">');
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });

  it("prices in major units with the currency, not cents", () => {
    expect(build().xml).toContain("<g:price>25.00 EUR</g:price>");
  });

  it("says identifiers genuinely don't exist — without this Google rejects every item", () => {
    expect(build().xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
  });

  it("omits that claim once real barcodes are declared", () => {
    const { xml } = build({ settings: { ...DEFAULT_PRODUCT_FEED, enabled: true, identifier_exists: true } });
    expect(xml).not.toContain("identifier_exists");
  });

  it("links to the product page using the same slug as the sitemap", () => {
    expect(build().xml).toContain("<link>https://theolivegoose.ie/products/iced-matcha-latte-candle</link>");
  });

  it("prefers an admin-set slug over the name, exactly as the storefront does", () => {
    const { xml } = build({ products: [product({ slug: "matcha" })] });
    expect(xml).toContain("<link>https://theolivegoose.ie/products/matcha</link>");
  });

  it("quotes the flat rate for a product that does not clear the free-shipping threshold", () => {
    const { xml } = build();
    expect(xml).toContain("<g:price>4.99 EUR</g:price>");
  });

  it("quotes free shipping for a product that clears it on its own", () => {
    const { xml } = build({ products: [product({ price: "50" })] });
    expect(xml).toContain("<g:price>0.00 EUR</g:price>");
  });

  it("sends no shipping block at all when no rate is configured", () => {
    const { xml } = build({ pickup: {} });
    expect(xml).not.toContain("<g:shipping>");
  });

  it("falls back to the site name for the brand, and prefers an explicit one", () => {
    expect(build().xml).toContain("<g:brand>The Olive Goose</g:brand>");
    const { xml } = build({ settings: { ...DEFAULT_PRODUCT_FEED, enabled: true, brand: "Olive Goose Candles" } });
    expect(xml).toContain("<g:brand>Olive Goose Candles</g:brand>");
  });

  it("marks sold-out stock rather than dropping it", () => {
    const { xml } = build({ products: [product({ stock: 0 })] });
    expect(xml).toContain("<g:availability>out_of_stock</g:availability>");
  });

  it("escapes XML so an ampersand in a product name cannot break the document", () => {
    const { xml } = build({ products: [product({ name: "Coffee & Cream <Special>" })] });
    expect(xml).toContain("<title>Coffee &amp; Cream &lt;Special&gt;</title>");
    expect(xml).not.toContain("<Special>");
  });

  it("strips the product page's markdown out of the description", () => {
    const { xml } = build({
      products: [product({ description: "", detail_paragraphs: ["**Your favourite café vibes**, now in candle form."] })],
    });
    expect(xml).toContain("<description>Your favourite café vibes, now in candle form.</description>");
  });

  it("sends gallery photos as extra images, and only real URLs", () => {
    const { xml } = build({
      products: [product({ gallery_urls: ["https://i.ibb.co/abc/two.jpg", "", "/uploads/local.jpg"] })],
    });
    expect(xml).toContain("<g:additional_image_link>https://i.ibb.co/abc/two.jpg</g:additional_image_link>");
    expect(xml).not.toContain("/uploads/local.jpg");
  });

  it("leaves gallery photos out when that is turned off", () => {
    const { xml } = build({
      products: [product({ gallery_urls: ["https://i.ibb.co/abc/two.jpg"] })],
      settings: { ...DEFAULT_PRODUCT_FEED, enabled: true, include_gallery_images: false },
    });
    expect(xml).not.toContain("additional_image_link");
  });

  it("carries one item per included product and reports what it left out", () => {
    const result = backend.buildProductFeed({
      products: [product(), product({ id: "2", price: "0" })],
      settings: { ...DEFAULT_PRODUCT_FEED, enabled: true },
      pickup: {},
    });
    expect(result.included).toBe(1);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toBe("No price");
    expect(result.xml.match(/<item>/g) ?? []).toHaveLength(1);
  });

  it("stays valid with an empty catalogue rather than emitting a broken channel", () => {
    const { xml, included } = backend.buildProductFeed({ products: [], settings: { enabled: true } });
    expect(included).toBe(0);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
