import type { Bundle, Product } from "@/lib/defaults";

/**
 * Single source of truth for Today's Deals bundle savings.
 *
 * Bundles can share candles (e.g. "Classics Duo" and "Café Trio" both include the
 * Matcha), so a basket can satisfy several bundles at once. To avoid stacking the
 * discount on the same candle, every product UNIT counts toward at most one bundle.
 * We greedily apply the highest-value bundle instance we can still form from the
 * unclaimed units, consume those units, and repeat — which for pair/triple bundle
 * shapes yields the best-value non-overlapping set and also handles multi-quantity
 * baskets (a bundle can apply more than once when there are enough units).
 *
 * IMPORTANT: the backend re-derives the charged discount with the exact same
 * algorithm (see `computeBundleSavings` in backend/index.js). Keep the two in sync
 * — including the deterministic bundle ordering below — so the saving shown in the
 * basket/checkout always matches what Stripe actually charges.
 */

export interface BundleCartItem {
  product: Pick<Product, "id" | "price">;
  quantity: number;
}

export interface AppliedBundle {
  bundle: Bundle;
  /** How many times this bundle was formed from the basket's units. */
  instances: number;
  /** Total € saved from this bundle across all its instances. */
  savings: number;
}

export interface BundleSavingsResult {
  applied: AppliedBundle[];
  totalSavings: number;
}

const parsePrice = (price: string | undefined): number => {
  const n = parseFloat(String(price ?? "").replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
};

/**
 * @param validProductIds  Ids of products that currently exist in the catalogue.
 *   When supplied, each bundle is resolved against it and ids that no longer exist
 *   are ignored (see `effectiveIds`). Pass the live product list so a stale id can't
 *   silently kill a discount. Omit only where the catalogue isn't available yet.
 */
export function computeBundleSavings(
  bundles: Bundle[],
  items: BundleCartItem[],
  validProductIds?: Iterable<string>,
): BundleSavingsResult {
  const remaining = new Map<string, number>();
  const price = new Map<string, number>();
  for (const i of items) {
    remaining.set(i.product.id, (remaining.get(i.product.id) ?? 0) + i.quantity);
    price.set(i.product.id, parsePrice(i.product.price));
  }

  // A bundle can accumulate orphaned product_ids once a product is deleted from the
  // catalogue. Such an id can never be in a cart, so requiring it would silently kill
  // the discount forever (this is exactly the "Classics Duo never applies" bug). When
  // the live catalogue is known, resolve each bundle against it and drop ids that no
  // longer exist — matching what the storefront already displays for that bundle.
  const catalog = validProductIds ? new Set(validProductIds) : null;
  const effectiveIds = (b: Bundle): string[] =>
    catalog && catalog.size > 0 ? b.product_ids.filter(pid => catalog.has(pid)) : (b.product_ids ?? []);

  const active = bundles
    .filter(b => b.is_active && effectiveIds(b).length > 0)
    .sort((a, b) => (a.display_order - b.display_order) || String(a.id).localeCompare(String(b.id)));

  // One instance = one unit of each (surviving) product in the bundle.
  const instanceSaving = (ids: string[], b: Bundle): number => {
    const base = ids.reduce((s, pid) => s + (price.get(pid) ?? 0), 0);
    return b.discount_type === "percentage" ? base * (b.discount_value / 100) : b.discount_value;
  };

  const applied = new Map<string, AppliedBundle>();
  let totalSavings = 0;

  for (;;) {
    let best: Bundle | null = null;
    let bestIds: string[] = [];
    let bestSaving = 0;
    for (const b of active) {
      const ids = effectiveIds(b);
      if (ids.every(pid => (remaining.get(pid) ?? 0) >= 1)) {
        const sv = instanceSaving(ids, b);
        if (sv > bestSaving) { bestSaving = sv; best = b; bestIds = ids; }
      }
    }
    if (!best || bestSaving <= 0) break;

    for (const pid of bestIds) remaining.set(pid, (remaining.get(pid) ?? 0) - 1);
    totalSavings += bestSaving;
    const rec = applied.get(best.id) ?? { bundle: best, instances: 0, savings: 0 };
    rec.instances += 1;
    rec.savings += bestSaving;
    applied.set(best.id, rec);
  }

  return { applied: [...applied.values()], totalSavings };
}
