/**
 * The discount code a shopper has applied at checkout, remembered across page
 * loads.
 *
 * It used to live only in CheckoutPage's React state, which meant it vanished
 * on any remount — going back to the basket to fix a quantity, a reload, or
 * pressing back from Stripe's payment page. The summary silently returned to
 * full price, and a shopper who didn't re-read it paid full price for an order
 * they thought was discounted. That is the worst possible failure mode for a
 * discount, so the applied code is persisted here instead.
 *
 * Storage is a cache, never the authority: checkout re-validates the restored
 * code against the server on every mount and drops it if it no longer applies
 * (spent, deactivated, or belonging to a different account on a shared device).
 * localStorage — matching the guest basket — so it survives a closed tab, and
 * every access is wrapped: Safari private mode and storage-blocked browsers
 * throw on read as well as write, and that must degrade to "no code remembered",
 * never to a checkout page that won't render.
 */

export const APPLIED_DISCOUNT_KEY = "og_applied_discount";

export interface AppliedDiscount {
  code: string;
  type: "percentage" | "fixed";
  value: number;
}

// Anything can be in localStorage — a half-written value, a key from an older
// build, something typed into devtools. A row that doesn't carry a usable code
// and a finite positive value is dropped rather than allowed to reach the order
// summary, where it would render as "NaN off" or a €0 line.
const isUsable = (row: unknown): row is AppliedDiscount => {
  if (!row || typeof row !== "object") return false;
  const { code, type, value } = row as AppliedDiscount;
  return (
    typeof code === "string" &&
    code.trim().length > 0 &&
    (type === "percentage" || type === "fixed") &&
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
};

export const readAppliedDiscount = (): AppliedDiscount | null => {
  try {
    const raw = localStorage.getItem(APPLIED_DISCOUNT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isUsable(parsed)) return null;
    return { code: parsed.code.trim().toUpperCase(), type: parsed.type, value: parsed.value };
  } catch {
    return null;
  }
};

export const writeAppliedDiscount = (applied: AppliedDiscount | null) => {
  try {
    if (!applied) localStorage.removeItem(APPLIED_DISCOUNT_KEY);
    else localStorage.setItem(APPLIED_DISCOUNT_KEY, JSON.stringify(applied));
  } catch {
    /* storage unavailable — the code still works for this page load */
  }
};

export const clearAppliedDiscount = () => writeAppliedDiscount(null);
