import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOrders, type Order } from "@/lib/userApi";
import PageSubNav, { ORDERS_NAV } from "@/components/PageSubNav";
import FooterSection from "@/components/sections/FooterSection";
import { DEFAULT_CONTENT } from "@/lib/defaults";

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

const MiniTracker = ({ order }: { order: Order }) => (
  <div className="flex items-center gap-1">
    {order.tracking.stages.map((stage, i) => {
      const done = i <= order.tracking.stage_index;
      const isLast = i === order.tracking.stages.length - 1;
      return (
        <div key={stage} className="flex items-center flex-1">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: done ? "#007600" : "#DDD" }} />
          {!isLast && <div className="flex-1 h-[2px]" style={{ background: i < order.tracking.stage_index ? "#007600" : "#DDD" }} />}
        </div>
      );
    })}
  </div>
);

const TrackOrderPage = () => {
  const { user, openAuthModal, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    fetchOrders().then(o => { setOrders(o); setLoading(false); });
  }, [user?.id]);

  const active = orders.filter(o => !o.tracking.delivered);
  const delivered = orders.filter(o => o.tracking.delivered);

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[112px]">
        <div className="max-w-4xl mx-auto px-3 sm:px-8 pt-6 sm:pt-8 pb-3">
          <h1 className="font-serif text-3xl font-bold" style={{ color: "#0F1111" }}>Track Order</h1>
          <div className="mt-3 mb-5" style={{ height: 1, background: "#DDD" }} />
        </div>

        <div className="max-w-4xl mx-auto px-3 sm:px-8 py-4 sm:py-6 space-y-4">
          {user && <PageSubNav items={ORDERS_NAV} />}

          {!authLoading && !user && (
            <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>Sign in to track your packages</h2>
              <button onClick={openAuthModal}
                className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                Sign in
              </button>
            </div>
          )}

          {user && loading && (
            <div className="bg-white rounded-xl p-10 text-center font-sans text-sm" style={{ color: "#555", border: "1px solid #DDD" }}>
              Loading your shipments…
            </div>
          )}

          {user && !loading && orders.length === 0 && (
            <div className="bg-white rounded-xl p-10 text-center" style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
              <h2 className="font-serif text-xl font-bold mb-2" style={{ color: "#0F1111" }}>No packages to track yet.</h2>
              <a href="/shop" className="font-sans text-sm hover:underline" style={{ color: "#C7511F" }}>Start shopping →</a>
            </div>
          )}

          {user && !loading && active.length > 0 && (
            <div className="space-y-3">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide" style={{ color: "#555" }}>
                On the way ({active.length})
              </p>
              {active.map(order => {
                const firstItem = order.items[0];
                return (
                  <div key={order.id} className="bg-white rounded-xl p-5 space-y-3"
                    style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-sans font-semibold text-base" style={{ color: order.status === "Cancelled" ? "#C7511F" : "#0F1111" }}>
                          {order.status}
                          {order.cancellation_status === "requested" && (
                            <span className="font-sans text-xs font-medium ml-2 px-2 py-0.5 rounded-full" style={{ background: "#fdf2e0", color: "#a88734" }}>
                              Cancellation requested
                            </span>
                          )}
                        </p>
                        <p className="font-sans text-xs" style={{ color: "#555" }}>
                          Order #{order.tracking_number} · Placed {formatDate(order.created_at)}
                        </p>
                      </div>
                      <button onClick={() => navigate(`/orders/${order.id}`)}
                        className="font-sans text-sm font-bold px-5 py-2 rounded-full transition-all hover:brightness-95 active:scale-95"
                        style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                        View full tracking
                      </button>
                    </div>
                    <MiniTracker order={order} />
                    <p className="font-sans text-sm truncate" style={{ color: "#555" }}>
                      {firstItem?.product_data?.name as string}
                      {order.items.length > 1 && ` + ${order.items.length - 1} more item${order.items.length - 1 > 1 ? "s" : ""}`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {user && !loading && delivered.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide" style={{ color: "#555" }}>
                Delivered ({delivered.length})
              </p>
              {delivered.map(order => (
                <div key={order.id} className="bg-white rounded-xl p-4 flex items-center justify-between gap-3"
                  style={{ border: "1px solid #DDD" }}>
                  <div>
                    <p className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Delivered</p>
                    <p className="font-sans text-xs" style={{ color: "#555" }}>Order #{order.tracking_number}</p>
                  </div>
                  <button onClick={() => navigate(`/orders/${order.id}`)}
                    className="font-sans text-sm hover:underline" style={{ color: "#007185" }}>
                    View details
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default TrackOrderPage;
