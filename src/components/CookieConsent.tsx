import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cookieBannerAnswered, writeCookieConsent } from "@/lib/cookieConsent";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Unanswered — or answered so long ago the choice has lapsed. Either way the
    // visitor gets asked; see lib/cookieConsent for the interval.
    if (!cookieBannerAnswered()) setVisible(true);
  }, []);

  // The choice is recorded in storage (see lib/cookieConsent), which broadcasts
  // it so anything gated on consent reacts in this same moment rather than on
  // the next page load.
  //
  // What turns on it: the shop's own analytics measure everyone either way —
  // they are first-party and the data never leaves our server. Google Analytics
  // does not. If the owner has enabled GA4 (Admin → Analytics → Google
  // Analytics), Accept is what loads that tag and Decline is what keeps it off
  // for this visitor for good. See the header of src/lib/ga.ts.
  const accept = () => {
    writeCookieConsent("accepted");
    setVisible(false);
  };

  const decline = () => {
    writeCookieConsent("declined");
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          // Sits above ordinary page content but BELOW every overlay that asks the
          // visitor for something — cart drawer (120/130), auth modal (150),
          // feedback modal (200). At z-[200] this banner painted on top of the
          // sign-in dialog, and on a phone (`left-4 right-4`, ~150px tall, pinned
          // to the bottom) it landed squarely over the Sign In button, so a new
          // customer could not sign in until they dismissed a cookie notice that
          // looked unrelated. Below the modals, the modal backdrop simply covers
          // it and it returns once the modal closes.
          className="fixed left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[110]"
          // Clear of any bottom-anchored action bar (checkout's mobile pay bar
          // publishes its height as --bottom-bar-h). Pinned flush to the bottom it
          // covered that button outright, and `fixed` positioning meant no z-index
          // could save it — the banner simply ate every tap on the CTA.
          style={{ bottom: "calc(1rem + var(--bottom-bar-h, 0px))" }}
        >
          <div
            className="rounded-2xl p-5 shadow-xl"
            style={{
              background: "var(--color-cream-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            {/* Cookie icon */}
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0 mt-0.5">🍪</span>
              <div className="flex-1 min-w-0">
                <p
                  className="font-display text-base font-semibold mb-1"
                  style={{ color: "var(--color-forest-dark)" }}
                >
                  We use cookies
                </p>
                <p
                  className="font-sans text-sm leading-relaxed"
                  style={{ color: "rgba(30,41,24,0.65)" }}
                >
                  Cookies help The Olive Goose keep things smooth and personal.
                  Accept the vibe ✨ or decline — no pressure, no drama. We’ll
                  still be here, making candles for you.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={accept}
                className="og-tap justify-center flex-1 font-display text-sm font-semibold py-2.5 rounded-full transition-all hover:opacity-90 active:scale-95"
                style={{
                  background: "var(--color-forest-dark)",
                  color: "var(--color-cream-text)",
                }}
              >
                Accept All
              </button>
              <button
                onClick={decline}
                className="og-tap justify-center flex-1 font-display text-sm font-semibold py-2.5 rounded-full transition-all hover:opacity-80"
                style={{
                  background: "transparent",
                  color: "var(--color-forest-dark)",
                  border: "1.5px solid var(--color-forest-dark)",
                }}
              >
                Decline
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CookieConsent;
