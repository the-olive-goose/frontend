import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOrders, type Order } from "@/lib/userApi";
import PageSubNav, { ORDERS_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

const OrdersPage = () => {
  const { user, openAuthModal, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetchOrders().then(o => { setOrders(o); setLoading(false); });
  }, [user?.id]);

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-5xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Your Orders</h1>
          <div className="mt-3 mb-0" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-5xl mx-auto px-3 sm:px-8 py-4 sm:py-6">
          {user && <PageSubNav items={ORDERS_NAV} />}

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to see your orders</h2>
              <p className="font-sans text-sm mb-5" style={{ color: "#555" }}>
                Track packages, view order history and manage returns once you're signed in.
              </p>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in to your account
              </button>
            </div>
          )}

          {user && !loading && orders.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>You haven't placed any orders yet.</h2>
              <a href="/shop" className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>Start shopping →</a>
            </div>
          )}

          {user && loading && (
            <div className="bg-white rounded-xl p-10 text-center font-sans text-sm" style={{ color: "#555", border: "1px solid #DDD" }}>
              Loading your orders…
            </div>
          )}

          <div className="space-y-4">
            {orders.map(order => {
              const firstItem = order.items[0];
              const img = (firstItem?.product_data?.image_url as string) || FALLBACK_IMGS[0];
              const extraCount = order.items.length - 1;

              return (
                <div key={order.id} className="bg-white rounded-xl overflow-hidden"
                  style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>

                  <div className="px-5 py-3 flex flex-wrap gap-x-8 gap-y-2 items-center"
                    style={{ background: "#f8f8f8", borderBottom: "1px solid #EEE" }}>
                    <div>
                      <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Order placed</p>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{formatDate(order.created_at)}</p>
                    </div>
                    <div>
                      <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Total</p>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>€{Number(order.total).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Fulfillment</p>
                      <span className="inline-block font-sans text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5"
                        style={{
                          background: order.fulfillment_type === "pickup" ? "#eef6ee" : "#eef4f8",
                          color: order.fulfillment_type === "pickup" ? "#007600" : "#007185",
                        }}>
                        {order.fulfillment_type === "pickup" ? "Store Pickup" : "Delivery"}
                      </span>
                    </div>
                    <div className="flex-1" />
                    <div>
                      <p className="font-sans text-[11px] uppercase tracking-wide" style={{ color: "#555" }}>Order #</p>
                      <p className="font-sans text-sm font-semibold" style={{ color: "#0F1111" }}>{order.tracking_number}</p>
                    </div>
                  </div>

                  <div className="p-5 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                    <img src={img} alt="" className="rounded-lg object-cover shrink-0"
                      style={{ width: 72, height: 72, mixBlendMode: "multiply" }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-sans font-semibold text-base mb-1" style={{ color: order.status === "Cancelled" ? "#C7511F" : order.tracking.delivered ? "#007600" : "#0F1111" }}>
                        {order.status}
                        {order.cancellation_status === "requested" && (
                          <span className="font-sans text-xs font-medium ml-2 px-2 py-0.5 rounded-full" style={{ background: "#fdf2e0", color: "#a88734" }}>
                            Cancellation requested
                          </span>
                        )}
                      </p>
                      <p className="font-sans text-sm truncate" style={{ color: "#555" }}>
                        {firstItem?.product_data?.name as string}
                        {extraCount > 0 && ` + ${extraCount} more item${extraCount > 1 ? "s" : ""}`}
                      </p>
                    </div>
                    <button onClick={() => navigate(`/orders/${order.id}`)}
                      className="font-sans text-sm font-bold px-5 py-2 rounded-full transition-all hover:brightness-95 active:scale-95 shrink-0"
                      style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                      Track package
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default OrdersPage;
