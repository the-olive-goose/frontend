import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";

const CartDrawer = () => {
  const { items, removeFromCart, updateQuantity, count, total, clearCart } = useCart();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      {/* Cart trigger button (rendered inline — parent can position it) */}
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-1.5 transition-opacity hover:opacity-70"
        style={{ color: "var(--color-white)" }}
        aria-label="Open cart"
      >
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
          <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 01-8 0"/>
        </svg>
        {count > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center font-sans text-[10px] font-bold"
            style={{ background: "var(--btn-primary-bg)", color: "var(--color-forest-dark)" }}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[120]"
              style={{ background: "rgba(20,28,16,0.45)" }}
              onClick={() => setOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="fixed top-0 right-0 bottom-0 z-[130] w-full max-w-sm flex flex-col"
              style={{
                background: "var(--color-cream-card)",
                borderLeft: "1px solid var(--color-border)",
                boxShadow: "-12px 0 40px rgba(0,0,0,0.15)",
              }}
            >
              {/* Header */}
              <div
                className="flex items-center justify-between px-6 py-5"
                style={{ borderBottom: "1px solid var(--color-border)" }}
              >
                <h2 className="font-display text-lg font-semibold" style={{ color: "var(--color-forest-dark)" }}>
                  Your Cart {count > 0 && <span className="font-sans text-sm font-normal opacity-60">({count})</span>}
                </h2>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors"
                  style={{ color: "rgba(30,41,24,0.5)" }}
                >
                  <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M1 1l12 12M13 1L1 13"/>
                  </svg>
                </button>
              </div>

              {/* Items */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-48 gap-3">
                    <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" style={{ color: "rgba(30,41,24,0.25)" }}>
                      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                      <line x1="3" y1="6" x2="21" y2="6"/>
                      <path d="M16 10a4 4 0 01-8 0"/>
                    </svg>
                    <p className="font-display text-sm" style={{ color: "rgba(30,41,24,0.4)" }}>Your cart is empty</p>
                  </div>
                ) : (
                  items.map(({ product, quantity }) => (
                    <div
                      key={product.id}
                      className="flex gap-4 py-3"
                      style={{ borderBottom: "1px solid var(--color-border)" }}
                    >
                      {/* Thumbnail */}
                      <div
                        className="w-16 h-16 rounded-xl overflow-hidden shrink-0"
                        style={{ background: "var(--color-sage-pale)" }}
                      >
                        {product.image_url && (
                          <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-display text-sm font-semibold truncate" style={{ color: "var(--color-forest-dark)" }}>
                          {product.name}
                        </p>
                        <p className="font-display text-sm mt-0.5" style={{ color: "var(--color-forest-dark)" }}>
                          {product.price}
                        </p>

                        {/* Quantity controls */}
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            onClick={() => updateQuantity(product.id, quantity - 1)}
                            className="w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:bg-black/10"
                            style={{ border: "1px solid var(--color-border)", color: "var(--color-forest-dark)" }}
                          >
                            −
                          </button>
                          <span className="font-sans text-sm w-4 text-center" style={{ color: "var(--color-forest-dark)" }}>
                            {quantity}
                          </span>
                          <button
                            onClick={() => updateQuantity(product.id, quantity + 1)}
                            className="w-6 h-6 rounded-full flex items-center justify-center transition-colors hover:bg-black/10"
                            style={{ border: "1px solid var(--color-border)", color: "var(--color-forest-dark)" }}
                          >
                            +
                          </button>
                          <button
                            onClick={() => removeFromCart(product.id)}
                            className="ml-auto transition-opacity hover:opacity-60"
                            style={{ color: "rgba(30,41,24,0.4)" }}
                          >
                            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                              <path d="M1 1l12 12M13 1L1 13"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              {items.length > 0 && (
                <div className="px-6 py-5" style={{ borderTop: "1px solid var(--color-border)" }}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-display text-base" style={{ color: "rgba(30,41,24,0.65)" }}>Total</span>
                    <span className="font-display text-xl font-semibold" style={{ color: "var(--color-forest-dark)" }}>
                      {total}
                    </span>
                  </div>
                  <button
                    className="w-full py-3 rounded-full font-display text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98] mb-2"
                    style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
                  >
                    Checkout
                  </button>
                  <button
                    onClick={clearCart}
                    className="w-full py-2 font-sans text-xs text-center transition-opacity hover:opacity-60"
                    style={{ color: "rgba(30,41,24,0.45)" }}
                  >
                    Clear cart
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default CartDrawer;
