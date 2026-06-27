import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useLocation } from "react-router-dom";
import { NavbarContent, AnnouncementBarContent, type Product } from "@/lib/defaults";
import { getShopCategories, getContent, type ShopCategory } from "@/lib/api";
import { DEFAULT_CONTENT } from "@/lib/defaults";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import CartDrawer from "@/components/CartDrawer";
import logo from "@/assets/logo.jpg";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

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

const ShopDropdown = ({ categories, onClose }: { categories: ShopCategory[]; onClose: () => void }) => (
  <motion.div
    initial={{ opacity: 0, y: 8, scale: 0.97 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: 6, scale: 0.97 }}
    transition={{ duration: 0.18, ease: "easeOut" }}
    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50"
    style={{ minWidth: 220 }}
  >
    <div className="flex justify-center mb-1">
      <div className="w-3 h-3 rotate-45" style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", marginBottom: -8, position: "relative", zIndex: 0 }} />
    </div>
    <div className="rounded-xl overflow-hidden py-2"
      style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", boxShadow: "0 12px 36px rgba(0,0,0,0.14)" }}>
      <a href="/shop" onClick={onClose}
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors group">
        <div className="w-3 h-3 rounded-full shrink-0" style={{ background: "var(--color-forest-dark)" }} />
        <span className="font-display text-sm" style={{ color: "var(--color-forest-dark)" }}>All candles</span>
      </a>
      {categories.length > 0 && <div className="my-1.5 mx-4" style={{ height: 1, background: "var(--color-border)" }} />}
      {categories.map(cat => (
        <a key={cat.id} href={`/shop?category=${cat.slug}`} onClick={onClose}
          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60 transition-colors">
          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: cat.accent_color }} />
          <div className="min-w-0">
            <span className="font-display text-sm block truncate" style={{ color: "var(--color-forest-dark)" }}>{cat.name}</span>
            {cat.mood_description && (
              <span className="font-sans text-xs block truncate" style={{ color: "rgba(30,41,24,0.5)" }}>{cat.mood_description}</span>
            )}
          </div>
        </a>
      ))}
    </div>
  </motion.div>
);

// ── Main Navbar ────────────────────────────────────────────────────────────────

