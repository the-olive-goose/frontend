import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { fetchOrder, requestOrderCancellation, SessionExpiredError, type Order } from "@/lib/userApi";
import { useAuth } from "@/contexts/AuthContext";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { formatPrice } from "@/lib/cart";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

const STAGE_ICONS: Record<string, JSX.Element> = {
  "Order Placed": (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M9 12l2 2 4-4" /><circle cx="12" cy="12" r="9" />
    </svg>
  ),
  Processing: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" />
    </svg>
  ),
  Shipped: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <rect x="1" y="6" width="13" height="11" rx="1" /><path d="M14 10h4l3 3v4h-7z" />
      <circle cx="6" cy="19" r="1.6" /><circle cx="17" cy="19" r="1.6" />
    </svg>
  ),
  "Out for Delivery": (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 12h13M13 6l6 6-6 6" />
    </svg>
  ),
  Delivered: (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  "Preparing Order": (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" />
    </svg>
  ),
  "Ready for Pickup": (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6" />
    </svg>
  ),
  "Picked Up": (
    <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
};

const CANCELLATION_LABEL: Record<Order["cancellation_status"], string> = {
  none: "",
  requested: "Cancellation requested — awaiting review",
  approved: "Cancellation approved",
  rejected: "Cancellation request declined",
};

const OrderTrackingPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading, requireAuth } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    if (!id || !user) return;
    fetchOrder(id).then(o => { setOrder(o); setLoading(false); });
    // Refresh periodically so tracking updates made by an admin appear without a manual reload.
    const interval = setInterval(() => fetchOrder(id).then(o => o && setOrder(o)), 15000);
    return () => clearInterval(interval);
  }, [id, user?.id]);

  const handleCancel = async () => {
    if (!id) return;
    setCancelling(true);
    setCancelError("");
    try {
      const updated = await requestOrderCancellation(id, cancelReason.trim());
      setOrder(updated);
      setShowCancelForm(false);
      setCancelReason("");
    } catch (err) {
      if (err instanceof SessionExpiredError) requireAuth(handleCancel);
      else setCancelError(err instanceof Error ? err.message : "Could not request cancellation");
    } finally {
      setCancelling(false);
    }
  };

  const addr = order?.shipping_address as Record<string, string> | undefined;
  const isPickup = order?.fulfillment_type === "pickup";
  const discountAmount = order ? Number(order.discount_amount) : 0;
  const isCancelled = order?.status === "Cancelled";

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[112px]">
        <div className="max-w-4xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <button onClick={() => navigate("/orders")}
            className="font-sans text-sm mb-2 hover:underline transition-colors" style={{ color: "#007185" }}>
            ← Back to Your Orders
          </button>
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Track Order</h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-4xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center font-sans text-sm" style={{ color: "#555", border: "1px solid #DDD" }}>
              Please sign in to view this order.
            </div>
          )}

          {user && loading && (
            <div className="bg-white rounded-xl p-10 text-center font-sans text-sm" style={{ color: "#555", border: "1px solid #DDD" }}>
              Loading order…
            </div>
          )}

          {user && !loading && !order && (
            <div className="bg-white rounded-xl p-10 text-center font-sans text-sm" style={{ color: "#555", border: "1px solid #DDD" }}>
              We couldn't find that order.
            </div>
          )}

          {order && (
            <>
              {/* Summary */}
              <div className="bg-white rounded-xl p-5 flex flex-wrap gap-x-8 gap-y-3"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Order placed</p>
                  <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{formatDate(order.created_at)}</p>
                </div>
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Order #</p>
                  <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{order.tracking_number}</p>
                </div>
                <div>
                  <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Total</p>
                  <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>€{Number(order.total).toFixed(2)}</p>
                </div>
                {discountAmount > 0 && (
                  <div>
                    <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Pickup savings</p>
                    <p className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>
                      −€{discountAmount.toFixed(2)} ({Number(order.discount_percent)}%)
                    </p>
                  </div>
                )}
                {isPickup ? (
                  <div>
                    <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Pickup from</p>
                    <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                      {addr?.location_name}, {addr?.city}
                    </p>
                  </div>
                ) : addr?.address_line1 && (
                  <div>
                    <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Shipping to</p>
                    <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>
                      {addr.address_line1}, {addr.city}
                    </p>
                  </div>
                )}
              </div>

              {isPickup && addr && (
                <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm font-semibold mb-1" style={{ color: "#0F1111" }}>Pickup location</p>
                  <p className="font-sans text-sm" style={{ color: "#555" }}>
                    {addr.address_line1}, {addr.city} {addr.eircode}, {addr.country}
                  </p>
                  {addr.hours && <p className="font-sans text-xs mt-1" style={{ color: "#007185" }}>{addr.hours}</p>}
                  {addr.contact_phone && (
                    <p className="font-sans text-xs mt-1" style={{ color: "#555" }}>Contact: {addr.contact_name} · {addr.contact_phone}</p>
                  )}
                </div>
              )}

              {/* Cancellation status */}
              {order.cancellation_status !== "none" && (
                <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm font-semibold" style={{
                    color: order.cancellation_status === "approved" ? "#C7511F" : order.cancellation_status === "rejected" ? "#555" : "#a88734",
                  }}>
                    {CANCELLATION_LABEL[order.cancellation_status]}
                  </p>
                  {order.refund_status === "pending" && (
                    <p className="font-sans text-xs mt-1" style={{ color: "#555" }}>
                      Your refund is being processed and we'll confirm once it's done.
                    </p>
                  )}
                </div>
              )}

              {/* Tracker */}
              <div className="bg-white rounded-xl p-6 sm:p-8"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                {isCancelled ? (
                  <p className="font-serif text-lg font-bold" style={{ color: "#C7511F" }}>This order was cancelled</p>
                ) : (
                  <>
                    <p className="font-serif text-lg font-bold mb-6" style={{ color: order.tracking.delivered ? "#007600" : "#0F1111" }}>
                      {order.tracking.delivered
                        ? (isPickup ? "Picked up" : "Delivered")
                        : isPickup
                          ? `Getting your order ready — currently: ${order.status}`
                          : `Arriving soon — currently: ${order.status}`}
                    </p>

                    <div className="flex items-start">
                      {order.tracking.stages.map((stage, i) => {
                        const done = i <= order.tracking.stage_index;
                        const isLast = i === order.tracking.stages.length - 1;
                        return (
                          <div key={stage} className="flex-1 flex flex-col items-center relative">
                            {!isLast && (
                              <div className="absolute top-5 left-1/2 w-full h-[3px]"
                                style={{ background: i < order.tracking.stage_index ? "#007600" : "#DDD" }} />
                            )}
                            <div className="w-10 h-10 rounded-full flex items-center justify-center relative z-10 shrink-0"
                              style={{
                                background: done ? "#007600" : "#f0f0f0",
                                color: done ? "#fff" : "#999",
                                border: done ? "none" : "1px solid #DDD",
                              }}>
                              {STAGE_ICONS[stage]}
                            </div>
                            <p className="font-sans text-xs text-center mt-2 px-1"
                              style={{ color: done ? "#0F1111" : "#999", fontWeight: done ? 600 : 400 }}>
                              {stage}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>

              {/* Cancel order */}
              {order.cancellation_eligible && (
                <div className="bg-white rounded-xl p-5" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  {!showCancelForm ? (
                    <div className="flex items-center justify-between gap-4">
                      <p className="font-sans text-sm" style={{ color: "#555" }}>Changed your mind?</p>
                      <button onClick={() => setShowCancelForm(true)}
                        className="font-sans text-sm font-semibold hover:underline" style={{ color: "#C7511F" }}>
                        Cancel this order
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>Request cancellation</p>
                      <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2}
                        placeholder="Tell us why (optional)…"
                        className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none resize-none"
                        style={{ border: "1px solid #DDD" }} />
                      {cancelError && <p className="font-sans text-xs" style={{ color: "#C7511F" }}>{cancelError}</p>}
                      <div className="flex items-center gap-3">
                        <button onClick={handleCancel} disabled={cancelling}
                          className="font-sans text-sm font-bold px-5 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 disabled:opacity-50"
                          style={{ background: "#C7511F", color: "#fff" }}>
                          {cancelling ? "Submitting…" : "Confirm cancellation request"}
                        </button>
                        <button onClick={() => { setShowCancelForm(false); setCancelError(""); }}
                          className="font-sans text-sm hover:underline" style={{ color: "#555" }}>
                          Never mind
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Items */}
              <div className="bg-white rounded-xl overflow-hidden"
                style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                <p className="font-sans text-sm font-semibold px-5 py-3" style={{ color: "#0F1111", borderBottom: "1px solid #EEE" }}>
                  Items in this order
                </p>
                {order.items.map((item, i) => {
                  const data = item.product_data as { name?: string; price?: string; image_url?: string };
                  return (
                    <div key={item.product_id} className="flex items-center gap-4 px-5 py-4"
                      style={{ borderBottom: i < order.items.length - 1 ? "1px solid #EEE" : "none" }}>
                      <img src={data.image_url || FALLBACK_IMGS[i % 2]} alt={data.name || ""}
                        className="rounded-lg object-cover shrink-0" style={{ width: 56, height: 56, mixBlendMode: "multiply" }} />
                      <div className="flex-1 min-w-0">
                        <p className="font-sans text-sm font-semibold truncate" style={{ color: "#0F1111" }}>{data.name}</p>
                        <p className="font-sans text-xs" style={{ color: "#555" }}>Qty: {item.quantity}</p>
                      </div>
                      <p className="font-sans text-sm font-semibold shrink-0" style={{ color: "#0F1111" }}>{formatPrice(data.price)}</p>
                    </div>
                  );
                })}
              </div>

              {order.tracking.delivered && (
                <div className="bg-white rounded-xl p-5 flex items-center justify-between gap-4"
                  style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm" style={{ color: "#555" }}>Not quite right?</p>
                  <button onClick={() => navigate("/returns")}
                    className="font-sans text-sm font-semibold hover:underline" style={{ color: "#007185" }}>
                    Return or replace items →
                  </button>
                </div>
              )}

              {/* Timeline */}
              {order.timeline && order.timeline.length > 0 && (
                <div className="bg-white rounded-xl overflow-hidden"
                  style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                  <p className="font-sans text-sm font-semibold px-5 py-3" style={{ color: "#0F1111", borderBottom: "1px solid #EEE" }}>
                    Order history
                  </p>
                  {[...order.timeline].reverse().map((event, i) => (
                    <div key={event.id} className="px-5 py-3"
                      style={{ borderBottom: i < order.timeline!.length - 1 ? "1px solid #EEE" : "none" }}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{event.title}</p>
                        <p className="font-sans text-xs shrink-0" style={{ color: "#999" }}>
                          {new Date(event.created_at).toLocaleString()}
                        </p>
                      </div>
                      {event.detail && (
                        <p className="font-sans text-sm mt-0.5 whitespace-pre-wrap" style={{ color: "#555" }}>{event.detail}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default OrderTrackingPage;
