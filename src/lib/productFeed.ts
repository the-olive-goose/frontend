// Storefront-side mirror of the feed's inclusion rules.
//
// The feed document is built by the API (backend/productFeed.js) — it has to be,
// because Google and Meta fetch /feed.xml directly and never run the app's code.
// But Admin → Ops → Product Feed has to show which products will actually be
// sent *before* anything is published, and the admin can't import the backend's
// plain JS (tsconfig covers `src` only).
//
// So the rules exist twice, the same arrangement as addressValidation.ts and
// computeBundleSavings. Duplication like that drifts silently — here the cost of
// drift is an admin who is told three candles are going out while the feed sends
// two, and who then spends a week arguing with Merchant Center diagnostics.
// src/lib/productFeed.test.ts pins the two together.
//
// Keep in sync with backend/productFeed.js.

import type { Product, ProductFeedContent } from "@/lib/defaults";

/** "€24.00" / "24" / 24 → 24. Same permissive parse as src/lib/products.ts. */
export const feedPriceValue = (price: string | number | null | undefined): number => {
  const n = parseFloat(String(price ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Explicit 0 blocks purchase; undefined/null means "not tracked". */
export const feedOutOfStock = (product: Product): boolean =>
  product.stock !== undefined && product.stock !== null && Number(product.stock) <= 0;

/**
 * Why a product would be left out of the feed, or null if it goes in.
 *
 * The wording is the admin-facing explanation, so it says what to do about it
 * rather than naming the field that failed.
 */
export const feedExcludeReason = (
  product: Product,
  settings: Pick<ProductFeedContent, "include_out_of_stock">,
): string | null => {
  if (!String(product.name || "").trim()) return "No name";
  if (feedPriceValue(product.price) <= 0) return "No price";
  if (!/^https?:\/\//i.test(String(product.image_url || "").trim()))
    return "No image, or the image URL is not a full https:// address";
  if (!settings.include_out_of_stock && feedOutOfStock(product)) return "Out of stock";
  return null;
};

export interface FeedPartition {
  included: Product[];
  excluded: Array<{ product: Product; reason: string }>;
}

/** Split the catalogue into what the feed will carry and what it will not. */
export const partitionFeedProducts = (
  products: Product[],
  settings: Pick<ProductFeedContent, "include_out_of_stock">,
): FeedPartition => {
  const included: Product[] = [];
  const excluded: Array<{ product: Product; reason: string }> = [];
  for (const product of products || []) {
    const reason = feedExcludeReason(product, settings);
    if (reason) excluded.push({ product, reason });
    else included.push(product);
  }
  return { included, excluded };
};
