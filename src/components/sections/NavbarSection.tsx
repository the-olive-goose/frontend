import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { NavbarContent, AnnouncementBarContent } from "@/lib/defaults";
import { getShopCategories, type ShopCategory } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import CartDrawer from "@/components/CartDrawer";
import logo from "@/assets/logo.jpg";

interface Props {
  data: NavbarContent;
  announcement: AnnouncementBarContent;
}

// ── Announcement bar ───────────────────────────────────────────────────────────

const AnnouncementBar = ({ data }: { data: AnnouncementBarContent }) => {
  const messages = data.messages?.length ? data.messages : ["Free shipping on orders over €65"];
  const interval = data.interval_ms ?? 3000;
  const [current, setCurrent] = useState(0);
  const [phase, setPhase]     = useState<"enter" | "show" | "exit">("enter");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cycle = () => {
      setPhase("exit");
      timerRef.current = setTimeout(() => {
        setCurrent(c => (c + 1) % messages.length);
        setPhase("enter");
        timerRef.current = setTimeout(() => {
          setPhase("show");
          timerRef.current = setTimeout(cycle, interval - 650);
        }, 350);
      }, 300);
    };
    setPhase("enter");
    timerRef.current = setTimeout(() => {
      setPhase("show");
      timerRef.current = setTimeout(cycle, interval - 650);
    }, 350);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [messages.length, interval]);

  const cls = phase === "enter" ? "announce-enter" : phase === "exit" ? "announce-exit" : "";

  return (
    <div className="w-full py-2 px-4 flex items-center justify-center overflow-hidden"
      style={{ background: "var(--bg-announce)", minHeight: "34px" }}>
      <p key={current} className={`font-display text-xs tracking-wide text-center ${cls}`}
        style={{ color: "var(--color-white)" }}>
        {messages[current]}
      </p>
    </div>
  );
};

// ── Shop dropdown ──────────────────────────────────────────────────────────────

const ShopDropdown = ({ categories, onClose }: {
  categories: ShopCategory[];
  onClose: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 8, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 6, scale: 0.97 }}
    transition={{ duration: 0.18, ease: "easeOut" }}
    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50"
    style={{ minWidth: 220 }}
  >
    {/* Arrow */}
    <div className="flex justify-center mb-1">
      <div className="w-3 h-3 rotate-45" style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", marginBottom: -8, position: "relative", zIndex: 0 }} />
    </div>
    <div
      className="rounded-xl overflow-hidden py-2"
      style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", boxShadow: "0 12px 36px rgba(0,0,0,0.14)" }}
    >
      {/* All candles link */}
      <a
        href="/shop"
        onClick={onClose}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors group"
      >
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "var(--color-forest-dark)" }} />
        <span className="font-display text-sm" style={{ color: "var(--color-forest-dark)" }}>All candles</span>
      </a>

      {categories.length > 0 && (
        <div className="my-1.5 mx-4" style={{ height: 1, background: "var(--color-border)" }} />
      )}

      {/* Category links */}
      {categories.map(cat => (
        <a
          key={cat.id}
          href={`/shop?category=${cat.slug}`}
          onClick={onClose}
          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors"
        >
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.accent_color }} />
          <div className="min-w-0">
            <span className="font-display text-sm block truncate" style={{ color: "var(--color-forest-dark)" }}>
              {cat.name}
            </span>
            {cat.mood_description && (
              <span className="font-sans text-xs block truncate" style={{ color: "rgba(30,41,24,0.5)" }}>
                {cat.mood_description}
              </span>
            )}
          </div>
        </a>
      ))}
    </div>
  </motion.div>
);

// ── Main Navbar ────────────────────────────────────────────────────────────────

