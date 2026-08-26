import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Product } from "@/lib/defaults";
import { useAuth } from "./AuthContext";
import {
  fetchCart, apiAddToCart, apiUpdateCartItem, apiRemoveCartItem, apiClearCart,
} from "@/lib/userApi";
import { track } from "@/lib/analytics";
import { MAX_CART_QTY, priceToNumber } from "@/lib/cart";
import {
  GUEST_CART_KEY, addGuestItem, clampQty, clearGuestCart, readGuestCart, writeGuestCart,
  type GuestCartItem,
} from "@/lib/guestCart";

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number) => Promise<void>;
  removeFromCart: (productId: string) => Promise<void>;
  updateQuantity: (productId: string, quantity: number) => Promise<void>;
  clearCart: () => Promise<void>;
  count: number;
  total: string;
}

const CartContext = createContext<CartContextType | null>(null);

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
};

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading } = useAuth();
  // Seeded from the guest basket so a returning visitor sees their items in the
  // very first paint, before /me has said whether they're signed in.
  const [items, setItems] = useState<CartItem[]>(() => readGuestCart());

  // The guest basket's synchronous source of truth. Callers add several products
  // in a tight `for (const p of bundle) await addToCart(p)` loop, and reading
  // `items` inside that loop would read the same pre-loop snapshot every pass —
  // only the last add would survive. This ref is updated before the await returns.
  const guestRef = useRef<GuestCartItem[]>(items);

  // The account id whose merge has already been claimed — see the effect below.
  const mergedForRef = useRef<string | null>(null);

  const setGuestItems = (update: (prev: GuestCartItem[]) => GuestCartItem[]) => {
    const next = update(guestRef.current);
    guestRef.current = next;
    writeGuestCart(next);
    setItems(next);
  };

  // Signed out → the localStorage basket. Signed in → the server basket, with
  // anything collected while signed out merged into it first (that merge is the
  // whole point of letting people shop before they have an account).
  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      // Signing out re-arms the merge: whatever this shopper collects from here
      // is a new guest basket, and it must follow them back in.
      mergedForRef.current = null;
      const guest = readGuestCart();
      guestRef.current = guest;
      setItems(guest);
      return;
    }

    let alive = true;
    (async () => {
      const guest = mergedForRef.current === user.id
        ? []
        : guestRef.current.length ? guestRef.current : readGuestCart();
      if (guest.length) {
        // Claimed before the first await: this effect can run twice for one
        // sign-in (StrictMode in dev, an auth revalidation in production), and
        // two passes reading the same basket would add every item twice.
        mergedForRef.current = user.id;
        try {
          for (const g of guest) await apiAddToCart(g.product.id, g.product, g.quantity);
          // Cleared only once every item is safely on the account, so a failed
          // merge leaves the basket in localStorage to retry rather than losing it.
          guestRef.current = [];
          clearGuestCart();
        } catch {
          // Keep the guest copy AND release the claim, so the next sign-in (or
          // reload) retries the merge rather than stranding the basket locally.
          mergedForRef.current = null;
        }
      }
      const rows = await fetchCart().catch(() => null);
      if (!alive || !rows) return;
      setItems(rows.map(r => ({
        product:  r.product_data as unknown as Product,
        quantity: r.quantity,
      })));
    })();
    return () => { alive = false; };
  }, [user?.id, authLoading]);

  // Another tab shopping while signed out changes the same localStorage basket —
  // without this, two open tabs would disagree about what's in it.
  useEffect(() => {
    if (user) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== GUEST_CART_KEY) return;
      const guest = readGuestCart();
      guestRef.current = guest;
      setItems(guest);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user?.id]);

  // `quantity` lets the product page add a chosen amount in one call. The backend
  // caps the stored total at MAX_CART_QTY, so mirror that ceiling locally too.
  const addToCart = async (product: Product, quantity = 1) => {
    const qty = clampQty(quantity);
    const analytics = { product_id: product.id, name: product.name, price: priceToNumber(product.price), quantity: qty };

    if (!user) {
      setGuestItems(prev => addGuestItem(prev, product, qty));
      // Guest adds are real adds: counting only signed-in ones would have hidden
      // most of the funnel now that the basket comes before the account.
      track("add_to_cart", analytics);
      return;
    }

    await apiAddToCart(product.id, product, qty);
    track("add_to_cart", analytics);
    setItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) {
        return prev.map(i => i.product.id === product.id
          ? { ...i, quantity: Math.min(i.quantity + qty, MAX_CART_QTY) }
          : i);
      }
      return [...prev, { product, quantity: qty }];
    });
  };

  const removeFromCart = async (productId: string) => {
    // Read the line before it is removed. The id alone was enough for our own
    // reports (they join back to the catalogue), but an event that leaves the
    // browser has to carry what it means: without the name and price, GA4's
    // item report lists the removal under a raw product id and can put no value
    // on what was abandoned.
    const removed = items.find(i => i.product.id === productId);
    const analytics = removed
      ? { product_id: productId, name: removed.product.name, price: priceToNumber(removed.product.price), quantity: removed.quantity }
      : { product_id: productId };

    if (!user) {
      setGuestItems(prev => prev.filter(i => i.product.id !== productId));
      track("remove_from_cart", analytics);
      return;
    }
    await apiRemoveCartItem(productId);
    track("remove_from_cart", analytics);
    setItems(prev => prev.filter(i => i.product.id !== productId));
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity <= 0) { await removeFromCart(productId); return; }
    const qty = clampQty(quantity);
    if (!user) {
      setGuestItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: qty } : i));
      return;
    }
    await apiUpdateCartItem(productId, qty);
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: qty } : i));
  };

  const clearCart = async () => {
    if (!user) { setGuestItems(() => []); return; }
    await apiClearCart();
    setItems([]);
  };

  const count = items.reduce((s, i) => s + i.quantity, 0);
  const total = (() => {
    const sum = items.reduce((acc, i) => {
      const n = parseFloat(i.product.price.replace(/[^0-9.]/g, ""));
      return acc + (isNaN(n) ? 0 : n * i.quantity);
    }, 0);
    return `€${sum.toFixed(2)}`;
  })();

  return (
    <CartContext.Provider value={{ items, addToCart, removeFromCart, updateQuantity, clearCart, count, total }}>
      {children}
    </CartContext.Provider>
  );
};
