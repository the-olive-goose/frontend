import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type Bundle, type DealsContent, type Product } from "@/lib/defaults";
import { useContent } from "@/hooks/useContent";
import { cartSubtotal, formatPrice } from "@/lib/cart";
import { track, lineItems } from "@/lib/analytics";
import { computeBundleSavings } from "@/lib/bundleSavings";
import { getBundleNudges } from "@/lib/bundleNudges";
import FreeShippingBar from "@/components/FreeShippingBar";
import TrustBadges from "@/components/TrustBadges";
import FooterSection from "@/components/sections/FooterSection";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const BasketPage = () => {
  const { user, openAuthModal, requireAuth } = useAuth();
  const { items, removeFromCart, updateQuantity, clearCart, count, addToCart } = useCart();
  const navigate = useNavigate();
  const [clearing, setClearing] = useState(false);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const { data: pickup, ready: pickupReady } = useContent("pickupSettings", DEFAULT_CONTENT.pickupSettings);
  const [addingNudge, setAddingNudge] = useState<string | null>(null);

  useEffect(() => {
    getContent<DealsContent>("deals", DEFAULT_DEALS).then(d => setBundles(d?.bundles ?? []));
    getContent("products", DEFAULT_CONTENT.products).then(d => setAllProducts(d?.items ?? []));
  }, []);

  // view_cart — the step between adding something and starting checkout, and
  // where a large share of abandonment actually happens. Fires once per visit to
  // the page with a non-empty basket; an empty basket is a bounce, not a cart
  // view, and counting it would understate the cart→checkout rate.
  const cartViewed = useRef(false);
  useEffect(() => {
    if (cartViewed.current || items.length === 0) return;
    cartViewed.current = true;
    track("view_cart", { items: count, total: +cartSubtotal(items).toFixed(2), line_items: lineItems(items) });
  }, [items, count]);

  // Per-unit, non-overlapping bundle allocation — same algorithm the backend
  // charges with, so what's shown here matches the Stripe total to the cent. The
  // catalogue is passed so bundles with a deleted (orphaned) product_id still apply
  // on their surviving candles instead of silently never discounting.
  const { applied: appliedBundles, totalSavings: bundleSavings } =
    computeBundleSavings(bundles, items, allProducts.map(p => p.id));

  // Bundles where the customer already has some, but not all, of the qualifying items —
  // ranked by how compelling they are to finish, not just listed as-is.
  const bundleNudges = getBundleNudges(bundles, items, allProducts, 2);

  const handleAddNudge = async (nudge: ReturnType<typeof getBundleNudges>[number]) => {
    setAddingNudge(nudge.bundle.id);
    for (const p of nudge.missing) await addToCart(p);
    setAddingNudge(null);
    toast.success(`${nudge.bundle.name} unlocked!`, { description: `You save €${nudge.savings.toFixed(2)}`, duration: 3000 });
  };

  const subtotalNum = cartSubtotal(items);
  const total = `€${subtotalNum.toFixed(2)}`;

  const handleClear = async () => {
    setClearing(true);
    await clearCart();
    setClearing(false);
  };

  // Shipping is deliberately NOT charged here: it depends on the fulfilment choice
  // (delivery vs pickup) the shopper only makes on the checkout page, so the basket
  // shows an items-only estimate and defers the shipping line to checkout.
  const estimatedTotalNum = Math.max(0, subtotalNum - Math.min(bundleSavings, subtotalNum));
  const estimatedTotal = `€${estimatedTotalNum.toFixed(2)}`;

  // The storefront's one and only sign-in gate, so this is the one place that can
  // measure what it costs. Without the event, a guest who won't make an account
  // looks identical to someone who simply left the basket page — the drop lands
  // on "Reached checkout" with no way to tell the two apart. The basket value
  // rides along so the money held up at the wall is knowable, not guessed.
  const handleProceedToCheckout = () => {
    track("checkout_gate", {
      outcome: user ? "passed" : "signin_required",
      total: +estimatedTotalNum.toFixed(2),
      items: count,
      line_items: lineItems(items),
      // The bundle saving already applied to `total` — carried so the value and
      // the list-priced items above can be reconciled rather than just differing.
      discount: +Math.min(bundleSavings, subtotalNum).toFixed(2),
    });
    // The path is repeated for the OAuth case: "Continue with Google" leaves the
    // site entirely, so the callback needs the destination written down — without
    // it the shopper comes back signed in but stranded on the homepage.
    requireAuth(() => navigate("/checkout"), "/checkout");
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>

      {/* Page header */}
      <div className="pt-[var(--nav-h,112px)]" style={{ background: "#f3f3f3" }}>
        <div className="max-w-6xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>
            Your Olive Goose Basket
          </h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-6xl mx-auto px-3 sm:px-8 py-4 sm:py-6 flex flex-col lg:flex-row gap-4 items-start">

          {/* ── Left: basket contents ── */}
          <div className="flex-1 min-w-0">

            {/* Signed out — empty. Signing in isn't required to shop, it just
                brings back a basket left on another device. */}
            {!user && items.length === 0 && (
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
                  <p className="font-sans text-sm mb-4" style={{ color: "#555" }}>
                    No account needed to add items — you can sign in when you check out.
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
                <a href="/shop" className="og-tap font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>
                  Continue Shopping →
                </a>
              </div>
            )}

            {/* Has items — signed in or not */}
            {items.length > 0 && (
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
                    const lineTotal = isNaN(unitPrice) ? formatPrice(item.product.price) : `€${(unitPrice * item.quantity).toFixed(2)}`;

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
                              {/* 44px on a phone (the touch-target floor the rest of
                                  the mobile UI uses), back to a compact 32px from
                                  the sm breakpoint up where there's a cursor. */}
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center font-sans text-lg transition-colors hover:bg-gray-200"
                                style={{ color: "#0F1111" }}>−</button>
                              <span className="px-3 font-sans text-sm font-semibold min-w-[28px] text-center"
                                style={{ color: "#0F1111" }}>{item.quantity}</span>
                              <button
                                onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center font-sans text-lg transition-colors hover:bg-gray-200"
                                style={{ color: "#0F1111" }}>+</button>
                            </div>
                            <span style={{ color: "#DDD" }}>|</span>
                            <button onClick={() => removeFromCart(item.product.id)}
                              className="og-tap font-sans text-sm transition-colors hover:underline"
                              style={{ color: "#C7511F" }}>
                              Delete
                            </button>
                            <button onClick={() => navigate("/shop")}
                              className="og-tap font-sans text-sm transition-colors hover:underline"
                              style={{ color: "#007185" }}>
                              Save for later
                            </button>
                          </div>
                        </div>

                        {/* Line price */}
                        <div className="shrink-0 text-right">
                          <p className="font-sans font-bold text-lg" style={{ color: "#0F1111" }}>{lineTotal}</p>
                          {item.quantity > 1 && (
                            <p className="font-sans text-xs" style={{ color: "#555" }}>{formatPrice(item.product.price)} each</p>
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
            {items.length > 0 && (
              <div className="mt-3 text-right">
                <button onClick={handleClear} disabled={clearing}
                  className="og-tap font-sans text-xs transition-colors hover:underline disabled:opacity-50"
                  style={{ color: "#C7511F" }}>
                  {clearing ? "Clearing…" : "Clear basket"}
                </button>
              </div>
            )}

            {/* Almost-a-bundle nudges — ranked by how compelling they are to finish */}
            {bundleNudges.length > 0 && (
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
                      className="og-tap justify-center shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
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

            {/* Order summary (whenever there is something to buy) */}
            {items.length > 0 && (
              <div className="bg-white rounded-xl p-5 space-y-3"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <FreeShippingBar subtotal={subtotalNum} threshold={pickup.free_shipping_threshold} ready={pickupReady} />
                <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                  <span>Subtotal ({count} item{count !== 1 ? "s" : ""})</span>
                  <span className="font-semibold">{total}</span>
                </div>

                {/* Bundle savings */}
                {appliedBundles.map(ab => (
                  <div key={ab.bundle.id} className="flex justify-between font-sans text-sm" style={{ color: "#007600" }}>
                    <span>🏷️ {ab.bundle.name} deal{ab.instances > 1 ? ` ×${ab.instances}` : ""}</span>
                    <span className="font-semibold">−€{ab.savings.toFixed(2)}</span>
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
                  <span style={{ color: "#555" }}>Calculated at checkout</span>
                </div>
                <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                  <div className="flex justify-between font-sans font-bold text-base" style={{ color: "#0F1111" }}>
                    <span>Estimated total</span>
                    <span>{estimatedTotal}</span>
                  </div>
                  <p className="font-sans text-xs mt-1" style={{ color: "#555" }}>
                    Shipping is added once you choose delivery or pickup at checkout.
                  </p>
                </div>
                {/* The site's single sign-in gate. requireAuth replays the
                    navigation once sign-in succeeds, and the guest basket is
                    merged into the account by then, so nothing is lost. */}
                <motion.button
                  whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                  onClick={handleProceedToCheckout}
                  className="og-tap justify-center w-full font-sans text-sm font-bold py-2.5 rounded-full transition-all"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  Proceed to Checkout
                </motion.button>
                {!user && (
                  <p className="text-center font-sans text-xs" style={{ color: "#555" }}>
                    You'll sign in at checkout — your basket comes with you.
                  </p>
                )}
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
              <a href="/shop" className="og-tap font-sans text-sm font-semibold hover:underline transition-colors"
                style={{ color: "#C7511F" }}>
                Continue Shopping →
              </a>
            </div>
          </div>
        </div>
      </div>

      <FooterSection />
    </div>
  );
};

export default BasketPage;
