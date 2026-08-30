import { describe, expect, it } from "vitest";
import { aggregateRating, clampRating, quotesForProduct } from "./productTestimonials";
import type { ProductTestimonial } from "./defaults";

const quote = (over: Partial<ProductTestimonial> = {}): ProductTestimonial => ({
  id: "q1",
  product_id: "1",
  quote: "Smells incredible.",
  author: "Sarah",
  location: "Dublin",
  rating: 5,
  ...over,
});

describe("clampRating", () => {
  it("accepts whole ratings in range", () => {
    expect(clampRating(1)).toBe(1);
    expect(clampRating(5)).toBe(5);
    expect(clampRating(3)).toBe(3);
  });

  it("rounds a fractional rating to the nearest whole star", () => {
    expect(clampRating(4.4)).toBe(4);
    expect(clampRating(4.6)).toBe(5);
  });

  it("accepts a numeric string, because admin inputs deliver strings", () => {
    expect(clampRating("4")).toBe(4);
  });

  // The important half. Anything unusable must come back null rather than being
  // coerced to a default — a blank field silently becoming 5 would publish a
  // five-star review nobody left.
  it("refuses anything that is not a usable 1–5 rating", () => {
    expect(clampRating(0)).toBeNull();
    expect(clampRating(6)).toBeNull();
    expect(clampRating(50)).toBeNull();
    expect(clampRating(-2)).toBeNull();
    expect(clampRating("")).toBeNull();
    expect(clampRating(null)).toBeNull();
    expect(clampRating(undefined)).toBeNull();
    expect(clampRating("five")).toBeNull();
    expect(clampRating(NaN)).toBeNull();
  });
});

describe("quotesForProduct", () => {
  it("selects only the quotes pinned to that product", () => {
    const items = [quote({ id: "a", product_id: "1" }), quote({ id: "b", product_id: "2" })];
    expect(quotesForProduct(items, "1").map(q => q.id)).toEqual(["a"]);
  });

  it("compares ids as strings, so a numeric product id still matches", () => {
    const items = [quote({ id: "a", product_id: 1 as unknown as string })];
    expect(quotesForProduct(items, "1")).toHaveLength(1);
  });

  it("drops entries with no quote text — a half-finished admin row", () => {
    const items = [quote({ id: "a", quote: "" }), quote({ id: "b", quote: "   " })];
    expect(quotesForProduct(items, "1")).toHaveLength(0);
  });

  it("preserves the admin's ordering", () => {
    const items = [quote({ id: "a" }), quote({ id: "b" }), quote({ id: "c" })];
    expect(quotesForProduct(items, "1").map(q => q.id)).toEqual(["a", "b", "c"]);
  });

  it("survives content saved before product_items existed", () => {
    expect(quotesForProduct(undefined, "1")).toEqual([]);
  });
});

describe("aggregateRating", () => {
  it("averages the ratings it is given", () => {
    const items = [quote({ rating: 5 }), quote({ rating: 4 })];
    expect(aggregateRating(items)).toEqual({ ratingValue: 4.5, reviewCount: 2 });
  });

  it("rounds to one decimal place, the precision Google shows", () => {
    const items = [quote({ rating: 5 }), quote({ rating: 5 }), quote({ rating: 4 })];
    // 14/3 = 4.666… → 4.7
    expect(aggregateRating(items)?.ratingValue).toBe(4.7);
  });

  // The claim on the page has to be one the shop can stand behind: a quote with
  // no rating is displayed but must not be counted as five stars.
  it("counts only the quotes that carry a usable rating", () => {
    const items = [
      quote({ rating: 4 }),
      quote({ rating: undefined as unknown as number }),
      quote({ rating: 0 }),
    ];
    expect(aggregateRating(items)).toEqual({ ratingValue: 4, reviewCount: 1 });
  });

  it("returns null when nothing is rated, so no aggregateRating is published", () => {
    const items = [quote({ rating: 0 }), quote({ rating: undefined as unknown as number })];
    expect(aggregateRating(items)).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(aggregateRating([])).toBeNull();
  });

  it("never reports a count larger than the quotes on the page", () => {
    const items = [quote({ rating: 5 }), quote({ rating: 99 })];
    const agg = aggregateRating(items);
    expect(agg?.reviewCount).toBeLessThanOrEqual(items.length);
    expect(agg).toEqual({ ratingValue: 5, reviewCount: 1 });
  });
});
