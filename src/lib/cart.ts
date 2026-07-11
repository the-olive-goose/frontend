import type { Product } from "@/lib/defaults";

// Fallback used only until the admin-configured pickupSettings.free_shipping_threshold loads.
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 65;

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
