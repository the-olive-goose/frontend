import { describe, it, expect } from "vitest";
import { computeBundleSavings, type BundleCartItem } from "@/lib/bundleSavings";
import type { Bundle } from "@/lib/defaults";

// Mirrors the live Today's Deals catalogue: three overlapping €20 candles.
const bundle = (over: Partial<Bundle> & Pick<Bundle, "id" | "product_ids" | "discount_type" | "discount_value" | "display_order">): Bundle => ({
  name: over.id,
  description: "",
  is_active: true,
  ...over,
});

const CLASSICS = bundle({ id: "classics", product_ids: ["matcha", "coffee"], discount_type: "percentage", discount_value: 10, display_order: 0 });
const MATCHA_BERRY = bundle({ id: "matcha-berry", product_ids: ["matcha", "berry"], discount_type: "percentage", discount_value: 10, display_order: 1 });
const BERRY_BREW = bundle({ id: "berry-brew", product_ids: ["coffee", "berry"], discount_type: "percentage", discount_value: 10, display_order: 2 });
const TRIO = bundle({ id: "trio", product_ids: ["matcha", "coffee", "berry"], discount_type: "percentage", discount_value: 15, display_order: 3 });
const ALL = [CLASSICS, MATCHA_BERRY, BERRY_BREW, TRIO];

const items = (counts: Record<string, number>): BundleCartItem[] =>
  Object.entries(counts).map(([id, quantity]) => ({ product: { id, price: "€20" }, quantity }));

// The live catalogue: only matcha / coffee / berry exist.
const CATALOG = ["matcha", "coffee", "berry"];

describe("computeBundleSavings", () => {
  it("does not stack overlapping bundles (the bug): one of each candle → best single bundle only", () => {
    const { applied, totalSavings } = computeBundleSavings(ALL, items({ matcha: 1, coffee: 1, berry: 1 }));
    // Trio (15% of €60 = €9) beats any duo (10% of €40 = €4) and consumes all units,
    // so the naive stacked total of €21 must NOT happen.
    expect(totalSavings).toBeCloseTo(9, 2);
    expect(applied).toHaveLength(1);
    expect(applied[0].bundle.id).toBe("trio");
    expect(applied[0].instances).toBe(1);
  });

  it("applies a bundle more than once for multi-quantity baskets", () => {
    const { applied, totalSavings } = computeBundleSavings(ALL, items({ matcha: 2, coffee: 2, berry: 2 }));
    expect(totalSavings).toBeCloseTo(18, 2); // Trio ×2
    expect(applied).toHaveLength(1);
    expect(applied[0].instances).toBe(2);
    expect(applied[0].savings).toBeCloseTo(18, 2);
  });

  it("uses leftover units for a second, different bundle once the best one is exhausted", () => {
    // 2 matcha + 2 coffee + 1 berry: Trio consumes m/c/b once (€9), leaving 1 matcha
    // + 1 coffee → Classics Duo (€4). Total €13, each unit counted once.
    const { totalSavings, applied } = computeBundleSavings(ALL, items({ matcha: 2, coffee: 2, berry: 1 }));
    expect(totalSavings).toBeCloseTo(13, 2);
    expect(applied.map(a => a.bundle.id).sort()).toEqual(["classics", "trio"]);
  });

  it("falls back to a duo when the trio can't be formed", () => {
    const { totalSavings, applied } = computeBundleSavings(ALL, items({ matcha: 1, coffee: 1 }));
    expect(totalSavings).toBeCloseTo(4, 2);
    expect(applied).toHaveLength(1);
    expect(applied[0].bundle.id).toBe("classics");
  });

  it("supports fixed-amount bundles per instance", () => {
    const fixed = bundle({ id: "fixed", product_ids: ["matcha", "coffee"], discount_type: "fixed", discount_value: 5, display_order: 0 });
    const { totalSavings } = computeBundleSavings([fixed], items({ matcha: 2, coffee: 2 }));
    expect(totalSavings).toBeCloseTo(10, 2); // €5 off ×2
  });

  it("ignores inactive bundles and empty baskets", () => {
    expect(computeBundleSavings([{ ...TRIO, is_active: false }], items({ matcha: 1, coffee: 1, berry: 1 })).totalSavings).toBe(0);
    expect(computeBundleSavings(ALL, []).totalSavings).toBe(0);
  });

  it("applies a bundle on its surviving candles when a product_id is orphaned (the live bug)", () => {
    // "Classics Duo" as stored live: matcha + a deleted product + coffee. With the
    // catalogue supplied, the phantom id is ignored and the duo discounts on matcha
    // + coffee. Without a catalogue it can never apply (old, broken behaviour).
    const classicsWithOrphan = bundle({
      id: "classics", product_ids: ["matcha", "1778327729472", "coffee"],
      discount_type: "percentage", discount_value: 10, display_order: 0,
    });
    const basket = items({ matcha: 1, coffee: 1 });

    expect(computeBundleSavings([classicsWithOrphan], basket).totalSavings).toBe(0);
    expect(computeBundleSavings([classicsWithOrphan], basket, CATALOG).totalSavings).toBeCloseTo(4, 2);
  });

  it("skips a bundle whose products are all orphaned", () => {
    const dead = bundle({ id: "dead", product_ids: ["ghost-a", "ghost-b"], discount_type: "percentage", discount_value: 10, display_order: 0 });
    expect(computeBundleSavings([dead], items({ matcha: 1, coffee: 1 }), CATALOG).totalSavings).toBe(0);
  });
});
