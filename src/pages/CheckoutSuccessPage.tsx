import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { getCheckoutSession } from "@/lib/userApi";
import FooterSection from "@/components/sections/FooterSection";

// Stripe redirects here after a successful payment. The order isn't guaranteed
// to exist the instant we land — the webhook (or this page's own poll, which
// finalizes it too) needs a moment — so we poll briefly and then hand off to
// the normal order tracking page.
const POLL_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 20; // ~30s

const CheckoutSuccessPage = () => {
  const { user, loading: authLoading } = useAuth();
  const { clearCart } = useCart();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = searchParams.get("session_id");

  const [status, setStatus] = useState<"confirming" | "timed_out" | "error">("confirming");
  const [errorMessage, setErrorMessage] = useState("");
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!user || !sessionId) return;
    let cancelled = false;

    const poll = async () => {
      attemptsRef.current += 1;
      try {
        const result = await getCheckoutSession(sessionId);
        if (cancelled) return;
        if ("id" in result) {
          await clearCart();
          navigate(`/orders/${result.id}`, { replace: true });
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Could not check payment status");
        return;
      }
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setStatus("timed_out");
        return;
      }
      setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
    return () => { cancelled = true; };
  }, [user, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen" style={{ background: "#f3f3f3" }}>
      <div className="pt-[var(--nav-h,112px)]">
        <div className="max-w-2xl mx-auto px-3 sm:px-8 py-16">
          <div className="bg-white rounded-xl p-10 text-center space-y-4"
            style={{ border: "1px solid #DDD", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>

            {!sessionId && (
              <>
                <h1 className="font-serif text-2xl font-bold" style={{ color: "#0F1111" }}>Missing payment reference</h1>
                <p className="font-sans text-sm" style={{ color: "#555" }}>
                  We couldn't find a payment session to confirm. If you completed a payment, check{" "}
                  <a href="/orders" className="hover:underline" style={{ color: "#007185" }}>your orders</a>.
                </p>
              </>
            )}

            {sessionId && !authLoading && !user && (
              <p className="font-sans text-sm" style={{ color: "#555" }}>Please sign in to confirm your payment.</p>
            )}

            {sessionId && (authLoading || (user && status === "confirming")) && (
              <>
                <div className="mx-auto w-10 h-10 rounded-full border-4 animate-spin"
                  style={{ borderColor: "#f0c14b", borderTopColor: "transparent" }} />
                <h1 className="font-serif text-2xl font-bold" style={{ color: "#0F1111" }}>Confirming your payment…</h1>
                <p className="font-sans text-sm" style={{ color: "#555" }}>
                  This only takes a few seconds. Please don't close this page.
                </p>
              </>
            )}

            {sessionId && user && status === "timed_out" && (
              <>
                <h1 className="font-serif text-2xl font-bold" style={{ color: "#0F1111" }}>Still confirming…</h1>
                <p className="font-sans text-sm" style={{ color: "#555" }}>
                  Your payment is taking longer than usual to confirm. If it succeeded, your order will appear in{" "}
                  <a href="/orders" className="hover:underline" style={{ color: "#007185" }}>your orders</a> shortly.
                </p>
                <button onClick={() => { attemptsRef.current = 0; setStatus("confirming"); }}
                  className="font-sans text-sm font-bold px-6 py-2.5 rounded-full transition-all hover:brightness-95 active:scale-95"
                  style={{ background: "#f0c14b", border: "1px solid #a88734", color: "#111" }}>
                  Check again
                </button>
              </>
            )}

            {sessionId && user && status === "error" && (
              <>
                <h1 className="font-serif text-2xl font-bold" style={{ color: "#0F1111" }}>Couldn't confirm payment</h1>
                <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{errorMessage}</p>
                <p className="font-sans text-sm" style={{ color: "#555" }}>
                  If you were charged, your order will still appear in{" "}
                  <a href="/orders" className="hover:underline" style={{ color: "#007185" }}>your orders</a>.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      <FooterSection />
    </div>
  );
};

export default CheckoutSuccessPage;
