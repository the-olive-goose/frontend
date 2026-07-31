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

// Normalize a stored price (e.g. "$38", "38", "€38.00") to euro for display.
// Admins can enter a plain number; the storefront always shows the € symbol.
export const formatPrice = (price: string | number | null | undefined): string => {
  if (price == null) return "";
  const match = String(price).match(/[0-9]+(?:[.,][0-9]+)?/);
  return match ? `€${match[0]}` : String(price);
};

export const cartSubtotal = (items: Array<{ product: Product; quantity: number }>): number =>
  items.reduce((acc, i) => {
    const n = parseFloat(i.product.price.replace(/[^0-9.]/g, ""));
    return acc + (isNaN(n) ? 0 : n * i.quantity);
  }, 0);
