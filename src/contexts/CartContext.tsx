import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { Product } from "@/lib/defaults";
import { useAuth } from "./AuthContext";
import {
  fetchCart, apiAddToCart, apiUpdateCartItem, apiRemoveCartItem, apiClearCart,
} from "@/lib/userApi";
import { track } from "@/lib/analytics";
import { MAX_CART_QTY } from "@/lib/cart";

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
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);

  // Load cart from backend when user logs in
  const loadCart = useCallback(async () => {
    if (!user) { setItems([]); return; }
    const rows = await fetchCart();
    setItems(rows.map(r => ({
      product:  r.product_data as unknown as Product,
      quantity: r.quantity,
    })));
  }, [user?.id]);

  useEffect(() => { loadCart(); }, [loadCart]);

  // `quantity` lets the product page add a chosen amount in one call. The backend
  // caps the stored total at MAX_CART_QTY, so mirror that ceiling locally too.
  const addToCart = async (product: Product, quantity = 1) => {
    if (!user) return;
    const qty = Math.min(Math.max(Math.trunc(quantity) || 1, 1), MAX_CART_QTY);
    await apiAddToCart(product.id, product, qty);
    track("add_to_cart", { product_id: product.id, name: product.name, price: product.price, quantity: qty });
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
    await apiRemoveCartItem(productId);
    track("remove_from_cart", { product_id: productId });
    setItems(prev => prev.filter(i => i.product.id !== productId));
  };

  const updateQuantity = async (productId: string, quantity: number) => {
    if (quantity <= 0) { await removeFromCart(productId); return; }
    await apiUpdateCartItem(productId, quantity);
    setItems(prev => prev.map(i => i.product.id === productId ? { ...i, quantity } : i));
  };

  const clearCart = async () => {
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