const NavbarSection = ({ data, announcement }: Props) => {
  const [mobileOpen, setMobileOpen]   = useState(false);
  const [shopOpen, setShopOpen]       = useState(false);
  const [mobileShopOpen, setMobileShopOpen] = useState(false);
  const [categories, setCategories]   = useState<ShopCategory[]>([]);
  const links = data.links ?? [];
  const shopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user, signOut, openAuthModal } = useAuth();

  useEffect(() => {
    getShopCategories().then(cats => setCategories(cats)).catch(() => {});
  }, []);

  const openShop  = () => { if (shopTimerRef.current) clearTimeout(shopTimerRef.current); setShopOpen(true); };
  const closeShop = () => { shopTimerRef.current = setTimeout(() => setShopOpen(false), 120); };

  // Detect if a link is the Shop link
  const isShopLink = (href: string) => href === "/shop" || href.startsWith("/shop?");

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <AnnouncementBar data={announcement} />

      <nav style={{ background: "var(--bg-nav)" }}>
        <div className="max-w-7xl mx-auto px-6 sm:px-8 py-2 flex items-center justify-between gap-6">

          {/* Logo */}
          <a href="/" className="shrink-0 group">
            <img src={logo} alt="The Olive Goose"
              className="transition-transform group-hover:scale-105 duration-300"
              style={{ height: 40, width: "auto", objectFit: "contain" }} />
          </a>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-8">
            {links.map((link, i) => {
              if (isShopLink(link.href)) {
                return (
                  <div
                    key={`shop-${i}`}
                    className="relative"
                    onMouseEnter={openShop}
                    onMouseLeave={closeShop}
                  >
                    {/* Shop link + dots trigger */}
                    <a
                      href="/shop"
                      className="flex items-center gap-1.5 font-display text-base transition-all hover:opacity-80 relative group"
                      style={{ color: "var(--color-white)", letterSpacing: "var(--tracking-nav)" }}
                    >
                      {link.label}
                      {/* Three dots indicator */}
                      <span
                        className="flex items-center gap-[3px] opacity-70 group-hover:opacity-100 transition-opacity"
                        style={{ transform: "translateY(1px)" }}
                      >
                        {[0,1,2].map(d => (
                          <span key={d} className="block rounded-full" style={{ width: 3, height: 3, background: "var(--color-white)", opacity: shopOpen ? 1 : 0.75 }} />
                        ))}
                      </span>
                      <span className="absolute -bottom-0.5 left-0 w-0 h-px transition-all duration-300 group-hover:w-full"
                        style={{ background: "var(--color-white)" }} />
                    </a>

                    {/* Dropdown */}
                    <AnimatePresence>
                      {shopOpen && (
                        <ShopDropdown categories={categories} onClose={() => setShopOpen(false)} />
                      )}
                    </AnimatePresence>
                  </div>
                );
              }

              return (
                <a
                  key={`${link.label}-${i}`}
                  href={link.href}
                  className="font-display text-base transition-all hover:opacity-70 relative group"
                  style={{ color: "var(--color-white)", letterSpacing: "var(--tracking-nav)" }}
                >
                  {link.label}
                  <span className="absolute -bottom-0.5 left-0 w-0 h-px transition-all duration-300 group-hover:w-full"
                    style={{ background: "var(--color-white)" }} />
                </a>
              );
            })}
          </div>

          {/* Desktop right controls */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            {user ? (
              <>
                {/* Cart drawer trigger */}
                <CartDrawer />

                {/* User avatar + logout */}
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-display text-xs font-semibold shrink-0"
                    style={{ background: "var(--btn-primary-bg)", color: "var(--color-forest-dark)" }}
                    title={user.email ?? ""}
                  >
                    {(user.user_metadata?.full_name?.[0] ?? user.email?.[0] ?? "U").toUpperCase()}
                  </div>
                  <button
                    onClick={() => signOut()}
                    className="font-display text-sm transition-all hover:opacity-70"
                    style={{ color: "var(--color-white)" }}
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <button
                onClick={openAuthModal}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95 font-display"
                style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", borderRadius: "var(--radius-pill)" }}
              >
                Sign In
              </button>
            )}
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--color-white)" }} aria-label="Toggle menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }}
              className="md:hidden border-t overflow-hidden"
              style={{ background: "var(--bg-nav)", borderColor: "rgba(255,255,255,0.18)" }}
            >
              <div className="px-6 py-5 space-y-1">
                {links.map((link, i) => {
                  if (isShopLink(link.href)) {
                    return (
                      <div key={`m-shop-${i}`}>
                        <div className="flex items-center justify-between py-2">
                          <a href="/shop" onClick={() => setMobileOpen(false)}
                            className="font-display text-base transition-opacity hover:opacity-70"
                            style={{ color: "var(--color-white)" }}>
                            {link.label}
                          </a>
                          <button onClick={() => setMobileShopOpen(o => !o)}
                            className="font-sans text-xs px-2 py-1 rounded opacity-70 hover:opacity-100"
                            style={{ color: "var(--color-white)", border: "1px solid rgba(255,255,255,0.3)" }}>
                            {mobileShopOpen ? "▲" : "▼"} Categories
                          </button>
                        </div>

                        {/* Mobile category list */}
                        <AnimatePresence>
                          {mobileShopOpen && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18 }}
                              className="overflow-hidden pl-4 space-y-1 pb-2"
                            >
                              <a href="/shop" onClick={() => setMobileOpen(false)}
                                className="flex items-center gap-2 py-1.5 font-sans text-sm transition-opacity hover:opacity-70"
                                style={{ color: "rgba(245,239,230,0.8)" }}>
                                <span className="block w-2 h-2 rounded-full shrink-0" style={{ background: "rgba(245,239,230,0.5)" }} />
                                All candles
                              </a>
                              {categories.map(cat => (
                                <a key={cat.id} href={`/shop?category=${cat.slug}`}
                                  onClick={() => setMobileOpen(false)}
                                  className="flex items-center gap-2 py-1.5 font-sans text-sm transition-opacity hover:opacity-70"
                                  style={{ color: "rgba(245,239,230,0.8)" }}>
                                  <span className="block w-2 h-2 rounded-full shrink-0" style={{ background: cat.accent_color }} />
                                  {cat.name}
                                </a>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  }

                  return (
                    <a key={`m-${link.label}-${i}`} href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="font-display block py-2 text-base transition-opacity hover:opacity-70"
                      style={{ color: "var(--color-white)" }}>
                      {link.label}
                    </a>
                  );
                })}

                <div className="pt-3">
                  {user ? (
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-sm" style={{ color: "rgba(245,239,230,0.7)" }}>
                        {user.user_metadata?.full_name ?? user.email}
                      </span>
                      <button
                        onClick={() => { signOut(); setMobileOpen(false); }}
                        className="font-display text-sm px-4 py-2 rounded-full"
                        style={{ border: "1px solid rgba(255,255,255,0.3)", color: "var(--color-white)" }}
                      >
                        Sign out
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { openAuthModal(); setMobileOpen(false); }}
                      className="font-display block w-full text-center px-5 py-2.5 rounded-full text-sm font-semibold"
                      style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", borderRadius: "var(--radius-pill)" }}
                    >
                      Sign In / Sign Up
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>
    </div>
  );
};

export default NavbarSection;
