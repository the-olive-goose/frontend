import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { getContent } from "@/lib/api";
import { createCheckoutSession, validateDiscountCode, SessionExpiredError, type DeliveryAddress, type FulfillmentType } from "@/lib/userApi";
import { DEFAULT_CONTENT, DEFAULT_DEALS, type PickupSettingsContent, type Bundle, type DealsContent, type Product } from "@/lib/defaults";
import { cartSubtotal, formatPrice } from "@/lib/cart";
import { track, getAnalyticsIds } from "@/lib/analytics";
import { getBundleNudges } from "@/lib/bundleNudges";
import FreeShippingBar from "@/components/FreeShippingBar";
import TrustBadges from "@/components/TrustBadges";
import FooterSection from "@/components/sections/FooterSection";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];
const inputStyle = { border: "1px solid #ccc", background: "#fff", color: "#111" } as const;

const CheckoutPage = () => {
  const { user, loading: authLoading, openAuthModal, requireAuth } = useAuth();
  const { items, count, addToCart } = useCart();
  const [searchParams] = useSearchParams();

  const [pickup, setPickup] = useState<PickupSettingsContent>(DEFAULT_CONTENT.pickupSettings);
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [addingNudge, setAddingNudge] = useState(false);
  const [fulfillment, setFulfillment] = useState<FulfillmentType>("delivery");
  const [address, setAddress] = useState<DeliveryAddress>({});
  const [contactPhone, setContactPhone] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState<{ code: string; percent: number } | null>(null);
  const [codeError, setCodeError] = useState("");
  const [validatingCode, setValidatingCode] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(
    searchParams.get("canceled") ? "Payment was canceled — your basket is still here whenever you're ready." : ""
  );

  useEffect(() => {
    getContent("pickupSettings", DEFAULT_CONTENT.pickupSettings).then(setPickup);
    getContent<DealsContent>("deals", DEFAULT_DEALS).then(d => setBundles(d?.bundles ?? []));
    getContent("products", DEFAULT_CONTENT.products).then(d => setAllProducts(d?.items ?? []));
  }, []);

  useEffect(() => {
    if (!user) return;
    setAddress({
      full_name: user.full_name ?? "",
      phone: user.phone ?? "",
      address_line1: user.address_line1 ?? "",
      address_line2: user.address_line2 ?? "",
      city: user.city ?? "",
      state: user.state ?? "",
      postal_code: user.postal_code ?? "",
      country: user.country ?? "",
    });
    setContactPhone(user.phone ?? "");
  }, [user?.id]);

  const subtotalNum = cartSubtotal(items);
  const isPickup = fulfillment === "pickup";
  const discountPercent = isPickup ? pickup.discount_percent : 0;
  const pickupDiscountAmount = subtotalNum * (discountPercent / 100);

  // Today's Deals bundles the basket already fully satisfies — same rule Stripe
  // applies server-side, so the total shown here matches what's actually charged.
  const appliedBundles = bundles.filter(b =>
    b.is_active && b.product_ids.length > 0 &&
    b.product_ids.every(pid => items.some(i => i.product.id === pid))
  );
  const bundleSavings = appliedBundles.reduce((sum, b) => {
    const base = b.product_ids.reduce((s, pid) => {
      const item = items.find(i => i.product.id === pid);
      if (!item) return s;
      const n = parseFloat(item.product.price.replace(/[^0-9.]/g, ""));
      return s + (isNaN(n) ? 0 : n * item.quantity);
    }, 0);
    return sum + (b.discount_type === "percentage" ? base * (b.discount_value / 100) : b.discount_value);
  }, 0);

  const codeDiscountAmount = appliedCode ? subtotalNum * (appliedCode.percent / 100) : 0;
  const discountAmount = pickupDiscountAmount + bundleSavings + codeDiscountAmount;
  const flatShipping = pickup.flat_shipping_rate ?? 4.99;
  const shipping = isPickup ? 0 : (subtotalNum >= pickup.free_shipping_threshold ? 0 : flatShipping);
  const grandTotal = Math.max(0, subtotalNum - discountAmount + shipping);

  const addressComplete = !!(address.address_line1 && address.city && address.postal_code && address.country);

  // Single best "almost complete" deal — checkout is high-intent, low-real-estate,
  // so only the top-ranked bundle nudge is surfaced here (see getBundleNudges).
  const [bestNudge] = getBundleNudges(bundles, items, allProducts, 1);

  const applyCode = async () => {
    const code = codeInput.trim();
    if (!code) return;
    setValidatingCode(true);
    setCodeError("");
    try {
      const result = await validateDiscountCode(code);
      if (result.valid && result.discount_percent != null) {
        setAppliedCode({ code: result.code ?? code.toUpperCase(), percent: result.discount_percent });
        setCodeInput("");
      } else {
        setAppliedCode(null);
        setCodeError(result.message ?? "That code isn't valid.");
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        requireAuth(() => applyCode());
      } else {
        setCodeError(err instanceof Error ? err.message : "Could not validate code");
      }
    } finally {
      setValidatingCode(false);
    }
  };

  const removeCode = () => {
    setAppliedCode(null);
    setCodeError("");
    setCodeInput("");
  };

  const handleAddNudge = async () => {
    if (!bestNudge) return;
    setAddingNudge(true);
    for (const p of bestNudge.missing) await addToCart(p);
    setAddingNudge(false);
    toast.success(`${bestNudge.bundle.name} unlocked!`, { description: `You save €${bestNudge.savings.toFixed(2)}`, duration: 3000 });
  };

  // Redirects to Stripe's hosted checkout page. The basket isn't cleared and no
  // order exists yet — that only happens once Stripe confirms the payment (see
  // CheckoutSuccessPage), so there's no way to end up with an unpaid order.
  const handlePlaceOrder = async () => {
    setError("");
    if (isPickup ? false : !addressComplete) {
      setError("Please fill in your delivery address.");
      return;
    }
    setPlacing(true);
    track("begin_checkout", { total: +grandTotal.toFixed(2), items: count, fulfillment_type: fulfillment });
    try {
      const { url } = await createCheckoutSession({
        fulfillment_type: fulfillment,
        shipping_address: isPickup ? undefined : address,
        contact_phone: isPickup ? contactPhone : undefined,
        discount_code: appliedCode?.code,
        analytics: getAnalyticsIds(),
      });
      window.location.href = url;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        requireAuth(() => handlePlaceOrder());
      } else {
        const msg = err instanceof Error ? err.message : "Could not start checkout";
        setError(msg);
        // A code that passed the pre-check but was consumed/blocked by the time
        // checkout started — drop it so the shopper can retry at the real price.
        if (appliedCode && /code|discount|welcome/i.test(msg)) {
          setAppliedCode(null);
          setCodeError(msg);
        }
      }
      setPlacing(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[112px]">
        <div className="max-w-6xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Checkout</h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className={`max-w-6xl mx-auto px-3 sm:px-8 py-4 sm:py-6 ${user && items.length > 0 ? "pb-28 lg:pb-6" : ""}`}>

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to check out</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in
              </button>
            </div>
          )}

          {user && items.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Your basket is empty.</h2>
              <a href="/shop" className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>Start shopping →</a>
            </div>
          )}

          {user && items.length > 0 && (
            <div className="flex flex-col lg:flex-row gap-4 items-start">

              {/* ── Left: checkout steps ── */}
              <div className="flex-1 min-w-0 w-full space-y-4">

                {/* Delivery method */}
                <div className="bg-white rounded-xl p-5 space-y-3" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>1. Delivery Method</h2>

                  {!isPickup && (
                    <div className="p-3 rounded-lg" style={{ background: "#f8f8f8" }}>
                      <FreeShippingBar subtotal={subtotalNum} threshold={pickup.free_shipping_threshold} compact />
                    </div>
                  )}

                  <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                    style={{ border: `2px solid ${fulfillment === "delivery" ? "#e77600" : "#DDD"}`, background: fulfillment === "delivery" ? "#fff8f0" : "#fff" }}>
                    <input type="radio" name="fulfillment" checked={fulfillment === "delivery"} onChange={() => setFulfillment("delivery")} className="mt-1" />
                    <div>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>Ship to my address</p>
                      <p className="font-sans text-xs" style={{ color: "#555" }}>
                        {subtotalNum >= pickup.free_shipping_threshold ? "Free shipping" : `€${flatShipping.toFixed(2)} shipping — free over €${pickup.free_shipping_threshold.toFixed(2)}`}
                      </p>
                    </div>
                  </label>

                  {pickup.enabled && (
                    <label className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                      style={{ border: `2px solid ${fulfillment === "pickup" ? "#e77600" : "#DDD"}`, background: fulfillment === "pickup" ? "#fff8f0" : "#fff" }}>
                      <input type="radio" name="fulfillment" checked={fulfillment === "pickup"} onChange={() => setFulfillment("pickup")} className="mt-1" />
                      <div>
                        <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                          Pick up from {pickup.location_name} — {pickup.city}
                          {pickup.discount_percent > 0 && (
                            <span className="ml-2 font-sans text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6ee", color: "#007600" }}>
                              Save {pickup.discount_percent}%
                            </span>
                          )}
                        </p>
                        <p className="font-sans text-xs" style={{ color: "#555" }}>{pickup.address_line1} · {pickup.hours}</p>
                      </div>
                    </label>
                  )}
                </div>

                {/* Delivery address / pickup details */}
                {fulfillment === "delivery" ? (
                  <div className="bg-white rounded-xl p-5 space-y-4" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>2. Delivery Address</h2>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <input placeholder="Full name" value={address.full_name ?? ""} onChange={e => setAddress(a => ({ ...a, full_name: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                      <input placeholder="Phone" value={address.phone ?? ""} onChange={e => setAddress(a => ({ ...a, phone: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    </div>
                    <input placeholder="Address line 1" value={address.address_line1 ?? ""} onChange={e => setAddress(a => ({ ...a, address_line1: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    <input placeholder="Address line 2 (optional)" value={address.address_line2 ?? ""} onChange={e => setAddress(a => ({ ...a, address_line2: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    <div className="grid sm:grid-cols-3 gap-3">
                      <input placeholder="City" value={address.city ?? ""} onChange={e => setAddress(a => ({ ...a, city: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                      <input placeholder="State / Region" value={address.state ?? ""} onChange={e => setAddress(a => ({ ...a, state: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                      <input placeholder="Postal code" value={address.postal_code ?? ""} onChange={e => setAddress(a => ({ ...a, postal_code: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    </div>
                    <input placeholder="Country" value={address.country ?? ""} onChange={e => setAddress(a => ({ ...a, country: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                  </div>
                ) : (
                  <div className="bg-white rounded-xl p-5 space-y-3" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>2. Pickup Details</h2>
                    <div className="p-3 rounded-lg" style={{ background: "#f8f8f8" }}>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{pickup.location_name}</p>
                      <p className="font-sans text-sm" style={{ color: "#555" }}>{pickup.address_line1}, {pickup.city} {pickup.eircode}</p>
                      <p className="font-sans text-sm" style={{ color: "#555" }}>{pickup.country}</p>
                      <p className="font-sans text-xs mt-1" style={{ color: "#007185" }}>{pickup.hours}</p>
                    </div>
                    {pickup.notes && <p className="font-sans text-xs" style={{ color: "#555" }}>{pickup.notes}</p>}
                    <div>
                      <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Contact phone (for pickup notice)</label>
                      <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none" style={inputStyle} />
                    </div>
                  </div>
                )}

                {/* Payment */}
                <div className="bg-white rounded-xl p-5 space-y-2" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold" style={{ color: "#0F1111" }}>3. Payment</h2>
                  <p className="font-sans text-sm" style={{ color: "#555" }}>
                    You'll pay securely by card on the next screen, hosted by Stripe. We never see or store your card details.
                  </p>
                </div>

                {/* Review items */}
                <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm font-semibold px-5 py-3" style={{ color: "#0F1111", borderBottom: "1px solid #EEE" }}>
                    4. Review Order ({count} item{count !== 1 ? "s" : ""})
                  </p>
                  {items.map((item, i) => {
                    const img = item.product.image_url || FALLBACK_IMGS[i % 2];
                    const unitPrice = parseFloat(item.product.price.replace(/[^0-9.]/g, ""));
                    const lineTotal = isNaN(unitPrice) ? formatPrice(item.product.price) : `€${(unitPrice * item.quantity).toFixed(2)}`;
                    return (
                      <div key={item.product.id} className="flex items-center gap-4 px-5 py-3" style={{ borderBottom: i < items.length - 1 ? "1px solid #EEE" : "none" }}>
                        <img src={img} alt={item.product.name} className="rounded-lg object-cover shrink-0" style={{ width: 52, height: 52, mixBlendMode: "multiply" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm font-semibold truncate" style={{ color: "#0F1111" }}>{item.product.name}</p>
                          <p className="font-sans text-xs" style={{ color: "#555" }}>Qty: {item.quantity}</p>
                        </div>
                        <p className="font-sans text-sm font-semibold shrink-0" style={{ color: "#0F1111" }}>{lineTotal}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Best "almost complete" deal — one ranked pick, not a wall of offers */}
                {bestNudge && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl flex-wrap"
                    style={{ background: "#fff8f0", border: "1px solid #f0dfc0" }}>
                    <span className="text-lg shrink-0">🏷️</span>
                    <p className="font-sans text-sm flex-1 min-w-[200px]" style={{ color: "#0F1111" }}>
                      Add <strong>{bestNudge.missing.map(p => p.name).join(" & ")}</strong> to unlock{" "}
                      <strong style={{ color: "#007600" }}>
                        {bestNudge.bundle.discount_type === "percentage" ? `${bestNudge.bundle.discount_value}% off` : `€${bestNudge.bundle.discount_value.toFixed(2)} off`}
                      </strong>{" "}
                      with the {bestNudge.bundle.name} bundle — save €{bestNudge.savings.toFixed(2)}.
                    </p>
                    <button onClick={handleAddNudge} disabled={addingNudge}
                      className="shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
                      style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                      {addingNudge ? "Adding…" : "Add & Save"}
                    </button>
                  </div>
                )}
              </div>

              {/* ── Right: order summary ── */}
              <div className="w-full lg:w-80 shrink-0">
                <div className="bg-white rounded-xl p-5 space-y-3 lg:sticky lg:top-28" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <h2 className="font-serif text-lg font-bold mb-1" style={{ color: "#0F1111" }}>Order Summary</h2>
                  <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                    <span>Subtotal ({count} item{count !== 1 ? "s" : ""})</span>
                    <span className="font-semibold">€{subtotalNum.toFixed(2)}</span>
                  </div>
                  {pickupDiscountAmount > 0 && (
                    <div className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>Pickup discount ({discountPercent}%)</span>
                      <span>−€{pickupDiscountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  {appliedBundles.map(b => (
                    <div key={b.id} className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>🏷️ {b.name} deal</span>
                      <span>
                        −{b.discount_type === "percentage" ? `${b.discount_value}%` : `€${b.discount_value.toFixed(2)}`}
                      </span>
                    </div>
                  ))}
                  {appliedCode && (
                    <div className="flex justify-between font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      <span>🎉 Code {appliedCode.code} ({appliedCode.percent}%)</span>
                      <span>−€{codeDiscountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-sans text-sm" style={{ color: "#0F1111" }}>
                    <span>Shipping</span>
                    <span className="font-semibold" style={{ color: shipping === 0 ? "#007600" : undefined }}>
                      {shipping === 0 ? "FREE" : `€${shipping.toFixed(2)}`}
                    </span>
                  </div>
                  {/* Discount code */}
                  <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                    {appliedCode ? (
                      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ background: "#eef6ee", border: "1px solid #cfe6cf" }}>
                        <span className="font-sans text-xs font-semibold" style={{ color: "#007600" }}>
                          Code applied · {appliedCode.percent}% off
                        </span>
                        <button onClick={removeCode} className="font-sans text-xs underline shrink-0" style={{ color: "#555" }}>
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "#555" }}>Discount code</label>
                        <div className="flex gap-2">
                          <input
                            value={codeInput}
                            onChange={e => { setCodeInput(e.target.value); setCodeError(""); }}
                            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyCode(); } }}
                            placeholder="e.g. OG-ABCD2345"
                            className="flex-1 min-w-0 px-3 py-2 rounded-lg font-sans text-sm outline-none uppercase"
                            style={inputStyle}
                          />
                          <button onClick={applyCode} disabled={validatingCode || !codeInput.trim()}
                            className="shrink-0 font-sans text-xs font-bold px-4 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                            style={{ background: "#e7e7e7", border: "1px solid #ccc", color: "#111" }}>
                            {validatingCode ? "…" : "Apply"}
                          </button>
                        </div>
                        {codeError && <p className="font-sans text-xs mt-1" style={{ color: "#C7511F" }}>{codeError}</p>}
                      </div>
                    )}
                  </div>

                  <div className="pt-2" style={{ borderTop: "1px solid #EEE" }}>
                    <div className="flex justify-between font-sans font-bold text-base" style={{ color: "#0F1111" }}>
                      <span>Order total</span>
                      <span>€{grandTotal.toFixed(2)}</span>
                    </div>
                  </div>

                  {error && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{error}</p>}

                  <button onClick={handlePlaceOrder} disabled={placing}
                    className="hidden lg:block w-full font-sans text-sm font-bold py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
                    style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                    {placing ? "Redirecting to payment…" : `Continue to secure payment · €${grandTotal.toFixed(2)}`}
                  </button>
                  <div className="pt-1">
                    <TrustBadges compact />
                  </div>
                  <p className="font-sans text-xs text-center" style={{ color: "#888" }}>
                    By placing your order, you agree to our Terms &amp; Privacy Policy.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky checkout bar — keeps the CTA reachable without scrolling back up */}
      {user && items.length > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 px-3 py-3"
          style={{ background: "#fff", borderTop: "1px solid #DDD", boxShadow: "0 -2px 12px rgba(0,0,0,0.08)" }}>
          {error && <p className="font-sans text-xs mb-2 text-center" style={{ color: "#C7511F" }}>{error}</p>}
          <button onClick={handlePlaceOrder} disabled={placing}
            className="w-full font-sans text-sm font-bold py-3 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-60"
            style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
            {placing ? "Redirecting to payment…" : `Continue to secure payment · €${grandTotal.toFixed(2)}`}
          </button>
        </div>
      )}

      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default CheckoutPage;
