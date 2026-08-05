import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { subscribe, AlreadySubscribedError, type SubscribeDiscount } from "@/lib/api";
import { track } from "@/lib/analytics";
import { useAuth } from "@/contexts/AuthContext";
import useBodyScrollLock from "@/hooks/useBodyScrollLock";
import { cookieBannerAnswered } from "@/lib/cookieConsent";
import type { SubscribePopupContent } from "@/lib/defaults";
import RichText from "@/lib/richtext";
import { fillDiscountToken } from "@/lib/offerTokens";

// This device is done with the offer — never show it again. Set once the visitor
// has actually subscribed (the code is theirs; asking again is just noise), and
// honoured if it is already present: it is also the switch the e2e suites and
// anyone who opted out under the earlier build set by hand.
const DISMISSED_KEY = "og_subscribe_popup_dismissed";
// Already shown in this tab — the cheap first check, and the one that holds when
// two tabs open at the same instant and both read the visit record before either
// writes it.
const SEEN_KEY = "og_subscribe_popup_seen";
// When this visit began and when the modal last appeared, shared across every tab
// on the device. sessionStorage alone is per-TAB: a visitor with the shop open in
// three tabs got three modals in one sitting, which is the opposite of what
// "once per visit" means.
const VISIT_KEY = "og_subscribe_popup_visit";

// The analytics definition of a visit: page loads more than this far apart are
// separate visits; anything closer is the same one continuing — a reload, a
// second tab, a click through to another page. So the modal shows once per
// visit, and asks again next time they come back.
const VISIT_GAP_MS = 30 * 60 * 1000;

// A visitor who flicks the pointer at the toolbar in the first moment after
// landing hasn't decided to leave — they're still arriving.
const EXIT_INTENT_GRACE_MS = 4000;

interface VisitRecord {
  /** When the modal last appeared, on any tab. */
  lastShown: number;
  /** When a page on this site last loaded — how a visit's end is detected. */
  lastPing: number;
  /** When the current visit began. */
  visitStart: number;
}

const readVisit = (): VisitRecord => {
  try {
    const parsed = JSON.parse(localStorage.getItem(VISIT_KEY) || "{}") as Partial<VisitRecord>;
    return {
      lastShown: Number(parsed.lastShown) || 0,
      lastPing: Number(parsed.lastPing) || 0,
      visitStart: Number(parsed.visitStart) || 0,
    };
  } catch {
    return { lastShown: 0, lastPing: 0, visitStart: 0 };
  }
};

const writeVisit = (record: VisitRecord) => {
  try { localStorage.setItem(VISIT_KEY, JSON.stringify(record)); } catch { /* best effort */ }
};

// Above the cookie banner (110) and the cart drawer (120/130) so it is never
// half-buried, but below the sign-in modal (150): a visitor already partway
// through signing in must be able to finish.
const MODAL_Z = 140;

// Shared with the announcement bar and the policy pages, so every surface
// substitutes {discount} identically.
const fillDiscount = fillDiscountToken;

interface Props {
  data: SubscribePopupContent;
  /** False until the real popup settings load — see useContent. */
  ready?: boolean;
}

