import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type Bundle, type DealsContent, type Product, type PickupSettingsContent } from "@/lib/defaults";
import { cartSubtotal } from "@/lib/cart";
import { getBundleNudges } from "@/lib/bundleNudges";
import FreeShippingBar from "@/components/FreeShippingBar";
import TrustBadges from "@/components/TrustBadges";
import FooterSection from "@/components/sections/FooterSection";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const BasketPage = () => {
  const { user, openAuthModal } = useAuth();
  const { items, removeFromCart, updateQuantity, clearCart, count, addToCart } = useCart();
  const navigate = useNavigate();
  const [clearing, setClearing] = useState(false);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [pickup, setPickup] = useState<PickupSettingsContent>(DEFAULT_CONTENT.pickupSettings);
  const [addingNudge, setAddingNudge] = useState<string | null>(null);

  useEffect(() => {
    getContent<DealsContent>("deals", DEFAULT_DEALS).then(d => setBundles(d?.bundles ?? []));
    getContent("products", DEFAULT_CONTENT.products).then(d => setAllProducts(d?.items ?? []));
    getContent("pickupSettings", DEFAULT_CONTENT.pickupSettings).then(setPickup);
  }, []);

  const appliedBundles = bundles.filter(b =>
    b.is_active && b.product_ids.length > 0 &&
    b.product_ids.every(pid => items.some(i => i.product.id === pid))
  );

  // Bundles where the customer already has some, but not all, of the qualifying items —
  // ranked by how compelling they are to finish, not just listed as-is.
  const bundleNudges = getBundleNudges(bundles, items, allProducts, 2);

  const handleAddNudge = async (nudge: ReturnType<typeof getBundleNudges>[number]) => {
    setAddingNudge(nudge.bundle.id);
    for (const p of nudge.missing) await addToCart(p);
    setAddingNudge(null);
    toast.success(`${nudge.bundle.name} unlocked!`, { description: `You save €${nudge.savings.toFixed(2)}`, duration: 3000 });
  };

  const bundleSavings = appliedBundles.reduce((sum, b) => {
    const base = b.product_ids.reduce((s, pid) => {
      const item = items.find(i => i.product.id === pid);
      if (!item) return s;
      const n = parseFloat(item.product.price.replace(/[^0-9.]/g, ""));
      return s + (isNaN(n) ? 0 : n * item.quantity);
    }, 0);
    return sum + (b.discount_type === "percentage" ? base * (b.discount_value / 100) : b.discount_value);
  }, 0);

  const subtotalNum = cartSubtotal(items);
  const total = `€${subtotalNum.toFixed(2)}`;

  const handleClear = async () => {
    setClearing(true);
    await clearCart();
    setClearing(false);
  };

  const shipping = subtotalNum >= pickup.free_shipping_threshold ? 0 : 4.99;
  const grandTotal = `€${Math.max(0, subtotalNum - bundleSavings + shipping).toFixed(2)}`;

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>

      {/* Page header */}
      <div className="pt-[112px]" style={{ background: "#f3f3f3" }}>
        <div className="max-w-6xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>
            Your Olive Goose Basket
          </h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-8 py-4 sm:py-6 flex flex-col lg:flex-row gap-4 items-start">

          {/* ── Left: basket contents ── */}
          <div className="flex-1 min-w-0">

            {/* Not signed in */}
            {!user && (
              <div className="bg-white rounded-xl p-8 flex flex-col sm:flex-row items-center gap-8"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div className="shrink-0 w-24 h-24 rounded-full flex items-center justify-center"
                  style={{ background: "#f3f3f3", border: "2px solid #DDD" }}>
                  <svg width="44" height="44" fill="none" stroke="#aaa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 01-8 0"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <h2 className="font-serif text-xl font-bold mb-1" style={{ color: "#0F1111" }}>Your Basket is empty.</h2>
                  <p className="font-sans text-sm mb-5" style={{ color: "#C7511F" }}>
                    <a href="/shop" className="hover:underline">Shop today's candles</a>
                  </p>
                  <div className="flex flex-wrap gap-3 mb-4">
                    <button onClick={openAuthModal}
                      className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                      style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                      Sign in to your account
                    </button>
                    <button onClick={openAuthModal}
                      className="font-sans text-sm px-6 py-2.5 rounded-full transition-all hover:bg-gray-50 active:scale-95"
                      style={{ border: "1px solid #aaa", color: "#111", background: "#fff" }}>
                      Sign up now
                    </button>
                  </div>
                  <p className="font-sans text-xs" style={{ color: "#555" }}>
                    Sign in to see items you added previously, or to use your saved details at checkout.
                  </p>
                </div>
              </div>
            )}

            {/* Signed in — empty */}
            {user && items.length === 0 && (
              <div className="bg-white rounded-xl p-10 text-center"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center mb-4"
                  style={{ background: "#f3f3f3", border: "2px solid #DDD" }}>
                  <svg width="38" height="38" fill="none" stroke="#aaa" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                    <line x1="3" y1="6" x2="21" y2="6"/>
                    <path d="M16 10a4 4 0 01-8 0"/>
                  </svg>
                </div>
                <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Your Basket is empty.</h2>
                <a href="/shop" className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>
                  Continue Shopping →
                </a>
              </div>
            )}

            {/* Signed in — has items */}
            {user && items.length > 0 && (
              <div className="bg-white rounded-xl overflow-hidden"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid #EEE" }}>
                  <span className="font-sans text-sm" style={{ color: "#555" }}>
                    {count} item{count !== 1 ? "s" : ""} in basket
                  </span>
                  <span className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                    Price
                  </span>
                </div>

                <AnimatePresence>
                  {items.map((item, idx) => {
                    const img = item.product.image_url || FALLBACK_IMGS[idx % 2];
                    const unitPrice = parseFloat(item.product.price.replace(/[^0-9.]/g, ""));
                    const lineTotal = isNaN(unitPrice) ? item.product.price : `€${(unitPrice * item.quantity).toFixed(2)}`;

                    return (
                      <motion.div key={item.product.id}
                        initial={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25 }}
                        className="flex gap-5 px-6 py-5"
                        style={{ borderBottom: "1px solid #EEE" }}>

                        {/* Product image */}
                        <a href="/shop" className="shrink-0">
                          <img src={img} alt={item.product.name}
                            className="rounded-lg object-cover"
                            style={{ width: "clamp(72px,20vw,120px)", height: "clamp(72px,20vw,120px)", mixBlendMode: "multiply" }} />
                        </a>

                        {/* Details */}
                        <div className="flex-1 min-w-0">
                          <p className="font-sans font-semibold text-base mb-1 truncate" style={{ color: "#0F1111" }}>
                            {item.product.name}
                          </p>
                          {item.product.tag && (
                            <span className="inline-block font-sans text-xs px-2 py-0.5 rounded-full mb-1"
                              style={{ background: "rgba(29,43,27,0.08)", color: "#1D2B1B", border: "1px solid rgba(29,43,27,0.18)" }}>
                              {item.product.tag}
                            </span>
                          )}
                          {item.product.description && (
                            <p className="font-sans text-sm mb-3 line-clamp-2" style={{ color: "#555" }}>
                              {item.product.description}
                            </p>
                          )}
                          <p className="font-sans text-sm font-semibold mb-3" style={{ color: "#007600" }}>
                            In Stock
                          </p>

                          {/* Quantity + actions */}
                          <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center rounded-full overflow-hidden"
                              style={{ border: "1px solid #DDD", background: "#f0f0f0" }}>
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                className="w-8 h-8 flex items-center justify-center font-sans text-lg transition-colors hover:bg-gray-200"
                                style={{ color: "#0F1111" }}>−</button>
                              <span className="px-3 font-sans text-sm font-semibold min-w-[28px] text-center"
                                style={{ color: "#0F1111" }}>{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                className="w-8 h-8 flex items-center justify-center font-sans text-lg transition-colors hover:bg-gray-200"
                                style={{ color: "#0F1111" }}>+</button>
                            </div>
                            <span style={{ color: "#DDD" }}>|</span>
                            <button onClick={() => removeFromCart(item.product.id)}
                              className="font-sans text-sm transition-colors hover:underline"
                              style={{ color: "#C7511F" }}>
                              Delete
                            </button>
                            <button onClick={() => navigate("/shop")}
                              className="font-sans text-sm transition-colors hover:underline"
                              style={{ color: "#007185" }}>
                              Save for later
                            </button>
                          </div>
                        </div>

                        {/* Line price */}
                        <div className="shrink-0 text-right">
                          <p className="font-sans font-bold text-lg" style={{ color: "#0F1111" }}>{lineTotal}</p>
                          {item.quantity > 1 && (
                            <p className="font-sans text-xs" style={{ color: "#555" }}>{item.product.price} each</p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {/* Subtotal row */}
                <div className="px-6 py-4 text-right">
                  <span className="font-sans text-base">
                    Subtotal ({count} item{count !== 1 ? "s" : ""}):&nbsp;
                    <strong style={{ color: "#0F1111" }}>{total}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* Clear basket */}
            {user && items.length > 0 && (
              <div className="mt-3 text-right">
                <button onClick={handleClear} disabled={clearing}
                  className="font-sans text-xs transition-colors hover:underline disabled:opacity-50"
                  style={{ color: "#C7511F" }}>
                  {clearing ? "Clearing…" : "Clear basket"}
                </button>
              </div>
            )}

            {/* Almost-a-bundle nudges — ranked by how compelling they are to finish */}
            {user && bundleNudges.length > 0 && (
              <div className="mt-3 space-y-2">
                {bundleNudges.map(nudge => (
                  <div key={nudge.bundle.id} className="flex items-center gap-3 px-4 py-3 rounded-xl flex-wrap"
                    style={{ background: "#fff8f0", border: "1px solid #f0dfc0" }}>
                    <span className="text-lg shrink-0">🏷️</span>
                    <p className="font-sans text-sm flex-1 min-w-[200px]" style={{ color: "#0F1111" }}>
                      Add <strong>{nudge.missing.map(p => p.name).join(" & ")}</strong> to unlock{" "}
                      <strong style={{ color: "#007600" }}>
                        {nudge.bundle.discount_type === "percentage" ? `${nudge.bundle.discount_value}% off` : `€${nudge.bundle.discount_value.toFixed(2)} off`}
                      </strong>{" "}
                      with the {nudge.bundle.name} bundle — save €{nudge.savings.toFixed(2)}.
                    </p>
                    <button onClick={() => handleAddNudge(nudge)} disabled={addingNudge === nudge.bundle.id}
                      className="shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
                      style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                      {addingNudge === nudge.bundle.id ? "Adding…" : "Add & Save"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Right: summary / info ── */}
          <div className="w-full lg:w-72 shrink-0 space-y-4">

            {/* Order summary (when signed in + has items) */}
            {user && items.length > 0 && (
              <div className="bg-white rounded-xl p-5 space-y-3"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <FreeShippingBar subtotal={subtotalNum} threshold={pickup.free_shipping_threshold} />
                <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                  <span>Subtotal ({count} item{count !== 1 ? "s" : ""})</span>
                  <span className="font-semibold">{total}</span>
                </div>

                {/* Bundle savings */}
                {appliedBundles.map(b => (
                  <div key={b.id} className="flex justify-between font-sans text-sm" style={{ color: "#007600" }}>
                    <span>🏷️ {b.name} deal</span>
                    <span className="font-semibold">
                      −{b.discount_type === "percentage" ? `${b.discount_value}%` : `€${b.discount_value.toFixed(2)}`}
                    </span>
                  </div>
                ))}
                {bundleSavings > 0 && (
                  <div className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                    <span>Total savings</span>
                    <span>−€{bundleSavings.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                  <span>Shipping</span>
                  <span className="font-semibold" style={{ color: shipping === 0 ? "#007600" : undefined }}>
                    {shipping === 0 ? "FREE" : `€${shipping.toFixed(2)}`}
                  </span>
                </div>
                <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                  <div className="flex justify-between font-sans font-bold text-base" style={{ color: "#0F1111" }}>
                    <span>Order total</span>
                    <span>{grandTotal}</span>
                  </div>
                </div>
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={() => navigate("/checkout")}
                  className="w-full font-sans text-sm font-bold py-2.5 rounded-full transition-all"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  Proceed to Checkout
                </motion.button>
                <div className="pt-1">
                  <TrustBadges compact />
                </div>
              </div>
            )}

            {/* Info card */}
            <div className="bg-white rounded-xl p-5"
              style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <p className="font-sans text-sm leading-relaxed mb-4" style={{ color: "#0F1111" }}>
                The price and availability of items at The Olive Goose are subject to change. The shopping basket is a temporary place to store a list of your items and reflects each item's most recent price.
              </p>
              <a href="/shop" className="font-sans text-sm font-semibold hover:underline transition-colors"
                style={{ color: "#C7511F" }}>
                Continue Shopping →
              </a>
            </div>
          </div>
        </div>
      </div>

      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default BasketPage;
