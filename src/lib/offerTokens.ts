import { DEFAULT_FREE_SHIPPING_THRESHOLD } from "@/lib/cart";
import type { PickupSettingsContent, SubscribePopupContent } from "@/lib/defaults";

/**
 * Marketing copy that quotes an offer must never hardcode the number.
 *
 * The free-shipping bar and the welcome discount are both admin-configurable
 * (Ops → Pickup & Delivery, and Subscribers & Signup Popup). Any copy that
 * spells the figure out in literal text — an announcement bar message, a policy
 * page body — silently becomes a lie the moment an admin changes the setting.
 * That is not hypothetical: production shipped a banner promising "free shipping
 * over €50" while the threshold was 0 (everything shipped free) and a policy page
 * claiming €65, alongside a banner promising "10% off your first order" while the
 * popup was configured to issue 5%.
 *
 * So copy embeds a TOKEN and this module resolves it against the live settings.
 * The figure shown to a customer then cannot disagree with the figure the
 * checkout actually applies.
 */

export interface OfferValues {
  /** Admin-configured free-shipping threshold, in euro. 0 means everything ships free. */
  freeShippingThreshold: number;
  /** Percent off carried by a welcome/subscriber code. */
  welcomeDiscountPercent: number;
}

/** "€50" for whole euro, "€49.99" when there are cents. */
const euro = (n: number): string => `€${Number.isInteger(n) ? n : n.toFixed(2)}`;

/**
 * Read the live offer figures out of the two content sections that own them.
 *
 * Uses Number.isFinite rather than `||` throughout: a threshold of 0 is a real,
 * meaningful setting ("free shipping on everything") and `|| 65` would quietly
 * reinstate a €65 bar in the copy while checkout charged nothing — the exact
 * mismatch this module exists to prevent. Same reasoning as the backend's own
 * threshold handling in backend/index.js.
 */
export const resolveOfferValues = (
  pickup?: Partial<Pick<PickupSettingsContent, "free_shipping_threshold">>,
  popup?: Partial<Pick<SubscribePopupContent, "discount_percent">>,
): OfferValues => {
  const threshold = Number(pickup?.free_shipping_threshold);
  const percent = Number(popup?.discount_percent);
  return {
    freeShippingThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_FREE_SHIPPING_THRESHOLD,
    welcomeDiscountPercent: Number.isFinite(percent) ? percent : 0,
  };
};

/**
 * The qualifying clause for free shipping, phrased for the threshold in force.
 *
 * A threshold of 0 needs different words, not a different number — "on orders
 * over €0" is technically true and reads as broken. Hence a token that carries
 * the whole clause rather than just the figure.
 */
export const freeShippingClause = (threshold: number): string =>
  threshold <= 0 ? "on all orders" : `on orders over ${euro(threshold)}`;

/**
 * Substitute just `{discount}` → the welcome percent.
 *
 * Split out for callers that legitimately know the discount percent but not the
 * shipping threshold — the signup popup owns its own percent and has no business
 * fetching pickup settings. It must not resolve the shipping tokens with a
 * fallback figure, because a plausible-but-wrong number is exactly the failure
 * this module prevents; leaving them unsubstituted is the honest outcome.
 */
export const fillDiscountToken = (text: string | undefined, percent: number): string =>
  text ? text.split("{discount}").join(String(percent)) : "";

/**
 * Substitute offer tokens in a copy string.
 *
 *   {discount}                  → "5"            (welcome discount percent)
 *   {free_shipping_threshold}   → "€50"          (formatted threshold)
 *   {free_shipping}             → "on orders over €50" / "on all orders"
 *
 * Unknown tokens are left untouched so a typo shows up as itself in the copy
 * rather than vanishing silently.
 */
export const fillOfferTokens = (text: string | undefined, values: OfferValues): string =>
  fillDiscountToken(text, values.welcomeDiscountPercent)
    .split("{free_shipping_threshold}").join(euro(values.freeShippingThreshold))
    .split("{free_shipping}").join(freeShippingClause(values.freeShippingThreshold));