const SubscribePopupCard = ({ data, ready = true }: Props) => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [issued, setIssued] = useState<SubscribeDiscount | null>(null);
  const [wasAlready, setWasAlready] = useState(false);
  const [formError, setFormError] = useState("");
  // The address the code was sent to, echoed back in the success view so a typo
  // is obvious while it can still be fixed.
  const [sentTo, setSentTo] = useState("");
  const { user, loading: authLoading, showAuthModal } = useAuth();

  // Closing is for this visit only. The once-per-session flag (set the moment it
  // appears) is what stops it coming back before they leave; next visit it is
  // allowed to ask again. Subscribing is what retires it for good — see
  // handleSubmit. The business rules behind the code (one per mailbox, one
  // payable order) live on the server and are untouched by any of this.
  const dismiss = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (open) return;
    const skip = (why: string) => console.info(`[subscribe-popup] not showing: ${why}`);
    // The bundled default has the popup enabled, so scheduling it before the real
    // settings arrive would pop a card the admin had switched off.
    if (!ready) return;
    if (!data.enabled) return skip("disabled in admin settings");
    if (authLoading) return; // wait until we know whether this visitor is signed in
    if (user) return skip("visitor is signed in");
    if (showAuthModal) return; // mid sign-in — the effect re-runs when that closes
    let visitStart = Date.now();
    try {
      if (localStorage.getItem(DISMISSED_KEY)) return skip("already subscribed on this device");
      if (sessionStorage.getItem(SEEN_KEY)) return skip("already shown in this tab");

      // Where in the visit are we? A gap since the last page load means they went
      // away and came back — a new visit, and the modal is welcome to ask again.
      const now = Date.now();
      const visit = readVisit();
      const returning = !visit.lastPing || now - visit.lastPing > VISIT_GAP_MS;
      visitStart = returning ? now : (visit.visitStart || now);
      writeVisit({ ...visit, lastPing: now, visitStart });
      if (visit.lastShown >= visitStart) return skip("already shown this visit (another tab)");
    } catch {
      return; // storage unavailable — don't risk nagging on every load
    }

    let cancelled = false;
    let delayTimer: number | undefined;
    const landedAt = Date.now();

    // Only mark the frequency flags when the card genuinely appears — if the tab
    // is hidden when the timer fires, wait for it to come back.
    const reveal = () => {
      if (cancelled) return;
      if (document.hidden) {
        document.addEventListener("visibilitychange", onVisible);
        return;
      }
      cancelled = true; // whichever trigger got here first wins; the other stands down
      window.clearTimeout(delayTimer);
      document.removeEventListener("mouseout", onExitIntent);
      try { sessionStorage.setItem(SEEN_KEY, "1"); } catch { /* best effort */ }
      // Claim the visit for every other tab too, not just this one.
      const now = Date.now();
      writeVisit({ ...readVisit(), lastShown: now, lastPing: now, visitStart });
      setOpen(true);
    };
    const onVisible = () => {
      if (!document.hidden) {
        document.removeEventListener("visibilitychange", onVisible);
        reveal();
      }
    };

    // Second trigger: the pointer leaves through the top of the window (toward the
    // tab bar / address bar / close button). Catching someone on the way out is
    // the one moment the offer costs them nothing, so it pre-empts the timer.
    // relatedTarget is null only when the pointer left the document entirely —
    // moving between elements inside the page also fires mouseout.
    const onExitIntent = (e: MouseEvent) => {
      if (e.relatedTarget || (e as MouseEvent & { toElement?: unknown }).toElement) return;
      if (e.clientY > 8) return; // left sideways or downward — not a leave
      if (Date.now() - landedAt < EXIT_INTENT_GRACE_MS) return;
      reveal();
    };

    const showAfterDelay = () => {
      // Fires a few seconds after landing (admin-set), or the moment they head
      // for the exit — whichever comes first.
      delayTimer = window.setTimeout(reveal, Math.max(0, data.delay_seconds ?? 3) * 1000);
      document.addEventListener("mouseout", onExitIntent);
    };

    // Never a second dialog on top of a first: the cookie banner owns the screen
    // until it's answered, and a visitor partway through signing in must be left
    // to finish. Both resolve on their own, so wait them out rather than skipping.
    const clearToShow = () => cookieBannerAnswered();
    let poll: number | undefined;
    if (clearToShow()) {
      showAfterDelay();
    } else {
      poll = window.setInterval(() => {
        if (clearToShow()) { window.clearInterval(poll); showAfterDelay(); }
      }, 800);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(delayTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("mouseout", onExitIntent);
    };
  }, [ready, data.enabled, data.delay_seconds, user, authLoading, showAuthModal, open]);

  // The page behind a blocking dialog must hold still — otherwise a finger dragged
  // over the modal scrolls the storefront underneath it.
  useBodyScrollLock(open);

  // Keyboard handling for a modal dialog: Esc closes it (the keyboard equivalent
  // of the X), and Tab is kept inside the card — a focus ring wandering onto the
  // page behind a dialog that blocks the mouse is the worst of both worlds.
  const cardRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement;
    const focusables = () => Array.from(
      cardRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    // Land on the email field (or the close button in the success view) rather
    // than leaving focus stranded on whatever the visitor last touched.
    const first = cardRef.current?.querySelector<HTMLElement>("input") ?? focusables()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dismiss(); return; }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      if (document.activeElement === edge || !cardRef.current?.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0]).focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (returnFocusRef.current as HTMLElement | null)?.focus?.();
    };
  }, [open, dismiss]);

  // Signed-in customers are already past the "give us your email" stage.
  if (user) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setFormError("");
    setStatus("loading");
    const address = email.trim().toLowerCase();
    try {
      const { discount, alreadySubscribed } = await subscribe(address);
      track("newsletter_signup");
      setSentTo(address);
      setIssued(discount);
      setWasAlready(alreadySubscribed);
      setStatus("done");
      // They have their code — this device is done with the offer, for good. (The
      // server decides who a code is actually worth issuing to; this only stops
      // the modal reappearing.) DON'T auto-close: the success view holds the code,
      // so it stays up until they close it.
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

  return (
    <AnimatePresence>
      {open && (
        // Backdrop. It covers the storefront and swallows every click, so the
        // offer has to be answered or closed — it can't be scrolled past. Clicking
        // the backdrop deliberately does nothing: the X (or Esc) is the way out.
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          // pointerEvents goes dead the instant it starts leaving, not when the
          // fade finishes: a backdrop that still eats clicks while it dissolves
          // makes the page feel stuck right after the visitor closed it.
          exit={{ opacity: 0, pointerEvents: "none", transition: { duration: 0.2 } }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-label="Newsletter signup offer"
          className="fixed inset-0 flex items-center justify-center"
          style={{
            zIndex: MODAL_Z,
            background: "rgba(30,41,24,0.55)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            padding: 16,
            // Long content on a short phone screen scrolls inside the backdrop
            // rather than being clipped off the top with no way to reach it.
            overflowY: "auto",
          }}
        >
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0, y: 40, rotate: -4, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, rotate: -1, scale: 1 }}
          exit={{ opacity: 0, y: 30, rotate: 3, scale: 0.94, transition: { duration: 0.2 } }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="relative"
          style={{
            width: "min(380px, calc(100vw - 32px))",
            background: "var(--color-cream-card)",
            border: "2px solid var(--color-forest-dark)",
            borderRadius: 22,
            boxShadow: "6px 8px 0 rgba(30,41,24,0.28), 0 18px 48px rgba(30,41,24,0.22)",
            padding: "clamp(18px, 2vw, 24px)",
            overflow: "visible",
            margin: "auto",
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

          {/* Close. On a phone this is the only way out of a dialog that blocks the
              page, so the tap target is a full 44px (the storefront's baseline)
              even though the drawn circle stays small. */}
          <button
            onClick={dismiss}
            aria-label="Close signup offer"
            className="transition-transform hover:scale-110"
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 44,
              height: 44,
              border: "none",
              background: "transparent",
              padding: 0,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <span
              aria-hidden
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                border: "1.5px solid var(--color-forest-dark)",
                color: "var(--color-forest-dark)",
                fontSize: "0.85rem",
                lineHeight: 1,
                display: "grid",
                placeItems: "center",
              }}
            >
              ✕
            </span>
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
              {/* The code itself is never printed here. It goes to the mailbox and
                  nowhere else, so claiming the offer means owning the address —
                  otherwise the card is a code dispenser for anyone willing to type
                  a new made-up email. */}
              {issued ? (
                <p className="font-sans" style={{ color: "var(--color-forest-dark)", opacity: 0.8, fontSize: "0.8rem", lineHeight: 1.5, marginTop: 8 }}>
                  {issued.email_delivered
                    ? <>We've emailed your {issued.discount_percent}% off code to <strong>{sentTo}</strong> — check your inbox (and spam), then apply it at checkout. 📬</>
                    : <>We couldn't get the email through to <strong>{sentTo}</strong> just now. Check the address is right and sign up again, or get in touch and we'll sort it. 💌</>}
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
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SubscribePopupCard;
