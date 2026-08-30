import { describe, expect, it } from "vitest";
import { installMemoryStorage } from "@/test/memoryStorage";
import { buildProductFeed } from "../../backend/productFeed.js";
import { toMetaEvent } from "./meta";
import { productPath } from "./products";
import type { Product } from "./defaults";

installMemoryStorage(); // this jsdom build ships without Web Storage

/**
 * The join that makes catalogue ads work, and the one nobody checks.
 *
 * A dynamic Meta or Google ad is the platform matching an event the pixel sent
 * against a row in the feed. That match is made on ONE string: the pixel's
 * `content_ids` against the feed's `g:id`. Everything else can be perfect and
 * the campaign will still show nothing — Meta reports it as an empty audience
 * or a catalogue with "0 matched products", days later, with no indication that
 * an id format is the reason.
 *
 * Both sides derive it from `product.id` today, and neither file knows the other
 * exists. This pins them together so a change to either is a failing test rather
 * than a silently dead retargeting campaign.
 *
 * The feed's `<link>` is checked the same way: a feed whose links 404 does not
 * lose one item, it gets the whole merchant account suspended.
 */

const CATALOGUE = [
  // The live shop's actual shape: no slug set, so the URL is derived from the name.
  { id: "1", name: "Iced Matcha Latte Candle", slug: "", price: "25",
    description: "Smooth matcha with a cozy creamy finish.",
    image_url: "https://i.ibb.co/a/matcha.png", gallery_urls: ["https://i.ibb.co/b/matcha2.png"] },
  // An admin-set slug, which must win over the name.
  { id: "2", name: "Iced Coffee Latte Candle", slug: "coffee-latte", price: "€25",
    description: "Iced latte vibes.", image_url: "https://i.ibb.co/c/coffee.png" },
  // Accents and punctuation in the name — the slugify path most likely to differ.
  { id: "3", name: "Café Crème & Berries!", price: "30.00",
    description: "Berry.", image_url: "https://i.ibb.co/d/berry.png" },
  // A numeric-looking id, and stock tracked at zero.
  { id: "42", name: "Sold Out Candle", price: "25", stock: 0,
    description: "Gone.", image_url: "https://i.ibb.co/e/gone.png" },
];

const SETTINGS = {
  enabled: true, include_out_of_stock: true, brand: "The Olive Goose",
  min_handling_time: 2, max_handling_time: 4,
};
const PICKUP = { flat_shipping_rate: 4.99, free_shipping_threshold: 45 };

const feed = () =>
  buildProductFeed({
    products: CATALOGUE, settings: SETTINGS, pickup: PICKUP,
    siteUrl: "https://theolivegoose.ie", siteName: "The Olive Goose", currency: "EUR",
  });

/** Pull every <item> out of the feed as a flat record. */
const feedItems = (xml: string): Record<string, string>[] =>
  [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, block]) => {
    const item: Record<string, string> = {};
    for (const [, tag, value] of block.matchAll(/<(g:[a-z_]+|title|description|link)>([^<]*)<\/\1>/g)) {
      if (!(tag in item)) item[tag] = value;
    }
    return item;
  });

/** What the pixel would put in content_ids when this product is viewed. */
const pixelContentIds = (product: { id: string; name: string; price: string }): string[] => {
  const event = toMetaEvent("view_item", {
    product_id: product.id, name: product.name, price: Number(String(product.price).replace(/[^0-9.]/g, "")),
  });
  return (event?.params.content_ids as string[]) ?? [];
};

describe("feed g:id ↔ pixel content_ids", () => {
  const items = feedItems(feed().xml);

  it("puts every catalogue product in the feed", () => {
    expect(items).toHaveLength(CATALOGUE.length);
  });

  it.each(CATALOGUE.map(p => [p.id, p] as const))(
    "product %s: the id the pixel reports is the id the feed publishes",
    (id, product) => {
      const item = items.find(i => i["g:id"] === id);
      expect(item, `no feed item with g:id ${id}`).toBeDefined();
      expect(pixelContentIds(product as never)).toEqual([id]);
    },
  );

  // The add-to-cart audience is what retargeting is actually built from, so it
  // has to join on the same string as the view.
  it("reports the same id on add_to_cart as on view_item", () => {
    for (const product of CATALOGUE) {
      const cart = toMetaEvent("add_to_cart", { product_id: product.id, name: product.name, price: 25, quantity: 1 });
      expect(cart?.params.content_ids).toEqual([product.id]);
    }
  });

  // Meta matches `contents[].id` too, and a mismatch between the two fields in
  // the same event is its own quiet failure.
  it("keeps contents[].id in step with content_ids", () => {
    const event = toMetaEvent("view_item", { product_id: "1", name: "X", price: 25 });
    const contents = event?.params.contents as { id: string }[];
    expect(contents.map(c => c.id)).toEqual(event?.params.content_ids);
  });

  it("declares content_type 'product', which is what product-level ids require", () => {
    expect(toMetaEvent("view_item", { product_id: "1", name: "X", price: 25 })?.params.content_type)
      .toBe("product");
  });
});