const NavbarSection = ({ data, announcement }: Props) => {
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [shopOpen, setShopOpen]             = useState(false);
  const [mobileShopOpen, setMobileShopOpen] = useState(false);
  const [categories, setCategories]         = useState<ShopCategory[]>([]);
  const [allProducts, setAllProducts]       = useState<Product[]>([]);
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchOpen, setSearchOpen]         = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const links = data.links ?? [];
  const shopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { user, signOut, openAuthModal }    = useAuth();
  const { count }                           = useCart();
  const navigate   = useNavigate();
  const location   = useLocation();

  // Which nav link matches the current page. Route hrefs match by path; hash/anchor
  // links (e.g. Home → "#shop-by-category") belong to the homepage.
  const isLinkActive = (href: string) => {
    if (href.startsWith("/")) {
      return href === "/" ? location.pathname === "/" : location.pathname.startsWith(href);
    }
    if (href.startsWith("#")) return location.pathname === "/";
    return false;
  };

  useEffect(() => {
    getShopCategories().then(cats => setCategories(cats)).catch(() => {});
    getContent<{ items: Product[] }>("products", DEFAULT_CONTENT.products)
      .then(d => setAllProducts(d?.items ?? []));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Live search results — top 6 closest matches
  const searchResults = searchQuery.trim().length >= 1
    ? allProducts.filter(p => {
        const q = searchQuery.toLowerCase();
        return p.name.toLowerCase().includes(q) ||
               p.description?.toLowerCase().includes(q) ||
               p.tag?.toLowerCase().includes(q);
      }).slice(0, 6)
    : [];

  const openShop  = () => { if (shopTimerRef.current) clearTimeout(shopTimerRef.current); setShopOpen(true); };
  const closeShop = () => { shopTimerRef.current = setTimeout(() => setShopOpen(false), 120); };
  const isShopLink = (href: string) => href === "/shop" || href.startsWith("/shop?");
  // Home link: a clean "/" or any legacy anchor value (e.g. "#shop by category").
  const isHomeLink = (href: string) => href === "/" || href.startsWith("#");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    navigate(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
    setMobileOpen(false);
  };

  // Home: when already on the homepage, smooth-scroll to the top; otherwise let
  // the <a href="/"> navigate there normally.
  const goHome = (e: React.MouseEvent) => {
    setMobileOpen(false);
    if (location.pathname === "/") {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const firstName = user?.full_name?.trim().split(" ")[0] || user?.email?.split("@")[0] || null;

  return (
    <div id="site-navbar" className="fixed top-0 left-0 right-0 z-50">
      <AnnouncementBar data={announcement} />

      <nav style={{ background: "var(--bg-nav)" }}>

        {/* ── Row 1: Logo · Search · Account · Basket ── */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-4">

          {/* Logo */}
          <a href="/" className="shrink-0 group" onClick={goHome}>
            <img src={logo} alt="The Olive Goose"
              className="transition-transform group-hover:scale-105 duration-300"
              style={{ height: 40, width: "auto", objectFit: "contain" }} />
          </a>

          {/* Search bar with live dropdown */}
          <div ref={searchRef} className="flex-1 relative">
            <form onSubmit={handleSearch} className="flex">
              <div className="flex w-full rounded-lg overflow-hidden" style={{ border: "2px solid var(--color-gold)" }}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Search fragrances..."
                  className="flex-1 px-4 py-2 font-sans text-sm outline-none"
                  style={{ background: "rgba(255,255,255,0.96)", color: "#111", minWidth: 0 }}
                />
                <button type="submit"
                  className="px-4 flex items-center justify-center transition-opacity hover:opacity-80"
                  style={{ background: "var(--color-gold)" }}>
                  <svg width="18" height="18" fill="none" stroke="#1D2B1B" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                  </svg>
                </button>
              </div>
            </form>

            {/* Live results dropdown */}
            <AnimatePresence>
              {searchOpen && searchResults.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute top-full left-0 right-0 mt-1 rounded-xl overflow-hidden z-50"
                  style={{ background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}
                >
                  {searchResults.map((p, i) => {
                    const img = p.image_url || FALLBACK_IMGS[i % 2];
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          navigate(`/shop?search=${encodeURIComponent(p.name)}`);
                          setSearchQuery(p.name);
                          setSearchOpen(false);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-gray-50"
                        style={{ borderBottom: i < searchResults.length - 1 ? "1px solid #f3f4f6" : "none" }}
                      >
                        <img src={img} alt={p.name}
                          className="rounded-md object-cover shrink-0"
                          style={{ width: 38, height: 38, mixBlendMode: "multiply" }} />
                        <div className="flex-1 min-w-0">
                          <p className="font-sans text-sm font-medium truncate" style={{ color: "#111" }}>{p.name}</p>
                          {p.description && (
                            <p className="font-sans text-xs truncate" style={{ color: "#666" }}>{p.description}</p>
                          )}
                        </div>
                        <span className="font-sans text-sm font-semibold shrink-0" style={{ color: "#6b3520" }}>{p.price}</span>
                      </button>
                    );
                  })}
                  {/* "See all results" footer */}
                  <button
                    onClick={() => { handleSearch({ preventDefault: () => {} } as React.FormEvent); setSearchOpen(false); }}
                    className="flex items-center justify-center w-full px-4 py-2.5 font-sans text-sm font-semibold transition-colors hover:bg-gray-50"
                    style={{ color: "#6b3520", borderTop: "1px solid #f3f4f6" }}
                  >
                    See all results for "{searchQuery}" →
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Account & Lists */}
          <button
            onClick={user ? undefined : openAuthModal}
            className="hidden sm:flex flex-col items-start shrink-0 transition-opacity hover:opacity-80 group"
            style={{ color: "var(--color-white)" }}
          >
            <span className="font-sans text-xs" style={{ color: "rgba(245,239,230,0.75)" }}>
              Hello, {firstName ?? "sign in"}
            </span>
            <span className="font-display text-sm font-semibold leading-tight flex items-center gap-1">
              Account &amp; Lists
              {user && (
                <button onClick={(e) => { e.stopPropagation(); signOut(); }}
                  className="font-sans text-[10px] opacity-50 hover:opacity-100 ml-1 transition-opacity"
                  style={{ color: "var(--color-white)" }}>
                  (sign out)
                </button>
              )}
            </span>
          </button>

          {/* Basket */}
          <button
            onClick={() => { if (user) navigate("/basket"); else openAuthModal(); }}
            className="hidden sm:flex items-center gap-2 shrink-0 transition-opacity hover:opacity-80"
            style={{ color: "var(--color-white)" }}
          >
            <div className="relative">
              <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 01-8 0"/>
              </svg>
              {count > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center font-sans text-[10px] font-bold"
                  style={{ background: "var(--btn-primary-bg)", color: "var(--color-forest-dark)" }}>
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </div>
            <span className="font-display text-sm font-semibold">Basket</span>
          </button>

          {/* Mobile hamburger */}
          <button onClick={() => setMobileOpen(!mobileOpen)}
            className="sm:hidden p-1 rounded transition-opacity hover:opacity-60 ml-auto"
            style={{ color: "var(--color-white)" }} aria-label="Toggle menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                d={mobileOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>

        {/* ── Row 2: Nav links (desktop) — centered ── */}
        <div className="hidden sm:block border-t" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-1.5">
            {links.map((link, i) => {
              const active = isShopLink(link.href) ? location.pathname.startsWith("/shop") : isLinkActive(link.href);
              if (isShopLink(link.href)) {
                return (
                  <div key={`shop-${i}`} className="relative" onMouseEnter={openShop} onMouseLeave={closeShop}>
                    <a href="/shop"
                      className={`flex items-center gap-1.5 font-display text-[15px] px-4 py-2 rounded-full transition-all group ${active ? "font-semibold" : "hover:bg-white/10"}`}
                      style={{ color: active ? "var(--color-forest-dark)" : "rgba(255,255,255,0.85)", background: active ? "var(--color-gold)" : "transparent", letterSpacing: "var(--tracking-nav)" }}>
                      {link.label}
                      <span className="flex items-center gap-[3px] opacity-80 group-hover:opacity-100 transition-opacity" style={{ transform: "translateY(1px)" }}>
                        {[0,1,2].map(d => <span key={d} className="block rounded-full" style={{ width: 3, height: 3, background: active ? "var(--color-forest-dark)" : "var(--color-white)" }} />)}
                      </span>
                    </a>
                    <AnimatePresence>
                      {shopOpen && <ShopDropdown categories={categories} onClose={() => setShopOpen(false)} />}
                    </AnimatePresence>
                  </div>
                );
              }
              return (
                <a key={`${link.label}-${i}`}
                  href={isHomeLink(link.href) ? "/" : link.href}
                  onClick={isHomeLink(link.href) ? goHome : undefined}
                  className={`font-display text-[15px] px-4 py-2 rounded-full transition-all whitespace-nowrap ${active ? "font-semibold" : "hover:bg-white/10"}`}
                  style={{ color: active ? "var(--color-forest-dark)" : "rgba(255,255,255,0.85)", background: active ? "var(--color-gold)" : "transparent", letterSpacing: "var(--tracking-nav)" }}>
                  {link.label}
                </a>
              );
            })}
          </div>
        </div>

        {/* ── Mobile menu ── */}
        <AnimatePresence>
          {mobileOpen && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22 }} className="sm:hidden border-t overflow-hidden"
              style={{ background: "var(--bg-nav)", borderColor: "rgba(255,255,255,0.18)" }}>
              <div className="px-6 py-4 space-y-1">

                {/* Mobile search */}
                <form onSubmit={handleSearch} className="flex mb-4">
                  <div className="flex w-full rounded-lg overflow-hidden" style={{ border: "1.5px solid var(--color-gold)" }}>
                    <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search fragrances..."
                      className="flex-1 px-3 py-2 font-sans text-sm outline-none"
                      style={{ background: "rgba(255,255,255,0.96)", color: "#111" }} />
                    <button type="submit" className="px-3 flex items-center" style={{ background: "var(--color-gold)" }}>
                      <svg width="16" height="16" fill="none" stroke="#1D2B1B" strokeWidth="2" strokeLinecap="round" viewBox="0 0 24 24">
                        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                      </svg>
                    </button>
                  </div>
                </form>

                {links.map((link, i) => {
                  const active = isShopLink(link.href) ? location.pathname.startsWith("/shop") : isLinkActive(link.href);
                  if (isShopLink(link.href)) {
                    return (
                      <div key={`m-shop-${i}`}>
                        <div className="flex items-center justify-between py-2">
                          <a href="/shop" onClick={() => setMobileOpen(false)}
                            className={`font-display text-base rounded-lg transition-all ${active ? "font-semibold px-3 py-1.5" : "hover:opacity-70"}`}
                            style={{ color: active ? "var(--color-forest-dark)" : "var(--color-white)", background: active ? "var(--color-gold)" : "transparent" }}>{link.label}</a>
                          <button onClick={() => setMobileShopOpen(o => !o)}
                            className="font-sans text-xs px-2 py-1 rounded opacity-70 hover:opacity-100"
                            style={{ color: "var(--color-white)", border: "1px solid rgba(255,255,255,0.3)" }}>
                            {mobileShopOpen ? "▲" : "▼"} Categories
                          </button>
                        </div>
                        <AnimatePresence>
                          {mobileShopOpen && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.18 }} className="overflow-hidden pl-4 space-y-1 pb-2">
                              <a href="/shop" onClick={() => setMobileOpen(false)}
                                className="flex items-center gap-2 py-1.5 font-sans text-sm transition-opacity hover:opacity-70"
                                style={{ color: "rgba(245,239,230,0.8)" }}>
                                <span className="block w-2 h-2 rounded-full shrink-0" style={{ background: "rgba(245,239,230,0.5)" }} />
                                All candles
                              </a>
                              {categories.map(cat => (
                                <a key={cat.id} href={`/shop?category=${cat.slug}`} onClick={() => setMobileOpen(false)}
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
                    <a key={`m-${link.label}-${i}`}
                      href={isHomeLink(link.href) ? "/" : link.href}
                      onClick={(e) => { if (isHomeLink(link.href)) goHome(e); else setMobileOpen(false); }}
                      className={`font-display block text-base rounded-lg transition-all ${active ? "font-semibold px-3 py-2" : "py-2 hover:opacity-70"}`}
                      style={{ color: active ? "var(--color-forest-dark)" : "var(--color-white)", background: active ? "var(--color-gold)" : "transparent" }}>
                      {link.label}
                    </a>
                  );
                })}

                <div className="pt-3 flex items-center justify-between gap-3">
                  {user ? (
                    <>
                      <span className="font-sans text-sm" style={{ color: "rgba(245,239,230,0.7)" }}>
                        Hello, {firstName}
                      </span>
                      <button onClick={() => { signOut(); setMobileOpen(false); }}
                        className="font-display text-sm px-4 py-2 rounded-full"
                        style={{ border: "1px solid rgba(255,255,255,0.3)", color: "var(--color-white)" }}>
                        Sign out
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { openAuthModal(); setMobileOpen(false); }}
                      className="font-display w-full text-center px-5 py-2.5 rounded-full text-sm font-semibold"
                      style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", borderRadius: "var(--radius-pill)" }}>
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
