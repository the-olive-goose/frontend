import type { Product } from "@/lib/defaults";
import { MAX_CART_QTY } from "@/lib/cart";

/**
 * The basket of a shopper who hasn't signed in.
 *
 * Every other e-commerce site lets you fill a basket first and asks who you are
 * at checkout; this site used to demand a sign-in on the very first "Add to
 * Cart", which is the single biggest reason a first-time visitor leaves. So the
 * cart now has two backings: this localStorage copy while signed out, and the
 * server cart once signed in. `CartContext` picks between them and merges the
 * guest copy into the account on sign-in.
 *
 * localStorage (not sessionStorage) so a basket survives a closed tab, and every
 * access is wrapped: Safari private mode and storage-blocked browsers throw on
 * read as well as write, and a thrown basket must degrade to "empty for this
 * page load", never to a crashed storefront.
 */

export const GUEST_CART_KEY = "og_guest_cart";

export interface GuestCartItem {
  product: Product;
  quantity: number;
}

/** Clamp to the same 1..MAX_CART_QTY window the backend enforces. */
export const clampQty = (quantity: number): number =>
  Math.min(Math.max(Math.trunc(quantity) || 1, 1), MAX_CART_QTY);

// Anything can be in localStorage — a half-written value, a key from an older
// build, something a person typed into devtools. Rows that don't carry the
// fields the basket renders (id, name, price) are dropped rather than allowed to
// reach a `.replace()` on undefined further down.
const isUsableRow = (row: unknown): row is GuestCartItem => {
  if (!row || typeof row !== "object") return false;
  const { product, quantity } = row as GuestCartItem;
  return (
    !!product &&
    typeof product === "object" &&
    typeof product.id === "string" &&
    product.id.length > 0 &&
    typeof product.name === "string" &&
    typeof product.price === "string" &&
    typeof quantity === "number" &&
    Number.isFinite(quantity) &&
    quantity > 0
  );
};

export const readGuestCart = (): GuestCartItem[] => {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isUsableRow)
      .map(row => ({ product: row.product, quantity: clampQty(row.quantity) }));
  } catch {
    return [];
  }
};

export const writeGuestCart = (items: GuestCartItem[]) => {
  try {
    if (items.length === 0) localStorage.removeItem(GUEST_CART_KEY);
    else localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — the basket still works for this page load */
  }
};

export const clearGuestCart = () => writeGuestCart([]);

/** Add (or top up) one product, capped like the server would cap it. */
export const addGuestItem = (
  items: GuestCartItem[],
  product: Product,
  quantity = 1,
): GuestCartItem[] => {
  const qty = clampQty(quantity);
  const existing = items.find(i => i.product.id === product.id);
  if (!existing) return [...items, { product, quantity: qty }];
  return items.map(i =>
    i.product.id === product.id
      // Re-adding also refreshes the stored product snapshot, so a price or image
      // the admin changed since the first add doesn't linger in the basket.
      ? { product, quantity: clampQty(Math.min(i.quantity + qty, MAX_CART_QTY)) }
      : i,
  );
};
