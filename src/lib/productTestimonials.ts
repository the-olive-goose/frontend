/**
 * Rating maths for the curated quotes on a product page.
 *
 * This lives in its own module because the same numbers are printed twice —
 * once as stars a visitor can see, once as `aggregateRating` in the page's
 * structured data — and Google's review-snippet policy requires those two to
 * agree. Keeping one implementation is what makes them agree by construction
 * rather than by somebody remembering.
 *
 * @see src/components/ProductTestimonials.tsx — the visible half
 * @see src/pages/ProductDetailPage.tsx — the structured-data half
 */
import type { ProductTestimonial } from "./defaults";

/**
 * A rating fit to publish, or `null` when there isn't one.
 *
 * Ratings come from an admin number input, so this has to survive a blank field,
 * a pasted string and a typo'd 50. Anything that isn't a whole 1–5 is refused
 * rather than coerced: rounding a bad value to 5 would invent a five-star review,
 * which is the one failure mode worth being strict about here.
 */
export const clampRating = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
};

/** The quotes belonging to one product, in the order the admin arranged them. */
export const quotesForProduct = (
  items: ProductTestimonial[] | undefined,
  productId: string,
): ProductTestimonial[] =>
  (items ?? []).filter(
    t => String(t.product_id) === String(productId) && (t.quote ?? "").trim() !== "",
  );

/**
 * The aggregate to publish, or `null` when there is nothing honest to publish.
 *
 * Averaged over ONLY the quotes carrying a usable rating — not over every quote
 * on the page. An admin who adds a testimonial and leaves the rating blank gets
 * that quote displayed and left out of the average, rather than counted as five
 * stars they never gave.
 */
export const aggregateRating = (
  items: ProductTestimonial[],
): { ratingValue: number; reviewCount: number } | null => {
  const ratings = items.map(t => clampRating(t.rating)).filter((n): n is number => n !== null);
  if (ratings.length === 0) return null;
  const mean = ratings.reduce((sum, n) => sum + n, 0) / ratings.length;
  return {
    // One decimal place, the precision Google displays. Rounded rather than
    // truncated so 4.75 reads as 4.8, matching what the stars suggest.
    ratingValue: Math.round(mean * 10) / 10,
    reviewCount: ratings.length,
  };
};
