import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const COOKIE_KEY = "og_cookie_consent";

const CookieConsent = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(COOKIE_KEY);
    if (!saved) setVisible(true);
  }, []);

  const accept = () => {
    localStorage.setItem(COOKIE_KEY, "accepted");
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(COOKIE_KEY, "declined");
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
          className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:max-w-md z-[200]"
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
                  We use cookies to personalise content, remember your cart, and improve your experience. You can choose to accept or decline.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={accept}
                className="flex-1 font-display text-sm font-semibold py-2.5 rounded-full transition-all hover:opacity-90 active:scale-95"
                style={{
                  background: "var(--color-forest-dark)",
                  color: "var(--color-cream-text)",
                }}
              >
                Accept All
              </button>
              <button
                onClick={decline}
                className="flex-1 font-display text-sm font-semibold py-2.5 rounded-full transition-all hover:opacity-80"
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
