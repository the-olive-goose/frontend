import { describe, expect, it } from "vitest";
import { cartSubtotal, formatPrice } from "@/lib/cart";
import type { Product } from "@/lib/defaults";

// formatPrice renders the price on every product card, in the cart drawer, the
// basket, checkout and order tracking — but had no tests, which is how a live
// product saved as "0.3" came to render as "€0.3" across the whole storefront.

describe("formatPrice", () => {
  it("pads cents to two digits", () => {
    expect(formatPrice("0.3")).toBe("€0.30");
    expect(formatPrice("20.5")).toBe("€20.50");
    expect(formatPrice(0.3)).toBe("€0.30");
  });

  it("leaves whole euro unpadded, matching the offer-copy convention", () => {
    expect(formatPrice("20")).toBe("€20");
    expect(formatPrice(20)).toBe("€20");
    // A trailing ".00" an admin typed is redundant, not a different price.
    expect(formatPrice("38.00")).toBe("€38");
  });

  it("strips any currency symbol the admin typed", () => {
    expect(formatPrice("$38")).toBe("€38");
    expect(formatPrice("€38.50")).toBe("€38.50");
    expect(formatPrice("EUR 12.75")).toBe("€12.75");
  });

  it("accepts a comma as the decimal separator", () => {
    expect(formatPrice("38,50")).toBe("€38.50");
  });

  it("rounds to the cent rather than printing sub-cent noise", () => {
    expect(formatPrice("18.267")).toBe("€18.27");
  });

  it("returns nothing for an absent price and echoes unparseable text", () => {
    expect(formatPrice(null)).toBe("");
    expect(formatPrice(undefined)).toBe("");
    expect(formatPrice("")).toBe("");
    expect(formatPrice("Price on request")).toBe("Price on request");
  });
});

const product = (price: string): Product => ({ id: "1", name: "Candle", price } as Product);

describe("cartSubtotal", () => {
  it("multiplies each line by its quantity", () => {
    expect(cartSubtotal([
      { product: product("20"), quantity: 2 },
      { product: product("0.3"), quantity: 1 },
    ])).toBeCloseTo(40.3, 2);
  });

  it("treats an unparseable price as zero rather than NaN-ing the whole basket", () => {
    expect(cartSubtotal([
      { product: product("Price on request"), quantity: 1 },
      { product: product("20"), quantity: 1 },
    ])).toBe(20);
  });

  it("is zero for an empty basket", () => {
    expect(cartSubtotal([])).toBe(0);
  });
});