describe("feed links resolve to real product pages", () => {
  const items = feedItems(feed().xml);

  // A feed link that 404s does not lose one item — it gets the merchant account
  // suspended. The feed builds the URL in plain JS; the storefront resolves it in
  // TypeScript. These are the two halves meeting.
  it.each(CATALOGUE.map(p => [p.id, p] as const))(
    "product %s: the feed's link is the storefront's own product path",
    (id, product) => {
      const item = items.find(i => i["g:id"] === id)!;
      expect(item.link).toBe(`https://theolivegoose.ie${productPath(product as unknown as Product)}`);
    },
  );

  it("derives a slug from the name when none is set", () => {
    expect(items.find(i => i["g:id"] === "1")!.link)
      .toBe("https://theolivegoose.ie/products/iced-matcha-latte-candle");
  });

  it("prefers an admin-set slug over the name", () => {
    expect(items.find(i => i["g:id"] === "2")!.link)
      .toBe("https://theolivegoose.ie/products/coffee-latte");
  });

  it("strips accents and punctuation the same way both sides do", () => {
    expect(items.find(i => i["g:id"] === "3")!.link)
      .toBe("https://theolivegoose.ie/products/cafe-creme-berries");
  });
});

describe("what the ad platforms require of each item", () => {
  const items = feedItems(feed().xml);

  it("carries every field Meta and Google reject an item for missing", () => {
    for (const item of items) {
      for (const field of ["g:id", "title", "description", "link", "g:image_link",
                           "g:availability", "g:price", "g:condition", "g:brand"]) {
        expect(item[field], `${field} missing from item ${item["g:id"]}`).toBeTruthy();
      }
    }
  });

  it("prices as a number and a currency, matching the shop's own price", () => {
    expect(items.find(i => i["g:id"] === "1")!["g:price"]).toBe("25.00 EUR");
    // "€25" must parse to the same figure as the bare "25" above.
    expect(items.find(i => i["g:id"] === "2")!["g:price"]).toBe("25.00 EUR");
    expect(items.find(i => i["g:id"] === "3")!["g:price"]).toBe("30.00 EUR");
  });

  it("marks a zero-stock product out of stock rather than dropping it", () => {
    expect(items.find(i => i["g:id"] === "42")!["g:availability"]).toBe("out_of_stock");
  });

  it("says identifiers do not exist, without which every item is disapproved", () => {
    expect(feed().xml).toContain("<g:identifier_exists>no</g:identifier_exists>");
  });

  // Per-item shipping is what one unit costs to deliver alone. A €25 candle
  // under a €45 threshold ships at the flat rate; understating it is a price
  // mismatch disapproval, overstating it loses the click.
  it("charges the flat rate below the free-shipping threshold", () => {
    const xml = feed().xml;
    expect(xml).toContain("<g:price>4.99 EUR</g:price>");
  });

  // Made-to-order is the shop's actual model: nothing is held, each candle is
  // poured after the order. Handling time is how that is expressed in a feed —
  // NOT by changing availability, which would hide the listing.
  it("declares handling time so Google does not promise same-day dispatch", () => {
    const xml = feed().xml;
    expect(xml).toContain("<g:min_handling_time>2</g:min_handling_time>");
    expect(xml).toContain("<g:max_handling_time>4</g:max_handling_time>");
  });

  it("keeps everything in stock — making time is not the same as having none", () => {
    const inStock = items.filter(i => i["g:availability"] === "in_stock");
    // Every product except the deliberately zero-stock fixture.
    expect(inStock).toHaveLength(CATALOGUE.length - 1);
    expect(feed().xml).not.toContain("preorder");
    expect(feed().xml).not.toContain("backorder");
  });

  it("omits handling time entirely when it is not set, rather than sending zero", () => {
    const { xml } = buildProductFeed({
      products: CATALOGUE, settings: { ...SETTINGS, min_handling_time: 0, max_handling_time: 0 },
      pickup: PICKUP, siteUrl: "https://theolivegoose.ie", siteName: "The Olive Goose", currency: "EUR",
    });
    expect(xml).not.toContain("handling_time");
  });

  it("orders a transposed pair instead of publishing a backwards range", () => {
    const { xml } = buildProductFeed({
      products: CATALOGUE, settings: { ...SETTINGS, min_handling_time: 7, max_handling_time: 3 },
      pickup: PICKUP, siteUrl: "https://theolivegoose.ie", siteName: "The Olive Goose", currency: "EUR",
    });
    expect(xml).toContain("<g:min_handling_time>3</g:min_handling_time>");
    expect(xml).toContain("<g:max_handling_time>7</g:max_handling_time>");
  });

  it("is well-formed XML that a parser accepts", () => {
    const doc = new DOMParser().parseFromString(feed().xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelectorAll("item")).toHaveLength(CATALOGUE.length);
  });

  it("escapes characters that would otherwise break the document", () => {
    const { xml } = buildProductFeed({
      products: [{ id: "x", name: 'Bold & "Bright" <one>', price: "10",
        description: "A & B", image_url: "https://i.ibb.co/x/a.png" }],
      settings: SETTINGS, pickup: PICKUP,
      siteUrl: "https://theolivegoose.ie", siteName: "The Olive Goose", currency: "EUR",
    });
    expect(xml).toContain("&amp;");
    expect(xml).not.toMatch(/<title>[^<]*<one>/);
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });
});
