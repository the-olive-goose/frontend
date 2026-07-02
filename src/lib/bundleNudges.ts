import type { Bundle, Product } from "@/lib/defaults";

export interface BundleNudge {
  bundle: Bundle;
  owned: Product[];
  missing: Product[];
  savings: number;      // € saved once the bundle is completed
  missingCost: number;  // € the customer still has to spend to unlock it
  value: number;        // savings per € spent finishing the bundle — "deal density"
}

const priceOf = (p: Product): number => {
  const n = parseFloat(p.price.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
};

/**
 * Ranks "almost-complete" deals bundles by how compelling they are to act on right now:
 *   1. Fewest items still needed — completing a bundle with one add is far more likely
 *      to convert than one still missing three, regardless of the discount size.
 *   2. Highest savings-per-euro still to spend ("value") — among equally-close bundles,
 *      surface the one where finishing it is objectively the best deal.
 *   3. Highest absolute savings — final tie-break.
 * Bundles the customer hasn't started (none of their items owned) are excluded here;
 * those belong on the Deals page as something to discover, not a checkout nudge.
 */
export const getBundleNudges = (
  bundles: Bundle[],
  items: Array<{ product: Product; quantity: number }>,
  allProducts: Product[],
  limit = 2
): BundleNudge[] => {
  const inCart = (id: string) => items.some(i => i.product.id === id);
  const findProduct = (id: string) => allProducts.find(p => p.id === id);

  const candidates: BundleNudge[] = [];
  for (const bundle of bundles) {
    if (!bundle.is_active || bundle.product_ids.length < 2) continue;

    const owned: Product[] = [];
    const missing: Product[] = [];
    for (const id of bundle.product_ids) {
      const product = findProduct(id);
      if (!product) continue; // deal references a product that no longer exists — skip it
      (inCart(id) ? owned : missing).push(product);
    }
    if (owned.length === 0 || missing.length === 0) continue;

    const bundleTotal = [...owned, ...missing].reduce((s, p) => s + priceOf(p), 0);
    const savings = bundle.discount_type === "percentage"
      ? bundleTotal * (bundle.discount_value / 100)
      : bundle.discount_value;
    const missingCost = missing.reduce((s, p) => s + priceOf(p), 0);
    const value = missingCost > 0 ? savings / missingCost : savings;

    candidates.push({ bundle, owned, missing, savings, missingCost, value });
  }

  return candidates
    .sort((a, b) =>
      a.missing.length !== b.missing.length ? a.missing.length - b.missing.length
      : b.value !== a.value ? b.value - a.value
      : b.savings - a.savings
    )
    .slice(0, limit);
};
