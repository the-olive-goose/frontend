import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { subscribe, AlreadySubscribedError, type SubscribeDiscount } from "@/lib/api";
import { track } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { SubscribePopupContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { fillDiscountToken } from "@/lib/offerTokens";

// Explicitly dismissed (X) or already subscribed — never show again on this device.
const DISMISSED_KEY = "og_subscribe_popup_dismissed";
// Already shown this browsing session — show at most once per session.
const SEEN_KEY = "og_subscribe_popup_seen";

// Shared with the announcement bar and the policy pages, so every surface
// substitutes {discount} identically.
const fillDiscount = fillDiscountToken;

interface Props {
  data: SubscribePopupContent;
}

const SubscribePopupCard = ({ data }: Props) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [issued, setIssued] = useState<SubscribeDiscount | null>(null);
  const [wasAlready, setWasAlready] = useState(false);
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (open) return;
    const skip = (why: string) => console.info(`[subscribe-popup] not showing: ${why}`);
    if (!data.enabled) return skip("disabled in admin settings");
    if (authLoading) return; // wait until we know whether this visitor is signed in
    if (user) return skip("visitor is signed in");
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return skip("previously dismissed or subscribed");
      if (sessionStorage.getItem(SEEN_KEY)) return skip("already shown this session");
    } catch {
      return; // storage unavailable — don't risk nagging on every load
    }

    let cancelled = false;
    let delayTimer: number | undefined;

    // Only mark the once-per-session flag when the card genuinely appears —
    // if the tab is hidden when the timer fires, wait for it to come back.
    const reveal = () => {
      if (cancelled) return;
      if (document.hidden) {
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* best effort */ }
      setOpen(true);
    };
    const onVisible = () => {
      if (!document.hidden) {
        document.removeEventListener("visibilitychange", onVisible);
        reveal();
      }
    };
    const showAfterDelay = () => {
      delayTimer = window.setTimeout(reveal, Math.max(0, data.delay_seconds ?? 3) * 1000);
    };

    // The cookie banner owns the bottom of the viewport until it's answered —
    // hold the card back so the two never stack on top of each other.
    const cookieAnswered = () => {
      try { return !!localStorage.getItem("og_cookie_consent"); } catch { return true; }
    };
    let poll: number | undefined;
    if (cookieAnswered()) {
      showAfterDelay();
    } else {
      poll = window.setInterval(() => {
        if (cookieAnswered()) { window.clearInterval(poll); showAfterDelay(); }
      }, 800);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(delayTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [data.enabled, data.delay_seconds, user, authLoading, open]);

  // Signed-in customers are already past the "give us your email" stage.
  if (user) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* best effort */ }
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setFormError("");
    setStatus("loading");
    try {
      const { discount, alreadySubscribed } = await subscribe(email.trim().toLowerCase());
      track("newsletter_signup");
      setIssued(discount);
      setWasAlready(alreadySubscribed);
      setStatus("done");
      // Subscribed for good — don't nag them again. But DON'T auto-close: the
      // success view holds their discount code, so leave it up until they close it.
      try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* best effort */ }
    } catch (err: unknown) {
      setStatus("idle");
      // Already subscribed with nothing left to give → keep the card open so they
      // can try a different email rather than being shut out.
      if (err instanceof AlreadySubscribedError) {
        setFormError(err.alreadyUsed
          ? "You've already used your welcome offer. Try another email? 💌"
          : "That email's already on the list — try another? 💌");
      } else {
        setFormError("Something went wrong — please try again.");
      }
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Couldn't copy", description: `Your code is ${code}` });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: 90, rotate: -6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, rotate: -1.5, scale: 1 }}
          exit={{ opacity: 0, y: 60, rotate: 4, scale: 0.92, transition: { duration: 0.25 } }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          role="dialog"
          aria-label="Newsletter signup offer"
          className="fixed bottom-4 left-4 z-[70]"
          style={{
            width: "min(330px, calc(100vw - 32px))",
            background: "var(--color-cream-card)",
            border: "2px solid var(--color-forest-dark)",
            borderRadius: 22,
            boxShadow: "6px 8px 0 rgba(30,41,24,0.28), 0 18px 48px rgba(30,41,24,0.22)",
            padding: "clamp(18px, 2vw, 24px)",
            overflow: "visible",
          }}
        >
          {/* Discount sticker — peeks over the top-left corner */}
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: -10 }}
            transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 14 }}
            aria-hidden
            style={{
              position: "absolute",
              top: -18,
              left: -12,
              background: "var(--color-forest-dark)",
              color: "var(--color-cream-text)",
              fontFamily: "'Fredoka', sans-serif",
              fontWeight: 600,
              fontSize: "0.95rem",
              padding: "8px 14px",
              borderRadius: 999,
              boxShadow: "0 6px 16px rgba(30,41,24,0.35)",
              letterSpacing: "0.02em",
            }}
          >
            {data.discount_percent}% OFF
          </motion.div>

          {/* Close */}
          <button
            onClick={dismiss}
            aria-label="Close signup offer"
            className="transition-transform hover:scale-110"
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 28,
              height: 28,
              borderRadius: "50%",
              border: "1.5px solid var(--color-forest-dark)",
              background: "transparent",
              color: "var(--color-forest-dark)",
              cursor: "pointer",
              fontSize: "0.85rem",
              lineHeight: 1,
              display: "grid",
              placeItems: "center",
            }}
          >
            ✕
          </button>

          {status === "done" ? (
            <div style={{ padding: "16px 4px 6px", textAlign: "center" }}>
              <p style={{ fontSize: "1.9rem", marginBottom: 6 }}>{wasAlready ? "💚" : "🎉"}</p>
              <p
                className="font-serif"
                style={{ color: "var(--color-forest-dark)", fontSize: "1.15rem", lineHeight: 1.3 }}
              >
                {wasAlready ? "You're already on the list!" : <RichText text={fillDiscount(data.success_text, data.discount_percent)} />}
              </p>
              {issued?.code ? (
                <>
                  <p className="font-sans" style={{ color: "var(--color-forest-dark)", opacity: 0.75, fontSize: "0.78rem", lineHeight: 1.45, margin: "8px 0 8px" }}>
                    Here's your {issued.discount_percent}% off code — use it at checkout.
                    {issued.email_delivered ? " We've emailed it too. 📬" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => copyCode(issued.code!)}
                    aria-label={`Copy discount code ${issued.code}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 8,
                      fontFamily: "'Fredoka', sans-serif", fontSize: "1.05rem", letterSpacing: "0.12em",
                      background: "rgba(255,255,255,0.65)", color: "var(--color-forest-dark)",
                      border: "1.5px dashed var(--color-forest-dark)", borderRadius: 12,
                      padding: "10px 16px", cursor: "pointer",
                    }}
                  >
                    <strong>{issued.code}</strong>
                    <span style={{ fontSize: "0.7rem", opacity: 0.8, letterSpacing: "normal" }}>
                      {copied ? "copied ✓" : "tap to copy"}
                    </span>
                  </button>
                </>
              ) : issued ? (
                <p className="font-sans" style={{ color: "var(--color-forest-dark)", opacity: 0.8, fontSize: "0.8rem", lineHeight: 1.5, marginTop: 8 }}>
                  We've emailed your {issued.discount_percent}% off code — check your inbox (and spam) and apply it at checkout. 📬
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <p
                style={{
                  fontFamily: "'Permanent Marker', cursive",
                  fontSize: "0.72rem",
                  color: "var(--color-sage-light)",
                  transform: "rotate(-1deg)",
                  marginTop: 10,
                }}
              >
                <RichText text={fillDiscount(data.eyebrow, data.discount_percent)} />
              </p>
              <h3
                className="font-serif"
                style={{
                  color: "var(--color-forest-dark)",
                  fontSize: "1.45rem",
                  lineHeight: 1.15,
                  margin: "6px 0 8px",
                }}
              >
                <RichText text={fillDiscount(data.headline, data.discount_percent)} />
              </h3>
              <p
                className="font-sans"
                style={{ color: "var(--color-forest-dark)", opacity: 0.75, fontSize: "0.85rem", lineHeight: 1.5 }}
              >
                <RichText text={fillDiscount(data.subtext, data.discount_percent)} />
              </p>

              <form onSubmit={handleSubmit} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); if (formError) setFormError(""); }}
                  placeholder={fillDiscount(data.placeholder, data.discount_percent)}
                  className="font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  style={{
                    padding: "11px 16px",
                    borderRadius: "var(--radius-input)",
                    border: "1.5px solid rgba(30,41,24,0.25)",
                    background: "rgba(255,255,255,0.6)",
                    color: "var(--color-forest-dark)",
                  }}
                />
                <motion.button
                  type="submit"
                  disabled={status === "loading"}
                  whileHover={{ scale: 1.03, y: -1 }}
                  whileTap={{ scale: 0.97 }}
                  className="font-sans text-sm font-medium disabled:opacity-60"
                  style={{
                    fontFamily: "'Fredoka', sans-serif",
                    padding: "11px 20px",
                    borderRadius: "var(--radius-pill)",
                    background: "var(--color-forest-dark)",
                    color: "var(--color-cream-text)",
                    border: "none",
                    cursor: "pointer",
                    boxShadow: "0 6px 18px rgba(30,41,24,0.25)",
                  }}
                >
                  {status === "loading" ? "..." : fillDiscount(data.cta_text, data.discount_percent)}
                </motion.button>
              </form>
              {formError && (
                <p className="font-sans" role="alert" style={{ color: "#b0361f", fontSize: "0.76rem", marginTop: 8, textAlign: "center" }}>
                  {formError}
                </p>
              )}
              <p
                style={{
                  fontFamily: "'Permanent Marker', cursive",
                  fontSize: "0.62rem",
                  color: "var(--color-sage-light)",
                  textAlign: "center",
                  marginTop: 10,
                  transform: "rotate(-0.5deg)",
                }}
              >
                unsubscribe whenever, no hard feelings 🫶
              </p>
            </>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default SubscribePopupCard;
