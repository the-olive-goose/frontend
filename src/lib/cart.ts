import type { Product } from "@/lib/defaults";

// Mirrors MAX_CART_QTY in backend/index.js — the server rejects anything higher,
// so the UI caps quantity pickers and optimistic cart updates at the same value.
export const MAX_CART_QTY = 99;

// Fallback used only until the admin-configured pickupSettings.free_shipping_threshold loads.
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 65;

// Mirrors MIN_CHARGE_EUR in backend/index.js — Stripe won't create a Checkout
// Session below this total, so checkout says so up front rather than sending the
// shopper to a payment page that can't exist. Most visible on pickup, which drops
// the shipping line that otherwise keeps a cheap basket above the floor.
export const MIN_CHARGE_EUR = 0.5;

// Normalize a stored price (e.g. "$38", "38", "€38.00", "38,50") to euro for display.
// Admins can enter a plain number; the storefront always shows the € symbol.
//
// Cents are padded to two digits. The old version echoed the admin's raw digits
// back, so a price saved as "0.3" rendered as "€0.3" on every card, in the basket
// and at checkout, while the bundle maths beside it printed "€20.30" from
// toFixed(2) — the same basket showing prices in two different shapes. Whole euro
// stays unpadded ("€20", not "€20.00"): that is the convention `euro()` in
// offerTokens.ts already uses for offer copy, and this now matches it.
export const formatPrice = (price: string | number | null | undefined): string => {
  if (price == null) return "";
  const match = String(price).match(/[0-9]+(?:[.,][0-9]+)?/);
  if (!match) return String(price);
  // Commas are decimal separators here, not thousands: the regex stops at the
  // first separator, so "38,50" arrives whole but "1,299" would already have been
  // truncated to "1,2" before this point either way.
  const n = Number(match[0].replace(",", "."));
  if (!Number.isFinite(n)) return `€${match[0]}`;
  return `€${Number.isInteger(n) ? n : n.toFixed(2)}`;
};

export const cartSubtotal = (items: Array<{ product: Product; quantity: number }>): number =>
  items.reduce((acc, i) => {
    const n = parseFloat(i.product.price.replace(/[^0-9.]/g, ""));
    return acc + (isNaN(n) ? 0 : n * i.quantity);
  }, 0);
