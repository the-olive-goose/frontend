import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { getContent, getShopCategories, type ShopCategory } from "@/lib/api";
import { DEFAULT_CONTENT, type Product } from "@/lib/defaults";
import NavbarSection from "@/components/sections/NavbarSection";
import FooterSection from "@/components/sections/FooterSection";
import m1 from "@/assets/M1.png";
import m2 from "@/assets/M2.png";

const FALLBACK_IMGS = [m1, m2];

// ── Product card ───────────────────────────────────────────────────────────────

const ProductCard = ({ product, idx, accent = "#1D2B1B" }: {
  product: Product; idx: number; accent?: string;
}) => {
  const img = product.image_url || FALLBACK_IMGS[idx % 2];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.3, delay: (idx % 6) * 0.05 }}
      whileHover={{ y: -6, transition: { duration: 0.2 } }}
      className="group flex flex-col rounded-2xl overflow-hidden"
      style={{ background: "var(--color-cream-card)", border: "1px solid var(--color-border)", boxShadow: "0 4px 18px rgba(0,0,0,0.07)" }}
    >
      {/* Image */}
      <div className="relative overflow-hidden" style={{ aspectRatio: "3/4", background: "var(--color-sage-pale)" }}>
        <img
          src={img}
          alt={product.name}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          style={{ mixBlendMode: "multiply" }}
        />
        {product.tag && (
          <span
            className="absolute top-3 left-3 font-display text-xs font-semibold tracking-wider uppercase px-3 py-1 rounded-full"
            style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
          >
            {product.tag}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-5 gap-3">
        <div className="flex-1">
          <h3
            className="font-display text-xl leading-tight mb-1"
            style={{ color: "var(--color-forest-dark)" }}
          >
            {product.name}
          </h3>
          <p
            className="font-sans text-sm leading-relaxed"
            style={{ color: "rgba(30,41,24,0.62)" }}
          >
            {product.description}
          </p>
        </div>

        <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid var(--color-border)" }}>
          <span
            className="font-display text-2xl font-semibold"
            style={{ color: accent || "var(--color-forest-dark)" }}
          >
            {product.price}
          </span>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            className="font-display text-sm font-semibold px-5 py-2.5 rounded-full transition-all"
            style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
          >
            Add to Cart
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
};

// ── Shop Page ──────────────────────────────────────────────────────────────────

const ShopPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories]   = useState<ShopCategory[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [content, setContent]         = useState(DEFAULT_CONTENT);
  const [loading, setLoading]         = useState(true);

  const activeSlug = searchParams.get("category") ?? "all";

  useEffect(() => {
    Promise.all([
      getContent("announcementBar", DEFAULT_CONTENT.announcementBar),
      getContent("navbar",          DEFAULT_CONTENT.navbar),
      getContent("footer",          DEFAULT_CONTENT.footer),
      getContent("products",        DEFAULT_CONTENT.products),
      getShopCategories(),
    ]).then(([announcementBar, navbar, footer, products, cats]) => {
      setContent(prev => ({ ...prev, announcementBar, navbar, footer, products }));
      setAllProducts(products.items ?? []);
      setCategories(cats);
    }).finally(() => setLoading(false));
  }, []);

  // Resolve products for the active category
  const visibleProducts: Product[] = (() => {
    if (activeSlug === "all") return allProducts;
    const cat = categories.find(c => c.slug === activeSlug);
    if (!cat || !cat.product_ids?.length) return [];
    return cat.product_ids
      .map(id => allProducts.find(p => p.id === id))
      .filter((p): p is Product => !!p);
  })();

  const activeCat = categories.find(c => c.slug === activeSlug);

  const setCategory = (slug: string) => {
    if (slug === "all") setSearchParams({});
    else setSearchParams({ category: slug });
    window.scrollTo({ top: 300, behavior: "smooth" });
  };

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <NavbarSection data={content.navbar} announcement={content.announcementBar} />

      {/* ── Hero ── */}
      <div
        className="w-full pt-[94px]"
        style={{ background: "var(--color-forest-dark)" }}
      >
        <div className="max-w-7xl mx-auto px-6 sm:px-12 py-16 sm:py-20">
          <motion.p
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="font-display text-xs tracking-[0.2em] uppercase mb-4"
            style={{ color: "var(--color-gold)" }}
          >
            ✦ &nbsp; The Collection
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="font-serif font-semibold mb-4"
            style={{ fontSize: "clamp(2.4rem,5vw,4rem)", color: "var(--color-cream-text)", lineHeight: 1.05 }}
          >
            {activeSlug === "all" ? "All Candles" : (activeCat?.name ?? "Shop")}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18 }}
            className="font-sans text-sm max-w-md leading-relaxed"
            style={{ color: "rgba(245,239,230,0.65)" }}
          >
            {activeSlug === "all"
              ? "Handpoured small-batch candles crafted for every mood, moment and era."
              : (activeCat?.mood_description ?? "")}
          </motion.p>
        </div>
      </div>

      {/* ── Category filter pills ── */}
      {categories.length > 0 && (
        <div style={{ background: "var(--color-sage-mid)", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div className="max-w-7xl mx-auto px-6 sm:px-12 py-4 flex items-center gap-3 overflow-x-auto no-scrollbar">
            {/* All pill */}
            <button
              onClick={() => setCategory("all")}
              className="shrink-0 font-display text-sm font-semibold px-5 py-2 rounded-full transition-all"
              style={{
                background: activeSlug === "all" ? "var(--color-forest-dark)" : "rgba(255,255,255,0.22)",
                color: activeSlug === "all" ? "var(--color-cream-text)" : "var(--color-forest-dark)",
                border: "1.5px solid transparent",
              }}
            >
              All
            </button>

            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.slug)}
                className="shrink-0 font-display text-sm font-semibold px-5 py-2 rounded-full transition-all"
                style={{
                  background: activeSlug === cat.slug ? cat.accent_color : "rgba(255,255,255,0.22)",
                  color: activeSlug === cat.slug ? "#fff" : "var(--color-forest-dark)",
                  border: `1.5px solid ${activeSlug === cat.slug ? cat.accent_color : "transparent"}`,
                }}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Product grid ── */}
      <div className="max-w-7xl mx-auto px-6 sm:px-12 py-14">

        {/* Category mood bar (when filtered) */}
        {activeCat && activeSlug !== "all" && (
          <motion.div
            key={activeSlug}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 mb-10"
          >
            <div className="w-3 h-3 rounded-full" style={{ background: activeCat.accent_color }} />
            <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.6)" }}>
              {activeCat.mood_description}
            </p>
            <div className="flex gap-2 ml-2">
              {(activeCat.tags ?? []).map(tag => (
                <span
                  key={tag}
                  className="font-sans text-xs px-2.5 py-0.5 rounded-full"
                  style={{ background: `${activeCat.accent_color}18`, color: activeCat.accent_color, border: `1px solid ${activeCat.accent_color}35` }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </motion.div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-20">
            <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && visibleProducts.length === 0 && (
          <div className="py-20 text-center space-y-4">
            <p className="text-4xl">🕯️</p>
            <p className="font-serif text-xl" style={{ color: "var(--color-forest-dark)" }}>
              {activeSlug === "all" ? "No products yet" : "No products in this category yet"}
            </p>
            <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.55)" }}>
              {activeSlug === "all"
                ? "Products will appear here once added in the admin panel."
                : "Try another category or browse all candles."}
            </p>
            {activeSlug !== "all" && (
              <button
                onClick={() => setCategory("all")}
                className="mt-4 font-display text-sm font-semibold px-6 py-2.5 rounded-full"
                style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}
              >
                Browse all candles →
              </button>
            )}
          </div>
        )}

        {/* Grid */}
        {!loading && visibleProducts.length > 0 && (
          <>
            <p className="font-sans text-xs text-right mb-6" style={{ color: "rgba(30,41,24,0.45)" }}>
              {visibleProducts.length} candle{visibleProducts.length !== 1 ? "s" : ""}
            </p>
            <motion.div layout className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <AnimatePresence mode="popLayout">
                {visibleProducts.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    idx={i}
                    accent={activeCat?.accent_color}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </div>

      <FooterSection data={content.footer} />
    </div>
  );
};

export default ShopPage;
