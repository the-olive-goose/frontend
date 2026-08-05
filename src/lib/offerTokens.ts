import { DEFAULT_FLAT_SHIPPING_RATE, DEFAULT_FREE_SHIPPING_THRESHOLD } from "@/lib/cart";
import type { PickupSettingsContent, ReturnPolicyContent, SubscribePopupContent } from "@/lib/defaults";

/** Fallback returns window, used only until the admin-set one loads. */
export const DEFAULT_RETURNS_WINDOW_DAYS = 30;

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
  /** Flat delivery charge below the threshold, in euro. 0 means delivery is always free. */
  flatShippingRate: number;
  /** Percent off carried by a welcome/subscriber code. */
  welcomeDiscountPercent: number;
  /** Days a shopper has to start a return, from Return Policy. */
  returnsWindowDays: number;
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
  pickup?: Partial<Pick<PickupSettingsContent, "free_shipping_threshold" | "flat_shipping_rate">>,
  popup?: Partial<Pick<SubscribePopupContent, "discount_percent">>,
  returnPolicy?: Partial<Pick<ReturnPolicyContent, "window_days">>,
): OfferValues => {
  const threshold = Number(pickup?.free_shipping_threshold);
  const rate = Number(pickup?.flat_shipping_rate);
  const percent = Number(popup?.discount_percent);
  const days = Number(returnPolicy?.window_days);
  return {
    freeShippingThreshold: Number.isFinite(threshold) ? threshold : DEFAULT_FREE_SHIPPING_THRESHOLD,
    flatShippingRate: Number.isFinite(rate) ? rate : DEFAULT_FLAT_SHIPPING_RATE,
    welcomeDiscountPercent: Number.isFinite(percent) ? percent : 0,
    returnsWindowDays: Number.isFinite(days) ? days : DEFAULT_RETURNS_WINDOW_DAYS,
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
 * What delivery actually costs, in one line, phrased for the settings in force.
 *
 * Both halves of the answer live in Ops → Pickup & Delivery: the flat rate is
 * what checkout adds below the bar, the threshold is where it stops charging.
 * Quoting only one of them is how a product page ends up saying "€4.99 shipping"
 * on a shop that ships everything free. A rate of 0, or a threshold of 0, both
 * mean nothing is ever charged — so they get the same wording, not a "€0.00".
 */
/** "30 days", "1 day" — the returns window, in words that agree with the number. */
export const returnsWindowClause = (days: number): string =>
  `${days} ${days === 1 ? "day" : "days"}`;

export const shippingCostClause = (rate: number, threshold: number): string =>
  rate <= 0 || threshold <= 0
    ? "Free shipping on all orders"
    : `${euro(rate)} shipping — free ${freeShippingClause(threshold)}`;

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
 *   {shipping_rate}             → "€4.99"        (flat delivery charge)
 *   {shipping_cost}             → "€4.99 shipping — free on orders over €50"
 *   {returns_days}              → "30"           (returns window, bare number)
 *   {returns_window}            → "30 days"
 *
 * Unknown tokens are left untouched so a typo shows up as itself in the copy
 * rather than vanishing silently.
 *
 * `{free_shipping_threshold}` is replaced before `{free_shipping}` so the longer
 * token wins; the same ordering applies to `{shipping_rate}` vs `{shipping_cost}`
 * — they share no prefix, but keeping the pattern makes that fact deliberate.
 */
export const fillOfferTokens = (text: string | undefined, values: OfferValues): string =>
  fillDiscountToken(text, values.welcomeDiscountPercent)
    .split("{free_shipping_threshold}").join(euro(values.freeShippingThreshold))
    .split("{free_shipping}").join(freeShippingClause(values.freeShippingThreshold))
    .split("{shipping_rate}").join(euro(values.flatShippingRate))
    .split("{shipping_cost}").join(shippingCostClause(values.flatShippingRate, values.freeShippingThreshold))
    .split("{returns_window}").join(returnsWindowClause(values.returnsWindowDays))
    .split("{returns_days}").join(String(values.returnsWindowDays));
