import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { Product } from "@/lib/defaults";
import { useAuth } from "./AuthContext";
import {
  fetchCart, apiAddToCart, apiUpdateCartItem, apiRemoveCartItem, apiClearCart,
} from "@/lib/userApi";

export interface CartItem {
  product: Product;
  quantity: number;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product) => Promise<void>;
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

  const addToCart = async (product: Product) => {
    if (!user) return;
    await apiAddToCart(product.id, product, 1);
    setItems(prev => {
      const existing = prev.find(i => i.product.id === product.id);
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = async (productId: string) => {
    await apiRemoveCartItem(productId);
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
