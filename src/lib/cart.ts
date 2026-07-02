import type { Product } from "@/lib/defaults";

// Fallback used only until the admin-configured pickupSettings.free_shipping_threshold loads.
export const DEFAULT_FREE_SHIPPING_THRESHOLD = 65;

export const cartSubtotal = (items: Array<{ product: Product; quantity: number }>): number =>
  items.reduce((acc, i) => {
    const n = parseFloat(i.product.price.replace(/[^0-9.]/g, ""));
    return acc + (isNaN(n) ? 0 : n * i.quantity);
  }, 0);
